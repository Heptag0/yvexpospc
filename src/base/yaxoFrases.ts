// YvexPOS — Yaxo: capa de FRASES (nivel local, sin IA).
//
// ===========================================================================
// AQUÍ NO HAY MODELO, Y POR ESO NO PUEDE MENTIR
// ===========================================================================
// Todo lo que dice Yaxo en el plan local sale de este archivo: plantillas con
// los números ya calculados metidos dentro. Se lee como una conversación, pero
// no la generó una IA.
//
// Esa es la garantía y no una limitación disfrazada: un modelo puede saltarse
// una instrucción por bien escrita que esté, y la que más se salta es la de no
// calcular. Una plantilla no calcula: recibe el número hecho. Si el margen no
// es fiable, aquí ni siquiera existe la frase que lo afirmaría.
//
// Sirve además para lo que el plan de nube NO cubre: cuando no hay internet,
// esto sigue respondiendo. Un asistente que se cae con la conexión, dentro de
// un punto de venta que presume de funcionar sin ella, sería una contradicción
// que el usuario nota el primer día.
//
// ===========================================================================
// EXPLICAR, NO SENTENCIAR
// ===========================================================================
// El dueño de una tienda YA SABE, más o menos, qué vende y qué le falta. Si
// Yaxo solo dice "resurte Coca", no aporta nada y encima repite el aviso de
// stock mínimo que ya existe.
//
// Lo que no sabe es el número exacto ni de dónde sale. Por eso cada frase
// enseña el camino: "vendes unas 12 al día, te quedan 26, eso te dura hasta el
// martes". El dato y el porqué, juntos. Ahí es donde aprende algo de su propio
// negocio, que es el trabajo del asistente.
//
// REGLA AL AÑADIR FRASES: si una frase da una conclusión sin la cifra que la
// sostiene, está mal escrita. "Te conviene subir el precio" no vale; "deja 8
// puntos menos que el resto de su departamento" sí.
//
// ===========================================================================
// VARIACIÓN: LA MISMA RESPUESTA, DISTINTAS PALABRAS
// ===========================================================================
// Leer tres veces la misma frase exacta delata la plantilla y rompe la ilusión
// de que hay alguien del otro lado. Por eso los huecos que se repiten mucho
// —aperturas, cierres, conectores— pasan por `variar()`, que ROTA en vez de
// sortear: con azar puro acaba saliendo la misma dos veces seguidas, y eso se
// nota más que no variar nada.
//
// ⚠️ TODAS las variantes de un hueco tienen que ser intercambiables SIN que
// cambie lo que el usuario entiende. Escribir una versión "más suave" de una
// mala noticia no es variar la forma, es cambiar el contenido. Si dos variantes
// no dicen lo mismo, una sobra.
//
// ===========================================================================
// PUNTO DE EXTENSIÓN — YVEXCONTA
// ===========================================================================
// Este archivo es el de CONTEXTO "pos" (ver ContextoYaxo en yaxoVoz.ts). Lo
// fiscal irá en `yaxoFrasesConta.ts`, con la misma forma: funciones que reciben
// indicadores y devuelven RespuestaYaxo. Lo que se comparte entre los dos es
// el tipo RespuestaYaxo, las ayudas de redacción y `variar()`; lo que no, las
// plantillas, porque hablan de cosas distintas.
//
// ===========================================================================
// PUNTO DE EXTENSIÓN — PLAN PREMIUM
// ===========================================================================
// Nada de este archivo se tira cuando llegue el modelo. Al contrario: es el
// respaldo cuando no hay internet, que es la mitad del argumento de venta del
// POS. El premium AÑADE una capa que llama a la API con `hechosParaModelo()`;
// si esa llamada falla o no hay conexión, se cae aquí y el usuario sigue
// teniendo respuesta.
//
// ===========================================================================
// LO QUE NUNCA SE ESCRIBE AQUÍ
// ===========================================================================
// Estas son las reglas de honestidad del analista anterior, traídas porque se
// aprendieron fallando:
//
//   - NUNCA prometer el resultado de una acción que depende del cliente.
//     "Si subes el precio 5% ganas $X" es falso: el cliente puede comprar
//     menos. Se señala la oportunidad y se invita a probar y medir.
//   - NUNCA afirmar una tendencia sin días suficientes (ver reservas).
//   - NUNCA dar un margen cuando falta costo capturado. El costo que falta no
//     es cero, es desconocido, y son cosas distintas.
//   - NUNCA comparar contra un día en curso como si estuviera cerrado.
//
// Las cuatro están implementadas abajo, no solo comentadas.

import { HechosNegocio } from "./yaxoHechos";
import {
  RitmoProducto,
  ProductoParado,
  MargenComparado,
  Umbrales,
  UMBRALES_POR_DEFECTO,
  DIAS_SIN_VENTA_PARADO,
} from "./indicadores";
import type { EstadoYaxo } from "@/src/componentes/Yaxo";
import { variar } from "./yaxoVoz";

export type RespuestaYaxo = {
  /** Una línea. Lo que se lee primero y a veces lo único que se lee. */
  titulo: string;
  /** Dos o tres párrafos cortos. El primero es el hallazgo; el resto, el
   *  porqué. Nunca más de tres: un tendero lee esto entre cliente y cliente. */
  parrafos: string[];
  /** Cara que pone Yaxo. Conecta con el componente del mismo nombre. */
  estado: EstadoYaxo;
  /** IDs de preguntas que tienen sentido DESPUÉS de esta respuesta. Es lo que
   *  convierte respuestas sueltas en conversación.
   *
   *  SON IDs, NO TEXTOS, y la distinción importa: la primera versión guardaba
   *  aquí el texto del chip ("¿Cómo voy?") y no coincidía con el de la pantalla
   *  ("¿Cómo voy hoy?"), así que la sugerencia se perdía en silencio. Con ids,
   *  cambiar la redacción de un chip no rompe nada. */
  siguientes?: string[];
  /** Opciones que Yaxo ofrece EN ESTA respuesta, como chips.
   *
   *  A diferencia de `siguientes` —que solo reordena preguntas que ya existen
   *  en el repertorio— esto es una REPREGUNTA: Yaxo acaba de preguntar algo y
   *  estas son las respuestas posibles. Se muestran delante de todo y
   *  desaparecen en cuanto se contesta o se cambia de tema.
   *
   *  El `id` lleva el formato "pregunta:argumento" (por ejemplo
   *  "resurtir:urgente"). La pantalla parte por los dos puntos y le pasa el
   *  argumento a la función que resuelve esa pregunta. Así una repregunta no
   *  necesita entradas nuevas en el repertorio ni ids inventados que después
   *  haya que mantener sincronizados entre las dos plataformas.
   *
   *  CUÁNDO USARLO, y es una línea que conviene no cruzar: solo cuando la
   *  respuesta CAMBIA de verdad según lo que se conteste y no hay un valor
   *  obvio por defecto. Si lo hay, se contesta con él, se dice cuál se usó, y
   *  se ofrece cambiarlo DESPUÉS. Preguntar de vuelta antes de ayudar es
   *  devolverle el trabajo al dueño, y eso es un menú telefónico, no un
   *  asistente. */
  opciones?: OpcionYaxo[];
};

export type OpcionYaxo = {
  /** "pregunta:argumento" — ver la nota de `opciones` arriba. */
  id: string;
  texto: string;
};

/** Formateador de dinero inyectado (pesos, de src/base/formato). Mismo patrón
 *  que componerTitular en reportes.ts: este archivo no depende de la capa de
 *  presentación. */
export type Fmt = (centavos: number) => string;

// ---------------------------------------------------------------------------
// Ayudas de redacción
// ---------------------------------------------------------------------------

/**
 * Cantidad por día en lenguaje de persona.
 *
 * "Vendes 0.43 al día" es correcto y no lo dice nadie. Por debajo de una
 * unidad diaria se pasa a la semana, que es como se piensa un producto de
 * rotación lenta.
 */
function ritmoEnPalabras(porDia: number, unidad: string): string {
  const plural = unidad === "pieza" ? "" : ` ${unidad}`;
  if (porDia >= 10) return `unos ${Math.round(porDia)}${plural} al día`;
  // "unos 1 al día" no lo dice nadie. El caso de la unidad exacta se escribe
  // aparte porque es el más frecuente en productos de rotación media.
  if (porDia >= 1 && porDia < 1.05) return `uno${plural} al día`;
  if (porDia >= 1) return `unos ${porDia.toFixed(1).replace(".0", "")}${plural} al día`;
  const porSemana = porDia * 7;
  if (porSemana >= 1) return `unos ${porSemana.toFixed(1).replace(".0", "")}${plural} a la semana`;
  return `menos de uno${plural} a la semana`;
}

/** Días en lenguaje de persona: nadie dice "2.7 días". */
function diasEnPalabras(dias: number): string {
  if (dias < 1) return "menos de un día";
  if (dias < 2) return "un día";
  if (dias < 14) return `${Math.round(dias)} días`;
  const semanas = Math.round(dias / 7);
  return `unas ${semanas} semanas`;
}

function etiquetaRango(r: HechosNegocio["rango"]): string {
  switch (r) {
    case "hoy": return "hoy";
    case "7d": return "los últimos 7 días";
    case "30d": return "los últimos 30 días";
    case "mes": return "este mes";
  }
}

// ---------------------------------------------------------------------------
// 1. "¿Cómo voy?"
// ---------------------------------------------------------------------------

export function comoVoy(h: HechosNegocio, fmt: Fmt): RespuestaYaxo {
  const r = h.resumen;
  const et = etiquetaRango(h.rango);

  if (h.reservas.sinVentas) {
    return {
      titulo: `Todavía no hay ventas ${et}`,
      parrafos: [
        "En cuanto cobres el primer ticket te puedo ir contando cómo va el día.",
      ],
      estado: "reposo",
      siguientes: ["parado", "resurtir"],
    };
  }

  const parrafos: string[] = [];

  // Párrafo 1: el dato, con su desglose. Si hubo devoluciones se explica la
  // resta, porque si no el usuario compara con lo que vio en la caja y no
  // cuadra.
  const tk = `${r.tickets} ${r.tickets === 1 ? "ticket" : "tickets"}`;
  if (r.devuelto_centavos > 0) {
    // Cuando hubo devoluciones SIEMPRE se explica la resta. Sin eso el usuario
    // compara con lo que vio en la caja, no le cuadra, y concluye que la app
    // está mal. Solo varía cómo se dice, nunca si se dice.
    parrafos.push(
      variar("voy-devuelto", [
        `Llevas ${fmt(r.total_centavos)} ${et}, en ${tk}. Cobraste ${fmt(r.bruto_centavos)} y devolviste ${fmt(r.devuelto_centavos)}, por eso la cifra de arriba es la que de verdad te quedó.`,
        `${et.charAt(0).toUpperCase() + et.slice(1)} te quedaron ${fmt(r.total_centavos)} de ${tk}. Por caja pasaron ${fmt(r.bruto_centavos)}, pero devolviste ${fmt(r.devuelto_centavos)} y eso ya va descontado.`,
        `Vas en ${fmt(r.total_centavos)} ${et}, con ${tk}. Ojo que no es todo lo que cobraste: entraron ${fmt(r.bruto_centavos)} y se fueron ${fmt(r.devuelto_centavos)} en devoluciones.`,
      ])
    );
  } else {
    parrafos.push(
      variar("voy-normal", [
        `Llevas ${fmt(r.total_centavos)} ${et}, en ${tk}. Eso da ${fmt(r.promedio_centavos)} por ticket.`,
        `${et.charAt(0).toUpperCase() + et.slice(1)} vas en ${fmt(r.total_centavos)}, repartidos en ${tk}. Cada cliente te dejó ${fmt(r.promedio_centavos)} en promedio.`,
        `Van ${fmt(r.total_centavos)} ${et} con ${tk}, o sea ${fmt(r.promedio_centavos)} por venta.`,
      ])
    );
  }

  // Párrafo 2: la comparación, SOLO si hay con qué comparar.
  const v = h.comparativo.variacionPct;
  if (h.reservas.pocosDatos) {
    const d = `${h.reservas.diasConVenta} ${h.reservas.diasConVenta === 1 ? "día" : "días"}`;
    parrafos.push(
      variar("voy-pocos", [
        `Todavía no te puedo decir si vas mejor o peor que antes: llevas ${d} con ventas registradas y con tan poco cualquier comparación engaña más de lo que ayuda.`,
        `Me falta historial para compararte con nada. Con ${d} de ventas, decirte que subiste o bajaste sería inventar: un martes flojo y un sábado bueno dan cualquier número.`,
        `Prefiero no comparar todavía. Llevas ${d} con movimiento y hace falta algo más para que la comparación signifique algo de verdad.`,
      ])
    );
  } else if (v !== null && Math.abs(v) >= 5) {
    const signo = v > 0 ? "más" : "menos";
    const pct = Math.abs(Math.round(v));
    const ant = fmt(h.comparativo.anterior.total_centavos);
    const enCurso =
      h.rango === "hoy"
        ? " " + variar("voy-encurso", [
            "Ojo que el día todavía va a medias, así que la comparación se va a mover.",
            "Aunque falta que termine el día: esto todavía va a cambiar.",
            "Tenlo en cuenta: el día no ha cerrado y el número sigue vivo.",
          ])
        : "";
    parrafos.push(
      variar("voy-comp", [
        `Es un ${pct}% ${signo} que el periodo anterior, cuando llevabas ${ant}.`,
        `Comparado con el periodo pasado vas un ${pct}% ${signo}: entonces llevabas ${ant}.`,
        `Contra los mismos días de antes, un ${pct}% ${signo}. En aquel tramo fueron ${ant}.`,
      ]) + enCurso
    );
  }

  // Párrafo 3: la ganancia, SOLO si el costo está capturado.
  if (h.utilidad && !h.reservas.margenIncompleto) {
    const g = fmt(h.utilidad.utilidad_centavos);
    const mg = h.utilidad.margenPct.toFixed(1);
    parrafos.push(
      variar("voy-ganancia", [
        `De eso, ${g} son ganancia: un ${mg}% de margen, calculado con el costo que tenía cada producto cuando lo vendiste.`,
        `Lo que te quedó limpio son ${g}, un ${mg}% de margen. Uso el costo del momento de la venta, no un promedio.`,
        `Ganancia: ${g}, o sea ${mg}% de margen. Cada producto cuenta con el costo que traía ese día.`,
      ])
    );
  } else if (h.reservas.productosSinCosto > 0) {
    parrafos.push(
      `No te puedo decir cuánto ganaste porque ${h.reservas.productosSinCosto} ` +
        `${h.reservas.productosSinCosto === 1 ? "producto" : "productos"} de los ` +
        `que vendiste no ${h.reservas.productosSinCosto === 1 ? "tiene" : "tienen"} ` +
        `costo capturado. Si se lo pones, la próxima vez sí te doy el número.`
    );
  }

  const subiendo = v !== null && v > 5 && !h.reservas.pocosDatos;
  return {
    titulo: `${fmt(r.total_centavos)} ${et}`,
    parrafos,
    estado: subiendo ? "feliz" : "reposo",
    siguientes: ["resurtir", "parado"],
  };
}

// ---------------------------------------------------------------------------
// 2. "¿Qué debo resurtir?"
// ---------------------------------------------------------------------------

/** Modo de "qué resurtir": solo lo que se acaba ya, o todo lo del periodo.
 *
 *  Sin modo, Yaxo REPREGUNTA — pero solo cuando la distinción importa de
 *  verdad, es decir, cuando hay bastante más pendiente que urgente. Si todo lo
 *  que hay es urgente, preguntar "¿todo o solo lo urgente?" sería ofrecer una
 *  elección entre dos cosas idénticas. */
export type ModoResurtir = "urgente" | "todo";

/** Cobertura por debajo de la cual algo entra en "todo lo del periodo". Es el
 *  horizonte de una compra normal de resurtido: lo que se acaba dentro del
 *  mes. Más allá, no es resurtir, es sobrestock. */
export const DIAS_COBERTURA_PERIODO = 30;

/** A partir de cuántos productos extra vale la pena repreguntar. Con uno o dos
 *  de diferencia, la elección no cambia nada y solo añade un toque. */
const DIFERENCIA_PARA_PREGUNTAR = 3;

export function queResurtir(
  ritmo: RitmoProducto[],
  fmt: Fmt,
  modo?: ModoResurtir,
  // Los umbrales REALES, que el dueño puede haber cambiado. Van como
  // parámetro y no importados como constante porque desde que son
  // configurables, la constante es solo el valor por defecto: filtrar aquí
  // con 7 días mientras indicadores.ts calculó con 14 dejaría a Yaxo diciendo
  // un número y razonando con otro, sin que nada lo avisara.
  u: Umbrales = UMBRALES_POR_DEFECTO
): RespuestaYaxo {
  const urgentes = ritmo.filter(
    (p) => p.diasCobertura !== null && p.diasCobertura <= u.diasCoberturaAlerta
  );
  const delPeriodo = ritmo.filter(
    (p) => p.diasCobertura !== null && p.diasCobertura <= DIAS_COBERTURA_PERIODO
  );

  if (ritmo.length === 0) {
    return {
      titulo: "Todavía no tengo suficiente historial",
      parrafos: [
        `Para decirte a qué ritmo se vende cada cosa necesito verlas moverse ` +
          `unos días. Con las ventas de las próximas dos semanas ya te puedo ` +
          `decir qué se te va a acabar y cuándo.`,
      ],
      estado: "reposo",
    };
  }

  // Repregunta: solo si hay una diferencia REAL entre las dos listas y el
  // dueño no ha elegido ya. Se responde con el dato que ya se tiene (cuántos
  // hay) en vez de devolver una pregunta a secas: así la repregunta afina, no
  // retrasa.
  if (
    modo === undefined &&
    urgentes.length > 0 &&
    delPeriodo.length - urgentes.length >= DIFERENCIA_PARA_PREGUNTAR
  ) {
    return {
      titulo: "¿Hasta dónde te lo saco?",
      parrafos: [
        variar("resurtir-pregunta", [
          `Tienes ${urgentes.length} productos que se acaban esta semana y ${delPeriodo.length} que se acaban dentro del mes. ¿Te doy solo lo urgente o todo?`,
          `Se te acaban ${urgentes.length} en los próximos días, y ${delPeriodo.length} contando todo el mes. Dime hasta dónde llego.`,
          `Hay ${urgentes.length} urgentes y ${delPeriodo.length} si miramos el mes entero. ¿Cuál te sirve más?`,
        ]),
      ],
      estado: "pensativo",
      opciones: [
        { id: "resurtir:urgente", texto: `Solo lo urgente (${urgentes.length})` },
        { id: "resurtir:todo", texto: `Todo el mes (${delPeriodo.length})` },
      ],
    };
  }

  if (urgentes.length === 0) {
    const primero = ritmo[0];
    return {
      titulo: "Por ahora vas bien de existencias",
      parrafos: [
        `Nada de lo que se mueve se te acaba en la próxima semana. Lo más ` +
          `justo es ${primero.nombre}: vendes ${ritmoEnPalabras(primero.porDia, primero.unidad)} ` +
          `y te quedan ${primero.stock}, o sea ${diasEnPalabras(primero.diasCobertura ?? 0)}.`,
      ],
      estado: "feliz",
      siguientes: ["parado", "hoy"],
    };
  }

  // La lista sobre la que se responde. Con modo "todo" es el mes entero; en
  // cualquier otro caso, lo urgente. Es la ÚNICA diferencia entre los dos
  // modos: el texto, el razonamiento y el orden son los mismos, porque lo que
  // cambia es el horizonte, no la forma de razonar.
  const lista = modo === "todo" ? delPeriodo : urgentes;
  const p = lista[0];
  const parrafos: string[] = [];

  // El cálculo a la vista. Esto es lo que NO da el aviso de stock mínimo.
  // `ritmoTxt` y no `ritmo`: el parámetro de la función YA se llama `ritmo`.
  // Declarar una const con el mismo nombre en el mismo ámbito rompe el bundle
  // en tiempo de compilación ("Identifier 'ritmo' has already been declared").
  const ritmoTxt = ritmoEnPalabras(p.porDia, p.unidad);
  const dura = diasEnPalabras(p.diasCobertura ?? 0);
  parrafos.push(
    variar("res-calculo", [
      `${p.nombre} es lo más urgente. En estos ${p.diasObservados} días vendiste ${p.unidadesVendidas} y te quedan ${p.stock}: a ese ritmo (${ritmoTxt}) te dura ${dura}.`,
      `Lo que más corre es ${p.nombre}. Vendes ${ritmoTxt} y en el estante quedan ${p.stock}, así que te alcanza para ${dura}. Lo saco de las ${p.unidadesVendidas} que salieron en ${p.diasObservados} días.`,
      `Empezaría por ${p.nombre}. Salieron ${p.unidadesVendidas} en ${p.diasObservados} días —${ritmoTxt}— y te quedan ${p.stock}: eso es ${dura} y se acaba.`,
    ])
  );

  if (p.reponerSemanaCentavos > 0) {
    parrafos.push(
      variar("res-costo", [
        `Reponer una semana te costaría alrededor de ${fmt(p.reponerSemanaCentavos)}, con el último costo que tienes capturado.`,
        `Para aguantar otra semana necesitarías unos ${fmt(p.reponerSemanaCentavos)}, según el costo que traes registrado.`,
        `Traer para una semana son más o menos ${fmt(p.reponerSemanaCentavos)} al costo que tienes puesto.`,
      ])
    );
  }

  if (lista.length > 1) {
    const otros = lista.slice(1, 4).map((x) => x.nombre);
    parrafos.push(
      `También andan justos ${otros.join(", ")}` +
        (lista.length > 4 ? ` y ${lista.length - 4} más` : "") + "."
    );
  }

  // Si contestó "solo lo urgente" pero hay más dentro del mes, se ofrece
  // ampliar sin volver a preguntar. Al revés no: quien pidió todo ya vio lo
  // urgente dentro de la lista.
  const opciones =
    modo === "urgente" && delPeriodo.length > urgentes.length
      ? [{ id: "resurtir:todo", texto: `Ver todo el mes (${delPeriodo.length})` }]
      : undefined;

  return {
    titulo:
      modo === "todo"
        ? `${lista.length} ${lista.length === 1 ? "producto se te acaba" : "productos se te acaban"} este mes`
        : `${lista.length} ${lista.length === 1 ? "producto se te acaba" : "productos se te acaban"} esta semana`,
    parrafos,
    estado: "alerta",
    siguientes: ["parado", "hoy"],
    opciones,
  };
}

// ---------------------------------------------------------------------------
// 3. "¿Qué tengo parado?"
// ---------------------------------------------------------------------------

export function queTengoParado(parados: ProductoParado[], fmt: Fmt): RespuestaYaxo {
  if (parados.length === 0) {
    return {
      titulo: "No tienes nada parado",
      parrafos: [
        `Todo lo que tienes en existencia se ha movido en los últimos ` +
          `${DIAS_SIN_VENTA_PARADO} días. Eso está muy bien: significa que el ` +
          `dinero que metiste en inventario está trabajando.`,
      ],
      estado: "feliz",
      siguientes: ["resurtir", "hoy"],
    };
  }

  const total = parados.reduce((s, p) => s + p.inmovilizadoCentavos, 0);
  const primero = parados[0];
  const parrafos: string[] = [];

  const cuantos = `${parados.length} ${parados.length === 1 ? "producto" : "productos"}`;
  parrafos.push(
    variar("par-total", [
      `Tienes ${fmt(total)} en ${cuantos} que no se ${parados.length === 1 ? "ha" : "han"} vendido en ${DIAS_SIN_VENTA_PARADO} días. Es dinero que ya pagaste y está ahí quieto.`,
      `Hay ${fmt(total)} dormidos en tu inventario: ${cuantos} sin moverse en ${DIAS_SIN_VENTA_PARADO} días. Ese dinero ya salió de tu bolsa.`,
      `${fmt(total)} en ${cuantos} llevan ${DIAS_SIN_VENTA_PARADO} días sin venderse. Es capital tuyo parado en el estante.`,
    ])
  );

  parrafos.push(
    `El que más pesa es ${primero.nombre}: ${primero.stock} ${primero.unidad} ` +
      `que suman ${fmt(primero.inmovilizadoCentavos)}` +
      (primero.diasSinVender !== null
        ? `, sin venderse desde hace ${diasEnPalabras(primero.diasSinVender)}.`
        : `, y no tengo registro de que se haya vendido nunca.`)
  );

  // Se invita a probar, NO se promete resultado: bajar el precio puede no
  // moverlo, y prometerlo es exactamente lo que no se hace aquí.
  // Se INVITA A PROBAR, nunca se promete resultado: bajar el precio puede no
  // moverlo, y prometerlo es justo la regla que este archivo no rompe. Las tres
  // variantes mantienen esa forma.
  parrafos.push(
    variar("par-accion", [
      `Vale la pena decidir algo con eso: moverlo a un lugar más visible, armarlo en paquete con algo que sí sale, o bajarle el precio para recuperar el dinero. Pruébalo con uno y mira qué pasa antes de hacerlo con todos.`,
      `Algo hay que hacer con eso. Cambiarlo de lugar, meterlo en un paquete con algo que se mueva, o rematarlo. Yo probaría con uno solo primero, a ver si responde.`,
      `Tienes opciones: sacarlo al frente, juntarlo con un producto que sí salga, o bajarle el precio. No sé cuál va a funcionar en tu tienda, así que prueba una y mide.`,
    ])
  );

  if (primero.estimadoConPrecio) {
    parrafos.push(
      `Una nota: ese monto lo calculé con el precio de venta porque no tiene ` +
        `costo capturado, así que el dinero real que metiste es menos.`
    );
  }

  return {
    titulo: `${fmt(total)} parados en inventario`,
    parrafos: parrafos.slice(0, 4),
    estado: "pensativo",
    siguientes: ["resurtir", "precios"],
  };
}

// ---------------------------------------------------------------------------
// 4. "¿Estoy cobrando bien?"
// ---------------------------------------------------------------------------

/** Diferencia mínima en puntos para que valga la pena mencionarla. Por debajo
 *  es variación normal entre productos del mismo departamento. */
const PUNTOS_DIFERENCIA_NOTABLE = 8;

export function estoyCobrandoBien(
  margenes: MargenComparado[],
  fmt: Fmt
): RespuestaYaxo {
  const bajos = margenes.filter(
    (m) => m.diferenciaPuntos <= -PUNTOS_DIFERENCIA_NOTABLE && m.departamento
  );

  if (margenes.length === 0) {
    return {
      titulo: "Aún no puedo comparar precios",
      parrafos: [
        `Para esto necesito que tus productos tengan capturado el costo, y que ` +
          `se hayan vendido unas cuantas veces. Conforme vayas poniendo costos ` +
          `te puedo ir diciendo cuáles se salen de lo normal en su departamento.`,
      ],
      estado: "reposo",
    };
  }

  if (bajos.length === 0) {
    return {
      titulo: "Tus precios se ven parejos",
      parrafos: [
        `Revisé cada producto contra los demás de su mismo departamento y ` +
          `ninguno se sale de lo normal. Comparo dentro del departamento a ` +
          `propósito: que los refrescos dejen menos que las botanas es normal en ` +
          `cualquier tienda, lo que importa es que un refresco no deje mucho ` +
          `menos que los otros refrescos.`,
      ],
      estado: "feliz",
      siguientes: ["parado", "hoy"],
    };
  }

  const m = bajos[0];
  return {
    titulo: `${m.nombre} deja menos que sus vecinos`,
    parrafos: [
      `${m.nombre} te está dejando un ${m.margenPct.toFixed(0)}% de margen, ` +
        `mientras que el resto de ${m.departamento} deja ` +
        `${m.margenDeptoPct.toFixed(0)}%. Son ${Math.abs(Math.round(m.diferenciaPuntos))} ` +
        `puntos de diferencia.`,
      `No quiere decir que esté mal: puede ser un producto gancho, o que te ` +
        `subieron el costo y el precio se quedó igual. Vale la pena que lo ` +
        `revises y decidas tú, porque vendiste ${m.unidadesVendidas} en estas ` +
        `semanas y eso ya mueve dinero.`,
      bajos.length > 1
        ? `Hay ${bajos.length - 1} más en la misma situación.`
        : "",
    ].filter(Boolean),
    estado: "pensativo",
    siguientes: ["parado", "hoy"],
  };
}

// ===========================================================================
// ¿QUÉ DÍA DE LA SEMANA VENDO MÁS?
// ===========================================================================
// La cifra sola ("el sábado, $5,598") no dice nada: puede ser un sábado
// bueno o el día que sostiene el negocio. Por eso siempre viaja con la media
// de los otros días y se dice cuánto destaca.
//
// Y no se acompaña de un consejo. La tentación es cerrar con "pon más
// personal el sábado" o "surte el viernes", y eso depende de cosas que Yaxo
// no sabe: si tiene a quién contratar, si el proveedor pasa ese día, si el
// local aguanta más gente. Se da el dato y el dueño decide — es su negocio.

export function mejorDiaSemana(
  mejor: { nombre: string; total_centavos: number } | null,
  fmt: Fmt,
  mediaOtrosCentavos?: number
): RespuestaYaxo {
  if (!mejor) {
    return {
      titulo: "Todavía no puedo decírtelo",
      parrafos: [
        variar("dia-sin", [
          "Necesito varias semanas de ventas para comparar unos días con otros. Con lo que llevas, cualquier día podría parecer el mejor solo porque cayó una venta grande.",
          "Aún no hay suficientes días registrados. Con pocas semanas, un día cualquiera destaca por casualidad y no porque de verdad sea el fuerte.",
          "Me faltan semanas para poder comparar. Ahora mismo señalaría un día al azar y te lo diría con toda la seguridad, que es lo peor que podría hacer.",
        ]),
      ],
      estado: "pensativo",
      siguientes: ["hoy", "semana"],
    };
  }

  const media = mediaOtrosCentavos ?? 0;
  const destaca = media > 0 ? Math.round(((mejor.total_centavos - media) / media) * 100) : 0;

  const parrafos = [
    variar("dia-hallazgo", [
      `Tu día fuerte es el ${mejor.nombre}: ${fmt(mejor.total_centavos)} sumando todos los ${mejor.nombre}s del periodo.`,
      `El ${mejor.nombre} es el que más te deja: ${fmt(mejor.total_centavos)} entre todos los del periodo.`,
      `Vendes más en ${mejor.nombre}. En total, ${fmt(mejor.total_centavos)} sumando todos los del periodo.`,
    ]),
  ];

  // Solo se afirma que "destaca" si hay con qué compararlo y la diferencia es
  // lo bastante grande. Un 6% arriba no es un día fuerte, es ruido.
  if (media > 0 && destaca >= 15) {
    parrafos.push(
      variar("dia-destaca", [
        `Es un ${destaca}% más que un día normal, que te deja alrededor de ${fmt(media)}.`,
        `Eso es ${destaca}% por encima del resto: los demás días rondan los ${fmt(media)}.`,
        `Comparado con los otros días, que andan por ${fmt(media)}, está un ${destaca}% arriba.`,
      ])
    );
  } else if (media > 0) {
    parrafos.push(
      variar("dia-parejo", [
        `Aunque va primero, tus días están bastante parejos: el resto ronda los ${fmt(media)}. No hay un día que sostenga el negocio.`,
        `La diferencia con los demás es corta —andan por ${fmt(media)}—, así que tu venta está repartida.`,
        `No destaca mucho: los otros días rondan ${fmt(media)}. Tu semana es pareja.`,
      ])
    );
  }

  return {
    titulo: `Vendes más en ${mejor.nombre}`,
    parrafos,
    estado: "contable",
    siguientes: ["semana", "hoy"],
  };
}

// ===========================================================================
// ¿QUÉ PRODUCTO ME DEJA MÁS GANANCIA?
// ===========================================================================
// El producto que más FACTURA casi nunca es el que más DEJA. Esta respuesta
// existe para separar esas dos cosas, y por eso siempre dice las dos cifras:
// lo que vendió y lo que quedó de ahí.

export function productoQueMasDeja(
  top: { nombre: string; cantidad: number; total_centavos: number; ganancia_centavos: number; margen_pct: number }[],
  fmt: Fmt
): RespuestaYaxo {
  if (top.length === 0) {
    return {
      titulo: "Todavía no puedo calcularlo",
      parrafos: [
        variar("gana-sin", [
          "Para saber cuánto te deja cada producto necesito su costo, y ninguno de los que has vendido lo tiene capturado.",
          "Me falta el costo de lo que vendiste. Sin eso no hay ganancia que calcular, solo precio de venta.",
          "No tengo el costo de los productos vendidos, así que cualquier ganancia que te dijera me la estaría inventando.",
        ]),
      ],
      estado: "pensativo",
      siguientes: ["sincosto", "precios"],
    };
  }

  const p = top[0];
  const parrafos = [
    variar("gana-primero", [
      `${p.nombre} es el que más te deja: ${fmt(p.ganancia_centavos)} de ganancia. Vendió ${fmt(p.total_centavos)} y de ahí te quedaron esos ${fmt(p.ganancia_centavos)} — un ${p.margen_pct}% de margen.`,
      `Lo que más ganancia te da es ${p.nombre}: ${fmt(p.ganancia_centavos)}. De los ${fmt(p.total_centavos)} que facturó, eso es lo que se quedó contigo (${p.margen_pct}%).`,
      `${p.nombre} encabeza la lista con ${fmt(p.ganancia_centavos)} de ganancia, sobre ${fmt(p.total_centavos)} vendidos. Su margen es del ${p.margen_pct}%.`,
    ]),
  ];

  if (top.length > 1) {
    const resto = top
      .slice(1, 4)
      .map((x) => `${x.nombre} (${fmt(x.ganancia_centavos)})`)
      .join(", ");
    parrafos.push(
      variar("gana-resto", [
        `Detrás van ${resto}.`,
        `Le siguen ${resto}.`,
        `Después están ${resto}.`,
      ])
    );
  }

  parrafos.push(
    variar("gana-aviso", [
      "Ojo: esto es de los productos que tienen costo capturado. Si te falta capturar costos, la lista puede cambiar.",
      "Solo cuento los productos con costo registrado. Los que no lo tienen no aparecen aquí aunque vendan mucho.",
      "Esta lista deja fuera lo que no tiene costo capturado, porque de eso no puedo saber la ganancia.",
    ])
  );

  return {
    titulo: `${p.nombre} es lo que más te deja`,
    parrafos,
    estado: "feliz",
    siguientes: ["volumen", "precios"],
  };
}

// ===========================================================================
// ¿QUÉ VENDO MUCHO PERO ME DEJA POCO?
// ===========================================================================
// El hallazgo más incómodo que puede dar Yaxo, y por eso el que más cuidado
// pide en el tono. NO se dice "estás perdiendo dinero" —nadie le quitó nada
// al dueño— sino cuánto MÁS habría ganado si ese producto dejara como el
// resto. Es la misma cifra, dicha sin acusar.
//
// Y no se recomienda subir el precio. Esa decisión depende de la competencia
// de enfrente, de si el producto es el que trae a la gente a la tienda, y de
// cosas que Yaxo no ve. Se pone el número encima de la mesa y ya.

export function vendoMuchoDejaPoco(
  items: {
    nombre: string;
    departamento: string | null;
    pesoPct: number;
    margenPct: number;
    margenNegocioPct: number;
    puntosDebajo: number;
    huecoCentavos: number;
    diasObservados: number;
  }[],
  fmt: Fmt
): RespuestaYaxo {
  if (items.length === 0) {
    return {
      titulo: "Nada que se salga de la norma",
      parrafos: [
        variar("vol-nada", [
          "Lo que más vendes deja un margen parecido al del resto de tu negocio. No hay ningún producto grande arrastrando tu ganancia hacia abajo.",
          "No encontré un producto que pese mucho en tus ventas y deje bastante menos que los demás. Tus márgenes van parejos.",
          "Revisé lo que más mueve tu negocio y ninguno deja notablemente menos que el promedio. Por ese lado estás bien.",
        ]),
      ],
      estado: "feliz",
      siguientes: ["ganancia", "precios"],
    };
  }

  const p = items[0];
  const parrafos = [
    variar("vol-hallazgo", [
      `${p.nombre} es el ${p.pesoPct}% de tus ventas pero deja un ${p.margenPct}%, cuando tu negocio entero deja ${p.margenNegocioPct}%.`,
      `Fíjate en ${p.nombre}: mueve el ${p.pesoPct}% de lo que vendes y su margen es del ${p.margenPct}%, contra el ${p.margenNegocioPct}% que deja tu negocio en general.`,
      `${p.nombre} pesa mucho —el ${p.pesoPct}% de tus ventas— y deja poco: ${p.margenPct}% frente al ${p.margenNegocioPct}% del resto.`,
    ]),
    variar("vol-hueco", [
      `Si dejara como tu promedio, en estos ${p.diasObservados} días habrías ganado ${fmt(p.huecoCentavos)} más. No es dinero que hayas perdido: es lo que hay de diferencia.`,
      `Esa diferencia son ${fmt(p.huecoCentavos)} en ${p.diasObservados} días. Nadie te los quitó; es lo que habrías ganado de más si dejara como los demás.`,
      `Puesto en pesos: ${fmt(p.huecoCentavos)} de diferencia en ${p.diasObservados} días respecto a si rindiera como el resto de tu negocio.`,
    ]),
  ];

  if (items.length > 1) {
    const otros = items
      .slice(1, 3)
      .map((x) => `${x.nombre} (${x.margenPct}%)`)
      .join(" y ");
    parrafos.push(
      variar("vol-otros", [
        `También está por debajo ${otros}.`,
        `Lo mismo pasa con ${otros}.`,
        `Igual le ocurre a ${otros}.`,
      ])
    );
  }

  return {
    titulo: `${p.nombre} vende mucho y deja poco`,
    parrafos,
    estado: "pensativo",
    siguientes: ["precios", "ganancia"],
  };
}

// ===========================================================================
// ¿CUÁNTOS PRODUCTOS NO TIENEN COSTO?
// ===========================================================================
// La única respuesta del asistente que le dice al dueño cómo hacer que Yaxo
// sea mejor. Se ordena por lo que MÁS VENDE a propósito: capturar el costo
// del catálogo entero no hace falta, y decirle que sí lo hace desistir.

export function faltaCosto(
  r: {
    total: number;
    totalProductos: number;
    conVenta: number;
    importeAfectadoCentavos: number;
    diasObservados: number;
    productos: { nombre: string; unidadesVendidas: number; importeCentavos: number }[];
  },
  fmt: Fmt
): RespuestaYaxo {
  if (r.total === 0) {
    return {
      titulo: "No te falta ningún costo",
      parrafos: [
        variar("costo-cero", [
          "Todos tus productos tienen su costo capturado. Eso hace que todo lo que te diga de ganancia y márgenes sea fiable.",
          "No hay ninguno sin costo. Por eso puedo hablarte de márgenes sin advertencias.",
          "Tienes el costo de todo el catálogo. Es lo que permite que los números de ganancia signifiquen algo.",
        ]),
      ],
      estado: "feliz",
      siguientes: ["ganancia", "precios"],
    };
  }

  const parrafos = [
    variar("costo-cuantos", [
      `Te faltan ${r.total} de ${r.totalProductos} productos por capturar su costo.`,
      `Hay ${r.total} productos sin costo, de ${r.totalProductos} en total.`,
      `De tus ${r.totalProductos} productos, ${r.total} no tienen costo registrado.`,
    ]),
  ];

  if (r.conVenta > 0) {
    parrafos.push(
      variar("costo-afecta", [
        `${r.conVenta} de ellos sí se han vendido en estos ${r.diasObservados} días, ${fmt(r.importeAfectadoCentavos)} en total. Esos son los que me impiden decirte tu ganancia real.`,
        `De esos, ${r.conVenta} se vendieron en los últimos ${r.diasObservados} días por ${fmt(r.importeAfectadoCentavos)}. Son los que estropean el cálculo del margen.`,
        `${r.conVenta} han tenido venta (${fmt(r.importeAfectadoCentavos)} en ${r.diasObservados} días). Mientras no tengan costo, su ganancia es un hueco.`,
      ])
    );
    const lista = r.productos
      .filter((p) => p.importeCentavos > 0)
      .slice(0, 3)
      .map((p) => p.nombre)
      .join(", ");
    if (lista) {
      parrafos.push(
        variar("costo-empieza", [
          `Si empiezas por ${lista}, que son los que más venden, la mayor parte del problema se arregla. No hace falta capturarlos todos.`,
          `Empieza por ${lista}: son los que más pesan. Con esos, el cálculo ya cambia bastante.`,
          `Con capturar ${lista} avanzas casi todo, porque son los que más mueven. El resto puede esperar.`,
        ])
      );
    }
  } else {
    parrafos.push(
      variar("costo-sinventa", [
        "Ninguno de ellos se ha vendido en este periodo, así que de momento no estropean ningún cálculo. Puede esperar.",
        "Como no se han vendido, no afectan a tus márgenes por ahora. No es urgente.",
        "No han tenido venta, así que no distorsionan nada todavía.",
      ])
    );
  }

  return {
    titulo: `Faltan ${r.total} costos por capturar`,
    parrafos,
    estado: r.conVenta > 0 ? "alerta" : "pensativo",
    siguientes: ["ganancia", "precios"],
  };
}

// ===========================================================================
// TEMA DINERO Y CAJA
// ===========================================================================
// Ninguna de estas cuatro necesitó SQL nuevo en el móvil: corteTurno(),
// resumen() de finanzas.ts y totalPorCobrar() de credito.ts ya daban todo. En
// el PC sí hubo que añadir resumen_deuda() a clientes.rs, porque allí no
// existía el equivalente.

/** Cuánto efectivo debería haber en el cajón, y de dónde sale esa cifra. */
export function efectivoEnCajon(
  corte: {
    fondo_centavos: number;
    efectivo_centavos: number;
    entradas_centavos: number;
    salidas_centavos: number;
    devoluciones_efectivo_centavos: number;
    efectivo_esperado_centavos: number;
    tickets: number;
  } | null,
  fmt: Fmt
): RespuestaYaxo {
  if (!corte) {
    return {
      titulo: "No tienes caja abierta",
      parrafos: [
        variar("caja-cerrada", [
          "Ahora mismo no hay ningún turno abierto en este aparato, así que no hay cajón que cuadrar. Abre caja al empezar el día y te llevo la cuenta.",
          "No hay turno abierto aquí. El efectivo esperado se calcula sobre el turno en curso: sin turno, no hay cifra que darte.",
          "Sin caja abierta no puedo decirte cuánto debería haber: la cuenta arranca con el fondo inicial del turno.",
        ]),
      ],
      estado: "pensativo",
      siguientes: ["hoy"],
    };
  }

  // El desglose es el punto de esta respuesta, no el total. Un número suelto
  // no sirve para nada cuando no cuadra: lo que el dueño necesita es saber
  // por dónde buscar la diferencia.
  const parrafos = [
    variar("caja-total", [
      `En el cajón deberías tener ${fmt(corte.efectivo_esperado_centavos)}.`,
      `Deberían ser ${fmt(corte.efectivo_esperado_centavos)} en efectivo.`,
      `La cuenta da ${fmt(corte.efectivo_esperado_centavos)} en el cajón.`,
    ]),
    variar("caja-desglose", [
      `Sale de: ${fmt(corte.fondo_centavos)} de fondo, más ${fmt(corte.efectivo_centavos)} cobrados en efectivo, más ${fmt(corte.entradas_centavos)} que entraron, menos ${fmt(corte.salidas_centavos)} que salieron y ${fmt(corte.devoluciones_efectivo_centavos)} devueltos.`,
      `Así se arma: fondo ${fmt(corte.fondo_centavos)} + efectivo cobrado ${fmt(corte.efectivo_centavos)} + entradas ${fmt(corte.entradas_centavos)} − salidas ${fmt(corte.salidas_centavos)} − devoluciones ${fmt(corte.devoluciones_efectivo_centavos)}.`,
      `Viene de tu fondo de ${fmt(corte.fondo_centavos)} y ${fmt(corte.efectivo_centavos)} de ventas en efectivo, con ${fmt(corte.entradas_centavos)} de entradas y ${fmt(corte.salidas_centavos)} de salidas, menos ${fmt(corte.devoluciones_efectivo_centavos)} en devoluciones.`,
    ]),
    variar("caja-ojo", [
      "Esto es solo el efectivo de este aparato. Tarjeta y transferencia no pasan por el cajón, y otra caja lleva el suyo aparte.",
      "Cuento solo efectivo y solo de esta caja: lo cobrado con tarjeta o transferencia no está ahí, y otra caja tiene su propio turno.",
      "Ojo, es efectivo de este turno y de esta caja. Lo de tarjeta no entra, y si hay otra caja abierta lleva su cuenta.",
    ]),
  ];

  return {
    titulo: `Deberías tener ${fmt(corte.efectivo_esperado_centavos)}`,
    parrafos,
    estado: "contable",
    siguientes: ["hoy", "gastos"],
  };
}

/** Gastos del mes, con el contraste contra lo que dejó el negocio. */
export function gastosDelMes(
  r: {
    gastos_mes_centavos: number;
    ganancia_mes_centavos: number;
    retiros_mes_centavos: number;
    por_categoria: { categoria: string; total_centavos: number; pct: number }[];
    hay_datos: boolean;
  },
  fmt: Fmt
): RespuestaYaxo {
  if (!r.hay_datos || r.gastos_mes_centavos === 0) {
    return {
      titulo: "No tienes gastos registrados este mes",
      parrafos: [
        variar("gasto-cero", [
          "No hay ningún gasto capturado en este mes. Mientras no los registres, lo que te diga de ganancia es solo lo que dejan tus productos, sin restar renta, luz ni sueldos.",
          "No veo gastos de este mes. Sin ellos, la ganancia que te muestro es la de los productos, no lo que de verdad te queda al final.",
          "Este mes no tiene gastos registrados. Eso significa que mi cuenta de ganancia se queda a medias: falta todo lo que pagas para tener abierto.",
        ]),
      ],
      estado: "pensativo",
      siguientes: ["fijos", "hoy"],
    };
  }

  const parrafos = [
    variar("gasto-total", [
      `Llevas ${fmt(r.gastos_mes_centavos)} de gastos este mes.`,
      `Este mes has gastado ${fmt(r.gastos_mes_centavos)}.`,
      `Tus gastos del mes van en ${fmt(r.gastos_mes_centavos)}.`,
    ]),
  ];

  // El gasto suelto no significa nada: lo que importa es contra qué. Si la
  // ganancia no está, NO se inventa una comparación.
  if (r.ganancia_mes_centavos > 0) {
    const queda = r.ganancia_mes_centavos - r.gastos_mes_centavos;
    const pct = Math.round((r.gastos_mes_centavos / r.ganancia_mes_centavos) * 100);
    parrafos.push(
      queda >= 0
        ? variar("gasto-queda", [
            `Tus productos dejaron ${fmt(r.ganancia_mes_centavos)}, así que después de gastos te quedan ${fmt(queda)}. Los gastos se llevan el ${pct}% de lo que ganas.`,
            `Contra los ${fmt(r.ganancia_mes_centavos)} que dejaron tus productos, te quedan ${fmt(queda)}. Los gastos son el ${pct}% de tu ganancia.`,
            `De los ${fmt(r.ganancia_mes_centavos)} de ganancia, los gastos se llevan el ${pct}% y te dejan ${fmt(queda)}.`,
          ])
        : variar("gasto-rojo", [
            `Tus productos dejaron ${fmt(r.ganancia_mes_centavos)} y los gastos van por encima: ${fmt(Math.abs(queda))} más de lo que ganaste este mes.`,
            `Este mes los gastos superan la ganancia de tus productos (${fmt(r.ganancia_mes_centavos)}) por ${fmt(Math.abs(queda))}.`,
            `Vas ${fmt(Math.abs(queda))} por encima: tus productos dejaron ${fmt(r.ganancia_mes_centavos)} y has gastado más que eso.`,
          ])
    );
  }

  if (r.por_categoria.length > 0) {
    const c = r.por_categoria[0];
    parrafos.push(
      variar("gasto-mayor", [
        `Lo que más pesa es ${c.categoria}: ${fmt(c.total_centavos)}, el ${c.pct}% de tus gastos.`,
        `El grueso se va en ${c.categoria} — ${fmt(c.total_centavos)}, un ${c.pct}% del total.`,
        `Tu gasto más grande es ${c.categoria}, con ${fmt(c.total_centavos)} (${c.pct}%).`,
      ])
    );
  }

  if (r.retiros_mes_centavos > 0) {
    parrafos.push(
      variar("gasto-retiros", [
        `Aparte, te has retirado ${fmt(r.retiros_mes_centavos)} para ti este mes. Eso no es gasto del negocio, va en tu libro personal.`,
        `Además sacaste ${fmt(r.retiros_mes_centavos)} para ti. Los retiros no cuentan como gasto del negocio.`,
        `Y ${fmt(r.retiros_mes_centavos)} que pasaron a tu bolsillo, que llevo aparte de los gastos.`,
      ])
    );
  }

  return {
    titulo: `${fmt(r.gastos_mes_centavos)} de gastos este mes`,
    parrafos,
    estado: "contable",
    siguientes: ["fijos", "hoy"],
  };
}

/** ¿Alcanza para los gastos fijos que faltan del mes? */
export function alcanzaParaFijos(
  r: {
    ganancia_mes_centavos: number;
    gastos_mes_centavos: number;
    proximos_fijos: { concepto: string; monto_centavos: number; dia_mes: number; pagado_este_mes: boolean; dias_faltan: number }[];
    hay_datos: boolean;
  },
  fmt: Fmt
): RespuestaYaxo {
  const pendientes = (r.proximos_fijos ?? []).filter((f) => !f.pagado_este_mes);

  if (pendientes.length === 0) {
    return {
      titulo: "No te quedan fijos por pagar",
      parrafos: [
        variar("fijos-cero", [
          "No tienes gastos fijos pendientes este mes. O ya los pagaste todos, o todavía no has registrado ninguno.",
          "No veo fijos por pagar. Si tienes renta o luz y no aparecen, es que aún no están capturados.",
          "Ningún gasto fijo pendiente. Si te falta registrar alguno, esta respuesta cambiará en cuanto lo captures.",
        ]),
      ],
      estado: "reposo",
      siguientes: ["gastos", "hoy"],
    };
  }

  const faltan = pendientes.reduce((s, f) => s + f.monto_centavos, 0);
  const disponible = r.ganancia_mes_centavos - r.gastos_mes_centavos;

  const parrafos = [
    variar("fijos-cuanto", [
      `Te faltan ${pendientes.length} gastos fijos por pagar este mes: ${fmt(faltan)} en total.`,
      `Quedan ${pendientes.length} fijos pendientes, que suman ${fmt(faltan)}.`,
      `Tienes ${pendientes.length} pagos fijos por delante, ${fmt(faltan)} entre todos.`,
    ]),
  ];

  // La comparación solo se hace si la ganancia es fiable. Con los productos
  // sin costo capturado la ganancia sale inflada, y decirle "sí te alcanza"
  // sobre un número inflado es el peor error que podría cometer aquí.
  if (r.hay_datos && r.ganancia_mes_centavos > 0) {
    parrafos.push(
      disponible >= faltan
        ? variar("fijos-alcanza", [
            `Con lo que llevas del mes te alcanza: después de tus gastos actuales quedan ${fmt(disponible)}, y los fijos pendientes son ${fmt(faltan)}.`,
            `Sí alcanza. Descontando lo que ya gastaste, tienes ${fmt(disponible)} y necesitas ${fmt(faltan)}.`,
            `Te da: van ${fmt(disponible)} disponibles contra ${fmt(faltan)} de fijos pendientes.`,
          ])
        : variar("fijos-falta", [
            `Con lo que llevas no alcanza: después de tus gastos quedan ${fmt(disponible)} y los fijos pendientes son ${fmt(faltan)}. Faltan ${fmt(faltan - disponible)}.`,
            `Por ahora no da. Tienes ${fmt(disponible)} y necesitas ${fmt(faltan)}: ${fmt(faltan - disponible)} de diferencia.`,
            `Faltarían ${fmt(faltan - disponible)}: quedan ${fmt(disponible)} y los fijos suman ${fmt(faltan)}. Queda mes por delante para cerrarlo.`,
          ])
    );
  }

  const proximo = pendientes.slice().sort((a, b) => a.dias_faltan - b.dias_faltan)[0];
  if (proximo) {
    parrafos.push(
      variar("fijos-proximo", [
        `El más cercano es ${proximo.concepto} (${fmt(proximo.monto_centavos)}), el día ${proximo.dia_mes}.`,
        `Lo primero que cae es ${proximo.concepto}, ${fmt(proximo.monto_centavos)} el día ${proximo.dia_mes}.`,
        `El siguiente en la lista: ${proximo.concepto}, ${fmt(proximo.monto_centavos)}, día ${proximo.dia_mes}.`,
      ])
    );
  }

  return {
    titulo: `${fmt(faltan)} en fijos pendientes`,
    parrafos,
    estado: "contable",
    siguientes: ["gastos", "hoy"],
  };
}

/** Cuánto te deben y quién. */
export function cuantoMeDeben(
  r: {
    total_centavos: number;
    num_clientes: number;
    sobre_limite: number;
    clientes: { nombre: string; saldo_centavos: number }[];
  },
  fmt: Fmt
): RespuestaYaxo {
  if (r.total_centavos === 0 || r.num_clientes === 0) {
    return {
      titulo: "Nadie te debe nada",
      parrafos: [
        variar("deben-cero", [
          "No tienes cuentas por cobrar. Todo lo que has vendido está cobrado.",
          "Ningún cliente tiene saldo pendiente contigo.",
          "No hay deuda viva: nadie te debe en este momento.",
        ]),
      ],
      estado: "feliz",
      siguientes: ["hoy"],
    };
  }

  const parrafos = [
    variar("deben-total", [
      `Te deben ${fmt(r.total_centavos)} entre ${r.num_clientes} clientes.`,
      `Tienes ${fmt(r.total_centavos)} por cobrar, repartidos en ${r.num_clientes} clientes.`,
      `Hay ${fmt(r.total_centavos)} en la calle, de ${r.num_clientes} personas.`,
    ]),
  ];

  if (r.clientes.length > 0) {
    const lista = r.clientes
      .slice(0, 3)
      .map((c) => `${c.nombre} (${fmt(c.saldo_centavos)})`)
      .join(", ");
    parrafos.push(
      variar("deben-quienes", [
        `Los que más deben: ${lista}.`,
        `Encabezan la lista ${lista}.`,
        `El grueso está en ${lista}.`,
      ])
    );
  }

  if (r.sobre_limite > 0) {
    parrafos.push(
      variar("deben-limite", [
        `${r.sobre_limite} ${r.sobre_limite === 1 ? "está" : "están"} por encima del límite de crédito que les pusiste.`,
        `Ojo: ${r.sobre_limite} ${r.sobre_limite === 1 ? "pasó" : "pasaron"} el límite que tienen asignado.`,
        `${r.sobre_limite} ${r.sobre_limite === 1 ? "rebasa" : "rebasan"} su límite de crédito.`,
      ])
    );
  }

  parrafos.push(
    variar("deben-ojo", [
      "Ese dinero ya cuenta como venta, pero todavía no está en tu cajón. Son cosas distintas.",
      "Recuerda que eso ya se contó como vendido aunque no lo hayas cobrado. No lo tomes como efectivo disponible.",
      "Está vendido, no cobrado. Es la diferencia entre lo que facturaste y lo que tienes.",
    ])
  );

  return {
    titulo: `Te deben ${fmt(r.total_centavos)}`,
    parrafos,
    estado: r.sobre_limite > 0 ? "alerta" : "contable",
    siguientes: ["hoy", "gastos"],
  };
}

// ===========================================================================
// LOS UMBRALES, EXPLICADOS Y AJUSTABLES
// ===========================================================================
// UNA función para los cinco, no cinco funciones. Todas dirían lo mismo con
// otro sustantivo, y cinco copias del mismo texto es garantía de que dentro de
// unos meses una diga "días" y otra "dias" y nadie se entere.
//
// POR QUÉ SE AJUSTAN HABLANDO Y NO EN UNA PANTALLA DE CONFIGURACIÓN
// Una pantalla con cinco campos numéricos no la abre nadie, y quien la abriera
// no sabría qué poner: "días de cobertura de alerta" no significa nada para un
// tendero. Dicho en conversación, con el valor actual, un ejemplo de por qué
// puede no servirle y las opciones a un toque, sí se entiende y sí se toca.
//
// Y el efecto de fondo: desde que el umbral lo pone el dueño, un aviso de Yaxo
// deja de ser una opinión suya y pasa a ser el número que el propio dueño
// eligió, cruzándose. Eso es lo que hace defendible que Yaxo avise.

type TextoUmbral = {
  /** Cómo se llama en la conversación. Nunca el nombre técnico. */
  que: string;
  /** Qué significa, en una frase, para alguien que no sabe qué es un umbral. */
  explica: string;
  /** Por qué el valor de fábrica puede no servirle a SU negocio. Es la parte
   *  que hace que se plantee cambiarlo en vez de pasar de largo. */
  porque: string;
  /** Unidad, para componer las opciones ("60 días", "$500"). */
  unidad: "dias" | "dinero" | "veces";
  /** Valores que se ofrecen. Incluyen el de fábrica a propósito: quien ya lo
   *  cambió tiene que poder volver sin adivinar cuál era. */
  valores: number[];
};

export const TEXTOS_UMBRAL: Record<keyof Umbrales, TextoUmbral> = {
  diasSinVentaParado: {
    que: "parado",
    explica: "Considero que un producto está parado cuando lleva ese tiempo sin venderse ni una vez.",
    porque:
      "En una tiendita, un mes sin venderse suele significar que está muerto. En una ferretería o una tienda de ropa, un mes es normal y no quiere decir nada.",
    unidad: "dias",
    valores: [15, 30, 60, 90],
  },
  diasCoberturaAlerta: {
    que: "se va a acabar",
    explica: "Te aviso de un producto cuando, al ritmo que se vende, le quedan menos de esos días de existencia.",
    porque:
      "Depende de cada cuánto te surten. Si tu proveedor pasa cada semana, con avisarte a siete días vas sobrado. Si tardas dos semanas en recibir, te estaría avisando tarde.",
    unidad: "dias",
    valores: [3, 7, 14, 21],
  },
  diasVentanaRitmo: {
    que: "el ritmo de venta",
    explica: "Para calcular a qué ritmo se vende cada cosa miro hacia atrás ese número de días.",
    porque:
      "Una ventana corta reacciona rápido pero se deja llevar por una semana rara. Una larga es más estable pero tarda en notar que algo empezó a moverse.",
    unidad: "dias",
    valores: [7, 14, 30, 60],
  },
  centavosMinimosParado: {
    que: "cuánto dinero parado vale la pena mencionar",
    explica: "No te menciono un producto parado si el dinero que tienes ahí metido es menor que esa cantidad.",
    porque:
      "Sin este límite, la lista de parados se llena de cosas de veinte pesos y lo importante se pierde entre el ruido.",
    unidad: "dinero",
    valores: [0, 10000, 20000, 50000],
  },
  ventasMinimasRitmo: {
    que: "cuántas ventas hacen falta para hablar de ritmo",
    explica: "No le calculo un ritmo a un producto que se vendió menos veces que eso en la ventana.",
    porque:
      "Un producto vendido dos veces en dos semanas no tiene ritmo: tiene dos ventas. Calcularle un promedio sería inventar una tendencia que no existe.",
    unidad: "veces",
    valores: [2, 3, 5, 10],
  },
};

/** Id de pregunta por umbral. Con guion y no con dos puntos: el separador de
 *  dos puntos es el que parte el argumento ("umbral-parado:60"), así que el id
 *  no puede llevar otro. */
export const PREGUNTA_UMBRAL: Record<keyof Umbrales, string> = {
  diasSinVentaParado: "umbral-parado",
  diasCoberturaAlerta: "umbral-alerta",
  diasVentanaRitmo: "umbral-ritmo",
  centavosMinimosParado: "umbral-minimo",
  ventasMinimasRitmo: "umbral-ventas",
};

function valorEnPalabras(t: TextoUmbral, v: number, fmt: Fmt): string {
  if (t.unidad === "dinero") return v === 0 ? "sin mínimo" : fmt(v);
  if (t.unidad === "veces") return `${v} ${v === 1 ? "venta" : "ventas"}`;
  return `${v} ${v === 1 ? "día" : "días"}`;
}

/** Explica un umbral y ofrece cambiarlo. */
export function explicarUmbral(k: keyof Umbrales, u: Umbrales, fmt: Fmt): RespuestaYaxo {
  const t = TEXTOS_UMBRAL[k];
  const actual = u[k];
  return {
    titulo: `Ahora mismo: ${valorEnPalabras(t, actual, fmt)}`,
    parrafos: [
      t.explica.replace("ese tiempo", valorEnPalabras(t, actual, fmt))
        .replace("esos días", valorEnPalabras(t, actual, fmt))
        .replace("ese número de días", valorEnPalabras(t, actual, fmt))
        .replace("esa cantidad", valorEnPalabras(t, actual, fmt))
        .replace("menos veces que eso", `menos de ${valorEnPalabras(t, actual, fmt)}`),
      t.porque,
      variar("umbral-cierre", [
        "Tú conoces tu giro mejor que yo. ¿Lo dejamos así o lo cambiamos?",
        "Cámbialo si en tu negocio no cuadra: es tu tienda, no la de al lado.",
        "Si con ese número no te sirve, dime otro y lo uso a partir de ahora.",
      ]),
    ],
    estado: "pensativo",
    // El valor actual NO se ofrece: sería un botón que no hace nada. Quien no
    // quiera cambiarlo simplemente no toca ninguno.
    opciones: t.valores
      .filter((v) => v !== actual)
      .map((v) => ({
        id: `${PREGUNTA_UMBRAL[k]}:${v}`,
        texto: valorEnPalabras(t, v, fmt),
      })),
  };
}

/** Confirma el cambio. `u` son los umbrales YA GUARDADOS y releídos, no los
 *  que se pidieron: si el valor se salió de rango y se recortó, el dueño tiene
 *  que ver el que quedó de verdad. */
export function umbralCambiado(k: keyof Umbrales, u: Umbrales, fmt: Fmt): RespuestaYaxo {
  const t = TEXTOS_UMBRAL[k];
  return {
    titulo: "Listo",
    parrafos: [
      variar("umbral-ok", [
        `A partir de ahora uso ${valorEnPalabras(t, u[k], fmt)} para ${t.que}.`,
        `Hecho: ${t.que} pasa a ser ${valorEnPalabras(t, u[k], fmt)}.`,
        `Queda en ${valorEnPalabras(t, u[k], fmt)}. Lo aplico desde la próxima pregunta.`,
      ]),
      variar("umbral-sync", [
        "Vale para todo tu negocio, así que tus otras cajas y tu teléfono usarán el mismo número en cuanto sincronicen.",
        "Lo comparten todos tus dispositivos: no hace falta que lo cambies otra vez en la caja o en el teléfono.",
        "Como es un ajuste del negocio y no de este aparato, viaja al resto de tus dispositivos al sincronizar.",
      ]),
    ],
    estado: "feliz",
    siguientes: ["resurtir", "parado"],
  };
}
