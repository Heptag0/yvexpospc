// YvexPOS — Banner recordatorio de verificación de correo.
//
// Aparece en la parte superior del POS SOLO si la cuenta está vinculada pero
// el correo no ha sido verificado. No bloquea nada (verificación suave): el
// dueño puede seguir vendiendo. Ofrece verificar ahí mismo o cerrar el aviso
// (vuelve al reiniciar hasta que verifique).
//
// Se puede cerrar por sesión; no insiste dentro de la misma sesión.

import { invoke } from "@tauri-apps/api/core";
import { montarVerificacionInline } from "./verificacion_ui.js";

let cerradoEstaSesion = false;

/**
 * Comprueba el estado de la cuenta y, si hace falta, muestra el banner arriba
 * del contenedor dado (normalmente el shell o #app).
 * @param {HTMLElement} anclaSuperior - dónde insertar el banner (al inicio).
 */
export async function revisarVerificacion(anclaSuperior) {
  if (cerradoEstaSesion) return;

  let estado;
  try {
    estado = await invoke("vinc_estado_cuenta");
  } catch (_) {
    return; // sin conexión o sin cuenta: no molestar
  }

  // Solo si está vinculado por cuenta y NO verificado.
  if (!estado || !estado.vinculado || estado.verificado) return;
  // Si no pudimos leer el correo (offline), no mostramos el banner.
  if (!estado.email) return;

  mostrarBanner(anclaSuperior, estado.email);
}

function mostrarBanner(ancla, email) {
  // Evitar duplicados.
  if (document.querySelector("#verif-banner")) return;

  const banner = document.createElement("div");
  banner.className = "verif-banner";
  banner.id = "verif-banner";
  banner.innerHTML = `
    <span class="verif-banner-icono">📧</span>
    <span class="verif-banner-texto">
      Verifica tu correo <strong>${escapar(email)}</strong> para asegurar tu cuenta.
    </span>
    <button type="button" class="verif-banner-btn" id="verif-banner-verificar">Verificar</button>
    <button type="button" class="verif-banner-cerrar" id="verif-banner-cerrar" title="Cerrar">×</button>`;

  ancla.insertBefore(banner, ancla.firstChild);

  banner.querySelector("#verif-banner-cerrar").addEventListener("click", () => {
    cerradoEstaSesion = true;
    banner.remove();
  });

  banner.querySelector("#verif-banner-verificar").addEventListener("click", () => {
    abrirModalVerificacion(email);
  });
}

// Modal ligero para verificar sin salir de la pantalla actual.
function abrirModalVerificacion(email) {
  const overlay = document.createElement("div");
  overlay.className = "verif-modal-overlay";
  overlay.innerHTML = `<div class="verif-modal" id="verif-modal-caja"></div>`;
  document.body.appendChild(overlay);

  const caja = overlay.querySelector("#verif-modal-caja");
  montarVerificacionInline(caja, email, {
    alVerificar: () => {
      overlay.remove();
      const b = document.querySelector("#verif-banner");
      if (b) b.remove();
    },
    alCerrar: () => overlay.remove(),
  });

  // Cerrar al hacer clic fuera de la caja.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

function escapar(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
