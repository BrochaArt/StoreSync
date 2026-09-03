// Lista las locations de una tienda ANTES de darla de alta: de acá sale el
// --location-id que pide el onboarding, y es el único dato que no viene en las
// credenciales que entrega el artista. No toca la base de datos.
//
// Uso:
//   SHOPIFY_CLIENT_ID=... SHOPIFY_CLIENT_SECRET=... \
//     npm run list-locations -- --shop-domain artista.myshopify.com

import { parseArgs } from "node:util";
import { LOCATIONS_QUERY, type LocationsQueryData } from "../src/graphql/onboarding.queries.js";
import {
  INVENTORY_BATCH_QUERY,
  type InventoryBatchData,
} from "../src/graphql/products.query.js";
import {
  TRACKING_SAMPLE_QUERY,
  type TrackingSampleData,
} from "../src/graphql/onboarding.queries.js";
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
    // Con varias activas, elegir mal es la falla silenciosa clásica: el import
    // escribe inventario SOLO en la location elegida, así que la tienda
    // aparecería sin stock. Se mide en vez de adivinar.
    console.log(`\n${activas.length} locations activas. Midiendo dónde está el inventario…\n`);

    const sample = await shopifyGraphql<TrackingSampleData>({
      shopDomain,
      accessToken,
      query: TRACKING_SAMPLE_QUERY,
    });
    const items = sample.productVariants.nodes.map((v) => v.inventoryItem.id);

    if (items.length === 0) {
      console.log("  La tienda no tiene variantes: no hay inventario que medir.");
    } else {
      // Se pregunta por los niveles de la muestra y se agrupa por la location
      // que responde, en vez de iterar la lista de locations: los servicios de
      // fulfillment (Printful y similares) NO salen en `locations` pero sí
      // guardan stock, y medir solo las listadas los dejaba invisibles.
      const data = await shopifyGraphql<InventoryBatchData>({
        shopDomain,
        accessToken,
        query: INVENTORY_BATCH_QUERY,
        variables: { ids: items, levels: 20 },
      });

      const porLocation = new Map<string, { name: string; conNivel: number; unidades: number }>();
      for (const node of data.nodes) {
        for (const nivel of node?.inventoryLevels?.nodes ?? []) {
          const q = nivel.quantities.find((x) => x.name === "available");
          if (typeof q?.quantity !== "number") continue;
          const id = numericId(nivel.location.id);
          const acc = porLocation.get(id) ?? { name: nivel.location.name, conNivel: 0, unidades: 0 };
          acc.conNivel++;
          acc.unidades += q.quantity;
          porLocation.set(id, acc);
        }
      }

      const listadas = new Set(nodes.map((l) => numericId(l.id)));
      const filas = [...porLocation.entries()].map(([id, v]) => ({
        id,
        name: listadas.has(id) ? v.name : `${v.name}  (no aparece en locations: fulfillment service)`,
        conNivel: v.conNivel,
        unidades: v.unidades,
      }));

      console.log(`  sobre ${items.length} variantes muestreadas:\n`);
      for (const f of filas) {
        console.log(
          `  ${f.id.padEnd(14)} ${String(f.conNivel).padStart(3)}/${items.length} con nivel` +
            `  ${String(f.unidades).padStart(6)} unidades   ${f.name}`,
        );
      }

      const orden = [...filas].sort((a, b) => b.conNivel - a.conNivel || b.unidades - a.unidades);
      const ganadora = orden[0]!;
      const segunda = orden[1];
      if (ganadora.conNivel === 0) {
        console.log("\n  Ninguna tiene inventario en la muestra: preguntarle al artista cuál despacha.");
      } else if (segunda && segunda.conNivel === ganadora.conNivel) {
        console.log("\n  Empate: las dos tienen nivel para las mismas variantes. Decide el artista.");
      } else {
        console.log(`\n  Usar en el alta:  --location-id ${ganadora.id}   (${ganadora.name})`);
      }
    }
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
