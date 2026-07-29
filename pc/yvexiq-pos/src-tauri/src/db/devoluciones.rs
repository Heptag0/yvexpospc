//! Devoluciones y cancelaciones (`devoluciones`, `devolucion_lineas`).
//!
//! Invariantes del plano (references/modulos.md → Devoluciones):
//!   - ⚠️ No se puede devolver más cantidad de la vendida menos lo ya devuelto.
//!   - ⚠️ Devolución que reingresa stock genera el ajuste vía la devolución.
//!   - La venta original cambia estado a devuelta_parcial/devuelta_total; nunca se borra.
//!   - Reembolso según cómo se pagó: efectivo → salida de caja; tarjeta →
//!     contrapartida (no toca cajón); crédito → baja la deuda del cliente.
//!   - Cancelación = devolución total con motivo "cancelación".
//!
//! Permisos: dueño/gerente devuelven cualquier venta; cajero solo de su sesión
//! abierta (se valida en la capa de comando con el rol y la sesión).

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::comun::{ahora, encolar_sync, nuevo_id};

/// Una línea de la venta, con cuánto se vendió y cuánto ya se devolvió.
#[derive(Debug, Serialize)]
pub struct LineaVentaDetalle {
    pub venta_linea_id: String,
    pub producto_id: String,
    pub descripcion: String,
    pub cantidad_vendida: f64,
    pub cantidad_devuelta: f64, // ya devuelto en devoluciones previas
    pub cantidad_disponible: f64, // vendida - devuelta
    pub precio_unitario_centavos: i64,
    pub total_linea_centavos: i64,
    pub unidad: String,
}

/// Detalle de una venta para la pantalla de devolución.
#[derive(Debug, Serialize)]
pub struct VentaDetalle {
    pub id: String,
    pub folio: i64,
    pub caja_sesion_id: String,
    pub cliente_id: Option<String>,
    pub total_centavos: i64,
    pub estado: String,
    pub creado_en: String,
    pub metodos_pago: Vec<(String, i64)>, // (metodo, monto) de los pagos
    pub lineas: Vec<LineaVentaDetalle>,
}

/// Busca una venta y arma su detalle, por `venta_id` (preferido, único
/// global) o por `folio` (respaldo: la más reciente con ese folio, de
/// cualquier caja — el folio solo es único por dispositivo).
pub fn buscar_venta(
    con: &Connection,
    folio: Option<i64>,
    venta_id: Option<&str>,
) -> Result<Option<VentaDetalle>, String> {
    let cab: Option<(String, String, Option<String>, i64, String, String, i64)> =
        if let Some(vid) = venta_id {
            con.query_row(
                "SELECT id, caja_sesion_id, cliente_id, total_centavos, estado, creado_en, folio
                 FROM ventas WHERE id=?1",
                rusqlite::params![vid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
            )
            .optional()
        } else if let Some(f) = folio {
            con.query_row(
                "SELECT id, caja_sesion_id, cliente_id, total_centavos, estado, creado_en, folio
                 FROM ventas WHERE folio=?1 ORDER BY creado_en DESC LIMIT 1",
                rusqlite::params![f],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
            )
            .optional()
        } else {
            Ok(None)
        }
        .map_err(|e| format!("error al buscar venta: {e}"))?;

    let (venta_id, caja_sesion_id, cliente_id, total, estado, creado_en, folio_real) = match cab {
        Some(v) => v,
        None => return Ok(None),
    };

    // Pagos de la venta (para saber cómo reembolsar).
    let mut stmt = con
        .prepare("SELECT metodo, monto_centavos FROM pagos WHERE venta_id=?1")
        .map_err(|e| format!("error al preparar pagos: {e}"))?;
    let metodos_pago: Vec<(String, i64)> = stmt
        .query_map(rusqlite::params![venta_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| format!("error al leer pagos: {e}"))?
        .collect::<Result<_, _>>()
        .map_err(|e| format!("error pagos: {e}"))?;

    // Líneas con lo ya devuelto.
    let mut stmt2 = con
        .prepare(
            "SELECT vl.id, vl.producto_id, vl.descripcion, vl.cantidad,
                    vl.precio_unitario_centavos, vl.total_linea_centavos,
                    COALESCE(p.unidad, 'pieza') AS unidad,
                    COALESCE((SELECT SUM(dl.cantidad) FROM devolucion_lineas dl
                              WHERE dl.venta_linea_id = vl.id), 0) AS ya_devuelto
             FROM venta_lineas vl
             LEFT JOIN productos p ON p.id = vl.producto_id
             WHERE vl.venta_id = ?1",
        )
        .map_err(|e| format!("error al preparar líneas: {e}"))?;

    let lineas: Vec<LineaVentaDetalle> = stmt2
        .query_map(rusqlite::params![venta_id], |r| {
            let vendida: f64 = r.get(3)?;
            let devuelta: f64 = r.get(7)?;
            Ok(LineaVentaDetalle {
                venta_linea_id: r.get(0)?,
                producto_id: r.get(1)?,
                descripcion: r.get(2)?,
                cantidad_vendida: vendida,
                cantidad_devuelta: devuelta,
                cantidad_disponible: vendida - devuelta,
                precio_unitario_centavos: r.get(4)?,
                total_linea_centavos: r.get(5)?,
                unidad: r.get(6)?,
            })
        })
        .map_err(|e| format!("error al leer líneas: {e}"))?
        .collect::<Result<_, _>>()
        .map_err(|e| format!("error líneas: {e}"))?;

    Ok(Some(VentaDetalle {
        id: venta_id,
        folio: folio_real,
        caja_sesion_id,
        cliente_id,
        total_centavos: total,
        estado,
        creado_en,
        metodos_pago,
        lineas,
    }))
}

/// Una línea a devolver: cuál y cuánto.
#[derive(Debug, Deserialize)]
pub struct LineaDevolver {
    pub venta_linea_id: String,
    pub cantidad: f64,
}

#[derive(Debug, Deserialize)]
pub struct DevolucionEntrada {
    pub venta_id: String,
    pub caja_sesion_id: String, // sesión ACTUAL (donde se procesa el reembolso)
    pub usuario_pos_id: String,
    pub motivo: Option<String>,
    pub lineas: Vec<LineaDevolver>,
    /// Método de reembolso: 'efectivo' | 'tarjeta' | 'transferencia' | 'credito'.
    /// Para crédito, baja la deuda del cliente en vez de dar dinero.
    pub metodo_reembolso: String,
}

#[derive(Debug, Serialize)]
pub struct DevolucionConfirmada {
    pub id: String,
    pub total_devuelto_centavos: i64,
    pub estado_venta: String,
}

/// Procesa una devolución (o cancelación) de forma atómica.
pub fn devolver(
    con: &mut Connection,
    dispositivo_id: &str,
    d: DevolucionEntrada,
) -> Result<DevolucionConfirmada, String> {
    if d.lineas.is_empty() {
        return Err("No se seleccionó nada para devolver.".into());
    }

    let tx = con.transaction().map_err(|e| format!("no se pudo abrir transacción: {e}"))?;

    // Estado y cliente de la venta.
    let (estado_actual, cliente_id): (String, Option<String>) = tx
        .query_row(
            "SELECT estado, cliente_id FROM ventas WHERE id=?1",
            rusqlite::params![d.venta_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| format!("error al leer venta: {e}"))?
        .ok_or_else(|| "No se encontró la venta.".to_string())?;

    if estado_actual == "devuelta_total" || estado_actual == "cancelada" {
        return Err("Esta venta ya fue devuelta o cancelada por completo.".into());
    }

    let dev_id = nuevo_id();
    let ts = ahora();
    let mut total_devuelto: i64 = 0;

    // Insertar la cabecera ANTES de las líneas (la FK devolucion_lineas ->
    // devoluciones lo exige). El total se actualiza al final con el real.
    tx.execute(
        "INSERT INTO devoluciones
           (id, venta_id, caja_sesion_id, usuario_pos_id, motivo, total_devuelto_centavos,
            metodo_reembolso, creado_en, actualizado_en, sincronizado)
         VALUES (?1,?2,?3,?4,?5,0,?6,?7,?7,0)",
        rusqlite::params![dev_id, d.venta_id, d.caja_sesion_id, d.usuario_pos_id, d.motivo, d.metodo_reembolso, ts],
    )
    .map_err(|e| format!("error al crear devolución: {e}"))?;

    // Procesar cada línea.
    for ld in &d.lineas {
        if ld.cantidad <= 0.0 {
            return Err("La cantidad a devolver debe ser mayor a cero.".into());
        }
        // Datos de la línea + lo ya devuelto.
        let (producto_id, descripcion, cantidad_vendida, precio_unit, controla_stock, ya_devuelto): (
            String, String, f64, i64, i64, f64,
        ) = tx
            .query_row(
                "SELECT vl.producto_id, vl.descripcion, vl.cantidad, vl.precio_unitario_centavos,
                        COALESCE(p.controla_stock, 0),
                        COALESCE((SELECT SUM(dl.cantidad) FROM devolucion_lineas dl
                                  WHERE dl.venta_linea_id = vl.id), 0)
                 FROM venta_lineas vl
                 LEFT JOIN productos p ON p.id = vl.producto_id
                 WHERE vl.id = ?1 AND vl.venta_id = ?2",
                rusqlite::params![ld.venta_linea_id, d.venta_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            )
            .optional()
            .map_err(|e| format!("error al leer línea: {e}"))?
            .ok_or_else(|| "La línea no pertenece a la venta.".to_string())?;

        let disponible = cantidad_vendida - ya_devuelto;
        if ld.cantidad > disponible + 1e-9 {
            return Err(format!(
                "No puedes devolver {} de {}: solo quedan {} disponibles.",
                fmt_cant(ld.cantidad), descripcion, fmt_cant(disponible)
            ));
        }

        // Monto de esta línea devuelta (proporcional al precio unitario).
        let monto_linea = (precio_unit as f64 * ld.cantidad).round() as i64;
        total_devuelto += monto_linea;

        // Insertar la línea de devolución. reingresa_stock = 1 (siempre, por ahora).
        let reingresa = controla_stock != 0;
        let dl_id = nuevo_id();
        tx.execute(
            "INSERT INTO devolucion_lineas
               (id, devolucion_id, venta_linea_id, cantidad, monto_centavos, reingresa_stock)
             VALUES (?1,?2,?3,?4,?5,?6)",
            rusqlite::params![dl_id, dev_id, ld.venta_linea_id, ld.cantidad, monto_linea, reingresa as i64],
        )
        .map_err(|e| format!("error al crear línea de devolución: {e}"))?;

        // Encolar la línea: sin esto el espejo de la nube tenía la devolución
        // sin detalle, y otra caja no podría saber QUÉ se devolvió.
        let payload_dl = serde_json::json!({
            "id": dl_id, "devolucion_id": dev_id, "venta_linea_id": ld.venta_linea_id,
            "cantidad": ld.cantidad, "monto_centavos": monto_linea,
            "reingresa_stock": reingresa as i64,
        });
        encolar_sync(&tx, "devolucion_lineas", &dl_id, "insert", &payload_dl)
            .map_err(|e| format!("error al encolar línea de devolución: {e}"))?;

        // Reingresar stock (vía la devolución, con su ajuste para auditoría).
        if reingresa {
            let stock_actual: f64 = tx
                .query_row(
                    "SELECT stock FROM productos WHERE id=?1",
                    rusqlite::params![producto_id],
                    |r| r.get(0),
                )
                .map_err(|e| format!("error al leer stock: {e}"))?;
            let nuevo_stock = stock_actual + ld.cantidad;
            tx.execute(
                "UPDATE productos SET stock=?2, actualizado_en=?3 WHERE id=?1",
                rusqlite::params![producto_id, nuevo_stock, ts],
            )
            .map_err(|e| format!("error al reingresar stock: {e}"))?;

            // Ajuste de inventario tipo 'entrada' con motivo devolución (rastro).
            let aj_id = nuevo_id();
            tx.execute(
                "INSERT INTO ajustes_inventario
                   (id, producto_id, tipo, cantidad, stock_resultante, motivo, usuario_pos_id,
                    creado_en, actualizado_en, sincronizado, dispositivo_id)
                 VALUES (?1,?2,'entrada',?3,?4,?5,?6,?7,?7,0,?8)",
                rusqlite::params![
                    aj_id, producto_id, ld.cantidad, nuevo_stock,
                    format!("Devolución #{}", &dev_id[..8]), d.usuario_pos_id, ts, dispositivo_id
                ],
            )
            .map_err(|e| format!("error al registrar ajuste de devolución: {e}"))?;

            let payload_prod = serde_json::json!({ "id": producto_id, "stock": nuevo_stock, "actualizado_en": ts });
            encolar_sync(&tx, "productos", &producto_id, "update", &payload_prod)
                .map_err(|e| format!("error al encolar stock: {e}"))?;
        }
    }

    // Actualizar el total real de la devolución (se insertó en 0 por la FK).
    tx.execute(
        "UPDATE devoluciones SET total_devuelto_centavos=?2 WHERE id=?1",
        rusqlite::params![dev_id, total_devuelto],
    )
    .map_err(|e| format!("error al actualizar total de devolución: {e}"))?;

    // Reembolso según método.
    match d.metodo_reembolso.as_str() {
        "efectivo" => {
            // La devolución en efectivo SÍ baja el efectivo del cajón, pero NO se
            // registra como salida de caja: el corte la calcula directamente de
            // la tabla `devoluciones` (renglón "Devoluciones de producto"),
            // separada de las salidas normales (retiros, pagos a proveedor).
        }
        "tarjeta" | "transferencia" => {
            // Contrapartida: no toca el cajón físico. Queda registrada en la
            // devolución; el corte de tarjeta/transferencia lo refleja aparte.
        }
        "credito" => {
            // Baja la deuda del cliente (en vez de dar dinero).
            let cid = cliente_id
                .as_deref()
                .ok_or_else(|| "La venta no tiene cliente para abonar el crédito.".to_string())?;
            let saldo: i64 = tx
                .query_row(
                    "SELECT saldo_centavos FROM clientes WHERE id=?1",
                    rusqlite::params![cid],
                    |r| r.get(0),
                )
                .map_err(|e| format!("error al leer saldo: {e}"))?;
            // No bajar más de lo que debe.
            let baja = total_devuelto.min(saldo);
            let nuevo_saldo = saldo - baja;
            tx.execute(
                "UPDATE clientes SET saldo_centavos=?2, actualizado_en=?3 WHERE id=?1",
                rusqlite::params![cid, nuevo_saldo, ts],
            )
            .map_err(|e| format!("error al ajustar deuda: {e}"))?;

            let mov_id = nuevo_id();
            tx.execute(
                "INSERT INTO movimientos_cuenta
                   (id, cliente_id, tipo, monto_centavos, venta_id, metodo, saldo_resultante_centavos,
                    motivo, usuario_pos_id, caja_sesion_id, creado_en, actualizado_en, sincronizado, dispositivo_id)
                 VALUES (?1,?2,'abono',?3,?4,NULL,?5,?6,?7,?8,?9,?9,0,?10)",
                rusqlite::params![
                    mov_id, cid, baja, d.venta_id, nuevo_saldo,
                    format!("Devolución #{}", &dev_id[..8]), d.usuario_pos_id, d.caja_sesion_id, ts, dispositivo_id
                ],
            )
            .map_err(|e| format!("error al registrar abono por devolución: {e}"))?;

            let payload_cli = serde_json::json!({ "id": cid, "saldo_centavos": nuevo_saldo, "actualizado_en": ts });
            encolar_sync(&tx, "clientes", cid, "update", &payload_cli)
                .map_err(|e| format!("error al encolar cliente: {e}"))?;
        }
        otro => return Err(format!("Método de reembolso inválido: {otro}")),
    }

    // Recalcular estado de la venta: ¿quedó algo sin devolver?
    let pendiente: f64 = tx
        .query_row(
            "SELECT COALESCE(SUM(vl.cantidad),0) - COALESCE((
                       SELECT SUM(dl.cantidad) FROM devolucion_lineas dl
                       JOIN venta_lineas v2 ON dl.venta_linea_id = v2.id
                       WHERE v2.venta_id = ?1), 0)
             FROM venta_lineas vl WHERE vl.venta_id = ?1",
            rusqlite::params![d.venta_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("error al calcular pendiente: {e}"))?;

    let es_cancelacion = d.motivo.as_deref() == Some("Cancelación");
    let nuevo_estado = if pendiente <= 1e-9 {
        if es_cancelacion { "cancelada" } else { "devuelta_total" }
    } else {
        "devuelta_parcial"
    };
    tx.execute(
        "UPDATE ventas SET estado=?2, actualizado_en=?3 WHERE id=?1",
        rusqlite::params![d.venta_id, nuevo_estado, ts],
    )
    .map_err(|e| format!("error al actualizar estado de venta: {e}"))?;

    // Encolar devolución y venta.
    let payload_dev = serde_json::json!({
        "id": dev_id, "venta_id": d.venta_id, "caja_sesion_id": d.caja_sesion_id,
        "usuario_pos_id": d.usuario_pos_id, "motivo": d.motivo,
        "total_devuelto_centavos": total_devuelto, "creado_en": ts, "actualizado_en": ts,
    });
    encolar_sync(&tx, "devoluciones", &dev_id, "insert", &payload_dev)
        .map_err(|e| format!("error al encolar devolución: {e}"))?;
    let payload_venta = serde_json::json!({ "id": d.venta_id, "estado": nuevo_estado, "actualizado_en": ts });
    encolar_sync(&tx, "ventas", &d.venta_id, "update", &payload_venta)
        .map_err(|e| format!("error al encolar venta: {e}"))?;

    tx.commit().map_err(|e| format!("error al confirmar devolución: {e}"))?;

    Ok(DevolucionConfirmada {
        id: dev_id,
        total_devuelto_centavos: total_devuelto,
        estado_venta: nuevo_estado.to_string(),
    })
}

/// Resumen de una venta para la lista de tickets del día.
#[derive(Debug, Serialize)]
pub struct VentaResumen {
    pub id: String,
    pub folio: i64,
    pub caja_sesion_id: String,
    pub total_centavos: i64,
    pub estado: String,
    pub creado_en: String,
    pub num_articulos: f64,
    /// Quién cobró (nombre real del cajero; "Otra caja" si aún no ha llegado
    /// el nombre por sync).
    pub cajero: String,
    /// "esta" = la cobró esta caja; "otra" = bajó de otra caja por sync.
    /// El frontend lo usa para etiquetar el origen y no confundir al dueño.
    pub origen: String,
}

/// Lista las ventas del día (creadas hoy) del NEGOCIO COMPLETO (todas las
/// cajas: las que bajan por sync ya viven aquí), etiquetando cuáles son de
/// esta caja (`dispositivo_id`) y quién las cobró. Si `solo_sesion` es Some,
/// filtra a esa sesión (para el cajero, que solo toca lo de su turno).
/// Más reciente primero.
pub fn ventas_del_dia(
    con: &Connection,
    dispositivo_id: &str,
    solo_sesion: Option<&str>,
) -> Result<Vec<VentaResumen>, String> {
    // "Hoy" según fecha local del cliente se complica con UTC; usamos las
    // ventas de las últimas 24h por creado_en, que para un turno diario basta.
    // Mejor aún: filtrar por fecha (YYYY-MM-DD) del creado_en comparado con now.
    let mut sql = String::from(
        "SELECT v.id, v.folio, v.caja_sesion_id, v.total_centavos, v.estado, v.creado_en,
                COALESCE((SELECT SUM(vl.cantidad) FROM venta_lineas vl WHERE vl.venta_id = v.id), 0),
                COALESCE(u.nombre, 'Otra caja'),
                CASE WHEN v.dispositivo_id = ?1 THEN 'esta' ELSE 'otra' END
         FROM ventas v
         LEFT JOIN usuarios_pos u ON u.id = v.usuario_pos_id
         WHERE date(v.creado_en) = date('now')",
    );
    if solo_sesion.is_some() {
        sql.push_str(" AND v.caja_sesion_id = ?2");
    }
    sql.push_str(" ORDER BY v.creado_en DESC");

    let mut stmt = con.prepare(&sql).map_err(|e| format!("error al preparar ventas del día: {e}"))?;
    let mapper = |r: &rusqlite::Row| {
        Ok(VentaResumen {
            id: r.get(0)?,
            folio: r.get(1)?,
            caja_sesion_id: r.get(2)?,
            total_centavos: r.get(3)?,
            estado: r.get(4)?,
            creado_en: r.get(5)?,
            num_articulos: r.get(6)?,
            cajero: r.get(7)?,
            origen: r.get(8)?,
        })
    };
    let filas = if let Some(s) = solo_sesion {
        stmt.query_map(rusqlite::params![dispositivo_id, s], mapper)
    } else {
        stmt.query_map(rusqlite::params![dispositivo_id], mapper)
    }
    .map_err(|e| format!("error al listar ventas del día: {e}"))?;

    let mut out = Vec::new();
    for f in filas {
        out.push(f.map_err(|e| format!("error al leer venta: {e}"))?);
    }
    Ok(out)
}

fn fmt_cant(n: f64) -> String {
    if (n.fract()).abs() < 1e-9 {
        format!("{}", n as i64)
    } else {
        format!("{:.3}", n)
    }
}
