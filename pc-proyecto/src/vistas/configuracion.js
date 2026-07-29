// YvexPOS — Configuración (solo dueño/gerente).
// Hub de categorías; cada tarjeta abre su subpantalla. Todo guarda en `config`
// (clave-valor) salvo Cajeros, que usa la tabla usuarios_pos.

import { invoke } from "@tauri-apps/api/core";
import { escapar } from "../util/formato.js";
import { montarVinculacion, detenerPolling } from "../util/vinculacion_ui.js";
import { montarVerificacionInline } from "../util/verificacion_ui.js";
import { TEMAS, ACENTOS, aplicarApariencia, hexAcento, valorApariencia } from "../util/apariencia.js";

const OPCIONES_IVA = [
  { valor: 0, label: "Sin IVA", desc: "No se aplica impuesto" },
  { valor: 16, label: "16%", desc: "México (IVA general)" },
  { valor: 21, label: "21%", desc: "España (IVA general)" },
  { valor: 8, label: "8%", desc: "México frontera" },
];

const SECCIONES = [
  {
    titulo: "Negocio",
    opciones: [
      { id: "negocio", icono: "🏪", nombre: "Datos del negocio", desc: "Nombre, dirección, teléfono" },
      { id: "impuestos", icono: "％", nombre: "Impuestos", desc: "IVA aplicable a las ventas" },
      { id: "fiscal", icono: "📄", nombre: "Datos fiscales", desc: "RFC, régimen, código postal" },
      { id: "moneda", icono: "💲", nombre: "Moneda", desc: "Símbolo y formato" },
    ],
  },
  {
    titulo: "Dispositivos",
    opciones: [
      { id: "impresora", icono: "🖨️", nombre: "Impresora de tickets", desc: "Dispositivo, fuente, columnas" },
      { id: "ticket", icono: "🧾", nombre: "Formato del ticket", desc: "Encabezado, pie, datos" },
      { id: "lector", icono: "📷", nombre: "Lector de códigos", desc: "Escáner de barras" },
      { id: "cajon", icono: "💵", nombre: "Cajón de dinero", desc: "Apertura automática" },
      { id: "bascula", icono: "⚖️", nombre: "Báscula", desc: "Productos a granel" },
    ],
  },
  {
    titulo: "Personalización",
    opciones: [
      { id: "tema", icono: "🎨", nombre: "Apariencia", desc: "Tema, color y estilo" },
      { id: "zona", icono: "🕐", nombre: "Zona horaria", desc: "Para cortes y reportes del día" },
      { id: "formas_pago", icono: "💳", nombre: "Formas de pago", desc: "Métodos aceptados" },
    ],
  },
  {
    titulo: "Sistema",
    opciones: [
      { id: "usuarios", icono: "👤", nombre: "Cajeros y usuarios", desc: "Altas, edición y permisos" },
      { id: "nube", icono: "☁️", nombre: "Conexión con la nube", desc: "Vincula esta caja con tu celular" },
      { id: "importar", icono: "📥", nombre: "Importar datos a YvexPOS", desc: "Desde otro POS o desde Excel" },
      { id: "exportar", icono: "📤", nombre: "Exportar datos", desc: "Descarga productos, inventario o ventas" },
      { id: "respaldo", icono: "💾", nombre: "Respaldo", desc: "Copia de seguridad de datos" },
    ],
  },
];

const METODOS_PAGO = [
  { id: "efectivo", nombre: "Efectivo", fijo: true },
  { id: "tarjeta", nombre: "Tarjeta" },
  { id: "transferencia", nombre: "Transferencia" },
  { id: "credito", nombre: "Crédito (fiado)" },
  { id: "vale", nombre: "Vale" },
];

export function montarConfiguracion(contenedor, sesion, alSalir, abrirEn) {
  contenedor.innerHTML = "";
  contenedor.style.alignItems = "stretch";
  contenedor.style.justifyContent = "flex-start";

  const wrap = document.createElement("div");
  wrap.className = "cfg";
  contenedor.appendChild(wrap);

  let cfg = {}; // mapa clave->valor de toda la config

  cargarYHub();

  async function cargarYHub() {
    try {
      cfg = await invoke("config_leer_todo");
    } catch (e) {
      wrap.innerHTML = '<div class="inv-vacio">Error al cargar: ' + escapar(String(e)) + "</div>";
      return;
    }
    // Si se pidió abrir una subpantalla concreta (ej. importar), ir directo.
    if (abrirEn) {
      abrirSubpantalla(abrirEn);
    } else {
      renderHub();
    }
  }

  function val(clave, def = "") {
    return cfg[clave] !== undefined && cfg[clave] !== "" ? cfg[clave] : def;
  }

  // ------------------------------------------------------------------- Hub
  function renderHub() {
    wrap.innerHTML = `
      <header class="inv-head">
        <div class="inv-head-izq">
          <button class="inv-volver" id="cfg-volver" aria-label="Volver">←</button>
          <h1>Configuración</h1>
        </div>
      </header>
      ${SECCIONES.map(seccionHTML).join("")}
    `;
    wrap.querySelector("#cfg-volver").addEventListener("click", alSalir);
    wrap.querySelectorAll("[data-abrir]").forEach((b) =>
      b.addEventListener("click", () => abrirSubpantalla(b.dataset.abrir))
    );
  }

  function seccionHTML(sec) {
    return `
      <section class="cfg-hub-seccion">
        <h2 class="cfg-hub-titulo">${sec.titulo}</h2>
        <div class="cfg-hub-grid">${sec.opciones.map(opcionHTML).join("")}</div>
      </section>`;
  }

  function opcionHTML(op) {
    return `
      <button class="cfg-hub-card" data-abrir="${op.id}">
        <span class="cfg-hub-ico">${op.icono}</span>
        <span class="cfg-hub-nombre">${op.nombre}</span>
        <span class="cfg-hub-desc">${op.desc}</span>
      </button>`;
  }

  function abrirSubpantalla(id) {
    const fn = {
      negocio: subNegocio, impuestos: subImpuestos, fiscal: subFiscal, moneda: subMoneda,
      impresora: subImpresora, ticket: subTicket, lector: subLector, cajon: subCajon, bascula: subBascula,
      tema: subTema, zona: subZona, formas_pago: subFormasPago, usuarios: subUsuarios, respaldo: subRespaldo,
      importar: subImportarHub, importar_pos: subImportar, importar_excel: subImportarExcel, exportar: subExportar,
      nube: subNube,
    }[id];
    if (fn) fn(); else renderHub();
  }

  function subNube() {
    wrap.innerHTML = `${cabeceraSub("Conexión con la nube", false)}
      <section class="cfg-seccion">
        <div id="verif-estado"></div>
        <div id="vinc-contenedor"></div>
      </section>`;
    conectarVolver();
    const cont = wrap.querySelector("#vinc-contenedor");
    montarVinculacion(cont, { compacto: false });
    // Si la cuenta está vinculada pero sin verificar, mostrar el aviso arriba.
    mostrarEstadoVerificacion();
  }

  async function mostrarEstadoVerificacion() {
    const caja = wrap.querySelector("#verif-estado");
    if (!caja) return;
    let estado;
    try {
      estado = await invoke("vinc_estado_cuenta");
    } catch (_) {
      return; // sin conexión: no mostrar nada
    }
    if (!estado || !estado.vinculado || !estado.email) return;

    if (estado.verificado) {
      caja.innerHTML = `
        <div class="cfg-verif cfg-verif--ok">
          <span class="cfg-verif-icono">✅</span>
          <div>
            <strong>Correo verificado</strong>
            <p>${escapar(estado.email)}</p>
          </div>
        </div>`;
      return;
    }

    // No verificado: aviso + botón para verificar en línea.
    caja.innerHTML = `
      <div class="cfg-verif cfg-verif--pend">
        <span class="cfg-verif-icono">📧</span>
        <div class="cfg-verif-texto">
          <strong>Falta verificar tu correo</strong>
          <p>${escapar(estado.email)}</p>
        </div>
        <button type="button" class="btn-primario" id="cfg-verif-btn">Verificar</button>
      </div>
      <div id="cfg-verif-inline"></div>`;

    caja.querySelector("#cfg-verif-btn").addEventListener("click", () => {
      const inline = caja.querySelector("#cfg-verif-inline");
      montarVerificacionInline(inline, estado.email, {
        alVerificar: () => subNube(), // re-render: ahora saldrá "verificado"
      });
      caja.querySelector("#cfg-verif-btn").style.display = "none";
    });
  }

  function cabeceraSub(titulo, conGuardar = true) {
    return `
      <header class="inv-head">
        <div class="inv-head-izq">
          <button class="inv-volver" id="sub-volver" aria-label="Volver">←</button>
          <h1>${titulo}</h1>
        </div>
        ${conGuardar ? '<div class="inv-head-der"><button class="btn-primario" id="sub-guardar">Guardar</button></div>' : ""}
      </header>
      <p class="m-error" id="sub-error"></p>
      <p class="cfg-ok" id="sub-ok" hidden>✓ Guardado</p>
    `;
  }

  function conectarVolver(destino) {
    wrap.querySelector("#sub-volver").addEventListener("click", () => {
      detenerPolling(); // por si venimos de la subpantalla de vinculación
      (destino || renderHub)();
    });
  }

  // Guarda un conjunto de claves en config.
  async function guardarClaves(claves) {
    const err = wrap.querySelector("#sub-error");
    const ok = wrap.querySelector("#sub-ok");
    if (err) err.textContent = "";
    if (ok) ok.hidden = true;
    try {
      await invoke("config_guardar_claves", { claves, rol: sesion.rol });
      Object.assign(cfg, claves);
      if (ok) { ok.hidden = false; setTimeout(() => (ok.hidden = true), 2200); }
      return true;
    } catch (e) {
      if (err) err.textContent = String(e);
      return false;
    }
  }

  // ------------------------------------------------------ Subpantallas config
  function campoTexto(id, label, clave, placeholder = "", col2 = true) {
    return `<label class="${col2 ? "cfg-col2" : ""}">${label}
      <input id="${id}" value="${escapar(val(clave))}" placeholder="${placeholder}" /></label>`;
  }

  function subNegocio() {
    wrap.innerHTML = `${cabeceraSub("Datos del negocio")}
      <section class="cfg-seccion"><div class="cfg-grid">
        ${campoTexto("f-nombre", "Nombre del negocio *", "negocio_nombre")}
        ${campoTexto("f-dir", "Dirección", "negocio_direccion", "Calle, número, colonia")}
        ${campoTexto("f-tel", "Teléfono", "negocio_telefono", "Opcional", false)}
      </div></section>`;
    conectarVolver();
    wrap.querySelector("#sub-guardar").addEventListener("click", () => {
      const nombre = wrap.querySelector("#f-nombre").value.trim();
      if (!nombre) { wrap.querySelector("#sub-error").textContent = "El nombre es obligatorio."; return; }
      guardarClaves({
        negocio_nombre: nombre,
        negocio_direccion: wrap.querySelector("#f-dir").value.trim(),
        negocio_telefono: wrap.querySelector("#f-tel").value.trim(),
      });
    });
  }

  function subImpuestos() {
    const activo = val("impuesto_activo", "0") === "1";
    const nombre = val("impuesto_nombre", "") || "IVA";
    // Tasa guardada en puntos base (1600 = 16%); mostramos como %.
    const tasaBase = parseInt(val("impuesto_tasa", "0"), 10) || 0;
    const tasaPct = (tasaBase / 100).toString();

    wrap.innerHTML = `${cabeceraSub("Impuestos")}
      <section class="cfg-seccion">
        <p class="cfg-seccion-sub">Configura el impuesto sobre las ventas (IVA, IEPS, Sales Tax, etc.). Si no lo necesitas, déjalo desactivado y vende a tus precios tal cual.</p>

        <label class="cfg-toggle cfg-imp-switch">
          <input type="checkbox" id="imp-activo" ${activo ? "checked" : ""} />
          <span>Aplicar impuesto a las ventas</span>
        </label>

        <div id="imp-detalle" class="${activo ? "" : "cfg-imp-oculto"}">
          <div class="cfg-grid">
            <label class="cfg-campo">
              <span>Nombre del impuesto</span>
              <input type="text" id="imp-nombre" value="${escapar(nombre)}" placeholder="IVA, Impuesto, Sales Tax…" />
            </label>
            <label class="cfg-campo">
              <span>Tasa (%)</span>
              <input type="number" id="imp-tasa" step="0.01" min="0" max="100" value="${tasaPct}" placeholder="16" />
            </label>
          </div>

          <div class="cfg-imp-info">
            <span class="cfg-imp-info-ico">ℹ️</span>
            <p>El impuesto está <strong>incluido en el precio</strong>: el precio que pones es el precio final que paga el cliente, y el impuesto se desglosa en el ticket. Así funciona en México, Latinoamérica y Europa.</p>
          </div>
        </div>
      </section>`;
    conectarVolver();

    const chkActivo = wrap.querySelector("#imp-activo");
    const detalle = wrap.querySelector("#imp-detalle");
    chkActivo.addEventListener("change", () => {
      detalle.classList.toggle("cfg-imp-oculto", !chkActivo.checked);
    });

    wrap.querySelector("#sub-guardar").addEventListener("click", () => {
      const act = chkActivo.checked;
      const claves = { impuesto_activo: act ? "1" : "0" };
      if (act) {
        const nom = wrap.querySelector("#imp-nombre").value.trim() || "IVA";
        const pct = parseFloat(wrap.querySelector("#imp-tasa").value) || 0;
        if (pct < 0 || pct > 100) {
          wrap.querySelector("#sub-error").textContent = "La tasa debe estar entre 0 y 100%.";
          return;
        }
        // Guardar tasa en puntos base (16% -> 1600). Modo siempre "incluido".
        claves.impuesto_nombre = nom;
        claves.impuesto_tasa = String(Math.round(pct * 100));
        claves.impuesto_modo = "incluido";
      }
      guardarClaves(claves);
    });
  }

  function subFiscal() {
    wrap.innerHTML = `${cabeceraSub("Datos fiscales")}
      <section class="cfg-seccion">
        <p class="cfg-seccion-sub">Para la facturación CFDI (próximamente). Puedes dejarlos vacíos.</p>
        <div class="cfg-grid">
          ${campoTexto("f-rfc", "RFC", "negocio_rfc", "Opcional", false)}
          ${campoTexto("f-cp", "Código postal", "negocio_codigo_postal", "Opcional", false)}
          ${campoTexto("f-reg", "Régimen fiscal", "negocio_regimen_fiscal", "Opcional")}
        </div></section>`;
    conectarVolver();
    wrap.querySelector("#sub-guardar").addEventListener("click", () => guardarClaves({
      negocio_rfc: wrap.querySelector("#f-rfc").value.trim(),
      negocio_codigo_postal: wrap.querySelector("#f-cp").value.trim(),
      negocio_regimen_fiscal: wrap.querySelector("#f-reg").value.trim(),
    }));
  }

  function subMoneda() {
    const simbolo = val("moneda_simbolo", "$");
    const codigo = val("moneda_codigo", "MXN");
    wrap.innerHTML = `${cabeceraSub("Moneda")}
      <section class="cfg-seccion"><div class="cfg-grid">
        <label>Símbolo<input id="f-sim" value="${escapar(simbolo)}" placeholder="$" /></label>
        <label>Código<input id="f-cod" value="${escapar(codigo)}" placeholder="MXN" /></label>
      </div>
      <p class="cfg-nota">Ejemplos: $ MXN (México), € EUR (España), $ USD (EE.UU.).</p></section>`;
    conectarVolver();
    wrap.querySelector("#sub-guardar").addEventListener("click", () => guardarClaves({
      moneda_simbolo: wrap.querySelector("#f-sim").value.trim() || "$",
      moneda_codigo: wrap.querySelector("#f-cod").value.trim() || "MXN",
    }));
  }

  // ---------------------------------------------------- Dispositivos
  function subImpresora() {
    const disp = val("impresora_dispositivo");
    const modo = val("impresora_modo", "escpos");
    const fuente = val("impresora_fuente", "A");
    const columnas = val("impresora_columnas", "48");
    const cortar = val("impresora_cortar", "1");
    wrap.innerHTML = `${cabeceraSub("Impresora de tickets")}
      <section class="cfg-seccion">
        <p class="cfg-seccion-sub">Ajustes de la impresora. Se aplican al imprimir.</p>
        <div class="cfg-grid">
          <label class="cfg-col2">Modo de impresión
            <select id="f-modo">
              <option value="escpos" ${modo === "escpos" ? "selected" : ""}>Térmica directa (ESC/POS) — recomendado</option>
              <option value="sistema" ${modo === "sistema" ? "selected" : ""}>Sistema / Windows (sirve para PDF)</option>
            </select>
          </label>
          <label class="cfg-col2">Dispositivo de impresora
            <div class="cfg-impresora-fila">
              <input id="f-disp" value="${escapar(disp)}" placeholder="Ej: POS-58, EPSON TM-T20, Microsoft Print to PDF" />
              <button class="btn-sec" id="f-detectar" type="button">Detectar</button>
            </div>
            <span class="cfg-impresora-hint" id="f-hint"></span>
          </label>
          <label>Fuente de impresión
            <select id="f-fuente">
              <option value="A" ${fuente === "A" ? "selected" : ""}>Fuente A (normal)</option>
              <option value="B" ${fuente === "B" ? "selected" : ""}>Fuente B (pequeña)</option>
            </select>
          </label>
          <label>Columnas (ancho)
            <select id="f-col">
              <option value="32" ${columnas === "32" ? "selected" : ""}>32 (papel 58mm)</option>
              <option value="48" ${columnas === "48" ? "selected" : ""}>48 (papel 80mm)</option>
            </select>
          </label>
          <label class="cfg-toggle cfg-col2">
            <input type="checkbox" id="f-cortar" ${cortar === "1" ? "checked" : ""} />
            <span>Cortar papel automáticamente al terminar</span>
          </label>
        </div>
        <p class="cfg-nota" id="f-modo-nota"></p>
      </section>`;
    conectarVolver();

    const nota = wrap.querySelector("#f-modo-nota");
    const actualizarNota = () => {
      const m = wrap.querySelector("#f-modo").value;
      nota.textContent = m === "escpos"
        ? "Térmica directa: manda comandos ESC/POS a la impresora. Es lo óptimo para POS (corte de papel y cajón de dinero)."
        : "Sistema: usa el driver de Windows. Útil para imprimir a PDF o a impresoras normales, pero sin control fino del corte/cajón.";
    };
    actualizarNota();
    wrap.querySelector("#f-modo").addEventListener("change", actualizarNota);

    // Detectar impresoras instaladas en el sistema.
    wrap.querySelector("#f-detectar").addEventListener("click", async () => {
      const hint = wrap.querySelector("#f-hint");
      hint.textContent = "Buscando impresoras…";
      try {
        const mod = await import("tauri-plugin-thermal-printer");
        let lista = [];
        if (mod.list_thermal_printers) {
          lista = await mod.list_thermal_printers();
        }
        if (Array.isArray(lista) && lista.length > 0) {
          const nombres = lista.map((p) => p.name || p).join(", ");
          hint.textContent = "Detectadas: " + nombres;
        } else {
          hint.textContent = "No se detectaron impresoras. Escribe el nombre manualmente.";
        }
      } catch (e) {
        hint.textContent = "No se pudo detectar (plugin no disponible aún): " + e;
      }
    });

    wrap.querySelector("#sub-guardar").addEventListener("click", () => guardarClaves({
      impresora_modo: wrap.querySelector("#f-modo").value,
      impresora_dispositivo: wrap.querySelector("#f-disp").value.trim(),
      impresora_fuente: wrap.querySelector("#f-fuente").value,
      impresora_columnas: wrap.querySelector("#f-col").value,
      impresora_cortar: wrap.querySelector("#f-cortar").checked ? "1" : "0",
    }));
  }

  function subTicket() {
    wrap.innerHTML = `${cabeceraSub("Formato del ticket")}
      <section class="cfg-seccion"><div class="cfg-grid">
        ${campoTexto("f-enc", "Encabezado (sobre el nombre)", "ticket_encabezado", "Opcional")}
        ${campoTexto("f-pie", "Mensaje al pie", "mensaje_ticket", "¡Gracias por su compra!")}
        <label class="cfg-toggle cfg-col2">
          <input type="checkbox" id="f-mostrar-rfc" ${val("ticket_mostrar_rfc", "0") === "1" ? "checked" : ""} />
          <span>Mostrar RFC del negocio en el ticket</span>
        </label>
        <label class="cfg-toggle cfg-col2">
          <input type="checkbox" id="f-mostrar-tel" ${val("ticket_mostrar_telefono", "1") === "1" ? "checked" : ""} />
          <span>Mostrar teléfono en el ticket</span>
        </label>
      </div></section>`;
    conectarVolver();
    wrap.querySelector("#sub-guardar").addEventListener("click", () => guardarClaves({
      ticket_encabezado: wrap.querySelector("#f-enc").value.trim(),
      mensaje_ticket: wrap.querySelector("#f-pie").value.trim(),
      ticket_mostrar_rfc: wrap.querySelector("#f-mostrar-rfc").checked ? "1" : "0",
      ticket_mostrar_telefono: wrap.querySelector("#f-mostrar-tel").checked ? "1" : "0",
    }));
  }

  function subLector() {
    wrap.innerHTML = `${cabeceraSub("Lector de códigos")}
      <section class="cfg-seccion">
        <p class="cfg-seccion-sub">El lector de barras funciona como teclado: escanea un código en la pantalla de venta y se busca el producto automáticamente. No requiere configuración especial.</p>
        <div class="cfg-grid">
          <label class="cfg-toggle cfg-col2">
            <input type="checkbox" id="f-sonido" ${val("lector_sonido", "1") === "1" ? "checked" : ""} />
            <span>Sonido al escanear un producto</span>
          </label>
          <label>Sufijo del lector
            <select id="f-sufijo">
              <option value="enter" ${val("lector_sufijo", "enter") === "enter" ? "selected" : ""}>Enter (lo normal)</option>
              <option value="tab" ${val("lector_sufijo", "enter") === "tab" ? "selected" : ""}>Tabulador</option>
              <option value="ninguno" ${val("lector_sufijo", "enter") === "ninguno" ? "selected" : ""}>Ninguno</option>
            </select>
          </label>
        </div>
        <p class="cfg-nota">Si tu lector agrega Enter o Tab al final del código, indícalo aquí para que la búsqueda funcione bien.</p>
      </section>`;
    conectarVolver();
    wrap.querySelector("#sub-guardar").addEventListener("click", () => guardarClaves({
      lector_sonido: wrap.querySelector("#f-sonido").checked ? "1" : "0",
      lector_sufijo: wrap.querySelector("#f-sufijo").value,
    }));
  }

  function subCajon() {
    wrap.innerHTML = `${cabeceraSub("Cajón de dinero")}
      <section class="cfg-seccion">
        <p class="cfg-seccion-sub">El cajón se abre con un pulso que envía la impresora térmica al cobrar en efectivo.</p>
        <div class="cfg-grid">
          <label class="cfg-toggle cfg-col2">
            <input type="checkbox" id="f-abrir" ${val("cajon_abrir_efectivo", "1") === "1" ? "checked" : ""} />
            <span>Abrir el cajón automáticamente en ventas con efectivo</span>
          </label>
          <label>Pin de apertura
            <select id="f-pin">
              <option value="0" ${val("cajon_pin", "0") === "0" ? "selected" : ""}>Pin 2 (estándar)</option>
              <option value="1" ${val("cajon_pin", "0") === "1" ? "selected" : ""}>Pin 5</option>
            </select>
          </label>
        </div>
        <p class="cfg-nota">Requiere impresora con puerto para cajón (RJ11). El pin depende del modelo.</p>
      </section>`;
    conectarVolver();
    wrap.querySelector("#sub-guardar").addEventListener("click", () => guardarClaves({
      cajon_abrir_efectivo: wrap.querySelector("#f-abrir").checked ? "1" : "0",
      cajon_pin: wrap.querySelector("#f-pin").value,
    }));
  }

  function subBascula() {
    wrap.innerHTML = `${cabeceraSub("Báscula")}
      <section class="cfg-seccion">
        <p class="cfg-seccion-sub">Para vender productos por peso (a granel).</p>
        <div class="cfg-grid">
          <label class="cfg-toggle cfg-col2">
            <input type="checkbox" id="f-activa" ${val("bascula_activa", "0") === "1" ? "checked" : ""} />
            <span>Usar báscula conectada</span>
          </label>
          <label>Puerto
            <input id="f-puerto" value="${escapar(val("bascula_puerto", "COM1"))}" placeholder="COM1" />
          </label>
          <label>Velocidad (baudios)
            <select id="f-baud">
              ${["9600", "4800", "19200"].map((b) => `<option value="${b}" ${val("bascula_baudios", "9600") === b ? "selected" : ""}>${b}</option>`).join("")}
            </select>
          </label>
        </div>
        <p class="cfg-nota">El modelo de báscula define el puerto y la velocidad. Consulta su manual.</p>
      </section>`;
    conectarVolver();
    wrap.querySelector("#sub-guardar").addEventListener("click", () => guardarClaves({
      bascula_activa: wrap.querySelector("#f-activa").checked ? "1" : "0",
      bascula_puerto: wrap.querySelector("#f-puerto").value.trim() || "COM1",
      bascula_baudios: wrap.querySelector("#f-baud").value,
    }));
  }

  // ---------------------------------------------------- Personalización
  function subTema() {
    // Estado local: parte de lo guardado (o predeterminados de apariencia.js).
    let tema = valorApariencia(cfg, "apariencia_tema");
    let acento = valorApariencia(cfg, "apariencia_acento");
    let densidad = valorApariencia(cfg, "apariencia_densidad");
    let forma = valorApariencia(cfg, "apariencia_forma");

    const nombresTema = { nocturno: "Nocturno", amanecer: "Amanecer", brisa: "Brisa" };
    const almaTema = { nocturno: "Oscuro y enfocado", amanecer: "Claro y cálido", brisa: "Claro y suave" };

    function pintar() {
      wrap.innerHTML = `${cabeceraSub("Apariencia", false)}
        <section class="cfg-seccion">
          <p class="cfg-seccion-sub">Tema</p>
          <div class="onb-temas">
            ${TEMAS.map((t) => `
              <button type="button" class="onb-tema ${t === tema ? "onb-tema--activo" : ""}" data-tema="${t}">
                <div class="onb-tema-preview onb-tema-preview--${t}">
                  <div class="onb-tema-barra"></div>
                  <div class="onb-tema-punto" style="background:${hexAcento(acento, t)}"></div>
                </div>
                <div class="onb-tema-nombre">${nombresTema[t]}</div>
                <div class="onb-tema-alma">${almaTema[t]}</div>
              </button>`).join("")}
          </div>

          <div class="onb-acento-zona">
            <span class="onb-acento-lbl">Color de acento</span>
            <div class="onb-acentos">
              ${ACENTOS.map((a) => `
                <button type="button" class="onb-acento ${a.id === acento ? "onb-acento--activo" : ""}"
                  data-acento="${a.id}" title="${a.nombre}"
                  style="background:${hexAcento(a.id, tema)}"></button>`).join("")}
            </div>
          </div>

          <div class="cfg-aprc-fila">
            <div>
              <span class="onb-acento-lbl">Densidad</span>
              <div class="cfg-segmento">
                <button type="button" data-densidad="comoda" class="${densidad === "comoda" ? "cfg-seg--activo" : ""}">Cómoda</button>
                <button type="button" data-densidad="compacta" class="${densidad === "compacta" ? "cfg-seg--activo" : ""}">Compacta</button>
              </div>
            </div>
            <div>
              <span class="onb-acento-lbl">Bordes</span>
              <div class="cfg-segmento">
                <button type="button" data-forma="suave" class="${forma === "suave" ? "cfg-seg--activo" : ""}">Suaves</button>
                <button type="button" data-forma="recta" class="${forma === "recta" ? "cfg-seg--activo" : ""}">Rectos</button>
              </div>
            </div>
          </div>
          <p id="sub-ok" class="cfg-ok" hidden>Guardado ✓</p>
        </section>`;
      conectarVolver();

      const aplicar = () => aplicarApariencia({
        apariencia_tema: tema, apariencia_acento: acento,
        apariencia_densidad: densidad, apariencia_forma: forma,
      });

      wrap.querySelectorAll("[data-tema]").forEach((b) =>
        b.addEventListener("click", () => { tema = b.dataset.tema; aplicar(); persistir(); pintar(); }));
      wrap.querySelectorAll("[data-acento]").forEach((b) =>
        b.addEventListener("click", () => { acento = b.dataset.acento; aplicar(); persistir(); pintar(); }));
      wrap.querySelectorAll("[data-densidad]").forEach((b) =>
        b.addEventListener("click", () => { densidad = b.dataset.densidad; aplicar(); persistir(); pintar(); }));
      wrap.querySelectorAll("[data-forma]").forEach((b) =>
        b.addEventListener("click", () => { forma = b.dataset.forma; aplicar(); persistir(); pintar(); }));
    }

    // Guarda en config (silencioso; la apariencia ya se aplicó en vivo).
    async function persistir() {
      await guardarClaves({
        apariencia_tema: tema, apariencia_acento: acento,
        apariencia_densidad: densidad, apariencia_forma: forma,
      });
    }

    pintar();
  }

  function subZona() {
    const auto = detectarZonaSO();
    let seleccionada = val("zona_horaria", "") || auto;

    // Todas las zonas IANA que conoce el navegador (~400, de todo el mundo).
    let todas = [];
    try {
      todas = (Intl.supportedValuesOf && Intl.supportedValuesOf("timeZone")) || [];
    } catch (_) { todas = []; }
    // Respaldo mínimo por si el navegador no soporta supportedValuesOf.
    if (!todas.length) {
      todas = [auto, "America/Mazatlan", "America/Mexico_City", "America/New_York",
               "America/Los_Angeles", "Europe/Madrid", "UTC"];
    }

    // Formatea una zona a algo legible: "America/Mazatlan" -> "Mazatlán  ·  UTC-07:00"
    function etiqueta(tz) {
      const ciudad = tz.split("/").pop().replace(/_/g, " ");
      let off = "";
      try {
        const s = new Intl.DateTimeFormat("es", { timeZone: tz, timeZoneName: "shortOffset" })
          .formatToParts(new Date()).find((p) => p.type === "timeZoneName");
        off = s ? s.value.replace("GMT", "UTC") : "";
      } catch (_) {}
      const region = tz.includes("/") ? tz.split("/")[0].replace(/_/g, " ") : "";
      return { ciudad, region, off, tz };
    }

    wrap.innerHTML = `${cabeceraSub("Zona horaria", false)}
      <section class="cfg-seccion">
        <p class="cfg-seccion-sub">
          Se usa para que los cortes y reportes del "día" coincidan con el día
          real de tu tienda.
        </p>
        <div class="cfg-zona-sel">
          <div class="cfg-zona-actual" id="cfg-zona-actual"></div>
          <div class="cfg-zona-buscador">
            <input type="text" id="cfg-zona-input" placeholder="Busca tu ciudad o país… (ej. Mazatlán, Madrid, Tokyo)"
                   autocomplete="off" />
            <ul class="cfg-zona-lista" id="cfg-zona-lista" hidden></ul>
          </div>
        </div>
        <p id="sub-ok" class="cfg-ok" hidden>Guardado ✓</p>
      </section>`;
    conectarVolver();

    const cajaActual = wrap.querySelector("#cfg-zona-actual");
    const input = wrap.querySelector("#cfg-zona-input");
    const lista = wrap.querySelector("#cfg-zona-lista");

    function pintarActual() {
      const e = etiqueta(seleccionada);
      const esAuto = seleccionada === auto;
      cajaActual.innerHTML = `
        <div class="cfg-zona-chip">
          <div class="cfg-zona-chip-txt">
            <strong>${escapar(e.ciudad)}</strong>
            <span>${escapar(e.region)}${e.off ? " · " + escapar(e.off) : ""}</span>
          </div>
          ${esAuto ? '<span class="cfg-zona-badge">Automática</span>' : ""}
        </div>
        ${!esAuto ? `<button type="button" class="cfg-zona-auto" id="cfg-zona-usar-auto">Usar la de este equipo (${escapar(etiqueta(auto).ciudad)})</button>` : ""}`;
      const btnAuto = cajaActual.querySelector("#cfg-zona-usar-auto");
      if (btnAuto) btnAuto.addEventListener("click", () => elegir(auto));
    }

    function elegir(tz) {
      seleccionada = tz;
      guardarClaves({ zona_horaria: tz });
      input.value = "";
      lista.hidden = true;
      pintarActual();
    }

    function buscar(q) {
      q = q.trim().toLowerCase();
      if (!q) { lista.hidden = true; return; }
      // Coincidencia por ciudad, región o texto completo. Prioriza inicio.
      const res = todas
        .map(etiqueta)
        .filter((e) =>
          e.tz.toLowerCase().includes(q) ||
          e.ciudad.toLowerCase().includes(q) ||
          e.region.toLowerCase().includes(q))
        .sort((a, b) => {
          const ap = a.ciudad.toLowerCase().startsWith(q) ? 0 : 1;
          const bp = b.ciudad.toLowerCase().startsWith(q) ? 0 : 1;
          return ap - bp || a.ciudad.localeCompare(b.ciudad);
        })
        .slice(0, 40);

      if (!res.length) {
        lista.innerHTML = '<li class="cfg-zona-vacio">Sin resultados</li>';
        lista.hidden = false;
        return;
      }
      lista.innerHTML = res.map((e) => `
        <li class="cfg-zona-item" data-tz="${escapar(e.tz)}">
          <span class="cfg-zona-item-ciudad">${escapar(e.ciudad)}</span>
          <span class="cfg-zona-item-meta">${escapar(e.region)}${e.off ? " · " + escapar(e.off) : ""}</span>
        </li>`).join("");
      lista.hidden = false;
      lista.querySelectorAll(".cfg-zona-item").forEach((li) =>
        li.addEventListener("click", () => elegir(li.dataset.tz)));
    }

    input.addEventListener("input", () => buscar(input.value));
    input.addEventListener("focus", () => { if (input.value) buscar(input.value); });
    // Cerrar la lista al hacer clic fuera.
    document.addEventListener("click", (ev) => {
      if (!wrap.querySelector(".cfg-zona-buscador")?.contains(ev.target)) lista.hidden = true;
    });

    pintarActual();
  }

  function subFormasPago() {
    // Las activas se guardan como CSV en config "formas_pago_activas".
    const activasStr = val("formas_pago_activas", "efectivo,tarjeta,transferencia,credito");
    const activas = new Set(activasStr.split(",").filter(Boolean));
    wrap.innerHTML = `${cabeceraSub("Formas de pago")}
      <section class="cfg-seccion">
        <p class="cfg-seccion-sub">Activa los métodos de pago que aceptas. Efectivo siempre está disponible.</p>
        <div class="cfg-pagos">
          ${METODOS_PAGO.map((m) => `
            <label class="cfg-toggle">
              <input type="checkbox" data-metodo="${m.id}" ${activas.has(m.id) || m.fijo ? "checked" : ""} ${m.fijo ? "disabled" : ""} />
              <span>${m.nombre}${m.fijo ? " (siempre activo)" : ""}</span>
            </label>`).join("")}
        </div>
      </section>`;
    conectarVolver();
    wrap.querySelector("#sub-guardar").addEventListener("click", () => {
      const sel = ["efectivo"];
      wrap.querySelectorAll("[data-metodo]").forEach((c) => {
        if (c.checked && c.dataset.metodo !== "efectivo") sel.push(c.dataset.metodo);
      });
      guardarClaves({ formas_pago_activas: sel.join(",") });
    });
  }

  // ---------------------------------------------------- Sistema
  function subRespaldo() {
    wrap.innerHTML = `${cabeceraSub("Respaldo y restauración", false)}
      <section class="cfg-seccion">
        <p class="cfg-seccion-sub">Tu información se guarda en este equipo. Un respaldo crea una copia de toda tu base de datos que puedes guardar en otro lugar (USB, nube) o usar para mover tu negocio a otra computadora.</p>

        <div class="cfg-respaldo-bloque">
          <h3>Crear respaldo</h3>
          <p>Guarda una copia completa de tu negocio: productos, inventario, ventas, clientes y configuración.</p>
          <button class="btn-primario" id="r-crear">💾 Crear respaldo ahora</button>
        </div>

        <div class="cfg-respaldo-bloque cfg-respaldo-peligro">
          <h3>Restaurar desde un respaldo</h3>
          <p>Reemplaza <strong>toda</strong> tu información actual con la de un archivo de respaldo. Antes de hacerlo, se guardará automáticamente una copia de seguridad de lo que tienes ahora.</p>
          <p class="cfg-respaldo-warn">⚠️ Esta acción reemplaza todos tus datos actuales y no se puede deshacer fácilmente.</p>
          <button class="btn-sec" id="r-restaurar">Restaurar desde archivo…</button>
        </div>

        <p class="m-error" id="sub-error"></p>
        <p class="cfg-ok" id="sub-ok" hidden></p>
      </section>`;
    conectarVolver();

    wrap.querySelector("#r-crear").addEventListener("click", crearRespaldo);
    wrap.querySelector("#r-restaurar").addEventListener("click", iniciarRestauracion);

    async function crearRespaldo() {
      const err = wrap.querySelector("#sub-error");
      const ok = wrap.querySelector("#sub-ok");
      err.textContent = "";
      ok.hidden = true;
      try {
        const dialog = await import("@tauri-apps/plugin-dialog");
        const fecha = new Date().toISOString().slice(0, 10);
        const ruta = await dialog.save({
          defaultPath: `respaldo_yvexpos_${fecha}.sqlite`,
          filters: [{ name: "Respaldo YvexPOS", extensions: ["sqlite"] }],
        });
        if (!ruta) return;
        await invoke("respaldo_completo", { rutaDestino: ruta, rol: sesion.rol });
        await guardarClaves({ respaldo_ultimo: new Date().toISOString() });
        ok.textContent = `✓ Respaldo guardado en ${ruta}`;
        ok.hidden = false;
      } catch (e) {
        err.textContent = "Error al crear el respaldo: " + e;
      }
    }

    async function iniciarRestauracion() {
      const err = wrap.querySelector("#sub-error");
      err.textContent = "";
      try {
        const dialog = await import("@tauri-apps/plugin-dialog");
        const ruta = await dialog.open({
          multiple: false,
          filters: [{ name: "Respaldo YvexPOS", extensions: ["sqlite"] }],
        });
        if (!ruta) return;
        // Validar el archivo antes de pedir confirmación.
        await invoke("restaurar_validar", { ruta });
        pantallaConfirmarRestauracion(ruta);
      } catch (e) {
        err.textContent = "No se puede restaurar este archivo: " + e;
      }
    }

    function pantallaConfirmarRestauracion(ruta) {
      wrap.innerHTML = `${cabeceraSub("Confirmar restauración", false)}
        <section class="cfg-seccion">
          <div class="cfg-restaurar-aviso">
            <span class="cfg-restaurar-ico">⚠️</span>
            <div>
              <strong>Estás a punto de reemplazar todos tus datos</strong>
              <p>Toda tu información actual (productos, ventas, inventario, clientes) será reemplazada por la del respaldo seleccionado. Se guardará una copia de seguridad de tus datos actuales por si acaso.</p>
              <p class="cfg-restaurar-archivo">Archivo: ${escapar(ruta)}</p>
            </div>
          </div>
          <p class="cfg-restaurar-instruccion">Para confirmar, escribe <strong>RESTAURAR</strong> en el campo:</p>
          <input type="text" id="r-confirm-input" class="cfg-restaurar-input" placeholder="Escribe RESTAURAR" autocomplete="off" />
          <div class="cfg-restaurar-acciones">
            <button class="btn-sec" id="r-cancelar">Cancelar</button>
            <button class="btn-peligro" id="r-ejecutar" disabled>Restaurar ahora</button>
          </div>
          <p class="m-error" id="r-error"></p>
        </section>`;
      wrap.querySelector("#sub-volver").addEventListener("click", subRespaldo);

      const input = wrap.querySelector("#r-confirm-input");
      const btn = wrap.querySelector("#r-ejecutar");
      input.addEventListener("input", () => {
        btn.disabled = input.value.trim().toUpperCase() !== "RESTAURAR";
      });
      input.focus();

      wrap.querySelector("#r-cancelar").addEventListener("click", subRespaldo);
      btn.addEventListener("click", () => ejecutarRestauracion(ruta));
    }

    async function ejecutarRestauracion(ruta) {
      const err = wrap.querySelector("#r-error");
      const btn = wrap.querySelector("#r-ejecutar");
      err.textContent = "";
      btn.disabled = true;
      btn.textContent = "Restaurando…";
      try {
        const respaldoSeg = await invoke("restaurar_ejecutar", {
          rutaRespaldo: ruta,
          rol: sesion.rol,
        });
        pantallaRestauracionLista(respaldoSeg);
      } catch (e) {
        err.textContent = String(e);
        btn.disabled = false;
        btn.textContent = "Restaurar ahora";
      }
    }

    function pantallaRestauracionLista(respaldoSeg) {
      wrap.innerHTML = `${cabeceraSub("Restauración completada", false)}
        <section class="cfg-seccion">
          <div class="dif-ok">
            <div class="exito-check">✓</div>
            <h2>Datos restaurados</h2>
            <p>Tu base de datos se restauró correctamente.</p>
            <p class="cfg-restaurar-seg">Se guardó una copia de tus datos anteriores en:<br><span>${escapar(respaldoSeg)}</span></p>
            <p class="cfg-restaurar-reinicio">La aplicación debe reiniciarse para cargar la información restaurada.</p>
            <button class="btn-primario" id="r-reiniciar">Reiniciar ahora</button>
          </div>
        </section>`;
      // Quitar el botón volver (no tiene sentido aquí).
      const volver = wrap.querySelector("#sub-volver");
      if (volver) volver.style.visibility = "hidden";
      wrap.querySelector("#r-reiniciar").addEventListener("click", () => {
        invoke("reiniciar_app");
      });
    }
  }

  // ---------------------------------------------------- Cajeros y usuarios
  async function subUsuarios() {
    wrap.innerHTML = `${cabeceraSub("Cajeros y usuarios", false)}
      <section class="cfg-seccion">
        <div class="cfg-usuarios-head">
          <p class="cfg-seccion-sub" style="margin:0">Gestiona quién puede usar el sistema y con qué permisos.</p>
          <button class="btn-primario" id="u-nuevo">+ Usuario</button>
        </div>
        <div id="u-lista"><div class="inv-vacio">Cargando…</div></div>
        <p class="m-error" id="sub-error"></p>
      </section>`;
    conectarVolver();
    wrap.querySelector("#u-nuevo").addEventListener("click", () => modalUsuario(null));
    await cargarUsuarios();
  }

  async function cargarUsuarios() {
    let usuarios = [];
    try {
      usuarios = await invoke("listar_usuarios");
    } catch (e) {
      wrap.querySelector("#u-lista").innerHTML = '<div class="inv-vacio">Error: ' + escapar(String(e)) + "</div>";
      return;
    }
    const colorRol = { dueno: "var(--morado)", gerente: "#3b82f6", cajero: "#14b8a6" };
    const etqRol = { dueno: "Dueño", gerente: "Gerente", cajero: "Cajero" };
    wrap.querySelector("#u-lista").innerHTML = `
      <div class="cfg-usuarios-grid">
        ${usuarios.map((u) => `
          <div class="cfg-usuario-card">
            <div class="cfg-usuario-avatar" style="background:${colorRol[u.rol] || "#666"}">${escapar(u.nombre[0] || "?")}</div>
            <div class="cfg-usuario-info">
              <span class="cfg-usuario-nombre">${escapar(u.nombre)}</span>
              <span class="cfg-usuario-rol">${etqRol[u.rol] || u.rol}</span>
            </div>
            <button class="btn-mini" data-editar="${u.id}">Editar</button>
          </div>`).join("")}
      </div>`;
    wrap.querySelectorAll("[data-editar]").forEach((b) =>
      b.addEventListener("click", () => {
        const u = usuarios.find((x) => x.id === b.dataset.editar);
        modalUsuario(u);
      }));
  }

  function modalUsuario(usuario) {
    const esEdicion = !!usuario;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2>${esEdicion ? "Editar usuario" : "Nuevo usuario"}</h2>
        <div class="cfg-grid">
          <label class="cfg-col2">Nombre
            <input id="um-nombre" value="${esEdicion ? escapar(usuario.nombre) : ""}" />
          </label>
          <label class="cfg-col2">Rol
            <select id="um-rol">
              <option value="cajero" ${esEdicion && usuario.rol === "cajero" ? "selected" : ""}>Cajero</option>
              <option value="gerente" ${esEdicion && usuario.rol === "gerente" ? "selected" : ""}>Gerente</option>
              <option value="dueno" ${esEdicion && usuario.rol === "dueno" ? "selected" : ""}>Dueño</option>
            </select>
          </label>
          <label class="cfg-col2">${esEdicion ? "PIN nuevo (dejar vacío para conservar)" : "PIN (4 a 6 dígitos)"}
            <input id="um-pin" inputmode="numeric" maxlength="6" placeholder="••••" />
          </label>
        </div>
        <p class="m-error" id="um-error"></p>
        <div class="m-acciones">
          ${esEdicion ? '<button class="btn-peligro" id="um-eliminar">Eliminar</button>' : "<span></span>"}
          <div>
            <button class="btn-sec" id="um-cancelar">Cancelar</button>
            <button class="btn-primario" id="um-guardar">${esEdicion ? "Guardar" : "Crear"}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const q = (s) => overlay.querySelector(s);
    const cerrar = () => overlay.remove();
    q("#um-cancelar").addEventListener("click", cerrar);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) cerrar(); });
    setTimeout(() => q("#um-nombre").focus(), 50);

    if (esEdicion) {
      q("#um-eliminar").addEventListener("click", async () => {
        if (!confirm(`¿Eliminar a ${usuario.nombre}?`)) return;
        try {
          await invoke("usuario_eliminar", { id: usuario.id, rol: sesion.rol });
          cerrar();
          cargarUsuarios();
        } catch (e) { q("#um-error").textContent = String(e); }
      });
    }

    q("#um-guardar").addEventListener("click", async () => {
      const err = q("#um-error");
      err.textContent = "";
      const nombre = q("#um-nombre").value.trim();
      const rolNuevo = q("#um-rol").value;
      const pin = q("#um-pin").value.trim();
      if (!nombre) { err.textContent = "El nombre es obligatorio."; return; }
      if (!esEdicion && !/^\d{4,6}$/.test(pin)) { err.textContent = "El PIN debe ser de 4 a 6 dígitos."; return; }
      if (pin && !/^\d{4,6}$/.test(pin)) { err.textContent = "El PIN debe ser de 4 a 6 dígitos."; return; }
      try {
        if (esEdicion) {
          await invoke("usuario_editar", { datos: { id: usuario.id, nombre, rol: rolNuevo, pin: pin || null }, rol: sesion.rol });
        } else {
          await invoke("usuario_crear", { datos: { nombre, pin, rol: rolNuevo }, rol: sesion.rol });
        }
        cerrar();
        cargarUsuarios();
      } catch (e) { err.textContent = String(e); }
    });
  }
  // ---------------------------------------------------- Hub de importación
  function subImportarHub() {
    wrap.innerHTML = `${cabeceraSub("Importar datos a YvexPOS", false)}
      <section class="cfg-seccion">
        <p class="cfg-seccion-sub">Trae tu información a YvexPOS sin recapturar nada. Elige según cómo tengas tus datos hoy.</p>

        <button class="cfg-imp-opcion cfg-imp-recomendada" id="imp-op-pos">
          <div class="cfg-imp-op-head">
            <span class="cfg-imp-op-ico">🗄️</span>
            <div>
              <span class="cfg-imp-op-titulo">Desde otro punto de venta <span class="cfg-imp-badge">recomendado</span></span>
              <span class="cfg-imp-op-desc">Si vienes de otro POS (como Eleventa), importa su base de datos completa: productos, categorías, clientes y ventas.</span>
            </div>
          </div>
        </button>

        <button class="cfg-imp-opcion" id="imp-op-excel">
          <div class="cfg-imp-op-head">
            <span class="cfg-imp-op-ico">📄</span>
            <div>
              <span class="cfg-imp-op-titulo">Desde Excel / hoja de cálculo</span>
              <span class="cfg-imp-op-desc">Si tienes tu catálogo de productos en Excel, cárgalo desde un archivo CSV.</span>
            </div>
          </div>
        </button>

        <div class="cfg-imp-tutorial">
          <h3>¿Cómo obtengo la base de datos de mi POS anterior?</h3>
          <p>La mayoría de los puntos de venta permiten exportar o respaldar su base de datos. El archivo suele tener extensión <code>.fdb</code> o <code>.gdb</code>.</p>
          <p><strong>Por ejemplo, en Eleventa:</strong> entra a Configuración → Base de datos → Exportar/Respaldar base de datos → guárdala en una carpeta que recuerdes. Luego selecciona ese archivo aquí con la primera opción.</p>
          <p class="cfg-imp-tutorial-nota">El proceso es parecido en otros sistemas: busca una opción de "respaldo", "backup" o "exportar base de datos" en su configuración.</p>
        </div>
      </section>`;
    conectarVolver();
    wrap.querySelector("#imp-op-pos").addEventListener("click", subImportar);
    wrap.querySelector("#imp-op-excel").addEventListener("click", subImportarExcel);
  }

  // ---------------------------------------------------- Importar de otro POS
  function subImportar() {
    wrap.innerHTML = `${cabeceraSub("Importar desde otro POS", false)}
      <section class="cfg-seccion">
        <p class="cfg-seccion-sub">Migra tu catálogo, clientes y ventas desde tu punto de venta anterior sin recapturar nada. Solo selecciona el archivo de tu base de datos.</p>
        <div class="cfg-import-paso">
          <h3>1. Selecciona el archivo de tu base de datos (.fdb)</h3>
          <button class="btn-primario" id="imp-seleccionar">Seleccionar archivo…</button>
          <p class="cfg-import-ruta" id="imp-ruta"></p>
          <p class="cfg-import-hint">Es el archivo donde tu POS anterior guarda la información (normalmente <code>PDVDATA.fdb</code>). Asegúrate de que ese programa esté cerrado.</p>
        </div>
        <div id="imp-preview"></div>
        <p class="m-error" id="imp-error"></p>
      </section>`;
    conectarVolver(subImportarHub);

    let rutaFdb = null;

    wrap.querySelector("#imp-seleccionar").addEventListener("click", seleccionar);

    async function seleccionar() {
      const err = wrap.querySelector("#imp-error");
      err.textContent = "";
      try {
        // Diálogo nativo de Tauri para elegir el .fdb.
        const dialog = await import("@tauri-apps/plugin-dialog");
        const ruta = await dialog.open({
          multiple: false,
          filters: [{ name: "Base de datos de POS", extensions: ["fdb", "FDB"] }],
        });
        if (!ruta) return;
        rutaFdb = ruta;
        wrap.querySelector("#imp-ruta").textContent = "Archivo: " + ruta;
        // Previsualizar (leer el FDB y contar).
        wrap.querySelector("#imp-preview").innerHTML = '<p class="cfg-import-detectado">Leyendo base de datos…</p>';
        const conteo = await invoke("fdb_previsualizar", { ruta });
        mostrarPreview(conteo);
      } catch (ex) {
        err.textContent = "No se pudo leer la base: " + ex;
        wrap.querySelector("#imp-preview").innerHTML = "";
        rutaFdb = null;
      }
    }

    function mostrarPreview(c) {
      const prev = wrap.querySelector("#imp-preview");
      prev.innerHTML = `
        <div class="cfg-import-paso">
          <h3>2. Elige qué importar</h3>
          <p class="cfg-import-detectado">Detectado en tu base de datos:</p>
          <label class="cfg-toggle">
            <input type="checkbox" id="imp-productos" checked />
            <span><strong>${c.productos}</strong> productos y <strong>${c.categorias}</strong> categorías</span>
          </label>
          <label class="cfg-toggle">
            <input type="checkbox" id="imp-clientes" checked />
            <span><strong>${c.clientes}</strong> clientes</span>
          </label>
          <label class="cfg-toggle">
            <input type="checkbox" id="imp-ventas" />
            <span><strong>${c.ventas.toLocaleString("es-MX")}</strong> ventas históricas (para análisis con Diego)</span>
          </label>
          <p class="cfg-import-aviso">⚠️ Las ventas históricas solo conservan su detalle si también importas los productos. Importar muchas ventas puede tardar.</p>
          <button class="btn-primario" id="imp-ejecutar">Importar ahora</button>
        </div>`;
      prev.querySelector("#imp-ejecutar").addEventListener("click", ejecutar);
    }

    async function ejecutar() {
      const err = wrap.querySelector("#imp-error");
      err.textContent = "";
      const opciones = {
        importar_productos: wrap.querySelector("#imp-productos").checked,
        importar_clientes: wrap.querySelector("#imp-clientes").checked,
        importar_ventas: wrap.querySelector("#imp-ventas").checked,
      };
      if (!opciones.importar_productos && !opciones.importar_clientes && !opciones.importar_ventas) {
        err.textContent = "Elige al menos una cosa para importar.";
        return;
      }
      const btn = wrap.querySelector("#imp-ejecutar");
      btn.disabled = true;
      btn.textContent = "Importando… (puede tardar)";
      try {
        const r = await invoke("fdb_importar", { ruta: rutaFdb, opciones, rol: sesion.rol });
        mostrarResultado(r);
      } catch (ex) {
        err.textContent = String(ex);
        btn.disabled = false;
        btn.textContent = "Importar ahora";
      }
    }

    function mostrarResultado(r) {
      const prev = wrap.querySelector("#imp-preview");
      const adv = r.advertencias && r.advertencias.length
        ? `<p class="cfg-import-advertencias">${r.advertencias.length} advertencia(s): ${escapar(r.advertencias.slice(0, 5).join("; "))}${r.advertencias.length > 5 ? "…" : ""}</p>`
        : "";
      prev.innerHTML = `
        <div class="cfg-import-resultado">
          <div class="exito-check">✓</div>
          <h3>Importación completada</h3>
          <ul class="cfg-import-lista">
            <li>${r.categorias_creadas} categorías creadas${r.categorias_unificadas ? ` (${r.categorias_unificadas} unificadas)` : ""}</li>
            <li>${r.productos_creados} productos importados${r.productos_omitidos ? ` (${r.productos_omitidos} omitidos)` : ""}</li>
            <li>${r.clientes_creados} clientes importados</li>
            <li>${r.ventas_creadas.toLocaleString("es-MX")} ventas históricas</li>
          </ul>
          ${adv}
          <button class="btn-primario" id="imp-fin">Listo</button>
        </div>`;
      wrap.querySelector("#imp-fin").addEventListener("click", renderHub);
    }
  }

  // ---------------------------------------------------- Exportar datos
  function subExportar() {
    wrap.innerHTML = `${cabeceraSub("Exportar datos", false)}
      <section class="cfg-seccion">
        <p class="cfg-seccion-sub">Descarga tu información en formato CSV, que puedes abrir en Excel. Útil para respaldos, contabilidad o análisis.</p>
        <div class="cfg-export-grid">
          <button class="cfg-export-card" data-tipo="productos">
            <span class="cfg-export-ico">📦</span>
            <span class="cfg-export-nombre">Productos</span>
            <span class="cfg-export-desc">Catálogo completo con precios y costos</span>
          </button>
          <button class="cfg-export-card" data-tipo="inventario">
            <span class="cfg-export-ico">📋</span>
            <span class="cfg-export-nombre">Inventario</span>
            <span class="cfg-export-desc">Existencias y su valor a costo y venta</span>
          </button>
          <button class="cfg-export-card" data-tipo="ventas">
            <span class="cfg-export-ico">🧾</span>
            <span class="cfg-export-nombre">Ventas</span>
            <span class="cfg-export-desc">Historial de transacciones</span>
          </button>
        </div>

        <div class="cfg-export-completo">
          <h3>Respaldo completo</h3>
          <p>Guarda toda tu base de datos en un solo archivo: productos, inventario, ventas, clientes y configuración. Útil para tener una copia de seguridad o pasar tu negocio a otra computadora.</p>
          <button class="btn-sec" id="exp-completo">💾 Exportar base de datos completa</button>
        </div>

        <p class="m-error" id="exp-error"></p>
        <p class="cfg-export-ok" id="exp-ok"></p>
      </section>`;
    conectarVolver();

    wrap.querySelectorAll("[data-tipo]").forEach((b) =>
      b.addEventListener("click", () => exportar(b.dataset.tipo))
    );
    wrap.querySelector("#exp-completo").addEventListener("click", exportarCompleto);

    async function exportarCompleto() {
      const err = wrap.querySelector("#exp-error");
      const ok = wrap.querySelector("#exp-ok");
      err.textContent = "";
      ok.textContent = "";
      try {
        const dialog = await import("@tauri-apps/plugin-dialog");
        const fecha = new Date().toISOString().slice(0, 10);
        const ruta = await dialog.save({
          defaultPath: `respaldo_yvexpos_${fecha}.sqlite`,
          filters: [{ name: "Base de datos YvexPOS", extensions: ["sqlite"] }],
        });
        if (!ruta) return;
        await invoke("respaldo_completo", { rutaDestino: ruta, rol: sesion.rol });
        ok.textContent = `✓ Respaldo completo guardado en ${ruta}`;
      } catch (e) {
        err.textContent = "Error al crear el respaldo: " + e;
      }
    }

    async function exportar(tipo) {
      const err = wrap.querySelector("#exp-error");
      const ok = wrap.querySelector("#exp-ok");
      err.textContent = "";
      ok.textContent = "";
      try {
        const csv = await invoke("exportar_csv", { tipo, rol: sesion.rol });
        // Guardar con el diálogo nativo.
        const dialog = await import("@tauri-apps/plugin-dialog");
        const fecha = new Date().toISOString().slice(0, 10);
        const ruta = await dialog.save({
          defaultPath: `${tipo}_${fecha}.csv`,
          filters: [{ name: "CSV", extensions: ["csv"] }],
        });
        if (!ruta) return;
        const fs = await import("@tauri-apps/plugin-fs");
        await fs.writeTextFile(ruta, csv);
        ok.textContent = `✓ Exportado correctamente a ${ruta}`;
      } catch (e) {
        err.textContent = "Error al exportar: " + e;
      }
    }
  }

  // ---------------------------------------------------- Importar desde Excel (CSV)
  function subImportarExcel() {
    wrap.innerHTML = `${cabeceraSub("Importar desde Excel", false)}
      <section class="cfg-seccion">
        <p class="cfg-seccion-sub">Carga tus productos desde un archivo de Excel. Primero guarda tu hoja como CSV (en Excel: Archivo → Guardar como → CSV), luego selecciónala aquí.</p>
        <div class="cfg-import-paso">
          <h3>1. Selecciona tu archivo CSV</h3>
          <button class="btn-primario" id="xls-seleccionar">Seleccionar archivo…</button>
          <p class="cfg-import-ruta" id="xls-ruta"></p>
        </div>
        <div id="xls-mapeo"></div>
        <p class="m-error" id="xls-error"></p>
      </section>`;
    conectarVolver(subImportarHub);

    let contenidoCsv = null;
    let analisis = null;

    // Etiquetas amigables de los campos del POS.
    const ETIQUETAS = {
      nombre: "Nombre del producto",
      codigo: "Código de barras",
      precio: "Precio de venta",
      costo: "Costo",
      categoria: "Categoría / Departamento",
      stock: "Existencia / Stock",
      unidad: "Unidad",
    };

    wrap.querySelector("#xls-seleccionar").addEventListener("click", seleccionar);

    async function seleccionar() {
      const err = wrap.querySelector("#xls-error");
      err.textContent = "";
      try {
        const dialog = await import("@tauri-apps/plugin-dialog");
        const ruta = await dialog.open({
          multiple: false,
          filters: [{ name: "CSV", extensions: ["csv", "txt"] }],
        });
        if (!ruta) return;
        wrap.querySelector("#xls-ruta").textContent = "Archivo: " + ruta;
        const fs = await import("@tauri-apps/plugin-fs");
        contenidoCsv = await fs.readTextFile(ruta);
        analisis = await invoke("csv_analizar", { contenido: contenidoCsv });
        mostrarMapeo();
      } catch (e) {
        err.textContent = "No se pudo leer el archivo: " + e;
      }
    }

    function mostrarMapeo() {
      const cont = wrap.querySelector("#xls-mapeo");

      // Si el archivo no parece de productos, avisar de forma prominente.
      const aviso = !analisis.parece_productos
        ? `<div class="cfg-imp-alerta">
             <span class="cfg-imp-alerta-ico">⚠️</span>
             <div>
               <strong>Este archivo no parece ser de productos</strong>
               <p>${escapar(analisis.motivo_sospecha || "No se detectaron las columnas típicas de un catálogo de productos.")}</p>
               <p class="cfg-imp-alerta-nota">Recuerda: esta opción es solo para importar <strong>el catálogo de productos</strong> de tu inventario (con nombre, precio, etc.). Si te confundiste de archivo, vuelve atrás y selecciona el correcto. Si aun así quieres continuar, revisa el mapeo de abajo con cuidado.</p>
             </div>
           </div>`
        : "";
      // Para cada campo del POS, un selector de columna (con la detección preseleccionada).
      const opcionesCol = (sel) =>
        `<option value="">— ninguna —</option>` +
        analisis.encabezados.map((h, i) =>
          `<option value="${i}" ${sel === i ? "selected" : ""}>${escapar(h)}</option>`).join("");

      const filasMapeo = analisis.campos_pos.map((campo) => {
        const det = analisis.deteccion[campo];
        const detectado = det !== undefined;
        return `
          <div class="cfg-mapeo-fila">
            <label class="cfg-mapeo-campo">
              ${ETIQUETAS[campo] || campo}
              ${campo === "nombre" ? '<span class="cfg-mapeo-req">obligatorio</span>' : ""}
            </label>
            <select class="cfg-mapeo-sel" data-campo="${campo}">${opcionesCol(det)}</select>
            ${detectado ? '<span class="cfg-mapeo-auto">✓ detectado</span>' : '<span class="cfg-mapeo-no">sin detectar</span>'}
          </div>`;
      }).join("");

      // Vista previa de las primeras filas.
      const previa = `
        <div class="cfg-mapeo-previa">
          <table class="inv-tabla">
            <thead><tr>${analisis.encabezados.map((h) => `<th>${escapar(h)}</th>`).join("")}</tr></thead>
            <tbody>
              ${analisis.muestra.map((fila) => `<tr>${fila.map((c) => `<td>${escapar(c)}</td>`).join("")}</tr>`).join("")}
            </tbody>
          </table>
        </div>`;

      cont.innerHTML = `
        ${aviso}
        <div class="cfg-import-paso">
          <h3>2. Confirma qué columna es qué</h3>
          <p class="cfg-import-detectado">Detectamos automáticamente las columnas. Revisa y corrige si algo no cuadra.</p>
          <div class="cfg-mapeo-lista">${filasMapeo}</div>
        </div>
        <div class="cfg-import-paso">
          <h3>Vista previa</h3>
          <p class="cfg-import-detectado">${analisis.total_filas} fila(s) en el archivo. Primeras ${analisis.muestra.length}:</p>
          ${previa}
        </div>
        <button class="btn-primario ${analisis.parece_productos ? "" : "btn-alerta"}" id="xls-importar">${analisis.parece_productos ? `Importar ${analisis.total_filas} producto(s)` : "Importar de todos modos"}</button>
      `;
      cont.querySelector("#xls-importar").addEventListener("click", ejecutar);
    }

    async function ejecutar() {
      const err = wrap.querySelector("#xls-error");
      err.textContent = "";
      // Recoger el mapeo elegido.
      const mapa = {};
      wrap.querySelectorAll("[data-campo]").forEach((sel) => {
        if (sel.value !== "") mapa[sel.dataset.campo] = parseInt(sel.value, 10);
      });
      if (mapa.nombre === undefined) {
        err.textContent = "Debes indicar qué columna tiene el nombre del producto.";
        return;
      }
      const btn = wrap.querySelector("#xls-importar");
      btn.disabled = true;
      btn.textContent = "Importando…";
      try {
        const r = await invoke("csv_importar_productos", {
          contenido: contenidoCsv,
          mapeo: { mapa },
          rol: sesion.rol,
        });
        mostrarResultado(r);
      } catch (e) {
        err.textContent = String(e);
        btn.disabled = false;
        btn.textContent = "Importar";
      }
    }

    function mostrarResultado(r) {
      const cont = wrap.querySelector("#xls-mapeo");
      const adv = r.advertencias && r.advertencias.length
        ? `<p class="cfg-import-advertencias">${r.advertencias.length} advertencia(s): ${escapar(r.advertencias.slice(0, 5).join("; "))}${r.advertencias.length > 5 ? "…" : ""}</p>`
        : "";
      cont.innerHTML = `
        <div class="cfg-import-resultado">
          <div class="exito-check">✓</div>
          <h3>Importación completada</h3>
          <ul class="cfg-import-lista">
            <li>${r.productos_creados} productos importados${r.productos_omitidos ? ` (${r.productos_omitidos} omitidos)` : ""}</li>
            <li>${r.categorias_creadas} categorías nuevas creadas</li>
          </ul>
          ${adv}
          <button class="btn-primario" id="xls-fin">Listo</button>
        </div>`;
      wrap.querySelector("#xls-fin").addEventListener("click", renderHub);
    }
  }

}

function fmtFecha(iso) {
  try {
    return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

// Zona horaria del sistema operativo (ej. "America/Mazatlan").
function detectarZonaSO() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Mexico_City";
  } catch (_) {
    return "America/Mexico_City";
  }
}
