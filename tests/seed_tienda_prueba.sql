-- Seed de tienda de prueba LOCAL para ejercitar receptor y worker (pasos 6-7).
-- Idempotente: si ya existe, rota credenciales al mismo valor conocido.
-- Client secret conocido SOLO para pruebas locales: whsec_prueba_1234567890
-- (firma webhooks Y mintearía el access_token — migración 007, Client
-- Credentials grant; no hay mint real aquí porque el dominio es ficticio).
--
-- Uso:
--   docker exec -i supabase_db_StoreSync psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < tests/seed_tienda_prueba.sql

do $$
declare
  v_artist uuid;
begin
  select id into v_artist from artists where name = 'Artista Prueba Local';
  if v_artist is null then
    insert into artists (name) values ('Artista Prueba Local') returning id into v_artist;
  end if;

  perform create_shop_with_secrets(
    v_artist,
    'prueba-local.myshopify.com',
    'client_id_prueba_local',
    'whsec_prueba_1234567890',
    '77777777777',
    true);
end $$;

select id as shop_id, shop_domain, status
from shops where shop_domain = 'prueba-local.myshopify.com';
