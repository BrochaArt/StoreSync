-- 018 — Refresco periódico de collections, metafields y taxonomía (PENDIENTES #6)
--
-- El payload REST de products/update NO trae collections, metafields ni la
-- categoría de taxonomía, así que el worker no puede refrescarlos: hasta ahora
-- solo los actualizaba un import completo a mano. Si el artista mueve un
-- producto de colección o edita un metafield, el gateway sirve el valor viejo
-- indefinidamente.
--
-- Se resuelve con un job que relee esas tres columnas desde Shopify. NO es un
-- import: no crea ni borra productos —de eso se encargan products/create y
-- products/delete— y no toca titulo, precio, imagenes ni inventario, que sí
-- viajan en el webhook. Radio de acción deliberadamente angosto.

-- Marca para elegir la tienda más rancia en cada corrida. NULL = nunca
-- refrescada, así que entra primero.
alter table shops add column if not exists last_refreshed_at timestamptz;

comment on column shops.last_refreshed_at is
  'Última corrida del refresco de collections/metafields/taxonomía (migración 018).';

-- ── Elegir la tienda a refrescar ─────────────────────────────────────────────
-- Una por corrida: el trabajo por invocación queda acotado sin importar cuántos
-- artistas haya. Con N tiendas y el cron cada 15 min, cada una se refresca cada
-- N*15 minutos. Solo tiendas 'active': una en needs_reauth no puede mintear.

create or replace function shop_a_refrescar()
returns table (shop_id uuid, shop_domain text)
language sql
security definer
set search_path = public
as $$
  select s.id, s.shop_domain
  from shops s
  where s.status = 'active'
  order by s.last_refreshed_at asc nulls first, s.created_at asc
  limit 1;
$$;

revoke all on function shop_a_refrescar() from public, anon, authenticated;
grant execute on function shop_a_refrescar() to service_role;

-- ── Aplicar el refresco en bloque ────────────────────────────────────────────
-- Un solo UPDATE contra el lote entero en vez de N llamadas: el Edge Function
-- se mantiene delgado y la escritura es atómica.
--
-- p_items: [{ "shopify_product_id": "123",
--             "taxonomy_category": {...} | null,
--             "collections": [...],
--             "metafields": [...] }]
--
-- Solo actualiza filas que YA existen para esa tienda. Un producto que Shopify
-- devuelve y nosotros no tenemos se ignora: crearlo es trabajo del webhook
-- products/create, y hacerlo aquí duplicaría esa lógica a medias.

create or replace function refresh_catalog_metadata(
  p_shop_id uuid,
  p_items   jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actualizados integer;
begin
  with entrada as (
    select
      item->>'shopify_product_id'                       as shopify_product_id,
      nullif(item->'taxonomy_category', 'null'::jsonb)  as taxonomy_category,
      coalesce(item->'collections', '[]'::jsonb)        as collections,
      coalesce(item->'metafields',  '[]'::jsonb)        as metafields
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item
  ),
  aplicado as (
    update products p set
      taxonomy_category = e.taxonomy_category,
      collections       = e.collections,
      metafields        = e.metafields
    from entrada e
    where p.shop_id = p_shop_id
      and p.shopify_product_id = e.shopify_product_id
      -- No escribir si nada cambió: evita reescribir 200 filas por gusto
      and (p.taxonomy_category is distinct from e.taxonomy_category
        or p.collections       is distinct from e.collections
        or p.metafields        is distinct from e.metafields)
    returning p.id
  )
  select count(*) into v_actualizados from aplicado;

  update shops set last_refreshed_at = now() where id = p_shop_id;

  return v_actualizados;
end;
$$;

revoke all on function refresh_catalog_metadata(uuid, jsonb) from public, anon, authenticated;
grant execute on function refresh_catalog_metadata(uuid, jsonb) to service_role;

-- ── Agendado (mismo patrón que la 006) ───────────────────────────────────────
-- El token nunca queda en texto plano en el comando: se lee del Vault en cada
-- ejecución. Reutiliza worker_sync_token porque el invocador es el mismo
-- (pg_cron sobre esta base) y la frontera de confianza es idéntica; un secreto
-- aparte solo agregaría un paso de despliegue sin cerrar ninguna puerta nueva.
--
-- Uso por entorno (una vez):
--   select schedule_refresh_cron('https://<proyecto>.supabase.co/functions/v1/refresh-catalog');
-- Para detener: select cron.unschedule('refresh-catalogo');

create or replace function schedule_refresh_cron(
  p_function_url text,
  p_secret_name  text default 'worker_sync_token',
  p_schedule     text default '*/15 * * * *'
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cmd text;
begin
  if not exists (select 1 from vault.secrets where name = p_secret_name) then
    raise exception 'No existe el secreto "%" en Vault: crearlo antes con vault.create_secret', p_secret_name;
  end if;

  v_cmd := format(
    $cmd$select net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = %L)),
      body := '{}'::jsonb);$cmd$,
    p_function_url, p_secret_name);

  return cron.schedule('refresh-catalogo', p_schedule, v_cmd);
end;
$$;

revoke all on function schedule_refresh_cron(text, text, text) from public, anon, authenticated;
grant execute on function schedule_refresh_cron(text, text, text) to service_role;
