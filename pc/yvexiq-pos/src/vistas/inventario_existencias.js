// YvexPOS — módulo Inventario (gestión de EXISTENCIAS, no del catálogo).
// El catálogo (crear/editar productos) vive en "Productos". Aquí se gestiona
// cuánto hay: resurtir, ajustar, ver el reporte de inventario.
//
// Accesos: Resurtir (entrada de mercancía), Ajustes (mermas/conteo),
// Reporte de inventario (valor, unidades, por categoría), Importar.

import { invoke } from "@tauri-apps/api/core";
import { pesos, centavos, escapar } from "../util/formato.js";

export function montarInventario(contenedor, sesion, alSalir, irAImportar) {
  const verCostos = sesion.rol !== "cajero";

  contenedor.innerHTML = "";
  contenedor.style.alignItems = "stretch";
  contenedor.style.justifyContent = "flex-start";

  const wrap = document.createElement("div");
  wrap.className = "inv";
  contenedor.appendChild(wrap);

  renderHub();

  // ---------------------------------------------------------------- Hub
  function renderHub() {
    wrap.innerHTML = `
      <header class="inv-head">
        <div class="inv-head-izq">
          <button class="inv-volver" id="inv-volver" aria-label="Volver">←</button>
          <h1>Inventario</h1>
        </div>
      </header>
      <p class="inv-sub">Gestiona las existencias de tu negocio. Para crear o editar productos, usa el módulo Productos.</p>
      <div class="invex-grid">
        <button class="invex-card" data-accion="resurtir">
          <span class="invex-ico">📥</span>
          <span class="invex-nombre">Agregar a inventario</span>
          <span class="invex-desc">Registrar entrada de mercancía y actualizar costo/precio</span>
        </button>
        <button class="invex-card" data-accion="ajuste">
          <span class="invex-ico">🔧</span>
          <span class="invex-nombre">Ajustes</span>
          <span class="invex-desc">Corregir stock por merma o conteo físico</span>
        </button>
        <button class="invex-card" data-accion="conteo">
          <span class="invex-ico">📋</span>
          <span class="invex-nombre">Realizar inventario</span>
          <span class="invex-desc">Contar existencias por departamento y corregir diferencias</span>
        </button>
        ${verCostos ? `
        <button class="invex-card" data-accion="reporte">
          <span class="invex-ico">📊</span>
          <span class="invex-nombre">Reporte de inventario</span>
          <span class="invex-desc">Valor, unidades y desglose por categoría</span>
        </button>` : ""}
        <button class="invex-card" data-accion="importar">
          <span class="invex-ico">📦</span>
          <span class="invex-nombre">Importar</span>
          <span class="invex-desc">Traer catálogo desde otro POS</span>
        </button>
      </div>
    `;
    wrap.querySelector("#inv-volver").addEventListener("click", alSalir);
    wrap.querySelectorAll("[data-accion]").forEach((b) =>
      b.addEventListener("click", () => abrir(b.dataset.accion))
    );
  }

  function abrir(accion) {
    if (accion === "resurtir") pantallaMovimiento("entrada");
    else if (accion === "ajuste") pantallaMovimiento("ajuste");
    else if (accion === "conteo") pantallaConteoDepto();
    else if (accion === "reporte") pantallaReporte();
    else if (accion === "importar") {
      if (typeof irAImportar === "function") irAImportar();
    }
  }

  function cabecera(titulo) {
    return `
      <header class="inv-head">
        <div class="inv-head-izq">
          <button class="inv-volver" id="sub-volver" aria-label="Volver">←</button>
          <h1>${titulo}</h1>
        </div>
      </header>`;
  }

  // ----------------------------------------------- Resurtir / Ajuste
  // Buscar producto → seleccionar → registrar movimiento.
  function pantallaMovimiento(modo) {
    const esEntrada = modo === "entrada";
    wrap.innerHTML = `
      ${cabecera(esEntrada ? "Agregar a inventario" : "Ajuste de inventario")}
      <p class="inv-sub">${esEntrada
        ? "Busca el producto, indica cuánto entró y, si quieres, actualiza su costo y precio."
        : "Busca el producto y corrige su stock por merma o conteo físico."}</p>
      <div class="invex-buscar-wrap">
        <span class="inv-buscar-ico">🔍</span>
        <input id="mov-buscar" class="inv-buscar" placeholder="Buscar producto por nombre o código…" autocomplete="off" autofocus />
      </div>
      <div id="mov-resultados" class="invex-resultados"></div>
      <div id="mov-form"></div>
    `;
    wrap.querySelector("#sub-volver").addEventListener("click", renderHub);

    const input = wrap.querySelector("#mov-buscar");
    let t;
    input.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => buscar(input.value.trim()), 200);
    });
    // Enter: seleccionar el primer resultado (que es el código exacto si existe).
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const primero = wrap.querySelector("[data-prod]");
        if (primero) primero.click();
      }
    });

    async function buscar(texto) {
      const cont = wrap.querySelector("#mov-resultados");
      if (!texto) {
        cont.innerHTML = "";
        return;
      }
      let prods = [];
      try {
        prods = await invoke("prod_listar", { rol: sesion.rol, filtro: texto, soloStockBajo: false });
      } catch (e) {
        cont.innerHTML = `<p class="m-error">${escapar(String(e))}</p>`;
        return;
      }
      prods = prods.filter((p) => p.controla_stock); // solo los que controlan stock
      if (prods.length === 0) {
        cont.innerHTML = '<p class="invex-vacio">Sin productos con inventario para “' + escapar(texto) + '”.</p>';
        return;
      }
      // Priorizar: el código exacto va primero (si busco "600", el producto con
      // código "600" sale arriba), luego el resto.
      const textoLower = texto.toLowerCase();
      prods.sort((a, b) => {
        const aExacto = (a.codigo_barras || "").toLowerCase() === textoLower ? 0 : 1;
        const bExacto = (b.codigo_barras || "").toLowerCase() === textoLower ? 0 : 1;
        return aExacto - bExacto;
      });
      cont.innerHTML = prods.slice(0, 8).map((p, i) => {
        const codExacto = (p.codigo_barras || "").toLowerCase() === textoLower;
        return `
        <button class="invex-result ${i === 0 ? "invex-result--primero" : ""}" data-prod="${p.id}">
          <span class="invex-result-nombre">${escapar(p.nombre)}${codExacto ? ' <span class="invex-badge-exacto">código exacto</span>' : ""}</span>
          <span class="invex-result-info">${p.codigo_barras ? escapar(p.codigo_barras) + " · " : ""}stock: ${fmtStock(p.stock, p.unidad)}</span>
        </button>`;
      }).join("");
      cont.querySelectorAll("[data-prod]").forEach((b) =>
        b.addEventListener("click", () => {
          const p = prods.find((x) => x.id === b.dataset.prod);
          formMovimiento(p, modo);
        })
      );
    }
  }

  function formMovimiento(p, modo) {
    const esEntrada = modo === "entrada";
    const cont = wrap.querySelector("#mov-form");
    wrap.querySelector("#mov-resultados").innerHTML = "";
    wrap.querySelector("#mov-buscar").value = p.nombre;

    const costoActual = verCostos && p.costo_centavos ? centavos(p.costo_centavos) : "";
    const precioActual = centavos(p.precio_venta_centavos);

    cont.innerHTML = `
      <div class="invex-form">
        <div class="invex-form-prod">
          <strong>${escapar(p.nombre)}</strong>
          ${p.codigo_barras ? `<span class="invex-form-cod">Código: ${escapar(p.codigo_barras)}</span>` : ""}
        </div>
        <div class="invex-stock-actual">
          <span class="invex-stock-actual-label">Stock actual</span>
          <span class="invex-stock-actual-valor">${fmtStock(p.stock, p.unidad)} <small>${escapar(p.unidad)}</small></span>
        </div>
        ${esEntrada ? `
          <label>Cantidad que entró
            <input id="mov-cant" type="number" step="0.001" min="0" placeholder="0" autofocus />
          </label>
          ${verCostos ? `
          <div class="invex-form-fila">
            <label>Costo unitario (opcional)
              <input id="mov-costo" type="number" step="0.01" min="0" value="${costoActual}" placeholder="${costoActual || "0.00"}" />
            </label>
            <label>Precio de venta (opcional)
              <input id="mov-precio" type="number" step="0.01" min="0" value="${precioActual}" />
            </label>
          </div>
          <div class="invex-margen-fila">
            <label class="invex-margen-label">Subir precio por margen
              <div class="invex-margen-input">
                <input id="mov-margen" type="number" step="1" min="0" placeholder="ej. 30" />
                <span>%</span>
                <button class="btn-sec" id="mov-aplicar-margen" type="button">Aplicar</button>
              </div>
            </label>
            <p class="invex-ayuda">Calcula el precio de venta sumando ese % de ganancia sobre el costo.</p>
          </div>` : ""}
        ` : `
          <div class="invex-ajuste-tipo">
            <label class="invex-radio-card">
              <input type="radio" name="ajtipo" value="merma" checked />
              <span class="invex-radio-cuerpo">
                <span class="invex-radio-titulo">Merma — restar</span>
                <span class="invex-radio-desc">Quita unidades del stock (producto dañado, caducado, robo). El número que pongas se <strong>resta</strong> de lo que hay.</span>
              </span>
            </label>
            <label class="invex-radio-card">
              <input type="radio" name="ajtipo" value="ajuste_conteo" />
              <span class="invex-radio-cuerpo">
                <span class="invex-radio-titulo">Conteo físico — fijar</span>
                <span class="invex-radio-desc">Contaste físicamente y el stock real es otro. El número que pongas <strong>reemplaza</strong> el stock actual.</span>
              </span>
            </label>
          </div>
          <label id="mov-cant-label">Cantidad de merma
            <input id="mov-cant" type="number" step="0.001" min="0" placeholder="0" autofocus />
          </label>
          <p class="invex-ayuda" id="mov-ayuda">Se restarán estas unidades del stock actual.</p>
          <label>Motivo (opcional)
            <input id="mov-motivo" type="text" placeholder="Ej. producto dañado, caducado…" />
          </label>
        `}
        <p class="m-error" id="mov-error"></p>
        <div class="invex-form-acciones">
          <button class="btn-sec" id="mov-cancelar">Cancelar</button>
          <button class="btn-primario" id="mov-guardar">${esEntrada ? "Agregar al inventario" : "Aplicar ajuste"}</button>
        </div>
      </div>
    `;

    setTimeout(() => cont.querySelector("#mov-cant")?.focus(), 50);

    cont.querySelector("#mov-cancelar").addEventListener("click", () => {
      cont.innerHTML = "";
      wrap.querySelector("#mov-buscar").value = "";
      wrap.querySelector("#mov-buscar").focus();
    });

    // Margen: calcular precio = costo / (1 - margen/100)… o costo*(1+margen/100)?
    // Usamos margen sobre precio de venta (markup sobre costo) estilo retail MX:
    // precio = costo * (1 + margen/100).
    if (esEntrada && verCostos) {
      cont.querySelector("#mov-aplicar-margen")?.addEventListener("click", () => {
        const costo = parseFloat(cont.querySelector("#mov-costo").value) || 0;
        const margen = parseFloat(cont.querySelector("#mov-margen").value) || 0;
        if (costo > 0 && margen > 0) {
          const nuevoPrecio = costo * (1 + margen / 100);
          cont.querySelector("#mov-precio").value = nuevoPrecio.toFixed(2);
        }
      });
    }

    // Cambiar etiqueta de cantidad y ayuda según tipo de ajuste.
    if (!esEntrada) {
      cont.querySelectorAll('input[name="ajtipo"]').forEach((r) =>
        r.addEventListener("change", () => {
          const tipo = cont.querySelector('input[name="ajtipo"]:checked').value;
          const esMerma = tipo === "merma";
          cont.querySelector("#mov-cant-label").childNodes[0].textContent =
            esMerma ? "Cantidad de merma" : "Stock real contado";
          cont.querySelector("#mov-ayuda").innerHTML = esMerma
            ? "Se restarán estas unidades del stock actual."
            : `El stock pasará a ser exactamente este número (ahora hay ${fmtStock(p.stock, p.unidad)}).`;
        })
      );
    }

    cont.querySelector("#mov-guardar").addEventListener("click", () => guardar(p, modo, cont));
  }

  async function guardar(p, modo, cont) {
    const err = cont.querySelector("#mov-error");
    err.textContent = "";
    const esEntrada = modo === "entrada";
    const cantidad = parseFloat(cont.querySelector("#mov-cant").value);
    if (isNaN(cantidad) || cantidad < 0) {
      err.textContent = "Indica una cantidad válida.";
      return;
    }

    const btn = cont.querySelector("#mov-guardar");
    btn.disabled = true;
    btn.textContent = "Guardando…";

    try {
      // Si es entrada y se cambió costo/precio, primero actualizamos el producto.
      if (esEntrada && verCostos) {
        const nuevoCosto = parseFloat(cont.querySelector("#mov-costo")?.value);
        const nuevoPrecio = parseFloat(cont.querySelector("#mov-precio")?.value);
        const cambioCosto = !isNaN(nuevoCosto) && Math.round(nuevoCosto * 100) !== (p.costo_centavos || 0);
        const cambioPrecio = !isNaN(nuevoPrecio) && Math.round(nuevoPrecio * 100) !== p.precio_venta_centavos;
        if (cambioCosto || cambioPrecio) {
          await invoke("prod_editar", {
            datos: {
              id: p.id,
              nombre: p.nombre,
              codigo_barras: p.codigo_barras || null,
              categoria_id: p.categoria_id || null,
              precio_venta_centavos: !isNaN(nuevoPrecio) ? Math.round(nuevoPrecio * 100) : p.precio_venta_centavos,
              costo_centavos: !isNaN(nuevoCosto) ? Math.round(nuevoCosto * 100) : (p.costo_centavos || 0),
              precio_mayoreo_centavos: p.precio_mayoreo_centavos || null,
              cantidad_mayoreo: p.cantidad_mayoreo || null,
              iva_tasa: p.iva_tasa || 0,
              controla_stock: p.controla_stock,
              unidad: p.unidad,
              stock_minimo: p.stock_minimo,
              favorito: p.favorito,
            },
          });
        }
      }

      // Registrar el movimiento de stock.
      const tipo = esEntrada
        ? "entrada"
        : cont.querySelector('input[name="ajtipo"]:checked').value;
      const motivo = esEntrada
        ? "Entrada de mercancía"
        : (cont.querySelector("#mov-motivo")?.value.trim() ||
           (tipo === "merma" ? "Merma" : "Conteo físico"));

      const nuevoStock = await invoke("prod_ajustar_stock", {
        datos: {
          producto_id: p.id,
          tipo,
          cantidad,
          motivo,
          usuario_pos_id: sesion.id,
        },
      });

      // Éxito: volver a la búsqueda lista para el siguiente.
      mostrarExitoMovimiento(p.nombre, nuevoStock, p.unidad, modo);
    } catch (e) {
      err.textContent = String(e);
      btn.disabled = false;
      btn.textContent = esEntrada ? "Registrar entrada" : "Aplicar ajuste";
    }
  }

  function mostrarExitoMovimiento(nombre, nuevoStock, unidad, modo) {
    const cont = wrap.querySelector("#mov-form");
    cont.innerHTML = `
      <div class="invex-exito">
        <div class="exito-check">✓</div>
        <p><strong>${escapar(nombre)}</strong></p>
        <p>Stock actualizado: <strong>${fmtStock(nuevoStock, unidad)} ${escapar(unidad)}</strong></p>
        <button class="btn-primario" id="mov-otro">Registrar otro</button>
      </div>`;
    cont.querySelector("#mov-otro").addEventListener("click", () => {
      cont.innerHTML = "";
      const inp = wrap.querySelector("#mov-buscar");
      inp.value = "";
      inp.focus();
    });
  }

  // ----------------------------------------------- Reporte de inventario
  async function pantallaReporte() {
    wrap.innerHTML = `${cabecera("Reporte de inventario")}
      <div id="rep-cont"><p class="inv-sub">Calculando…</p></div>`;
    wrap.querySelector("#sub-volver").addEventListener("click", renderHub);

    // Cargar el mapa de categorías (id → nombre) para el desglose por producto.
    try {
      const cats = await invoke("cat_listar");
      mapaCategoriasNombre = {};
      cats.forEach((c) => { mapaCategoriasNombre[c.id] = c.nombre; });
    } catch (e) {
      mapaCategoriasNombre = {};
    }

    let r;
    try {
      r = await invoke("inventario_reporte", { rol: sesion.rol });
    } catch (e) {
      wrap.querySelector("#rep-cont").innerHTML = `<p class="m-error">${escapar(String(e))}</p>`;
      return;
    }

    const cont = wrap.querySelector("#rep-cont");
    cont.innerHTML = `
      <div class="invex-rep-tarjetas">
        <div class="invex-rep-card invex-rep-destacada">
          <span class="invex-rep-label">Valor del inventario (a costo)</span>
          <span class="invex-rep-valor">${pesos(r.valor_costo_centavos)}</span>
        </div>
        <div class="invex-rep-card">
          <span class="invex-rep-label">Valor a precio de venta</span>
          <span class="invex-rep-valor">${pesos(r.valor_venta_centavos)}</span>
        </div>
        <div class="invex-rep-card">
          <span class="invex-rep-label">Productos</span>
          <span class="invex-rep-valor">${r.total_productos}</span>
        </div>
        <div class="invex-rep-card">
          <span class="invex-rep-label">Unidades en existencia</span>
          <span class="invex-rep-valor">${fmtStock(r.unidades_totales, "")}</span>
        </div>
        <div class="invex-rep-card ${r.productos_sin_stock > 0 ? "invex-rep-alerta" : ""}">
          <span class="invex-rep-label">Sin stock</span>
          <span class="invex-rep-valor">${r.productos_sin_stock}</span>
        </div>
        <div class="invex-rep-card ${r.productos_stock_bajo > 0 ? "invex-rep-alerta" : ""}">
          <span class="invex-rep-label">Stock bajo</span>
          <span class="invex-rep-valor">${r.productos_stock_bajo}</span>
        </div>
      </div>

      <h2 class="invex-rep-titulo">Por categoría</h2>
      <p class="invex-ayuda" style="margin-top:-8px;margin-bottom:14px">Haz clic en una categoría para ver la lista de sus productos.</p>
      <div class="inv-tabla-wrap">
        <table class="inv-tabla">
          <thead>
            <tr>
              <th>Categoría</th>
              <th class="num">Productos</th>
              <th class="num">Unidades</th>
              <th class="num">Valor a costo</th>
              <th class="num">Valor a venta</th>
            </tr>
          </thead>
          <tbody id="rep-cats">
            ${r.por_categoria.map((c, i) => `
              <tr class="invex-cat-fila" data-cat-idx="${i}" data-cat-nombre="${escapar(c.categoria)}" tabindex="0">
                <td><span class="invex-cat-flecha">▸</span> ${escapar(c.categoria)}</td>
                <td class="num">${c.num_productos}</td>
                <td class="num">${fmtStock(c.unidades, "")}</td>
                <td class="num">${pesos(c.valor_costo_centavos)}</td>
                <td class="num">${pesos(c.valor_venta_centavos)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    `;

    // Al hacer clic/Enter en una categoría, abrir su pantalla dedicada.
    cont.querySelectorAll(".invex-cat-fila").forEach((fila) => {
      const abrir = () => pantallaCategoria(fila.dataset.catNombre, r.por_categoria[+fila.dataset.catIdx]);
      fila.addEventListener("click", abrir);
      fila.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); abrir(); }
      });
    });
  }

  // Pantalla dedicada: lista de productos de un departamento.
  async function pantallaCategoria(nombre, resumen) {
    wrap.innerHTML = `${cabecera(escapar(nombre))}
      <div id="cat-cont"><p class="inv-sub">Cargando productos…</p></div>`;
    wrap.querySelector("#sub-volver").addEventListener("click", pantallaReporte);

    let prods = [];
    try {
      prods = await invoke("prod_listar", { rol: sesion.rol, filtro: null, soloStockBajo: false });
    } catch (e) {
      wrap.querySelector("#cat-cont").innerHTML = `<p class="m-error">${escapar(String(e))}</p>`;
      return;
    }
    const productosCat = prods
      .filter((p) => nombreCategoriaDe(p) === nombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    const cont = wrap.querySelector("#cat-cont");
    cont.innerHTML = `
      <div class="invcat-resumen">
        <div class="invcat-resumen-item">
          <span class="invcat-resumen-label">Productos</span>
          <span class="invcat-resumen-valor">${resumen.num_productos}</span>
        </div>
        <div class="invcat-resumen-item">
          <span class="invcat-resumen-label">Unidades</span>
          <span class="invcat-resumen-valor">${fmtStock(resumen.unidades, "")}</span>
        </div>
        ${verCostos ? `
        <div class="invcat-resumen-item">
          <span class="invcat-resumen-label">Valor a costo</span>
          <span class="invcat-resumen-valor">${pesos(resumen.valor_costo_centavos)}</span>
        </div>
        <div class="invcat-resumen-item">
          <span class="invcat-resumen-label">Valor a venta</span>
          <span class="invcat-resumen-valor">${pesos(resumen.valor_venta_centavos)}</span>
        </div>` : ""}
      </div>

      <div class="invcat-lista">
        ${productosCat.map((p) => {
          const valorCosto = Math.round(p.stock * (p.costo_centavos || 0));
          const sinStock = p.controla_stock && p.stock <= 0;
          const bajo = p.controla_stock && p.stock > 0 && p.stock <= p.stock_minimo;
          const estado = !p.controla_stock ? "" : sinStock ? "invcat-sin" : bajo ? "invcat-bajo" : "invcat-ok";
          return `
            <div class="invcat-item">
              <div class="invcat-item-izq">
                <span class="invcat-item-nombre">${escapar(p.nombre)}</span>
                <span class="invcat-item-cod">${p.codigo_barras ? escapar(p.codigo_barras) : "Sin código"}</span>
              </div>
              <div class="invcat-item-der">
                <div class="invcat-item-precio">${pesos(p.precio_venta_centavos)}</div>
                ${p.controla_stock
                  ? `<div class="invcat-item-stock ${estado}">${fmtStock(p.stock, "")} <small>${escapar(p.unidad)}</small></div>`
                  : '<div class="invcat-item-stock invcat-servicio">servicio</div>'}
              </div>
            </div>`;
        }).join("")}
      </div>
      ${productosCat.length === 0 ? '<p class="invex-vacio">Esta categoría no tiene productos.</p>' : ""}
    `;
  }

  // Necesitamos el nombre de categoría de un producto. Como prod_listar no lo
  // trae directo, mantenemos un mapa cargado del reporte.
  let mapaCategoriasNombre = {};
  function nombreCategoriaDe(p) {
    if (!p.categoria_id) return "Sin categoría";
    return mapaCategoriasNombre[p.categoria_id] || "Sin categoría";
  }

  // ============================================================
  // Modo "Realizar inventario" — conteo por departamento
  // ============================================================
  async function pantallaConteoDepto() {
    wrap.innerHTML = `${cabecera("Realizar inventario")}
      <p class="inv-sub">Cuenta las existencias de tu negocio departamento por departamento. Al terminar verás un resumen de las diferencias antes de aplicar los cambios.</p>
      <div id="conteo-cats"><p class="inv-sub">Cargando departamentos…</p></div>`;
    wrap.querySelector("#sub-volver").addEventListener("click", renderHub);

    let cats = [];
    try {
      cats = await invoke("cat_listar");
    } catch (e) {
      wrap.querySelector("#conteo-cats").innerHTML = `<p class="m-error">${escapar(String(e))}</p>`;
      return;
    }
    const cont = wrap.querySelector("#conteo-cats");
    cont.innerHTML = `
      <p class="invex-rep-titulo">Elige un departamento para contar</p>
      <div class="conteo-cat-grid">
        ${cats.map((c) => `
          <button class="conteo-cat-card" data-cat="${c.id}" data-nombre="${escapar(c.nombre)}">
            <span class="conteo-cat-nombre">${escapar(c.nombre)}</span>
          </button>`).join("")}
      </div>`;
    cont.querySelectorAll("[data-cat]").forEach((b) =>
      b.addEventListener("click", () => pantallaContar(b.dataset.cat, b.dataset.nombre))
    );
  }

  // Pantalla de conteo de un departamento.
  async function pantallaContar(categoriaId, categoriaNombre) {
    wrap.innerHTML = `${cabecera("Contar: " + escapar(categoriaNombre))}
      <div id="contar-cont"><p class="inv-sub">Cargando productos…</p></div>`;
    wrap.querySelector("#sub-volver").addEventListener("click", pantallaConteoDepto);

    let prods = [];
    try {
      prods = await invoke("prod_listar", { rol: sesion.rol, filtro: null, soloStockBajo: false });
    } catch (e) {
      wrap.querySelector("#contar-cont").innerHTML = `<p class="m-error">${escapar(String(e))}</p>`;
      return;
    }
    // Solo productos de esta categoría que controlan stock.
    const items = prods
      .filter((p) => p.categoria_id === categoriaId && p.controla_stock)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    if (items.length === 0) {
      wrap.querySelector("#contar-cont").innerHTML =
        '<p class="invex-vacio">Este departamento no tiene productos con inventario.</p>';
      return;
    }

    // Estado del conteo: producto_id → cantidad contada (null = sin contar).
    const contado = {};
    items.forEach((p) => { contado[p.id] = null; });

    const cont = wrap.querySelector("#contar-cont");
    cont.innerHTML = `
      <p class="inv-sub">Escribe la cantidad contada de cada producto. Si usas lector de barras, escanea el producto y se sumará +1 automáticamente.</p>
      <div class="contar-escaner">
        <span class="inv-buscar-ico">📷</span>
        <input id="contar-scan" class="inv-buscar" placeholder="Escanea un código para sumar +1…" autocomplete="off" />
      </div>
      <div class="contar-lista">
        ${items.map((p) => `
          <div class="contar-item" data-item="${p.id}">
            <div class="contar-item-info">
              <span class="contar-item-nombre">${escapar(p.nombre)}</span>
              <span class="contar-item-sistema">Sistema: ${fmtStock(p.stock, p.unidad)} ${escapar(p.unidad)}</span>
            </div>
            <input type="number" step="0.001" min="0" class="contar-item-input" data-cant="${p.id}"
                   placeholder="contar" />
          </div>`).join("")}
      </div>
      <div class="contar-acciones">
        <span class="contar-progreso" id="contar-progreso">0 de ${items.length} contados</span>
        <button class="btn-primario" id="contar-revisar">Revisar diferencias</button>
      </div>
    `;

    // Inputs de cantidad.
    cont.querySelectorAll("[data-cant]").forEach((inp) =>
      inp.addEventListener("input", () => {
        const id = inp.dataset.cant;
        const v = parseFloat(inp.value);
        contado[id] = isNaN(v) ? null : v;
        actualizarProgreso();
      })
    );

    // Escáner: al escanear un código, busca el producto y suma +1.
    const scan = cont.querySelector("#contar-scan");
    scan.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const codigo = scan.value.trim();
      scan.value = "";
      if (!codigo) return;
      const p = items.find((x) => (x.codigo_barras || "") === codigo);
      if (!p) {
        avisoScan("Ese código no está en este departamento");
        return;
      }
      const actual = contado[p.id] || 0;
      contado[p.id] = actual + 1;
      const inp = cont.querySelector(`[data-cant="${p.id}"]`);
      inp.value = contado[p.id];
      const fila = cont.querySelector(`[data-item="${p.id}"]`);
      fila.classList.add("contar-item--scan");
      setTimeout(() => fila.classList.remove("contar-item--scan"), 600);
      actualizarProgreso();
    });
    setTimeout(() => scan.focus(), 50);

    function actualizarProgreso() {
      const n = Object.values(contado).filter((v) => v !== null).length;
      cont.querySelector("#contar-progreso").textContent = `${n} de ${items.length} contados`;
    }

    function avisoScan(msg) {
      const s = cont.querySelector("#contar-scan");
      s.classList.add("contar-scan--error");
      s.placeholder = msg;
      setTimeout(() => {
        s.classList.remove("contar-scan--error");
        s.placeholder = "Escanea un código para sumar +1…";
      }, 1500);
    }

    cont.querySelector("#contar-revisar").addEventListener("click", () =>
      pantallaDiferencias(items, contado, categoriaNombre)
    );
  }

  // Ticket de diferencias antes de aplicar.
  function pantallaDiferencias(items, contado, categoriaNombre) {
    const difs = items
      .filter((p) => contado[p.id] !== null)
      .map((p) => {
        const real = contado[p.id];
        const delta = real - p.stock;
        const valorDelta = Math.round(delta * (p.costo_centavos || 0));
        return { p, real, delta, valorDelta };
      });

    const conCambio = difs.filter((d) => Math.abs(d.delta) > 1e-9);
    const totalValor = conCambio.reduce((s, d) => s + d.valorDelta, 0);
    const sinContar = items.length - difs.length;

    wrap.innerHTML = `${cabecera("Diferencias: " + escapar(categoriaNombre))}`;
    const cont = document.createElement("div");
    cont.className = "dif-cont";
    wrap.appendChild(cont);
    wrap.querySelector("#sub-volver").addEventListener("click", () => {
      const catId = items[0]?.categoria_id;
      pantallaContar(catId, categoriaNombre);
    });

    if (conCambio.length === 0) {
      cont.innerHTML = `
        <div class="dif-ok">
          <div class="exito-check">✓</div>
          <p>Todo cuadra. No hay diferencias entre lo contado y el sistema.</p>
          ${sinContar > 0 ? `<p class="invex-ayuda">${sinContar} producto(s) sin contar (se omitirán).</p>` : ""}
          <button class="btn-primario" id="dif-cerrar">Volver</button>
        </div>`;
      cont.querySelector("#dif-cerrar").addEventListener("click", renderHub);
      return;
    }

    cont.innerHTML = `
      <p class="inv-sub">Revisa las diferencias antes de aplicar. <span class="dif-rojo">Rojo</span> = falta producto (menos del que debería). <span class="dif-verde">Verde</span> = sobra producto.</p>
      <div class="dif-ticket">
        <div class="dif-ticket-head">
          <span>Producto</span>
          <span class="num">Sistema</span>
          <span class="num">Contado</span>
          <span class="num">Diferencia</span>
          ${verCostos ? '<span class="num">Impacto</span>' : ""}
        </div>
        ${conCambio.map((d) => {
          const signo = d.delta > 0 ? "+" : "";
          const clase = d.delta < 0 ? "dif-rojo" : "dif-verde";
          const impactoTxt = (d.valorDelta < 0 ? "-" : "+") + pesos(Math.abs(d.valorDelta));
          return `
            <div class="dif-ticket-fila">
              <span class="dif-nombre">${escapar(d.p.nombre)}</span>
              <span class="num dif-sistema">${fmtStock(d.p.stock, "")}</span>
              <span class="num dif-contado">${fmtStock(d.real, "")}</span>
              <span class="num ${clase} dif-delta">${signo}${fmtStock(d.delta, "")}</span>
              ${verCostos ? `<span class="num ${clase}">${impactoTxt}</span>` : ""}
            </div>`;
        }).join("")}
      </div>
      ${verCostos ? `
      <div class="dif-total ${totalValor < 0 ? "dif-rojo" : "dif-verde"}">
        <span>Impacto total en inventario</span>
        <span class="dif-total-valor">${totalValor < 0 ? "-" : "+"}${pesos(Math.abs(totalValor))}</span>
      </div>` : ""}
      ${sinContar > 0 ? `<p class="invex-ayuda">${sinContar} producto(s) sin contar — no se tocarán.</p>` : ""}
      <div class="dif-acciones">
        <button class="btn-sec" id="dif-volver">Volver a contar</button>
        <button class="btn-primario" id="dif-aplicar">Aplicar ajustes (${conCambio.length})</button>
      </div>
      <p class="m-error" id="dif-error"></p>
    `;

    cont.querySelector("#dif-volver").addEventListener("click", () => {
      const catId = items[0]?.categoria_id;
      pantallaContar(catId, categoriaNombre);
    });

    cont.querySelector("#dif-aplicar").addEventListener("click", async () => {
      const btn = cont.querySelector("#dif-aplicar");
      const err = cont.querySelector("#dif-error");
      err.textContent = "";
      btn.disabled = true;
      btn.textContent = "Aplicando…";
      const lineas = conCambio.map((d) => ({
        producto_id: d.p.id,
        stock_contado: d.real,
      }));
      try {
        const res = await invoke("inventario_conteo", { lineas, usuarioPosId: sesion.id });
        mostrarConteoAplicado(res);
      } catch (e) {
        err.textContent = String(e);
        btn.disabled = false;
        btn.textContent = `Aplicar ajustes (${conCambio.length})`;
      }
    });
  }

  function mostrarConteoAplicado(res) {
    wrap.innerHTML = `${cabecera("Inventario realizado")}
      <div class="dif-ok">
        <div class="exito-check">✓</div>
        <h2>Conteo aplicado</h2>
        <p><strong>${res.productos_ajustados}</strong> producto(s) ajustado(s).</p>
        ${verCostos ? `<p>Impacto en inventario: <strong class="${res.diferencia_valor_centavos < 0 ? "dif-rojo" : "dif-verde"}">${res.diferencia_valor_centavos < 0 ? "-" : "+"}${pesos(Math.abs(res.diferencia_valor_centavos))}</strong></p>` : ""}
        <button class="btn-primario" id="conteo-fin">Listo</button>
      </div>`;
    wrap.querySelector("#sub-volver").addEventListener("click", renderHub);
    wrap.querySelector("#conteo-fin").addEventListener("click", renderHub);
  }

  function fmtStock(n, unidad) {
    const v = Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
    return v;
  }
}
