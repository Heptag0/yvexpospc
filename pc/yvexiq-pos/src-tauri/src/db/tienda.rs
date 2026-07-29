//! Tienda en línea — puente del POS de escritorio con la API de tiendas del VPS
//! (`https://tienda.yvexiq.com`).
//!
//! Reutiliza las credenciales de dispositivo que ya guarda la vinculación
//! (`sync_dispositivo_id` / `sync_token` en `config`) con los headers
//! `X-Dispositivo-Id` / `X-Dispositivo-Token`, exactamente como `sync_push.rs`.
//!
//! Qué cubre:
//!   - Publicar / actualizar / desactivar la tienda y consultar su estado.
//!   - Verificar disponibilidad de slug.
//!   - Listar pedidos web y cambiar su estado (con validación local de la
//!     transición, espejo del mapa del backend, para fallar rápido y cálido).
//!   - Al marcar un pedido como entregado (`completar_pedido`), registrar la
//!     venta LOCAL en ventas / venta_lineas / pagos con la misma mecánica
//!     transaccional que una venta de caja (folio por dispositivo, encolado en
//!     `cola_sync` para que suba a la nube y aparezca en reportes).
//!
//! Anti-duplicado de la venta web: la marca vive en `config`
//! (`tienda_ventaweb_{pedidoId}` -> venta_id) y se escribe DENTRO de la misma
//! transacción que la venta: o nacen las dos o ninguna. Si se reintenta (doble
//! toque, reintento tras error), se detecta y NO se duplica.

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

use super::comun::{ahora, encolar_sync, nuevo_id};

/// Base de la API de tiendas (el mismo VPS del escáner, servicio separado).
const BASE: &str = "https://tienda.yvexiq.com";

const TIMEOUT: Duration = Duration::from_secs(30);

// ============================================================================
// Credenciales y HTTP
// ============================================================================

struct Cred {
    dispositivo_id: String,
    token: String,
}

/// Lee las credenciales del dispositivo. Si la caja no está vinculada a la
/// nube, devuelve un error cálido (la UI lo muestra tal cual, no es un 500 feo).
fn credenciales(con: &Connection) -> Result<Cred, String> {
    let leer = |clave: &str| -> Option<String> {
        con.query_row(
            "SELECT valor FROM config WHERE clave = ?1",
            rusqlite::params![clave],
            |r| r.get::<_, String>(0),
        )
        .ok()
    };
    match (leer("sync_dispositivo_id"), leer("sync_token")) {
        (Some(d), Some(t)) if !d.is_empty() && !t.is_empty() => {
            Ok(Cred { dispositivo_id: d, token: t })
        }
        _ => Err(
            "Esta caja aún no está vinculada a la nube. Vincúlala desde Configuración → Conexión con la nube y tu tienda estará lista."
                .to_string(),
        ),
    }
}

/// Traduce un error de ureq a un mensaje cálido en español.
fn mapear_error(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, r) => {
            let detalle = r.into_string().unwrap_or_default();
            let detalle = detalle.trim();
            match code {
                401 => "La nube no reconoció a esta caja. Revisa la vinculación en Configuración → Conexión con la nube.".to_string(),
                404 => "No encontramos eso en el servidor. Quizá la tienda aún no se publica.".to_string(),
                409 => if detalle.is_empty() {
                    "Ese cambio de estado ya no es válido (alguien más movió el pedido).".to_string()
                } else {
                    limpiar_detalle(detalle)
                },
                _ => {
                    if detalle.is_empty() {
                        format!("El servidor de la tienda respondió con un error (HTTP {code}). Intenta de nuevo en un momento.")
                    } else {
                        limpiar_detalle(detalle)
                    }
                }
            }
        }
        _ => "No pudimos conectar con la tienda en línea. Revisa tu internet e inténtalo de nuevo.".to_string(),
    }
}

/// El VPS responde {"detail": "mensaje"}; sacamos el mensaje legible.
fn limpiar_detalle(detalle: &str) -> String {
    if let Ok(v) = serde_json::from_str::<Value>(detalle) {
        if let Some(d) = v.get("detail").and_then(|d| d.as_str()) {
            return d.to_string();
        }
    }
    detalle.chars().take(300).collect()
}

fn parsear(resp: Result<ureq::Response, ureq::Error>) -> Result<Value, String> {
    let r = resp.map_err(mapear_error)?;
    r.into_json::<Value>()
        .map_err(|_| "El servidor respondió algo inesperado. Intenta de nuevo en un momento.".to_string())
}

fn get(con: &Connection, ruta: &str, query: &[(&str, &str)]) -> Result<Value, String> {
    let cred = credenciales(con)?;
    let mut req = ureq::get(&format!("{BASE}{ruta}"))
        .set("X-Dispositivo-Id", &cred.dispositivo_id)
        .set("X-Dispositivo-Token", &cred.token)
        .timeout(TIMEOUT);
    for (k, v) in query {
        req = req.query(k, v);
    }
    parsear(req.call())
}

fn post(con: &Connection, ruta: &str, cuerpo: Option<&Value>) -> Result<Value, String> {
    let cred = credenciales(con)?;
    let req = ureq::post(&format!("{BASE}{ruta}"))
        .set("Content-Type", "application/json")
        .set("X-Dispositivo-Id", &cred.dispositivo_id)
        .set("X-Dispositivo-Token", &cred.token)
        .timeout(TIMEOUT);
    let resp = match cuerpo {
        Some(c) => req.send_json(c.clone()),
        None => req.send_string("{}"),
    };
    parsear(resp)
}

// ============================================================================
// Endpoints: estado, publicar, slug, desactivar
// ============================================================================

/// GET /api/tienda/estado — config + conteo de pedidos nuevos.
pub fn estado(con: &Connection) -> Result<Value, String> {
    get(con, "/api/tienda/estado", &[])
}

/// POST /api/tienda/publicar — el frontend arma el payload completo (v2/v3);
/// aquí solo se reenvía. Al éxito, guarda slug/url en la config local.
pub fn publicar(con: &Connection, payload: Value) -> Result<Value, String> {
    let resp = post(con, "/api/tienda/publicar", Some(&payload))?;
    if resp.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        let mut claves = Vec::new();
        for (campo, clave) in [
            ("slug", "tienda_slug"),
            ("url_publica", "tienda_url_publica"),
            ("url_path", "tienda_url_path"),
        ] {
            if let Some(v) = resp.get(campo).and_then(|v| v.as_str()) {
                claves.push((clave, v.to_string()));
            }
        }
        for (clave, valor) in claves {
            let _ = con.execute(
                "INSERT INTO config (clave, valor) VALUES (?1, ?2)
                 ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
                rusqlite::params![clave, valor],
            );
        }
    }
    Ok(resp)
}

/// GET /api/tienda/slug-disponible?slug=x
pub fn slug_disponible(con: &Connection, slug: &str) -> Result<Value, String> {
    get(con, "/api/tienda/slug-disponible", &[("slug", slug)])
}

/// POST /api/tienda/desactivar
pub fn desactivar(con: &Connection) -> Result<Value, String> {
    post(con, "/api/tienda/desactivar", None)
}

// ============================================================================
// Pedidos web
// ============================================================================

/// GET /api/tienda/pedidos?estado=&desde=
pub fn pedidos(
    con: &Connection,
    estado: Option<&str>,
    desde: Option<&str>,
) -> Result<Value, String> {
    let mut query: Vec<(&str, &str)> = Vec::new();
    if let Some(e) = estado.filter(|e| !e.trim().is_empty()) {
        query.push(("estado", e.trim()));
    }
    if let Some(d) = desde.filter(|d| !d.trim().is_empty()) {
        query.push(("desde", d.trim()));
    }
    get(con, "/api/tienda/pedidos", &query)
}

/// Transiciones válidas, ESPEJO de `TRANSICIONES_PEDIDO` en tienda_utils.py.
/// 'preparando' es legado: solo puede ir a listo | cancelado.
fn transicion_valida(actual: &str, nuevo: &str) -> bool {
    let destinos: &[&str] = match actual {
        "nuevo" => &["listo", "cancelado"],
        "preparando" => &["listo", "cancelado"],
        "listo" => &["entregado", "cancelado"],
        _ => &[],
    };
    destinos.contains(&nuevo)
}

const ESTADOS_VALIDOS: [&str; 5] = ["nuevo", "preparando", "listo", "entregado", "cancelado"];

/// Cambia el estado de un pedido. Valida la transición ANTES de llamar al
/// servidor (mismo mapa del backend) para responder rápido y cálido.
pub fn cambiar_estado_pedido(
    con: &Connection,
    pedido_id: &str,
    estado_actual: &str,
    estado_nuevo: &str,
) -> Result<Value, String> {
    let nuevo = estado_nuevo.trim().to_lowercase();
    if !ESTADOS_VALIDOS.contains(&nuevo.as_str()) {
        return Err("Ese estado no existe. Usa: nuevo, listo, entregado o cancelado.".into());
    }
    if !transicion_valida(&estado_actual.trim().to_lowercase(), &nuevo) {
        return Err(format!(
            "No se puede pasar de «{}» a «{}».",
            estado_actual.trim(),
            nuevo
        ));
    }
    post(
        con,
        &format!("/api/tienda/pedidos/{pedido_id}/estado"),
        Some(&serde_json::json!({ "estado": nuevo })),
    )
}

// ============================================================================
// Venta web: registrar en ventas/venta_lineas/pagos al completar el pedido
// ============================================================================

#[derive(Debug, Serialize)]
pub struct ResultadoCompletar {
    /// El pedido quedó como 'entregado' en el servidor.
    pub pedido_entregado: bool,
    /// La venta local se registró (o ya estaba registrada).
    pub venta_registrada: bool,
    /// true si la venta YA existía (anti-duplicado disparado).
    pub ya_registrada: bool,
    /// Folio local de la venta registrada (si aplica).
    pub folio: Option<i64>,
    /// Aviso cálido para la UI (p. ej. "venta_no_registrada" sin caja abierta).
    pub aviso: Option<String>,
}

/// Completa un pedido web:
///   (a) pasa el pedido a 'entregado' en el servidor,
///   (b) si OK, registra la venta LOCAL (misma mecánica que ventas.rs: folio
///       por dispositivo, transacción atómica, encolado en cola_sync).
///
/// Si NO hay caja abierta, la venta no se registra pero el estado del pedido
/// NO se revierte: se devuelve `aviso = "venta_no_registrada"` para que la UI
/// lo explique cálidamente.
pub fn completar_pedido(
    con: &mut Connection,
    pedido_id: &str,
    usuario_pos_id: &str,
) -> Result<ResultadoCompletar, String> {
    // 1. Traer el pedido FRESCO del servidor (los montos se cuadran a la
    //    fuente: no se confía en lo que la UI tenga en pantalla).
    let lista = pedidos(con, None, None)?;
    let pedido = lista
        .get("pedidos")
        .and_then(|p| p.as_array())
        .and_then(|arr| arr.iter().find(|p| p.get("id").and_then(|i| i.as_str()) == Some(pedido_id)))
        .cloned()
        .ok_or_else(|| "No encontramos ese pedido en el servidor. Actualiza la lista.".to_string())?;

    let estado_actual = pedido
        .get("estado")
        .and_then(|e| e.as_str())
        .unwrap_or("")
        .to_string();

    // 2. Cambiar a 'entregado' (validando la transición localmente primero).
    cambiar_estado_pedido(con, pedido_id, &estado_actual, "entregado")?;

    let mut res = ResultadoCompletar {
        pedido_entregado: true,
        venta_registrada: false,
        ya_registrada: false,
        folio: None,
        aviso: None,
    };

    // 3. Anti-duplicado: si la marca ya existe, devolvemos la venta apuntada.
    let clave_marca = format!("tienda_ventaweb_{pedido_id}");
    let marca: Option<String> = con
        .query_row(
            "SELECT valor FROM config WHERE clave = ?1",
            rusqlite::params![clave_marca],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("error al revisar la venta web: {e}"))?
        .flatten();
    if let Some(venta_id) = marca {
        res.ya_registrada = true;
        res.venta_registrada = true;
        res.folio = con
            .query_row(
                "SELECT folio FROM ventas WHERE id = ?1",
                rusqlite::params![venta_id],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        return Ok(res);
    }

    // 4. Caja abierta: sin turno no se registra la venta (y NO se revierte el
    //    pedido). La UI lo dice cálidamente con el aviso.
    let dispositivo_id: String = con
        .query_row(
            "SELECT valor FROM config WHERE clave = 'dispositivo_id'",
            [],
            |r| r.get(0),
        )
        .map_err(|_| "No se encontró el dispositivo. ¿El POS está configurado?".to_string())?;
    let sesion = super::caja::sesion_abierta(con, &dispositivo_id)?;
    let sesion = match sesion {
        Some(s) => s,
        None => {
            res.aviso = Some(
                "venta_no_registrada: El pedido quedó como entregado, pero no hay caja abierta, así que la venta no se apuntó en el corte. Ábrela antes de completar pedidos.".to_string(),
            );
            return Ok(res);
        }
    };

    // 5. Registrar la venta web (transacción atómica, como ventas::cobrar).
    let (folio, total) = registrar_venta_web(con, &dispositivo_id, usuario_pos_id, &sesion.id, &pedido, &clave_marca)?;
    res.venta_registrada = true;
    res.folio = Some(folio);
    let _ = total;
    Ok(res)
}

struct LineaWeb {
    producto_id: Option<String>, // None = línea libre (envío o producto borrado)
    nombre: String,
    cantidad: f64,
    precio_centavos: i64,
}

/// Inserta venta + líneas + pago + marca anti-duplicado en UNA transacción y
/// encola todo en cola_sync (igual que una venta de caja). Devuelve (folio, total).
fn registrar_venta_web(
    con: &mut Connection,
    dispositivo_id: &str,
    usuario_pos_id: &str,
    caja_sesion_id: &str,
    pedido: &Value,
    clave_marca: &str,
) -> Result<(i64, i64), String> {
    let total_centavos = pedido
        .get("total_centavos")
        .and_then(|t| t.as_i64())
        .unwrap_or(0);
    let entrega = pedido.get("entrega").and_then(|e| e.as_str()).unwrap_or("pickup");
    let pago = pedido.get("pago").and_then(|p| p.as_str()).unwrap_or("efectivo");
    let items = pedido.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default();

    // Líneas: items tal cual + "Envío a domicilio" por la diferencia
    // (total − Σitems), como hace el móvil. El envío es ingreso y debe verse
    // en el corte y en reportes.
    let mut lineas: Vec<LineaWeb> = items
        .iter()
        .map(|it| LineaWeb {
            producto_id: it.get("producto_id").and_then(|p| p.as_str()).map(|s| s.to_string()),
            nombre: it
                .get("nombre")
                .and_then(|n| n.as_str())
                .unwrap_or("Producto")
                .to_string(),
            cantidad: it.get("cantidad").and_then(|c| c.as_f64()).unwrap_or(1.0),
            precio_centavos: it.get("precio_centavos").and_then(|p| p.as_i64()).unwrap_or(0),
        })
        .collect();
    if lineas.is_empty() {
        return Err("El pedido no tiene productos.".into());
    }
    let suma_items: i64 = lineas
        .iter()
        .map(|l| (l.precio_centavos as f64 * l.cantidad).round() as i64)
        .sum();
    let envio = total_centavos - suma_items;
    if entrega == "domicilio" && envio > 0 {
        lineas.push(LineaWeb {
            producto_id: None,
            nombre: "Envío a domicilio".into(),
            cantidad: 1.0,
            precio_centavos: envio,
        });
    }

    let metodo = if pago == "en_linea" { "tarjeta" } else { "efectivo" };
    let total = suma_items + if entrega == "domicilio" && envio > 0 { envio } else { 0 };
    let total = if total > 0 { total } else { total_centavos };

    let tx = con
        .transaction()
        .map_err(|e| format!("no se pudo abrir transacción: {e}"))?;

    // ¿El producto sigue existiendo en el catálogo local? Si no, la línea se
    // guarda libre (producto_id NULL) con su nombre y precio históricos.
    for l in &mut lineas {
        if let Some(pid) = &l.producto_id {
            let existe: Option<i64> = tx
                .query_row(
                    "SELECT 1 FROM productos WHERE id = ?1 AND eliminado = 0",
                    rusqlite::params![pid],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| format!("error al revisar producto: {e}"))?;
            if existe.is_none() {
                l.producto_id = None;
            }
        }
    }

    // Folio consecutivo por dispositivo (misma regla que ventas::cobrar).
    let folio: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(folio), 0) + 1 FROM ventas WHERE dispositivo_id = ?1",
            rusqlite::params![dispositivo_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("error al generar folio: {e}"))?;

    let venta_id = nuevo_id();
    let ts = ahora();
    // Origen identificable: "Pedido web {folio8}" (los primeros 8 del id del
    // pedido, en mayúsculas, como lo ve el cliente en la tienda).
    let folio_web: String = clave_marca
        .trim_start_matches("tienda_ventaweb_")
        .chars()
        .take(8)
        .collect::<String>()
        .to_uppercase();
    let origen = format!("Pedido web {folio_web}");

    tx.execute(
        "INSERT INTO ventas
           (id, folio, dispositivo_id, usuario_pos_id, caja_sesion_id, cliente_id,
            subtotal_centavos, descuento_centavos, iva_centavos, total_centavos,
            estado, creado_en, actualizado_en, sincronizado, origen)
         VALUES (?1,?2,?3,?4,?5,NULL,?6,0,0,?7,'completada',?8,?8,0,?9)",
        rusqlite::params![venta_id, folio, dispositivo_id, usuario_pos_id, caja_sesion_id,
                          total, total, ts, origen],
    )
    .map_err(|e| format!("error al crear la venta web: {e}"))?;

    // Líneas + descuento de stock (como una venta normal: los productos con
    // controla_stock bajan; las líneas libres no tocan stock).
    for l in &lineas {
        let linea_id = nuevo_id();
        let total_linea = (l.precio_centavos as f64 * l.cantidad).round() as i64;
        tx.execute(
            "INSERT INTO venta_lineas
               (id, venta_id, producto_id, descripcion, cantidad, precio_unitario_centavos,
                costo_unitario_centavos, descuento_linea_centavos, total_linea_centavos,
                creado_en, actualizado_en)
             VALUES (?1,?2,?3,?4,?5,?6,0,0,?7,?8,?8)",
            rusqlite::params![linea_id, venta_id, l.producto_id, l.nombre, l.cantidad,
                              l.precio_centavos, total_linea, ts],
        )
        .map_err(|e| format!("error al crear línea de la venta web: {e}"))?;

        let payload_linea = serde_json::json!({
            "id": linea_id, "venta_id": venta_id, "producto_id": l.producto_id,
            "descripcion": l.nombre, "cantidad": l.cantidad,
            "precio_unitario_centavos": l.precio_centavos,
            "costo_unitario_centavos": 0, "descuento_linea_centavos": 0,
            "total_linea_centavos": total_linea, "creado_en": ts, "actualizado_en": ts,
        });
        encolar_sync(&tx, "venta_lineas", &linea_id, "insert", &payload_linea)
            .map_err(|e| format!("error al encolar línea: {e}"))?;

        // Stock: igual que una venta normal (solo si controla_stock).
        if let Some(pid) = &l.producto_id {
            let ctrl: Option<i64> = tx
                .query_row(
                    "SELECT controla_stock FROM productos WHERE id = ?1",
                    rusqlite::params![pid],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| format!("error al leer stock: {e}"))?;
            if ctrl == Some(1) {
                tx.execute(
                    "UPDATE productos SET stock = stock - ?2, actualizado_en = ?3 WHERE id = ?1",
                    rusqlite::params![pid, l.cantidad, ts],
                )
                .map_err(|e| format!("error al descontar stock: {e}"))?;
                let nuevo_stock: f64 = tx
                    .query_row(
                        "SELECT stock FROM productos WHERE id = ?1",
                        rusqlite::params![pid],
                        |r| r.get(0),
                    )
                    .unwrap_or(0.0);
                let payload_prod = serde_json::json!({
                    "id": pid, "stock": nuevo_stock, "actualizado_en": ts,
                });
                encolar_sync(&tx, "productos", pid, "update", &payload_prod)
                    .map_err(|e| format!("error al encolar stock: {e}"))?;
            }
        }
    }

    // Pago único por el total: 'en_linea' cuenta como tarjeta.
    let pago_id = nuevo_id();
    let recibido = if metodo == "efectivo" { Some(total) } else { None };
    tx.execute(
        "INSERT INTO pagos
           (id, venta_id, metodo, monto_centavos, recibido_centavos, cambio_centavos,
            creado_en, actualizado_en)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
        rusqlite::params![pago_id, venta_id, metodo, total, recibido, Some(0), ts],
    )
    .map_err(|e| format!("error al crear el pago: {e}"))?;

    let payload_pago = serde_json::json!({
        "id": pago_id, "venta_id": venta_id, "metodo": metodo,
        "monto_centavos": total, "recibido_centavos": recibido,
        "cambio_centavos": 0, "creado_en": ts, "actualizado_en": ts,
    });
    encolar_sync(&tx, "pagos", &pago_id, "insert", &payload_pago)
        .map_err(|e| format!("error al encolar pago: {e}"))?;

    // Cabecera a la cola (sin `origen`: la nube no recibe esa columna).
    let payload_venta = serde_json::json!({
        "id": venta_id, "folio": folio, "dispositivo_id": dispositivo_id,
        "usuario_pos_id": usuario_pos_id, "caja_sesion_id": caja_sesion_id,
        "cliente_id": Value::Null,
        "subtotal_centavos": total, "descuento_centavos": 0, "iva_centavos": 0,
        "total_centavos": total, "estado": "completada",
        "creado_en": ts, "actualizado_en": ts,
    });
    encolar_sync(&tx, "ventas", &venta_id, "insert", &payload_venta)
        .map_err(|e| format!("error al encolar venta: {e}"))?;

    // Marca anti-duplicado DENTRO de la transacción: venta y marca nacen juntas.
    tx.execute(
        "INSERT INTO config (clave, valor) VALUES (?1, ?2)
         ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
        rusqlite::params![clave_marca, venta_id],
    )
    .map_err(|e| format!("error al marcar la venta web: {e}"))?;

    tx.commit()
        .map_err(|e| format!("error al confirmar la venta web: {e}"))?;

    Ok((folio, total))
}

// ============================================================================
// Config local de la tienda (clave-valor en `config`, prefijo tienda_)
// ============================================================================

/// Claves de tienda que viven en la config local.
const CLAVES_TIENDA: [&str; 22] = [
    "tienda_plantilla",
    "tienda_tema",
    "tienda_acento",
    "tienda_whatsapp",
    "tienda_mensaje_bienvenida",
    "tienda_mostrar_stock",
    "tienda_slug",
    "tienda_giro",
    "tienda_domicilio",
    "tienda_horarios",
    "tienda_instagram",
    "tienda_facebook",
    "tienda_tiktok",
    "tienda_entrega_pickup",
    "tienda_entrega_domicilio",
    "tienda_costo_envio_centavos",
    "tienda_pago_efectivo",
    "tienda_link_pago",
    "tienda_ocultar_agotados",
    "tienda_url_publica",
    "tienda_url_path",
    "tienda_productos_ids", // JSON con los ids elegidos para publicar
];

/// Lee la config local de la tienda (solo las claves tienda_*).
pub fn config_local(con: &Connection) -> Result<std::collections::HashMap<String, String>, String> {
    let mut mapa = std::collections::HashMap::new();
    let mut stmt = con
        .prepare("SELECT clave, valor FROM config WHERE clave LIKE 'tienda_%'")
        .map_err(|e| e.to_string())?;
    let filas = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))
        .map_err(|e| e.to_string())?;
    for f in filas.flatten() {
        // Las marcas anti-duplicado (tienda_ventaweb_*) no son config editable.
        if f.0.starts_with("tienda_ventaweb_") {
            continue;
        }
        mapa.insert(f.0, f.1.unwrap_or_default());
    }
    Ok(mapa)
}

/// Guarda claves de tienda (solo permite las conocidas, prefijo tienda_).
pub fn guardar_config_local(
    con: &Connection,
    claves: &std::collections::HashMap<String, String>,
) -> Result<(), String> {
    for (clave, valor) in claves {
        if !CLAVES_TIENDA.contains(&clave.as_str()) {
            continue; // ignora claves ajenas; no rompe
        }
        con.execute(
            "INSERT INTO config (clave, valor) VALUES (?1, ?2)
             ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
            rusqlite::params![clave, valor],
        )
        .map_err(|e| format!("error al guardar {clave}: {e}"))?;
    }
    Ok(())
}

// ============================================================================
// Productos del catálogo local listos para publicar
// ============================================================================

/// Junta los productos activos del catálogo local para el payload de publicar.
/// `ids` = selección del dueño (vacío/None = todos los activos).
/// departamento = nombre de la categoría; stock solo si controla_stock.
pub fn productos_para_publicar(
    con: &Connection,
    ids: Option<Vec<String>>,
) -> Result<Vec<Value>, String> {
    let mut stmt = con
        .prepare(
            "SELECT p.id, p.nombre, p.precio_venta_centavos, p.controla_stock,
                    p.stock, COALESCE(c.nombre, '') AS depto
             FROM productos p
             LEFT JOIN categorias c ON c.id = p.categoria_id
             WHERE p.eliminado = 0
             ORDER BY p.nombre COLLATE NOCASE",
        )
        .map_err(|e| format!("error al leer productos: {e}"))?;
    let filas = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)? != 0,
                r.get::<_, f64>(4)?,
                r.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let filtro = ids.filter(|v| !v.is_empty());
    let mut salida = Vec::new();
    let mut orden = 0i64;
    for f in filas.flatten() {
        if let Some(ref sel) = filtro {
            if !sel.contains(&f.0) {
                continue;
            }
        }
        salida.push(serde_json::json!({
            "producto_id": f.0,
            "nombre": f.1,
            "descripcion": "",
            "precio_centavos": f.2,
            "departamento": f.5,
            "orden": orden,
            "stock": if f.3 { Some(f.4.round() as i64) } else { None::<i64> },
        }));
        orden += 1;
    }
    Ok(salida)
}
