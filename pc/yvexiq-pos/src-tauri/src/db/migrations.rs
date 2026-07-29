//! Cargador de migraciones de SQLite.
//!
//! Cada migración es un archivo `.sql` numerado en `migrations/`, embebido en el
//! binario con `include_str!` para que no dependa de archivos sueltos junto al
//! ejecutable en producción.
//!
//! La tabla `schema_version` guarda la última versión aplicada. Al arrancar, se
//! aplican en orden solo las migraciones con número mayor al ya aplicado, dentro
//! de una transacción por migración (si una falla, no deja la BD a medias).
//!
//! REGLA: nunca editar una migración ya liberada. Siempre añadir una nueva
//! (`002_...`, `003_...`) y registrarla en el arreglo `MIGRACIONES`.

use rusqlite::{Connection, Result};

/// Una migración: su número de versión y su SQL embebido.
struct Migracion {
    version: i64,
    nombre: &'static str,
    sql: &'static str,
}

/// Lista ordenada de migraciones. Añadir nuevas AL FINAL, nunca reordenar.
const MIGRACIONES: &[Migracion] = &[
    Migracion {
        version: 1,
        nombre: "001_inicial",
        sql: include_str!("migrations/001_inicial.sql"),
    },
    Migracion {
        version: 2,
        nombre: "002_credito_clientes",
        sql: include_str!("migrations/002_credito_clientes.sql"),
    },
    Migracion {
        version: 3,
        nombre: "003_metodo_reembolso",
        sql: include_str!("migrations/003_metodo_reembolso.sql"),
    },
    Migracion {
        version: 4,
        nombre: "004_costo_historico",
        sql: include_str!("migrations/004_costo_historico.sql"),
    },
    Migracion {
        version: 5,
        nombre: "005_tickets_espera",
        sql: include_str!("migrations/005_tickets_espera.sql"),
    },
    Migracion {
        version: 6,
        nombre: "006_kits",
        sql: include_str!("migrations/006_kits.sql"),
    },
    Migracion {
        version: 7,
        nombre: "007_tienda_ventas_web",
        sql: include_str!("migrations/007_tienda_ventas_web.sql"),
    },
];

/// Asegura que exista la tabla de control de versión.
fn asegurar_tabla_version(con: &Connection) -> Result<()> {
    con.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version    INTEGER PRIMARY KEY,
            nombre     TEXT NOT NULL,
            aplicada_en TEXT NOT NULL
        );",
    )
}

/// Devuelve la versión más alta ya aplicada (0 si la BD está virgen).
fn version_actual(con: &Connection) -> Result<i64> {
    let v: Option<i64> = con
        .query_row("SELECT MAX(version) FROM schema_version", [], |row| row.get(0))
        .unwrap_or(None);
    Ok(v.unwrap_or(0))
}

/// Aplica todas las migraciones pendientes en orden. Idempotente: si ya está al
/// día, no hace nada. Devuelve cuántas migraciones aplicó.
///
/// Nota sobre foreign_keys: algunas migraciones recrean tablas (patrón
/// crear-copiar-borrar-renombrar de SQLite, que ALTER no cubre para CHECKs).
/// SQLite ignora cambios a `foreign_keys` dentro de una transacción, así que
/// se desactivan ANTES de migrar y se reactivan DESPUÉS, con verificación de
/// integridad referencial al final.
pub fn aplicar_migraciones(con: &Connection) -> Result<usize> {
    asegurar_tabla_version(con)?;
    let actual = version_actual(con)?;
    let mut aplicadas = 0;

    // Desactivar FK fuera de transacción mientras migramos (necesario para
    // recreaciones de tabla). Se reactiva al final.
    con.pragma_update(None, "foreign_keys", "OFF")?;

    for m in MIGRACIONES {
        if m.version <= actual {
            continue;
        }
        con.execute_batch("BEGIN;")?;
        match con.execute_batch(m.sql) {
            Ok(_) => {
                con.execute(
                    "INSERT INTO schema_version (version, nombre, aplicada_en)
                     VALUES (?1, ?2, ?3)",
                    rusqlite::params![
                        m.version,
                        m.nombre,
                        chrono::Utc::now().to_rfc3339()
                    ],
                )?;
                con.execute_batch("COMMIT;")?;
                aplicadas += 1;
                println!("[migraciones] aplicada: {} (v{})", m.nombre, m.version);
            }
            Err(e) => {
                let _ = con.execute_batch("ROLLBACK;");
                let _ = con.pragma_update(None, "foreign_keys", "ON");
                eprintln!("[migraciones] FALLÓ {} (v{}): {e}", m.nombre, m.version);
                return Err(e);
            }
        }
    }

    // Reactivar FK y verificar integridad referencial tras las migraciones.
    con.pragma_update(None, "foreign_keys", "ON")?;
    let violaciones: i64 = con
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0))
        .unwrap_or(0);
    if violaciones > 0 {
        eprintln!("[migraciones] ADVERTENCIA: {violaciones} violaciones de FK tras migrar");
    }

    Ok(aplicadas)
}
