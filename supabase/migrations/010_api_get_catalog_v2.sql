-- 010 — api_get_catalog v2: agrega los campos estándar de la 009 al contrato.
--
-- Migraciones append-only: la 008 no se toca, se reemplaza la función con
-- create or replace (misma firma, mismos permisos).
--
-- Cambios respecto de la 008 — todos ADITIVOS, ningún campo previo cambia de
-- nombre ni de forma, así que el consumidor actual no se rompe:
--   shop.name, shop.artist{name,email,website,bio}
--   product.vendor, product_type, tags, category, collections, details
--   variant.title, variant.options
--
-- 'details' se arma desde los metafields del producto usando como etiqueta el
-- nombre que el artista le puso a la definición en SU Shopify (shops.
-- metafield_definitions). Así el detalle sale con nombre legible sin que
-- nosotros hardcodeemos ni una sola clave. Si el artista no definió metafields,
-- details viene vacío: no se infiere nada desde la descripción.
--
-- Se excluye el namespace 'global' (title_tag / description_tag): son los
-- campos de SEO que Shopify pone en TODA tienda, no detalles del producto.

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
      s.artist_id,
      coalesce(s.metafield_definitions, '{}'::jsonb) as defs
    from shops s
    where s.id = p_shop_id
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
        -- Campos estándar, crudos: interpretarlos es del consumidor
        'vendor',             p.vendor,
        'product_type',       p.product_type,
        'tags',               to_jsonb(coalesce(p.tags, '{}'::text[])),
        'category',           p.taxonomy_category,   -- null si la tienda no la asignó
        'collections',        coalesce(p.collections, '[]'::jsonb),
        'details', coalesce((
          select jsonb_agg(jsonb_build_object(
            'key',   (mf->>'namespace') || '.' || (mf->>'key'),
            'label', coalesce(
                       t.defs ->> ((mf->>'namespace') || '.' || (mf->>'key')),
                       mf->>'key'          -- sin definición: la clave cruda
                     ),
            'type',  mf->>'type',
            'value', mf->>'value'
          ) order by ord)
          from jsonb_array_elements(coalesce(p.metafields, '[]'::jsonb))
               with ordinality as e(mf, ord)
          -- Namespaces que Shopify se reserva en TODA tienda: 'global' es el
          -- SEO (title_tag/description_tag) y 'shopify'/'shopify--*' son los de
          -- sus apps internas (discovery, recomendaciones). No son detalles del
          -- producto: los pone la plataforma, no el artista.
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
            -- Donde el tamaño es opción de variante, vive aquí y solo aquí
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
        -- artists.name la fija el operador y es la persona; shop_name es la marca
        'name',    coalesce(a.name, t.shop_name),
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
  from tienda t
  left join artists a on a.id = t.artist_id;
$$;

revoke all on function api_get_catalog(uuid, int, uuid) from public, anon, authenticated;
grant execute on function api_get_catalog(uuid, int, uuid) to service_role;
