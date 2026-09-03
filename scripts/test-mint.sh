#!/usr/bin/env bash
# Prueba AISLADA del Client Credentials grant contra una tienda real.
# NO imprime el secret ni el token. Solo dice si Shopify entrega un token.
#
# Uso (las credenciales vienen del entorno, nunca de argumentos ni del chat):
#   export SHOP_DOMAIN=artista.myshopify.com
#   export SHOPIFY_CLIENT_ID=...
#   export SHOPIFY_CLIENT_SECRET=...
#   bash scripts/test-mint.sh
set -euo pipefail

: "${SHOP_DOMAIN:?falta SHOP_DOMAIN}"
: "${SHOPIFY_CLIENT_ID:?falta SHOPIFY_CLIENT_ID}"
: "${SHOPIFY_CLIENT_SECRET:?falta SHOPIFY_CLIENT_SECRET}"

echo "→ POST https://$SHOP_DOMAIN/admin/oauth/access_token (grant_type=client_credentials)"

http_code=$(curl -s -o /tmp/mint_resp.json -w '%{http_code}' \
  -X POST "https://$SHOP_DOMAIN/admin/oauth/access_token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=$SHOPIFY_CLIENT_ID" \
  --data-urlencode "client_secret=$SHOPIFY_CLIENT_SECRET")

echo "  HTTP $http_code"

if [ "$http_code" = "200" ]; then
  if grep -q '"access_token"' /tmp/mint_resp.json; then
    echo "✔ Shopify entregó un access_token. El Client Credentials grant FUNCIONA."
    echo "  expires_in: $(grep -o '"expires_in":[0-9]*' /tmp/mint_resp.json | cut -d: -f2)"
  else
    echo "✖ HTTP 200 pero sin access_token en la respuesta. Cuerpo:"
    cat /tmp/mint_resp.json
  fi
else
  echo "✖ Shopify rechazó el grant. Cuerpo de la respuesta:"
  cat /tmp/mint_resp.json
fi

rm -f /tmp/mint_resp.json
