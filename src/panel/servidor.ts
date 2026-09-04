// Ruteo del panel, sin acoplarse a ningún servidor: recibe los datos de una
// petición y devuelve una respuesta. Lo usan igual el servidor local
// (scripts/panel.ts) y la función de Vercel (api/index.ts), así que lo que se
// prueba en local es literalmente lo que corre en producción.
//
// TODA ruta que muestre datos exige sesión. La única puerta abierta es /login.

import { createServiceClient } from "../services/supabase.js";
import * as q from "./consultas.js";
import { cerrarSesion, cookieVencida, iniciarSesion, sesionDe } from "./auth.js";
import { esc, pagina } from "./shell.js";
import {
  vistaAlta,
  vistaArtistas,
  vistaLogin,
  vistaProducto,
  vistaProductos,
  vistaResumen,
} from "./vistas.js";

export interface Peticion {
  metodo: string;
  url: URL;
  cookie: string | undefined;
  /** Cuerpo crudo de un POST (form-urlencoded). */
  cuerpo: string;
}

export interface Respuesta {
  estado: number;
  headers: Record<string, string>;
  cuerpo: string;
}

// Perezoso a propósito: si falta una variable de entorno en el despliegue,
// mejor un error legible en la primera petición que un crash al importar.
let _sb: ReturnType<typeof createServiceClient> | null = null;
const cliente = () => (_sb ??= createServiceClient());

const HOST_DB = new URL(process.env["SUPABASE_URL"] ?? "http://desconocido").host;

const html = (estado: number, cuerpo: string, extra: Record<string, string> = {}): Respuesta => ({
  estado,
  headers: { "Content-Type": "text/html; charset=utf-8", ...extra },
  cuerpo,
});

const redirigir = (a: string, extra: Record<string, string> = {}): Respuesta => ({
  estado: 302,
  headers: { Location: a, ...extra },
  cuerpo: "",
});

/**
 * Un destino de vuelta solo puede ser una ruta de este panel. Sin esto,
 * ?destino=https://otro-sitio convierte el login en un trampolín para phishing.
 */
function destinoSeguro(d: string | null): string {
  if (!d || !d.startsWith("/") || d.startsWith("//")) return "/";
  return d;
}

/** Salud para la esquina de la cabecera: lo que conviene ver de un vistazo. */
function derecha(ts: q.PanelTienda[]): string {
  const fallas = ts.reduce((n, t) => n + t.fallas_24h, 0);
  const pend = ts.reduce((n, t) => n + t.webhooks_sin_procesar, 0);
  const partes: string[] = [];
  if (pend > 0) partes.push(`${pend} webhooks sin procesar`);
  if (fallas > 0) partes.push(`${fallas} fallas 24 h`);
  return partes.length
    ? `<span>${esc(partes.join(" · "))}</span>`
    : `<span><span class="pulso"></span>sin fallas</span>`;
}

export async function atender(p: Peticion): Promise<Respuesta> {
  const ruta = p.url.pathname.replace(/\/+$/, "") || "/";

  // ── Rutas de sesión ────────────────────────────────────────────────────────

  if (ruta === "/login") {
    if (p.metodo === "POST") {
      const form = new URLSearchParams(p.cuerpo);
      const r = await iniciarSesion(
        cliente(),
        (form.get("email") ?? "").trim(),
        form.get("password") ?? "",
      );
      if ("error" in r) {
        return html(
          401,
          pagina({
            titulo: "Entrar",
            ruta: "/login",
            hostDb: HOST_DB,
            desnuda: true,
            cuerpo: vistaLogin(r.error, form.get("destino")),
          }),
        );
      }
      return redirigir(destinoSeguro(form.get("destino")), { "Set-Cookie": r.cookie });
    }

    return html(
      200,
      pagina({
        titulo: "Entrar",
        ruta: "/login",
        hostDb: HOST_DB,
        desnuda: true,
        cuerpo: vistaLogin(null, p.url.searchParams.get("destino")),
      }),
    );
  }

  if (ruta === "/salir") {
    await cerrarSesion(p.cookie);
    return redirigir("/login", { "Set-Cookie": cookieVencida() });
  }

  // ── De acá para abajo, todo exige sesión ───────────────────────────────────

  const sesion = await sesionDe(cliente(), p.cookie);
  if (!sesion) {
    const volver = ruta === "/" ? "" : `?destino=${encodeURIComponent(ruta + p.url.search)}`;
    return redirigir(`/login${volver}`, { "Set-Cookie": cookieVencida() });
  }

  // Si el token se renovó a mitad de camino, la cookie viaja con la respuesta.
  const cookie: Record<string, string> = sesion.cookieNueva
    ? { "Set-Cookie": sesion.cookieNueva }
    : {};
  const marco = (titulo: string, rutaNav: string, cuerpo: string, ts: q.PanelTienda[]) =>
    html(200, pagina({ titulo, ruta: rutaNav, hostDb: HOST_DB, derecha: derecha(ts), sesion: sesion.email, cuerpo }), cookie);

  const shop = p.url.searchParams.get("shop");

  const detalle = /^\/productos\/([0-9a-f-]{36})$/i.exec(ruta);
  if (detalle) {
    const [prod, ts] = await Promise.all([q.producto(cliente(), detalle[1]!), q.tiendas(cliente())]);
    if (!prod) {
      return html(
        404,
        pagina({
          titulo: "No encontrado",
          ruta: "/productos",
          hostDb: HOST_DB,
          sesion: sesion.email,
          cuerpo: `<div class="vacio">Ese producto no existe. <a href="/productos">Ver todos</a></div>`,
        }),
        cookie,
      );
    }
    return marco(
      prod.title ?? "Producto",
      "/productos",
      vistaProducto(prod, ts.find((t) => t.id === prod.shop_id), p.url.searchParams.get("vista") === "json"),
      ts,
    );
  }

  if (ruta === "/") {
    const ts = await q.tiendas(cliente());
    const [prods, evs] = await Promise.all([
      q.productos(cliente(), { shopId: shop, limite: 8 }),
      q.eventos(cliente(), { shopId: shop, limite: 12 }),
    ]);
    return marco("Resumen", "/", vistaResumen(ts, prods, evs, shop), ts);
  }

  if (ruta === "/artistas") {
    const ts = await q.tiendas(cliente());
    return marco("Artistas", "/artistas", vistaArtistas(ts), ts);
  }

  if (ruta === "/productos") {
    const busqueda = p.url.searchParams.get("q");
    const ts = await q.tiendas(cliente());
    const prods = await q.productos(cliente(), { shopId: shop, busqueda, limite: 90 });
    return marco("Productos", "/productos", vistaProductos(ts, prods, shop, busqueda), ts);
  }

  if (ruta === "/alta") {
    const [ts, cs] = await Promise.all([q.tiendas(cliente()), q.consumidores(cliente())]);
    return marco("Estado del alta", "/alta", vistaAlta(ts, cs, shop), ts);
  }

  return {
    estado: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...cookie },
    cuerpo: "no encontrado",
  };
}
