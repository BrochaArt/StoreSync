// Crea en la tienda de un artista las definiciones canónicas `custom.*` que le
// falten, para que los campos del contrato existan en su editor de Shopify.
//
// Sin definición no hay dónde escribir el atributo: es el desbloqueador de
// cualquier tienda que llegue sin metafields cargados.
//
// ESCRIBE EN LA TIENDA DEL ARTISTA. Por eso el modo por defecto es solo mostrar
// el plan; hay que pasar --aplicar para que cree algo.
//
// Uso:
//   npm run create-metafield-definitions -- --shop-id <uuid>            # plan
//   npm run create-metafield-definitions -- --shop-id <uuid> --aplicar  # ejecuta

import { parseArgs } from "node:util";
import { crearDefinicionesCanonicas } from "../src/services/metafield-definitions.js";
import { ShopifyAuthError } from "../src/services/shopify-client.js";
import { createServiceClient } from "../src/services/supabase.js";

try {
  process.loadEnvFile();
} catch {
  /* sin .env */
}

const { values } = parseArgs({
  options: { "shop-id": { type: "string" }, aplicar: { type: "boolean" } },
});

const shopId = values["shop-id"];
if (!shopId) {
  console.error("Requiere --shop-id <uuid>. Agrega --aplicar para escribir de verdad.");
  process.exit(2);
}

const supabase = createServiceClient();

try {
  const s = await crearDefinicionesCanonicas(supabase, shopId, { aplicar: values.aplicar ?? false });

  console.log(`Tienda: ${s.shopDomain}`);
  if (s.simulado) console.log("MODO PLAN — no se escribió nada. Agrega --aplicar para ejecutar.\n");

  for (const d of s.yaExistian) console.log(`= ya existía   custom.${d.key}  (${d.tipo})`);
  for (const k of s.creadas) console.log(`${s.simulado ? "+ se crearía  " : "✔ creada      "} custom.${k}`);
  for (const f of s.fallidas) console.error(`✖ falló        custom.${f.key}: ${f.error}`);

  console.log(
    `\n${s.yaExistian.length} ya existían · ${s.creadas.length} ${s.simulado ? "por crear" : "creadas"} · ${s.fallidas.length} fallidas`,
  );
  if (!s.simulado && s.creadas.length > 0) {
    console.log("\nLos campos ya aparecen en el editor de productos de Shopify del artista.");
    console.log("Cargar valores es trabajo suyo: el pipeline no inventa datos.");
  }
  if (s.fallidas.length > 0) process.exit(1);
} catch (e) {
  if (e instanceof ShopifyAuthError) {
    console.error(`✖ ${e.message}`);
    process.exit(1);
  }
  console.error(`✖ ${(e as Error).message}`);
  process.exit(1);
}
