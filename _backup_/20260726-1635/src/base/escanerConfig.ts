// YvexPOS Móvil — Persistencia de la config del escáner de tickets.
//
// La LÓGICA PURA (defaults, rangos, clamps, mapeos) vive en escaner.ts para
// probarla sin base de datos; aquí solo se lee/escribe la tabla `config`.
//
// Claves (todas con defaults de DEFAULT_CONFIG_ESCANER si no existen):
//   escaner_umbral_aviso_pct   2–15    (default 5)
//   escaner_umbral_alerta_pct  5–30    (default 15)  · nunca < aviso+1
//   escaner_umbral_irreal_pct  30–100  (default 50)  · nunca < alerta+1
//   escaner_margen_default_pct 5–100   (default 30)
//   escaner_redondeo           "50" | "100" | "ninguno" (default "50")
//
// Continuidad: si escaner_redondeo aún no existe, se toma la preferencia
// heredada de ticket_redondeo ("entero"→"100", "exacto"→"ninguno", resto→"50").
//
// REGLA INQUEBRANTABLE: el nivel "irreal" siempre arranca en "mantener" y
// NUNCA aplica costo automáticamente por configuración; el usuario decide
// línea por línea. Esta config solo cambia CUÁNDO se avisa.

import { leerVarias, guardarConfig } from "./config";
import {
  CLAVE_REDONDEO,
  ConfigEscaner,
  DEFAULT_CONFIG_ESCANER,
  modoRedondeoValido,
  redondeoDesdeModo,
  sanarConfigEscaner,
} from "./escaner";

/** Claves de la tabla config para los valores numéricos. */
export const CLAVES_CONFIG_ESCANER = {
  avisoPct: "escaner_umbral_aviso_pct",
  alertaPct: "escaner_umbral_alerta_pct",
  irrealPct: "escaner_umbral_irreal_pct",
  margenDefaultPct: "escaner_margen_default_pct",
} as const;

export const CLAVE_REDONDEO_ESCANER = "escaner_redondeo";

function parseNum(v: string | undefined | null): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Lee la config completa aplicando defaults, migración de redondeo heredado
 *  y clamps de coherencia. Nunca devuelve valores inválidos. */
export async function obtenerConfigEscaner(): Promise<ConfigEscaner> {
  const m = await leerVarias([
    ...Object.values(CLAVES_CONFIG_ESCANER),
    CLAVE_REDONDEO_ESCANER,
    CLAVE_REDONDEO, // heredada (fallback de migración)
  ]);

  const parcial: Partial<ConfigEscaner> = {};
  const aviso = parseNum(m.get(CLAVES_CONFIG_ESCANER.avisoPct));
  if (aviso != null) parcial.avisoPct = aviso;
  const alerta = parseNum(m.get(CLAVES_CONFIG_ESCANER.alertaPct));
  if (alerta != null) parcial.alertaPct = alerta;
  const irreal = parseNum(m.get(CLAVES_CONFIG_ESCANER.irrealPct));
  if (irreal != null) parcial.irrealPct = irreal;
  const margen = parseNum(m.get(CLAVES_CONFIG_ESCANER.margenDefaultPct));
  if (margen != null) parcial.margenDefaultPct = margen;

  const r = m.get(CLAVE_REDONDEO_ESCANER);
  if (r === "50" || r === "100" || r === "ninguno") {
    parcial.redondeo = r;
  } else if (m.has(CLAVE_REDONDEO)) {
    // Migración suave desde la clave heredada.
    parcial.redondeo = redondeoDesdeModo(modoRedondeoValido(m.get(CLAVE_REDONDEO) ?? null));
  }

  return sanarConfigEscaner(parcial);
}

/** Guarda un cambio parcial: sanea (rangos + coherencia) contra la config
 *  vigente, persiste TODAS las claves ya sanas y devuelve la config efectiva
 *  (para que la UI muestre los clamps aplicados, p. ej. alerta = aviso+1). */
export async function guardarConfigEscaner(
  parcial: Partial<ConfigEscaner>
): Promise<ConfigEscaner> {
  const actual = await obtenerConfigEscaner();
  const sana = sanarConfigEscaner({ ...actual, ...parcial });
  await Promise.all([
    guardarConfig(CLAVES_CONFIG_ESCANER.avisoPct, String(sana.avisoPct)),
    guardarConfig(CLAVES_CONFIG_ESCANER.alertaPct, String(sana.alertaPct)),
    guardarConfig(CLAVES_CONFIG_ESCANER.irrealPct, String(sana.irrealPct)),
    guardarConfig(CLAVES_CONFIG_ESCANER.margenDefaultPct, String(sana.margenDefaultPct)),
    guardarConfig(CLAVE_REDONDEO_ESCANER, sana.redondeo),
  ]);
  return sana;
}

/** Restablece todo a los valores por defecto. */
export async function restablecerConfigEscaner(): Promise<ConfigEscaner> {
  // El parcial es la config POR DEFECTO completa: pisa cualquier valor actual.
  return guardarConfigEscaner(DEFAULT_CONFIG_ESCANER);
}
