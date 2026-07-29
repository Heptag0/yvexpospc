// YvexPOS Móvil — Pruebas de las reglas de lealtad (src/base/lealtadReglas.ts).
//
// Uso:   node test-lealtad.mjs
// Compila lealtadReglas.ts a JS temporal con el tsc del proyecto y ejerce
// las funciones PURAS con casos límite: acumulación con decimales, canje
// parcial por tope, ticket chico, cero puntos, entradas raras.

import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const TMP = ".tmp_lealtad_test";

console.log("· Compilando src/base/lealtadReglas.ts …");
execSync(
  `node node_modules/typescript/bin/tsc src/base/lealtadReglas.ts --outDir ${TMP}` +
    ` --module commonjs --target es2017 --moduleResolution node --skipLibCheck`,
  { stdio: "inherit" }
);

const require = createRequire(import.meta.url);
const { puntosPorCompra, descuentoPorCanje } = require(
  `./${TMP}/lealtadReglas.js`
);

// ---------------------------------------------------------------------------
// puntosPorCompra: 1 punto por cada N pesos COMPLETOS del total
// ---------------------------------------------------------------------------

// $100.00 exactos con regla $10/punto -> 10 puntos.
assert.equal(puntosPorCompra(10000, 10), 10, "$100 a $10/punto = 10 pts");

// Acumulación con decimales: $99.99 -> NO llega al décimo punto (floor).
assert.equal(puntosPorCompra(9999, 10), 9, "$99.99 a $10/punto = 9 pts (floor)");

// $105.50 -> 10 puntos (los $5.50 no cuentan).
assert.equal(puntosPorCompra(10550, 10), 10, "$105.50 -> 10 pts");

// Regla fraccionaria ($12.50/punto): $25.00 -> 2 puntos.
assert.equal(puntosPorCompra(2500, 12.5), 2, "$25 a $12.50/punto = 2 pts");

// Ticket chico: $9.99 a $10/punto -> 0 puntos.
assert.equal(puntosPorCompra(999, 10), 0, "ticket menor al paso -> 0 pts");

// Entradas raras: cero, negativos, NaN -> 0, nunca truena.
assert.equal(puntosPorCompra(0, 10), 0, "total 0 -> 0 pts");
assert.equal(puntosPorCompra(-500, 10), 0, "total negativo -> 0 pts");
assert.equal(puntosPorCompra(10000, 0), 0, "regla 0 -> 0 pts");
assert.equal(puntosPorCompra(NaN, 10), 0, "NaN -> 0 pts");

// ---------------------------------------------------------------------------
// descuentoPorCanje: tope del ticket, total chico, cero puntos
// ---------------------------------------------------------------------------

// Canje completo sin tope: 10 pts * $1.00 = $10.00 sobre ticket de $50
// (tope 50% = $25, no estorba).
assert.deepEqual(
  descuentoPorCanje(10, 100, 5000, 50),
  { descuentoCentavos: 1000, puntosUsados: 10 },
  "canje completo bajo el tope"
);

// Canje parcial por tope: 40 pts * $1.00 = $40, pero tope 50% de $50 = $25.
// Solo se usan 25 puntos (floor a favor del cliente: no le quitamos de más).
assert.deepEqual(
  descuentoPorCanje(40, 100, 5000, 50),
  { descuentoCentavos: 2500, puntosUsados: 25 },
  "el tope recorta el canje y bajan los puntos usados"
);

// Total chico con tope 100%: el descuento nunca pasa del total.
assert.deepEqual(
  descuentoPorCanje(100, 100, 800, 100),
  { descuentoCentavos: 800, puntosUsados: 8 },
  "total chico: descuento = total, nunca negativo"
);

// Tope fraccionario: 33% de $10.00 = floor($3.30) -> $3.30, 3 puntos de $1.
assert.deepEqual(
  descuentoPorCanje(10, 100, 1000, 33),
  { descuentoCentavos: 330, puntosUsados: 3 },
  "tope porcentual con centavos: floor limpio"
);

// Redondeo a favor del cliente: tope $3.50 con puntos de $1 -> se cobran
// 3 puntos ($3.00), los 50 centavos restantes los paga el cliente.
assert.deepEqual(
  descuentoPorCanje(10, 100, 700, 50),
  { descuentoCentavos: 350, puntosUsados: 3 },
  "tope $3.50 -> 3 pts ($3.00), nunca un punto de más"
);

// Cero puntos / cero ticket / entradas raras -> 0 y 0.
assert.deepEqual(descuentoPorCanje(0, 100, 5000, 50), { descuentoCentavos: 0, puntosUsados: 0 }, "0 puntos");
assert.deepEqual(descuentoPorCanje(10, 100, 0, 50), { descuentoCentavos: 0, puntosUsados: 0 }, "ticket 0");
assert.deepEqual(descuentoPorCanje(10, 0, 5000, 50), { descuentoCentavos: 0, puntosUsados: 0 }, "valor 0");
assert.deepEqual(descuentoPorCanje(10, 100, 5000, 0), { descuentoCentavos: 0, puntosUsados: 0 }, "tope 0");
assert.deepEqual(descuentoPorCanje(-5, 100, 5000, 50), { descuentoCentavos: 0, puntosUsados: 0 }, "negativos");

rmSync(TMP, { recursive: true, force: true });
console.log("TODAS LAS PRUEBAS PASARON");
