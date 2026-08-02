// YvexPOS Móvil — Sustituciones para bajar sellos de advertencia.
//
// ═══════════════════════════════════════════════════════════════════════════
// LA REGLA DE ORO DE ESTE MÓDULO: es preferible decir "no lo recomiendo" que
// sugerir algo que eche a perder el producto o lo cambie tanto que deje de
// ser lo que era. Por eso cada sustitución tiene un NIVEL, no es una lista
// suelta de tips:
//
//   "segura"          → el ingrediente no cumple función de conservación ni
//                        de seguridad. Se recomienda sin rodeos. Puede que ni
//                        se note, o hasta mejore el producto.
//   "advertencia"      → es segura de comer y de conservar, pero SÍ cambia
//                        sabor, textura o consistencia de forma notoria.
//                        Se recomienda probar, con el aviso claro.
//   "no_recomendada"   → el ingrediente cumple una función de CONSERVACIÓN
//                        (evita hongos, controla bacterias, fija textura de
//                        curado). Bajarlo sin cambiar también el método de
//                        conservación puede echar a perder el producto o
//                        volverlo inseguro. Se dice que no, y por qué.
//
// ⚠️ ESTO ES CONOCIMIENTO GENERAL DE CIENCIA DE ALIMENTOS, NO UNA NORMA
// VERIFICADA COMO LA NOM-051. sellos.ts está verificado contra el Diario
// Oficial de la Federación, palabra por palabra; este módulo son principios
// de conservación de alimentos ampliamente aceptados (actividad de agua,
// función del azúcar/sal como conservadores), pero cada receta es distinta
// — es orientación, no una garantía de que el producto no se eche a perder.
// Para conservas y curados que se van a vender, lo correcto es siempre
// consultar a alguien de inocuidad alimentaria antes de cambiar proporciones.
// ═══════════════════════════════════════════════════════════════════════════

export type NivelSustitucion = "segura" | "advertencia" | "no_recomendada";
export type NutrienteId = "azucares" | "grasas_sat" | "grasas_trans" | "sodio";

export type CategoriaReceta =
  | "postre_lacteo" | "panificado" | "conserva_mermelada" | "salsa_aderezo"
  | "embutido_curado" | "bebida" | "botana_snack" | "otro";

export const CATEGORIAS_RECETA: { id: CategoriaReceta; n: string; ejemplos: string }[] = [
  { id: "postre_lacteo", n: "Postre lácteo", ejemplos: "Flan, natilla, pay, helado, crema" },
  { id: "panificado", n: "Panadería y repostería", ejemplos: "Pan, galletas, pastel, muffin" },
  { id: "conserva_mermelada", n: "Conserva o mermelada", ejemplos: "Mermelada, jalea, encurtido dulce" },
  { id: "salsa_aderezo", n: "Salsa o aderezo", ejemplos: "Salsa embotellada, aderezo, cátsup casera" },
  { id: "embutido_curado", n: "Embutido o curado", ejemplos: "Carne curada, queso madurado" },
  { id: "bebida", n: "Bebida", ejemplos: "Agua fresca, licuado, refresco artesanal" },
  { id: "botana_snack", n: "Botana salada", ejemplos: "Frituras, snacks, palomitas saladas" },
  { id: "otro", n: "Otro / no estoy seguro", ejemplos: "" },
];

export type Sustitucion = {
  nivel: NivelSustitucion;
  titulo: string;
  explicacion: string;
  como?: string;
};

/**
 * Devuelve la(s) sustitución(es) recomendadas para bajar un nutriente en una
 * categoría de receta específica. Si la categoría es "otro" o no se conoce,
 * se usa el criterio más cauteloso disponible para ese nutriente.
 */
export function sustitucionesPara(nutriente: NutrienteId, categoria: CategoriaReceta): Sustitucion[] {
  const tabla = TABLA[nutriente];
  return tabla[categoria] ?? tabla.otro;
}

// ───────────────────────────────────────────────────────────────────────────
// GRASAS TRANS — el caso más simple: casi siempre es correcto bajarlas.
// ───────────────────────────────────────────────────────────────────────────
// Las grasas trans en una cocina casera vienen casi siempre de un solo lugar:
// grasa vegetal parcialmente hidrogenada (margarina de barra industrial,
// manteca vegetal para hojaldre). No cumplen ninguna función de conservación
// — solo estaban ahí por costo o por textura — así que cambiarlas es seguro
// en casi cualquier receta.
const GRASAS_TRANS_GENERICA: Sustitucion[] = [{
  nivel: "segura",
  titulo: "Cambia la grasa vegetal hidrogenada por mantequilla o aceite",
  explicacion: "Las grasas trans caseras casi siempre vienen de manteca vegetal o margarina de barra hidrogenada. No conservan nada — solo estaban por costo o textura — así que quitarlas es seguro y no arriesga tu producto.",
  como: "Sustituye en la misma cantidad por mantequilla (sube un poco la saturada, pero baja o elimina la trans) o por aceite vegetal líquido (canola, girasol, maíz) si buscas bajar ambas.",
}];

// ───────────────────────────────────────────────────────────────────────────
// AZÚCARES
// ───────────────────────────────────────────────────────────────────────────
const AZUCARES: Record<CategoriaReceta, Sustitucion[]> = {
  postre_lacteo: [{
    nivel: "segura",
    titulo: "Baja el azúcar entre 15% y 25%",
    explicacion: "En un postre lácteo refrigerado (flan, natilla, crema) el azúcar es sabor, no conservador — lo que mantiene seguro al producto es el frío y la pasteurización de la leche, no el azúcar. Bajarlo un poco es seguro.",
    como: "Compénsalo con vainilla, canela o ralladura de limón: refuerzan la sensación de dulzor sin agregar azúcar.",
  }],
  panificado: [{
    nivel: "advertencia",
    titulo: "Puedes bajar el azúcar, pero cambia el resultado",
    explicacion: "En pan y repostería el azúcar no es lo que evita que se eche a perder (eso lo hace la actividad de agua y la cocción), así que bajarlo es seguro de comer. Pero SÍ hace más que endulzar: ayuda a dorar (reacción de Maillard), retiene humedad y da estructura.",
    como: "Prueba bajar hasta un 20% sin cambiar nada más. Espera que salga menos dorado, un poco más firme o se seque más rápido — es normal, no es que esté mal hecho.",
  }],
  conserva_mermelada: [{
    nivel: "no_recomendada",
    titulo: "No se aconseja bajar el azúcar sin cambiar el método",
    explicacion: "En una mermelada o conserva, el azúcar ES el conservador principal: reduce el agua disponible para que no crezcan hongos ni bacterias. Bajarlo de forma importante, sin ajustar nada más, puede hacer que tu producto se eche a perder mucho antes — a veces sin que se note a simple vista.",
    como: "Si de verdad quieres una versión baja en azúcar, es un cambio de RECETA completo (más ácido, pectina especial para bajo azúcar, y casi siempre refrigeración obligatoria con vida de anaquel más corta), no un simple ajuste de cantidad. Vale la pena consultarlo con alguien de inocuidad alimentaria antes de vender esa versión.",
  }],
  salsa_aderezo: [{
    nivel: "advertencia",
    titulo: "Depende de si tu salsa se vende de anaquel o se refrigera",
    explicacion: "Si tu salsa se consume fresca o se guarda en refrigeración, el azúcar es sobre todo sabor y es seguro bajarlo. Si la embotellas para que dure semanas fuera del refrigerador, el azúcar sí puede estar ayudando a conservarla.",
    como: "Si es de consumo rápido o refrigerada: baja con confianza. Si es de anaquel, baja poco a poco y prueba que no cambie el tiempo que dura buena.",
  }],
  embutido_curado: [{
    nivel: "advertencia",
    titulo: "El azúcar aquí suele ser secundario, pero revisa la receta",
    explicacion: "En curados, lo crítico para la seguridad normalmente es la sal y el tiempo de curado, no el azúcar. Aun así, en algunas recetas el azúcar ayuda a equilibrar la sal y alimenta el proceso de fermentación/curado.",
    como: "Si tu receta usa el azúcar solo por sabor, es razonablemente seguro bajarlo un poco. Si no estás seguro de para qué lo lleva tu receta, no lo toques.",
  }],
  bebida: [{
    nivel: "segura",
    titulo: "Baja el azúcar con confianza",
    explicacion: "En una bebida que se prepara y se consume el mismo día (agua fresca, licuado), el azúcar es solo sabor. No hay riesgo de conservación al bajarlo.",
    como: "Usa fruta más madura para compensar dulzor, o baja gradualmente: el paladar se ajusta rápido.",
  }],
  botana_snack: [{
    nivel: "advertencia",
    titulo: "Revisa si el azúcar ayuda a la textura",
    explicacion: "En algunas botanas el azúcar participa en el caramelizado o en pegar coberturas. Bajarlo es seguro de comer, pero puede cambiar cómo queda la textura final.",
  }],
  otro: [{
    nivel: "advertencia",
    titulo: "Prueba bajarlo poco a poco",
    explicacion: "Sin saber qué tipo de producto es, lo más prudente es bajar el azúcar en pasos pequeños (10-15% a la vez) y revisar que no cambie ni el sabor ni cuánto dura en buen estado.",
  }],
};

// ───────────────────────────────────────────────────────────────────────────
// GRASAS SATURADAS
// ───────────────────────────────────────────────────────────────────────────
const GRASAS_SAT: Record<CategoriaReceta, Sustitucion[]> = {
  postre_lacteo: [{
    nivel: "segura",
    titulo: "Cambia a versiones light o descremadas",
    explicacion: "En un postre de leche, la grasa saturada casi siempre viene de la crema, la leche entera o la mantequilla — ninguna cumple función de conservación. Cambiarlas es de las sustituciones más seguras que hay.",
    como: "Leche entera → leche light o descremada (si se espesa con fécula, casi no se nota). Crema para batir → leche evaporada light. Mantequilla → mantequilla light o aceite vegetal en recetas que no dependen de que cuaje (flanes, natillas sí llevan huevo para eso, no mantequilla).",
  }],
  panificado: [{
    nivel: "advertencia",
    titulo: "Cambia mantequilla o manteca por aceite vegetal",
    explicacion: "Es seguro de comer y de conservar, pero la mantequilla y la manteca no solo aportan grasa: dan estructura (el hojaldrado de una masa, lo tierno de una galleta). Cambiarlas por aceite casi siempre cambia la textura de forma notoria.",
    como: "En pasteles y muffins el cambio suele pasar casi inadvertido. En hojaldres, croissants o galletas que dependen de láminas de mantequilla fría, el resultado va a ser bastante distinto — pruébalo en una tanda chica antes de cambiar toda tu producción.",
  }],
  conserva_mermelada: [{
    nivel: "segura",
    titulo: "Si tu conserva lleva grasa, es seguro bajarla",
    explicacion: "En mermeladas y conservas dulces la grasa casi nunca está presente, y cuando lo está no es lo que conserva el producto (eso lo hace el azúcar y la acidez). Bajarla es seguro.",
  }],
  salsa_aderezo: [{
    nivel: "advertencia",
    titulo: "Cambia a versiones light si tu salsa lleva crema o mayonesa",
    explicacion: "Seguro de comer y conservar, pero crema y mayonesa dan cuerpo y cremosidad — la versión light suele quedar más aguada.",
    como: "Prueba con crema light o yogur natural sin azúcar como base; ajusta espesando un poco más con el mismo método que ya uses.",
  }],
  embutido_curado: [{
    nivel: "advertencia",
    titulo: "La grasa aquí afecta textura y ligado, no seguridad",
    explicacion: "En embutidos, la grasa ayuda a la textura y a que la pieza se mantenga unida al cocinar o curar. No es lo que hace seguro al producto (eso es la sal y el proceso de curado), pero bajarla mucho puede hacer que quede seco o se desmorone.",
    como: "Baja en pasos pequeños y prueba cada tanda — aquí el margen de error de textura es más chico que en un pastel.",
  }],
  bebida: [{
    nivel: "segura",
    titulo: "Baja con confianza si tu bebida lleva lácteos",
    explicacion: "En licuados o bebidas con leche, cambiar a versiones light es seguro y el efecto en sabor es mínimo.",
  }],
  botana_snack: [{
    nivel: "advertencia",
    titulo: "Depende del método de cocción",
    explicacion: "Si la grasa viene de freír, cambiar el método (hornear en vez de freír) baja mucho más la grasa saturada que solo cambiar el tipo de aceite, pero cambia la textura de forma notoria (menos crujiente).",
  }],
  otro: [{
    nivel: "advertencia",
    titulo: "Prueba con una versión light del ingrediente principal",
    explicacion: "Sin saber el tipo de producto, lo más seguro es probar la sustitución en una tanda pequeña antes de aplicarla a toda tu producción.",
  }],
};

// ───────────────────────────────────────────────────────────────────────────
// SODIO
// ───────────────────────────────────────────────────────────────────────────
const SODIO: Record<CategoriaReceta, Sustitucion[]> = {
  postre_lacteo: [{
    nivel: "segura",
    titulo: "El sodio rara vez es protagonista aquí",
    explicacion: "En un postre dulce, el sodio casi siempre viene de una pizca de sal para realzar sabor, no de un ingrediente que cumpla función de conservación. Bajarlo o quitarlo es seguro.",
  }],
  panificado: [{
    nivel: "advertencia",
    titulo: "Baja la sal con cuidado si usas levadura",
    explicacion: "Es seguro de comer, pero en pan con levadura la sal también regula qué tan rápido fermenta la masa — quitarla del todo puede hacer que fermente demasiado rápido y se desborde o colapse.",
    como: "Baja gradualmente (10-15% a la vez) y observa cómo se comporta la masa antes de bajar más.",
  }],
  conserva_mermelada: [{
    nivel: "advertencia",
    titulo: "Depende de si es dulce o si lleva encurtido",
    explicacion: "En mermeladas dulces, el sodio casi nunca importa para la conservación (eso lo hace el azúcar). Pero si es un encurtido o conserva salada, la sal SÍ ayuda a conservar — ahí aplica el mismo cuidado que en salmueras.",
  }],
  salsa_aderezo: [{
    nivel: "advertencia",
    titulo: "Depende de si se vende de anaquel o refrigerada",
    explicacion: "La sal en salsas embotelladas de larga vida en anaquel puede estar ayudando a conservarlas, junto con la acidez. Si tu salsa se refrigera y se consume en pocas semanas, el riesgo es mucho menor.",
    como: "Si es de anaquel: baja poco a poco y revisa que no acorte cuánto dura buena. Si es refrigerada y de consumo rápido: puedes bajar con más confianza.",
  }],
  embutido_curado: [{
    nivel: "no_recomendada",
    titulo: "No se aconseja bajar la sal en curados",
    explicacion: "En embutidos y curados, la sal (junto con el tiempo y a veces nitritos) es lo que controla el crecimiento de bacterias durante el proceso, incluidas algunas peligrosas. Bajarla sin rediseñar el proceso completo de curado es un riesgo real de seguridad alimentaria, no solo de sabor.",
    como: "Este es un cambio que requiere conocimiento especializado en curado de alimentos, no un ajuste de receta casero. Si te interesa una versión con menos sodio, consúltalo con alguien con experiencia formal en charcutería o inocuidad alimentaria antes de venderla.",
  }],
  bebida: [{
    nivel: "segura",
    titulo: "El sodio rara vez importa en una bebida",
    explicacion: "Salvo en bebidas isotónicas o algunas aguas saborizadas comerciales, el sodio no suele ser relevante ni funcional en una bebida casera. Bajarlo es seguro.",
  }],
  botana_snack: [{
    nivel: "advertencia",
    titulo: "Baja gradualmente, el sabor se nota rápido",
    explicacion: "Es seguro bajar la sal en una botana, pero el paladar la nota de inmediato — bajar de golpe suele sentirse como \"le falta sal\", aunque no haya ningún problema de conservación.",
    como: "Baja un 15-20% a la vez y dale un par de semanas a tus clientes para acostumbrarse antes de bajar más.",
  }],
  otro: [{
    nivel: "advertencia",
    titulo: "Verifica primero si tu producto se conserva a temperatura ambiente",
    explicacion: "Si tu producto se vende de anaquel (no refrigerado) y no sabes con certeza para qué lleva sal, lo más prudente es no bajarla sin asesoría — podría estar cumpliendo una función de conservación que no es obvia a simple vista.",
  }],
};

const TABLA: Record<NutrienteId, Record<CategoriaReceta, Sustitucion[]>> = {
  azucares: AZUCARES,
  grasas_sat: GRASAS_SAT,
  sodio: SODIO,
  // Las grasas trans usan la misma recomendación en todas las categorías: es
  // el único caso donde el contexto casi no cambia la respuesta.
  grasas_trans: {
    postre_lacteo: GRASAS_TRANS_GENERICA, panificado: GRASAS_TRANS_GENERICA,
    conserva_mermelada: GRASAS_TRANS_GENERICA, salsa_aderezo: GRASAS_TRANS_GENERICA,
    embutido_curado: GRASAS_TRANS_GENERICA, bebida: GRASAS_TRANS_GENERICA,
    botana_snack: GRASAS_TRANS_GENERICA, otro: GRASAS_TRANS_GENERICA,
  },
};
