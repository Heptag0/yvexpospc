// YvexPOS — Yaxo: capa de HECHOS.
//
// ===========================================================================
// AQUÍ NO HAY UNA SOLA CONSULTA SQL, Y ESO ES EL PUNTO
// ===========================================================================
// Todo sale de `reportes.ts`. La tentación era escribir SQL propio "porque
// Yaxo necesita otras cifras", y habría sido un error caro: acabaríamos con
// dos verdades. Yaxo diría $8,640 y la pantalla de Reportes $8,610, porque una
// resta las devoluciones parciales y la otra no.
//
// reportes.ts ya resolvió cosas que costaron trabajo y que no se ven a simple
// vista: la diferencia entre una venta cancelada y una devuelta parcial, el
// ticket promedio siempre sobre el neto, la cobertura de costos. Reescribir
// eso sería repetir los mismos errores desde cero.
//
// REGLA PARA QUIEN AÑADA HECHOS: si Yaxo necesita una cifra que reportes.ts no
// da, se añade la función ALLÍ y se llama desde aquí. Nunca un SELECT en este
// archivo.
//
// ===========================================================================
// POR QUÉ EXISTE ESTA CAPA SI YA ESTÁ reportes.ts
// ===========================================================================
// Por dos cosas que reportes.ts no hace, porque no es su trabajo:
//
//   1. REUNIR. Una pregunta como "¿cómo voy hoy?" necesita el resumen, la
//      comparación con ayer, la utilidad y los métodos de pago. Son cuatro
//      llamadas que aquí salen en una.
//
//   2. DECIDIR QUÉ SE PUEDE AFIRMAR. Un número existe siempre; que sea honesto
//      afirmarlo, no. Con dos días de datos no hay tendencia. Con la mitad de
//      los productos sin costo capturado, el margen es una ilusión. Esas
//      decisiones se toman aquí, UNA vez, y las heredan los tres niveles del
//      asistente: el local con plantillas, el local con lenguaje y el de nube.
//
// El objeto que devuelve `reunirHechos` es exactamente lo que se le manda al
// modelo en el nivel de nube. Si un dato no está aquí, el modelo no lo tiene y
// no puede inventarlo. Esa es la garantía, y es de construcción, no de
// instrucción: da igual lo que diga el prompt si el dato no viajó.
//
// ===========================================================================
// PORTABILIDAD AL PC
// ===========================================================================
// Este archivo se porta a Rust casi línea por línea, llamando a `reportes.rs`
// en vez de a `reportes.ts`. Lo que NO se porta es SQL, porque aquí no hay:
// los dos esquemas difieren (el PC tiene `venta_lineas.descripcion`, el móvil
// `nombre_producto`; el PC tiene `ventas.usuario_pos_id`, el móvil no), así que
// una consulta copiada de un lado al otro falla. Al apoyarse en la capa de
// reportes de cada plataforma, esa diferencia deja de importar.
//
// ===========================================================================
// PERMISOS
// ===========================================================================
// No hay comprobaciones de permiso en este archivo, y tampoco hacen falta:
// todas las funciones de reportes.ts llaman a exigirPermiso("verReportes"), así
// que Yaxo hereda el sistema entero. Un cajero sin ese permiso recibe el error
// de siempre al preguntar por márgenes, sin que aquí haya que acordarse.

import {
  Rango,
  ResumenRango,
  Comparativo,
  Utilidad,
  MejorHora,
  TopProducto,
  VentaDepto,
  VentaMetodo,
  PuntoSerie,
  COBERTURA_FIABLE,
  resumenRango,
  comparativoRango,
  utilidadRango,
  mejorHoraRango,
  topProductos,
  ventasPorDepartamento,
  ventasPorMetodo,
  serieVentas,
} from "./reportes";

/** Días cerrados mínimos para que una comparación signifique algo.
 *
 *  Con menos, cualquier subida o bajada es ruido: un martes flojo y un sábado
 *  bueno dan un "+180%" que no describe nada. Es el mismo umbral que ya se usó
 *  en el analista anterior, y viene de ver el error en producción: alertas de
 *  "tus ventas se desplomaron" en negocios que llevaban tres días con la app. */
export const DIAS_MINIMOS_PARA_COMPARAR = 5;

/** Qué NO se puede afirmar con los datos que hay. Cada bandera apaga un tipo
 *  de frase, tanto en las plantillas locales como en el prompt de la nube. */
export type Reservas = {
  /** El rango incluye el día de HOY, que está a medias. Cualquier comparación
   *  contra un día completo sale mal: a las diez de la mañana todo día en
   *  curso "cayó un 70%". */
  incluyeDiaEnCurso: boolean;
  /** Menos de DIAS_MINIMOS_PARA_COMPARAR días con venta. No hay tendencia que
   *  contar. */
  pocosDatos: boolean;
  /** Días con al menos una venta dentro del rango. */
  diasConVenta: number;
  /** La utilidad no es fiable porque falta costo en parte de lo vendido.
   *  Afirmar un margen aquí sería inventar: el costo que falta no es cero, es
   *  desconocido, y son cosas distintas. */
  margenIncompleto: boolean;
  /** Cuántos productos distintos se vendieron sin costo capturado. Sirve para
   *  que Yaxo pueda decir qué hacer, no solo que no sabe. */
  productosSinCosto: number;
  /** No hubo ninguna venta en el rango. */
  sinVentas: boolean;
};

export type HechosNegocio = {
  rango: Rango;
  /** Instante en que se reunieron. El modelo lo necesita para no hablar del
   *  "mes pasado" cuando en realidad mira los últimos 30 días. */
  generadoEn: string;
  resumen: ResumenRango;
  comparativo: Comparativo;
  /** null cuando no hay ninguna venta con costo capturado. */
  utilidad: Utilidad | null;
  mejorHora: MejorHora | null;
  topProductos: TopProducto[];
  porDepartamento: VentaDepto[];
  porMetodo: VentaMetodo[];
  serie: PuntoSerie[];
  reservas: Reservas;
};

/**
 * Reúne todo lo que Yaxo puede saber de un rango, y marca qué es honesto
 * afirmar.
 *
 * Las llamadas van en paralelo a propósito: son lecturas independientes sobre
 * SQLite local y secuenciarlas solo añadiría espera. En un teléfono de gama
 * baja con un catálogo grande, esa diferencia se nota al abrir el asistente.
 */
export async function reunirHechos(rango: Rango): Promise<HechosNegocio> {
  const [resumen, comparativo, utilidad, mejorHora, top, deptos, metodos, serie] =
    await Promise.all([
      resumenRango(rango),
      comparativoRango(rango),
      utilidadRango(rango),
      // La mejor hora no significa nada en un rango de un solo día parcial, y
      // el mejor día no significa nada en "hoy": reportes.ts ya devuelve null
      // en esos casos, así que no hay que decidirlo aquí otra vez.
      mejorHoraRango(rango),
      topProductos(rango, 5),
      ventasPorDepartamento(rango),
      ventasPorMetodo(rango),
      serieVentas(rango),
    ]);

  // Días con al menos una venta. Se cuenta sobre la serie porque ya viene
  // agrupada por día (o por hora en "hoy", donde el conteo no aplica).
  const diasConVenta =
    rango === "hoy" ? 0 : serie.filter((p) => p.tickets > 0).length;

  const reservas: Reservas = {
    // "hoy" es obvio, pero 7d, 30d y mes TAMBIÉN terminan en el día de hoy y
    // arrastran el mismo problema en su último tramo. Se marca en los cuatro.
    incluyeDiaEnCurso: true,
    pocosDatos: rango !== "hoy" && diasConVenta < DIAS_MINIMOS_PARA_COMPARAR,
    diasConVenta,
    margenIncompleto: utilidad === null || utilidad.cobertura < COBERTURA_FIABLE,
    productosSinCosto: utilidad?.productosSinCosto ?? 0,
    sinVentas: resumen.tickets === 0,
  };

  return {
    rango,
    generadoEn: new Date().toISOString(),
    resumen,
    comparativo,
    utilidad,
    mejorHora,
    topProductos: top,
    porDepartamento: deptos,
    porMetodo: metodos,
    serie,
    reservas,
  };
}

/**
 * Versión reducida para mandar al modelo en el nivel de nube.
 *
 * POR QUÉ NO SE MANDA `HechosNegocio` ENTERO
 * Tres motivos, y el tercero es el que de verdad importa:
 *   - La serie completa de 30 días son cientos de tokens que no cambian la
 *     respuesta a "¿cómo voy?".
 *   - Menos ruido en el prompt es menos ocasión de que el modelo se agarre a
 *     un dato secundario y monte la respuesta alrededor.
 *   - Los nombres de producto pueden ser largos y no aportan más allá de los
 *     primeros: cinco bastan para hablar de lo que se mueve.
 *
 * Los centavos se convierten a pesos AQUÍ, no en el prompt. Pedirle al modelo
 * que divida entre 100 es pedirle que calcule, y esa es justo la instrucción
 * que el prompt le prohíbe.
 */
export function hechosParaModelo(h: HechosNegocio) {
  const p = (c: number) => Math.round(c) / 100;
  return {
    periodo: h.rango,
    vendido: p(h.resumen.total_centavos),
    devuelto: p(h.resumen.devuelto_centavos),
    tickets: h.resumen.tickets,
    ticket_promedio: p(h.resumen.promedio_centavos),
    articulos: h.resumen.articulos,
    variacion_pct: h.comparativo.variacionPct,
    vendido_periodo_anterior: p(h.comparativo.anterior.total_centavos),
    // La utilidad solo viaja si es fiable. Si el costo está a medias, el
    // modelo NO recibe el número: no puede afirmarlo ni "matizarlo", que en la
    // práctica acaba siendo lo mismo.
    ganancia: h.reservas.margenIncompleto ? null : p(h.utilidad!.utilidad_centavos),
    margen_pct: h.reservas.margenIncompleto ? null : h.utilidad!.margenPct,
    mejor_hora: h.mejorHora ? `${h.mejorHora.hora}:00` : null,
    top_productos: h.topProductos.map((t) => ({
      nombre: t.nombre,
      cantidad: t.cantidad,
      total: p(t.total_centavos),
    })),
    por_metodo: h.porMetodo.map((m) => ({
      metodo: m.metodo,
      total: p(m.total_centavos),
    })),
    // Las reservas viajan tal cual: son instrucciones para el modelo, no
    // adorno. "pocos_datos: true" es lo que le dice que no hable de tendencias.
    reservas: h.reservas,
  };
}
