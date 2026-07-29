//! Kits (productos compuestos / paquetes).
//!
//! Un kit es un producto (`productos.es_kit = 1`) que al venderse descuenta del
//! inventario a sus componentes, no a sí mismo. Este módulo maneja la relación
//! kit → componentes (tabla `kit_componentes`).
//!
//! Regla de esta versión: los componentes son SIEMPRE productos normales
//! (no otros kits). Un solo nivel. Las promociones (futuro) manejarán el nivel
//! extra con su propia regla.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::comun::{ahora, nuevo_id};

/// Un componente de un kit, con datos del producto para mostrarlo.
#[derive(Debug, Serialize)]
pub struct ComponenteKit {
    pub producto_id: String,
    pub nombre: String,
    pub cantidad: f64,
    pub costo_centavos: i64,
    pub precio_venta_centavos: i64,
    pub stock: f64,
    pub controla_stock: bool,
    pub unidad: String,
}

/// Componente tal como llega del frontend al crear/editar un kit.
#[derive(Debug, Deserialize, Clone)]
pub struct ComponenteEntrada {
    pub producto_id: String,
    pub cantidad: f64,
}

/// Lee los componentes de un kit (con datos del producto para mostrarlos).
pub fn componentes_de(con: &Connection, kit_id: &str) -> Result<Vec<ComponenteKit>, String> {
    let mut stmt = con
        .prepare(
            "SELECT kc.producto_componente_id, p.nombre, kc.cantidad,
                    p.costo_centavos, p.precio_venta_centavos, p.stock, p.controla_stock, p.unidad
             FROM kit_componentes kc
             JOIN productos p ON p.id = kc.producto_componente_id
             WHERE kc.kit_id = ?1 AND p.eliminado = 0
             ORDER BY p.nombre COLLATE NOCASE",
        )
        .map_err(|e| format!("error al preparar componentes: {e}"))?;
    let filas = stmt
        .query_map(rusqlite::params![kit_id], |r| {
            Ok(ComponenteKit {
                producto_id: r.get(0)?,
                nombre: r.get(1)?,
                cantidad: r.get(2)?,
                costo_centavos: r.get(3)?,
                precio_venta_centavos: r.get(4)?,
                stock: r.get(5)?,
                controla_stock: r.get::<_, i64>(6)? != 0,
                unidad: r.get(7)?,
            })
        })
        .map_err(|e| format!("error al consultar componentes: {e}"))?;
    let mut out = Vec::new();
    for f in filas {
        out.push(f.map_err(|e| format!("error al leer componente: {e}"))?);
    }
    Ok(out)
}

/// Calcula el costo total de un kit sumando (costo componente × cantidad).
/// Se usa como costo por defecto del kit (el usuario puede ajustarlo).
pub fn costo_calculado(con: &Connection, componentes: &[ComponenteEntrada]) -> Result<i64, String> {
    let mut total: i64 = 0;
    for c in componentes {
        let costo: i64 = con
            .query_row(
                "SELECT costo_centavos FROM productos WHERE id = ?1 AND eliminado = 0",
                rusqlite::params![c.producto_id],
                |r| r.get(0),
            )
            .map_err(|e| format!("error al leer costo de componente: {e}"))?;
        // Redondeo al centavo del costo × cantidad (cantidad puede ser decimal).
        total += (costo as f64 * c.cantidad).round() as i64;
    }
    Ok(total)
}

/// Reemplaza por completo los componentes de un kit (borra los previos y pone
/// los nuevos). Se usa tanto al crear como al editar. Valida que:
///   * haya al menos un componente,
///   * ningún componente sea un kit (solo productos normales, un nivel),
///   * ningún componente sea el propio kit.
/// Debe llamarse dentro de una transacción (el llamador la maneja).
pub fn reemplazar_componentes(
    con: &Connection,
    kit_id: &str,
    dispositivo_id: &str,
    componentes: &[ComponenteEntrada],
) -> Result<(), String> {
    if componentes.is_empty() {
        return Err("Un paquete debe tener al menos un producto.".into());
    }
    // Validar cada componente.
    for c in componentes {
        if c.producto_id == kit_id {
            return Err("Un paquete no puede contenerse a sí mismo.".into());
        }
        if c.cantidad <= 0.0 {
            return Err("La cantidad de cada producto del paquete debe ser mayor que cero.".into());
        }
        let (existe, es_kit): (bool, bool) = con
            .query_row(
                "SELECT 1, es_kit FROM productos WHERE id = ?1 AND eliminado = 0",
                rusqlite::params![c.producto_id],
                |r| Ok((true, r.get::<_, i64>(1)? != 0)),
            )
            .map_err(|_| "Uno de los productos del paquete ya no existe.".to_string())?;
        if !existe {
            return Err("Uno de los productos del paquete ya no existe.".into());
        }
        if es_kit {
            return Err("Un paquete no puede contener otro paquete (por ahora).".into());
        }
    }
    // Borrar los previos y poner los nuevos.
    con.execute("DELETE FROM kit_componentes WHERE kit_id = ?1", rusqlite::params![kit_id])
        .map_err(|e| format!("error al limpiar componentes: {e}"))?;
    let ts = ahora();
    for c in componentes {
        con.execute(
            "INSERT INTO kit_componentes
               (id, kit_id, producto_componente_id, cantidad, creado_en, actualizado_en, dispositivo_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)",
            rusqlite::params![nuevo_id(), kit_id, c.producto_id, c.cantidad, ts, dispositivo_id],
        )
        .map_err(|e| format!("error al guardar componente: {e}"))?;
    }
    Ok(())
}

/// Componente reducido para descontar stock al vender un kit.
pub struct CompDescuento {
    pub producto_id: String,
    pub cantidad: f64,
    pub stock: f64,
    pub controla_stock: bool,
}

/// Lee los componentes de un kit con lo mínimo para descontar su stock.
/// Se usa dentro de la transacción de venta.
pub fn componentes_para_descuento(
    con: &Connection,
    kit_id: &str,
) -> Result<Vec<CompDescuento>, String> {
    let mut stmt = con
        .prepare(
            "SELECT kc.producto_componente_id, kc.cantidad, p.stock, p.controla_stock
             FROM kit_componentes kc
             JOIN productos p ON p.id = kc.producto_componente_id
             WHERE kc.kit_id = ?1 AND p.eliminado = 0",
        )
        .map_err(|e| format!("error al preparar componentes para descuento: {e}"))?;
    let filas = stmt
        .query_map(rusqlite::params![kit_id], |r| {
            Ok(CompDescuento {
                producto_id: r.get(0)?,
                cantidad: r.get(1)?,
                stock: r.get(2)?,
                controla_stock: r.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(|e| format!("error al consultar componentes para descuento: {e}"))?;
    let mut out = Vec::new();
    for f in filas {
        out.push(f.map_err(|e| format!("error al leer componente: {e}"))?);
    }
    Ok(out)
}
pub fn disponibles(con: &Connection, kit_id: &str) -> Result<Option<f64>, String> {
    let comps = componentes_de(con, kit_id)?;
    let mut minimo: Option<f64> = None;
    for c in comps {
        if c.controla_stock && c.cantidad > 0.0 {
            let posibles = (c.stock / c.cantidad).floor();
            minimo = Some(match minimo {
                Some(m) => m.min(posibles),
                None => posibles,
            });
        }
    }
    Ok(minimo)
}