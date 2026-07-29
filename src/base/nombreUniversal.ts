// YvexPOS Móvil — Limpieza del nombre "universal" (OpenFoodFacts).
//
// Módulo PURO, sin dependencias nativas ni de React: lo separé de codigos.ts
// porque codigos.ts importa inventario.ts (expo-sqlite) y eso impedía probar
// esta lógica con node directo (ver test-codigos.mjs). codigos.ts lo re-usa
// desde consultarNombreUniversal().
//
// El catálogo universal manda nombres "sucios" reales que vimos en capturas:
//   - Marca duplicada con distinto case: "Coca-Cola Coca cola, 600ml"
//   - Descripción genérica larga y cortada: "sabritas Botana crujiente a base de pa..."
//   - Texto truncado/corrupto: "e relleno sabor mermelada Gansito, 50..."
// Esta función los convierte en algo útil para prellenar el formulario:
//   "Coca-Cola Coca cola, 600ml"                 → "Coca-Cola 600ml"
//   ("Botana crujiente...", "sabritas", "45 g")  → "Sabritas 45g"
//   ("e relleno sabor mermelada Gansito...", "Gansito", "50 g") → "Gansito 50g"
//   ("Sabritas Limón", "Sabritas", "")           → "Sabritas Limón"
//
// REGLA: solo SUGIERE un texto; el tendero siempre puede editarlo.

/** Quita acentos y baja a minúsculas, solo para COMPARAR (nunca para mostrar). */
function canon(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Colapsa espacios múltiples y recorta. */
function sanea(v: string | null | undefined): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

/** Capitaliza la marca solo si viene TODA en minúsculas o TODA en mayúsculas
 *  ("sabritas" → "Sabritas", "FUD" → "Fud"). Si ya trae formato propio
 *  ("Coca-Cola", "Gamesa", "Duvalín") se respeta tal cual. */
function capitalizaMarca(marca: string): string {
  if (!marca) return marca;
  const esTodoMin = marca === marca.toLowerCase();
  const esTodoMay = marca === marca.toUpperCase();
  if (!esTodoMin && !esTodoMay) return marca; // formato propio: se respeta
  return marca
    .toLowerCase()
    .split(" ")
    .map((p) => (p ? p[0]!.toUpperCase() + p.slice(1) : p))
    .join(" ");
}

/** Normaliza la presentación/quantity del catálogo:
 *    "600 ml" → "600ml"   "50 g" → "50g"   "1 lt" / "1 l" → "1L"
 *    "1.5 L" → "1.5L"     "1 kg" → "1kg" */
function normalizaCantidad(q: string): string {
  let s = sanea(q);
  if (!s) return "";
  // Litros a "L" mayúscula pegada: "1 lt" / "1 l" / "1.5 L" → "1L" / "1.5L"
  s = s.replace(/(\d(?:[.,]\d+)?)\s*(?:lt|lts|l)\b/gi, "$1L");
  // ml / g / kg / cl pegados al número: "600 ml" → "600ml"
  s = s.replace(/(\d(?:[.,]\d+)?)\s*(ml|g|gr|kg|cl)\b/gi, (_m, n: string, u: string) => {
    const unidad = u.toLowerCase() === "gr" ? "g" : u.toLowerCase();
    return `${n}${unidad}`;
  });
  return s.replace(/\s{2,}/g, " ").trim();
}

/** ¿El texto ya contiene la cantidad? (comparación sin espacios ni case) */
function yaContieneCantidad(texto: string, cantidad: string): boolean {
  if (!cantidad) return true;
  const aplana = (v: string) => canon(v).replace(/[\s,]+/g, "");
  return aplana(texto).includes(aplana(cantidad));
}

/** Palabras canónicas de un texto: minúsculas, sin acentos, separando por
 *  cualquier puntuación ("Coca-Cola," → ["coca","cola"]). Solo para comparar. */
function subpalabras(v: string): string[] {
  return canon(v).split(/[^a-z0-9ñ]+/).filter(Boolean);
}

/** Quita la marca del INICIO del nombre si aparece duplicada, comparando sin
 *  case ni acentos y tolerando guiones/puntuación ("Coca-Cola" = "coca cola").
 *  Se puede repetir hasta 2 veces ("Coca-Cola Coca cola, 600ml" → "600ml"). */
function quitaMarcaAlInicio(nombre: string, marca: string): string {
  const mWords = subpalabras(marca);
  if (!mWords.length) return nombre;

  let resto = nombre;
  for (let intento = 0; intento < 2; intento++) {
    const tokens = resto.split(/\s+/);
    let mi = 0; // cuántas palabras de la marca ya casamos
    let consumidos = 0;
    for (const tok of tokens) {
      const sw = subpalabras(tok);
      let todoCasa = true;
      for (const w of sw) {
        if (mi < mWords.length && w === mWords[mi]) mi++;
        else { todoCasa = false; break; }
      }
      if (!todoCasa) break;
      consumidos++;
      if (mi >= mWords.length) break;
    }
    if (mi < mWords.length) break; // el nombre NO empieza con la marca
    resto = tokens.slice(consumidos).join(" ");
  }
  // Limpia restos de puntuación al inicio (", 600ml" → "600ml")
  return resto.replace(/^[\s,;:.\-–—/]+/, "").trim();
}

/** ¿El nombre parece inútil tal cual: descripción genérica larga o texto
 *  truncado/corrupto del catálogo? */
function pareceSucioOLargo(nombre: string): boolean {
  const palabras = nombre.split(/\s+/).filter(Boolean).length;
  if (nombre.length > 40 || palabras > 6) return true; // descripción larga
  if (/\.{2,}|…/.test(nombre)) return true; // puntos suspensivos = cortado
  if (/^[a-záéíóúñü]/.test(nombre)) return true; // empieza en minúscula = corte previo
  return false;
}

/** Corta el nombre en el último espacio antes de maxLen, sin dejar palabra
 *  a la mitad ni puntuación colgando. */
function cortaBonito(nombre: string, maxLen = 40): string {
  if (nombre.length <= maxLen) return nombre;
  const corte = nombre.lastIndexOf(" ", maxLen);
  const base = corte > 10 ? nombre.slice(0, corte) : nombre.slice(0, maxLen);
  return base.replace(/[\s,;:.\-–—/]+$/, "").trim();
}

/** Simplifica el nombre sugerido por el catálogo universal.
 *  Devuelve null si tras limpiar queda algo inútil (<3 caracteres):
 *  mejor sin sugerencia que una sugerencia basura.
 *
 *  Ejemplos (ver test-codigos.mjs):
 *    ("Coca-Cola Coca cola, 600ml", "Coca-Cola", "600 ml") → "Coca-Cola 600ml"
 *    ("Botana crujiente a base de pa...", "sabritas", "45 g") → "Sabritas 45g"
 *    ("e relleno sabor mermelada Gansito, 50...", "Gansito", "50 g") → "Gansito 50g"
 *    ("Sabritas Limón", "sabritas", null) → "Sabritas Limón"
 *    ("Galletas Marías 170g", "Gamesa", "170 g") → "Gamesa Galletas Marías 170g"
 */
export function simplificarNombreUniversal(
  productName: string | null | undefined,
  brands: string | null | undefined,
  quantity: string | null | undefined
): string | null {
  const nombre = sanea(productName);
  // A veces hay varias marcas separadas por coma: nos quedamos la primera.
  const marcaCruda = sanea(brands).split(",")[0]?.trim() ?? "";
  const marca = capitalizaMarca(marcaCruda);
  const cantidad = normalizaCantidad(quantity ?? "");

  // 1) Quitar la marca duplicada al inicio del nombre.
  let base = quitaMarcaAlInicio(nombre, marca);

  // 2) Si lo que quedó (o el nombre original) es descripción larga o texto
  //    truncado/corrupto, preferimos algo corto: marca + presentación, marca
  //    sola, o el nombre cortado limpio sin dejar palabra a la mitad.
  if (pareceSucioOLargo(base) || pareceSucioOLargo(nombre)) {
    if (marca) base = marca;
    else base = cortaBonito(base.replace(/\.{2,}|…/g, "").trim());
    // Si la base larga YA traía la marca en medio (ej. "…Gansito, 50…"),
    // la marca sola es lo más honesto; no intentamos rescatar el texto roto.
  }

  // 3) Si tras quitar la marca quedó muy poco, usamos la marca como base.
  if (base.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/g, "").length < 3 && marca) {
    base = marca;
  }

  // 4) Componer marca + resto si la marca NO aparece ya en la base
  //    ("Galletas Marías" + "Gamesa" → "Gamesa Galletas Marías").
  if (marca && base !== marca && !canon(base).includes(canon(marca))) {
    base = `${marca} ${base}`;
  }

  // 5) Cantidad al final, solo si no está ya en el texto.
  let resultado = base;
  if (cantidad && !yaContieneCantidad(resultado, cantidad)) {
    resultado = `${resultado} ${cantidad}`;
  }

  resultado = resultado.replace(/\s{2,}/g, " ").replace(/[\s,;:.\-–—]+$/, "").trim();
  if (resultado.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/g, "").length < 3) return null;
  return resultado;
}
