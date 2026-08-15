#!/usr/bin/env node
/**
 * Ejemplo de cliente para el API de catálogo de StoreSync (solo lectura).
 * Sin dependencias — usa fetch nativo (Node 18+).
 *
 * Uso:
 *   export STORESYNC_API_KEY=sk_storesync_xxxxx
 *   export STORESYNC_SHOP_ID=<uuid de la tienda>
 *   node api-client-example.mjs
 */

const BASE_URL =
  process.env.STORESYNC_BASE_URL ??
  "https://<proyecto>.supabase.co/functions/v1/api-gateway/catalog";
const SHOP_ID = process.env.STORESYNC_SHOP_ID ?? "00000000-0000-0000-0000-000000000000";
const PAGE_SIZE = 50;

class ApiGatewayError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Trae una página del catálogo. Si el gateway responde 429 (rate limit),
 * espera retry_after_seconds y reintenta. */
async function fetchPage(apiKey, cursor) {
  const url = new URL(BASE_URL);
  url.searchParams.set("shop_id", SHOP_ID);
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (cursor) url.searchParams.set("cursor", cursor);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });

  if (res.status === 200) return res.json();
  if (res.status === 401) throw new ApiGatewayError("API key ausente o inválida (401)");
  if (res.status === 403) throw new ApiGatewayError(`shop_id ${SHOP_ID} no autorizado para esta key (403)`);
  if (res.status === 429) {
    const { retry_after_seconds: wait = 60 } = await res.json();
    console.error(`  rate limited, esperando ${wait}s...`);
    await sleep(wait * 1000);
    return fetchPage(apiKey, cursor);
  }
  throw new ApiGatewayError(`HTTP ${res.status}: ${await res.text()}`);
}

/** Generador async: recorre TODAS las páginas y va entregando productos uno a uno. */
async function* fetchFullCatalog(apiKey) {
  let cursor;
  for (;;) {
    const page = await fetchPage(apiKey, cursor);
    yield* page.products;
    if (!page.pagination.has_more) break;
    cursor = page.pagination.next_cursor;
  }
}

async function main() {
  const apiKey = process.env.STORESYNC_API_KEY;
  if (!apiKey) {
    console.error("Falta la variable de entorno STORESYNC_API_KEY");
    process.exit(2);
  }

  let total = 0;
  for await (const product of fetchFullCatalog(apiKey)) {
    total++;
    const stock = product.variants.reduce(
      (sum, v) => sum + v.inventory.reduce((s, inv) => s + inv.available, 0),
      0,
    );
    console.log(`  ${product.title.padEnd(40)} ${product.variants.length} variante(s), stock total ${stock}`);
  }

  console.log(`\n✔ ${total} productos leídos`);
}

main();
