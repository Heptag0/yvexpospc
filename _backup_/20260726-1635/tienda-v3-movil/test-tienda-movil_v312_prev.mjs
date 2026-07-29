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
const {
  sugerirSlug,
  whatsappValido,
  armarTextoAyuda,
  urlPublica,
  normalizarSlug,
  slugFormatoValido,
  urlSubdominio,
  plantillaParaGiro,
  pesosACentavos,
  normalizarRed,
  linkPagoValido,
  temaTiendaValido,
  temaTiendaEfectivo,
  TEMAS_TIENDA,
  TEMA_AUTO_CLARO,
  TEMA_AUTO_OSCURO,
  NOMBRES_PLANTILLA,
  nombrePlantilla,
  FONDOS_TEMA,
  validarColorHex,
  luminanciaRelativa,
  razonContraste,
  contrasteSuficiente,
  acentoContrasteSeguro,
  fondoGuiaTema,
  telefonoParaWhatsApp,
  urlWhatsAppCliente,
  mensajePedidoCancelado,
  mensajePedidoListo,
  urlPreviewTienda,
  TRANSICIONES_PEDIDO,
  transicionPedidoValida,
  etiquetaEstadoPedido,
  folioCortoPedido,
  horaRelativa,
  etiquetaEntregaPedido,
  etiquetaPagoPedido,
} = require(`./${TMP}/tiendaReglas.js`);

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

// ---------------------------------------------------------------------------
// normalizarSlug / slugFormatoValido (v2 — "Tu enlace")
// ---------------------------------------------------------------------------

assert.equal(normalizarSlug("Mi Tienda Bonita"), "mi-tienda-bonita", "minúsculas y guiones");
assert.equal(normalizarSlug("Café   24"), "cafe-24", "acentos fuera, espacios a guion");
assert.equal(normalizarSlug("--hola--"), "hola", "sin guiones laterales");
assert.equal(normalizarSlug("a--b"), "a-b", "guiones dobles colapsados");
assert.equal(normalizarSlug("¡Qué_Onda!"), "que-onda", "signos y guiones bajos");
assert.equal(normalizarSlug(""), "", "vacío -> vacío (NO inventa default)");
assert.equal(normalizarSlug("---"), "", "solo signos -> vacío");
// @ts-ignore: a propósito, entrada que no es string
assert.equal(normalizarSlug(null), "", "null -> vacío");
assert.ok(normalizarSlug("un nombre de tienda increíblemente largo para probar el límite").length <= 40, "máx. 40");

assert.ok(slugFormatoValido("mi-tienda"), "slug normal ok");
assert.ok(slugFormatoValido("abc"), "3 chars ok");
assert.ok(!slugFormatoValido("ab"), "muy corto");
assert.ok(!slugFormatoValido(""), "vacío no");
assert.ok(!slugFormatoValido("-hola"), "guion inicial no");
assert.ok(!slugFormatoValido("ho--la"), "doble guion no");
assert.ok(!slugFormatoValido("HOLA"), "mayúsculas no (debe normalizarse antes)");
assert.ok(!slugFormatoValido("a".repeat(41)), "más de 40 no");

// ---------------------------------------------------------------------------
// urlSubdominio / plantillaParaGiro (v2)
// ---------------------------------------------------------------------------

assert.equal(urlSubdominio("abarrotes-lupita"), "https://abarrotes-lupita.yvexiq.com", "subdominio");

// Espejo del backend (tienda_utils.GIRO_A_PLANTILLA):
assert.equal(plantillaParaGiro("ropa"), "boutique");
assert.equal(plantillaParaGiro("belleza"), "boutique");
assert.equal(plantillaParaGiro("mascotas"), "boutique");
assert.equal(plantillaParaGiro("cafeteria"), "menu");
assert.equal(plantillaParaGiro("restaurante"), "menu");
assert.equal(plantillaParaGiro("abarrotes"), "catalogo");
assert.equal(plantillaParaGiro("farmacia"), "catalogo");
assert.equal(plantillaParaGiro("ferreteria"), "catalogo");
assert.equal(plantillaParaGiro("electronica"), "catalogo");
assert.equal(plantillaParaGiro("otro"), "catalogo");
assert.equal(plantillaParaGiro("floreria"), "aurora", "giro desconocido -> aurora");
assert.equal(plantillaParaGiro(""), "aurora", "vacío -> aurora");
assert.equal(plantillaParaGiro(null), "aurora", "null -> aurora");
assert.equal(plantillaParaGiro(" ROPA "), "boutique", "mayúsculas y espacios");

// ---------------------------------------------------------------------------
// pesosACentavos (v2 — costo de envío)
// ---------------------------------------------------------------------------

assert.equal(pesosACentavos("30"), 3000, "pesos enteros");
assert.equal(pesosACentavos("35.50"), 3550, "decimales con punto");
assert.equal(pesosACentavos("35,50"), 3550, "coma decimal");
assert.equal(pesosACentavos("$45.00"), 4500, "signo de pesos");
assert.equal(pesosACentavos("0"), 0, "cero (envío gratis)");
assert.equal(pesosACentavos("12.345"), 1235, "redondeo al centavo");
assert.equal(pesosACentavos(""), null, "vacío -> null");
assert.equal(pesosACentavos("abc"), null, "letras -> null");
assert.equal(pesosACentavos("-10"), null, "negativo -> null");
assert.equal(pesosACentavos(null), null, "null -> null");

// ---------------------------------------------------------------------------
// normalizarRed (v2 — instagram/facebook/tiktok)
// ---------------------------------------------------------------------------

assert.equal(normalizarRed("instagram", "@Tutienda"), "@tutienda", "@ y minúsculas");
assert.equal(normalizarRed("instagram", "tutienda"), "@tutienda", "sin @");
assert.equal(
  normalizarRed("instagram", "https://instagram.com/tutienda"),
  "@tutienda",
  "URL completa"
);
assert.equal(
  normalizarRed("instagram", "instagram.com/tutienda?igsh=abc"),
  "@tutienda",
  "URL sin protocolo y con query"
);
assert.equal(normalizarRed("tiktok", "https://www.tiktok.com/@tutienda"), "@tutienda", "tiktok con www");
assert.equal(normalizarRed("tiktok", "@Tutienda_22"), "@tutienda_22", "tiktok directo");
assert.equal(normalizarRed("facebook", "Mi Pagina"), "MiPagina", "facebook sin @, espacios fuera");
assert.equal(
  normalizarRed("facebook", "https://www.facebook.com/mi.pagina"),
  "mi.pagina",
  "facebook URL"
);
assert.equal(normalizarRed("instagram", ""), "", "vacío -> vacío");
assert.equal(normalizarRed("instagram", "   "), "", "espacios -> vacío");
assert.equal(normalizarRed("tiktok", null), "", "null -> vacío");

// ---------------------------------------------------------------------------
// linkPagoValido (v2)
// ---------------------------------------------------------------------------

assert.ok(linkPagoValido(""), "vacío es válido (opcional)");
assert.ok(linkPagoValido("   "), "solo espacios = vacío");
assert.ok(linkPagoValido("https://mpago.la/123abc"), "https ok");
assert.ok(linkPagoValido("http://pagos.mx/link"), "http ok");
assert.ok(!linkPagoValido("mpago.la/123"), "sin protocolo no");
assert.ok(!linkPagoValido("págamelo después"), "texto libre no");
assert.ok(!linkPagoValido(null), "null no");

// ---------------------------------------------------------------------------
// v3.1 — temas válidos y alias (espejo de TEMAS_VALIDOS / ALIAS_TEMAS)
// ---------------------------------------------------------------------------

assert.deepEqual(TEMAS_TIENDA, ["auto", "perla", "medianoche", "arena", "cielo"], "5 temas en orden");
assert.equal(TEMA_AUTO_CLARO, "perla");
assert.equal(TEMA_AUTO_OSCURO, "medianoche");

assert.equal(temaTiendaValido("perla"), "perla");
assert.equal(temaTiendaValido("medianoche"), "medianoche");
assert.equal(temaTiendaValido("arena"), "arena");
assert.equal(temaTiendaValido("cielo"), "cielo");
assert.equal(temaTiendaValido("auto"), "auto");
assert.equal(temaTiendaValido("claro"), "perla", "alias claro -> perla");
assert.equal(temaTiendaValido("oscuro"), "medianoche", "alias oscuro -> medianoche");
assert.equal(temaTiendaValido(" CLARO "), "perla", "alias con mayúsculas y espacios");
assert.equal(temaTiendaValido(""), "auto", "vacío -> auto");
assert.equal(temaTiendaValido(null), "auto", "null -> auto");
assert.equal(temaTiendaValido("sepia"), "auto", "valor raro -> auto");

assert.equal(temaTiendaEfectivo("auto", false), "perla", "auto de día -> perla");
assert.equal(temaTiendaEfectivo("auto", true), "medianoche", "auto de noche -> medianoche");
assert.equal(temaTiendaEfectivo("arena", true), "arena", "tema concreto pasa intacto");
assert.equal(temaTiendaEfectivo("claro", true), "perla", "alias también se resuelve");

// ---------------------------------------------------------------------------
// v3.1 — nombres display de plantillas (ids intactos)
// ---------------------------------------------------------------------------

assert.equal(NOMBRES_PLANTILLA.aurora, "Amanecer");
assert.equal(NOMBRES_PLANTILLA.noche, "Nocturna");
assert.equal(NOMBRES_PLANTILLA.mercado, "Mercadito");
assert.equal(NOMBRES_PLANTILLA.boutique, "Vitrina");
assert.equal(NOMBRES_PLANTILLA.menu, "La Carta");
assert.equal(NOMBRES_PLANTILLA.catalogo, "Surtido");
assert.equal(nombrePlantilla("menu"), "La Carta");
assert.equal(nombrePlantilla("rara"), "rara", "id desconocido -> el propio id");
assert.equal(nombrePlantilla(null), "Amanecer", "null -> Amanecer");

// ---------------------------------------------------------------------------
// v3.1 — contraste WCAG (espejo de la matemática del backend)
// ---------------------------------------------------------------------------

assert.equal(FONDOS_TEMA.perla, "#f6f7fb");
assert.equal(FONDOS_TEMA.medianoche, "#0d0f16");
assert.equal(FONDOS_TEMA.arena, "#f7f1e6");
assert.equal(FONDOS_TEMA.cielo, "#eef4f9");

assert.equal(validarColorHex("#8B5CF6"), "#8b5cf6", "minúsculas");
assert.equal(validarColorHex("rojo"), "#2563eb", "inválido -> defecto");
assert.equal(validarColorHex("#8b5cf"), "#2563eb", "5 dígitos -> defecto");

// Luminancias de referencia WCAG conocidas.
assert.ok(Math.abs(luminanciaRelativa("#000000") - 0) < 1e-9, "negro = 0");
assert.ok(Math.abs(luminanciaRelativa("#ffffff") - 1) < 1e-9, "blanco = 1");
assert.ok(Math.abs(razonContraste("#000000", "#ffffff") - 21) < 0.01, "negro/blanco = 21");
assert.ok(Math.abs(razonContraste("#8b5cf6", "#8b5cf6") - 1) < 1e-9, "mismo color = 1");

// Casos guía del aviso: acento oscuro sobre medianoche -> insuficiente;
// acento claro -> suficiente.
assert.ok(!contrasteSuficiente("#1e293b", FONDOS_TEMA.medianoche), "oscuro sobre medianoche no");
assert.ok(contrasteSuficiente("#a5b4fc", FONDOS_TEMA.medianoche), "claro sobre medianoche sí");
assert.ok(contrasteSuficiente("#8b5cf6", FONDOS_TEMA.perla), "violeta sobre perla sí");
assert.ok(!contrasteSuficiente("#fbbf24", FONDOS_TEMA.perla), "amarillo sobre perla no");

// El ajuste: preserva matiz y alcanza >= 3:1.
const ajustado = acentoContrasteSeguro("#1e293b", FONDOS_TEMA.medianoche);
assert.notEqual(ajustado, "#1e293b", "hubo ajuste");
assert.ok(contrasteSuficiente(ajustado, FONDOS_TEMA.medianoche), "el ajustado alcanza >= 3:1");
const ajustadoClaro = acentoContrasteSeguro("#fbbf24", FONDOS_TEMA.perla);
assert.ok(contrasteSuficiente(ajustadoClaro, FONDOS_TEMA.perla), "sobre perla también alcanza");
// Si ya cumple, se regresa intacto.
assert.equal(acentoContrasteSeguro("#8b5cf6", FONDOS_TEMA.perla), "#8b5cf6", "intacto si ya cumple");

// Paridad exacta con el backend (valores calculados con tienda_utils.py).
assert.equal(acentoContrasteSeguro("#1e293b", "#0d0f16"), "#47628c", "paridad backend medianoche");
assert.equal(acentoContrasteSeguro("#fbbf24", "#f6f7fb"), "#b08003", "paridad backend perla");

assert.equal(fondoGuiaTema("auto", false), "#f6f7fb");
assert.equal(fondoGuiaTema("auto", true), "#0d0f16");
assert.equal(fondoGuiaTema("arena", true), "#f7f1e6");

// ---------------------------------------------------------------------------
// v3.1 — teléfono MX y mensajes de aviso al cliente
// ---------------------------------------------------------------------------

assert.equal(telefonoParaWhatsApp("55 1234 5678"), "525512345678", "10 dígitos -> +52");
assert.equal(telefonoParaWhatsApp("+52 55 1234 5678"), "525512345678", "con lada pasa");
assert.equal(telefonoParaWhatsApp("5215512345678"), "5215512345678", "13 dígitos pasa");
assert.equal(telefonoParaWhatsApp("12345"), null, "muy corto");
assert.equal(telefonoParaWhatsApp(""), null, "vacío");
assert.equal(telefonoParaWhatsApp(null), null, "null");
assert.equal(telefonoParaWhatsApp("1234567890123456"), null, "16 dígitos no");

const cancel = mensajePedidoCancelado("Lupita", "Abarrotes Don José", "#A1B2C3D4");
assert.ok(cancel.includes("Hola Lupita"), "saluda al cliente");
assert.ok(cancel.includes("Abarrotes Don José"), "lleva el negocio");
assert.ok(cancel.includes("#A1B2C3D4"), "lleva el folio");
assert.ok(cancel.includes("fue cancelado"), "dice cancelado");
assert.ok(cancel.includes("aquí estamos"), "cierre cálido");

const listoPickup = mensajePedidoListo("Lupita", "Abarrotes Don José", "#A1B2C3D4", "pickup");
assert.ok(listoPickup.includes("ya está listo"), "dice listo");
assert.ok(listoPickup.includes("pasar a recogerlo"), "pickup -> recoger");
const listoDom = mensajePedidoListo("Lupita", "Abarrotes Don José", "#A1B2C3D4", "domicilio");
assert.ok(listoDom.includes("va en camino"), "domicilio -> en camino");
assert.ok(mensajePedidoCancelado("", "", "#X").includes("tu tienda"), "sin nombre -> genérico");

const urlWa = urlWhatsAppCliente("525512345678", "Hola Lupita, tu pedido #A1 está listo");
assert.equal(
  urlWa,
  "https://wa.me/525512345678?text=Hola%20Lupita%2C%20tu%20pedido%20%23A1%20est%C3%A1%20listo",
  "wa.me con mensaje URL-encoded"
);

// ---------------------------------------------------------------------------
// v3 — temaTiendaValido / urlPreviewTienda
// ---------------------------------------------------------------------------

const preview = urlPreviewTienda(
  "https://tienda.yvexiq.com/",
  "abarrotes-lupita",
  "noche",
  "medianoche",
  "#8b5cf6"
);
assert.equal(
  preview,
  "https://tienda.yvexiq.com/t/abarrotes-lupita/preview?plantilla=noche&tema=medianoche&acento=%238b5cf6",
  "preview exacta: sin doble diagonal y acento URL-encoded"
);
assert.ok(
  urlPreviewTienda("https://tienda.yvexiq.com", "x", "menu", "oscuro", "#fff").includes("tema=medianoche"),
  "alias oscuro -> medianoche en la preview"
);
assert.ok(
  urlPreviewTienda("https://tienda.yvexiq.com", "x", "menu", "sepia", "#fff").includes("tema=auto"),
  "tema raro cae a auto en la preview"
);

// ---------------------------------------------------------------------------
// v3 — transiciones de pedido (espejo del backend)
// ---------------------------------------------------------------------------

assert.ok(transicionPedidoValida("nuevo", "preparando"), "nuevo -> preparando");
assert.ok(transicionPedidoValida("nuevo", "cancelado"), "nuevo -> cancelado");
assert.ok(!transicionPedidoValida("nuevo", "listo"), "nuevo NO -> listo");
assert.ok(!transicionPedidoValida("nuevo", "entregado"), "nuevo NO -> entregado");
assert.ok(transicionPedidoValida("preparando", "listo"), "preparando -> listo");
assert.ok(transicionPedidoValida("preparando", "cancelado"), "preparando -> cancelado");
assert.ok(!transicionPedidoValida("preparando", "nuevo"), "preparando NO -> nuevo");
assert.ok(transicionPedidoValida("listo", "entregado"), "listo -> entregado");
assert.ok(transicionPedidoValida("listo", "cancelado"), "listo -> cancelado");
assert.ok(!transicionPedidoValida("entregado", "cancelado"), "entregado NO -> cancelado");
assert.ok(!transicionPedidoValida("entregado", "nuevo"), "entregado es terminal");
assert.ok(!transicionPedidoValida("cancelado", "nuevo"), "cancelado es terminal");
assert.ok(!transicionPedidoValida("nuevo", "nuevo"), "mismo estado no");
assert.ok(!transicionPedidoValida(null, "listo"), "actual null no");
assert.ok(!transicionPedidoValida("nuevo", null), "nuevo null no");
assert.ok(!transicionPedidoValida("raro", "listo"), "estado raro no");

// El mapa declarado cuadra con la regla: cancelado desde todo menos entregado.
for (const [desde, destinos] of Object.entries(TRANSICIONES_PEDIDO)) {
  if (desde !== "entregado" && desde !== "cancelado")
    assert.ok(destinos.includes("cancelado"), `${desde} puede cancelarse`);
  else assert.ok(!destinos.includes("cancelado"), `${desde} NO puede cancelarse`);
}

// ---------------------------------------------------------------------------
// v3 — etiquetas, folio corto y hora relativa
// ---------------------------------------------------------------------------

assert.equal(etiquetaEstadoPedido("nuevo"), "Nuevo");
assert.equal(etiquetaEstadoPedido("preparando"), "En preparación");
assert.equal(etiquetaEstadoPedido("listo"), "Listo");
assert.equal(etiquetaEstadoPedido("entregado"), "Entregado");
assert.equal(etiquetaEstadoPedido("cancelado"), "Cancelado");
assert.equal(etiquetaEstadoPedido("raro"), "Desconocido");
assert.equal(etiquetaEstadoPedido(null), "Desconocido");

// Espejo del backend: "Folio web: {pedido_id[:8].upper()}".
assert.equal(
  folioCortoPedido("a1b2c3d4-e5f6-7890-abcd-ef1234567890"),
  "#A1B2C3D4",
  "primeros 8 del UUID en mayúsculas"
);
assert.equal(folioCortoPedido(""), "#—", "vacío -> guion");
assert.equal(folioCortoPedido(null), "#—", "null -> guion");

const T0 = Date.parse("2026-07-27T12:00:00.000Z");
assert.equal(horaRelativa("2026-07-27T11:59:40.000Z", T0), "hace un momento", "20 s");
assert.equal(horaRelativa("2026-07-27T11:55:00.000Z", T0), "hace 5 min");
assert.equal(horaRelativa("2026-07-27T11:00:00.000Z", T0), "hace 1 h");
assert.equal(horaRelativa("2026-07-27T09:00:00.000Z", T0), "hace 3 h");
assert.equal(horaRelativa("2026-07-26T12:00:00.000Z", T0), "hace 1 día");
assert.equal(horaRelativa("2026-07-24T12:00:00.000Z", T0), "hace 3 días");
assert.equal(horaRelativa("2026-07-13T12:00:00.000Z", T0), "hace 2 semanas");
assert.equal(horaRelativa("2026-07-27T13:00:00.000Z", T0), "hace un momento", "futura no truena");
assert.equal(horaRelativa("no-es-fecha", T0), "hace un momento", "inválida no truena");
assert.equal(horaRelativa(null, T0), "hace un momento", "null no truena");

assert.equal(etiquetaEntregaPedido("pickup"), "Recoger en tienda");
assert.equal(etiquetaEntregaPedido("domicilio"), "A domicilio");
assert.equal(etiquetaEntregaPedido("raro"), "Recoger en tienda", "raro cae a pickup");

assert.equal(etiquetaPagoPedido("efectivo"), "Efectivo al recibir");
assert.equal(etiquetaPagoPedido("en_linea"), "Pago en línea");
assert.equal(etiquetaPagoPedido("raro"), "Efectivo al recibir", "raro cae a efectivo");

rmSync(TMP, { recursive: true, force: true });
console.log("TODAS LAS PRUEBAS PASARON");
