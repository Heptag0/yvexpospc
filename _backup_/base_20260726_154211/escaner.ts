// YvexPOS Móvil — Lógica del escáner de tickets de compra (pura, sin JSX).
//
// Aquí vive TODO lo que se puede probar sin pantalla:
//   - los tipos del contrato con el backend (POST /ia/ticket)
//   - emparejar las líneas del ticket contra el catálogo local
//   - el aviso escalonado cuando el costo cambia
//   - el precio de venta sugerido (mantiene el margen actual)
//   - el redondeo del precio sugerido (configurable en Ajustes)
//
// REGLA DE ORO del POS: dinero SIEMPRE en centavos enteros.

import type { Producto } from "./inventario";
// Ciclo seguro: diccionario.ts importa normalizarNombre de AQUÍ, pero solo lo
// usa dentro de funciones; este import tampoco se usa al cargar el módulo.
import { buscarEnDiccionario, conflictoPresentacion, EntradaDiccionario } from "./diccionario";
// Re-export para la pantalla (el modal importa todo del escáner).
export { conflictoPresentacion, tamanoCanonicaEnvase } from "./diccionario";

// ---------------------------------------------------------------------------
// Contrato del backend (POST /ia/ticket)
// ---------------------------------------------------------------------------

export type ConfianzaLinea = "alta" | "media" | "baja";
export type TipoLineaTicket = "venta" | "cambio" | "envase" | "otro";

export type LineaTicket = {
  nombre_crudo: string;          // tal como lo leyó la IA en el ticket
  nombre_sugerido: string;       // nombre "bonito" propuesto
  codigo_barras: string | null;
  cantidad: number;
  unidad_ticket: "pieza" | "caja" | "pack" | null;
  piezas_por_empaque: number | null; // ej. 24 si viene por caja de 24
  costo_unitario_centavos: number;
  importe_centavos: number | null;   // total de la línea si se alcanzó a leer
  tipo: TipoLineaTicket;
  confianza: ConfianzaLinea;
  nota: string | null;               // ej. "zona ilegible"
  catalogo_idx?: number | null;      // 0-based: entrada del CATÁLOGO ENVIADO que la IA reconoció
};

/** Resultado de la verificación por doble lectura del backend (opcional). */
export type VerificacionTicket = {
  aplicada: boolean;
  lineas_verificadas: number;
  lineas_discrepantes: number;
  lineas_sin_pareja: number;
};

export type RespuestaTicket = {
  proveedor: string | null;
  proveedor_id: string | null;
  fecha: string | null;              // "2026-07-14"
  folio: string | null;
  es_preventa: boolean;
  lineas: LineaTicket[];
  total_ticket_centavos: number | null;
  avisos: string[];
  mock: boolean;                     // true = respuesta de prueba del servidor
  verificacion?: VerificacionTicket | null; // resumen de la doble lectura (si se aplicó)
};

// ---------------------------------------------------------------------------
// Emparejamiento de líneas contra el catálogo
// ---------------------------------------------------------------------------
//
// Filosofía: un empareje EQUIVOCADO es mucho peor que ningún empareje (sumar
// stock al producto que no es, en silencio). Por eso hay dos zonas:
//   SEGURO   -> se aplica solo (chip verde)
//   SUGERIDO -> hay duda razonable (chip ámbar, exige confirmación humana)
//   (null)   -> no se parece a nada: producto nuevo
//
// La clave es la PENALIZACIÓN DE VARIANTE: los tokens que quedan de un solo
// lado ("light", "zero", "adobada") son justo los que DISTINGUEN productos;
// cada uno resta puntos, así "Ballena Pacífico" nunca auto-empareja con
// "Ballena Pacífico Light".

/** Ruido de formato/empaque/unidad: se elimina ANTES de comparar. Mejor quitar
 *  de más (si queda "pacífico light" ya hay señal) que dejar ruido. */
export const TOKEN_RUIDO: ReadonlySet<string> = new Set([
  // unidades y derivados
  "ml", "lt", "l", "g", "gr", "kg", "oz", "cc", "cl",
  "pz", "pzs", "pza", "pk", "pack", "ct",
  "pieza", "piezas", "un", "ud", "x",
  // empaque y material (botella/bote/lata NO son ruido: a veces distinguen
  // la presentación —"Bote Pacífico Light" vs "Ballena Pacífico Light"—)
  "caja", "cajas", "paquete", "charola", "display",
  "tarro",
  "pet", "vidrio", "plastico", "retornable", "grabada", "nr", "no",
  // letras sueltas típicas de tickets y formatos
  "h", "c", "ci", "r", "t", "tc", "div", "division", "mega",
  // conectores que no aportan ("Agua En Ciel", "Coca Cola de 600")
  "en", "de", "del", "el", "la", "las", "los", "al", "con", "para", "por", "y",
]);

/** Abreviaturas de VARIANTE/SABOR/TAMAÑO comunes en tickets de abarrotes
 *  (genéricas del comercio mexicano, nada de productos concretos). Se aplican
 *  como sustitución de token completo tras minúsculas, antes de quitar ruido.
 *
 *  Bloque de MARCA (formatos de proveedor, evaluado 2026-07): "tkt" (Tecate,
 *  formato TKT.ROJ.CAG940), "hei" (Heineken), "mb" (Marlboro, PMI) y "roj"
 *  (roja) son tokens que NO aparecen en productos ajenos a esas marcas, así
 *  que expandirlos no contamina otros emparejes. NO se agregan "lt" (también
 *  es "litro"), "lat", "cag", "ind", "cc" ni "sta": son ambiguos o bastan
 *  como token crudo en las claves del diccionario universal. */
export const ABREVIATURAS: Readonly<Record<string, string>> = {
  lg: "light",
  suav: "suave",
  trad: "tradicional",
  orig: "original",
  adob: "adobada",
  gde: "grande",
  ch: "chica",
  med: "mediana",
  reg: "regular",
  vain: "vainilla",
  choc: "chocolate",
  nat: "natural",
  // Marca en formatos de proveedor (ver nota del encabezado):
  tkt: "tecate",
  hei: "heineken",
  mb: "marlboro",
  roj: "roja",
};

// Palabras de CATEGORÍA/tipo genérico: si sobran de un lado no delatan variante
// ("jugo", "agua", "galletas"), así que NO penalizan en el score.
const TOKENS_GENERICOS: ReadonlySet<string> = new Set([
  "agua", "refresco", "soda", "jugo", "leche", "cerveza", "pan",
  "galleta", "galletas", "arroz", "frijol", "frijoles", "aceite", "cafe",
  "atun", "jabon", "shampoo", "papel", "crema", "huevo", "yogurt", "queso",
]);

// Palabras de PRESENTACIÓN cervecera (envase/tamaño): tampoco penalizan,
// pero por otra razón — el choque de presentación NO bloquea el empareje;
// lo maneja conflictoPresentacion DEGRADANDO a "sugerido" con nota humana
// ("ballena pacifico suave 940" sí es prima de "Bote Pacífico Suave 410ml",
// pero nadie aplica costos de una presentación sobre otra en silencio).
const TOKENS_ENVASE: ReadonlySet<string> = new Set([
  "ballena", "ballenon", "caguama", "mega", "bote", "laton", "cuartito",
  "lata",
]);

/** ¿Token de ruido? Además del set: números puros y códigos cortos de
 *  presentación del proveedor ("45g", "50p", "50x1", "gu2", "k6"). */
function esRuido(t: string): boolean {
  if (TOKEN_RUIDO.has(t)) return true;
  if (/^\d+(\.\d+)?$/.test(t)) return true;       // número suelto ("600", "1.5")
  if (/^[a-z]{1,2}\d+$/.test(t)) return true;      // letra(s)+número ("gu2", "k6", "x24")
  if (/^\d+[a-z]{1,2}\d*$/.test(t)) return true;   // número+letra(s) ("45g", "600ml", "50x1")
  return false;
}

/** Normaliza un nombre a tokens significativos: minúsculas, sin acentos,
 *  abreviaturas expandidas (lg→light) y sin ruido de empaque/unidad. */
export function normalizarNombre(texto: string): string[] {
  const limpio = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // marcas diacríticas (acentos)
    .replace(/[^a-z0-9ñ ]/g, " ");
  return limpio
    .split(/\s+/)
    .map((t) => ABREVIATURAS[t] ?? t)
    .filter((t) => t.length > 0 && !esRuido(t));
}

/** Clave canónica de un nombre de ticket para el diccionario de alias:
 *  los mismos tokens de normalizarNombre pero ORDENADOS y unidos con espacio
 *  ("Pacífico LG 940 ml" y "LG PACIFICO" dan la misma clave "light pacifico").
 *  Cadena vacía si el nombre no deja ningún token útil. */
export function normalizarClave(nombre: string): string {
  return [...normalizarNombre(nombre)].sort().join(" ");
}

/** Similitud entre dos tokens (0 a 1): igualdad, prefijo ("sabrita"/"sabritas")
 *  y coeficiente de bigramas para lo demás. */
function simToken(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)))
    return 0.85;
  if (a.length < 2 || b.length < 2) return 0;
  const bigramas = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const A = bigramas(a);
  const B = bigramas(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

const PENALIZACION_VARIANTE = 0.15;
const UMBRAL_SEGURO = 0.78;
const UMBRAL_SUGERIDO = 0.55;

/** Puntúa dos listas de tokens (0 a 1, puede bajar de 0 por penalización):
 *  contención del lado corto en el otro -> base alta; si no, fuzzy token a
 *  token promediado. Cada token que sobra de UN solo lado y no es categoría
 *  genérica resta 0.15 (penalización de variante); los tokens de ENVASE se
 *  excluyen de esa penalización: el choque de presentación degrada vía
 *  conflictoPresentacion, no bloquea el empareje. */
function puntuar(tA: string[], tB: string[]): number {
  const A = [...new Set(tA)];
  const B = [...new Set(tB)];
  if (!A.length || !B.length) return 0;
  const setA = new Set(A);
  const setB = new Set(B);
  const [corto, largo] = A.length <= B.length ? [A, B] : [B, A];
  const largoSet = new Set(largo);

  let base: number;
  const iguales = A.length === B.length && A.every((t) => setB.has(t));
  if (iguales) {
    base = 0.95;
  } else if (corto.every((t) => largoSet.has(t))) {
    base = 0.85; // contención estricta
  } else {
    const suma = corto.reduce(
      (s, t) => s + Math.max(...largo.map((u) => simToken(t, u))),
      0
    );
    base = suma / corto.length;
  }

  const sobrantes = [
    ...A.filter((t) => !setB.has(t)),
    ...B.filter((t) => !setA.has(t)),
  ].filter((t) => !TOKENS_GENERICOS.has(t) && !TOKENS_ENVASE.has(t));
  return base - sobrantes.length * PENALIZACION_VARIANTE;
}

export type EstadoEmpareje = "seguro" | "sugerido";

/** Una entrada del diccionario del negocio (alias_ticket): a qué producto
 *  apunta la clave y, si aplica, cuántas piezas trae el empaque recordado
 *  (null = pieza suelta). */
export type EntradaAlias = {
  productoId: string;
  piezasEmpaque: number | null;
};

export type Emparejamiento = {
  producto: Producto | null;
  estado: EstadoEmpareje | null; // null cuando no hubo match
  score: number;
  viaAlias?: boolean;            // true si lo resolvió el diccionario del negocio
  piezasEmpaqueRecordado?: number | null; // pack recordado por el alias (si hay)
  viaDiccionario?: boolean;      // true si el diccionario UNIVERSAL reconoció la línea
  diccionario?: EntradaDiccionario | null; // ficha curada (pre-relleno de producto nuevo)
  notaConflicto?: string | null; // presentación del ticket ≠ la del producto (degradado a sugerido)
};

/** Empareja por NOMBRE contra el catálogo, en TRES pasadas:
 *  1) Diccionario del negocio (aliasTicket): si hay alias y el producto sigue
 *     existiendo, es SEGURO de inmediato (score 1) — el tendero ya enseñó ese
 *     nombre, y si recordó que venía por pack, viaja en piezasEmpaqueRecordado.
 *     EXCEPCIÓN DE CONFLICTO: el alias confirmado MANDA aunque la presentación
 *     no coincida (si en SU tienda "latón" es el 410, se respeta).
 *  2) Diccionario UNIVERSAL de proveedores: si reconoce la línea y el nombre
 *     canónico coincide EXACTO (normalizado) con un producto local, es SEGURO
 *     (gana al fuzzy). NUNCA empareja por parecido: sin igualdad local, el
 *     flujo sigue al fuzzy con la ficha adjunta (pre-relleno de producto nuevo).
 *  3) Fuzzy por nombre (crudo y sugerido, mejor candidato). Umbrales:
 *     >= 0.78 -> seguro · 0.55–0.78 -> sugerido · < 0.55 -> null.
 *  CONFLICTO DE PRESENTACIÓN (pasadas 2 y 3): si el tamaño/envase que indica
 *  el ticket NO coincide con el que indica el nombre del producto local
 *  ("1 L" vs "355 ml"), el empareje DEGRADA a "sugerido" con notaConflicto:
 *  nunca se aplican costos de una presentación sobre otra en silencio. */
export function emparejarProducto(
  nombreCrudo: string,
  nombreSugerido: string,
  catalogo: Producto[],
  aliasMap?: Map<string, EntradaAlias>
): Emparejamiento {
  const textoLinea = `${nombreCrudo ?? ""} ${nombreSugerido ?? ""}`;
  // 1) Diccionario del negocio (memoria del dispositivo).
  if (aliasMap && aliasMap.size > 0) {
    for (const nombre of [nombreCrudo, nombreSugerido]) {
      const clave = normalizarClave(nombre);
      if (!clave) continue;
      const entrada = aliasMap.get(clave);
      if (!entrada) continue;
      const producto = catalogo.find((x) => x.id === entrada.productoId);
      if (producto) {
        return {
          producto,
          estado: "seguro",
          score: 1,
          viaAlias: true,
          piezasEmpaqueRecordado: entrada.piezasEmpaque,
        };
      }
      // Alias huérfano (producto borrado): se ignora y sigue el flujo.
    }
  }

  // 2) Diccionario universal de proveedores (después del alias del negocio,
  //    antes del fuzzy). Solo empareja por IGUALDAD NORMALIZADA con el
  //    canónico ("Bote Pacífico Light 355 ml" == "bote light pacifico");
  //    si no hay igualdad, la ficha viaja adjunta para pre-rellenar.
  const dic = buscarEnDiccionario(nombreCrudo, nombreSugerido);
  if (dic) {
    const claveCanon = normalizarClave(dic.nombre);
    if (claveCanon) {
      const igual = catalogo.find(
        (p) => normalizarClave(p.nombre) === claveCanon
      );
      if (igual) {
        // Conflicto de presentación: el ticket dice otro tamaño/envase que el
        // producto local → DEGRADA a sugerido (ámbar) con nota.
        const conf = conflictoPresentacion(textoLinea, igual.nombre);
        if (conf) {
          return {
            producto: igual,
            estado: "sugerido",
            score: 1,
            viaDiccionario: true,
            diccionario: dic,
            notaConflicto: conf,
          };
        }
        return {
          producto: igual,
          estado: "seguro",
          score: 1,
          viaDiccionario: true,
          diccionario: dic,
        };
      }
    }
  }

  // 3) Fuzzy por nombre.
  const candidatos = [normalizarNombre(nombreSugerido), normalizarNombre(nombreCrudo)];
  let mejor: { producto: Producto; score: number; comp: number } | null = null;
  let mejorScore = 0;

  for (const p of catalogo) {
    const tokensP = normalizarNombre(p.nombre);
    if (!tokensP.length) continue;
    for (const tokensT of candidatos) {
      if (!tokensT.length) continue;
      const score = puntuar(tokensT, tokensP);
      // Tokens compartidos exactos (desempate: a igual score gana el que
      // comparte MÁS tokens; sin esto "BOTE LG" empataba entre dos
      // presentaciones de la misma marca).
      const setP = new Set(tokensP);
      const comp = tokensT.reduce((n, t) => n + (setP.has(t) ? 1 : 0), 0);
      const diff = score - mejorScore;
      if (diff > 1e-9 || (Math.abs(diff) <= 1e-9 && mejor != null && comp > mejor.comp)) {
        mejorScore = score;
        mejor = { producto: p, score, comp };
      }
    }
  }

  if (!mejor || mejorScore < UMBRAL_SUGERIDO)
    return {
      producto: null,
      estado: null,
      score: mejorScore,
      viaDiccionario: !!dic,
      diccionario: dic,
    };
  // Conflicto de presentación también en el fuzzy: un "seguro" cuyo tamaño no
  // coincide con el del ticket DEGRADA a sugerido; si ya era sugerido, la
  // nota explica por qué conviene revisarlo.
  const confFuzzy = conflictoPresentacion(textoLinea, mejor.producto.nombre);
  return {
    producto: mejor.producto,
    estado:
      mejorScore >= UMBRAL_SEGURO && !confFuzzy ? "seguro" : "sugerido",
    score: mejorScore,
    viaDiccionario: !!dic,
    diccionario: dic,
    notaConflicto: confFuzzy,
  };
}

/** Empareja todas las líneas (alineado con `lineas`). Solo las de tipo
 *  "venta" entran al inventario. Un código de barras exacto siempre gana
 *  (estado seguro); si no, se va por nombre con emparejarProducto.
 *  `aliasMap` es el diccionario del negocio (cargarMapaAlias, opcional). */
export function emparejarLineas(
  lineas: LineaTicket[],
  productos: Producto[],
  aliasMap?: Map<string, EntradaAlias>
): Emparejamiento[] {
  return lineas.map((l) => {
    if (l.tipo !== "venta") return { producto: null, estado: null, score: 0 };
    const cb = l.codigo_barras?.trim();
    if (cb) {
      const cbUp = cb.toUpperCase();
      const exacto = productos.find(
        (p) => p.codigo_barras && p.codigo_barras.trim().toUpperCase() === cbUp
      );
      if (exacto) return { producto: exacto, estado: "seguro", score: 1 };
    }
    return emparejarProducto(l.nombre_crudo, l.nombre_sugerido, productos, aliasMap);
  });
}

// ---------------------------------------------------------------------------
// Config del escáner (umbrales, margen y redondeo configurables por el usuario)
// ---------------------------------------------------------------------------
//
// La PERSISTENCIA (tabla config) vive en escanerConfig.ts; aquí solo va la
// lógica PURA: defaults, rangos, clamps y mapeos, para probarla sin base.

/** Redondeo del precio sugerido, tal como lo elige el usuario:
 *  "50" = múltiplo de $0.50 · "100" = a $1.00 · "ninguno" = exacto. */
export type RedondeoEscaner = "50" | "100" | "ninguno";

/** Umbrales del aviso de cambio de costo (en %). */
export type UmbralesAviso = {
  avisoPct: number;   // variación mínima para aviso suave (ámbar)
  alertaPct: number;  // a partir de aquí es rojo y exige decisión
  irrealPct: number;  // arriba de esto se asume error de lectura (conservar)
};

export type ConfigEscaner = UmbralesAviso & {
  margenDefaultPct: number;     // % de ganancia para precio sugerido sin base
  redondeo: RedondeoEscaner;
};

/** Defaults calibrados para proveedores típicos en México. */
export const DEFAULT_CONFIG_ESCANER: ConfigEscaner = {
  avisoPct: 5,
  alertaPct: 15,
  irrealPct: 50,
  margenDefaultPct: 30,
  redondeo: "50",
};

/** Rangos permitidos en la UI y en los clamps. */
export const RANGOS_CONFIG_ESCANER = {
  avisoPct: { min: 2, max: 15 },
  alertaPct: { min: 5, max: 30 },
  irrealPct: { min: 30, max: 100 },
  margenDefaultPct: { min: 5, max: 100 },
} as const;

/** Sana una config parcial: aplica defaults, respeta rangos y mantiene la
 *  COHERENCIA de umbrales (alerta ≥ aviso+1, irreal ≥ alerta+1; el rango
 *  mínimo manda si chocan). Siempre devuelve una config completa y válida. */
export function sanarConfigEscaner(parcial: Partial<ConfigEscaner>): ConfigEscaner {
  const b = { ...DEFAULT_CONFIG_ESCANER, ...parcial };
  const clamp = (v: number, r: { min: number; max: number }) =>
    Math.min(r.max, Math.max(r.min, Math.round(v)));
  const avisoPct = clamp(b.avisoPct, RANGOS_CONFIG_ESCANER.avisoPct);
  const alertaPct = clamp(
    Math.max(b.alertaPct, avisoPct + 1),
    RANGOS_CONFIG_ESCANER.alertaPct
  );
  const irrealPct = clamp(
    Math.max(b.irrealPct, alertaPct + 1),
    RANGOS_CONFIG_ESCANER.irrealPct
  );
  return {
    avisoPct,
    alertaPct,
    irrealPct,
    margenDefaultPct: clamp(b.margenDefaultPct, RANGOS_CONFIG_ESCANER.margenDefaultPct),
    redondeo:
      b.redondeo === "100" || b.redondeo === "ninguno" ? b.redondeo : "50",
  };
}

// ---------------------------------------------------------------------------
// Aviso de cambio de costo (escalonado)
// ---------------------------------------------------------------------------

/** Umbrales POR DEFECTO (la config del usuario viaja como parámetro).
 *  Se conservan los nombres históricos: los usan los tests. */
export const UMBRAL_AVISO_PCT = DEFAULT_CONFIG_ESCANER.avisoPct;
export const UMBRAL_ROJO_PCT = DEFAULT_CONFIG_ESCANER.alertaPct;
export const UMBRAL_IRREAL_PCT = DEFAULT_CONFIG_ESCANER.irrealPct;

/** ninguno: sin cambio o cambio menor al umbral (informativo) ·
 *  aviso: ámbar (5–15 con defaults) · alerta: rojo, exige decisión (15–50) ·
 *  irreal: >50% en valor absoluto (parece error de lectura; conservar por
 *  defecto, NO bloquea). */
export type NivelAviso = "ninguno" | "aviso" | "alerta" | "irreal";

export type AvisoCosto = {
  nivel: NivelAviso;
  pct?: number; // cambio porcentual con signo (+ subió, - bajó)
};

export function nivelAvisoCosto(
  costoActualCentavos: number | null,
  costoNuevoCentavos: number,
  umbrales: UmbralesAviso = DEFAULT_CONFIG_ESCANER
): AvisoCosto {
  if (!costoActualCentavos || costoActualCentavos <= 0) return { nivel: "ninguno" };
  if (costoActualCentavos === costoNuevoCentavos) return { nivel: "ninguno" };
  const pct =
    ((costoNuevoCentavos - costoActualCentavos) / costoActualCentavos) * 100;
  const abs = Math.abs(pct);
  if (abs < umbrales.avisoPct) return { nivel: "ninguno", pct }; // informativo
  if (abs < umbrales.alertaPct) return { nivel: "aviso", pct };
  if (abs <= umbrales.irrealPct) return { nivel: "alerta", pct };
  return { nivel: "irreal", pct };
}

// ---------------------------------------------------------------------------
// Precio sugerido y redondeo
// ---------------------------------------------------------------------------

/** Sugiere precio de venta manteniendo el margen actual del producto.
 *  margen = (precio - costo) / precio  ->  sugerido = costoNuevo / (1 - margen)
 *  Sin base (producto nuevo o sin costo/precio): costo × (1 + margenDefaultPct/100)
 *  (margen de la config del escáner; 30% por defecto).
 *  Devuelve centavos SIN redondear (el redondeo es paso aparte). */
export function precioSugerido(
  costoNuevo: number,
  costoActual: number | null,
  precioActual: number,
  margenDefaultPct: number = DEFAULT_CONFIG_ESCANER.margenDefaultPct
): number {
  if (precioActual > 0 && costoActual != null && costoActual > 0) {
    const margen = (precioActual - costoActual) / precioActual;
    // Margen absurdo (>=95%) rompería la fórmula: cae al default.
    if (margen < 0.95) return costoNuevo / (1 - margen);
  }
  return costoNuevo * (1 + margenDefaultPct / 100);
}

export type ModoRedondeo = "exacto" | "50" | "90" | "entero";

/** Clave de config donde vive el modo elegido en Ajustes. */
export const CLAVE_REDONDEO = "ticket_redondeo";
export const REDONDEO_DEFECTO: ModoRedondeo = "50";

export const OPCIONES_REDONDEO: { id: ModoRedondeo; nombre: string; desc: string }[] = [
  { id: "exacto", nombre: "Exacto", desc: "El precio sugerido tal cual, al centavo" },
  { id: "50", nombre: "A .50", desc: "Múltiplo de 50 centavos más cercano ($18.50)" },
  { id: "90", nombre: "Terminado en .90", desc: "La terminación .90 más cercana ($18.90)" },
  { id: "entero", nombre: "Entero", desc: "Peso redondo más cercano ($19.00)" },
];

/** Valida lo leído de config (cualquier cosa rara cae al default). */
export function modoRedondeoValido(v: string | null): ModoRedondeo {
  return v === "exacto" || v === "50" || v === "90" || v === "entero"
    ? v
    : REDONDEO_DEFECTO;
}

/** De la opción del usuario ("50" | "100" | "ninguno") al modo interno. */
export function modoRedondeoDesdeConfig(r: RedondeoEscaner): ModoRedondeo {
  return r === "100" ? "entero" : r === "ninguno" ? "exacto" : "50";
}

/** Del modo interno guardado (ticket_redondeo heredado) a la opción del
 *  usuario; el modo "90" (ya no ofrecido) se aproxima a "50". */
export function redondeoDesdeModo(m: ModoRedondeo): RedondeoEscaner {
  return m === "entero" ? "100" : m === "exacto" ? "ninguno" : "50";
}

/** Redondea un precio (centavos) según el modo elegido. Si el resultado
 *  quedara por debajo del costo, sube un paso para no vender con pérdida. */
export function redondearPrecio(
  centavos: number,
  modo: ModoRedondeo,
  costoMinimo?: number
): number {
  let v: number;
  switch (modo) {
    case "exacto":
      v = Math.round(centavos);
      break;
    case "50":
      v = Math.round(centavos / 50) * 50;
      break;
    case "90": {
      // Terminaciones .90: 0.90, 1.90, 2.90... la más cercana.
      v = Math.round((centavos - 90) / 100) * 100 + 90;
      if (v < 90) v = 90;
      break;
    }
    case "entero":
      v = Math.round(centavos / 100) * 100;
      break;
  }
  // Nunca por debajo del costo: sube pasos hasta cubrirlo.
  const paso = modo === "exacto" ? 1 : modo === "50" ? 50 : 100;
  if (costoMinimo != null) {
    let guardia = 0;
    while (v < costoMinimo && guardia++ < 1000) v += paso;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Piezas que entran al inventario
// ---------------------------------------------------------------------------

/** Piezas reales que suma una línea: cantidad × piezas por empaque (1 si no hay). */
export function piezasQueEntran(linea: LineaTicket): number {
  return linea.cantidad * (linea.piezas_por_empaque ?? 1);
}

// ---------------------------------------------------------------------------
// Sospecha de empaque (pack) a partir del nombre
// ---------------------------------------------------------------------------

/** ¿Cuántas piezas trae el empaque según el nombre? Patrones típicos de
 *  ticket: "6PK", "6 PACK", "K6", "X6", "12 PZ", "4M". Devuelve el PRIMER
 *  número >1 y ≤48 que encuentre; null si no hay señal de pack.
 *  Cuidados: "940 ML", "355", "1 LT" NO disparan (son tamaño, no pack).
 *  Nota: "K6" no exige frontera antes de la K porque el ticket lo aplasta
 *  contra la marca ("SCLAENILNTK6"). "4M" (cuatro mil... no: 4-pack de la
 *  industria) se cubre con \b(\d{1,2})\s?m\b. */
export function extraerPiezasEmpaque(nombre: string): number | null {
  const PATRONES = [
    /(\d{1,2})\s?pack/i,   // "6 PACK", "4PACK"
    /(\d{1,2})\s?pk/i,     // "6PK"
    /k\s?(\d{1,2})\b/i,    // "K6", "…TK6"
    /\bx\s?(\d{1,2})\b/i,  // "X6"
    /(\d{1,2})\s?pz/i,     // "12 PZ", "24pzs"
    /\b(\d{1,2})\s?m\b/i,  // "4M" (formato pack; "940 ML" no: va pegado al 0)
  ];
  for (const re of PATRONES) {
    const m = nombre.match(re);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n > 1 && n <= 48) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Nombre bonito para productos nuevos
// ---------------------------------------------------------------------------
//
// El crudo del ticket ("BUD LIGHT 6 PACK HI CONE 24 330 ML") no sirve como
// nombre de catálogo. nombreBonito deja "Bud Light 330 ml".

/** Códigos internos / de empaque / material que se ELIMINAN del nombre
 *  (palabras puras; los alfanuméricos tipo "GU2" se detectan por patrón). */
const CODIGOS_NOMBRE: ReadonlySet<string> = new Set([
  // códigos de proveedor y de empaque
  "nrp", "rp", "nr", "tc", "ct", "ci", "hc", "h", "c", "r", "t",
  "div", "division", "mega", "hi", "cone",
  // empaque y material (no aportan al nombre del producto)
  "pack", "caja", "cajas", "paquete", "charola", "display",
  "pet", "vidrio", "plastico", "plastica", "retornable", "grabada",
  // conectores que no aportan
  "en", "de", "del", "el", "la", "las", "los", "al", "con", "para", "por", "y",
]);

const RE_NUMERO = /^\d+(?:[.,]\d+)?$/;
const RE_UNIDAD = /^(ml|lt|l|g|gr|kg|oz)$/i;
const RE_TAMANO_PEGADO = /^(\d+(?:[.,]\d+)?)(ml|lt|l|g|gr|kg|oz)$/i;
const RE_PACK_PEGADO = /^(\d{1,2}pk|k\d{1,2}|x\d{1,2})$/i;
const RE_MEZCLA_ALNUM = /^(?:[a-zñáéíóúü]+\d+|\d+[a-zñáéíóúü]+)$/i;

/** Unidad en su forma canónica (minúsculas; litros como "L"). */
function unidadCanonica(u: string): string {
  const m = u.toLowerCase();
  if (m === "lt" || m === "l") return "L";
  if (m === "gr") return "g";
  return m; // ml, g, kg, oz
}

/** Número de tamaño sin ceros de más: "1.00" → "1", "1.5" → "1.5". */
function numeroLimpio(s: string): string {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? String(n) : s;
}

/** Title Case suave: "PACIFICO" → "Pacifico", "Bud" → "Bud". */
function titleCase(palabra: string): string {
  const min = palabra.toLowerCase();
  return min.charAt(0).toUpperCase() + min.slice(1);
}

/** Nombre presentable para un producto nuevo. Parte del sugerido si existe y
 *  no es idéntico al crudo; si no, del crudo. Elimina códigos internos
 *  (NRP, TC, GU2…), números sueltos y tokens de pack (X6, 6PK, K6, PACK…);
 *  CONSERVA palabras normales y el tamaño con unidad ("600ML", "600 ml",
 *  "1.00L" → "1 L"). Resultado en Title Case con unidades en minúscula:
 *  "Powerade Moras 600 ml". Si no queda nada, devuelve el crudo tal cual
 *  (nunca inventa). */
export function nombreBonito(crudo: string, sugerido: string): string {
  const s = (sugerido ?? "").trim();
  const c = (crudo ?? "").trim();
  const fuente = s && s.toUpperCase() !== c.toUpperCase() ? s : c;

  const tokens = fuente
    .replace(/[^a-zA-Z0-9.,ñÑáéíóúÁÉÍÓÚüÜ ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const salida: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const sig = tokens[i + 1];

    // Tamaño pegado: "600ML", "1.00L".
    const pegado = t.match(RE_TAMANO_PEGADO);
    if (pegado) {
      salida.push(`${numeroLimpio(pegado[1])} ${unidadCanonica(pegado[2])}`);
      continue;
    }
    // Tamaño separado: "600 ml", "1.5 Lt".
    if (RE_NUMERO.test(t) && sig && RE_UNIDAD.test(sig)) {
      salida.push(`${numeroLimpio(t)} ${unidadCanonica(sig)}`);
      i++;
      continue;
    }
    // Pack separado: "6 PACK", "12 caja".
    if (RE_NUMERO.test(t) && sig && /^(pack|caja|cajas)$/i.test(sig)) {
      i++;
      continue;
    }
    if (RE_NUMERO.test(t)) continue;              // número suelto ("24", "12")
    if (RE_PACK_PEGADO.test(t)) continue;         // "6PK", "K6", "X6"
    if (CODIGOS_NOMBRE.has(t.toLowerCase())) continue; // "NRP", "TC", "HI"…
    if (t.length === 1) continue;                 // letra suelta
    if (RE_MEZCLA_ALNUM.test(t)) continue;        // "GU2", "4M", "50P"
    salida.push(titleCase(t));
  }

  return salida.length ? salida.join(" ") : (crudo ?? "");
}

// ---------------------------------------------------------------------------
// Costo por pieza (los tickets por caja traen el costo POR EMPAQUE)
// ---------------------------------------------------------------------------

/** Costo por PIEZA en centavos. Si el ticket vino por caja/pack
 *  (piezas_por_empaque > 1), el costo_unitario es POR EMPAQUE y hay que
 *  repartirlo; si no, ya es por pieza. null si la línea no trae costo. */
export function costoPorPiezaCentavos(linea: LineaTicket): number | null {
  const costo = linea.costo_unitario_centavos;
  if (costo == null) return null;
  const ppe = linea.piezas_por_empaque ?? 1;
  if (ppe > 1) return Math.round(costo / ppe);
  return costo;
}

// ---------------------------------------------------------------------------
// Markup (% de ganancia sobre costo) <-> precio
// ---------------------------------------------------------------------------

/** % de ganancia sobre costo: (precio − costo) / costo × 100, entero.
 *  null si no hay costo o precio con qué calcularlo. */
export function markupPct(
  costoCentavos: number | null,
  precioCentavos: number | null
): number | null {
  if (!costoCentavos || costoCentavos <= 0) return null;
  if (precioCentavos == null) return null;
  return Math.round(((precioCentavos - costoCentavos) / costoCentavos) * 100);
}

/** Precio a partir de un % de ganancia: costo × (1 + pct/100), ya redondeado
 *  según el modo configurado (y nunca por debajo del costo). */
export function precioDesdeMarkup(
  costoCentavos: number,
  pct: number,
  redondeo: ModoRedondeo
): number {
  return redondearPrecio(costoCentavos * (1 + pct / 100), redondeo, costoCentavos);
}

/** Recalcula al cambiar pieza↔pack (o el número de piezas del empaque).
 *  Del costo POR EMPAQUE saca el costo por pieza (÷ N; N≤1 = pieza suelta:
 *  el costo por pieza es el total del empaque) y, si hay % de ganancia
 *  vigente, el precio con la lógica de siempre (precioDesdeMarkup + redondeo
 *  configurado). precio = null cuando no hay % con qué calcularlo (el modal
 *  cae al precio sugerido por margen). Es el ÚNICO camino de cálculo: lo
 *  usan el toggle, la edición del número, el pack recordado por alias y el
 *  pack automático por sospecha. */
export function recalcularPorEmpaque(
  costoEmpaqueCentavos: number,
  piezasEmpaque: number,
  pct: number | null,
  redondeo: ModoRedondeo
): { costoPieza: number; precio: number | null } {
  const n = piezasEmpaque > 1 ? Math.round(piezasEmpaque) : 1;
  const costoPieza = Math.round(costoEmpaqueCentavos / n);
  return {
    costoPieza,
    precio: pct != null ? precioDesdeMarkup(costoPieza, pct, redondeo) : null,
  };
}

// ---------------------------------------------------------------------------
// Validación de la suma del ticket (con cambios físicos)
// ---------------------------------------------------------------------------

/** Importe de una línea: el leído del ticket o, si falta, cantidad × costo. */
export function importeLineaCentavos(l: LineaTicket): number {
  return l.importe_centavos ?? Math.round(l.cantidad * l.costo_unitario_centavos);
}

/** ¿La suma de las líneas cuadra con el total impreso?
 *  Con cambio físico el total del ticket es venta − cambio, así que cuadra si:
 *    |sumaVenta − total| ≤ tolerancia   O   |sumaVenta − sumaCambio − total| ≤ tolerancia
 *  Tolerancia: max(2 centavos, 1% del total).
 *  Devuelve null si el ticket no trajo total (no hay nada que validar). */
export function sumaCuadra(respuesta: RespuestaTicket): boolean | null {
  const total = respuesta.total_ticket_centavos;
  if (total == null || total <= 0) return null;
  const venta = respuesta.lineas
    .filter((l) => l.tipo === "venta")
    .reduce((s, l) => s + importeLineaCentavos(l), 0);
  const cambio = respuesta.lineas
    .filter((l) => l.tipo === "cambio")
    .reduce((s, l) => s + importeLineaCentavos(l), 0);
  const tolerancia = Math.max(2, Math.round(total * 0.01));
  return (
    Math.abs(venta - total) <= tolerancia ||
    Math.abs(venta - cambio - total) <= tolerancia
  );
}

// ---------------------------------------------------------------------------
// Ancla histórica de costo (100% local)
// ---------------------------------------------------------------------------
//
// El dispositivo recuerda los costos que el tendero CONFIRMÓ en tickets
// anteriores (tabla historial_costos). Al revisar un ticket nuevo, si el
// costo leído cae fuera del rango esperado según ese historial, se asume
// lectura dudosa: la línea arranca en "mantener" con una nota neutra, SIN
// alerta roja — el historial manda sobre los umbrales de la config.
// Si no hay historial (producto nuevo o nunca confirmado), manda la config.
//
// REGLA INQUEBRANTABLE (igual que siempre): ningún costo se aplica solo;
// el usuario decide línea por línea.

/** Margen del rango esperado: min del historial −15% · max del historial +15%. */
export const HIST_MARGEN_PCT = 15;

export type RangoEsperadoCosto = { min: number; max: number };

/** Rango esperado de costo a partir del historial confirmado (centavos).
 *  [min*(1−minPct/100), max*(1+maxPct/100)], redondeado a centavos enteros.
 *  null cuando no hay historial con qué anclar (historial vacío o sin
 *  costos positivos). */
export function rangoEsperadoCosto(
  historial: number[],
  config?: { minPct?: number; maxPct?: number }
): RangoEsperadoCosto | null {
  const validos = historial.filter((c) => Number.isFinite(c) && c > 0);
  if (!validos.length) return null;
  const minPct = config?.minPct ?? HIST_MARGEN_PCT;
  const maxPct = config?.maxPct ?? HIST_MARGEN_PCT;
  const minH = Math.min(...validos);
  const maxH = Math.max(...validos);
  return {
    min: Math.round(minH * (1 - minPct / 100)),
    max: Math.round(maxH * (1 + maxPct / 100)),
  };
}

export type DecisionCostoHistorial = "dentro" | "fuera" | "sin_historial";

/** ¿El costo leído del ticket cae dentro del rango histórico?
 *  "sin_historial" cuando no hay ancla (flujo normal con umbrales de config);
 *  "fuera" cuando queda por debajo del mínimo o por encima del máximo del
 *  rango (el tendero revisa, pero sin escándalo: la IA pudo leer mal). */
export function decisionCostoHistorial(
  costoLeido: number,
  historial: number[],
  umbrales?: { minPct?: number; maxPct?: number }
): DecisionCostoHistorial {
  const rango = rangoEsperadoCosto(historial, umbrales);
  if (!rango) return "sin_historial";
  return costoLeido < rango.min || costoLeido > rango.max ? "fuera" : "dentro";
}
