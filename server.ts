// Entrypoint del panel. Vercel detecta este archivo por su nombre, llama a
// listen() y le rutea todas las peticiones; en local es el mismo servidor, así
// que lo que se prueba acá es literalmente lo que corre desplegado.
//
// Seguridad (§11): entrega HTML ya renderizado y el service_role vive solo en
// este proceso — jamás llega al navegador. En local escucha únicamente en
// 127.0.0.1; en Vercel la exposición la maneja la plataforma y la puerta es el
// login (Supabase Auth + lista blanca, migración 020).
//
// Local:
//   npm run panel                      → http://127.0.0.1:8787 (datos del .env)
//   npm run panel -- --env .env.cloud  → contra producción

import { createServer, type IncomingMessage } from "node:http";
import { parseArgs } from "node:util";
import { atender } from "./src/panel/servidor.js";

const enVercel = process.env["VERCEL"] === "1";

if (!enVercel) {
  const { values } = parseArgs({ options: { env: { type: "string" } }, strict: false });
  try {
    process.loadEnvFile((values["env"] as string | undefined) ?? ".env");
  } catch {
    /* sin archivo env: las vars deben venir del entorno */
  }
  // Sin HTTPS en local el navegador descarta una cookie Secure y el login nunca
  // prende. En Vercel esto no se define y la cookie sí exige HTTPS.
  process.env["PANEL_INSEGURO"] ??= "1";
}

const PORT = Number(process.env["PORT"] ?? process.env["PANEL_PORT"] ?? 8787);

const leerCuerpo = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => {
      d += c;
      // Un formulario de login no pesa nada: cortar temprano evita que alguien
      // mantenga el proceso ocupado con un cuerpo infinito.
      if (d.length > 64_000) reject(new Error("cuerpo demasiado grande"));
    });
    req.on("end", () => resolve(d));
    req.on("error", reject);
  });

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? `127.0.0.1:${PORT}`;
    const r = await atender({
      metodo: req.method ?? "GET",
      url: new URL(req.url ?? "/", `http://${host}`),
      cookie: req.headers.cookie,
      cuerpo: req.method === "POST" ? await leerCuerpo(req) : "",
    });
    res.writeHead(r.estado, r.headers);
    res.end(r.cuerpo);
  } catch (e) {
    console.error(e);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`error del panel: ${(e as Error).message}`);
  }
});

// En local solo loopback; en Vercel el bind lo decide la plataforma.
if (enVercel) {
  server.listen(PORT);
} else {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Panel de operación: http://127.0.0.1:${PORT}`);
  });
}
