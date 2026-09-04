-- 020 — Lista blanca de operadores del panel.
--
-- El panel dejó de escuchar solo en 127.0.0.1: al hospedarlo, esa red deja de
-- ser la autenticación y hay que ponerle una de verdad. Se usa Supabase Auth
-- (email + contraseña), pero autenticarse NO alcanza: el registro público de
-- Supabase está abierto por defecto en cualquier proyecto, así que sin esta
-- tabla bastaría con crearse una cuenta para entrar a ver todo el catálogo.
--
-- Dos puertas, no una:
--   1. sesión válida de Supabase Auth
--   2. email presente y activo en esta tabla
--
-- El panel sigue usando service_role DENTRO del servidor (Decisión 3: RLS
-- deny-all, sin políticas para authenticated; el acceso externo es el gateway).
-- Esa clave nunca llega al navegador: el servidor entrega HTML ya renderizado.

create table if not exists panel_usuarios (
  email      text primary key,
  nombre     text,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table panel_usuarios is
  'Operadores autorizados a entrar al panel. Estar autenticado no basta (migración 020).';

alter table panel_usuarios enable row level security;
revoke all on panel_usuarios from anon, authenticated;
grant select, insert, update, delete on panel_usuarios to service_role;

-- El panel llama a esto en CADA request, con el email que trae la sesión ya
-- verificada. Devuelve false para un email desconocido o desactivado: la
-- dirección segura es negar.
create or replace function panel_tiene_acceso(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from panel_usuarios u
    where lower(u.email) = lower(btrim(coalesce(p_email, '')))
      and u.activo
  );
$$;

revoke all on function panel_tiene_acceso(text) from public, anon, authenticated;
grant execute on function panel_tiene_acceso(text) to service_role;
