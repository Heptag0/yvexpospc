// YvexPOS Móvil — Agenda financiera: dos libros (negocio y personal).
//
// Puerto de src-tauri/src/db/finanzas.rs del PC. Mismas reglas, mismos
// nombres, mismos resultados — para que el dueño vea lo mismo en la caja y
// en su teléfono.
//
// DOS LIBROS separados, intercambiables:
//   negocio  → la renta del local, la luz del local, los sueldos…
//   personal → la renta de su casa, la luz de su casa, la despensa…
// La misma categoría vive en los dos y está bien: es el mismo tipo de gasto
// en dos bolsillos distintos. Mezclarlos es justo lo que hace que un negocio
// familiar nunca sepa si de verdad gana.
//
// EL PUENTE ENTRE LIBROS: cuando el dueño saca dinero del negocio para sus
// cosas (categoría "retiro"), eso es UN GASTO del negocio y UN INGRESO
// personal a la vez. Una sola captura, las dos verdades correctas.
//
// ⚠️ SIN DOBLE CAPTURA (igual que el PC): si el gasto del negocio se paga con
// efectivo del cajón, el mismo registro genera su salida en `movimientos_caja`
// para que el corte cuadre. El dueño captura UNA vez.
//
// ⚠️ COSTO DE LO VENDIDO: se calcula con el costo ACTUAL del producto
// (`venta_lineas` no guarda snapshot al vender). Aproximación honesta
// mientras los costos se muevan poco. Mismo criterio que el PC.
//
// LOCAL-ONLY (v1). Dinero SIEMPRE en centavos enteros.

import { bd, uuid, ahoraISO } from "./db";
import { registrarMovimientoCaja } from "./venta";

export type Ambito = "negocio" | "personal";
export type ClaseMov = "gasto" | "ingreso";

export type Movimiento = {
  id: string;
  clase: ClaseMov;
  concepto: string;
  categoria: string;
  monto_centavos: number;
  fecha: string;
  notas: string | null;
};

export type GastoFijo = {
  id: string;
  ambito: Ambito;
  concepto: string;
  categoria: string;
  monto_centavos: number;
  dia_mes: number;
  notas: string | null;
  pagado_este_mes: boolean;
  dias_faltan: number;
};

export type EstadoPresupuesto = {
  categoria: string;
  limite_centavos: number;
  gastado_centavos: number;
  pct: number;
  estado: "ok" | "cerca" | "excedido";
};

export type DiaCalendario = {
  fecha: string;
  dia: number;
  gastos_centavos: number;
  ingresos_centavos: number;
  fijos_pendientes: number;
};

export type TotalCategoria = {
  categoria: string;
  total_centavos: number;
  pct: number;
};

export type Aviso = {
  tono: "peligro" | "alerta" | "info";
  titulo: string;
  detalle: string;
};

export type ResumenFinanzas = {
  ambito: Ambito;
  ingresos_mes_centavos: number;
  gastos_mes_centavos: number;
  balance_mes_centavos: number;
  gastos_hoy_centavos: number;
  proyeccion_mes_centavos: number;
  // Solo negocio
  ventas_hoy_centavos: number;
  costo_vendido_hoy_centavos: number;
  ganancia_hoy_centavos: number;
  ventas_mes_centavos: number;
  costo_vendido_mes_centavos: number;
  ganancia_mes_centavos: number;
  costo_diario_centavos: number;
  falta_hoy_centavos: number;
  margen_pct: number;
  // El puente
  retiros_mes_centavos: number;
  // Contexto
  presupuestos: EstadoPresupuesto[];
  por_categoria: TotalCategoria[];
  proximos_fijos: GastoFijo[];
  calendario: DiaCalendario[];
  avisos: Aviso[];
  hay_datos: boolean;
};

export type DatosGasto = {
  ambito: Ambito;
  concepto: string;
  categoria: string;
  montoCentavos: number;
  fecha: string;
  metodoPago?: string;
  gastoFijoId?: string | null;
  notas?: string | null;
  /** Si viene, el gasto se pagó con efectivo del cajón de ESTE turno: se
   *  genera también su salida en movimientos_caja para que el corte cuadre. */
  cajaSesionId?: string | null;
};

export type DatosIngreso = {
  ambito: Ambito;
  concepto: string;
  categoria: string;
  montoCentavos: number;
  fecha: string;
  notas?: string | null;
};

export type DatosGastoFijo = {
  ambito: Ambito;
  concepto: string;
  categoria: string;
  montoCentavos: number;
  diaMes: number;
  notas?: string | null;
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export function hoyYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pesosTxt(centavos: number): string {
  return `$${(centavos / 100).toFixed(2)}`;
}

async function suma(
  tabla: "gastos" | "ingresos",
  ambito: Ambito,
  desde: string,
  hasta: string
): Promise<number> {
  const db = await bd();
  const r = await db.getFirstAsync<{ t: number }>(
    `SELECT COALESCE(SUM(monto_centavos),0) AS t FROM ${tabla}
      WHERE eliminado = 0 AND ambito = ? AND fecha BETWEEN ? AND ?`,
    [ambito, desde, hasta]
  );
  return r?.t ?? 0;
}

async function sumaVentas(desde: string, hasta: string): Promise<number> {
  const db = await bd();
  const r = await db.getFirstAsync<{ t: number }>(
    `SELECT COALESCE(SUM(total_centavos),0) AS t FROM ventas
      WHERE estado != 'cancelada' AND date(creado_en) BETWEEN ? AND ?`,
    [desde, hasta]
  );
  return r?.t ?? 0;
}

async function costoVendido(desde: string, hasta: string): Promise<number> {
  const db = await bd();
  const r = await db.getFirstAsync<{ t: number }>(
    `SELECT COALESCE(SUM(CAST(ROUND(vl.cantidad * COALESCE(p.costo_centavos,0)) AS INTEGER)),0) AS t
       FROM venta_lineas vl
       JOIN ventas v ON vl.venta_id = v.id
       LEFT JOIN productos p ON vl.producto_id = p.id
      WHERE v.estado != 'cancelada' AND date(v.creado_en) BETWEEN ? AND ?`,
    [desde, hasta]
  );
  return r?.t ?? 0;
}

// ---------------------------------------------------------------------------
// Gastos
// ---------------------------------------------------------------------------

/** Registra un gasto. Dos efectos automáticos según el caso:
 *    - efectivo del negocio + turno abierto → salida en movimientos_caja
 *    - categoría "retiro" en el negocio → ingreso espejo en el libro personal
 *  Una sola captura del dueño, las verdades correctas en cada lado. */
export async function registrarGasto(d: DatosGasto): Promise<string> {
  const concepto = d.concepto.trim();
  if (!concepto) throw new Error("Escribe en qué se gastó.");
  if (d.montoCentavos <= 0) throw new Error("El monto debe ser mayor a cero.");
  const db = await bd();
  const id = uuid();
  const ts = ahoraISO();
  const metodo = d.metodoPago ?? "efectivo";

  // 1. ¿Sale del cajón? Primero el movimiento: si falla, no queda un gasto
  //    "pagado del cajón" sin su salida (el corte mentiría).
  let movimientoId: string | null = null;
  if (metodo === "efectivo" && d.ambito === "negocio" && d.cajaSesionId) {
    movimientoId = await registrarMovimientoCaja({
      cajaSesionId: d.cajaSesionId,
      tipo: "salida",
      motivo: concepto,
      montoCentavos: d.montoCentavos,
    });
  }

  // 2. ¿Es retiro del negocio? Entonces también ENTRA al libro personal.
  const ingresoEspejo = d.ambito === "negocio" && d.categoria === "retiro" ? uuid() : null;

  await db.withTransactionAsync(async () => {
    if (ingresoEspejo) {
      await db.runAsync(
        `INSERT INTO ingresos
           (id, ambito, concepto, categoria, monto_centavos, fecha,
            gasto_origen_id, notas, eliminado, creado_en, actualizado_en)
         VALUES (?,'personal',?,'negocio',?,?,?,NULL,0,?,?)`,
        [ingresoEspejo, concepto, d.montoCentavos, d.fecha, id, ts, ts]
      );
    }
    await db.runAsync(
      `INSERT INTO gastos
         (id, ambito, concepto, categoria, monto_centavos, fecha, metodo_pago,
          gasto_fijo_id, movimiento_caja_id, ingreso_espejo_id, notas,
          eliminado, creado_en, actualizado_en)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
      [
        id, d.ambito, concepto, d.categoria, d.montoCentavos, d.fecha,
        metodo, d.gastoFijoId ?? null, movimientoId, ingresoEspejo,
        d.notas?.trim() || null, ts, ts,
      ]
    );
  });
  return id;
}

/** Baja suave. Si tenía ingreso espejo (retiro), también se da de baja: era
 *  el mismo dinero. La salida de caja NO se toca: ese efectivo ya salió del
 *  cajón físicamente y el corte de ese turno ya se calculó con ella. */
export async function eliminarGasto(id: string): Promise<void> {
  const db = await bd();
  const ts = ahoraISO();
  const g = await db.getFirstAsync<{ ingreso_espejo_id: string | null }>(
    "SELECT ingreso_espejo_id FROM gastos WHERE id = ?",
    [id]
  );
  await db.withTransactionAsync(async () => {
    await db.runAsync("UPDATE gastos SET eliminado = 1, actualizado_en = ? WHERE id = ?", [ts, id]);
    if (g?.ingreso_espejo_id) {
      await db.runAsync("UPDATE ingresos SET eliminado = 1, actualizado_en = ? WHERE id = ?", [ts, g.ingreso_espejo_id]);
    }
  });
}

// ---------------------------------------------------------------------------
// Ingresos
// ---------------------------------------------------------------------------

export async function registrarIngreso(d: DatosIngreso): Promise<string> {
  const concepto = d.concepto.trim();
  if (!concepto) throw new Error("Escribe de dónde vino el dinero.");
  if (d.montoCentavos <= 0) throw new Error("El monto debe ser mayor a cero.");
  const db = await bd();
  const id = uuid();
  const ts = ahoraISO();
  await db.runAsync(
    `INSERT INTO ingresos
       (id, ambito, concepto, categoria, monto_centavos, fecha,
        gasto_origen_id, notas, eliminado, creado_en, actualizado_en)
     VALUES (?,?,?,?,?,?,NULL,?,0,?,?)`,
    [id, d.ambito, concepto, d.categoria, d.montoCentavos, d.fecha, d.notas?.trim() || null, ts, ts]
  );
  return id;
}

export async function eliminarIngreso(id: string): Promise<void> {
  const db = await bd();
  await db.runAsync("UPDATE ingresos SET eliminado = 1, actualizado_en = ? WHERE id = ?", [ahoraISO(), id]);
}

/** Gastos e ingresos juntos, lo más reciente primero. */
export async function listarMovimientos(
  ambito: Ambito,
  desde: string,
  hasta: string
): Promise<Movimiento[]> {
  const db = await bd();
  const gastos = await db.getAllAsync<any>(
    `SELECT id, concepto, categoria, monto_centavos, fecha, notas FROM gastos
      WHERE eliminado = 0 AND ambito = ? AND fecha BETWEEN ? AND ?`,
    [ambito, desde, hasta]
  );
  const ingresos = await db.getAllAsync<any>(
    `SELECT id, concepto, categoria, monto_centavos, fecha, notas FROM ingresos
      WHERE eliminado = 0 AND ambito = ? AND fecha BETWEEN ? AND ?`,
    [ambito, desde, hasta]
  );
  const todos: Movimiento[] = [
    ...gastos.map((g) => ({ ...g, clase: "gasto" as ClaseMov })),
    ...ingresos.map((i) => ({ ...i, clase: "ingreso" as ClaseMov })),
  ];
  todos.sort((a, b) => (a.fecha === b.fecha ? a.clase.localeCompare(b.clase) : b.fecha.localeCompare(a.fecha)));
  return todos;
}

// ---------------------------------------------------------------------------
// Gastos fijos
// ---------------------------------------------------------------------------

export async function crearFijo(d: DatosGastoFijo): Promise<string> {
  const concepto = d.concepto.trim();
  if (!concepto) throw new Error("Escribe el nombre del gasto fijo.");
  if (d.montoCentavos <= 0) throw new Error("El monto debe ser mayor a cero.");
  const db = await bd();
  const id = uuid();
  const ts = ahoraISO();
  await db.runAsync(
    `INSERT INTO gastos_fijos
       (id, ambito, concepto, categoria, monto_centavos, dia_mes, activo, notas,
        eliminado, creado_en, actualizado_en)
     VALUES (?,?,?,?,?,?,1,?,0,?,?)`,
    [id, d.ambito, concepto, d.categoria, d.montoCentavos,
     Math.min(31, Math.max(1, Math.round(d.diaMes))), d.notas?.trim() || null, ts, ts]
  );
  return id;
}

export async function eliminarFijo(id: string): Promise<void> {
  const db = await bd();
  await db.runAsync("UPDATE gastos_fijos SET eliminado = 1, actualizado_en = ? WHERE id = ?", [ahoraISO(), id]);
}

export async function listarFijos(ambito: Ambito, hoy: string): Promise<GastoFijo[]> {
  const db = await bd();
  const mes = hoy.slice(0, 7);
  const diaHoy = Number(hoy.slice(8, 10));
  const filas = await db.getAllAsync<any>(
    `SELECT f.id, f.ambito, f.concepto, f.categoria, f.monto_centavos, f.dia_mes, f.notas,
            EXISTS (SELECT 1 FROM gastos g
                     WHERE g.gasto_fijo_id = f.id AND g.eliminado = 0
                       AND substr(g.fecha, 1, 7) = ?) AS pagado
       FROM gastos_fijos f
      WHERE f.eliminado = 0 AND f.activo = 1 AND f.ambito = ?
      ORDER BY f.dia_mes`,
    [mes, ambito]
  );
  return filas.map((f) => ({
    id: f.id, ambito: f.ambito, concepto: f.concepto, categoria: f.categoria,
    monto_centavos: f.monto_centavos, dia_mes: f.dia_mes, notas: f.notas,
    pagado_este_mes: f.pagado === 1,
    dias_faltan: f.dia_mes - diaHoy,
  }));
}

// ---------------------------------------------------------------------------
// Presupuestos
// ---------------------------------------------------------------------------

export async function guardarPresupuesto(
  ambito: Ambito,
  categoria: string,
  montoCentavos: number
): Promise<void> {
  const db = await bd();
  const ts = ahoraISO();
  if (montoCentavos <= 0) {
    // Poner 0 quita el límite de esa categoría.
    await db.runAsync("DELETE FROM presupuestos WHERE ambito = ? AND categoria = ?", [ambito, categoria]);
    return;
  }
  await db.runAsync(
    `INSERT INTO presupuestos (id, ambito, categoria, monto_centavos, creado_en, actualizado_en)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(ambito, categoria) DO UPDATE SET
       monto_centavos = excluded.monto_centavos, actualizado_en = excluded.actualizado_en`,
    [uuid(), ambito, categoria, montoCentavos, ts, ts]
  );
}

// ---------------------------------------------------------------------------
// El tablero
// ---------------------------------------------------------------------------

export async function resumen(ambito: Ambito, hoy: string): Promise<ResumenFinanzas> {
  const db = await bd();
  const esNegocio = ambito === "negocio";
  const mes = hoy.slice(0, 7);
  const mesInicio = `${mes}-01`;
  const diaHoy = Number(hoy.slice(8, 10));
  const ultimoDia = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
  const mesFin = `${mes}-${String(ultimoDia).padStart(2, "0")}`;

  const [gastosMes, gastosHoy, ingresosExtra] = await Promise.all([
    suma("gastos", ambito, mesInicio, hoy),
    suma("gastos", ambito, hoy, hoy),
    suma("ingresos", ambito, mesInicio, hoy),
  ]);
  const ventasMes = esNegocio ? await sumaVentas(mesInicio, hoy) : 0;
  const ventasHoy = esNegocio ? await sumaVentas(hoy, hoy) : 0;
  const costoMes = esNegocio ? await costoVendido(mesInicio, hoy) : 0;
  const costoHoy = esNegocio ? await costoVendido(hoy, hoy) : 0;

  const ingresosMes = ventasMes + ingresosExtra;
  const gananciaMes = ventasMes - costoMes - gastosMes;
  const gananciaHoy = ventasHoy - costoHoy - gastosHoy;
  const balanceMes = ingresosMes - gastosMes - (esNegocio ? costoMes : 0);

  // Punto de equilibrio (negocio)
  const fijoTot = await db.getFirstAsync<{ t: number }>(
    "SELECT COALESCE(SUM(monto_centavos),0) AS t FROM gastos_fijos WHERE eliminado = 0 AND activo = 1 AND ambito = ?",
    [ambito]
  );
  const totalFijos = fijoTot?.t ?? 0;
  const costoDiario = Math.round(totalFijos / 30);
  const margenPct = ventasMes > 0 ? ((ventasMes - costoMes) / ventasMes) * 100 : 30;
  const faltaHoy = esNegocio && margenPct > 0
    ? Math.max(0, Math.round((costoDiario + gastosHoy) / (margenPct / 100)) - ventasHoy)
    : 0;

  const proyeccion = diaHoy > 0 ? Math.round((gastosMes / diaHoy) * 30) : gastosMes;

  // El puente: retiros del negocio este mes
  const ret = await db.getFirstAsync<{ t: number }>(
    `SELECT COALESCE(SUM(monto_centavos),0) AS t FROM gastos
      WHERE eliminado = 0 AND ambito = 'negocio' AND categoria = 'retiro' AND fecha BETWEEN ? AND ?`,
    [mesInicio, hoy]
  );
  const retirosMes = ret?.t ?? 0;

  // Presupuestos con su avance
  const presuFilas = await db.getAllAsync<any>(
    `SELECT p.categoria, p.monto_centavos AS limite,
            COALESCE((SELECT SUM(g.monto_centavos) FROM gastos g
                       WHERE g.eliminado = 0 AND g.ambito = p.ambito
                         AND g.categoria = p.categoria AND g.fecha BETWEEN ? AND ?), 0) AS gastado
       FROM presupuestos p WHERE p.ambito = ? ORDER BY p.categoria`,
    [mesInicio, hoy, ambito]
  );
  const presupuestos: EstadoPresupuesto[] = presuFilas.map((p) => {
    const pct = p.limite > 0 ? Math.max(0, Math.round((p.gastado * 100) / p.limite)) : 0;
    return {
      categoria: p.categoria,
      limite_centavos: p.limite,
      gastado_centavos: p.gastado,
      pct,
      estado: pct > 100 ? "excedido" : pct >= 80 ? "cerca" : "ok",
    };
  });

  // Por categoría
  const catFilas = await db.getAllAsync<any>(
    `SELECT categoria, SUM(monto_centavos) AS total FROM gastos
      WHERE eliminado = 0 AND ambito = ? AND fecha BETWEEN ? AND ?
      GROUP BY categoria ORDER BY total DESC`,
    [ambito, mesInicio, hoy]
  );
  const porCategoria: TotalCategoria[] = catFilas.map((c) => ({
    categoria: c.categoria,
    total_centavos: c.total,
    pct: gastosMes > 0 ? Math.round((c.total * 100) / gastosMes) : 0,
  }));

  // Fijos
  const fijos = await listarFijos(ambito, hoy);
  const proximosFijos = fijos.filter((f) => !f.pagado_este_mes && f.dias_faltan >= -5 && f.dias_faltan <= 7);

  // Calendario del mes — UNA consulta por tabla y se arma en memoria (en un
  // teléfono, 31 consultas por pantalla se notan).
  const gPorDia = await db.getAllAsync<any>(
    `SELECT fecha, SUM(monto_centavos) AS t FROM gastos
      WHERE eliminado = 0 AND ambito = ? AND fecha BETWEEN ? AND ? GROUP BY fecha`,
    [ambito, mesInicio, mesFin]
  );
  const iPorDia = await db.getAllAsync<any>(
    `SELECT fecha, SUM(monto_centavos) AS t FROM ingresos
      WHERE eliminado = 0 AND ambito = ? AND fecha BETWEEN ? AND ? GROUP BY fecha`,
    [ambito, mesInicio, mesFin]
  );
  const vPorDia = esNegocio
    ? await db.getAllAsync<any>(
        `SELECT date(creado_en) AS fecha, SUM(total_centavos) AS t FROM ventas
          WHERE estado != 'cancelada' AND date(creado_en) BETWEEN ? AND ? GROUP BY date(creado_en)`,
        [mesInicio, mesFin]
      )
    : [];
  const mapG = new Map(gPorDia.map((x) => [x.fecha, x.t]));
  const mapI = new Map(iPorDia.map((x) => [x.fecha, x.t]));
  const mapV = new Map(vPorDia.map((x) => [x.fecha, x.t]));

  const calendario: DiaCalendario[] = [];
  for (let dia = 1; dia <= ultimoDia; dia++) {
    const fecha = `${mes}-${String(dia).padStart(2, "0")}`;
    calendario.push({
      fecha,
      dia,
      gastos_centavos: mapG.get(fecha) ?? 0,
      ingresos_centavos: (mapI.get(fecha) ?? 0) + (mapV.get(fecha) ?? 0),
      fijos_pendientes: fijos.filter((f) => f.dia_mes === dia && !f.pagado_este_mes).length,
    });
  }

  // Avisos
  const avisos: Aviso[] = [];
  for (const p of presupuestos.filter((x) => x.estado !== "ok")) {
    if (p.estado === "excedido") {
      avisos.push({
        tono: "peligro",
        titulo: `Te pasaste en ${p.categoria}`,
        detalle: `Llevas ${pesosTxt(p.gastado_centavos)} de ${pesosTxt(p.limite_centavos)} que te pusiste.`,
      });
    } else {
      avisos.push({
        tono: "alerta",
        titulo: `Vas al ${p.pct}% de tu límite en ${p.categoria}`,
        detalle: `Te quedan ${pesosTxt(p.limite_centavos - p.gastado_centavos)} para el resto del mes.`,
      });
    }
  }
  for (const f of proximosFijos.filter((x) => x.dias_faltan < 0)) {
    avisos.push({
      tono: "peligro",
      titulo: `${f.concepto} venció el día ${f.dia_mes}`,
      detalle: `${pesosTxt(f.monto_centavos)} sin registrar este mes.`,
    });
  }
  if (!esNegocio && retirosMes > 0 && gastosMes > retirosMes) {
    avisos.push({
      tono: "alerta",
      titulo: "Estás gastando más de lo que te da el negocio",
      detalle: `El negocio te dio ${pesosTxt(retirosMes)} y llevas ${pesosTxt(gastosMes)} de gastos personales.`,
    });
  }

  return {
    ambito,
    ingresos_mes_centavos: ingresosMes,
    gastos_mes_centavos: gastosMes,
    balance_mes_centavos: balanceMes,
    gastos_hoy_centavos: gastosHoy,
    proyeccion_mes_centavos: proyeccion,
    ventas_hoy_centavos: ventasHoy,
    costo_vendido_hoy_centavos: costoHoy,
    ganancia_hoy_centavos: gananciaHoy,
    ventas_mes_centavos: ventasMes,
    costo_vendido_mes_centavos: costoMes,
    ganancia_mes_centavos: gananciaMes,
    costo_diario_centavos: costoDiario,
    falta_hoy_centavos: faltaHoy,
    margen_pct: margenPct,
    retiros_mes_centavos: retirosMes,
    presupuestos,
    por_categoria: porCategoria,
    proximos_fijos: proximosFijos,
    calendario,
    avisos,
    hay_datos: gastosMes > 0 || ingresosMes > 0 || totalFijos > 0 || presupuestos.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Catálogos de categorías (compartidos con la pantalla)
// ---------------------------------------------------------------------------

export const CATS_GASTO: Record<Ambito, { id: string; n: string }[]> = {
  negocio: [
    { id: "renta", n: "Renta del local" },
    { id: "servicios", n: "Luz, agua, gas" },
    { id: "internet", n: "Internet y teléfono" },
    { id: "sueldos", n: "Sueldos" },
    { id: "insumos", n: "Insumos" },
    { id: "transporte", n: "Transporte" },
    { id: "mantenimiento", n: "Mantenimiento" },
    { id: "impuestos", n: "Impuestos" },
    { id: "retiro", n: "Retiro para mí" },
    { id: "otro", n: "Otro" },
  ],
  personal: [
    { id: "casa", n: "Casa y renta" },
    { id: "servicios", n: "Luz, agua, gas" },
    { id: "internet", n: "Internet y teléfono" },
    { id: "despensa", n: "Despensa" },
    { id: "transporte", n: "Transporte" },
    { id: "salud", n: "Salud" },
    { id: "educacion", n: "Escuela" },
    { id: "entretenimiento", n: "Gustos y salidas" },
    { id: "deudas", n: "Deudas y pagos" },
    { id: "ahorro", n: "Ahorro" },
    { id: "otro", n: "Otro" },
  ],
};

export const CATS_INGRESO: Record<Ambito, { id: string; n: string }[]> = {
  negocio: [
    { id: "extra", n: "Ingreso extra" },
    { id: "renta", n: "Renta que cobro" },
    { id: "otro", n: "Otro" },
  ],
  personal: [
    { id: "negocio", n: "Del negocio" },
    { id: "sueldo", n: "Sueldo" },
    { id: "freelance", n: "Trabajo por fuera" },
    { id: "renta", n: "Renta que cobro" },
    { id: "apoyo", n: "Apoyo familiar" },
    { id: "otro", n: "Otro" },
  ],
};

export function nombreCategoria(ambito: Ambito, id: string): string {
  return (
    CATS_GASTO[ambito].find((c) => c.id === id)?.n ??
    CATS_INGRESO[ambito].find((c) => c.id === id)?.n ??
    id
  );
}
