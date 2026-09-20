// YvexPOS Móvil — Ticket de venta (lógica pura, sin JSX).
//
// Tras un cobro exitoso, esta pieza arma el MODELO del recibo y su TEXTO
// plano (monoespaciado, ancho de recibo térmico) para compartir por
// WhatsApp, correo o cualquier app con el Share nativo.
//
// Dinero SIEMPRE en centavos enteros; el formato sale de formato.ts (pesos).

import { ResultadoCobro, ItemCarrito, MetodoPago, etiquetaFolio } from "./venta";
import { pesos, fmtFecha } from "./formato";
import { leerNombreNegocio } from "./giro";
import { usuarioActivo } from "./usuarios";

export type LineaTicket = {
  cantidad: number;
  nombre: string;
  precio_unitario_centavos: number;
  importe_centavos: number;
};

export type TicketVenta = {
  nombre_negocio: string;
  folio: number;
  /** Serie de esta caja ("A"). Vacío si la caja no está vinculada. */
  folio_prefijo: string;
  fecha_iso: string;
  fecha_legible: string;
  lineas: LineaTicket[];
  articulos: number;
  subtotal_centavos: number; // antes del descuento de lealtad
  descuento_centavos: number; // canje de puntos (0 si no hubo)
  total_centavos: number;
  /** Impuesto YA CONTENIDO en el total (0 si el negocio lo tiene apagado).
   *  Se muestra como desglose informativo — NO se suma al total, porque el
   *  precio que capturó el dueño ya lo incluye. */
  impuesto_centavos: number;
  /** Cómo lo llama el negocio: "IVA", "Impuesto", "Sales Tax"… */
  impuesto_nombre: string;
  /** Total menos impuesto. Solo se muestra cuando hay impuesto que desglosar;
   *  es la línea "Base" del recibo, igual que en el PC. */
  base_centavos: number;
  /** Quién cobró. En una tienda con varios cajeros es lo que permite saber a
   *  quién preguntarle por un ticket — el PC ya lo imprime ("Atendió: …") y
   *  el móvil no lo tenía. */
  atendio: string;
  /** Desglose REAL de cómo se pagó — uno o varios renglones si fue mixto.
   *  Puerto directo de ResultadoCobro.pagos (venta.ts): lo aplicado después
   *  del reparto, no lo que se capturó en pantalla. */
  pagos: {
    metodo: MetodoPago;
    monto_centavos: number;
    recibido_centavos: number | null;
    cambio_centavos: number | null;
  }[];
  /** Cambio TOTAL de la venta (suma de todos los pagos en efectivo) — se
   *  guarda aparte porque es lo que se dice en voz alta al cliente, no hay
   *  que sumarlo desde `pagos` cada vez que se muestra. */
  cambio_centavos: number;
  despedida: string;
  // Programa de lealtad (solo si el ticket tuvo cliente ligado)
  cliente_nombre?: string;
  puntos_ganados?: number;
  saldo_puntos?: number;
};

/** Arma el modelo del ticket con lo que vender.tsx ya tiene al cobrar: el
 *  resultado de cobrar() (que YA trae el desglose real de pagos aplicados)
 *  + el carrito + el nombre del negocio de config.
 *
 *  Antes recibía `metodo`/`pagadoCentavos` sueltos, porque solo existía un
 *  pago por venta. Con el cobro mixto (varios métodos por venta) esos dos
 *  parámetros dejaron de alcanzar — el desglose real ahora vive en
 *  `resultado.pagos`, y de ahí se lee directo: es lo aplicado de verdad,
 *  no lo que se pidió capturar en pantalla. */
export async function construirTicket(
  resultado: ResultadoCobro,
  items: ItemCarrito[],
  lealtad?: { clienteNombre: string; puntosGanados: number; saldoPuntos: number }
): Promise<TicketVenta> {
  const negocio = await leerNombreNegocio();
  // Best-effort: si por lo que sea no hay usuario activo, el recibo sale sin
  // la línea "Atendió" en vez de romper el cobro ya cerrado.
  let atendio = "";
  try {
    atendio = (await usuarioActivo())?.nombre ?? "";
  } catch {
    atendio = "";
  }
  const ahora = new Date().toISOString();
  const lineas: LineaTicket[] = items.map((i) => ({
    cantidad: i.cantidad,
    nombre: i.nombre,
    precio_unitario_centavos: i.precio_centavos,
    importe_centavos: Math.round(i.precio_centavos * i.cantidad),
  }));
  const descuento = resultado.descuento_centavos ?? 0;
  return {
    nombre_negocio: negocio,
    folio: resultado.folio,
    folio_prefijo: resultado.folio_prefijo,
    fecha_iso: ahora,
    fecha_legible: fmtFecha(ahora),
    lineas,
    articulos: lineas.reduce((s, l) => s + l.cantidad, 0),
    subtotal_centavos: resultado.total_centavos + descuento,
    descuento_centavos: descuento,
    total_centavos: resultado.total_centavos,
    impuesto_centavos: resultado.impuesto_centavos,
    impuesto_nombre: resultado.impuesto_nombre,
    base_centavos: resultado.total_centavos - resultado.impuesto_centavos,
    atendio,
    pagos: resultado.pagos,
    cambio_centavos: resultado.cambio_centavos,
    despedida: "¡Gracias por tu compra!",
    cliente_nombre: lealtad?.clienteNombre,
    puntos_ganados: lealtad?.puntosGanados,
    saldo_puntos: lealtad?.saldoPuntos,
  };
}

// ---------------------------------------------------------------------------
// Texto plano tipo recibo (monoespaciado) para compartir.
// Ancho clásico de impresora térmica chica: 32 columnas.
// ---------------------------------------------------------------------------

const ANCHO = 32;

/** 31/08/26 19:13 — corta pero con año, igual que el PC. */
function fechaCortaConAnio(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${p(d.getFullYear() % 100)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function centro(texto: string): string {
  const t = texto.length > ANCHO ? texto.slice(0, ANCHO) : texto;
  const margen = Math.max(0, Math.floor((ANCHO - t.length) / 2));
  return " ".repeat(margen) + t;
}

function extremos(izq: string, der: string): string {
  const hueco = ANCHO - izq.length - der.length;
  if (hueco >= 1) return izq + " ".repeat(hueco) + der;
  // Si no cabe, recorta la izquierda (el importe manda).
  const maxIzq = ANCHO - der.length - 1;
  return izq.slice(0, Math.max(1, maxIzq)) + " " + der;
}

function separador(caracter = "-"): string {
  return caracter.repeat(ANCHO);
}

const NOMBRES_METODO: Record<MetodoPago, string> = {
  efectivo: "EFECTIVO",
  tarjeta: "TARJETA",
  transferencia: "TRANSFERENCIA",
  credito: "CREDITO",
};

/** Recibo en texto plano, listo para Share.share({ message }). */
export function textoRecibo(t: TicketVenta): string {
  const renglones: string[] = [];
  renglones.push(centro(t.nombre_negocio.toUpperCase()));
  renglones.push("");
  // Folio a la izquierda y fecha a la derecha, como el PC. La fecha lleva AÑO:
  // un recibo que solo dice "31 ago" es inútil para buscar una venta meses
  // después, que es justo cuando alguien saca un ticket viejo del cajón.
  renglones.push(
    extremos(
      `Ticket ${etiquetaFolio(t.folio, t.folio_prefijo, true)}`,
      fechaCortaConAnio(t.fecha_iso)
    )
  );
  if (t.atendio) renglones.push(`Atendió: ${t.atendio}`);
  renglones.push(separador("="));
  for (const l of t.lineas) {
    const cant = l.cantidad % 1 === 0 ? String(l.cantidad) : l.cantidad.toFixed(2);
    renglones.push(extremos(`${cant} x ${l.nombre}`, pesos(l.importe_centavos)));
    if (l.cantidad !== 1) {
      renglones.push(`   @ ${pesos(l.precio_unitario_centavos)} c/u`);
    }
  }
  renglones.push(separador("-"));
  // "Subtotal" solo aporta cuando hay un descuento que explicar: si no, dice
  // exactamente lo mismo que TOTAL dos renglones más abajo y solo estorba.
  if (t.descuento_centavos > 0) {
    renglones.push(extremos("SUBTOTAL", pesos(t.subtotal_centavos)));
    renglones.push(extremos("DESCUENTO LEALTAD", `-${pesos(t.descuento_centavos)}`));
  }
  // Base + impuesto incluido + TOTAL, el mismo orden que imprime el PC. El
  // impuesto va ANTES del total, no después: así se lee como una suma que
  // termina en el total, en vez de como algo que podría sumarse encima.
  if (t.impuesto_centavos > 0) {
    renglones.push(extremos("BASE", pesos(t.base_centavos)));
    renglones.push(
      extremos(`${t.impuesto_nombre.toUpperCase()} INCL.`, pesos(t.impuesto_centavos))
    );
  }
  renglones.push(extremos("TOTAL", pesos(t.total_centavos)));
  renglones.push("");
  // Un renglón por cada pago real — con un solo método (el caso de siempre)
  // se ve exactamente igual que antes; con varios, se ve cada uno por su
  // cuenta, que es justo lo que hace único a un pago mixto.
  for (const p of t.pagos) {
    const monto = p.metodo === "efectivo" ? (p.recibido_centavos ?? p.monto_centavos) : p.monto_centavos;
    renglones.push(extremos(NOMBRES_METODO[p.metodo], pesos(monto)));
  }
  if (t.cambio_centavos > 0) {
    renglones.push(extremos("CAMBIO", pesos(t.cambio_centavos)));
  }
  renglones.push(separador("="));
  renglones.push(centro(`${t.articulos} articulo${t.articulos === 1 ? "" : "s"}`));
  if (t.cliente_nombre) {
    const partes = [t.cliente_nombre];
    if ((t.puntos_ganados ?? 0) > 0) partes.push(`+${t.puntos_ganados} pts`);
    if (t.saldo_puntos != null) partes.push(`saldo: ${t.saldo_puntos} pts`);
    renglones.push(centro(`Cliente: ${partes.join(" · ")}`));
  }
  renglones.push(centro(t.despedida));
  renglones.push(centro("Hecho con YvexPOS"));
  return renglones.join("\n");
}
