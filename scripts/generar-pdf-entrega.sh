#!/usr/bin/env bash
# Exporta el documento de entrega del API a PDF, para mandárselo a la empresa
# que consume el gateway.
#
# Fuente y salida están gitignored a propósito: llevan la API key del consumidor
# en claro y el repositorio es público. El estilo (docs/estilo-pdf.css) sí vive
# en el repo.
#
# Uso:
#   npm run doc-pdf
#   MD=otro.md PDF=salida.pdf npm run doc-pdf
#   TITULO="..." SUBTITULO="..." MD=otro.md PDF=salida.pdf npm run doc-pdf
#
# TITULO/SUBTITULO existen porque el script se reusa para documentos que no son
# la entrega de integración (avisos de cambios al consumidor, por ejemplo) y el
# encabezado fijo quedaba fuera de lugar.
set -euo pipefail

MD="${MD:-docs/api-gateway-handoff.md}"
PDF="${PDF:-docs/StoreSync - Documentacion de integracion API.pdf}"
CSS="docs/estilo-pdf.css"
TITULO="${TITULO:-Acceso al API de catálogo — StoreSync}"
SUBTITULO="${SUBTITULO:-Documentación de integración}"

[ -f "$MD" ] || { echo "✖ No existe $MD (está gitignored: no viene en un clon nuevo)."; exit 1; }
[ -f "$CSS" ] || { echo "✖ Falta $CSS"; exit 1; }
command -v pandoc >/dev/null || { echo "✖ Falta pandoc. macOS: brew install pandoc"; exit 1; }

# Chrome hace el HTML -> PDF. Se puede forzar con CHROME=/ruta/al/binario.
if [ -z "${CHROME:-}" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
           "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
           "$(command -v google-chrome || true)" \
           "$(command -v chromium || true)"; do
    [ -n "$c" ] && [ -x "$c" ] && CHROME="$c" && break
  done
fi
[ -n "${CHROME:-}" ] || { echo "✖ No encontré Chrome/Chromium. Pásalo con CHROME=/ruta"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pandoc "$MD" --standalone --from=gfm --to=html5 \
  --metadata title="$TITULO" \
  --include-in-header=<(printf '<style>\n%s\n</style>' "$(cat "$CSS")") \
  -o "$TMP/doc.html"

# Pandoc repite el título en su propio <header>; se quita y se pone la fecha.
SUBTITULO="$SUBTITULO" python3 - "$TMP/doc.html" <<'PY'
import re, sys, os, datetime
p = sys.argv[1]
h = open(p, encoding="utf-8").read()
h = re.sub(r"<header[^>]*>.*?</header>", "", h, flags=re.S)
h = h.replace(
    "</h1>",
    '</h1>\n<p class="subtitulo">%s · Generado el %s</p>'
    % (os.environ.get("SUBTITULO", "Documentación de integración"),
       datetime.date.today().strftime("%d/%m/%Y")),
    1,
)
open(p, "w", encoding="utf-8").write(h)
PY

# El aviso "Trying to load the allocator multiple times" de Chrome es inocuo.
"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
  --virtual-time-budget=6000 \
  --print-to-pdf="$TMP/salida.pdf" "file://$TMP/doc.html" 2>/dev/null || true

[ -s "$TMP/salida.pdf" ] || { echo "✖ Chrome no generó el PDF"; exit 1; }
mv "$TMP/salida.pdf" "$PDF"

paginas="$(command -v pdfinfo >/dev/null && pdfinfo "$PDF" | awk '/^Pages:/{print $2}' || echo '?')"
echo "✔ $PDF  ($paginas páginas)"
# El documento de entrega por defecto lleva la API key del consumidor en claro.
# Con MD= apuntando a otra fuente eso no tiene por qué ser cierto, así que el
# aviso solo sale cuando corresponde.
if [ "$MD" = "docs/api-gateway-handoff.md" ]; then
  echo "  Contiene la API key en claro: mándalo por un canal que controles."
fi
