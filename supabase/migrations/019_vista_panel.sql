-- 019 — Vista de resumen por tienda para el panel de operación.
--
-- El panel mostraba solo tiendas y productos, y resolvía los conteos con un
-- bucle de una consulta por tienda. Al crecer a cuatro vistas (resumen, control
-- de artistas, productos y estado del alta) eso serían decenas de viajes por
-- carga. Se agrega todo en una vista: el panel hace UN select.
--
-- Es de solo lectura y no expone nada que el panel no muestre ya: ni
-- client_secret_id ni ninguna referencia a Vault. Como el resto del esquema,
-- queda revocada para anon/authenticated — solo service_role, server-side.

create or replace view panel_tiendas as
select
  s.id,
  s.shop_domain,
  s.status,
  s.location_id,
  s.created_at,
  s.last_refreshed_at,
  s.profile_synced_at,

  -- Perfil público del artista (lo que el consumidor recibe en shop.artist)
  a.name          as artista,
  s.shop_name,
  s.contact_email,
  s.website,
  s.bio,
  (s.bio is not null and length(btrim(s.bio)) > 0) as tiene_bio,

  -- Volumen del catálogo
  (select count(*) from products p
    where p.shop_id = s.id and p.deleted_at is null)                as productos,
  (select count(*) from products p
    where p.shop_id = s.id and p.deleted_at is not null)            as productos_borrados,
  (select count(*) from variants v
     join products p on p.id = v.product_id
    where p.shop_id = s.id)                                          as variantes,
  (select count(*) from product_images i
     join products p on p.id = i.product_id
    where p.shop_id = s.id)                                          as imagenes,
  (select count(*) from inventory_levels il
     join variants v on v.id = il.variant_id
     join products p on p.id = v.product_id
    where p.shop_id = s.id)                                          as inventarios,

  -- Variantes sin ninguna fila de inventario: llegan al consumidor sin stock
  (select count(*) from variants v
     join products p on p.id = v.product_id
    where p.shop_id = s.id
      and not exists (select 1 from inventory_levels il where il.variant_id = v.id))
                                                                     as variantes_sin_inventario,

  -- Cobertura de los diez atributos canónicos (Decisión 7b). Un solo barrido
  -- de products por tienda; lo que el artista no cargó cuenta 0, sin deducir.
  (select jsonb_build_object(
      'category',          count(*) filter (where metafield_valor(p.metafields, 'category')          is not null),
      'size',              count(*) filter (where metafield_valor(p.metafields, 'size')              is not null),
      'year',              count(*) filter (where metafield_valor(p.metafields, 'year')              is not null),
      'technique',         count(*) filter (where metafield_valor(p.metafields, 'technique')         is not null),
      'material',          count(*) filter (where metafield_valor(p.metafields, 'material')          is not null),
      'paper_type',        count(*) filter (where metafield_valor(p.metafields, 'paper_type')        is not null),
      'additional_info',   count(*) filter (where metafield_valor(p.metafields, 'additional_info')   is not null),
      'nft_link',          count(*) filter (where metafield_valor(p.metafields, 'nft_link')          is not null),
      'shipping',          count(*) filter (where metafield_valor(p.metafields, 'shipping')          is not null),
      'about_the_artwork', count(*) filter (where metafield_valor(p.metafields, 'about_the_artwork') is not null))
     from products p where p.shop_id = s.id and p.deleted_at is null) as atributos,

  -- Salud de la ingesta. El registro de webhooks vive en Shopify, no acá: lo
  -- más cerca que podemos estar de "están activos" es cuándo llegó el último.
  (select max(w.received_at) from webhook_events w where w.shop_id = s.id)
                                                                     as ultimo_webhook,
  (select count(*) from webhook_events w
    where w.shop_id = s.id and w.processed_at is null)               as webhooks_sin_procesar,
  (select count(*) from sync_events e
    where e.shop_id = s.id and e.status in ('failed', 'dead_letter')
      and e.created_at > now() - interval '24 hours')                as fallas_24h,

  -- Visibilidad ante el API: sin esto la tienda queda sincronizada e invisible
  (select coalesce(array_agg(c.name order by c.name), '{}')
     from api_consumers c
    where c.active and s.id = any(c.allowed_shop_ids))               as consumidores

from shops s
join artists a on a.id = s.artist_id;

comment on view panel_tiendas is
  'Resumen por tienda para el panel de operación (migración 019). Solo lectura.';

revoke all on panel_tiendas from public, anon, authenticated;
grant select on panel_tiendas to service_role;
