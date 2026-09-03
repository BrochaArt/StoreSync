// Agrega (o quita) una tienda al scope de un consumidor del API gateway ya existente.
//
// El alta de un artista nuevo NO lo expone al consumidor automáticamente: el gateway
// valida shop_id contra allowed_shop_ids (Decisión 6). Sin este paso la tienda queda
// sincronizada pero invisible — 403 para el consumidor.
//
// Uso:
//   npm run add-shop-to-consumer -- --consumer <nombre|uuid> --shop-id <uuid>
//   npm run add-shop-to-consumer -- --consumer <nombre|uuid> --shop-id <uuid> --remove

import { parseArgs } from "node:util";
import { createServiceClient } from "../src/services/supabase.js";

try {
  process.loadEnvFile();
} catch {
  /* sin .env: las vars deben venir del entorno */
}

const { values } = parseArgs({
  options: {
    consumer: { type: "string" },
    "shop-id": { type: "string" },
    remove: { type: "boolean" },
  },
});

const consumerRef = values.consumer;
const shopId = values["shop-id"];
const remove = values.remove ?? false;

if (!consumerRef || !shopId) {
  console.error("Requiere --consumer <nombre|uuid> y --shop-id <uuid>. Opcional: --remove");
  process.exit(2);
}

const supabase = createServiceClient();

// La tienda debe existir: autorizar un uuid inventado dejaría un scope muerto
const { data: shop } = await supabase
  .from("shops")
  .select("id, shop_domain")
  .eq("id", shopId)
  .maybeSingle<{ id: string; shop_domain: string }>();
if (!shop) {
  console.error(`La tienda ${shopId} no existe.`);
  process.exit(1);
}

// El consumidor se busca por uuid o por nombre (lo segundo es lo cómodo en operación)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const { data: consumer } = await supabase
  .from("api_consumers")
  .select("id, name, allowed_shop_ids, active")
  .eq(UUID_RE.test(consumerRef) ? "id" : "name", consumerRef)
  .maybeSingle<{ id: string; name: string; allowed_shop_ids: string[]; active: boolean }>();
if (!consumer) {
  console.error(`No existe el consumidor "${consumerRef}".`);
  process.exit(1);
}

const actuales = consumer.allowed_shop_ids ?? [];
const yaEsta = actuales.includes(shopId);

if (remove ? !yaEsta : yaEsta) {
  console.log(
    remove
      ? `= ${shop.shop_domain} no estaba en el scope de "${consumer.name}": nada que hacer`
      : `= ${shop.shop_domain} ya estaba autorizada para "${consumer.name}": nada que hacer`,
  );
  process.exit(0);
}

const nuevos = remove ? actuales.filter((id) => id !== shopId) : [...actuales, shopId];

const { error } = await supabase
  .from("api_consumers")
  .update({ allowed_shop_ids: nuevos })
  .eq("id", consumer.id);
if (error) {
  console.error(`No se pudo actualizar el scope: ${error.message}`);
  process.exit(1);
}

console.log(remove ? "✔ Tienda retirada del scope" : "✔ Tienda autorizada");
console.log(`  consumidor: ${consumer.name}${consumer.active ? "" : "  ⚠ (inactivo)"}`);
console.log(`  tienda:     ${shop.shop_domain}`);
console.log(`  scope:      ${actuales.length} → ${nuevos.length} tienda(s)`);
