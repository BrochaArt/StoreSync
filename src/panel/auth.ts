// Autenticación del panel: Supabase Auth (email + contraseña) por cookie.
//
// Dos puertas, y las dos se cruzan en CADA request (migración 020):
//   1. sesión válida — el token se verifica contra Supabase, no se cree lo que
//      diga la cookie
//   2. email en panel_usuarios y activo — autenticarse no alcanza, porque el
//      registro público de Supabase está abierto por defecto
//
// La cookie es HttpOnly (JavaScript no la lee), SameSite=Lax (no viaja en
// peticiones de terceros) y Secure fuera de local. Guarda los dos tokens: el de
// acceso vence en una hora y se renueva solo con el de refresco, para que el
// operador no tenga que volver a entrar cada rato.
//
// El service_role NUNCA participa del login: solo el cliente anónimo valida
// credenciales. Aquel se usa después, para leer datos, y jamás sale del servidor.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const COOKIE = "storesync_panel";

interface Guardado {
  access_token: string;
  refresh_token: string;
}

export interface Sesion {
  email: string;
  /** Presente si hubo que renovar: el llamador debe reenviar la cookie. */
  cookieNueva?: string;
}

function clienteAnonimo(): SupabaseClient {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_ANON_KEY"];
  if (!url || !key) {
    throw new Error("Faltan SUPABASE_URL / SUPABASE_ANON_KEY: sin ellas no hay login");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function leerCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const parte of (header ?? "").split(";")) {
    const i = parte.indexOf("=");
    if (i < 0) continue;
    const k = parte.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return out;
}

const seguro = (): string => (process.env["PANEL_INSEGURO"] === "1" ? "" : " Secure;");

function armarCookie(valor: string, maxAge: number): string {
  return `${COOKIE}=${encodeURIComponent(valor)}; Path=/; HttpOnly;${seguro()} SameSite=Lax; Max-Age=${maxAge}`;
}

/** Cookie de 30 días: el token de acceso interno se renueva solo. */
const guardar = (g: Guardado): string => armarCookie(JSON.stringify(g), 60 * 60 * 24 * 30);

export const cookieVencida = (): string => armarCookie("", 0);

/**
 * Valida credenciales. Devuelve la cookie a poner, o un mensaje de error
 * DELIBERADAMENTE genérico: distinguir "no existe" de "contraseña mala" le
 * confirma a quien tantea qué correos son válidos.
 */
export async function iniciarSesion(
  servicio: SupabaseClient,
  email: string,
  password: string,
): Promise<{ cookie: string } | { error: string }> {
  const anon = clienteAnonimo();
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user?.email) {
    return { error: "Credenciales incorrectas." };
  }

  // Segunda puerta: tener cuenta no basta.
  if (!(await tieneAcceso(servicio, data.user.email))) {
    await anon.auth.signOut();
    return { error: "Esta cuenta no está autorizada para el panel." };
  }

  return {
    cookie: guardar({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    }),
  };
}

async function tieneAcceso(servicio: SupabaseClient, email: string): Promise<boolean> {
  const { data, error } = await servicio.rpc("panel_tiene_acceso", { p_email: email });
  if (error) {
    console.error(`panel_tiene_acceso: ${error.message}`);
    return false;
  }
  return data === true;
}

/**
 * Resuelve la sesión de un request. null = no entra.
 *
 * El token se verifica CONTRA SUPABASE en cada request: la cookie es HttpOnly y
 * firmada, pero igual es entrada del cliente y no se le cree por sí sola.
 */
export async function sesionDe(
  servicio: SupabaseClient,
  cookieHeader: string | undefined,
): Promise<Sesion | null> {
  const crudo = leerCookies(cookieHeader)[COOKIE];
  if (!crudo) return null;

  let g: Guardado;
  try {
    g = JSON.parse(crudo) as Guardado;
  } catch {
    return null;
  }
  if (!g?.access_token || !g?.refresh_token) return null;

  const anon = clienteAnonimo();

  // Camino normal: el token de acceso sigue vivo.
  const { data, error } = await anon.auth.getUser(g.access_token);
  if (!error && data.user?.email) {
    return (await tieneAcceso(servicio, data.user.email)) ? { email: data.user.email } : null;
  }

  // Venció: renovar con el de refresco y reenviar la cookie.
  const renovada = await anon.auth.refreshSession({ refresh_token: g.refresh_token });
  const s = renovada.data.session;
  const correo = renovada.data.user?.email;
  if (renovada.error || !s || !correo) return null;
  if (!(await tieneAcceso(servicio, correo))) return null;

  return {
    email: correo,
    cookieNueva: guardar({ access_token: s.access_token, refresh_token: s.refresh_token }),
  };
}

/** Invalida el refresh token del lado de Supabase, no solo la cookie. */
export async function cerrarSesion(cookieHeader: string | undefined): Promise<void> {
  const crudo = leerCookies(cookieHeader)[COOKIE];
  if (!crudo) return;
  try {
    const g = JSON.parse(crudo) as Guardado;
    const anon = clienteAnonimo();
    await anon.auth.setSession({ access_token: g.access_token, refresh_token: g.refresh_token });
    await anon.auth.signOut();
  } catch {
    /* cookie ilegible o sesión ya muerta: la cookie vencida basta */
  }
}
