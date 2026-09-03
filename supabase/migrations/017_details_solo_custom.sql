-- 017 — details: solo metafields del artista, no de las apps que instaló.
--
-- El filtro de `details` era una lista negra (global / shopify / shopify--%) y
-- por eso entregaba al consumidor la configuración interna de apps de terceros:
-- en la tienda de Rafael, 11 productos traían zipifypages.config,
-- zipifypages.productpagedata, headercontent, footercontent, btnpopups,
-- stylesversion, productpagescripts, más mc-facebook y mm-google-shopping.
-- Ni un solo atributo real: esa tienda no tiene metafields `custom`.
--
-- Medido sobre las dos tiendas antes del cambio:
--   Sara   custom(16 claves, 1058 apariciones) + global(SEO, ya excluido)
--   Rafael zipifypages(7) + mc-facebook(1) + mm-google-shopping(1) + global(2)
--
-- La lista blanca por `custom` conserva TODO lo de Sara y descarta TODO el ruido
-- de Rafael, cuyo `details` queda vacío — que es la verdad: no cargó atributos.
-- Los campos canónicos al nivel del producto (size, year, technique…) no cambian:
-- ya leían `custom.<clave>` explícitamente.

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
      coalesce(a.name, s.shop_name) as artist_name,
      coalesce(s.metafield_definitions, '{}'::jsonb) as defs
    from shops s
    left join artists a on a.id = s.artist_id
    where s.id = p_shop_id
  ),
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
        'description_text',   html_a_texto(p.description_html),
        'status',             p.status,
        'updated_at',         p.updated_at,
        -- ── Atributos del producto ──────────────────────────────────────────
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
        -- rich_text_field: se entrega ya aplanado, nunca el árbol
        'about_the_artwork',  rich_text_plano(metafield_valor(p.metafields, 'about_the_artwork')),
        -- ── Campos estándar de Shopify, crudos ──────────────────────────────
        'vendor',             p.vendor,
        'product_type',       p.product_type,
        'tags',               to_jsonb(coalesce(p.tags, '{}'::text[])),
        'shopify_taxonomy',   p.taxonomy_category,
        'collections',        coalesce(p.collections, '[]'::jsonb),
        -- ── La lista completa, para pintar la ficha ─────────────────────────
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
          -- Lista BLANCA: solo el namespace donde Shopify guarda los metafields
          -- que define el comerciante. La lista negra anterior ('global',
          -- 'shopify', 'shopify--%') dejaba pasar los de apps de terceros:
          -- zipifypages (page builder), mc-facebook y mm-google-shopping se
          -- estaban entregando como si fueran atributos del producto. Cada app
          -- nueva que instale un artista abriría otro agujero; con lista blanca
          -- no hay nada que perseguir.
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
            'options',            coalesce(v.options, '[]'::jsonb),
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
    from page p cross join tienda t
  )
  select jsonb_build_object(
    'shop', jsonb_build_object(
      'id',     t.id,
      'domain', t.shop_domain,
      'name',   t.shop_name,
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
