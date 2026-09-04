// Refresco de collections, metafields y taxonomía (PENDIENTES #6, migración 018).
//
// El payload REST de products/update no trae esos tres campos, así que el
// worker no puede mantenerlos al día: se quedaban con el valor del último
// import manual. Este job los relee de Shopify periódicamente.
//
// NO es un import: no crea ni borra productos (eso lo hacen products/create y
// products/delete) y no toca titulo, precio, imagenes ni inventario, que sí
// viajan en el webhook. Solo reescribe las tres columnas que derivan.
//
// Una tienda por invocación —la que lleve más tiempo sin refrescar— para que el
// trabajo por corrida quede acotado sin importar cuántos artistas haya. El
// operador puede forzar una con {"shop_id": "..."} en el body.
//
// Auth: igual que worker-sync — verify_jwt=false y token dedicado comparado en
// tiempo constante. Comparte worker_sync_token: el invocador es el mismo
// (pg_cron sobre esta base) y la frontera de confianza es idéntica.

import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { createClient } from "npm:@supabase/supabase-js@2";
import { SHOPIFY_API_VERSION } from "../../../src/config/shopify.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const WORKER_TOKEN = Deno.env.get("WORKER_SYNC_TOKEN") ?? "";
// Version de API: fuente unica en src/config/shopify.ts (Decision 1).
const API_VERSION = SHOPIFY_API_VERSION;

const PAGE_SIZE = 50;
const MAX_PAGINAS = 60; // tope de seguridad: 3000 productos por corrida
const MAX_INTENTOS = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bearerOk(header: string | null): boolean {
  if (WORKER_TOKEN.length === 0) {
    console.error("WORKER_SYNC_TOKEN no configurado: rechazando toda invocación (fail-closed)");
    return false;
  }
  const token = header?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(token);
  const b = Buffer.from(WORKER_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Último segmento de un gid. Los ids de taxonomía no son numéricos. */
const idDeGid = (gid: string) => gid.split("/").pop() ?? gid;

/** Client Credentials grant: token nuevo por corrida, nunca se cachea. */
async function mintAccessToken(shopDomain: string, clientId: string, clientSecret: string) {
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    throw new Error(`mint falló para ${shopDomain}: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

/** GraphQL con backoff ante 429/5xx y THROTTLED (mismo criterio que §10). */
async function shopifyGraphql<T>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const url = `https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`;

  for (let intento = 1; ; intento++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(`Autenticación rechazada por Shopify (${res.status}) para ${shopDomain}`);
    }
    if (res.status === 429 || res.status >= 500) {
      if (intento >= MAX_INTENTOS) throw new Error(`Shopify ${res.status} tras ${intento} intentos`);
      const retryAfter = Number(res.headers.get("Retry-After"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** intento * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`Shopify respondió ${res.status}`);

    const body = await res.json();
    if (body.errors?.length) {
      const throttled = body.errors.some((e: { extensions?: { code?: string } }) =>
        e.extensions?.code === "THROTTLED",
      );
      if (throttled && intento < MAX_INTENTOS) {
        await sleep(2 ** intento * 1000);
        continue;
      }
      throw new Error(`GraphQL: ${body.errors.map((e: { message: string }) => e.message).join("; ")}`);
    }
    return body.data as T;
  }
}

// Solo los tres campos que derivan, nada más: la query es barata y el radio de
// escritura queda acotado por construcción.
const QUERY = /* GraphQL */ `
  query MetadatosCatalogo($cursor: String, $pageSize: Int!) {
    products(first: $pageSize, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        category { id name fullName }
        collections(first: 20) { nodes { id title handle } }
        metafields(first: 25) { nodes { namespace key type value } }
      }
    }
  }
`;

interface ProductoNodo {
  id: string;
  category: { id: string; name: string; fullName: string } | null;
  collections: { nodes: Array<{ id: string; title: string; handle: string }> };
  metafields: { nodes: Array<{ namespace: string; key: string; type: string; value: string }> };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!bearerOk(req.headers.get("Authorization"))) {
    return new Response("unauthorized", { status: 401 });
  }

  // El operador puede forzar una tienda; el cron no manda nada.
  let forzado: string | undefined;
  try {
    forzado = (await req.json())?.shop_id;
  } catch {
    /* body vacío: es el caso del cron */
  }

  let shopId: string;
  let shopDomain: string;
  if (forzado) {
    const { data } = await supabase
      .from("shops")
      .select("id, shop_domain")
      .eq("id", forzado)
      .maybeSingle();
    if (!data) return Response.json({ error: "shop_no_encontrada" }, { status: 404 });
    shopId = data.id;
    shopDomain = data.shop_domain;
  } else {
    const { data } = await supabase.rpc("shop_a_refrescar");
    if (!data?.[0]) return Response.json({ refrescadas: 0, motivo: "sin tiendas activas" });
    shopId = data[0].shop_id;
    shopDomain = data[0].shop_domain;
  }

  try {
    const { data: credsRows, error: credsErr } = await supabase.rpc("get_shop_credentials", {
      p_shop_id: shopId,
    });
    const creds = credsRows?.[0];
    if (credsErr || !creds) throw new Error(`sin credenciales: ${credsErr?.message ?? "sin fila"}`);

    const accessToken = await mintAccessToken(shopDomain, creds.client_id, creds.client_secret);

    const items: Array<Record<string, unknown>> = [];
    let cursor: string | null = null;
    let paginas = 0;

    do {
      const data = await shopifyGraphql<{
        products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ProductoNodo[] };
      }>(shopDomain, accessToken, QUERY, { cursor, pageSize: PAGE_SIZE });

      for (const n of data.products.nodes) {
        items.push({
          shopify_product_id: idDeGid(n.id),
          taxonomy_category: n.category
            ? { id: idDeGid(n.category.id), name: n.category.name, full_name: n.category.fullName }
            : null,
          collections: n.collections.nodes.map((c) => ({
            id: idDeGid(c.id),
            title: c.title,
            handle: c.handle,
          })),
          metafields: n.metafields.nodes.map((m) => ({
            namespace: m.namespace,
            key: m.key,
            type: m.type,
            value: m.value,
          })),
        });
      }

      cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
      paginas++;
    } while (cursor && paginas < MAX_PAGINAS);

    const truncado = cursor !== null;

    // Un solo UPDATE por lote; la RPC ignora productos que no tenemos y estampa
    // last_refreshed_at.
    const { data: actualizados, error: rpcErr } = await supabase.rpc("refresh_catalog_metadata", {
      p_shop_id: shopId,
      p_items: items,
    });
    if (rpcErr) throw new Error(`refresh_catalog_metadata: ${rpcErr.message}`);

    await supabase.from("sync_events").insert({
      shop_id: shopId,
      direction: "inbound",
      entity: "product",
      status: "success",
      payload: {
        refresco_metadatos: true,
        productos_leidos: items.length,
        productos_actualizados: actualizados,
        paginas,
        truncado,
      },
    });

    return Response.json({
      shop: shopDomain,
      productos_leidos: items.length,
      productos_actualizados: actualizados,
      paginas,
      truncado,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`refresco falló shop=${shopId}: ${msg}`);
    await supabase.from("sync_events").insert({
      shop_id: shopId,
      direction: "inbound",
      entity: "product",
      status: "failed",
      error: msg,
      payload: { refresco_metadatos: true },
    });
    return Response.json({ error: "refresco_fallido", detalle: msg }, { status: 500 });
  }
});
