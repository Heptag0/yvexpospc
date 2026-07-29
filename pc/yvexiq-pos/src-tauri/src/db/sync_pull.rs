//! Sincronización VPS -> PC: baja lo que cambió en el negocio (la mitad que
//! faltaba; sync_push.rs ya sube lo nuestro).
//!
//! Modelo mental:
//!     PC    --sube-->  NUBE  --baja-->  MÓVIL
//!     MÓVIL --sube-->  NUBE  --baja-->  PC   <- este módulo
//!
//! Lo que baja GET /sync/bajar?desde=<ISO>:
//!   - Catálogo COMPARTIDO (categorías y productos): el PC adopta la versión
//!     canónica del negocio. El stock que baja YA refleja las ventas de todas
//!     las cajas, porque siempre SUBIMOS antes de BAJAR (ver sync_worker).
//!   - Turnos y ventas de OTRAS cajas (el servidor excluye los propios): para
//!     reportes completos del negocio. Solo se insertan; nunca se re-encolan
//!     (este módulo escribe directo en SQL, no pasa por el encolador, así que
//!     no hay eco de vuelta al VPS).
//!
//! Reglas aprendidas de los bugs del móvil (NO quitar):
//!   1. FK OFF durante la aplicación: los datos bajados referencian usuarios y
//!      turnos de otras cajas que quizá no existen aquí. El servidor ya
//!      garantizó la integridad; el PC es un espejo para esas filas.
//!   2. Usuarios espejo: se crea un usuarios_pos mínimo ('Otra caja', sin PIN,
//!      inactivo) por cada usuario foráneo, para que las referencias apunten a
//!      algo y los reportes sean coherentes.
//!   3. La marca `sync_desde` la devuelve el servidor NORMALIZADA (ISO con Z)
//!      calculada en Postgres como tiempo real, no como texto. La guardamos
//!      tal cual y la reenviamos en la próxima página; nunca la calculamos en
//!      el cliente comparando strings.
//!   4. Todo se aplica en UNA transacción por página: o entra completa o no
//!      entra; la marca solo avanza si la página se aplicó.

use rusqlite::Connection;
use serde::Deserialize;
use serde_json::Value;

/// Endpoint de bajada (mismo servidor que sync_push; si cambia el dominio,
/// tocar ambos).
const URL_BAJAR: &str = "https://pos.yvexiq.com/sync/bajar";

/// Tope de páginas por pasada. Cada página trae hasta 500 filas por entidad;
/// 10 páginas es más que suficiente para ponerse al día tras días offline.
const MAX_PAGINAS: usize = 10;

/// Respuesta del servidor. Los campos de filas van como Value genérico: el
/// servidor mezcla bools, números y nulos según la columna, y Value nos deja
/// normalizarlos con cuidado al insertar.
#[derive(Debug, Deserialize)]
struct Pagina {
    hasta: String,
    hay_mas: bool,
    #[serde(default)]
    categorias: Vec<Value>,
    #[serde(default)]
    productos: Vec<Value>,
    #[serde(default)]
    caja_sesiones: Vec<Value>,
    #[serde(default)]
    ventas: Vec<Value>,
    #[serde(default)]
    venta_lineas: Vec<Value>,
    #[serde(default)]
    pagos: Vec<Value>,
    /// Cajeros de otras cajas (sin PIN), para etiquetar ventas con nombre real.
    #[serde(default)]
    usuarios: Vec<Value>,
}

/// Resultado de una pasada de bajada (para logs y para la UI).
#[derive(Debug, Default)]
pub struct ResultadoBajada {
    pub aplicados: usize,
    pub paginas: usize,
    pub hubo_error: bool,
    pub mensaje: String,
}

// ---------------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------------

/// Baja TODAS las páginas pendientes (hasta MAX_PAGINAS). Lo llaman el hilo de
/// fondo tras cada subida y el comando manual sync_bajar_ahora.
///
/// Devuelve Ok(res) aunque no hubiera nada que bajar (no es error). Err solo
/// ante fallo de red, servidor o SQL — y en ese caso NADA queda a medias: la
/// página que falló se descartó entera y la marca no avanzó.
pub fn bajar_todo(con: &Connection) -> Result<ResultadoBajada, String> {
    let mut res = ResultadoBajada::default();

    let cred = match super::sync_push::credenciales_sync(con) {
        Some(c) => c,
        None => {
            res.mensaje = "Dispositivo no vinculado".into();
            return Ok(res); // no vinculado: no es error, simplemente no hay sync
        }
    };

    // dispositivo_id LOCAL de esta caja (lo escribió el onboarding en config).
    // Las filas del catálogo compartido lo llevan como relleno NOT NULL; las
    // ventas/turnos bajados conservan el dispositivo_id real de su caja.
    let disp_local = con
        .query_row(
            "SELECT valor FROM config WHERE clave = 'dispositivo_id'",
            [],
            |r| r.get::<_, String>(0),
        )
        .map_err(|_| "No se encontró el dispositivo local en config".to_string())?;

    for _ in 0..MAX_PAGINAS {
        let (aplicados, hay_mas) = bajar_una_pagina(con, &cred, &disp_local)?;
        res.aplicados += aplicados;
        res.paginas += 1;
        if !hay_mas {
            res.mensaje = if res.aplicados > 0 {
                format!("Bajados {} cambios", res.aplicados)
            } else {
                "Al día".into()
            };
            return Ok(res);
        }
    }

    // Se alcanzó el tope de páginas: no es error; la próxima pasada continúa
    // porque la marca ya quedó guardada en la última página aplicada.
    res.mensaje = format!(
        "Bajados {} cambios (quedan más para la próxima pasada)",
        res.aplicados
    );
    Ok(res)
}

// ---------------------------------------------------------------------------
// Una página: pedir, aplicar en transacción, avanzar la marca
// ---------------------------------------------------------------------------

fn bajar_una_pagina(
    con: &Connection,
    cred: &super::sync_push::CredencialesSync,
    disp_local: &str,
) -> Result<(usize, bool), String> {
    // Marca guardada (vacío = primera vez: el servidor usa 1970 y baja todo).
    let desde: String = con
        .query_row(
            "SELECT valor FROM config WHERE clave = 'sync_desde'",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap_or_default();

    let url = if desde.is_empty() {
        URL_BAJAR.to_string()
    } else {
        format!("{URL_BAJAR}?desde={desde}")
    };

    let resp = ureq::get(&url)
        .set("X-Dispositivo-Id", &cred.dispositivo_id)
        .set("X-Dispositivo-Token", &cred.token)
        .timeout(std::time::Duration::from_secs(60))
        .call();

    let pagina: Pagina = match resp {
        Ok(r) => r
            .into_json()
            .map_err(|e| format!("respuesta ilegible de /sync/bajar: {e}"))?,
        Err(ureq::Error::Status(code, r)) => {
            let detalle = r.into_string().unwrap_or_else(|_| "sin detalle".into());
            return Err(format!("HTTP {code} al bajar: {detalle}"));
        }
        Err(e) => return Err(format!("red al bajar: {e}")),
    };

    let aplicados = aplicar_pagina(con, &pagina, disp_local)?;

    // Avanzar la marca SOLO si la página se aplicó entera (si no, ya habría
    // saltado el error arriba). La guardamos tal cual la mandó el servidor.
    if !pagina.hasta.is_empty() && pagina.hasta != desde {
        con.execute(
            "INSERT INTO config (clave, valor) VALUES ('sync_desde', ?1)
             ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
            rusqlite::params![pagina.hasta],
        )
        .map_err(|e| format!("no se pudo guardar sync_desde: {e}"))?;
    }

    Ok((aplicados, pagina.hay_mas))
}

/// Aplica una página completa en UNA transacción con las FK apagadas.
fn aplicar_pagina(con: &Connection, p: &Pagina, disp_local: &str) -> Result<usize, String> {
    let mut aplicados = 0usize;

    // PRAGMA foreign_keys no tiene efecto DENTRO de una transacción: hay que
    // apagarlo ANTES de abrir la tx y volver a encenderlo DESPUÉS de cerrarla.
    con.pragma_update(None, "foreign_keys", "OFF")
        .map_err(|e| format!("PRAGMA foreign_keys OFF: {e}"))?;

    let resultado = (|| -> Result<usize, String> {
        let tx = con
            .unchecked_transaction()
            .map_err(|e| format!("abrir transacción: {e}"))?;

        // --- Categorías del negocio (compartidas) ---
        for c in &p.categorias {
            tx.execute(
                "INSERT INTO categorias
                    (id, nombre, color, orden, creado_en, actualizado_en, eliminado, dispositivo_id)
                 VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                    nombre = excluded.nombre,
                    color = excluded.color,
                    eliminado = excluded.eliminado,
                    actualizado_en = excluded.actualizado_en",
                rusqlite::params![
                    txt(c, "id"),
                    txt(c, "nombre"),
                    opt_txt(c, "color"),
                    opt_txt(c, "creado_en").unwrap_or_else(ahora_iso),
                    opt_txt(c, "actualizado_en").unwrap_or_else(ahora_iso),
                    bool01(c, "eliminado"),
                    disp_local,
                ],
            )
            .map_err(|e| format!("categoría {}: {e}", txt(c, "id")))?;
            aplicados += 1;
        }

        // --- Productos del negocio (compartidos; el stock YA viene neto) ---
        for prod in &p.productos {
            // `unidad` tiene CHECK ('pieza','kg','litro') en el PC; si la nube
            // manda otra cosa, caemos a 'pieza' para no abortar la página.
            let unidad = match txt(prod, "unidad").as_str() {
                "kg" => "kg",
                "litro" => "litro",
                _ => "pieza",
            };
            tx.execute(
                "INSERT INTO productos
                    (id, codigo_barras, nombre, categoria_id, precio_venta_centavos,
                     costo_centavos, precio_mayoreo_centavos, cantidad_mayoreo, iva_tasa,
                     controla_stock, stock, unidad, stock_minimo, imagen_ruta, favorito,
                     creado_en, actualizado_en, eliminado, dispositivo_id)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,NULL,0,?8,?9,?10,?11,NULL,0,?12,?13,?14,?15)
                 ON CONFLICT(id) DO UPDATE SET
                    codigo_barras = excluded.codigo_barras,
                    nombre = excluded.nombre,
                    categoria_id = excluded.categoria_id,
                    precio_venta_centavos = excluded.precio_venta_centavos,
                    costo_centavos = excluded.costo_centavos,
                    precio_mayoreo_centavos = excluded.precio_mayoreo_centavos,
                    controla_stock = excluded.controla_stock,
                    stock = excluded.stock,
                    stock_minimo = excluded.stock_minimo,
                    unidad = excluded.unidad,
                    eliminado = excluded.eliminado,
                    actualizado_en = excluded.actualizado_en",
                rusqlite::params![
                    txt(prod, "id"),
                    opt_txt(prod, "codigo_barras"),
                    txt(prod, "nombre"),
                    opt_txt(prod, "categoria_id"),
                    entero(prod, "precio_venta_centavos"),
                    entero(prod, "costo_centavos"),
                    opt_entero(prod, "precio_mayoreo_centavos"),
                    bool01(prod, "controla_stock"),
                    real(prod, "stock"),
                    unidad,
                    real(prod, "stock_minimo"),
                    opt_txt(prod, "creado_en").unwrap_or_else(ahora_iso),
                    opt_txt(prod, "actualizado_en").unwrap_or_else(ahora_iso),
                    bool01(prod, "eliminado"),
                    disp_local,
                ],
            )
            .map_err(|e| format!("producto {}: {e}", txt(prod, "id")))?;
            aplicados += 1;
        }

        // --- Usuarios espejo de otras cajas ---
        // Las ventas/turnos bajados apuntan a usuarios que esta caja no conoce.
        // Se crea un registro mínimo (sin PIN, inactivo) solo si no existe.
        let mut usuarios_vistos = std::collections::HashSet::new();
        for fila in p.caja_sesiones.iter().chain(p.ventas.iter()) {
            if let Some(uid) = opt_txt(fila, "usuario_pos_id") {
                usuarios_vistos.insert(uid);
            }
        }
        for uid in usuarios_vistos {
            tx.execute(
                "INSERT INTO usuarios_pos
                    (id, nombre, pin_hash, rol, activo, eliminado,
                     creado_en, actualizado_en, dispositivo_id)
                 VALUES (?1, 'Otra caja', '', 'cajero', 0, 0, ?2, ?2, ?3)
                 ON CONFLICT(id) DO NOTHING",
                rusqlite::params![uid, ahora_iso(), disp_local],
            )
            .map_err(|e| format!("usuario espejo {uid}: {e}"))?;
        }

        // --- Nombres reales de cajeros de otras cajas ---
        // El servidor manda los usuarios (sin PIN): se actualiza el espejo con
        // el nombre y rol reales. NUNCA se toca pin_hash y se insertan con
        // activo = 0: nadie puede entrar como ellos en esta caja, solo se
        // muestra quién vendió en tickets y reportes.
        for u in &p.usuarios {
            tx.execute(
                "INSERT INTO usuarios_pos
                    (id, nombre, pin_hash, rol, activo, eliminado,
                     creado_en, actualizado_en, dispositivo_id)
                 VALUES (?1, ?2, '', ?3, 0, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                    nombre = excluded.nombre,
                    rol = excluded.rol,
                    eliminado = excluded.eliminado,
                    actualizado_en = excluded.actualizado_en",
                rusqlite::params![
                    txt(u, "id"),
                    {
                        let n = txt(u, "nombre");
                        if n.is_empty() { "Otra caja".to_string() } else { n }
                    },
                    {
                        let r = txt(u, "rol");
                        match r.as_str() {
                            "dueno" | "gerente" => r,
                            _ => "cajero".to_string(),
                        }
                    },
                    bool01(u, "eliminado"),
                    opt_txt(u, "creado_en").unwrap_or_else(ahora_iso),
                    opt_txt(u, "actualizado_en").unwrap_or_else(ahora_iso),
                    opt_txt(u, "dispositivo_id").unwrap_or_else(|| disp_local.to_string()),
                ],
            )
            .map_err(|e| format!("usuario {}: {e}", txt(u, "id")))?;
        }

        // --- Turnos de otras cajas ---
        for s in &p.caja_sesiones {
            tx.execute(
                "INSERT INTO caja_sesiones
                    (id, dispositivo_id, usuario_pos_id, fondo_inicial_centavos,
                     abierta_en, cerrada_en, estado, actualizado_en, sincronizado)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1)
                 ON CONFLICT(id) DO UPDATE SET
                    cerrada_en = excluded.cerrada_en,
                    estado = excluded.estado,
                    actualizado_en = excluded.actualizado_en",
                rusqlite::params![
                    txt(s, "id"),
                    opt_txt(s, "dispositivo_id").unwrap_or_else(|| disp_local.to_string()),
                    opt_txt(s, "usuario_pos_id").unwrap_or_default(),
                    entero(s, "fondo_inicial_centavos"),
                    opt_txt(s, "abierta_en").unwrap_or_else(ahora_iso),
                    opt_txt(s, "cerrada_en"),
                    {
                        let e = txt(s, "estado");
                        if e == "cerrada" { "cerrada".to_string() } else { "abierta".to_string() }
                    },
                    opt_txt(s, "actualizado_en").unwrap_or_else(ahora_iso),
                ],
            )
            .map_err(|e| format!("turno {}: {e}", txt(s, "id")))?;
            aplicados += 1;
        }

        // --- Ventas de otras cajas ---
        for v in &p.ventas {
            tx.execute(
                "INSERT INTO ventas
                    (id, folio, dispositivo_id, usuario_pos_id, caja_sesion_id,
                     subtotal_centavos, descuento_centavos, iva_centavos,
                     total_centavos, estado, creado_en, actualizado_en, sincronizado)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,1)
                 ON CONFLICT(id) DO UPDATE SET
                    estado = excluded.estado,
                    actualizado_en = excluded.actualizado_en",
                rusqlite::params![
                    txt(v, "id"),
                    entero(v, "folio"),
                    opt_txt(v, "dispositivo_id").unwrap_or_else(|| disp_local.to_string()),
                    opt_txt(v, "usuario_pos_id").unwrap_or_default(),
                    txt(v, "caja_sesion_id"),
                    entero(v, "subtotal_centavos"),
                    entero(v, "descuento_centavos"),
                    entero(v, "iva_centavos"),
                    entero(v, "total_centavos"),
                    {
                        let e = txt(v, "estado");
                        match e.as_str() {
                            "cancelada" | "devuelta_parcial" | "devuelta_total" => e,
                            _ => "completada".to_string(),
                        }
                    },
                    opt_txt(v, "creado_en").unwrap_or_else(ahora_iso),
                    opt_txt(v, "actualizado_en").unwrap_or_else(ahora_iso),
                ],
            )
            .map_err(|e| format!("venta {}: {e}", txt(v, "id")))?;
            aplicados += 1;
        }

        // --- Líneas de esas ventas ---
        for l in &p.venta_lineas {
            tx.execute(
                "INSERT INTO venta_lineas
                    (id, venta_id, producto_id, descripcion, cantidad,
                     precio_unitario_centavos, descuento_linea_centavos,
                     total_linea_centavos, creado_en, actualizado_en)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)
                 ON CONFLICT(id) DO NOTHING",
                rusqlite::params![
                    txt(l, "id"),
                    txt(l, "venta_id"),
                    txt(l, "producto_id"),
                    txt(l, "descripcion"),
                    real(l, "cantidad"),
                    entero(l, "precio_unitario_centavos"),
                    entero(l, "descuento_linea_centavos"),
                    entero(l, "total_linea_centavos"),
                    opt_txt(l, "creado_en").unwrap_or_else(ahora_iso),
                ],
            )
            .map_err(|e| format!("línea {}: {e}", txt(l, "id")))?;
        }

        // --- Pagos de esas ventas ---
        for pg in &p.pagos {
            tx.execute(
                "INSERT INTO pagos
                    (id, venta_id, metodo, monto_centavos, creado_en, actualizado_en)
                 VALUES (?1,?2,?3,?4,?5,?5)
                 ON CONFLICT(id) DO NOTHING",
                rusqlite::params![
                    txt(pg, "id"),
                    txt(pg, "venta_id"),
                    {
                        let m = txt(pg, "metodo");
                        match m.as_str() {
                            "tarjeta" | "transferencia" | "vale" => m,
                            _ => "efectivo".to_string(),
                        }
                    },
                    entero(pg, "monto_centavos"),
                    opt_txt(pg, "creado_en").unwrap_or_else(ahora_iso),
                ],
            )
            .map_err(|e| format!("pago {}: {e}", txt(pg, "id")))?;
        }

        tx.commit().map_err(|e| format!("commit de bajada: {e}"))?;
        Ok(aplicados)
    })();

    // Pase lo que pase, las FK vuelven a encenderse (la conexión la siguen
    // usando las ventas del día a día).
    let _ = con.pragma_update(None, "foreign_keys", "ON");

    resultado
}

// ---------------------------------------------------------------------------
// Normalizadores Value -> tipos SQLite (reglas: dinero en centavos enteros,
// bool como 0/1, timestamps ISO texto). Nunca float para dinero.
// ---------------------------------------------------------------------------

/// Texto obligatorio; cadena vacía si falta (las columnas NOT NULL lo exigen).
fn txt(v: &Value, clave: &str) -> String {
    v.get(clave).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

/// Texto opcional (None si es null o no está).
fn opt_txt(v: &Value, clave: &str) -> Option<String> {
    v.get(clave).and_then(|x| x.as_str()).map(|s| s.to_string())
}

/// Bool del servidor -> 0/1 del PC. Tolera que venga como bool o como número.
fn bool01(v: &Value, clave: &str) -> i64 {
    match v.get(clave) {
        Some(Value::Bool(b)) => i64::from(*b),
        Some(Value::Number(n)) => i64::from(n.as_i64().unwrap_or(0) != 0),
        _ => 0,
    }
}

/// Entero obligatorio (centavos, folio). Falta/null -> 0.
fn entero(v: &Value, clave: &str) -> i64 {
    v.get(clave).and_then(|x| x.as_i64()).unwrap_or(0)
}

/// Entero opcional (precio mayoreo, que puede ser null).
fn opt_entero(v: &Value, clave: &str) -> Option<i64> {
    v.get(clave).and_then(|x| x.as_i64())
}

/// REAL (stock, cantidad a granel). Falta/null -> 0.0.
///
/// OJO (bug real): el servidor convierte a TEXTO todo valor con método `.hex`
/// pensando en los UUID... pero los floats de Python TAMBIÉN tienen `.hex()`.
/// Resultado: stock y cantidad llegan como string ("24.0") en el JSON.
/// Por eso aquí aceptamos número O texto numérico.
fn real(v: &Value, clave: &str) -> f64 {
    match v.get(clave) {
        Some(x) => x
            .as_f64()
            .or_else(|| x.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
            .unwrap_or(0.0),
        None => 0.0,
    }
}

/// Timestamp ISO UTC para filas espejo que no traen fecha propia.
fn ahora_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
