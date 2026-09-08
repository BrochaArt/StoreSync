// Elimina un operador del panel: entrada en la lista blanca (migración 020) +
// cuenta en Supabase Auth. Es la contraparte de create-panel-user.
//
// Para quitarle el acceso a alguien SIN borrarle la cuenta —lo habitual cuando
// una persona deja el equipo pero se quiere conservar el rastro— no hace falta
// este script:
//   update panel_usuarios set activo = false where email = '...';
// Esto de acá es para borrar de verdad: una cuenta creada por error, una
// dirección de prueba que se coló.
//
// Pide --confirmar a propósito. Este script nació porque un correo de ejemplo
// copiado tal cual creó una cuenta real en producción; un borrado sin guarda
// repetiría la clase de accidente en el sentido contrario, que es peor.
//
// Uso:
//   npm run delete-panel-user -- --email correo@ejemplo.com --confirmar

import { parseArgs } from "node:util";
import { createServiceClient } from "../src/services/supabase.js";

try {
  process.loadEnvFile();
} catch {
  /* sin .env: las vars deben venir del entorno */
}

const { values } = parseArgs({
  options: { email: { type: "string" }, confirmar: { type: "boolean" } },
});

const email = values.email?.trim().toLowerCase();

if (!email) {
  console.error(
    "Requiere --email.\n" + "  npm run delete-panel-user -- --email correo@ejemplo.com --confirmar",
  );
  process.exit(2);
}

const supabase = createServiceClient();

// ── Qué se va a borrar ───────────────────────────────────────────────────────
// Se muestra ANTES de tocar nada: sin --confirmar el script no escribe.
const { data: fila } = await supabase
  .from("panel_usuarios")
  .select("email, nombre, activo")
  .eq("email", email)
  .maybeSingle();

const { data: lista, error: errListar } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (errListar) {
  console.error(`✖ No se pudo consultar Supabase Auth: ${errListar.message}`);
  process.exit(1);
}
const cuenta = lista.users.find((u) => u.email?.toLowerCase() === email);

if (!fila && !cuenta) {
  console.log(`= ${email} no está ni en la lista blanca ni en Auth — nada que borrar`);
  process.exit(0);
}

console.log(`Se va a borrar ${email}:`);
console.log(
  fila
    ? `  · lista blanca — nombre: ${fila.nombre ?? "(sin nombre)"}, activo: ${fila.activo}`
    : "  · lista blanca — no figura",
);
console.log(cuenta ? `  · cuenta de Auth — creada ${cuenta.created_at}` : "  · cuenta de Auth — no figura");

if (!values.confirmar) {
  console.error("\nNo se borró nada. Repetir con --confirmar para ejecutarlo.");
  process.exit(2);
}

// ── Lista blanca primero ─────────────────────────────────────────────────────
// El orden importa: quitar la autorización corta el acceso al panel de
// inmediato. Si el borrado de la cuenta fallara después, queda una cuenta que
// puede autenticarse pero no entrar — el lado seguro en el que quedarse.
if (fila) {
  const { error } = await supabase.from("panel_usuarios").delete().eq("email", email);
  if (error) {
    console.error(`✖ No se pudo quitar de la lista blanca: ${error.message}`);
    process.exit(1);
  }
  console.log(`✔ Quitado de la lista blanca: ${email}`);
}

// ── Cuenta de Auth ───────────────────────────────────────────────────────────
if (cuenta) {
  const { error } = await supabase.auth.admin.deleteUser(cuenta.id);
  if (error) {
    console.error(`✖ Lista blanca limpia, pero no se pudo borrar la cuenta: ${error.message}`);
    console.error("  Ya no puede entrar al panel. Borrar la cuenta desde el dashboard.");
    process.exit(1);
  }
  console.log(`✔ Cuenta borrada de Supabase Auth: ${email}`);
}
