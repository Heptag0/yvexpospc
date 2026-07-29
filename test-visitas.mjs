// YvexPOS Móvil — Pruebas de la lógica de visitas (src/base/visitas.ts).
//
// Uso:   node test-visitas.mjs
// Compila visitas.ts a JS temporal con el tsc del proyecto y ejerce las
// funciones PURAS con casos límite: visita hoy, mañana, fin de semana,
// cruce de mes/año, array vacío, un solo día.

import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const TMP = ".tmp_visitas_test";

console.log("· Compilando src/base/visitas.ts …");
execSync(
  `node node_modules/typescript/bin/tsc src/base/visitas.ts --outDir ${TMP}` +
    ` --module commonjs --target es2017 --moduleResolution node --skipLibCheck`,
  { stdio: "inherit" }
);

const require = createRequire(import.meta.url);
const V = require(`./${TMP}/visitas.js`);
const { proximaFechaVisita, etiquetaAviso, nombreDia } = V;

// Referencia: 2026-07-26 es DOMINGO (día 0). Verifícalo con el propio helper.
assert.equal(nombreDia("2026-07-26"), "domingo", "ancla: 2026-07-26 es domingo");

// --- visita hoy (inclusive) ---------------------------------------------------
assert.equal(
  proximaFechaVisita([0], "2026-07-26"),
  "2026-07-26",
  "hoy es día de visita -> hoy"
);

// --- visita mañana --------------------------------------------------------------
assert.equal(
  proximaFechaVisita([1], "2026-07-26"),
  "2026-07-27",
  "desde domingo, próximo lunes es mañana"
);

// --- dos días: lunes y jueves ---------------------------------------------------
assert.equal(
  proximaFechaVisita([1, 4], "2026-07-26"),
  "2026-07-27",
  "lun/jue desde domingo -> lunes 27"
);
assert.equal(
  proximaFechaVisita([1, 4], "2026-07-27"),
  "2026-07-27",
  "lun/jue desde lunes -> hoy (lunes)"
);
assert.equal(
  proximaFechaVisita([1, 4], "2026-07-28"),
  "2026-07-30",
  "lun/jue desde martes -> jueves 30"
);

// --- fin de semana: solo sábado, desde sábado siguiente semana -------------------
assert.equal(
  proximaFechaVisita([6], "2026-07-26"),
  "2026-08-01",
  "solo sábado desde domingo -> sábado siguiente"
);
assert.equal(
  proximaFechaVisita([0], "2026-07-27"),
  "2026-08-02",
  "solo domingo desde lunes -> domingo siguiente"
);

// --- cruce de mes -----------------------------------------------------------------
assert.equal(
  proximaFechaVisita([2], "2026-07-31"),
  "2026-08-04",
  "desde vie 31 jul, próximo martes cae en agosto"
);
assert.equal(
  proximaFechaVisita([6], "2026-07-31"),
  "2026-08-01",
  "31 jul vie -> sáb 1 ago"
);

// --- cruce de año -------------------------------------------------------------------
assert.equal(
  proximaFechaVisita([5], "2026-12-31"),
  "2027-01-01",
  "31 dic 2026 (jue) -> vie 1 ene 2027"
);

// --- febrero en año bisiesto / no bisiesto -------------------------------------------
assert.equal(
  proximaFechaVisita([6], "2024-02-28"),
  "2024-03-02",
  "2024 bisiesto: mié 28 feb -> sáb 2 mar"
);
assert.equal(
  proximaFechaVisita([4], "2026-02-28"),
  "2026-03-05",
  "2026 no bisiesto: sáb 28 feb -> jue 5 mar"
);

// --- array vacío / basura --------------------------------------------------------------
assert.equal(proximaFechaVisita([], "2026-07-26"), null, "array vacío -> null");
assert.equal(proximaFechaVisita([7, -1, 9], "2026-07-26"), null, "días inválidos -> null");
assert.equal(proximaFechaVisita([1], "fecha-mala"), null, "fecha inválida -> null");
assert.equal(proximaFechaVisita([1], "2026-02-31"), null, "fecha imposible -> null");

// --- duplicados y desorden no afectan ---------------------------------------------------
assert.equal(
  proximaFechaVisita([4, 1, 1, 4], "2026-07-28"),
  "2026-07-30",
  "duplicados/desorden -> mismo resultado"
);

// --- etiquetaAviso -----------------------------------------------------------------------
assert.equal(etiquetaAviso("2026-07-26", "2026-07-26"), "Hoy", "mismo día -> Hoy");
assert.equal(etiquetaAviso("2026-07-27", "2026-07-26"), "Mañana", "+1 -> Mañana");
assert.equal(etiquetaAviso("2026-07-30", "2026-07-26"), "El jueves", "otro día -> El {weekday}");
assert.equal(etiquetaAviso("2027-01-01", "2026-12-31"), "Mañana", "mañana cruzando año");
assert.equal(etiquetaAviso("2027-01-05", "2026-12-31"), "El martes", "weekday cruzando año");
assert.equal(etiquetaAviso("2026-07-25", "2026-07-26"), "El sábado", "ayer -> weekday (sin tronar)");
assert.equal(etiquetaAviso("mala", "2026-07-26"), "mala", "fecha inválida -> texto original");

rmSync(TMP, { recursive: true, force: true });
console.log("TODAS LAS PRUEBAS PASARON ✓");
