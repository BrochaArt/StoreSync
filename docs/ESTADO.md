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

**`014` — los atributos suben al nivel del producto:** hasta la 013 lo extraído
viajaba solo dentro de `details[]`, o sea que para leer el tamaño había que recorrer
un arreglo buscando la clave. Ahora `size`, `year`, `technique`, `material`,
`paper_type`, `additional_info` y `nft_link` son campos propios (`producto.size`),
alimentados por `custom.<clave>` según la convención publicada. `details[]` se
mantiene completo —incluidos esos y `category`, cuya excepción se eliminó— porque es
la forma que pidió el consumidor para pintar la ficha. Con valor sobre 205 productos:
category 205, información adicional 109, tamaño 103, técnica 103, tipo de papel 73,
año 66, material 36, enlace NFT 18.

`custom.material` se borró de los 73 posters (`metafieldsDelete`): el valor era el
texto de marketing que la artista había archivado bajo esa etiqueta ("This art print
displays sharp, vivid images…"), no un material. Queda solo en los 36 canvas, donde
dice "Stretched canvas print". Los posters conservan `paper_type` y `additional_info`,
que sí son correctos.

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

## Los dos datos que faltaban en la ficha (2026-08-20)

El consumidor reportó que en la ficha del producto faltaban el texto "About the
artwork" y la nota "Worldwide free shipping". Cada uno faltaba por una razón distinta.

**`about_the_artwork` sí se entregaba, pero ilegible.** Shopify guarda los
`rich_text_field` como un árbol JSON, no como HTML, y ese blob viajaba crudo dentro de
`details[]`. La 015 agrega `rich_text_plano` —recorre el árbol y devuelve texto, y si
el valor no es JSON lo devuelve intacto, así que es seguro sobre cualquier metafield—.
La 016 lo conecta al contrato de dos formas: `details[].value_text` (siempre legible,
para rich text el árbol aplanado y para el resto el mismo `value`) y
`about_the_artwork` como campo propio del producto. `value` crudo se conserva.

**La nota de envío no existía como dato:** vivía suelta en la prosa de la descripción.
Backfill de 102 metafields `custom.shipping`, respetando la distinción que hacía la
artista: 66 obras dicen "Worldwide free shipping" y 36 dicen "Worldwide shipping", sin
el "free". Los 73 productos que YA tenían `custom.shipping` con texto propio del
artista ("We dispatch all orders within 2-5 business days") se saltaron sin tocarlos.
30 productos no tienen frase de envío.

Cobertura tras reimportar, sobre 205: category 205, shipping 175, tamaño 103,
técnica 103, about_the_artwork 66, año 66.

Nota de operación: `api_get_catalog` no se puede ejecutar desde el MCP de Supabase
—devuelve 42501— porque el `grant execute` es solo para `service_role`. Es el
comportamiento correcto; para verificarla hay que ir por un cliente service_role.

## Segunda tienda dada de alta (2026-08-19)

Alta + import completos con el mismo pipeline, sin una línea de código específica:
183 productos (Shopify reporta 183), 583 variantes, 748 imágenes, 495 niveles de
inventario. 88 variantes quedaron sin nivel en la location primaria y el import las
reporta en vez de inventarles un número.

**La location se eligió midiendo, no por el nombre.** La tienda tiene dos activas y la
que parecía la principal por su nombre no tenía un solo nivel de inventario; toda la
existencia estaba en la otra. `list-locations` ahora muestrea 50 variantes y consulta
el `available` en cada location para decidirlo — elegir mal habría importado el
catálogo completo con todo en cero, sin fallar en ninguna parte.

**Los ocho atributos canónicos salen en cero:** ese artista no tiene metafields
cargados. Lo que sí sirve de entrada es `product_type` (Print 91 · Ceramic 29 ·
Resin sculpture 24 · 39 vacíos), que va crudo al consumidor. Confirma el diseño de la
Decisión 7b: el contrato es idéntico y lo que no esté cargado sale null, sin que nadie
toque el pipeline.

**Su inventario no es stock real.** 462 de 583 variantes no tienen tracking. De las 121
que sí, la mediana es 9999 y son camisetas en tallas S–5XL: el placeholder de
"ilimitado" del print-on-demand. En esa tienda `available` no se puede leer como
unidades disponibles, al revés que en la primera. Hay que advertírselo al consumidor.

**Webhooks: 7 de 8 topics registrados.** `FULFILLMENTS_UPDATE` falla con "You cannot
create a webhook subscription with the specified topic" porque la app no tiene ningún
scope de fulfillment — y les pasa a LAS DOS tiendas, que comparten los mismos 7 scopes
(read/write de products, inventory, orders + read_locations). Ver PENDIENTES #8.

**La primera tienda no tenía webhooks registrados** — ese paso nunca se había
corrido desde julio, así que su catálogo solo se refrescaba con imports manuales. Se
registraron los mismos 7 topics el 2026-08-19. Ahora las dos tiendas están en vivo.

**Cadena de ingesta verificada de punta a punta menos el último eslabón:** el cron
`drain-sync-jobs` está activo cada minuto, 120/120 corridas exitosas en las últimas dos
horas, y —lo que de verdad importa— `net._http_response` muestra 200 en las 120, con
`{"drenados":0,"procesados":0,"fallidos":0,"dead_letter":0}`. Vale la pena mirar esa
tabla y no solo `cron.job_run_details`: pg_net es asíncrono, así que el cron reporta
"succeeded" con solo encolar el POST, y un worker devolviendo 401 se vería igual de
sano desde ahí.

Lo único sin probar es la llegada de un webhook real: `webhook_events` sigue en 0 filas.
Hasta que llegue el primero, PENDIENTES #3 —la forma de los payloads REST en 2026-07—
no se puede cerrar.

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

## Refresco periódico de collections/metafields/taxonomía (2026-09-04)

Cierra PENDIENTES #6. `refresh-catalog` (Edge Function) + `018_refresh_catalogo.sql`,
agendada cada 15 min como `refresh-catalogo`.

| Pieza | Qué hace |
|---|---|
| `shops.last_refreshed_at` | marca para elegir la tienda más rancia |
| `shop_a_refrescar()` | devuelve UNA tienda `active`, la de refresco más antiguo |
| `refresh_catalog_metadata(shop_id, items)` | un solo UPDATE por lote; ignora productos que no tenemos y estampa `last_refreshed_at` |
| `schedule_refresh_cron(url, secreto, schedule)` | agendado idempotente, mismo patrón que la 006 |

Decisiones que vale la pena no re-litigar:

- **Radio angosto a propósito.** Reescribe solo las tres columnas que no viajan en el
  webhook REST. No crea ni borra productos: eso duplicaría a medias la lógica de
  `products/create` / `products/delete`.
- **Una tienda por corrida.** El trabajo por invocación no crece con la cantidad de
  artistas; con N tiendas cada una se refresca cada N×15 min. Tope de 60 páginas
  (3000 productos) y la respuesta trae `truncado` si se alcanzó.
- **Reutiliza `worker_sync_token`.** El invocador es el mismo (pg_cron sobre esta base) y
  la frontera de confianza es idéntica; un secreto aparte solo agregaría un paso de
  despliegue.
- **No reescribe si nada cambió** (`is distinct from`): las corridas normales reportan 0
  actualizados en vez de tocar 205 filas.

**El bundler de Edge Functions SÍ sigue imports fuera de la carpeta de la función.** El
deploy subió `supabase/functions/refresh-catalog/index.ts` y `src/config/shopify.ts`
juntos, así que la versión de API se importa de la fuente única (Decisión 1) en vez de
duplicarse. Corrige el supuesto que había detrás de la decisión de implementación #7.

Verificación en producción: rotación automática entre las dos tiendas, HTTP 200 real en
`net._http_response` —no solo `cron.job_run_details`, por la lección del 401 silencioso—
y la prueba de fondo: se metió deriva a mano en un producto (colecciones falsas,
metafields vacíos, taxonomía nula) y la corrida siguiente reportó exactamente 1
actualizado, restaurando 4 colecciones, 9 metafields y la taxonomía.

## No se normalizan los atributos entre artistas — decidido (2026-09-02)

**El consumidor muestra cada artista por separado**, no una vitrina común. Con eso se
cae la razón de ser de normalizar: `product_type` crudo (`Print`, `Ceramic`,
`Resin sculpture`) pinta un perfil individual igual de bien que una `category` traducida.

Se descartó, entonces, todo esto que estaba planeado y a medio construir:

- El mapa `product_type` → `category` por tienda, con su tabla de reglas y su script.
- La derivación de `technique` y `year` desde la prosa de las descripciones.
- Empujar las 10 definiciones canónicas a la tienda de un artista que no las va a llenar.

Queda en el repo `scripts/create-metafield-definitions.ts` (con
`src/services/metafield-definitions.ts` y su GraphQL): crea en la tienda del artista las
definiciones `custom.*` que le falten, idempotente y en modo plan por defecto —hay que
pasar `--aplicar` para que escriba—. No se ejecutó contra ninguna tienda. Sirve el día
que un artista sí quiera cargar sus atributos.

### Por qué derivar era mala idea, con evidencia del catálogo real

Medido sobre las 183 obras de la segunda tienda:

| campo | derivable | problema |
|---|---|---|
| `category` | sí, desde `product_type` (144/183) | ninguno técnico: solo faltaba la decisión de negocio |
| `technique` | 160/183 mencionan una técnica | **68 mencionan más de una** ("grabado … en técnica giclee"): 43 % sería moneda al aire |
| `year` | 68/183 traen un año | **24 traen más de uno**, y hay falsos positivos demostrables |

El caso que cierra la discusión de `year`:

> "La esfera de nieve en **Ciudadano Kane (1941)** es uno de los símbolos más icónicos…"

Ese 1941 es el año de la película, no de la obra. Derivarlo habría publicado una fecha
falsa en el perfil público de un artista. Un campo vacío se ve incompleto; un dato
inventado se ve creíble y está mal — y sobre obra ajena, eso no es un bug cosmético.

### Lo que sí se sostiene como contrato

Cada artista entrega **lo suyo, con su propio vocabulario**: `details` con sus etiquetas,
`product_type`, `tags`, `collections`, opciones de variante y `description_text`. Lo que
no tenga viaja con la clave presente y valor `null` (verificado: las 10 canónicas salen
siempre, incluso en la tienda que no cargó ninguna). La uniformidad está en el
**mecanismo**, no en la lista de campos: los artistas venden cosas distintas y forzar un
esquema común obligaría a inventar datos.

Vocabularios reales, para dimensionar por qué un mapa global era imposible:

    Tienda A  product_type:  Neo Ancestral · Obra
    Tienda B  product_type:  Print · Ceramic · Resin sculpture

### Entregado al consumidor

`docs/api-gateway-handoff.md` (gitignored: lleva la API key) advierte las tres cosas que
condicionan su UI, todas medidas y no supuestas:

1. Los campos de `shop.artist` pueden venir `null` — una de las dos tiendas no tiene
   `bio`, y se decidió entregar el perfil así en vez de perseguir al artista.
2. `details` varía radicalmente entre artistas (100 % de las obras en una tienda, 0 % en
   la otra) y eso no va a cambiar.
3. Una opción de variante puede empacar dos dimensiones en un valor
   (`"A4 / Con Marco"`). El precio cambia con cada combinación —verificado en 103 de 103
   productos—, así que la variante es la unidad de compra correcta, pero quien quiera
   selectores separados de tamaño y marco tendrá que partir el string.

## details: lista blanca por namespace `custom` (2026-09-02)

El filtro de `details` era una lista negra (`global`, `shopify`, `shopify--%`), así que
entregaba al consumidor los metafields de las apps instaladas por el artista. Medido
sobre la tienda de Rafael: 11 productos servían `zipifypages.config`,
`productpagedata`, `headercontent`, `footercontent`, `btnpopups`, `stylesversion`,
`productpagescripts`, más `mc-facebook` y `mm-google-shopping` — configuración interna
de un page builder y de feeds de marketing, cero atributos reales.

`017_details_solo_custom.sql` cambia el filtro a lista blanca por `custom`, el namespace
donde Shopify guarda lo que define el comerciante. La forma importa más que el caso
puntual: con lista negra, cada app que instale cualquier artista abre un agujero nuevo
que hay que descubrir a mano.

Medición previa que respalda el corte — ningún falso positivo ni negativo:

| tienda | namespaces presentes |
|---|---|
| Sara | `custom` (16 claves, 1058 apariciones) + `global` (SEO, ya excluido) |
| Rafael | `zipifypages`(7) + `mc-facebook`(1) + `mm-google-shopping`(1) + `global`(2) — **ningún `custom`** |

Verificado contra el endpoint tras aplicar: Sara conserva sus 15 claves íntegras; Rafael
queda con `details: []`, que es la verdad —no cargó atributos—. Los campos canónicos al
nivel del producto no se tocaron: ya leían `custom.<clave>` explícitamente.

**Documentado para el consumidor** en `docs/api-gateway-handoff.md`, sección "Qué hacer
cuando los atributos vienen vacíos": integrar en cascada (campo canónico → opciones de
variante → `product_type` → `description_text`), con la advertencia de que los nombres
de opción no están normalizados ni siquiera dentro de una misma tienda (en la de Rafael
conviven `TAMAÑO`, `Talla` y `Size`, y `Marco`/`MARCO`).

## Inventario por TODAS las locations, no solo la primaria (2026-09-02)

El import pedía `inventoryLevel(locationId:)` de la location primaria y nada más. En la
tienda de Rafael eso dejaba **88 de 583 variantes sin una sola fila de inventario**: el
import las reportaba como advertencia y el consumidor las recibía con `inventory: []`,
indistinguibles de agotadas.

**Dónde estaba el stock: en una location llamada "Printful"** que la consulta
`locations` de Shopify **no devuelve** — los servicios de fulfillment tienen su propia
location oculta. Por eso `list-locations`, que iteraba la lista de locations para medir,
era estructuralmente incapaz de verla.

Cambios (typecheck limpio, ambas tiendas reimportadas y verificadas contra el endpoint):

| Archivo | Cambio |
|---|---|
| `products.query.ts` | `INVENTORY_BATCH_QUERY`: `inventoryLevel(locationId:)` → `inventoryLevels(first:$levels)` con `location{id name}` y `pageInfo` |
| `catalog-import.ts` | Fase 2 escribe una fila por (variante, location). Lote 100→50 (la query pide hasta 20 niveles por item, sube el costo). Advierte si un item tiene más locations que el tope, y si no tiene `available` en ninguna |
| `list-locations.ts` | Mide agrupando por la location que responde, en una sola llamada, en vez de iterar `locations`. Marca las que no aparecen listadas como *fulfillment service* |

No hubo que tocar el gateway (`api_get_catalog` ya agregaba todas las filas por variante
sin filtrar location) ni el worker (el handler de `inventory_levels/update` ya escribía a
la location que trae el payload).

Resultado — Rafael: 495 → **583 filas, cobertura 100 %, cero advertencias**. 495 en la
primaria (stock real, rango -3 a 4) y 88 en Printful (9998-9999, el "ilimitado" del
print-on-demand). Ninguna variante quedó en dos locations. Sara: sin cambios (278/278),
tiene una sola location.

**Para el consumidor:** `inventory` ya podía traer varias entradas por diseño y ahora de
verdad las trae. Un `available` de 9999 es el placeholder de print-on-demand, no
existencias contadas — la advertencia de la Decisión 7b sobre no leer `available` como
unidades sigue vigente para esa tienda.

## Alta de un artista nuevo — runbook vigente

Probado en dos tiendas (Sara Alarcón, Rafael Lanfranco) sin una línea de código
específica por artista. Todo corre contra cloud: `cp .env.cloud .env`.

### Regla dura: una app POR TIENDA, creada dentro del admin del artista

El Client Credentials grant solo funciona si la app y la tienda pertenecen a la misma
organización de Shopify. Las dos tiendas activas lo cumplen porque **cada una tiene su
propia app** creada dentro de su propio admin — sus `client_id` son distintos entre sí, o sea que no comparten una app central.

Crear UNA app en la organización propia (Dev Dashboard) y apuntarla a la tienda de un
artista **no funciona**: Shopify responde `shop_not_permitted` aunque la app esté
instalada y la tienda tenga plan pagado. Pasó con la tercera tienda (2026-09) y costó
varias horas de diagnóstico — el error es el mismo para "app no instalada", así que
despista. Consecuencia de diseño: **no** hace falta implementar Authorization Code
grant; el patrón una-app-por-tienda cubre tiendas independientes de artistas.

**Paso 0 — del lado de Shopify (lo hace el artista).** Ver
`docs/conectar-tienda-shopify.md`, que es el documento para reenviarle. Tres requisitos
que bloquean todo lo demás si faltan:
- App creada con **distribución personalizada** (una app pública queda "en revisión" y
  no se puede instalar).
- App **instalada** — el contador "Instalaciones" del Dev Dashboard debe decir ≥1.
  Sin esto el mint responde `shop_not_permitted`.
- La tienda en un **plan pagado activo**. El Client Credentials grant no funciona en
  tiendas en trial: mismo error `shop_not_permitted` aunque la app esté bien instalada.

```bash
# 1. Validar credenciales antes de tocar nada (no imprime el secret ni el token)
export SHOP_DOMAIN=<tienda>.myshopify.com
export SHOPIFY_CLIENT_ID=...   SHOPIFY_CLIENT_SECRET=...
bash scripts/test-mint.sh

# 2. Alta. Con --location-id 000 el alta se bloquea sin escribir nada y lista las
#    locations reales; repetir con la correcta. Ver también `npm run list-locations`,
#    que mide inventario por location (elegir por nombre ya salió mal una vez).
npm run onboard -- --shop-domain <tienda>.myshopify.com --location-id 000 \
  --artist-name "<Artista>"        # o --artist-id <uuid> si el artista ya existe

# 3. Import inicial (idempotente; revisar advertencias y completitud)
npm run import-catalog -- --shop-id <uuid>

# 4. Webhooks en vivo — solo DESPUÉS del import (BUILD ORDER)
npm run register-webhooks -- --shop-id <uuid> \
  --callback-url https://fgrpclxpjciosvjzbefo.supabase.co/functions/v1/webhook
#    FULFILLMENTS_UPDATE falla de forma esperada: falta el scope (PENDIENTES #8)

# 5. Exponer la tienda al consumidor del API — SIN ESTO QUEDA INVISIBLE
npm run add-shop-to-consumer -- --consumer <nombre> --shop-id <uuid>
```

**El paso 5 es el que se olvida en silencio.** El gateway valida `shop_id` contra
`allowed_shop_ids` (Decisión 6): sin autorizar, la tienda queda perfectamente
sincronizada y el consumidor recibe 403. Le pasó a la tienda de Rafael, que estuvo
sincronizada e invisible desde el 2026-08-19 hasta que se detectó.

Al terminar: **checklist §13** con la tienda real (#1–#4 y #7 inbound) y documentar
PENDIENTES #1 y #3.

## Panel visual (ops)

`npm run panel -- --env .env.local` (o `.env.cloud`) → http://127.0.0.1:8787
Muestra tiendas, productos espejados con stock por variante, webhooks sin
procesar y últimos sync_events. Server-side rendered: service_role solo en el
proceso local, nunca en el navegador. La superficie para consumidores externos
sigue siendo el gateway (Decisión 6), pendiente por BUILD ORDER.
Env files (gitignored): `.env` activo · `.env.local` stack local · `.env.cloud`
producción (usa la key legacy JWT: el REST del proyecto rechaza las `sb_secret_…`,
verificado en producción el 2026-09-04 — ver esa sección antes de intentar rotar).

## El panel vive en el equipo personal, no en BOSS (2026-09-04)

El proyecto de Vercel estaba creado bajo el equipo `bosstechnology`, así que la
`service_role` de Brocha quedaba guardada como variable de entorno de un equipo
ajeno al proyecto. Se rehízo el despliegue en `henry-garzons-projects` y se
borró el proyecto de BOSS, que se llevó la variable con él.

| Pieza | Valor |
|---|---|
| Equipo | `henry-garzons-projects` |
| Proyecto | `storesync-panel` |
| Dominio | `panel.brocha.art` |
| DNS | `A panel → 76.76.21.21` en 101domain (nameservers `ns1/ns2.101domain.com`) |
| Certificado | Let's Encrypt, automático (~75 s tras crear el registro) |
| Protección | `all_except_custom_domains` |

`all_except_custom_domains` es deliberado: la URL `.vercel.app` queda detrás del
SSO de Vercel (solo el dueño de la cuenta) y `panel.brocha.art` queda pública
con el login de Supabase como única puerta. Verificado desde el dominio: `/login`
200, `/` sin sesión 302 → `/login`, y POST con credenciales falsas 401
"Credenciales incorrectas" (o sea, llega a Supabase y rechaza).

### Pendiente: rotar la `service_role`

La key estuvo guardada en un proyecto del equipo equivocado. Aunque ese proyecto
ya no existe, una credencial que vivió donde no debía se rota.

No hacerlo por el camino legacy: rotar una `service_role` JWT rota el *JWT
secret* del proyecto e invalida **todas** las keys legacy de golpe —también la
`anon`— más las sesiones abiertas. El camino limpio es crear una `sb_secret_…`
nueva, cambiarla en Vercel, redesplegar y recién ahí revocar la legacy. Los
`grant execute … to service_role` de las migraciones siguen valiendo: las secret
keys nuevas mapean al mismo rol de Postgres.

Antes de revocar hay que actualizar también `.env`, `.env.local` y `.env.cloud`,
o los scripts de operador (`onboard`, `import-catalog`, `register-webhooks`,
`panel`) dejan de andar. El worker no se ve afectado: usa `WORKER_SYNC_TOKEN`
(decisión #9).

### Las `sb_secret_…` NO sirven en este proyecto — verificado a los golpes

Esta sección afirmó primero lo contrario. Estaba mal y costó una caída del login;
queda escrito para que nadie lo repita.

Lo que se probó y falló: se creó una secret key nueva, se cargó como
`SUPABASE_SERVICE_ROLE_KEY` en Vercel y se redesplegó. Al entrar al panel, el RPC
`panel_tiene_acceso` devolvió **`Invalid API key`** y el login quedó inutilizable.
Se volvió a la legacy.

El error de razonamiento: se probó una `sb_publishable_…` contra `/rest/v1/` y,
al ver que era aceptada, se generalizó a las secret. No se sostiene — los dos
formatos se resuelven por caminos distintos:

| Key | Contra `/rest/v1/` |
|---|---|
| `anon` legacy (JWT) | aceptada → rol `anon` → `42501` por RLS |
| `sb_publishable_…` | aceptada → rol `anon` → `42501` por RLS |
| `sb_secret_…` | **rechazada** → `Invalid API key` |
| `service_role` legacy (JWT) | aceptada → rol `service_role` |

Sí vale la pena conservar la distinción de diagnóstico, que sigue siendo cierta:
**`42501` viaja como HTTP 401** y se lee igual que "key inválida", pero no lo es.
Al depurar un 401 de PostgREST hay que leer el `code` del cuerpo: `42501` es RLS
—la key entró bien—, mientras que `Invalid API key` sí es la credencial.

Y el detalle que hizo el fallo difícil de leer: `tieneAcceso`
(`src/panel/auth.ts`) atrapa el error del RPC y devuelve `false`. Con una
`service_role` inválida el panel no dice "key mala", dice **"Esta cuenta no está
autorizada para el panel"**. Si aparece ese mensaje sin haber tocado
`panel_usuarios`, sospechar de la key antes que de la cuenta.

Conclusión operativa: **la rotación por keys nuevas está bloqueada** hasta
entender por qué el proyecto rechaza las secret. La `service_role` legacy sigue
siendo la única que funciona, y sigue pendiente de rotar — por ahora solo por la
vía legacy, que invalida todas las keys legacy de golpe y necesita ventana.

## El API entrega solo lo vendible (2026-09-08)

Migración 021. Hasta acá `api_get_catalog` filtraba una sola cosa —
`deleted_at is null`— y todo lo demás salía. Medido antes del cambio, sobre 388
productos vivos:

| | antes | ahora |
|---|---|---|
| Productos | 388 | **134** |
| Variantes | — | **300** |
| `status = archived` | 74 | 0 |
| `status = draft` | 44 | 0 |
| Activos sin stock vendible | 137 | 0 |

Es un recorte del 65%, y es el número correcto: lo que salía antes no era un
catálogo, era todo lo que había en la base. El consumidor estaba recibiendo obras
archivadas por el artista, borradores que nunca se publicaron y piezas vendidas.

Tres filtros nuevos:

1. `p.status = 'active'` — archived y draft afuera. Efecto útil: archivar una
   obra desde el admin de Shopify ahora la retira del API sin tocar nada acá.
2. Variante vendible = `sum(available) > 0` sobre sus `inventory_levels`, aplicado
   en dos lugares: para decidir qué productos entran y para podar las variantes
   agotadas de los productos que sí entran.
3. `s.status = 'active'` en la tienda. No estaba, y era un agujero: desactivar
   una tienda no le cortaba el catálogo al consumidor.

### Por qué `> 0` y no `<> 0`

Porque **35 productos activos tienen inventario negativo**, hasta `-8`. Son
sobreventas de Shopify. Con `<> 0` esos 35 seguirían saliendo como disponibles,
que es exactamente el error que la migración viene a cerrar. Una variante sin
ninguna fila de inventario también cuenta como no vendible (`coalesce` a 0): no se
anuncia lo que no se pudo confirmar, y el panel ya vigila ese caso con
`variantes_sin_inventario` (migración 019).

### Lo que NO se filtra, a propósito

Dentro de una variante vendible, las filas de `inventory` por ubicación se
entregan completas, incluidas las que están en 0. El consumidor necesita saber
que una ubicación no tiene stock; ocultarlas le rompe la contabilidad por
location (migración 015).

La forma del JSON no cambia. `status` sigue en el payload aunque ahora sea siempre
`active`: sacarlo rompería a quien ya lo lee.

### El registro de migraciones está desincronizado

Encontrado al aplicar la 021: `supabase_migrations.schema_migrations` llega hasta
la **016**, pero 017–020 sí están aplicadas —se verificó que la función en
producción tiene la lista blanca de 017, y el panel de 019/020 funciona—. Alguien
las aplicó por fuera del CLI. La 021 quedó registrada, así que el hueco es
017–020. No rompe nada hoy, pero un `supabase db push` sobre un entorno limpio se
comportaría raro. Conviene reconciliar el registro antes del próximo despliegue
que dependa de él.

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
