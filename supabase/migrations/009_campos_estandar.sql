-- 009 — Campos ESTÁNDAR de Shopify que el catálogo no guardaba.
--
-- Regla de diseño: el gateway sirve a varios artistas con UN solo contrato, así
-- que aquí solo entran campos que existen igual en cualquier tienda Shopify.
-- Nada de mapear "Posters"→réplica ni de parsear la descripción: esas son
-- convenciones de UNA tienda y romperían al siguiente artista en silencio.
-- Lo que Shopify no tenga estructurado, se devuelve null/vacío — no se infiere.
--
-- Se guarda crudo lo que Shopify da crudo (product_type, tags, collections):
-- interpretarlo es trabajo del consumidor, no nuestro.

-- ── Producto ─────────────────────────────────────────────────────────────────
-- taxonomy_category: taxonomía global de Shopify, ya normalizada
--   {"id","name","full_name"} — null si la tienda no la asignó.
-- collections/metafields: se pasan tal cual. NO llegan en el payload de los
--   webhooks REST (products/update), así que solo el import inicial los
--   refresca; el upsert del worker omite estas columnas para no borrarlas.
alter table products
  add column if not exists vendor            text,
  add column if not exists product_type      text,
  add column if not exists tags              text[] not null default '{}',
  add column if not exists taxonomy_category jsonb,
  add column if not exists collections       jsonb  not null default '[]'::jsonb,
  add column if not exists metafields        jsonb  not null default '[]'::jsonb;

-- ── Variante ─────────────────────────────────────────────────────────────────
-- options: [{"name":"Size","value":"50 x 70"}] — para catálogos donde el tamaño
-- es opción de variante (un producto con varias medidas), el único lugar
-- estándar donde ese dato existe. Se guarda tal cual lo escribió el artista:
-- normalizar "30x 40" a "30cm x 40cm" sería inventar una unidad que no está.
alter table variants
  add column if not exists title   text,
  add column if not exists options jsonb not null default '[]'::jsonb;

-- ── Perfil del artista (viene de shop { }, estándar en toda tienda) ──────────
-- artists.name la fija el operador en el onboarding y manda sobre shop_name:
-- shop.name suele ser la marca ("Demo Art Studio"), no la persona.
-- metafield_definitions: {"custom.shipping": "Shipping", ...} — la etiqueta
-- legible que el artista le puso a cada metafield en SU Shopify. Es lo que
-- permite exponer los detalles con nombre sin hardcodear ninguno.
alter table shops
  add column if not exists shop_name             text,
  add column if not exists contact_email         text,
  add column if not exists website               text,
  add column if not exists bio                   text,
  add column if not exists metafield_definitions jsonb not null default '{}'::jsonb,
  add column if not exists profile_synced_at     timestamptz;
