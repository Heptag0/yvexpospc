// YvexPOS — confirmación propia compartida.
// El confirm() nativo NO funciona en Tauri (WebView2 lo bloquea), así que
// toda confirmación destructiva del programa pasa por aquí.
//
// Uso:
//   import { confirmar } from "../util/confirmar.js";
//   const ok = await confirmar("¿Eliminar este cliente?", {
//     titulo: "Eliminar cliente", ok: "Eliminar", peligro: true,
//   });
//   if (!ok) return;
//
// Enter = aceptar · Escape / clic afuera = cancelar.
// Usa z-index alto (modal-overlay--confirm) para convivir con modales abiertos.

export function confirmar(mensaje, opciones = {}) {
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
