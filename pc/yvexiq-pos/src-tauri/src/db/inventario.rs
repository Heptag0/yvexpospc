//! Reporte de inventario: valor total, cantidad de productos, desglose por
//! categoría/departamento. Solo para dueño/gerente (incluye costos).
//!
//! El "valor de inventario" se calcula a costo: suma de (stock × costo) de los
//! productos que controlan stock. Es lo que el dueño tiene invertido en
//! mercancía.

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct FilaCategoriaInv {
    pub categoria: String,
    pub num_productos: i64,
    pub unidades: f64,
    pub valor_costo_centavos: i64,
    pub valor_venta_centavos: i64,
}

#[derive(Debug, Serialize)]
pub struct ReporteInventario {
    pub total_productos: i64,        // productos activos en catálogo
    pub productos_con_stock: i64,    // que controlan stock
    pub unidades_totales: f64,       // suma de stock
    pub valor_costo_centavos: i64,   // inversión total a costo
    pub valor_venta_centavos: i64,   // valor potencial a precio de venta
    pub productos_sin_stock: i64,    // controlan stock pero están en 0
    pub productos_stock_bajo: i64,   // en o por debajo del mínimo
    pub por_categoria: Vec<FilaCategoriaInv>,
}

/// Genera el reporte. `rol` debe ser dueno/gerente (incluye costos).
pub fn generar(con: &Connection, dispositivo_id: &str, rol: &str) -> Result<ReporteInventario, String> {
    if rol != "dueno" && rol != "gerente" {
        return Err("No tienes permiso para ver el reporte de inventario.".into());
    }

    // Totales generales.
    let (total_productos, con_stock, unidades, valor_costo_f, valor_venta_f): (i64, i64, f64, f64, f64) = con
        .query_row(
            "SELECT
               COUNT(*),
               COALESCE(SUM(CASE WHEN controla_stock=1 THEN 1 ELSE 0 END),0),
               COALESCE(SUM(CASE WHEN controla_stock=1 THEN stock ELSE 0 END),0),
               COALESCE(SUM(CASE WHEN controla_stock=1 THEN stock * costo_centavos ELSE 0 END),0),
               COALESCE(SUM(CASE WHEN controla_stock=1 THEN stock * precio_venta_centavos ELSE 0 END),0)
             FROM productos
             WHERE eliminado=0 AND es_kit=0 AND dispositivo_id=?1",
            rusqlite::params![dispositivo_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|e| format!("error en totales de inventario: {e}"))?;

    // Sin stock y stock bajo.
    let (sin_stock, stock_bajo): (i64, i64) = con
        .query_row(
            "SELECT
               COALESCE(SUM(CASE WHEN controla_stock=1 AND stock<=0 THEN 1 ELSE 0 END),0),
               COALESCE(SUM(CASE WHEN controla_stock=1 AND stock>0 AND stock<=stock_minimo THEN 1 ELSE 0 END),0)
             FROM productos
             WHERE eliminado=0 AND es_kit=0 AND dispositivo_id=?1",
            rusqlite::params![dispositivo_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| format!("error en stock bajo: {e}"))?;

    // Desglose por categoría.
    let mut stmt = con
        .prepare(
            "SELECT COALESCE(c.nombre, 'Sin categoría'),
                    COUNT(*),
                    COALESCE(SUM(CASE WHEN p.controla_stock=1 THEN p.stock ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN p.controla_stock=1 THEN p.stock * p.costo_centavos ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN p.controla_stock=1 THEN p.stock * p.precio_venta_centavos ELSE 0 END),0)
             FROM productos p
             LEFT JOIN categorias c ON p.categoria_id = c.id
             WHERE p.eliminado=0 AND p.es_kit=0 AND p.dispositivo_id=?1
             GROUP BY COALESCE(c.nombre, 'Sin categoría')
             ORDER BY 4 DESC",
        )
        .map_err(|e| format!("error al preparar por_categoria: {e}"))?;
    let filas = stmt
        .query_map(rusqlite::params![dispositivo_id], |r| {
            // valor*cantidad puede dar REAL (stock decimal): leer f64 y redondear.
            let costo_f: f64 = r.get(3)?;
            let venta_f: f64 = r.get(4)?;
            Ok(FilaCategoriaInv {
                categoria: r.get(0)?,
                num_productos: r.get(1)?,
                unidades: r.get(2)?,
                valor_costo_centavos: costo_f.round() as i64,
                valor_venta_centavos: venta_f.round() as i64,
            })
        })
        .map_err(|e| format!("error en por_categoria: {e}"))?;
    let por_categoria: Vec<FilaCategoriaInv> =
        filas.collect::<Result<_, _>>().map_err(|e| format!("error al recolectar: {e}"))?;

    Ok(ReporteInventario {
        total_productos,
        productos_con_stock: con_stock,
        unidades_totales: unidades,
        valor_costo_centavos: valor_costo_f.round() as i64,
        valor_venta_centavos: valor_venta_f.round() as i64,
        productos_sin_stock: sin_stock,
        productos_stock_bajo: stock_bajo,
        por_categoria,
    })
}

// ============================================================================
// Métricas ligeras para la cabecera de la pantalla de Inventario
// ============================================================================

#[derive(Debug, Serialize)]
pub struct MetricasInventario {
    pub total_productos: i64,      // productos activos (sin kits)
    pub valor_costo_centavos: i64, // inversión total a costo
    pub margen_promedio: i64,      // % de margen ponderado por valor de venta
    pub stock_bajo: i64,           // en o por debajo del mínimo (con stock > 0)
    pub sin_stock: i64,            // en 0 exacto
    pub negativos: i64,            // en negativo (necesitan revisión)
}

/// Métricas resumidas del inventario para la franja superior. Ligera (una sola
/// pasada). No requiere rol especial de reporte, pero el margen/valor solo
/// tienen sentido para dueño/gerente; el frontend decide si mostrarlos.
pub fn metricas(con: &Connection, dispositivo_id: &str) -> Result<MetricasInventario, String> {
    let (total, valor_costo_f, valor_venta_f, valor_costo_vendible_f): (i64, f64, f64, f64) = con
        .query_row(
            "SELECT
               COUNT(*),
               COALESCE(SUM(CASE WHEN controla_stock=1 THEN stock * costo_centavos ELSE 0 END),0),
               COALESCE(SUM(CASE WHEN controla_stock=1 THEN stock * precio_venta_centavos ELSE 0 END),0),
               COALESCE(SUM(CASE WHEN controla_stock=1 AND stock>0 THEN stock * costo_centavos ELSE 0 END),0)
             FROM productos
             WHERE eliminado=0 AND es_kit=0 AND dispositivo_id=?1",
            rusqlite::params![dispositivo_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|e| format!("error en métricas de inventario: {e}"))?;

    let (bajo, sin, neg): (i64, i64, i64) = con
        .query_row(
            "SELECT
               COALESCE(SUM(CASE WHEN controla_stock=1 AND stock>0 AND stock<=stock_minimo THEN 1 ELSE 0 END),0),
               COALESCE(SUM(CASE WHEN controla_stock=1 AND stock=0 THEN 1 ELSE 0 END),0),
               COALESCE(SUM(CASE WHEN controla_stock=1 AND stock<0 THEN 1 ELSE 0 END),0)
             FROM productos
             WHERE eliminado=0 AND es_kit=0 AND dispositivo_id=?1",
            rusqlite::params![dispositivo_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| format!("error en conteos de inventario: {e}"))?;

    // Margen promedio ponderado por valor de venta: (venta - costo) / venta.
    // Usamos el costo vendible (solo stock positivo) para que sea coherente.
    let margen = if valor_venta_f > 0.0 {
        (((valor_venta_f - valor_costo_vendible_f) / valor_venta_f) * 100.0).round() as i64
    } else {
        0
    };

    Ok(MetricasInventario {
        total_productos: total,
        valor_costo_centavos: valor_costo_f.round() as i64,
        margen_promedio: margen,
        stock_bajo: bajo,
        sin_stock: sin,
        negativos: neg,
    })
}

// ============================================================================
// Conteo físico de inventario (modo "realizar inventario")
// ============================================================================

use serde::Deserialize;
use super::comun::ahora;

/// Un producto contado: su id y el stock real que se contó físicamente.
#[derive(Debug, Deserialize)]
pub struct ConteoLinea {
    pub producto_id: String,
    pub stock_contado: f64,
}

/// Resultado de aplicar un conteo.
#[derive(Debug, Serialize)]
pub struct ResultadoConteo {
    pub productos_ajustados: i64,
    pub diferencia_valor_centavos: i64, // impacto en dinero (a costo)
}

/// Aplica un conteo físico masivo: para cada producto, fija su stock al valor
/// contado (tipo "ajuste_conteo") y registra el rastro. Todo en una sola
/// transacción. Solo se ajustan los productos cuyo conteo difiere del stock.
pub fn aplicar_conteo(
    con: &mut Connection,
    dispositivo_id: &str,
    usuario_pos_id: &str,
    lineas: &[ConteoLinea],
) -> Result<ResultadoConteo, String> {
    let ts = ahora();
    let tx = con.transaction().map_err(|e| format!("no se pudo abrir transacción: {e}"))?;

    let mut ajustados = 0i64;
    let mut dif_valor = 0i64;

    for l in lineas {
        if l.stock_contado < 0.0 {
            return Err("El stock contado no puede ser negativo.".into());
        }
        // Stock actual y costo del producto.
        let fila: Option<(f64, i64, i64)> = tx
            .query_row(
                "SELECT stock, costo_centavos, controla_stock FROM productos
                 WHERE id=?1 AND eliminado=0",
                rusqlite::params![l.producto_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(|e| format!("error al leer producto: {e}"))?;
        let (stock_actual, costo, controla) = match fila {
            Some(f) => f,
            None => continue, // producto no existe; saltar
        };
        if controla == 0 {
            continue; // servicios no se cuentan
        }
        // Si no hay diferencia, no hacemos nada.
        let delta = l.stock_contado - stock_actual;
        if delta.abs() < 1e-9 {
            continue;
        }

        // Actualizar stock al valor contado.
        tx.execute(
            "UPDATE productos SET stock=?2, actualizado_en=?3 WHERE id=?1",
            rusqlite::params![l.producto_id, l.stock_contado, ts],
        )
        .map_err(|e| format!("error al actualizar stock: {e}"))?;

        // Rastro del ajuste.
        super::productos::registrar_ajuste_en_tx(
            &tx,
            dispositivo_id,
            &l.producto_id,
            "ajuste_conteo",
            delta,
            l.stock_contado,
            "Conteo físico de inventario",
            usuario_pos_id,
        )?;

        ajustados += 1;
        // Impacto en dinero a costo: delta * costo.
        dif_valor += (delta * costo as f64).round() as i64;
    }

    tx.commit().map_err(|e| format!("error al confirmar conteo: {e}"))?;
    Ok(ResultadoConteo {
        productos_ajustados: ajustados,
        diferencia_valor_centavos: dif_valor,
    })
}
