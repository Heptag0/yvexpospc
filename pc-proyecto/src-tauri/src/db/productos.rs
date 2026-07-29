//! Productos (`productos`) y ajustes de inventario (`ajustes_inventario`).
//!
//! Invariantes del plano (references/modulos.md → Inventario):
//!   - ⚠️ El stock NUNCA se edita a mano en `productos.stock` sin generar un
//!     `ajuste_inventario`. Todo cambio de stock deja rastro o viene de
//!     ventas/devoluciones. La suma de movimientos reconstruye el stock.
//!   - El cajero NUNCA ve `costo_centavos` ni márgenes. Se filtra aquí, en la
//!     capa de datos, no solo en la UI.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::comun::{ahora, encolar_sync, nuevo_id};

/// Roles que pueden ver costos/márgenes.
fn puede_ver_costos(rol: &str) -> bool {
    rol == "dueno" || rol == "gerente"
}

#[derive(Debug, Serialize)]
pub struct Producto {
    pub id: String,
    pub codigo_barras: Option<String>,
    pub nombre: String,
    pub categoria_id: Option<String>,
    pub precio_venta_centavos: i64,
    /// null si el rol no puede ver costos.
    pub costo_centavos: Option<i64>,
    pub precio_mayoreo_centavos: Option<i64>,
    pub cantidad_mayoreo: Option<i64>,
    pub iva_tasa: i64,
    pub controla_stock: bool,
    pub stock: f64,
    pub unidad: String,
    pub stock_minimo: f64,
    pub favorito: bool,
    pub es_kit: bool,
}

#[derive(Debug, Deserialize)]
pub struct NuevoProducto {
    pub codigo_barras: Option<String>,
    pub nombre: String,
    pub categoria_id: Option<String>,
    pub precio_venta_centavos: i64,
    pub costo_centavos: Option<i64>,
    pub precio_mayoreo_centavos: Option<i64>,
    pub cantidad_mayoreo: Option<i64>,
    pub iva_tasa: i64,
    pub controla_stock: bool,
    pub stock_inicial: f64,
    pub unidad: String,
    pub stock_minimo: f64,
    pub favorito: bool,
    /// Si es un kit (paquete). Por defecto false (producto normal).
    #[serde(default)]
    pub es_kit: bool,
    /// Componentes del kit (solo si es_kit = true).
    #[serde(default)]
    pub componentes: Vec<super::kits::ComponenteEntrada>,
}

#[derive(Debug, Deserialize)]
pub struct EditarProducto {
    pub id: String,
    pub codigo_barras: Option<String>,
    pub nombre: String,
    pub categoria_id: Option<String>,
    pub precio_venta_centavos: i64,
    pub costo_centavos: Option<i64>,
    pub precio_mayoreo_centavos: Option<i64>,
    pub cantidad_mayoreo: Option<i64>,
    pub iva_tasa: i64,
    pub controla_stock: bool,
    pub unidad: String,
    pub stock_minimo: f64,
    pub favorito: bool,
    #[serde(default)]
    pub es_kit: bool,
    #[serde(default)]
    pub componentes: Vec<super::kits::ComponenteEntrada>,
}

const UNIDADES_VALIDAS: [&str; 3] = ["pieza", "kg", "litro"];

fn validar_producto_base(nombre: &str, unidad: &str, iva: i64, precio: i64) -> Result<(), String> {
    if nombre.trim().is_empty() {
        return Err("El nombre del producto no puede estar vacío.".into());
    }
    if !UNIDADES_VALIDAS.contains(&unidad) {
        return Err(format!("Unidad inválida: {unidad}"));
    }
    if iva != 0 && iva != 16 {
        return Err("El IVA debe ser 0 o 16.".into());
    }
    if precio < 0 {
        return Err("El precio no puede ser negativo.".into());
    }
    Ok(())
}

/// Construye un Producto desde una fila, ocultando costos según el rol.
fn fila_a_producto(row: &rusqlite::Row, ver_costos: bool) -> rusqlite::Result<Producto> {
    let costo: i64 = row.get("costo_centavos")?;
    let mayoreo: Option<i64> = row.get("precio_mayoreo_centavos")?;
    Ok(Producto {
        id: row.get("id")?,
        codigo_barras: row.get("codigo_barras")?,
        nombre: row.get("nombre")?,
        categoria_id: row.get("categoria_id")?,
        precio_venta_centavos: row.get("precio_venta_centavos")?,
        costo_centavos: if ver_costos { Some(costo) } else { None },
        // El mayoreo sí lo ve el cajero (lo necesita para vender), pero el costo no.
        precio_mayoreo_centavos: mayoreo,
        cantidad_mayoreo: row.get("cantidad_mayoreo")?,
        iva_tasa: row.get("iva_tasa")?,
        controla_stock: row.get::<_, i64>("controla_stock")? != 0,
        stock: row.get("stock")?,
        unidad: row.get("unidad")?,
        stock_minimo: row.get("stock_minimo")?,
        favorito: row.get::<_, i64>("favorito")? != 0,
        es_kit: row.get::<_, i64>("es_kit")? != 0,
    })
}

/// Lista productos no eliminados. Filtra costos según rol.
/// `filtro` opcional busca por nombre o código (LIKE).
pub fn listar(
    con: &Connection,
    rol: &str,
    filtro: Option<&str>,
    solo_stock_bajo: bool,
    solo_negativos: bool,
) -> Result<Vec<Producto>, String> {
    let ver = puede_ver_costos(rol);
    let mut sql = String::from(
        "SELECT id, codigo_barras, nombre, categoria_id, precio_venta_centavos,
                costo_centavos, precio_mayoreo_centavos, cantidad_mayoreo, iva_tasa,
                controla_stock, stock, unidad, stock_minimo, favorito, es_kit
         FROM productos
         WHERE eliminado = 0",
    );
    if solo_stock_bajo {
        sql.push_str(" AND controla_stock = 1 AND stock <= stock_minimo");
    }
    if solo_negativos {
        sql.push_str(" AND controla_stock = 1 AND stock < 0");
    }
    if filtro.is_some() {
        sql.push_str(" AND (nombre LIKE ?1 OR codigo_barras LIKE ?1)");
    }
    sql.push_str(" ORDER BY nombre COLLATE NOCASE");

    let mut stmt = con.prepare(&sql).map_err(|e| format!("error al preparar productos: {e}"))?;
    let mapper = |row: &rusqlite::Row| fila_a_producto(row, ver);

    let filas = if let Some(f) = filtro {
        let patron = format!("%{}%", f.trim());
        stmt.query_map(rusqlite::params![patron], mapper)
    } else {
        stmt.query_map([], mapper)
    }
    .map_err(|e| format!("error al consultar productos: {e}"))?;

    let mut out = Vec::new();
    for f in filas {
        out.push(f.map_err(|e| format!("error al leer producto: {e}"))?);
    }
    Ok(out)
}

/// Cuenta cuántos productos tienen stock negativo (para la alerta de revisión).
/// Solo cuenta los que controlan stock; los kits no controlan stock propio.
pub fn contar_negativos(con: &Connection) -> Result<i64, String> {
    con.query_row(
        "SELECT COUNT(*) FROM productos WHERE eliminado = 0 AND controla_stock = 1 AND stock < 0",
        [],
        |r| r.get(0),
    )
    .map_err(|e| format!("error al contar negativos: {e}"))
}

/// Busca un producto por código de barras exacto (para escaneo en venta).
pub fn por_codigo(con: &Connection, rol: &str, codigo: &str) -> Result<Option<Producto>, String> {
    let ver = puede_ver_costos(rol);
    // Normalizar el código buscado igual que al guardar: sin espacios y en
    // MAYÚSCULAS. Así "8plb" encuentra el "8PLB" guardado.
    let codigo_norm = codigo.trim().to_uppercase();
    con.query_row(
        "SELECT id, codigo_barras, nombre, categoria_id, precio_venta_centavos,
                costo_centavos, precio_mayoreo_centavos, cantidad_mayoreo, iva_tasa,
                controla_stock, stock, unidad, stock_minimo, favorito, es_kit
         FROM productos WHERE codigo_barras = ?1 AND eliminado = 0",
        rusqlite::params![codigo_norm],
        |row| fila_a_producto(row, ver),
    )
    .optional()
    .map_err(|e| format!("error al buscar por código: {e}"))
}

pub fn crear(con: &Connection, dispositivo_id: &str, d: &NuevoProducto) -> Result<String, String> {
    validar_producto_base(&d.nombre, &d.unidad, d.iva_tasa, d.precio_venta_centavos)?;
    let nombre = d.nombre.trim();
    // Código vacío -> NULL (productos sin código).
    let codigo = d.codigo_barras.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(|s| s.to_uppercase());

    // Unicidad de código (si tiene): no permitir dos productos con el mismo.
    if let Some(c) = &codigo {
        let dup: Option<i64> = con
            .query_row(
                "SELECT 1 FROM productos WHERE codigo_barras = ?1 AND eliminado = 0",
                rusqlite::params![c],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| format!("error al verificar código: {e}"))?;
        if dup.is_some() {
            return Err(format!("Ya existe un producto con el código {c}."));
        }
    }

    let id = nuevo_id();
    let ts = ahora();
    // Si es kit, el costo por defecto es la suma de componentes (ajustable si
    // el usuario mandó un costo explícito).
    let costo = if d.es_kit {
        match d.costo_centavos {
            Some(c) => c,
            None => super::kits::costo_calculado(con, &d.componentes)?,
        }
    } else {
        d.costo_centavos.unwrap_or(0)
    };
    // Un kit no controla su propio stock (su disponibilidad viene de componentes).
    let controla = if d.es_kit { false } else { d.controla_stock };
    let stock_ini = if d.es_kit { 0.0 } else { d.stock_inicial };

    con.execute(
        "INSERT INTO productos
           (id, codigo_barras, nombre, categoria_id, precio_venta_centavos, costo_centavos,
            precio_mayoreo_centavos, cantidad_mayoreo, iva_tasa, controla_stock, stock, unidad,
            stock_minimo, imagen_ruta, favorito, creado_en, actualizado_en, eliminado, dispositivo_id, es_kit)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,NULL,?14,?15,?15,0,?16,?17)",
        rusqlite::params![
            id, codigo, nombre, d.categoria_id, d.precio_venta_centavos, costo,
            d.precio_mayoreo_centavos, d.cantidad_mayoreo, d.iva_tasa,
            controla as i64, stock_ini, d.unidad, d.stock_minimo,
            d.favorito as i64, ts, dispositivo_id, d.es_kit as i64
        ],
    )
    .map_err(|e| format!("error al crear producto: {e}"))?;

    // Si es kit, guardar sus componentes.
    if d.es_kit {
        super::kits::reemplazar_componentes(con, &id, dispositivo_id, &d.componentes)?;
    }

    // Si nace con stock inicial > 0 y controla stock, dejamos rastro como
    // ajuste de "entrada" (coherente con la invariante de auditoría).
    if controla && stock_ini > 0.0 {
        registrar_ajuste_en_tx(
            con, dispositivo_id, &id, "entrada", stock_ini, stock_ini,
            "Stock inicial", "sistema",
        )?;
    }

    let payload = serde_json::json!({
        "id": id, "codigo_barras": codigo, "nombre": nombre, "categoria_id": d.categoria_id,
        "precio_venta_centavos": d.precio_venta_centavos, "costo_centavos": costo,
        "precio_mayoreo_centavos": d.precio_mayoreo_centavos, "cantidad_mayoreo": d.cantidad_mayoreo,
        "iva_tasa": d.iva_tasa, "controla_stock": d.controla_stock as i64,
        "stock": d.stock_inicial, "unidad": d.unidad, "stock_minimo": d.stock_minimo,
        "favorito": d.favorito as i64, "creado_en": ts, "actualizado_en": ts,
        "eliminado": 0, "dispositivo_id": dispositivo_id,
    });
    encolar_sync(con, "productos", &id, "insert", &payload)
        .map_err(|e| format!("error al encolar producto: {e}"))?;

    Ok(id)
}

/// Edita campos del producto. NO toca `stock` (eso es exclusivo de ajustes).
pub fn editar(con: &Connection, d: &EditarProducto) -> Result<(), String> {
    validar_producto_base(&d.nombre, &d.unidad, d.iva_tasa, d.precio_venta_centavos)?;
    let nombre = d.nombre.trim();
    let codigo = d.codigo_barras.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(|s| s.to_uppercase());

    if let Some(c) = &codigo {
        let dup: Option<i64> = con
            .query_row(
                "SELECT 1 FROM productos WHERE codigo_barras = ?1 AND eliminado = 0 AND id <> ?2",
                rusqlite::params![c, d.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| format!("error al verificar código: {e}"))?;
        if dup.is_some() {
            return Err(format!("Ya existe otro producto con el código {c}."));
        }
    }

    let ts = ahora();
    // Costo del kit: por defecto suma de componentes (ajustable).
    let costo = if d.es_kit {
        match d.costo_centavos {
            Some(c) => c,
            None => super::kits::costo_calculado(con, &d.componentes)?,
        }
    } else {
        d.costo_centavos.unwrap_or(0)
    };
    let controla = if d.es_kit { false } else { d.controla_stock };
    let n = con
        .execute(
            "UPDATE productos SET
               codigo_barras = ?2, nombre = ?3, categoria_id = ?4, precio_venta_centavos = ?5,
               costo_centavos = ?6, precio_mayoreo_centavos = ?7, cantidad_mayoreo = ?8,
               iva_tasa = ?9, controla_stock = ?10, unidad = ?11, stock_minimo = ?12,
               favorito = ?13, actualizado_en = ?14, es_kit = ?15
             WHERE id = ?1 AND eliminado = 0",
            rusqlite::params![
                d.id, codigo, nombre, d.categoria_id, d.precio_venta_centavos, costo,
                d.precio_mayoreo_centavos, d.cantidad_mayoreo, d.iva_tasa,
                controla as i64, d.unidad, d.stock_minimo, d.favorito as i64, ts, d.es_kit as i64
            ],
        )
        .map_err(|e| format!("error al editar producto: {e}"))?;
    if n == 0 {
        return Err("No se encontró el producto.".into());
    }

    // Si es kit, actualizar sus componentes. Si dejó de ser kit, limpiarlos.
    if d.es_kit {
        let disp: String = con
            .query_row("SELECT dispositivo_id FROM productos WHERE id = ?1", rusqlite::params![d.id], |r| r.get(0))
            .map_err(|e| format!("error al leer dispositivo: {e}"))?;
        super::kits::reemplazar_componentes(con, &d.id, &disp, &d.componentes)?;
    } else {
        con.execute("DELETE FROM kit_componentes WHERE kit_id = ?1", rusqlite::params![d.id])
            .map_err(|e| format!("error al limpiar componentes: {e}"))?;
    }

    let payload = serde_json::json!({
        "id": d.id, "codigo_barras": codigo, "nombre": nombre, "categoria_id": d.categoria_id,
        "precio_venta_centavos": d.precio_venta_centavos, "costo_centavos": costo,
        "precio_mayoreo_centavos": d.precio_mayoreo_centavos, "cantidad_mayoreo": d.cantidad_mayoreo,
        "iva_tasa": d.iva_tasa, "controla_stock": d.controla_stock as i64, "unidad": d.unidad,
        "stock_minimo": d.stock_minimo, "favorito": d.favorito as i64, "actualizado_en": ts,
    });
    encolar_sync(con, "productos", &d.id, "update", &payload)
        .map_err(|e| format!("error al encolar producto: {e}"))?;
    Ok(())
}

pub fn eliminar(con: &Connection, id: &str) -> Result<(), String> {
    let ts = ahora();
    let n = con
        .execute(
            "UPDATE productos SET eliminado = 1, actualizado_en = ?2 WHERE id = ?1 AND eliminado = 0",
            rusqlite::params![id, ts],
        )
        .map_err(|e| format!("error al eliminar producto: {e}"))?;
    if n == 0 {
        return Err("No se encontró el producto.".into());
    }
    let payload = serde_json::json!({ "id": id, "eliminado": 1, "actualizado_en": ts });
    encolar_sync(con, "productos", id, "update", &payload)
        .map_err(|e| format!("error al encolar baja de producto: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------- Ajustes

#[derive(Debug, Deserialize)]
pub struct AjusteStock {
    pub producto_id: String,
    pub tipo: String,      // "entrada" | "merma" | "ajuste_conteo"
    pub cantidad: f64,     // para entrada/merma: magnitud; para ajuste_conteo: nuevo stock
    pub motivo: Option<String>,
    pub usuario_pos_id: String,
}

const TIPOS_AJUSTE: [&str; 3] = ["entrada", "merma", "ajuste_conteo"];

/// Aplica un ajuste de stock DENTRO de una transacción: actualiza
/// `productos.stock` Y escribe el rastro en `ajustes_inventario`, atómicamente.
/// Esta es la única vía permitida para cambiar stock fuera de ventas/devoluciones.
pub fn aplicar_ajuste(con: &mut Connection, dispositivo_id: &str, a: &AjusteStock) -> Result<f64, String> {
    if !TIPOS_AJUSTE.contains(&a.tipo.as_str()) {
        return Err(format!("Tipo de ajuste inválido: {}", a.tipo));
    }
    if a.cantidad < 0.0 {
        return Err("La cantidad no puede ser negativa.".into());
    }

    let tx = con.transaction().map_err(|e| format!("no se pudo abrir transacción: {e}"))?;

    // Stock actual y si controla stock.
    let (stock_actual, controla): (f64, i64) = tx
        .query_row(
            "SELECT stock, controla_stock FROM productos WHERE id = ?1 AND eliminado = 0",
            rusqlite::params![a.producto_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| format!("error al leer producto: {e}"))?
        .ok_or_else(|| "No se encontró el producto.".to_string())?;

    if controla == 0 {
        return Err("Este producto no controla stock (es un servicio).".into());
    }

    // Calcular delta y nuevo stock según el tipo.
    let (delta, nuevo_stock) = match a.tipo.as_str() {
        "entrada" => (a.cantidad, stock_actual + a.cantidad),
        "merma" => {
            let ns = stock_actual - a.cantidad;
            (-a.cantidad, ns)
        }
        "ajuste_conteo" => {
            // Aquí `cantidad` ES el nuevo stock contado físicamente.
            (a.cantidad - stock_actual, a.cantidad)
        }
        _ => unreachable!(),
    };

    if nuevo_stock < 0.0 {
        return Err("El ajuste dejaría el stock en negativo.".into());
    }

    let ts = ahora();
    tx.execute(
        "UPDATE productos SET stock = ?2, actualizado_en = ?3 WHERE id = ?1",
        rusqlite::params![a.producto_id, nuevo_stock, ts],
    )
    .map_err(|e| format!("error al actualizar stock: {e}"))?;

    registrar_ajuste_en_tx(
        &tx, dispositivo_id, &a.producto_id, &a.tipo, delta, nuevo_stock,
        a.motivo.as_deref().unwrap_or(""), &a.usuario_pos_id,
    )?;

    // Encolar el update del producto (su stock cambió).
    let payload_prod = serde_json::json!({
        "id": a.producto_id, "stock": nuevo_stock, "actualizado_en": ts,
    });
    encolar_sync(&tx, "productos", &a.producto_id, "update", &payload_prod)
        .map_err(|e| format!("error al encolar producto: {e}"))?;

    tx.commit().map_err(|e| format!("error al confirmar ajuste: {e}"))?;
    Ok(nuevo_stock)
}

/// Inserta el registro de ajuste (rastro) y lo encola. Recibe conexión ya en
/// transacción para que stock + rastro sean atómicos.
pub fn registrar_ajuste_en_tx(
    con: &Connection,
    dispositivo_id: &str,
    producto_id: &str,
    tipo: &str,
    delta: f64,
    stock_resultante: f64,
    motivo: &str,
    usuario_pos_id: &str,
) -> Result<(), String> {
    let id = nuevo_id();
    let ts = ahora();
    con.execute(
        "INSERT INTO ajustes_inventario
           (id, producto_id, tipo, cantidad, stock_resultante, motivo, usuario_pos_id,
            creado_en, actualizado_en, sincronizado, dispositivo_id)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8,0,?9)",
        rusqlite::params![id, producto_id, tipo, delta, stock_resultante, motivo, usuario_pos_id, ts, dispositivo_id],
    )
    .map_err(|e| format!("error al registrar ajuste: {e}"))?;

    let payload = serde_json::json!({
        "id": id, "producto_id": producto_id, "tipo": tipo, "cantidad": delta,
        "stock_resultante": stock_resultante, "motivo": motivo, "usuario_pos_id": usuario_pos_id,
        "creado_en": ts, "actualizado_en": ts, "dispositivo_id": dispositivo_id,
    });
    encolar_sync(con, "ajustes_inventario", &id, "insert", &payload)
        .map_err(|e| format!("error al encolar ajuste: {e}"))?;
    Ok(())
}
