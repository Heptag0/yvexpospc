// YvexPOS — Componente de verificación de correo (reutilizable).
//
// Se usa en: el modal del banner, y en Configuración → Conexión con la nube.
// Muestra el correo, pide el código de 6 dígitos, y permite reenviar o
// corregir el correo si se escribió mal.

import { invoke } from "@tauri-apps/api/core";

/**
 * Monta la verificación dentro de `contenedor`.
 * @param {HTMLElement} contenedor
 * @param {string} email - correo actual de la cuenta.
 * @param {object} opciones
 * @param {function} [opciones.alVerificar] - callback al verificar con éxito.
 * @param {function} [opciones.alCerrar] - callback para cerrar (modal).
 */
export function montarVerificacionInline(contenedor, email, opciones = {}) {
  let correoActual = email;

  function pintar() {
    contenedor.innerHTML = `
      <div class="verif-inline">
        <div class="vinc-icono">📧</div>
        <h3 class="vinc-titulo">Verifica tu correo</h3>
        <p class="vinc-desc">
          Enviamos un código de 6 dígitos a<br>
          <strong class="vinc-correo">${escapar(correoActual)}</strong>
        </p>
        <p class="vinc-nota-spam">Si no lo ves, revisa tu carpeta de spam o correo no deseado.</p>
        <div class="vinc-form">
          <input type="text" id="vif-codigo" class="vinc-codigo-input" inputmode="numeric"
                 maxlength="6" placeholder="000000" autocomplete="one-time-code" />
          <p class="vinc-form-error" id="vif-error"></p>
          <button type="button" class="vinc-btn-primario" id="vif-confirmar">Verificar</button>
          <button type="button" class="vinc-link" id="vif-reenviar">Reenviar código</button>
          <button type="button" class="vinc-link" id="vif-cambiar">¿Correo incorrecto? Cámbialo</button>
          ${opciones.alCerrar ? '<button type="button" class="vinc-link vinc-link--tenue" id="vif-cerrar">Cerrar</button>' : ""}
        </div>
      </div>`;

    const err = contenedor.querySelector("#vif-error");
    const input = contenedor.querySelector("#vif-codigo");
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 6);
    });
    input.focus();

    contenedor.querySelector("#vif-confirmar").addEventListener("click", async () => {
      const codigo = input.value.trim();
      err.className = "vinc-form-error";
      err.textContent = "";
      if (codigo.length !== 6) return (err.textContent = "El código son 6 dígitos.");
      const btn = contenedor.querySelector("#vif-confirmar");
      btn.disabled = true; btn.textContent = "Verificando…";
      try {
        await invoke("vinc_verificar_confirmar", { codigo });
        pintarExito();
      } catch (e) {
        err.textContent = String(e);
        btn.disabled = false; btn.textContent = "Verificar";
      }
    });

    contenedor.querySelector("#vif-reenviar").addEventListener("click", async () => {
      err.className = "vinc-form-error";
      err.textContent = "";
      try {
        await invoke("vinc_verificar_enviar");
        err.className = "vinc-form-error vinc-form-ok";
        err.textContent = "Código reenviado. Revisa tu correo.";
      } catch (e) {
        err.textContent = String(e);
      }
    });

    contenedor.querySelector("#vif-cambiar").addEventListener("click", pintarCambio);

    const cerrar = contenedor.querySelector("#vif-cerrar");
    if (cerrar) cerrar.addEventListener("click", () => opciones.alCerrar && opciones.alCerrar());
  }

  function pintarCambio() {
    contenedor.innerHTML = `
      <div class="verif-inline">
        <h3 class="vinc-titulo">Corregir correo</h3>
        <p class="vinc-desc">Escribe tu correo correcto y te enviaremos un código nuevo.</p>
        <div class="vinc-form">
          <label class="vinc-campo">
            <span>Correo correcto</span>
            <input type="email" id="vif-nuevo" value="${escapar(correoActual)}" />
          </label>
          <p class="vinc-form-error" id="vif-cambio-error"></p>
          <button type="button" class="vinc-btn-primario" id="vif-guardar">Guardar y reenviar</button>
          <button type="button" class="vinc-link" id="vif-volver">← Volver</button>
        </div>
      </div>`;
    const err = contenedor.querySelector("#vif-cambio-error");
    contenedor.querySelector("#vif-volver").addEventListener("click", pintar);
    contenedor.querySelector("#vif-guardar").addEventListener("click", async () => {
      const nuevo = contenedor.querySelector("#vif-nuevo").value.trim();
      err.textContent = "";
      if (!nuevo || !nuevo.includes("@")) return (err.textContent = "Escribe un correo válido.");
      const btn = contenedor.querySelector("#vif-guardar");
      btn.disabled = true; btn.textContent = "Guardando…";
      try {
        const actualizado = await invoke("vinc_verificar_cambiar_email", { emailNuevo: nuevo });
        correoActual = actualizado || nuevo;
        pintar();
      } catch (e) {
        err.textContent = String(e);
        btn.disabled = false; btn.textContent = "Guardar y reenviar";
      }
    });
  }

  function pintarExito() {
    contenedor.innerHTML = `
      <div class="verif-inline">
        <div class="vinc-icono">✅</div>
        <h3 class="vinc-titulo">¡Correo verificado!</h3>
        <p class="vinc-desc">Tu cuenta ya está asegurada. Gracias.</p>
        <button type="button" class="vinc-btn-primario" id="vif-listo">Listo</button>
      </div>`;
    contenedor.querySelector("#vif-listo").addEventListener("click", () => {
      if (opciones.alVerificar) opciones.alVerificar();
    });
  }

  pintar();
}

function escapar(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
