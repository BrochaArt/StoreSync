// Emite un API key para un consumidor externo del API gateway (Decisión 6).
// El key plano se muestra UNA sola vez y jamás se persiste: en la base solo
// queda su sha256 (key_hash). Si se pierde, se emite uno nuevo — no se recupera.
//
// Uso:
//   npm run create-api-consumer -- --name leadgods \
//     --shop-id <uuid> [--shop-id <uuid> ...] [--rate-limit 120]

import { randomBytes, createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { createServiceClient } from "../src/services/supabase.js";

try {
  process.loadEnvFile();
} catch {
  /* sin .env: las vars deben venir del entorno */
}

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    "shop-id": { type: "string", multiple: true },
    "rate-limit": { type: "string" },
  },
});

const name = values.name;
const shopIds = values["shop-id"] ?? [];
const rateLimit = values["rate-limit"] ? Number(values["rate-limit"]) : 120;

if (!name || shopIds.length === 0) {
  console.error("Requiere --name y al menos un --shop-id <uuid>.");
  process.exit(2);
}

// Key opaco de alta entropía. Prefijo para reconocerlo de un vistazo.
const apiKey = `sk_storesync_${randomBytes(24).toString("hex")}`;
const keyHash = createHash("sha256").update(apiKey).digest("hex");

const supabase = createServiceClient();

const { data, error } = await supabase
  .from("api_consumers")
  .insert({
    name,
    key_hash: keyHash,
    allowed_shop_ids: shopIds,
    rate_limit_per_min: rateLimit,
  })
  .select("id")
  .single<{ id: string }>();

if (error || !data) {
  console.error(`No se pudo crear el consumidor: ${error?.message ?? "sin datos"}`);
  process.exit(1);
}

console.log("✔ Consumidor creado");
console.log(`  id:          ${data.id}`);
console.log(`  name:        ${name}`);
console.log(`  shops:       ${shopIds.join(", ")}`);
console.log(`  rate limit:  ${rateLimit}/min`);
console.log("");
console.log("  API KEY (se muestra UNA sola vez — guárdalo y entrégalo por canal seguro):");
console.log(`  ${apiKey}`);
