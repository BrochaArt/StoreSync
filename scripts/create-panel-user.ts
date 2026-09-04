// Crea un operador del panel: cuenta en Supabase Auth + entrada en la lista
// blanca (migración 020). Sin las dos cosas no entra — tener cuenta no basta.
//
// La contraseña viaja SOLO por variable de entorno, nunca como argumento: un
// argumento queda en el historial del shell y en la lista de procesos.
//
// Correrlo sobre una cuenta que ya existe RESTABLECE su contraseña, así que
// sirve igual para dar de alta y para recuperar el acceso de alguien.
//
// Uso:
//   PANEL_PASSWORD='...' npm run create-panel-user -- --email tu@correo.com --nombre "Tu Nombre"
//
// Para revocar el acceso de alguien, sin borrarle la cuenta:
//   update panel_usuarios set activo = false where email = '...';

import { parseArgs } from "node:util";
import { createServiceClient } from "../src/services/supabase.js";

try {
  process.loadEnvFile();
} catch {
  /* sin .env: las vars deben venir del entorno */
}

const { values } = parseArgs({
  options: { email: { type: "string" }, nombre: { type: "string" } },
});

const email = values.email?.trim().toLowerCase();
const nombre = values.nombre ?? null;
const password = process.env["PANEL_PASSWORD"];

if (!email || !password) {
  console.error(
    "Requiere --email y la variable PANEL_PASSWORD.\n" +
      "  PANEL_PASSWORD='...' npm run create-panel-user -- --email tu@correo.com",
  );
  process.exit(2);
}
if (password.length < 12) {
  // El panel queda expuesto a internet: una contraseña corta es la puerta más
  // barata de forzar que va a tener el sistema.
  console.error("La contraseña debe tener al menos 12 caracteres.");
  process.exit(2);
}

const supabase = createServiceClient();

// ── Cuenta en Supabase Auth ──────────────────────────────────────────────────
// email_confirm: no hay flujo de correo en el panel; el operador la crea a mano
// para alguien de su equipo, así que se da por confirmada.
const { data: creada, error: errCrear } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

let yaExistia = false;
if (errCrear) {
  const msg = errCrear.message.toLowerCase();
  if (!(msg.includes("already") || msg.includes("registered") || msg.includes("exists"))) {
    console.error(`✖ No se pudo crear la cuenta: ${errCrear.message}`);
    process.exit(1);
  }
  // Ya existía: se le fija la contraseña indicada. Correrlo de nuevo es la
  // forma de restablecerla cuando alguien la olvida.
  yaExistia = true;
  const { data: lista, error: errListar } = await supabase.auth.admin.listUsers();
  const usuario = lista?.users.find((u) => u.email?.toLowerCase() === email);
  if (errListar || !usuario) {
    console.error(`✖ La cuenta existe pero no se pudo ubicar: ${errListar?.message ?? "no encontrada"}`);
    process.exit(1);
  }
  const { error: errPass } = await supabase.auth.admin.updateUserById(usuario.id, { password });
  if (errPass) {
    console.error(`✖ No se pudo actualizar la contraseña: ${errPass.message}`);
    process.exit(1);
  }
  console.log(`= la cuenta ${email} ya existía — contraseña actualizada`);
} else {
  console.log(`✔ Cuenta creada en Supabase Auth: ${creada.user?.email}`);
}

// ── Lista blanca ─────────────────────────────────────────────────────────────
const { error: errLista } = await supabase
  .from("panel_usuarios")
  .upsert({ email, nombre, activo: true }, { onConflict: "email" });

if (errLista) {
  console.error(`✖ No se pudo autorizar en el panel: ${errLista.message}`);
  process.exit(1);
}

console.log(`✔ Autorizado en el panel: ${email}`);
if (!yaExistia) {
  console.log("  Correr esto de nuevo con otra PANEL_PASSWORD restablece la contraseña.");
}
