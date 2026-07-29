//! Capa de base de datos del POS.
//!
//! Abre SQLite en la carpeta de datos de la app, configura los PRAGMAs que
//! importan para un POS (WAL para no bloquear lecturas durante una venta,
//! foreign_keys ON), y aplica las migraciones al arrancar.
//!
//! La conexión vive dentro de un `Mutex<Connection>` en el estado de Tauri.
//! Todos los `#[tauri::command]` la toman de ahí. Una sola conexión protegida
//! por mutex es suficiente y correcta para un POS de una caja: las operaciones
//! son cortas y la contención es mínima.

pub mod caja;
pub mod categorias;
pub mod clientes;
pub mod comun;
pub mod config;
pub mod devoluciones;
pub mod firebird;
pub mod exportar;
pub mod importar_csv;
pub mod importador;
pub mod impuestos;
pub mod tickets_espera;
pub mod kits;
pub mod restaurar;
pub mod inventario;
pub mod migrations;
pub mod onboarding;
pub mod productos;
pub mod reportes;
pub mod ticket;
pub mod usuarios;
pub mod ventas;
pub mod inicio;
pub mod vinculacion;
pub mod sync_push;
pub mod sync_pull;
pub mod sync_worker;

use rusqlite::Connection;
use std::sync::Mutex;

/// Estado compartido que Tauri inyecta en los comandos.
pub struct EstadoDb {
    pub con: Mutex<Connection>,
    /// Canal hacia el hilo de sincronización de fondo. Permite pedirle un sync
    /// inmediato tras cada venta. Option porque puede no estar arrancado aún.
    pub sync_tx: Mutex<Option<std::sync::mpsc::Sender<sync_worker::SenalSync>>>,
}

/// Abre la conexión, configura PRAGMAs y aplica migraciones.
/// `ruta_db` es el archivo .sqlite (se crea si no existe).
pub fn inicializar(ruta_db: &std::path::Path) -> Result<Connection, String> {
    let con = Connection::open(ruta_db)
        .map_err(|e| format!("no se pudo abrir la BD en {ruta_db:?}: {e}"))?;

    // WAL: lectores no bloquean al escritor. Clave para que reportes/consultas
    // no traben una venta en curso.
    con.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("PRAGMA journal_mode: {e}"))?;
    // NORMAL con WAL es el balance correcto durabilidad/velocidad para un POS.
    con.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| format!("PRAGMA synchronous: {e}"))?;
    // Integridad referencial activa (debe ir ANTES de cualquier escritura).
    con.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("PRAGMA foreign_keys: {e}"))?;

    migrations::aplicar_migraciones(&con)
        .map_err(|e| format!("error aplicando migraciones: {e}"))?;

    Ok(con)
}