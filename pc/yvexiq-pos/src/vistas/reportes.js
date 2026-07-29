// YvexPOS — módulo Reportes (solo dueño/gerente).
// Métricas, desgloses y gráficos por periodo. Ganancia con costo histórico.

import { invoke } from "@tauri-apps/api/core";
import { pesos, escapar } from "../util/formato.js";
import { donaSVG, barrasSVG, lineaSVG } from "./graficos.js";

const ETIQUETA_METODO = {
  efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia",
  credito: "Crédito", vale: "Vale",
};
const COLOR_METODO = {
  efectivo: "#22c55e", tarjeta: "#3b82f6", transferencia: "#06b6d4",
  credito: "#f59e0b", vale: "#a855f7",
};

export function montarReportes(contenedor, sesion, alSalir) {
  contenedor.innerHTML = "";
  contenedor.style.alignItems = "stretch";
  contenedor.style.justifyContent = "flex-start";

  const wrap = document.createElement("div");
  wrap.className = "rep";
  contenedor.appendChild(wrap);

  let periodo = "mes_actual";

  pintarEsqueleto();
  cargar();

  function pintarEsqueleto() {
    wrap.innerHTML = `
      <header class="inv-head">
        <div class="inv-head-izq">
          <button class="inv-volver" id="rep-volver" aria-label="Volver">←</button>
          <h1>Reportes</h1>
        </div>
      </header>
      <div class="rep-periodos" id="rep-periodos">
        ${botonPeriodo("hoy", "Hoy")}
        ${botonPeriodo("semana_actual", "Semana")}
        ${botonPeriodo("mes_actual", "Mes actual")}
        ${botonPeriodo("mes_anterior", "Mes anterior")}
        ${botonPeriodo("anio_actual", "Año")}
        ${botonPeriodo("personalizado", "Personalizado")}
      </div>
      <div class="rep-rango" id="rep-rango" hidden>
        <label>Desde <input type="date" id="rep-desde" /></label>
        <label>Hasta <input type="date" id="rep-hasta" /></label>
        <button class="btn-primario" id="rep-aplicar">Aplicar</button>
      </div>
      <div id="rep-cuerpo"><div class="inv-vacio">Cargando…</div></div>
    `;
    wrap.querySelector("#rep-volver").addEventListener("click", alSalir);
    wrap.querySelectorAll("[data-periodo]").forEach((b) =>
      b.addEventListener("click", () => {
        periodo = b.dataset.periodo;
        wrap.querySelectorAll("[data-periodo]").forEach((x) => x.classList.remove("rep-periodo--activo"));
        b.classList.add("rep-periodo--activo");
        const rango = wrap.querySelector("#rep-rango");
        if (periodo === "personalizado") {
          rango.hidden = false;
        } else {
          rango.hidden = true;
          cargar();
        }
      })
    );
    wrap.querySelector("#rep-aplicar").addEventListener("click", cargar);
  }

  function botonPeriodo(id, label) {
    const activo = id === periodo ? "rep-periodo--activo" : "";
    return `<button class="rep-periodo ${activo}" data-periodo="${id}">${label}</button>`;
  }

  function rangoFechas() {
    const ahora = new Date();
    let inicio, fin;
    const iso = (d) => d.toISOString();
    const inicioDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
    const finDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

    switch (periodo) {
      case "hoy":
        inicio = inicioDia(ahora); fin = finDia(ahora); break;
      case "semana_actual": {
        const dow = (ahora.getDay() + 6) % 7; // lunes = 0
        const lunes = new Date(ahora); lunes.setDate(ahora.getDate() - dow);
        inicio = inicioDia(lunes); fin = finDia(ahora); break;
      }
      case "mes_actual":
        inicio = new Date(ahora.getFullYear(), ahora.getMonth(), 1, 0, 0, 0);
        fin = finDia(ahora); break;
      case "mes_anterior":
        inicio = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1, 0, 0, 0);
        fin = new Date(ahora.getFullYear(), ahora.getMonth(), 0, 23, 59, 59, 999); break;
      case "anio_actual":
        inicio = new Date(ahora.getFullYear(), 0, 1, 0, 0, 0); fin = finDia(ahora); break;
      case "personalizado": {
        const d = wrap.querySelector("#rep-desde").value;
        const h = wrap.querySelector("#rep-hasta").value;
        if (!d || !h) return null;
        inicio = new Date(d + "T00:00:00"); fin = new Date(h + "T23:59:59"); break;
      }
      default:
        inicio = inicioDia(ahora); fin = finDia(ahora);
    }
    return { inicio: iso(inicio), fin: iso(fin) };
  }

  async function cargar() {
    const cuerpo = wrap.querySelector("#rep-cuerpo");
    cuerpo.innerHTML = '<div class="inv-vacio">Calculando…</div>';
    const rango = rangoFechas();
    if (!rango) {
      cuerpo.innerHTML = '<div class="inv-vacio">Selecciona ambas fechas.</div>';
      return;
    }
    let rep;
    try {
      rep = await invoke("reporte_generar", {
        rol: sesion.rol,
        inicio: rango.inicio,
        fin: rango.fin,
      });
    } catch (e) {
      cuerpo.innerHTML = '<div class="inv-vacio">Error: ' + escapar(String(e)) + "</div>";
      return;
    }
    // Periodo anterior equivalente (misma duración, inmediatamente antes)
    // para la comparativa del héroe. Es opcional: si falla, no hay tendencia.
    let repPrevio = null;
    try {
      const ini = new Date(rango.inicio), fin = new Date(rango.fin);
      const dur = fin.getTime() - ini.getTime();
      repPrevio = await invoke("reporte_generar", {
        rol: sesion.rol,
        inicio: new Date(ini.getTime() - dur - 1).toISOString(),
        fin: new Date(ini.getTime() - 1).toISOString(),
      });
    } catch (e) {
      repPrevio = null;
    }
    render(rep, repPrevio);
  }

  function render(rep, repPrevio) {
    const m = rep.metricas;
    const cuerpo = wrap.querySelector("#rep-cuerpo");
    cuerpo.innerHTML = "";

    if (m.num_ventas === 0) {
      cuerpo.innerHTML = `
        <div class="rep-vacio">
          <div class="rep-vacio-ico">📊</div>
          <b>No hubo ventas en este periodo.</b>
          <span>Prueba con otro rango de fechas.</span>
        </div>`;
      return;
    }

    // ---------- HÉROE: ¿cuánto se vendió? ----------
    const prev = repPrevio ? repPrevio.metricas : null;
    const hero = document.createElement("div");
    hero.className = "rep-hero";
    hero.innerHTML = `
      <div class="rep-hero-venta con-filo">
        <span class="rep-hero-label">Vendido en el periodo</span>
        <span class="rep-hero-valor num">${pesos(m.total_vendido_centavos)}</span>
        <div class="rep-hero-pie">
          ${tendenciaHTML(m.total_vendido_centavos, prev ? prev.total_vendido_centavos : null)}
          <span class="rep-hero-sub num">${m.num_ventas} venta${m.num_ventas === 1 ? "" : "s"} · promedio ${pesos(m.venta_promedio_centavos)}</span>
        </div>
      </div>
      <div class="rep-hero-lado">
        <div class="rep-hero-mini con-filo rep-hero-mini--ganancia">
          <span class="rep-hero-label">Ganancia</span>
          <span class="rep-hero-valor-mini num">${pesos(m.ganancia_centavos)}</span>
          ${tendenciaHTML(m.ganancia_centavos, prev ? prev.ganancia_centavos : null)}
        </div>
        <div class="rep-hero-mini con-filo">
          <span class="rep-hero-label">Margen</span>
          <span class="rep-hero-valor-mini num">${m.margen_promedio_pct.toFixed(1)}%</span>
          <span class="rep-hero-sub num">${fmtNum(m.articulos_vendidos)} artículos</span>
        </div>
      </div>
    `;
    cuerpo.appendChild(hero);
    // Las cifras del héroe ruedan de 0 a su valor: la firma de la casa.
    ruedaPesos(hero.querySelector(".rep-hero-valor"), m.total_vendido_centavos);
    ruedaPesos(hero.querySelector(".rep-hero-mini--ganancia .rep-hero-valor-mini"), m.ganancia_centavos);

    // ---------- ¿EN QUÉ se vendió? ----------
    cuerpo.appendChild(tituloNarrativa("¿En qué se vendió?"));
    const fila1 = document.createElement("div");
    fila1.className = "rep-fila rep-fila--2";
    const panelMetodos = panel("Por forma de pago");
    panelMetodos.cuerpo.appendChild(donaSVG(rep.por_metodo.map((p) => ({
      label: ETIQUETA_METODO[p.metodo] || p.metodo,
      valor: p.monto_centavos,
      color: COLOR_METODO[p.metodo],
    })), { titulo: "ingresos" }));
    fila1.appendChild(panelMetodos.el);
    const panelCat = panel("Por departamento");
    panelCat.cuerpo.appendChild(barrasSVG(rep.por_categoria.slice(0, 8).map((c) => ({
      label: c.categoria,
      valor: c.vendido_centavos,
      valor2: c.ganancia_centavos,
      sub: `${fmtNum(c.articulos)} artículos`,
    })), { etiquetaValor2: "Ganancia" }));
    fila1.appendChild(panelCat.el);
    cuerpo.appendChild(fila1);

    // ---------- ¿CUÁNDO se vendió? ----------
    cuerpo.appendChild(tituloNarrativa("¿Cuándo se vendió?"));
    const fila2 = document.createElement("div");
    fila2.className = "rep-fila rep-fila--2";
    const panelDia = panel("Tendencia por día");
    panelDia.cuerpo.appendChild(lineaSVG(rep.por_dia.map((p) => ({
      etiqueta: fmtFechaCorta(p.etiqueta),
      valor: p.vendido_centavos,
    })), { alto: 220 }));
    fila2.appendChild(panelDia.el);
    const panelHora = panel("Por hora del día");
    panelHora.cuerpo.appendChild(barrasSVG(rep.por_hora.map((p) => ({
      label: p.etiqueta + "h", // barrasSVG espera `label` (etiqueta es de lineaSVG)
      valor: p.vendido_centavos,
    })), {}));
    fila2.appendChild(panelHora.el);
    cuerpo.appendChild(fila2);

    // ---------- ¿QUÉ productos? (tabla con barras integradas) ----------
    cuerpo.appendChild(tituloNarrativa("¿Qué productos movieron el dinero?"));
    const panelTop = panel("Los más vendidos del periodo");
    const maxVendido = Math.max(...rep.productos_top.map((p) => p.vendido_centavos), 1);
    const tabla = document.createElement("table");
    tabla.className = "rep-tabla rep-tabla--barras";
    tabla.innerHTML = `
      <thead><tr><th>Producto</th><th class="num">Cantidad</th><th class="num">Vendido</th><th class="num">Ganancia</th></tr></thead>
      <tbody>
        ${rep.productos_top.map((p) => `
          <tr>
            <td class="rep-prod-celda">
              <span class="rep-prod-nombre">${escapar(p.nombre)}</span>
              <span class="rep-prod-barra" style="width:${((p.vendido_centavos / maxVendido) * 100).toFixed(1)}%"></span>
            </td>
            <td class="num">${fmtNum(p.cantidad)}</td>
            <td class="num">${pesos(p.vendido_centavos)}</td>
            <td class="num rep-ganancia">${pesos(p.ganancia_centavos)}</td>
          </tr>`).join("")}
      </tbody>`;
    panelTop.cuerpo.appendChild(tabla);
    cuerpo.appendChild(panelTop.el);
  }

  // Chip de tendencia contra el periodo anterior equivalente. Silencio sin
  // referencia; verde celebra, neutro informa (dato, no regaño).
  function tendenciaHTML(actual, anterior) {
    if (anterior == null || anterior <= 0) return "";
    const pct = ((actual - anterior) / anterior) * 100;
    if (!isFinite(pct)) return "";
    const arriba = pct >= 0;
    return `<span class="rep-tend ${arriba ? "rep-tend--arriba" : "rep-tend--abajo"}">
      ${arriba ? "↑" : "↓"} ${Math.abs(pct).toFixed(0)}% vs periodo anterior</span>`;
  }

  function ruedaPesos(el, hasta) {
    if (!el) return;
    const t0 = performance.now(), dur = 600;
    const paso = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = pesos(Math.round(hasta * e));
      if (p < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }

  function tituloNarrativa(txt) {
    const el = document.createElement("h2");
    el.className = "rep-narrativa";
    el.textContent = txt;
    return el;
  }

  function metricaCard(label, valor, extra = "") {
    return `<div class="rep-card ${extra}">
      <span class="rep-card-label">${label}</span>
      <span class="rep-card-valor num">${valor}</span>
    </div>`;
  }
  function panel(titulo) {
    const el = document.createElement("div");
    el.className = "rep-panel";
    el.innerHTML = `<div class="rep-panel-titulo">${titulo}</div><div class="rep-panel-cuerpo"></div>`;
    return { el, cuerpo: el.querySelector(".rep-panel-cuerpo") };
  }
}

function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
function fmtFechaCorta(iso) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}
