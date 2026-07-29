// YvexPOS — Componente de conexión con la nube (reutilizable).
//
// Ofrece TRES vías para conectar esta caja con una cuenta:
//   1. Crear cuenta nueva (registro + vinculación directa, sin código).
//   2. Iniciar sesión (login + vinculación directa).
//   3. Vincular con código (para adoptar esta caja desde otro dispositivo
//      que ya tiene la sesión, estilo YouTube/TV).
//
// Si la caja YA está vinculada, muestra el estado y permite desvincular.
//
// Se usa en el onboarding (paso "Local + nube") y en Configuración.

import { invoke } from "@tauri-apps/api/core";
import { escapar } from "./formato.js";

let temporizador = null;

/**
 * Monta el flujo de conexión con la nube dentro de `contenedor`.
 * @param {HTMLElement} contenedor
 * @param {object} opciones
 * @param {function} [opciones.alVincular] - callback al vincularse con éxito.
 * @param {boolean} [opciones.compacto]
 */
export async function montarVinculacion(contenedor, opciones = {}) {
  detenerPolling();

  let yaVinc = false;
  try {
    yaVinc = await invoke("vinc_ya_vinculado");
  } catch (_) {
    yaVinc = false;
  }

  if (yaVinc) {
    mostrarYaVinculado(contenedor, opciones);
  } else {
    mostrarMenu(contenedor, opciones);
  }
}

export function detenerPolling() {
  if (temporizador) {
    clearInterval(temporizador);
    temporizador = null;
  }
}

// ===========================================================================
// MENÚ inicial: elegir entre crear cuenta, iniciar sesión, o usar código
// ===========================================================================
function mostrarMenu(contenedor, opciones) {
  const { compacto = false } = opciones;
  contenedor.innerHTML = `
    <div class="vinc-caja ${compacto ? "vinc-compacto" : ""}">
      <div class="vinc-icono">☁️</div>
      <h3 class="vinc-titulo">Conecta con la nube</h3>
      <p class="vinc-desc">
        Vincula esta caja a tu cuenta YvexPOS para ver tus ventas y cortes
        desde tu celular, estés donde estés.
      </p>
      <div class="vinc-menu">
        <button type="button" class="vinc-btn-primario" id="vinc-ir-registro">
          Crear una cuenta nueva
        </button>
        <button type="button" class="vinc-btn-secundario" id="vinc-ir-login">
          Ya tengo cuenta, iniciar sesión
        </button>
        <button type="button" class="vinc-link" id="vinc-ir-codigo">
          Vincular con un código
        </button>
      </div>
    </div>`;

  contenedor.querySelector("#vinc-ir-registro").addEventListener("click",
    () => mostrarRegistro(contenedor, opciones));
  contenedor.querySelector("#vinc-ir-login").addEventListener("click",
    () => mostrarLogin(contenedor, opciones));
  contenedor.querySelector("#vinc-ir-codigo").addEventListener("click",
    () => iniciarVinculacionCodigo(contenedor, opciones));
}

// ===========================================================================
// CREAR CUENTA
// ===========================================================================
function mostrarRegistro(contenedor, opciones) {
  const { compacto = false } = opciones;
  contenedor.innerHTML = `
    <div class="vinc-caja ${compacto ? "vinc-compacto" : ""}">
      <h3 class="vinc-titulo">Crea tu cuenta</h3>
      <p class="vinc-desc">Con esta cuenta verás tu negocio desde el celular.</p>
      <div class="vinc-form">
        <label class="vinc-campo">
          <span>Tu nombre</span>
          <input type="text" id="reg-nombre" placeholder="Arturo" autocomplete="name" />
        </label>
        <label class="vinc-campo">
          <span>Nombre de tu negocio</span>
          <input type="text" id="reg-negocio" placeholder="Modelorama El Pavo" />
        </label>
        <label class="vinc-campo">
          <span>Correo electrónico</span>
          <input type="email" id="reg-email" placeholder="tucorreo@ejemplo.com" autocomplete="email" />
        </label>
        <label class="vinc-campo">
          <span>Contraseña (mínimo 8 caracteres)</span>
          <input type="password" id="reg-password" placeholder="••••••••" autocomplete="new-password" />
        </label>
        <p class="vinc-form-error" id="reg-error"></p>
        <button type="button" class="vinc-btn-primario" id="reg-enviar">Crear cuenta y vincular</button>
        <button type="button" class="vinc-link" id="reg-volver">← Volver</button>
      </div>
    </div>`;

  const err = contenedor.querySelector("#reg-error");
  contenedor.querySelector("#reg-volver").addEventListener("click",
    () => mostrarMenu(contenedor, opciones));

  contenedor.querySelector("#reg-enviar").addEventListener("click", async () => {
    const nombre = contenedor.querySelector("#reg-nombre").value.trim();
    const negocio = contenedor.querySelector("#reg-negocio").value.trim();
    const email = contenedor.querySelector("#reg-email").value.trim();
    const password = contenedor.querySelector("#reg-password").value;

    err.textContent = "";
    if (!nombre) return (err.textContent = "Escribe tu nombre.");
    if (!negocio) return (err.textContent = "Escribe el nombre de tu negocio.");
    if (!email || !email.includes("@")) return (err.textContent = "Escribe un correo válido.");
    if (password.length < 8) return (err.textContent = "La contraseña debe tener al menos 8 caracteres.");

    const btn = contenedor.querySelector("#reg-enviar");
    btn.disabled = true;
    btn.textContent = "Creando cuenta…";
    try {
      await invoke("vinc_registrar", {
        email, nombre, password, negocioNombre: negocio, nombreCaja: "Caja 1",
      });
      // Cuenta creada y vinculada. El backend ya envió un código de
      // verificación al correo. Mostramos la pantalla para meterlo.
      mostrarVerificacion(contenedor, opciones, email);
    } catch (e) {
      err.textContent = String(e);
      btn.disabled = false;
      btn.textContent = "Crear cuenta y vincular";
    }
  });
}

// ===========================================================================
// INICIAR SESIÓN
// ===========================================================================
function mostrarLogin(contenedor, opciones) {
  const { compacto = false } = opciones;
  contenedor.innerHTML = `
    <div class="vinc-caja ${compacto ? "vinc-compacto" : ""}">
      <h3 class="vinc-titulo">Inicia sesión</h3>
      <p class="vinc-desc">Entra con tu cuenta YvexPOS para vincular esta caja.</p>
      <div class="vinc-form">
        <label class="vinc-campo">
          <span>Correo electrónico</span>
          <input type="email" id="log-email" placeholder="tucorreo@ejemplo.com" autocomplete="email" />
        </label>
        <label class="vinc-campo">
          <span>Contraseña</span>
          <input type="password" id="log-password" placeholder="••••••••" autocomplete="current-password" />
        </label>
        <p class="vinc-form-error" id="log-error"></p>
        <button type="button" class="vinc-btn-primario" id="log-enviar">Iniciar sesión y vincular</button>
        <button type="button" class="vinc-link" id="log-volver">← Volver</button>
      </div>
    </div>`;

  const err = contenedor.querySelector("#log-error");
  contenedor.querySelector("#log-volver").addEventListener("click",
    () => mostrarMenu(contenedor, opciones));

  contenedor.querySelector("#log-enviar").addEventListener("click", async () => {
    const email = contenedor.querySelector("#log-email").value.trim();
    const password = contenedor.querySelector("#log-password").value;

    err.textContent = "";
    if (!email || !email.includes("@")) return (err.textContent = "Escribe un correo válido.");
    if (!password) return (err.textContent = "Escribe tu contraseña.");

    const btn = contenedor.querySelector("#log-enviar");
    btn.disabled = true;
    btn.textContent = "Entrando…";
    try {
      await invoke("vinc_login", { email, password, nombreCaja: "Caja 1" });
      mostrarExito(contenedor, opciones);
    } catch (e) {
      err.textContent = String(e);
      btn.disabled = false;
      btn.textContent = "Iniciar sesión y vincular";
    }
  });
}

// ===========================================================================
// VINCULAR CON CÓDIGO (flujo estilo YouTube/TV)
// ===========================================================================
async function iniciarVinculacionCodigo(contenedor, opciones) {
  const { compacto = false } = opciones;
  contenedor.innerHTML = `<div class="vinc-caja"><p class="vinc-cargando">Generando código…</p></div>`;

  let datos;
  try {
    datos = await invoke("vinc_generar_codigo");
  } catch (e) {
    mostrarErrorCodigo(contenedor, opciones, String(e));
    return;
  }

  const bonito = datos.codigo.length === 8
    ? `${datos.codigo.slice(0, 4)} ${datos.codigo.slice(4)}`
    : datos.codigo;

  contenedor.innerHTML = `
    <div class="vinc-caja ${compacto ? "vinc-compacto" : ""}">
      <h3 class="vinc-titulo">Tu código de vinculación</h3>
      <div class="vinc-codigo">${escapar(bonito)}</div>
      <ol class="vinc-pasos">
        <li>Abre <strong>YvexPOS</strong> en tu celular (ya con tu sesión).</li>
        <li>Toca <strong>"Agregar caja"</strong>.</li>
        <li>Escribe este código.</li>
      </ol>
      <p class="vinc-esperando">
        <span class="vinc-latido"></span> Esperando confirmación…
      </p>
      <button type="button" class="vinc-link" id="vinc-cod-volver">← Volver</button>
    </div>`;

  contenedor.querySelector("#vinc-cod-volver").addEventListener("click", () => {
    detenerPolling();
    mostrarMenu(contenedor, opciones);
  });

  const codigo = datos.codigo;
  temporizador = setInterval(async () => {
    let est;
    try {
      est = await invoke("vinc_consultar_estado", { codigo });
    } catch (e) {
      detenerPolling();
      mostrarErrorCodigo(contenedor, opciones, String(e));
      return;
    }
    if (est.estado === "vinculado") {
      detenerPolling();
      mostrarExito(contenedor, opciones);
    }
  }, 3000);
}

function mostrarErrorCodigo(contenedor, opciones, mensaje) {
  const { compacto = false } = opciones;
  contenedor.innerHTML = `
    <div class="vinc-caja vinc-error ${compacto ? "vinc-compacto" : ""}">
      <div class="vinc-icono">⚠️</div>
      <h3 class="vinc-titulo">No se pudo generar el código</h3>
      <p class="vinc-desc">${escapar(mensaje)}</p>
      <button type="button" class="vinc-btn-primario" id="vinc-cod-reintentar">Reintentar</button>
      <button type="button" class="vinc-link" id="vinc-cod-volver2">← Volver</button>
    </div>`;
  contenedor.querySelector("#vinc-cod-reintentar").addEventListener("click",
    () => iniciarVinculacionCodigo(contenedor, opciones));
  contenedor.querySelector("#vinc-cod-volver2").addEventListener("click",
    () => mostrarMenu(contenedor, opciones));
}

// ===========================================================================
// ÉXITO y YA VINCULADO
// ===========================================================================
function mostrarVerificacion(contenedor, opciones, email) {
  const { compacto = false } = opciones;
  let correoActual = email;

  function pintar() {
    contenedor.innerHTML = `
      <div class="vinc-caja ${compacto ? "vinc-compacto" : ""}">
        <div class="vinc-icono">📧</div>
        <h3 class="vinc-titulo">Verifica tu correo</h3>
        <p class="vinc-desc">
          Enviamos un código de 6 dígitos a<br>
          <strong class="vinc-correo">${escapar(correoActual)}</strong>
        </p>
        <p class="vinc-nota-spam">Si no lo ves, revisa tu carpeta de spam o correo no deseado.</p>
        <div class="vinc-form">
          <input type="text" id="ver-codigo" class="vinc-codigo-input" inputmode="numeric"
                 maxlength="6" placeholder="000000" autocomplete="one-time-code" />
          <p class="vinc-form-error" id="ver-error"></p>
          <button type="button" class="vinc-btn-primario" id="ver-confirmar">Verificar</button>
          <button type="button" class="vinc-link" id="ver-reenviar">Reenviar código</button>
          <button type="button" class="vinc-link" id="ver-cambiar">¿Correo incorrecto? Cámbialo</button>
          <button type="button" class="vinc-link vinc-link--tenue" id="ver-luego">Verificar más tarde</button>
        </div>
      </div>`;

    const err = contenedor.querySelector("#ver-error");
    const input = contenedor.querySelector("#ver-codigo");
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 6);
    });

    contenedor.querySelector("#ver-confirmar").addEventListener("click", async () => {
      const codigo = input.value.trim();
      err.textContent = "";
      if (codigo.length !== 6) return (err.textContent = "El código son 6 dígitos.");
      const btn = contenedor.querySelector("#ver-confirmar");
      btn.disabled = true; btn.textContent = "Verificando…";
      try {
        await invoke("vinc_verificar_confirmar", { codigo });
        mostrarExito(contenedor, opciones, true);
      } catch (e) {
        err.textContent = String(e);
        btn.disabled = false; btn.textContent = "Verificar";
      }
    });

    contenedor.querySelector("#ver-reenviar").addEventListener("click", async () => {
      err.textContent = "";
      try {
        await invoke("vinc_verificar_enviar");
        err.className = "vinc-form-error vinc-form-ok";
        err.textContent = "Código reenviado. Revisa tu correo.";
      } catch (e) {
        err.className = "vinc-form-error";
        err.textContent = String(e);
      }
    });

    contenedor.querySelector("#ver-cambiar").addEventListener("click", () => pintarCambioCorreo());
    contenedor.querySelector("#ver-luego").addEventListener("click", () => {
      // Entrar al POS sin verificar (verificación suave).
      if (opciones.alVincular) opciones.alVincular();
    });
  }

  function pintarCambioCorreo() {
    contenedor.innerHTML = `
      <div class="vinc-caja ${compacto ? "vinc-compacto" : ""}">
        <h3 class="vinc-titulo">Corregir correo</h3>
        <p class="vinc-desc">Escribe tu correo correcto y te enviaremos un código nuevo.</p>
        <div class="vinc-form">
          <label class="vinc-campo">
            <span>Correo correcto</span>
            <input type="email" id="ver-nuevo-email" value="${escapar(correoActual)}" />
          </label>
          <p class="vinc-form-error" id="ver-cambio-error"></p>
          <button type="button" class="vinc-btn-primario" id="ver-guardar-email">Guardar y reenviar</button>
          <button type="button" class="vinc-link" id="ver-cancelar-cambio">← Volver</button>
        </div>
      </div>`;
    const err = contenedor.querySelector("#ver-cambio-error");
    contenedor.querySelector("#ver-cancelar-cambio").addEventListener("click", pintar);
    contenedor.querySelector("#ver-guardar-email").addEventListener("click", async () => {
      const nuevo = contenedor.querySelector("#ver-nuevo-email").value.trim();
      err.textContent = "";
      if (!nuevo || !nuevo.includes("@")) return (err.textContent = "Escribe un correo válido.");
      const btn = contenedor.querySelector("#ver-guardar-email");
      btn.disabled = true; btn.textContent = "Guardando…";
      try {
        const emailActualizado = await invoke("vinc_verificar_cambiar_email", { emailNuevo: nuevo });
        correoActual = emailActualizado || nuevo;
        pintar();
      } catch (e) {
        err.textContent = String(e);
        btn.disabled = false; btn.textContent = "Guardar y reenviar";
      }
    });
  }

  pintar();
}

function mostrarExito(contenedor, opciones, verificado = false) {
  const { compacto = false } = opciones;
  const extra = verificado
    ? "Tu correo quedó verificado. "
    : "";
  contenedor.innerHTML = `
    <div class="vinc-caja vinc-exito ${compacto ? "vinc-compacto" : ""}">
      <div class="vinc-icono">✅</div>
      <h3 class="vinc-titulo">¡Caja vinculada!</h3>
      <p class="vinc-desc">
        ${extra}Esta caja ya está conectada a tu cuenta. Tus ventas empezarán a
        aparecer en tu celular en unos segundos.
      </p>
      <button type="button" class="vinc-btn-primario" id="vinc-continuar">Continuar</button>
    </div>`;
  const btn = contenedor.querySelector("#vinc-continuar");
  btn.addEventListener("click", () => {
    if (opciones.alVincular) opciones.alVincular();
  });
}

function mostrarYaVinculado(contenedor, opciones) {
  const { compacto = false } = opciones;
  contenedor.innerHTML = `
    <div class="vinc-caja vinc-ok ${compacto ? "vinc-compacto" : ""}">
      <div class="vinc-icono">☁️</div>
      <h3 class="vinc-titulo">Esta caja está vinculada</h3>
      <p class="vinc-desc">
        Tus ventas se están enviando a tu cuenta en la nube. Puedes verlas
        desde la app YvexPOS en tu celular.
      </p>
      <button type="button" class="vinc-btn-secundario" id="vinc-desvincular">
        Desvincular esta caja
      </button>
    </div>`;
  contenedor.querySelector("#vinc-desvincular").addEventListener("click", async () => {
    if (!confirm("¿Desvincular esta caja? Dejará de enviar ventas a la nube hasta que la vincules de nuevo.")) return;
    try {
      await invoke("vinc_desvincular");
      montarVinculacion(contenedor, opciones);
    } catch (e) {
      alert("No se pudo desvincular: " + e);
    }
  });
}
