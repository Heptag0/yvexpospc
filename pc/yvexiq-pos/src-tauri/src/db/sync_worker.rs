//! Integración del empujador de sincronización con la app.
//!
//! Tres formas de disparar el sync, combinadas para robustez:
//!   1. Tras cada venta   -> inmediatez ("casi instantáneo").
//!   2. Hilo periódico    -> red de seguridad: vacía lo atascado por cortes.
//!   3. Comando manual     -> botón "Sincronizar ahora" para el dueño.
//!
//! Principio: el sync NUNCA debe hacer fallar ni ralentizar una venta. Por eso
//! el disparo tras venta es "dispara y olvida" en un hilo aparte, y el hilo de
//! fondo abre su PROPIA conexión a SQLite (no comparte el Mutex de la venta),
//! así jamás compite por el candado con la caja registrando ventas.

use std::path::PathBuf;
use std::sync::mpsc::{Receiver, Sender};
use std::time::Duration;

use rusqlite::Connection;

use super::sync_push::sincronizar_una_pasada;
use super::sync_pull::bajar_todo;

/// Ejecuta un ciclo completo: SUBE primero (lo nuestro ya cuenta en la nube)
/// y BAJA después (el stock que llega ya refleja todas las cajas, incluida
/// esta). El orden importa: invertirlo dejaría el stock local inflado.
fn ciclo_sync(con: &Connection) {
    let r = sincronizar_una_pasada(con);
    if r.hubo_error {
        // No es grave: quedará para el próximo ciclo. Solo log.
        eprintln!("[sync] subida: {}", r.mensaje);
    }
    match bajar_todo(con) {
        Ok(b) => {
            if b.aplicados > 0 {
                println!("[sync] bajada: {}", b.mensaje);
            }
        }
        Err(e) => eprintln!("[sync] bajada: {e}"),
    }
}

/// Cada cuánto corre el hilo de respaldo (segundos). 30s es un buen balance:
/// frecuente para sentirse "vivo", sin martillar el servidor.
const INTERVALO_RESPALDO_SEG: u64 = 30;

/// Abre una conexión nueva a la misma base de datos. La usa el hilo de fondo
/// para no compartir el Mutex de la conexión principal (la de las ventas).
fn abrir_conexion(ruta: &PathBuf) -> rusqlite::Result<Connection> {
    let con = Connection::open(ruta)?;
    // WAL permite lecturas/escrituras concurrentes sin bloquear tanto; el POS
    // ya debería usarlo, pero lo aseguramos para el acceso desde este hilo.
    let _ = con.pragma_update(None, "journal_mode", "WAL");
    let _ = con.busy_timeout(Duration::from_secs(5));
    Ok(con)
}

/// Señal para pedirle al hilo de fondo que sincronice YA (tras una venta),
/// sin esperar al siguiente ciclo. El canal permite "empujar" el sync.
pub enum SenalSync {
    /// Sincroniza ahora mismo (se manda tras cada venta).
    Ahora,
    /// Termina el hilo (al cerrar la app).
    Detener,
}

/// Arranca el hilo de fondo. Devuelve un Sender para pedirle syncs inmediatos.
///
/// El hilo:
///   - Cada INTERVALO_RESPALDO_SEG segundos, sincroniza (respaldo).
///   - Si recibe SenalSync::Ahora (tras una venta), sincroniza de inmediato.
///   - Si recibe SenalSync::Detener, termina limpio.
pub fn arrancar_hilo_sync(ruta_db: PathBuf) -> Sender<SenalSync> {
    let (tx, rx): (Sender<SenalSync>, Receiver<SenalSync>) = std::sync::mpsc::channel();

    std::thread::spawn(move || {
        // El hilo abre su propia conexión (no comparte el Mutex de la venta).
        let con = match abrir_conexion(&ruta_db) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[sync] no se pudo abrir conexión de fondo: {e}");
                return;
            }
        };

        loop {
            // Espera una señal hasta INTERVALO_RESPALDO_SEG; si no llega ninguna,
            // el timeout dispara un sync de respaldo igual.
            match rx.recv_timeout(Duration::from_secs(INTERVALO_RESPALDO_SEG)) {
                Ok(SenalSync::Detener) => {
                    println!("[sync] hilo de sincronización detenido");
                    break;
                }
                Ok(SenalSync::Ahora) => {
                    // Venta recién hecha: ciclo completo de inmediato.
                    ciclo_sync(&con);
                    // Vaciar señales acumuladas (si hubo varias ventas juntas,
                    // una sola pasada ya subió el lote entero).
                    while let Ok(SenalSync::Ahora) = rx.try_recv() {}
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // Ciclo de respaldo: sube lo pendiente y baja lo del negocio.
                    ciclo_sync(&con);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    // El Sender se soltó (app cerrando): terminar.
                    break;
                }
            }
        }
    });

    tx
}