-- 022 — Moneda en el catálogo y orden real de las variantes.
--
-- Los dos bugs salieron del mismo caso: el grabado "El RETRO FLYING GOLDFISH"
-- de Rafael. En su Shopify vale S/. 395 (A4 sin marco); el consumidor lo
-- publicó como USD 475. Dos fallas nuestras encadenadas:
--
-- 1. SIN MONEDA. `variants.price` es un numérico pelado y en todo el catálogo
--    no había ninguna columna de moneda — `currency` existía solo en `orders`.
--    El API entregaba `475` sin decir nunca en qué moneda, así que el consumidor
--    asumió dólares. Adivinó mal, pero lo obligábamos a adivinar: S/. 475 son
--    unos USD 128, no 475.
--
-- 2. ORDEN ARBITRARIO. No se guardaba el `position` de la variante, y
--    `api_get_catalog` ordenaba `by v.id` — un uuid, o sea al azar. Para ese
--    producto el orden entregado era:
--      A4/Con marco (475) → A3/Con marco (645) → A3/Sin marco (535) → A4/Sin marco (395)
--    contra el del artista, que empieza por A4/Sin marco (395). La variante que
--    encabeza la ficha define el precio que ve el comprador, así que el orden
--    al azar era también un precio al azar.
--
-- Ambos campos ya venían de Shopify y solo no se estaban guardando: `position`
-- viaja en el payload REST del webhook (verificado sobre un products/update
-- real) y `Shop.currencyCode` existe en la Admin API 2026-07 (verificado por
-- introspección contra la tienda de Rafael).
--
-- La moneda va a nivel TIENDA, no de variante: Shopify define una sola moneda
-- por tienda y todos los precios del admin están en ella. Ponerla por variante
-- invitaría a que se desincronicen entre sí.

alter table shops    add column if not exists currency text;
alter table variants add column if not exists position int;

comment on column shops.currency is
  'ISO 4217 de Shopify (shop.currencyCode). Sin esto el consumidor adivina la moneda del precio.';
comment on column variants.position is
  'Orden definido por el artista en su admin. NULL = todavía sin importar; ver el orden en api_get_catalog.';

-- Índice para el orden: se lee en cada armado de catálogo.
create index if not exists idx_variants_product_position on variants(product_id, position);

-- ── api_get_catalog: expone la moneda y ordena por position ───────────────────
-- Cambios sobre la 021:
--   · `shop.currency` nuevo en el payload.
--   · Las variantes se ordenan `position nulls last, id` — el `id` queda solo
--     como desempate estable para las que todavía no tienen position (datos
--     previos al backfill), para que el orden no baile entre llamadas.

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
  tienda as (
    select
      s.id, s.shop_domain, s.shop_name, s.contact_email, s.website, s.bio,
      s.currency,
      coalesce(a.name, s.shop_name) as artist_name,
      coalesce(s.metafield_definitions, '{}'::jsonb) as defs
    from shops s
    left join artists a on a.id = s.artist_id
    where s.id = p_shop_id
      and s.status = 'active'
  ),
  vendibles as (
    select v.id as variant_id, v.product_id
    from variants v
    join products p on p.id = v.product_id
    where p.shop_id = p_shop_id
      and coalesce((
        select sum(il.available) from inventory_levels il where il.variant_id = v.id
      ), 0) > 0
  ),
  peek as (
    select p.*
    from products p, lim
    where p.shop_id = p_shop_id
      and p.deleted_at is null
      and p.status = 'active'
      and exists (select 1 from vendibles vd where vd.product_id = p.id)
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
        'description_text',   html_a_texto(p.description_html),
        'status',             p.status,
        'updated_at',         p.updated_at,
        'artist',             t.artist_name,
        'artist_email',       t.contact_email,
        'category',           metafield_valor(p.metafields, 'category'),
        'size',               metafield_valor(p.metafields, 'size'),
        'year',               metafield_valor(p.metafields, 'year'),
        'technique',          metafield_valor(p.metafields, 'technique'),
        'material',           metafield_valor(p.metafields, 'material'),
        'paper_type',         metafield_valor(p.metafields, 'paper_type'),
        'additional_info',    metafield_valor(p.metafields, 'additional_info'),
        'nft_link',           metafield_valor(p.metafields, 'nft_link'),
        'shipping',           metafield_valor(p.metafields, 'shipping'),
        'about_the_artwork',  rich_text_plano(metafield_valor(p.metafields, 'about_the_artwork')),
        'vendor',             p.vendor,
        'product_type',       p.product_type,
        'tags',               to_jsonb(coalesce(p.tags, '{}'::text[])),
        'shopify_taxonomy',   p.taxonomy_category,
        'collections',        coalesce(p.collections, '[]'::jsonb),
        'details', coalesce((
          select jsonb_agg(jsonb_build_object(
            'key',   (mf->>'namespace') || '.' || (mf->>'key'),
            'label', coalesce(
                       t.defs ->> ((mf->>'namespace') || '.' || (mf->>'key')),
                       mf->>'key'
                     ),
            'type',  mf->>'type',
            'value', mf->>'value',
            'value_text', case
                            when mf->>'type' = 'rich_text_field'
                              then rich_text_plano(mf->>'value')
                            else mf->>'value'
                          end
          ) order by ord)
          from jsonb_array_elements(coalesce(p.metafields, '[]'::jsonb))
               with ordinality as e(mf, ord)
          where coalesce(mf->>'namespace', '') = 'custom'
        ), '[]'::jsonb),
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
            'title',              v.title,
            'sku',                v.sku,
            'price',              v.price,
            'position',           v.position,
            'options',            coalesce(v.options, '[]'::jsonb),
            'inventory', coalesce((
              select jsonb_agg(jsonb_build_object(
                'location_id', il.location_id,
                'available',   il.available,
                'updated_at',  il.updated_at
              ) order by il.location_id)
              from inventory_levels il where il.variant_id = v.id
            ), '[]'::jsonb)
          ) order by v.position nulls last, v.id)
          from variants v
          where v.product_id = p.id
            and exists (select 1 from vendibles vd where vd.variant_id = v.id)
        ), '[]'::jsonb)
      ) as product
    from page p cross join tienda t
  )
  select jsonb_build_object(
    'shop', jsonb_build_object(
      'id',       t.id,
      'domain',   t.shop_domain,
      'name',     t.shop_name,
      -- Moneda de TODOS los precios de este payload. Puede venir null mientras
      -- la tienda no haya refrescado su perfil; un consumidor que la reciba
      -- null NO debe asumir una moneda por defecto.
      'currency', t.currency,
      'artist', jsonb_build_object(
        'name',    t.artist_name,
        'email',   t.contact_email,
        'website', t.website,
        'bio',     t.bio
      )
    ),
    'pagination', jsonb_build_object(
      'limit',       (select n from lim),
      'returned',    (select count(*) from page),
      'has_more',    (select count(*) from peek) > (select count(*) from page),
      'next_cursor', (select id::text from page order by id desc limit 1)
    ),
    'products', coalesce((select jsonb_agg(product order by id) from shaped), '[]'::jsonb)
  )
  from tienda t;
$$;

revoke all on function api_get_catalog(uuid, int, uuid) from public, anon, authenticated;
grant execute on function api_get_catalog(uuid, int, uuid) to service_role;
