// YvexPOS Móvil — Lógica de reportes de ventas (locales).
//
// Todos los rangos y agrupaciones se calculan en HORA LOCAL del teléfono
// (la venta de las 11pm cuenta en el día local correcto, no en el día UTC).
// creado_en se guarda en ISO UTC; los límites de rango se calculan en JS y la
// agrupación por día/hora también, para no depender del parseo de fechas de
// SQLite.
//
// ---------------------------------------------------------------------------
// DEVOLUCIONES — cómo se restan, y por qué el JOIN con `ventas` no es adorno
// ---------------------------------------------------------------------------
// Las cifras de dinero de este archivo son NETAS: se les resta lo devuelto.
// Antes no lo eran, y una sola devolución inflaba todo (vendido, utilidad,
// margen, top de productos, departamentos y métodos de pago).
//
// La trampa: devoluciones.ts implementa la CANCELACIÓN como una devolución
// total con motivo "Cancelación", y deja la venta en estado 'cancelada'. Como
// las consultas de ingreso ya excluyen las ventas canceladas, restar además
// su reembolso descontaría el mismo dinero DOS veces:
//
//   Venta de $100, luego cancelada
//     real     : la venta no existe             ->    0
//     mal      : 0 (excluida) − 100 (reembolso) -> −100   <- dinero fantasma
//
// Por eso toda consulta de devoluciones lleva `JOIN ventas v ... AND
// v.estado <> 'cancelada'`. Es el mismo filtro, literal, que ya usa
// caja.rs::calcular_corte() en el PC y corteTurno() en venta.ts.
//
// Segunda decisión: las devoluciones se imputan por SU PROPIA fecha
// (dv.creado_en), no por la de la venta original. Es la lectura de caja, la
// que le importa al tendero: "cuánto me quedó en este periodo". Devolver hoy
// algo vendido la semana pasada baja lo de hoy, igual que en el cajón.
//
// ---------------------------------------------------------------------------
// QUÉ SE MIDE EN BRUTO A PROPÓSITO (y no es un descuido)
// ---------------------------------------------------------------------------
// serieVentas, mejorHoraRango y mejorDiaRango NO restan devoluciones. Esas
// tres responden "CUÁNDO entra gente a comprar", no "cuánto me quedó". Una
// devolución ocurre en un momento que no tiene relación con la hora en que se
// vendió: restarla donde cae inventaría un valle a las 6pm porque alguien
// regresó un refresco, y podría dejar barras negativas sin significado.
//
// La pantalla lo resuelve diciéndolo: bajo la gráfica aparece cuánto se
// devolvió en el rango, cuando lo hay.
//
// ---------------------------------------------------------------------------
// PERMISO: verReportes
// ---------------------------------------------------------------------------
// Cada función que consulta ventas o costos llama exigirPermiso("verReportes")
// como primera línea, por su cuenta. _layout.tsx ya oculta la pestaña para el
// rol cajero, pero esa pestaña oculta es cortesía, no seguridad.
//
// Los únicos exports SIN gate son inicioDeRango / limitesDeRango /
// limitesPeriodoAnterior / componerTitular: son matemática pura (sin bd()) y
// no exponen ningún dato del negocio.

import { bd } from "./db";
import { exigirPermiso } from "./permisos";

export type Rango = "hoy" | "7d" | "30d" | "mes";

/** ISO UTC del inicio (00:00 local) de hace `dias` días. */
function inicioDiaLocalISO(diasAtras: number): string {
  const d = new Date();
  d.setDate(d.getDate() - diasAtras);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** ISO UTC del inicio del rango elegido. */
export function inicioDeRango(rango: Rango): string {
  if (rango === "hoy") return inicioDiaLocalISO(0);
  if (rango === "7d") return inicioDiaLocalISO(6);
  if (rango === "30d") return inicioDiaLocalISO(29);
  // mes: día 1 del mes actual
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Límites del rango y del periodo anterior equivalente
// ---------------------------------------------------------------------------

export type Limites = { desde: string; hasta: string };

/** Inicio y fin del rango actual. El fin es AHORA, no el fin del día. */
export function limitesDeRango(rango: Rango): Limites {
  return { desde: inicioDeRango(rango), hasta: new Date().toISOString() };
}

/**
 * Periodo anterior EQUIVALENTE, para comparar peras con peras.
 *
 * Detalle que importa: si hoy es miércoles y llevamos 3 días del mes, el mes
 * anterior se compara SOLO con sus primeros 3 días. Comparar 3 días contra 30
 * daría siempre una caída falsa y el dato sería basura.
 */
export function limitesPeriodoAnterior(rango: Rango): Limites {
  const ahora = new Date();

  if (rango === "mes") {
    const inicioMesAnterior = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1, 0, 0, 0, 0);
    // Mismo avance dentro del mes: día del mes y hora actuales.
    const finMesAnterior = new Date(inicioMesAnterior);
    finMesAnterior.setDate(ahora.getDate());
    finMesAnterior.setHours(ahora.getHours(), ahora.getMinutes(), 0, 0);
    return { desde: inicioMesAnterior.toISOString(), hasta: finMesAnterior.toISOString() };
  }

  const dias = rango === "hoy" ? 1 : rango === "7d" ? 7 : 30;
  const desdeActual = new Date(inicioDeRango(rango));
  const desde = new Date(desdeActual);
  desde.setDate(desde.getDate() - dias);
  // Mismo avance dentro del periodo: se corta a la misma altura relativa.
  const hasta = new Date(ahora);
  hasta.setDate(hasta.getDate() - dias);
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

// ---------------------------------------------------------------------------
// Resumen del rango
// ---------------------------------------------------------------------------

export type ResumenRango = {
  /** Vendido NETO: bruto − devuelto. Es la cifra protagonista. */
  total_centavos: number;
  /** Lo cobrado antes de devoluciones. Se guarda para poder explicar la resta. */
  bruto_centavos: number;
  /** Reembolsado en el rango (por fecha de la devolución). Siempre >= 0. */
  devuelto_centavos: number;
  tickets: number;
  /**
   * Ticket promedio: SIEMPRE total neto / tickets.
   *
   * La primera versión lo calculaba sobre el bruto, con el argumento de que
   * "cuánto gasta un cliente típico" es una pregunta sobre las ventas y no
   * sobre los reembolsos. En una hoja de cálculo eso se sostiene; en una
   * tarjeta con las tres cifras juntas, no: con una venta de $200 devuelta a
   * la mitad se leía "$100 vendido · 1 ticket · $200 de promedio", y nadie
   * piensa "son dos preguntas distintas" — piensa que la app está rota.
   *
   * La regla manda sobre el matiz: si en pantalla hay total, tickets y
   * promedio uno al lado del otro, total ÷ tickets TIENE que dar el promedio.
   */
  promedio_centavos: number;
  /** Artículos netos de lo devuelto. */
  articulos: number;
};

/** Resumen entre dos instantes ISO. `hasta` es exclusivo. */
export async function resumenEntre(desde: string, hasta: string): Promise<ResumenRango> {
  await exigirPermiso("verReportes");
  const db = await bd();

  const fila = await db.getFirstAsync<{ n: number; t: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total_centavos),0) AS t
     FROM ventas WHERE estado <> 'cancelada' AND creado_en >= ? AND creado_en < ?`,
    [desde, hasta]
  );
  const art = await db.getFirstAsync<{ a: number }>(
    `SELECT COALESCE(SUM(l.cantidad),0) AS a
     FROM venta_lineas l JOIN ventas v ON v.id = l.venta_id
     WHERE v.estado <> 'cancelada' AND v.creado_en >= ? AND v.creado_en < ?`,
    [desde, hasta]
  );

  // Dinero reembolsado en el rango. El JOIN con ventas evita el doble
  // descuento de las canceladas (ver cabecera del archivo).
  const dev = await db.getFirstAsync<{ d: number }>(
    `SELECT COALESCE(SUM(dv.total_devuelto_centavos),0) AS d
     FROM devoluciones dv JOIN ventas v ON v.id = dv.venta_id
     WHERE v.estado <> 'cancelada' AND dv.creado_en >= ? AND dv.creado_en < ?`,
    [desde, hasta]
  );

  // Piezas devueltas. Las líneas viven solo en la PRIMERA devolución del
  // reparto (devoluciones.ts no las duplica por método), así que este JOIN
  // no cuenta de más aunque la devolución se haya partido en varias filas.
  const devArt = await db.getFirstAsync<{ a: number }>(
    `SELECT COALESCE(SUM(dl.cantidad),0) AS a
     FROM devolucion_lineas dl
     JOIN devoluciones dv ON dv.id = dl.devolucion_id
     JOIN ventas v ON v.id = dv.venta_id
     WHERE v.estado <> 'cancelada' AND dv.creado_en >= ? AND dv.creado_en < ?`,
    [desde, hasta]
  );

  const n = fila?.n ?? 0;
  const bruto = fila?.t ?? 0;
  const devuelto = dev?.d ?? 0;
  return {
    total_centavos: bruto - devuelto,
    bruto_centavos: bruto,
    devuelto_centavos: devuelto,
    tickets: n,
    promedio_centavos: n > 0 ? Math.round((bruto - devuelto) / n) : 0,
    articulos: (art?.a ?? 0) - (devArt?.a ?? 0),
  };
}

/** Resumen del rango completo, hasta ahora. */
export async function resumenRango(rango: Rango): Promise<ResumenRango> {
  const { desde, hasta } = limitesDeRango(rango);
  return resumenEntre(desde, hasta);
}

// ---------------------------------------------------------------------------
// Comparación contra el periodo anterior
// ---------------------------------------------------------------------------

export type Comparativo = {
  actual: ResumenRango;
  anterior: ResumenRango;
  /** null cuando el periodo anterior fue cero: no se puede dividir. */
  variacionPct: number | null;
  diferencia_centavos: number;
};

export async function comparativoRango(rango: Rango): Promise<Comparativo> {
  await exigirPermiso("verReportes");
  const a = limitesDeRango(rango);
  const b = limitesPeriodoAnterior(rango);
  const [actual, anterior] = await Promise.all([
    resumenEntre(a.desde, a.hasta),
    resumenEntre(b.desde, b.hasta),
  ]);
  const variacionPct =
    anterior.total_centavos > 0
      ? ((actual.total_centavos - anterior.total_centavos) / anterior.total_centavos) * 100
      : null;
  return {
    actual,
    anterior,
    variacionPct,
    diferencia_centavos: actual.total_centavos - anterior.total_centavos,
  };
}

// ---------------------------------------------------------------------------
// Utilidad del rango
// ---------------------------------------------------------------------------
//
// El costo sale SIEMPRE de venta_lineas.costo_unitario_centavos: el costo
// congelado en el momento de vender (migración v22, portada de la 004 del PC).
// Antes había una rama de respaldo que leía el costo ACTUAL del producto
// cuando esa columna no existía. Se eliminó: la columna existe en todo
// esquema desde v22 y cobrar() siempre la escribe, así que esa rama nunca se
// ejecutaba — solo sondeaba el esquema con PRAGMA en cada carga de pantalla.
//
// ---------------------------------------------------------------------------
// COBERTURA: por qué el margen podía mentir, y hacia arriba
// ---------------------------------------------------------------------------
// productos.costo_centavos es NULLABLE, y cobrar() hace `?? 0`. Un producto
// dado de alta sin costo — lo normal al empezar, y masivo al importar de
// Eleventa — deja la línea con costo 0. Para el cálculo, costo 0 no significa
// "no lo sé": significa "me lo regalaron", y ese producto reporta 100% de
// margen.
//
// Con medio catálogo sin costo, el margen no es aproximado: es falso, y falso
// hacia arriba. Por eso se mide la COBERTURA — qué parte de lo vendido tiene
// costo registrado — y la pantalla dice cuánto está midiendo de verdad en vez
// de presentar una ganancia inventada como si fuera un hecho.

export type Utilidad = {
  /** Venta neta considerada (después de devoluciones). */
  venta_centavos: number;
  costo_centavos: number;
  utilidad_centavos: number;
  margenPct: number;
  /** Parte de lo vendido (0..1) cuyo costo SÍ está registrado. 1 = todo. */
  cobertura: number;
  /** Cuántos productos distintos se vendieron sin costo capturado. */
  productosSinCosto: number;
};

/** Umbral por encima del cual la ganancia se considera fiable para afirmarla
 *  en el titular sin matices. No es 1 exacto para no descartar el dato por un
 *  concepto libre de un pedido web (que nunca tendrá costo) dentro de un mes
 *  entero de ventas bien capturadas. */
export const COBERTURA_FIABLE = 0.98;

export async function utilidadRango(rango: Rango): Promise<Utilidad | null> {
  await exigirPermiso("verReportes");
  const db = await bd();
  const desde = inicioDeRango(rango);

  const f = await db.getFirstAsync<{
    costo: number; venta: number; venta_con_costo: number; sin_costo: number;
  }>(
    `SELECT COALESCE(SUM(l.costo_unitario_centavos * l.cantidad),0) AS costo,
            COALESCE(SUM(l.total_linea_centavos),0) AS venta,
            COALESCE(SUM(CASE WHEN l.costo_unitario_centavos > 0
                              THEN l.total_linea_centavos ELSE 0 END),0) AS venta_con_costo,
            COUNT(DISTINCT CASE WHEN l.costo_unitario_centavos <= 0
                                THEN COALESCE(l.producto_id, l.nombre_producto) END) AS sin_costo
     FROM venta_lineas l JOIN ventas v ON v.id = l.venta_id
     WHERE v.estado <> 'cancelada' AND v.creado_en >= ?`,
    [desde]
  );

  // Lo devuelto sale de las dos columnas: deja de ser venta y deja de ser
  // costo. Si solo se restara de la venta, devolver un producto empeoraría el
  // margen como si la mercancía se hubiera perdido, cuando volvió al anaquel.
  const d = await db.getFirstAsync<{ venta_dev: number; costo_dev: number }>(
    `SELECT COALESCE(SUM(dl.monto_centavos),0) AS venta_dev,
            COALESCE(SUM(dl.cantidad * vl.costo_unitario_centavos),0) AS costo_dev
     FROM devolucion_lineas dl
     JOIN devoluciones dv ON dv.id = dl.devolucion_id
     JOIN venta_lineas vl ON vl.id = dl.venta_linea_id
     JOIN ventas v ON v.id = dv.venta_id
     WHERE v.estado <> 'cancelada' AND dv.creado_en >= ?`,
    [desde]
  );

  const ventaBruta = Math.round(f?.venta ?? 0);
  const venta = ventaBruta - Math.round(d?.venta_dev ?? 0);
  const costo = Math.round(f?.costo ?? 0) - Math.round(d?.costo_dev ?? 0);
  if (venta <= 0) return null;

  const utilidad = venta - costo;
  return {
    venta_centavos: venta,
    costo_centavos: costo,
    utilidad_centavos: utilidad,
    margenPct: (utilidad / venta) * 100,
    // La cobertura se mide sobre el bruto: es una propiedad del catálogo
    // (cuántos productos tienen costo), no del flujo de devoluciones.
    cobertura: ventaBruta > 0 ? Math.min(1, (f?.venta_con_costo ?? 0) / ventaBruta) : 0,
    productosSinCosto: f?.sin_costo ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Cuándo vende el negocio
// ---------------------------------------------------------------------------
//
// En BRUTO a propósito: responden "cuándo entra gente", no "cuánto me quedó".
// Ver la nota de la cabecera del archivo.

export type MejorHora = { hora: number; total_centavos: number; tickets: number };

/** Hora local con más venta acumulada en el rango. */
export async function mejorHoraRango(rango: Rango): Promise<MejorHora | null> {
  await exigirPermiso("verReportes");
  const db = await bd();
  const filas = await db.getAllAsync<{ creado_en: string; total_centavos: number }>(
    `SELECT creado_en, total_centavos FROM ventas
     WHERE estado <> 'cancelada' AND creado_en >= ?`,
    [inicioDeRango(rango)]
  );
  if (filas.length === 0) return null;
  const horas = new Array(24).fill(0).map(() => ({ total: 0, n: 0 }));
  for (const f of filas) {
    const h = new Date(f.creado_en).getHours();
    horas[h].total += f.total_centavos;
    horas[h].n += 1;
  }
  let mejor = 0;
  for (let h = 1; h < 24; h++) if (horas[h].total > horas[mejor].total) mejor = h;
  if (horas[mejor].total === 0) return null;
  return { hora: mejor, total_centavos: horas[mejor].total, tickets: horas[mejor].n };
}

export type MejorDia = { dia: number; nombre: string; total_centavos: number };

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Día de la semana con más venta acumulada. Sin sentido para el rango "hoy". */
export async function mejorDiaRango(rango: Rango): Promise<MejorDia | null> {
  await exigirPermiso("verReportes");
  if (rango === "hoy") return null;
  const db = await bd();
  const filas = await db.getAllAsync<{ creado_en: string; total_centavos: number }>(
    `SELECT creado_en, total_centavos FROM ventas
     WHERE estado <> 'cancelada' AND creado_en >= ?`,
    [inicioDeRango(rango)]
  );
  if (filas.length === 0) return null;
  const dias = new Array(7).fill(0);
  for (const f of filas) dias[new Date(f.creado_en).getDay()] += f.total_centavos;
  let mejor = 0;
  for (let d = 1; d < 7; d++) if (dias[d] > dias[mejor]) mejor = d;
  if (dias[mejor] === 0) return null;
  return { dia: mejor, nombre: DIAS[mejor], total_centavos: dias[mejor] };
}

// ---------------------------------------------------------------------------
// Serie para la gráfica: por HORA (rango hoy) o por DÍA (los demás)
// ---------------------------------------------------------------------------

export type PuntoSerie = {
  etiqueta: string; // "14h" o "9 jul"
  total_centavos: number;
  tickets: number;
  /** Índice del día de la semana (0=domingo). null en la serie por hora.
   *  Lo usa componerTitular() para nombrar el día del pico sin volver a
   *  parsear la etiqueta, que es texto de presentación y no un dato. */
  diaSemana: number | null;
};

export async function serieVentas(rango: Rango): Promise<PuntoSerie[]> {
  await exigirPermiso("verReportes");
  const db = await bd();
  const desde = inicioDeRango(rango);
  const filas = await db.getAllAsync<{ creado_en: string; total_centavos: number }>(
    `SELECT creado_en, total_centavos FROM ventas
     WHERE estado <> 'cancelada' AND creado_en >= ?`,
    [desde]
  );

  if (rango === "hoy") {
    // Cubetas por hora local, de 0 a la hora actual.
    const horaActual = new Date().getHours();
    const cubetas: PuntoSerie[] = [];
    for (let h = 0; h <= horaActual; h++) {
      cubetas.push({ etiqueta: `${h}h`, total_centavos: 0, tickets: 0, diaSemana: null });
    }
    for (const f of filas) {
      const h = new Date(f.creado_en).getHours();
      if (h >= 0 && h <= horaActual) {
        cubetas[h].total_centavos += f.total_centavos;
        cubetas[h].tickets += 1;
      }
    }
    return cubetas;
  }

  // Cubetas por día local desde el inicio del rango hasta hoy.
  const inicio = new Date(desde);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const cubetas: PuntoSerie[] = [];
  const indice = new Map<string, number>(); // clave "yyyy-m-d" -> posición
  const cursor = new Date(inicio);
  while (cursor <= hoy) {
    const clave = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;
    indice.set(clave, cubetas.length);
    cubetas.push({
      etiqueta: cursor.toLocaleDateString("es-MX", { day: "numeric", month: "short" }),
      total_centavos: 0,
      tickets: 0,
      diaSemana: cursor.getDay(),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  for (const f of filas) {
    const d = new Date(f.creado_en);
    const clave = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const i = indice.get(clave);
    if (i !== undefined) {
      cubetas[i].total_centavos += f.total_centavos;
      cubetas[i].tickets += 1;
    }
  }
  return cubetas;
}

// ---------------------------------------------------------------------------
// Top productos del rango
// ---------------------------------------------------------------------------

export type TopProducto = {
  nombre: string;
  cantidad: number;
  total_centavos: number;
};

export async function topProductos(rango: Rango, limite = 8): Promise<TopProducto[]> {
  await exigirPermiso("verReportes");
  const db = await bd();
  const desde = inicioDeRango(rango);

  // Se agrupa por producto_id, NO por nombre_producto.
  //
  // `nombre_producto` es el nombre CONGELADO al momento de vender. Al agrupar
  // por ahí, renombrar un producto partía sus ventas en dos filas del top y
  // ninguna reflejaba el total: el producto que más vendes podía no aparecer,
  // o aparecer dos veces con la mitad cada una.
  //
  // La etiqueta es el nombre ACTUAL del catálogo; si el producto ya no existe
  // (o la línea no tiene producto_id, como los conceptos libres de un pedido
  // web) se cae al congelado, que es lo único que queda. Mismo criterio que
  // reportes.rs del PC.
  //
  // Lo devuelto se resta por línea con un LEFT JOIN a una subconsulta
  // agregada: hacerlo con un segundo JOIN directo multiplicaría las filas de
  // venta_lineas por sus devoluciones y sumaría de más.
  const filas = await db.getAllAsync<TopProducto>(
    `SELECT COALESCE(p.nombre, l.nombre_producto) AS nombre,
            COALESCE(SUM(l.cantidad),0) - COALESCE(SUM(d.cant),0) AS cantidad,
            COALESCE(SUM(l.total_linea_centavos),0) - COALESCE(SUM(d.monto),0) AS total_centavos
     FROM venta_lineas l
     JOIN ventas v ON v.id = l.venta_id
     LEFT JOIN productos p ON p.id = l.producto_id
     LEFT JOIN (
       SELECT dl.venta_linea_id AS lid,
              SUM(dl.cantidad) AS cant,
              SUM(dl.monto_centavos) AS monto
       FROM devolucion_lineas dl
       JOIN devoluciones dv ON dv.id = dl.devolucion_id
       GROUP BY dl.venta_linea_id
     ) d ON d.lid = l.id
     WHERE v.estado <> 'cancelada' AND v.creado_en >= ?
     GROUP BY COALESCE(l.producto_id, l.nombre_producto)
     ORDER BY total_centavos DESC
     LIMIT ?`,
    [desde, limite]
  );
  // Un producto devuelto por completo queda en 0 y no es un "más vendido".
  return filas.filter((f) => f.total_centavos > 0 || f.cantidad > 0);
}

// ---------------------------------------------------------------------------
// Ventas por departamento
// ---------------------------------------------------------------------------

export type VentaDepto = {
  departamento: string;
  color: string | null;
  total_centavos: number;
  cantidad: number;
};

export async function ventasPorDepartamento(rango: Rango): Promise<VentaDepto[]> {
  await exigirPermiso("verReportes");
  const db = await bd();
  const filas = await db.getAllAsync<VentaDepto>(
    `SELECT COALESCE(c.nombre, 'Sin departamento') AS departamento,
            c.color AS color,
            COALESCE(SUM(l.total_linea_centavos),0) - COALESCE(SUM(d.monto),0) AS total_centavos,
            COALESCE(SUM(l.cantidad),0) - COALESCE(SUM(d.cant),0) AS cantidad
     FROM venta_lineas l
     JOIN ventas v ON v.id = l.venta_id
     LEFT JOIN productos p ON p.id = l.producto_id
     LEFT JOIN categorias c ON c.id = p.categoria_id
     LEFT JOIN (
       SELECT dl.venta_linea_id AS lid,
              SUM(dl.cantidad) AS cant,
              SUM(dl.monto_centavos) AS monto
       FROM devolucion_lineas dl
       JOIN devoluciones dv ON dv.id = dl.devolucion_id
       GROUP BY dl.venta_linea_id
     ) d ON d.lid = l.id
     WHERE v.estado <> 'cancelada' AND v.creado_en >= ?
     GROUP BY c.id
     ORDER BY total_centavos DESC`,
    [inicioDeRango(rango)]
  );
  return filas.filter((f) => f.total_centavos > 0);
}

// ---------------------------------------------------------------------------
// Ventas por método de pago
// ---------------------------------------------------------------------------

export type VentaMetodo = {
  /** Valor crudo de pagos.metodo: "efectivo" | "tarjeta" | "transferencia" |
   *  "credito" (ver MetodoPago en venta.ts). La pantalla lo traduce con un
   *  mapa que tiene caída por defecto, para que un método nuevo se vea con su
   *  nombre en vez de rotularse mal. */
  metodo: string;
  /** Neto: cobrado por ese método menos lo reembolsado por ese mismo método. */
  total_centavos: number;
  pagos: number;
};

export async function ventasPorMetodo(rango: Rango): Promise<VentaMetodo[]> {
  await exigirPermiso("verReportes");
  const db = await bd();
  const ini = inicioDeRango(rango);

  const cobrado = await db.getAllAsync<{ metodo: string; total: number; pagos: number }>(
    `SELECT p.metodo,
            COALESCE(SUM(p.monto_centavos),0) AS total,
            COUNT(*) AS pagos
     FROM pagos p
     JOIN ventas v ON v.id = p.venta_id
     WHERE v.estado <> 'cancelada' AND v.creado_en >= ?
     GROUP BY p.metodo`,
    [ini]
  );

  // El dinero vuelve por donde entró: devoluciones.ts crea UNA fila por
  // método, así que agrupar por metodo_reembolso da el reparto real.
  const devuelto = await db.getAllAsync<{ metodo: string; total: number }>(
    `SELECT dv.metodo_reembolso AS metodo,
            COALESCE(SUM(dv.total_devuelto_centavos),0) AS total
     FROM devoluciones dv
     JOIN ventas v ON v.id = dv.venta_id
     WHERE v.estado <> 'cancelada' AND dv.creado_en >= ?
     GROUP BY dv.metodo_reembolso`,
    [ini]
  );
  const mapaDev = new Map<string, number>(
    devuelto.map((d) => [d.metodo, d.total] as [string, number])
  );

  return cobrado
    .map((c) => ({
      metodo: c.metodo,
      total_centavos: c.total - (mapaDev.get(c.metodo) ?? 0),
      pagos: c.pagos,
    }))
    .filter((m) => m.total_centavos !== 0)
    .sort((a, b) => b.total_centavos - a.total_centavos);
}

// ---------------------------------------------------------------------------
// EL TITULAR — la pantalla empieza contando qué pasó, no listando indicadores
// ---------------------------------------------------------------------------
//
// Función PURA a propósito: recibe lo que la pantalla ya cargó y no toca la
// base. Así se puede ejecutar con casos reales sin SQLite, que es la única
// forma de comprobar que la redacción no dice tonterías en los bordes.
//
// Devuelve PIEZAS, no un string. Si devolviera texto plano, las cifras se
// pintarían en Archivo en vez de IBM Plex Mono y sería la única vez en toda la
// app que un monto no pasa por <Monto>.
//
// REGLA QUE MANDA: el titular NUNCA repite la cifra protagonista ni el
// porcentaje que la lámina ya muestra debajo. La primera versión decía
// "Vendiste $10,107.00 ... 41% menos que los 7 días previos" justo encima de
// una tarjeta que decía "$10,107.00" y "↓41% vs los 7 días previos": la misma
// frase dos veces con distinta tipografía. Por eso se leía como un texto
// suelto pegado sobre la tarjeta en vez de como su conclusión. El titular
// aporta lo que las cifras NO dicen; si no tiene nada que aportar, se queda
// con lo más útil que quede sin duplicar.
//
// ESCALERA DE CAÍDA — el orden importa, y siempre hay salida:
//   1. Pico excepcional   un día muy por encima de lo normal
//   2. Tendencia          tres días seguidos subiendo o bajando
//   3. Ganancia           cuánto quedó y cuántos centavos por peso
//   4. Costos incompletos por qué NO se puede decir la ganancia todavía
//   5. Comparación        en prosa, cuando no hay dato de costo ninguno
//   6. Sin histórico      se dice que todavía no hay con qué comparar
//   (sin ventas -> null; la pantalla muestra un estado vacío de verdad)
//
// Nunca hay un hueco y nunca se afirma algo que los datos no sostienen.

export type PiezaTitular = { t: "texto" | "monto"; v: string };

/** Días con venta mínimos para que la mediana signifique algo. Con dos o tres
 *  días, "un día normal" no existe todavía: cualquiera de ellos es la mitad de
 *  la muestra y el "pico" sería ruido. */
const DIAS_MINIMOS_PICO = 4;
/** Cuánto tiene que despegar un día sobre la mediana para ser noticia. */
const FACTOR_PICO = 1.8;
/** Días con venta mínimos para afirmar una TENDENCIA.
 *
 *  Salió de ejecutar la escalera con casos reales: con tres días de historia,
 *  "llevas tres días bajando" se disparaba en el tercer día de vida del
 *  negocio. Es literalmente cierto y no significa nada — y es un pésimo
 *  primer mensaje. Con cinco días la frase ya describe un patrón. */
const DIAS_MINIMOS_TENDENCIA = 5;
/** Cuánto tiene que moverse la racha de tres días para llamarse tendencia.
 *
 *  Sin esto, una serie de 16,000 / 16,500 / 17,000 se anunciaba como "llevas
 *  tres días subiendo": un 6% repartido en tres días es el mismo día con otro
 *  decimal. Mismo criterio que el 3% de la comparación porcentual. */
const MOVIMIENTO_MINIMO_TENDENCIA = 0.15;

/** Mediana de una lista de números. Se usa mediana y NO promedio a propósito:
 *  el promedio lo arrastra el propio pico, así que la frase se desactivaría
 *  sola justo en el caso en que tiene sentido. */
function mediana(xs: number[]): number {
  if (xs.length === 0) return 0;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : Math.round((o[m - 1] + o[m]) / 2);
}

/** "el doble", "casi el triple"... sin prometer precisión que no hay.
 *
 *  Los umbrales están puestos para que cada frase cubra el entorno de su
 *  número: "el triple" vale de 2.75 a 3.6, "casi el triple" justo por debajo.
 *  La primera versión tenía los cortes desordenados y un ratio de 3.0 exacto
 *  salía como "casi el cuádruple" — se cazó ejecutando los casos, no
 *  leyendo. */
function veces(ratio: number): string {
  if (ratio >= 3.6) return `${Math.round(ratio)} veces`;
  if (ratio >= 2.75) return "el triple";
  if (ratio >= 2.4) return "casi el triple";
  if (ratio >= 1.85) return "el doble";
  return "casi el doble";
}

const DIAS_CAP = ["El domingo", "El lunes", "El martes", "El miércoles",
  "El jueves", "El viernes", "El sábado"];

export function componerTitular(args: {
  rango: Rango;
  comp: Comparativo;
  utilidad: Utilidad | null;
  serie: PuntoSerie[];
  etiquetaAnterior: string;
  /** Texto de "cuándo podré comparar" del rango ("Mañana", "La próxima semana"). */
  cuandoComparar: string;
  /** Formateador de dinero (pesos, de src/base/formato). Se inyecta para que
   *  este archivo no dependa de la capa de presentación. */
  fmt: (centavos: number) => string;
}): PiezaTitular[] | null {
  const { rango, comp, utilidad, serie, etiquetaAnterior, cuandoComparar, fmt } = args;
  const r = comp.actual;

  // 5. Sin ventas: no hay nada que contar. La pantalla decide qué mostrar.
  if (r.tickets === 0) return null;

  const T = (v: string): PiezaTitular => ({ t: "texto", v });
  const M = (c: number): PiezaTitular => ({ t: "monto", v: fmt(c) });

  // La ganancia solo se afirma cuando el costo está capturado casi al 100%.
  // Con menos, la cifra existe pero está sesgada al alza (ver COBERTURA_FIABLE)
  // y no se pone en el titular: la sección Ganancia lo explica con detalle.
  const ganancia =
    utilidad && utilidad.cobertura >= COBERTURA_FIABLE && utilidad.utilidad_centavos > 0
      ? utilidad.utilidad_centavos
      : null;

  // 1. Pico excepcional. Solo con serie por día (en "hoy" la serie es horaria
  //    y "un día normal" no aplica).
  if (rango !== "hoy") {
    const conVenta = serie.filter((p) => p.total_centavos > 0);
    if (conVenta.length >= DIAS_MINIMOS_PICO) {
      const med = mediana(conVenta.map((p) => p.total_centavos));
      let pico = conVenta[0];
      for (const p of conVenta) if (p.total_centavos > pico.total_centavos) pico = p;
      const ratio = med > 0 ? pico.total_centavos / med : 0;
      if (ratio >= FACTOR_PICO && pico.diaSemana !== null) {
        // En 7 días solo hay un sábado, así que el nombre del día basta. En 30
        // días o en el mes hay cuatro o cinco: "el sábado" no identifica
        // ninguno, y el usuario no sabría a cuál mirar. Ahí se usa la fecha.
        const cual = rango === "7d"
          ? DIAS_CAP[pico.diaSemana]
          : `El ${pico.etiqueta}`;
        return [
          T(`${cual} vendiste `),
          M(pico.total_centavos),
          T(`: ${veces(ratio)} de un día normal.`),
        ];
      }
    }

    // 2. Tendencia: los tres últimos días, todos con venta y todos moviéndose
    //    en la misma dirección. Se exige que el primero tenga venta para no
    //    llamar "subida" a salir de un día cerrado, que haya historia
    //    suficiente para que el patrón signifique algo, y que el movimiento
    //    sea de verdad (ver las dos constantes de arriba).
    const u = serie.slice(-3);
    if (
      u.length === 3 &&
      conVenta.length >= DIAS_MINIMOS_TENDENCIA &&
      u.every((p) => p.total_centavos > 0)
    ) {
      const sube = u[1].total_centavos > u[0].total_centavos &&
        u[2].total_centavos > u[1].total_centavos;
      const baja = u[1].total_centavos < u[0].total_centavos &&
        u[2].total_centavos < u[1].total_centavos;
      const movimiento =
        Math.abs(u[2].total_centavos - u[0].total_centavos) / u[0].total_centavos;
      if ((sube || baja) && movimiento >= MOVIMIENTO_MINIMO_TENDENCIA) {
        return [
          T(`Llevas tres días ${sube ? "subiendo" : "bajando"}. Ayer cerraste con `),
          M(u[2].total_centavos),
          T("."),
        ];
      }
    }
  }

  // 3. Ganancia. Es lo que la lámina NO puede decir: el vendido y la
  //    comparación ya están ahí arriba en cifras.
  if (ganancia !== null && utilidad) {
    const pct = Math.round(utilidad.margenPct);
    return [
      T("Te quedaron "),
      M(ganancia),
      T(
        pct >= 1
          ? ` de ganancia: el ${pct}% de lo que vendiste.`
          : " de ganancia."
      ),
    ];
  }

  // 4. Hay costos, pero incompletos. Decirlo es más útil que dar una cifra
  //    inflada: un producto sin costo capturado reporta 100% de margen, así
  //    que la ganancia existiría pero estaría sesgada hacia arriba.
  if (utilidad && utilidad.cobertura < COBERTURA_FIABLE) {
    const n = utilidad.productosSinCosto;
    return [
      T(
        `Todavía no puedo decirte cuánto ganaste: ${
          n === 1 ? "falta el costo de 1 producto" : `faltan los costos de ${n} productos`
        }.`
      ),
    ];
  }

  // 5. Sin costos en absoluto. Queda la comparación; se redacta en prosa y no
  //    con el mismo porcentaje que ya muestra la lámina justo debajo.
  if (comp.variacionPct !== null) {
    const pct = Math.abs(comp.variacionPct);
    const sube = comp.variacionPct >= 0;
    // Por debajo del 3% no es una tendencia, es el mismo periodo con otro
    // decimal. Decir "1% más" suena a precisión y es ruido.
    if (pct < 3) {
      return [T(`Vendiste prácticamente lo mismo que ${etiquetaAnterior}.`)];
    }
    return [
      T(`${sube ? "Subiste" : "Bajaste"} ${pct.toFixed(0)}% respecto a ${etiquetaAnterior}: `),
      M(Math.abs(comp.diferencia_centavos)),
      T(sube ? " más." : " menos."),
    ];
  }

  // 6. Sin histórico. Es la primera semana: se dice, no se rellena con un 0%.
  return [
    T(
      `Llevas ${r.tickets} ${r.tickets === 1 ? "ticket" : "tickets"}. ${cuandoComparar}.`
    ),
  ];
}

// ---------------------------------------------------------------------------
// Productos por GANANCIA (no por venta)
// ---------------------------------------------------------------------------
//
// `topProductos` ordena por lo VENDIDO, que es lo que casi todo el mundo mira
// y casi nunca es lo que conviene saber. El producto que más factura no suele
// ser el que más deja: basta con que sea barato de vender y caro de comprar.
//
// Va AQUÍ y no en indicadores.ts por la regla de siempre: es una métrica de
// ventas, y las métricas de ventas viven en este archivo para que no existan
// dos formas de contar lo mismo. Comparte con `topProductos` el criterio de
// agrupar por producto_id y de restar devoluciones por línea con la
// subconsulta agregada — si eso cambia, cambia en los dos sitios.
//
// Solo entran líneas con costo capturado. Una línea con costo 0 daría 100% de
// margen y encabezaría la lista siempre, que es justo el error que convierte
// un reporte en una mentira convincente.

export type ProductoGanancia = {
  nombre: string;
  cantidad: number;
  total_centavos: number;
  ganancia_centavos: number;
  margen_pct: number;
};

export async function productosPorGanancia(
  rango: Rango,
  limite = 8
): Promise<ProductoGanancia[]> {
  await exigirPermiso("verReportes");
  const db = await bd();
  const desde = inicioDeRango(rango);

  const filas = await db.getAllAsync<{
    nombre: string;
    cantidad: number;
    total_centavos: number;
    costo_centavos: number;
  }>(
    `SELECT COALESCE(p.nombre, l.nombre_producto) AS nombre,
            COALESCE(SUM(l.cantidad),0) - COALESCE(SUM(d.cant),0) AS cantidad,
            COALESCE(SUM(l.total_linea_centavos),0) - COALESCE(SUM(d.monto),0) AS total_centavos,
            COALESCE(SUM(l.costo_unitario_centavos * l.cantidad),0) AS costo_centavos
     FROM venta_lineas l
     JOIN ventas v ON v.id = l.venta_id
     LEFT JOIN productos p ON p.id = l.producto_id
     LEFT JOIN (
       SELECT dl.venta_linea_id AS lid,
              SUM(dl.cantidad) AS cant,
              SUM(dl.monto_centavos) AS monto
       FROM devolucion_lineas dl
       JOIN devoluciones dv ON dv.id = dl.devolucion_id
       GROUP BY dl.venta_linea_id
     ) d ON d.lid = l.id
     WHERE v.estado <> 'cancelada'
       AND v.creado_en >= ?
       AND l.costo_unitario_centavos > 0
     GROUP BY COALESCE(l.producto_id, l.nombre_producto)`,
    [desde]
  );

  const salida: ProductoGanancia[] = [];
  for (const f of filas) {
    const total = Number(f.total_centavos) || 0;
    const costo = Number(f.costo_centavos) || 0;
    // Un producto devuelto por completo queda en 0 o negativo: no es "el que
    // más deja", es una devolución.
    if (total <= 0) continue;
    const ganancia = Math.round(total - costo);
    salida.push({
      nombre: f.nombre,
      cantidad: Number(f.cantidad) || 0,
      total_centavos: total,
      ganancia_centavos: ganancia,
      margen_pct: Math.round((ganancia / total) * 1000) / 10,
    });
  }

  salida.sort((a, b) => b.ganancia_centavos - a.ganancia_centavos);
  return salida.slice(0, limite);
}
