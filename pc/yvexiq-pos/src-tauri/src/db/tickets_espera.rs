//! Tickets en espera: ventas simultáneas guardadas en BD.
//!
//! Permiten tener varias ventas abiertas a la vez y que sobrevivan a cortes de
//! luz o cierres de la app. El contenido del carrito se guarda como JSON (texto)
//! porque es una estructura variable y transitoria.
//!
//! El frontend serializa el carrito a JSON y lo manda; aquí solo lo guardamos y
//! lo devolvemos tal cual. La estructura del JSON la conoce el frontend.

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

use super::comun::{ahora, nuevo_id};

#[derive(Debug, Serialize)]
pub struct TicketEspera {
    pub id: String,
    pub numero: i64,
    pub nombre: Option<String>,
    pub contenido: String, // JSON del carrito
    pub actualizado_en: String,
}

/// Lista los tickets en espera de una caja, ordenados por número.
pub fn listar(con: &Connection, caja_sesion_id: &str) -> Result<Vec<TicketEspera>, String> {
    let mut stmt = con
        .prepare(
            "SELECT id, numero, nombre, contenido, actualizado_en
             FROM tickets_espera WHERE caja_sesion_id = ?1
             ORDER BY numero",
        )
        .map_err(|e| format!("error al preparar listado: {e}"))?;
    let filas = stmt
        .query_map(rusqlite::params![caja_sesion_id], |r| {
            Ok(TicketEspera {
                id: r.get(0)?,
                numero: r.get(1)?,
                nombre: r.get(2)?,
                contenido: r.get(3)?,
                actualizado_en: r.get(4)?,
            })
        })
        .map_err(|e| format!("error al listar tickets: {e}"))?;
    let mut out = Vec::new();
    for f in filas {
        out.push(f.map_err(|e| format!("error en fila: {e}"))?);
    }
    Ok(out)
}

/// Crea un ticket en espera nuevo (carrito vacío o con contenido). Devuelve el
/// ticket creado con su número asignado.
pub fn crear(
    con: &Connection,
    caja_sesion_id: &str,
    usuario_pos_id: &str,
    dispositivo_id: &str,
    contenido: &str,
) -> Result<TicketEspera, String> {
    // Número siguiente: el mayor de esta caja + 1 (empieza en 1).
    let numero: i64 = con
        .query_row(
            "SELECT COALESCE(MAX(numero), 0) + 1 FROM tickets_espera WHERE caja_sesion_id = ?1",
            rusqlite::params![caja_sesion_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("error al calcular número: {e}"))?;
    let id = nuevo_id();
    let ts = ahora();
    con.execute(
        "INSERT INTO tickets_espera
           (id, numero, nombre, caja_sesion_id, usuario_pos_id, contenido, creado_en, actualizado_en, dispositivo_id)
         VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?6, ?7)",
        rusqlite::params![id, numero, caja_sesion_id, usuario_pos_id, contenido, ts, dispositivo_id],
    )
    .map_err(|e| format!("error al crear ticket: {e}"))?;
    Ok(TicketEspera {
        id,
        numero,
        nombre: None,
        contenido: contenido.to_string(),
        actualizado_en: ts,
    })
}

/// Guarda (actualiza) el contenido de un ticket en espera existente.
pub fn guardar(con: &Connection, id: &str, contenido: &str) -> Result<(), String> {
    let ts = ahora();
    let n = con
        .execute(
            "UPDATE tickets_espera SET contenido = ?2, actualizado_en = ?3 WHERE id = ?1",
            rusqlite::params![id, contenido, ts],
        )
        .map_err(|e| format!("error al guardar ticket: {e}"))?;
    if n == 0 {
        return Err("El ticket en espera ya no existe.".into());
    }
    Ok(())
}

/// Renombra un ticket en espera (nombre opcional; vacío = quitar nombre).
pub fn renombrar(con: &Connection, id: &str, nombre: Option<&str>) -> Result<(), String> {
    let ts = ahora();
    let nombre_limpio = nombre.map(|s| s.trim()).filter(|s| !s.is_empty());
    con.execute(
        "UPDATE tickets_espera SET nombre = ?2, actualizado_en = ?3 WHERE id = ?1",
        rusqlite::params![id, nombre_limpio, ts],
    )
    .map_err(|e| format!("error al renombrar ticket: {e}"))?;
    Ok(())
}

/// Elimina un ticket en espera (al cobrarlo o descartarlo).
pub fn eliminar(con: &Connection, id: &str) -> Result<(), String> {
    con.execute("DELETE FROM tickets_espera WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| format!("error al eliminar ticket: {e}"))?;
    Ok(())
}

/// Carga un ticket específico por id (para retomarlo).
pub fn cargar(con: &Connection, id: &str) -> Result<Option<TicketEspera>, String> {
    con.query_row(
        "SELECT id, numero, nombre, contenido, actualizado_en FROM tickets_espera WHERE id = ?1",
        rusqlite::params![id],
        |r| {
            Ok(TicketEspera {
                id: r.get(0)?,
                numero: r.get(1)?,
                nombre: r.get(2)?,
                contenido: r.get(3)?,
                actualizado_en: r.get(4)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("error al cargar ticket: {e}"))
}
