//! Configuración del negocio (tabla `config`, clave-valor).
//!
//! Lee y escribe los ajustes que el dueño puede cambiar después del onboarding:
//! datos del negocio (nombre, dirección, teléfono), fiscales (RFC, régimen, CP),
//! e IVA por defecto. La tabla es clave-valor para mantener flexibilidad.
//!
//! El IVA configurable resuelve lo que dejamos pendiente: los productos nacen
//! con iva_tasa=0; aquí el negocio define su tasa por país (16% MX / 21% ES /
//! 0 = desactivado), que la venta aplicará en el futuro.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::comun::encolar_sync;

/// Snapshot de toda la configuración del negocio para el frontend.
#[derive(Debug, Serialize, Default)]
pub struct Configuracion {
    pub negocio_nombre: String,
    pub negocio_direccion: String,
    pub negocio_telefono: String,
    pub negocio_rfc: String,
    pub negocio_regimen_fiscal: String,
    pub negocio_codigo_postal: String,
    pub iva_tasa: i64,           // 0, 16, 21… (porcentaje)
    pub moneda: String,          // "MXN", "EUR", "USD"
    pub mensaje_ticket: String,  // pie del ticket ("¡Gracias por su compra!")
}

#[derive(Debug, Deserialize)]
pub struct ConfiguracionEntrada {
    pub negocio_nombre: String,
    pub negocio_direccion: Option<String>,
    pub negocio_telefono: Option<String>,
    pub negocio_rfc: Option<String>,
    pub negocio_regimen_fiscal: Option<String>,
    pub negocio_codigo_postal: Option<String>,
    pub iva_tasa: i64,
    pub moneda: Option<String>,
    pub mensaje_ticket: Option<String>,
}

const IVA_VALIDOS: [i64; 4] = [0, 16, 21, 8];

fn get(con: &Connection, clave: &str) -> String {
    con.query_row(
        "SELECT valor FROM config WHERE clave = ?1",
        rusqlite::params![clave],
        |r| r.get::<_, Option<String>>(0),
    )
    .optional()
    .ok()
    .flatten()
    .flatten()
    .unwrap_or_default()
}

fn set(con: &Connection, clave: &str, valor: &str) -> Result<(), String> {
    con.execute(
        "INSERT INTO config (clave, valor) VALUES (?1, ?2)
         ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
        rusqlite::params![clave, valor],
    )
    .map_err(|e| format!("error al guardar {clave}: {e}"))?;
    let payload = serde_json::json!({ "clave": clave, "valor": valor });
    encolar_sync(con, "config", clave, "update", &payload)
        .map_err(|e| format!("error al encolar {clave}: {e}"))?;
    Ok(())
}

/// Lee toda la configuración actual.
pub fn leer(con: &Connection) -> Result<Configuracion, String> {
    let iva_str = get(con, "iva_tasa");
    let iva = iva_str.parse::<i64>().unwrap_or(0);
    let moneda = {
        let m = get(con, "moneda");
        if m.is_empty() { "MXN".to_string() } else { m }
    };
    Ok(Configuracion {
        negocio_nombre: get(con, "negocio_nombre"),
        negocio_direccion: get(con, "negocio_direccion"),
        negocio_telefono: get(con, "negocio_telefono"),
        negocio_rfc: get(con, "negocio_rfc"),
        negocio_regimen_fiscal: get(con, "negocio_regimen_fiscal"),
        negocio_codigo_postal: get(con, "negocio_codigo_postal"),
        iva_tasa: iva,
        moneda,
        mensaje_ticket: get(con, "mensaje_ticket"),
    })
}

/// Guarda la configuración. Valida nombre no vacío e IVA en rango conocido.
pub fn guardar(con: &Connection, c: &ConfiguracionEntrada) -> Result<(), String> {
    let nombre = c.negocio_nombre.trim();
    if nombre.is_empty() {
        return Err("El nombre del negocio no puede estar vacío.".into());
    }
    if !IVA_VALIDOS.contains(&c.iva_tasa) {
        return Err(format!("Tasa de IVA no soportada: {}%.", c.iva_tasa));
    }

    let limpio = |o: &Option<String>| o.as_deref().map(str::trim).unwrap_or("").to_string();

    set(con, "negocio_nombre", nombre)?;
    set(con, "negocio_direccion", &limpio(&c.negocio_direccion))?;
    set(con, "negocio_telefono", &limpio(&c.negocio_telefono))?;
    set(con, "negocio_rfc", &limpio(&c.negocio_rfc))?;
    set(con, "negocio_regimen_fiscal", &limpio(&c.negocio_regimen_fiscal))?;
    set(con, "negocio_codigo_postal", &limpio(&c.negocio_codigo_postal))?;
    set(con, "iva_tasa", &c.iva_tasa.to_string())?;
    let moneda = c.moneda.as_deref().unwrap_or("MXN");
    set(con, "moneda", if moneda.is_empty() { "MXN" } else { moneda })?;
    set(con, "mensaje_ticket", &limpio(&c.mensaje_ticket))?;
    Ok(())
}

// ----------------------------------------------------------------------------
// API genérica clave-valor: leer todo y guardar un mapa de claves.
// Permite que el frontend maneje cualquier opción de config (impresora, tema,
// formas de pago, etc.) sin tener que añadir campos fijos en Rust cada vez.
// ----------------------------------------------------------------------------

use std::collections::HashMap;

/// Lee TODAS las claves de config como un mapa clave->valor.
pub fn leer_todo(con: &Connection) -> Result<HashMap<String, String>, String> {
    let mut stmt = con
        .prepare("SELECT clave, valor FROM config")
        .map_err(|e| format!("error al preparar config: {e}"))?;
    let filas = stmt
        .query_map([], |r| {
            let clave: String = r.get(0)?;
            let valor: Option<String> = r.get(1)?;
            Ok((clave, valor.unwrap_or_default()))
        })
        .map_err(|e| format!("error al leer config: {e}"))?;
    let mut mapa = HashMap::new();
    for f in filas {
        let (k, v) = f.map_err(|e| format!("error fila config: {e}"))?;
        mapa.insert(k, v);
    }
    Ok(mapa)
}

/// Guarda un mapa de claves. Cada par se escribe (o actualiza) y se encola.
/// Las claves reservadas no se pueden sobrescribir por esta vía.
pub fn guardar_claves(con: &Connection, claves: &HashMap<String, String>) -> Result<(), String> {
    const RESERVADAS: [&str; 1] = ["dispositivo_id"];
    for (clave, valor) in claves {
        if RESERVADAS.contains(&clave.as_str()) {
            continue; // proteger claves de sistema
        }
        set(con, clave, valor)?;
    }
    Ok(())
}

// ============================================================================
// Configuración de impuesto (genérico: IVA / Sales Tax / IEPS…)
// ============================================================================

use super::impuestos::ConfigImpuesto;

/// Lee la configuración de impuesto desde las claves de `config`.
/// Por defecto: desactivado, nombre "Impuesto", modo "incluido", tasa 0.
pub fn leer_impuesto(con: &Connection) -> ConfigImpuesto {
    let activo = get(con, "impuesto_activo") == "1";
    let nombre = {
        let n = get(con, "impuesto_nombre");
        if n.is_empty() { "Impuesto".to_string() } else { n }
    };
    let modo = {
        let m = get(con, "impuesto_modo");
        if m == "agregado" { "agregado".to_string() } else { "incluido".to_string() }
    };
    // tasa general en puntos base (1600 = 16%).
    let tasa_general = get(con, "impuesto_tasa").parse::<i64>().unwrap_or(0);

    ConfigImpuesto { activo, nombre, modo, tasa_general }
}
