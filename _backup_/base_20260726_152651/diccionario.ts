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

  // Mililitros explícitos: "355ML", "600 ml",  "355cc".
  for (const m of t.matchAll(/(\d{2,4})\s?(?:ml|cm3|cc)\b/g)) {
    s.add(`${parseInt(m[1], 10)}ml`);
  }
  // Litros explícitos: "1LT", "1.5 LT", "2 L", "1.2L", "3 litros".
  for (const m of t.matchAll(/(\d(?:[.,]\d+)?)\s?(?:lts?|litros?)\b/g)) {
    s.add(`${m[1].replace(",", ".").replace(/\.?0+$/, "")}l`);
  }
  // Empaque cervecero PEGADO al tamaño (formatos de distribuidora):
  // "CAG940" → 940 ml, "CAG.1.2" → 1.2 L, "LAT473M" → 473, "CUAR190" → 190.
  for (const m of t.matchAll(/\b(?:cag|lat|cuar)\W*?(\d{3}|\d(?:[.,]\d+)?)/g)) {
    const n = m[1].replace(",", ".");
    // Con separador decimal o valor chico → litros ("1.2" → 1.2l); si no, ml.
    if (/[.,]/.test(m[1]) || parseFloat(n) < 10) s.add(`${n.replace(/\.?0+$/, "")}l`);
    else s.add(`${parseInt(n, 10)}ml`);
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
      // "TKT.ROJ.CAG.1.2" → señala 1.2l (cag pegado); va antes que la 940.
      { nombre: "Tecate Original Caguama 1.2 L", presentacion: "1.2 L", piezasEmpaque: 12, senalas: ["1.2l", "mega", "ballenon"] },
      // "TKT.ROJ.CAG940" → señala 940ml (cag pegado) cae aquí.
      { nombre: "Ballena Tecate Original 940 ml", presentacion: "940 ml", piezasEmpaque: 12, senalas: ["940ml", "ballena", "caguama", "1l"] },
    ],
  },
  {
    // "lt" y "cc" son TOKEN_RUIDO (litro/cm3) y nunca llegan a los tokens,
    // así que los formatos TKT.LT.* se reconocen por el token PEGADO que sí
    // sobrevive: "cag", "cag940", "lat473m", "cuar190". Empate n=2 con
    // "roja tecate" (línea roja 1.2/940): gana la Original por ir primero.
    claves: [
      "light tecate",
      "cag tecate",
      "cag940 tecate",
      "lat473m tecate",
      "cuar190 tecate",
    ],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "Tecate Light 355 ml", presentacion: "355 ml", piezasEmpaque: 24, senalas: ["355ml", "bote", "lata"], def: true },
      // "TKT.LT.CUAR190" → señala 190ml (cuar pegado).
      { nombre: "Tecate Light Cuartito 190 ml", presentacion: "190 ml", piezasEmpaque: null, senalas: ["190ml"] },
      // "TKT.LT.LAT473M" → señala 473ml (lat pegado).
      { nombre: "Tecate Light Lata 473 ml", presentacion: "473 ml", piezasEmpaque: 24, senalas: ["473ml"] },
      // "TKT.LT.CAG.1.2" → señala 1.2l; va antes que la ballena.
      { nombre: "Tecate Light Caguama 1.2 L", presentacion: "1.2 L", piezasEmpaque: 12, senalas: ["1.2l", "mega", "ballenon"] },
      { nombre: "Ballena Tecate Light 940 ml", presentacion: "940 ml", piezasEmpaque: 12, senalas: ["940ml", "ballena", "caguama", "1l"] },
    ],
  },
  {
    // Indio: la mega retornable de 1.2 L es la presentación de tiendita.
    // "IND.MEG.RET1.2" no deja señal (tamaño pegado sin unidad) → def.
    claves: ["ind meg", "indio"],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "Indio Mega Retornable 1.2 L", presentacion: "1.2 L", piezasEmpaque: 12, senalas: ["1.2l", "mega", "ballenon"], def: true },
    ],
  },
  {
    // "BOH.OBS.NR355M" → tokens boh/obs; sin señal → def 355 NR.
    claves: ["boh obs", "bohemia obscura", "bohemia"],
    departamento: CERVEZAS,
    presentaciones: [
      { nombre: "Bohemia Obscura 355 ml", presentacion: "355 ml", piezasEmpaque: 12, senalas: ["355ml"], def: true },
    ],
  },
  {
    // "HEI.LT.NR.355M" → solo sobrevive "heineken" (hei→heineken; "lt" es
    // TOKEN_RUIDO); sin señal de tamaño → def 355. NR = no retornable.
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
    // "XX.LAG.6P.355M" → tokens xx/lag; sin señal → def 355 (caja 24).
    claves: ["lager xx", "dos equis", "lag xx"],
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
      { nombre: "Coca-Cola Sin Azúcar 2.5 L", presentacion: "2.5 L", piezasEmpaque: null, senalas: ["2.5l"] },
    ],
  },
  {
    // Formato ARCA "CC SIN AZUCAR25": "cc" es TOKEN_RUIDO y "azucar25" queda
    // pegado (no produce el token "azucar") → clave con el token que sobrevive;
    // no deja señal de tamaño → familia dedicada con def 2.5 L.
    claves: ["azucar25 sin"],
    departamento: REFRESCOS,
    presentaciones: [
      { nombre: "Coca-Cola Sin Azúcar 2.5 L", presentacion: "2.5 L", piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    // Topo Chico (Arca): agua mineral; "TOPO CHICO 355M" no deja señal → def.
    claves: ["chico topo", "topo"],
    departamento: "Aguas",
    presentaciones: [
      { nombre: "Topo Chico 355 ml", presentacion: "355 ml", piezasEmpaque: null, senalas: ["355ml"], def: true },
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
    // "SIDRAL MUNDET60" → tokens sidral/mundet60 ("mundet60" pega con la
    // clave exacta; "sidral" sola también la reconoce). Sin señal → def 600.
    claves: ["mundet sidral", "sidral", "mundet60 sidral", "mundet60"],
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
    // "STA CLARA ENT1L" → tokens sta/clara ("sta" ≠ "santa") + señala 1l.
    claves: ["clara santa", "clara sta"],
    departamento: "Lácteos",
    presentaciones: [
      { nombre: "Leche Santa Clara 1 L", presentacion: "1 L", piezasEmpaque: null, senalas: ["1l"], def: true },
    ],
  },
];

// ---------------------------------------------------------------------------
// Familias curadas — LALA (departamento "Lácteos")
// ---------------------------------------------------------------------------
//
// Se venden por pieza: piezasEmpaque null en todo EXCEPTO la caja 12 × 1 L
// de Leche Lala Entera ("LALA.ENT.12/1L"), que sí es empaque del proveedor.

const LACTEOS = "Lácteos";

const FAMILIAS_LALA: FamiliaDic[] = [
  {
    // "LALA.ENT.12/1L" → tokens lala/ent + señala 1l. La Entera es la leche
    // base: también responde a "lala" sola (gana la clave larga si hay más).
    claves: ["ent lala", "entera lala", "lala"],
    departamento: LACTEOS,
    presentaciones: [
      { nombre: "Leche Lala Entera 1 L", presentacion: "1 L", piezasEmpaque: 12, senalas: ["1l"], def: true },
    ],
  },
  {
    claves: ["desl lala", "deslactosada lala"],
    departamento: LACTEOS,
    presentaciones: [
      { nombre: "Leche Lala Deslactosada 1 L", presentacion: "1 L", piezasEmpaque: null, senalas: ["1l"], def: true },
    ],
  },
  {
    claves: ["crema lala"],
    departamento: LACTEOS,
    presentaciones: [
      { nombre: "Crema Lala 200 ml", presentacion: "200 ml", piezasEmpaque: null, senalas: ["200ml"], def: true },
      { nombre: "Crema Lala Cubeta 4 L", presentacion: "4 L", piezasEmpaque: null, senalas: ["4l"] },
    ],
  },
  {
    // Sabores: tamaño dinámico como las botanas (default el bote de 220 g).
    claves: ["lala yogurt", "lala yogur"],
    departamento: LACTEOS,
    presentaciones: [
      { nombreBase: "Yogurt Lala Bote", presentacion: "220 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["beb lactea", "bebida lactea"],
    departamento: LACTEOS,
    presentaciones: [
      { nombre: "Bebida Láctea Lala 220 ml", presentacion: "220 ml", piezasEmpaque: null, senalas: ["220ml"], def: true },
    ],
  },
];

// ---------------------------------------------------------------------------
// Familias curadas — CIGARROS (departamento "Cigarros")
// ---------------------------------------------------------------------------
//
// PMI/BAT: la venta es por CAJETILLA (piezasEmpaque null — el diccionario es
// respaldo por nombre; si la línea trae EAN, el código de barras gana antes).

const CIGARROS = "Cigarros";

const FAMILIAS_CIGARROS: FamiliaDic[] = [
  {
    // "MB.GLD14S" → tokens marlboro/gld14s (mb→marlboro).
    claves: ["gld14s marlboro", "gold marlboro"],
    departamento: CIGARROS,
    presentaciones: [
      { nombre: "Marlboro Gold 14", presentacion: "cajetilla 14", piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    // Entrada base Marlboro: el Rojo KS es el de mayor rotación; "MB.*" sin
    // variante reconocible cae aquí. "MB.KS.B20" → ks ("b20" es ruido) y
    // "MB.RED20S" → red20s.
    claves: ["ks marlboro", "marlboro red20s", "marlboro rojo", "marlboro"],
    departamento: CIGARROS,
    presentaciones: [
      { nombre: "Marlboro Rojo KS Box 20", presentacion: "cajetilla 20", piezasEmpaque: null, senalas: [], def: true },
    ],
  },
];

// ---------------------------------------------------------------------------
// Familias curadas — GAMESA (departamento "Galletas")
// ---------------------------------------------------------------------------

const GALLETAS = "Galletas";

const FAMILIAS_GAMESA: FamiliaDic[] = [
  {
    // "MARIAS GAMESA170G" → tokens marias/gamesa170g + gramaje dinámico 170.
    claves: ["gamesa marias", "marias"],
    departamento: GALLETAS,
    presentaciones: [
      { nombreBase: "Marías Gamesa", presentacion: "170 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["chocolate emperador", "emperador"],
    departamento: GALLETAS,
    presentaciones: [
      { nombreBase: "Emperador Chocolate", presentacion: "101 g", dinamico: true, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    // Surtido Rico se compra como CAJA suelta (es la unidad de venta).
    claves: ["rico surtido"],
    departamento: GALLETAS,
    presentaciones: [
      { nombre: "Surtido Rico Gamesa (caja)", presentacion: "caja", piezasEmpaque: null, senalas: [], def: true },
    ],
  },
];

// ---------------------------------------------------------------------------
// Familias curadas — SIGMA / FUD (departamento "Carnes frías")
// ---------------------------------------------------------------------------
//
// Se venden POR KILO: EntradaDiccionario no tiene campo unidad, así que el
// "kg" queda en la nota del nombre/presentación (piezasEmpaque null siempre).

const CARNES = "Carnes frías";

const FAMILIAS_FUD: FamiliaDic[] = [
  {
    // "JAM PAVO FUD VAK" → tokens jam/pavo/fud/vak.
    claves: ["fud jam pavo", "fud pavo"],
    departamento: CARNES,
    presentaciones: [
      { nombre: "Jamón de Pavo FUD (kg)", presentacion: "kg", piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["fud salchicha viena", "fud salchicha", "fud viena"],
    departamento: CARNES,
    presentaciones: [
      { nombre: "Salchicha Viena FUD (kg)", presentacion: "kg", piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["fud oaxaca queso", "fud oaxaca"],
    departamento: CARNES,
    presentaciones: [
      { nombre: "Queso Oaxaca FUD 400 g", presentacion: "400 g", piezasEmpaque: null, senalas: ["400g"], def: true },
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
      { nombre: "Pingüinos Marinela 2 pzs 80 g", presentacion: "2 pzs 80 g", piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["medias noches"],
    departamento: PAN,
    presentaciones: [
      { nombreBase: "Medias Noches Bimbo", presentacion: "8 pzs", dinamico: false, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    // Entrada genérica 4p (las espolvoreadas/azucaradas tienen familia propia
    // con clave más larga, que gana cuando el sabor viene en el ticket).
    claves: ["bimbo donitas", "donitas"],
    departamento: PAN,
    presentaciones: [
      { nombreBase: "Donitas Bimbo", presentacion: "4 pzs", dinamico: false, piezasEmpaque: null, senalas: [], def: true },
    ],
  },
  {
    claves: ["bimbo tortillinas", "tortillinas"],
    departamento: PAN,
    presentaciones: [
      { nombreBase: "Tortillinas Bimbo", presentacion: "12 pzs", dinamico: false, piezasEmpaque: null, senalas: [], def: true },
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
  ...FAMILIAS_LALA,
  ...FAMILIAS_CIGARROS,
  ...FAMILIAS_GAMESA,
  ...FAMILIAS_SABRITAS,
  ...FAMILIAS_BIMBO,
  ...FAMILIAS_FUD,
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
