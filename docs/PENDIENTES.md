# PENDIENTES — dudas de API marcadas para validar (no inventar)

> Regla de la sesión: si un detalle de la API de Shopify genera duda, se marca aquí
> en vez de asumir. Validar contra la tienda de desarrollo.

## 1. `inventorySetQuantities` con `name: "available"` vs `on_hand` / `committed`

⚠ VALIDACIÓN PENDIENTE de `DECISIONES_TECNICAS_SYNC.md` (primera semana, tienda dev):
crear un pedido **sin cumplir** en la tienda de desarrollo y verificar que escribir
`available` se comporta como se espera con cantidades comprometidas. Es el escenario
exacto de sobreventa silenciosa. Documentar el resultado aquí y en /docs.

## 2. Verificación de "inventory tracking confirmado ON" (requisito 5 de §2.2)

Shopify no tiene un toggle de tracking a nivel tienda: `tracked` vive por
`InventoryItem` (variante). Interpretación implementada en el onboarding: muestrear
las primeras variantes del catálogo vía GraphQL y exigir que al menos una tenga
`inventoryItem.tracked = true`; se registra la proporción. Confirmar con el cliente
si el criterio debe ser más estricto (p. ej. 100 % de variantes tracked).

## 3. Payloads de webhooks en `2026-07`

Las formas de payload usadas (p. ej. `inventory_levels/update` con
`inventory_item_id`, `location_id`, `available`) siguen el shape REST histórico de
Shopify. Mi conocimiento llega hasta enero 2026: verificar contra el primer webhook
real de la tienda dev que los campos no cambiaron en `2026-07`, antes de dar por
buenos los handlers.

## 4. Productos con más de 50 variantes

La query de import (guía §5.2) trae `variants(first: 50)` anidado. El import pagina
variantes adicionales por producto cuando `hasNextPage = true`, pero Shopify ahora
permite hasta 2000 variantes/producto: si aparece un catálogo así, medir costo de
rate limit y considerar pasar ese producto a Bulk Operations.

## 5b. `Product.images` vs `media` en el import

El import usa la conexión `images(first: 50)` de Product (además de
`featuredImage`, guía §5.2). Shopify empuja hacia `media` como camino nuevo:
verificar en el primer import real contra `2026-07` que `images` sigue
devolviendo todo (si un producto usa solo media/video, evaluar migrar la query
a `media(first:){ ... on MediaImage }`).

## 5. Alerta real para dead-letter y `needs_reauth` (§10 guía)

Hoy "alertar" = fila en `sync_events` (status `dead_letter`) + log. Falta decidir el
canal real de alerta (email/Slack/otro) — no cubierto por los documentos.

## 6. Frescura de `collections`, `metafields` y `category` (Decisión 7)

El payload REST de `products/update` no trae ninguno de los tres, así que el worker
no puede refrescarlos: solo los actualiza el import completo. Si el artista mueve un
producto de colección o edita un metafield, el gateway sigue sirviendo el valor viejo
hasta el próximo import. Decidir el mecanismo: re-import periódico por cron,
suscripción a `collections/update` (solo resuelve colecciones), o aceptar la deriva y
documentarla al consumidor.

## 7. Datos que el artista debe cargar en Shopify para que viajen estructurados

Consecuencia directa de la Decisión 7: tamaño, año y técnica de las obras solo existen
como texto en la descripción, así que no salen en `details`. Para exponerlos hay que
pedirle al artista que los cargue como metafields con definición (o como opción de
variante, si el producto tiene varias medidas). Es trabajo de configuración por tienda,
una sola vez, y a partir de ahí el mismo contrato lo entrega para todos los artistas.

## 8. Scope de fulfillment ausente en las apps de las tiendas

`FULFILLMENTS_UPDATE` no se puede registrar: las apps tienen 7 scopes (read/write de
products, inventory y orders, más read_locations) y ninguno de fulfillment. Pasa en las
dos tiendas dadas de alta, así que el handler de fulfillments del worker nunca se
ejecuta y `orders.fulfillment_status` no se actualiza por esa vía.

Impacto hoy: nulo para el consumidor, porque el gateway solo expone catálogo. Para
cerrarlo hay que pedirle a cada artista que agregue el scope a su app en el Dev
Dashboard y volver a correr `register-webhooks`. Decidir si vale la pena o si se saca
`FULFILLMENTS_UPDATE` de `WEBHOOK_TOPICS` mientras tanto, para que el registro no
reporte una falla esperada en cada alta.
