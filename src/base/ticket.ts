// YvexPOS Móvil — Ticket de venta (lógica pura, sin JSX).
//
// Tras un cobro exitoso, esta pieza arma el MODELO del recibo y su TEXTO
// plano (monoespaciado, ancho de recibo térmico) para compartir por
// WhatsApp, correo o cualquier app con el Share nativo.
//
// Dinero SIEMPRE en centavos enteros; el formato sale de formato.ts (pesos).

import { ResultadoCobro, ItemCarrito, MetodoPago } from "./venta";
import { pesos, fmtFecha } from "./formato";
import { leerNombreNegocio } from "./giro";

export type LineaTicket = {
  cantidad: number;
  nombre: string;
  precio_unitario_centavos: number;
  importe_centavos: number;
};

export type TicketVenta = {
  nombre_negocio: string;
  folio: number;
  fecha_iso: string;
  fecha_legible: string;
  lineas: LineaTicket[];
  articulos: number;
  subtotal_centavos: number; // antes del descuento de lealtad
  descuento_centavos: number; // canje de puntos (0 si no hubo)
  total_centavos: number;
  metodo: MetodoPago;
  pagado_centavos: number;
  cambio_centavos: number;
  despedida: string;
  // Programa de lealtad (solo si el ticket tuvo cliente ligado)
  cliente_nombre?: string;
  puntos_ganados?: number;
  saldo_puntos?: number;
};

/** Arma el modelo del ticket con lo que vender.tsx ya tiene al cobrar
 *  (resultado de cobrar() + el carrito) + el nombre del negocio de config. */
export async function construirTicket(
  resultado: ResultadoCobro,
  items: ItemCarrito[],
  metodo: MetodoPago,
  pagadoCentavos: number,
  lealtad?: { clienteNombre: string; puntosGanados: number; saldoPuntos: number }
): Promise<TicketVenta> {
  const negocio = await leerNombreNegocio();
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
    fecha_iso: ahora,
    fecha_legible: fmtFecha(ahora),
    lineas,
    articulos: lineas.reduce((s, l) => s + l.cantidad, 0),
    subtotal_centavos: resultado.total_centavos + descuento,
    descuento_centavos: descuento,
    total_centavos: resultado.total_centavos,
    metodo,
    pagado_centavos: pagadoCentavos,
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

/** Recibo en texto plano, listo para Share.share({ message }). */
export function textoRecibo(t: TicketVenta): string {
  const renglones: string[] = [];
  renglones.push(centro(t.nombre_negocio.toUpperCase()));
  renglones.push(centro(`Folio #${t.folio}`));
  renglones.push(centro(t.fecha_legible));
  renglones.push(separador("="));
  for (const l of t.lineas) {
    const cant = l.cantidad % 1 === 0 ? String(l.cantidad) : l.cantidad.toFixed(2);
    renglones.push(extremos(`${cant} x ${l.nombre}`, pesos(l.importe_centavos)));
    if (l.cantidad !== 1) {
      renglones.push(`   @ ${pesos(l.precio_unitario_centavos)} c/u`);
    }
  }
  renglones.push(separador("-"));
  renglones.push(extremos("SUBTOTAL", pesos(t.subtotal_centavos)));
  if (t.descuento_centavos > 0) {
    renglones.push(extremos("DESCUENTO LEALTAD", `-${pesos(t.descuento_centavos)}`));
  }
  renglones.push(extremos("TOTAL", pesos(t.total_centavos)));
  renglones.push(
    extremos(
      t.metodo === "efectivo" ? "EFECTIVO" : "TARJETA",
      pesos(t.metodo === "efectivo" ? t.pagado_centavos : t.total_centavos)
    )
  );
  if (t.metodo === "efectivo") {
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
