// YvexPOS Móvil — Pruebas de las reglas de la tienda (src/base/tiendaReglas.ts).
//
// Uso:   node test-tienda-movil.mjs
// Compila tiendaReglas.ts a JS temporal con el tsc del proyecto y ejerce
// las funciones PURAS: slugs con acentos, emojis, espacios y nombres largos;
// whatsapp con +52, espacios, guiones y números cortos/largos.

import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const TMP = ".tmp_tienda_test";

console.log("· Compilando src/base/tiendaReglas.ts …");
execSync(
  `node node_modules/typescript/bin/tsc src/base/tiendaReglas.ts --outDir ${TMP}` +
    ` --module commonjs --target es2017 --moduleResolution node --skipLibCheck`,
  { stdio: "inherit" }
);

const require = createRequire(import.meta.url);
const { sugerirSlug, whatsappValido, armarTextoAyuda, urlPublica } = require(
  `./${TMP}/tiendaReglas.js`
);

// ---------------------------------------------------------------------------
// sugerirSlug
// ---------------------------------------------------------------------------

assert.equal(sugerirSlug("Abarrotes Lupita"), "abarrotes-lupita", "espacios -> guiones");
assert.equal(sugerirSlug("Tienda Éxito"), "tienda-exito", "sin acentos");
assert.equal(sugerirSlug("Doña María"), "dona-maria", "ñ -> n");
assert.equal(sugerirSlug("¡La Esquina! 🌮"), "la-esquina", "emojis y signos fuera");
assert.equal(sugerirSlug("   Papelería   Azul   "), "papeleria-azul", "espacios laterales");
assert.equal(sugerirSlug("A -- B__C"), "a-b-c", "guiones colapsados y guiones bajos");
assert.equal(sugerirSlug("Café 24/7"), "cafe-24-7", "números se conservan");
assert.equal(sugerirSlug("---"), "mi-tienda", "solo signos -> mi-tienda");
assert.equal(sugerirSlug(""), "mi-tienda", "vacío -> mi-tienda");
assert.equal(sugerirSlug("   "), "mi-tienda", "solo espacios -> mi-tienda");
// @ts-ignore: a propósito, entrada que no es string
assert.equal(sugerirSlug(null), "mi-tienda", "null -> mi-tienda");

// Máx. 40 caracteres, sin guion colgando.
const largo = sugerirSlug("La Tiendita Más Bonita de Toda la Colonia del Valle Centro");
assert.ok(largo.length <= 40, "máx. 40 caracteres");
assert.ok(!largo.endsWith("-"), "sin guion colgando tras el recorte");
assert.equal(largo, "la-tiendita-mas-bonita-de-toda-la-coloni", "recorte exacto");

// ---------------------------------------------------------------------------
// whatsappValido
// ---------------------------------------------------------------------------

assert.equal(whatsappValido("5512345678"), "5512345678", "10 dígitos pelones");
assert.equal(whatsappValido("+52 55 1234 5678"), "525512345678", "+52 con espacios");
assert.equal(whatsappValido("52-1-55-1234-5678"), "5215512345678", "guiones fuera");
assert.equal(whatsappValido("(55) 1234 5678"), "5512345678", "paréntesis fuera");
assert.equal(whatsappValido("12345"), null, "muy corto");
assert.equal(whatsappValido("1234567890123456"), null, "muy largo (16)");
assert.equal(whatsappValido(""), null, "vacío");
assert.equal(whatsappValido("hola"), null, "letras");
assert.equal(whatsappValido(null), null, "null");
assert.equal(whatsappValido(undefined), null, "undefined");
// 15 dígitos (máximo internacional) sí cuadra.
assert.equal(whatsappValido("123456789012345"), "123456789012345", "15 dígitos ok");

// ---------------------------------------------------------------------------
// armarTextoAyuda / urlPublica
// ---------------------------------------------------------------------------

const texto = armarTextoAyuda("https://tienda.yvexiq.com/t/abarrotes-lupita", "Abarrotes Lupita");
assert.ok(texto.includes("Abarrotes Lupita"), "lleva el nombre del negocio");
assert.ok(texto.includes("https://tienda.yvexiq.com/t/abarrotes-lupita"), "lleva la URL");
assert.ok(texto.toLowerCase().includes("whatsapp"), "menciona WhatsApp");

assert.ok(
  armarTextoAyuda("https://tienda.yvexiq.com/t/x", "").includes("mi negocio"),
  "sin nombre -> 'mi negocio'"
);

assert.equal(
  urlPublica("https://tienda.yvexiq.com/", "mi-tienda"),
  "https://tienda.yvexiq.com/t/mi-tienda",
  "sin doble diagonal"
);

rmSync(TMP, { recursive: true, force: true });
console.log("TODAS LAS PRUEBAS PASARON");
