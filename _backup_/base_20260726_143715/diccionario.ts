// YvexPOS Móvil — Diccionario universal de proveedores (comercio mexicano).
//
// Datos curados UNIVERSALES: marcas y presentaciones que cualquier tiendita
// de México compra por ticket de proveedor. NADA específico de un negocio
// (la memoria del negocio vive aparte, en alias_ticket / perfil_producto).
//
// Cómo funciona el match:
//   1. FAMILIA (marca + variante): las `claves` ya vienen NORMALIZADAS igual
//      que normalizarClave de escaner.ts (tokens significativos, ordenados,
//      sin ruido). Una familia pega si TODOS los tokens de alguna clave están
//      en los tokens de la línea; gana la clave más larga (más específica).
//   2. PRESENTACIÓN (355 ml, ballena 940, mega 1.2 L...): se elige por
//      SEÑALES del texto crudo — tamaños pelados o con unidad, y conocimiento
//      cervecero verificado con tendero:
//        "ballena"  = botella retornable de 940 ml ("de a litro")
//        "ballenón" / "MEGA" = 1.2 L
//        "caguama"  = nombre regional de la ballena (~940 ml)
//        "bote"     = botella ~355 ml · "TC" junto a 355 no cambia nada
//   3. Botanas y pan llevan tamaño DINÁMICO: el del ticket si se alcanza a
//      leer ("60GRX36X1" → 60 g), si no, el tamaño típico de tiendita.
//
// IMPORTANTE (ciclo de imports): escaner.ts importa buscarEnDiccionario y
// este archivo importa normalizarNombre de escaner.ts. Es seguro porque
// AQUÍ solo se usa DENTRO de funciones (nunca al cargar el módulo).

import { normalizarNombre } from "./escaner";

// ---------------------------------------------------------------------------
// Contrato público
// ---------------------------------------------------------------------------

export type EntradaDiccionario = {
  claves: string[];              // claves normalizadas de la familia
  nombre: string;                // nombre canónico bonito, ej. "Bote Pacífico Light 355 ml"
  presentacion: string;          // "355 ml", "940 ml", "1.2 L", "60 g"
  piezasEmpaque: number | null;  // caja típica del proveedor (24, 12, 6...)
  departamento: string | null;   // sugerencia: "Cervezas", "Refrescos", "Botanas"...
};

// ---------------------------------------------------------------------------
// Estructura interna (familias con presentaciones y señales)
// ---------------------------------------------------------------------------

type PresentacionDic = {
  nombre?: string;        // nombre completo (bebidas: incluye presentación)
  nombreBase?: string;    // botanas/pan: base a la que se le pega el tamaño
  presentacion: string;   // default si es dinámico
  dinamico?: boolean;     // true: usa el tamaño del ticket si lo trae (gramos)
  piezasEmpaque: number | null;
  senalas: string[];      // señales del texto crudo que la eligen
  def?: boolean;          // presentación por defecto cuando no hay señal
};

type FamiliaDic = {
  claves: string[];
  departamento: string | null;
  presentaciones: PresentacionDic[];
};

// ---------------------------------------------------------------------------
// Detección de señales de presentación en el texto crudo
// ---------------------------------------------------------------------------

/** Extrae señales del texto: tamaños con unidad ("355ML", "1LT", "1.5 L"),
 *  tamaños pelados típicos de bebida ("940", "600"), gramajes ("45G",
 *  "60GRX36X1" → 60 g) y palabras cerveceras (mega, ballena, caguama, bote). */
function detectarSenalas(texto: string): Set<string> {
  const t = ` ${texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")} `;
  const s = new Set<string>();

  if (/\bmega\b/.test(t)) s.add("mega");
  if (/ballenon/.test(t)) s.add("ballenon"); // antes que "ballena" (la contiene)
  if (/ballena/.test(t)) s.add("ballena");
  if (/caguamita/.test(t)) s.add("620ml");
  if (/caguama/.test(t)) s.add("caguama");
  if (/\bbote\b/.test(t)) s.add("bote");
  if (/\blata\b/.test(t)) s.add("lata");

  // Mililitros explícitos: "355ML", "600 ml", "355cc".
  for (const m of t.matchAll(/(\d{2,4})\s?(?:ml|cm3|cc)\b/g)) {
    s.add(`${parseInt(m[1], 10)}ml`);
  }
  // Litros explícitos: "1LT", "1.5 LT", "2 L", "1.2L", "3 litros".
  for (const m of t.matchAll(/(\d(?:[.,]\d+)?)\s?(?:lts?|litros?)\b/g)) {
    s.add(`${m[1].replace(",", ".").replace(/\.?0+$/, "")}l`);
  }
  // Tamaños pelados típicos de bebida (sin unidad): "…PACIFICO 940…".
  for (const m of t.matchAll(/\b(235|325|330|355|473|500|600|620|650|940)\b/g)) {
    s.add(`${m[1]}ml`);
  }
  // Gramaje: "45G", "62 g", "60GRX36X1" (gr pegado a código de caja).
  for (const m of t.matchAll(/(\d{2,3})\s?(?:grs|gr|g)(?=[\s\d.,x]|$)/g)) {
    s.add(`${parseInt(m[1], 10)}g`);
  }
  return s;
}

/** El primer tamaño en gramos detectado (para presentaciones dinámicas). */
function gramosDetectados(senalas: Set<string>): string | null {
  for (const s of senalas) if (/^\d+g$/.test(s)) return s.replace("g", " g");
  return null;
}

// ---------------------------------------------------------------------------
// Familias curadas — CERVECERA (departamento "Cervezas")
// ---------------------------------------------------------------------------
//
// Empaques típicos: botes/latas de 355 → caja de 24 · 355 premium → 12 ·
// 473/620/650 → 24/12 · ballenas 940 → 12 · mega/ballenón 1.2 L → 6.
// Orden de presentaciones: primero las de señal más específica (mega antes
// que ballena, porque "ballenón" contiene "ballena"); `def` marca la típica.

const CERVEZAS = "Cervezas";

const FAMILIAS_CERVEZA: FamiliaDic[] = [
  {
    claves: ["clara pacifico", "pacifico"],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "Bote Pacífico Clara 355 ml", presentacion: "355 ml", piezasEmpaque: 24, senalas: ["355ml", "bote", "lata"], def: true },
      { nombre: "Mega Pacífico Clara 1.2 L", presentacion: "1.2 L", piezasEmpaque: 6, senalas: ["1.2l", "mega", "ballenon"] },
      { nombre: "Ballena Pacífico Clara 940 ml", presentacion: "940 ml", piezasEmpaque: 12, senalas: ["940ml", "ballena", "caguama", "1l"] },
    ],
  },
  {
    claves: ["light pacifico"],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "Bote Pacífico Light 355 ml", presentacion: "355 ml", piezasEmpaque: 24, senalas: ["355ml", "bote", "lata"], def: true },
      { nombre: "Mega Pacífico Light 1.2 L", presentacion: "1.2 L", piezasEmpaque: 6, senalas: ["1.2l", "mega", "ballenon"] },
      { nombre: "Ballena Pacífico Light 940 ml", presentacion: "940 ml", piezasEmpaque: 12, senalas: ["940ml", "ballena", "caguama", "1l"] },
    ],
  },
  {
    claves: ["corona extra", "corona", "coronita"],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "Corona Extra 355 ml", presentacion: "355 ml", piezasEmpaque: 24, senalas: ["355ml", "bote", "lata"], def: true },
      { nombre: "Mega Corona Extra 1.2 L", presentacion: "1.2 L", piezasEmpaque: 6, senalas: ["1.2l", "mega", "ballenon"] },
      { nombre: "Corona Extra 620 ml", presentacion: "620 ml", piezasEmpaque: 12, senalas: ["620ml"] },
      { nombre: "Ballena Corona Extra 940 ml", presentacion: "940 ml", piezasEmpaque: 12, senalas: ["940ml", "ballena", "caguama", "1l"] },
    ],
  },
  {
    claves: ["especial modelo", "esp modelo", "modelo"],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "Modelo Especial 355 ml", presentacion: "355 ml", piezasEmpaque: 12, senalas: ["355ml", "bote", "lata"], def: true },
      { nombre: "Mega Modelo Especial 1.2 L", presentacion: "1.2 L", piezasEmpaque: 6, senalas: ["1.2l", "mega", "ballenon"] },
      { nombre: "Ballena Modelo Especial 940 ml", presentacion: "940 ml", piezasEmpaque: 12, senalas: ["940ml", "ballena", "caguama", "1l"] },
    ],
  },
  {
    claves: ["modelo negra"],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "Negra Modelo 355 ml", presentacion: "355 ml", piezasEmpaque: 12, senalas: ["355ml", "bote", "lata"], def: true },
    ],
  },
  {
    claves: ["victoria"],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "Bote Victoria 355 ml", presentacion: "355 ml", piezasEmpaque: 24, senalas: ["355ml", "bote", "lata"], def: true },
      { nombre: "Mega Victoria 1.2 L", presentacion: "1.2 L", piezasEmpaque: 6, senalas: ["1.2l", "mega", "ballenon"] },
      { nombre: "Ballena Victoria 940 ml", presentacion: "940 ml", piezasEmpaque: 12, senalas: ["940ml", "ballena", "caguama", "1l"] },
    ],
  },
  {
    claves: ["leon"],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "Ballena León 940 ml", presentacion: "940 ml", piezasEmpaque: 12, senalas: ["940ml", "ballena", "caguama", "1l"], def: true },
    ],
  },
  {
    claves: ["montejo"],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "Bote Montejo 355 ml", presentacion: "355 ml", piezasEmpaque: 24, senalas: ["355ml", "bote", "lata"], def: true },
      { nombre: "Ballena Montejo 940 ml", presentacion: "940 ml", piezasEmpaque: 12, senalas: ["940ml", "ballena", "caguama", "1l"] },
    ],
  },
  {
    claves: ["tecate", "roja tecate", "original tecate"],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "Tecate Original 355 ml", presentacion: "355 ml", piezasEmpaque: 24, senalas: ["355ml", "bote", "lata"], def: true },
      { nombre: "Tecate Original 473 ml", presentacion: "473 ml", piezasEmpaque: 24, senalas: ["473ml"] },
      { nombre: "Ballena Tecate Original 940 ml", presentacion: "940 ml", piezasEmpaque: 12, senalas: ["940ml", "ballena", "caguama", "1l"] },
    ],
  },
  {
    claves: ["light tecate"],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "Tecate Light 355 ml", presentacion: "355 ml", piezasEmpaque: 24, senalas: ["355ml", "bote", "lata"], def: true },
      { nombre: "Tecate Light 473 ml", presentacion: "473 ml", piezasEmpaque: 24, senalas: ["473ml"] },
      { nombre: "Ballena Tecate Light 940 ml", presentacion: "940 ml", piezasEmpaque: 12, senalas: ["940ml", "ballena", "caguama", "1l"] },
    ],
  },
  {
    claves: ["heineken"],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "Heineken 355 ml", presentacion: "355 ml", piezasEmpaque: 12, senalas: ["355ml", "bote", "lata"], def: true },
      { nombre: "Heineken 650 ml", presentacion: "650 ml", piezasEmpaque: 12, senalas: ["650ml"] },
    ],
  },
  {
    claves: ["bud light"],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "Bud Light 330 ml", presentacion: "330 ml", piezasEmpaque: 24, senalas: ["330ml"], def: true },
      { nombre: "Bud Light 355 ml", presentacion: "355 ml", piezasEmpaque: 24, senalas: ["355ml", "bote", "lata"] },
      { nombre: "Bud Light 473 ml", presentacion: "473 ml", piezasEmpaque: 24, senalas: ["473ml"] },
    ],
  },
  {
    claves: ["budweiser"],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "Budweiser 355 ml", presentacion: "355 ml", piezasEmpaque: 24, senalas: ["355ml", "bote", "lata"], def: true },
    ],
  },
  {
    claves: ["lager xx", "dos equis"],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "XX Lager 355 ml", presentacion: "355 ml", piezasEmpaque: 24, senalas: ["355ml", "bote", "lata"], def: true },
      { nombre: "Ballena XX Lager 940 ml", presentacion: "940 ml", piezasEmpaque: 12, senalas: ["940ml", "ballena", "caguama", "1l"] },
    ],
  },
  {
    claves: ["ambar xx", "ambar dos equis"],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "XX Ámbar 355 ml", presentacion: "355 ml", piezasEmpaque: 12, senalas: ["355ml", "bote", "lata"], def: true },
      { nombre: "Ballena XX Ámbar 940 ml", presentacion: "940 ml", piezasEmpaque: 12, senalas: ["940ml", "ballena", "caguama", "1l"] },
    ],
  },
  {
    claves: ["barrilito"],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "Barrilito 325 ml", presentacion: "325 ml", piezasEmpaque: 24, senalas: ["325ml"], def: true },
    ],
  },
];

// ---------------------------------------------------------------------------
// Familias curadas — COCA-COLA / FEMSA
// ---------------------------------------------------------------------------

const REFRESCOS = "Refrescos";

const FAMILIAS_FEMSA: FamiliaDic[] = [
  {
    claves: ["coca cola", "coke", "coca"],
    departamento: REFRESCOS,
    presentaciones: [
      { nombre: "Coca-Cola 600 ml", presentacion: "600 ml", piezasEmpaque: null, senalas: ["600ml"], def: true },
      { nombre: "Coca-Cola 235 ml", presentacion: "235 ml", piezasEmpaque: null, senalas: ["235ml"] },
      { nombre: "Coca-Cola 355 ml", presentacion: "355 ml", piezasEmpaque: null, senalas: ["355ml"] },
      { nombre: "Coca-Cola 500 ml", presentacion: "500 ml", piezasEmpaque: null, senalas: ["500ml"] },
      { nombre: "Coca-Cola 1.5 L", presentacion: "1.5 L", piezasEmpaque: null, senalas: ["1.5l"] },
      { nombre: "Coca-Cola 2 L", presentacion: "2 L", piezasEmpaque: null, senalas: ["2l"] },
      { nombre: "Coca-Cola 2.5 L", presentacion: "2.5 L", piezasEmpaque: null, senalas: ["2.5l"] },
      { nombre: "Coca-Cola 3 L", presentacion: "3 L", piezasEmpaque: null, senalas: ["3l"] },
    ],
  },
  {
    claves: ["azucar coca cola sin"],
    departamento: REFRESCOS,
    presentaciones: [
      { nombre: "Coca-Cola Sin Azúcar 600 ml", presentacion: "600 ml", piezasEmpaque: null, senalas: ["600ml"], def: true },
      { nombre: "Coca-Cola Sin Azúcar 355 ml", presentacion: "355 ml", piezasEmpaque: null, senalas: ["355ml"] },
    ],
  },
  {
    claves: ["fanta"],
    departamento: REFRESCOS,
    presentaciones: [
      { nombre: "Fanta 600 ml", presentacion: "600 ml", piezasEmpaque: null, senalas: ["600ml"], def: true },
      { nombre: "Fanta 355 ml", presentacion: "355 ml", piezasEmpaque: null, senalas: ["355ml"] },
      { nombre: "Fanta 2 L", presentacion: "2 L", piezasEmpaque: null, senalas: ["2l"] },
    ],
  },
  {
    claves: ["sprite"],
    departamento: REFRESCOS,
    presentaciones: [
      { nombre: "Sprite 600 ml", presentacion: "600 ml", piezasEmpaque: null, senalas: ["600ml"], def: true },
      { nombre: "Sprite 355 ml", presentacion: "355 ml", piezasEmpaque: null, senalas: ["355ml"] },
      { nombre: "Sprite 2 L", presentacion: "2 L", piezasEmpaque: null, senalas: ["2l"] },
    ],
  },
  {
    claves: ["fresca"],
    departamento: REFRESCOS,
    presentaciones: [
      { nombre: "Fresca 600 ml", presentacion: "600 ml", piezasEmpaque: null, senalas: ["600ml"], def: true },
      { nombre: "Fresca 355 ml", presentacion: "355 ml", piezasEmpaque: null, senalas: ["355ml"] },
    ],
  },
  {
    claves: ["mundet sidral", "sidral"],
    departamento: REFRESCOS,
    presentaciones: [
      { nombre: "Sidral Mundet 600 ml", presentacion: "600 ml", piezasEmpaque: null, senalas: ["600ml"], def: true },
      { nombre: "Sidral Mundet 355 ml", presentacion: "355 ml", piezasEmpaque: null, senalas: ["355ml"] },
    ],
  },
  {
    claves: ["ciel"],
    departamento: "Aguas",
    presentaciones: [
      { nombre: "Ciel 600 ml", presentacion: "600 ml", piezasEmpaque: null, senalas: ["600ml"], def: true },
      { nombre: "Ciel 1.5 L", presentacion: "1.5 L", piezasEmpaque: null, senalas: ["1.5l"] },
    ],
  },
  {
    claves: ["powerade"],
    departamento: REFRESCOS,
    presentaciones: [
      { nombre: "Powerade 600 ml", presentacion: "600 ml", piezasEmpaque: null, senalas: ["600ml"], def: true },
      { nombre: "Powerade 1 L", presentacion: "1 L", piezasEmpaque: null, senalas: ["1l"] },
    ],
  },
  {
    // "del" es ruido en la normalización: la clave real es solo "valle".
    claves: ["valle"],
    departamento: "Jugos",
    presentaciones: [
      { nombre: "Jugo Del Valle 1 L", presentacion: "1 L", piezasEmpaque: null, senalas: ["1l"], def: true },
    ],
  },
  {
    claves: ["clara santa"],
    departamento: "Lácteos",
    presentaciones: [
      { nombre: "Leche Santa Clara 1 L", presentacion: "1 L", piezasEmpaque: null, senalas: ["1l"], def: true },
    ],
  },
];

// ---------------------------------------------------------------------------
// Familias curadas — SABRITAS (tamaño dinámico: el del ticket si se lee)
// ---------------------------------------------------------------------------

const BOTANAS = "Botanas";

const FAMILIAS_SABRITAS: FamiliaDic[] = [
  {
    claves: ["original sabritas", "sabritas"],
    departamento: BOTANAS,
    presentaciones: [
      { nombreBase: "Sabritas Original", presentacion: "45 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["limon sabritas"],
    departamento: BOTANAS,
    presentaciones: [
      { nombreBase: "Sabritas Limón", presentacion: "45 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["adobadas sabritas"],
    departamento: BOTANAS,
    presentaciones: [
      { nombreBase: "Sabritas Adobadas", presentacion: "45 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["rancheritos"],
    departamento: BOTANAS,
    presentaciones: [
      { nombreBase: "Rancheritos", presentacion: "58 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["cheetos torciditos"],
    departamento: BOTANAS,
    presentaciones: [
      { nombreBase: "Cheetos Torciditos", presentacion: "52 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["cheetos poffets"],
    departamento: BOTANAS,
    presentaciones: [
      { nombreBase: "Cheetos Poffets", presentacion: "45 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["doritos nacho", "doritos"],
    departamento: BOTANAS,
    presentaciones: [
      { nombreBase: "Doritos Nacho", presentacion: "61 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["fuego takis", "takis"],
    departamento: BOTANAS,
    presentaciones: [
      { nombreBase: "Takis Fuego", presentacion: "56 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["takis xplosion"],
    departamento: BOTANAS,
    presentaciones: [
      { nombreBase: "Takis Xplosion", presentacion: "56 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["chorizo fritos"],
    departamento: BOTANAS,
    presentaciones: [
      { nombreBase: "Fritos Chorizo", presentacion: "50 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["fritos limon sal", "fritos limon"],
    departamento: BOTANAS,
    presentaciones: [
      { nombreBase: "Fritos Limón y Sal", presentacion: "50 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["churrumais"],
    departamento: BOTANAS,
    presentaciones: [
      { nombreBase: "Churrumais", presentacion: "55 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["crujitos"],
    departamento: BOTANAS,
    presentaciones: [
      { nombreBase: "Crujitos", presentacion: "55 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["queso ruffles", "ruffles"],
    departamento: BOTANAS,
    presentaciones: [
      { nombreBase: "Ruffles Queso", presentacion: "48 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
];

// ---------------------------------------------------------------------------
// Familias curadas — BIMBO / MARINELA (tamaño dinámico)
// ---------------------------------------------------------------------------

const PAN = "Pan";

const FAMILIAS_BIMBO: FamiliaDic[] = [
  {
    claves: ["nito"],
    departamento: PAN,
    presentaciones: [
      { nombreBase: "Nito Bimbo", presentacion: "62 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["rebanadas"],
    departamento: PAN,
    presentaciones: [
      { nombreBase: "Rebanadas Bimbo", presentacion: "2 pzs", dinamico: false, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["canela roles"],
    departamento: PAN,
    presentaciones: [
      { nombreBase: "Roles de Canela Bimbo", presentacion: "2 pzs", dinamico: false, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["chocoroles"],
    departamento: PAN,
    presentaciones: [
      { nombreBase: "Chocoroles Bimbo", presentacion: "2 pzs", dinamico: false, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["donitas espolvoreadas"],
    departamento: PAN,
    presentaciones: [
      { nombreBase: "Donitas Espolvoreadas Bimbo", presentacion: "4 pzs", dinamico: false, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["azucaradas donitas"],
    departamento: PAN,
    presentaciones: [
      { nombreBase: "Donitas Azucaradas Bimbo", presentacion: "4 pzs", dinamico: false, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["blanco pan"],
    departamento: PAN,
    presentaciones: [
      { nombreBase: "Pan Blanco Bimbo", presentacion: "620 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["integral pan"],
    departamento: PAN,
    presentaciones: [
      { nombreBase: "Pan Integral Bimbo", presentacion: "620 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["mantecadas"],
    departamento: PAN,
    presentaciones: [
      { nombreBase: "Mantecadas Bimbo", presentacion: "2 pzs", dinamico: false, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["barritas"],
    departamento: PAN,
    presentaciones: [
      { nombreBase: "Barritas Bimbo", presentacion: "75 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["gansito"],
    departamento: PAN,
    presentaciones: [
      { nombreBase: "Gansito Marinela", presentacion: "50 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    // "CHOC ROLE" normaliza a "chocolate role" (ABREVIATURAS choc→chocolate).
    claves: ["choco roles", "chocolate role"],
    departamento: PAN,
    presentaciones: [
      { nombreBase: "Choco Roles Marinela", presentacion: "2 pzs", dinamico: false, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["pinguinos"],
    departamento: PAN,
    presentaciones: [
      { nombreBase: "Pingüinos Marinela", presentacion: "2 pzs", dinamico: false, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
];

// ---------------------------------------------------------------------------
// Resolver público
// ---------------------------------------------------------------------------

/** Todas las familias curadas (se exporta para inspección y pruebas). */
export const FAMILIAS_DICCIONARIO: readonly FamiliaDic[] = [
  ...FAMILIAS_CERVEZA,
  ...FAMILIAS_FEMSA,
  ...FAMILIAS_SABRITAS,
  ...FAMILIAS_BIMBO,
];

/** Elige la presentación dentro de la familia: la primera cuyas señales
 *  aparezcan en el texto; si ninguna pega, la marcada `def` (la típica). */
function elegirPresentacion(
  fam: FamiliaDic,
  senalas: Set<string>
): PresentacionDic {
  for (const p of fam.presentaciones) {
    if (p.senalas.some((x) => senalas.has(x))) return p;
  }
  return fam.presentaciones.find((p) => p.def) ?? fam.presentaciones[0];
}

/** Reconoce una línea de ticket contra el diccionario universal.
 *  Devuelve la entrada con nombre canónico, presentación, pack típico y
 *  departamento sugerido; null si ninguna familia la reconoce (NO inventa
 *  nada: lo que no está curado, no existe para el diccionario). */
export function buscarEnDiccionario(
  nombreCrudo: string,
  nombreSugerido: string
): EntradaDiccionario | null {
  const tokens = new Set([
    ...normalizarNombre(nombreCrudo ?? ""),
    ...normalizarNombre(nombreSugerido ?? ""),
  ]);
  if (!tokens.size) return null;

  // Familia ganadora: la clave MÁS LARGA (más específica) que quepa en los
  // tokens de la línea. "light pacifico" (2) gana a "pacifico" (1).
  let mejor: { fam: FamiliaDic; n: number } | null = null;
  for (const fam of FAMILIAS_DICCIONARIO) {
    for (const clave of fam.claves) {
      const ct = clave.split(" ");
      if (ct.length > (mejor?.n ?? 0) && ct.every((t) => tokens.has(t))) {
        mejor = { fam, n: ct.length };
      }
    }
  }
  if (!mejor) return null;

  const senalas = detectarSenalas(`${nombreCrudo ?? ""} ${nombreSugerido ?? ""}`);
  const p = elegirPresentacion(mejor.fam, senalas);

  // Presentación dinámica (botanas/pan): el gramaje del ticket si se leyó.
  let pres = p.presentacion;
  if (p.dinamico) pres = gramosDetectados(senalas) ?? p.presentacion;
  const nombre = p.nombre ?? `${p.nombreBase} ${pres}`;

  return {
    claves: [...mejor.fam.claves],
    nombre,
    presentacion: pres,
    piezasEmpaque: p.piezasEmpaque,
    departamento: mejor.fam.departamento,
  };
}
