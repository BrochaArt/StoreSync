-- 013 — html_a_texto: espacios Unicode y recorte de bordes.
--
-- Dos defectos vistos al correr la 012 contra el catálogo real:
--
-- 1. Quedaban espacios al final de línea. No eran espacios normales sino
--    U+00A0 (no-break space) LITERALES, no la entidad `&nbsp;`: así los deja
--    el editor de Shopify cuando se pega desde Notion o Word. `[ \t]` no los
--    captura, así que sobrevivían al colapso de espacios.
--
-- 2. Sobraba una línea en blanco al principio y al final. `btrim(t)` sin
--    segundo argumento recorta SOLO espacios, no saltos de línea.
--
-- La 012 no se edita (ya corrió en producción): se reemplaza la función.

create or replace function html_a_texto(p_html text)
returns text
language sql
immutable
parallel safe
as $$
  with x00 as (select coalesce(p_html, '') as t),
       x01 as (select regexp_replace(t, '<style[^>]*>.*?</style>',   ' ', 'gi') as t from x00),
       x02 as (select regexp_replace(t, '<script[^>]*>.*?</script>', ' ', 'gi') as t from x01),
       x03 as (select regexp_replace(t, '<!--.*?-->',                ' ', 'g')  as t from x02),
       x04 as (select regexp_replace(t, '<br[^>]*>', E'\n', 'gi') as t from x03),
       x05 as (select regexp_replace(t, '</(p|div|li|tr|h[1-6]|blockquote)>', E'\n', 'gi') as t from x04),
       x06 as (select regexp_replace(t, '<[^>]*>', '', 'g') as t from x05),
       -- entidades: &amp; al final para no doble-decodificar
       x07 as (select replace(replace(t, '&nbsp;', ' '), '&#160;', ' ') as t from x06),
       x08 as (select replace(replace(replace(t, '&#39;', ''''), '&rsquo;', ''''), '&apos;', '''') as t from x07),
       x09 as (select replace(replace(replace(t, '&quot;', '"'), '&ldquo;', '"'), '&rdquo;', '"') as t from x08),
       x10 as (select replace(replace(replace(t, '&mdash;', '—'), '&ndash;', '–'), '&hellip;', '…') as t from x09),
       x11 as (select replace(replace(t, '&lt;', '<'), '&gt;', '>') as t from x10),
       x12 as (select replace(t, '&amp;', '&') as t from x11),
       -- espacios Unicode LITERALES (no entidades) que deja el pegado desde
       -- Notion/Word/Sheets: no-break, thin, figure, narrow -> espacio normal
       x13 as (select translate(t, U&'\00A0\2007\2009\200A\202F', '     ') as t from x12),
       -- ancho cero e invisibles: fuera, no aportan nada
       x14 as (select replace(replace(replace(t, U&'\200B', ''), U&'\200C', ''), U&'\FEFF', '') as t from x13),
       x15 as (select regexp_replace(t, '[ \t]+', ' ', 'g') as t from x14),
       x16 as (select regexp_replace(t, '[ \t]*\n[ \t]*', E'\n', 'g') as t from x15),
       x17 as (select regexp_replace(t, '\n{3,}', E'\n\n', 'g') as t from x16)
  select nullif(btrim(t, E' \t\n\r'), '') from x17;
$$;

comment on function html_a_texto(text) is
  'HTML de Shopify -> texto plano. Determinista, sin interpretar contenido.';
