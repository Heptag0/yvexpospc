//! Vinculación del dispositivo con la nube (YvexPOS VPS).
//!
//! Flujo (estilo YouTube/TV), lado PC:
//!   1. `generar_codigo`  -> el PC pide un código corto al VPS y lo muestra.
//!   2. El dueño lo teclea en su app (ya autenticado) y lo reclama.
//!   3. `consultar_estado` -> el PC pregunta en bucle; cuando el dueño reclamó,
//!      recibe su token + id de dispositivo y los guarda en `config`.
//!
//! Tras vincular, quedan en `config`:
//!   - sync_dispositivo_id : id que el VPS asignó a esta caja
//!   - sync_token          : credencial para empujar (la lee sync_push.rs)
//!   - sync_negocio_id     : negocio al que pertenece (informativo)
//!
//! Estas claves son DISTINTAS del `dispositivo_id` local del onboarding: ese
//! identifica la instalación en SQLite; estos identifican la caja en la nube.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

/// Base del servicio en el VPS. Si algún día cambia el dominio, se toca aquí.
const BASE_URL: &str = "https://pos.yvexiq.com";

/// Respuesta de /vincular/generar.
#[derive(Debug, Deserialize)]
struct RespGenerar {
    codigo: String,
    expira_en: String,
}

/// Lo que se devuelve al frontend cuando se genera un código.
#[derive(Debug, Serialize)]
pub struct CodigoVinculacion {
    pub codigo: String,
    pub expira_en: String,
}

/// Respuesta de /vincular/estado/{codigo}.
#[derive(Debug, Deserialize)]
struct RespEstado {
    reclamado: bool,
    dispositivo_id: Option<String>,
    token: Option<String>,
    negocio_id: Option<String>,
}

/// Estado que ve el frontend al consultar.
#[derive(Debug, Serialize)]
pub struct EstadoVinculacion {
    /// "esperando" | "vinculado"
    pub estado: String,
    pub dispositivo_id: Option<String>,
    pub negocio_id: Option<String>,
}

/// Lee una clave de config (helper local, mismo patrón que config.rs).
fn get_config(con: &Connection, clave: &str) -> Option<String> {
    con.query_row(
        "SELECT valor FROM config WHERE clave = ?1",
        rusqlite::params![clave],
        |r| r.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
    .filter(|s| !s.is_empty())
}

/// Escribe una clave de config. NO se encola a sync: estas claves son locales
/// del dispositivo (credenciales), no deben viajar al VPS.
fn set_config(con: &Connection, clave: &str, valor: &str) -> Result<(), String> {
    con.execute(
        "INSERT INTO config (clave, valor) VALUES (?1, ?2)
         ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
        rusqlite::params![clave, valor],
    )
    .map_err(|e| format!("error al guardar {clave}: {e}"))?;
    Ok(())
}

/// ¿Ya está vinculada esta caja? (tiene token guardado)
pub fn ya_vinculado(con: &Connection) -> bool {
    get_config(con, "sync_dispositivo_id").is_some() && get_config(con, "sync_token").is_some()
}

/// Pide un código de vinculación al VPS y lo devuelve para mostrarlo.
/// `tipo` = "pc" (esta app de escritorio siempre es una caja PC).
pub fn generar_codigo(tipo: &str) -> Result<CodigoVinculacion, String> {
    let cuerpo = serde_json::json!({ "tipo": tipo }).to_string();
    let resp = ureq::post(&format!("{BASE_URL}/vincular/generar"))
        .set("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(20))
        .send_string(&cuerpo);

    match resp {
        Ok(r) => {
            let g: RespGenerar = r
                .into_json()
                .map_err(|e| format!("respuesta ilegible del servidor: {e}"))?;
            Ok(CodigoVinculacion { codigo: g.codigo, expira_en: g.expira_en })
        }
        Err(ureq::Error::Status(code, r)) => {
            let detalle = r.into_string().unwrap_or_default();
            Err(format!("El servidor rechazó la solicitud ({code}): {detalle}"))
        }
        Err(_) => Err("No hay conexión a internet para generar el código.".into()),
    }
}

/// Consulta si el código ya fue reclamado. Si sí, guarda las credenciales en
/// config y devuelve estado "vinculado". Si no, devuelve "esperando".
///
/// El frontend llama esto cada 2-3 segundos mientras muestra el código.
pub fn consultar_estado(con: &Connection, codigo: &str) -> Result<EstadoVinculacion, String> {
    let url = format!("{BASE_URL}/vincular/estado/{codigo}");
    let resp = ureq::get(&url)
        .timeout(std::time::Duration::from_secs(20))
        .call();

    match resp {
        Ok(r) => {
            let e: RespEstado = r
                .into_json()
                .map_err(|err| format!("respuesta ilegible: {err}"))?;

            if !e.reclamado {
                return Ok(EstadoVinculacion {
                    estado: "esperando".into(),
                    dispositivo_id: None,
                    negocio_id: None,
                });
            }

            // Reclamado: guardar credenciales. El token viene UNA sola vez.
            let disp = e.dispositivo_id
                .ok_or("el servidor no devolvió dispositivo_id")?;
            let token = e.token
                .ok_or("el token ya fue recogido antes (vinculación duplicada)")?;

            set_config(con, "sync_dispositivo_id", &disp)?;
            set_config(con, "sync_token", &token)?;
            if let Some(neg) = &e.negocio_id {
                set_config(con, "sync_negocio_id", neg)?;
            }

            Ok(EstadoVinculacion {
                estado: "vinculado".into(),
                dispositivo_id: Some(disp),
                negocio_id: e.negocio_id,
            })
        }
        Err(ureq::Error::Status(404, _)) => {
            Err("El código no existe o expiró. Genera uno nuevo.".into())
        }
        Err(ureq::Error::Status(410, _)) => {
            Err("El código expiró. Genera uno nuevo.".into())
        }
        Err(ureq::Error::Status(code, r)) => {
            let detalle = r.into_string().unwrap_or_default();
            Err(format!("Error del servidor ({code}): {detalle}"))
        }
        Err(_) => Err("Sin conexión. Reintentando…".into()),
    }
}

/// Desvincula la caja: borra las credenciales locales. (Para "cambiar de
/// cuenta" o resolver problemas.) No afecta al VPS; el dueño puede además
/// revocar el dispositivo desde su app.
pub fn desvincular(con: &Connection) -> Result<(), String> {
    con.execute(
        "DELETE FROM config WHERE clave IN ('sync_dispositivo_id','sync_token','sync_negocio_id','sesion_token')",
        [],
    )
    .map_err(|e| format!("error al desvincular: {e}"))?;
    Ok(())
}


// ---------------------------------------------------------------------------
// Crear cuenta / iniciar sesión + vinculación directa (sin código).
// Para cuando el dueño configura la nube DESDE ESTE MISMO PC.
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct SesionResp {
    token: String,
    dueno_id: String,
    nombre: String,
}

#[derive(Debug, Deserialize)]
struct VincularDirectoResp {
    dispositivo_id: String,
    token: String,
    negocio_id: String,
    prefijo_folio: String,
}

/// Registra una cuenta nueva y vincula este PC en un solo flujo.
/// Devuelve el nombre del dueño para saludarlo en la UI.
pub fn registrar_y_vincular(
    con: &Connection,
    email: &str,
    nombre: &str,
    password: &str,
    negocio_nombre: &str,
    nombre_caja: &str,
) -> Result<String, String> {
    let cuerpo = serde_json::json!({
        "email": email, "nombre": nombre, "password": password,
        "negocio_nombre": negocio_nombre,
    }).to_string();
    let sesion = post_sesion(&format!("{BASE_URL}/cuenta/registrar"), &cuerpo)?;
    vincular_con_sesion(con, &sesion.token, nombre_caja)?;
    Ok(sesion.nombre)
}

/// Inicia sesión con una cuenta existente y vincula este PC.
pub fn login_y_vincular(
    con: &Connection,
    email: &str,
    password: &str,
    nombre_caja: &str,
) -> Result<String, String> {
    let cuerpo = serde_json::json!({ "email": email, "password": password }).to_string();
    let sesion = post_sesion(&format!("{BASE_URL}/cuenta/login"), &cuerpo)?;
    vincular_con_sesion(con, &sesion.token, nombre_caja)?;
    Ok(sesion.nombre)
}

/// Hace un POST que devuelve una sesión (registrar o login), con manejo de error.
fn post_sesion(url: &str, cuerpo: &str) -> Result<SesionResp, String> {
    let resp = ureq::post(url)
        .set("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(20))
        .send_string(cuerpo);
    match resp {
        Ok(r) => r.into_json::<SesionResp>()
            .map_err(|e| format!("respuesta ilegible: {e}")),
        Err(ureq::Error::Status(code, r)) => {
            let detalle = leer_detalle(r);
            Err(detalle.unwrap_or_else(|| format!("Error del servidor ({code})")))
        }
        Err(_) => Err("Sin conexión a internet.".into()),
    }
}

/// Con un token de sesión, vincula este dispositivo directo y guarda las
/// credenciales en config (igual que el flujo de código).
fn vincular_con_sesion(con: &Connection, token: &str, nombre_caja: &str) -> Result<(), String> {
    // Guardar el token de sesión del dueño: lo necesitan las acciones de cuenta
    // (verificar correo, reenviar código). Es distinto del token de dispositivo.
    set_config(con, "sesion_token", token)?;
    let cuerpo = serde_json::json!({
        "nombre_caja": nombre_caja, "tipo": "pc",
    }).to_string();
    let resp = ureq::post(&format!("{BASE_URL}/vincular/directo"))
        .set("Content-Type", "application/json")
        .set("Authorization", &format!("Bearer {token}"))
        .timeout(std::time::Duration::from_secs(20))
        .send_string(&cuerpo);
    match resp {
        Ok(r) => {
            let v: VincularDirectoResp = r.into_json()
                .map_err(|e| format!("respuesta ilegible: {e}"))?;
            set_config(con, "sync_dispositivo_id", &v.dispositivo_id)?;
            set_config(con, "sync_token", &v.token)?;
            set_config(con, "sync_negocio_id", &v.negocio_id)?;
            Ok(())
        }
        Err(ureq::Error::Status(code, r)) => {
            let detalle = leer_detalle(r);
            Err(detalle.unwrap_or_else(|| format!("Error al vincular ({code})")))
        }
        Err(_) => Err("Sin conexión al vincular.".into()),
    }
}

/// Extrae el campo "detail" de una respuesta de error de FastAPI, si lo hay.
fn leer_detalle(r: ureq::Response) -> Option<String> {
    let texto = r.into_string().ok()?;
    let v: serde_json::Value = serde_json::from_str(&texto).ok()?;
    v.get("detail").and_then(|d| d.as_str()).map(|s| s.to_string())
}


// ---------------------------------------------------------------------------
// Verificación de correo (usa el token de sesión guardado al vincular).
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct EstadoCuenta {
    pub vinculado: bool,
    pub email: Option<String>,
    pub verificado: bool,
}

/// Lee el token de sesión guardado. None si no hay (no vinculado por cuenta).
fn sesion_token(con: &Connection) -> Option<String> {
    get_config(con, "sesion_token")
}

/// Consulta el estado de la cuenta: vinculado, correo, y si está verificado.
/// Si no hay sesión o no hay internet, devuelve lo que se pueda (offline-safe).
pub fn estado_cuenta(con: &Connection) -> EstadoCuenta {
    let vinculado = ya_vinculado(con);
    let token = match sesion_token(con) {
        Some(t) => t,
        None => return EstadoCuenta { vinculado, email: None, verificado: false },
    };
    let resp = ureq::get(&format!("{BASE_URL}/cuenta/verificar/estado"))
        .set("Authorization", &format!("Bearer {token}"))
        .timeout(std::time::Duration::from_secs(15))
        .call();
    match resp {
        Ok(r) => {
            #[derive(Deserialize)]
            struct E { email: String, verificado: bool }
            match r.into_json::<E>() {
                Ok(e) => EstadoCuenta { vinculado, email: Some(e.email), verificado: e.verificado },
                Err(_) => EstadoCuenta { vinculado, email: None, verificado: false },
            }
        }
        // Sin conexión o error: no bloquea, solo informa lo que hay.
        Err(_) => EstadoCuenta { vinculado, email: None, verificado: false },
    }
}

/// Reenvía el código de verificación al correo de la cuenta.
pub fn verificar_enviar(con: &Connection) -> Result<String, String> {
    let token = sesion_token(con).ok_or("No hay sesión activa en esta caja.")?;
    let resp = ureq::post(&format!("{BASE_URL}/cuenta/verificar/enviar"))
        .set("Authorization", &format!("Bearer {token}"))
        .timeout(std::time::Duration::from_secs(20))
        .call();
    match resp {
        Ok(_) => Ok("Te enviamos un código a tu correo.".into()),
        Err(ureq::Error::Status(_, r)) => Err(leer_detalle(r).unwrap_or_else(|| "Error al enviar.".into())),
        Err(_) => Err("Sin conexión a internet.".into()),
    }
}

/// Confirma el código de verificación de 6 dígitos.
pub fn verificar_confirmar(con: &Connection, codigo: &str) -> Result<String, String> {
    let token = sesion_token(con).ok_or("No hay sesión activa en esta caja.")?;
    let cuerpo = serde_json::json!({ "codigo": codigo }).to_string();
    let resp = ureq::post(&format!("{BASE_URL}/cuenta/verificar/confirmar"))
        .set("Content-Type", "application/json")
        .set("Authorization", &format!("Bearer {token}"))
        .timeout(std::time::Duration::from_secs(20))
        .send_string(&cuerpo);
    match resp {
        Ok(_) => Ok("¡Correo verificado!".into()),
        Err(ureq::Error::Status(_, r)) => Err(leer_detalle(r).unwrap_or_else(|| "Código incorrecto.".into())),
        Err(_) => Err("Sin conexión a internet.".into()),
    }
}

/// Corrige el correo (si se escribió mal) y manda un código nuevo.
pub fn verificar_cambiar_email(con: &Connection, email_nuevo: &str) -> Result<String, String> {
    let token = sesion_token(con).ok_or("No hay sesión activa en esta caja.")?;
    let cuerpo = serde_json::json!({ "email_nuevo": email_nuevo }).to_string();
    let resp = ureq::post(&format!("{BASE_URL}/cuenta/verificar/cambiar-email"))
        .set("Content-Type", "application/json")
        .set("Authorization", &format!("Bearer {token}"))
        .timeout(std::time::Duration::from_secs(20))
        .send_string(&cuerpo);
    match resp {
        Ok(r) => {
            #[derive(Deserialize)]
            struct R { email: String }
            match r.into_json::<R>() {
                Ok(x) => Ok(x.email),
                Err(_) => Ok(email_nuevo.to_string()),
            }
        }
        Err(ureq::Error::Status(_, r)) => Err(leer_detalle(r).unwrap_or_else(|| "Error al cambiar correo.".into())),
        Err(_) => Err("Sin conexión a internet.".into()),
    }
}
