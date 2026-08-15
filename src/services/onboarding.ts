import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LOCATIONS_QUERY,
  TRACKING_SAMPLE_QUERY,
  type LocationsQueryData,
  type TrackingSampleData,
} from "../graphql/onboarding.queries.js";
import { numericId } from "./gid.js";
import { mintAccessToken, ShopifyAuthError, shopifyGraphql } from "./shopify-client.js";

/** El alta se bloquea: se reportan TODAS las fallas y no se persiste nada. */
export class OnboardingBlockedError extends Error {
  constructor(readonly fallas: string[]) {
    super(`Alta bloqueada — requisito(s) sin cumplir:\n  - ${fallas.join("\n  - ")}`);
    this.name = "OnboardingBlockedError";
  }
}

export interface OnboardShopParams {
  artistId: string;
  shopDomain: string;
  /** Client ID de la app (Dev Dashboard). No es secreto por sí solo. */
  clientId: string;
  /** Client secret — mintea el access_token y firma los webhooks de esta tienda. */
  clientSecret: string;
  /** id numérico o gid://shopify/Location/... */
  locationId: string;
}

export interface OnboardShopResult {
  shopId: string;
  created: boolean;
  locationName: string;
  trackedRatio: number;
}

const DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/**
 * Valida los 6 requisitos de la guía §2.2 y, SOLO si todos pasan, persiste
 * (secreto a Vault + fila en shops) vía create_shop_with_secrets (mig. 007).
 *
 *   1. shop URL con formato artista.myshopify.com
 *   2. Admin API "token" válido   ─┐ Client Credentials grant: mintear el
 *   6. Custom App instalada       ─┘ access_token contra ESTA tienda prueba
 *      ambos a la vez — si el client_id/secret son de otra tienda o la app
 *      no está instalada ahí, Shopify rechaza el mint (no hace falta cruzar
 *      myshopifyDomain a mano: el shop va en la URL del propio mint).
 *   3. webhook secret presente = client_secret (mismo valor, confirmado
 *      contra shopify.dev — ya validado por requisito 2/6 si el mint pasó)
 *   4. location_id existe y está ACTIVA contra la API (guía: "verify early")
 *   5. inventory tracking ON por muestreo de variantes (docs/PENDIENTES.md #2)
 */
export async function onboardShop(
  supabase: SupabaseClient,
  params: OnboardShopParams,
): Promise<OnboardShopResult> {
  const fallas: string[] = [];
  const shopDomain = params.shopDomain.trim().toLowerCase();

  // Requisito 1 — sin dominio válido no hay a quién llamar: corta de una
  if (!DOMAIN_RE.test(shopDomain)) {
    throw new OnboardingBlockedError([
      `Dominio inválido: "${params.shopDomain}" (esperado: artista.myshopify.com)`,
    ]);
  }

  // Chequeo de forma — antes de gastar una llamada a Shopify
  if (params.clientSecret.trim().length < 16) {
    fallas.push("Client secret ausente o demasiado corto (< 16 caracteres)");
  }

  // Requisitos 2, 3 y 6 — mintear YA prueba: client_id/secret válidos,
  // pertenecen a ESTA tienda, y la app está instalada ahí.
  let accessToken = "";
  try {
    accessToken = (
      await mintAccessToken({
        shopDomain,
        clientId: params.clientId,
        clientSecret: params.clientSecret,
      })
    ).accessToken;
  } catch (e) {
    if (e instanceof ShopifyAuthError) {
      fallas.push(
        "Client ID/Secret rechazados (401/403): inválidos, o la app no está instalada en esta tienda",
      );
    } else {
      fallas.push(`No se pudo mintear el access token: ${(e as Error).message}`);
    }
  }

  let locationName = "";
  let trackedRatio = 0;

  if (accessToken) {
    // Requisito 4 — la falla silenciosa más común en multi-tienda es escribir
    // a una location equivocada o desactivada (guía §2.2): verificar temprano.
    const wantedId = numericId(params.locationId);
    const locs = await shopifyGraphql<LocationsQueryData>({
      shopDomain,
      accessToken,
      query: LOCATIONS_QUERY,
    });
    const loc = locs.locations.nodes.find((l) => numericId(l.id) === wantedId);
    if (!loc) {
      const disponibles = locs.locations.nodes
        .map((l) => `${numericId(l.id)} (${l.name}${l.isActive ? "" : ", inactiva"})`)
        .join(", ");
      fallas.push(`location_id ${wantedId} no existe en la tienda. Disponibles: ${disponibles || "ninguna"}`);
    } else if (!loc.isActive) {
      fallas.push(`La location ${wantedId} ("${loc.name}") está DESACTIVADA`);
    } else {
      locationName = loc.name;
    }

    // Requisito 5 — tracking por muestreo. Sin variantes no hay forma de
    // confirmarlo: se bloquea (dirección segura del invariante).
    const sample = await shopifyGraphql<TrackingSampleData>({
      shopDomain,
      accessToken,
      query: TRACKING_SAMPLE_QUERY,
    });
    const total = sample.productVariants.nodes.length;
    const tracked = sample.productVariants.nodes.filter((v) => v.inventoryItem.tracked).length;
    if (total === 0) {
      fallas.push("La tienda no tiene variantes: imposible confirmar inventory tracking");
    } else if (tracked === 0) {
      fallas.push(`Ninguna de las ${total} variantes muestreadas tiene tracking activo`);
    } else {
      trackedRatio = tracked / total;
    }
  }

  if (fallas.length > 0) {
    throw new OnboardingBlockedError(fallas);
  }

  // Persistencia todo-o-nada (Vault + shops en una transacción, migración 007)
  const { data, error } = await supabase.rpc("create_shop_with_secrets", {
    p_artist_id: params.artistId,
    p_shop_domain: shopDomain,
    p_client_id: params.clientId,
    p_client_secret: params.clientSecret,
    p_location_id: numericId(params.locationId),
    p_inventory_tracked: true,
  });
  if (error) {
    throw new Error(`El alta falló al persistir: ${error.message}`);
  }

  const row = (data as Array<{ shop_id: string; created: boolean }>)[0];
  if (!row) {
    throw new Error("create_shop_with_secrets no devolvió fila");
  }

  return { shopId: row.shop_id, created: row.created, locationName, trackedRatio };
}
