// YvexPOS — apertura de caja.
// Se muestra tras el login si no hay caja abierta. Declara el fondo inicial.
// Invariante del plano: no se puede vender sin una caja_sesion abierta.

import { invoke } from "@tauri-apps/api/core";

export function montarAbrirCaja(contenedor, sesion, alAbrir) {
  contenedor.innerHTML = "";
  contenedor.style.alignItems = "center";
  contenedor.style.justifyContent = "center";

  const wrap = document.createElement("div");
  wrap.className = "caja-abrir";
  wrap.innerHTML = `
    <div class="caja-card">
      <div class="caja-ico">💵</div>
      <h1>Abrir caja</h1>
      <p>Hola, ${escapar(sesion.nombre)}. ¿Con cuánto efectivo abres la caja hoy?</p>
      <label>Fondo inicial
        <div class="caja-monto">
          <span>$</span>
          <input id="caja-fondo" inputmode="decimal" placeholder="0.00" autocomplete="off" />
        </div>
      </label>
      <p class="m-error" id="caja-error"></p>
      <button class="btn-primario caja-btn" id="caja-confirmar">Abrir caja</button>
      <p class="caja-nota">El fondo inicial es el dinero con el que empiezas el turno. Se usa para cuadrar el corte al cerrar.</p>
    </div>
  `;
  contenedor.appendChild(wrap);

  const input = wrap.querySelector("#caja-fondo");
  const err = wrap.querySelector("#caja-error");
  setTimeout(() => input.focus(), 60);

  async function confirmar() {
    err.textContent = "";
    // Campo vacío = sin fondo (0). Enter directo abre el turno con $0.
    const texto = (input.value || "").trim().replace(",", ".");
    const v = texto === "" ? 0 : parseFloat(texto);
    if (isNaN(v) || v < 0) {
      err.textContent = "Ingresa un monto válido (puede ser 0).";
      return;
    }
    const centavos = Math.round(v * 100);
    const btn = wrap.querySelector("#caja-confirmar");
    btn.disabled = true;
    btn.textContent = "Abriendo…";
    try {
      const sesionCaja = await invoke("caja_abrir", {
        usuarioPosId: sesion.id,
        fondoInicialCentavos: centavos,
      });
      alAbrir(sesionCaja);
    } catch (e) {
      err.textContent = String(e);
      btn.disabled = false;
      btn.textContent = "Abrir caja";
    }
  }

  wrap.querySelector("#caja-confirmar").addEventListener("click", confirmar);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmar();
  });
}

function escapar(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}
