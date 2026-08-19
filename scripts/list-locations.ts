// Lista las locations de una tienda ANTES de darla de alta: de acá sale el
// --location-id que pide el onboarding, y es el único dato que no viene en las
// credenciales que entrega el artista. No toca la base de datos.
//
// Uso:
//   SHOPIFY_CLIENT_ID=... SHOPIFY_CLIENT_SECRET=... \
//     npm run list-locations -- --shop-domain artista.myshopify.com

import { parseArgs } from "node:util";
import { LOCATIONS_QUERY, type LocationsQueryData } from "../src/graphql/onboarding.queries.js";
import { numericId } from "../src/services/gid.js";
import { mintAccessToken, ShopifyAuthError, shopifyGraphql } from "../src/services/shopify-client.js";

try {
  process.loadEnvFile();
} catch {
  /* sin .env: las vars deben venir del entorno */
}

const { values } = parseArgs({ options: { "shop-domain": { type: "string" } } });

const shopDomain = values["shop-domain"];
const clientId = process.env["SHOPIFY_CLIENT_ID"];
const clientSecret = process.env["SHOPIFY_CLIENT_SECRET"];

if (!shopDomain || !clientId || !clientSecret) {
  console.error(
    "Requiere --shop-domain y las env vars SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET.",
  );
  process.exit(2);
}

try {
  // Mintear ya prueba que las credenciales son de ESTA tienda y que la app
  // está instalada: si esto pasa, el onboarding no va a fallar por auth.
  const { accessToken } = await mintAccessToken({ shopDomain, clientId, clientSecret });
  const data = await shopifyGraphql<LocationsQueryData>({
    shopDomain,
    accessToken,
    query: LOCATIONS_QUERY,
  });

  const nodes = data.locations.nodes;
  if (nodes.length === 0) {
    console.error("La tienda no tiene locations: el alta no puede continuar.");
    process.exit(1);
  }

  console.log(`Locations de ${shopDomain}:`);
  for (const l of nodes) {
    console.log(
      `  ${numericId(l.id).padEnd(14)} ${l.isActive ? "activa  " : "INACTIVA"}  ${l.name}`,
    );
  }

  const activas = nodes.filter((l) => l.isActive);
  if (activas.length === 1) {
    console.log(`\nUsar en el alta:  --location-id ${numericId(activas[0]!.id)}`);
  } else if (activas.length === 0) {
    console.error("\n✖ Ninguna location activa: el onboarding va a bloquear el alta.");
    process.exit(1);
  } else {
    console.log(`\n${activas.length} locations activas: elegir la primaria, la que despacha.`);
  }
} catch (e) {
  if (e instanceof ShopifyAuthError) {
    console.error(
      "✖ Client ID/Secret rechazados: son inválidos, son de otra tienda, o la app no está instalada ahí.",
    );
    process.exit(1);
  }
  console.error(`✖ ${(e as Error).message}`);
  process.exit(1);
}
