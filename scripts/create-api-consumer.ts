// Emite un API key para un consumidor externo del API gateway (Decisión 6).
// El key plano se muestra UNA sola vez y jamás se persiste: en la base solo
// queda su sha256 (key_hash). Si se pierde, se emite uno nuevo — no se recupera.
//
// Uso:
//   npm run create-api-consumer -- --name leadgods --contact-email dev@leadgods.com \
//     --shop-id <uuid> [--shop-id <uuid> ...] [--rate-limit 120] [--notes "..."]
//
// El contacto es obligatorio: un consumidor sin a quién avisarle se entera de
// un cambio de contrato cuando algo se le rompe (migración 025).

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
    "contact-email": { type: "string" },
    notes: { type: "string" },
    "shop-id": { type: "string", multiple: true },
    "rate-limit": { type: "string" },
  },
});

const name = values.name;
const contactEmail = values["contact-email"]?.trim() || null;
const notes = values.notes?.trim() || null;
const shopIds = values["shop-id"] ?? [];
const rateLimit = values["rate-limit"] ? Number(values["rate-limit"]) : 120;

if (!name || shopIds.length === 0 || !contactEmail) {
  console.error("Requiere --name, --contact-email y al menos un --shop-id <uuid>.");
  process.exit(2);
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
  console.error(`--contact-email no parece un correo: ${contactEmail}`);
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
    contact_email: contactEmail,
    notes,
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
console.log(`  contacto:    ${contactEmail}${notes ? ` (${notes})` : ""}`);
console.log(`  shops:       ${shopIds.join(", ")}`);
console.log(`  rate limit:  ${rateLimit}/min`);
console.log("");
console.log("  API KEY (se muestra UNA sola vez — guárdalo y entrégalo por canal seguro):");
console.log(`  ${apiKey}`);
