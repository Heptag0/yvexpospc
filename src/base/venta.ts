// YvexPOS Móvil — Lógica de venta y turnos de caja.
//
// Mismo modelo que el PC: toda venta pertenece a un TURNO de caja abierto
// (fondo inicial -> ventas -> corte al cerrar). El cobro es TRANSACCIONAL:
// venta + líneas + pago + descuento de stock, todo o nada.
// Kits: al vender un kit se descuenta el stock de sus COMPONENTES.

import { bd, uuid, ahoraISO } from "./db";
import { asegurarUsuario, usuarioActivoId } from "./usuarios";
import { encolar, sincronizarTrasVenta } from "./sync";
import { leerConfig } from "./config";
import {
  lineasVentaWeb,
  metodoPagoVentaWeb,
  ORIGEN_VENTA_WEB,
} from "./tiendaReglas";

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
  /** Descuento de lealtad aplicado (0 si no hubo). Para el recibo. */
  descuento_centavos: number;
};

export type OpcionesCobro = {
  /** Cliente de lealtad ligado al ticket (null/undefined = venta de
   *  mostrador sin cliente, como siempre). */
  clienteId?: string;
  /** Descuento YA CONFIRMADO por el usuario en pantalla (canje de puntos).
   *  cobrar() solo lo acota: nunca negativo, nunca mayor que el subtotal.
   *  NADA se descuenta automáticamente. */
  descuentoCentavos?: number;
};

export async function cobrar(
  items: ItemCarrito[],
  metodo: MetodoPago,
  pagadoCentavos: number,
  opciones?: OpcionesCobro
): Promise<ResultadoCobro> {
  if (items.length === 0) throw new Error("El ticket está vacío.");
  const turno = await turnoActivo();
  if (!turno) throw new Error("No hay un turno de caja abierto.");

  const subtotal = items.reduce(
    (s, i) => s + Math.round(i.precio_centavos * i.cantidad),
    0
  );
  // Descuento de lealtad confirmado en pantalla (canje de puntos). Acotado:
  // entre 0 y el subtotal, siempre. total = subtotal - descuento.
  const descuento = Math.max(
    0,
    Math.min(Math.floor(opciones?.descuentoCentavos ?? 0), subtotal)
  );
  const clienteId = opciones?.clienteId ?? null;
  const total = subtotal - descuento;
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
         iva_centavos, total_centavos, estado, cliente_id, creado_en, actualizado_en)
       VALUES (?,?,?,?,?,?,0,?, 'completada', ?, ?, ?)`,
      [ventaId, turno.id, usuario.id, folio, subtotal, descuento, total, clienteId, ahora, ahora]
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
    // cliente_id y descuento_centavos ya existían en el payload hecho a mano
    // (antes viajaban fijos en null/0): el backend ya esperaba estas columnas
    // y la bajada (sync.ts) inserta columnas explícitas, así que mandar los
    // valores reales es seguro.
    cliente_id: clienteId,
    subtotal_centavos: subtotal,
    descuento_centavos: descuento,
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
    descuento_centavos: descuento,
  };
}

// ---------------------------------------------------------------------------
// Venta WEB (pedido de la tienda en línea marcado como entregado)
// ---------------------------------------------------------------------------
//
// Se registra al completar un pedido web para que aparezca en "Vendido hoy"
// y en Reportes. Mismas tablas y misma mecánica transaccional que cobrar(),
// con tres diferencias deliberadas:
//   1. ventas.origen = 'web' (columna local existente; la nube NO la recibe:
//      el MAPA del sync no la incluye, así que no hace falta migración).
//   2. Puede llevar una línea "Envío a domicilio" (producto_id NULL) y
//      líneas cuyo producto ya no existe en el catálogo local (también con
//      producto_id NULL para no violar la FK; el nombre y precio quedan).
//   3. ANTI-DUPLICADO: la marca vive en config (`tienda_ventaweb_{pedidoId}`
//      -> venta_id), escrita DENTRO de la misma transacción. Si el registro
//      se reintenta (doble toque, reintento tras error de red, pedido que se
//      marca entregado dos veces), se detecta y NO se duplica la venta.

export type PedidoParaVentaWeb = {
  id: string;
  items: {
    producto_id: string;
    nombre: string;
    cantidad: number;
    precio_centavos: number;
  }[];
  total_centavos: number;
  entrega: string; // "pickup" | "domicilio"
  pago: string; // "efectivo" | "en_linea"
};

export type ResultadoVentaWeb = {
  venta_id: string;
  folio: number;
  total_centavos: number;
  /** true si el pedido YA tenía su venta registrada (anti-duplicado). */
  ya_registrada: boolean;
};

export async function registrarVentaWeb(
  pedido: PedidoParaVentaWeb
): Promise<ResultadoVentaWeb> {
  const claveMarca = `tienda_ventaweb_${pedido.id}`;
  const marca = await leerConfig(claveMarca);
  if (marca) {
    // Ya estaba apuntada: devolvemos la existente sin duplicar.
    const db0 = await bd();
    const f0 = await db0.getFirstAsync<{ folio: number; total_centavos: number }>(
      "SELECT folio, total_centavos FROM ventas WHERE id = ?",
      [marca]
    );
    return {
      venta_id: marca,
      folio: f0?.folio ?? 0,
      total_centavos: f0?.total_centavos ?? 0,
      ya_registrada: true,
    };
  }

  const turno = await turnoActivo();
  if (!turno)
    throw new Error("No hay un turno de caja abierto para apuntar la venta web.");

  const usuario = await asegurarUsuario();
  if (!usuario)
    throw new Error("Primero configura tu usuario desde la pantalla de bienvenida.");

  const lineas = lineasVentaWeb(pedido.items, pedido.total_centavos, pedido.entrega);
  if (lineas.length === 0) throw new Error("El pedido no tiene productos.");
  const metodo = metodoPagoVentaWeb(pedido.pago);

  const db = await bd();
  const ventaId = uuid();
  const ahora = ahoraISO();

  // ¿El producto sigue existiendo en el catálogo local? Si no, la línea se
  // guarda como producto libre (producto_id NULL) con su nombre y precio.
  const existentes = new Set<string>();
  for (const l of lineas) {
    if (!l.producto_id) continue;
    const p = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM productos WHERE id = ?",
      [l.producto_id]
    );
    if (p) existentes.add(l.producto_id);
  }

  const subtotal = lineas.reduce(
    (s, l) => s + Math.round(l.precio_centavos * l.cantidad),
    0
  );
  const total = subtotal; // sin descuento: el pedido ya trae su total final

  await db.withTransactionAsync(async () => {
    const f = await db.getFirstAsync<{ m: number }>(
      "SELECT COALESCE(MAX(folio),0) AS m FROM ventas"
    );
    const folio = (f?.m ?? 0) + 1;

    await db.runAsync(
      `INSERT INTO ventas
        (id, caja_sesion_id, usuario_pos_id, folio, subtotal_centavos, descuento_centavos,
         iva_centavos, total_centavos, estado, cliente_id, origen, creado_en, actualizado_en)
       VALUES (?,?,?,?,?,0,0,?, 'completada', NULL, ?, ?, ?)`,
      [ventaId, turno.id, usuario.id, folio, subtotal, total, ORIGEN_VENTA_WEB, ahora, ahora]
    );

    for (const l of lineas) {
      const pid = l.producto_id && existentes.has(l.producto_id) ? l.producto_id : null;
      const totalLinea = Math.round(l.precio_centavos * l.cantidad);
      await db.runAsync(
        `INSERT INTO venta_lineas
          (id, venta_id, producto_id, nombre_producto, cantidad,
           precio_unitario_centavos, descuento_linea_centavos, total_linea_centavos, creado_en)
         VALUES (?,?,?,?,?,?,0,?,?)`,
        [uuid(), ventaId, pid, l.nombre, l.cantidad, l.precio_centavos, totalLinea, ahora]
      );
      // Stock: igual que una venta normal (no-op si no controla stock; las
      // líneas libres — envío o producto borrado — no tienen pid).
      if (pid) {
        await db.runAsync(
          `UPDATE productos SET stock = stock - ?, actualizado_en = ?
           WHERE id = ? AND controla_stock = 1`,
          [l.cantidad, ahora, pid]
        );
      }
    }

    await db.runAsync(
      `INSERT INTO pagos (id, venta_id, metodo, monto_centavos, creado_en)
       VALUES (?,?,?,?,?)`,
      [uuid(), ventaId, metodo, total, ahora]
    );

    // Marca anti-duplicado DENTRO de la transacción: venta y marca nacen
    // juntas o no nacen.
    await db.runAsync(
      "INSERT INTO config (clave, valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor = ?",
      [claveMarca, ventaId, ventaId]
    );

    (globalThis as any).__ultimoFolioWeb = folio;
  });

  const folio = (globalThis as any).__ultimoFolioWeb ?? 0;

  // ---- A la cola de subida (mismo esquema que cobrar; la nube no recibe
  // `origen` porque su MAPA de columnas no lo incluye). ----
  await encolar("ventas", ventaId, {
    id: ventaId,
    folio,
    usuario_pos_id: usuario.id,
    caja_sesion_id: turno.id,
    cliente_id: null,
    subtotal_centavos: subtotal,
    descuento_centavos: 0,
    iva_centavos: 0,
    total_centavos: total,
    estado: "completada",
    creado_en: ahora,
    actualizado_en: ahora,
  });

  const db2 = await bd();
  const lineasDb = await db2.getAllAsync<any>(
    "SELECT * FROM venta_lineas WHERE venta_id = ?",
    [ventaId]
  );
  for (const l of lineasDb) {
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

  const pagoDb = await db2.getFirstAsync<any>(
    "SELECT * FROM pagos WHERE venta_id = ?",
    [ventaId]
  );
  if (pagoDb) {
    await encolar("pagos", pagoDb.id, {
      id: pagoDb.id,
      venta_id: ventaId,
      metodo: pagoDb.metodo,
      monto_centavos: pagoDb.monto_centavos,
      recibido_centavos: metodo === "efectivo" ? total : null,
      cambio_centavos: 0,
      creado_en: pagoDb.creado_en,
      actualizado_en: pagoDb.creado_en,
    });
  }

  // ---- Stock resultante a la nube (misma regla que cobrar). ----
  for (const pid of existentes) {
    const p = await db2.getFirstAsync<{ stock: number; controla_stock: number }>(
      "SELECT stock, controla_stock FROM productos WHERE id = ?",
      [pid]
    );
    if (p && p.controla_stock === 1) {
      await encolar("productos", pid, {
        id: pid, stock: p.stock, actualizado_en: ahora,
      }, "update");
    }
  }

  sincronizarTrasVenta();

  return { venta_id: ventaId, folio, total_centavos: total, ya_registrada: false };
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
