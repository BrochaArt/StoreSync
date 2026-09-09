-- 026 — Las imágenes se entregan en tamaños, no solo el original.
--
-- leadgods reportó que las miniaturas y las imágenes principales no se ven como
-- en la tienda del artista. No era un problema de ellos: les entregábamos SOLO
-- la URL del original.
--
-- Medido sobre la ficha del grabado "El RETRO FLYING GOLDFISH":
--
--   lo que carga la tienda del artista   miniatura width=246 · principal width=1445
--   lo que entregábamos nosotros         el original, 1.057 KB
--   la misma imagen a width=400          24 KB
--
-- 44 veces más pesada por miniatura, y hay 1.739 imágenes en el catálogo. La
-- tienda nunca sirve el original: usa `&width=N` sobre la misma URL, con un
-- srcset de 8 a 12 anchos. Nosotros teníamos el dato y no lo usábamos.
--
-- No se guarda nada nuevo: el CDN de Shopify redimensiona sobre la misma URL,
-- así que `sizes` y `srcset` se derivan con `imagen_ancho`, definida acá mismo,
-- en el armado del payload.
--
-- `url` se deja como está —el original— para no romper a quien ya lo lee.

-- ── El redimensionado, en un solo lugar ──────────────────────────────────────

create or replace function imagen_ancho(p_url text, p_width int)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_url is null or p_url = '' then null
    -- Ya trae un width: se reemplaza en vez de encadenar otro.
    when p_url ~ '[?&]width=' then regexp_replace(p_url, '([?&])width=[0-9]+', '\1width=' || p_width)
    when position('?' in p_url) > 0 then p_url || '&width=' || p_width
    else p_url || '?width=' || p_width
  end;
$$;

comment on function imagen_ancho(text, int) is
  'URL del CDN de Shopify redimensionada. El CDN sirve el ancho pedido sobre la misma URL: no se guarda nada nuevo.';

-- ── El catálogo, con los tamaños derivados ───────────────────────────────────

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
        'description_html',   html_sanitizado(p.description_html),
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
            'position',         pi.position,
            -- Tamaños listos para usar. `url` sigue siendo el original, por
            -- compatibilidad con quien ya lo lee.
            'sizes', jsonb_build_object(
              'thumb',    imagen_ancho(pi.url, 400),
              'medium',   imagen_ancho(pi.url, 800),
              'large',    imagen_ancho(pi.url, 1600),
              'original', pi.url
            ),
            -- Para <img srcset>: mismo juego de anchos que sirve la tienda.
            'srcset', (
              select jsonb_agg(
                       jsonb_build_object('width', w, 'url', imagen_ancho(pi.url, w))
                       order by w)
              from unnest(array[246, 400, 600, 800, 1200, 1600, 2048]) as w
            )
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
