-- 025 — A quién avisarle cuando cambia el contrato del API.
--
-- `api_consumers` guardaba nombre, hash del key, tiendas habilitadas y rate
-- limit: todo lo necesario para AUTORIZAR a un consumidor, nada para HABLARLE.
--
-- Se notó al tener que avisar tres cambios del contrato en un mismo día
-- (021 catálogo vendible, 022 moneda y orden, 023/024 HTML sanitizado): el
-- único consumidor activo figura como `cliente-externo`, sin correo ni canal, y
-- hubo que salir a preguntar a quién escribirle. Un cambio de contrato sin a
-- quién avisar es un cambio que el consumidor descubre roto.
--
-- Se agrega también `notes` para dejar registro de por dónde se los contacta
-- cuando no es el correo (un canal de Slack compartido, un ticket, quien sea el
-- referente técnico).
--
-- Nullable a propósito: los consumidores que ya existen no se invalidan por no
-- tenerlo. El script de alta lo pide desde ahora.

alter table api_consumers add column if not exists contact_email text;
alter table api_consumers add column if not exists notes         text;

comment on column api_consumers.contact_email is
  'A quién avisarle cuando cambia el contrato del API. Sin esto, el consumidor se entera cuando algo se le rompe.';
comment on column api_consumers.notes is
  'Canal alternativo o referente técnico, cuando el correo no alcanza.';
