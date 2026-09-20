// YvexPOS Móvil — Devoluciones y cancelaciones.
//
// Puerto de src-tauri/src/db/devoluciones.rs (PC): mismas reglas, mismos
// criterios de reembolso. Si algo aquí no coincide con ese archivo, es un
// bug de este puerto, no una decisión de diseño distinta.
//
// Invariantes (idénticas al PC):
//   - No se puede devolver más cantidad de la vendida menos lo ya devuelto.
//   - La venta original cambia de estado; nunca se borra.
//   - Reembolso según cómo se pagó: efectivo -> baja el cajón (el corte lo
//     calcula directo de `devoluciones`, no como salida de caja aparte);
//     tarjeta/transferencia -> no toca el cajón; crédito -> baja la deuda.
//   - Cancelación = devolución TOTAL con motivo exacto "Cancelación" (mismo
//     string mágico que usa el PC para decidir el estado final — ver abajo).
//
// Permisos: "devolver" ya está disponible para los TRES roles en
// permisos.ts (cajero incluido) — mismo reparto que el PC, donde cajero
// devuelve y cancela, y queda en la bitácora.
//
// Reingreso de stock: NO se llama a inventario.ts::ajustarStock() a
// propósito — esa función exige el permiso "ajustarStock" (solo
// gerente/dueño), y un cajero SÍ puede reingresar stock como parte de una
// devolución que él mismo procesa. El ajuste va inline aquí, bajo el
// permiso "devolver", con el mismo patrón local (ajustes_inventario es
// rastro puramente LOCAL en este cliente — nunca se encola como entidad
// propia; solo se sube el `productos.stock` resultante. Ver
// inventario.ts::ajustarStock(), que hace exactamente lo mismo).

import { bd, uuid, ahoraISO } from "./db";
import { encolar } from "./sync";
import { exigirPermiso } from "./permisos";
import { leerPrefijoFolio, etiquetaFolio } from "./venta";

export type LineaVentaDetalle = {
  venta_linea_id: string;
  producto_id: string | null;
  nombre: string;
  cantidad_vendida: number;
  cantidad_devuelta: number;
  cantidad_disponible: number;
  precio_unitario_centavos: number;
  total_linea_centavos: number;
};

export type VentaDetalle = {
  id: string;
  folio: number;
  caja_sesion_id: string;
  cliente_id: string | null;
  total_centavos: number;
  estado: string;
  creado_en: string;
  metodos_pago: { metodo: string; monto_centavos: number }[];
  lineas: LineaVentaDetalle[];
};

export type VentaResumen = {
  id: string;
  folio: number;
  /** Folio tal como debe verse: "A-3" si la venta es de ESTA caja y la caja
   *  tiene serie asignada; "#3" si llegó de otra caja (su serie no se
   *  conoce aquí) o si esta caja no está vinculada. */
  folio_etiqueta: string;
  total_centavos: number;
  estado: string;
  creado_en: string;
  articulos: number;
  /** false = ya no queda nada que devolver (devuelta total o cancelada). */
  devolvible: boolean;
};

/** Lista las ventas recientes para elegir cuál devolver, igual que la
 *  pantalla "Ventas del día" del PC.
 *
 *  ⚠️ POR QUÉ ESTO EXISTE — BUG REAL ENCONTRADO EN PRUEBAS.
 *  Antes la única forma de llegar a una venta era escribir su folio. Pero
 *  el folio NO es único en este teléfono: cada caja (este móvil, el PC,
 *  otra tablet) numera desde 1 por su cuenta, y al sincronizar todas esas
 *  ventas conviven en la misma tabla local. Escribir "3" devolvía la más
 *  reciente de TODAS las que tuvieran folio 3 — normalmente la del PC, no
 *  la que el cajero tenía en mente. La devolución entonces se aplicaba a
 *  una venta distinta: el stock volvía, sí, pero al producto equivocado,
 *  y parecía que "las devoluciones no devuelven el stock".
 *
 *  Eligiendo de una lista se devuelve el `id` (que sí es único de verdad),
 *  y la ambigüedad desaparece de raíz. */
export async function listarVentasRecientes(limite = 50): Promise<VentaResumen[]> {
  await exigirPermiso("devolver");
  const db = await bd();
  const filas = await db.getAllAsync<{
    id: string; folio: number; total_centavos: number; estado: string;
    creado_en: string; origen: string; articulos: number;
  }>(
    `SELECT v.id, v.folio, v.total_centavos, v.estado, v.creado_en, v.origen,
            COALESCE((SELECT SUM(vl.cantidad) FROM venta_lineas vl
                      WHERE vl.venta_id = v.id), 0) AS articulos
     FROM ventas v
     ORDER BY v.creado_en DESC
     LIMIT ?`,
    [limite]
  );
  const prefijo = await leerPrefijoFolio();
  return filas.map((f) => ({
    ...f,
    folio_etiqueta: etiquetaFolio(f.folio, prefijo, f.origen === "local"),
    devolvible: f.estado !== "devuelta_total" && f.estado !== "cancelada",
  }));
}

/** Busca una venta por folio (número) o por id (UUID), para la pantalla de
 *  devolución. El folio no es único globalmente (cada caja lleva el suyo,
 *  igual que en el PC) — con folio se toma la más reciente que coincida;
 *  con id, que sí es único de verdad, no hay ambigüedad. */
export async function buscarVenta(textoBusqueda: string): Promise<VentaDetalle | null> {
  await exigirPermiso("devolver");
  const db = await bd();
  const q = textoBusqueda.trim();
  if (!q) return null;
  const esFolio = /^\d+$/.test(q);

  const cab = esFolio
    ? await db.getFirstAsync<{
        id: string; caja_sesion_id: string; cliente_id: string | null;
        total_centavos: number; estado: string; creado_en: string; folio: number;
      }>(
        `SELECT id, caja_sesion_id, cliente_id, total_centavos, estado, creado_en, folio
         FROM ventas WHERE folio = ? ORDER BY creado_en DESC LIMIT 1`,
        [Number(q)]
      )
    : await db.getFirstAsync<{
        id: string; caja_sesion_id: string; cliente_id: string | null;
        total_centavos: number; estado: string; creado_en: string; folio: number;
      }>(
        `SELECT id, caja_sesion_id, cliente_id, total_centavos, estado, creado_en, folio
         FROM ventas WHERE id = ?`,
        [q]
      );
  if (!cab) return null;

  const metodos_pago = await db.getAllAsync<{ metodo: string; monto_centavos: number }>(
    "SELECT metodo, monto_centavos FROM pagos WHERE venta_id = ?",
    [cab.id]
  );

  const filas = await db.getAllAsync<{
    venta_linea_id: string; producto_id: string | null; nombre: string;
    cantidad_vendida: number; precio_unitario_centavos: number;
    total_linea_centavos: number; ya_devuelto: number;
  }>(
    `SELECT vl.id AS venta_linea_id, vl.producto_id, vl.nombre_producto AS nombre,
            vl.cantidad AS cantidad_vendida, vl.precio_unitario_centavos, vl.total_linea_centavos,
            COALESCE((SELECT SUM(dl.cantidad) FROM devolucion_lineas dl
                      WHERE dl.venta_linea_id = vl.id), 0) AS ya_devuelto
     FROM venta_lineas vl WHERE vl.venta_id = ?`,
    [cab.id]
  );

  const lineas: LineaVentaDetalle[] = filas.map((f) => ({
    venta_linea_id: f.venta_linea_id,
    producto_id: f.producto_id,
    nombre: f.nombre,
    cantidad_vendida: f.cantidad_vendida,
    cantidad_devuelta: f.ya_devuelto,
    cantidad_disponible: f.cantidad_vendida - f.ya_devuelto,
    precio_unitario_centavos: f.precio_unitario_centavos,
    total_linea_centavos: f.total_linea_centavos,
  }));

  return {
    id: cab.id, folio: cab.folio, caja_sesion_id: cab.caja_sesion_id,
    cliente_id: cab.cliente_id, total_centavos: cab.total_centavos,
    estado: cab.estado, creado_en: cab.creado_en, metodos_pago, lineas,
  };
}

export type MetodoReembolso = "efectivo" | "tarjeta" | "transferencia" | "credito";

export type LineaDevolver = { venta_linea_id: string; cantidad: number };

export type DevolucionEntrada = {
  venta_id: string;
  caja_sesion_id: string;
  usuario_pos_id: string;
  motivo: string | null;
  lineas: LineaDevolver[];
  // `metodo_reembolso` ya NO se pide: el dinero vuelve por donde entró, en la
  // misma proporción del cobro. Ver repartoReembolso() y el aviso de la
  // pantalla de devoluciones.
};

/** Cuánto se devuelve por cada método, en la proporción en que se cobró. */
export type ParteReembolso = { metodo: MetodoReembolso; monto_centavos: number };

export type DevolucionConfirmada = {
  id: string;
  total_devuelto_centavos: number;
  estado_venta: string;
  /** El reparto real que se aplicó, para poder mostrarlo al confirmar. */
  reparto: ParteReembolso[];
};

/** Reparte un importe entre los métodos con que se pagó una venta, en la
 *  misma proporción del cobro.
 *
 *  POR QUÉ EXISTE: el cajero elegía UN método para toda la devolución. En una
 *  venta mixta (150 tarjeta + 50 efectivo) eso permitía devolver los 200
 *  completos en efectivo: salían del cajón 150 pesos que nunca entraron por
 *  ahí, y el corte quedaba con un faltante imposible de explicar. El dinero
 *  tiene que volver por donde vino.
 *
 *  El último método absorbe el redondeo, así que la suma del reparto es
 *  SIEMPRE exactamente el total devuelto — nunca sobra ni falta un centavo. */
export function repartoReembolso(
  total: number,
  pagos: { metodo: string; monto_centavos: number }[]
): ParteReembolso[] {
  const validos = pagos.filter(
    (p) => p.monto_centavos > 0 &&
      ["efectivo", "tarjeta", "transferencia", "credito"].includes(p.metodo)
  );
  if (validos.length === 0) return [{ metodo: "efectivo", monto_centavos: total }];
  if (validos.length === 1) {
    return [{ metodo: validos[0].metodo as MetodoReembolso, monto_centavos: total }];
  }
  const sumaPagos = validos.reduce((s, p) => s + p.monto_centavos, 0);
  const partes: ParteReembolso[] = [];
  let asignado = 0;
  validos.forEach((p, i) => {
    const esUltimo = i === validos.length - 1;
    const monto = esUltimo
      ? total - asignado
      : Math.round((total * p.monto_centavos) / sumaPagos);
    asignado += monto;
    partes.push({ metodo: p.metodo as MetodoReembolso, monto_centavos: monto });
  });
  return partes.filter((p) => p.monto_centavos !== 0);
}

function fmtCant(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

/** Procesa una devolución (o cancelación) de forma atómica. Puerto exacto
 *  de devoluciones.rs::devolver() — mismas validaciones, mismo orden. */
export async function devolver(
  d: DevolucionEntrada
): Promise<DevolucionConfirmada> {
  await exigirPermiso("devolver");
  if (d.lineas.length === 0) {
    throw new Error("No se seleccionó nada para devolver.");
  }
  if (d.lineas.some((l) => l.cantidad <= 0)) {
    throw new Error("La cantidad a devolver debe ser mayor a cero.");
  }

  const db = await bd();
  const devId = uuid();
  const ts = ahoraISO();
  let totalDevuelto = 0;
  let estadoVenta = "";
  let reparto: ParteReembolso[] = [];

  await db.withTransactionAsync(async () => {
    const venta = await db.getFirstAsync<{ estado: string; cliente_id: string | null }>(
      "SELECT estado, cliente_id FROM ventas WHERE id = ?",
      [d.venta_id]
    );
    const pagosVenta = await db.getAllAsync<{ metodo: string; monto_centavos: number }>(
      "SELECT metodo, monto_centavos FROM pagos WHERE venta_id = ?",
      [d.venta_id]
    );
    if (!venta) throw new Error("No se encontró la venta.");
    if (venta.estado === "devuelta_total" || venta.estado === "cancelada") {
      throw new Error("Esta venta ya fue devuelta o cancelada por completo.");
    }

    // ¿Cuánto se cobró DE VERDAD por esta venta, frente a la suma de sus
    // líneas a precio de lista?
    //
    // BUG REAL encontrado en pruebas: el reembolso se calculaba como
    // precio_unitario × cantidad, o sea el precio de lista. Pero el canje de
    // puntos de lealtad es un descuento GLOBAL de la venta: no se reparte
    // entre las líneas. Una venta de $2.50 con $1.25 de canje se cobra en
    // $1.25 y se devolvían $2.50 — el negocio regalaba la diferencia en cada
    // devolución, y el corte cuadraba mal por ese mismo importe.
    //
    // El factor reparte el descuento global proporcionalmente entre las
    // líneas, que es lo que el cliente pagó por cada una de verdad.
    const totales = await db.getFirstAsync<{ total_venta: number; suma_lineas: number }>(
      `SELECT v.total_centavos AS total_venta,
              COALESCE((SELECT SUM(vl.total_linea_centavos) FROM venta_lineas vl
                        WHERE vl.venta_id = v.id), 0) AS suma_lineas
       FROM ventas v WHERE v.id = ?`,
      [d.venta_id]
    );
    const sumaLineas = totales?.suma_lineas ?? 0;
    const factorCobrado = sumaLineas > 0 ? (totales?.total_venta ?? 0) / sumaLineas : 1;

    // Cabecera ANTES de las líneas (misma razón que en el PC: la FK de
    // devolucion_lineas la exige). El total real se actualiza al final.
    await db.runAsync(
      `INSERT INTO devoluciones
        (id, venta_id, caja_sesion_id, usuario_pos_id, motivo,
         metodo_reembolso, total_devuelto_centavos, creado_en, actualizado_en)
       VALUES (?,?,?,?,?,?,0,?,?)`,
      [devId, d.venta_id, d.caja_sesion_id, d.usuario_pos_id, d.motivo,
       "efectivo", ts, ts]
    );

    for (const ld of d.lineas) {
      const linea = await db.getFirstAsync<{
        producto_id: string | null; nombre: string; cantidad_vendida: number;
        precio_unitario: number; total_linea: number;
        controla_stock: number; ya_devuelto: number;
      }>(
        `SELECT vl.producto_id, vl.nombre_producto AS nombre, vl.cantidad AS cantidad_vendida,
                vl.precio_unitario_centavos AS precio_unitario,
                vl.total_linea_centavos AS total_linea,
                COALESCE(p.controla_stock, 0) AS controla_stock,
                COALESCE((SELECT SUM(dl.cantidad) FROM devolucion_lineas dl
                          WHERE dl.venta_linea_id = vl.id), 0) AS ya_devuelto
         FROM venta_lineas vl
         LEFT JOIN productos p ON p.id = vl.producto_id
         WHERE vl.id = ? AND vl.venta_id = ?`,
        [ld.venta_linea_id, d.venta_id]
      );
      if (!linea) throw new Error("La línea no pertenece a la venta.");

      const disponible = linea.cantidad_vendida - linea.ya_devuelto;
      if (ld.cantidad > disponible + 1e-9) {
        throw new Error(
          `No puedes devolver ${fmtCant(ld.cantidad)} de ${linea.nombre}: solo quedan ${fmtCant(disponible)} disponibles.`
        );
      }

      // Proporción de la línea que se devuelve, ya ajustada por el
      // descuento global: nunca se reembolsa más de lo que entró a caja.
      const proporcion =
        linea.cantidad_vendida > 0 ? ld.cantidad / linea.cantidad_vendida : 0;
      const montoLinea = Math.round(linea.total_linea * proporcion * factorCobrado);
      totalDevuelto += montoLinea;

      const reingresa = linea.controla_stock !== 0 && !!linea.producto_id;
      const dlId = uuid();
      await db.runAsync(
        `INSERT INTO devolucion_lineas
          (id, devolucion_id, venta_linea_id, cantidad, monto_centavos, reingresa_stock)
         VALUES (?,?,?,?,?,?)`,
        [dlId, devId, ld.venta_linea_id, ld.cantidad, montoLinea, reingresa ? 1 : 0]
      );
      // Igual que en el PC: sin encolar la línea, el espejo de la nube
      // tendría la devolución sin detalle y otra caja no sabría QUÉ se
      // devolvió.
      await encolar("devolucion_lineas", dlId, {
        id: dlId, devolucion_id: devId, venta_linea_id: ld.venta_linea_id,
        cantidad: ld.cantidad, monto_centavos: montoLinea,
        reingresa_stock: reingresa ? 1 : 0,
      });

      if (reingresa && linea.producto_id) {
        const prod = await db.getFirstAsync<{ stock: number }>(
          "SELECT stock FROM productos WHERE id = ?",
          [linea.producto_id]
        );
        const stockAntes = prod?.stock ?? 0;
        const nuevoStock = stockAntes + ld.cantidad;
        await db.runAsync(
          "UPDATE productos SET stock = ?, actualizado_en = ? WHERE id = ?",
          [nuevoStock, ts, linea.producto_id]
        );
        // Rastro LOCAL (no se encola como entidad propia — mismo criterio
        // que inventario.ts::ajustarStock(); solo el stock resultante de
        // `productos` viaja a la nube, dos líneas abajo).
        await db.runAsync(
          `INSERT INTO ajustes_inventario (id, producto_id, stock_antes, stock_despues, motivo, creado_en)
           VALUES (?,?,?,?,?,?)`,
          [uuid(), linea.producto_id, stockAntes, nuevoStock, `Devolución #${devId.slice(0, 8)}`, ts]
        );
        await encolar("productos", linea.producto_id, {
          id: linea.producto_id, stock: nuevoStock, actualizado_en: ts,
        }, "update");
      }
    }

    // ---------------------------------------------------------------
    // Reparto del reembolso: el dinero vuelve por donde entró.
    // ---------------------------------------------------------------
    // Se crea UNA fila de devolución por método, cada una con su parte. Es
    // lo que permite hacer esto sin tocar el esquema: cada fila conserva un
    // solo `metodo_reembolso`, así que el corte (que suma las de efectivo)
    // y el espejo de la nube siguen funcionando igual que siempre.
    //
    // Las LÍNEAS se quedan todas en la primera devolución: el stock ya se
    // repuso una vez en el bucle de arriba, y duplicarlas aquí lo repondría
    // dos veces.
    reparto = repartoReembolso(totalDevuelto, pagosVenta);

    const principal = reparto[0];
    await db.runAsync(
      "UPDATE devoluciones SET total_devuelto_centavos = ?, metodo_reembolso = ? WHERE id = ?",
      [principal.monto_centavos, principal.metodo, devId]
    );
    await encolar("devoluciones", devId, {
      id: devId, venta_id: d.venta_id, caja_sesion_id: d.caja_sesion_id,
      usuario_pos_id: d.usuario_pos_id, motivo: d.motivo,
      metodo_reembolso: principal.metodo,
      total_devuelto_centavos: principal.monto_centavos,
      creado_en: ts, actualizado_en: ts,
    });

    for (const parte of reparto.slice(1)) {
      const otroId = uuid();
      await db.runAsync(
        `INSERT INTO devoluciones
          (id, venta_id, caja_sesion_id, usuario_pos_id, motivo,
           metodo_reembolso, total_devuelto_centavos, creado_en, actualizado_en)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [otroId, d.venta_id, d.caja_sesion_id, d.usuario_pos_id, d.motivo,
         parte.metodo, parte.monto_centavos, ts, ts]
      );
      await encolar("devoluciones", otroId, {
        id: otroId, venta_id: d.venta_id, caja_sesion_id: d.caja_sesion_id,
        usuario_pos_id: d.usuario_pos_id, motivo: d.motivo,
        metodo_reembolso: parte.metodo,
        total_devuelto_centavos: parte.monto_centavos,
        creado_en: ts, actualizado_en: ts,
      });
    }

    // La parte que corresponde a crédito se abona a la cuenta del cliente.
    // El efectivo lo descuenta el corte solo (lee las devoluciones de
    // efectivo); tarjeta y transferencia no tocan el cajón físico.
    const parteCredito = reparto.find((p) => p.metodo === "credito");
    if (parteCredito && parteCredito.monto_centavos > 0) {
      if (!venta.cliente_id) {
        throw new Error("La venta no tiene cliente para abonar el crédito.");
      }
      const cliente = await db.getFirstAsync<{ saldo_centavos: number }>(
        "SELECT saldo_centavos FROM clientes WHERE id = ?",
        [venta.cliente_id]
      );
      const saldo = cliente?.saldo_centavos ?? 0;
      const baja = Math.min(parteCredito.monto_centavos, saldo);
      const nuevoSaldo = saldo - baja;
      await db.runAsync(
        "UPDATE clientes SET saldo_centavos = ?, actualizado_en = ? WHERE id = ?",
        [nuevoSaldo, ts, venta.cliente_id]
      );
      const movId = uuid();
      const nota = `Devolución #${devId.slice(0, 8)}`;
      await db.runAsync(
        `INSERT INTO movimientos_cuenta
          (id, cliente_id, tipo, monto_centavos, venta_id, metodo, saldo_resultante_centavos,
           motivo, usuario_pos_id, caja_sesion_id, creado_en, actualizado_en)
         VALUES (?,?,'abono',?,?,NULL,?,?,?,?,?,?)`,
        [movId, venta.cliente_id, baja, d.venta_id, nuevoSaldo, nota,
         d.usuario_pos_id, d.caja_sesion_id, ts, ts]
      );
      await encolar("clientes", venta.cliente_id, {
        id: venta.cliente_id, saldo_centavos: nuevoSaldo, actualizado_en: ts,
      }, "update");
      await encolar("movimientos_cuenta", movId, {
        id: movId, cliente_id: venta.cliente_id, tipo: "abono",
        monto_centavos: baja, venta_id: d.venta_id, metodo: null,
        saldo_resultante_centavos: nuevoSaldo, motivo: nota,
        usuario_pos_id: d.usuario_pos_id, caja_sesion_id: d.caja_sesion_id,
        creado_en: ts, actualizado_en: ts,
      });
    }

    // ¿Quedó algo sin devolver?
    const pendiente = await db.getFirstAsync<{ p: number }>(
      `SELECT COALESCE(SUM(vl.cantidad),0) - COALESCE((
                 SELECT SUM(dl.cantidad) FROM devolucion_lineas dl
                 JOIN venta_lineas v2 ON dl.venta_linea_id = v2.id
                 WHERE v2.venta_id = ?), 0) AS p
       FROM venta_lineas vl WHERE vl.venta_id = ?`,
      [d.venta_id, d.venta_id]
    );
    const esCancelacion = d.motivo === "Cancelación";
    const nuevoEstado =
      (pendiente?.p ?? 0) <= 1e-9
        ? (esCancelacion ? "cancelada" : "devuelta_total")
        : "devuelta_parcial";
    estadoVenta = nuevoEstado;

    await db.runAsync(
      "UPDATE ventas SET estado = ?, actualizado_en = ? WHERE id = ?",
      [nuevoEstado, ts, d.venta_id]
    );

    // -----------------------------------------------------------------------
    // PUNTOS DE LEALTAD — deshacer lo que hizo el cobro
    // -----------------------------------------------------------------------
    //
    // Al cancelar, la venta deja de existir a todos los efectos. Sus puntos
    // también tienen que deshacerse: los que el cliente GANÓ con esa compra
    // (que ya no hizo) y los que CANJEÓ en ella (que pagó por un descuento
    // que se le acaba de devolver en dinero). Sin esto, cancelar una venta con
    // canje le costaba los puntos al cliente Y le devolvía el descuento al
    // negocio: el cliente pagaba dos veces.
    //
    // Se hace con UNA cuenta: el neto de todos los movimientos de esa venta.
    // Si ganó 12 y canjeó 50, el neto es −38 y hay que devolver 38.
    //
    // ---------------------------------------------------------------------
    // POR QUÉ ES SEGURO — las cuatro decisiones que lo hacen inofensivo
    // ---------------------------------------------------------------------
    // 1. TRY/CATCH PROPIO. Si cualquier cosa aquí falla, se traga y la
    //    cancelación sigue. El peor caso es exactamente el comportamiento
    //    anterior (los puntos no vuelven); nunca puede impedir que una venta
    //    se cancele, que es lo único que no se puede romper.
    //
    // 2. SQL EN LÍNEA, no canjearPuntos() ni acumularPorVenta(). Las dos
    //    abren su propia withTransactionAsync y esto ya está DENTRO de una:
    //    anidar transacciones en expo-sqlite reventaría la cancelación
    //    entera. También evita un import circular con lealtad.ts.
    //
    // 3. IDEMPOTENTE POR CONSTRUCCIÓN. La cuenta suma TODOS los movimientos
    //    de la venta, incluida la propia reversión. Después de revertir, el
    //    neto es 0 y una segunda pasada no hace nada. No hace falta una
    //    marca de "ya revertido" que alguien pueda olvidar.
    //
    // 4. TIPOS EXISTENTES ('compra' / 'canje'), no uno nuevo. Un tipo
    //    inventado podría no estar declarado en el MAPA del servidor ni
    //    contemplado por la pantalla que pinta el historial. La nota explica
    //    lo que pasó; el tipo se queda en terreno conocido.
    //
    // Solo en CANCELACIÓN. Una devolución total ('devuelta_total') deja los
    // puntos como están a propósito: es una decisión de negocio distinta
    // (¿premias la compra aunque la mercancía volviera?) y no se toma aquí.
    if (nuevoEstado === "cancelada" && venta.cliente_id) {
      try {
        const neto = await db.getFirstAsync<{ n: number }>(
          "SELECT COALESCE(SUM(puntos),0) AS n FROM puntos_movimientos WHERE venta_id = ?",
          [d.venta_id]
        );
        const saldoNeto = neto?.n ?? 0;
        if (saldoNeto !== 0) {
          const cli = await db.getFirstAsync<{ puntos: number }>(
            "SELECT puntos FROM clientes WHERE id = ?",
            [venta.cliente_id]
          );
          const puntosActuales = cli?.puntos ?? 0;
          // Al QUITAR puntos (neto positivo: los había ganado), nunca se baja
          // de cero. Si ya los gastó en otra compra, se quita lo que quede:
          // un saldo negativo rompería el canje de todas las ventas
          // siguientes con un error de "no alcanza".
          const ajuste =
            saldoNeto > 0 ? -Math.min(saldoNeto, puntosActuales) : -saldoNeto;

          if (ajuste !== 0) {
            const movId = uuid();
            const nota =
              ajuste > 0
                ? "Puntos devueltos por cancelación de la venta"
                : "Puntos retirados por cancelación de la venta";
            await db.runAsync(
              `INSERT INTO puntos_movimientos (id, cliente_id, venta_id, tipo, puntos, nota, creado_en)
               VALUES (?,?,?,?,?,?,?)`,
              [
                movId,
                venta.cliente_id,
                d.venta_id,
                ajuste > 0 ? "compra" : "canje",
                ajuste,
                nota,
                ts,
              ]
            );
            await db.runAsync(
              "UPDATE clientes SET puntos = puntos + ?, actualizado_en = ? WHERE id = ?",
              [ajuste, ts, venta.cliente_id]
            );
            // Se encola SOLO el movimiento, nunca la fila de `clientes`.
            // Es exactamente lo que hacen acumularPorVenta() y
            // canjearPuntos(): el saldo del cliente lo reconstruye el
            // servidor a partir de los movimientos. Mandar aquí una
            // combinación de columnas que nunca se ha mandado sería
            // estrenar un camino de sincronización en el sitio equivocado.
            await encolar("puntos_movimientos", movId, {
              id: movId,
              cliente_id: venta.cliente_id,
              venta_id: d.venta_id,
              tipo: ajuste > 0 ? "compra" : "canje",
              puntos: ajuste,
              nota,
              creado_en: ts,
              actualizado_en: ts,
            });
          }
        }
      } catch {
        // Los puntos no se pudieron revertir. La cancelación es lo
        // importante y continúa: quedan como estaban antes de este cambio.
      }
    }

    // (Las devoluciones ya se encolaron una por una arriba, cada una con su
    // método y su parte del reparto.)
    await encolar("ventas", d.venta_id, {
      id: d.venta_id, estado: nuevoEstado, actualizado_en: ts,
    }, "update");
  });

  return {
    id: devId,
    total_devuelto_centavos: totalDevuelto,
    estado_venta: estadoVenta,
    reparto,
  };
}
