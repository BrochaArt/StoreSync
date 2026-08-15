// Alta de tienda (guía §2.2 + Decisiones 2 + migración 007). Bloqueante: si un
// requisito falla, se reportan TODAS las fallas y no se persiste nada.
//
// Credenciales de la app del Dev Dashboard de ESA tienda (Client Credentials
// grant — Shopify retiró las Custom Apps clásicas el 1-ene-2026). Client ID
// y Secret están en Settings → Credentials de la app. SOLO por variables de
// entorno (no quedan en historial del shell):
//   SHOPIFY_CLIENT_ID=...  SHOPIFY_CLIENT_SECRET=...
//
// Uso:
//   npm run onboard -- --shop-domain artista.myshopify.com --location-id 123456 \
//     (--artist-id <uuid> | --artist-name "Nombre")

import { parseArgs } from "node:util";
import { OnboardingBlockedError, onboardShop } from "../src/services/onboarding.js";
import { createServiceClient } from "../src/services/supabase.js";

try {
  process.loadEnvFile();
} catch {
  /* sin .env: las vars deben venir del entorno */
}

const { values } = parseArgs({
  options: {
    "shop-domain": { type: "string" },
    "location-id": { type: "string" },
    "artist-id": { type: "string" },
    "artist-name": { type: "string" },
  },
});

const shopDomain = values["shop-domain"];
const locationId = values["location-id"];
const clientId = process.env["SHOPIFY_CLIENT_ID"];
const clientSecret = process.env["SHOPIFY_CLIENT_SECRET"];

if (!shopDomain || !locationId || !clientId || !clientSecret) {
  console.error(
    "Faltan datos: requiere --shop-domain, --location-id y las env vars SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET.",
  );
  process.exit(2);
}

const supabase = createServiceClient();

let artistId = values["artist-id"];
if (!artistId) {
  const artistName = values["artist-name"];
  if (!artistName) {
    console.error("Falta --artist-id o --artist-name.");
    process.exit(2);
  }
  const { data, error } = await supabase
    .from("artists")
    .insert({ name: artistName })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    console.error(`No se pudo crear el artista: ${error?.message ?? "sin datos"}`);
    process.exit(1);
  }
  artistId = data.id;
  console.log(`Artista creado: ${artistId}`);
}

try {
  const r = await onboardShop(supabase, {
    artistId,
    shopDomain,
    locationId,
    clientId,
    clientSecret,
  });
  console.log(
    r.created
      ? "✔ Tienda dada de alta"
      : "✔ Credenciales rotadas (la tienda ya existía; vuelve a 'active')",
  );
  console.log(`  shop_id:  ${r.shopId}`);
  console.log(`  location: ${r.locationName} (${locationId})`);
  console.log(`  tracking: ${(r.trackedRatio * 100).toFixed(0)}% de variantes muestreadas`);
} catch (e) {
  if (e instanceof OnboardingBlockedError) {
    console.error(`✖ ${e.message}`);
    process.exit(1);
  }
  throw e;
}
