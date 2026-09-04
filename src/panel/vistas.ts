// Las cuatro vistas del panel. Todo se renderiza en el servidor: los
// desplegables usan <details> nativo y las pestañas son rutas, así que no hay
// una sola línea de JavaScript de cliente que mantener.

import {
  CANONICOS,
  ETIQUETAS,
  metafield,
  stockDe,
  type ConsumidorRow,
  type EventoRow,
  type PanelTienda,
  type ProductoRow,
} from "./consultas.js";
import { barra, chip, esc, hace, hora, num, type Tono } from "./shell.js";

const ICONO_IMG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-6 6-3-3-4 4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICONO_ALERTA = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="min-width:17px;margin-top:1px"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`;
const ICONO_OK = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="min-width:17px;margin-top:1px"><path d="M20 6L9 17l-5-5"/></svg>`;
const FLECHA = `<span class="flecha"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>`;

const tonoEstado = (s: string): Tono => (s === "active" ? "verde" : s === "paused" ? "ambar" : "rojo");

/** Chip de stock de una variante. Sin filas = no vendible, no "cero". */
function chipStock(v: ProductoRow["variants"][number]): string {
  const n = stockDe(v);
  if (n === null) return chip("sin inventario", "gris");
  if (n <= 0) return chip("0 disp.", "rojo");
  if (n >= 9999) return chip(`${num(n)} disp.`, "gris");
  if (n <= 5) return chip(`${num(n)} disp.`, "ambar");
  return chip(`${num(n)} disp.`, "verde");
}

function miniatura(p: ProductoRow): string {
  const img = [...p.product_images].sort((a, b) => a.position - b.position)[0];
  return img
    ? `<div class="thumb"><img src="${esc(img.url)}" alt="${esc(img.alt_text ?? "")}" loading="lazy"></div>`
    : `<div class="thumb">${ICONO_IMG}</div>`;
}

function tarjetaProducto(p: ProductoRow, dominio: string): string {
  const cat = metafield(p, "category");
  const stock = p.variants.length
    ? chipStock(p.variants[0]!)
    : chip("sin variantes", "gris");
  return `<a class="prod${p.deleted_at ? " borrado" : ""}" href="/productos/${esc(p.id)}">
    ${miniatura(p)}
    <div class="info">
      <span class="nom">${esc(p.title ?? "(sin título)")}</span>
      <span class="meta">${esc(dominio)}${p.product_type ? ` · ${esc(p.product_type)}` : ""}</span>
      <span class="chips">
        ${cat ? chip(cat, "verde") : chip("sin categoría", "gris")}
        ${stock}
        ${chip(`${p.variants.length} variante${p.variants.length === 1 ? "" : "s"}`, "gris")}
        ${p.deleted_at ? chip("eliminado en Shopify", "rojo") : ""}
      </span>
    </div>
  </a>`;
}

// ─── Resumen ──────────────────────────────────────────────────────────────────

export function vistaResumen(
  ts: PanelTienda[],
  prods: ProductoRow[],
  evs: EventoRow[],
  filtro: string | null,
): string {
  const dom = new Map(ts.map((t) => [t.id, t.shop_domain]));
  const sel = ts.find((t) => t.id === filtro) ?? null;

  const totales = ts.reduce(
    (a, t) => ({
      productos: a.productos + t.productos,
      variantes: a.variantes + t.variantes,
      imagenes: a.imagenes + t.imagenes,
      pendientes: a.pendientes + t.webhooks_sin_procesar,
      fallas: a.fallas + t.fallas_24h,
    }),
    { productos: 0, variantes: 0, imagenes: 0, pendientes: 0, fallas: 0 },
  );

  const kpis = [
    { l: "Artistas conectados", v: num(ts.length), p: `${ts.filter((t) => t.status === "active").length} sincronizando` },
    { l: "Productos", v: num(totales.productos), p: "espejados desde Shopify" },
    { l: "Variantes", v: num(totales.variantes), p: `${num(totales.imagenes)} imágenes` },
    {
      l: "Fallas (24 h)",
      v: num(totales.fallas),
      p: totales.pendientes > 0 ? `${num(totales.pendientes)} webhooks sin procesar` : "cola al día",
    },
  ]
    .map((k) => `<div class="kpi"><span class="meta">${esc(k.l)}</span><span class="valor">${k.v}</span><span class="meta">${esc(k.p)}</span></div>`)
    .join("");

  const tarjetas = ts
    .map((t) => {
      const on = filtro === t.id;
      return `<a class="tienda${on ? " sel" : ""}" href="${on ? "/" : `/?shop=${esc(t.id)}`}">
        <span style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <strong>${esc(t.artista)}</strong>${chip(t.status === "active" ? "activa" : t.status, tonoEstado(t.status))}
        </span>
        <span class="meta">${esc(t.shop_domain)}</span>
        <span class="meta">${num(t.productos)} productos · ${num(t.variantes)} variantes · refrescado ${esc(hace(t.last_refreshed_at))}</span>
      </a>`;
    })
    .join("");

  const filasEv = evs.length
    ? evs
        .map((e) => {
          const t: Tono = e.status === "success" ? "verde" : e.status === "dead_letter" ? "rojo" : "ambar";
          const refresco = e.payload && (e.payload as Record<string, unknown>)["refresco_metadatos"];
          const que = refresco ? "refresco de metadatos" : `${e.direction}/${e.entity}`;
          return `<tr><td class="meta" style="white-space:nowrap">${esc(hora(e.created_at))}</td>
            <td>${esc(que)}<br><span class="meta">${esc(dom.get(e.shop_id ?? "") ?? "")}</span></td>
            <td style="text-align:right">${chip(e.status, t)}</td></tr>`;
        })
        .join("")
    : `<tr><td class="meta">sin eventos todavía</td></tr>`;

  const cobertura = ts
    .map((t) => {
      const con = CANONICOS.filter((c) => (t.atributos[c] ?? 0) > 0).length;
      return `<div style="display:flex;flex-direction:column;gap:5px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
          <span style="font-size:13.5px">${esc(t.artista)}</span>
          <span class="meta">${con} de 10 atributos</span>
        </div>
        ${barra(con, 10)}
      </div>`;
    })
    .join("");

  return `<div class="titulo">
    <h1>Resumen</h1>
    <span class="meta">Estado general de la sincronización. El alta y el mantenimiento corren por terminal.</span>
  </div>

  <div class="kpis">${kpis}</div>

  <section style="display:flex;flex-direction:column;gap:10px">
    <div style="display:flex;align-items:baseline;gap:12px">
      <h2>Artistas</h2>
      ${filtro ? `<a href="/" style="font-size:13px">ver todos</a>` : ""}
      <span style="margin-left:auto"><a href="/alta" style="font-size:13px">estado del alta &rsaquo;</a></span>
    </div>
    <div class="tarjetas">${tarjetas || `<div class="vacio">Sin tiendas dadas de alta todavía.</div>`}</div>
  </section>

  <div class="dos">
    <section style="display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;align-items:baseline;gap:10px">
        <h2>Productos</h2>
        <span class="meta">${sel ? `de ${esc(sel.artista)}` : "más recientes de todos los artistas"}</span>
        <span style="margin-left:auto"><a href="${filtro ? `/productos?shop=${esc(filtro)}` : "/productos"}" style="font-size:13px">ver todos &rsaquo;</a></span>
      </div>
      <div class="rejilla">${
        prods.length
          ? prods.slice(0, 8).map((p) => tarjetaProducto(p, dom.get(p.shop_id) ?? "")).join("")
          : `<div class="vacio">Sin productos sincronizados.</div>`
      }</div>
    </section>

    <section style="display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;flex-direction:column;gap:10px">
        <h2>Actividad reciente</h2>
        <div class="card" style="padding:4px 14px 10px"><table>${filasEv}</table></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <h2>Cobertura de atributos</h2>
        <div class="card" style="padding:14px;display:flex;flex-direction:column;gap:12px">
          ${cobertura || `<span class="meta">sin tiendas</span>`}
          <span class="meta" style="line-height:1.45">Lo que el artista no carga en Shopify viaja vacío: no se deduce.</span>
        </div>
      </div>
    </section>
  </div>`;
}

// ─── Artistas ─────────────────────────────────────────────────────────────────

export function vistaArtistas(ts: PanelTienda[]): string {
  const avisos: string[] = [];
  for (const t of ts) {
    if (!t.tiene_bio) {
      avisos.push(
        `<div class="aviso ambar">${ICONO_ALERTA}<span>El perfil de <strong>${esc(t.artista)}</strong> no tiene biografía: su encabezado sale vacío en el sitio del consumidor.</span></div>`,
      );
    }
    if (t.consumidores.length === 0) {
      avisos.push(
        `<div class="aviso rojo">${ICONO_ALERTA}<span><strong>${esc(t.artista)}</strong> está sincronizado pero <strong>invisible</strong>: ningún consumidor lo tiene autorizado, así que el API responde 403 al pedirlo.</span></div>`,
      );
    }
    if (t.variantes_sin_inventario > 0) {
      avisos.push(
        `<div class="aviso gris">${ICONO_ALERTA}<span><strong>${num(t.variantes_sin_inventario)} variantes</strong> de ${esc(t.artista)} no tienen ninguna fila de inventario: el consumidor no puede distinguirlas de agotadas.</span></div>`,
      );
    }
  }

  const filas = ts
    .map((t) => {
      const con = CANONICOS.filter((c) => (t.atributos[c] ?? 0) > 0).length;
      const detalleAttr = CANONICOS.map((c) => {
        const n = t.atributos[c] ?? 0;
        const pct = t.productos > 0 ? Math.round((n / t.productos) * 100) : 0;
        return `<div class="campo"><span class="meta">${esc(ETIQUETAS[c])}</span><span class="v ${n === 0 ? "sin" : ""}">${n === 0 ? "sin cargar" : `${num(n)} · ${pct}%`}</span></div>`;
      }).join("");

      const perfil = [
        ["Nombre", esc(t.artista), false],
        ["Tienda", esc(t.shop_name ?? "—"), false],
        ["Biografía", t.tiene_bio ? `${t.bio!.trim().length} caracteres` : "sin cargar", !t.tiene_bio],
        ["Sitio web", t.website ? esc(t.website) : "sin cargar", !t.website],
        ["Email", t.contact_email ? esc(t.contact_email) : "sin cargar", !t.contact_email],
      ]
        .map(
          ([k, v, falta]) =>
            `<div class="campo"><span class="meta">${k}</span><span class="v ${falta ? "falta" : ""}">${v}</span></div>`,
        )
        .join("");

      const sync = [
        ["Estado", esc(t.status)],
        ["Ubicación primaria", esc(t.location_id)],
        ["Imágenes", num(t.imagenes)],
        ["Filas de inventario", num(t.inventarios)],
        ["Último refresco", esc(hace(t.last_refreshed_at))],
        ["Último webhook", esc(hace(t.ultimo_webhook))],
        ["Fallas (24 h)", num(t.fallas_24h)],
      ]
        .map(([k, v]) => `<div class="campo"><span class="meta">${k}</span><span class="v">${v}</span></div>`)
        .join("");

      return `<details${!t.tiene_bio || t.consumidores.length === 0 ? " open" : ""}>
      <summary>
        <div style="display:grid;grid-template-columns:minmax(0,2.2fr) 100px 100px 120px 130px;gap:14px;align-items:center">
          <span style="display:flex;align-items:center;gap:10px;min-width:0">
            ${FLECHA}
            <span style="display:grid;gap:1px;min-width:0">
              <span style="font-size:14.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.artista)}</span>
              <span class="meta" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.shop_domain)}</span>
            </span>
          </span>
          <span class="num" style="text-align:right;font-variant-numeric:tabular-nums">${num(t.productos)}</span>
          <span class="num" style="text-align:right;font-variant-numeric:tabular-nums">${num(t.variantes)}</span>
          <span style="display:grid;gap:4px"><span class="meta">${con} de 10</span>${barra(con, 10)}</span>
          <span>${
            t.consumidores.length
              ? chip(t.consumidores.join(", "), "verde")
              : chip("invisible", "rojo")
          }</span>
        </div>
      </summary>
      <div style="padding:6px 16px 20px 42px;background:#faf9f6">
        <div class="cols3" style="padding-top:12px">
          <div style="display:flex;flex-direction:column;gap:8px"><h2>Perfil público</h2>${perfil}</div>
          <div style="display:flex;flex-direction:column;gap:8px"><h2>Sincronización</h2>${sync}</div>
          <div style="display:flex;flex-direction:column;gap:8px"><h2>Atributos por campo</h2>${detalleAttr}</div>
        </div>
        <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
          <a href="/productos?shop=${esc(t.id)}" style="font-size:13.2px">ver sus productos &rsaquo;</a>
          <a href="/alta?shop=${esc(t.id)}" style="font-size:13.2px">estado del alta &rsaquo;</a>
        </div>
      </div>
    </details>`;
    })
    .join("");

  return `<div style="display:flex;align-items:flex-end;gap:16px">
    <div class="titulo">
      <h1>Artistas</h1>
      <span class="meta">Estado de cada tienda conectada. Despliega una fila para ver el detalle.</span>
    </div>
    <span class="meta" style="margin-left:auto">el alta y el mantenimiento corren por terminal</span>
  </div>

  ${avisos.length ? `<div style="display:flex;flex-direction:column;gap:8px">${avisos.join("")}</div>` : ""}

  <div class="card" style="overflow:hidden">
    <div style="padding:14px 16px 0">
      <div style="display:grid;grid-template-columns:minmax(0,2.2fr) 100px 100px 120px 130px;gap:14px;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:#6d6d66;font-weight:600;padding-bottom:8px">
        <span>Artista</span><span style="text-align:right">Productos</span><span style="text-align:right">Variantes</span><span>Atributos</span><span>Consumidor</span>
      </div>
    </div>
    ${filas || `<div class="vacio" style="border:0">Sin tiendas dadas de alta.</div>`}
  </div>`;
}

// ─── Productos ────────────────────────────────────────────────────────────────

export function vistaProductos(
  ts: PanelTienda[],
  prods: ProductoRow[],
  filtro: string | null,
  busqueda: string | null,
): string {
  const dom = new Map(ts.map((t) => [t.id, t.shop_domain]));
  const q = busqueda ? `&q=${encodeURIComponent(busqueda)}` : "";

  const pills = [`<a href="/productos${busqueda ? `?q=${encodeURIComponent(busqueda)}` : ""}"${!filtro ? ' class="on"' : ""}>Todos</a>`]
    .concat(
      ts.map(
        (t) =>
          `<a href="/productos?shop=${esc(t.id)}${q}"${filtro === t.id ? ' class="on"' : ""}>${esc(t.artista)}</a>`,
      ),
    )
    .join("");

  return `<div class="titulo">
    <h1>Productos</h1>
    <span class="meta">Lo que el consumidor recibe por el API, tal como está espejado ahora.</span>
  </div>

  <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
    <div class="pills">${pills}</div>
    <form method="get" action="/productos" style="margin-left:auto;display:flex;gap:6px">
      ${filtro ? `<input type="hidden" name="shop" value="${esc(filtro)}">` : ""}
      <input name="q" value="${esc(busqueda ?? "")}" placeholder="Buscar por título…"
        style="font:inherit;font-size:13.5px;padding:7px 12px;border:1px solid #dcdad2;border-radius:8px;min-width:220px">
      <button type="submit" style="font:inherit;font-size:13.5px;cursor:pointer;background:#16211c;color:#e9efe9;border:0;border-radius:8px;padding:7px 16px">Buscar</button>
    </form>
  </div>

  <span class="meta">${prods.length} producto${prods.length === 1 ? "" : "s"}${busqueda ? ` para “${esc(busqueda)}”` : ""}</span>

  <div class="rejilla">${
    prods.length
      ? prods.map((p) => tarjetaProducto(p, dom.get(p.shop_id) ?? "")).join("")
      : `<div class="vacio">Ningún producto coincide.</div>`
  }</div>`;
}

// ─── Detalle de producto ──────────────────────────────────────────────────────

export function vistaProducto(p: ProductoRow, t: PanelTienda | undefined, json: boolean): string {
  const cat = metafield(p, "category");
  const cargados = CANONICOS.filter((c) => metafield(p, c) !== null).length;

  const attrs = CANONICOS.map((c) => {
    const v = metafield(p, c);
    const corto = v && v.length > 90 ? `${v.length} caracteres` : v;
    return `<div class="campo"><span class="meta">${esc(ETIQUETAS[c])}</span><span class="v ${v ? "" : "sin"}">${v ? esc(corto!) : "sin cargar"}</span></div>`;
  }).join("");

  const filasVar = p.variants.length
    ? p.variants
        .map((v) => {
          // "Default Title" es el marcador de Shopify para un producto SIN
          // opciones: no es un nombre, y repetirlo dos veces por fila es ruido.
          // Solo se oculta acá; el JSON refleja el API tal cual.
          const titulo = v.title && v.title !== "Default Title" ? v.title : "Única";
          const opts = (v.options ?? [])
            .filter((o) => !(o.name === "Title" && o.value === "Default Title"))
            .map((o) => `${o.name}: ${o.value}`)
            .join(" · ");
          const ubis = v.inventory_levels.length
            ? v.inventory_levels.map((l) => esc(l.location_id)).join("<br>")
            : `<span class="sin">ninguna</span>`;
          return `<tr>
            <td>${esc(titulo)}${opts ? `<br><span class="meta">${esc(opts)}</span>` : ""}</td>
            <td class="meta">${esc(v.sku ?? "sin sku")}</td>
            <td class="num">${v.price != null ? `$${esc(v.price)}` : "—"}</td>
            <td class="meta">${ubis}</td>
            <td class="num">${chipStock(v)}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="5" class="meta">sin variantes</td></tr>`;

  const cuerpoJson = JSON.stringify(
    {
      id: p.id,
      shopify_product_id: p.shopify_product_id,
      title: p.title,
      handle: p.handle,
      status: p.status,
      artist: t?.artista ?? null,
      ...Object.fromEntries(CANONICOS.map((c) => [c, metafield(p, c)])),
      product_type: p.product_type,
      tags: p.tags ?? [],
      shopify_taxonomy: p.taxonomy_category,
      collections: p.collections ?? [],
      images: p.product_images.length,
      variants: p.variants.map((v) => ({
        shopify_variant_id: v.shopify_variant_id,
        sku: v.sku,
        price: v.price,
        options: v.options ?? [],
        inventory: v.inventory_levels.map((l) => ({
          location_id: l.location_id,
          available: l.available,
        })),
      })),
    },
    null,
    2,
  );

  const galeria = [...p.product_images]
    .sort((a, b) => a.position - b.position)
    .slice(0, 8)
    .map(
      (i) =>
        `<img src="${esc(i.url)}" alt="${esc(i.alt_text ?? "")}" loading="lazy" style="width:64px;height:64px;object-fit:cover;border-radius:7px;border:1px solid #dcdad2">`,
    )
    .join("");

  const base = `/productos/${esc(p.id)}`;

  return `<div style="display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap">
    <div style="width:108px;min-width:108px;height:108px;border-radius:10px;border:1px solid #dcdad2;overflow:hidden;background:#eceae3;display:flex;align-items:center;justify-content:center;color:#9a988f">
      ${p.product_images.length ? `<img src="${esc([...p.product_images].sort((a, b) => a.position - b.position)[0]!.url)}" alt="" style="width:100%;height:100%;object-fit:cover">` : ICONO_IMG}
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;flex-grow:1;min-width:0">
      <span class="meta"><a href="/productos?shop=${esc(p.shop_id)}">${esc(t?.artista ?? "")}</a> · ${esc(t?.shop_domain ?? "")}</span>
      <h1 style="font-size:22px">${esc(p.title ?? "(sin título)")}</h1>
      <div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center">
        ${cat ? chip(cat, "verde") : chip("sin categoría", "gris")}
        ${p.product_type ? chip(p.product_type, "gris") : ""}
        ${p.deleted_at ? chip("eliminado en Shopify", "rojo") : ""}
        <span class="meta">actualizado ${esc(hace(p.updated_at))} · ${p.product_images.length} imágenes</span>
      </div>
    </div>
    <div class="pills">
      <a href="${base}"${!json ? ' class="on"' : ""}>Ficha</a>
      <a href="${base}?vista=json"${json ? ' class="on"' : ""}>Lo que recibe el consumidor</a>
    </div>
  </div>

  ${
    json
      ? `<div class="card" style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;align-items:center;gap:10px"><h2>Respuesta del API</h2>${chip("GET /api-gateway/catalog", "gris")}</div>
          <pre class="cmd" style="background:#f7f8fa;color:#17324d;border:1px solid #e2e5e9">${esc(cuerpoJson)}</pre>
          <span class="meta">Los <code>null</code> son deliberados: el artista no cargó ese dato y no se deduce.</span>
        </div>`
      : `<div class="dos">
          <div class="card" style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">
            <div style="display:flex;align-items:center;gap:10px">
              <h2>Atributos</h2>${chip(`${cargados} de 10 cargados`, cargados === 0 ? "ambar" : "verde")}
            </div>
            <div>${attrs}</div>
            <span class="meta" style="line-height:1.45">Los campos vacíos viajan como <code>null</code> con la clave presente: el consumidor siempre recibe la misma forma.</span>
          </div>

          <div style="display:flex;flex-direction:column;gap:16px">
            <div class="card" style="padding:18px 20px;display:flex;flex-direction:column;gap:10px">
              <h2>Variantes e inventario</h2>
              <table><tr><th>Variante</th><th>SKU</th><th class="num">Precio</th><th>Ubicación</th><th class="num">Stock</th></tr>${filasVar}</table>
            </div>
            ${
              galeria
                ? `<div class="card" style="padding:18px 20px;display:flex;flex-direction:column;gap:10px">
                    <h2>Imágenes</h2><div style="display:flex;gap:8px;flex-wrap:wrap">${galeria}</div>
                  </div>`
                : ""
            }
            ${
              p.collections?.length
                ? `<div class="card" style="padding:18px 20px;display:flex;flex-direction:column;gap:10px">
                    <h2>Colecciones</h2><div style="display:flex;gap:6px;flex-wrap:wrap">${p.collections.map((c) => chip(c.title, "gris")).join("")}</div>
                  </div>`
                : ""
            }
          </div>
        </div>`
  }`;
}

// ─── Estado del alta ──────────────────────────────────────────────────────────

interface Etapa {
  titulo: string;
  detalle: string;
  estado: "listo" | "parcial" | "pendiente";
}

const CHIP_ETAPA: Record<Etapa["estado"], Tono> = { listo: "verde", parcial: "ambar", pendiente: "gris" };

function etapasDe(t: PanelTienda): Etapa[] {
  const con = CANONICOS.filter((c) => (t.atributos[c] ?? 0) > 0).length;
  return [
    {
      titulo: "Credenciales en Vault",
      detalle: `client_id y secret guardados cifrados · tienda ${t.status}`,
      estado: t.status === "active" ? "listo" : "parcial",
    },
    {
      titulo: "Ubicación de inventario",
      detalle: `location ${t.location_id}${t.variantes_sin_inventario > 0 ? ` · ${num(t.variantes_sin_inventario)} variantes sin nivel` : ""}`,
      estado: t.variantes_sin_inventario > 0 ? "parcial" : "listo",
    },
    {
      titulo: "Catálogo importado",
      detalle: `${num(t.productos)} productos · ${num(t.variantes)} variantes · ${num(t.imagenes)} imágenes`,
      estado: t.productos > 0 ? "listo" : "pendiente",
    },
    {
      titulo: "Webhooks llegando",
      detalle:
        t.ultimo_webhook === null
          ? "nunca llegó uno — puede que falte registrarlos"
          : `último ${hace(t.ultimo_webhook)}`,
      estado: t.ultimo_webhook === null ? "pendiente" : "listo",
    },
    {
      titulo: "Refresco de metadatos",
      detalle:
        t.last_refreshed_at === null
          ? "todavía sin correr"
          : `último ${hace(t.last_refreshed_at)} · el cron rota cada 15 min`,
      estado: t.last_refreshed_at === null ? "pendiente" : "listo",
    },
    {
      titulo: "Atributos del artista",
      detalle: con === 0 ? "no cargó ninguno: viajan vacíos" : `${con} de 10 con datos`,
      estado: con === 0 ? "parcial" : "listo",
    },
    {
      titulo: "Visible para el consumidor",
      detalle: t.consumidores.length
        ? `autorizada en ${t.consumidores.join(", ")}`
        : "ningún consumidor la tiene autorizada — responde 403",
      estado: t.consumidores.length ? "listo" : "pendiente",
    },
  ];
}

const CMD_NUEVO: Array<[string, string]> = [
  ["1 · Probar las credenciales", "bash scripts/test-mint.sh"],
  [
    "2 · Alta (con 000 lista las ubicaciones reales)",
    'npm run onboard -- --shop-domain <dominio> \\\n  --location-id 000 --artist-name "<Nombre>"',
  ],
  ["3 · Importar el catálogo", "npm run import-catalog -- --shop-id <id>"],
  [
    "4 · Webhooks, solo después del import",
    "npm run register-webhooks -- --shop-id <id> \\\n  --callback-url <url del receptor>",
  ],
  ["5 · Publicarlo al consumidor", "npm run add-shop-to-consumer -- \\\n  --consumer <nombre> --shop-id <id>"],
];

export function vistaAlta(ts: PanelTienda[], cs: ConsumidorRow[], sel: string | null): string {
  const t = ts.find((x) => x.id === sel) ?? null;

  const pills = [`<a href="/alta"${!t ? ' class="on"' : ""}>Artista nuevo</a>`]
    .concat(ts.map((x) => `<a href="/alta?shop=${esc(x.id)}"${t?.id === x.id ? ' class="on"' : ""}>${esc(x.artista)}</a>`))
    .join("");

  const cuerpo = t
    ? (() => {
        const etapas = etapasDe(t)
          .map(
            (e) => `<div style="display:flex;gap:11px;align-items:flex-start;padding:11px 0;border-bottom:1px solid #eeede8">
            <span style="color:${e.estado === "listo" ? "#1d9e75" : e.estado === "parcial" ? "#c99a3a" : "#c9c7bd"}">${e.estado === "listo" ? ICONO_OK : ICONO_ALERTA}</span>
            <span style="display:grid;gap:2px;flex-grow:1;min-width:0">
              <span style="font-size:14px;font-weight:600">${esc(e.titulo)}</span>
              <span class="meta">${esc(e.detalle)}</span>
            </span>
            ${chip(e.estado, CHIP_ETAPA[e.estado])}
          </div>`,
          )
          .join("");

        const pendientes = etapasDe(t).filter((e) => e.estado !== "listo");
        const cmds: Array<[string, string]> = [
          ["Reimportar el catálogo", `npm run import-catalog -- --shop-id ${t.id}`],
          ["Volver a registrar webhooks", `npm run register-webhooks -- --shop-id ${t.id} \\\n  --callback-url <url del receptor>`],
        ];
        if (!t.consumidores.length && cs.length) {
          cmds.unshift([
            "Publicarlo al consumidor",
            `npm run add-shop-to-consumer -- --consumer ${cs[0]!.name} --shop-id ${t.id}`,
          ]);
        }

        return `<div class="dos">
          <div class="card" style="padding:18px 22px;display:flex;flex-direction:column">
            <div style="display:flex;align-items:center;gap:10px;padding-bottom:6px">
              <h2>Pipeline</h2>${chip(pendientes.length ? `${pendientes.length} sin cerrar` : "completo", pendientes.length ? "ambar" : "verde")}
            </div>
            ${etapas}
          </div>
          <div class="card" style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">
            <h2>Comandos</h2>
            <span class="meta" style="line-height:1.5">El panel no ejecuta nada: estas son las líneas que se corren en la terminal del proyecto.</span>
            ${cmds.map(([p, c]) => `<div style="display:flex;flex-direction:column;gap:5px"><span class="meta">${esc(p)}</span><pre class="cmd">${esc(c)}</pre></div>`).join("")}
          </div>
        </div>`;
      })()
    : `<div class="dos">
        <div class="card" style="padding:18px 22px;display:flex;flex-direction:column;gap:12px">
          <h2>Antes de empezar</h2>
          <div class="aviso ambar">${ICONO_ALERTA}<span>El artista debe crear la app <strong>dentro del admin de su propia tienda</strong>. Si nace en una organización de Partners, Shopify rechaza la conexión con <code>shop_not_permitted</code> y hay que rehacerla.</span></div>
          <div class="aviso gris">${ICONO_ALERTA}<span>La tienda necesita un <strong>plan pagado activo</strong>: el Client Credentials grant no funciona en tiendas de prueba.</span></div>
          <span class="meta" style="line-height:1.5">Los datos que hay que pedirle: dominio <code>.myshopify.com</code>, Client ID y Client Secret. Ver <code>docs/conectar-tienda-shopify.md</code>.</span>
        </div>
        <div class="card" style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">
          <h2>Secuencia completa</h2>
          ${CMD_NUEVO.map(([p, c]) => `<div style="display:flex;flex-direction:column;gap:5px"><span class="meta">${esc(p)}</span><pre class="cmd">${esc(c)}</pre></div>`).join("")}
          <div class="aviso rojo">${ICONO_ALERTA}<span>El paso 5 se olvida en silencio: sin él la tienda queda sincronizada y el consumidor recibe 403 al pedirla.</span></div>
        </div>
      </div>`;

  return `<div class="titulo">
    <h1>Estado del alta</h1>
    <span class="meta">En qué punto del pipeline está cada artista y qué comando resuelve lo que falta.</span>
  </div>
  <div class="pills">${pills}</div>
  ${cuerpo}`;
}
