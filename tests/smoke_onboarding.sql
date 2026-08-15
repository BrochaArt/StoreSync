-- Smoke del alta transaccional (paso 5). Transacción + rollback: no deja datos.
--
-- Uso:
--   docker exec -i supabase_db_StoreSync psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < tests/smoke_onboarding.sql
--
-- Esperado:
--   alta_nueva = t; client_id_v1_ok = t, secret_v1_ok = t
--   misma_tienda = t, fue_rotacion = t
--   volvio_a_active = t, secret_rotado = t, location_actualizada = t
--   secretos_sin_huerfanos = 1; audit_alta = 2

begin;

insert into artists (name) values ('Artista Alta') returning id as artist_id \gset

-- Alta nueva
select shop_id as sid, created as creado
from create_shop_with_secrets(:'artist_id', 'alta.myshopify.com', 'client_v1', 'secret_v1', '111', true) \gset

-- psql serializa booleans como t/f en variables \gset
select :'creado' = 't' as alta_nueva;

select (client_id = 'client_v1')     as client_id_v1_ok,
       (client_secret = 'secret_v1') as secret_v1_ok,
       location_id
from get_shop_credentials(:'sid');

-- Simular el invariante §10 (401/403 → needs_reauth) y recuperar por onboarding
update shops set status = 'needs_reauth' where id = :'sid';

select shop_id as sid2, created as creado2
from create_shop_with_secrets(:'artist_id', 'alta.myshopify.com', 'client_v2', 'secret_v2', '222', true) \gset

select (:'sid2' = :'sid') as misma_tienda,
       (:'creado2' = 'f') as fue_rotacion;

select (s.status = 'active')            as volvio_a_active,
       (g.client_secret = 'secret_v2')  as secret_rotado,
       (g.location_id = '222')          as location_actualizada
from shops s, get_shop_credentials(:'sid') g
where s.id = :'sid';

-- Rotación reutiliza el slot de Vault: sigue siendo exactamente 1 secreto
-- (migración 007: un solo client_secret, ya no access_token + webhook_secret)
select count(*) as secretos_sin_huerfanos
from vault.secrets where name like '%alta.myshopify.com';

select count(*) as audit_alta
from audit_log where entity = 'shop' and entity_id = :'sid';

rollback;
