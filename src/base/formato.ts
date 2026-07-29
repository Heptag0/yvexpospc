// YvexPOS Móvil — Helpers de formato (dinero, stock, fechas).

/** Centavos enteros -> "$18.00". */
export function pesos(centavos: number): string {
  const signo = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  const entero = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, "0");
  // Separador de miles para montos grandes ($12,450.00).
  const miles = entero.toLocaleString("en-US");
  return `${signo}$${miles}.${dec}`;
}

/** Texto de pesos del formulario -> centavos enteros. */
export function aCentavos(pesosTexto: string): number {
  const limpio = pesosTexto.replace(",", ".").replace(/[^0-9.]/g, "");
  const n = parseFloat(limpio);
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

/** Centavos -> texto editable ("18.00"). */
export function centavosATexto(centavos: number | null): string {
  if (centavos == null) return "";
  return (centavos / 100).toFixed(2);
}

/** Stock legible: entero si es redondo, con decimales si no. */
export function fmtStock(n: number, unidad: string): string {
  const num = Number.isInteger(n)
    ? String(n)
    : n.toFixed(3).replace(/\.?0+$/, "");
  return `${num} ${unidad}`;
}

/** Número de texto de input -> real (0 si inválido). */
export function aNumero(texto: string): number {
  const n = parseFloat(texto.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

/** ISO -> "9 jul, 14:32" (para historiales). */
export function fmtFecha(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-MX", {
      day: "numeric",
      month: "short",
    }) + ", " + d.toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
