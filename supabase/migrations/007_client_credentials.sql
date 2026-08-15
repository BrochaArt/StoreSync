-- 007 — Migrar de token estático (shpat_) a Client Credentials grant.
--
-- Shopify retiró las Custom Apps clásicas el 1 de enero de 2026: las apps
-- nuevas (Dev Dashboard) NO entregan un access_token permanente. En su lugar,
-- cada tienda entrega client_id + client_secret (los mismos que firman sus
-- webhooks — confirmado contra shopify.dev), y el access_token se MINTEA bajo
-- demanda contra POST /admin/oauth/access_token (válido 24h, de sobra para
-- una corrida de import/registro; no requiere caché ni cron: cada operación
-- mintea el suyo y lo descarta — "refresco automático" = nunca reutilizar uno
-- viejo entre corridas).
--
-- shops.access_token_secret_id / webhook_secret_id (un solo secreto real,
-- duplicado en dos slots de Vault) se reemplazan por: client_id (texto plano,
-- inútil sin el secret) + client_secret_id (Vault — la única referencia real).
--
-- Ambas tablas (local y cloud) están vacías de tiendas reales al momento de
-- este cambio: alter directo, sin migración de datos.

alter table shops drop column if exists access_token_secret_id;
alter table shops drop column if exists webhook_secret_id;
alter table shops add column if not exists client_id text not null;
alter table shops add column if not exists client_secret_id uuid not null;

-- ── create_shop_with_secrets: un solo secreto (client_secret) en Vault ────────
-- Los nombres de los parámetros de entrada cambian (p_access_token ->
-- p_client_id/p_client_secret): Postgres no permite renombrarlos vía
-- CREATE OR REPLACE (a diferencia de las columnas de un RETURNS TABLE),
-- hay que dropear la función antes.

drop function if exists create_shop_with_secrets(uuid, text, text, text, text, boolean);

create function create_shop_with_secrets(
  p_artist_id         uuid,
  p_shop_domain       text,
  p_client_id         text,
  p_client_secret     text,
  p_location_id       text,
  p_inventory_tracked boolean
) returns table (shop_id uuid, created boolean)
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_shop shops%rowtype;
  v_secret_sid uuid;
begin
  select * into v_shop from shops s where s.shop_domain = p_shop_domain;

  if found then
    perform vault.update_secret(v_shop.client_secret_id, p_client_secret);

    update shops s set
      client_id         = p_client_id,
      location_id       = p_location_id,
      inventory_tracked = p_inventory_tracked,
      status            = 'active'
    where s.id = v_shop.id;

    insert into audit_log (shop_id, entity, entity_id, action, detail)
    values (v_shop.id, 'shop', v_shop.id::text, 'credentials_rotated',
            jsonb_build_object('shop_domain', p_shop_domain, 'location_id', p_location_id));

    shop_id := v_shop.id;
    created := false;
    return next;
    return;
  end if;

  v_secret_sid := vault.create_secret(
    p_client_secret,
    'shop_client_secret_' || p_shop_domain,
    'Client secret (OAuth + firma de webhooks) para ' || p_shop_domain);

  insert into shops (artist_id, shop_domain, client_id, client_secret_id,
                     location_id, inventory_tracked)
  values (p_artist_id, p_shop_domain, p_client_id, v_secret_sid,
          p_location_id, p_inventory_tracked)
  returning id into shop_id;

  insert into audit_log (shop_id, entity, entity_id, action, detail)
  values (shop_id, 'shop', shop_id::text, 'onboarded',
          jsonb_build_object('shop_domain', p_shop_domain, 'location_id', p_location_id));

  created := true;
  return next;
end;
$$;

revoke all on function create_shop_with_secrets(uuid, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function create_shop_with_secrets(uuid, text, text, text, text, boolean)
  to service_role;

-- ── get_shop_credentials: client_id + client_secret descifrado ───────────────
-- El shape de retorno cambia (access_token/webhook_secret -> client_id/
-- client_secret): hay que dropear la función antes de recrearla.

drop function if exists get_shop_credentials(uuid);

create function get_shop_credentials(p_shop_id uuid)
returns table (shop_domain text, client_id text, client_secret text, location_id text)
language sql
security definer
set search_path = public, vault
as $$
  select s.shop_domain,
         s.client_id,
         v.decrypted_secret as client_secret,
         s.location_id
  from shops s
  join vault.decrypted_secrets v on v.id = s.client_secret_id
  where s.id = p_shop_id;
$$;

revoke all on function get_shop_credentials(uuid) from public, anon, authenticated;
grant execute on function get_shop_credentials(uuid) to service_role;
