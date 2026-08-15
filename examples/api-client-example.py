#!/usr/bin/env python3
"""
Ejemplo de cliente para el API de catálogo de StoreSync (solo lectura).

Requiere:  pip install requests

Uso:
  export STORESYNC_API_KEY=sk_storesync_xxxxx
  export STORESYNC_SHOP_ID=<uuid de la tienda>
  python3 api-client-example.py
"""

import os
import sys
import time
from typing import Iterator, Optional

import requests

BASE_URL = os.environ.get(
    "STORESYNC_BASE_URL",
    "https://<proyecto>.supabase.co/functions/v1/api-gateway/catalog",
)
SHOP_ID = os.environ.get("STORESYNC_SHOP_ID", "00000000-0000-0000-0000-000000000000")
PAGE_SIZE = 50


class ApiGatewayError(Exception):
    pass


def fetch_page(api_key: str, cursor: Optional[str] = None) -> dict:
    """Trae una página del catálogo. Si el gateway responde 429 (rate limit),
    espera retry_after_seconds y reintenta."""
    params = {"shop_id": SHOP_ID, "limit": PAGE_SIZE}
    if cursor:
        params["cursor"] = cursor

    resp = requests.get(
        BASE_URL,
        params=params,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=30,
    )

    if resp.status_code == 200:
        return resp.json()
    if resp.status_code == 401:
        raise ApiGatewayError("API key ausente o inválida (401)")
    if resp.status_code == 403:
        raise ApiGatewayError(f"shop_id {SHOP_ID} no autorizado para esta key (403)")
    if resp.status_code == 429:
        wait = resp.json().get("retry_after_seconds", 60)
        print(f"  rate limited, esperando {wait}s...", file=sys.stderr)
        time.sleep(wait)
        return fetch_page(api_key, cursor)
    raise ApiGatewayError(f"HTTP {resp.status_code}: {resp.text}")


def fetch_full_catalog(api_key: str) -> Iterator[dict]:
    """Generador: recorre TODAS las páginas y va entregando productos uno a uno."""
    cursor = None
    while True:
        page = fetch_page(api_key, cursor)
        yield from page["products"]
        if not page["pagination"]["has_more"]:
            break
        cursor = page["pagination"]["next_cursor"]


def main() -> None:
    api_key = os.environ.get("STORESYNC_API_KEY")
    if not api_key:
        print("Falta la variable de entorno STORESYNC_API_KEY", file=sys.stderr)
        sys.exit(2)

    total = 0
    for product in fetch_full_catalog(api_key):
        total += 1
        variantes = len(product["variants"])
        stock = sum(
            inv["available"] for v in product["variants"] for inv in v["inventory"]
        )
        print(f"  {product['title']!r:40} {variantes} variante(s), stock total {stock}")

    print(f"\n✔ {total} productos leídos")


if __name__ == "__main__":
    main()
