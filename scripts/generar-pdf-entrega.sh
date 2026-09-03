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
set -euo pipefail

MD="${MD:-docs/api-gateway-handoff.md}"
PDF="${PDF:-docs/StoreSync - Documentacion de integracion API.pdf}"
CSS="docs/estilo-pdf.css"

[ -f "$MD" ] || { echo "✖ No existe $MD (está gitignored: no viene en un clon nuevo)."; exit 1; }
[ -f "$CSS" ] || { echo "✖ Falta $CSS"; exit 1; }
command -v pandoc >/dev/null || { echo "✖ Falta pandoc. macOS: brew install pandoc"; exit 1; }

# Chrome hace el HTML -> PDF. Se puede forzar con CHROME=/ruta/al/binario.
if [ -z "${CHROME:-}" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           "$(command -v google-chrome || true)" \
           "$(command -v chromium || true)"; do
    [ -n "$c" ] && [ -x "$c" ] && CHROME="$c" && break
  done
fi
[ -n "${CHROME:-}" ] || { echo "✖ No encontré Chrome/Chromium. Pásalo con CHROME=/ruta"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pandoc "$MD" --standalone --from=gfm --to=html5 \
  --metadata title="Acceso al API de catálogo — StoreSync" \
  --include-in-header=<(printf '<style>\n%s\n</style>' "$(cat "$CSS")") \
  -o "$TMP/doc.html"

# Pandoc repite el título en su propio <header>; se quita y se pone la fecha.
python3 - "$TMP/doc.html" <<'PY'
import re, sys, datetime
p = sys.argv[1]
h = open(p, encoding="utf-8").read()
h = re.sub(r"<header[^>]*>.*?</header>", "", h, flags=re.S)
h = h.replace(
    "</h1>",
    '</h1>\n<p class="subtitulo">Documentación de integración · Generado el %s</p>'
    % datetime.date.today().strftime("%d/%m/%Y"),
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
echo "  Contiene la API key en claro: mándalo por un canal que controles."
