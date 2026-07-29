//! Onboarding de primer arranque.
//!
//! El esquema nace sin datos. Antes de poder vender, el POS necesita:
//!   1. un `dispositivo` (esta caja),
//!   2. un `usuario_pos` rol `dueno` (con PIN hasheado),
//!   3. config básica (`negocio_nombre`, y campos fiscales opcionales).
//!
//! Todo se crea en UNA transacción: o queda la caja entera configurada, o nada.
//! Si la transacción falla a medias, no deja un dispositivo sin dueño.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::comun::{ahora, encolar_sync, nuevo_id};
use super::usuarios::{crear_usuario_en_tx, validar_pin, NuevoUsuario, UsuarioPublico};

/// ¿Ya fue configurado este POS? True si existe al menos un dispositivo.
pub fn ya_configurado(con: &Connection) -> Result<bool, String> {
    let n: i64 = con
        .query_row("SELECT COUNT(*) FROM dispositivos", [], |r| r.get(0))
        .map_err(|e| format!("error al consultar dispositivos: {e}"))?;
    Ok(n > 0)
}

/// Datos del negocio para el arranque. Los fiscales son opcionales (CFDI futuro).
#[derive(Debug, Deserialize)]
pub struct DatosNegocio {
    pub nombre: String,
    pub rfc: Option<String>,
    pub regimen_fiscal: Option<String>,
    pub codigo_postal: Option<String>,
}

/// Payload completo del onboarding desde el frontend.
#[derive(Debug, Deserialize)]
pub struct PayloadOnboarding {
    pub nombre_dispositivo: String, // "Caja 1", "Mostrador"
    pub negocio: DatosNegocio,
    pub dueno: NuevoUsuario,         // su rol debe ser "dueno" (se fuerza)
    pub otros_usuarios: Vec<NuevoUsuario>, // cajeros/gerentes opcionales
}

/// Resultado devuelto al frontend tras configurar.
#[derive(Debug, Serialize)]
pub struct ResultadoOnboarding {
    pub dispositivo_id: String,
    pub usuarios: Vec<UsuarioPublico>,
}

/// Guarda un par clave/valor en `config` y lo encola para sync.
fn set_config(con: &Connection, clave: &str, valor: &str) -> Result<(), String> {
    con.execute(
        "INSERT INTO config (clave, valor) VALUES (?1, ?2)
         ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
        rusqlite::params![clave, valor],
    )
    .map_err(|e| format!("error al guardar config {clave}: {e}"))?;
    let payload = serde_json::json!({ "clave": clave, "valor": valor });
    encolar_sync(con, "config", clave, "update", &payload)
        .map_err(|e| format!("error al encolar config {clave}: {e}"))?;
    Ok(())
}

/// Ejecuta el primer arranque. `con` debe ser mutable para abrir la transacción.
pub fn ejecutar_onboarding(
    con: &mut Connection,
    p: PayloadOnboarding,
) -> Result<ResultadoOnboarding, String> {
    if ya_configurado(con)? {
        return Err("Este POS ya fue configurado.".into());
    }

    // Validaciones que NO requieren tocar la BD, antes de abrir transacción.
    if p.nombre_dispositivo.trim().is_empty() {
        return Err("El nombre de la caja no puede estar vacío.".into());
    }
    if p.negocio.nombre.trim().is_empty() {
        return Err("El nombre del negocio no puede estar vacío.".into());
    }
    validar_pin(&p.dueno.pin)?;

    let tx = con
        .transaction()
        .map_err(|e| format!("no se pudo abrir transacción: {e}"))?;

    let dispositivo_id = nuevo_id();
    let ts = ahora();

    // 1. Dispositivo.
    tx.execute(
        "INSERT INTO dispositivos (id, nombre, negocio_id, creado_en, actualizado_en)
         VALUES (?1, ?2, NULL, ?3, ?3)",
        rusqlite::params![dispositivo_id, p.nombre_dispositivo.trim(), ts],
    )
    .map_err(|e| format!("error al crear dispositivo: {e}"))?;

    {
        let payload = serde_json::json!({
            "id": dispositivo_id,
            "nombre": p.nombre_dispositivo.trim(),
            "negocio_id": null,
            "creado_en": ts,
            "actualizado_en": ts,
        });
        encolar_sync(&tx, "dispositivos", &dispositivo_id, "insert", &payload)
            .map_err(|e| format!("error al encolar dispositivo: {e}"))?;
    }

    // 2. Dueño (se fuerza el rol, sin importar lo que mande el frontend).
    let dueno_datos = NuevoUsuario {
        nombre: p.dueno.nombre.clone(),
        pin: p.dueno.pin.clone(),
        rol: "dueno".to_string(),
    };
    let mut usuarios = Vec::new();
    usuarios.push(crear_usuario_en_tx(&tx, &dispositivo_id, &dueno_datos)?);

    // 3. Otros usuarios (cajeros/gerentes). No pueden ser "dueno" desde aquí.
    for u in &p.otros_usuarios {
        if u.rol == "dueno" {
            return Err("Solo puede haber un dueño en el arranque.".into());
        }
        usuarios.push(crear_usuario_en_tx(&tx, &dispositivo_id, u)?);
    }

    // 4. Config del negocio.
    set_config(&tx, "negocio_nombre", p.negocio.nombre.trim())?;
    if let Some(rfc) = p.negocio.rfc.as_deref().filter(|s| !s.trim().is_empty()) {
        set_config(&tx, "negocio_rfc", rfc.trim())?;
    }
    if let Some(reg) = p
        .negocio
        .regimen_fiscal
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        set_config(&tx, "negocio_regimen_fiscal", reg.trim())?;
    }
    if let Some(cp) = p
        .negocio
        .codigo_postal
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        set_config(&tx, "negocio_codigo_postal", cp.trim())?;
    }
    // Tema por defecto del plano.
    set_config(&tx, "tema", "oscuro")?;
    // Guardamos qué dispositivo es ESTE, para identificarlo en arranques futuros.
    set_config(&tx, "dispositivo_id", &dispositivo_id)?;

    tx.commit()
        .map_err(|e| format!("error al confirmar el arranque: {e}"))?;

    Ok(ResultadoOnboarding {
        dispositivo_id,
        usuarios,
    })
}
