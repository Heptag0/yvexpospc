// YvexPOS Móvil — Cálculo de impuestos configurable (IVA, Sales Tax, IEPS...).
//
// Puerto EXACTO de src-tauri/src/db/impuestos.rs del PC: mismo algoritmo,
// mismas fórmulas, mismo redondeo — para que un negocio con PC y móvil
// calcule idéntico el impuesto en las dos plataformas. Si algo aquí no
// coincide con impuestos.rs, es un bug de este archivo, no una decisión de
// diseño distinta.
//
// La configuración vive en la tabla `config` (mismas claves que el PC):
//   - impuesto_activo:  "0" | "1"  (por defecto 0 = desactivado — la mayoría
//     de negocios lo van a dejar así)
//   - impuesto_nombre:  "IVA" | "Impuesto" | "Sales Tax" | ...
//   - impuesto_modo:    "incluido" | "agregado"
//   - impuesto_tasa:    tasa GENERAL en PUNTOS BASE (1600 = 16.00%)
//
// Tasa en puntos base (centésimas de %) para permitir tasas como 8.25%
// (= 825) sin flotantes: 16% = 1600, 21% = 2100, 8.25% = 825.
//
// Dos modos, elegidos por el dueño desde Ajustes:
//   - "incluido": el precio YA contiene el impuesto (México, Europa). El
//     TOTAL no cambia; solo se DESGLOSA cuánto del precio ya era impuesto.
//       base = total / (1 + tasa);  impuesto = total - base
//   - "agregado": el precio es sin impuesto y se SUMA al cobrar (EU/EEUU).
//       impuesto = subtotal * tasa;  total = subtotal + impuesto
//
// Cada producto puede traer su propia tasa (`productos.iva_tasa`, un
// PORCENTAJE entero — 0 o 16, igual que el PC, ver inventario.ts::validar);
// si es 0, se usa la tasa general de la configuración.

import { leerConfig } from "./config";
import { guardarConfigCompartida } from "./sync";

export type ModoImpuesto = "incluido" | "agregado";

export type ConfigImpuesto = {
  activo: boolean;
  nombre: string;
  modo: ModoImpuesto;
  /** Tasa GENERAL en puntos base (1600 = 16%). */
  tasaGeneral: number;
};

export const CONFIG_IMPUESTO_DEFECTO: ConfigImpuesto = {
  activo: false,
  nombre: "Impuesto",
  modo: "incluido",
  tasaGeneral: 0,
};

/** Lee la config de impuesto desde `config` — mismas 4 claves que el PC. */
export async function leerConfigImpuesto(): Promise<ConfigImpuesto> {
  // `impuesto_modo` ya no se lee: el modo es siempre "incluido" (ver abajo).
  // La clave se deja intacta en `config` a propósito — no se borra nada del
  // dispositivo, y si algún día vuelve a haber más de un modo, el valor
  // histórico del negocio sigue ahí.
  const [activo, nombre, tasa] = await Promise.all([
    leerConfig("impuesto_activo"),
    leerConfig("impuesto_nombre"),
    leerConfig("impuesto_tasa"),
  ]);
  return {
    activo: activo === "1",
    nombre: nombre && nombre.trim() ? nombre : CONFIG_IMPUESTO_DEFECTO.nombre,
    // SIEMPRE "incluido" — el modo "agregado" se retiró a propósito.
    //
    // POR QUÉ: el PC solo implementa "incluido" (el precio que capturas es
    // el que paga el cliente, y el impuesto se desglosa en el ticket), que
    // es como funciona de verdad en México, Latinoamérica y Europa. Tener
    // dos modelos distintos entre plataformas causó un bug real: con
    // "agregado" activo, la pantalla de cobro mostraba el total del carrito
    // ($20.00) mientras cobrar() exigía neto+impuesto ($23.20), y la venta
    // quedaba bloqueada con "el pago no cubre el total".
    //
    // Se coacciona en la LECTURA (no solo se esconde el selector) para que
    // un negocio que ya tenía guardado "agregado" de una versión anterior
    // pase a comportarse bien sin tener que tocar nada.
    modo: "incluido",
    tasaGeneral: Number(tasa) || 0,
  };
}

/** Guarda la config de impuesto. Solo escribe las claves que vengan
 *  definidas en `parcial` — mismo criterio parcial que el resto de la app
 *  (ver guardarConfig / los ajustes del escáner).
 *
 *  Usa guardarConfigCompartida() (no guardarConfig() a secas): estas 4
 *  claves describen al NEGOCIO, no a este teléfono — deben viajar a las
 *  demás cajas. Ver sync.ts::CLAVES_CONFIG_COMPARTIDA. */
export async function guardarConfigImpuesto(
  parcial: Partial<ConfigImpuesto>
): Promise<void> {
  if (parcial.activo !== undefined) {
    await guardarConfigCompartida("impuesto_activo", parcial.activo ? "1" : "0");
  }
  if (parcial.nombre !== undefined) {
    await guardarConfigCompartida("impuesto_nombre", parcial.nombre.trim() || CONFIG_IMPUESTO_DEFECTO.nombre);
  }
  if (parcial.modo !== undefined) {
    await guardarConfigCompartida("impuesto_modo", parcial.modo);
  }
  if (parcial.tasaGeneral !== undefined) {
    await guardarConfigCompartida("impuesto_tasa", String(Math.max(0, Math.round(parcial.tasaGeneral))));
  }
}

/** Convierte un porcentaje entero (como `productos.iva_tasa`, 0 o 16) a
 *  puntos base. 16 -> 1600.
 *
 *  ⚠️ NO confundir con `productos.iva_tasa`: ese campo es un PORCENTAJE
 *  entero, no puntos base. Pasar 16 sin convertir aquí sería un error de
 *  100×: 16 puntos base son 0.16%, no 16%. Sobre $1000 serían $1.60 en vez
 *  de $160 — exactamente el bug real que tuvo ventas.rs en el PC antes de
 *  crear esta función. */
export function puntosBaseDesdePct(pct: number): number {
  return Math.round(pct) * 100;
}

/** Desglose de impuesto de una venta (en centavos). */
export type DesgloseImpuesto = {
  baseCentavos: number;
  impuestoCentavos: number;
  totalCentavos: number;
};

/** Una línea para calcular impuesto: su importe (precio×cantidad, YA con
 *  descuentos repartidos) en centavos, y su tasa efectiva en PUNTOS BASE. */
export type LineaImpuesto = {
  importeCentavos: number;
  /** Puntos base (1600 = 16%). 0 = usar la tasa general de la config. */
  tasaBase: number;
};

/** impuesto = importe × tasa (puntos base), con redondeo SIMÉTRICO respecto
 *  al cero.
 *
 *  Por qué no basta Math.round: JS redondea .5 siempre hacia +Infinity
 *  (Math.round(-1.5) === -1, no -2) — asimétrico. Con importes negativos
 *  (una devolución, o una línea con rebaja mayor al precio) el impuesto de
 *  la devolución no cuadraría en espejo con el de la venta original. Mismo
 *  problema, misma solución, que ya se resolvió en impuestos.rs del PC. */
function redondearImpuesto(importeCentavos: number, tasaBase: number): number {
  const prod = importeCentavos * tasaBase;
  const ajuste = prod < 0 ? -5000 : 5000;
  return Math.trunc((prod + ajuste) / 10000);
}

/** Dado un importe CON impuesto incluido, devuelve la base (sin impuesto).
 *  base = importe × 10000 / (10000 + tasaBase), mismo redondeo simétrico. */
function baseDesdeIncluido(importeCentavos: number, tasaBase: number): number {
  const num = importeCentavos * 10000;
  const den = 10000 + tasaBase;
  const mitad = Math.trunc(den / 2);
  const ajuste = num < 0 ? -mitad : mitad;
  return Math.trunc((num + ajuste) / den);
}

/** Calcula el desglose de impuesto de una venta completa. Puerto exacto de
 *  impuestos::calcular() del PC — misma firma, mismo comportamiento:
 *    - impuesto inactivo: total = suma de líneas, impuesto = 0.
 *    - "incluido": total = importe neto (no cambia); se desglosa la base.
 *    - "agregado": total = importe neto + impuesto (se suma). */
export function calcular(cfg: ConfigImpuesto, lineas: LineaImpuesto[]): DesgloseImpuesto {
  if (!cfg.activo) {
    const total = lineas.reduce((s, l) => s + l.importeCentavos, 0);
    return { baseCentavos: total, impuestoCentavos: 0, totalCentavos: total };
  }

  let impuestoTotal = 0;
  let baseTotal = 0;
  let brutoTotal = 0;

  for (const l of lineas) {
    const tasa = l.tasaBase > 0 ? l.tasaBase : cfg.tasaGeneral;
    if (cfg.modo === "agregado") {
      // El importe es la base; el impuesto se suma.
      const imp = redondearImpuesto(l.importeCentavos, tasa);
      baseTotal += l.importeCentavos;
      impuestoTotal += imp;
      brutoTotal += l.importeCentavos + imp;
    } else {
      // "incluido": el importe ya trae el impuesto; lo extraemos.
      const base = baseDesdeIncluido(l.importeCentavos, tasa);
      const imp = l.importeCentavos - base;
      baseTotal += base;
      impuestoTotal += imp;
      brutoTotal += l.importeCentavos;
    }
  }

  return { baseCentavos: baseTotal, impuestoCentavos: impuestoTotal, totalCentavos: brutoTotal };
}
