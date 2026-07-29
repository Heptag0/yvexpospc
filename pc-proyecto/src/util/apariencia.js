// YvexPOS — apariencia: aplica la personalización del dueño al programa.
// -----------------------------------------------------------------------------
// El tema/acento/densidad/forma viven en la config de SQLite con las claves:
//   apariencia_tema      → "nocturno" | "amanecer" | "brisa"
//   apariencia_acento    → id de ACENTOS ("morado", "turquesa", …)
//   apariencia_densidad  → "comoda" | "compacta"
//   apariencia_forma     → "suave" | "recta"
//
// main.js llama aplicarApariencia(cfg) al arrancar (la apariencia aplica
// desde el login); Configuración la llama en vivo al cambiar cada perilla.
//
// REGLA QUE LA PERSONALIZACIÓN NO PUEDE ROMPER: cada acento trae dos
// versiones curadas (tema oscuro / temas claros) y el texto sobre el acento
// se elige por contraste WCAG calculado. YvexPOS no se puede desconfigurar.

export const TEMAS = ["nocturno", "amanecer", "brisa"];

/// Acentos curados. `oscuro` para Nocturno; `claro` (más profundo) para
/// Amanecer/Brisa. Ambas versiones garantizan contraste sobre sus fondos.
export const ACENTOS = [
  { id: "morado",   nombre: "Morado Yvex", oscuro: "#8b5cf6", claro: "#7c3aed" },
  { id: "turquesa", nombre: "Turquesa",    oscuro: "#2dd4bf", claro: "#0f766e" },
  { id: "azul",     nombre: "Azul",        oscuro: "#60a5fa", claro: "#2563eb" },
  { id: "verde",    nombre: "Verde",       oscuro: "#34d399", claro: "#0d9d6f" },
  { id: "ambar",    nombre: "Ámbar",       oscuro: "#fbbf24", claro: "#b45309" },
  { id: "coral",    nombre: "Coral",       oscuro: "#fb7185", claro: "#be123c" },
  { id: "rosa",     nombre: "Rosa",        oscuro: "#e879f9", claro: "#a21caf" },
  { id: "grafito",  nombre: "Grafito",     oscuro: "#a7a9c4", claro: "#4b4d63" },
];

const PREDETERMINADA = {
  apariencia_tema: "nocturno",
  apariencia_acento: "morado",
  apariencia_densidad: "comoda",
  apariencia_forma: "suave",
};

/// Lee una clave de apariencia de la config con su predeterminado.
export function valorApariencia(cfg, clave) {
  const v = cfg && cfg[clave];
  return v !== undefined && v !== "" ? v : PREDETERMINADA[clave];
}

/// Hex del acento para el tema dado (los swatches del selector la usan).
export function hexAcento(acentoId, tema) {
  const a = ACENTOS.find((x) => x.id === acentoId) || ACENTOS[0];
  return tema === "nocturno" ? a.oscuro : a.claro;
}

/// Aplica la apariencia completa al documento. Tolera cfg vacío/nulo.
export function aplicarApariencia(cfg) {
  const tema = validar(valorApariencia(cfg, "apariencia_tema"), TEMAS, "nocturno");
  const acento = valorApariencia(cfg, "apariencia_acento");
  const densidad = validar(valorApariencia(cfg, "apariencia_densidad"), ["comoda", "compacta"], "comoda");
  const forma = validar(valorApariencia(cfg, "apariencia_forma"), ["suave", "recta"], "suave");

  const html = document.documentElement;
  html.dataset.tema = tema;
  html.dataset.densidad = densidad;
  html.dataset.forma = forma;
  aplicarAcento(acento, tema);
}

/// Inyecta el acento (y sus derivados) encima del tema activo.
export function aplicarAcento(acentoId, tema) {
  const hex = hexAcento(acentoId, tema);
  const raiz = document.documentElement.style;
  if (acentoId === "morado") {
    // El predeterminado ya vive en los tokens del tema: limpiar overrides
    // para que gobierne el CSS (incluye matices finos por tema).
    ["--acento", "--acento-suave", "--acento-borde", "--acento-texto"].forEach((t) =>
      raiz.removeProperty(t)
    );
    return;
  }
  raiz.setProperty("--acento", hex);
  raiz.setProperty("--acento-suave", conAlfa(hex, tema === "nocturno" ? 0.14 : 0.1));
  raiz.setProperty("--acento-borde", conAlfa(hex, 0.4));
  raiz.setProperty("--acento-texto", textoSobre(hex));
}

// --- helpers ---
function validar(v, permitidos, def) {
  return permitidos.includes(v) ? v : def;
}
function conAlfa(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
/// Texto sobre el acento por contraste WCAG real: gana el mayor, con
/// preferencia por blanco cuando alcanza umbral (asienta mejor).
function textoSobre(hex) {
  const rBlanco = contraste("#ffffff", hex);
  const rOscuro = contraste("#101018", hex);
  return rBlanco >= 4.2 || rBlanco >= rOscuro ? "#ffffff" : "#101018";
}
function luminancia(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
function contraste(a, b) {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
