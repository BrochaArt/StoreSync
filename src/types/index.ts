// Tipos compartidos entre servicios, workers y Edge Functions.

/**
 * Fila que devuelve get_shop_credentials (migración 007). Solo en memoria:
 * jamás loguear. client_secret firma los webhooks Y mintea el access_token
 * (Client Credentials grant — Shopify retiró las Custom Apps clásicas el
 * 1-ene-2026, ya no hay un access_token permanente que guardar).
 */
export interface ShopCredentials {
  shop_domain: string;
  client_id: string;
  client_secret: string;
  location_id: string;
}

/** Mensaje encolado en pgmq 'sync_jobs' por el receptor de webhooks (Decisión 4). */
export interface SyncJobMessage {
  webhook_event_id: string;
  shop_id: string;
  topic: string;
}
