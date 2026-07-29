// YvexPOS Móvil — Lógica de reportes de ventas (locales).
//
// Todos los rangos y agrupaciones se calculan en HORA LOCAL del teléfono
// (la venta de las 11pm cuenta en el día local correcto, no en el día UTC).
// creado_en se guarda en ISO UTC; los límites de rango se calculan en JS y la
// agrupación por día/hora también, para no depender del parseo de fechas de
// SQLite.

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
// Resumen del rango
// ---------------------------------------------------------------------------

export type ResumenRango = {
  total_centavos: number;
  tickets: number;
  promedio_centavos: number;
  articulos: number;
};

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
