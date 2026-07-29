//! Sesiones de caja (`caja_sesiones`) — apertura mínima.
//!
//! Esta es la base mínima que la invariante del plano exige para vender:
//!   ⚠️ Toda venta pertenece a una caja_sesion ABIERTA. Sin sesión abierta,
//!      forzar apertura antes de vender.
//!
//! El módulo de Caja completo (corte X/Z, movimientos, cierre con conteo) se
//! construye después SOBRE esta base. Aquí solo: abrir y consultar la abierta.

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

use super::comun::{ahora, encolar_sync, nuevo_id};

#[derive(Debug, Serialize)]
pub struct SesionCaja {
    pub id: String,
    pub usuario_pos_id: String,
    pub fondo_inicial_centavos: i64,
    pub abierta_en: String,
    pub estado: String,
}

/// Devuelve la sesión abierta de este dispositivo, si existe.
/// ⚠️ Solo puede haber una sesión 'abierta' por dispositivo a la vez.
pub fn sesion_abierta(con: &Connection, dispositivo_id: &str) -> Result<Option<SesionCaja>, String> {
    con.query_row(
        "SELECT id, usuario_pos_id, fondo_inicial_centavos, abierta_en, estado
         FROM caja_sesiones
         WHERE dispositivo_id = ?1 AND estado = 'abierta'
         ORDER BY abierta_en DESC LIMIT 1",
        rusqlite::params![dispositivo_id],
        |row| {
            Ok(SesionCaja {
                id: row.get(0)?,
                usuario_pos_id: row.get(1)?,
                fondo_inicial_centavos: row.get(2)?,
                abierta_en: row.get(3)?,
                estado: row.get(4)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("error al consultar sesión de caja: {e}"))
}

/// Abre una sesión de caja con el fondo inicial declarado.
/// Falla si ya hay una abierta (no se permiten dos a la vez).
pub fn abrir_caja(
    con: &Connection,
    dispositivo_id: &str,
    usuario_pos_id: &str,
    fondo_inicial_centavos: i64,
) -> Result<SesionCaja, String> {
    if fondo_inicial_centavos < 0 {
        return Err("El fondo inicial no puede ser negativo.".into());
    }
    if sesion_abierta(con, dispositivo_id)?.is_some() {
        return Err("Ya hay una caja abierta en este dispositivo.".into());
    }

    let id = nuevo_id();
    let ts = ahora();
    con.execute(
        "INSERT INTO caja_sesiones
           (id, dispositivo_id, usuario_pos_id, fondo_inicial_centavos, abierta_en,
            cerrada_en, total_efectivo_esperado_centavos, total_efectivo_contado_centavos,
            diferencia_centavos, estado, actualizado_en, sincronizado)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, NULL, NULL, 'abierta', ?5, 0)",
        rusqlite::params![id, dispositivo_id, usuario_pos_id, fondo_inicial_centavos, ts],
    )
    .map_err(|e| format!("error al abrir caja: {e}"))?;

    let payload = serde_json::json!({
        "id": id, "dispositivo_id": dispositivo_id, "usuario_pos_id": usuario_pos_id,
        "fondo_inicial_centavos": fondo_inicial_centavos, "abierta_en": ts,
        "estado": "abierta", "actualizado_en": ts,
    });
    encolar_sync(con, "caja_sesiones", &id, "insert", &payload)
        .map_err(|e| format!("error al encolar sesión de caja: {e}"))?;

    Ok(SesionCaja {
        id,
        usuario_pos_id: usuario_pos_id.to_string(),
        fondo_inicial_centavos,
        abierta_en: ts,
        estado: "abierta".to_string(),
    })
}

// ============================================================================
// Movimientos de efectivo, Corte X (parcial) y Cierre Z
// ============================================================================

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct MovimientoEntrada {
    pub caja_sesion_id: String,
    pub tipo: String, // entrada | salida
    pub motivo: Option<String>,
    pub monto_centavos: i64,
    pub usuario_pos_id: String,
}

/// Registra una entrada o salida de efectivo del cajón durante el turno.
pub fn registrar_movimiento(con: &Connection, m: &MovimientoEntrada) -> Result<(), String> {
    if m.tipo != "entrada" && m.tipo != "salida" {
        return Err("Tipo de movimiento inválido.".into());
    }
    if m.monto_centavos <= 0 {
        return Err("El monto debe ser mayor a cero.".into());
    }
    // Verificar que la sesión esté abierta.
    let abierta: Option<i64> = con
        .query_row(
            "SELECT 1 FROM caja_sesiones WHERE id=?1 AND estado='abierta'",
            rusqlite::params![m.caja_sesion_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("error al verificar caja: {e}"))?;
    if abierta.is_none() {
        return Err("La caja no está abierta.".into());
    }

    let id = nuevo_id();
    let ts = ahora();
    con.execute(
        "INSERT INTO movimientos_caja
           (id, caja_sesion_id, tipo, motivo, monto_centavos, usuario_pos_id, creado_en, actualizado_en)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
        rusqlite::params![id, m.caja_sesion_id, m.tipo, m.motivo, m.monto_centavos, m.usuario_pos_id, ts],
    )
    .map_err(|e| format!("error al registrar movimiento: {e}"))?;

    let payload = serde_json::json!({
        "id": id, "caja_sesion_id": m.caja_sesion_id, "tipo": m.tipo, "motivo": m.motivo,
        "monto_centavos": m.monto_centavos, "usuario_pos_id": m.usuario_pos_id,
        "creado_en": ts, "actualizado_en": ts,
    });
    encolar_sync(con, "movimientos_caja", &id, "insert", &payload)
        .map_err(|e| format!("error al encolar movimiento: {e}"))?;
    Ok(())
}

/// Desglose completo de un corte (sirve para Corte X y para el Cierre Z).
#[derive(Debug, Serialize)]
pub struct CorteCaja {
    pub caja_sesion_id: String,
    pub usuario_nombre: String,
    pub abierta_en: String,
    pub fondo_inicial_centavos: i64,
    // Ventas del turno (todas, sin importar método).
    pub num_ventas: i64,
    pub total_vendido_centavos: i64,
    // Desglose por método de pago (lo que el dueño "expande").
    pub ventas_efectivo_centavos: i64,
    pub ventas_tarjeta_centavos: i64,
    pub ventas_transferencia_centavos: i64,
    pub ventas_credito_centavos: i64,
    // Abonos recibidos en el turno, por método (entran al ingreso del día).
    pub abonos_efectivo_centavos: i64,
    pub abonos_tarjeta_centavos: i64,
    pub abonos_transferencia_centavos: i64,
    // Movimientos de efectivo.
    pub entradas_centavos: i64,
    pub salidas_centavos: i64,
    // Devoluciones de producto reembolsadas en efectivo (bajan el cajón, pero
    // separadas de las salidas normales para claridad del corte).
    pub devoluciones_efectivo_centavos: i64,
    // El número clave: cuánto efectivo debe haber en el cajón.
    pub efectivo_esperado_centavos: i64,
    /// --- Contexto del negocio (INFORMATIVO, no entra al arqueo) ---
    /// Ventas de HOY cobradas en OTRAS cajas (móvil, otra PC) que ya bajaron
    /// por sync. El corte sigue siendo solo de ESTA caja porque el efectivo
    /// es físico; esto solo evita la confusión de "¿y mis otras ventas?".
    pub otras_cajas_num: i64,
    pub otras_cajas_total_centavos: i64,
}

/// Calcula el corte de una sesión. NO cierra nada (sirve para Corte X y como
/// base del Cierre Z). Aplica la invariante: efectivo esperado = SOLO efectivo.
pub fn calcular_corte(con: &Connection, caja_sesion_id: &str) -> Result<CorteCaja, String> {
    // Datos de la sesión.
    let (usuario_pos_id, abierta_en, fondo, dispositivo_sesion): (String, String, i64, String) = con
        .query_row(
            "SELECT usuario_pos_id, abierta_en, fondo_inicial_centavos, dispositivo_id
             FROM caja_sesiones WHERE id=?1",
            rusqlite::params![caja_sesion_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(|e| format!("error al leer sesión: {e}"))?
        .ok_or_else(|| "No se encontró la sesión de caja.".to_string())?;

    let usuario_nombre: String = con
        .query_row(
            "SELECT nombre FROM usuarios_pos WHERE id=?1",
            rusqlite::params![usuario_pos_id],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "—".to_string());

    // Ventas del turno: total y conteo.
    let (num_ventas, total_vendido): (i64, i64) = con
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(total_centavos),0)
             FROM ventas WHERE caja_sesion_id=?1 AND estado != 'cancelada'",
            rusqlite::params![caja_sesion_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| format!("error al sumar ventas: {e}"))?;

    // Desglose por método: sumar pagos de las ventas de ESTA sesión, por método.
    let suma_pagos = |metodo: &str| -> Result<i64, String> {
        con.query_row(
            "SELECT COALESCE(SUM(p.monto_centavos),0)
             FROM pagos p JOIN ventas v ON p.venta_id = v.id
             WHERE v.caja_sesion_id=?1 AND v.estado != 'cancelada' AND p.metodo=?2",
            rusqlite::params![caja_sesion_id, metodo],
            |r| r.get(0),
        )
        .map_err(|e| format!("error al sumar pagos {metodo}: {e}"))
    };
    let ventas_efectivo = suma_pagos("efectivo")?;
    let ventas_tarjeta = suma_pagos("tarjeta")?;
    let ventas_transferencia = suma_pagos("transferencia")?;
    let ventas_credito = suma_pagos("credito")?;

    // Abonos recibidos en el turno, por método (vinculados a esta caja_sesion).
    let suma_abonos = |metodo: &str| -> Result<i64, String> {
        con.query_row(
            "SELECT COALESCE(SUM(monto_centavos),0)
             FROM movimientos_cuenta
             WHERE caja_sesion_id=?1 AND tipo='abono' AND metodo=?2",
            rusqlite::params![caja_sesion_id, metodo],
            |r| r.get(0),
        )
        .map_err(|e| format!("error al sumar abonos {metodo}: {e}"))
    };
    let abonos_efectivo = suma_abonos("efectivo")?;
    let abonos_tarjeta = suma_abonos("tarjeta")?;
    let abonos_transferencia = suma_abonos("transferencia")?;

    // Movimientos de efectivo del cajón.
    let entradas: i64 = con
        .query_row(
            "SELECT COALESCE(SUM(monto_centavos),0) FROM movimientos_caja
             WHERE caja_sesion_id=?1 AND tipo='entrada'",
            rusqlite::params![caja_sesion_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("error al sumar entradas: {e}"))?;
    let salidas: i64 = con
        .query_row(
            "SELECT COALESCE(SUM(monto_centavos),0) FROM movimientos_caja
             WHERE caja_sesion_id=?1 AND tipo='salida'",
            rusqlite::params![caja_sesion_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("error al sumar salidas: {e}"))?;

    // Devoluciones de producto reembolsadas en efectivo en esta sesión.
    let devoluciones_efectivo: i64 = con
        .query_row(
            "SELECT COALESCE(SUM(total_devuelto_centavos),0) FROM devoluciones
             WHERE caja_sesion_id=?1 AND metodo_reembolso='efectivo'",
            rusqlite::params![caja_sesion_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("error al sumar devoluciones: {e}"))?;

    // ⚠️ INVARIANTE: efectivo esperado = SOLO efectivo (ventas + abonos) + mov.
    // Tarjeta, transferencia y crédito NO van al cajón físico.
    // Las devoluciones en efectivo bajan el cajón (separadas de salidas normales).
    let efectivo_esperado =
        fondo + ventas_efectivo + abonos_efectivo + entradas - salidas - devoluciones_efectivo;

    // Contexto del negocio (solo informativo): ventas de HOY en OTRAS cajas.
    // NO entra al arqueo: ese dinero está en el cajón de la otra caja, no aquí.
    let (otras_num, otras_total): (i64, i64) = con
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(total_centavos),0)
             FROM ventas
             WHERE dispositivo_id <> ?1
               AND estado != 'cancelada'
               AND date(creado_en) = date('now')",
            rusqlite::params![dispositivo_sesion],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| format!("error al sumar otras cajas: {e}"))?;

    Ok(CorteCaja {
        caja_sesion_id: caja_sesion_id.to_string(),
        usuario_nombre,
        abierta_en,
        fondo_inicial_centavos: fondo,
        num_ventas,
        total_vendido_centavos: total_vendido,
        ventas_efectivo_centavos: ventas_efectivo,
        ventas_tarjeta_centavos: ventas_tarjeta,
        ventas_transferencia_centavos: ventas_transferencia,
        ventas_credito_centavos: ventas_credito,
        abonos_efectivo_centavos: abonos_efectivo,
        abonos_tarjeta_centavos: abonos_tarjeta,
        abonos_transferencia_centavos: abonos_transferencia,
        entradas_centavos: entradas,
        salidas_centavos: salidas,
        devoluciones_efectivo_centavos: devoluciones_efectivo,
        efectivo_esperado_centavos: efectivo_esperado,
        otras_cajas_num: otras_num,
        otras_cajas_total_centavos: otras_total,
    })
}

/// Cierra la sesión (Corte Z). Recibe el efectivo contado físicamente, calcula
/// la diferencia y marca la sesión como cerrada (inmutable desde entonces).
pub fn cerrar_caja(
    con: &Connection,
    caja_sesion_id: &str,
    total_contado_centavos: i64,
) -> Result<(i64, i64), String> {
    // Verificar que esté abierta (no recerrar).
    let estado: Option<String> = con
        .query_row(
            "SELECT estado FROM caja_sesiones WHERE id=?1",
            rusqlite::params![caja_sesion_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("error al verificar sesión: {e}"))?;
    match estado.as_deref() {
        None => return Err("No se encontró la sesión.".into()),
        Some("cerrada") => return Err("Esta caja ya fue cerrada.".into()),
        _ => {}
    }

    let corte = calcular_corte(con, caja_sesion_id)?;
    let esperado = corte.efectivo_esperado_centavos;
    let diferencia = total_contado_centavos - esperado; // + sobrante, - faltante
    let ts = ahora();

    con.execute(
        "UPDATE caja_sesiones SET
           cerrada_en=?2, total_efectivo_esperado_centavos=?3,
           total_efectivo_contado_centavos=?4, diferencia_centavos=?5,
           estado='cerrada', actualizado_en=?2
         WHERE id=?1",
        rusqlite::params![caja_sesion_id, ts, esperado, total_contado_centavos, diferencia],
    )
    .map_err(|e| format!("error al cerrar caja: {e}"))?;

    let payload = serde_json::json!({
        "id": caja_sesion_id, "cerrada_en": ts,
        "total_efectivo_esperado_centavos": esperado,
        "total_efectivo_contado_centavos": total_contado_centavos,
        "diferencia_centavos": diferencia, "estado": "cerrada", "actualizado_en": ts,
    });
    encolar_sync(con, "caja_sesiones", caja_sesion_id, "update", &payload)
        .map_err(|e| format!("error al encolar cierre: {e}"))?;

    Ok((esperado, diferencia))
}
