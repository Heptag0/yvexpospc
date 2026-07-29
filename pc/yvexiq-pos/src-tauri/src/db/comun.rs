//! Utilidades compartidas por todos los módulos de datos.
//!
//! Centralizar aquí el UUID, el timestamp y el encolado de sync evita que cada
//! módulo los reimplemente y se desincronice del esquema.

use rusqlite::Connection;
use serde_json::Value;

/// UUID v4 como texto. Todos los IDs sincronizables se generan así (en cliente).
pub fn nuevo_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Timestamp actual en ISO-8601 UTC. Toda fecha en BD es UTC; la UI la convierte
/// a hora de Mazatlán al mostrar.
pub fn ahora() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Encola una operación para que el sync worker la empuje al VPS más tarde.
/// `payload` es el JSON del registro tal como quedó en SQLite.
///
/// ⚠️ MODO OFFLINE LIMPIO: si el dispositivo NO tiene cuenta vinculada (sin
/// `sync_dispositivo_id`/`sync_token` en config), esto es un NO-OP: no se
/// encola nada. Quien usa el POS solo local no acumula una cola muerta que
/// nunca se vaciaría. Consecuencia aceptada (igual que en el móvil): lo
/// vendido ANTES de vincular no sube retroactivamente; la sync empieza a
/// contar desde la vinculación.
///
/// NOTA: la cola se llena dentro de la MISMA transacción que crea/actualiza el
/// registro, para que nunca exista un registro sin su entrada de sync (o ambos
/// o ninguno). Por eso recibe `&Connection` ya dentro de la transacción.
pub fn encolar_sync(
    con: &Connection,
    entidad: &str,
    entidad_id: &str,
    operacion: &str, // "insert" | "update"
    payload: &Value,
) -> rusqlite::Result<()> {
    if !sync_activa(con) {
        return Ok(()); // sin cuenta vinculada: modo offline, nada que encolar
    }
    con.execute(
        "INSERT INTO cola_sync (entidad, entidad_id, operacion, payload, intentos, creado_en)
         VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        rusqlite::params![
            entidad,
            entidad_id,
            operacion,
            payload.to_string(),
            ahora()
        ],
    )?;
    Ok(())
}

/// ¿Hay cuenta vinculada con credenciales completas? Es el interruptor global
/// de la sincronización: sin esto, ni se encola ni se envía ni se baja nada.
/// (Lectura directa de config para no importar sync_push desde aquí.)
fn sync_activa(con: &Connection) -> bool {
    let leer = |clave: &str| -> Option<String> {
        con.query_row(
            "SELECT valor FROM config WHERE clave = ?1",
            rusqlite::params![clave],
            |r| r.get::<_, String>(0),
        )
        .ok()
    };
    match (leer("sync_dispositivo_id"), leer("sync_token")) {
        (Some(d), Some(t)) => !d.is_empty() && !t.is_empty(),
        _ => false,
    }
}
