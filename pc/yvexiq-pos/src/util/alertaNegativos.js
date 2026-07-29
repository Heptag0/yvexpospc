// Alerta discreta y fija de "stock negativo que necesita revisión".
// Aparece abajo a la derecha. No es intrusiva: no bloquea, no se puede
// descartar (su función es recordar que hay algo que atender), pero es sutil.
// Al pulsarla, ejecuta `alPulsar` (normalmente ir a Inventario filtrando negativos).

import { icono } from "./iconos.js";
import { invoke } from "@tauri-apps/api/core";

/**
 * Monta (o actualiza) la alerta de negativos dentro de `contenedor`.
 * @param {HTMLElement} contenedor - dónde vive la alerta (la vista actual).
 * @param {Function} alPulsar - callback al hacer click en la alerta.
 * @returns {Function} una función para refrescar el conteo manualmente.
 */
export function montarAlertaNegativos(contenedor, alPulsar) {
  let alerta = null;

  async function refrescar() {
    let n = 0;
    try {
      n = await invoke("prod_contar_negativos");
    } catch (e) {
      console.error("No se pudo contar negativos:", e);
      return;
    }
    if (n > 0) {
      if (!alerta) {
        alerta = document.createElement("button");
        alerta.className = "alerta-neg";
        alerta.type = "button";
        alerta.addEventListener("click", alPulsar);
        contenedor.appendChild(alerta);
        // Pequeño retraso para que la transición de entrada se note.
        requestAnimationFrame(() => alerta.classList.add("alerta-neg--visible"));
      }
      const plural = n > 1;
      alerta.innerHTML = `
        <span class="alerta-neg-ico">${icono("existencias")}</span>
        <span class="alerta-neg-txt">
          <span class="alerta-neg-titulo">${n} producto${plural ? "s" : ""} en negativo</span>
          <span class="alerta-neg-sub">Toca para revisar y ajustar</span>
        </span>`;
    } else if (alerta) {
      // Ya no hay negativos: quitar la alerta con suavidad.
      alerta.classList.remove("alerta-neg--visible");
      const a = alerta;
      alerta = null;
      setTimeout(() => a.remove(), 300);
    }
  }

  refrescar();
  return refrescar;
}
