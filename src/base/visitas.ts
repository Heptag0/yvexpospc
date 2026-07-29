// YvexPOS Móvil — Lógica PURA de días de visita de proveedores.
//
// Sin imports nativos ni de expo: fechas como cadenas "AAAA-MM-DD" y
// aritmética de días en UTC (así un cruce de mes/año o de horario de verano
// nunca mueve la fecha). Esto la hace 100% testeable con node puro
// (test-visitas.mjs), igual que nombreUniversal.ts.
//
// Convención de días: 0 = domingo, 1 = lunes, ..., 6 = sábado
// (la misma de Date.getDay(), para no traducir nada nunca).

const DIAS_ES = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
] as const;

const MS_DIA = 24 * 60 * 60 * 1000;

/** "2026-07-26" -> milisegundos UTC de ese día (00:00). null si inválida. */
function ymdAms(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  // Rechaza fechas imposibles ("2026-02-31" se desbordaría a marzo).
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d)
    return null;
  return ms;
}

/** Milisegundos UTC -> "AAAA-MM-DD". */
function msAymd(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Próxima fecha de visita a partir de `desdeYmd` (INCLUSIVE: si hoy es día
 * de visita, devuelve hoy). `dias` son números 0-6; puede venir desordenado
 * o con duplicados, no importa.
 *
 * Devuelve "AAAA-MM-DD" o null si no hay días configurados o la fecha de
 * referencia es inválida.
 */
export function proximaFechaVisita(dias: number[], desdeYmd: string): string | null {
  const validos = [...new Set(dias.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  if (validos.length === 0) return null;
  const inicio = ymdAms(desdeYmd);
  if (inicio == null) return null;
  // 7 días bastan para cubrir cualquier combinación de días de la semana.
  for (let i = 0; i < 7; i++) {
    const ms = inicio + i * MS_DIA;
    if (validos.includes(new Date(ms).getUTCDay())) return msAymd(ms);
  }
  return null;
}

/**
 * Etiqueta amable para el aviso de Inicio:
 *   misma fecha que hoy  -> "Hoy"
 *   mañana               -> "Mañana"
 *   otro día             -> "El lunes" (weekday en español)
 * Fecha inválida -> la cadena original (nunca truena la UI).
 */
export function etiquetaAviso(fechaYmd: string, hoyYmd: string): string {
  const f = ymdAms(fechaYmd);
  const h = ymdAms(hoyYmd);
  if (f == null || h == null) return fechaYmd;
  const diff = Math.round((f - h) / MS_DIA);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Mañana";
  return `El ${DIAS_ES[new Date(f).getUTCDay()]}`;
}

/** Nombre del día de la semana en español para una fecha "AAAA-MM-DD". */
export function nombreDia(fechaYmd: string): string | null {
  const ms = ymdAms(fechaYmd);
  if (ms == null) return null;
  return DIAS_ES[new Date(ms).getUTCDay()];
}

/** Fecha "AAAA-MM-DD" de hoy en la hora local del dispositivo. */
export function hoyYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
