// YvexPOS — pantalla de Venta (el corazón).
// Layout del plano: carrito a la izquierda, acceso rápido a la derecha,
// COBRAR como el botón más grande. Operable con teclado y lector de barras.

import { invoke } from "@tauri-apps/api/core";
import { pesos, escapar } from "../util/formato.js";
import { icono } from "../util/iconos.js";
import { montarAlertaNegativos } from "../util/alertaNegativos.js";
import { verTicket } from "./ticket.js";
import { lineaVida } from "../util/sidebar.js";

export function montarVenta(contenedor, sesion, cajaSesion, alSalir, alAbrirDevoluciones, alIrInventarioNegativos) {
  contenedor.innerHTML = "";
  contenedor.style.alignItems = "stretch";
  contenedor.style.justifyContent = "stretch";

  const wrap = document.createElement("div");
  wrap.className = "venta";
  contenedor.appendChild(wrap);

  // Estado del carrito: [{producto, cantidad, descuento_centavos}]
  let carrito = [];
  let descuentoGlobal = 0; // centavos
  let bipId = null; // producto recién agregado: su línea emite la onda de marca
  let favoritos = [];
  // Refresco de la alerta de stock negativo (se asigna al montarla).
  let refrescarAlertaNeg = null;

  // --- Múltiples tickets (ventas simultáneas) ---
  // tickets: [{id, numero, nombre}] — los abiertos de esta caja.
  // ticketActivoId: cuál está en pantalla ahora.
  let tickets = [];
  let ticketActivoId = null;
  let guardadoTimer = null; // debounce para autoguardar

  // Serializa el carrito actual a JSON (guarda el producto completo para que el
  // ticket sobreviva aunque el producto cambie o se borre después).
  function serializarCarrito() {
    return JSON.stringify({
      lineas: carrito.map((l) => ({
        producto: l.producto,
        cantidad: l.cantidad,
        descuento_centavos: l.descuento_centavos,
      })),
      descuento_global: descuentoGlobal,
    });
  }

  // Reconstruye el carrito desde el JSON de un ticket.
  function cargarCarritoDesde(contenidoJson) {
    try {
      const data = JSON.parse(contenidoJson || "{}");
      carrito = (data.lineas || []).map((l) => ({
        producto: l.producto,
        cantidad: l.cantidad,
        descuento_centavos: l.descuento_centavos || 0,
      }));
      descuentoGlobal = data.descuento_global || 0;
    } catch (e) {
      carrito = [];
      descuentoGlobal = 0;
    }
  }

  // Guarda el ticket activo en BD (con debounce para no saturar).
  function autoguardar() {
    if (!ticketActivoId) return;
    // Mantener el contenido en memoria del ticket activo al día también.
    const t = tickets.find((x) => x.id === ticketActivoId);
    if (t) t.contenido = serializarCarrito();
    clearTimeout(guardadoTimer);
    guardadoTimer = setTimeout(async () => {
      try {
        await invoke("ticket_espera_guardar", {
          id: ticketActivoId,
          contenido: serializarCarrito(),
        });
      } catch (e) {
        console.error("No se pudo guardar el ticket:", e);
      }
    }, 400);
  }

  // Carga los tickets en espera al abrir la venta. Si no hay ninguno, crea uno.
  async function iniciarTickets() {
    try {
      tickets = await invoke("ticket_espera_listar", { cajaSesionId: cajaSesion.id });
    } catch (e) {
      tickets = [];
    }
    if (tickets.length === 0) {
      await crearTicketNuevo(false);
    } else {
      // Activar el primero y cargar su carrito.
      ticketActivoId = tickets[0].id;
      cargarCarritoDesde(tickets[0].contenido);
    }
    pintar();
    cargarFavoritos();
    renderPestanas();
    // Alerta discreta de stock negativo; al pulsar, ir a Inventario filtrado.
    if (typeof alIrInventarioNegativos === "function") {
      refrescarAlertaNeg = montarAlertaNegativos(wrap, alIrInventarioNegativos);
    }
  }

  // Crea un ticket nuevo (vacío) y lo activa.
  async function crearTicketNuevo(guardarActual = true) {
    // Guardar el actual antes de cambiar.
    if (guardarActual && ticketActivoId) {
      try { await invoke("ticket_espera_guardar", { id: ticketActivoId, contenido: serializarCarrito() }); }
      catch (e) { console.error(e); }
    }
    try {
      const nuevo = await invoke("ticket_espera_crear", {
        cajaSesionId: cajaSesion.id,
        usuarioPosId: sesion.id,
        contenido: JSON.stringify({ lineas: [], descuento_global: 0 }),
      });
      tickets.push({ id: nuevo.id, numero: nuevo.numero, nombre: nuevo.nombre, contenido: nuevo.contenido });
      ticketActivoId = nuevo.id;
      carrito = [];
      descuentoGlobal = 0;
      renderCarrito();
      renderPestanas();
    } catch (e) {
      console.error("No se pudo crear ticket:", e);
    }
  }

  // Cambia al ticket indicado (guarda el actual, carga el nuevo).
  async function cambiarTicket(id) {
    if (id === ticketActivoId) return;
    // Guardar el actual.
    if (ticketActivoId) {
      try { await invoke("ticket_espera_guardar", { id: ticketActivoId, contenido: serializarCarrito() }); }
      catch (e) { console.error(e); }
      // Actualizar el contenido en memoria del ticket que dejamos.
      const t = tickets.find((x) => x.id === ticketActivoId);
      if (t) t.contenido = serializarCarrito();
    }
    // Cargar el nuevo.
    const destino = tickets.find((x) => x.id === id);
    if (!destino) return;
    ticketActivoId = id;
    cargarCarritoDesde(destino.contenido);
    renderCarrito();
    renderPestanas();
    limpiarBusqueda();
  }

  // Cierra (descarta) un ticket. Pide confirmación si tiene productos.
  async function cerrarTicket(id) {
    const t = tickets.find((x) => x.id === id);
    if (!t) return;
    // Ver si tiene productos. Para el ticket activo, mirar el carrito EN VIVO
    // (fuente de verdad); para los demás, su contenido guardado en memoria.
    let tieneItems = false;
    if (id === ticketActivoId) {
      tieneItems = carrito.length > 0;
    } else {
      try {
        const data = JSON.parse(t.contenido || "{}");
        tieneItems = (data.lineas || []).length > 0;
      } catch (e) {}
    }
    const etiqueta = t.nombre || `Ticket ${t.numero}`;
    if (tieneItems) {
      const ok = await confirmar(`Se perderán los productos de "${etiqueta}".`, {
        titulo: "¿Descartar ticket?",
        ok: "Descartar",
        cancelar: "Cancelar",
        peligro: true,
      });
      if (!ok) return;
    }
    try { await invoke("ticket_espera_eliminar", { id }); }
    catch (e) { console.error(e); }
    tickets = tickets.filter((x) => x.id !== id);
    // Si cerramos el activo, activar otro o crear uno nuevo.
    if (id === ticketActivoId) {
      if (tickets.length > 0) {
        ticketActivoId = tickets[0].id;
        cargarCarritoDesde(tickets[0].contenido);
        renderCarrito();
      } else {
        ticketActivoId = null;
        await crearTicketNuevo(false);
        return;
      }
    }
    renderPestanas();
  }

  // Tras cobrar: elimina el ticket activo (ya es venta real) y pasa a otro.
  async function finalizarTicketCobrado() {
    const cobradoId = ticketActivoId;
    if (cobradoId) {
      try { await invoke("ticket_espera_eliminar", { id: cobradoId }); }
      catch (e) { console.error(e); }
      tickets = tickets.filter((x) => x.id !== cobradoId);
    }
    // Limpiar el carrito en memoria.
    carrito = [];
    descuentoGlobal = 0;
    ticketActivoId = null;
    // Activar otro ticket o crear uno vacío.
    if (tickets.length > 0) {
      ticketActivoId = tickets[0].id;
      cargarCarritoDesde(tickets[0].contenido);
    } else {
      await crearTicketNuevo(false);
    }
    renderCarrito();
    renderPestanas();
  }

  // Renombra un ticket con modal propio (prompt() nativo no funciona en Tauri).
  async function renombrarTicket(id) {
    const t = tickets.find((x) => x.id === id);
    if (!t) return;
    const actual = t.nombre || "";
    const html = `
      <h2>Nombre del ticket</h2>
      <p class="m-sub">Ticket ${t.numero} · un nombre ayuda a identificar al cliente ("Sra. Lupita", "Mesa 2"…)</p>
      <label>Nombre
        <input id="rt-nombre" value="${escapar(actual)}" placeholder="Ticket ${t.numero}" maxlength="30" />
      </label>
      <div class="m-acciones"><span></span><div>
        <button class="btn-sec" id="rt-cancelar">Cancelar</button>
        <button class="btn-primario" id="rt-ok">Guardar</button>
      </div></div>
    `;
    const modal = abrirModal(html);
    const input = modal.querySelector("#rt-nombre");
    setTimeout(() => { input.focus(); input.select(); }, 50);
    const guardar = async () => {
      const nombre = input.value.trim() || null;
      cerrarModal();
      try {
        await invoke("ticket_espera_renombrar", { id, nombre });
        t.nombre = nombre;
        renderPestanas();
      } catch (e) {
        console.error(e);
      }
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); guardar(); } });
    modal.querySelector("#rt-cancelar").addEventListener("click", cerrarModal);
    modal.querySelector("#rt-ok").addEventListener("click", guardar);
  }

  // Dibuja la barra de pestañas de tickets.
  function renderPestanas() {
    const cont = wrap.querySelector("#venta-tabs");
    if (!cont) return;
    cont.innerHTML =
      tickets
        .map((t) => {
          const activo = t.id === ticketActivoId;
          const etiqueta = t.nombre ? escapar(t.nombre) : `Ticket ${t.numero}`;
          return `
        <div class="vt-tab ${activo ? "vt-tab--activa" : ""}" data-tab="${t.id}">
          <span class="vt-tab-nombre" data-tabnombre="${t.id}">${etiqueta}</span>
          <button class="vt-tab-cerrar" data-tabcerrar="${t.id}" aria-label="Cerrar" type="button">×</button>
        </div>`;
        })
        .join("") +
      `<button class="vt-tab-nuevo" id="vt-tab-nuevo" aria-label="Nuevo ticket" type="button">+</button>`;

    // Un solo manejador por delegación: decide según dónde se hizo clic.
    // Así evitamos conflictos de orden entre "cerrar" y "cambiar de ticket".
    cont.onclick = (e) => {
      const btnCerrar = e.target.closest("[data-tabcerrar]");
      if (btnCerrar) {
        e.preventDefault();
        e.stopPropagation();
        cerrarTicket(btnCerrar.dataset.tabcerrar);
        return;
      }
      const btnNuevo = e.target.closest("#vt-tab-nuevo");
      if (btnNuevo) {
        crearTicketNuevo(true);
        return;
      }
      const tab = e.target.closest("[data-tab]");
      if (!tab) return;
      const id = tab.dataset.tab;
      // Clic en el nombre del ticket YA activo = renombrar.
      if (e.target.closest("[data-tabnombre]") && id === ticketActivoId) {
        renombrarTicket(id);
        return;
      }
      cambiarTicket(id);
    };
  }

  // Atajos de teclado globales de la pantalla de venta.
  //   F10 → buscar por nombre     F12 → cobrar     Supr → quitar línea enfocada
  // (La confirmación de venta con F1/F2 se maneja dentro del modal de cobro.)
  function onTeclaGlobal(e) {
    // No interferir si hay un modal abierto (el modal maneja su propio teclado).
    if (modalVenta) return;
    if (e.key === "F10") {
      e.preventDefault();
      abrirBuscadorNombre();
    } else if (e.key === "F12") {
      e.preventDefault();
      if (carrito.length > 0) abrirCobro();
    } else if (e.key === "Delete" || e.key === "Supr") {
      // Suprimir: quita la línea cuyo input de cantidad esté enfocado.
      const activo = document.activeElement;
      if (activo && activo.dataset && activo.dataset.cant !== undefined) {
        e.preventDefault();
        quitarLinea(+activo.dataset.cant);
      }
    }
  }
  document.addEventListener("keydown", onTeclaGlobal);

  // Limpieza al salir de la vista: quitar el listener global.
  const alSalirLimpio = () => {
    document.removeEventListener("keydown", onTeclaGlobal);
    if (typeof alSalir === "function") alSalir();
  };

  iniciarTickets();

  function pintar() {
    wrap.innerHTML = `
      <div class="venta-izq">
        <div class="venta-tabs" id="venta-tabs"></div>
        <div class="venta-panel con-filo">
          <header class="venta-head">
            <button class="inv-volver" id="venta-volver" aria-label="Salir">←</button>
            <div class="venta-buscar-wrap">
              <span class="venta-buscar-ico">${icono("buscar")}</span>
              <input id="venta-buscar" class="venta-buscar" placeholder="Escanea o teclea un código…" autocomplete="off" style="text-transform:uppercase" />
              <span class="tecla-hint">F10 · nombre</span>
            </div>
            <span class="venta-cajero">${escapar(sesion.nombre)}</span>
          </header>
          <div class="venta-resultados venta-resultados--centro" id="venta-resultados" hidden></div>
          <div class="carrito" id="carrito"></div>
          <div class="venta-totales">
            <div class="vt-fila"><span>Subtotal</span><span class="num" id="vt-subtotal">$0.00</span></div>
            <div class="vt-fila vt-desc" id="vt-desc-fila" hidden>
              <span>Descuento <button class="vt-desc-quitar" id="vt-desc-quitar">quitar</button></span>
              <span class="num" id="vt-desc">-$0.00</span>
            </div>
            <div class="vt-fila vt-total"><span>Total</span><span class="num" id="vt-total">$0.00</span></div>
            <div class="venta-acciones">
              <button class="btn-sec" id="venta-desc">Descuento</button>
              <button class="btn-cobrar" id="venta-cobrar">Cobrar <span class="tecla-hint tecla-hint--enbtn">F12</span></button>
            </div>
          </div>
        </div>
      </div>
      <div class="venta-der">
        <button class="venta-buscar-nombre con-filo" id="venta-buscar-nombre">${icono("buscar")}<span>Buscar por nombre</span><span class="tecla-hint">F10</span></button>
        <div class="venta-panel venta-panel--favs con-filo">
          <div class="venta-favs-titulo">Favoritos</div>
          <div class="venta-favs" id="venta-favs"></div>
        </div>
        <button class="btn-sec venta-devol" id="venta-devol">Ventas del día</button>
      </div>
    `;

    wrap.querySelector("#venta-volver").addEventListener("click", async () => {
      // Guardar el ticket activo antes de salir (queda en espera).
      if (ticketActivoId) {
        try { await invoke("ticket_espera_guardar", { id: ticketActivoId, contenido: serializarCarrito() }); }
        catch (e) { console.error(e); }
      }
      alSalirLimpio();
    });

    wrap.querySelector("#venta-devol").addEventListener("click", async () => {
      if (ticketActivoId) {
        try { await invoke("ticket_espera_guardar", { id: ticketActivoId, contenido: serializarCarrito() }); }
        catch (e) { console.error(e); }
      }
      if (typeof alAbrirDevoluciones === "function") alAbrirDevoluciones();
    });

    const buscar = wrap.querySelector("#venta-buscar");
    // La barra principal es SOLO para código de barras (lector o tecleado):
    // Enter escanea. Ya no busca por nombre en vivo (eso genera ruido de
    // resultados que no corresponden al código). El buscador por nombre se
    // abre con F10 (ver más abajo).
    buscar.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        escanear(buscar.value.trim());
      }
    });

    wrap.querySelector("#venta-desc").addEventListener("click", abrirDescuentoGlobal);
    wrap.querySelector("#vt-desc-quitar")?.addEventListener("click", () => {
      descuentoGlobal = 0;
      renderTotales();
    });
    wrap.querySelector("#venta-cobrar").addEventListener("click", abrirCobro);
    wrap.querySelector("#venta-buscar-nombre").addEventListener("click", abrirBuscadorNombre);

    renderCarrito();
    renderFavoritos();
    renderPestanas();
    setTimeout(() => buscar.focus(), 60);
  }

  // -------------------------------------------------------------- Productos
  async function cargarFavoritos() {
    try {
      const todos = await invoke("prod_listar", { rol: sesion.rol, filtro: null, soloStockBajo: false });
      favoritos = todos.filter((p) => p.favorito);
      renderFavoritos();
    } catch (e) {
      favoritos = [];
    }
  }

  async function buscarProductos(texto) {
    const cont = wrap.querySelector("#venta-resultados");
    if (!texto) {
      cont.hidden = true;
      cont.innerHTML = "";
      return;
    }
    try {
      const res = await invoke("prod_listar", { rol: sesion.rol, filtro: texto, soloStockBajo: false });
      if (res.length === 0) {
        cont.hidden = false;
        cont.innerHTML = '<div class="vr-vacio">Sin resultados.</div>';
        return;
      }
      cont.hidden = false;
      cont.innerHTML = res
        .slice(0, 8)
        .map(
          (p) => `
        <button class="vr-item" data-id="${p.id}">
          <span class="vr-nombre">${escapar(p.nombre)}</span>
          <span class="vr-precio num">${pesos(p.precio_venta_centavos)}</span>
        </button>`
        )
        .join("");
      cont.querySelectorAll(".vr-item").forEach((b) =>
        b.addEventListener("click", async () => {
          const p = res.find((x) => x.id === b.dataset.id);
          await agregar(p);
          limpiarBusqueda();
        })
      );
    } catch (e) {
      cont.hidden = false;
      cont.innerHTML = '<div class="vr-vacio">Error: ' + escapar(String(e)) + "</div>";
    }
  }

  async function escanear(codigo) {
    if (!codigo) return;
    try {
      const p = await invoke("prod_por_codigo", { rol: sesion.rol, codigo });
      if (p) {
        await agregar(p);
        limpiarBusqueda();
      } else {
        // No existe: por ahora avisamos. (Alta rápida vendrá luego.)
        const buscar = wrap.querySelector("#venta-buscar");
        buscar.classList.add("venta-buscar--error");
        setTimeout(() => buscar.classList.remove("venta-buscar--error"), 600);
      }
    } catch (e) {
      console.error(e);
    }
  }

  function limpiarBusqueda() {
    const buscar = wrap.querySelector("#venta-buscar");
    buscar.value = "";
    wrap.querySelector("#venta-resultados").hidden = true;
    wrap.querySelector("#venta-resultados").innerHTML = "";
    buscar.focus();
  }

  // Buscador POR NOMBRE en un modal dedicado (F10 o botón). Separado de la
  // barra principal (que es solo código). Aquí sí se busca por nombre y se
  // muestran resultados para elegir.
  function abrirBuscadorNombre() {
    const html = `
      <h2>Buscar producto por nombre</h2>
      <input id="bn-input" class="campo bn-input" placeholder="Escribe el nombre del producto…" autocomplete="off" />
      <div class="bn-resultados" id="bn-resultados"></div>
      <div class="m-acciones"><span></span><div>
        <button class="btn-sec" id="bn-cerrar">Cerrar</button>
      </div></div>
    `;
    const modal = abrirModal(html);
    const input = modal.querySelector("#bn-input");
    const cont = modal.querySelector("#bn-resultados");
    modal.querySelector("#bn-cerrar").addEventListener("click", () => cerrarModal());

    let t;
    input.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => correr(input.value.trim()), 150);
    });
    // Enter agrega el primer resultado (rápido con teclado).
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const primero = cont.querySelector(".vr-item");
        if (primero) primero.click();
      }
    });

    async function correr(texto) {
      if (!texto) { cont.innerHTML = ""; return; }
      try {
        const res = await invoke("prod_listar", { rol: sesion.rol, filtro: texto, soloStockBajo: false });
        if (res.length === 0) {
          cont.innerHTML = '<div class="vr-vacio">Sin resultados.</div>';
          return;
        }
        cont.innerHTML = res.slice(0, 10).map((p) => `
          <button class="vr-item" data-id="${p.id}">
            <span class="vr-nombre">${escapar(p.nombre)}</span>
            <span class="vr-precio num">${pesos(p.precio_venta_centavos)}</span>
          </button>`).join("");
        cont.querySelectorAll(".vr-item").forEach((b) =>
          b.addEventListener("click", async () => {
            const p = res.find((x) => x.id === b.dataset.id);
            await agregar(p);
            cerrarModal();
          })
        );
      } catch (e) {
        cont.innerHTML = '<div class="vr-vacio">Error: ' + escapar(String(e)) + "</div>";
      }
    }

    setTimeout(() => input.focus(), 50);
  }

  function renderFavoritos() {
    const cont = wrap.querySelector("#venta-favs");
    if (!cont) return;
    if (favoritos.length === 0) {
      cont.innerHTML = '<div class="favs-vacio">Marca productos como favoritos en Inventario para acceso rápido.</div>';
      return;
    }
    cont.innerHTML = favoritos
      .map(
        (p) => `
      <button class="fav-card" data-id="${p.id}">
        <span class="fav-nombre">${escapar(p.nombre)}</span>
        <span class="fav-precio num">${pesos(p.precio_venta_centavos)}</span>
      </button>`
      )
      .join("");
    cont.querySelectorAll(".fav-card").forEach((b) =>
      b.addEventListener("click", async () => {
        const p = favoritos.find((x) => x.id === b.dataset.id);
        await agregar(p);
      })
    );
  }

  // ---------------------------------------------------------------- Carrito
  async function agregar(producto) {
    const existe = carrito.find((l) => l.producto.id === producto.id);
    const cantidadActual = existe ? existe.cantidad : 0;
    const nuevaCantidad = cantidadActual + 1;

    if (producto.es_kit) {
      // Un kit no tiene stock propio: validamos contra sus componentes.
      let disponibles = null;
      try {
        disponibles = await invoke("kit_disponibles", { kitId: producto.id });
      } catch (e) {
        console.error("No se pudo verificar disponibilidad del paquete:", e);
      }
      // disponibles === null => algún/ningún componente controla stock =>
      // sin límite conocido; dejamos pasar.
      if (disponibles !== null && nuevaCantidad > disponibles) {
        const continuar = await avisoStockKit(producto, disponibles);
        if (!continuar) return; // el usuario decidió no continuar
      }
      // Añadir el kit.
      if (existe) existe.cantidad += 1;
      else carrito.push({ producto, cantidad: 1, descuento_centavos: 0 });
      bipId = producto.id;
      renderCarrito();
      return;
    }

    // Producto normal: validar su propio stock.
    if (producto.controla_stock && nuevaCantidad > producto.stock) {
      avisoStock(producto);
      return;
    }
    if (existe) existe.cantidad += 1;
    else carrito.push({ producto, cantidad: 1, descuento_centavos: 0 });
    bipId = producto.id;
    renderCarrito();
  }

  // Aviso bloqueante para kits sin stock suficiente de componentes.
  // Devuelve true si el usuario decide continuar de todos modos (stock negativo).
  async function avisoStockKit(producto, disponibles) {
    // Averiguar qué componentes faltan, para un mensaje claro.
    let faltantes = [];
    try {
      const comps = await invoke("kit_componentes", { kitId: producto.id });
      faltantes = comps
        .filter((c) => c.controla_stock && c.stock < c.cantidad)
        .map((c) => `${c.nombre} (hay ${fmtStock(c.stock)}, se necesitan ${fmtStock(c.cantidad)})`);
    } catch (e) {
      console.error(e);
    }
    const detalle =
      disponibles <= 0
        ? `No se puede armar ni un "${producto.nombre}" con el inventario actual.`
        : `Solo alcanza para ${fmtStock(disponibles)} paquete(s) de "${producto.nombre}".`;
    const listaFaltan = faltantes.length
      ? `\n\nFalta inventario de:\n• ${faltantes.join("\n• ")}`
      : "";
    return await confirmar(
      `${detalle}${listaFaltan}\n\nLo recomendable es ajustar el inventario de esos productos. ¿Quieres vender de todos modos? El stock quedará en negativo y deberás corregirlo con un ajuste.`,
      {
        titulo: "No hay inventario suficiente para el paquete",
        ok: "Vender de todos modos",
        cancelar: "Cancelar",
        peligro: true,
      }
    );
  }

  function avisoStock(producto) {
    // Aviso breve no bloqueante (toast) en vez de un alert que corta el flujo.
    let toast = wrap.querySelector("#venta-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "venta-toast";
      toast.className = "venta-toast";
      wrap.appendChild(toast);
    }
    toast.textContent = `Sin stock suficiente de ${producto.nombre} (quedan ${fmtStock(producto.stock)})`;
    toast.classList.add("venta-toast--visible");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove("venta-toast--visible"), 2200);
  }

  function fmtStock(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(3);
  }

  function precioAplicado(linea) {
    const p = linea.producto;
    if (p.precio_mayoreo_centavos && p.cantidad_mayoreo && linea.cantidad >= p.cantidad_mayoreo) {
      return p.precio_mayoreo_centavos;
    }
    return p.precio_venta_centavos;
  }

  function totalLinea(linea) {
    const bruto = Math.round(precioAplicado(linea) * linea.cantidad);
    return Math.max(0, bruto - linea.descuento_centavos);
  }

  function subtotal() {
    return carrito.reduce((s, l) => s + totalLinea(l), 0);
  }

  function renderCarrito() {
    const cont = wrap.querySelector("#carrito");
    if (carrito.length === 0) {
      cont.innerHTML = '<div class="carrito-vacio"><span class="carrito-vacio-ico">' + icono("venta") + '</span>Escanea o busca un producto para empezar.</div>';
      renderTotales();
      return;
    }
    cont.innerHTML = carrito
      .map((l, i) => {
        const p = l.producto;
        const mayoreo = precioAplicado(l) !== p.precio_venta_centavos;
        const esGranel = p.unidad !== "pieza";
        return `
      <div class="cl ${p.id === bipId ? "cl--bip" : ""}">
        <div class="cl-info">
          <span class="cl-nombre">${escapar(p.nombre)}</span>
          <span class="cl-precio">${pesos(precioAplicado(l))} c/u ${mayoreo ? '<span class="cl-mayoreo">mayoreo</span>' : ""}</span>
          ${l.descuento_centavos > 0 ? `<span class="cl-desc-tag">−${pesos(l.descuento_centavos)}</span>` : ""}
        </div>
        <div class="cl-cant">
          <button class="cl-btn" data-menos="${i}">−</button>
          <input class="cl-cant-input num" data-cant="${i}" value="${esGranel ? l.cantidad.toFixed(3) : l.cantidad}" inputmode="decimal" />
          <button class="cl-btn" data-mas="${i}">+</button>
        </div>
        <span class="cl-total num">${pesos(totalLinea(l))}</span>
        <button class="cl-quitar" data-quitar="${i}" aria-label="Quitar">×</button>
      </div>`;
      })
      .join("");
    bipId = null; // la onda solo suena una vez

    cont.querySelectorAll("[data-menos]").forEach((b) =>
      b.addEventListener("click", () => cambiarCantidad(+b.dataset.menos, -1))
    );
    cont.querySelectorAll("[data-mas]").forEach((b) =>
      b.addEventListener("click", () => cambiarCantidad(+b.dataset.mas, +1))
    );
    cont.querySelectorAll("[data-cant]").forEach((inp) =>
      inp.addEventListener("change", () => {
        const i = +inp.dataset.cant;
        const v = parseFloat((inp.value || "").replace(",", "."));
        if (isNaN(v) || v <= 0) {
          quitarLinea(i);
        } else {
          // Tope por stock si el producto lo controla.
          const prod = carrito[i].producto;
          if (prod.controla_stock && v > prod.stock) {
            avisoStock(prod);
            carrito[i].cantidad = prod.stock;
          } else {
            carrito[i].cantidad = v;
          }
          renderCarrito();
        }
      })
    );
    cont.querySelectorAll("[data-quitar]").forEach((b) =>
      b.addEventListener("click", () => quitarLinea(+b.dataset.quitar))
    );
    // Doble clic en total de línea = descuento de línea.
    cont.querySelectorAll(".cl").forEach((el, i) => {
      el.querySelector(".cl-total").addEventListener("dblclick", () => abrirDescuentoLinea(i));
    });

    renderTotales();
  }

  async function cambiarCantidad(i, delta) {
    const l = carrito[i];
    const paso = l.producto.unidad === "pieza" ? 1 : 0.1;
    const nueva = +(l.cantidad + delta * paso).toFixed(3);
    // Si al restar llegaría a 0 (o menos), es quitar el producto: pedir aviso.
    if (nueva <= 0) {
      quitarLinea(i);
      return;
    }
    // Validar stock al subir cantidad.
    if (delta > 0) {
      if (l.producto.es_kit) {
        let disponibles = null;
        try {
          disponibles = await invoke("kit_disponibles", { kitId: l.producto.id });
        } catch (e) {
          console.error(e);
        }
        if (disponibles !== null && nueva > disponibles) {
          const continuar = await avisoStockKit(l.producto, disponibles);
          if (!continuar) return;
        }
      } else if (l.producto.controla_stock && nueva > l.producto.stock) {
        avisoStock(l.producto);
        return;
      }
    }
    l.cantidad = Math.max(0, nueva);
    renderCarrito();
  }

  // Quita una línea del carrito, con confirmación (evita borrados accidentales).
  async function quitarLinea(i) {
    const l = carrito[i];
    if (!l) return;
    const nombre = l.producto.nombre;
    const ok = await confirmar(`¿Quitar "${nombre}" de la venta?`, {
      titulo: "Quitar producto",
      ok: "Quitar",
      peligro: true,
    });
    if (ok) {
      carrito.splice(i, 1);
      renderCarrito();
    }
  }

  function renderTotales() {
    const sub = subtotal();
    const desc = Math.min(descuentoGlobal, sub);
    const total = sub - desc;
    wrap.querySelector("#vt-subtotal").textContent = pesos(sub);
    const descFila = wrap.querySelector("#vt-desc-fila");
    if (desc > 0) {
      descFila.hidden = false;
      wrap.querySelector("#vt-desc").textContent = "-" + pesos(desc);
    } else {
      descFila.hidden = true;
    }
    wrap.querySelector("#vt-total").textContent = pesos(total);
    wrap.querySelector("#venta-cobrar").disabled = carrito.length === 0;
    // Autoguardar el ticket activo (con debounce) cada vez que cambia algo.
    autoguardar();
  }

  // ------------------------------------------------------------- Descuentos
  function abrirDescuentoLinea(i) {
    const l = carrito[i];
    const actual = (l.descuento_centavos / 100).toFixed(2);
    const html = `
      <h2>Descuento en línea</h2>
      <p class="m-sub">${escapar(l.producto.nombre)} · importe ${pesos(Math.round(precioAplicado(l) * l.cantidad))}</p>
      <label>Descuento en pesos
        <input id="dl-monto" inputmode="decimal" value="${l.descuento_centavos ? actual : ""}" placeholder="0.00" />
      </label>
      <p class="m-error" id="dl-error"></p>
      <div class="m-acciones"><span></span><div>
        <button class="btn-sec" id="dl-cancelar">Cancelar</button>
        <button class="btn-primario" id="dl-ok">Aplicar</button>
      </div></div>
    `;
    const modal = abrirModal(html);
    const $ = (s) => modal.querySelector(s);
    setTimeout(() => $("#dl-monto").focus(), 50);
    $("#dl-cancelar").addEventListener("click", cerrarModal);
    $("#dl-ok").addEventListener("click", () => {
      const v = parseFloat(($("#dl-monto").value || "0").replace(",", "."));
      const bruto = Math.round(precioAplicado(l) * l.cantidad);
      const cent = Math.round((isNaN(v) ? 0 : v) * 100);
      if (cent > bruto) {
        $("#dl-error").textContent = "El descuento no puede superar el importe.";
        return;
      }
      l.descuento_centavos = Math.max(0, cent);
      cerrarModal();
      renderCarrito();
    });
  }

  function abrirDescuentoGlobal() {
    if (carrito.length === 0) return;
    const sub = subtotal();
    const html = `
      <h2>Descuento global</h2>
      <p class="m-sub">Subtotal actual: ${pesos(sub)}</p>
      <div class="dg-tabs">
        <button class="dg-tab dg-tab--activo" data-modo="monto">En pesos</button>
        <button class="dg-tab" data-modo="pct">En %</button>
      </div>
      <label id="dg-label">Descuento en pesos
        <input id="dg-valor" inputmode="decimal" placeholder="0.00" />
      </label>
      <p class="m-preview" id="dg-preview"></p>
      <p class="m-error" id="dg-error"></p>
      <div class="m-acciones"><span></span><div>
        <button class="btn-sec" id="dg-cancelar">Cancelar</button>
        <button class="btn-primario" id="dg-ok">Aplicar</button>
      </div></div>
    `;
    const modal = abrirModal(html);
    const $ = (s) => modal.querySelector(s);
    let modo = "monto";
    setTimeout(() => $("#dg-valor").focus(), 50);

    function calcular() {
      const v = parseFloat(($("#dg-valor").value || "0").replace(",", "."));
      if (isNaN(v) || v < 0) return 0;
      return modo === "monto" ? Math.round(v * 100) : Math.round((sub * v) / 100);
    }
    function preview() {
      const c = Math.min(calcular(), sub);
      $("#dg-preview").textContent = "Total con descuento: " + pesos(sub - c);
    }
    $("#dg-valor").addEventListener("input", preview);
    modal.querySelectorAll(".dg-tab").forEach((b) =>
      b.addEventListener("click", () => {
        modal.querySelectorAll(".dg-tab").forEach((x) => x.classList.remove("dg-tab--activo"));
        b.classList.add("dg-tab--activo");
        modo = b.dataset.modo;
        $("#dg-label").firstChild.textContent = modo === "monto" ? "Descuento en pesos" : "Descuento en %";
        preview();
      })
    );
    $("#dg-cancelar").addEventListener("click", cerrarModal);
    $("#dg-ok").addEventListener("click", () => {
      descuentoGlobal = Math.min(calcular(), sub);
      cerrarModal();
      renderTotales();
    });
  }

  // ----------------------------------------------------------------- Cobro
  // v2: coreografía de marca. La lógica de pagos (mixtos, crédito, límites)
  // es EXACTAMENTE la misma; cambió la presentación y el efectivo manual
  // pasó de prompt() nativo (roto en Tauri) a una fila de captura propia.
  function abrirCobro() {
    if (carrito.length === 0) return;
    const sub = subtotal();
    const desc = Math.min(descuentoGlobal, sub);
    const total = sub - desc;

    // pagos: [{metodo, monto_centavos, recibido_centavos}]
    let pagos = [];
    let clienteCredito = null; // cliente asignado si hay pago a crédito

    const html = `
      <div class="cobro">
        <div class="cobro-cab">
          <span class="cobro-cab-label">Total a cobrar</span>
          <div class="cobro-cab-total num">${pesos(total)}</div>
        </div>
        <div class="cobro-metodos">
          <button class="cobro-met" data-met="efectivo">Efectivo</button>
          <button class="cobro-met" data-met="tarjeta">Tarjeta</button>
          <button class="cobro-met" data-met="transferencia">Transferencia</button>
          <button class="cobro-met" data-met="credito">Crédito</button>
        </div>
        <div class="cobro-cliente" id="cobro-cliente" hidden></div>
        <div class="cobro-rapido" id="cobro-rapido"></div>
        <div class="cobro-efectivo" id="cobro-efectivo" hidden>
          <span class="cobro-efectivo-signo">$</span>
          <input id="ce-monto" inputmode="decimal" placeholder="0.00" autocomplete="off" />
          <button class="btn-primario" id="ce-agregar">Agregar</button>
        </div>
        <div class="cobro-pagos" id="cobro-pagos"></div>
        <div class="cobro-resumen" id="cobro-resumen"></div>
        <p class="m-error" id="cobro-error"></p>
        <div class="m-acciones"><span></span><div class="cobro-confirmar-grupo">
          <button class="btn-sec" id="cobro-cancelar">Cancelar</button>
          <button class="btn-sec" id="cobro-confirmar-imp">Confirmar e imprimir <span class="tecla-hint">F2</span></button>
          <button class="btn-primario" id="cobro-confirmar">Confirmar venta <span class="tecla-hint tecla-hint--enbtn">F1</span></button>
        </div></div>
      </div>
    `;
    const modal = abrirModal(html);
    const $ = (s) => modal.querySelector(s);

    // Botones de efectivo exacto / billetes comunes.
    const sugeridos = sugerenciasEfectivo(total);
    $("#cobro-rapido").innerHTML =
      `<button class="cobro-chip" data-exacto="1">Exacto ${pesos(total)}</button>` +
      sugeridos.map((c) => `<button class="cobro-chip" data-efectivo="${c}">${pesos(c)}</button>`).join("");

    function pagado() {
      return pagos.reduce((s, p) => s + p.monto_centavos, 0);
    }
    function restante() {
      return total - pagado();
    }

    function render() {
      // Lista de pagos añadidos.
      const cont = $("#cobro-pagos");
      cont.innerHTML = pagos
        .map(
          (p, i) => `
        <div class="cp">
          <span>${etiquetaMetodo(p.metodo)}</span>
          <span class="num">${pesos(p.monto_centavos)}</span>
          <button data-quitar="${i}" class="cp-quitar" aria-label="Quitar pago">×</button>
        </div>`
        )
        .join("");
      cont.querySelectorAll("[data-quitar]").forEach((b) =>
        b.addEventListener("click", () => {
          pagos.splice(+b.dataset.quitar, 1);
          render();
        })
      );

      const rest = restante();
      const resumen = $("#cobro-resumen");
      if (pagos.length === 0) {
        resumen.innerHTML = `<div class="cr-total">Sin pagos: se asume efectivo exacto</div>`;
      } else if (rest > 0) {
        resumen.innerHTML = `<div class="cr-falta">Falta <strong class="num">${pesos(rest)}</strong></div>`;
      } else {
        const cambio = -rest;
        resumen.innerHTML = `<div class="cr-cambio"><span>Su cambio</span><strong class="num">${pesos(cambio)}</strong></div>`;
      }
      // El botón queda habilitado si: no hay pagos (se asume efectivo exacto)
      // o los pagos ya cubren el total. Solo se bloquea con pago parcial corto.
      $("#cobro-confirmar").disabled = pagos.length > 0 && rest > 0;
    }

    function agregarPago(metodo, montoCent, recibidoCent) {
      pagos.push({
        metodo,
        monto_centavos: montoCent,
        recibido_centavos: metodo === "efectivo" ? recibidoCent ?? montoCent : null,
      });
      render();
    }

    // Métodos: tarjeta/transferencia añaden el restante completo.
    modal.querySelectorAll(".cobro-met").forEach((b) =>
      b.addEventListener("click", async () => {
        const met = b.dataset.met;
        const rest = restante();
        if (rest <= 0) return;
        if (met === "efectivo") {
          pedirMontoEfectivo(rest);
        } else if (met === "credito") {
          await manejarCredito(rest);
        } else {
          agregarPago(met, rest, null);
        }
      })
    );

    // Flujo de crédito: elegir cliente (si no hay), verificar límite, agregar pago.
    async function manejarCredito(rest) {
      const err = $("#cobro-error");
      err.textContent = "";
      // 1. Asegurar cliente seleccionado.
      if (!clienteCredito) {
        const elegido = await seleccionarCliente();
        if (!elegido) return; // canceló
        clienteCredito = elegido;
      }
      // 2. Verificar límite por el monto que iría a crédito (el restante).
      try {
        const [excede, saldo, limite] = await invoke("cliente_verificar_limite", {
          clienteId: clienteCredito.id,
          montoCargoCentavos: rest,
        });
        if (excede) {
          const ok = await confirmar(
            `${clienteCredito.nombre} quedaría sobre su límite. Debe ${pesos(saldo)}, límite ${pesos(limite)}. Esta venta sumaría ${pesos(rest)} (nuevo saldo ${pesos(saldo + rest)}).`,
            { titulo: "Cliente sobre su límite", ok: "Autorizar venta", cancelar: "Cancelar", peligro: true }
          );
          if (!ok) return;
        }
      } catch (e) {
        err.textContent = String(e);
        return;
      }
      // 3. Agregar el pago a crédito por el restante.
      agregarPago("credito", rest, null);
      renderCliente();
    }

    function renderCliente() {
      const cont = $("#cobro-cliente");
      if (!clienteCredito) {
        cont.hidden = true;
        return;
      }
      cont.hidden = false;
      cont.innerHTML = `
        <span class="cc-label">Cliente (crédito):</span>
        <span class="cc-nombre">${escapar(clienteCredito.nombre)}</span>
        <span class="cc-saldo">debe ${pesos(clienteCredito.saldo_centavos)}</span>
        <button class="cc-cambiar" id="cc-cambiar">cambiar</button>
      `;
      $("#cc-cambiar").addEventListener("click", async () => {
        const elegido = await seleccionarCliente();
        if (elegido) {
          clienteCredito = elegido;
          renderCliente();
        }
      });
    }

    // Chips de efectivo.
    modal.querySelectorAll(".cobro-chip").forEach((b) =>
      b.addEventListener("click", () => {
        const rest = restante();
        if (rest <= 0) return;
        if (b.dataset.exacto) {
          // Pago exacto: cubre justo lo que falta, sin cambio.
          agregarPago("efectivo", rest, rest);
        } else {
          // Billete: el cliente entrega ese monto completo. El monto del pago
          // es lo recibido; el cambio sale de (pagado - total).
          const recibido = parseInt(b.dataset.efectivo, 10);
          agregarPago("efectivo", recibido, recibido);
        }
      })
    );

    // Efectivo manual: fila de captura propia (antes era prompt(), roto en Tauri).
    function pedirMontoEfectivo(rest) {
      const fila = $("#cobro-efectivo");
      const input = $("#ce-monto");
      fila.hidden = false;
      input.value = "";
      input.placeholder = "Recibido (resta " + pesos(rest).replace("$", "$ ") + ")";
      setTimeout(() => input.focus(), 40);
    }
    function agregarEfectivoManual() {
      const input = $("#ce-monto");
      const v = parseFloat((input.value || "").replace(",", "."));
      if (isNaN(v) || v <= 0) { input.focus(); return; }
      const recibido = Math.round(v * 100);
      $("#cobro-efectivo").hidden = true;
      agregarPago("efectivo", recibido, recibido);
    }
    $("#ce-agregar").addEventListener("click", agregarEfectivoManual);
    $("#ce-monto").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); agregarEfectivoManual(); }
    });

    $("#cobro-cancelar").addEventListener("click", () => {
      quitarF1();
      cerrarModal();
    });

    async function confirmarVenta(imprimir = false) {
      const err = $("#cobro-error");
      err.textContent = "";
      // Si no se añadió ningún pago, asumir efectivo exacto (caso más común).
      let pagosFinal = pagos;
      if (pagosFinal.length === 0) {
        pagosFinal = [{ metodo: "efectivo", monto_centavos: total, recibido_centavos: total }];
      } else if (restante() > 0) {
        // Pagos insuficientes: no confirmar.
        err.textContent = `Falta ${pesos(restante())} por cubrir.`;
        return;
      }
      const btn = $("#cobro-confirmar");
      btn.disabled = true;
      btn.textContent = "Procesando…";

      const cobro = {
        caja_sesion_id: cajaSesion.id,
        usuario_pos_id: sesion.id,
        descuento_global_centavos: desc,
        cliente_id: clienteCredito ? clienteCredito.id : null,
        lineas: carrito.map((l) => ({
          producto_id: l.producto.id,
          cantidad: l.cantidad,
          descuento_linea_centavos: l.descuento_centavos,
        })),
        pagos: pagosFinal.map((p) => ({
          metodo: p.metodo,
          monto_centavos: p.monto_centavos,
          recibido_centavos: p.recibido_centavos,
        })),
      };

      try {
        const res = await invoke("venta_cobrar", { cobro });
        quitarF1();
        cerrarModal();
        // La firma de marca: la línea de vida recorre en verde.
        lineaVida.exito();
        // Si se pidió imprimir (F2), lanzar impresión del ticket.
        if (imprimir && res && res.folio != null) {
          try { await invoke("ticket_preparar_impresion", { folio: res.folio, ventaId: res.id }); }
          catch (e) { console.error("No se pudo imprimir:", e); }
        }
        // La venta se completó: eliminar su ticket en espera y pasar a otro.
        await finalizarTicketCobrado();
        // Un cobro pudo dejar componentes/productos en negativo: refrescar aviso.
        if (refrescarAlertaNeg) refrescarAlertaNeg();
        mostrarTicketExito(res);
      } catch (e) {
        err.textContent = String(e);
        btn.disabled = false;
        btn.innerHTML = 'Confirmar venta <span class="tecla-hint tecla-hint--enbtn">F1</span>';
      }
    }

    $("#cobro-confirmar").addEventListener("click", () => confirmarVenta(false));
    $("#cobro-confirmar-imp").addEventListener("click", () => confirmarVenta(true));

    // Atajos dentro del cobro:
    //   F1 = confirmar venta      F2 = confirmar e imprimir ticket
    //   Escape = cancelar
    function onF1(e) {
      if (e.key === "F1") {
        e.preventDefault();
        confirmarVenta(false);
      } else if (e.key === "F2") {
        e.preventDefault();
        confirmarVenta(true);
      } else if (e.key === "Escape") {
        quitarF1();
        cerrarModal();
      }
    }
    function quitarF1() {
      document.removeEventListener("keydown", onF1);
    }
    document.addEventListener("keydown", onF1);

    // Sub-modal para elegir cliente (devuelve promesa con el cliente o null).
    function seleccionarCliente() {
      return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay modal-overlay--alto";
        overlay.innerHTML = `
          <div class="modal modal--chico" role="dialog" aria-modal="true">
            <h2>Elegir cliente</h2>
            <input id="sc-buscar" class="inv-buscar" style="width:100%;margin-bottom:12px" placeholder="Buscar cliente…" autocomplete="off" />
            <div class="sc-lista" id="sc-lista"></div>
            <p class="m-sub" id="sc-vacio" hidden>Sin clientes. Créalos en el apartado Clientes.</p>
            <div class="m-acciones"><span></span><button class="btn-sec" id="sc-cancelar">Cancelar</button></div>
          </div>`;
        document.body.appendChild(overlay);
        const q = (s) => overlay.querySelector(s);

        async function buscar(texto) {
          let lista = [];
          try {
            lista = await invoke("cliente_listar", { filtro: texto || null });
          } catch (e) {
            lista = [];
          }
          const cont = q("#sc-lista");
          const vacio = q("#sc-vacio");
          if (lista.length === 0) {
            cont.innerHTML = "";
            vacio.hidden = false;
            return;
          }
          vacio.hidden = true;
          cont.innerHTML = lista
            .slice(0, 20)
            .map(
              (c) => `
            <button class="sc-item" data-id="${c.id}">
              <span class="sc-nombre">${escapar(c.nombre)}</span>
              <span class="sc-saldo ${c.saldo_centavos > 0 ? "cli-debe" : "cli-aldia"}">${pesos(c.saldo_centavos)}</span>
            </button>`
            )
            .join("");
          cont.querySelectorAll(".sc-item").forEach((b) =>
            b.addEventListener("click", () => {
              const c = lista.find((x) => x.id === b.dataset.id);
              cerrar(c);
            })
          );
        }

        function cerrar(val) {
          overlay.remove();
          resolve(val || null);
        }
        let t;
        q("#sc-buscar").addEventListener("input", (e) => {
          clearTimeout(t);
          t = setTimeout(() => buscar(e.target.value.trim()), 150);
        });
        q("#sc-cancelar").addEventListener("click", () => cerrar(null));
        overlay.addEventListener("mousedown", (e) => {
          if (e.target === overlay) cerrar(null);
        });
        setTimeout(() => q("#sc-buscar").focus(), 50);
        buscar("");
      });
    }

    render();
  }

  function mostrarTicketExito(res) {
    const cambio = res.cambio_centavos || 0;
    const html = `
      <div class="exito exito--v2 exito--auto">
        <div class="ex-anillo"></div><div class="ex-anillo"></div>
        <div class="exito-check">✓</div>
        <h2>Venta #${res.folio} completada</h2>
        <div class="exito-total num">${pesos(res.total_centavos)}</div>
        ${cambio > 0 ? `
          <div class="exito-cambio-label">Su cambio</div>
          <div class="exito-cambio-v num" id="exito-cambio-v">$0.00</div>` : ""}
        <div class="exito-ticket-slot"><div class="exito-ticketito">·· GRACIAS POR SU COMPRA ··</div></div>
        <button class="btn-sec exito-ver-ticket" id="exito-ticket">Ver ticket</button>
        <div class="exito-auto-barra"><div class="exito-auto-fill"></div></div>
      </div>
    `;
    const modal = abrirModal(html);

    // El cambio rueda de 0 a su valor: legible a un metro, imposible de perder.
    if (cambio > 0) {
      const el = modal.querySelector("#exito-cambio-v");
      const t0 = performance.now(), dur = 600;
      const paso = (t) => {
        const p = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = pesos(Math.round(cambio * e));
        if (p < 1) requestAnimationFrame(paso);
      };
      requestAnimationFrame(paso);
    }

    let cerrado = false;
    const continuar = () => {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      cerrarModal();
      carrito = [];
      descuentoGlobal = 0;
      pintar();
    };
    const timer = setTimeout(continuar, 2200);
    // El botón Ver ticket cancela el auto-cierre y abre la vista previa.
    // Al cerrar la vista previa, se continúa (cierra aviso, nueva venta).
    modal.querySelector("#exito-ticket").addEventListener("click", (e) => {
      e.stopPropagation();
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      verTicket(res.folio, continuar, res.id);
    });
    // Tocar el resto del aviso (no el botón) lo salta.
    modal.addEventListener("click", (e) => {
      if (e.target.closest("#exito-ticket")) return;
      continuar();
    });
    const onKey = (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "F1") {
        e.preventDefault();
        continuar();
      }
    };
    document.addEventListener("keydown", onKey);
  }

  // -------------------------------------------------------------- helpers
  function sugerenciasEfectivo(total) {
    // Billetes comunes en México que superen el total.
    const billetes = [5000, 10000, 20000, 50000, 100000]; // $50,$100,$200,$500,$1000
    return billetes.filter((b) => b > total).slice(0, 3);
  }
  function etiquetaMetodo(m) {
    return { efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia", vale: "Vale" }[m] || m;
  }
}

// --- Modales (locales a esta vista) ---
let modalVenta = null;
function abrirModal(html) {
  if (modalVenta) cerrarModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(overlay);
  modalVenta = overlay;
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) cerrarModal();
  });
  return overlay.querySelector(".modal");
}
function cerrarModal() {
  if (modalVenta) {
    modalVenta.remove();
    modalVenta = null;
  }
}

// Modal de confirmación propio (reemplaza al confirm() nativo, que no funciona
// en este entorno de Tauri). Devuelve una promesa que resuelve true/false.
// Usa su propio overlay para no interferir con otros modales abiertos.
function confirmar(mensaje, opciones = {}) {
  const titulo = opciones.titulo || "Confirmar";
  const textoOk = opciones.ok || "Aceptar";
  const textoCancelar = opciones.cancelar || "Cancelar";
  const peligro = opciones.peligro === true;
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay modal-overlay--confirm";
    overlay.innerHTML = `
      <div class="modal modal--confirm" role="dialog" aria-modal="true">
        <h2 class="confirm-titulo">${escapar(titulo)}</h2>
        <p class="confirm-msg">${escapar(mensaje)}</p>
        <div class="confirm-acciones">
          <button class="btn-sec" data-conf="0">${escapar(textoCancelar)}</button>
          <button class="${peligro ? "btn-peligro" : "btn-primario"}" data-conf="1">${escapar(textoOk)}</button>
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
    // Foco en el botón de confirmar para poder usar Enter.
    setTimeout(() => overlay.querySelector('[data-conf="1"]').focus(), 40);
  });
}