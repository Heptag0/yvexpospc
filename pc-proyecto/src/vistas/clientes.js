// YvexPOS — sección Clientes (administración pura: alta, edición, datos).
// Para abonar/cobrar deudas está el apartado Crédito.

import { invoke } from "@tauri-apps/api/core";
import { pesos, centavos, escapar } from "../util/formato.js";
import { verEstadoCuenta } from "./cuenta.js";
import { confirmar } from "../util/confirmar.js";

export function montarClientes(contenedor, sesion, cajaSesion, alSalir) {
  contenedor.innerHTML = "";
  contenedor.style.alignItems = "stretch";
  contenedor.style.justifyContent = "flex-start";

  const wrap = document.createElement("div");
  wrap.className = "cli";
  contenedor.appendChild(wrap);

  let clientes = [];
  let filtro = "";

  pintarEsqueleto();
  cargar();

  function pintarEsqueleto() {
    wrap.innerHTML = `
      <header class="inv-head">
        <div class="inv-head-izq">
          <button class="inv-volver" id="cli-volver" aria-label="Volver">←</button>
          <h1>Clientes</h1>
        </div>
        <div class="inv-head-der">
          <button class="btn-primario" id="cli-nuevo">+ Cliente</button>
        </div>
      </header>
      <div class="cli-stats" id="cli-stats" hidden></div>
      <div class="inv-barra">
        <input id="cli-buscar" class="inv-buscar" placeholder="Buscar por nombre o teléfono…" autocomplete="off" />
      </div>
      <div class="inv-tabla-wrap">
        <table class="inv-tabla">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Teléfono</th>
              <th class="num">Límite</th>
              <th class="num">Saldo</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="cli-tbody"></tbody>
        </table>
        <div id="cli-vacio" class="inv-vacio" hidden></div>
      </div>
    `;
    wrap.querySelector("#cli-volver").addEventListener("click", alSalir);
    wrap.querySelector("#cli-nuevo").addEventListener("click", () => abrirModalCliente(null));
    const buscar = wrap.querySelector("#cli-buscar");
    let t;
    buscar.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        filtro = buscar.value.trim();
        cargar();
      }, 180);
    });
  }

  async function cargar() {
    const tbody = wrap.querySelector("#cli-tbody");
    const vacio = wrap.querySelector("#cli-vacio");
    try {
      clientes = await invoke("cliente_listar", { filtro: filtro || null });
    } catch (e) {
      tbody.innerHTML = "";
      vacio.hidden = false;
      vacio.textContent = "Error al cargar clientes: " + e;
      return;
    }
    if (clientes.length === 0) {
      tbody.innerHTML = "";
      vacio.hidden = false;
      vacio.textContent = filtro ? "Sin resultados para “" + filtro + "”." : "Aún no hay clientes. Crea el primero con “+ Cliente”.";
      return;
    }
    vacio.hidden = true;
    // Franja de contexto: cuántos son y cuánto deben en conjunto (sin filtro).
    if (!filtro) {
      const conDeuda = clientes.filter((c) => c.saldo_centavos > 0);
      const stats = wrap.querySelector("#cli-stats");
      stats.hidden = false;
      stats.innerHTML = `
        <span><strong class="num">${clientes.length}</strong> cliente${clientes.length === 1 ? "" : "s"}</span>
        <span class="cli-stats-sep">·</span>
        <span><strong class="num">${conDeuda.length}</strong> con deuda</span>
        <span class="cli-stats-sep">·</span>
        <span><strong class="num">${pesos(conDeuda.reduce((s, c) => s + c.saldo_centavos, 0))}</strong> por cobrar</span>`;
    }
    tbody.innerHTML = clientes.map(fila).join("");
    tbody.querySelectorAll("[data-estado]").forEach((b) =>
      b.addEventListener("click", () => {
        const c = clientes.find((x) => x.id === b.dataset.estado);
        verEstadoCuenta(c, null); // sin onAbonar: aquí solo se consulta
      })
    );
    tbody.querySelectorAll("[data-editar]").forEach((b) =>
      b.addEventListener("click", () => {
        const c = clientes.find((x) => x.id === b.dataset.editar);
        abrirModalCliente(c);
      })
    );
  }

  function fila(c) {
    const debe = c.saldo_centavos > 0;
    const limite = c.limite_credito_centavos > 0 ? pesos(c.limite_credito_centavos) : "—";
    return `
      <tr>
        <td class="inv-nombre">${escapar(c.nombre)}</td>
        <td class="inv-codigo">${c.telefono ? escapar(c.telefono) : "—"}</td>
        <td class="num">${limite}</td>
        <td class="num"><span class="${debe ? "cli-debe" : "cli-aldia"}">${pesos(c.saldo_centavos)}</span></td>
        <td class="inv-acciones-col">
          <button class="btn-mini" data-estado="${c.id}">Estado</button>
          <button class="btn-mini" data-editar="${c.id}">Editar</button>
        </td>
      </tr>`;
  }

  function abrirModalCliente(cli) {
    const esEdicion = !!cli;
    const html = `
      <h2>${esEdicion ? "Editar cliente" : "Nuevo cliente"}</h2>
      <div class="m-grid">
        <label class="m-col2">Nombre
          <input id="cm-nombre" value="${cli ? escapar(cli.nombre) : ""}" />
        </label>
        <label>Teléfono
          <input id="cm-tel" value="${cli && cli.telefono ? escapar(cli.telefono) : ""}" placeholder="Opcional" />
        </label>
        <label>Límite de crédito
          <input id="cm-limite" inputmode="decimal" value="${cli && cli.limite_credito_centavos ? centavos(cli.limite_credito_centavos) : ""}" placeholder="0 = sin límite" />
        </label>
        <label class="m-col2">Notas
          <input id="cm-notas" value="${cli && cli.notas ? escapar(cli.notas) : ""}" placeholder="Opcional" />
        </label>
      </div>
      <p class="m-error" id="cm-error"></p>
      <div class="m-acciones">
        ${esEdicion && cli.saldo_centavos === 0 ? '<button class="btn-peligro" id="cm-eliminar">Eliminar</button>' : "<span></span>"}
        <div>
          <button class="btn-sec" id="cm-cancelar">Cancelar</button>
          <button class="btn-primario" id="cm-guardar">${esEdicion ? "Guardar" : "Crear"}</button>
        </div>
      </div>
    `;
    const modal = abrirModal(html);
    const $ = (s) => modal.querySelector(s);
    setTimeout(() => $("#cm-nombre").focus(), 50);
    $("#cm-cancelar").addEventListener("click", cerrarModal);

    if (esEdicion && cli.saldo_centavos === 0) {
      $("#cm-eliminar").addEventListener("click", async () => {
        // confirm() nativo no funciona en Tauri: confirmación propia compartida.
        const ok = await confirmar(
          `¿Eliminar a ${cli.nombre}? Sus datos de contacto se pierden; el historial de ventas no se toca.`,
          { titulo: "Eliminar cliente", ok: "Eliminar", peligro: true }
        );
        if (!ok) return;
        try {
          await invoke("cliente_eliminar", { id: cli.id });
          cerrarModal();
          cargar();
        } catch (e) {
          $("#cm-error").textContent = String(e);
        }
      });
    }

    $("#cm-guardar").addEventListener("click", async () => {
      const err = $("#cm-error");
      err.textContent = "";
      const nombre = $("#cm-nombre").value.trim();
      if (!nombre) return (err.textContent = "El nombre es obligatorio.");
      const limV = parseFloat(($("#cm-limite").value || "0").replace(",", "."));
      const limite = isNaN(limV) ? 0 : Math.round(limV * 100);
      const base = {
        nombre,
        telefono: $("#cm-tel").value.trim() || null,
        notas: $("#cm-notas").value.trim() || null,
        limite_credito_centavos: limite,
      };
      try {
        if (esEdicion) {
          await invoke("cliente_editar", { datos: { id: cli.id, ...base } });
        } else {
          await invoke("cliente_crear", { datos: base });
        }
        cerrarModal();
        cargar();
      } catch (e) {
        err.textContent = String(e);
      }
    });
  }
}

let modalCli = null;
function abrirModal(html) {
  if (modalCli) cerrarModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(overlay);
  modalCli = overlay;
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) cerrarModal();
  });
  return overlay.querySelector(".modal");
}
function cerrarModal() {
  if (modalCli) {
    modalCli.remove();
    modalCli = null;
  }
}
