//! Reportes (solo lectura). Métricas agregadas para el dueño/gerente.
//!
//! Toda la ganancia/margen usa el costo HISTÓRICO guardado en venta_lineas
//! (costo_unitario_centavos) para ser fiel a la realidad. Ventas previas a la
//! migración 004 tienen costo 0 y se reportan como "sin costo registrado".
//!
//! Filtra siempre por ventas no canceladas. El rango de fechas se recibe como
//! ISO (inicio y fin), calculado en el frontend según el periodo elegido.
//!
//! NOTA (sincronización): los reportes son del NEGOCIO COMPLETO. Las ventas
//! que bajan de otras cajas (móvil, otra PC) ya viven en la base local y
//! cuentan igual que las propias; excluirlas daría números a medias.
//! (El corte de caja es la excepción: ese sí es por turno, porque el
//! efectivo es físico de cada caja.)

use rusqlite::Connection;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct MetricasGenerales {
    pub total_vendido_centavos: i64,
    pub num_ventas: i64,
    pub venta_promedio_centavos: i64,
    pub ganancia_centavos: i64,
    pub margen_promedio_pct: f64,
    pub costo_total_centavos: i64,
    pub articulos_vendidos: f64,
}

#[derive(Debug, Serialize)]
pub struct ParMetodo {
    pub metodo: String,
    pub monto_centavos: i64,
    pub num: i64,
}

#[derive(Debug, Serialize)]
pub struct FilaCategoria {
    pub categoria: String,
    pub vendido_centavos: i64,
    pub ganancia_centavos: i64,
    pub articulos: f64,
}

#[derive(Debug, Serialize)]
pub struct FilaProducto {
    pub nombre: String,
    pub cantidad: f64,
    pub vendido_centavos: i64,
    pub ganancia_centavos: i64,
}

#[derive(Debug, Serialize)]
pub struct PuntoTiempo {
    pub etiqueta: String, // fecha YYYY-MM-DD o hora 00-23
    pub vendido_centavos: i64,
    pub num_ventas: i64,
}

#[derive(Debug, Serialize)]
pub struct ReporteCompleto {
    pub metricas: MetricasGenerales,
    pub por_metodo: Vec<ParMetodo>,
    pub por_categoria: Vec<FilaCategoria>,
    pub productos_top: Vec<FilaProducto>,
    pub por_dia: Vec<PuntoTiempo>,
    pub por_hora: Vec<PuntoTiempo>,
}

/// Genera el reporte completo para un rango [inicio, fin] (ISO-8601 UTC).
/// Cuenta las ventas de TODAS las cajas del negocio (ver nota de arriba).
pub fn generar(
    con: &Connection,
    inicio: &str,
    fin: &str,
) -> Result<ReporteCompleto, String> {
    let metricas = metricas_generales(con, inicio, fin)?;
    let por_metodo = por_metodo(con, inicio, fin)?;
    let por_categoria = por_categoria(con, inicio, fin)?;
    let productos_top = productos_top(con, inicio, fin)?;
    let por_dia = por_dia(con, inicio, fin)?;
    let por_hora = por_hora(con, inicio, fin)?;
    Ok(ReporteCompleto {
        metricas,
        por_metodo,
        por_categoria,
        productos_top,
        por_dia,
        por_hora,
    })
}

fn metricas_generales(
    con: &Connection,
    inicio: &str,
    fin: &str,
) -> Result<MetricasGenerales, String> {
    // Total e ingresos.
    let (total, num): (i64, i64) = con
        .query_row(
            "SELECT COALESCE(SUM(total_centavos),0), COUNT(*)
             FROM ventas
             WHERE estado != 'cancelada'
               AND creado_en >= ?1 AND creado_en <= ?2",
            rusqlite::params![inicio, fin],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| format!("error métricas: {e}"))?;

    // Ganancia y costo desde las líneas (costo histórico).
    // OJO: cantidad es REAL (granel), así que costo*cantidad sale decimal.
    // Leemos como f64 y redondeamos a centavos enteros.
    let (ingreso_lineas, costo_total_f, articulos): (i64, f64, f64) = con
        .query_row(
            "SELECT
               COALESCE(SUM(vl.total_linea_centavos),0),
               COALESCE(SUM(vl.costo_unitario_centavos * vl.cantidad),0),
               COALESCE(SUM(vl.cantidad),0)
             FROM venta_lineas vl
             JOIN ventas v ON vl.venta_id = v.id
             WHERE v.estado != 'cancelada'
               AND v.creado_en >= ?1 AND v.creado_en <= ?2",
            rusqlite::params![inicio, fin],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| format!("error ganancia: {e}"))?;
    let costo_total = costo_total_f.round() as i64;

    let ganancia = ingreso_lineas - costo_total;
    let venta_promedio = if num > 0 { total / num } else { 0 };
    // Margen sobre ingreso de líneas (no sobre total con descuento global, para
    // que sea margen de producto). Si no hay ingreso, 0.
    let margen = if ingreso_lineas > 0 {
        (ganancia as f64 / ingreso_lineas as f64) * 100.0
    } else {
        0.0
    };

    Ok(MetricasGenerales {
        total_vendido_centavos: total,
        num_ventas: num,
        venta_promedio_centavos: venta_promedio,
        ganancia_centavos: ganancia,
        margen_promedio_pct: (margen * 10.0).round() / 10.0,
        costo_total_centavos: costo_total,
        articulos_vendidos: articulos,
    })
}

fn por_metodo(con: &Connection, inicio: &str, fin: &str) -> Result<Vec<ParMetodo>, String> {
    let mut stmt = con
        .prepare(
            "SELECT p.metodo, COALESCE(SUM(p.monto_centavos),0), COUNT(DISTINCT p.venta_id)
             FROM pagos p JOIN ventas v ON p.venta_id = v.id
             WHERE v.estado != 'cancelada'
               AND v.creado_en >= ?1 AND v.creado_en <= ?2
             GROUP BY p.metodo
             ORDER BY 2 DESC",
        )
        .map_err(|e| format!("error por_metodo: {e}"))?;
    let filas = stmt
        .query_map(rusqlite::params![inicio, fin], |r| {
            Ok(ParMetodo { metodo: r.get(0)?, monto_centavos: r.get(1)?, num: r.get(2)? })
        })
        .map_err(|e| format!("error por_metodo q: {e}"))?;
    filas.collect::<Result<_, _>>().map_err(|e| format!("error por_metodo c: {e}"))
}

fn por_categoria(con: &Connection, inicio: &str, fin: &str) -> Result<Vec<FilaCategoria>, String> {
    let mut stmt = con
        .prepare(
            "SELECT COALESCE(c.nombre, 'Sin categoría'),
                    COALESCE(SUM(vl.total_linea_centavos),0),
                    COALESCE(SUM(vl.total_linea_centavos - vl.costo_unitario_centavos * vl.cantidad),0),
                    COALESCE(SUM(vl.cantidad),0)
             FROM venta_lineas vl
             JOIN ventas v ON vl.venta_id = v.id
             LEFT JOIN productos p ON vl.producto_id = p.id
             LEFT JOIN categorias c ON p.categoria_id = c.id
             WHERE v.estado != 'cancelada'
               AND v.creado_en >= ?1 AND v.creado_en <= ?2
             GROUP BY COALESCE(c.nombre, 'Sin categoría')
             ORDER BY 2 DESC",
        )
        .map_err(|e| format!("error por_categoria: {e}"))?;
    let filas = stmt
        .query_map(rusqlite::params![inicio, fin], |r| {
            // ganancia sale decimal (cantidad REAL); leer f64 y redondear.
            let ganancia_f: f64 = r.get(2)?;
            Ok(FilaCategoria {
                categoria: r.get(0)?,
                vendido_centavos: r.get(1)?,
                ganancia_centavos: ganancia_f.round() as i64,
                articulos: r.get(3)?,
            })
        })
        .map_err(|e| format!("error por_categoria q: {e}"))?;
    filas.collect::<Result<_, _>>().map_err(|e| format!("error por_categoria c: {e}"))
}

fn productos_top(con: &Connection, inicio: &str, fin: &str) -> Result<Vec<FilaProducto>, String> {
    let mut stmt = con
        .prepare(
            "SELECT vl.descripcion,
                    COALESCE(SUM(vl.cantidad),0),
                    COALESCE(SUM(vl.total_linea_centavos),0),
                    COALESCE(SUM(vl.total_linea_centavos - vl.costo_unitario_centavos * vl.cantidad),0)
             FROM venta_lineas vl
             JOIN ventas v ON vl.venta_id = v.id
             WHERE v.estado != 'cancelada'
               AND v.creado_en >= ?1 AND v.creado_en <= ?2
             GROUP BY vl.descripcion
             ORDER BY 3 DESC
             LIMIT 15",
        )
        .map_err(|e| format!("error productos_top: {e}"))?;
    let filas = stmt
        .query_map(rusqlite::params![inicio, fin], |r| {
            let ganancia_f: f64 = r.get(3)?;
            Ok(FilaProducto {
                nombre: r.get(0)?,
                cantidad: r.get(1)?,
                vendido_centavos: r.get(2)?,
                ganancia_centavos: ganancia_f.round() as i64,
            })
        })
        .map_err(|e| format!("error productos_top q: {e}"))?;
    filas.collect::<Result<_, _>>().map_err(|e| format!("error productos_top c: {e}"))
}

fn por_dia(con: &Connection, inicio: &str, fin: &str) -> Result<Vec<PuntoTiempo>, String> {
    let mut stmt = con
        .prepare(
            "SELECT date(creado_en), COALESCE(SUM(total_centavos),0), COUNT(*)
             FROM ventas
             WHERE estado != 'cancelada'
               AND creado_en >= ?1 AND creado_en <= ?2
             GROUP BY date(creado_en)
             ORDER BY date(creado_en)",
        )
        .map_err(|e| format!("error por_dia: {e}"))?;
    let filas = stmt
        .query_map(rusqlite::params![inicio, fin], |r| {
            Ok(PuntoTiempo { etiqueta: r.get(0)?, vendido_centavos: r.get(1)?, num_ventas: r.get(2)? })
        })
        .map_err(|e| format!("error por_dia q: {e}"))?;
    filas.collect::<Result<_, _>>().map_err(|e| format!("error por_dia c: {e}"))
}

fn por_hora(con: &Connection, inicio: &str, fin: &str) -> Result<Vec<PuntoTiempo>, String> {
    // strftime %H da la hora (00-23) en UTC. Para Mazatlán habría que ajustar
    // zona; por ahora se reporta en la hora local del timestamp guardado.
    let mut stmt = con
        .prepare(
            "SELECT strftime('%H', creado_en), COALESCE(SUM(total_centavos),0), COUNT(*)
             FROM ventas
             WHERE estado != 'cancelada'
               AND creado_en >= ?1 AND creado_en <= ?2
             GROUP BY strftime('%H', creado_en)
             ORDER BY 1",
        )
        .map_err(|e| format!("error por_hora: {e}"))?;
    let filas = stmt
        .query_map(rusqlite::params![inicio, fin], |r| {
            Ok(PuntoTiempo { etiqueta: r.get(0)?, vendido_centavos: r.get(1)?, num_ventas: r.get(2)? })
        })
        .map_err(|e| format!("error por_hora q: {e}"))?;
    filas.collect::<Result<_, _>>().map_err(|e| format!("error por_hora c: {e}"))
}
