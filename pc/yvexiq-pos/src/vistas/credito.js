// YvexPOS — apartado Crédito (cobranza).
// Enfocado en la deuda: quién debe, cuánto se debe en total, y abonar rápido.

import { invoke } from "@tauri-apps/api/core";
import { pesos, escapar } from "../util/formato.js";
import { verEstadoCuenta, abrirAbono } from "./cuenta.js";

export function montarCredito(contenedor, sesion, cajaSesion, alSalir) {
  contenedor.innerHTML = "";
  contenedor.style.alignItems = "stretch";
  contenedor.style.justifyContent = "flex-start";

  const wrap = document.createElement("div");
  wrap.className = "cli";
  contenedor.appendChild(wrap);

  let deudores = [];
  let filtro = "";

  pintarEsqueleto();
  cargar();

  function pintarEsqueleto() {
    wrap.innerHTML = `
      <header class="inv-head">
        <div class="inv-head-izq">
          <button class="inv-volver" id="cr-volver" aria-label="Volver">←</button>
          <h1>Crédito</h1>
        </div>
      </header>
      <div class="cr-resumen" id="cr-resumen"></div>
      <div class="inv-barra">
        <input id="cr-buscar" class="inv-buscar" placeholder="Buscar deudor…" autocomplete="off" />
      </div>
      <div class="inv-tabla-wrap">
        <table class="inv-tabla">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Teléfono</th>
              <th class="num">Límite</th>
              <th class="num">Debe</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="cr-tbody"></tbody>
        </table>
        <div id="cr-vacio" class="inv-vacio" hidden></div>
      </div>
    `;
    wrap.querySelector("#cr-volver").addEventListener("click", alSalir);
    const buscar = wrap.querySelector("#cr-buscar");
    let t;
    buscar.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        filtro = buscar.value.trim();
        render();
      }, 150);
    });
  }

  let todos = [];
  async function cargar() {
    try {
      todos = await invoke("cliente_listar", { filtro: null });
    } catch (e) {
      todos = [];
    }
    render();
  }

  function render() {
    // Solo deudores (saldo > 0).
    let lista = todos.filter((c) => c.saldo_centavos > 0);
    // Total por cobrar de TODA la tienda (antes de filtrar por búsqueda).
    const totalPorCobrar = lista.reduce((s, c) => s + c.saldo_centavos, 0);
    const numDeudores = lista.length;

    if (filtro) {
      const f = filtro.toLowerCase();
      lista = lista.filter(
        (c) => c.nombre.toLowerCase().includes(f) || (c.telefono || "").includes(filtro)
      );
    }
    // Ordenar por saldo descendente (los que más deben primero).
    lista.sort((a, b) => b.saldo_centavos - a.saldo_centavos);
    deudores = lista;

    // Héroe de cobranza + los que exigen atención primero.
    const sobreLimite = lista.filter((c) =>
      c.limite_credito_centavos > 0 && c.saldo_centavos > c.limite_credito_centavos);
    const resumen = wrap.querySelector("#cr-resumen");
    resumen.innerHTML = `
      <div class="cr-hero con-filo">
        <span class="cr-card-label">Dinero en la calle</span>
        <span class="cr-hero-valor num" id="cr-hero-valor">${pesos(0)}</span>
        <span class="cr-hero-sub num">${numDeudores} cliente${numDeudores === 1 ? "" : "s"} con deuda${sobreLimite.length ? ` · ${sobreLimite.length} sobre su límite` : ""}</span>
      </div>
      ${sobreLimite.length ? `
      <div class="cr-atencion con-filo">
        <span class="cr-card-label">Cobrar primero</span>
        ${sobreLimite.slice(0, 3).map((c) => `
          <button class="cr-atencion-fila" data-abonar-rapido="${c.id}">
            <span class="cr-atencion-nombre">${escapar(c.nombre)}</span>
            <span class="cli-debe num">${pesos(c.saldo_centavos)}</span>
          </button>`).join("")}
      </div>` : ""}
    `;
    // La cifra del héroe rueda de 0 a su valor.
    {
      const el = wrap.querySelector("#cr-hero-valor");
      const t0 = performance.now(), dur = 600;
      const paso = (t) => {
        const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        el.textContent = pesos(Math.round(totalPorCobrar * e));
        if (p < 1) requestAnimationFrame(paso);
      };
      requestAnimationFrame(paso);
    }
    resumen.querySelectorAll("[data-abonar-rapido]").forEach((b) =>
      b.addEventListener("click", () => {
        const c = todos.find((x) => x.id === b.dataset.abonarRapido);
        if (c) abrirAbono(c, sesion, cajaSesion, cargar);
      }));

    const tbody = wrap.querySelector("#cr-tbody");
    const vacio = wrap.querySelector("#cr-vacio");
    if (deudores.length === 0) {
      tbody.innerHTML = "";
      vacio.hidden = false;
      vacio.textContent = filtro
        ? "Ningún deudor coincide con “" + filtro + "”."
        : "Nadie debe nada. Todo cobrado. 👍";
      return;
    }
    vacio.hidden = true;
    tbody.innerHTML = deudores.map(fila).join("");
    tbody.querySelectorAll("[data-abonar]").forEach((b) =>
      b.addEventListener("click", () => {
        const c = deudores.find((x) => x.id === b.dataset.abonar);
        abrirAbono(c, sesion, cajaSesion, cargar);
      })
    );
    tbody.querySelectorAll("[data-estado]").forEach((b) =>
      b.addEventListener("click", () => {
        const c = deudores.find((x) => x.id === b.dataset.estado);
        verEstadoCuenta(c, (cli) => abrirAbono(cli, sesion, cajaSesion, cargar));
      })
    );
  }

  function fila(c) {
    const limite = c.limite_credito_centavos > 0 ? pesos(c.limite_credito_centavos) : "—";
    const sobreLimite = c.limite_credito_centavos > 0 && c.saldo_centavos > c.limite_credito_centavos;
    // Barra de uso del límite bajo el nombre: de un vistazo, quién está al tope.
    const pct = c.limite_credito_centavos > 0
      ? Math.min(100, (c.saldo_centavos / c.limite_credito_centavos) * 100) : 0;
    const tonoBarra = pct >= 100 ? "cr-uso--tope" : pct >= 70 ? "cr-uso--alto" : "cr-uso--ok";
    return `
      <tr>
        <td class="inv-nombre cr-nombre-celda">
          ${escapar(c.nombre)}
          ${c.limite_credito_centavos > 0 ? `<span class="cr-uso ${tonoBarra}" style="width:${pct.toFixed(0)}%"></span>` : ""}
        </td>
        <td class="inv-codigo">${c.telefono ? escapar(c.telefono) : "—"}</td>
        <td class="num">${limite}</td>
        <td class="num"><span class="cli-debe">${pesos(c.saldo_centavos)}</span>${sobreLimite ? ' <span class="cr-alerta">!</span>' : ""}</td>
        <td class="inv-acciones-col">
          <button class="btn-mini btn-mini--ok" data-abonar="${c.id}">Abonar</button>
          <button class="btn-mini" data-estado="${c.id}">Estado</button>
        </td>
      </tr>`;
  }
}
