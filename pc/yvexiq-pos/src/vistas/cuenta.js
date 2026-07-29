// YvexPOS — cuenta de cliente (estado + abono), compartido entre vistas.
// Lo usan tanto Clientes (ver estado) como Crédito (abonar).

import { invoke } from "@tauri-apps/api/core";
import { pesos, centavos, escapar } from "../util/formato.js";

let modalCuenta = null;

export function abrirModalCuenta(html) {
  if (modalCuenta) cerrarModalCuenta();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(overlay);
  modalCuenta = overlay;
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) cerrarModalCuenta();
  });
  return overlay.querySelector(".modal");
}
export function cerrarModalCuenta() {
  if (modalCuenta) {
    modalCuenta.remove();
    modalCuenta = null;
  }
}

/// Muestra el estado de cuenta de un cliente. `onAbonar` opcional: si se pasa
/// y el cliente debe, muestra botón "Registrar abono" que llama a ese callback.
export async function verEstadoCuenta(cli, onAbonar) {
  let movimientos = [];
  try {
    movimientos = await invoke("cliente_estado_cuenta", { clienteId: cli.id });
  } catch (e) {
    movimientos = [];
  }
  const debe = cli.saldo_centavos > 0;
  const listaHtml =
    movimientos.length === 0
      ? '<li class="ec-vacio">Sin movimientos.</li>'
      : movimientos
          .map((m) => {
            const esCargo = m.tipo === "cargo";
            const signo = esCargo ? "+" : "−";
            const cls = esCargo ? "ec-cargo" : "ec-abono";
            const etq = esCargo ? "Venta a crédito" : "Abono" + (m.metodo ? " (" + m.metodo + ")" : "");
            const fecha = new Date(m.creado_en).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
            return `
        <li class="ec-mov">
          <div class="ec-mov-info">
            <span class="ec-mov-tipo ${cls}">${etq}</span>
            <span class="ec-mov-fecha">${fecha}</span>
          </div>
          <div class="ec-mov-montos">
            <span class="num ${cls}">${signo}${pesos(m.monto_centavos)}</span>
            <span class="ec-mov-saldo num">saldo ${pesos(m.saldo_resultante_centavos)}</span>
          </div>
        </li>`;
          })
          .join("");

  const puedeAbonar = debe && typeof onAbonar === "function";
  const html = `
    <div class="ec-cabecera">
      <h2>${escapar(cli.nombre)}</h2>
      <div class="ec-saldo ${debe ? "cli-debe" : "cli-aldia"}">
        <span>Saldo</span>
        <strong class="num">${pesos(cli.saldo_centavos)}</strong>
      </div>
    </div>
    ${puedeAbonar ? '<button class="btn-primario ec-abonar" id="ec-abonar">Registrar abono</button>' : (debe ? "" : '<p class="ec-aldia-msg">✓ Este cliente está al día.</p>')}
    <div class="ec-titulo">Movimientos</div>
    <ul class="ec-lista">${listaHtml}</ul>
    <div class="m-acciones"><span></span><button class="btn-sec" id="ec-cerrar">Cerrar</button></div>
  `;
  const modal = abrirModalCuenta(html);
  return new Promise((resolve) => {
    modal.querySelector("#ec-cerrar").addEventListener("click", () => {
      cerrarModalCuenta();
      resolve("cerrado");
    });
    modal.querySelector("#ec-abonar")?.addEventListener("click", () => {
      cerrarModalCuenta();
      onAbonar(cli);
      resolve("abonar");
    });
  });
}

/// Modal de abono. `sesion` y `cajaSesion` para registrar quién/dónde.
/// `onListo` se llama tras un abono exitoso (para recargar la vista).
export function abrirAbono(cli, sesion, cajaSesion, onListo) {
  const html = `
    <h2>Registrar abono</h2>
    <p class="m-sub">${escapar(cli.nombre)} · debe <strong>${pesos(cli.saldo_centavos)}</strong></p>
    <label>Monto del abono
      <input id="ab-monto" inputmode="decimal" placeholder="0.00" />
    </label>
    <div class="ab-rapido">
      <button class="cobro-chip" id="ab-todo">Pagar todo ${pesos(cli.saldo_centavos)}</button>
    </div>
    <div class="ab-metodos">
      <button class="aj-tipo aj-tipo--activo" data-met="efectivo">Efectivo</button>
      <button class="aj-tipo" data-met="tarjeta">Tarjeta</button>
      <button class="aj-tipo" data-met="transferencia">Transferencia</button>
    </div>
    <p class="m-preview" id="ab-preview"></p>
    <p class="m-error" id="ab-error"></p>
    <div class="m-acciones"><span></span><div>
      <button class="btn-sec" id="ab-cancelar">Cancelar</button>
      <button class="btn-primario" id="ab-ok">Registrar abono</button>
    </div></div>
  `;
  const modal = abrirModalCuenta(html);
  const $ = (s) => modal.querySelector(s);
  let metodo = "efectivo";
  setTimeout(() => $("#ab-monto").focus(), 50);

  function preview() {
    const v = parseFloat(($("#ab-monto").value || "0").replace(",", "."));
    if (isNaN(v) || v <= 0) return ($("#ab-preview").textContent = "");
    const cent = Math.round(v * 100);
    const nuevo = cli.saldo_centavos - cent;
    $("#ab-preview").textContent = nuevo >= 0 ? `Saldo restante: ${pesos(nuevo)}` : "El abono supera la deuda.";
    $("#ab-preview").className = "m-preview" + (nuevo < 0 ? " m-preview--mal" : "");
  }
  $("#ab-monto").addEventListener("input", preview);
  $("#ab-todo").addEventListener("click", () => {
    $("#ab-monto").value = centavos(cli.saldo_centavos);
    preview();
  });
  modal.querySelectorAll(".ab-metodos .aj-tipo").forEach((b) =>
    b.addEventListener("click", () => {
      modal.querySelectorAll(".ab-metodos .aj-tipo").forEach((x) => x.classList.remove("aj-tipo--activo"));
      b.classList.add("aj-tipo--activo");
      metodo = b.dataset.met;
    })
  );
  $("#ab-cancelar").addEventListener("click", cerrarModalCuenta);
  $("#ab-ok").addEventListener("click", async () => {
    const err = $("#ab-error");
    err.textContent = "";
    const v = parseFloat(($("#ab-monto").value || "0").replace(",", "."));
    if (isNaN(v) || v <= 0) return (err.textContent = "Ingresa un monto válido.");
    const cent = Math.round(v * 100);
    try {
      await invoke("cliente_abonar", {
        datos: {
          cliente_id: cli.id,
          monto_centavos: cent,
          metodo,
          usuario_pos_id: sesion.id,
          caja_sesion_id: cajaSesion ? cajaSesion.id : null,
          motivo: null,
        },
      });
      cerrarModalCuenta();
      if (typeof onListo === "function") onListo();
    } catch (e) {
      err.textContent = String(e);
    }
  });
}
