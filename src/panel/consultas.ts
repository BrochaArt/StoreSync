// Consultas del panel. Todas de solo lectura y con el cliente service_role,
// que vive únicamente en este proceso (§11).
//
// Los conteos por tienda salen de la vista panel_tiendas (migración 019): un
// solo select en vez de un bucle de consultas por tienda y por métrica.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Las diez claves del contrato (Decisión 7b), en el orden en que se muestran. */
export const CANONICOS = [
  "category",
  "size",
  "year",
  "technique",
  "material",
  "paper_type",
  "additional_info",
  "nft_link",
  "shipping",
  "about_the_artwork",
] as const;

export type ClaveCanonica = (typeof CANONICOS)[number];

export const ETIQUETAS: Record<ClaveCanonica, string> = {
  category: "Categoría",
  size: "Tamaño",
  year: "Año",
  technique: "Técnica",
  material: "Material",
  paper_type: "Tipo de papel",
  additional_info: "Información adicional",
  nft_link: "Enlace NFT",
  shipping: "Envío",
  about_the_artwork: "Sobre la obra",
};

export interface PanelTienda {
  id: string;
  shop_domain: string;
  status: string;
  location_id: string;
  created_at: string;
  last_refreshed_at: string | null;
  profile_synced_at: string | null;
  artista: string;
  shop_name: string | null;
  contact_email: string | null;
  website: string | null;
  bio: string | null;
  tiene_bio: boolean;
  productos: number;
  productos_borrados: number;
  variantes: number;
  imagenes: number;
  inventarios: number;
  variantes_sin_inventario: number;
  atributos: Record<string, number>;
  ultimo_webhook: string | null;
  webhooks_sin_procesar: number;
  fallas_24h: number;
  consumidores: string[];
}

export interface EventoRow {
  created_at: string;
  shop_id: string | null;
  direction: string;
  entity: string;
  status: string;
  error: string | null;
  payload: Record<string, unknown> | null;
}

interface MetafieldRow {
  namespace: string;
  key: string;
  type: string;
  value: string;
}

export interface ProductoRow {
  id: string;
  shop_id: string;
  shopify_product_id: string;
  title: string | null;
  handle: string | null;
  status: string | null;
  product_type: string | null;
  tags: string[] | null;
  deleted_at: string | null;
  updated_at: string | null;
  description_html: string | null;
  metafields: MetafieldRow[] | null;
  collections: Array<{ id: string; title: string; handle: string }> | null;
  taxonomy_category: { id: string; name: string; full_name: string } | null;
  product_images: Array<{ url: string; position: number; alt_text: string | null }>;
  variants: Array<{
    id: string;
    title: string | null;
    sku: string | null;
    price: string | null;
    shopify_variant_id: string;
    options: Array<{ name: string; value: string }> | null;
    inventory_levels: Array<{ available: number; location_id: string; updated_at: string }>;
  }>;
}

/** Un nodo del árbol rich_text de Shopify -> texto. Espejo de rich_text_nodo
 *  (migración 015): los bloques cierran con salto de línea, el resto concatena. */
function nodoPlano(n: unknown): string {
  if (n === null || typeof n !== "object") return "";
  const nodo = n as Record<string, unknown>;
  const tipo = nodo["type"];
  if (tipo === "text") return String(nodo["value"] ?? "");

  let partes = "";
  const hijos = nodo["children"];
  if (Array.isArray(hijos)) for (const h of hijos) partes += nodoPlano(h);

  return tipo === "paragraph" || tipo === "heading" || tipo === "list-item"
    ? `${partes}\n`
    : partes;
}

/**
 * rich_text_field -> texto plano. Espejo exacto de rich_text_plano (migración
 * 015): si el valor no es un objeto JSON se devuelve intacto, así aplicarlo es
 * seguro sobre cualquier metafield.
 *
 * El panel tiene que aplanar por su cuenta porque lee `products.metafields`
 * directo; si no, la pestaña "lo que recibe el consumidor" mostraría el árbol
 * crudo y estaría mintiendo sobre lo que entrega el API.
 */
export function richTextPlano(valor: string | null): string | null {
  if (valor === null || valor.trim() === "") return null;
  let arbol: unknown;
  try {
    arbol = JSON.parse(valor);
  } catch {
    return valor;
  }
  if (arbol === null || typeof arbol !== "object" || Array.isArray(arbol)) return valor;
  const texto = nodoPlano(arbol).replace(/\n{3,}/g, "\n\n").trim();
  return texto === "" ? null : texto;
}

/**
 * Valor de un metafield `custom.<clave>`, o null — con el MISMO tratamiento que
 * el gateway: `about_the_artwork` es rich_text_field y viaja aplanado; el resto
 * va crudo (ver 017_details_solo_custom.sql).
 */
export function metafield(p: ProductoRow, clave: string): string | null {
  const m = (p.metafields ?? []).find((x) => x.namespace === "custom" && x.key === clave);
  const v = m?.value?.trim();
  if (!v) return null;
  return clave === "about_the_artwork" ? richTextPlano(v) : v;
}

/** Suma del `available` de una variante en todas sus ubicaciones. */
export const stockDe = (v: ProductoRow["variants"][number]): number | null =>
  v.inventory_levels.length === 0
    ? null
    : v.inventory_levels.reduce((n, l) => n + l.available, 0);

const SELECT_PRODUCTO =
  "id, shop_id, shopify_product_id, title, handle, status, product_type, tags, deleted_at, updated_at, description_html, metafields, collections, taxonomy_category, " +
  "product_images(url, position, alt_text), " +
  "variants(id, title, sku, price, shopify_variant_id, options, inventory_levels(available, location_id, updated_at))";

export async function tiendas(sb: SupabaseClient): Promise<PanelTienda[]> {
  const { data, error } = await sb.from("panel_tiendas").select("*").order("created_at");
  if (error) throw new Error(`tiendas: ${error.message}`);
  return (data ?? []) as PanelTienda[];
}

export async function eventos(
  sb: SupabaseClient,
  opts: { shopId?: string | null; limite?: number } = {},
): Promise<EventoRow[]> {
  let q = sb
    .from("sync_events")
    .select("created_at, shop_id, direction, entity, status, error, payload")
    .order("created_at", { ascending: false })
    .limit(opts.limite ?? 12);
  if (opts.shopId) q = q.eq("shop_id", opts.shopId);
  const { data, error } = await q;
  if (error) throw new Error(`eventos: ${error.message}`);
  return (data ?? []) as EventoRow[];
}

export async function productos(
  sb: SupabaseClient,
  opts: { shopId?: string | null; busqueda?: string | null; limite?: number } = {},
): Promise<ProductoRow[]> {
  let q = sb
    .from("products")
    .select(SELECT_PRODUCTO)
    .order("updated_at", { ascending: false })
    .limit(opts.limite ?? 60);
  if (opts.shopId) q = q.eq("shop_id", opts.shopId);
  // Búsqueda por título: ilike con el patrón escapado para que % y _ del
  // usuario no se interpreten como comodines.
  if (opts.busqueda) {
    const patron = opts.busqueda.replace(/[%_\\]/g, (c) => `\\${c}`);
    q = q.ilike("title", `%${patron}%`);
  }
  const { data, error } = await q;
  if (error) throw new Error(`productos: ${error.message}`);
  return (data ?? []) as unknown as ProductoRow[];
}

export async function producto(sb: SupabaseClient, id: string): Promise<ProductoRow | null> {
  const { data, error } = await sb.from("products").select(SELECT_PRODUCTO).eq("id", id).maybeSingle();
  if (error) throw new Error(`producto: ${error.message}`);
  return (data as unknown as ProductoRow) ?? null;
}

export interface ConsumidorRow {
  id: string;
  name: string;
  active: boolean;
  rate_limit_per_min: number;
  allowed_shop_ids: string[];
}

export async function consumidores(sb: SupabaseClient): Promise<ConsumidorRow[]> {
  const { data, error } = await sb
    .from("api_consumers")
    .select("id, name, active, rate_limit_per_min, allowed_shop_ids")
    .order("created_at");
  if (error) throw new Error(`consumidores: ${error.message}`);
  return (data ?? []) as ConsumidorRow[];
}
