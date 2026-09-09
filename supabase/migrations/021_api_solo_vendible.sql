-- 021 — El API entrega solo lo que se puede comprar.
--
-- Hasta acá `api_get_catalog` filtraba una sola cosa: `deleted_at is null`. Todo
-- lo demás salía. Medido en producción antes del cambio, sobre 388 productos:
--
--   status=active    270  (137 de ellos sin stock vendible)
--   status=archived   74  ← se entregaban al consumidor
--   status=draft      44  ← se entregaban al consumidor
--
-- O sea que el consumidor recibía obras archivadas por el artista, borradores
-- que nunca se publicaron, y piezas ya vendidas. Quedan ~133 productos: es un
-- recorte del 65%, y es el número correcto — lo anterior no era catálogo, era
-- todo lo que había en la base.
--
-- Tres filtros nuevos:
--
-- 1. `p.status = 'active'`. Deja fuera archived y draft de una vez. Es el
--    estado que el artista maneja desde su admin de Shopify, así que archivar
--    una obra ahora la retira del API sin que nadie toque nada acá.
--
-- 2. Variante vendible = suma de `available` > 0 en sus inventory_levels.
--    Va en `> 0` y no en `<> 0` a propósito: 35 productos activos tienen
--    inventario NEGATIVO (hasta -8), sobreventas de Shopify. Con `<> 0` esos 35
--    seguirían saliendo como disponibles, que es exactamente el error que este
--    cambio viene a cerrar.
--
--    Una variante sin ninguna fila de inventario cuenta como NO vendible
--    (coalesce a 0). Es la dirección segura: no se anuncia lo que no se pudo
--    confirmar. Hoy no hay ninguna en ese estado, y el panel ya vigila el caso
--    con `variantes_sin_inventario` (migración 019).
--
-- 3. `s.status = 'active'` en la tienda. No estaba y era un agujero: desactivar
--    una tienda no le cortaba el catálogo al consumidor. Hoy las dos tiendas
--    están activas, así que no cambia nada — cierra el caso a futuro.
--
-- Lo que NO se filtra, a propósito: las filas de `inventory` por ubicación
-- dentro de una variante vendible se entregan completas, incluidas las que
-- están en 0. El consumidor necesita saber que una ubicación no tiene stock;
-- ocultarlas le rompería la contabilidad por location (migración 015).
--
-- La forma del JSON no cambia. `status` sigue en el payload aunque ahora sea
-- siempre 'active': sacarlo rompería a quien ya lo lee.

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
      and s.status = 'active'
  ),
  -- Variantes con stock vendible de esta tienda. Se calcula una vez y se usa
  -- en los dos lugares que la necesitan: para decidir qué productos entran a
  -- la página y para podar las variantes agotadas de los que sí entran.
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
          -- que define el comerciante (migración 017).
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
          from variants v
          where v.product_id = p.id
            -- Un producto puede entrar a la página por UNA variante vendible;
            -- las agotadas del mismo producto no viajan.
            and exists (select 1 from vendibles vd where vd.variant_id = v.id)
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
