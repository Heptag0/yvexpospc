// YvexPOS Móvil — Pruebas de la lógica del escáner de tickets (src/base/escaner.ts).
//
// Uso:   node test-escaner-logica.mjs
// Compila escaner.ts a JS temporal con el tsc del proyecto y ejerce los
// helpers puros (sin pantalla ni base de datos). Todo debe salir en verde.

import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const TMP = ".tmp_esc_test";

console.log("· Compilando src/base/escaner.ts …");
execSync(
  `node node_modules/typescript/bin/tsc src/base/escaner.ts --outDir ${TMP}` +
    ` --module commonjs --target es2017 --moduleResolution node --skipLibCheck`,
  { stdio: "inherit" }
);

const require = createRequire(import.meta.url);
const E = require(`./${TMP}/escaner.js`);

// --- helpers de prueba -------------------------------------------------------
const base = {
  nombre_crudo: "X",
  nombre_sugerido: "X",
  codigo_barras: null,
  cantidad: 1,
  unidad_ticket: "pieza",
  piezas_por_empaque: null,
  costo_unitario_centavos: 100,
  importe_centavos: null,
  tipo: "venta",
  confianza: "alta",
  nota: null,
};
const respuesta = (lineas, total) => ({
  proveedor: null,
  proveedor_id: null,
  fecha: null,
  folio: null,
  es_preventa: false,
  lineas,
  total_ticket_centavos: total,
  avisos: [],
  mock: false,
});

// --- normalizarNombre / emparejarLineas --------------------------------------
assert.deepEqual(E.normalizarNombre("Sabritas Sal 40g"), ["sabritas", "sal"]);
assert.deepEqual(E.normalizarNombre("Café Soluble 200 gr"), ["cafe", "soluble"]);
assert.deepEqual(E.normalizarNombre("Coca-Cola 600ml"), ["coca", "cola"]);
assert.deepEqual(E.normalizarNombre("Galletas María 12 pza"), ["galletas", "maria"]);

const prods = [
  { id: "1", nombre: "Choc Role 80g", codigo_barras: null, costo_centavos: 1500, precio_venta_centavos: 2100 },
  { id: "2", nombre: "Coca-Cola 600ml", codigo_barras: "75010553", costo_centavos: 1300, precio_venta_centavos: 1800 },
];
const m = E.emparejarLineas(
  [
    { ...base, nombre_crudo: "ChocRole80g", nombre_sugerido: "Choc Role 80g" },
    { ...base, nombre_crudo: "Coca 600", nombre_sugerido: "Coca Cola 600", codigo_barras: "75010553" },
    { ...base, nombre_crudo: "XYZ desconocido", nombre_sugerido: "XYZ raro" },
    { ...base, tipo: "cambio", codigo_barras: "75010553" }, // cambio no se empareja
  ],
  prods
);
assert.equal(m[0]?.producto?.id, "1", "fuzzy por nombre");
assert.equal(m[1]?.producto?.id, "2", "código exacto");
assert.equal(m[1]?.estado, "seguro", "código exacto es seguro");
assert.equal(m[2]?.producto, null, "sin match");
assert.equal(m[3]?.producto, null, "cambio no se empareja");
console.log("✓ normalizarNombre / emparejarLineas");

// --- emparejarProducto: casos reales reportados por el usuario -----------------
// Regla de oro: un empareje EQUIVOCADO es peor que ninguno.
const cervezas = [
  { id: "bote", nombre: "Bote Pacífico Light", codigo_barras: null, costo_centavos: null, precio_venta_centavos: 0 },
  { id: "ballena-lg", nombre: "Ballena Pacífico Light", codigo_barras: null, costo_centavos: null, precio_venta_centavos: 0 },
  { id: "ballena", nombre: "Ballena Pacífico", codigo_barras: null, costo_centavos: null, precio_venta_centavos: 0 },
];

// El caso que destapó todo: "LG" con ruido de empaque debe llegar al Bote Light.
const e1 = E.emparejarProducto(
  "BOTE LG",
  "Pacífico LG 12 940 ml CT Caja Plástica",
  cervezas
);
assert.equal(e1.producto?.nombre, "Bote Pacífico Light", `salió ${e1.producto?.nombre} (${e1.estado} ${e1.score})`);
assert.ok(e1.estado === "seguro" || e1.estado === "sugerido");
assert.notEqual(e1.producto?.nombre, "Ballena Pacífico Light", "JAMÁS la ballena");

// "BALLENA LG" es la Light.
const e2 = E.emparejarProducto("BALLENA LG", "Ballena Pacífico LG 940ml", cervezas);
assert.equal(e2.producto?.nombre, "Ballena Pacífico Light", `salió ${e2.producto?.nombre} (${e2.estado} ${e2.score})`);

// "BALLENA" a secas: la versión regular o duda; NUNCA seguro con la Light.
const e3 = E.emparejarProducto("BALLENA", "BALLENA", cervezas);
assert.notEqual(
  e3.producto?.nombre === "Ballena Pacífico Light" && e3.estado === "seguro",
  true,
  "la regular no puede auto-emparejar seguro con la Light"
);
if (e3.producto) assert.equal(e3.producto.nombre, "Ballena Pacífico", `salió ${e3.producto.nombre}`);

// La Ballena regular NO auto-empareja con la Light (penalización de variante).
const e3b = E.emparejarProducto("PACIFICO BALLENA", "Pacífico Ballena 12 940 ml Retornable", cervezas);
assert.equal(e3b.producto?.nombre, "Ballena Pacífico", `salió ${e3b.producto?.nombre} (${e3b.estado})`);
assert.ok(e3b.estado === "seguro", "misma variante exacta debe ser segura");

// Códigos de presentación del proveedor no estorban.
const e4 = E.emparejarProducto(
  "SABRITAS SAL GU2 45G 50P",
  "SABRITAS SAL GU2 45G 50P",
  [{ id: "s", nombre: "Sabritas Sal Gu2 45g 50x1", codigo_barras: null, costo_centavos: null, precio_venta_centavos: 0 }]
);
assert.equal(e4.producto?.nombre, "Sabritas Sal Gu2 45g 50x1");
assert.equal(e4.estado, "seguro", `debió ser seguro (score ${e4.score})`);

// Ruido clásico de refresco.
const e5 = E.emparejarProducto(
  "COCA COLA NR",
  "Coca-Cola 600 ml no retornable 4 pack",
  [{ id: "c", nombre: "Coca-Cola 600ml", codigo_barras: null, costo_centavos: null, precio_venta_centavos: 0 }]
);
assert.equal(e5.producto?.nombre, "Coca-Cola 600ml");
assert.equal(e5.estado, "seguro", `debió ser seguro (score ${e5.score})`);

// Stopwords y códigos k<número>.
const e6 = E.emparejarProducto(
  "CIEL AGUA",
  "Ciel Agua En Ciel 1 Lt K6",
  [{ id: "a", nombre: "Agua Ciel 1L", codigo_barras: null, costo_centavos: null, precio_venta_centavos: 0 }]
);
assert.equal(e6.producto?.nombre, "Agua Ciel 1L");
assert.ok(e6.estado === "seguro" || e6.estado === "sugerido", `estado ${e6.estado}`);

// Lo que no está en el catálogo NO se inventa.
const e7 = E.emparejarProducto(
  "POWERADE MORAS",
  "Powerade Moras 600 ml no retornable",
  [
    { id: "c", nombre: "Coca-Cola 600ml", codigo_barras: null, costo_centavos: null, precio_venta_centavos: 0 },
    { id: "s", nombre: "Sabritas Sal", codigo_barras: null, costo_centavos: null, precio_venta_centavos: 0 },
  ]
);
assert.equal(e7.producto, null, `debió ser null (salió ${e7.producto?.nombre} ${e7.score})`);
console.log("✓ emparejarProducto (casos reales: Pacífico, Sabritas, Coca, Ciel, Powerade)");

// --- Diccionario del negocio: normalizarClave y alias ---------------------------
assert.equal(
  E.normalizarClave("Pacífico LG 12 940 ml CT Caja Plástica"),
  "light pacifico plastica"
);
assert.equal(E.normalizarClave("BOTE LG"), "bote light");
assert.equal(E.normalizarClave("Sabritas Sal GU2 45G 50P"), "sabritas sal");
assert.equal(
  E.normalizarClave("Coca-Cola 600 ml no retornable 4 pack"),
  "coca cola"
);
assert.equal(E.normalizarClave("940 ml CT"), "", "sin tokens útiles → clave vacía");

// El alias GANA al fuzzy: el tendero ya enseñó que "PACIFICO LG" es la Ballena.
// (Formato v10 del mapa: clave → { productoId, piezasEmpaque }.)
const aliasMap = new Map([["light pacifico", { productoId: "ballena", piezasEmpaque: null }]]);
const a1 = E.emparejarProducto("PACIFICO LG 940", "Pacífico Light 940 ml", cervezas, aliasMap);
assert.equal(a1.producto?.id, "ballena", `el alias debió ganar (salió ${a1.producto?.nombre})`);
assert.equal(a1.viaAlias, true, "debe marcarse viaAlias");
assert.equal(a1.estado, "seguro", "el alias siempre es seguro");
assert.equal(a1.piezasEmpaqueRecordado, null, "sin pack recordado → null");

// La memoria recuerda el PACK: alias que guardó 6 piezas por empaque.
const aliasPack = new Map([["moras powerade", { productoId: "ballena", piezasEmpaque: 6 }]]);
const a1b = E.emparejarProducto("PWMOR 600ML NRP", "Powerade Moras 600 ml", cervezas, aliasPack);
assert.equal(a1b.producto?.id, "ballena", `alias con pack (salió ${a1b.producto?.nombre})`);
assert.equal(a1b.viaAlias, true);
assert.equal(a1b.piezasEmpaqueRecordado, 6, "debió recordar el pack de 6");

// Sin el mapa, el MISMO input ahora lo resuelve el DICCIONARIO UNIVERSAL:
// "Pacífico Light 940 ml" ES la Ballena Light (el fuzzy viejo decía Bote,
// con duda razonable — estaba equivocado; el diccionario tiene razón).
const a2 = E.emparejarProducto("PACIFICO LG 940", "Pacífico Light 940 ml", cervezas);
assert.equal(a2.producto?.id, "ballena-lg", `sin alias salió ${a2.producto?.nombre}`);
assert.equal(a2.estado, "seguro", "igualdad con el canónico del diccionario → seguro");
assert.equal(a2.viaDiccionario, true, "vino del diccionario universal");
assert.ok(!a2.viaAlias, "sin alias no hay viaAlias");
assert.ok(a2.piezasEmpaqueRecordado == null, "el diccionario no trae pack recordado del negocio");

// Alias huérfano (producto borrado): se ignora y sigue el diccionario
// universal (que vuelve a acertar: es la Ballena Light).
const a3 = E.emparejarProducto(
  "PACIFICO LG 940",
  "Pacífico Light 940 ml",
  cervezas,
  new Map([["light pacifico", { productoId: "no-existe", piezasEmpaque: null }]])
);
assert.equal(a3.producto?.id, "ballena-lg", `huérfano debió seguir al diccionario (salió ${a3.producto?.nombre})`);
assert.ok(!a3.viaAlias, "huérfano no marca viaAlias");

// "Lager" no es ninguna de las tres presentaciones: JAMÁS seguro.
const a4 = E.emparejarProducto(
  "PACIFICO LAGER",
  "Pacífico Lager 12 Pk 940 ml en Caja Plástica",
  cervezas
);
assert.notEqual(a4.estado, "seguro", `Lager jamás seguro (salió ${a4.producto?.nombre} ${a4.score})`);
console.log("✓ diccionario del negocio (normalizarClave + alias)");

// --- nombreBonito --------------------------------------------------------------
// Con sugerido útil, parte del sugerido.
assert.equal(
  E.nombreBonito("PWMOR 600ML NRP", "Powerade Moras 600ml"),
  "Powerade Moras 600 ml"
);
// Sin sugerido útil (idéntico-basura o vacío): limpia el crudo.
assert.equal(
  E.nombreBonito("PACIFICO LIGHT TC 6PK H C 24 355 ML", ""),
  "Pacifico Light 355 ml"
);
assert.equal(
  E.nombreBonito("CORONA DIV 12 940ML CT R GRABADA", "CORONA DIV 12 940ML CT R GRABADA"),
  "Corona 940 ml"
);
assert.equal(
  E.nombreBonito("BUD LIGHT 6 PACK HI CONE 24 330 ML", ""),
  "Bud Light 330 ml"
);
// Crudo basura ilegible: NUNCA inventa ni devuelve vacío.
assert.ok(
  E.nombreBonito("XJ## ?? ??", "").length > 0,
  "basura ilegible debe devolver algo no vacío"
);
assert.equal(E.nombreBonito("### ###", ""), "### ###", "si nada sirve, crudo tal cual");
console.log("✓ nombreBonito");

// --- extraerPiezasEmpaque -------------------------------------------------------
// "4M" se cubre con el patrón \b(\d{1,2})\s?m\b (documentado en escaner.ts).
assert.equal(E.extraerPiezasEmpaque("CC 600ML NRP 4M"), 4);
assert.equal(E.extraerPiezasEmpaque("SCLAENILNTK6"), 6); // K6 aplastado
assert.equal(E.extraerPiezasEmpaque("AGUA 1 LT K6"), 6);
assert.equal(E.extraerPiezasEmpaque("REFRESCO 4 PACK"), 4);
assert.equal(E.extraerPiezasEmpaque("PACIFICO LIGHT 6PK 355 ML"), 6);
// Tamaños NO son packs.
assert.equal(E.extraerPiezasEmpaque("CORONA 940 ML"), null, "940 ML es tamaño, no pack");
assert.equal(E.extraerPiezasEmpaque("PACIFICO 355"), null);
assert.equal(E.extraerPiezasEmpaque("COCA COLA 600"), null);
console.log("✓ extraerPiezasEmpaque");

// --- costoPorPiezaCentavos ----------------------------------------------------
// Sin empaque: el costo ya es por pieza.
assert.equal(E.costoPorPiezaCentavos({ ...base, costo_unitario_centavos: 1691 }), 1691);
// Con empaque: el costo es POR CAJA y se reparte (el bug de la Ballena Corona:
// $400.00 por caja de 12 → $33.33 por pieza, no $400).
assert.equal(
  E.costoPorPiezaCentavos({
    ...base,
    unidad_ticket: "caja",
    piezas_por_empaque: 12,
    costo_unitario_centavos: 40000,
  }),
  3333
);
assert.equal(
  E.costoPorPiezaCentavos({
    ...base,
    unidad_ticket: "pack",
    piezas_por_empaque: 24,
    costo_unitario_centavos: 1691,
  }),
  70 // 1691/24 = 70.45… → 70
);
// piezas = 1 o ausente → costo tal cual.
assert.equal(
  E.costoPorPiezaCentavos({ ...base, piezas_por_empaque: 1, costo_unitario_centavos: 500 }),
  500
);
// Sin costo → null.
assert.equal(E.costoPorPiezaCentavos({ ...base, costo_unitario_centavos: null }), null);
console.log("✓ costoPorPiezaCentavos");

// --- nivelAvisoCosto (4 niveles: ninguno / aviso 5–15 / alerta 15–50 / irreal >50)
assert.equal(E.UMBRAL_AVISO_PCT, 5);
assert.equal(E.UMBRAL_ROJO_PCT, 15);
assert.equal(E.UMBRAL_IRREAL_PCT, 50);
assert.deepEqual(E.nivelAvisoCosto(null, 100), { nivel: "ninguno" });
assert.deepEqual(E.nivelAvisoCosto(100, 100), { nivel: "ninguno" }); // 0%
assert.equal(E.nivelAvisoCosto(1000, 1030).nivel, "ninguno", "3% solo informativo");
assert.equal(E.nivelAvisoCosto(1000, 1030).pct > 0, true, "el informativo sí trae pct");
assert.equal(E.nivelAvisoCosto(1000, 1070).nivel, "aviso");   // 7%
assert.equal(E.nivelAvisoCosto(1000, 1300).nivel, "alerta");  // 30%
assert.equal(E.nivelAvisoCosto(1000, 1530).nivel, "irreal");  // 53%
assert.equal(E.nivelAvisoCosto(1000, 400).nivel, "irreal", "-60% también es irreal");
assert.equal(E.nivelAvisoCosto(1000, 900).nivel, "aviso");    // -10%
assert.equal(E.nivelAvisoCosto(1000, 1150).nivel, "alerta", "justo 15% ya es alerta");
assert.equal(E.nivelAvisoCosto(1000, 1500).nivel, "alerta", "justo 50% aún es alerta");
assert.equal(E.nivelAvisoCosto(1000, 1501).nivel, "irreal", ">50% ya es irreal");
console.log("✓ nivelAvisoCosto");

// --- precioSugerido / redondearPrecio ------------------------------------------
assert.equal(E.precioSugerido(1200, 1000, 2000), 2400); // mantiene margen 50%
assert.equal(E.precioSugerido(1000, null, 0), 1300);    // sin base: ×1.3
assert.equal(E.redondearPrecio(1830, "exacto"), 1830);
assert.equal(E.redondearPrecio(1830, "50"), 1850);
assert.equal(E.redondearPrecio(1824, "50"), 1800);
assert.equal(E.redondearPrecio(1830, "90"), 1790); // 17.90 queda más cerca
assert.equal(E.redondearPrecio(1830, "entero"), 1800);
assert.equal(E.redondearPrecio(1810, "entero", 1850), 1900); // nunca bajo costo
assert.equal(E.redondearPrecio(50, "90"), 90);
console.log("✓ precioSugerido / redondearPrecio");

// --- markupPct / precioDesdeMarkup ---------------------------------------------
assert.equal(E.markupPct(1000, 1300), 30);
assert.equal(E.markupPct(1000, 2000), 100);
assert.equal(E.markupPct(1691, 2200), 30); // 30.09… → 30
assert.equal(E.markupPct(null, 1300), null, "sin costo → null");
assert.equal(E.markupPct(0, 1300), null);
assert.equal(E.markupPct(1000, null), null, "sin precio → null");
// Ida: costo × 1.30 con redondeo '50'.
assert.equal(E.precioDesdeMarkup(1000, 30, "50"), 1300);
assert.equal(E.precioDesdeMarkup(3333, 30, "50"), 4350); // 4332.9 → 4350
// Ida y vuelta con redondeo '50': el % resultante queda a un paso del original.
const p1 = E.precioDesdeMarkup(1667, 30, "50"); // 2167.1 → 2150
assert.equal(p1, 2150);
const pct1 = E.markupPct(1667, p1);
assert.ok(pct1 !== null && Math.abs(pct1 - 30) <= 2, `ida y vuelta ≈30% (salió ${pct1})`);
// Nunca por debajo del costo aunque el % sea negativo.
assert.ok(E.precioDesdeMarkup(1000, -5, "50") >= 1000);
console.log("✓ markupPct / precioDesdeMarkup");

// --- recalcularPorEmpaque (pieza ↔ pack, un solo camino) ------------------------
// El caso real: $516.32 por caja de 24 → $21.51 por pieza.
assert.deepEqual(E.recalcularPorEmpaque(51632, 24, null, "50"), {
  costoPieza: 2151,
  precio: null,
});
// Con % vigente: precio = costo × (1+pct) con redondeo (2151 × 1.30 = 2796.3 → 2800).
const re1 = E.recalcularPorEmpaque(51632, 24, 30, "50");
assert.equal(re1.costoPieza, 2151);
assert.equal(re1.precio, 2800);
// Conmutación pack → pieza (N=1): el costo por pieza ES el total del empaque.
assert.equal(E.recalcularPorEmpaque(51632, 1, null, "50").costoPieza, 51632);
// N inválido (0 o texto vacío ya parseado) no divide.
assert.equal(E.recalcularPorEmpaque(2151, 0, null, "50").costoPieza, 2151);
// Ida y vuelta sin %: pieza→pack y pack→pieza conservan el orden de magnitud.
const re2 = E.recalcularPorEmpaque(12750, 6, null, "50"); // $127.50 pack de 6
assert.equal(re2.costoPieza, 2125);
assert.equal(E.recalcularPorEmpaque(re2.costoPieza * 6, 1, null, "50").costoPieza, 12750);
console.log("✓ recalcularPorEmpaque");

// --- sumaCuadra ------------------------------------------------------------------
// 1) Cuadra directo: sumaVenta ≈ total.
assert.equal(
  E.sumaCuadra(
    respuesta(
      [
        { ...base, cantidad: 2, costo_unitario_centavos: 1691, importe_centavos: 3382 },
        { ...base, cantidad: 1, costo_unitario_centavos: 22860, importe_centavos: 22860 },
      ],
      26242
    )
  ),
  true
);
// 2) Cuadra con cambio físico: total impreso = venta − cambio.
assert.equal(
  E.sumaCuadra(
    respuesta(
      [
        { ...base, cantidad: 1, costo_unitario_centavos: 30000, importe_centavos: 30000 },
        { ...base, tipo: "cambio", cantidad: 1, costo_unitario_centavos: 4000, importe_centavos: 4000 },
      ],
      26000
    )
  ),
  true,
  "venta − cambio debe cuadrar"
);
// 3) No cuadra: ni directo ni con cambio.
assert.equal(
  E.sumaCuadra(
    respuesta(
      [
        { ...base, cantidad: 1, costo_unitario_centavos: 30000, importe_centavos: 30000 },
        { ...base, tipo: "cambio", cantidad: 1, costo_unitario_centavos: 1000, importe_centavos: 1000 },
      ],
      26000
    )
  ),
  false
);
// Sin total → null (no hay nada que validar).
assert.equal(E.sumaCuadra(respuesta([{ ...base }], null)), null);
// Tolerancia: max(2, 1% del total). Total 100000 → tolera 1000 de diferencia.
assert.equal(
  E.sumaCuadra(respuesta([{ ...base, cantidad: 1, costo_unitario_centavos: 100900 }], 100000)),
  true
);
assert.equal(
  E.sumaCuadra(respuesta([{ ...base, cantidad: 1, costo_unitario_centavos: 102000 }], 100000)),
  false
);
// Sin importe legible estima cantidad × costo.
assert.equal(
  E.sumaCuadra(respuesta([{ ...base, cantidad: 3, costo_unitario_centavos: 1000 }], 3000)),
  true
);
console.log("✓ sumaCuadra");

// --- piezasQueEntran --------------------------------------------------------------
assert.equal(E.piezasQueEntran({ cantidad: 13, piezas_por_empaque: 24 }), 312);
assert.equal(E.piezasQueEntran({ cantidad: 10, piezas_por_empaque: null }), 10);
console.log("✓ piezasQueEntran");

// --- config del escáner: defaults, clamps y mapeos (sanarConfigEscaner) ---------
// Defaults completos al sanar "nada".
assert.deepEqual(E.sanarConfigEscaner({}), E.DEFAULT_CONFIG_ESCANER);
assert.deepEqual(E.DEFAULT_CONFIG_ESCANER, {
  avisoPct: 5,
  alertaPct: 15,
  irrealPct: 50,
  margenDefaultPct: 30,
  redondeo: "50",
});
// Clamps de rango.
assert.equal(E.sanarConfigEscaner({ avisoPct: 99 }).avisoPct, 15, "aviso máx 15");
assert.equal(E.sanarConfigEscaner({ avisoPct: 1 }).avisoPct, 2, "aviso mín 2");
assert.equal(
  E.sanarConfigEscaner({ margenDefaultPct: 500 }).margenDefaultPct,
  100,
  "margen máx 100"
);
// Coherencia de umbrales: alerta ≥ aviso+1, irreal ≥ alerta+1 (mínimos mandan).
assert.equal(
  E.sanarConfigEscaner({ avisoPct: 10, alertaPct: 8 }).alertaPct,
  11,
  "alerta sube a aviso+1"
);
assert.equal(
  E.sanarConfigEscaner({ alertaPct: 25, irrealPct: 20 }).irrealPct,
  30,
  "irreal quedaría en 26, pero el mínimo de rango es 30"
);
// Redondeo inválido cae a "50".
assert.equal(E.sanarConfigEscaner({ redondeo: "cacao" }).redondeo, "50");
console.log("✓ sanarConfigEscaner (defaults + clamps)");

// --- nivelAvisoCosto con umbrales personalizados ---------------------------------
const U = { avisoPct: 10, alertaPct: 25, irrealPct: 80 };
assert.equal(E.nivelAvisoCosto(1000, 1070, U).nivel, "ninguno", "7% < 10");
assert.equal(E.nivelAvisoCosto(1000, 1200, U).nivel, "aviso", "20% en 10–25");
assert.equal(E.nivelAvisoCosto(1000, 1600, U).nivel, "alerta", "60% en 25–80");
assert.equal(E.nivelAvisoCosto(1000, 1900, U).nivel, "irreal", "90% > 80");
console.log("✓ nivelAvisoCosto con umbrales configurables");

// --- mapeo redondeo usuario ↔ modo interno + margen por defecto -------------------
assert.equal(E.modoRedondeoDesdeConfig("100"), "entero");
assert.equal(E.modoRedondeoDesdeConfig("ninguno"), "exacto");
assert.equal(E.modoRedondeoDesdeConfig("50"), "50");
assert.equal(E.redondeoDesdeModo("entero"), "100");
assert.equal(E.redondeoDesdeModo("exacto"), "ninguno");
assert.equal(E.redondeoDesdeModo("90"), "50", "el .90 heredado se aproxima a .50");
assert.equal(E.redondearPrecio(1830, "50"), 1850);
assert.equal(E.redondearPrecio(1830, "entero"), 1800);
assert.equal(E.redondearPrecio(1830, "exacto"), 1830);
// Margen por defecto configurable (sin base: costo × (1 + pct/100)).
assert.equal(E.precioSugerido(1000, null, 0, 25), 1250);
assert.equal(E.precioSugerido(1000, null, 0), 1300, "default 30%");
console.log("✓ mapeo de redondeo + margen por defecto");

// --- ancla histórica: rangoEsperadoCosto --------------------------------------
assert.equal(E.HIST_MARGEN_PCT, 15);
assert.equal(E.rangoEsperadoCosto([]), null, "sin historial → null");
assert.equal(E.rangoEsperadoCosto([0, -50]), null, "costos no positivos no anclan");
assert.deepEqual(E.rangoEsperadoCosto([1000]), { min: 850, max: 1150 }, "un valor ±15%");
assert.deepEqual(
  E.rangoEsperadoCosto([1000, 1200, 1100]),
  { min: 850, max: 1380 },
  "min/max del historial con margen"
);
assert.deepEqual(
  E.rangoEsperadoCosto([1000], { minPct: 10, maxPct: 20 }),
  { min: 900, max: 1200 },
  "porcentajes personalizados"
);
console.log("✓ rangoEsperadoCosto");

// --- ancla histórica: decisionCostoHistorial ------------------------------------
assert.equal(E.decisionCostoHistorial(1000, []), "sin_historial");
assert.equal(E.decisionCostoHistorial(1000, [1000]), "dentro");
assert.equal(E.decisionCostoHistorial(850, [1000]), "dentro", "justo en el mínimo");
assert.equal(E.decisionCostoHistorial(1150, [1000]), "dentro", "justo en el máximo");
assert.equal(E.decisionCostoHistorial(849, [1000]), "fuera", "1 centavo abajo del rango");
assert.equal(E.decisionCostoHistorial(1151, [1000]), "fuera", "1 centavo arriba del rango");
assert.equal(E.decisionCostoHistorial(2000, [1000, 1200]), "fuera");
console.log("✓ decisionCostoHistorial");

// --- contrato nuevo del backend: catalogo_idx y verificacion ---------------------
// Los tipos nuevos conviven con los helpers existentes (compilan y corren).
const lineaConIdx = { ...base, catalogo_idx: 0, codigo_barras: "75010553" };
const mIdx = E.emparejarLineas([lineaConIdx], prods);
assert.equal(mIdx[0]?.producto?.id, "2", "catalogo_idx no estorba al empareje local");
const respConVerif = {
  ...respuesta([{ ...base, catalogo_idx: null }], 100),
  verificacion: {
    aplicada: true,
    lineas_verificadas: 12,
    lineas_discrepantes: 2,
    lineas_sin_pareja: 1,
  },
};
assert.equal(typeof E.sumaCuadra(respConVerif), "boolean", "verificacion no rompe sumaCuadra");
console.log("✓ contrato catalogo_idx / verificacion");

// --- diccionario universal de proveedores: buscarEnDiccionario ------------------
// (escaner.ts lo importa, así que tsc ya lo compiló al mismo outDir)
const D = require(`./${TMP}/diccionario.js`);
console.log(`· Diccionario: ${D.FAMILIAS_DICCIONARIO.length} familias cargadas`);

// Los 4 casos del brief, tal cual
const d1 = D.buscarEnDiccionario("PACIFICO LIGHT TC 6PK 24 355ML", null);
assert.equal(d1?.nombre, "Bote Pacífico Light 355 ml", "brief 1: nombre");
assert.equal(d1?.presentacion, "355 ml", "brief 1: presentación");
assert.equal(d1?.piezasEmpaque, 24, "brief 1: pack 24");
assert.equal(d1?.departamento, "Cervezas", "brief 1: departamento");

const d2 = D.buscarEnDiccionario("MODELO ESP 12PK 1LT", null);
assert.equal(d2?.nombre, "Ballena Modelo Especial 940 ml", "brief 2: nombre");
assert.equal(d2?.presentacion, "940 ml", "brief 2: presentación");
assert.equal(d2?.piezasEmpaque, 12, "brief 2: pack 12");

const d3 = D.buscarEnDiccionario("PACIFICO LG MEGA 12 1 2 CT", null);
assert.equal(d3?.nombre, "Mega Pacífico Light 1.2 L", "brief 3: nombre");
assert.equal(d3?.presentacion, "1.2 L", "brief 3: presentación");
assert.equal(d3?.piezasEmpaque, 6, "brief 3: pack 6 (mega)");

assert.equal(
  D.buscarEnDiccionario("TCHAM600MLNR1", null),
  null,
  "brief 4: marca desconocida → null"
);

// Casos adicionales: clave suelta "coca" y gramaje dinámico de botanas
const d5 = D.buscarEnDiccionario("COCA 600ML NR 4 PACK", null);
assert.equal(d5?.nombre, "Coca-Cola 600 ml", "coca sin 'cola'");
assert.equal(d5?.presentacion, "600 ml");

const d6 = D.buscarEnDiccionario("SABRITAS LIMON 60GRX36X1", null);
assert.equal(d6?.presentacion, "60 g", "gramaje dinámico desde el crudo");
assert.equal(d6?.nombre, "Sabritas Limón 60 g");
console.log("✓ buscarEnDiccionario (4 del brief + 2 adicionales)");

// --- emparejarLineas con diccionario --------------------------------------------
// El diccionario GANA al fuzzy cuando el canónico coincide con un producto
// (el fuzzy solo alcanzaría "sugerido" ~0.70 para esta línea).
const prodsDic = [
  { id: "bote-lg", nombre: "Bote Pacífico Light", codigo_barras: null, costo_centavos: 1500, precio_venta_centavos: 2100 },
];
const mDic = E.emparejarLineas(
  [{ ...base, nombre_crudo: "PACIFICO LIGHT TC 6PK 24 355ML", nombre_sugerido: "PACIFICO LIGHT TC 6PK 24 355ML" }],
  prodsDic
);
assert.equal(mDic[0]?.producto?.id, "bote-lg", "reconoce el canónico del diccionario");
assert.equal(mDic[0]?.estado, "seguro", "igualdad canónica → seguro, no sugerido");
assert.equal(mDic[0]?.viaDiccionario, true, "marca viaDiccionario");

// Sin igualdad canónica NO empareja por parecido: la ficha viaja para
// pre-rellenar el producto nuevo.
const mDic2 = E.emparejarLineas(
  [{ ...base, nombre_crudo: "MODELO ESP 12PK 1LT", nombre_sugerido: "MODELO ESP 12PK 1LT" }],
  prodsDic
);
assert.equal(mDic2[0]?.producto, null, "no empareja por parecido");
assert.equal(mDic2[0]?.diccionario?.nombre, "Ballena Modelo Especial 940 ml");
assert.equal(mDic2[0]?.diccionario?.piezasEmpaque, 12, "ficha con pack para pre-relleno");
console.log("✓ emparejarLineas con diccionario (gana al fuzzy / ficha sin parecido)");

// --- diccionario ampliado: 7 formatos reales de proveedor -----------------------
// Cada caso verifica que la CLAVE curada coincide con lo que normalizarNombre
// produce para ese crudo (el punto débil: si no coincide, no reconoce nada).

// CERVECERA (formato Distribuidora del Valle / Heineken: "TKT.LT.CAG.1.2")
const f1 = D.buscarEnDiccionario("TKT.ROJ.CAG940", null);
assert.equal(f1?.nombre, "Ballena Tecate Original 940 ml", "TKT.ROJ.CAG940");
assert.equal(f1?.presentacion, "940 ml");
assert.equal(f1?.piezasEmpaque, 12, "caguama roja: caja 12");
assert.equal(f1?.departamento, "Cervezas");

const f2 = D.buscarEnDiccionario("TKT.LT.CAG.1.2", null);
assert.equal(f2?.nombre, "Tecate Light Caguama 1.2 L", "TKT.LT.CAG.1.2");
assert.equal(f2?.presentacion, "1.2 L");
assert.equal(f2?.piezasEmpaque, 12);

const f3 = D.buscarEnDiccionario("IND.MEG.RET1.2", null);
assert.equal(f3?.nombre, "Indio Mega Retornable 1.2 L", "IND.MEG.RET1.2");
assert.equal(f3?.presentacion, "1.2 L");

const f4 = D.buscarEnDiccionario("TKT.LT.LAT473M", null);
assert.equal(f4?.nombre, "Tecate Light Lata 473 ml", "TKT.LT.LAT473M");
assert.equal(f4?.presentacion, "473 ml");

const f5 = D.buscarEnDiccionario("TKT.LT.CUAR190", null);
assert.equal(f5?.nombre, "Tecate Light Cuartito 190 ml", "TKT.LT.CUAR190");
assert.equal(f5?.presentacion, "190 ml");

const f6 = D.buscarEnDiccionario("HEI.LT.NR.355M", null);
assert.equal(f6?.nombre, "Heineken 355 ml", "HEI.LT.NR.355M");

const f7 = D.buscarEnDiccionario("XX.LAG.6P.355M", null);
assert.equal(f7?.nombre, "XX Lager 355 ml", "XX.LAG.6P.355M");

const f8 = D.buscarEnDiccionario("BOH.OBS.NR355M", null);
assert.equal(f8?.nombre, "Bohemia Obscura 355 ml", "BOH.OBS.NR355M");
assert.equal(f8?.piezasEmpaque, 12, "premium: caja 12");

const f9 = D.buscarEnDiccionario("CH.TKT.24/355B", null);
assert.equal(f9?.nombre, "Tecate Original 355 ml", "CH.TKT.24/355B");
assert.equal(f9?.piezasEmpaque, 24, "charola 24");

// LALA
const f10 = D.buscarEnDiccionario("LALA.ENT.12/1L", null);
assert.equal(f10?.nombre, "Leche Lala Entera 1 L", "LALA.ENT.12/1L");
assert.equal(f10?.piezasEmpaque, 12, "única láctea con pack: caja 12/1L");
assert.equal(f10?.departamento, "Lácteos");

const f11 = D.buscarEnDiccionario("CREMA LALA 200ML", null);
assert.equal(f11?.nombre, "Crema Lala 200 ml");
assert.equal(f11?.piezasEmpaque, null, "lácteos por pieza");

// CIGARROS
const f12 = D.buscarEnDiccionario("MB.KS.B20", null);
assert.equal(f12?.nombre, "Marlboro Rojo KS Box 20", "MB.KS.B20");
assert.equal(f12?.departamento, "Cigarros");
assert.equal(f12?.piezasEmpaque, null, "cigarros por cajetilla");

const f13 = D.buscarEnDiccionario("MB.GLD14S", null);
assert.equal(f13?.nombre, "Marlboro Gold 14", "MB.GLD14S");

// GAMESA
const f14 = D.buscarEnDiccionario("MARIAS GAMESA170G", null);
assert.equal(f14?.nombre, "Marías Gamesa 170 g", "MARIAS GAMESA170G");
assert.equal(f14?.presentacion, "170 g", "gramaje dinámico");
assert.equal(f14?.departamento, "Galletas");

// COCA/ARCA
const f15 = D.buscarEnDiccionario("TOPO CHICO 355M", null);
assert.equal(f15?.nombre, "Topo Chico 355 ml", "TOPO CHICO 355M");

const f16 = D.buscarEnDiccionario("SIDRAL MUNDET60", null);
assert.equal(f16?.nombre, "Sidral Mundet 600 ml", "SIDRAL MUNDET60");
assert.equal(f16?.presentacion, "600 ml");

const f17 = D.buscarEnDiccionario("STA CLARA ENT1L", null);
assert.equal(f17?.nombre, "Leche Santa Clara 1 L", "STA CLARA ENT1L");

const f18 = D.buscarEnDiccionario("CC SIN AZUCAR25", null);
assert.equal(f18?.nombre, "Coca-Cola Sin Azúcar 2.5 L", "CC SIN AZUCAR25 (25 = 2.5 L)");
assert.equal(f18?.presentacion, "2.5 L");

// SIGMA/FUD
const f19 = D.buscarEnDiccionario("JAM PAVO FUD VAK", null);
assert.equal(f19?.nombre, "Jamón de Pavo FUD (kg)", "JAM PAVO FUD VAK");
assert.equal(f19?.presentacion, "kg", "carnes frías por kilo");
assert.equal(f19?.piezasEmpaque, null);
assert.equal(f19?.departamento, "Carnes frías");

const f20 = D.buscarEnDiccionario("QUESO OAXACA FUD 400G", null);
assert.equal(f20?.nombre, "Queso Oaxaca FUD 400 g");
console.log("✓ diccionario ampliado: 7 formatos reales (20 casos)");

rmSync(TMP, { recursive: true, force: true });
console.log("\nTODAS LAS PRUEBAS DE LÓGICA PASARON ✓");
