-- 014 — Los atributos extraídos suben a campos propios del producto.
--
-- Hasta la 013 todo lo que se sacó de las descripciones (tamaño, año, técnica,
-- material, tipo de papel, información adicional, enlace NFT) viajaba SOLO
-- dentro de `details[]`. Para leer el tamaño había que recorrer un arreglo
-- buscando la clave: el dato estaba, pero no como parámetro.
--
-- Ahora cada uno es un campo del objeto: `producto.size`, `producto.year`, etc.
-- `details[]` se mantiene completo —incluidos estos— porque es la forma que
-- pidió el consumidor para pintar la ficha: etiqueta + valor, en el orden y con
-- el nombre que el artista les puso.
--
-- Convención publicada, igual para toda tienda (Decisión 7b): el metafield
-- `custom.<clave>` alimenta el campo `<clave>`. Quien no lo cargue recibe null.
-- Los campos promovidos son un conjunto FIJO y documentado; los metafields que
-- un artista invente por su cuenta siguen llegando solo por `details`.
--
-- Se elimina la excepción que ocultaba `custom.category` de `details`: ahora la
-- regla es una sola, sin casos especiales — todo metafield del artista aparece
-- en la lista, y además los canónicos suben a campo propio.

-- Valor de un metafield del namespace 'custom' por clave. null si no está.
create or replace function metafield_valor(p_metafields jsonb, p_key text)
returns text
language sql
immutable
parallel safe
as $$
  select mf->>'value'
  from jsonb_array_elements(coalesce(p_metafields, '[]'::jsonb)) as e(mf)
  where mf->>'namespace' = 'custom'
    and mf->>'key' = p_key
  limit 1;
$$;

comment on function metafield_valor(jsonb, text) is
  'Valor de un metafield custom.<clave> del producto, o null.';

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
            'value', mf->>'value'
          ) order by ord)
          from jsonb_array_elements(coalesce(p.metafields, '[]'::jsonb))
               with ordinality as e(mf, ord)
          -- Namespaces reservados por Shopify en TODA tienda: 'global' es el
          -- SEO y 'shopify'/'shopify--*' son sus apps internas.
          where coalesce(mf->>'namespace', '') not in ('global', 'shopify')
            and coalesce(mf->>'namespace', '') not like 'shopify--%'
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
            -- Si el producto se vende en varias medidas, el tamaño está acá
            -- (por variante, con su precio) y `size` arriba viene null.
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
