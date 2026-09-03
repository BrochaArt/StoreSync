import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CREATE_DEFINITION_MUTATION,
  DEFINICIONES_CANONICAS,
  LIST_DEFINITIONS_QUERY,
  type CreateDefinitionData,
  type ListDefinitionsData,
  type MetafieldDefinicion,
} from "../graphql/metafield-definitions.js";
import type { ShopCredentials } from "../types/index.js";
import { mintAccessToken, shopifyGraphql } from "./shopify-client.js";

export interface DefinicionesSummary {
  shopDomain: string;
  creadas: string[];
  yaExistian: Array<{ key: string; tipo: string }>;
  fallidas: Array<{ key: string; error: string }>;
  /** true si no se escribió nada (modo plan). */
  simulado: boolean;
}

/**
 * Crea en la tienda del artista las definiciones canónicas que le falten.
 *
 * Idempotente: lista las existentes del namespace `custom` y crea solo las
 * ausentes. Una definición ya presente NO se modifica — el artista pudo haberla
 * ajustado a su gusto (etiqueta, descripción) y el contrato solo depende de la
 * clave, no de cómo la llame.
 *
 * ESCRIBE en la tienda de un tercero: por eso `aplicar` es opt-in explícito.
 * Con `aplicar: false` devuelve el plan sin tocar nada.
 */
export async function crearDefinicionesCanonicas(
  supabase: SupabaseClient,
  shopId: string,
  opts: { aplicar: boolean } = { aplicar: false },
): Promise<DefinicionesSummary> {
  const { data: credsRows, error } = await supabase.rpc("get_shop_credentials", {
    p_shop_id: shopId,
  });
  if (error || !credsRows?.[0]) {
    throw new Error(`No hay credenciales para la tienda ${shopId}: ${error?.message ?? "sin fila"}`);
  }
  const creds = credsRows[0] as ShopCredentials;

  const { accessToken } = await mintAccessToken({
    shopDomain: creds.shop_domain,
    clientId: creds.client_id,
    clientSecret: creds.client_secret,
  });

  // Definiciones `custom` ya presentes (paginado: una tienda puede tener muchas)
  const existentes = new Map<string, string>();
  let cursor: string | null = null;
  do {
    const data: ListDefinitionsData = await shopifyGraphql<ListDefinitionsData>({
      shopDomain: creds.shop_domain,
      accessToken,
      query: LIST_DEFINITIONS_QUERY,
      variables: { cursor },
    });
    for (const n of data.metafieldDefinitions.nodes) existentes.set(n.key, n.type.name);
    cursor = data.metafieldDefinitions.pageInfo.hasNextPage
      ? data.metafieldDefinitions.pageInfo.endCursor
      : null;
  } while (cursor);

  const summary: DefinicionesSummary = {
    shopDomain: creds.shop_domain,
    creadas: [],
    yaExistian: [],
    fallidas: [],
    simulado: !opts.aplicar,
  };

  for (const def of DEFINICIONES_CANONICAS) {
    const tipoExistente = existentes.get(def.key);
    if (tipoExistente !== undefined) {
      summary.yaExistian.push({ key: def.key, tipo: tipoExistente });
      continue;
    }
    if (!opts.aplicar) {
      summary.creadas.push(def.key); // lo que se crearía
      continue;
    }
    try {
      const r = await shopifyGraphql<CreateDefinitionData>({
        shopDomain: creds.shop_domain,
        accessToken,
        query: CREATE_DEFINITION_MUTATION,
        variables: { definition: definicionInput(def) },
      });
      const errs = r.metafieldDefinitionCreate.userErrors;
      if (errs.length > 0) {
        summary.fallidas.push({ key: def.key, error: errs.map((e) => e.message).join("; ") });
        continue;
      }
      summary.creadas.push(def.key);
    } catch (e) {
      summary.fallidas.push({ key: def.key, error: (e as Error).message });
    }
  }

  return summary;
}

function definicionInput(def: MetafieldDefinicion) {
  return {
    namespace: "custom",
    key: def.key,
    name: def.name,
    description: def.description,
    type: def.type,
    ownerType: "PRODUCT",
    ...(def.validations ? { validations: def.validations } : {}),
  };
}
