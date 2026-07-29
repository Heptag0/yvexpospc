// YvexPOS Móvil — Pruebas de simplificarNombreUniversal (src/base/nombreUniversal.ts).
//
// Uso:   node test-codigos.mjs
// Compila nombreUniversal.ts a JS temporal con el tsc del proyecto y ejerce la
// función PURA con los casos reales de las capturas del dueño.
// OJO: la función vive en su propio módulo (sin expo-sqlite) precisamente para
// poder probarla así; codigos.ts la re-importa (no está duplicada).

import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const TMP = ".tmp_cod_test";

console.log("· Compilando src/base/nombreUniversal.ts …");
execSync(
  `node node_modules/typescript/bin/tsc src/base/nombreUniversal.ts --outDir ${TMP}` +
    ` --module commonjs --target es2017 --moduleResolution node --skipLibCheck`,
  { stdio: "inherit" }
);

const require = createRequire(import.meta.url);
const N = require(`./${TMP}/nombreUniversal.js`);
const f = N.simplificarNombreUniversal;

// --- marca duplicada con distinto case (captura real: Coca) -------------------
assert.equal(
  f("Coca-Cola Coca cola, 600ml", "Coca-Cola", "600 ml"),
  "Coca-Cola 600ml",
  "marca duplicada + quantity ya en el texto"
);

// --- marca en minúscula + descripción genérica larga cortada (captura: Sabritas)
assert.equal(
  f("sabritas Botana crujiente a base de pa...", "sabritas", "45 g"),
  "Sabritas 45g",
  "marca minúscula se capitaliza; descripción larga/truncada se descarta"
);

// --- texto corrupto/truncado del catálogo (captura: Gansito) ------------------
assert.equal(
  f("e relleno sabor mermelada Gansito, 50...", "Gansito", "50 g"),
  "Gansito 50g",
  "texto corrupto: marca + presentación normalizada"
);

// --- nombre limpio normal: se respeta y se capitaliza la marca ----------------
assert.equal(
  f("Sabritas Limón", "sabritas", null),
  "Sabritas Limón",
  "nombre limpio sin quantity"
);

// --- marca que NO aparece en el nombre se antepone ----------------------------
assert.equal(
  f("Galletas Marías 170g", "Gamesa", "170 g"),
  "Gamesa Galletas Marías 170g",
  "quantity ya presente en el nombre no se repite"
);

// --- quantity ausente: marca + nombre sin nada extra --------------------------
assert.equal(
  f("Papitas sabor limón", "sabritas", ""),
  "Sabritas Papitas sabor limón",
  "sin quantity"
);

// --- marca con formato propio se respeta (no se toca el case) -----------------
assert.equal(
  f("Chocolate con leche", "Duvalín", "18 g"),
  "Duvalín Chocolate con leche 18g",
  "marca mixta conserva su formato"
);

// --- normalización de litros ---------------------------------------------------
assert.equal(
  f("Agua natural", "Ciel", "1 lt"),
  "Ciel Agua natural 1L",
  "'1 lt' → '1L'"
);
assert.equal(
  f("Refresco cola", "Coca-Cola", "1.5 L"),
  "Coca-Cola Refresco cola 1.5L",
  "'1.5 L' → '1.5L'"
);

// --- nombre largo sin marca ni quantity: se corta limpio en espacio -----------
const largo = f("Botana crujiente a base de papa con chile y limón", "", "");
assert.ok(largo && largo.length <= 40, `cortado a ≤40 (salió '${largo}')`);
assert.ok(
  "Botana crujiente a base de papa con chile y limón".startsWith(largo),
  "el corte respeta el inicio original"
);
assert.ok(!/\s$/.test(largo) && !/[,;:.\-–—/]$/.test(largo), "sin cola colgando");

// --- nulos / inútiles ----------------------------------------------------------
assert.equal(f("", "sabritas", "45 g"), "Sabritas 45g", "sin nombre: marca + qty");
assert.equal(f(null, null, null), null, "todo vacío → null");
assert.equal(f("x", "", ""), null, "menos de 3 caracteres útiles → null");
assert.equal(f("...", "", ""), null, "puro artefacto → null");

// --- varias marcas: solo la primera --------------------------------------------
assert.equal(
  f("Chocolate", "Gamesa, PepsiCo", "30 g"),
  "Gamesa Chocolate 30g",
  "varias marcas → la primera"
);

rmSync(TMP, { recursive: true, force: true });
console.log("TODAS LAS PRUEBAS PASARON ✓");
