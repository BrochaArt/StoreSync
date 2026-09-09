// Perfil de la tienda: los datos del artista y las etiquetas de sus metafields.
//
// Todo lo que se guarda aquí sale de campos estándar de Shopify, así que el
// mismo código sirve para cualquier artista sin configuración por tienda.
//
// Se refresca en el onboarding y en cada import de catálogo: son dos llamadas
// baratas y evitan que el API sirva un email viejo.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  METAFIELD_DEFINITIONS_QUERY,
  SHOP_PROFILE_QUERY,
  type MetafieldDefinitionsData,
  type ShopProfileData,
} from "../graphql/shop.query.js";
import { shopifyGraphql } from "./shopify-client.js";

export interface PerfilTienda {
  shopName: string | null;
  contactEmail: string | null;
  website: string | null;
  bio: string | null;
  /** ISO 4217 ("PEN", "USD"). La moneda en la que el artista publica. */
  currency: string | null;
  /** "namespace.key" -> etiqueta legible definida por el artista */
  metafieldDefinitions: Record<string, string>;
}

export async function fetchShopProfile(
  shopDomain: string,
  accessToken: string,
): Promise<PerfilTienda> {
  const { shop } = await shopifyGraphql<ShopProfileData>({
    shopDomain,
    accessToken,
    query: SHOP_PROFILE_QUERY,
  });

  // Las definiciones se paginan: una tienda con muchos metafields pasa de 250.
  const metafieldDefinitions: Record<string, string> = {};
  let cursor: string | null = null;
  do {
    const data: MetafieldDefinitionsData = await shopifyGraphql<MetafieldDefinitionsData>({
      shopDomain,
      accessToken,
      query: METAFIELD_DEFINITIONS_QUERY,
      variables: { cursor },
    });
    for (const d of data.metafieldDefinitions.nodes) {
      // trim: hay definiciones reales con espacio de más ("Ships in a tube ").
      // El resto del texto no se toca — las mayúsculas son decisión del artista.
      metafieldDefinitions[`${d.namespace}.${d.key}`] = d.name.trim();
    }
    const { pageInfo } = data.metafieldDefinitions;
    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);

  return {
    shopName: shop.name?.trim() || null,
    // contactEmail es el de cara al público; email es el de la cuenta
    contactEmail: shop.contactEmail?.trim() || shop.email?.trim() || null,
    website: shop.url?.trim() || null,
    bio: shop.description?.trim() || null,
    currency: shop.currencyCode?.trim() || null,
    metafieldDefinitions,
  };
}

/** Persiste el perfil en shops. No toca credenciales ni status. */
export async function syncShopProfile(
  supabase: SupabaseClient,
  shopId: string,
  shopDomain: string,
  accessToken: string,
): Promise<PerfilTienda> {
  const perfil = await fetchShopProfile(shopDomain, accessToken);

  const { error } = await supabase
    .from("shops")
    .update({
      shop_name: perfil.shopName,
      contact_email: perfil.contactEmail,
      website: perfil.website,
      bio: perfil.bio,
      currency: perfil.currency,
      metafield_definitions: perfil.metafieldDefinitions,
      profile_synced_at: new Date().toISOString(),
    })
    .eq("id", shopId);
  if (error) throw new Error(`No se pudo guardar el perfil de ${shopDomain}: ${error.message}`);

  return perfil;
}
