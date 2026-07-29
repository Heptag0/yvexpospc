// YvexPOS — vista previa del ticket (aspecto de papel térmico).
// Muestra el contenido generado por el backend tal como saldría impreso.
// La impresión real (ESC/POS) se conectará cuando haya impresora; aquí el
// botón "Imprimir" queda listo y avisa si no hay hardware.

import { invoke } from "@tauri-apps/api/core";
import { escapar } from "../util/formato.js";

let overlayTicket = null;

/// Abre la vista previa de un ticket. Localiza la venta por `ventaId`
/// (preferido: es único global; el folio solo es único POR caja y con la
/// sync puede repetirse entre dispositivos) o por `folio` como respaldo.
/// `alCerrar` (opcional) se llama cuando el usuario cierra la vista previa.
export async function verTicket(folio, alCerrar, ventaId) {
  let ticket;
  try {
    ticket = await invoke("ticket_generar", { folio: folio ?? null, ventaId: ventaId ?? null });
  } catch (e) {
    avisoFlotante("No se pudo generar el ticket: " + e);
    if (typeof alCerrar === "function") alCerrar();
    return;
  }
  mostrar(ticket, alCerrar, ventaId ?? null);
}

/// Abre la vista previa de la última venta.
export async function verUltimoTicket(alCerrar) {
  let ticket;
  try {
    ticket = await invoke("ticket_ultima");
  } catch (e) {
    avisoFlotante(String(e));
    if (typeof alCerrar === "function") alCerrar();
    return;
  }
  mostrar(ticket, alCerrar);
}

let alCerrarTicket = null;
let folioActual = null;
let ventaIdActual = null;

function mostrar(ticket, alCerrar, ventaId) {
  cerrar();
  alCerrarTicket = typeof alCerrar === "function" ? alCerrar : null;
  folioActual = ticket.folio;
  ventaIdActual = ventaId ?? null;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="tk-modal">
      <div class="tk-papel" style="--tk-cols:${ticket.ancho}">
        ${ticket.lineas.map(lineaHTML).join("")}
      </div>
      <div class="tk-acciones">
        <button class="btn-sec" id="tk-cerrar">Cerrar</button>
        <button class="btn-primario" id="tk-imprimir">Imprimir</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlayTicket = overlay;
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) cerrar();
  });
  overlay.querySelector("#tk-cerrar").addEventListener("click", cerrar);
  overlay.querySelector("#tk-imprimir").addEventListener("click", imprimir);
}

function lineaHTML(l) {
  const txt = l.texto === "" ? "&nbsp;" : escapar(l.texto);
  const clase = {
    titulo: "tk-titulo",
    negrita: "tk-negrita",
    centro: "tk-centro",
    separador: "tk-sep",
    normal: "",
  }[l.estilo] || "";
  return `<div class="tk-linea ${clase}">${txt}</div>`;
}

async function imprimir() {
  // Pide al backend el trabajo de impresión (bytes ESC/POS + modo + impresora).
  let trabajo;
  try {
    trabajo = await invoke("ticket_preparar_impresion", {
      folio: folioActual,
      ventaId: ventaIdActual,
    });
  } catch (e) {
    avisoFlotante("No se pudo preparar la impresión: " + e);
    return;
  }

  if (trabajo.modo === "sistema") {
    // Modo sistema: imprime vía driver de Windows (sirve para PDF, láser, etc.).
    await imprimirSistema(trabajo);
  } else {
    // Modo ESC/POS: manda los bytes directos a la impresora térmica.
    await imprimirEscpos(trabajo);
  }
}

// Imprime el ticket a la térmica vía el plugin, usando su formato de "secciones".
// El plugin genera los ESC/POS internamente a partir de estas secciones.
async function imprimirEscpos(trabajo) {
  try {
    const mod = await import("tauri-plugin-thermal-printer");
    const t = trabajo.ticket;
    const anchoMm = t.ancho === 32 ? "Mm58" : "Mm80";

    // Convertir las líneas del ticket a las secciones que entiende el plugin.
    // Estilos: titulo -> Title; el resto -> Text con alineación según estilo.
    const sections = t.lineas.map((l) => {
      const texto = l.texto === "" ? " " : l.texto;
      if (l.estilo === "titulo") {
        return { Title: { text: texto } };
      }
      const align =
        l.estilo === "centro" ? "Center" : l.estilo === "negrita" ? "Left" : "Left";
      const bold = l.estilo === "negrita";
      return { Text: { text: texto, styles: { align, bold } } };
    });

    await mod.print_thermal_printer({
      printer: trabajo.impresora || "",
      paper_size: anchoMm,
      options: { code_page: 0, encode: "WINDOWS_1252" },
      sections,
    });
    avisoFlotante("Ticket enviado a la impresora.");
  } catch (e) {
    avisoFlotante(
      "No se pudo imprimir en la térmica (" + e + "). Revisa la impresora en Configuración o usa el modo Sistema."
    );
  }
}

// Imprime vía el sistema operativo (Windows): abre el diálogo de impresión
// donde puedes elegir una impresora normal o "Microsoft Print to PDF".
async function imprimirSistema(trabajo) {
  const html = ticketAHtml(trabajo.ticket);
  // En Tauri, la forma fiable de usar el diálogo del sistema es imprimir el
  // contenido en un iframe oculto y llamar a print() sobre él. Así el usuario
  // elige impresora o PDF en el diálogo nativo de Windows.
  imprimirViaIframe(html);
}

function imprimirViaIframe(html) {
  // Quita un iframe previo si quedó.
  const viejo = document.getElementById("tk-print-frame");
  if (viejo) viejo.remove();

  const iframe = document.createElement("iframe");
  iframe.id = "tk-print-frame";
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  // Esperar a que cargue el contenido y disparar el diálogo de impresión.
  setTimeout(() => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      avisoFlotante("No se pudo abrir el diálogo de impresión: " + e);
    }
    // Limpiar el iframe después.
    setTimeout(() => iframe.remove(), 1000);
  }, 300);
}

function ticketAHtml(ticket) {
  const lineas = ticket.lineas
    .map((l) => {
      const clase = { titulo: "t", negrita: "b", centro: "c" }[l.estilo] || "";
      const txt = l.texto === "" ? "&nbsp;" : escapar(l.texto);
      return `<div class="l ${clase}">${txt}</div>`;
    })
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: 'Courier New', monospace; font-size: 12px; margin: 6px; white-space: pre; }
    .l { line-height: 1.35; }
    .b { font-weight: bold; }
    .c { text-align: center; }
    .t { font-weight: bold; font-size: 15px; text-align: center; }
  </style></head><body>${lineas}</body></html>`;
}

function cerrar() {
  if (overlayTicket) {
    overlayTicket.remove();
    overlayTicket = null;
  }
  if (alCerrarTicket) {
    const cb = alCerrarTicket;
    alCerrarTicket = null;
    cb();
  }
}

function avisoFlotante(msg) {
  const t = document.createElement("div");
  t.className = "venta-toast venta-toast--visible";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}