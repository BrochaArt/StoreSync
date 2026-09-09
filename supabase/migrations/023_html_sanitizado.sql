-- 023 — `html_sanitizado`: el HTML del artista deja de viajar crudo.
--
-- Medido sobre los 388 productos vivos antes del cambio:
--
--    89 traen un bloque <style> completo
--   148 traen atributos data-sheets-* (pegado desde Google Sheets)
--   155 traen atributos data-mce-*   (editor de Shopify)
--   117 traen style= inline (Arial 11pt, colores fijos)
--     3 traen <iframe> de YouTube, puestos a propósito por el artista
--     0 traen <script>, on*= o javascript: — HOY
--
-- El <style> es el daño concreto: no está scopeado, así que un consumidor que
-- pinte esa descripción le aplica el CSS del artista a TODA su página. Que hoy
-- no haya <script> no es defensa — el artista escribe en su propio admin y
-- puede pegar cualquier cosa mañana. Sanitizar es lo que hace que deje de
-- importarnos qué pegue.
--
-- LISTA BLANCA, no negra — misma decisión y mismo motivo que la 017: con lista
-- negra, cada editor o app nueva que use un artista abre otro agujero que hay
-- que salir a perseguir.
--
-- ── El bug que casi se va a producción ───────────────────────────────────────
--
-- La primera versión filtraba atributos con un regex que NO estaba anclado a
-- una etiqueta: `\s+[a-zA-Z_:][-\w:.]*(?=[\s>])` para barrer atributos sin
-- valor (<td nowrap>). Sobre texto plano eso también matchea. El caso que lo
-- destapó:
--
--   entrada:   <p>texto <strong>fuerte</strong> y <em>enfasis</em></p>
--   resultado: <p>texto <strong>fuerte</strong> <em>enfasis</em></p>
--                                               ↑ se comió la "y"
--
-- Se comía cualquier palabra suelta seguida de espacio. La lección: filtrar
-- atributos SOLO sobre etiquetas completas (`<`…`>`). Por eso acá los atributos
-- se barren con un match de etiqueta entera —`<(/?tag)[^>]*>` → `<\1>`— y lo
-- que hay que conservar (href, src de video) se reconstruye desde cero por
-- centinela. Lo que no se reconstruye explícitamente, no sobrevive.
--
-- Verificación sobre el catálogo real: `html_a_texto(html)` vs
-- `html_a_texto(html_sanitizado(html))` da idéntico en los 388 productos — no
-- se pierde una palabra. El HTML entregado baja de 758 KB a 334 KB.

create or replace function html_sanitizado(p_html text)
returns text
language sql
immutable
parallel safe
as $$
  with
  x00 as (select coalesce(p_html, '') as t),
  -- Los centinelas usan U+0001..U+0006. Se limpian primero para que el
  -- contenido del artista no pueda falsificar uno.
  x01 as (select translate(t, U&'\0001\0002\0003\0004\0005\0006', '') as t from x00),

  -- ── Contenedores que se van CON su contenido ────────────────────────────────
  x02 as (select regexp_replace(t, '<style[^>]*>.*?</style>',   ' ', 'gi') as t from x01),
  x03 as (select regexp_replace(t, '<script[^>]*>.*?</script>', ' ', 'gi') as t from x02),
  x04 as (select regexp_replace(t, '<!--.*?-->',                ' ', 'g')  as t from x03),
  x05 as (select regexp_replace(t, '<(object|embed|form|svg|noscript|template)[^>]*>.*?</\1>', ' ', 'gi') as t from x04),

  -- ── Lo que se conserva se captura ANTES de barrer atributos ─────────────────
  -- Video: solo YouTube y Vimeo. El artista los puso a propósito (su colección
  -- Movie Props); un iframe de cualquier otro origen no tiene por qué entrar en
  -- la página del consumidor.
  x06 as (select regexp_replace(t,
            '<iframe[^>]*\ssrc\s*=\s*"(https://(?:www\.)?youtube(?:-nocookie)?\.com/embed/[^"]*)"[^>]*>',
            U&'\0001' || '\1' || U&'\0002', 'gi') as t from x05),
  x07 as (select regexp_replace(t,
            '<iframe[^>]*\ssrc\s*=\s*"(https://player\.vimeo\.com/video/[^"]*)"[^>]*>',
            U&'\0001' || '\1' || U&'\0002', 'gi') as t from x06),
  x08 as (select regexp_replace(t, '<iframe[^>]*>.*?</iframe>', ' ', 'gi') as t from x07),
  x09 as (select regexp_replace(t, '</?iframe[^>]*>', ' ', 'gi') as t from x08),
  -- Enlaces: 87 descripciones los usan. Solo http(s) y mailto.
  x10 as (select regexp_replace(t,
            '<a[^>]*\shref\s*=\s*"((?:https?://|mailto:)[^"]*)"[^>]*>',
            U&'\0003' || '\1' || U&'\0004', 'gi') as t from x09),
  -- Imágenes: hoy ninguna descripción trae, pero el día que aparezca una no
  -- puede ser la excepción sin regla.
  x11 as (select regexp_replace(t,
            '<img[^>]*\ssrc\s*=\s*"(https://[^"]*)"[^>]*>',
            U&'\0005' || '\1' || U&'\0006', 'gi') as t from x10),

  -- ── Etiquetas fuera de la lista blanca: se quita la etiqueta, se conserva el
  --    texto que envuelve. `\y` es el borde de palabra de Postgres (`\b` acá es
  --    backspace, no borde).
  x12 as (select regexp_replace(t,
            '</?(?!(?:p|br|strong|b|em|i|u|s|ul|ol|li|h[1-6]|blockquote|a|img|span|div|table|thead|tbody|tr|td|th|hr|sub|sup)\y)[a-zA-Z][a-zA-Z0-9]*[^>]*>',
            '', 'gi') as t from x11),

  -- ── Atributos: se barren TODOS, sobre etiquetas completas. Ver el bug del
  --    encabezado: sin anclar a `<`…`>` esto se come el texto.
  x13 as (select regexp_replace(t, '<(/?[a-zA-Z][a-zA-Z0-9]*)[^>]*>', '<\1>', 'g') as t from x12),

  -- ── De vuelta, en forma canónica ────────────────────────────────────────────
  x14 as (select regexp_replace(t,
            U&'\0003' || '([^' || U&'\0004' || ']*)' || U&'\0004',
            '<a href="\1" rel="nofollow noopener" target="_blank">', 'g') as t from x13),
  x15 as (select regexp_replace(t,
            U&'\0005' || '([^' || U&'\0006' || ']*)' || U&'\0006',
            '<img src="\1" loading="lazy">', 'g') as t from x14),
  x16 as (select regexp_replace(t,
            U&'\0001' || '([^' || U&'\0002' || ']*)' || U&'\0002',
            '<iframe src="\1" width="560" height="315" loading="lazy"></iframe>', 'g') as t from x15),

  -- ── Prolijidad ──────────────────────────────────────────────────────────────
  x17 as (select regexp_replace(t, '[ \t]+', ' ', 'g') as t from x16),
  x18 as (select regexp_replace(t, '(<p>\s*</p>\s*)+', '', 'gi') as t from x17)
  select nullif(btrim(t, E' \t\n\r'), '') from x18;
$$;

comment on function html_sanitizado(text) is
  'HTML de Shopify -> HTML seguro por lista blanca. Los atributos se filtran sobre etiquetas completas: enlaces, imágenes y video permitido se reconstruyen desde cero.';
