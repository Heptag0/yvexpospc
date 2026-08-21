// YvexPOS Móvil — Lógica de reportes de ventas (locales).
//
// Todos los rangos y agrupaciones se calculan en HORA LOCAL del teléfono
// (la venta de las 11pm cuenta en el día local correcto, no en el día UTC).
// creado_en se guarda en ISO UTC; los límites de rango se calculan en JS y la
// agrupación por día/hora también, para no depender del parseo de fechas de
// SQLite.
//
// ---------------------------------------------------------------------------
// QUÉ SE AÑADIÓ Y POR QUÉ
// ---------------------------------------------------------------------------
// La pantalla solo sabía decir QUÉ pasó (vendido, tickets, promedio). Nunca
// CÓMO fue ni CUÁNTO se ganó. Un número sin comparación no informa: "$4,350"
// no significa nada si no sabes si la semana pasada fueron $3,000 o $9,000.
//
// Se añaden cuatro cosas, todas derivadas de datos que YA existen:
//   · comparativoRango  — el mismo rango contra el periodo anterior.
//   · utilidadRango     — costo y margen real del rango.
//   · mejorHoraRango    — a qué hora vende de verdad el negocio.
//   · mejorDiaRango     — qué día de la semana rinde más.
//
// Nada de esto exige tocar el esquema ni sincronizar nada nuevo.

import { bd } from "./db";

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
  total_centavos: number;
  tickets: number;
  promedio_centavos: number;
  articulos: number;
};

/** Resumen entre dos instantes ISO. `hasta` es exclusivo. */
export async function resumenEntre(desde: string, hasta: string): Promise<ResumenRango> {
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
  const n = fila?.n ?? 0;
  const t = fila?.t ?? 0;
  return {
    total_centavos: t,
    tickets: n,
    promedio_centavos: n > 0 ? Math.round(t / n) : 0,
    articulos: art?.a ?? 0,
  };
}

export async function resumenRango(rango: Rango): Promise<ResumenRango> {
  const db = await bd();
  const desde = inicioDeRango(rango);
  const fila = await db.getFirstAsync<{ n: number; t: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total_centavos),0) AS t
     FROM ventas WHERE estado <> 'cancelada' AND creado_en >= ?`,
    [desde]
  );
  const art = await db.getFirstAsync<{ a: number }>(
    `SELECT COALESCE(SUM(l.cantidad),0) AS a
     FROM venta_lineas l JOIN ventas v ON v.id = l.venta_id
     WHERE v.estado <> 'cancelada' AND v.creado_en >= ?`,
    [desde]
  );
  const n = fila?.n ?? 0;
  const t = fila?.t ?? 0;
  return {
    total_centavos: t,
    tickets: n,
    promedio_centavos: n > 0 ? Math.round(t / n) : 0,
    articulos: art?.a ?? 0,
  };
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
// El costo puede vivir en la línea de venta (lo ideal: es el costo del momento
// en que se vendió) o solo en el producto (aproximación: el costo de HOY).
// En vez de asumir un esquema, se pregunta a la base qué columnas existe y se
// escoge la mejor disponible. Si no hay ninguna, se devuelve null y la
// pantalla simplemente no muestra la tarjeta — nunca un cero engañoso.

export type Utilidad = {
  costo_centavos: number;
  utilidad_centavos: number;
  margenPct: number;
  /** true = costo tomado del producto (aproximado), no de la línea. */
  aproximado: boolean;
};

async function columnasDe(tabla: string): Promise<Set<string>> {
  try {
    const db = await bd();
    const filas = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${tabla})`);
    return new Set(filas.map((f) => f.name));
  } catch {
    return new Set<string>();
  }
}

export async function utilidadRango(rango: Rango): Promise<Utilidad | null> {
  const db = await bd();
  const desde = inicioDeRango(rango);
  const colLinea = await columnasDe("venta_lineas");

  let sql: string;
  let aproximado: boolean;

  if (colLinea.has("costo_unitario_centavos")) {
    aproximado = false;
    sql = `SELECT COALESCE(SUM(l.costo_unitario_centavos * l.cantidad),0) AS costo,
                  COALESCE(SUM(l.total_linea_centavos),0) AS venta
           FROM venta_lineas l JOIN ventas v ON v.id = l.venta_id
           WHERE v.estado <> 'cancelada' AND v.creado_en >= ?`;
  } else {
    const colProd = await columnasDe("productos");
    if (!colProd.has("costo_centavos")) return null;
    aproximado = true;
    sql = `SELECT COALESCE(SUM(p.costo_centavos * l.cantidad),0) AS costo,
                  COALESCE(SUM(l.total_linea_centavos),0) AS venta
           FROM venta_lineas l
           JOIN ventas v ON v.id = l.venta_id
           JOIN productos p ON p.id = l.producto_id
           WHERE v.estado <> 'cancelada' AND v.creado_en >= ?`;
  }

  try {
    const f = await db.getFirstAsync<{ costo: number; venta: number }>(sql, [desde]);
    const costo = Math.round(f?.costo ?? 0);
    const venta = Math.round(f?.venta ?? 0);
    if (venta <= 0) return null;
    const utilidad = venta - costo;
    return {
      costo_centavos: costo,
      utilidad_centavos: utilidad,
      margenPct: (utilidad / venta) * 100,
      aproximado,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cuándo vende el negocio
// ---------------------------------------------------------------------------

export type MejorHora = { hora: number; total_centavos: number; tickets: number };

/** Hora local con más venta acumulada en el rango. */
export async function mejorHoraRango(rango: Rango): Promise<MejorHora | null> {
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
};

export async function serieVentas(rango: Rango): Promise<PuntoSerie[]> {
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
      cubetas.push({ etiqueta: `${h}h`, total_centavos: 0, tickets: 0 });
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
  const db = await bd();
  return db.getAllAsync<TopProducto>(
    `SELECT l.nombre_producto AS nombre,
            COALESCE(SUM(l.cantidad),0) AS cantidad,
            COALESCE(SUM(l.total_linea_centavos),0) AS total_centavos
     FROM venta_lineas l
     JOIN ventas v ON v.id = l.venta_id
     WHERE v.estado <> 'cancelada' AND v.creado_en >= ?
     GROUP BY l.nombre_producto
     ORDER BY total_centavos DESC
     LIMIT ?`,
    [inicioDeRango(rango), limite]
  );
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
  const db = await bd();
  return db.getAllAsync<VentaDepto>(
    `SELECT COALESCE(c.nombre, 'Sin departamento') AS departamento,
            c.color AS color,
            COALESCE(SUM(l.total_linea_centavos),0) AS total_centavos,
            COALESCE(SUM(l.cantidad),0) AS cantidad
     FROM venta_lineas l
     JOIN ventas v ON v.id = l.venta_id
     LEFT JOIN productos p ON p.id = l.producto_id
     LEFT JOIN categorias c ON c.id = p.categoria_id
     WHERE v.estado <> 'cancelada' AND v.creado_en >= ?
     GROUP BY c.id
     ORDER BY total_centavos DESC`,
    [inicioDeRango(rango)]
  );
}

// ---------------------------------------------------------------------------
// Ventas por método de pago
// ---------------------------------------------------------------------------

export type VentaMetodo = {
  metodo: string;
  total_centavos: number;
  pagos: number;
};

export async function ventasPorMetodo(rango: Rango): Promise<VentaMetodo[]> {
  const db = await bd();
  return db.getAllAsync<VentaMetodo>(
    `SELECT p.metodo,
            COALESCE(SUM(p.monto_centavos),0) AS total_centavos,
            COUNT(*) AS pagos
     FROM pagos p
     JOIN ventas v ON v.id = p.venta_id
     WHERE v.estado <> 'cancelada' AND v.creado_en >= ?
     GROUP BY p.metodo
     ORDER BY total_centavos DESC`,
    [inicioDeRango(rango)]
  );
}
