// YvexPOS — módulo Devoluciones y cancelaciones.
// Buscar venta por folio → elegir qué devolver y cuánto → reembolso según método.
// Cancelación = devolución total con motivo "Cancelación".

import { invoke } from "@tauri-apps/api/core";
import { pesos, escapar } from "../util/formato.js";
import { verTicket } from "./ticket.js";
import { confirmar } from "../util/confirmar.js";

const ETIQUETA_METODO = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  credito: "Crédito (baja deuda)",
};

export function montarDevoluciones(contenedor, sesion, cajaSesion, alSalir) {
  contenedor.innerHTML = "";
  contenedor.style.alignItems = "stretch";
  contenedor.style.justifyContent = "flex-start";

  const wrap = document.createElement("div");
  wrap.className = "dev";
  contenedor.appendChild(wrap);

  let venta = null;
  // Estado de selección: { venta_linea_id: cantidad_a_devolver }
  let seleccion = {};
  let ventasDia = [];
  let filtroEstado = "todas";

  pintarLista();

  async function pintarLista() {
    wrap.innerHTML = `
      <header class="inv-head">
        <div class="inv-head-izq">
          <button class="inv-volver" id="dev-volver" aria-label="Volver">←</button>
          <h1>Ventas del día</h1>
        </div>
      </header>
      <p class="dev-sub">Toca un ticket para devolver productos o cancelar la venta.</p>
      <div class="dev-filtros" id="dev-filtros" hidden></div>
      <p class="m-error" id="dev-error"></p>
      <div id="dev-lista-tickets"><div class="inv-vacio">Cargando ventas…</div></div>
    `;
    wrap.querySelector("#dev-volver").addEventListener("click", alSalir);
    await cargarVentasDia();
  }

  async function cargarVentasDia() {
    const cont = wrap.querySelector("#dev-lista-tickets");
    try {
      ventasDia = await invoke("ventas_del_dia", {
        rol: sesion.rol,
        cajaSesionId: cajaSesion.id,
      });
    } catch (e) {
      cont.innerHTML = '<div class="inv-vacio">Error: ' + escapar(String(e)) + "</div>";
      return;
    }
    if (ventasDia.length === 0) {
      cont.innerHTML = '<div class="inv-vacio">No hay ventas hoy todavía.</div>';
      return;
    }
    // Filtros por estado con conteo: el día de un vistazo.
    const cuenta = (est) => ventasDia.filter((v) => est.includes(v.estado)).length;
    const filtros = [
      { id: "todas", n: "Todas", c: ventasDia.length },
      { id: "completada", n: "Completadas", c: cuenta(["completada"]) },
      { id: "devuelta", n: "Con devolución", c: cuenta(["devuelta_parcial", "devuelta_total"]) },
      { id: "cancelada", n: "Canceladas", c: cuenta(["cancelada"]) },
    ];
    const zonaF = wrap.querySelector("#dev-filtros");
    zonaF.hidden = false;
    zonaF.innerHTML = filtros.map((f) => `
      <button class="dev-filtro ${f.id === filtroEstado ? "dev-filtro--activo" : ""}" data-filtro="${f.id}">
        ${f.n} <span class="num">${f.c}</span>
      </button>`).join("");
    zonaF.querySelectorAll("[data-filtro]").forEach((b) =>
      b.addEventListener("click", () => {
        filtroEstado = b.dataset.filtro;
        cargarVentasDia();
      }));
    const visibles = ventasDia.filter((v) =>
      filtroEstado === "todas" ? true :
      filtroEstado === "devuelta" ? (v.estado === "devuelta_parcial" || v.estado === "devuelta_total") :
      v.estado === filtroEstado);
    if (visibles.length === 0) {
      cont.innerHTML = '<div class="inv-vacio">Ninguna venta con ese estado hoy.</div>';
      return;
    }
    cont.innerHTML = `<div class="dev-tickets">${visibles.map(ticket).join("")}</div>`;
    cont.querySelectorAll("[data-ticket]").forEach((b) =>
      b.addEventListener("click", () => abrirTicket(b.dataset.ticket))
    );
    cont.querySelectorAll("[data-reimprimir]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        verTicket(null, undefined, b.dataset.reimprimir);
      })
    );
  }

  // Etiqueta de quién cobró: siempre el nombre del cajero; si la venta bajó
  // de otra caja por sync, se prefija "Otra caja ·" para no confundirla con
  // las cobradas aquí. ("Otra caja" solo, cuando el nombre aún no ha llegado.)
  function etiquetaQuien(v) {
    if (v.origen !== "otra") return escapar(v.cajero);
    if (!v.cajero || v.cajero === "Otra caja") return "Otra caja";
    return `Otra caja · ${escapar(v.cajero)}`;
  }

  function ticket(v) {
    const hora = new Date(v.creado_en).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    const cerrada = v.estado === "devuelta_total" || v.estado === "cancelada";
    return `
      <div class="dev-ticket-wrap">
        <button class="dev-ticket ${cerrada ? "dev-ticket--cerrada" : ""} ${v.origen === "otra" ? "dev-ticket--otra" : ""}" data-ticket="${v.id}">
          <div class="dev-ticket-cab">
            <span class="dev-ticket-folio">#${v.folio}</span>
            <span class="dev-ticket-hora">${hora}</span>
          </div>
          <div class="dev-ticket-quien ${v.origen === "otra" ? "dev-ticket-quien--otra" : ""}">${etiquetaQuien(v)}</div>
          <div class="dev-ticket-total num">${pesos(v.total_centavos)}</div>
          <div class="dev-ticket-estado dev-estado--${v.estado}">${etiquetaEstado(v.estado)}</div>
        </button>
        <button class="dev-ticket-reimprimir" data-reimprimir="${v.id}">🖨 Reimprimir</button>
      </div>`;
  }

  async function abrirTicket(ventaId) {
    const err = wrap.querySelector("#dev-error");
    if (err) err.textContent = "";
    try {
      venta = await invoke("devolucion_buscar_venta", {
        folio: null,
        ventaId,
        rol: sesion.rol,
        cajaSesionId: cajaSesion.id,
      });
    } catch (e) {
      venta = null;
      await pintarLista();
      const e2 = wrap.querySelector("#dev-error");
      if (e2) e2.textContent = String(e);
      return;
    }
    if (!venta) return;
    seleccion = {};
    pintarDetalle();
  }

  function pintarDetalle() {
    wrap.innerHTML = `
      <header class="inv-head">
        <div class="inv-head-izq">
          <button class="inv-volver" id="dev-volver-lista" aria-label="Volver">←</button>
          <h1>Venta #${venta.folio}</h1>
        </div>
      </header>
      <p class="m-error" id="dev-error"></p>
      <div id="dev-cuerpo"></div>
    `;
    wrap.querySelector("#dev-volver-lista").addEventListener("click", pintarLista);
    renderVenta();
  }

  function renderVenta() {
    const v = venta;
    const yaCerrada = v.estado === "devuelta_total" || v.estado === "cancelada";
    const fecha = new Date(v.creado_en).toLocaleString("es-MX", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const metodosTxt = v.metodos_pago.map((m) => `${ETIQUETA_METODO[m[0]] || m[0]} ${pesos(m[1])}`).join(" · ");

    const filas = v.lineas
      .map((l) => {
        const agotada = l.cantidad_disponible <= 0;
        const sel = seleccion[l.venta_linea_id] || 0;
        return `
        <div class="dev-linea ${agotada ? "dev-linea--agotada" : ""}">
          <div class="dev-linea-info">
            <span class="dev-linea-nombre">${escapar(l.descripcion)}</span>
            <span class="dev-linea-detalle">
              ${pesos(l.precio_unitario_centavos)} c/u · vendido ${fmtCant(l.cantidad_vendida, l.unidad)}
              ${l.cantidad_devuelta > 0 ? `· ya devuelto ${fmtCant(l.cantidad_devuelta, l.unidad)}` : ""}
            </span>
          </div>
          ${
            agotada
              ? '<span class="dev-linea-agotada-tag">Devuelta</span>'
              : `<div class="dev-linea-cant">
                  <button class="cl-btn" data-menos="${l.venta_linea_id}">−</button>
                  <input class="cl-cant-input num" data-cant="${l.venta_linea_id}" value="${sel}" inputmode="decimal" />
                  <button class="cl-btn" data-mas="${l.venta_linea_id}">+</button>
                  <span class="dev-linea-max">de ${fmtCant(l.cantidad_disponible, l.unidad)}</span>
                </div>`
          }
        </div>`;
      })
      .join("");

    wrap.querySelector("#dev-cuerpo").innerHTML = `
      <div class="dev-venta-cab">
        <div>
          <div class="dev-venta-folio">Venta #${v.folio}</div>
          <div class="dev-venta-fecha">${fecha}</div>
        </div>
        <div class="dev-venta-estado dev-estado--${v.estado}">${etiquetaEstado(v.estado)}</div>
      </div>
      <div class="dev-venta-pago">Pagado con: ${metodosTxt}</div>
      ${yaCerrada ? '<p class="dev-cerrada">Esta venta ya no admite más devoluciones.</p>' : ""}
      <div class="dev-lineas">${filas}</div>
      ${
        yaCerrada
          ? ""
          : `<div class="dev-resumen">
               <div class="dev-total">A devolver: <strong class="num" id="dev-total">$0.00</strong></div>
               <div class="dev-acciones">
                 <button class="btn-peligro" id="dev-cancelar-venta">Cancelar venta completa</button>
                 <button class="btn-cobrar dev-procesar" id="dev-procesar" disabled>Devolver seleccionado</button>
               </div>
             </div>`
      }
    `;

    if (!yaCerrada) {
      wrap.querySelectorAll("[data-menos]").forEach((b) =>
        b.addEventListener("click", () => cambiarCant(b.dataset.menos, -1))
      );
      wrap.querySelectorAll("[data-mas]").forEach((b) =>
        b.addEventListener("click", () => cambiarCant(b.dataset.mas, +1))
      );
      wrap.querySelectorAll("[data-cant]").forEach((inp) =>
        inp.addEventListener("change", () => {
          const id = inp.dataset.cant;
          const l = venta.lineas.find((x) => x.venta_linea_id === id);
          let v2 = parseFloat((inp.value || "0").replace(",", "."));
          if (isNaN(v2) || v2 < 0) v2 = 0;
          if (v2 > l.cantidad_disponible) v2 = l.cantidad_disponible;
          seleccion[id] = v2;
          renderTotalSel();
          inp.value = v2;
        })
      );
      wrap.querySelector("#dev-procesar").addEventListener("click", () => procesar(false));
      wrap.querySelector("#dev-cancelar-venta").addEventListener("click", () => procesar(true));
      renderTotalSel();
    }
  }

  function cambiarCant(id, delta) {
    const l = venta.lineas.find((x) => x.venta_linea_id === id);
    const paso = l.unidad === "pieza" ? 1 : 0.1;
    let v2 = (seleccion[id] || 0) + delta * paso;
    if (v2 < 0) v2 = 0;
    if (v2 > l.cantidad_disponible) v2 = l.cantidad_disponible;
    seleccion[id] = +v2.toFixed(3);
    renderVenta();
  }

  function totalSeleccionado() {
    let total = 0;
    for (const l of venta.lineas) {
      const c = seleccion[l.venta_linea_id] || 0;
      total += Math.round(l.precio_unitario_centavos * c);
    }
    return total;
  }

  function renderTotalSel() {
    const total = totalSeleccionado();
    const el = wrap.querySelector("#dev-total");
    if (el) el.textContent = pesos(total);
    const btn = wrap.querySelector("#dev-procesar");
    if (btn) btn.disabled = total <= 0;
  }

  // ------------------------------------------------------------- Procesar
  async function procesar(esCancelacion) {
    let lineas;
    if (esCancelacion) {
      // Cancelar = devolver todo lo disponible de cada línea.
      lineas = venta.lineas
        .filter((l) => l.cantidad_disponible > 0)
        .map((l) => ({ venta_linea_id: l.venta_linea_id, cantidad: l.cantidad_disponible }));
      if (lineas.length === 0) return;
    } else {
      lineas = Object.entries(seleccion)
        .filter(([, c]) => c > 0)
        .map(([id, c]) => ({ venta_linea_id: id, cantidad: c }));
      if (lineas.length === 0) return;
    }

    // Determinar método de reembolso. Si la venta tuvo un solo método, usarlo.
    // Si fue mixta, preguntar. Crédito si la venta fue a crédito.
    const metodos = venta.metodos_pago.map((m) => m[0]);
    let metodoReembolso;
    if (metodos.length === 1) {
      metodoReembolso = metodos[0];
    } else {
      metodoReembolso = await elegirMetodoReembolso(metodos);
      if (!metodoReembolso) return; // canceló
    }

    const totalTxt = esCancelacion
      ? "toda la venta"
      : pesos(totalSeleccionado());
    const confirmMsg = esCancelacion
      ? `¿Cancelar la venta #${venta.folio} completa? Se reembolsará ${ETIQUETA_METODO[metodoReembolso] || metodoReembolso} y el stock reingresará.`
      : `¿Devolver ${totalTxt}? Reembolso por ${ETIQUETA_METODO[metodoReembolso] || metodoReembolso}.`;
    // confirm() nativo no funciona en Tauri: confirmación propia compartida.
    const ok = await confirmar(confirmMsg, {
      titulo: esCancelacion ? "Cancelar venta" : "Procesar devolución",
      ok: esCancelacion ? "Cancelar la venta" : "Devolver",
      peligro: true,
    });
    if (!ok) return;

    try {
      const res = await invoke("devolucion_procesar", {
        datos: {
          venta_id: venta.id,
          caja_sesion_id: cajaSesion.id,
          usuario_pos_id: sesion.id,
          motivo: esCancelacion ? "Cancelación" : null,
          lineas,
          metodo_reembolso: metodoReembolso,
        },
      });
      mostrarExito(res);
    } catch (e) {
      wrap.querySelector("#dev-error").textContent = String(e);
    }
  }

  function elegirMetodoReembolso(metodos) {
    return new Promise((resolve) => {
      const opciones = metodos
        .map((m) => `<button class="aj-tipo" data-met="${m}">${ETIQUETA_METODO[m] || m}</button>`)
        .join("");
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay modal-overlay--alto";
      overlay.innerHTML = `
        <div class="modal modal--chico">
          <h2>¿Cómo reembolsar?</h2>
          <p class="m-sub">Esta venta tuvo varios métodos de pago. Elige cómo devolver.</p>
          <div class="aj-tipos">${opciones}</div>
          <div class="m-acciones"><span></span><button class="btn-sec" id="er-cancelar">Cancelar</button></div>
        </div>`;
      document.body.appendChild(overlay);
      const cerrar = (val) => {
        overlay.remove();
        resolve(val);
      };
      overlay.querySelectorAll("[data-met]").forEach((b) =>
        b.addEventListener("click", () => cerrar(b.dataset.met))
      );
      overlay.querySelector("#er-cancelar").addEventListener("click", () => cerrar(null));
      overlay.addEventListener("mousedown", (e) => {
        if (e.target === overlay) cerrar(null);
      });
    });
  }

  function mostrarExito(res) {
    const html = `
      <div class="exito">
        <div class="exito-check">✓</div>
        <h2>Devolución procesada</h2>
        <div class="exito-total">${pesos(res.total_devuelto_centavos)}</div>
        <div class="exito-cambio">Venta ahora: ${etiquetaEstado(res.estado_venta)}</div>
        <button class="btn-primario exito-btn" id="dev-fin">Listo</button>
      </div>
    `;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal modal--chico">${html}</div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#dev-fin").addEventListener("click", () => {
      overlay.remove();
      // Recargar la venta para reflejar el nuevo estado.
      abrirTicket(venta.id);
    });
  }

  function fmtCant(n, unidad) {
    if (unidad === "pieza") return Number.isInteger(n) ? `${n}` : n.toFixed(0);
    return `${n.toFixed(3)} ${unidad}`;
  }
  function etiquetaEstado(e) {
    return {
      completada: "Completada",
      devuelta_parcial: "Devuelta parcial",
      devuelta_total: "Devuelta total",
      cancelada: "Cancelada",
    }[e] || e;
  }
}
