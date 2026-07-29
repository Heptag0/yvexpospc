// YvexPOS — Login: el recibimiento.
// La primera pantalla del día y la primera de toda demo: panel de marca con
// el símbolo latiendo, y el flujo ¿quién está en caja? → PIN con teclado
// en pantalla + teclado físico. Sin shell (aún no hay sesión).
//
// Contrato intacto: montarLogin(contenedor, alLogin) → alLogin(usuario)
// tras invoke("login", { usuarioId, pin }) exitoso.

import { invoke } from "@tauri-apps/api/core";
import { escapar } from "../util/formato.js";

export function montarLogin(contenedor, alLogin) {
  contenedor.innerHTML = "";
  contenedor.style.cssText = "align-items:stretch;justify-content:flex-start;padding:0;";

  const wrap = document.createElement("div");
  wrap.className = "login";
  contenedor.appendChild(wrap);

  let usuarios = [];
  let seleccionado = null;
  let pin = "";
  let ocupado = false;

  wrap.innerHTML = `
    <aside class="login-marca">
      <svg class="login-marca-agua" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <path d="M14 12 L32 38 L50 12" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M32 38 L32 52" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>
      </svg>
      <div class="login-marca-centro">
        <svg class="login-simbolo" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <path d="M14 12 L32 38 L50 12" stroke="url(#lg)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M32 38 L32 52" stroke="url(#lg)" stroke-width="7" stroke-linecap="round"/>
          <circle class="login-nucleo" cx="32" cy="40" r="5" fill="var(--marca-b)"/>
          <defs><linearGradient id="lg" x1="14" y1="12" x2="50" y2="52">
            <stop stop-color="var(--marca-a)"/><stop offset="1" stop-color="var(--marca-b)"/>
          </linearGradient></defs>
        </svg>
        <div class="login-wordmark">Yvex<span>POS</span></div>
        <p class="login-tagline">Tu punto de venta, a tu manera.</p>
        <p class="login-negocio" id="login-negocio" hidden></p>
      </div>
      <div class="linea-vida login-lv"></div>
    </aside>
    <section class="login-panel">
      <div class="login-caja" id="login-caja">
        <div class="inv-vacio">Cargando usuarios…</div>
      </div>
    </section>
  `;

  const caja = wrap.querySelector("#login-caja");

  // El login de TU tienda lleva su nombre: la personalización desde el
  // primer pixel. config_leer_todo ya es invocable antes del login (main.js
  // lo usa para la apariencia); si falla, simplemente no se muestra.
  (async () => {
    try {
      const cfg = await invoke("config_leer_todo");
      const nombre = cfg && cfg.negocio_nombre;
      if (nombre) {
        const el = wrap.querySelector("#login-negocio");
        el.hidden = false;
        el.textContent = nombre;
      }
    } catch (e) { /* primer arranque o sin permiso: silencio */ }
  })();

  // ------------------------------------------------ Fase 1: ¿quién eres?
  async function cargarUsuarios() {
    try {
      usuarios = await invoke("listar_usuarios");
    } catch (e) {
      caja.innerHTML = '<div class="estado estado--error">✗ ' + escapar(String(e)) + "</div>";
      return;
    }
    faseUsuarios();
  }

  function faseUsuarios() {
    seleccionado = null;
    pin = "";
    caja.innerHTML = `
      <h1 class="login-titulo">¿Quién está en caja?</h1>
      <p class="login-sub">Elige tu usuario para entrar al turno.</p>
      <div class="login-usuarios">
        ${usuarios.map((u) => `
          <button class="login-usuario" data-id="${u.id}">
            <span class="login-avatar" style="--rol-color:var(--rol-${escapar(u.rol)}, var(--acento))">
              ${escapar((u.nombre || "?").trim()[0] || "?").toUpperCase()}
            </span>
            <span class="login-usuario-txt">
              <b>${escapar(u.nombre)}</b>
              <small>${escapar(u.rol)}</small>
            </span>
          </button>`).join("")}
      </div>
    `;
    caja.querySelectorAll("[data-id]").forEach((b) =>
      b.addEventListener("click", () => {
        seleccionado = usuarios.find((u) => u.id === b.dataset.id);
        fasePin();
      }));
  }

  // ------------------------------------------------ Fase 2: PIN
  function fasePin() {
    pin = "";
    caja.innerHTML = `
      <button class="login-cambiar" id="login-cambiar">← Cambiar de usuario</button>
      <div class="login-quien">
        <span class="login-avatar login-avatar--grande" style="--rol-color:var(--rol-${escapar(seleccionado.rol)}, var(--acento))">
          ${escapar((seleccionado.nombre || "?").trim()[0] || "?").toUpperCase()}
        </span>
        <div><b>${escapar(seleccionado.nombre)}</b><small>${escapar(seleccionado.rol)}</small></div>
      </div>
      <div class="login-pin" id="login-pin">
        ${[0, 1, 2, 3, 4, 5].map(() => '<span class="login-punto"></span>').join("")}
      </div>
      <p class="m-error login-error" id="login-error"></p>
      <div class="login-pad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) =>
          `<button class="login-tecla" data-n="${n}">${n}</button>`).join("")}
        <button class="login-tecla login-tecla--borrar" data-borrar aria-label="Borrar">⌫</button>
        <button class="login-tecla" data-n="0">0</button>
        <button class="login-tecla login-tecla--ok" data-ok>OK</button>
      </div>
    `;
    caja.querySelector("#login-cambiar").addEventListener("click", faseUsuarios);
    caja.querySelectorAll("[data-n]").forEach((b) =>
      b.addEventListener("click", () => teclear(b.dataset.n)));
    caja.querySelector("[data-borrar]").addEventListener("click", borrar);
    caja.querySelector("[data-ok]").addEventListener("click", entrar);
  }

  function pintarPuntos() {
    const puntos = caja.querySelectorAll(".login-punto");
    puntos.forEach((p, i) => p.classList.toggle("login-punto--lleno", i < pin.length));
  }

  function teclear(n) {
    if (ocupado || !seleccionado || pin.length >= 6) return;
    pin += n;
    pintarPuntos();
    const err = caja.querySelector("#login-error");
    if (err) err.textContent = "";
    // El PIN es de 4 a 6 dígitos: al llegar al máximo se confirma solo;
    // los de 4-5 confirman con OK o Enter (mismo contrato que antes).
    if (pin.length === 6) entrar();
  }

  function borrar() {
    if (ocupado) return;
    pin = pin.slice(0, -1);
    pintarPuntos();
    const err = caja.querySelector("#login-error");
    if (err) err.textContent = "";
  }

  async function entrar() {
    if (ocupado) return;
    if (pin.length < 4) {
      const err = caja.querySelector("#login-error");
      if (err) err.textContent = "El PIN tiene al menos 4 dígitos.";
      return;
    }
    ocupado = true;
    try {
      const usuario = await invoke("login", { usuarioId: seleccionado.id, pin });
      // Éxito: destello en la línea de vida de la marca y adelante.
      document.removeEventListener("keydown", onTecla);
      wrap.querySelector(".login-lv").classList.add("lv--exito");
      setTimeout(() => alLogin(usuario), 350);
    } catch (e) {
      ocupado = false;
      pin = "";
      pintarPuntos();
      const zona = caja.querySelector("#login-pin");
      const err = caja.querySelector("#login-error");
      if (err) err.textContent = String(e);
      // Sacudida: el clásico "PIN incorrecto" sin palabras.
      zona.classList.remove("login-pin--error");
      void zona.offsetWidth;
      zona.classList.add("login-pin--error");
    }
  }

  // Teclado físico: números, retroceso y escape para cambiar de usuario.
  function onTecla(e) {
    if (!seleccionado) return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); teclear(e.key); }
    else if (e.key === "Backspace") { e.preventDefault(); borrar(); }
    else if (e.key === "Enter") { e.preventDefault(); entrar(); }
    else if (e.key === "Escape") { e.preventDefault(); faseUsuarios(); }
  }
  document.addEventListener("keydown", onTecla);
  // Al montar cualquier otra vista, contenedor.innerHTML cambia; limpiar el
  // listener cuando el nodo raíz salga del documento.
  const observador = new MutationObserver(() => {
    if (!document.body.contains(wrap)) {
      document.removeEventListener("keydown", onTecla);
      observador.disconnect();
    }
  });
  observador.observe(contenedor, { childList: true });

  cargarUsuarios();
}