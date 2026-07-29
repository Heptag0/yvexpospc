//! Clientes (`clientes`) y cuenta corriente (`movimientos_cuenta`).
//!
//! Modelo (definido con Arturo, no en el plano original):
//!   - Cada cliente tiene `saldo_centavos` (deuda) y `limite_credito_centavos`.
//!   - Un 'cargo' (venta a crédito) sube el saldo; un 'abono' (pago) lo baja.
//!   - La suma de (cargos - abonos) reconstruye el saldo. Rastro auditable.
//!   - El límite AVISA pero no bloquea (el cajero/dueño decide).
//!   - El abono guarda su `metodo` y fecha: el corte futuro cuenta el ingreso
//!     el día que se abona, no el día que se vendió a crédito.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::comun::{ahora, encolar_sync, nuevo_id};

#[derive(Debug, Serialize)]
pub struct Cliente {
    pub id: String,
    pub nombre: String,
    pub telefono: Option<String>,
    pub notas: Option<String>,
    pub limite_credito_centavos: i64,
    pub saldo_centavos: i64,
}

#[derive(Debug, Deserialize)]
pub struct NuevoCliente {
    pub nombre: String,
    pub telefono: Option<String>,
    pub notas: Option<String>,
    pub limite_credito_centavos: i64,
}

#[derive(Debug, Deserialize)]
pub struct EditarCliente {
    pub id: String,
    pub nombre: String,
    pub telefono: Option<String>,
    pub notas: Option<String>,
    pub limite_credito_centavos: i64,
}

#[derive(Debug, Serialize)]
pub struct MovimientoCuenta {
    pub id: String,
    pub tipo: String,
    pub monto_centavos: i64,
    pub venta_id: Option<String>,
    pub metodo: Option<String>,
    pub saldo_resultante_centavos: i64,
    pub motivo: Option<String>,
    pub creado_en: String,
}

#[derive(Debug, Deserialize)]
pub struct AbonoEntrada {
    pub cliente_id: String,
    pub monto_centavos: i64,
    pub metodo: String, // efectivo | tarjeta | transferencia
    pub usuario_pos_id: String,
    pub caja_sesion_id: Option<String>,
    pub motivo: Option<String>,
}

const METODOS_ABONO: [&str; 3] = ["efectivo", "tarjeta", "transferencia"];

// -------------------------------------------------------------------- CRUD

pub fn listar(con: &Connection, filtro: Option<&str>) -> Result<Vec<Cliente>, String> {
    let mut sql = String::from(
        "SELECT id, nombre, telefono, notas, limite_credito_centavos, saldo_centavos
         FROM clientes WHERE eliminado = 0",
    );
    if filtro.is_some() {
        sql.push_str(" AND (nombre LIKE ?1 OR telefono LIKE ?1)");
    }
    sql.push_str(" ORDER BY nombre COLLATE NOCASE");

    let mut stmt = con.prepare(&sql).map_err(|e| format!("error al preparar clientes: {e}"))?;
    let mapper = |row: &rusqlite::Row| {
        Ok(Cliente {
            id: row.get(0)?,
            nombre: row.get(1)?,
            telefono: row.get(2)?,
            notas: row.get(3)?,
            limite_credito_centavos: row.get(4)?,
            saldo_centavos: row.get(5)?,
        })
    };
    let filas = if let Some(f) = filtro {
        let patron = format!("%{}%", f.trim());
        stmt.query_map(rusqlite::params![patron], mapper_fix(mapper))
    } else {
        stmt.query_map([], mapper_fix(mapper))
    }
    .map_err(|e| format!("error al consultar clientes: {e}"))?;

    let mut out = Vec::new();
    for f in filas {
        out.push(f.map_err(|e| format!("error al leer cliente: {e}"))?);
    }
    Ok(out)
}

// Helper para reusar el mismo closure en ambas ramas de query_map.
fn mapper_fix<F>(f: F) -> F
where
    F: Fn(&rusqlite::Row) -> rusqlite::Result<Cliente>,
{
    f
}

pub fn obtener(con: &Connection, id: &str) -> Result<Option<Cliente>, String> {
    con.query_row(
        "SELECT id, nombre, telefono, notas, limite_credito_centavos, saldo_centavos
         FROM clientes WHERE id = ?1 AND eliminado = 0",
        rusqlite::params![id],
        |row| {
            Ok(Cliente {
                id: row.get(0)?,
                nombre: row.get(1)?,
                telefono: row.get(2)?,
                notas: row.get(3)?,
                limite_credito_centavos: row.get(4)?,
                saldo_centavos: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("error al obtener cliente: {e}"))
}

pub fn crear(con: &Connection, dispositivo_id: &str, d: &NuevoCliente) -> Result<Cliente, String> {
    let nombre = d.nombre.trim();
    if nombre.is_empty() {
        return Err("El nombre del cliente no puede estar vacío.".into());
    }
    if d.limite_credito_centavos < 0 {
        return Err("El límite de crédito no puede ser negativo.".into());
    }
    let id = nuevo_id();
    let ts = ahora();
    let tel = d.telefono.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let notas = d.notas.as_deref().map(str::trim).filter(|s| !s.is_empty());

    con.execute(
        "INSERT INTO clientes
           (id, nombre, telefono, notas, limite_credito_centavos, saldo_centavos,
            creado_en, actualizado_en, eliminado, dispositivo_id)
         VALUES (?1,?2,?3,?4,?5,0,?6,?6,0,?7)",
        rusqlite::params![id, nombre, tel, notas, d.limite_credito_centavos, ts, dispositivo_id],
    )
    .map_err(|e| format!("error al crear cliente: {e}"))?;

    let payload = serde_json::json!({
        "id": id, "nombre": nombre, "telefono": tel, "notas": notas,
        "limite_credito_centavos": d.limite_credito_centavos, "saldo_centavos": 0,
        "creado_en": ts, "actualizado_en": ts, "eliminado": 0, "dispositivo_id": dispositivo_id,
    });
    encolar_sync(con, "clientes", &id, "insert", &payload)
        .map_err(|e| format!("error al encolar cliente: {e}"))?;

    Ok(Cliente {
        id,
        nombre: nombre.to_string(),
        telefono: tel.map(String::from),
        notas: notas.map(String::from),
        limite_credito_centavos: d.limite_credito_centavos,
        saldo_centavos: 0,
    })
}

pub fn editar(con: &Connection, d: &EditarCliente) -> Result<(), String> {
    let nombre = d.nombre.trim();
    if nombre.is_empty() {
        return Err("El nombre del cliente no puede estar vacío.".into());
    }
    if d.limite_credito_centavos < 0 {
        return Err("El límite de crédito no puede ser negativo.".into());
    }
    let ts = ahora();
    let tel = d.telefono.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let notas = d.notas.as_deref().map(str::trim).filter(|s| !s.is_empty());

    let n = con
        .execute(
            "UPDATE clientes SET nombre=?2, telefono=?3, notas=?4, limite_credito_centavos=?5,
               actualizado_en=?6
             WHERE id=?1 AND eliminado=0",
            rusqlite::params![d.id, nombre, tel, notas, d.limite_credito_centavos, ts],
        )
        .map_err(|e| format!("error al editar cliente: {e}"))?;
    if n == 0 {
        return Err("No se encontró el cliente.".into());
    }

    let payload = serde_json::json!({
        "id": d.id, "nombre": nombre, "telefono": tel, "notas": notas,
        "limite_credito_centavos": d.limite_credito_centavos, "actualizado_en": ts,
    });
    encolar_sync(con, "clientes", &d.id, "update", &payload)
        .map_err(|e| format!("error al encolar cliente: {e}"))?;
    Ok(())
}

pub fn eliminar(con: &Connection, id: &str) -> Result<(), String> {
    // No permitir borrar un cliente con saldo pendiente (deuda viva).
    let saldo: Option<i64> = con
        .query_row(
            "SELECT saldo_centavos FROM clientes WHERE id=?1 AND eliminado=0",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("error al verificar cliente: {e}"))?;
    match saldo {
        None => return Err("No se encontró el cliente.".into()),
        Some(s) if s != 0 => {
            return Err("No se puede eliminar un cliente con saldo pendiente.".into())
        }
        _ => {}
    }
    let ts = ahora();
    con.execute(
        "UPDATE clientes SET eliminado=1, actualizado_en=?2 WHERE id=?1",
        rusqlite::params![id, ts],
    )
    .map_err(|e| format!("error al eliminar cliente: {e}"))?;
    let payload = serde_json::json!({ "id": id, "eliminado": 1, "actualizado_en": ts });
    encolar_sync(con, "clientes", id, "update", &payload)
        .map_err(|e| format!("error al encolar baja de cliente: {e}"))?;
    Ok(())
}

// -------------------------------------------------- Movimientos de cuenta

/// Estado de cuenta: los movimientos del cliente, más reciente primero.
pub fn estado_cuenta(con: &Connection, cliente_id: &str) -> Result<Vec<MovimientoCuenta>, String> {
    let mut stmt = con
        .prepare(
            "SELECT id, tipo, monto_centavos, venta_id, metodo, saldo_resultante_centavos,
                    motivo, creado_en
             FROM movimientos_cuenta
             WHERE cliente_id = ?1
             ORDER BY creado_en DESC, rowid DESC",
        )
        .map_err(|e| format!("error al preparar estado de cuenta: {e}"))?;
    let filas = stmt
        .query_map(rusqlite::params![cliente_id], |row| {
            Ok(MovimientoCuenta {
                id: row.get(0)?,
                tipo: row.get(1)?,
                monto_centavos: row.get(2)?,
                venta_id: row.get(3)?,
                metodo: row.get(4)?,
                saldo_resultante_centavos: row.get(5)?,
                motivo: row.get(6)?,
                creado_en: row.get(7)?,
            })
        })
        .map_err(|e| format!("error al consultar estado de cuenta: {e}"))?;
    let mut out = Vec::new();
    for f in filas {
        out.push(f.map_err(|e| format!("error al leer movimiento: {e}"))?);
    }
    Ok(out)
}

/// Registra un cargo (venta a crédito) DENTRO de una transacción ya abierta.
/// Sube el saldo del cliente y deja rastro. Usado por el módulo de ventas.
pub fn registrar_cargo_en_tx(
    con: &Connection,
    dispositivo_id: &str,
    cliente_id: &str,
    monto_centavos: i64,
    venta_id: &str,
    usuario_pos_id: &str,
    caja_sesion_id: &str,
) -> Result<i64, String> {
    let saldo_actual: i64 = con
        .query_row(
            "SELECT saldo_centavos FROM clientes WHERE id=?1 AND eliminado=0",
            rusqlite::params![cliente_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("error al leer saldo: {e}"))?
        .ok_or_else(|| "El cliente no existe.".to_string())?;

    let nuevo_saldo = saldo_actual + monto_centavos;
    let ts = ahora();

    con.execute(
        "UPDATE clientes SET saldo_centavos=?2, actualizado_en=?3 WHERE id=?1",
        rusqlite::params![cliente_id, nuevo_saldo, ts],
    )
    .map_err(|e| format!("error al actualizar saldo: {e}"))?;

    let mov_id = nuevo_id();
    con.execute(
        "INSERT INTO movimientos_cuenta
           (id, cliente_id, tipo, monto_centavos, venta_id, metodo, saldo_resultante_centavos,
            motivo, usuario_pos_id, caja_sesion_id, creado_en, actualizado_en, sincronizado, dispositivo_id)
         VALUES (?1,?2,'cargo',?3,?4,NULL,?5,NULL,?6,?7,?8,?8,0,?9)",
        rusqlite::params![
            mov_id, cliente_id, monto_centavos, venta_id, nuevo_saldo,
            usuario_pos_id, caja_sesion_id, ts, dispositivo_id
        ],
    )
    .map_err(|e| format!("error al registrar cargo: {e}"))?;

    let payload_cli = serde_json::json!({ "id": cliente_id, "saldo_centavos": nuevo_saldo, "actualizado_en": ts });
    encolar_sync(con, "clientes", cliente_id, "update", &payload_cli)
        .map_err(|e| format!("error al encolar cliente: {e}"))?;

    let payload_mov = serde_json::json!({
        "id": mov_id, "cliente_id": cliente_id, "tipo": "cargo", "monto_centavos": monto_centavos,
        "venta_id": venta_id, "metodo": null, "saldo_resultante_centavos": nuevo_saldo,
        "usuario_pos_id": usuario_pos_id, "caja_sesion_id": caja_sesion_id,
        "creado_en": ts, "actualizado_en": ts, "dispositivo_id": dispositivo_id,
    });
    encolar_sync(con, "movimientos_cuenta", &mov_id, "insert", &payload_mov)
        .map_err(|e| format!("error al encolar movimiento: {e}"))?;

    Ok(nuevo_saldo)
}

/// Registra un abono (pago de deuda). Baja el saldo y deja rastro con método.
pub fn registrar_abono(con: &mut Connection, dispositivo_id: &str, a: &AbonoEntrada) -> Result<i64, String> {
    if a.monto_centavos <= 0 {
        return Err("El abono debe ser mayor a cero.".into());
    }
    if !METODOS_ABONO.contains(&a.metodo.as_str()) {
        return Err(format!("Método de abono inválido: {}", a.metodo));
    }

    let tx = con.transaction().map_err(|e| format!("no se pudo abrir transacción: {e}"))?;

    let saldo_actual: i64 = tx
        .query_row(
            "SELECT saldo_centavos FROM clientes WHERE id=?1 AND eliminado=0",
            rusqlite::params![a.cliente_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("error al leer saldo: {e}"))?
        .ok_or_else(|| "El cliente no existe.".to_string())?;

    if a.monto_centavos > saldo_actual {
        return Err(format!(
            "El abono (${:.2}) es mayor que la deuda (${:.2}).",
            a.monto_centavos as f64 / 100.0,
            saldo_actual as f64 / 100.0
        ));
    }

    let nuevo_saldo = saldo_actual - a.monto_centavos;
    let ts = ahora();

    tx.execute(
        "UPDATE clientes SET saldo_centavos=?2, actualizado_en=?3 WHERE id=?1",
        rusqlite::params![a.cliente_id, nuevo_saldo, ts],
    )
    .map_err(|e| format!("error al actualizar saldo: {e}"))?;

    let mov_id = nuevo_id();
    tx.execute(
        "INSERT INTO movimientos_cuenta
           (id, cliente_id, tipo, monto_centavos, venta_id, metodo, saldo_resultante_centavos,
            motivo, usuario_pos_id, caja_sesion_id, creado_en, actualizado_en, sincronizado, dispositivo_id)
         VALUES (?1,?2,'abono',?3,NULL,?4,?5,?6,?7,?8,?9,?9,0,?10)",
        rusqlite::params![
            mov_id, a.cliente_id, a.monto_centavos, a.metodo, nuevo_saldo,
            a.motivo, a.usuario_pos_id, a.caja_sesion_id, ts, dispositivo_id
        ],
    )
    .map_err(|e| format!("error al registrar abono: {e}"))?;

    let payload_cli = serde_json::json!({ "id": a.cliente_id, "saldo_centavos": nuevo_saldo, "actualizado_en": ts });
    encolar_sync(&tx, "clientes", &a.cliente_id, "update", &payload_cli)
        .map_err(|e| format!("error al encolar cliente: {e}"))?;

    let payload_mov = serde_json::json!({
        "id": mov_id, "cliente_id": a.cliente_id, "tipo": "abono", "monto_centavos": a.monto_centavos,
        "venta_id": null, "metodo": a.metodo, "saldo_resultante_centavos": nuevo_saldo,
        "motivo": a.motivo, "usuario_pos_id": a.usuario_pos_id, "caja_sesion_id": a.caja_sesion_id,
        "creado_en": ts, "actualizado_en": ts, "dispositivo_id": dispositivo_id,
    });
    encolar_sync(&tx, "movimientos_cuenta", &mov_id, "insert", &payload_mov)
        .map_err(|e| format!("error al encolar movimiento: {e}"))?;

    tx.commit().map_err(|e| format!("error al confirmar abono: {e}"))?;
    Ok(nuevo_saldo)
}

/// Verifica si un cargo adicional dejaría al cliente sobre su límite.
/// Devuelve (excede, saldo_actual, limite). No bloquea: el frontend decide.
/// limite = 0 significa "sin límite definido" → nunca excede.
pub fn verificar_limite(
    con: &Connection,
    cliente_id: &str,
    monto_cargo_centavos: i64,
) -> Result<(bool, i64, i64), String> {
    let row: Option<(i64, i64)> = con
        .query_row(
            "SELECT saldo_centavos, limite_credito_centavos FROM clientes WHERE id=?1 AND eliminado=0",
            rusqlite::params![cliente_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| format!("error al verificar límite: {e}"))?;
    let (saldo, limite) = row.ok_or_else(|| "El cliente no existe.".to_string())?;
    if limite == 0 {
        return Ok((false, saldo, limite)); // sin límite definido
    }
    let excede = (saldo + monto_cargo_centavos) > limite;
    Ok((excede, saldo, limite))
}
