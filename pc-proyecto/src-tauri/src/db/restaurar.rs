//! Restauración de la base de datos desde un respaldo (.sqlite).
//!
//! Es una operación DESTRUCTIVA: reemplaza toda la base actual. Por eso:
//!   1. Valida que el archivo sea un respaldo de YvexPOS legítimo.
//!   2. Hace un respaldo de seguridad de la base ACTUAL antes de tocar nada.
//!   3. Copia el respaldo elegido sobre la base activa.
//! Tras esto, la app debe REINICIARSE para cargar la base nueva (el frontend
//! lo solicita). No intentamos recargar en caliente porque la conexión activa
//! tiene el archivo abierto.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

/// Tablas que un respaldo válido de YvexPOS debe tener. Si faltan, el archivo
/// no es nuestro y se rechaza (evita romper el POS con un SQLite cualquiera).
const TABLAS_REQUERIDAS: [&str; 5] =
    ["dispositivos", "usuarios_pos", "productos", "ventas", "categorias"];

/// Valida que el archivo sea un respaldo de YvexPOS: abrible como SQLite y con
/// las tablas esperadas. Devuelve Ok(()) si es válido.
pub fn validar(ruta: &str) -> Result<(), String> {
    if !Path::new(ruta).exists() {
        return Err("El archivo no existe.".into());
    }
    // Abrir en solo lectura para no tocarlo.
    let con = Connection::open(ruta)
        .map_err(|_| "El archivo no es una base de datos válida.".to_string())?;

    for tabla in TABLAS_REQUERIDAS {
        let existe: bool = con
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
                rusqlite::params![tabla],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !existe {
            return Err(format!(
                "El archivo no parece un respaldo de YvexPOS (falta la tabla '{tabla}'). \
                 ¿Seguro que es un respaldo generado por YvexPOS?"
            ));
        }
    }
    Ok(())
}

/// Construye la ruta del respaldo de seguridad automático (junto a la BD,
/// con marca de tiempo).
pub fn ruta_respaldo_seguridad(dir_datos: &Path) -> PathBuf {
    let marca = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    dir_datos.join(format!("respaldo_auto_{marca}.sqlite"))
}

/// Realiza un respaldo de seguridad de la base ACTUAL usando VACUUM INTO.
/// `con` es la conexión activa. Devuelve la ruta del respaldo creado.
pub fn respaldo_seguridad(con: &Connection, dir_datos: &Path) -> Result<PathBuf, String> {
    let destino = ruta_respaldo_seguridad(dir_datos);
    let ruta_sql = destino.to_string_lossy().replace('\'', "''");
    con.execute_batch(&format!("VACUUM INTO '{ruta_sql}'"))
        .map_err(|e| format!("no se pudo crear el respaldo de seguridad: {e}"))?;
    Ok(destino)
}

/// Copia el archivo de respaldo elegido sobre la base de datos activa.
/// IMPORTANTE: debe llamarse después de cerrar/soltar la conexión activa, o al
/// menos tras un checkpoint, y la app debe reiniciarse después.
pub fn sobrescribir_bd(ruta_respaldo: &str, ruta_bd_activa: &Path) -> Result<(), String> {
    // Borrar los archivos auxiliares del WAL para que no queden inconsistentes
    // con la base recién copiada.
    for ext in ["-wal", "-shm"] {
        let aux = PathBuf::from(format!("{}{}", ruta_bd_activa.to_string_lossy(), ext));
        if aux.exists() {
            let _ = std::fs::remove_file(&aux);
        }
    }
    std::fs::copy(ruta_respaldo, ruta_bd_activa)
        .map_err(|e| format!("no se pudo restaurar la base: {e}"))?;
    Ok(())
}
