# ESTADO — sesión 2026-07-21/22 (pasos 1–7 del orden de ejecución)

> Para retomar sin perder contexto. Documentos rectores en la raíz:
> `Shopify_Supabase_Sync_Dev_Guide.docx` + `DECISIONES_TECNICAS_SYNC.md`
> (las decisiones SIEMPRE ganan ante contradicción).

## Campos estándar en el catálogo (Decisión 7) — DESPLEGADO Y VERIFICADO (2026-08-13)

Ampliación del contrato del gateway a pedido del consumidor (artista, categoría,
detalles). Auditado contra el catálogo real: 205 productos, ver Decisión 7 para qué se
rechazó y por qué.

**Estado:** `db push` aplicó 007–010 (la 007 y la 008 estaban vivas en cloud pero sin
registrar en el historial: se re-aplicaron como no-op y quedaron registradas).
Import completo: 205/205 productos, 278 variantes, 991 imágenes, perfil del artista y
12 definiciones de metafield. Sin advertencias.

Verificado contra el endpoint en vivo (100 productos): `shop.artist` completo,
100/100 con taxonomía y `collections`, 89/100 con `details`, 38/100 con opción de
variante distinta de `Title`, paginación por cursor OK y ningún metafield interno de
Shopify colado en `details`.

**`011_atributos_canonicos.sql` (aplicada y verificada):** sube `artist`,
`artist_email` y `category` a parámetros del producto; `category` pasa a ser la de
negocio (desde `custom.category`) y la taxonomía de Shopify se mueve a
`shopify_taxonomy`. Ver Decisión 7b. Hoy `category` sale `null` en toda la tienda:
se llena cuando se corra el backfill de metafields.

**Backfill de la tienda especial — EJECUTADO (2026-08-14):** los atributos que vivían
en prosa dentro de `description_html` se pasaron a metafields estándar en el Shopify de
la artista, vía `metafieldsSet` (nunca import por CSV, que actualiza el producto entero
por handle). Se crearon 4 definiciones —`custom.category` "Categoría" con lista de
opciones fija, `custom.size` "Tamaño", `custom.year` "Año", `custom.technique` "Técnica"—
y se escribieron **477/477 metafields sobre 205 productos, sin errores**. Prueba previa
sobre 2 productos, verificada leyendo de vuelta.

Estado tras reimportar, medido sobre la respuesta del API:

| | antes | después |
|---|---|---|
| `category` con valor | 0/205 | **205/205** |
| tamaño como parámetro | 0/205 | **103** en `details` + 73 en opción de variante = 176 |
| año | 0/205 | **66** (los 37 canvas impresos no tienen: el año es de la obra original) |
| técnica | 0/205 | **103** |

El mapa colección→categoría usado para sembrar los valores vivió en un script
desechable fuera del repo; el pipeline sigue sin una línea específica de esta tienda.

**Segunda tanda (mismo día):** pares `Etiqueta: valor` que quedaban en la prosa —
`Material` (109), `Información adicional` (109), `Tipo de papel` (73) y `Enlace NFT`
(18) — con **lista blanca de etiquetas medidas**, nunca "lo que esté en `<strong>`":
hay dos productos con la técnica y la medida en negrita que habrían generado
metafields basura. 309 metafields sobre 127 productos, sin errores. Resultado:
194/205 productos con al menos un detalle, promedio de 4 por producto.

**`012` + `013` — `description_text`:** campo nuevo con la descripción en texto plano.
Se calcula al LEER (`html_a_texto`), no al escribir, porque la descripción entra por
dos caminos (import GraphQL y webhook REST) y hacerlo al escribir obligaría a mantener
el mismo limpiador en TypeScript y en Deno. La 013 corrige dos defectos que solo
aparecieron con datos reales: espacios U+00A0 **literales** (no la entidad `&nbsp;`)
que deja el pegado desde Notion, y `btrim` sin argumentos, que no recorta saltos de
línea. Barrido de los 205: cero residuos HTML, cero espacios invisibles, cero bordes
sucios.

| Archivo | Qué hace |
|---|---|
| `009_campos_estandar.sql` | `products`: vendor, product_type, tags, taxonomy_category, collections, metafields · `variants`: title, options · `shops`: perfil del artista + `metafield_definitions` |
| `010_api_get_catalog_v2.sql` | `create or replace api_get_catalog`: agrega `shop.artist`, los campos crudos, `details` y `variants[].options`. Aditivo — el consumidor actual no se rompe |
| `src/graphql/shop.query.ts` | `shop { name contactEmail url description }` + definiciones de metafields (la etiqueta legible de cada `details`) |
| `src/services/shop-profile.ts` | Sincroniza el perfil a `shops`; lo llama el import |
| `products.query.ts`, `catalog-source.ts`, `repositories/catalog.ts` | Piden y persisten los campos nuevos |
| `worker-sync/handlers.ts` | Camino webhook: vendor/product_type/tags (CSV) y `option1..3` → `options`. Omite collections/metafields (no vienen en REST) para no borrarlos |

Para aplicarlo:

```bash
supabase db push                                    # 009 + 010
npm run import-catalog -- --shop-id <uuid>          # idempotente: rellena lo nuevo
```

## Qué se construyó (todo verificado en local)

| Paso | Entregable | Verificación |
|---|---|---|
| 1 | Init + extensiones (`000`), estructura §12.1, `SHOPIFY_API_VERSION=2026-07` en constante única | extensiones instaladas tras `db reset` |
| 2 | `001_schema_base.sql`: 8 tablas con Decisión 2 (Vault `secret_id`s, sin token plano), `shops.status`, soft-delete, RLS deny-all | 13 tablas totales, `relrowsecurity=t`, anon 42501 |
| 3 | `002_eventos_api.sql`: `webhook_events` (unique idempotencia), `sync_events` (+`payload` que exige Decisión 5), `audit_log`, `api_consumers`, `api_request_log` | `db reset` limpio |
| 4 | `003_funciones_colas.sql`: `get_shop_credentials`, `apply_inventory_change` (advisory lock), colas pgmq + wrappers RPC service_role-only | `tests/smoke_fundacion.sql` verde; anon denegado vía PostgREST; re-apply idempotente |
| 5 | `004_onboarding.sql` + `src/services/onboarding.ts`: 6 requisitos §2.2 bloqueantes (location activa contra API), rotación = recuperación de `needs_reauth` | `tests/smoke_onboarding.sql` verde; typecheck OK |
| 6 | `005_ingesta_webhooks.sql` (persist+enqueue atómico) + Edge Function `webhook` (HMAC raw + `timingSafeEqual`) + registro §6.1 idempotente | `tests/test_receptor_webhooks.sh`: 4/4 verde |
| 7 | Edge Function `worker-sync` (pgmq vt=60, dead-letter read_ct>5) + handlers §7.1 + import §5 (`CatalogSource`, fase 2 por location, Bulk stub) + `006_cron_worker.sql` | `tests/test_worker_inbound.sh`: 100% verde |

**Checklist §13 marcado en local:** #8 (duplicado aplicado una vez) y #9 (HMAC malo
rechazado sin escribir). El resto exige tienda Shopify real conectada.

**Invariantes en pie:** inventario SOLO vía `apply_inventory_change`; secretos SOLO
en Vault (descifrado único: `get_shop_credentials`); 401/403 → `needs_reauth` sin
retry (`markShopNeedsReauth`); idempotencia por `unique(shop_id, shopify_event_id)`;
service_role solo server-side (deny-all verificado); HMAC constante sobre body crudo.

## Decisiones de implementación de esta sesión (dentro de la latitud de los docs)

1. IDs de Shopify: **numérico como texto en DB**; GID solo en frontera GraphQL (`src/services/gid.ts`).
2. Ingesta de webhooks **atómica** (fila + mensaje en una transacción, migración 005).
3. RLS **deny-all** (sin policies anon/authenticated + revoke): el acceso externo será el gateway (Decisión 6).
4. Re-onboarding = **rotación** (`vault.update_secret`, mismos secret_ids) + `status='active'`.
5. Órdenes espejo **sin tocar inventario** (Shopify emite su propio `inventory_levels/update`; evita doble descuento).
6. Worker: `processed_at` evita re-aplicar en redeliveries; handlers upsert + set absoluto ⇒ reproceso inocuo.
7. Handlers del worker viven junto a la Edge Function (bundling); mappers Node en `src/` (shapes distintos: REST vs GraphQL).
8. Puertos locales 55321+ (54xxx ocupados por otro proyecto local).
9. **Auth del worker por token dedicado** (`WORKER_SYNC_TOKEN`), no la service key:
   en el despliegue real, la `service_role` legacy que devuelve la API ≠ la
   `SUPABASE_SERVICE_ROLE_KEY` que el runtime inyecta (proyectos con keys
   nuevas `sb_secret_…`) y el cron recibía 401 silencioso del worker. El token
   propio vive en `supabase secrets set` + Vault (`worker_sync_token`) y
   desacopla la invocación interna del formato de keys de Supabase.

## NO construido aún (por diseño — BUILD ORDER)

- Outbound §7.2/§8 (`inventorySetQuantities` + `compareQuantity`, cola `inventory_out`).
- Reconciliación (Decisión 5, dos niveles) y cola `reconcile` (ya existe la cola).
- API gateway (Decisión 6; las tablas ya existen).
- `BulkCatalogSource` (§5.3) — interfaz lista, stub documentado.
- Canal real de alertas (hoy: `sync_events` + stderr) — PENDIENTES #5.
- Validación `available` vs `on_hand/committed` — PENDIENTES #1 (semana 1 con tienda dev).

## Despliegue cloud — EJECUTADO Y VALIDADO (2026-07-22)

Proyecto `fgrpclxpjciosvjzbefo` (org `ybjvneingmxwkrbvomqo`), CLI enlazada.

- Migraciones 000–006 aplicadas vía `db push` sobre base **verificada vacía**.
- Batería SQL remota: 4 extensiones, 13 tablas (13 con RLS), 3 colas, 8 funciones, cron activo.
- Edge Functions `webhook` y `worker-sync` desplegadas: GET→405, POST sin firma→401, worker sin token→401.
- Cron `drain-sync-jobs` (job 1, cada minuto) con `WORKER_SYNC_TOKEN` leído del Vault.
- **E2E real validado**: webhook firmado → 200, replay → dedupe, tick del cron →
  worker drenó → producto+variante creados, `processed_at` marcado, `sync_events`
  success, cola en 0. Datos de prueba limpiados después.
- Incidente encontrado y resuelto: 401 cron→worker por mismatch de formato de
  keys (decisión de implementación #9). El secreto Vault con la service key
  legacy fue eliminado; solo queda `worker_sync_token`.
- `.env.cloud` local (gitignored) con la URL + secret key del proyecto para
  correr los scripts contra el cloud: `cp .env.cloud .env` (volver a local:
  regenerar desde `supabase status -o env`).

## SIGUIENTE PASO EXACTO (próxima sesión)

1. **Alta de la tienda dev real** (valida los 6 requisitos §2.2 y bloquea si algo falla):
   ```bash
   cp .env.cloud .env
   SHOPIFY_ADMIN_TOKEN=shpat_... SHOPIFY_WEBHOOK_SECRET=... npm run onboard -- \
     --shop-domain <tienda>.myshopify.com --location-id <id> --artist-name "<Artista>"
   ```
2. **Import inicial**: `npm run import-catalog -- --shop-id <uuid>` (verifica completitud).
3. **Webhooks en vivo** (solo tras import — BUILD ORDER):
   `npm run register-webhooks -- --shop-id <uuid> --callback-url https://fgrpclxpjciosvjzbefo.supabase.co/functions/v1/webhook`
4. **Checklist §13** con la tienda real: #1–#4 y #7 (inbound); documentar PENDIENTES #1 y #3.
5. Con la tienda verde en inbound → **outbound §7.2/§8** (siguiente bloque del BUILD ORDER).

## Panel visual (ops)

`npm run panel -- --env .env.local` (o `.env.cloud`) → http://127.0.0.1:8787
Muestra tiendas, productos espejados con stock por variante, webhooks sin
procesar y últimos sync_events. Server-side rendered: service_role solo en el
proceso local, nunca en el navegador. La superficie para consumidores externos
sigue siendo el gateway (Decisión 6), pendiente por BUILD ORDER.
Env files (gitignored): `.env` activo · `.env.local` stack local · `.env.cloud`
producción (usa la key legacy JWT: el REST del proyecto rechaza las `sb_secret_…`).

## Cómo correr todo en local

```bash
supabase start                      # stack (puertos 55321+)
supabase db reset                   # aplica 000-006
docker exec -i supabase_db_StoreSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 < tests/smoke_fundacion.sql
docker exec -i supabase_db_StoreSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 < tests/smoke_onboarding.sql
docker exec -i supabase_db_StoreSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 < tests/seed_tienda_prueba.sql
supabase functions serve            # en otra terminal
bash tests/test_receptor_webhooks.sh
bash tests/test_worker_inbound.sh
npm run typecheck
```

Repo: https://github.com/brocha-art/StoreSync (main al día con los 7 pasos).
