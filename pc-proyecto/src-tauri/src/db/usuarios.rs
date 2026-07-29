//! Usuarios de caja (`usuarios_pos`): hash de PIN y alta.
//!
//! Invariantes del plano (references/modulos.md → Usuarios):
//!   - ⚠️ Login por PIN con hash (argon2). Nunca PIN en claro en BD ni logs.
//!   - Roles: dueno | gerente | cajero.
//!
//! El PIN se valida como 4 a 6 dígitos antes de hashear.

use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::comun::{ahora, encolar_sync, nuevo_id};

/// Roles válidos. Coincide con el CHECK del esquema.
pub const ROLES_VALIDOS: [&str; 3] = ["dueno", "gerente", "cajero"];

/// Datos para crear un usuario de caja.
#[derive(Debug, Deserialize)]
pub struct NuevoUsuario {
    pub nombre: String,
    pub pin: String,
    pub rol: String,
}

/// Representación segura de un usuario para devolver al frontend (sin pin_hash).
#[derive(Debug, Serialize)]
pub struct UsuarioPublico {
    pub id: String,
    pub nombre: String,
    pub rol: String,
    pub activo: bool,
}

/// Valida que el PIN sea de 4 a 6 dígitos numéricos.
pub fn validar_pin(pin: &str) -> Result<(), String> {
    let largo = pin.chars().count();
    if largo < 4 || largo > 6 {
        return Err("El PIN debe tener entre 4 y 6 dígitos.".into());
    }
    if !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err("El PIN solo puede contener dígitos.".into());
    }
    Ok(())
}

/// Hashea un PIN con argon2. Devuelve la cadena PHC completa (incluye sal).
pub fn hashear_pin(pin: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(pin.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("error al hashear el PIN: {e}"))
}

/// Verifica un PIN contra un hash almacenado.
pub fn verificar_pin(pin: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(pin.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

/// Crea un usuario dentro de una transacción ya abierta. No hace commit.
/// Valida nombre, PIN y rol. Encola el registro para sync.
pub fn crear_usuario_en_tx(
    con: &Connection,
    dispositivo_id: &str,
    datos: &NuevoUsuario,
) -> Result<UsuarioPublico, String> {
    let nombre = datos.nombre.trim();
    if nombre.is_empty() {
        return Err("El nombre no puede estar vacío.".into());
    }
    if !ROLES_VALIDOS.contains(&datos.rol.as_str()) {
        return Err(format!("Rol inválido: {}", datos.rol));
    }
    validar_pin(&datos.pin)?;

    let id = nuevo_id();
    let pin_hash = hashear_pin(&datos.pin)?;
    let ts = ahora();

    con.execute(
        "INSERT INTO usuarios_pos
           (id, nombre, pin_hash, rol, activo, creado_en, actualizado_en, eliminado, dispositivo_id)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5, 0, ?6)",
        rusqlite::params![id, nombre, pin_hash, datos.rol, ts, dispositivo_id],
    )
    .map_err(|e| format!("error al crear usuario: {e}"))?;

    // El pin_hash sí viaja al sync (es hash, no PIN en claro); el VPS lo necesita
    // para login en otras cajas de la misma cuenta.
    let payload = serde_json::json!({
        "id": id,
        "nombre": nombre,
        "pin_hash": pin_hash,
        "rol": datos.rol,
        "activo": 1,
        "creado_en": ts,
        "actualizado_en": ts,
        "eliminado": 0,
        "dispositivo_id": dispositivo_id,
    });
    encolar_sync(con, "usuarios_pos", &id, "insert", &payload)
        .map_err(|e| format!("error al encolar sync de usuario: {e}"))?;

    Ok(UsuarioPublico {
        id,
        nombre: nombre.to_string(),
        rol: datos.rol.clone(),
        activo: true,
    })
}

/// Lista los usuarios activos (no eliminados) con solo datos públicos.
/// NUNCA devuelve pin_hash. Ordena: dueño primero, luego gerentes, luego cajeros.
pub fn listar_usuarios(con: &Connection) -> Result<Vec<UsuarioPublico>, String> {
    let mut stmt = con
        .prepare(
            "SELECT id, nombre, rol, activo
             FROM usuarios_pos
             WHERE eliminado = 0 AND activo = 1
             ORDER BY CASE rol
                        WHEN 'dueno' THEN 0
                        WHEN 'gerente' THEN 1
                        ELSE 2
                      END,
                      nombre COLLATE NOCASE",
        )
        .map_err(|e| format!("error al preparar consulta de usuarios: {e}"))?;

    let filas = stmt
        .query_map([], |row| {
            Ok(UsuarioPublico {
                id: row.get(0)?,
                nombre: row.get(1)?,
                rol: row.get(2)?,
                activo: row.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(|e| format!("error al consultar usuarios: {e}"))?;

    let mut out = Vec::new();
    for f in filas {
        out.push(f.map_err(|e| format!("error al leer usuario: {e}"))?);
    }
    Ok(out)
}

/// Verifica el PIN de un usuario por su id. Devuelve el usuario público si el
/// PIN coincide, o un error genérico si no (no revela si el id existe).
pub fn login(con: &Connection, usuario_id: &str, pin: &str) -> Result<UsuarioPublico, String> {
    let fila: Option<(String, String, String, i64, i64)> = con
        .query_row(
            "SELECT nombre, rol, pin_hash, activo, eliminado
             FROM usuarios_pos WHERE id = ?1",
            rusqlite::params![usuario_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(|e| format!("error al consultar usuario: {e}"))?;

    // Mensaje genérico en todos los caminos de fallo: no filtramos si el id
    // existe, si está inactivo, o si el PIN está mal. Todo es "no coincide".
    let err_generico = || "PIN incorrecto. Intenta de nuevo.".to_string();

    let (nombre, rol, pin_hash, activo, eliminado) = match fila {
        Some(f) => f,
        None => return Err(err_generico()),
    };
    if eliminado != 0 || activo == 0 {
        return Err(err_generico());
    }
    if !verificar_pin(pin, &pin_hash) {
        return Err(err_generico());
    }

    Ok(UsuarioPublico {
        id: usuario_id.to_string(),
        nombre,
        rol,
        activo: true,
    })
}

// ----------------------------------------------------------------------------
// Gestión de usuarios (para la pantalla de Cajeros en Configuración).
// ----------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
pub struct EditarUsuario {
    pub id: String,
    pub nombre: String,
    pub rol: String,
    /// Si viene un PIN nuevo (4-6 dígitos), se actualiza. Si es None, se conserva.
    pub pin: Option<String>,
}

/// Crea un usuario (versión fuera de transacción, para la pantalla de gestión).
pub fn crear_usuario(con: &Connection, dispositivo_id: &str, datos: &NuevoUsuario) -> Result<UsuarioPublico, String> {
    crear_usuario_en_tx(con, dispositivo_id, datos)
}

/// Edita nombre, rol y opcionalmente el PIN de un usuario.
pub fn editar_usuario(con: &Connection, d: &EditarUsuario) -> Result<(), String> {
    let nombre = d.nombre.trim();
    if nombre.is_empty() {
        return Err("El nombre no puede estar vacío.".into());
    }
    if !ROLES_VALIDOS.contains(&d.rol.as_str()) {
        return Err(format!("Rol inválido: {}", d.rol));
    }
    let ts = ahora();

    // Si cambia el rol y este usuario es el ÚLTIMO dueño, no permitir degradarlo
    // (la tienda quedaría sin dueño).
    let rol_actual: Option<String> = con
        .query_row(
            "SELECT rol FROM usuarios_pos WHERE id=?1 AND eliminado=0",
            rusqlite::params![d.id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("error al leer usuario: {e}"))?;
    let rol_actual = rol_actual.ok_or_else(|| "No se encontró el usuario.".to_string())?;
    if rol_actual == "dueno" && d.rol != "dueno" && es_ultimo_dueno(con, &d.id)? {
        return Err("No puedes quitar el rol de dueño al único dueño.".into());
    }

    if let Some(pin) = &d.pin {
        if !pin.trim().is_empty() {
            validar_pin(pin)?;
            let pin_hash = hashear_pin(pin)?;
            con.execute(
                "UPDATE usuarios_pos SET nombre=?2, rol=?3, pin_hash=?4, actualizado_en=?5 WHERE id=?1",
                rusqlite::params![d.id, nombre, d.rol, pin_hash, ts],
            )
            .map_err(|e| format!("error al editar usuario: {e}"))?;
        } else {
            con.execute(
                "UPDATE usuarios_pos SET nombre=?2, rol=?3, actualizado_en=?4 WHERE id=?1",
                rusqlite::params![d.id, nombre, d.rol, ts],
            )
            .map_err(|e| format!("error al editar usuario: {e}"))?;
        }
    } else {
        con.execute(
            "UPDATE usuarios_pos SET nombre=?2, rol=?3, actualizado_en=?4 WHERE id=?1",
            rusqlite::params![d.id, nombre, d.rol, ts],
        )
        .map_err(|e| format!("error al editar usuario: {e}"))?;
    }

    let payload = serde_json::json!({ "id": d.id, "nombre": nombre, "rol": d.rol, "actualizado_en": ts });
    encolar_sync(con, "usuarios_pos", &d.id, "update", &payload)
        .map_err(|e| format!("error al encolar usuario: {e}"))?;
    Ok(())
}

/// Elimina (soft) un usuario. No deja eliminar al último dueño.
pub fn eliminar_usuario(con: &Connection, id: &str) -> Result<(), String> {
    let rol: Option<String> = con
        .query_row(
            "SELECT rol FROM usuarios_pos WHERE id=?1 AND eliminado=0",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("error al leer usuario: {e}"))?;
    let rol = rol.ok_or_else(|| "No se encontró el usuario.".to_string())?;
    if rol == "dueno" && es_ultimo_dueno(con, id)? {
        return Err("No puedes eliminar al único dueño del negocio.".into());
    }
    let ts = ahora();
    con.execute(
        "UPDATE usuarios_pos SET eliminado=1, activo=0, actualizado_en=?2 WHERE id=?1",
        rusqlite::params![id, ts],
    )
    .map_err(|e| format!("error al eliminar usuario: {e}"))?;
    let payload = serde_json::json!({ "id": id, "eliminado": 1, "activo": 0, "actualizado_en": ts });
    encolar_sync(con, "usuarios_pos", id, "update", &payload)
        .map_err(|e| format!("error al encolar baja de usuario: {e}"))?;
    Ok(())
}

/// True si `id` es el único dueño activo que queda.
fn es_ultimo_dueno(con: &Connection, id: &str) -> Result<bool, String> {
    let otros: i64 = con
        .query_row(
            "SELECT COUNT(*) FROM usuarios_pos WHERE rol='dueno' AND eliminado=0 AND id != ?1",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .map_err(|e| format!("error al contar dueños: {e}"))?;
    Ok(otros == 0)
}
