// YvexPOS — vista de Inventario.
// Tabla de productos con búsqueda, filtro de stock bajo, alta/edición,
// gestión de categorías y ajuste de stock con rastro.
// El cajero no ve columna de costo (el backend tampoco se lo manda).

import { invoke } from "@tauri-apps/api/core";
import { pesos, centavos, escapar } from "../util/formato.js";
import { icono } from "../util/iconos.js";

export function montarInventario(contenedor, sesion, alSalir, filtroInicial) {
  const esCajero = sesion.rol === "cajero";
  const verCostos = !esCajero;

  contenedor.innerHTML = "";
  contenedor.style.alignItems = "stretch";
  contenedor.style.justifyContent = "flex-start";

  const wrap = document.createElement("div");
  wrap.className = "inv";
  contenedor.appendChild(wrap);

  let categorias = [];
  let productos = [];
  let filtro = "";
  let soloStockBajo = false;
  let soloNegativos = filtroInicial === "negativos";
  let filtroCategoria = ""; // "" = todas
  let modoEliminar = false;
  const seleccionados = new Set();

  pintarEsqueleto();
  cargarTodo();

  function pintarEsqueleto() {
    wrap.innerHTML = `
      <header class="inv-head">
        <div class="inv-head-izq">
          <button class="inv-volver" id="inv-volver" aria-label="Volver">←</button>
          <div>
            <h1>Inventario</h1>
            <p class="inv-head-sub" id="inv-head-sub">Cargando…</p>
          </div>
        </div>
        <div class="inv-head-der">
          <button class="btn-sec" id="inv-cats">Departamentos</button>
          <button class="btn-sec" id="inv-eliminar-modo">Borrar producto</button>
          <button class="btn-primario" id="inv-nuevo">${icono("mas")}<span>Producto</span></button>
        </div>
      </header>

      ${verCostos ? `
      <div class="inv-metricas" id="inv-metricas">
        <div class="inv-metrica inv-metrica--principal">
          <span class="inv-metrica-lbl">Valor del inventario</span>
          <span class="inv-metrica-val num" id="met-valor">—</span>
          <span class="inv-metrica-pie" id="met-valor-pie">a costo</span>
        </div>
        <div class="inv-metrica">
          <span class="inv-metrica-lbl">Margen promedio</span>
          <span class="inv-metrica-val num" id="met-margen">—</span>
        </div>
        <button class="inv-metrica inv-metrica--accion" id="met-bajo-btn" type="button">
          <span class="inv-metrica-lbl">Stock bajo</span>
          <span class="inv-metrica-val num" id="met-bajo">—</span>
          <span class="inv-metrica-pie">por reabastecer</span>
        </button>
        <button class="inv-metrica inv-metrica--accion" id="met-neg-btn" type="button">
          <span class="inv-metrica-lbl">En negativo</span>
          <span class="inv-metrica-val num" id="met-neg">—</span>
          <span class="inv-metrica-pie">necesitan revisión</span>
        </button>
      </div>` : ""}

      <div class="inv-barra">
        <div class="inv-buscar-wrap">
          <span class="inv-buscar-ico">${icono("buscar")}</span>
          <input id="inv-buscar" class="inv-buscar" placeholder="Buscar producto por nombre o código…" autocomplete="off" />
        </div>
        <div class="inv-filtros">
          <div class="inv-cat-wrap">
            <select id="inv-cat-filtro" class="inv-cat-filtro"><option value="">Todos los departamentos</option></select>
          </div>
          <div class="inv-segmentos" id="inv-segmentos">
            <button class="inv-seg inv-seg--on" data-seg="todos">Todos</button>
            <button class="inv-seg" data-seg="bajo">Stock bajo</button>
            <button class="inv-seg" data-seg="negativos">Negativos</button>
          </div>
        </div>
      </div>

      <div class="inv-elim-barra" id="inv-elim-barra" hidden>
        <span id="inv-elim-conteo">0 seleccionados</span>
        <div>
          <button class="btn-sec" id="inv-elim-cancelar">Cancelar</button>
          <button class="btn-peligro" id="inv-elim-confirmar" disabled>Borrar seleccionados</button>
        </div>
      </div>

      <div class="inv-tabla-wrap">
        <table class="inv-tabla">
          <thead>
            <tr>
              <th class="inv-col-check" id="inv-th-check" hidden><input type="checkbox" id="inv-check-todos" /></th>
              <th>Producto</th>
              <th>Código</th>
              <th class="num">Precio</th>
              ${verCostos ? '<th class="num">Costo</th><th class="num">Margen</th>' : ""}
              <th class="num">Stock</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="inv-tbody"></tbody>
        </table>
        <div id="inv-vacio" class="inv-vacio" hidden></div>
      </div>
    `;

    wrap.querySelector("#inv-volver").addEventListener("click", alSalir);
    wrap.querySelector("#inv-nuevo").addEventListener("click", () => abrirModalProducto(null));
    wrap.querySelector("#inv-cats").addEventListener("click", abrirModalCategorias);
    wrap.querySelector("#inv-eliminar-modo").addEventListener("click", activarModoEliminar);
    wrap.querySelector("#inv-elim-cancelar").addEventListener("click", desactivarModoEliminar);
    wrap.querySelector("#inv-elim-confirmar").addEventListener("click", eliminarSeleccionados);

    // Métricas clicables (stock bajo / negativos) actúan como filtros rápidos.
    const btnBajo = wrap.querySelector("#met-bajo-btn");
    const btnNeg = wrap.querySelector("#met-neg-btn");
    if (btnBajo) btnBajo.addEventListener("click", () => aplicarSegmento("bajo"));
    if (btnNeg) btnNeg.addEventListener("click", () => aplicarSegmento("negativos"));

    // Segmentos (Todos / Stock bajo / Negativos).
    wrap.querySelectorAll(".inv-seg").forEach((b) =>
      b.addEventListener("click", () => aplicarSegmento(b.dataset.seg))
    );

    wrap.querySelector("#inv-cat-filtro").addEventListener("change", (e) => {
      filtroCategoria = e.target.value;
      cargarProductos();
    });

    const checkTodos = wrap.querySelector("#inv-check-todos");
    checkTodos.addEventListener("change", () => {
      if (checkTodos.checked) {
        productos.forEach((p) => seleccionados.add(p.id));
      } else {
        seleccionados.clear();
      }
      cargarProductos();
      actualizarBarraEliminar();
    });

    const buscar = wrap.querySelector("#inv-buscar");
    let t;
    buscar.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        filtro = buscar.value.trim();
        cargarProductos();
      }, 180);
    });
  }

  // Cambia el segmento activo (todos / bajo / negativos) y recarga.
  function aplicarSegmento(seg) {
    soloStockBajo = seg === "bajo";
    soloNegativos = seg === "negativos";
    wrap.querySelectorAll(".inv-seg").forEach((b) =>
      b.classList.toggle("inv-seg--on", b.dataset.seg === seg)
    );
    cargarProductos();
  }

  function activarModoEliminar() {
    modoEliminar = true;
    seleccionados.clear();
    wrap.querySelector("#inv-elim-barra").hidden = false;
    wrap.querySelector("#inv-th-check").hidden = false;
    actualizarBarraEliminar();
    cargarProductos();
  }

  function desactivarModoEliminar() {
    modoEliminar = false;
    seleccionados.clear();
    wrap.querySelector("#inv-elim-barra").hidden = true;
    wrap.querySelector("#inv-th-check").hidden = true;
    cargarProductos();
  }

  function actualizarBarraEliminar() {
    const n = seleccionados.size;
    wrap.querySelector("#inv-elim-conteo").textContent =
      n === 1 ? "1 seleccionado" : `${n} seleccionados`;
    wrap.querySelector("#inv-elim-confirmar").disabled = n === 0;
  }

  async function eliminarSeleccionados() {
    const n = seleccionados.size;
    if (n === 0) return;
    const ok = await confirmar(
      `¿Borrar ${n} producto${n > 1 ? "s" : ""}?`,
      "Esta acción no se puede deshacer."
    );
    if (!ok) return;
    const btn = wrap.querySelector("#inv-elim-confirmar");
    btn.disabled = true;
    btn.textContent = "Borrando…";
    try {
      await invoke("prod_eliminar_varios", { ids: Array.from(seleccionados) });
      desactivarModoEliminar();
    } catch (e) {
      mostrarError("Error al borrar: " + e);
      btn.disabled = false;
      btn.textContent = "Borrar seleccionados";
    }
  }

  async function cargarTodo() {
    try {
      categorias = await invoke("cat_listar");
    } catch (e) {
      categorias = [];
    }
    // Poblar el filtro de categorías.
    const sel = wrap.querySelector("#inv-cat-filtro");
    if (sel) {
      sel.innerHTML = '<option value="">Todos los departamentos</option>' +
        categorias.map((c) => `<option value="${c.id}">${escapar(c.nombre)}</option>`).join("");
    }
    await cargarProductos();
    await cargarMetricas();
    // Si entramos filtrando negativos (desde la alerta de Venta), marca el segmento.
    if (soloNegativos) {
      wrap.querySelectorAll(".inv-seg").forEach((b) =>
        b.classList.toggle("inv-seg--on", b.dataset.seg === "negativos")
      );
    }
  }

  // Carga las métricas de la franja superior (solo con permiso de costos).
  async function cargarMetricas() {
    if (!verCostos) return;
    let m;
    try {
      m = await invoke("inventario_metricas");
    } catch (e) {
      console.error("No se pudieron cargar métricas:", e);
      return;
    }
    const set = (id, val) => { const el = wrap.querySelector(id); if (el) el.textContent = val; };
    set("#met-valor", pesos(m.valor_costo_centavos));
    set("#met-margen", m.margen_promedio + "%");
    set("#met-bajo", m.stock_bajo);
    set("#met-neg", m.negativos);
    // Subtítulo de la cabecera con el conteo real.
    set("#inv-head-sub", `${m.total_productos} producto${m.total_productos !== 1 ? "s" : ""}`);
    // Resaltar la tarjeta de negativos solo si hay alguno.
    const negBtn = wrap.querySelector("#met-neg-btn");
    if (negBtn) negBtn.classList.toggle("inv-metrica--alerta", m.negativos > 0);
    const bajoBtn = wrap.querySelector("#met-bajo-btn");
    if (bajoBtn) bajoBtn.classList.toggle("inv-metrica--aviso", m.stock_bajo > 0);
  }

  async function cargarProductos() {
    const tbody = wrap.querySelector("#inv-tbody");
    const vacio = wrap.querySelector("#inv-vacio");
    try {
      productos = await invoke("prod_listar", {
        rol: sesion.rol,
        filtro: filtro || null,
        soloStockBajo,
        soloNegativos,
      });
    } catch (e) {
      tbody.innerHTML = "";
      vacio.hidden = false;
      vacio.textContent = "Error al cargar productos: " + e;
      return;
    }
    // Filtro por categoría (en frontend).
    if (filtroCategoria) {
      productos = productos.filter((p) => p.categoria_id === filtroCategoria);
    }
    if (productos.length === 0) {
      tbody.innerHTML = "";
      vacio.hidden = false;
      vacio.textContent = filtro
        ? "Sin resultados para “" + filtro + "”."
        : filtroCategoria
        ? "No hay productos en este departamento."
        : soloNegativos
        ? "No hay productos en negativo. 👍"
        : soloStockBajo
        ? "No hay productos con stock bajo. 👍"
        : "Aún no hay productos. Crea el primero con “+ Producto”.";
      return;
    }
    vacio.hidden = true;
    tbody.innerHTML = productos.map(filaProducto).join("");

    if (modoEliminar) {
      tbody.querySelectorAll("[data-sel]").forEach((c) =>
        c.addEventListener("change", () => {
          const id = c.dataset.sel;
          if (c.checked) seleccionados.add(id);
          else seleccionados.delete(id);
          actualizarBarraEliminar();
        })
      );
    } else {
      tbody.querySelectorAll("[data-editar]").forEach((b) =>
        b.addEventListener("click", () => {
          const p = productos.find((x) => x.id === b.dataset.editar);
          abrirModalProducto(p);
        })
      );
      tbody.querySelectorAll("[data-ajustar]").forEach((b) =>
        b.addEventListener("click", () => {
          const p = productos.find((x) => x.id === b.dataset.ajustar);
          abrirModalAjuste(p);
        })
      );
    }
  }

  function nombreCategoria(id) {
    if (!id) return "—";
    const c = categorias.find((x) => x.id === id);
    return c ? escapar(c.nombre) : "—";
  }

  function colorCategoria(id) {
    const c = categorias.find((x) => x.id === id);
    return c && c.color ? c.color : "var(--texto-debil)";
  }

  function filaProducto(p) {
    const negativo = p.controla_stock && !p.es_kit && p.stock < 0;
    const bajo = p.controla_stock && !negativo && p.stock <= p.stock_minimo;
    const stockClase = negativo ? "stock-negativo" : bajo ? "stock-bajo" : "";
    const stockTxt = p.es_kit
      ? '<span class="inv-kit-tag">paquete</span>'
      : p.controla_stock
      ? `<span class="${stockClase}">${fmtStock(p.stock, p.unidad)}${negativo ? " ⚠" : ""}</span>`
      : '<span class="inv-servicio">servicio</span>';
    let costoCols = "";
    if (verCostos) {
      const costo = p.costo_centavos ?? 0;
      const margen =
        p.precio_venta_centavos > 0 && costo > 0
          ? Math.round(((p.precio_venta_centavos - costo) / p.precio_venta_centavos) * 100)
          : null;
      costoCols = `
        <td class="num inv-costo">${costo ? pesos(costo) : "—"}</td>
        <td class="num">${margen !== null ? `<span class="inv-margen">${margen}%</span>` : "—"}</td>`;
    }
    const celdaCheck = modoEliminar
      ? `<td class="inv-col-check"><input type="checkbox" data-sel="${p.id}" ${seleccionados.has(p.id) ? "checked" : ""} /></td>`
      : "";
    const celdaAcciones = modoEliminar
      ? "<td></td>"
      : `<td class="inv-acciones-col">
          <div class="inv-acciones">
            ${p.controla_stock && !p.es_kit ? `<button class="btn-mini" data-ajustar="${p.id}">Stock</button>` : ""}
            <button class="btn-mini" data-editar="${p.id}">Editar</button>
          </div>
        </td>`;
    const dep = p.categoria_id ? nombreCategoria(p.categoria_id) : "Sin departamento";
    return `
      <tr class="${modoEliminar && seleccionados.has(p.id) ? "inv-fila-sel" : ""}">
        ${celdaCheck}
        <td class="inv-nombre-cel">
          <div class="inv-prod">
            <span class="inv-dep-dot" style="background:${colorCategoria(p.categoria_id)}"></span>
            <div class="inv-prod-txt">
              <div class="inv-prod-nombre">
                ${p.favorito ? '<span class="inv-fav" title="Favorito">★</span>' : ""}
                ${p.es_kit ? '<span class="inv-kit-ico" title="Paquete">' + icono("venta") + "</span>" : ""}
                ${escapar(p.nombre)}
              </div>
              <div class="inv-prod-dep">${dep}</div>
            </div>
          </div>
        </td>
        <td class="inv-codigo">${p.codigo_barras ? `<span class="inv-code-pill">${escapar(p.codigo_barras)}</span>` : "—"}</td>
        <td class="num inv-precio">${pesos(p.precio_venta_centavos)}</td>
        ${costoCols}
        <td class="num">${stockTxt}</td>
        ${celdaAcciones}
      </tr>`;
  }

  // ---------------------------------------------------------- Modal producto
  function abrirModalProducto(prod) {
    const esEdicion = !!prod;
    const opcionesCat = [
      '<option value="">Sin departamento</option>',
      ...categorias.map(
        (c) =>
          `<option value="${c.id}" ${prod && prod.categoria_id === c.id ? "selected" : ""}>${escapar(c.nombre)}</option>`
      ),
    ].join("");

    const g = (campo, def = "") => (prod ? prod[campo] ?? def : def);
    const precioInicial = prod ? centavos(prod.precio_venta_centavos) : "";
    const costoInicial = prod && prod.costo_centavos ? centavos(prod.costo_centavos) : "";
    const mayoreoInicial = prod && prod.precio_mayoreo_centavos ? centavos(prod.precio_mayoreo_centavos) : "";

    const html = `
      <h2>${esEdicion ? "Editar producto" : "Nuevo producto"}</h2>
      <div class="m-grid">
        <label class="m-col2">Nombre
          <input id="m-nombre" value="${prod ? escapar(prod.nombre) : ""}" />
        </label>
        <label>Código de barras
          <input id="m-codigo" value="${prod && prod.codigo_barras ? escapar(prod.codigo_barras) : ""}" placeholder="Opcional" style="text-transform:uppercase" />
          <span class="m-hint">Recomendado: agiliza la venta al escanear o teclear.</span>
        </label>
        <label>Departamento
          <select id="m-cat">${opcionesCat}</select>
        </label>
        ${
          verCostos
            ? `<div class="m-col2 margen-bloque">
                 <div class="margen-campos">
                   <label>Costo
                     <input id="m-costo" inputmode="decimal" value="${costoInicial}" placeholder="0.00" />
                   </label>
                   <label>Margen
                     <div class="margen-input">
                       <input id="m-margen" inputmode="decimal" placeholder="0" />
                       <span>%</span>
                     </div>
                   </label>
                   <label>Precio de venta
                     <input id="m-precio" inputmode="decimal" value="${precioInicial}" placeholder="0.00" />
                   </label>
                 </div>
                 <div class="margen-rapido">
                   <span>Margen rápido:</span>
                   <button type="button" class="margen-chip" data-m="20">20%</button>
                   <button type="button" class="margen-chip" data-m="30">30%</button>
                   <button type="button" class="margen-chip" data-m="40">40%</button>
                   <button type="button" class="margen-chip" data-m="50">50%</button>
                 </div>
                 <p class="margen-nota" id="m-ganancia"></p>
               </div>`
            : `<label>Precio de venta
                 <input id="m-precio" inputmode="decimal" value="${precioInicial}" placeholder="0.00" />
               </label>`
        }
        <label>Precio mayoreo
          <input id="m-mayoreo" inputmode="decimal" value="${mayoreoInicial}" placeholder="Opcional" />
        </label>
        <label>Cantidad para mayoreo
          <input id="m-cant-mayoreo" inputmode="numeric" value="${g("cantidad_mayoreo", "")}" placeholder="Opcional" />
        </label>
        <div class="m-col2 venta-modo">
          <div class="venta-modo-label">¿Cómo se vende?</div>
          <div class="venta-modo-ops" id="m-modo-ops">
            <button type="button" class="venta-modo-op" data-modo="pieza" data-tip="Se vende por piezas enteras: refrescos, cigarros, dulces. Es lo más común.">
              ${icono("inventario")}<span>Por pieza</span>
            </button>
            <button type="button" class="venta-modo-op" data-modo="granel" data-tip="Se vende por peso o volumen con decimales, usando báscula: fruta, verdura, carnes.">
              ${icono("existencias")}<span>A granel</span>
            </button>
            <button type="button" class="venta-modo-op" data-modo="kit" data-tip="Un paquete que agrupa otros productos y descuenta sus componentes del inventario al venderse: '8 Pacífico', combos.">
              ${icono("venta")}<span>Paquete</span>
            </button>
          </div>
          <p class="venta-modo-tip" id="m-modo-tip"></p>
        </div>

        <label id="m-lbl-unidad-granel" hidden>Unidad de granel
          <select id="m-unidad-granel">
            <option value="kg">Kilogramo</option>
            <option value="litro">Litro</option>
          </select>
        </label>

        <label id="m-lbl-min">Stock mínimo
          <input id="m-min" inputmode="decimal" value="${g("stock_minimo", 0)}" />
        </label>
        ${
          !esEdicion
            ? `<label id="m-lbl-stock-ini">Stock inicial
                 <input id="m-stock-ini" inputmode="decimal" value="0" />
               </label>`
            : ""
        }
        <label class="m-toggle" id="m-lbl-controla">
          <input type="checkbox" id="m-controla" ${prod ? (prod.controla_stock ? "checked" : "") : "checked"} />
          <span>Este producto usa inventario</span>
        </label>
        <label class="m-toggle">
          <input type="checkbox" id="m-fav" ${prod && prod.favorito ? "checked" : ""} />
          <span>Favorito (cuadrícula rápida)</span>
        </label>

        <div class="m-col2 kit-config" id="m-kit-config" hidden>
          <button type="button" class="kit-config-btn" id="m-kit-config-btn">
            <span class="kit-config-icono">${icono("venta")}</span>
            <span class="kit-config-texto">
              <span class="kit-config-titulo">Configurar contenido del paquete</span>
              <span class="kit-config-resumen" id="m-kit-resumen">Sin productos todavía · toca para armar</span>
            </span>
            <span class="kit-config-flecha">→</span>
          </button>
          <div class="kit-detalle" id="m-kit-detalle" hidden></div>
        </div>
      </div>
      <p class="m-error" id="m-error"></p>
      <div class="m-acciones">
        ${esEdicion ? '<button class="btn-peligro" id="m-eliminar">Eliminar</button>' : "<span></span>"}
        <div>
          <button class="btn-sec" id="m-cancelar">Cancelar</button>
          <button class="btn-primario" id="m-guardar">${esEdicion ? "Guardar" : "Crear"}</button>
        </div>
      </div>
    `;

    const modal = abrirModal(html);
    const $ = (s) => modal.querySelector(s);

    // --- Selector "¿Cómo se vende?" y armador de kit ---
    // Modo inicial: kit si el producto es kit; granel si su unidad es kg/litro;
    // pieza en cualquier otro caso (y por defecto en productos nuevos).
    let modoVenta = "pieza";
    if (prod && prod.es_kit) modoVenta = "kit";
    else if (prod && (prod.unidad === "kg" || prod.unidad === "litro")) modoVenta = "granel";
    // Componentes del kit en edición: [{producto_id, nombre, cantidad, costo_centavos}]
    let kitComponentes = [];
    // Se asigna en el medidor de margen; permite refrescar la nota de ganancia
    // cuando el armador de kit autollena el costo. Puede ser no-op si no hay costos.
    let refrescarGanancia = null;

    const tips = {
      pieza: "Se vende por piezas enteras: refrescos, cigarros, dulces. Es lo más común.",
      granel: "Se vende por peso o volumen con decimales, usando báscula: fruta, verdura, carnes.",
      kit: "Un paquete que agrupa otros productos y descuenta sus componentes del inventario al venderse.",
    };

    // Aplica el modo elegido: marca el botón, muestra/oculta campos.
    function aplicarModo(modo) {
      modoVenta = modo;
      modal.querySelectorAll(".venta-modo-op").forEach((b) =>
        b.classList.toggle("venta-modo-op--activo", b.dataset.modo === modo)
      );
      $("#m-modo-tip").textContent = tips[modo] || "";
      // Granel: mostrar selector de unidad (kg/litro) SOLO en granel.
      $("#m-lbl-unidad-granel").hidden = modo !== "granel";
      // Kit: mostrar el botón de configurar contenido; ocultar stock/controla
      // (un kit no tiene stock propio).
      const esKit = modo === "kit";
      $("#m-kit-config").hidden = !esKit;
      $("#m-lbl-min").hidden = esKit;
      $("#m-lbl-controla").hidden = esKit;
      if ($("#m-lbl-stock-ini")) $("#m-lbl-stock-ini").hidden = esKit;
      if (esKit) actualizarResumenKit();
      // Refrescar la nota de ganancia para que el sufijo (por unidad/paquete)
      // coincida con el modo actual.
      if (typeof refrescarGanancia === "function") refrescarGanancia();
    }

    modal.querySelectorAll(".venta-modo-op").forEach((b) =>
      b.addEventListener("click", () => aplicarModo(b.dataset.modo))
    );

    // Costo total del kit (suma de componentes × cantidad).
    function costoKit() {
      return kitComponentes.reduce((s, c) => s + Math.round(c.costo_centavos * c.cantidad), 0);
    }

    // Refleja el estado del kit en el modal principal: resumen en el botón y
    // costo calculado en el campo de costo de arriba (si el usuario no lo tocó
    // manualmente).
    let costoTocadoManual = esEdicion && prod.es_kit && !!prod.costo_centavos;
    function actualizarResumenKit() {
      const n = kitComponentes.length;
      const resumen = $("#m-kit-resumen");
      const detalle = $("#m-kit-detalle");
      if (resumen) {
        resumen.textContent = n === 0
          ? "Sin productos todavía · toca para armar"
          : `${n} producto${n > 1 ? "s" : ""} · costo ${pesos(costoKit())}`;
      }
      // Lista visible de componentes como chips (nombre ×cantidad), sin entrar.
      if (detalle) {
        if (n === 0) {
          detalle.innerHTML = "";
          detalle.hidden = true;
        } else {
          detalle.hidden = false;
          detalle.innerHTML = kitComponentes
            .map((c) => {
              const cant = Number.isInteger(c.cantidad) ? c.cantidad : c.cantidad.toFixed(3);
              return `<span class="kit-chip"><span class="kit-chip-cant">${cant}×</span> ${escapar(c.nombre)}</span>`;
            })
            .join("");
        }
      }
      // Reflejar costo calculado arriba (salvo que el usuario lo haya editado).
      if (verCostos && !costoTocadoManual) {
        const el = $("#m-costo");
        if (el) {
          el.value = kitComponentes.length ? centavos(costoKit()) : "";
          if (typeof refrescarGanancia === "function") refrescarGanancia();
        }
      }
    }

    // Abre la ventana aparte para armar el contenido del paquete.
    $("#m-kit-config-btn")?.addEventListener("click", abrirArmadorKit);

    function abrirArmadorKit() {
      // Overlay secundario propio: NO usa abrirModal (que cerraría el modal de
      // producto). Se monta encima y al cerrar deja el modal de producto intacto.
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay modal-overlay--alto";
      overlay.innerHTML = `
        <div class="modal modal--chico" role="dialog" aria-modal="true">
          <h2>Contenido del paquete</h2>
          <p class="m-sub">El inventario se descuenta de estos productos al vender el paquete.</p>
          <div class="kit-buscar-wrap">
            <span class="kit-buscar-ico">${icono("buscar")}</span>
            <input id="ak-buscar" class="kit-buscar" placeholder="Busca un producto para añadir…" autocomplete="off" />
            <div class="kit-buscar-res" id="ak-res" hidden></div>
          </div>
          <ul class="kit-componentes" id="ak-lista"></ul>
          <p class="kit-costo-calc" id="ak-costo"></p>
          <div class="m-acciones"><span></span><button class="btn-primario" id="ak-listo">Listo</button></div>
        </div>`;
      document.body.appendChild(overlay);
      const $$ = (s) => overlay.querySelector(s);
      const cerrarArmador = () => {
        overlay.remove();
        actualizarResumenKit();
      };
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) cerrarArmador(); });

      const buscar = $$("#ak-buscar");
      const res = $$("#ak-res");
      let t = null;

      buscar.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => correr(buscar.value.trim()), 150);
      });
      buscar.addEventListener("blur", () => setTimeout(() => { res.hidden = true; }, 150));

      async function correr(texto) {
        if (!texto) { res.hidden = true; return; }
        try {
          const lista = await invoke("prod_listar", { rol: sesion.rol, filtro: texto, soloStockBajo: false });
          const candidatos = lista.filter((p) => !p.es_kit && (!prod || p.id !== prod.id));
          if (candidatos.length === 0) {
            res.innerHTML = '<div class="kit-res-vacio">Sin resultados.</div>';
          } else {
            res.innerHTML = candidatos.slice(0, 8).map((p) =>
              `<button type="button" class="kit-res-item" data-id="${p.id}"><span>${escapar(p.nombre)}</span><span class="num">${pesos(p.precio_venta_centavos)}</span></button>`
            ).join("");
            res.querySelectorAll(".kit-res-item").forEach((b) =>
              b.addEventListener("mousedown", (e) => {
                e.preventDefault();
                agregar(candidatos.find((x) => x.id === b.dataset.id));
              })
            );
          }
          res.hidden = false;
        } catch (e) {
          res.innerHTML = '<div class="kit-res-vacio">Error: ' + escapar(String(e)) + "</div>";
          res.hidden = false;
        }
      }

      function agregar(p) {
        const ex = kitComponentes.find((c) => c.producto_id === p.id);
        if (ex) ex.cantidad += 1;
        else kitComponentes.push({ producto_id: p.id, nombre: p.nombre, cantidad: 1, costo_centavos: p.costo_centavos || 0 });
        buscar.value = "";
        res.hidden = true;
        pintarLista();
      }

      function pintarLista() {
        const lista = $$("#ak-lista");
        if (kitComponentes.length === 0) {
          lista.innerHTML = '<li class="kit-comp-vacio">Añade productos que formen este paquete.</li>';
        } else {
          lista.innerHTML = kitComponentes.map((c, i) => `
            <li class="kit-comp">
              <span class="kit-comp-nombre">${escapar(c.nombre)}</span>
              <div class="kit-comp-cant">
                <button type="button" class="cl-btn" data-kmenos="${i}">−</button>
                <input class="cl-cant-input" data-kcant="${i}" value="${c.cantidad}" inputmode="decimal" />
                <button type="button" class="cl-btn" data-kmas="${i}">+</button>
              </div>
              <button type="button" class="kit-comp-quitar" data-kquitar="${i}" aria-label="Quitar">×</button>
            </li>`).join("");
          lista.querySelectorAll("[data-kmenos]").forEach((b) =>
            b.addEventListener("click", () => { const i = +b.dataset.kmenos; kitComponentes[i].cantidad = Math.max(1, +(kitComponentes[i].cantidad - 1).toFixed(3)); pintarLista(); })
          );
          lista.querySelectorAll("[data-kmas]").forEach((b) =>
            b.addEventListener("click", () => { const i = +b.dataset.kmas; kitComponentes[i].cantidad = +(kitComponentes[i].cantidad + 1).toFixed(3); pintarLista(); })
          );
          lista.querySelectorAll("[data-kcant]").forEach((inp) =>
            inp.addEventListener("change", () => {
              const i = +inp.dataset.kcant;
              const v = parseFloat((inp.value || "").replace(",", "."));
              if (isNaN(v) || v <= 0) kitComponentes.splice(i, 1);
              else kitComponentes[i].cantidad = v;
              pintarLista();
            })
          );
          lista.querySelectorAll("[data-kquitar]").forEach((b) =>
            b.addEventListener("click", () => { kitComponentes.splice(+b.dataset.kquitar, 1); pintarLista(); })
          );
        }
        if (verCostos) {
          $$("#ak-costo").textContent = kitComponentes.length ? `Costo del paquete (calculado): ${pesos(costoKit())}` : "";
        }
      }

      $$("#ak-listo").addEventListener("click", cerrarArmador);
      pintarLista();
      setTimeout(() => buscar.focus(), 50);
    }

    // Al editar un kit, cargar sus componentes actuales.
    if (prod && prod.es_kit) {
      invoke("kit_componentes", { kitId: prod.id })
        .then((comps) => {
          kitComponentes = comps.map((c) => ({
            producto_id: c.producto_id,
            nombre: c.nombre,
            cantidad: c.cantidad,
            costo_centavos: c.costo_centavos || 0,
          }));
          if (modoVenta === "kit") actualizarResumenKit();
        })
        .catch((e) => console.error("No se pudieron cargar componentes:", e));
    }

    aplicarModo(modoVenta);

    // --- Medidor de margen vinculado (solo si ve costos) ---
    if (verCostos) {
      const elCosto = $("#m-costo");
      const elMargen = $("#m-margen");
      const elPrecio = $("#m-precio");
      const elGanancia = $("#m-ganancia");
      const leer = (el) => {
        const v = parseFloat((el.value || "").replace(",", "."));
        return isNaN(v) ? null : v;
      };
      const mostrarGanancia = () => {
        const c = leer(elCosto);
        const p = leer(elPrecio);
        const sufijo = modoVenta === "kit" ? " por paquete" : " por unidad";
        if (c !== null && p !== null && p >= c) {
          elGanancia.textContent = `Ganancia: $${(p - c).toFixed(2)}${sufijo}`;
          elGanancia.className = "margen-nota margen-nota--ok";
        } else if (c !== null && p !== null && p < c) {
          elGanancia.textContent = "⚠ El precio es menor que el costo (pérdida).";
          elGanancia.className = "margen-nota margen-nota--mal";
        } else {
          elGanancia.textContent = "";
        }
      };
      const desdeCostoMargen = () => {
        const c = leer(elCosto);
        const m = leer(elMargen);
        if (c !== null && m !== null) {
          elPrecio.value = (c * (1 + m / 100)).toFixed(2);
        }
        mostrarGanancia();
      };
      const desdePrecio = () => {
        const c = leer(elCosto);
        const p = leer(elPrecio);
        if (c !== null && c > 0 && p !== null) {
          elMargen.value = (((p - c) / c) * 100).toFixed(1);
        }
        mostrarGanancia();
      };
      elCosto.addEventListener("input", desdeCostoMargen);
      elMargen.addEventListener("input", desdeCostoMargen);
      elPrecio.addEventListener("input", desdePrecio);
      // Si el usuario escribe el costo a mano en un kit, dejamos de autollenarlo.
      elCosto.addEventListener("input", () => { if (modoVenta === "kit") costoTocadoManual = true; });
      // Exponer para que el armador de kit refresque la nota de ganancia.
      refrescarGanancia = mostrarGanancia;
      modal.querySelectorAll(".margen-chip").forEach((b) =>
        b.addEventListener("click", () => {
          elMargen.value = b.dataset.m;
          desdeCostoMargen();
        })
      );
      if (esEdicion) desdePrecio();
    }

    $("#m-cancelar").addEventListener("click", cerrarModal);
    if (esEdicion) {
      $("#m-eliminar").addEventListener("click", async () => {
        if (!(await confirmar("¿Eliminar este producto?", "El producto dejará de aparecer, pero el histórico de ventas se conserva."))) return;
        try {
          await invoke("prod_eliminar", { id: prod.id });
          cerrarModal();
          cargarProductos();
        } catch (e) {
          $("#m-error").textContent = String(e);
        }
      });
    }

    $("#m-guardar").addEventListener("click", async () => {
      const err = $("#m-error");
      err.textContent = "";
      const nombre = $("#m-nombre").value.trim();
      if (!nombre) return (err.textContent = "El nombre es obligatorio.");

      const precioC = aCentavos($("#m-precio").value);
      if (precioC === null) return (err.textContent = "Precio de venta inválido.");
      const costoC = verCostos ? aCentavos($("#m-costo").value, true) : 0;
      if (costoC === null) return (err.textContent = "Costo inválido.");
      const mayoreoC = aCentavos($("#m-mayoreo").value, true);
      if (mayoreoC === null) return (err.textContent = "Precio de mayoreo inválido.");

      const esKit = modoVenta === "kit";

      // Validaciones propias del kit.
      if (esKit && kitComponentes.length === 0) {
        return (err.textContent = "Un paquete necesita al menos un producto en su contenido.");
      }

      // La unidad se deriva del modo: granel usa kg/litro; pieza y kit usan "pieza".
      const unidad = modoVenta === "granel" ? $("#m-unidad-granel").value : "pieza";

      // El costo del kit: si el usuario escribió uno, se respeta; si no, el
      // backend lo calcula de los componentes (mandamos null para que calcule).
      let costoFinal = verCostos ? costoC : null;
      if (esKit && verCostos && (!$("#m-costo").value.trim())) costoFinal = null;

      const base = {
        codigo_barras: $("#m-codigo").value.trim() || null,
        nombre,
        categoria_id: $("#m-cat").value || null,
        precio_venta_centavos: precioC,
        costo_centavos: costoFinal,
        precio_mayoreo_centavos: mayoreoC || null,
        cantidad_mayoreo: parseEntero($("#m-cant-mayoreo").value),
        iva_tasa: prod ? (prod.iva_tasa ?? 0) : 0,
        // Un kit no controla stock propio; en otros modos, según el checkbox.
        controla_stock: esKit ? false : $("#m-controla").checked,
        unidad,
        stock_minimo: esKit ? 0 : (parseFloat($("#m-min").value) || 0),
        favorito: $("#m-fav").checked,
        es_kit: esKit,
        componentes: esKit
          ? kitComponentes.map((c) => ({ producto_id: c.producto_id, cantidad: c.cantidad }))
          : [],
      };

      try {
        if (esEdicion) {
          await invoke("prod_editar", { datos: { id: prod.id, ...base } });
        } else {
          await invoke("prod_crear", {
            datos: { ...base, stock_inicial: esKit ? 0 : (parseFloat($("#m-stock-ini")?.value) || 0) },
          });
        }
        cerrarModal();
        await cargarTodo();
      } catch (e) {
        err.textContent = String(e);
      }
    });

    setTimeout(() => $("#m-nombre").focus(), 50);
  }

  // ------------------------------------------------------------ Modal ajuste
  function abrirModalAjuste(p) {
    const html = `
      <h2>Ajustar stock</h2>
      <p class="m-sub">${escapar(p.nombre)} · stock actual: <strong>${fmtStock(p.stock, p.unidad)}</strong></p>
      <div class="aj-tipos">
        <button class="aj-tipo aj-tipo--activo" data-tipo="entrada">Entrada</button>
        <button class="aj-tipo" data-tipo="merma">Merma</button>
        <button class="aj-tipo" data-tipo="ajuste_conteo">Conteo físico</button>
      </div>
      <label id="aj-label-cant">Cantidad que entra
        <input id="aj-cant" inputmode="decimal" placeholder="0" />
      </label>
      <label>Motivo
        <input id="aj-motivo" placeholder="Reabasto, caducidad, conteo…" />
      </label>
      <p class="m-preview" id="aj-preview"></p>
      <p class="m-error" id="aj-error"></p>
      <div class="m-acciones">
        <span></span>
        <div>
          <button class="btn-sec" id="aj-cancelar">Cancelar</button>
          <button class="btn-primario" id="aj-guardar">Aplicar</button>
        </div>
      </div>
    `;
    const modal = abrirModal(html);
    const $ = (s) => modal.querySelector(s);
    let tipo = "entrada";

    const labels = {
      entrada: "Cantidad que entra",
      merma: "Cantidad que se pierde",
      ajuste_conteo: "Stock real contado",
    };

    function actualizarPreview() {
      const v = parseFloat($("#aj-cant").value);
      const prev = $("#aj-preview");
      if (isNaN(v)) return (prev.textContent = "");
      let nuevo;
      if (tipo === "entrada") nuevo = p.stock + v;
      else if (tipo === "merma") nuevo = p.stock - v;
      else nuevo = v;
      prev.textContent = `Stock resultante: ${fmtStock(nuevo, p.unidad)}`;
      prev.className = "m-preview" + (nuevo < 0 ? " m-preview--mal" : "");
    }

    modal.querySelectorAll(".aj-tipo").forEach((b) =>
      b.addEventListener("click", () => {
        modal.querySelectorAll(".aj-tipo").forEach((x) => x.classList.remove("aj-tipo--activo"));
        b.classList.add("aj-tipo--activo");
        tipo = b.dataset.tipo;
        $("#aj-label-cant").firstChild.textContent = labels[tipo];
        actualizarPreview();
      })
    );
    $("#aj-cant").addEventListener("input", actualizarPreview);
    $("#aj-cancelar").addEventListener("click", cerrarModal);

    $("#aj-guardar").addEventListener("click", async () => {
      const err = $("#aj-error");
      err.textContent = "";
      const v = parseFloat($("#aj-cant").value);
      if (isNaN(v) || v < 0) return (err.textContent = "Cantidad inválida.");
      try {
        await invoke("prod_ajustar_stock", {
          datos: {
            producto_id: p.id,
            tipo,
            cantidad: v,
            motivo: $("#aj-motivo").value.trim() || null,
            usuario_pos_id: sesion.id,
          },
        });
        cerrarModal();
        cargarProductos();
        cargarMetricas();
      } catch (e) {
        err.textContent = String(e);
      }
    });

    setTimeout(() => $("#aj-cant").focus(), 50);
  }

  // -------------------------------------------------------- Modal categorías
  // ---- Departamentos (antes "categorías") ----
  // Paleta de colores curada para departamentos (coherente con el diseño).
  const PALETA_DEPTO = [
    "#8b5cf6", "#6366f1", "#3b82f6", "#0ea5e9", "#06b6d4", "#14b8a6",
    "#10b981", "#84cc16", "#eab308", "#f59e0b", "#f97316", "#ef4444",
    "#ec4899", "#d946ef", "#a855f7", "#64748b",
  ];

  function abrirModalCategorias() {
    function pintar() {
      const lista =
        categorias.length === 0
          ? '<li class="cat-vacio">Sin departamentos todavía.</li>'
          : categorias
              .map(
                (c) => `
            <li class="depto-fila" draggable="true" data-id="${c.id}">
              <span class="depto-asa" aria-label="Arrastrar para reordenar">${icono("asa")}</span>
              <span class="cat-color" style="background:${c.color || "var(--acento)"}"></span>
              <span class="cat-nombre">${escapar(c.nombre)}</span>
              <button class="btn-mini" data-cat-edit="${c.id}">Editar</button>
              <button class="btn-mini btn-mini--peligro" data-cat-del="${c.id}">Quitar</button>
            </li>`
              )
              .join("");
      const html = `
        <h2>Departamentos</h2>
        <p class="m-sub">Organiza tus productos. Arrastra desde ⠿ para ordenar cómo aparecen.</p>
        <ul class="cat-lista" id="depto-lista">${lista}</ul>
        <p class="m-error" id="cat-error"></p>
        <div class="m-acciones">
          <button class="btn-primario" id="cat-nuevo">+ Nuevo departamento</button>
          <button class="btn-sec" id="cat-cerrar">Cerrar</button>
        </div>
      `;
      const modal = abrirModal(html, true);
      const $ = (s) => modal.querySelector(s);
      $("#cat-cerrar").addEventListener("click", () => {
        cerrarModal();
        cargarProductos();
      });
      $("#cat-nuevo").addEventListener("click", () => abrirEditorDepto(null));

      modal.querySelectorAll("[data-cat-del]").forEach((b) =>
        b.addEventListener("click", async () => {
          if (!(await confirmar("¿Quitar este departamento?", "Los productos que lo usan quedarán sin departamento."))) return;
          try {
            await invoke("cat_eliminar", { id: b.dataset.catDel });
            categorias = await invoke("cat_listar");
            cerrarModal();
            pintar();
          } catch (e) {
            $("#cat-error").textContent = String(e);
          }
        })
      );
      modal.querySelectorAll("[data-cat-edit]").forEach((b) =>
        b.addEventListener("click", () => {
          const c = categorias.find((x) => x.id === b.dataset.catEdit);
          abrirEditorDepto(c);
        })
      );

      // --- Arrastrar y soltar para reordenar ---
      const listaEl = $("#depto-lista");
      let arrastradoId = null;

      listaEl.querySelectorAll(".depto-fila").forEach((fila) => {
        fila.addEventListener("dragstart", (e) => {
          arrastradoId = fila.dataset.id;
          fila.classList.add("depto-fila--arrastrando");
          e.dataTransfer.effectAllowed = "move";
        });
        fila.addEventListener("dragend", () => {
          fila.classList.remove("depto-fila--arrastrando");
          listaEl.querySelectorAll(".depto-fila").forEach((f) => f.classList.remove("depto-fila--sobre"));
        });
        fila.addEventListener("dragover", (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (fila.dataset.id !== arrastradoId) fila.classList.add("depto-fila--sobre");
        });
        fila.addEventListener("dragleave", () => fila.classList.remove("depto-fila--sobre"));
        fila.addEventListener("drop", (e) => {
          e.preventDefault();
          fila.classList.remove("depto-fila--sobre");
          const destinoId = fila.dataset.id;
          if (!arrastradoId || arrastradoId === destinoId) return;
          soltarDepto(arrastradoId, destinoId);
        });
      });
    }

    // Reordena: coloca el departamento arrastrado en la posición del destino.
    async function soltarDepto(idArrastrado, idDestino) {
      const desde = categorias.findIndex((x) => x.id === idArrastrado);
      const hasta = categorias.findIndex((x) => x.id === idDestino);
      if (desde < 0 || hasta < 0) return;
      const nuevos = categorias.slice();
      const [movido] = nuevos.splice(desde, 1);
      nuevos.splice(hasta, 0, movido);
      // Actualizar la lista local ya para que se vea inmediato.
      categorias = nuevos;
      try {
        await invoke("cat_reordenar", { ids: nuevos.map((c) => c.id) });
        categorias = await invoke("cat_listar");
        cerrarModal();
        pintar();
      } catch (e) {
        console.error(e);
      }
    }

    // Ventana propia para crear/editar un departamento (nombre + color).
    function abrirEditorDepto(depto) {
      const esEdicion = !!depto;
      const colorActual = (depto && depto.color) || PALETA_DEPTO[0];
      const swatches = PALETA_DEPTO.map(
        (col) => `<button type="button" class="depto-swatch ${col === colorActual ? "depto-swatch--activo" : ""}" data-color="${col}" style="background:${col}" aria-label="Color ${col}"></button>`
      ).join("");
      const html = `
        <h2>${esEdicion ? "Editar departamento" : "Nuevo departamento"}</h2>
        <label class="depto-campo">Nombre
          <input id="depto-nombre" value="${depto ? escapar(depto.nombre) : ""}" placeholder="Ej. Bebidas, Cigarros, Botanas" />
        </label>
        <div class="depto-color-label">Color</div>
        <div class="depto-paleta" id="depto-paleta">${swatches}</div>
        <p class="m-error" id="depto-error"></p>
        <div class="m-acciones">
          <span></span>
          <div>
            <button class="btn-sec" id="depto-cancelar">Cancelar</button>
            <button class="btn-primario" id="depto-guardar">${esEdicion ? "Guardar" : "Crear"}</button>
          </div>
        </div>
      `;
      const modal = abrirModal(html, true);
      const $ = (s) => modal.querySelector(s);
      let colorElegido = colorActual;

      modal.querySelectorAll(".depto-swatch").forEach((sw) =>
        sw.addEventListener("click", () => {
          colorElegido = sw.dataset.color;
          modal.querySelectorAll(".depto-swatch").forEach((s) => s.classList.remove("depto-swatch--activo"));
          sw.classList.add("depto-swatch--activo");
        })
      );

      $("#depto-cancelar").addEventListener("click", () => {
        cerrarModal();
        pintar();
      });
      $("#depto-nombre").addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); $("#depto-guardar").click(); }
      });
      $("#depto-guardar").addEventListener("click", async () => {
        const nombre = $("#depto-nombre").value.trim();
        if (!nombre) return ($("#depto-error").textContent = "Escribe un nombre.");
        try {
          if (esEdicion) {
            await invoke("cat_editar", { datos: { id: depto.id, nombre, color: colorElegido, orden: depto.orden } });
          } else {
            await invoke("cat_crear", { datos: { nombre, color: colorElegido, orden: categorias.length } });
          }
          categorias = await invoke("cat_listar");
          cerrarModal();
          pintar();
        } catch (e) {
          $("#depto-error").textContent = String(e);
        }
      });
      setTimeout(() => $("#depto-nombre").focus(), 40);
    }

    pintar();
  }

  // ----------------------------------------------------------------- helpers
  function fmtStock(n, unidad) {
    const esEntero = Number.isInteger(n);
    const num = unidad === "pieza" ? (esEntero ? n : n.toFixed(0)) : n.toFixed(3);
    const u = unidad === "pieza" ? "" : " " + unidad;
    return `${num}${u}`;
  }

  // Aviso de error no bloqueante (toast), reemplaza al alert() nativo.
  function mostrarError(msg) {
    let toast = wrap.querySelector("#inv-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "inv-toast";
      toast.className = "inv-toast";
      wrap.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("inv-toast--visible");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove("inv-toast--visible"), 3000);
  }
}

// ============================================================================
// Infraestructura de modales y confirmación (compartida en esta vista)
// ============================================================================
let modalActual = null;

function abrirModal(htmlInterno, reemplazar = false) {
  if (modalActual && !reemplazar) cerrarModal();
  if (modalActual && reemplazar) cerrarModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${htmlInterno}</div>`;
  document.body.appendChild(overlay);
  modalActual = overlay;
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) cerrarModal();
  });
  return overlay.querySelector(".modal");
}

function cerrarModal() {
  if (modalActual) {
    modalActual.remove();
    modalActual = null;
  }
}

// Confirmación con promesa (reemplaza al confirm() nativo, más elegante).
function confirmar(titulo, detalle) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay modal-overlay--alto";
    overlay.innerHTML = `
      <div class="modal modal--chico" role="dialog" aria-modal="true">
        <h2>${escaparLocal(titulo)}</h2>
        ${detalle ? `<p class="m-sub">${escaparLocal(detalle)}</p>` : ""}
        <div class="m-acciones"><span></span><div>
          <button class="btn-sec" data-no>Cancelar</button>
          <button class="btn-peligro" data-si>Sí, continuar</button>
        </div></div>
      </div>`;
    document.body.appendChild(overlay);
    const cerrar = (val) => {
      overlay.remove();
      resolve(val);
    };
    overlay.querySelector("[data-si]").addEventListener("click", () => cerrar(true));
    overlay.querySelector("[data-no]").addEventListener("click", () => cerrar(false));
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) cerrar(false);
    });
  });
}
function escaparLocal(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// Convierte texto "12.50" a centavos (1250). null si inválido.
// permitirVacio: si true, "" devuelve 0 (para campos opcionales).
function aCentavos(txt, permitirVacio = false) {
  const t = (txt || "").trim();
  if (t === "") return permitirVacio ? 0 : null;
  const v = parseFloat(t.replace(",", "."));
  if (isNaN(v) || v < 0) return null;
  return Math.round(v * 100);
}
function parseEntero(txt) {
  const t = (txt || "").trim();
  if (t === "") return null;
  const v = parseInt(t, 10);
  return isNaN(v) ? null : v;
}
