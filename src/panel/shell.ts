// Cromo compartido del panel: estilos, cabecera con navegación y utilidades
// de formato. Todo el HTML se arma server-side — el panel no tiene build, ni
// framework, ni JavaScript de cliente salvo lo mínimo (§11: el service_role
// vive solo en este proceso, jamás llega al navegador).

export const esc = (s: unknown): string =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

/** Tono de un chip. Los cuatro que ya usaba el panel. */
export type Tono = "verde" | "ambar" | "rojo" | "gris";

export const chip = (texto: string, tono: Tono = "gris"): string =>
  `<span class="chip ${tono}">${esc(texto)}</span>`;

export const num = (n: number | null | undefined): string =>
  n == null ? "—" : n.toLocaleString("es");

/** "hace 6 min" — más útil que una marca de tiempo para saber si algo corre. */
export function hace(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "hace segundos";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

export const hora = (iso: string): string =>
  new Date(iso).toLocaleTimeString("es", { hour12: false, hour: "2-digit", minute: "2-digit" });

/** Barra de proporción. Ámbar cuando está en cero: no es un error, pero se ve. */
export function barra(parte: number, total: number): string {
  const pct = total > 0 ? Math.round((parte / total) * 100) : 0;
  const color = pct === 0 ? "#d8b25e" : "#1d9e75";
  return `<span class="barra"><span style="width:${pct}%;background:${color}"></span></span>`;
}

const NAV = [
  { href: "/", etiqueta: "Resumen" },
  { href: "/artistas", etiqueta: "Artistas" },
  { href: "/productos", etiqueta: "Productos" },
  { href: "/alta", etiqueta: "Estado del alta" },
];

const ESTILOS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif; background: #f4f3ef; color: #1e1e1c; }
  a { color: #1d9e75; text-decoration: none; }
  a:hover { color: #16795a; }

  header { background: #16211c; color: #e9efe9; padding: 12px 28px; display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
  header .marca { font-size: 17px; font-weight: 600; letter-spacing: -.01em; }
  header .sub { font-size: 12.5px; color: #9db3a6; }
  nav { display: flex; gap: 4px; }
  nav a { padding: 6px 12px; border-radius: 7px; color: #9db3a6; font-size: 14px; }
  nav a:hover { color: #e9efe9; background: #21322a; }
  nav a.on { color: #16211c; background: #cfe8dc; font-weight: 600; }
  header .derecha { margin-left: auto; display: flex; align-items: center; gap: 16px; font-size: 12.5px; color: #9db3a6; }
  .pulso { width: 7px; height: 7px; border-radius: 99px; background: #37c493; display: inline-block; margin-right: 6px; }

  main { padding: 22px 28px 44px; display: flex; flex-direction: column; gap: 24px; }
  h1 { font-size: 21px; font-weight: 600; margin: 0; letter-spacing: -.01em; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .06em; color: #6d6d66; margin: 0; font-weight: 600; }
  .meta { color: #6d6d66; font-size: 12.5px; }
  .titulo { display: flex; flex-direction: column; gap: 3px; }

  .card { background: #fff; border: 1px solid #dcdad2; border-radius: 10px; }
  .vacio { background: #fff; border: 1px dashed #c9c7bd; border-radius: 10px; padding: 26px; text-align: center; color: #6d6d66; }

  .chip { font-size: 11.5px; padding: 1px 8px; border-radius: 99px; white-space: nowrap; display: inline-block; }
  .chip.verde { background: #e1f5ee; color: #085041; }
  .chip.ambar { background: #faeeda; color: #633806; }
  .chip.rojo  { background: #fcebeb; color: #791f1f; }
  .chip.gris  { background: #f1efe8; color: #444441; }

  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }
  .kpi { background: #fff; border: 1px solid #dcdad2; border-radius: 10px; padding: 14px 16px; display: grid; gap: 2px; }
  .kpi .valor { font-size: 26px; font-weight: 600; letter-spacing: -.02em; line-height: 1.15; font-variant-numeric: tabular-nums; }

  .barra { display: block; height: 6px; background: #eceae3; border-radius: 99px; overflow: hidden; }
  .barra span { display: block; height: 100%; border-radius: 99px; }

  table { width: 100%; border-collapse: collapse; }
  th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: #6d6d66; font-weight: 600; text-align: left; padding: 0 10px 8px 0; }
  td { padding: 7px 10px 7px 0; border-top: 1px solid #eeede8; font-size: 13px; vertical-align: top; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }

  .aviso { border-radius: 9px; padding: 11px 14px; font-size: 13.2px; line-height: 1.5; display: flex; gap: 10px; align-items: flex-start; }
  .aviso.ambar { background: #faeeda; color: #633806; }
  .aviso.rojo  { background: #fcebeb; color: #791f1f; }
  .aviso.gris  { background: #f1efe8; color: #444441; }
  .aviso.verde { background: #e1f5ee; color: #085041; }

  .cmd { font: 12.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; background: #16211c; color: #cfe8dc; border-radius: 8px; padding: 10px 13px; white-space: pre-wrap; margin: 0; overflow-x: auto; }

  .pills { display: flex; gap: 8px; flex-wrap: wrap; }
  .pills a { border: 1px solid #dcdad2; background: #fff; border-radius: 99px; padding: 5px 14px; font-size: 13.2px; color: #1e1e1c; }
  .pills a:hover { border-color: #b9c9bf; }
  .pills a.on { background: #16211c; border-color: #16211c; color: #e9efe9; font-weight: 600; }

  .tarjetas { display: flex; gap: 12px; flex-wrap: wrap; }
  .tienda { background: #fff; border: 1px solid #dcdad2; border-radius: 10px; padding: 12px 16px; display: grid; gap: 4px; min-width: 268px; color: inherit; }
  .tienda:hover { border-color: #b9c9bf; color: inherit; }
  .tienda.sel { border-color: #1d9e75; outline: 2px solid #1d9e7533; }
  .tienda strong { font-size: 15px; }

  .rejilla { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 12px; }
  .prod { background: #fff; border: 1px solid #dcdad2; border-radius: 10px; overflow: hidden; display: flex; color: inherit; }
  .prod:hover { border-color: #b9c9bf; color: inherit; }
  .prod.borrado { opacity: .55; }
  .thumb { width: 88px; min-width: 88px; background: #eceae3; display: flex; align-items: center; justify-content: center; color: #9a988f; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .prod .info { padding: 10px 14px; display: flex; flex-direction: column; gap: 4px; min-width: 0; width: 100%; }
  .prod .info .nom { font-size: 14.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .prod .info .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }

  .dos { display: grid; grid-template-columns: minmax(0, 2.1fr) minmax(0, 1fr); gap: 20px; align-items: start; }
  .cols3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
  .campo { display: flex; justify-content: space-between; gap: 12px; font-size: 13.2px; padding: 4px 0; border-bottom: 1px solid #eeede8; }
  .campo .v { text-align: right; }
  .falta { color: #791f1f; }
  .sin { color: #9a988f; font-style: italic; }

  details > summary { cursor: pointer; list-style: none; padding: 13px 16px; border-top: 1px solid #eeede8; }
  details > summary::-webkit-details-marker { display: none; }
  details > summary:hover { background: #faf9f6; }
  details[open] > summary { background: #faf9f6; }
  .flecha { color: #9a988f; display: inline-block; transition: transform .12s; }
  details[open] .flecha { transform: rotate(90deg); }

  @media (max-width: 1000px) {
    .dos, .cols3 { grid-template-columns: minmax(0, 1fr); }
  }
`;

export interface OpcionesPagina {
  titulo: string;
  ruta: string;
  hostDb: string;
  /** Texto corto a la derecha de la cabecera (salud, hora, etc.). */
  derecha?: string;
  cuerpo: string;
}

export function pagina(o: OpcionesPagina): string {
  const nav = NAV.map(
    (n) => `<a href="${n.href}"${n.href === o.ruta ? ' class="on"' : ""}>${esc(n.etiqueta)}</a>`,
  ).join("");

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.titulo)} · StoreSync</title>
<style>${ESTILOS}</style></head>
<body>
<header>
  <span class="marca">StoreSync</span>
  <span class="sub">panel de control</span>
  <nav>${nav}</nav>
  <span class="derecha">
    <span>datos de ${esc(o.hostDb)}</span>
    ${o.derecha ?? ""}
  </span>
</header>
<main>${o.cuerpo}</main>
</body></html>`;
}
