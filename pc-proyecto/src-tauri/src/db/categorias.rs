//! Categorías de productos (`categorias`).
//!
//! CRUD con soft delete. Cada cambio encola sync. El `color` se usa en la
//! cuadrícula de venta (personalizable por negocio).

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::comun::{ahora, encolar_sync, nuevo_id};

#[derive(Debug, Serialize)]
pub struct Categoria {
    pub id: String,
    pub nombre: String,
    pub color: Option<String>,
    pub orden: i64,
}

#[derive(Debug, Deserialize)]
pub struct NuevaCategoria {
    pub nombre: String,
    pub color: Option<String>,
    pub orden: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct EditarCategoria {
    pub id: String,
    pub nombre: String,
    pub color: Option<String>,
    pub orden: Option<i64>,
}

/// Lista categorías no eliminadas, ordenadas por `orden` y luego nombre.
pub fn listar(con: &Connection) -> Result<Vec<Categoria>, String> {
    let mut stmt = con
        .prepare(
            "SELECT id, nombre, color, orden
             FROM categorias
             WHERE eliminado = 0
             ORDER BY orden, nombre COLLATE NOCASE",
        )
        .map_err(|e| format!("error al preparar consulta de categorías: {e}"))?;
    let filas = stmt
        .query_map([], |row| {
            Ok(Categoria {
                id: row.get(0)?,
                nombre: row.get(1)?,
                color: row.get(2)?,
                orden: row.get(3)?,
            })
        })
        .map_err(|e| format!("error al consultar categorías: {e}"))?;
    let mut out = Vec::new();
    for f in filas {
        out.push(f.map_err(|e| format!("error al leer categoría: {e}"))?);
    }
    Ok(out)
}

pub fn crear(con: &Connection, dispositivo_id: &str, datos: &NuevaCategoria) -> Result<Categoria, String> {
    let nombre = datos.nombre.trim();
    if nombre.is_empty() {
        return Err("El nombre de la categoría no puede estar vacío.".into());
    }
    let id = nuevo_id();
    let ts = ahora();
    let orden = datos.orden.unwrap_or(0);

    con.execute(
        "INSERT INTO categorias (id, nombre, color, orden, creado_en, actualizado_en, eliminado, dispositivo_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, 0, ?6)",
        rusqlite::params![id, nombre, datos.color, orden, ts, dispositivo_id],
    )
    .map_err(|e| format!("error al crear categoría: {e}"))?;

    let payload = serde_json::json!({
        "id": id, "nombre": nombre, "color": datos.color, "orden": orden,
        "creado_en": ts, "actualizado_en": ts, "eliminado": 0, "dispositivo_id": dispositivo_id,
    });
    encolar_sync(con, "categorias", &id, "insert", &payload)
        .map_err(|e| format!("error al encolar categoría: {e}"))?;

    Ok(Categoria { id, nombre: nombre.to_string(), color: datos.color.clone(), orden })
}

pub fn editar(con: &Connection, datos: &EditarCategoria) -> Result<Categoria, String> {
    let nombre = datos.nombre.trim();
    if nombre.is_empty() {
        return Err("El nombre de la categoría no puede estar vacío.".into());
    }
    let ts = ahora();
    let orden = datos.orden.unwrap_or(0);

    let n = con
        .execute(
            "UPDATE categorias SET nombre = ?2, color = ?3, orden = ?4, actualizado_en = ?5
             WHERE id = ?1 AND eliminado = 0",
            rusqlite::params![datos.id, nombre, datos.color, orden, ts],
        )
        .map_err(|e| format!("error al editar categoría: {e}"))?;
    if n == 0 {
        return Err("No se encontró la categoría.".into());
    }

    let payload = serde_json::json!({
        "id": datos.id, "nombre": nombre, "color": datos.color, "orden": orden,
        "actualizado_en": ts,
    });
    encolar_sync(con, "categorias", &datos.id, "update", &payload)
        .map_err(|e| format!("error al encolar categoría: {e}"))?;

    Ok(Categoria { id: datos.id.clone(), nombre: nombre.to_string(), color: datos.color.clone(), orden })
}

/// Reasigna el campo `orden` de las categorías según la lista de ids recibida
/// (el primer id queda con orden 0, el segundo con 1, etc.). Todo en una
/// transacción para que el reordenamiento sea atómico.
pub fn reordenar(con: &mut Connection, ids: &[String]) -> Result<(), String> {
    let ts = ahora();
    let tx = con.transaction().map_err(|e| format!("error al iniciar transacción: {e}"))?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE categorias SET orden = ?2, actualizado_en = ?3 WHERE id = ?1 AND eliminado = 0",
            rusqlite::params![id, i as i64, ts],
        )
        .map_err(|e| format!("error al reordenar categoría: {e}"))?;
    }
    tx.commit().map_err(|e| format!("error al confirmar reordenamiento: {e}"))?;
    Ok(())
}

/// Baja soft. Si hay productos asignados, NO los borra; quedan sin categoría
/// (la relación es nullable). Devolvemos cuántos productos quedaron sueltos.
pub fn eliminar(con: &Connection, id: &str) -> Result<(), String> {
    let existe: Option<i64> = con
        .query_row(
            "SELECT 1 FROM categorias WHERE id = ?1 AND eliminado = 0",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("error al verificar categoría: {e}"))?;
    if existe.is_none() {
        return Err("No se encontró la categoría.".into());
    }
    let ts = ahora();
    con.execute(
        "UPDATE categorias SET eliminado = 1, actualizado_en = ?2 WHERE id = ?1",
        rusqlite::params![id, ts],
    )
    .map_err(|e| format!("error al eliminar categoría: {e}"))?;

    let payload = serde_json::json!({ "id": id, "eliminado": 1, "actualizado_en": ts });
    encolar_sync(con, "categorias", id, "update", &payload)
        .map_err(|e| format!("error al encolar baja de categoría: {e}"))?;
    Ok(())
}
