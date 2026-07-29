// YvexPOS — vista Pedidos web.
// Atiende los pedidos que llegan de la tienda en línea: aceptar, cancelar y
// completar (al completar se registra la venta en caja vía tienda_pedido_completar).
// Auto-refresh cada 30 s + botón actualizar. Tolerante a offline: no rompe la
// pantalla si no hay internet.

import { invoke } from "@tauri-apps/api/core";
import { pesos, escapar } from "../util/formato.js";
import { confirmar } from "../util/confirmar.js";
import { folioCorto, horaRelativa, urlWhatsApp, abrirUrl } from "../util/tienda.js";
import { lineaVida } from "../util/sidebar.js";

const FILTROS = [
  { id: "nuevo", nombre: "Nuevos", estados: ["nuevo"] },
  { id: "listo", nombre: "Listos", estados: ["listo", "preparando"] },
  { id: "historial", nombre: "Historial", estados: ["entregado", "cancelado"] },
];

export function montarPedidosWeb(contenedor, sesion, cajaSesion, volver) {
  contenedor.innerHTML = "";
  contenedor.style.alignItems = "stretch";
  contenedor.style.justifyContent = "flex-start";

  const wrap = document.createElement("div");
  wrap.className = "pw";
  contenedor.appendChild(wrap);

  wrap.innerHTML = `
    <header class="pw-head">
      <div>
        <h1 class="pw-titulo">Pedidos web</h1>
        <p class="pw-sub" id="pw-sub">Los pedidos que llegan de tu tienda en línea.</p>
      </div>
      <div class="pw-filtros" id="pw-filtros">
        ${FILTROS.map((f, i) => `
          <button class="pw-filtro ${i === 0 ? "pw-filtro--on" : ""}" data-f="${f.id}">${f.nombre}</button>`).join("")}
      </div>
      <button class="btn-sec" id="pw-refrescar">Actualizar</button>
    </header>
    <div id="pw-lista"><div class="estado">Buscando pedidos…</div></div>
  `;

  const $ = (s) => wrap.querySelector(s);
  const lista = $("#pw-lista");

  let filtro = "nuevo";
  let timer = null;
  let nombreNegocio = "tu negocio";
  let muerto = false; // la vista se desmontó; no seguir refrescando

  invoke("config_leer_todo")
    .then((c) => { if (c && c.negocio_nombre) nombreNegocio = c.negocio_nombre; })
    .catch(() => {});

  $("#pw-refrescar").onclick = () => cargar(true);
  $("#pw-filtros").querySelectorAll(".pw-filtro").forEach((b) => (b.onclick = () => {
    filtro = b.dataset.f;
    $("#pw-filtros").querySelectorAll(".pw-filtro").forEach((x) =>
      x.classList.toggle("pw-filtro--on", x === b));
    cargar(true);
  }));

  cargar(true);
  programarRefresco();

  // Al salir de la vista (se reemplaza el contenido), dejar de refrescar.
  const observador = new MutationObserver(() => {
    if (!contenedor.contains(wrap)) {
      muerto = true;
      clearTimeout(timer);
      observador.disconnect();
    }
  });
  observador.observe(contenedor, { childList: true });

  function programarRefresco() {
    clearTimeout(timer);
    timer = setTimeout(() => { if (!muerto) cargar(false).finally(programarRefresco); }, 30000);
  }

  async function cargar(mostrarCargando) {
    if (mostrarCargando) lista.innerHTML = '<div class="estado">Buscando pedidos…</div>';
    let pedidos;
    try {
      // Traemos todo y filtramos en cliente: el filtro "listos" junta
      // listo + preparando (legado), que la API no puede hacer en una sola pasada.
      const r = await invoke("tienda_pedidos", { estadoFiltro: null, desde: null });
      pedidos = Array.isArray(r.pedidos) ? r.pedidos : [];
    } catch (e) {
      const msg = String(e);
      if (msg.includes("vinculada")) {
        lista.innerHTML = `
          <div class="estado" style="max-width:560px">
            <h2 style="margin:0 0 10px">Primero vincula esta caja con la nube</h2>
            <p>Los pedidos web llegan por internet, así que esta caja necesita estar
            vinculada a tu cuenta de YvexPOS desde
            <strong>Configuración → Conexión con la nube</strong>.</p>
          </div>`;
        return;
      }
      lista.innerHTML = `<div class="estado estado--error">${escapar(msg)}</div>`;
      return;
    }

    const estados = FILTROS.find((f) => f.id === filtro).estados;
    const visibles = pedidos.filter((p) => estados.includes(p.estado));
    $("#pw-sub").textContent = `${visibles.length} pedido${visibles.length === 1 ? "" : "s"} · actualizado ${horaRelativa(new Date().toISOString())}`;

    if (visibles.length === 0) {
      lista.innerHTML = `<div class="estado estado--ok" style="max-width:520px">${
        filtro === "nuevo" ? "Todo al día. Cuando entre un pedido de tu tienda, aparecerá aquí."
        : filtro === "listo" ? "No hay pedidos esperando al cliente."
        : "Todavía no hay pedidos terminados."
      }</div>`;
      return;
    }

    lista.innerHTML = "";
    for (const p of visibles) lista.appendChild(tarjeta(p));
  }

  function tarjeta(p) {
    const folio = folioCorto(p.id);
    const el = document.createElement("article");
    el.className = `pw-card con-filo pw-card--${p.estado}`;
    const items = Array.isArray(p.items) ? p.items : [];
    const contacto = [p.cliente_telefono, p.cliente_correo].filter(Boolean).join(" · ");
    el.innerHTML = `
      <div class="pw-card-head">
        <div>
          <span class="pw-folio num">#${escapar(folio)}</span>
          <span class="pw-hora">${escapar(horaRelativa(p.creado_en))}</span>
          <span class="pw-chip pw-chip--${escapar(p.estado)}">${escapar(etiquetaEstado(p.estado))}</span>
        </div>
        <div class="pw-total num">${pesos(p.total_centavos)}</div>
      </div>
      <div class="pw-cliente">
        <b>${escapar(p.cliente_nombre || "Cliente")}</b>
        ${contacto ? `<span class="pw-contacto">${escapar(contacto)}</span>` : ""}
      </div>
      <ul class="pw-items">
        ${items.map((it) => `<li>${escapar(String(it.cantidad))} × ${escapar(it.nombre)}
          <span class="num">${pesos(it.precio_centavos * it.cantidad)}</span></li>`).join("")}
      </ul>
      <div class="pw-detalle">
        <span>${p.entrega === "domicilio" ? "A domicilio" : "Recoger en tienda"}</span>
        <span>${p.pago === "en_linea" ? "Pago en línea" : "Efectivo al recibir"}</span>
      </div>
      ${p.direccion ? `<div class="pw-nota">Dirección: ${escapar(p.direccion)}</div>` : ""}
      ${p.cliente_notas ? `<div class="pw-nota">Notas: ${escapar(p.cliente_notas)}</div>` : ""}
      <div class="pw-acciones">
        ${p.ubicacion ? `<button class="btn-sec btn-mini" data-acc="mapa">Ver en el mapa</button>` : ""}
        ${p.estado === "nuevo" ? `
          <button class="btn-primario btn-mini" data-acc="aceptar">Aceptar pedido</button>
          <button class="btn-peligro btn-mini" data-acc="cancelar">Cancelar</button>` : ""}
        ${p.estado === "listo" || p.estado === "preparando" ? `
          <button class="btn-primario btn-mini" data-acc="completar">Marcar completado</button>
          <button class="btn-peligro btn-mini" data-acc="cancelar">Cancelar</button>` : ""}
      </div>
    `;

    el.querySelectorAll("[data-acc]").forEach((b) => (b.onclick = async () => {
      const acc = b.dataset.acc;
      if (acc === "mapa") {
        await abrirUrl(`https://maps.google.com/?q=${encodeURIComponent(p.ubicacion)}`);
        return;
      }
      if (acc === "aceptar") return cambiarEstado(p, "listo", "aviso_listo");
      if (acc === "cancelar") return cancelar(p);
      if (acc === "completar") return completar(p);
    }));
    return el;
  }

  function etiquetaEstado(e) {
    return { nuevo: "Nuevo", preparando: "Preparando", listo: "Listo",
             entregado: "Entregado", cancelado: "Cancelado" }[e] || e;
  }

  // Aviso simple (el alert() nativo no funciona en Tauri/WebView2).
  async function aviso(texto) {
    await confirmar(String(texto), { titulo: "Pedidos web", ok: "Entendido" });
  }

  async function cambiarEstado(p, nuevo, avisoTipo) {
    try {
      await invoke("tienda_pedido_estado", {
        pedidoId: p.id, estadoActual: p.estado, estadoNuevo: nuevo,
      });
      lineaVida.exito();
      if (avisoTipo === "aviso_listo") avisarCliente(p, "listo");
      await cargar(false);
    } catch (e) {
      await aviso(e);
    }
  }

  async function cancelar(p) {
    const ok = await confirmar(
      `¿Cancelar el pedido #${folioCorto(p.id)} de ${p.cliente_nombre || "el cliente"}? El pedido no se cobrará.`,
      { titulo: "Cancelar pedido", ok: "Sí, cancelar", peligro: true }
    );
    if (!ok) return;
    try {
      await invoke("tienda_pedido_estado", {
        pedidoId: p.id, estadoActual: p.estado, estadoNuevo: "cancelado",
      });
      avisarCliente(p, "cancelado");
      await cargar(false);
    } catch (e) {
      await aviso(e);
    }
  }

  async function completar(p) {
    try {
      const r = await invoke("tienda_pedido_completar", {
        pedidoId: p.id, usuarioPosId: sesion.id,
      });
      if (r.aviso && r.aviso.startsWith("venta_no_registrada")) {
        await confirmar(
          "El pedido quedó como entregado, pero no hay caja abierta, así que la venta no se apuntó en el corte. Abre caja antes de completar pedidos para que cuadren tus reportes.",
          { titulo: "Venta no registrada", ok: "Entendido" }
        );
      } else {
        lineaVida.exito();
        avisarCliente(p, p.entrega === "domicilio" ? "en_camino" : "listo");
      }
      await cargar(false);
    } catch (e) {
      await aviso(e);
    }
  }

  // Avisa al cliente por WhatsApp (o correo si solo hay correo). Best-effort:
  // si no hay contacto, no estorba.
  function avisarCliente(p, tipo) {
    const folio = folioCorto(p.id);
    const nombre = p.cliente_nombre || "";
    let cuerpo;
    if (tipo === "cancelado") {
      cuerpo = `Hola ${nombre}, te saluda ${nombreNegocio}. Tu pedido #${folio} fue cancelado. Cualquier duda, aquí estamos.`;
    } else if (tipo === "en_camino") {
      cuerpo = `Hola ${nombre}, te saluda ${nombreNegocio}. Tu pedido #${folio} ya va en camino.`;
    } else {
      cuerpo = `Hola ${nombre}, te saluda ${nombreNegocio}. Tu pedido #${folio} ya está listo, pásalo a recoger.`;
    }
    if (p.cliente_telefono) {
      const url = urlWhatsApp(p.cliente_telefono, cuerpo);
      if (url) abrirUrl(url).catch(() => {});
    } else if (p.cliente_correo) {
      const asunto = encodeURIComponent(`Tu pedido #${folio} · ${nombreNegocio}`);
      abrirUrl(`mailto:${p.cliente_correo}?subject=${asunto}&body=${encodeURIComponent(cuerpo)}`).catch(() => {});
    }
  }
}
