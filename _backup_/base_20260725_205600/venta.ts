// YvexPOS Móvil — Lógica de venta y turnos de caja.
//
// Mismo modelo que el PC: toda venta pertenece a un TURNO de caja abierto
// (fondo inicial -> ventas -> corte al cerrar). El cobro es TRANSACCIONAL:
// venta + líneas + pago + descuento de stock, todo o nada.
// Kits: al vender un kit se descuenta el stock de sus COMPONENTES.

import { bd, uuid, ahoraISO } from "./db";
import { asegurarUsuario, usuarioActivoId } from "./usuarios";
import { encolar, sincronizarTrasVenta } from "./sync";

export type Turno = {
  id: string;
  fondo_inicial_centavos: number;
  abierta_en: string;
};

export type ItemCarrito = {
  producto_id: string;
  nombre: string;
  precio_centavos: number;
  cantidad: number;
  es_kit: boolean;
};

export type MetodoPago = "efectivo" | "tarjeta";

// ---------------------------------------------------------------------------
// Turnos de caja
// ---------------------------------------------------------------------------

export async function turnoActivo(): Promise<Turno | null> {
  const db = await bd();
  const fila = await db.getFirstAsync<Turno>(
    `SELECT id, fondo_inicial_centavos, abierta_en
     FROM caja_sesiones WHERE estado = 'abierta'
     ORDER BY abierta_en DESC LIMIT 1`
  );
  return fila ?? null;
}

export async function abrirTurno(fondoCentavos: number): Promise<Turno> {
  const db = await bd();
  const ya = await turnoActivo();
  if (ya) return ya; // idempotente: si ya hay turno, se usa ese

  // Garantiza que haya un usuario. Si la base está limpia, el onboarding es
  // quien crea al dueño (nunca un PIN por defecto).
  const usuario = await asegurarUsuario();
  if (!usuario) throw new Error("Primero configura tu usuario desde la pantalla de bienvenida.");

  const id = uuid();
  const ahora = ahoraISO();
  await db.runAsync(
    `INSERT INTO caja_sesiones
      (id, usuario_pos_id, fondo_inicial_centavos, abierta_en, estado, creado_en, actualizado_en)
     VALUES (?,?,?,?, 'abierta', ?, ?)`,
    [id, usuario.id, fondoCentavos, ahora, ahora, ahora]
  );

  // A la cola de subida: la nube exige el turno ANTES que sus ventas (FK).
  await encolar("caja_sesiones", id, {
    id,
    usuario_pos_id: usuario.id,
    fondo_inicial_centavos: fondoCentavos,
    abierta_en: ahora,
    cerrada_en: null,
    estado: "abierta",
    actualizado_en: ahora,
  });

  return { id, fondo_inicial_centavos: fondoCentavos, abierta_en: ahora };
}

export async function cerrarTurno(turnoId: string): Promise<void> {
  const db = await bd();
  const ahora = ahoraISO();
  await db.runAsync(
    `UPDATE caja_sesiones SET estado = 'cerrada', cerrada_en = ?, actualizado_en = ? WHERE id = ?`,
    [ahora, ahora, turnoId]
  );
  await encolar(
    "caja_sesiones",
    turnoId,
    { id: turnoId, cerrada_en: ahora, estado: "cerrada", actualizado_en: ahora },
    "update"
  );
}

export type Corte = {
  tickets: number;
  total_centavos: number;
  efectivo_centavos: number;
  tarjeta_centavos: number;
  fondo_centavos: number;
  efectivo_esperado_centavos: number; // fondo + ventas en efectivo
};

/** Corte del turno: totales por método y efectivo esperado en cajón. */
export async function corteTurno(turno: Turno): Promise<Corte> {
  const db = await bd();
  const tot = await db.getFirstAsync<{ n: number; t: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total_centavos),0) AS t
     FROM ventas WHERE caja_sesion_id = ? AND estado <> 'cancelada'`,
    [turno.id]
  );
  const porMetodo = await db.getAllAsync<{ metodo: string; m: number }>(
    `SELECT p.metodo, COALESCE(SUM(p.monto_centavos),0) AS m
     FROM pagos p JOIN ventas v ON v.id = p.venta_id
     WHERE v.caja_sesion_id = ? AND v.estado <> 'cancelada'
     GROUP BY p.metodo`,
    [turno.id]
  );
  const efectivo = porMetodo.find((x) => x.metodo === "efectivo")?.m ?? 0;
  const tarjeta = porMetodo.find((x) => x.metodo === "tarjeta")?.m ?? 0;
  return {
    tickets: tot?.n ?? 0,
    total_centavos: tot?.t ?? 0,
    efectivo_centavos: efectivo,
    tarjeta_centavos: tarjeta,
    fondo_centavos: turno.fondo_inicial_centavos,
    efectivo_esperado_centavos: turno.fondo_inicial_centavos + efectivo,
  };
}

// ---------------------------------------------------------------------------
// Cobro (transaccional)
// ---------------------------------------------------------------------------

export type ResultadoCobro = {
  venta_id: string;
  folio: number;
  total_centavos: number;
  cambio_centavos: number;
};

export async function cobrar(
  items: ItemCarrito[],
  metodo: MetodoPago,
  pagadoCentavos: number
): Promise<ResultadoCobro> {
  if (items.length === 0) throw new Error("El ticket está vacío.");
  const turno = await turnoActivo();
  if (!turno) throw new Error("No hay un turno de caja abierto.");

  const total = items.reduce(
    (s, i) => s + Math.round(i.precio_centavos * i.cantidad),
    0
  );
  if (metodo === "efectivo" && pagadoCentavos < total)
    throw new Error("El efectivo recibido no alcanza para el total.");
  const cambio = metodo === "efectivo" ? pagadoCentavos - total : 0;

  // Quién está vendiendo.
  const usuario = await asegurarUsuario();
  if (!usuario) throw new Error("Primero configura tu usuario desde la pantalla de bienvenida.");

  const db = await bd();
  const ventaId = uuid();
  const ahora = ahoraISO();

  await db.withTransactionAsync(async () => {
    // Folio consecutivo local.
    const f = await db.getFirstAsync<{ m: number }>(
      "SELECT COALESCE(MAX(folio),0) AS m FROM ventas"
    );
    const folio = (f?.m ?? 0) + 1;

    await db.runAsync(
      `INSERT INTO ventas
        (id, caja_sesion_id, usuario_pos_id, folio, subtotal_centavos, descuento_centavos,
         iva_centavos, total_centavos, estado, creado_en, actualizado_en)
       VALUES (?,?,?,?,?,0,0,?, 'completada', ?, ?)`,
      [ventaId, turno.id, usuario.id, folio, total, total, ahora, ahora]
    );

    for (const it of items) {
      const totalLinea = Math.round(it.precio_centavos * it.cantidad);
      await db.runAsync(
        `INSERT INTO venta_lineas
          (id, venta_id, producto_id, nombre_producto, cantidad,
           precio_unitario_centavos, descuento_linea_centavos, total_linea_centavos, creado_en)
         VALUES (?,?,?,?,?,?,0,?,?)`,
        [uuid(), ventaId, it.producto_id, it.nombre, it.cantidad, it.precio_centavos, totalLinea, ahora]
      );

      if (it.es_kit) {
        // Kit: descontar stock de cada componente.
        const comps = await db.getAllAsync<{ producto_id: string; cantidad: number }>(
          "SELECT producto_id, cantidad FROM kit_componentes WHERE kit_id = ?",
          [it.producto_id]
        );
        for (const c of comps) {
          await db.runAsync(
            `UPDATE productos SET stock = stock - ?, actualizado_en = ?
             WHERE id = ? AND controla_stock = 1`,
            [c.cantidad * it.cantidad, ahora, c.producto_id]
          );
        }
      } else {
        await db.runAsync(
          `UPDATE productos SET stock = stock - ?, actualizado_en = ?
           WHERE id = ? AND controla_stock = 1`,
          [it.cantidad, ahora, it.producto_id]
        );
      }
    }

    await db.runAsync(
      `INSERT INTO pagos (id, venta_id, metodo, monto_centavos, creado_en)
       VALUES (?,?,?,?,?)`,
      [uuid(), ventaId, metodo, total, ahora]
    );

    // Guardar el folio para devolverlo fuera de la transacción.
    (globalThis as any).__ultimoFolio = folio;
  });

  const folio = (globalThis as any).__ultimoFolio ?? 0;

  // ---- A la cola de subida (no bloquea la venta: solo escribe local) ----
  // El orden importa poco (el servidor reordena por dependencias), pero lo
  // encolamos en orden natural: venta, sus líneas, su pago.
  await encolar("ventas", ventaId, {
    id: ventaId,
    folio,
    usuario_pos_id: usuario.id,
    caja_sesion_id: turno.id,
    cliente_id: null,
    subtotal_centavos: total,
    descuento_centavos: 0,
    iva_centavos: 0,
    total_centavos: total,
    estado: "completada",
    creado_en: ahora,
    actualizado_en: ahora,
  });

  const db2 = await bd();
  const lineas = await db2.getAllAsync<any>(
    "SELECT * FROM venta_lineas WHERE venta_id = ?",
    [ventaId]
  );
  for (const l of lineas) {
    await encolar("venta_lineas", l.id, {
      id: l.id,
      venta_id: ventaId,
      producto_id: l.producto_id,
      descripcion: l.nombre_producto,
      cantidad: l.cantidad,
      precio_unitario_centavos: l.precio_unitario_centavos,
      costo_unitario_centavos: 0,
      descuento_linea_centavos: l.descuento_linea_centavos,
      total_linea_centavos: l.total_linea_centavos,
      creado_en: l.creado_en,
      actualizado_en: l.creado_en,
    });
  }

  const pago = await db2.getFirstAsync<any>(
    "SELECT * FROM pagos WHERE venta_id = ?",
    [ventaId]
  );
  if (pago) {
    await encolar("pagos", pago.id, {
      id: pago.id,
      venta_id: ventaId,
      metodo: pago.metodo,
      monto_centavos: pago.monto_centavos,
      recibido_centavos: metodo === "efectivo" ? pagadoCentavos : null,
      cambio_centavos: cambio,
      creado_en: pago.creado_en,
      actualizado_en: pago.creado_en,
    });
  }

  // ---- Stock resultante a la nube (misma regla del PC: la nube no calcula
  // stock; quien vende empuja el stock nuevo como update parcial). Sin esto,
  // las demás cajas bajan el catálogo con el stock viejo. ----
  const idsAfectados = new Set<string>();
  for (const it of items) {
    if (it.es_kit) {
      // Un kit descuenta el stock de sus COMPONENTES (no el suyo).
      const comps = await db2.getAllAsync<{ producto_id: string }>(
        "SELECT producto_id FROM kit_componentes WHERE kit_id = ?",
        [it.producto_id]
      );
      for (const c of comps) idsAfectados.add(c.producto_id);
    } else {
      idsAfectados.add(it.producto_id);
    }
  }
  for (const pid of idsAfectados) {
    const p = await db2.getFirstAsync<{ stock: number; controla_stock: number }>(
      "SELECT stock, controla_stock FROM productos WHERE id = ?",
      [pid]
    );
    // Solo suben los que controlan stock (los demás ni se tocaron en local).
    if (p && p.controla_stock === 1) {
      await encolar("productos", pid, {
        id: pid, stock: p.stock, actualizado_en: ahora,
      }, "update");
    }
  }

  // Sync inmediato en segundo plano (como hace el PC): la venta ya está
  // cobrada y guardada; esto solo adelanta la subida para que las demás
  // cajas la vean en segundos, no en la próxima sync manual.
  sincronizarTrasVenta();

  return {
    venta_id: ventaId,
    folio,
    total_centavos: total,
    cambio_centavos: cambio,
  };
}

// ---------------------------------------------------------------------------
// Resumen del día (para la pantalla de Inicio)
// ---------------------------------------------------------------------------

/** ISO del inicio del día LOCAL (hoy a las 00:00 hora del teléfono, en UTC). */
function inicioHoyISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export type ResumenHoy = {
  total_centavos: number;
  tickets: number;
  promedio_centavos: number;
};

export async function resumenHoy(): Promise<ResumenHoy> {
  const db = await bd();
  const fila = await db.getFirstAsync<{ n: number; t: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total_centavos),0) AS t
     FROM ventas WHERE estado <> 'cancelada' AND creado_en >= ?`,
    [inicioHoyISO()]
  );
  const n = fila?.n ?? 0;
  const t = fila?.t ?? 0;
  return {
    total_centavos: t,
    tickets: n,
    promedio_centavos: n > 0 ? Math.round(t / n) : 0,
  };
}

export type VentaReciente = {
  id: string;
  folio: number;
  total_centavos: number;
  creado_en: string;
  articulos: number;
};

export async function ventasRecientes(limite = 6): Promise<VentaReciente[]> {
  const db = await bd();
  return db.getAllAsync<VentaReciente>(
    `SELECT v.id, v.folio, v.total_centavos, v.creado_en,
            (SELECT COALESCE(SUM(l.cantidad),0) FROM venta_lineas l WHERE l.venta_id = v.id) AS articulos
     FROM ventas v WHERE v.estado <> 'cancelada'
     ORDER BY v.creado_en DESC LIMIT ?`,
    [limite]
  );
}
