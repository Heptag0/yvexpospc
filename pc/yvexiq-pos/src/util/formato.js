// YvexPOS — utilidades de formato compartidas.
// Dinero en centavos enteros (fuente de verdad); aquí solo se formatea para mostrar.

/// Centavos enteros -> string de pesos "$1,800.00".
export function pesos(cent) {
  const n = (cent ?? 0) / 100;
  return "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/// Centavos enteros -> string decimal sin símbolo "18.00" (para inputs).
export function centavos(cent) {
  return ((cent ?? 0) / 100).toFixed(2);
}

/// Escapa texto para insertar en HTML de forma segura.
export function escapar(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}
