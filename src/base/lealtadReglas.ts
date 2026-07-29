// YvexPOS Móvil — Reglas PURAS del programa de lealtad.
//
// Sin imports nativos ni de expo: aritmética entera (dinero SIEMPRE en
// centavos) y nada más. 100% testeable con node puro (test-lealtad.mjs),
// igual que visitas.ts.
//
// Las reglas viven en config (leerReglas de lealtad.ts las lee):
//   lealtad_pesos_por_punto      -> 1 punto por cada N pesos de compra
//   lealtad_puntos_visita        -> puntos por visita (máx. 1 al día)
//   lealtad_valor_punto_centavos -> cuánto vale 1 punto al canjear
//   lealtad_tope_descuento_pct   -> tope del ticket cubrible con puntos (%)

/** Puntos que gana una compra: 1 punto por cada `pesosPorPunto` pesos
 *  COMPLETOS del total. floor: $99 con regla de $10 -> 9 puntos.
 *  Entradas inválidas (negativas, cero, NaN) -> 0 puntos, nunca truena. */
export function puntosPorCompra(
  totalCentavos: number,
  pesosPorPunto: number
): number {
  if (!Number.isFinite(totalCentavos) || totalCentavos <= 0) return 0;
  if (!Number.isFinite(pesosPorPunto) || pesosPorPunto <= 0) return 0;
  const pesos = totalCentavos / 100;
  return Math.floor(pesos / pesosPorPunto);
}

export type ResultadoCanje = {
  descuentoCentavos: number;
  puntosUsados: number;
};

/** Cuánto descuento da un canje de puntos sobre este ticket.
 *
 *  Tres candados:
 *    1. El descuento nunca pasa del TOPE del ticket (topePct del total).
 *    2. Nunca es mayor que el total mismo (total chico, tope 100%).
 *    3. Nunca negativo (entradas raras -> 0).
 *
 *  Si el tope RECORTA el canje, puntosUsados baja respecto a lo solicitado:
 *  se cobra solo lo necesario para llegar al descuento (floor, a FAVOR del
 *  cliente: nunca le quitamos un punto de más por redondeo). Puede quedar un
 *  resto de centavos sin cubrir (a lo sumo valorPunto-1 centavos), que el
 *  cliente paga normal. Así el saldo siempre cuadra: puntosUsados * valor
 *  puede ser MENOR que descuentoCentavos, pero nunca MAYOR.
 *
 *  REGLA DE NEGOCIO: esta función solo CALCULA; la app siempre muestra el
 *  resultado y el usuario confirma en pantalla antes de cobrar. Nada se
 *  aplica automáticamente. */
export function descuentoPorCanje(
  puntosSolicitados: number,
  valorPuntoCent: number,
  totalCentavos: number,
  topePct: number
): ResultadoCanje {
  if (
    !Number.isFinite(puntosSolicitados) || puntosSolicitados <= 0 ||
    !Number.isFinite(valorPuntoCent) || valorPuntoCent <= 0 ||
    !Number.isFinite(totalCentavos) || totalCentavos <= 0 ||
    !Number.isFinite(topePct) || topePct <= 0
  ) {
    return { descuentoCentavos: 0, puntosUsados: 0 };
  }
  const solicitado = Math.floor(puntosSolicitados) * valorPuntoCent;
  const tope = Math.floor((totalCentavos * Math.min(topePct, 100)) / 100);
  const descuentoCentavos = Math.max(
    0,
    Math.min(solicitado, tope, totalCentavos)
  );
  // floor a favor del cliente: mínimo de puntos para ESE descuento.
  const puntosUsados = Math.floor(descuentoCentavos / valorPuntoCent);
  return { descuentoCentavos, puntosUsados };
}
