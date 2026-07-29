// YvexPOS — módulo Caja (movimientos, corte X, cierre Z).
// El corte muestra: venta del día (total) y desglose por método expandible,
// con el efectivo esperado del cajón como número clave para cuadrar.

import { invoke } from "@tauri-apps/api/core";
import { pesos, escapar } from "../util/formato.js";

export function montarCaja(contenedor, sesion, cajaSesion, alSalir, alCerrarSesion) {
  contenedor.innerHTML = "";
  contenedor.style.alignItems = "stretch";
  contenedor.style.justifyContent = "flex-start";

  const wrap = document.createElement("div");
  wrap.className = "caja";
  contenedor.appendChild(wrap);

  let corte = null;

  pintarEsqueleto();
  cargarCorte();

  function pintarEsqueleto() {
    wrap.innerHTML = `
      <header class="inv-head">
        <div class="inv-head-izq">
          <button class="inv-volver" id="caja-volver" aria-label="Volver">←</button>
          <h1>Corte</h1>
        </div>
        <div class="inv-head-der">
          <button class="btn-sec" id="caja-mov">Entrada / Salida</button>
        </div>
      </header>
      <div id="caja-cuerpo"><div class="inv-vacio">Cargando corte…</div></div>
    `;
    wrap.querySelector("#caja-volver").addEventListener("click", alSalir);
    wrap.querySelector("#caja-mov").addEventListener("click", abrirMovimiento);
  }

  async function cargarCorte() {
    try {
      corte = await invoke("caja_corte", { cajaSesionId: cajaSesion.id });
    } catch (e) {
      wrap.querySelector("#caja-cuerpo").innerHTML =
        '<div class="inv-vacio">Error al calcular el corte: ' + escapar(String(e)) + "</div>";
      return;
    }
    render();
  }

  function render() {
    const c = corte;
    const apertura = new Date(c.abierta_en).toLocaleString("es-MX", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
    wrap.querySelector("#caja-cuerpo").innerHTML = `
      <div class="caja-info">
        <span>Turno de <strong>${escapar(c.usuario_nombre)}</strong></span>
        <span>Abierta: ${apertura}</span>
        <span>Fondo inicial: <strong class="num">${pesos(c.fondo_inicial_centavos)}</strong></span>
      </div>

      <div class="caja-grid">
        <!-- EL número del corte: lo que debe haber en el cajón, físicamente. -->
        <div class="caja-bloque caja-bloque--efectivo con-filo">
          <div class="caja-bloque-label">Efectivo esperado en cajón</div>
          <div class="caja-bloque-valor caja-bloque-valor--hero num">${pesos(c.efectivo_esperado_centavos)}</div>
          <div class="caja-efvo-detalle">
            ${filaEfvo("Fondo inicial", c.fondo_inicial_centavos)}
            ${filaEfvo("+ Ventas en efectivo", c.ventas_efectivo_centavos)}
            ${filaEfvo("+ Abonos en efectivo", c.abonos_efectivo_centavos)}
            ${filaEfvo("+ Entradas", c.entradas_centavos)}
            ${filaEfvo("− Salidas", -c.salidas_centavos)}
            ${filaEfvo("− Devoluciones de producto", -c.devoluciones_efectivo_centavos)}
          </div>
        </div>

        <!-- Venta del día (contexto del turno). -->
        <div class="caja-bloque caja-bloque--venta con-filo">
          <div class="caja-bloque-label">Venta del día</div>
          <div class="caja-bloque-valor num">${pesos(c.total_vendido_centavos)}</div>
          <div class="caja-bloque-sub">${c.num_ventas} venta${c.num_ventas === 1 ? "" : "s"}</div>
          <button class="caja-desglose-btn" id="caja-toggle">Ver desglose por método ▾</button>
          <div class="caja-desglose" id="caja-desglose" hidden>
            ${filaDesglose("Efectivo", c.ventas_efectivo_centavos)}
            ${filaDesglose("Tarjeta", c.ventas_tarjeta_centavos)}
            ${filaDesglose("Transferencia", c.ventas_transferencia_centavos)}
            ${filaDesglose("Crédito (fiado)", c.ventas_credito_centavos, true)}
          </div>
        </div>
      </div>

      ${
        c.otras_cajas_num > 0
          ? `<p class="caja-nota-credito caja-nota-otras">Otras cajas hoy: <strong class="num">${pesos(c.otras_cajas_total_centavos)}</strong> en ${c.otras_cajas_num} venta${c.otras_cajas_num === 1 ? "" : "s"}. No entran a este arqueo: ese efectivo está en la otra caja. Los reportes sí las incluyen.</p>`
          : ""
      }

      ${
        c.ventas_credito_centavos > 0 || c.abonos_efectivo_centavos > 0
          ? `<p class="caja-nota-credito">El crédito es venta del día pero no entra al cajón hasta que el cliente abona. Los abonos recibidos hoy sí cuentan como efectivo.</p>`
          : ""
      }

      <div class="caja-acciones">
        <button class="btn-cobrar caja-cerrar-btn" id="caja-cerrar">Hacer corte y cerrar caja</button>
      </div>
    `;

    const toggle = wrap.querySelector("#caja-toggle");
    const desglose = wrap.querySelector("#caja-desglose");
    toggle.addEventListener("click", () => {
      const oculto = desglose.hidden;
      desglose.hidden = !oculto;
      toggle.textContent = oculto ? "Ocultar desglose ▴" : "Ver desglose por método ▾";
    });
    wrap.querySelector("#caja-cerrar").addEventListener("click", abrirCierre);
  }

  function filaDesglose(label, cent, esCredito) {
    return `<div class="cd-fila ${esCredito ? "cd-credito" : ""}">
      <span>${label}</span><span class="num">${pesos(cent)}</span>
    </div>`;
  }
  function filaEfvo(label, cent) {
    return `<div class="ce-fila"><span>${label}</span><span class="num">${pesos(cent)}</span></div>`;
  }

  // ---------------------------------------------------------- Movimiento
  function abrirMovimiento() {
    const html = `
      <h2>Entrada / Salida de efectivo</h2>
      <p class="m-sub">Registra dinero que entra o sale del cajón fuera de las ventas.</p>
      <div class="aj-tipos">
        <button class="aj-tipo aj-tipo--activo" data-tipo="salida">Salida</button>
        <button class="aj-tipo" data-tipo="entrada">Entrada</button>
      </div>
      <label>Monto
        <input id="mv-monto" inputmode="decimal" placeholder="0.00" />
      </label>
      <label>Motivo
        <input id="mv-motivo" placeholder="Pago a proveedor, retiro, depósito…" />
      </label>
      <p class="m-error" id="mv-error"></p>
      <div class="m-acciones"><span></span><div>
        <button class="btn-sec" id="mv-cancelar">Cancelar</button>
        <button class="btn-primario" id="mv-ok">Registrar</button>
      </div></div>
    `;
    const modal = abrirModal(html);
    const $ = (s) => modal.querySelector(s);
    let tipo = "salida";
    setTimeout(() => $("#mv-monto").focus(), 50);
    modal.querySelectorAll(".aj-tipo").forEach((b) =>
      b.addEventListener("click", () => {
        modal.querySelectorAll(".aj-tipo").forEach((x) => x.classList.remove("aj-tipo--activo"));
        b.classList.add("aj-tipo--activo");
        tipo = b.dataset.tipo;
      })
    );
    $("#mv-cancelar").addEventListener("click", cerrarModal);
    $("#mv-ok").addEventListener("click", async () => {
      const err = $("#mv-error");
      err.textContent = "";
      const v = parseFloat(($("#mv-monto").value || "0").replace(",", "."));
      if (isNaN(v) || v <= 0) return (err.textContent = "Ingresa un monto válido.");
      try {
        await invoke("caja_movimiento", {
          datos: {
            caja_sesion_id: cajaSesion.id,
            tipo,
            motivo: $("#mv-motivo").value.trim() || null,
            monto_centavos: Math.round(v * 100),
            usuario_pos_id: sesion.id,
          },
        });
        cerrarModal();
        cargarCorte();
      } catch (e) {
        err.textContent = String(e);
      }
    });
  }

  // ------------------------------------------------------------- Cierre Z
  function abrirCierre() {
    const esperado = corte.efectivo_esperado_centavos;
    const html = `
      <h2>Corte y cierre de caja</h2>
      <p class="m-sub">Cuenta el efectivo físico del cajón y anótalo. El sistema calculará la diferencia.</p>
      <div class="cierre-esperado">
        <span>Efectivo esperado</span>
        <strong class="num">${pesos(esperado)}</strong>
      </div>
      <label>Efectivo contado (físico)
        <div class="caja-monto">
          <span>$</span>
          <input id="ci-contado" inputmode="decimal" placeholder="0.00" autocomplete="off" />
        </div>
      </label>
      <p class="cierre-dif" id="ci-dif"></p>
      <p class="m-error" id="ci-error"></p>
      <div class="m-acciones"><span></span><div>
        <button class="btn-sec" id="ci-cancelar">Cancelar</button>
        <button class="btn-peligro" id="ci-ok">Cerrar caja</button>
      </div></div>
    `;
    const modal = abrirModal(html);
    const $ = (s) => modal.querySelector(s);
    setTimeout(() => $("#ci-contado").focus(), 50);

    $("#ci-contado").addEventListener("input", () => {
      const v = parseFloat(($("#ci-contado").value || "").replace(",", "."));
      const dif = $("#ci-dif");
      if (isNaN(v)) return (dif.textContent = "");
      const contado = Math.round(v * 100);
      const d = contado - esperado;
      if (d === 0) {
        dif.textContent = "✓ Cuadra exacto.";
        dif.className = "cierre-dif cierre-dif--ok";
      } else if (d > 0) {
        dif.textContent = `Sobrante de ${pesos(d)}`;
        dif.className = "cierre-dif cierre-dif--sobra";
      } else {
        dif.textContent = `Faltante de ${pesos(-d)}`;
        dif.className = "cierre-dif cierre-dif--falta";
      }
    });

    $("#ci-cancelar").addEventListener("click", cerrarModal);
    $("#ci-ok").addEventListener("click", async () => {
      const err = $("#ci-error");
      err.textContent = "";
      const v = parseFloat(($("#ci-contado").value || "").replace(",", "."));
      if (isNaN(v) || v < 0) return (err.textContent = "Ingresa el efectivo contado.");
      const contado = Math.round(v * 100);
      const ok = await confirmarPropio(
        "Una vez cerrada, la caja no se puede modificar. ¿Cerrar el turno?",
        { titulo: "Cerrar caja", ok: "Cerrar el turno", peligro: true }
      );
      if (!ok) return;
      try {
        const [esp, dif] = await invoke("caja_cerrar", {
          cajaSesionId: cajaSesion.id,
          totalContadoCentavos: contado,
        });
        cerrarModal();
        mostrarResumenCierre(esp, contado, dif);
      } catch (e) {
        err.textContent = String(e);
      }
    });
  }

  function mostrarResumenCierre(esperado, contado, diferencia) {
    const cuadra = diferencia === 0;
    const html = `
      <div class="exito">
        <div class="exito-check" style="${cuadra ? "" : "background:var(--alerta)"}">${cuadra ? "✓" : "≠"}</div>
        <h2>Caja cerrada</h2>
        <div class="cierre-resumen">
          <div><span>Esperado</span><strong class="num">${pesos(esperado)}</strong></div>
          <div><span>Contado</span><strong class="num">${pesos(contado)}</strong></div>
          <div class="${diferencia === 0 ? "" : diferencia > 0 ? "cierre-dif--sobra" : "cierre-dif--falta"}">
            <span>Diferencia</span>
            <strong class="num">${diferencia === 0 ? pesos(0) : (diferencia > 0 ? "+" : "−") + pesos(Math.abs(diferencia))}</strong>
          </div>
        </div>
        <button class="btn-primario exito-btn" id="ci-fin">Cerrar sesión</button>
      </div>
    `;
    const modal = abrirModal(html);
    modal.querySelector("#ci-fin").addEventListener("click", () => {
      cerrarModal();
      // Tras cerrar caja, lo natural es cerrar sesión (nuevo turno = nueva apertura).
      if (typeof alCerrarSesion === "function") alCerrarSesion();
      else alSalir();
    });
  }
}

// --- Modales locales ---
let modalCaja = null;
function abrirModal(html) {
  if (modalCaja) cerrarModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(overlay);
  modalCaja = overlay;
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) cerrarModal();
  });
  return overlay.querySelector(".modal");
}
function cerrarModal() {
  if (modalCaja) {
    modalCaja.remove();
    modalCaja = null;
  }
}

// Confirmación propia (el confirm() nativo no funciona en Tauri).
// Mismo patrón que venta.js; usa su propio overlay para convivir con
// el modal de cierre que ya está abierto debajo.
function confirmarPropio(mensaje, opciones = {}) {
  const titulo = opciones.titulo || "Confirmar";
  const textoOk = opciones.ok || "Aceptar";
  const textoCancelar = opciones.cancelar || "Cancelar";
  const peligro = opciones.peligro === true;
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay modal-overlay--confirm";
    overlay.innerHTML = `
      <div class="modal modal--confirm" role="dialog" aria-modal="true">
        <h2 class="confirm-titulo">${titulo}</h2>
        <p class="confirm-msg">${mensaje}</p>
        <div class="confirm-acciones">
          <button class="btn-sec" data-conf="0">${textoCancelar}</button>
          <button class="${peligro ? "btn-peligro" : "btn-primario"}" data-conf="1">${textoOk}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const cerrar = (valor) => {
      overlay.remove();
      document.removeEventListener("keydown", onTecla);
      resolve(valor);
    };
    function onTecla(e) {
      if (e.key === "Escape") { e.preventDefault(); cerrar(false); }
      else if (e.key === "Enter") { e.preventDefault(); cerrar(true); }
    }
    document.addEventListener("keydown", onTecla);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) cerrar(false); });
    overlay.querySelector('[data-conf="0"]').addEventListener("click", () => cerrar(false));
    overlay.querySelector('[data-conf="1"]').addEventListener("click", () => cerrar(true));
    setTimeout(() => overlay.querySelector('[data-conf="1"]').focus(), 40);
  });
}