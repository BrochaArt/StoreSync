// API gateway (Decisión 6): único acceso de un consumidor EXTERNO a los datos.
// Read-only. Autentica por API key propia (no JWT de Supabase), aplica scoping
// por tienda y rate limit, y devuelve el catálogo ya shaped por api_get_catalog.
//
// Contrato de seguridad (§11):
//   - El service_role vive SOLO dentro de esta función; jamás sale al cliente.
//   - El API key nunca se guarda plano: se compara su sha256 contra key_hash.
//   - Un consumidor solo ve las tiendas en su allowed_shop_ids (scoping explícito).
//   - Errores uniformes: el endpoint no revela qué tiendas/keys existen.
//
// Uso:
//   GET /api-gateway/catalog?shop_id=<uuid>&limit=50&cursor=<product_id>
//   Header:  Authorization: Bearer <api_key>   (o  X-Api-Key: <api_key>)

import { createClient } from "npm:@supabase/supabase-js@2";

// service_role: SOLO existe dentro de esta función server-side (§11)
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

// sha256 hex del API key — el mismo cómputo que el script emisor (create-api-consumer).
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Consumer {
  id: string;
  allowed_shop_ids: string[];
  rate_limit_per_min: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  // 1. Extraer el API key (Bearer o X-Api-Key)
  const auth = req.headers.get("Authorization") ?? "";
  const apiKey = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : (req.headers.get("X-Api-Key") ?? "").trim();
  if (!apiKey) return json({ error: "unauthorized" }, 401);

  // 2. Consumidor por hash del key (nunca se guarda el key plano)
  const keyHash = await sha256Hex(apiKey);
  const { data: consumer } = await supabase
    .from("api_consumers")
    .select("id, allowed_shop_ids, rate_limit_per_min")
    .eq("key_hash", keyHash)
    .eq("active", true)
    .maybeSingle<Consumer>();
  if (!consumer) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const path = url.pathname;

  // Log al final con el status real; helper para no repetir el insert.
  const log = (status: number, shopId: string | null) =>
    supabase.from("api_request_log").insert({
      consumer_id: consumer.id,
      path,
      shop_id: shopId,
      status,
    });

  // 3. Rate limit: requests de este consumidor en los últimos 60s
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabase
    .from("api_request_log")
    .select("id", { count: "exact", head: true })
    .eq("consumer_id", consumer.id)
    .gte("created_at", since);
  if ((count ?? 0) >= consumer.rate_limit_per_min) {
    await log(429, null);
    return json({ error: "rate_limited", retry_after_seconds: 60 }, 429);
  }

  // 4. Ruta: por ahora solo /catalog
  if (!path.endsWith("/catalog")) {
    await log(404, null);
    return json({ error: "not_found" }, 404);
  }

  // 5. shop_id requerido y DENTRO del scope del consumidor
  const shopId = url.searchParams.get("shop_id");
  if (!shopId || !consumer.allowed_shop_ids.includes(shopId)) {
    // 403 uniforme para "no existe" y "no autorizada": no es un oráculo de tiendas
    await log(403, shopId);
    return json({ error: "forbidden" }, 403);
  }

  const limit = Number(url.searchParams.get("limit") ?? "50");
  const cursor = url.searchParams.get("cursor"); // último product_id de la página previa

  // 6. Datos ya shaped por el RPC (SECURITY DEFINER, solo lectura)
  const { data, error } = await supabase.rpc("api_get_catalog", {
    p_shop_id: shopId,
    p_limit: Number.isFinite(limit) ? limit : 50,
    p_after: cursor,
  });
  if (error) {
    console.error(`api_get_catalog shop=${shopId}: ${error.message}`);
    await log(500, shopId);
    return json({ error: "internal_error" }, 500);
  }

  await log(200, shopId);
  return json(data, 200);
});
