//! Ventas (`ventas`, `venta_lineas`, `pagos`) — el corazón del POS.
//!
//! Invariantes del plano (references/modulos.md → Venta). NO se rompen:
//!   - ⚠️ La venta se persiste en SQLite ANTES de imprimir. (La impresión la
//!     dispara el frontend DESPUÉS de que este módulo confirma; aquí solo se
//!     persiste. Si la impresora falla, la venta ya existe.)
//!   - ⚠️ Stock se descuenta en la MISMA transacción que la venta (atómica).
//!   - ⚠️ Montos en centavos enteros. El total es suma de líneas.
//!   - ⚠️ Toda venta pertenece a una caja_sesion abierta.
//!   - `descripcion` de línea = copia del nombre al momento (histórico inmutable).
//!   - Productos con controla_stock = 0 se venden sin tocar stock.
//!   - El total se cuadra a la fuente (recalculado aquí en Rust), NO se confía
//!     en el total que mande el frontend.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::comun::{ahora, encolar_sync, nuevo_id};

/// Una línea del carrito tal como la manda el frontend.
/// `precio_unitario_centavos` y descuentos los RECALCULA/valida el backend
/// contra el producto real; no se confía ciegamente en el frontend para montos.
#[derive(Debug, Deserialize)]
pub struct LineaCarrito {
    pub producto_id: String,
    pub cantidad: f64,
    /// Descuento por línea en centavos (ya calculado por el frontend; se valida).
    pub descuento_linea_centavos: i64,
}

/// Un pago de la venta (puede haber varios = pago mixto).
#[derive(Debug, Deserialize)]
pub struct PagoEntrada {
    pub metodo: String, // efectivo | tarjeta | transferencia | vale
    pub monto_centavos: i64,
    pub recibido_centavos: Option<i64>, // solo efectivo
}

/// Payload completo del cobro.
#[derive(Debug, Deserialize)]
pub struct CobroEntrada {
    pub caja_sesion_id: String,
    pub usuario_pos_id: String,
    /// Descuento global en centavos (sobre el subtotal ya con descuentos de línea).
    pub descuento_global_centavos: i64,
    /// Cliente asignado. OBLIGATORIO si algún pago es a crédito.
    pub cliente_id: Option<String>,
    pub lineas: Vec<LineaCarrito>,
    pub pagos: Vec<PagoEntrada>,
}

#[derive(Debug, Serialize)]
pub struct VentaConfirmada {
    pub id: String,
    pub folio: i64,
    pub subtotal_centavos: i64,
    pub descuento_centavos: i64,
    pub total_centavos: i64,
    pub cambio_centavos: i64,
}

const METODOS_VALIDOS: [&str; 5] = ["efectivo", "tarjeta", "transferencia", "vale", "credito"];

/// Datos del producto que necesitamos al vender (leídos en la transacción).
struct ProductoVenta {
    nombre: String,
    precio_venta_centavos: i64,
    costo_centavos: i64,
    precio_mayoreo_centavos: Option<i64>,
    cantidad_mayoreo: Option<i64>,
    controla_stock: bool,
    stock: f64,
    unidad: String,
    iva_tasa: i64,
    es_kit: bool,
}

/// Procesa un cobro completo de forma ATÓMICA.
/// Recalcula todos los montos desde los productos reales (no confía en el
/// frontend para el dinero), descuenta stock, genera folio por dispositivo,
/// y persiste venta + líneas + pagos. Todo o nada.
pub fn cobrar(
    con: &mut Connection,
    dispositivo_id: &str,
    c: CobroEntrada,
) -> Result<VentaConfirmada, String> {
    if c.lineas.is_empty() {
        return Err("No hay productos en la venta.".into());
    }
    if c.pagos.is_empty() {
        return Err("No se registró ningún pago.".into());
    }
    for p in &c.pagos {
        if !METODOS_VALIDOS.contains(&p.metodo.as_str()) {
            return Err(format!("Método de pago inválido: {}", p.metodo));
        }
        if p.monto_centavos <= 0 {
            return Err("Cada pago debe ser mayor a cero.".into());
        }
    }
    if c.descuento_global_centavos < 0 {
        return Err("El descuento global no puede ser negativo.".into());
    }

    // Monto total que va a crédito (puede ser parte de un pago mixto).
    let monto_credito: i64 = c
        .pagos
        .iter()
        .filter(|p| p.metodo == "credito")
        .map(|p| p.monto_centavos)
        .sum();
    // Si hay crédito, debe haber cliente.
    if monto_credito > 0 && c.cliente_id.is_none() {
        return Err("Una venta a crédito necesita un cliente asignado.".into());
    }

    let tx = con
        .transaction()
        .map_err(|e| format!("no se pudo abrir transacción: {e}"))?;

    // 1. Verificar que la caja siga abierta (no se vende sin caja).
    let caja_ok: Option<i64> = tx
        .query_row(
            "SELECT 1 FROM caja_sesiones WHERE id = ?1 AND estado = 'abierta'",
            rusqlite::params![c.caja_sesion_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("error al verificar caja: {e}"))?;
    if caja_ok.is_none() {
        return Err("La caja no está abierta. Abre caja antes de vender.".into());
    }

    // 2. Recalcular cada línea desde el producto real. Cuadrar a la fuente.
    let mut subtotal_centavos: i64 = 0;
    struct LineaCalculada {
        producto_id: String,
        descripcion: String,
        cantidad: f64,
        precio_unitario_centavos: i64,
        costo_unitario_centavos: i64,
        descuento_linea_centavos: i64,
        total_linea_centavos: i64,
        tasa_impuesto_base: i64,
        controla_stock: bool,
        stock_actual: f64,
        unidad: String,
        es_kit: bool,
    }
    let mut calculadas: Vec<LineaCalculada> = Vec::new();

    for l in &c.lineas {
        if l.cantidad <= 0.0 {
            return Err("La cantidad de cada línea debe ser mayor a cero.".into());
        }
        let prod = leer_producto(&tx, &l.producto_id)?;

        // Mayoreo automático: si cantidad >= cantidad_mayoreo, usa precio mayoreo.
        let precio_unitario = match (prod.precio_mayoreo_centavos, prod.cantidad_mayoreo) {
            (Some(pm), Some(cm)) if cm > 0 && l.cantidad >= cm as f64 => pm,
            _ => prod.precio_venta_centavos,
        };

        // Importe de línea = precio * cantidad, redondeado a centavo entero.
        let bruto = (precio_unitario as f64 * l.cantidad).round() as i64;
        let desc = l.descuento_linea_centavos.max(0).min(bruto); // no más que el bruto
        let total_linea = bruto - desc;

        subtotal_centavos += total_linea;

        calculadas.push(LineaCalculada {
            producto_id: l.producto_id.clone(),
            descripcion: prod.nombre.clone(),
            cantidad: l.cantidad,
            precio_unitario_centavos: precio_unitario,
            costo_unitario_centavos: prod.costo_centavos,
            descuento_linea_centavos: desc,
            total_linea_centavos: total_linea,
            tasa_impuesto_base: prod.iva_tasa,
            controla_stock: prod.controla_stock,
            stock_actual: prod.stock,
            unidad: prod.unidad.clone(),
            es_kit: prod.es_kit,
        });
    }

    // 3. Descuento global, acotado al subtotal.
    let descuento_global = c.descuento_global_centavos.min(subtotal_centavos);
    let neto_centavos = subtotal_centavos - descuento_global;

    // 3b. Impuesto configurable (IVA / Sales Tax / IEPS…).
    // Leemos la config de impuesto y calculamos el desglose. El descuento global
    // se reparte proporcionalmente entre las líneas para el cálculo del impuesto.
    let cfg_imp = super::config::leer_impuesto(&tx);
    let lineas_imp: Vec<super::impuestos::LineaImpuesto> = calculadas
        .iter()
        .map(|lc| {
            // Repartir el descuento global proporcional al peso de la línea.
            let importe = if subtotal_centavos > 0 {
                let proporcion = lc.total_linea_centavos as f64 / subtotal_centavos as f64;
                (lc.total_linea_centavos as f64 - descuento_global as f64 * proporcion).round() as i64
            } else {
                lc.total_linea_centavos
            };
            super::impuestos::LineaImpuesto {
                importe_centavos: importe,
                tasa_base: lc.tasa_impuesto_base,
            }
        })
        .collect();
    let desglose = super::impuestos::calcular(&cfg_imp, &lineas_imp);

    // El total que paga el cliente:
    //   - modo "incluido" o impuesto inactivo: el neto (no cambia).
    //   - modo "agregado": neto + impuesto (se suma).
    let iva_centavos = desglose.impuesto_centavos;
    let total_centavos = if cfg_imp.activo && cfg_imp.modo == "agregado" {
        neto_centavos + iva_centavos
    } else {
        neto_centavos
    };
    // descuento_centavos en la cabecera = solo el global (los de línea ya están
    // restados en cada total_linea).

    // 4. Validar que los pagos cubran el total.
    let total_pagado: i64 = c.pagos.iter().map(|p| p.monto_centavos).sum();
    if total_pagado < total_centavos {
        return Err(format!(
            "El pago (${:.2}) no cubre el total (${:.2}).",
            total_pagado as f64 / 100.0,
            total_centavos as f64 / 100.0
        ));
    }
    // El cambio solo aplica al efectivo/excedente real, NUNCA al crédito (no hay
    // vuelto sobre fiado). El crédito cubre exactamente su parte. Cambio = lo
    // pagado por métodos reales menos lo que esos métodos debían cubrir.
    let pagado_real: i64 = c
        .pagos
        .iter()
        .filter(|p| p.metodo != "credito")
        .map(|p| p.monto_centavos)
        .sum();
    let a_cubrir_real = total_centavos - monto_credito; // lo que no se fía
    let cambio_centavos = (pagado_real - a_cubrir_real).max(0);

    // 5. Validar stock disponible ANTES de descontar (mensaje claro por producto).
    for lc in &calculadas {
        if lc.controla_stock && lc.stock_actual < lc.cantidad {
            return Err(format!(
                "Stock insuficiente de {}: hay {} y se piden {}.",
                lc.descripcion, fmt_cant(lc.stock_actual, &lc.unidad), fmt_cant(lc.cantidad, &lc.unidad)
            ));
        }
    }

    // 6. Generar folio consecutivo por dispositivo.
    let folio: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(folio), 0) + 1 FROM ventas WHERE dispositivo_id = ?1",
            rusqlite::params![dispositivo_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("error al generar folio: {e}"))?;

    let venta_id = nuevo_id();
    let ts = ahora();

    // 7. Insertar cabecera.
    tx.execute(
        "INSERT INTO ventas
           (id, folio, dispositivo_id, usuario_pos_id, caja_sesion_id, cliente_id, subtotal_centavos,
            descuento_centavos, iva_centavos, total_centavos, estado, creado_en,
            actualizado_en, sincronizado)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'completada',?11,?11,0)",
        rusqlite::params![
            venta_id, folio, dispositivo_id, c.usuario_pos_id, c.caja_sesion_id, c.cliente_id,
            subtotal_centavos, descuento_global, iva_centavos, total_centavos, ts
        ],
    )
    .map_err(|e| format!("error al crear venta: {e}"))?;

    // 8. Insertar líneas + descontar stock + rastro de ajuste, atómico.
    for lc in &calculadas {
        let linea_id = nuevo_id();
        tx.execute(
            "INSERT INTO venta_lineas
               (id, venta_id, producto_id, descripcion, cantidad, precio_unitario_centavos,
                costo_unitario_centavos, descuento_linea_centavos, total_linea_centavos, creado_en, actualizado_en)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)",
            rusqlite::params![
                linea_id, venta_id, lc.producto_id, lc.descripcion, lc.cantidad,
                lc.precio_unitario_centavos, lc.costo_unitario_centavos,
                lc.descuento_linea_centavos, lc.total_linea_centavos, ts
            ],
        )
        .map_err(|e| format!("error al crear línea de venta: {e}"))?;

        // Encolar la línea.
        let payload_linea = serde_json::json!({
            "id": linea_id, "venta_id": venta_id, "producto_id": lc.producto_id,
            "descripcion": lc.descripcion, "cantidad": lc.cantidad,
            "precio_unitario_centavos": lc.precio_unitario_centavos,
            "costo_unitario_centavos": lc.costo_unitario_centavos,
            "descuento_linea_centavos": lc.descuento_linea_centavos,
            "total_linea_centavos": lc.total_linea_centavos, "creado_en": ts, "actualizado_en": ts,
        });
        encolar_sync(&tx, "venta_lineas", &linea_id, "insert", &payload_linea)
            .map_err(|e| format!("error al encolar línea: {e}"))?;

        // Descontar stock.
        if lc.es_kit {
            // Un kit descuenta el stock de sus COMPONENTES (no el suyo).
            // cantidad_componente_a_descontar = cantidad_en_kit × cantidad_kits_vendidos.
            let componentes = super::kits::componentes_para_descuento(&tx, &lc.producto_id)?;
            for comp in &componentes {
                if !comp.controla_stock {
                    continue;
                }
                let descontar = comp.cantidad * lc.cantidad;
                let nuevo_stock = comp.stock - descontar;
                tx.execute(
                    "UPDATE productos SET stock = ?2, actualizado_en = ?3 WHERE id = ?1",
                    rusqlite::params![comp.producto_id, nuevo_stock, ts],
                )
                .map_err(|e| format!("error al descontar componente del kit: {e}"))?;

                let payload_comp = serde_json::json!({
                    "id": comp.producto_id, "stock": nuevo_stock, "actualizado_en": ts,
                });
                encolar_sync(&tx, "productos", &comp.producto_id, "update", &payload_comp)
                    .map_err(|e| format!("error al encolar stock de componente: {e}"))?;
            }
        } else if lc.controla_stock {
            let nuevo_stock = lc.stock_actual - lc.cantidad;
            tx.execute(
                "UPDATE productos SET stock = ?2, actualizado_en = ?3 WHERE id = ?1",
                rusqlite::params![lc.producto_id, nuevo_stock, ts],
            )
            .map_err(|e| format!("error al descontar stock: {e}"))?;

            let payload_prod = serde_json::json!({
                "id": lc.producto_id, "stock": nuevo_stock, "actualizado_en": ts,
            });
            encolar_sync(&tx, "productos", &lc.producto_id, "update", &payload_prod)
                .map_err(|e| format!("error al encolar stock: {e}"))?;
        }
    }

    // 9. Insertar pagos. El cambio se imputa al primer pago en efectivo.
    let mut cambio_restante = cambio_centavos;
    for p in &c.pagos {
        let pago_id = nuevo_id();
        let (recibido, cambio_pago) = if p.metodo == "efectivo" {
            let recibido = p.recibido_centavos.unwrap_or(p.monto_centavos);
            // Imputamos todo el cambio al primer efectivo encontrado.
            let cambio = cambio_restante;
            cambio_restante = 0;
            (Some(recibido), Some(cambio))
        } else {
            (None, None)
        };
        tx.execute(
            "INSERT INTO pagos
               (id, venta_id, metodo, monto_centavos, recibido_centavos, cambio_centavos,
                creado_en, actualizado_en)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
            rusqlite::params![pago_id, venta_id, p.metodo, p.monto_centavos, recibido, cambio_pago, ts],
        )
        .map_err(|e| format!("error al crear pago: {e}"))?;

        let payload_pago = serde_json::json!({
            "id": pago_id, "venta_id": venta_id, "metodo": p.metodo,
            "monto_centavos": p.monto_centavos, "recibido_centavos": recibido,
            "cambio_centavos": cambio_pago, "creado_en": ts, "actualizado_en": ts,
        });
        encolar_sync(&tx, "pagos", &pago_id, "insert", &payload_pago)
            .map_err(|e| format!("error al encolar pago: {e}"))?;
    }

    // 9b. Si hubo crédito, registrar el cargo a la cuenta del cliente (sube saldo).
    if monto_credito > 0 {
        let cliente_id = c
            .cliente_id
            .as_deref()
            .ok_or_else(|| "Falta el cliente para la venta a crédito.".to_string())?;
        super::clientes::registrar_cargo_en_tx(
            &tx,
            dispositivo_id,
            cliente_id,
            monto_credito,
            &venta_id,
            &c.usuario_pos_id,
            &c.caja_sesion_id,
        )?;
    }

    // 10. Encolar la cabecera de venta.
    let payload_venta = serde_json::json!({
        "id": venta_id, "folio": folio, "dispositivo_id": dispositivo_id,
        "usuario_pos_id": c.usuario_pos_id, "caja_sesion_id": c.caja_sesion_id,
        "cliente_id": c.cliente_id,
        "subtotal_centavos": subtotal_centavos, "descuento_centavos": descuento_global,
        "iva_centavos": 0, "total_centavos": total_centavos, "estado": "completada",
        "creado_en": ts, "actualizado_en": ts,
    });
    encolar_sync(&tx, "ventas", &venta_id, "insert", &payload_venta)
        .map_err(|e| format!("error al encolar venta: {e}"))?;

    tx.commit().map_err(|e| format!("error al confirmar venta: {e}"))?;

    Ok(VentaConfirmada {
        id: venta_id,
        folio,
        subtotal_centavos,
        descuento_centavos: descuento_global,
        total_centavos,
        cambio_centavos,
    })
}

fn leer_producto(con: &Connection, id: &str) -> Result<ProductoVenta, String> {
    con.query_row(
        "SELECT nombre, precio_venta_centavos, costo_centavos, precio_mayoreo_centavos,
                cantidad_mayoreo, controla_stock, stock, unidad, iva_tasa, es_kit
         FROM productos WHERE id = ?1 AND eliminado = 0",
        rusqlite::params![id],
        |row| {
            Ok(ProductoVenta {
                nombre: row.get(0)?,
                precio_venta_centavos: row.get(1)?,
                costo_centavos: row.get(2)?,
                precio_mayoreo_centavos: row.get(3)?,
                cantidad_mayoreo: row.get(4)?,
                controla_stock: row.get::<_, i64>(5)? != 0,
                stock: row.get(6)?,
                unidad: row.get(7)?,
                iva_tasa: row.get(8)?,
                es_kit: row.get::<_, i64>(9)? != 0,
            })
        },
    )
    .optional()
    .map_err(|e| format!("error al leer producto: {e}"))?
    .ok_or_else(|| "Un producto de la venta ya no existe.".to_string())
}

fn fmt_cant(n: f64, unidad: &str) -> String {
    if unidad == "pieza" {
        format!("{}", n as i64)
    } else {
        format!("{:.3} {}", n, unidad)
    }
}