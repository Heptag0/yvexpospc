//! Inicio (dashboard): comparativas de venta y alertas inteligentes de stock.
//!
//! Filosofía de las alertas (decidida con Arturo):
//!   - "Stock bajo" clásico (stock <= minimo) grita con catálogos importados de
//!     Eleventa: cientos de productos muertos con stock 0 y mínimos sin
//!     configurar. Aquí el criterio es ROTACIÓN: solo alerta lo que SE VENDE
//!     y se está acabando (cobertura en días = stock / venta diaria promedio).
//!   - El producto muerto no alerta por stock; alerta por DINERO ATORADO:
//!     tiene stock, tiene costo, y no se vende hace 60 días.
//!   - Las comparativas se calculan A LA MISMA HORA (hoy hasta ahora vs mismo
//!     día de la semana pasada hasta esa hora), si no a media tarde siempre
//!     "vas perdiendo" contra el día completo anterior.
//!
//! Convención de fechas: el frontend calcula los rangos en hora LOCAL y los
//! manda como ISO-8601 UTC (`Date.toISOString()`), igual que reporte_generar.
//! `creado_en` se guarda con el mismo formato, así que la comparación de
//! strings es correcta.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

/// Rangos precalculados por el frontend (ISO-8601 UTC).
#[derive(Debug, Deserialize)]
pub struct RangosInicio {
    /// Hoy a las 00:00 (local) → ISO.
    pub hoy_inicio: String,
    /// Este instante.
    pub ahora: String,
    /// Mismo día de la semana pasada, 00:00 (local).
    pub dia_previo_inicio: String,
    /// Mismo día de la semana pasada, a ESTA misma hora.
    pub dia_previo_fin: String,
    /// Lunes de esta semana, 00:00 (local).
    pub semana_inicio: String,
    /// Lunes de la semana pasada, 00:00 (local).
    pub semana_previa_inicio: String,
    /// La semana pasada, al punto equivalente a "ahora" (mismo día y hora).
    pub semana_previa_fin: String,
    /// Hace 30 días (ventana de rotación).
    pub hace_30_dias: String,
    /// Hace 60 días (umbral de producto muerto).
    pub hace_60_dias: String,
}

#[derive(Debug, Serialize)]
pub struct Comparativa {
    pub actual_centavos: i64,
    pub anterior_centavos: i64,
}

#[derive(Debug, Serialize)]
pub struct ProductoPorAgotarse {
    pub id: String,
    pub nombre: String,
    pub stock: f64,
    pub unidad: String,
    /// Cantidad vendida en los últimos 30 días.
    pub vendida_30d: f64,
    /// Días que dura el stock actual al ritmo de venta de esos 30 días.
    pub dias_cobertura: f64,
}

#[derive(Debug, Serialize)]
pub struct ResumenMuertos {
    /// Cuántos productos con stock no se venden hace 60 días.
    pub cuantos: i64,
    /// Dinero atorado a costo (suma de stock × costo). Solo dueño/gerente.
    pub valor_costo_centavos: i64,
    /// Los 5 con más dinero atorado, para dar cara a la cifra.
    pub peores: Vec<String>,
    /// Días que lleva operando el sistema (desde la primera venta registrada).
    /// El frontend lo usa para NO alarmar a un negocio recién migrado: sin
    /// suficiente historial, "sin venta en 60 días" no significa "no rota",
    /// significa "acabas de empezar a usar YvexPOS".
    pub dias_operando: i64,
    /// true si ya hay historial suficiente para que la cifra sea confiable.
    pub historial_confiable: bool,
}

#[derive(Debug, Serialize)]
pub struct ResumenInicio {
    pub hoy: Comparativa,
    pub semana: Comparativa,
    pub por_agotarse: Vec<ProductoPorAgotarse>,
    /// None si el rol no puede ver costos (cajero).
    pub muertos: Option<ResumenMuertos>,
}

/// Umbral de cobertura: alertar si el stock dura menos de N días de venta.
const DIAS_COBERTURA_ALERTA: f64 = 7.0;

/// NOTA (sincronización): Inicio muestra el NEGOCIO COMPLETO, no solo esta
/// caja. Las ventas que bajan de otras cajas (móvil, otra PC) ya están en la
/// base local; filtrarlas haría que el dueño viera números a medias.
/// (El corte de caja sí es por turno/caja: el efectivo es físico de cada caja.)
pub fn resumen(
    con: &Connection,
    incluir_costos: bool,
    r: &RangosInicio,
) -> Result<ResumenInicio, String> {
    let hoy = Comparativa {
        actual_centavos: suma_rango(con, &r.hoy_inicio, &r.ahora)?,
        anterior_centavos: suma_rango(con, &r.dia_previo_inicio, &r.dia_previo_fin)?,
    };
    let semana = Comparativa {
        actual_centavos: suma_rango(con, &r.semana_inicio, &r.ahora)?,
        anterior_centavos: suma_rango(con, &r.semana_previa_inicio, &r.semana_previa_fin)?,
    };
    let por_agotarse = por_agotarse(con, &r.hace_30_dias)?;
    let muertos = if incluir_costos {
        Some(muertos(con, &r.hace_60_dias, &r.ahora)?)
    } else {
        None
    };
    Ok(ResumenInicio { hoy, semana, por_agotarse, muertos })
}

/// Suma de venta en un rango [ini, fin). Excluye canceladas; las devoluciones
/// parciales cuentan por su total original (mismo criterio que el corte).
/// Cuenta TODAS las cajas del negocio (ver nota en `resumen`).
fn suma_rango(con: &Connection, ini: &str, fin: &str) -> Result<i64, String> {
    con.query_row(
        "SELECT COALESCE(SUM(total_centavos), 0)
           FROM ventas
          WHERE estado <> 'cancelada'
            AND creado_en >= ?1 AND creado_en < ?2",
        rusqlite::params![ini, fin],
        |row| row.get(0),
    )
    .map_err(|e| format!("error en suma de rango: {e}"))
}

/// Productos que SÍ rotan y cuyo stock cubre menos de DIAS_COBERTURA_ALERTA
/// días de venta. Los muertos (sin venta en 30 días) jamás aparecen aquí.
fn por_agotarse(
    con: &Connection,
    hace_30_dias: &str,
) -> Result<Vec<ProductoPorAgotarse>, String> {
    let mut stmt = con
        .prepare(
            "SELECT p.id, p.nombre, p.stock, p.unidad, m.vendida,
                    (p.stock * 30.0 / m.vendida) AS dias
               FROM productos p
               JOIN (SELECT vl.producto_id, SUM(vl.cantidad) AS vendida
                       FROM venta_lineas vl
                       JOIN ventas v ON v.id = vl.venta_id
                      WHERE v.estado <> 'cancelada'
                        AND v.creado_en >= ?1
                      GROUP BY vl.producto_id) m
                 ON m.producto_id = p.id
              WHERE p.eliminado = 0
                AND p.controla_stock = 1
                AND p.es_kit = 0
                AND m.vendida > 0
                AND p.stock >= 0
                AND (p.stock * 30.0 / m.vendida) < ?2
              ORDER BY dias ASC
              LIMIT 10",
        )
        .map_err(|e| e.to_string())?;
    let filas = stmt
        .query_map(
            rusqlite::params![hace_30_dias, DIAS_COBERTURA_ALERTA],
            |row| {
                Ok(ProductoPorAgotarse {
                    id: row.get(0)?,
                    nombre: row.get(1)?,
                    stock: row.get(2)?,
                    unidad: row.get(3)?,
                    vendida_30d: row.get(4)?,
                    dias_cobertura: row.get(5)?,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(filas)
}

/// Umbral de historial: por debajo de esto, la métrica de producto muerto
/// no es confiable (recién migrado de otro POS).
const DIAS_HISTORIAL_MINIMO: i64 = 45;

/// Dinero atorado: productos con stock y costo que no venden hace 60 días.
/// Solo cuenta productos CREADOS antes de la ventana (uno agregado ayer no
/// puede llevar 60 días sin venderse) y reporta la antigüedad del sistema
/// para que el frontend no alarme a un negocio recién migrado.
fn muertos(
    con: &Connection,
    hace_60_dias: &str,
    ahora: &str,
) -> Result<ResumenMuertos, String> {
    // Antigüedad del sistema = días desde la primera venta registrada.
    // Si no hay ventas aún, dias_operando = 0.
    let primera_venta: Option<String> = con
        .query_row(
            "SELECT MIN(creado_en) FROM ventas WHERE estado <> 'cancelada'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("error en primera venta: {e}"))?
        .flatten();

    let dias_operando = match &primera_venta {
        Some(fecha) => dias_entre(fecha, ahora),
        None => 0,
    };
    let historial_confiable = dias_operando >= DIAS_HISTORIAL_MINIMO;

    // El producto debe existir DESDE antes de la ventana: uno recién dado de
    // alta no cuenta como "muerto". `p.creado_en < ?1` (hace_60_dias) lo cubre.
    let filtro = "p.eliminado = 0
                AND p.controla_stock = 1
                AND p.es_kit = 0
                AND p.stock > 0
                AND p.costo_centavos > 0
                AND p.creado_en < ?1
                AND p.id NOT IN (
                      SELECT vl.producto_id
                        FROM venta_lineas vl
                        JOIN ventas v ON v.id = vl.venta_id
                       WHERE v.creado_en >= ?1)";

    let (cuantos, valor): (i64, f64) = con
        .query_row(
            &format!(
                "SELECT COUNT(*), COALESCE(SUM(p.stock * p.costo_centavos), 0.0)
                   FROM productos p WHERE {filtro}"
            ),
            rusqlite::params![hace_60_dias],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("error en muertos: {e}"))?;

    let mut stmt = con
        .prepare(&format!(
            "SELECT p.nombre FROM productos p WHERE {filtro}
              ORDER BY p.stock * p.costo_centavos DESC LIMIT 5"
        ))
        .map_err(|e| e.to_string())?;
    let peores = stmt
        .query_map(rusqlite::params![hace_60_dias], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(ResumenMuertos {
        cuantos,
        valor_costo_centavos: valor.round() as i64,
        peores,
        dias_operando,
        historial_confiable,
    })
}

/// Días entre dos fechas ISO-8601. Robusto: compara solo la parte YYYY-MM-DD,
/// evitando dependencias de parsing de tiempo.
fn dias_entre(desde_iso: &str, hasta_iso: &str) -> i64 {
    let dia = |iso: &str| -> Option<i64> {
        let f = iso.get(0..10)?; // "YYYY-MM-DD"
        let mut p = f.split('-');
        let y: i64 = p.next()?.parse().ok()?;
        let m: i64 = p.next()?.parse().ok()?;
        let d: i64 = p.next()?.parse().ok()?;
        // Día juliano simplificado (algoritmo de Howard Hinnant).
        let y = if m <= 2 { y - 1 } else { y };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let mp = (m + 9) % 12;
        let doy = (153 * mp + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        Some(era * 146097 + doe - 719468)
    };
    match (dia(desde_iso), dia(hasta_iso)) {
        (Some(a), Some(b)) => (b - a).max(0),
        _ => 0,
    }
}   