// YvexPOS Móvil — traspaso ligero entre pantallas (memoria, no persistente).
// Cuando Cotizaciones dice "convertir a venta", deja aquí la cotización
// completa; Vender la recoge al montar/enfocar y arma el carrito con ella.
// Se limpia sola al leerse: si el usuario navega a Vender por otro lado
// después, no hay una cotización vieja esperando a colarse por sorpresa.
//
// Mismo patrón exacto que su equivalente en el PC (src/util/handoff.js).

import { CotizacionConLineas } from "./cotizaciones";

let cotizacionPendiente: CotizacionConLineas | null = null;

export function dejarCotizacionParaVenta(c: CotizacionConLineas) {
  cotizacionPendiente = c;
}

export function tomarCotizacionPendiente(): CotizacionConLineas | null {
  const c = cotizacionPendiente;
  cotizacionPendiente = null;
  return c;
}
