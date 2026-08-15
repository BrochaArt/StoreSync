-- 012 — description_text: la descripción en texto plano, sin la basura del HTML.
--
-- Por qué hace falta: el HTML que llega de Shopify viene de pegar en el editor
-- desde Notion, Google Sheets o Word. Medido sobre un catálogo real de 205
-- productos: 144 traían comentarios `<!-- notionvc: uuid -->`, 65 tenían
-- `<meta charset>` repetidos en medio del texto, 20 un bloque `<style>` y 18
-- atributos `data-sheets-*`. `description_html` se conserva intacto; esto es
-- un campo ADICIONAL para quien solo quiere el texto.
--
-- Por qué al LEER y no al escribir: la descripción entra por dos caminos —el
-- import (GraphQL, descriptionHtml) y el worker (REST, body_html)—. Calcularlo
-- al escribir obligaría a mantener el mismo limpiador en TypeScript y en Deno,
-- que es exactamente el tipo de duplicación que se desincroniza. Como función
-- de lectura hay una sola implementación y sirve para lo ya importado sin
-- reimportar nada.
--
-- Esto NO contradice la Decisión 7: limpiar HTML es normalización de formato,
-- determinista e igual para cualquier tienda. No interpreta convenciones de
-- nadie ni deduce atributos — para eso están los metafields.

create or replace function html_a_texto(p_html text)
returns text
language sql
immutable
parallel safe
as $$
  with x00 as (select coalesce(p_html, '') as t),
       -- bloques completos que no son contenido
       x01 as (select regexp_replace(t, '<style[^>]*>.*?</style>',   ' ', 'gi') as t from x00),
       x02 as (select regexp_replace(t, '<script[^>]*>.*?</script>', ' ', 'gi') as t from x01),
       x03 as (select regexp_replace(t, '<!--.*?-->',                ' ', 'g')  as t from x02),
       -- saltos de línea antes de borrar las etiquetas, para no pegar párrafos
       x04 as (select regexp_replace(t, '<br[^>]*>', E'\n', 'gi') as t from x03),
       x05 as (select regexp_replace(t, '</(p|div|li|tr|h[1-6]|blockquote)>', E'\n', 'gi') as t from x04),
       -- el resto de etiquetas (incluye <meta>, <span data-sheets-*>, etc.)
       x06 as (select regexp_replace(t, '<[^>]*>', '', 'g') as t from x05),
       -- entidades: &amp; se decodifica AL FINAL para no doble-decodificar
       x07 as (select replace(replace(t, '&nbsp;', ' '), '&#160;', ' ') as t from x06),
       x08 as (select replace(replace(replace(t, '&#39;', ''''), '&rsquo;', ''''), '&apos;', '''') as t from x07),
       x09 as (select replace(replace(replace(t, '&quot;', '"'), '&ldquo;', '"'), '&rdquo;', '"') as t from x08),
       x10 as (select replace(replace(replace(t, '&mdash;', '—'), '&ndash;', '–'), '&hellip;', '…') as t from x09),
       x11 as (select replace(replace(t, '&lt;', '<'), '&gt;', '>') as t from x10),
       x12 as (select replace(t, '&amp;', '&') as t from x11),
       -- espacios: colapsa horizontales, limpia los bordes de cada línea
       x13 as (select regexp_replace(t, '[ \t]+', ' ', 'g') as t from x12),
       x14 as (select regexp_replace(t, '[ \t]*\n[ \t]*', E'\n', 'g') as t from x13),
       -- 3+ saltos seguidos quedan en 2 (un renglón en blanco)
       x15 as (select regexp_replace(t, '\n{3,}', E'\n\n', 'g') as t from x14)
  select nullif(btrim(t), '') from x15;
$$;

comment on function html_a_texto(text) is
  'HTML de Shopify -> texto plano. Determinista, sin interpretar contenido.';

-- ── api_get_catalog: agrega description_text ─────────────────────────────────
-- Cambio ADITIVO: description_html se mantiene igual y en su sitio.

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
        'artist',             t.artist_name,
        'artist_email',       t.contact_email,
        'category', (
          select mf->>'value'
          from jsonb_array_elements(coalesce(p.metafields, '[]'::jsonb)) as e(mf)
          where mf->>'namespace' = 'custom' and mf->>'key' = 'category'
          limit 1
        ),
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
            'value', mf->>'value'
          ) order by ord)
          from jsonb_array_elements(coalesce(p.metafields, '[]'::jsonb))
               with ordinality as e(mf, ord)
          where coalesce(mf->>'namespace', '') not in ('global', 'shopify')
            and coalesce(mf->>'namespace', '') not like 'shopify--%'
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
