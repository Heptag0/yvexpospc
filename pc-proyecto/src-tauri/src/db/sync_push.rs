//! Sincronización PC -> VPS: vacía `cola_sync` hacia el servidor.
//!
//! Diseño (robusto y tolerante a cortes de internet):
//!   - Lee un lote de operaciones pendientes de `cola_sync` (las más viejas
//!     primero, respetando el orden en que se encolaron = orden transaccional).
//!   - Las manda al receptor genérico del VPS (POST /sync/lote) con el token
//!     del dispositivo.
//!   - Si el envío tiene éxito: BORRA esas filas de la cola (ya están en el VPS).
//!   - Si falla (sin internet, error del servidor): incrementa `intentos` y
//!     guarda `ultimo_error`; se reintentan en la siguiente pasada. NADA se
//!     pierde: la venta ya está en SQLite, solo espera para subir.
//!   - Es idempotente de punta a punta: si el lote llegó al VPS pero la
//!     respuesta se perdió, el reenvío no duplica (el VPS reconoce el lote_id).
//!
//! El PC nunca deja de vender por falta de internet: vender escribe en SQLite
//! (con su encolado); este módulo sube cuando puede.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Cuántas operaciones se mandan por lote. Un lote muy grande tarda; uno muy
/// chico hace muchas peticiones. 200 es un punto medio cómodo.
const TAM_LOTE: usize = 200;

/// Máximo de reintentos antes de marcar una fila como "problemática". No la
/// borra (no se pierde), pero deja de bloquear la cola en cada pasada.
const MAX_INTENTOS: i64 = 20;

/// URL del receptor. En producción: https://pos.yvexiq.com/sync/lote
const URL_SYNC: &str = "https://pos.yvexiq.com/sync/lote";

/// Credenciales del dispositivo, guardadas localmente tras la vinculación.
/// (Se leen de la config del POS; ver `credenciales_sync`.)
pub struct CredencialesSync {
    pub dispositivo_id: String,
    pub token: String,
}

/// Una operación pendiente, tal como vive en `cola_sync`.
#[derive(Debug, Serialize)]
struct Operacion {
    entidad: String,
    entidad_id: String,
    operacion: String,
    payload: Value,
}

#[derive(Debug, Serialize)]
struct Lote {
    lote_id: String,
    operaciones: Vec<Operacion>,
}

#[derive(Debug, Deserialize)]
struct RespuestaLote {
    ok: bool,
    #[allow(dead_code)]
    ya_procesado: bool,
    #[allow(dead_code)]
    aplicadas: i64,
}

/// Resultado de una pasada de sincronización.
#[derive(Debug, Default)]
pub struct ResultadoSync {
    pub enviadas: usize,
    pub pendientes_restantes: i64,
    pub hubo_error: bool,
    pub mensaje: String,
}

/// Lee las credenciales de sync desde la config local (tabla `config`).
/// Devuelve None si el dispositivo aún no está vinculado (no hay que sincronizar).
pub fn credenciales_sync(con: &Connection) -> Option<CredencialesSync> {
    let leer = |clave: &str| -> Option<String> {
        con.query_row(
            "SELECT valor FROM config WHERE clave = ?1",
            rusqlite::params![clave],
            |r| r.get::<_, String>(0),
        )
        .ok()
    };
    let dispositivo_id = leer("sync_dispositivo_id")?;
    let token = leer("sync_token")?;
    if dispositivo_id.is_empty() || token.is_empty() {
        return None;
    }
    Some(CredencialesSync { dispositivo_id, token })
}

/// Ejecuta UNA pasada de sincronización: toma un lote de la cola y lo sube.
/// Devuelve el resultado para que la UI pueda mostrar estado ("● Sincronizado"
/// / "● Sin conexión") en la barra de estado (la línea de vida).
///
/// Llamar: (a) periódicamente en un hilo de fondo, y (b) justo después de cada
/// venta, para el "casi instantáneo".
pub fn sincronizar_una_pasada(con: &Connection) -> ResultadoSync {
    let mut res = ResultadoSync::default();

    let cred = match credenciales_sync(con) {
        Some(c) => c,
        None => {
            // Dispositivo no vinculado: no es error, simplemente no hay sync.
            res.mensaje = "Dispositivo no vinculado".into();
            return res;
        }
    };

    // 1) Leer un lote de pendientes (los más viejos primero, saltando los que
    //    ya superaron el máximo de intentos para no atascar la cola).
    let pendientes = match leer_pendientes(con, MAX_INTENTOS, TAM_LOTE) {
        Ok(p) => p,
        Err(e) => {
            res.hubo_error = true;
            res.mensaje = format!("Error leyendo la cola: {e}");
            return res;
        }
    };

    if pendientes.is_empty() {
        res.mensaje = "Nada pendiente".into();
        res.pendientes_restantes = 0;
        return res;
    }

    let ids_cola: Vec<i64> = pendientes.iter().map(|(id, _)| *id).collect();
    let operaciones: Vec<Operacion> = pendientes.into_iter().map(|(_, op)| op).collect();

    // 2) Armar el lote con un id único (idempotencia: si reenviamos, el VPS lo
    //    reconoce y no duplica).
    let lote = Lote {
        lote_id: uuid::Uuid::new_v4().to_string(),
        operaciones,
    };

    // 3) Enviar al VPS.
    match enviar_lote(&cred, &lote) {
        Ok(_) => {
            // Éxito: borrar esas filas de la cola (ya están en el VPS).
            if let Err(e) = borrar_de_cola(con, &ids_cola) {
                res.hubo_error = true;
                res.mensaje = format!("Subió pero no se limpió la cola: {e}");
                return res;
            }
            res.enviadas = ids_cola.len();
            res.pendientes_restantes = contar_pendientes(con).unwrap_or(0);
            res.mensaje = "Sincronizado".into();
        }
        Err(e) => {
            // Falló: marcar intentos y guardar el error. Nada se pierde.
            let _ = marcar_fallo(con, &ids_cola, &e);
            res.hubo_error = true;
            res.pendientes_restantes = contar_pendientes(con).unwrap_or(0);
            res.mensaje = format!("Sin conexión ({e})");
        }
    }

    res
}

/// Lee hasta `limite` operaciones pendientes, en orden de encolado.
fn leer_pendientes(
    con: &Connection,
    max_intentos: i64,
    limite: usize,
) -> rusqlite::Result<Vec<(i64, Operacion)>> {
    let mut stmt = con.prepare(
        "SELECT id, entidad, entidad_id, operacion, payload
           FROM cola_sync
          WHERE intentos < ?1
          ORDER BY id ASC
          LIMIT ?2",
    )?;
    let filas = stmt.query_map(
        rusqlite::params![max_intentos, limite as i64],
        |row| {
            let id: i64 = row.get(0)?;
            let payload_txt: String = row.get(4)?;
            let payload: Value = serde_json::from_str(&payload_txt)
                .unwrap_or(Value::Null);
            Ok((
                id,
                Operacion {
                    entidad: row.get(1)?,
                    entidad_id: row.get(2)?,
                    operacion: row.get(3)?,
                    payload,
                },
            ))
        },
    )?;
    filas.collect()
}

/// Envía el lote por HTTPS. `ureq` es síncrono y ligero (no arrastra tokio).
fn enviar_lote(cred: &CredencialesSync, lote: &Lote) -> Result<RespuestaLote, String> {
    let cuerpo = serde_json::to_string(lote).map_err(|e| format!("serializar: {e}"))?;
    let resp = ureq::post(URL_SYNC)
        .set("Content-Type", "application/json")
        .set("X-Dispositivo-Id", &cred.dispositivo_id)
        .set("X-Dispositivo-Token", &cred.token)
        .timeout(std::time::Duration::from_secs(30))
        .send_string(&cuerpo);

    match resp {
        Ok(r) => {
            let parsed: RespuestaLote = r
                .into_json()
                .map_err(|e| format!("respuesta ilegible: {e}"))?;
            if parsed.ok {
                Ok(parsed)
            } else {
                Err("el servidor respondió ok=false".into())
            }
        }
        Err(ureq::Error::Status(code, r)) => {
            // 401 = credenciales malas; 4xx/5xx = problema del servidor.
            let detalle = r
                .into_string()
                .unwrap_or_else(|_| "sin detalle".into());
            Err(format!("HTTP {code}: {detalle}"))
        }
        Err(e) => Err(format!("red: {e}")), // sin internet, DNS, timeout...
    }
}

/// Borra de la cola las filas que ya subieron.
fn borrar_de_cola(con: &Connection, ids: &[i64]) -> rusqlite::Result<()> {
    let tx = con.unchecked_transaction()?;
    for id in ids {
        tx.execute("DELETE FROM cola_sync WHERE id = ?1", rusqlite::params![id])?;
    }
    tx.commit()
}

/// Marca un intento fallido en las filas del lote (incrementa contador, guarda error).
fn marcar_fallo(con: &Connection, ids: &[i64], error: &str) -> rusqlite::Result<()> {
    let tx = con.unchecked_transaction()?;
    // Guardar solo los primeros 300 chars del error para no inflar la BD.
    let err_corto: String = error.chars().take(300).collect();
    for id in ids {
        tx.execute(
            "UPDATE cola_sync SET intentos = intentos + 1, ultimo_error = ?2 WHERE id = ?1",
            rusqlite::params![id, err_corto],
        )?;
    }
    tx.commit()
}

fn contar_pendientes(con: &Connection) -> rusqlite::Result<i64> {
    con.query_row("SELECT COUNT(*) FROM cola_sync", [], |r| r.get(0))
}

/// Resetea el contador de intentos de TODA la cola. Útil cuando el servidor
/// estuvo caído o con un bug: las operaciones que agotaron sus reintentos
/// (intentos >= MAX_INTENTOS) quedaban bloqueadas; esto las reactiva para que
/// el siguiente sync las vuelva a intentar. Devuelve cuántas filas reactivó.
pub fn reintentar_todo(con: &Connection) -> Result<i64, String> {
    con.execute(
        "UPDATE cola_sync SET intentos = 0, ultimo_error = NULL WHERE intentos > 0",
        [],
    )
    .map_err(|e| format!("error al reiniciar intentos: {e}"))?;
    contar_pendientes(con).map_err(|e| e.to_string())
}