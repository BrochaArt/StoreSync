// Panel de operación de SOLO LECTURA: muestra el estado de la sincronización.
// No da de alta artistas ni ejecuta acciones — eso corre por terminal con los
// scripts del proyecto; el panel dice qué comando toca.
//
// Seguridad (§11): corre server-side y entrega HTML ya renderizado — el
// service_role JAMÁS llega al navegador. Escucha SOLO en 127.0.0.1. El acceso
// externo "de verdad" es el API gateway (Decisión 6); esto es una herramienta
// de operación local.
//
// Uso:
//   npm run panel                          → http://127.0.0.1:8787 (datos del .env)
//   npm run panel -- --env .env.local      → stack local
//   npm run panel -- --env .env.cloud      → producción
//   PANEL_PORT=9000 npm run panel          → otro puerto

import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { createServiceClient } from "../src/services/supabase.js";
import * as q from "../src/panel/consultas.js";
import { esc, pagina } from "../src/panel/shell.js";
import {
  vistaAlta,
  vistaArtistas,
  vistaProducto,
  vistaProductos,
  vistaResumen,
} from "../src/panel/vistas.js";

const { values: args } = parseArgs({ options: { env: { type: "string" } } });
try {
  process.loadEnvFile(args.env ?? ".env");
} catch {
  /* sin archivo env: las vars deben venir del entorno */
}

const PORT = Number(process.env["PANEL_PORT"] ?? 8787);
const HOST_DB = new URL(process.env["SUPABASE_URL"] ?? "http://desconocido").host;
const supabase = createServiceClient();

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

async function enrutar(url: URL): Promise<{ estado: number; html: string } | null> {
  const ruta = url.pathname.replace(/\/+$/, "") || "/";
  const shop = url.searchParams.get("shop");

  // Detalle de producto: /productos/<uuid>
  const detalle = /^\/productos\/([0-9a-f-]{36})$/i.exec(ruta);
  if (detalle) {
    const p = await q.producto(supabase, detalle[1]!);
    const ts = await q.tiendas(supabase);
    if (!p) {
      return {
        estado: 404,
        html: pagina({
          titulo: "No encontrado",
          ruta: "/productos",
          hostDb: HOST_DB,
          cuerpo: `<div class="vacio">Ese producto no existe. <a href="/productos">Ver todos</a></div>`,
        }),
      };
    }
    return {
      estado: 200,
      html: pagina({
        titulo: p.title ?? "Producto",
        ruta: "/productos",
        hostDb: HOST_DB,
        derecha: derecha(ts),
        cuerpo: vistaProducto(p, ts.find((t) => t.id === p.shop_id), url.searchParams.get("vista") === "json"),
      }),
    };
  }

  if (ruta === "/") {
    const ts = await q.tiendas(supabase);
    const [prods, evs] = await Promise.all([
      q.productos(supabase, { shopId: shop, limite: 8 }),
      q.eventos(supabase, { shopId: shop, limite: 12 }),
    ]);
    return {
      estado: 200,
      html: pagina({
        titulo: "Resumen",
        ruta: "/",
        hostDb: HOST_DB,
        derecha: derecha(ts),
        cuerpo: vistaResumen(ts, prods, evs, shop),
      }),
    };
  }

  if (ruta === "/artistas") {
    const ts = await q.tiendas(supabase);
    return {
      estado: 200,
      html: pagina({
        titulo: "Artistas",
        ruta: "/artistas",
        hostDb: HOST_DB,
        derecha: derecha(ts),
        cuerpo: vistaArtistas(ts),
      }),
    };
  }

  if (ruta === "/productos") {
    const busqueda = url.searchParams.get("q");
    const ts = await q.tiendas(supabase);
    const prods = await q.productos(supabase, { shopId: shop, busqueda, limite: 90 });
    return {
      estado: 200,
      html: pagina({
        titulo: "Productos",
        ruta: "/productos",
        hostDb: HOST_DB,
        derecha: derecha(ts),
        cuerpo: vistaProductos(ts, prods, shop, busqueda),
      }),
    };
  }

  if (ruta === "/alta") {
    const [ts, cs] = await Promise.all([q.tiendas(supabase), q.consumidores(supabase)]);
    return {
      estado: 200,
      html: pagina({
        titulo: "Estado del alta",
        ruta: "/alta",
        hostDb: HOST_DB,
        derecha: derecha(ts),
        cuerpo: vistaAlta(ts, cs, shop),
      }),
    };
  }

  return null;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    const r = await enrutar(url);
    if (!r) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("no encontrado");
      return;
    }
    res.writeHead(r.estado, { "Content-Type": "text/html; charset=utf-8" });
    res.end(r.html);
  } catch (e) {
    console.error(e);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`error del panel: ${(e as Error).message}`);
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Panel de operación: http://127.0.0.1:${PORT} (datos de ${HOST_DB})`);
});
