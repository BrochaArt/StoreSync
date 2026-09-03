// Import inicial de catálogo (guía §5): productos → variantes (con
// inventory_item_id SIEMPRE) → imágenes → inventario por location primaria.
// Idempotente: correrlo dos veces converge al mismo estado (upserts + set).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INVENTORY_BATCH_QUERY,
  PRODUCTS_COUNT_QUERY,
  type InventoryBatchData,
  type ProductsCountData,
} from "../graphql/products.query.js";
import type { ShopCredentials } from "../types/index.js";
import { PaginatedCatalogSource, type CatalogSource } from "./catalog-source.js";
import { numericId, toGid } from "./gid.js";
import { mintAccessToken, shopifyGraphql } from "./shopify-client.js";
import { syncShopProfile } from "./shop-profile.js";
import { upsertProductoImportado } from "../repositories/catalog.js";

export interface ImportSummary {
  productos: number;
  variantes: number;
  imagenes: number;
  inventariosEscritos: number;
  productosEnShopify: number | null;
  /** Perfil del artista refrescado desde shop { } — null si no se pudo */
  perfil: { nombre: string | null; email: string | null; definiciones: number } | null;
  advertencias: string[];
}

const INVENTORY_BATCH = 50;
// Locations por item que se piden de una. Una tienda normal tiene 1-3; el tope
// deja margen para fulfillment services sin disparar el costo de la query.
const INVENTORY_LEVELS_POR_ITEM = 20;

export async function importCatalog(
  supabase: SupabaseClient,
  shopId: string,
  source?: CatalogSource,
): Promise<ImportSummary> {
  // La tienda debe estar operable: needs_reauth/paused detiene sus jobs (§10)
  const { data: shop, error: shopErr } = await supabase
    .from("shops")
    .select("status")
    .eq("id", shopId)
    .single();
  if (shopErr || !shop) throw new Error(`Tienda ${shopId} no existe: ${shopErr?.message ?? ""}`);
  if (shop.status !== "active") {
    throw new Error(`Tienda ${shopId} en estado '${shop.status}': import bloqueado (§10)`);
  }

  const { data: credsRows, error: credsErr } = await supabase.rpc("get_shop_credentials", {
    p_shop_id: shopId,
  });
  const creds = credsRows?.[0] as ShopCredentials | undefined;
  if (credsErr || !creds) {
    throw new Error(`Sin credenciales para ${shopId}: ${credsErr?.message ?? "sin fila"}`);
  }

  // Un solo mint para toda la corrida (válido 24h — de sobra para un import
  // completo, incluso de catálogos grandes). Nada de caché: la próxima
  // corrida mintea el suyo.
  const { accessToken } = await mintAccessToken({
    shopDomain: creds.shop_domain,
    clientId: creds.client_id,
    clientSecret: creds.client_secret,
  });

  const src = source ?? new PaginatedCatalogSource(creds.shop_domain, accessToken);
  const summary: ImportSummary = {
    productos: 0,
    variantes: 0,
    imagenes: 0,
    inventariosEscritos: 0,
    productosEnShopify: null,
    perfil: null,
    advertencias: [],
  };

  // Perfil del artista (nombre, email, web, bio) + etiquetas de metafields.
  // Si falla no se aborta el import: el catálogo es el trabajo principal y el
  // perfil se vuelve a intentar en la próxima corrida.
  try {
    const perfil = await syncShopProfile(supabase, shopId, creds.shop_domain, accessToken);
    summary.perfil = {
      nombre: perfil.shopName,
      email: perfil.contactEmail,
      definiciones: Object.keys(perfil.metafieldDefinitions).length,
    };
    if (!perfil.contactEmail) {
      summary.advertencias.push("La tienda no expone contactEmail: artist.email saldrá null");
    }
  } catch (e) {
    summary.advertencias.push(`No se pudo sincronizar el perfil: ${(e as Error).message}`);
  }

  for await (const pagina of src.fetchCatalog()) {
    // Fase 1 (página): upsert de productos/variantes/imágenes + mapping
    const itemToVariant = new Map<string, string>();
    for (const p of pagina) {
      const persisted = await upsertProductoImportado(supabase, shopId, p);
      summary.productos++;
      summary.variantes += p.variants.length;
      summary.imagenes += p.images.length;
      for (const [item, variantId] of persisted.variantIdByInventoryItem) {
        itemToVariant.set(item, variantId);
      }
      if (p.variants.length > 50) {
        summary.advertencias.push(
          `Producto ${p.shopifyProductId}: ${p.variants.length} variantes (candidato a Bulk §5.3)`,
        );
      }
    }

    // Fase 2 (página): available por item en TODAS sus locations, en lotes.
    // Una fila por (variante, location): el consumidor recibe la foto completa
    // y decide. Limitarlo a la primaria escondía el stock de los servicios de
    // fulfillment, que viven en una location propia (ver INVENTORY_BATCH_QUERY).
    const items = [...itemToVariant.keys()];
    for (let i = 0; i < items.length; i += INVENTORY_BATCH) {
      const lote = items.slice(i, i + INVENTORY_BATCH);
      const data = await shopifyGraphql<InventoryBatchData>({
        shopDomain: creds.shop_domain,
        accessToken,
        query: INVENTORY_BATCH_QUERY,
        variables: {
          ids: lote.map((id) => toGid("InventoryItem", id)),
          levels: INVENTORY_LEVELS_POR_ITEM,
        },
      });

      for (const node of data.nodes) {
        if (!node || node.__typename !== "InventoryItem" || !node.id) continue;
        const itemId = node.id.split("/").pop() ?? "";
        const variantId = itemToVariant.get(itemId);
        if (!variantId) continue;

        const niveles = node.inventoryLevels?.nodes ?? [];
        if (node.inventoryLevels?.pageInfo.hasNextPage) {
          // Más locations de las que pedimos: se escriben las traídas, pero hay
          // que saberlo — el consumidor vería un inventario incompleto.
          summary.advertencias.push(
            `inventory_item ${itemId} tiene más de ${INVENTORY_LEVELS_POR_ITEM} locations: solo se escribieron las primeras`,
          );
        }

        let escritosDelItem = 0;
        for (const nivel of niveles) {
          const qty = nivel.quantities.find((q) => q.name === "available")?.quantity;
          // available null = item sin tracking en esa location: NO inventar un
          // número, simplemente no se escribe esa fila.
          if (typeof qty !== "number") continue;

          const { error: applyErr } = await supabase.rpc("apply_inventory_change", {
            p_variant_id: variantId,
            p_location_id: numericId(nivel.location.id),
            p_new_available: qty,
            p_source: "initial_import",
          });
          if (applyErr) {
            throw new Error(`apply_inventory_change ${variantId}: ${applyErr.message}`);
          }
          summary.inventariosEscritos++;
          escritosDelItem++;
        }

        if (escritosDelItem === 0) {
          // Sin una sola location con 'available': sin filas = no vendible,
          // la dirección segura (mostrar menos, nunca inventar existencias).
          summary.advertencias.push(
            `inventory_item ${itemId} sin 'available' en ninguna location: no escrito`,
          );
        }
      }
    }
  }

  // Completitud del mapping (§12.2 paso 3): comparar contra productsCount
  try {
    const countData = await shopifyGraphql<ProductsCountData>({
      shopDomain: creds.shop_domain,
      accessToken,
      query: PRODUCTS_COUNT_QUERY,
    });
    summary.productosEnShopify = countData.productsCount?.count ?? null;
    if (
      summary.productosEnShopify !== null &&
      summary.productosEnShopify !== summary.productos
    ) {
      summary.advertencias.push(
        `Completitud: Shopify reporta ${summary.productosEnShopify} productos, importados ${summary.productos}`,
      );
    }
  } catch (e) {
    summary.advertencias.push(`No se pudo verificar productsCount: ${(e as Error).message}`);
  }

  // Rastro de observabilidad del import completo
  await supabase.from("sync_events").insert({
    shop_id: shopId,
    direction: "inbound",
    entity: "product",
    status: "success",
    payload: { import_inicial: true, ...summary, advertencias: summary.advertencias.slice(0, 20) },
  });

  return summary;
}
