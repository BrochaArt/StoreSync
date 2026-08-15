-- 008 — API gateway (Decisión 6): extracción read-only del catálogo para
-- consumidores externos. El schema de consumidores (api_consumers /
-- api_request_log) ya existe desde la 002; esto agrega la función que shape
-- los datos. La Edge Function api-gateway la invoca DESPUÉS de autenticar por
-- API key y validar el scoping por tienda (server-side).
--
-- Contrato de seguridad (§11): esta función SOLO expone catálogo, inventario
-- e imágenes. JAMÁS credenciales, secretos de Vault, órdenes ni datos de otra
-- tienda. Asume que p_shop_id YA fue autorizado para el consumidor: el scoping
-- (allowed_shop_ids) y el rate limit los aplica la Edge Function antes de
-- llamar aquí. Es SECURITY DEFINER solo para leer saltándose el RLS deny-all;
-- no recibe ni el consumer ni el key.

-- Paginación keyset por product.id (estable para "extraer todo" página a
-- página). p_after = último id de la página previa (null = desde el inicio).
-- El límite se acota a [1, 100] para que ningún consumidor pida un volcado
-- gigante en una sola llamada.
create or replace function api_get_catalog(
  p_shop_id uuid,
  p_limit   int,
  p_after   uuid default null
) returns jsonb
language sql
security definer
set search_path = public
as $$
  with lim as (
    select least(greatest(coalesce(p_limit, 50), 1), 100) as n
  ),
  -- Traemos n+1 para saber si hay más sin una segunda query de conteo total.
  peek as (
    select p.*
    from products p, lim
    where p.shop_id = p_shop_id
      and p.deleted_at is null
      and (p_after is null or p.id > p_after)
    order by p.id
    limit (select n from lim) + 1
  ),
  page as (
    select * from peek order by id limit (select n from lim)
  ),
  shaped as (
    select
      p.id,
      jsonb_build_object(
        'id',                 p.id,
        'shopify_product_id', p.shopify_product_id,
        'title',              p.title,
        'handle',             p.handle,
        'description_html',   p.description_html,
        'status',             p.status,
        'updated_at',         p.updated_at,
        'images', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',               pi.id,
            'shopify_image_id', pi.shopify_image_id,
            'url',              pi.url,
            'alt_text',         pi.alt_text,
            'position',         pi.position
          ) order by pi.position, pi.id)
          from product_images pi where pi.product_id = p.id
        ), '[]'::jsonb),
        'variants', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',                 v.id,
            'shopify_variant_id', v.shopify_variant_id,
            'sku',                v.sku,
            'price',              v.price,
            'inventory', coalesce((
              select jsonb_agg(jsonb_build_object(
                'location_id', il.location_id,
                'available',   il.available,
                'updated_at',  il.updated_at
              ) order by il.location_id)
              from inventory_levels il where il.variant_id = v.id
            ), '[]'::jsonb)
          ) order by v.id)
          from variants v where v.product_id = p.id
        ), '[]'::jsonb)
      ) as product
    from page p
  )
  select jsonb_build_object(
    'shop', jsonb_build_object(
      'id',     s.id,
      'domain', s.shop_domain
    ),
    'pagination', jsonb_build_object(
      'limit',       (select n from lim),
      'returned',    (select count(*) from page),
      'has_more',    (select count(*) from peek) > (select count(*) from page),
      'next_cursor', (select id::text from page order by id desc limit 1)   -- null cuando la página va vacía
    ),
    'products', coalesce((select jsonb_agg(product order by id) from shaped), '[]'::jsonb)
  )
  from shops s
  where s.id = p_shop_id;
$$;

revoke all on function api_get_catalog(uuid, int, uuid) from public, anon, authenticated;
grant execute on function api_get_catalog(uuid, int, uuid) to service_role;
