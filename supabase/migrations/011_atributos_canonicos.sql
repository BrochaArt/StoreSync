-- 011 — Atributos canónicos: artista, email y categoría como parámetros
-- propios del producto.
--
-- Qué cambia y por qué:
--
-- 1. `artist` / `artist_email` en CADA producto, además de en `shop.artist`.
--    El consumidor guarda productos sueltos y necesita que cada uno se baste
--    a sí mismo, sin volver al bloque de tienda.
--
-- 2. `category` pasa a ser la categoría de NEGOCIO (Obra Original / Réplica /
--    Producto), leída del metafield `custom.category`. La taxonomía global de
--    Shopify se conserva bajo `shopify_taxonomy`.
--    RENOMBRE de un campo publicado en la 010 — hay que avisar al consumidor.
--    Motivo: la taxonomía devolvía "Arts & Entertainment" en los 205 productos
--    de la tienda auditada; `category` con ese contenido no le sirve a nadie.
--
-- Esto NO contradice la Decisión 7. El mapa `custom.category -> category` es
-- una convención NUESTRA, publicada y aplicada idéntica a todas las tiendas:
-- quien llene el metafield obtiene el campo, quien no, lo obtiene en null.
-- Sigue sin haber una sola línea de código específica de un artista.
--
-- `custom.category` se excluye de `details` para no entregarlo dos veces; el
-- resto de metafields (tamaño, año, técnica, envío…) sigue viajando en la
-- lista, que es la forma que pidió el consumidor: etiqueta + valor.

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
      -- artists.name la fija el operador y es la persona; shop_name es la marca
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
        'status',             p.status,
        'updated_at',         p.updated_at,
        -- Atributos canónicos, al nivel del producto
        'artist',             t.artist_name,
        'artist_email',       t.contact_email,
        'category', (
          select mf->>'value'
          from jsonb_array_elements(coalesce(p.metafields, '[]'::jsonb)) as e(mf)
          where mf->>'namespace' = 'custom' and mf->>'key' = 'category'
          limit 1
        ),
        -- Campos estándar, crudos: interpretarlos es del consumidor
        'vendor',             p.vendor,
        'product_type',       p.product_type,
        'tags',               to_jsonb(coalesce(p.tags, '{}'::text[])),
        'shopify_taxonomy',   p.taxonomy_category,   -- antes 'category'
        'collections',        coalesce(p.collections, '[]'::jsonb),
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
            -- ya viaja arriba como `category`
            and not (mf->>'namespace' = 'custom' and mf->>'key' = 'category')
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
