// YvexPOS — Shell de navegación: sidebar persistente + línea de vida + contenido.
// -----------------------------------------------------------------------------
// Se monta UNA vez tras login + caja abierta, y vive mientras dura la sesión.
// Las vistas se montan dentro de shell.contenido (que replica el rol del viejo
// #app), así que NO necesitan cambios: reciben un elemento y lo controlan.
//
// Uso desde main.js:
//   const shell = montarShell(app, sesion, {
//     alNavegar: (mod) => abrirModulo(mod),   // click en un ítem del sidebar
//     alSalir:   () => irALogin(),             // botón cerrar sesión
//   });
//   shell.contenido            → elemento donde montar cada vista
//   shell.marcarActivo("venta")→ resalta el ítem del módulo activo
//   shell.lineaVida.exito()    → recorrido verde (venta cobrada); vuelve solo
//   shell.lineaVida.atencion("Sin conexión") → parpadeo ámbar persistente
//   shell.lineaVida.operando() → estado base
//
// La línea de vida es un componente de MARCA: es la misma en todos los temas.

import { icono } from "./iconos.js";
import { escapar } from "./formato.js";

// ---------------------------------------------------------------------------
// Puente global a la línea de vida. Permite que cualquier vista dispare la
// firma de marca sin recibir el shell por parámetro (cero cambios de firma):
//   import { lineaVida } from "../util/sidebar.js";
//   lineaVida.exito();  // recorrido verde al cobrar
// Si el shell no está montado (login, onboarding), las llamadas no hacen nada.
let lvActual = null;
export const lineaVida = {
  operando() { if (lvActual) lvActual.operando(); },
  exito()    { if (lvActual) lvActual.exito(); },
  atencion() { if (lvActual) lvActual.atencion(); },
};

// Puente global al badge de Pedidos web (mismo patrón que lineaVida): cualquier
// parte de la app puede refrescar el numerito sin recibir el shell:
//   import { badgePedidos } from "../util/sidebar.js";
//   badgePedidos.actualizar(3);
// Si el shell no está montado, la llamada no hace nada.
let badgeActual = null;
export const badgePedidos = {
  actualizar(n) { if (badgeActual) badgeActual(n); },
};

// Ítems de navegación. `roles` limita visibilidad (como el menú actual).
const ITEMS = [
  { mod: "inicio",        texto: "Inicio",        ico: "inicio" },
  { mod: "venta",         texto: "Venta",         ico: "venta" },
  { mod: "pedidosweb",    texto: "Pedidos web",   ico: "pedidos", badge: true },
  { mod: "tienda",        texto: "Tienda",        ico: "tienda" },
  { mod: "inventario",    texto: "Productos",     ico: "inventario" },
  { mod: "existencias",   texto: "Inventario",    ico: "existencias" },
  { mod: "clientes",      texto: "Clientes",      ico: "clientes" },
  { mod: "credito",       texto: "Crédito",       ico: "credito" },
  { mod: "caja",          texto: "Corte",         ico: "caja" },
  { mod: "reportes",      texto: "Reportes",      ico: "reportes",      roles: ["dueno", "gerente"] },
  { mod: "configuracion", texto: "Configuración", ico: "configuracion", roles: ["dueno", "gerente"] },
];

export function montarShell(raiz, sesion, { alNavegar, alSalir }) {
  // El shell toma el ancho/alto completo: neutralizar el centrado de #app.
  raiz.style.cssText = "align-items:stretch;justify-content:flex-start;padding:0;";

  const visibles = ITEMS.filter(
    (it) => !it.roles || it.roles.includes(sesion.rol)
  );

  raiz.innerHTML = `
    <div class="shell">
      <div class="shell-fila">
        <nav class="sb" id="shell-sb" aria-label="Navegación principal">
          <div class="sb-logo" title="YvexPOS">
            <svg viewBox="0 0 64 64" fill="none" width="26" height="26" aria-hidden="true">
              <path d="M14 12 L32 38 L50 12" stroke="url(#sbg)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M32 38 L32 52" stroke="url(#sbg)" stroke-width="8" stroke-linecap="round"/>
              <defs><linearGradient id="sbg" x1="14" y1="12" x2="50" y2="52">
                <stop stop-color="var(--marca-a)"/><stop offset="1" stop-color="var(--marca-b)"/>
              </linearGradient></defs>
            </svg>
            <span class="sb-marca">Yvex<span class="sb-marca-pos">POS</span></span>
          </div>
          <div class="sb-items">
            ${visibles
              .map(
                (it) => `
              <button class="sb-item" data-mod="${it.mod}" title="${escapar(it.texto)}">
                <span class="sb-ico">${icono(it.ico)}</span>
                <span class="sb-texto">${escapar(it.texto)}</span>
                ${it.badge ? '<span class="sb-badge" id="sb-badge-pedidos" hidden></span>' : ""}
              </button>`
              )
              .join("")}
          </div>
          <div class="sb-fin">
            <div class="sb-user" title="${escapar(sesion.nombre)} · ${escapar(sesion.rol)}">
              <span class="sb-avatar" style="--rol-color:var(--rol-${escapar(sesion.rol)})">
                ${escapar((sesion.nombre || "?").trim()[0] || "?").toUpperCase()}
              </span>
              <span class="sb-user-txt">
                <b>${escapar(sesion.nombre)}</b>
                <small>${escapar(sesion.rol)} · Caja</small>
              </span>
            </div>
            <button class="sb-item sb-salir" id="shell-salir" title="Cerrar sesión">
              <span class="sb-ico">${icono("salir")}</span>
              <span class="sb-texto">Cerrar sesión</span>
            </button>
          </div>
        </nav>
        <div class="shell-contenido" id="shell-contenido"></div>
      </div>
      <footer class="shell-pie">
        <div class="linea-vida" id="shell-lv"></div>
        <div class="shell-pie-fila">
          <span class="shell-estado" id="shell-estado">● Operando</span>
          <span class="shell-pie-info">${escapar(sesion.nombre)} · ${escapar(sesion.rol)}</span>
        </div>
      </footer>
    </div>
  `;

  const lv = raiz.querySelector("#shell-lv");
  const estadoTxt = raiz.querySelector("#shell-estado");
  const contenido = raiz.querySelector("#shell-contenido");
  let volverTimer = null;

  // --- navegación ---
  raiz.querySelectorAll(".sb-item[data-mod]").forEach((b) =>
    b.addEventListener("click", () => alNavegar(b.dataset.mod))
  );
  raiz.querySelector("#shell-salir").addEventListener("click", alSalir);

  function marcarActivo(mod) {
    raiz
      .querySelectorAll(".sb-item[data-mod]")
      .forEach((b) => b.classList.toggle("sb-item--activo", b.dataset.mod === mod));
  }

  // --- línea de vida (instancia de este shell) ---
  const lineaVida = {
    operando() {
      clearTimeout(volverTimer);
      lv.className = "linea-vida";
      estadoTxt.textContent = "● Operando";
      estadoTxt.style.color = "var(--acento)";
    },
    exito() {
      // Recorrido verde; reiniciar la animación aunque se dispare dos veces seguidas.
      clearTimeout(volverTimer);
      lv.className = "linea-vida";
      void lv.offsetWidth;
      lv.className = "linea-vida lv--exito";
      estadoTxt.textContent = "● Venta cobrada";
      estadoTxt.style.color = "var(--exito)";
      volverTimer = setTimeout(() => lineaVida.operando(), 2200);
    },
    atencion(texto) {
      clearTimeout(volverTimer);
      lv.className = "linea-vida lv--atencion";
      estadoTxt.textContent = "● " + (texto || "Atención");
      estadoTxt.style.color = "var(--alerta)";
    },
  };

  // Registrar esta línea de vida como la global (ver puente arriba).
  lvActual = lineaVida;

  // --- badge de Pedidos web (instancia de este shell) ---
  const badgeEl = raiz.querySelector("#sb-badge-pedidos");
  badgeActual = badgeEl
    ? (n) => {
        const num = Number(n) || 0;
        badgeEl.hidden = num <= 0;
        badgeEl.textContent = num > 99 ? "99+" : String(num);
      }
    : null;

  return { contenido, marcarActivo, lineaVida };
}