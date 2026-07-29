//! Importador de datos de Eleventa (desde el JSON que genera el puente Python).
//!
//! Flujo: el puente Python lee el .FDB y exporta a JSON. Aquí leemos ese JSON
//! y lo insertamos en SQLite con las reglas del POS:
//!   - Montos decimales de Eleventa → centavos enteros (×100, redondeo).
//!   - UUID v4 nuevo para cada registro; mapa id-viejo→UUID para relaciones.
//!   - Dedup de productos por código de barras (no duplicar).
//!   - Categorías duplicadas por nombre (case-insensitive) se unifican.
//!   - Stock entra como ajuste_inventario tipo entrada (rastro).
//!   - Productos sin categoría → "General".
//!
//! El usuario elige qué importar (productos, clientes, ventas) vía flags.

use std::collections::HashMap;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::comun::{ahora, nuevo_id};

// ---------------------------------------------------------------- Estructuras JSON

#[derive(Debug, Deserialize)]
pub struct ExportEleventa {
    #[serde(default)]
    pub categorias: Vec<CatJson>,
    #[serde(default)]
    pub productos: Vec<ProdJson>,
    #[serde(default)]
    pub clientes: Vec<CliJson>,
    #[serde(default)]
    pub ventas: Vec<VentaJson>,
}

#[derive(Debug, Deserialize)]
pub struct CatJson {
    pub id_eleventa: i64,
    pub nombre: String,
}

#[derive(Debug, Deserialize)]
pub struct ProdJson {
    pub codigo: String,
    pub nombre: String,
    pub costo: f64,
    pub precio: f64,
    pub mayoreo: f64,
    pub categoria_id_eleventa: Option<i64>,
    pub controla_stock: bool,
    pub stock: f64,
    pub stock_minimo: f64,
}

#[derive(Debug, Deserialize)]
pub struct CliJson {
    pub nombre: String,
    pub telefono: String,
    pub email: String,
    pub direccion: String,
    pub saldo: f64,
    pub limite_credito: f64,
}

#[derive(Debug, Deserialize)]
pub struct VentaJson {
    pub folio: i64,
    pub fecha: Option<String>,
    pub subtotal: f64,
    pub total: f64,
    pub forma_pago: String,
    #[serde(default)]
    pub lineas: Vec<LineaJson>,
}

#[derive(Debug, Deserialize)]
pub struct LineaJson {
    pub codigo: String,
    pub nombre: String,
    pub cantidad: f64,
    pub precio: f64,
    pub total: f64,
}

// ---------------------------------------------------------------- Resultado

#[derive(Debug, Serialize, Default)]
pub struct ResumenImport {
    pub categorias_creadas: i64,
    pub categorias_unificadas: i64,
    pub productos_creados: i64,
    pub productos_omitidos: i64,
    pub clientes_creados: i64,
    pub ventas_creadas: i64,
    pub advertencias: Vec<String>,
}

/// Opciones: qué importar (el usuario las elige en la vista previa).
#[derive(Debug, Deserialize)]
pub struct OpcionesImport {
    pub importar_productos: bool,
    pub importar_clientes: bool,
    pub importar_ventas: bool,
}

/// Convierte un monto decimal de Eleventa a centavos enteros del POS.
fn a_centavos(decimal: f64) -> i64 {
    (decimal * 100.0).round() as i64
}

/// Cuenta cuántos hay de cada cosa (para la vista previa, sin insertar).
pub fn previsualizar(export: &ExportEleventa) -> ResumenImport {
    ResumenImport {
        categorias_creadas: export.categorias.len() as i64,
        productos_creados: export.productos.len() as i64,
        clientes_creados: export.clientes.len() as i64,
        ventas_creadas: export.ventas.len() as i64,
        ..Default::default()
    }
}

/// Importa el export a SQLite según las opciones. Todo en una transacción:
/// si algo falla, no queda nada a medias.
pub fn importar(
    con: &mut Connection,
    dispositivo_id: &str,
    export: &ExportEleventa,
    opciones: &OpcionesImport,
) -> Result<ResumenImport, String> {
    let mut r = ResumenImport::default();
    let ts = ahora();

    // Usuario dueño para asociar ajustes de inventario y ventas históricas.
    let usuario_dueno: String = con
        .query_row(
            "SELECT id FROM usuarios_pos WHERE rol='dueno' AND eliminado=0 LIMIT 1",
            [],
            |r| r.get(0),
        )
        .map_err(|_| "No hay un usuario dueño para asociar la importación.".to_string())?;

    let tx = con.transaction().map_err(|e| format!("error al iniciar transacción: {e}"))?;

    // -------------------------------------------------- Categorías
    // Mapa id_eleventa → uuid_pos. Unifica por nombre (case-insensitive).
    let mut mapa_cat: HashMap<i64, String> = HashMap::new();
    let mut cat_por_nombre: HashMap<String, String> = HashMap::new();

    // Aseguramos una categoría "General" para productos sin categoría.
    let general_id = nuevo_id();
    tx.execute(
        "INSERT INTO categorias (id, nombre, orden, creado_en, actualizado_en, eliminado, dispositivo_id)
         VALUES (?1, 'General', 0, ?2, ?2, 0, ?3)",
        rusqlite::params![general_id, ts, dispositivo_id],
    )
    .map_err(|e| format!("error al crear categoría General: {e}"))?;
    cat_por_nombre.insert("general".to_string(), general_id.clone());
    r.categorias_creadas += 1;

    for cat in &export.categorias {
        let nombre = cat.nombre.trim();
        // "- Sin Departamento -" y vacíos → General.
        let es_general = nombre.is_empty()
            || nombre.eq_ignore_ascii_case("- Sin Departamento -")
            || nombre.eq_ignore_ascii_case("General");
        if es_general {
            mapa_cat.insert(cat.id_eleventa, general_id.clone());
            continue;
        }
        let clave = nombre.to_lowercase();
        // Si ya existe una categoría con ese nombre (case-insensitive), unificar.
        if let Some(uuid) = cat_por_nombre.get(&clave) {
            mapa_cat.insert(cat.id_eleventa, uuid.clone());
            r.categorias_unificadas += 1;
            continue;
        }
        let uuid = nuevo_id();
        tx.execute(
            "INSERT INTO categorias (id, nombre, orden, creado_en, actualizado_en, eliminado, dispositivo_id)
             VALUES (?1, ?2, 0, ?3, ?3, 0, ?4)",
            rusqlite::params![uuid, nombre, ts, dispositivo_id],
        )
        .map_err(|e| format!("error al crear categoría {nombre}: {e}"))?;
        cat_por_nombre.insert(clave, uuid.clone());
        mapa_cat.insert(cat.id_eleventa, uuid.clone());
        r.categorias_creadas += 1;
    }

    // -------------------------------------------------- Productos
    if opciones.importar_productos {
        // Para dedup por código de barras: códigos ya vistos.
        let mut codigos_vistos: HashMap<String, ()> = HashMap::new();

        for p in &export.productos {
            let nombre = p.nombre.trim();
            if nombre.is_empty() {
                r.productos_omitidos += 1;
                continue;
            }
            let codigo = p.codigo.trim();
            // Dedup por código de barras (si tiene código no vacío).
            if !codigo.is_empty() {
                if codigos_vistos.contains_key(codigo) {
                    r.productos_omitidos += 1;
                    r.advertencias.push(format!("Producto duplicado por código: {nombre} ({codigo})"));
                    continue;
                }
                codigos_vistos.insert(codigo.to_string(), ());
            }

            let categoria_uuid = p
                .categoria_id_eleventa
                .and_then(|id| mapa_cat.get(&id).cloned())
                .unwrap_or_else(|| general_id.clone());

            // La unidad: Eleventa no distingue claramente; por defecto 'pieza'.
            // (El cliente puede ajustar después productos a granel.)
            let prod_id = nuevo_id();
            let codigo_val: Option<&str> = if codigo.is_empty() { None } else { Some(codigo) };
            let mayoreo_cent = if p.mayoreo > 0.0 { Some(a_centavos(p.mayoreo)) } else { None };

            tx.execute(
                "INSERT INTO productos
                   (id, codigo_barras, nombre, categoria_id, precio_venta_centavos,
                    costo_centavos, precio_mayoreo_centavos, cantidad_mayoreo, iva_tasa,
                    controla_stock, stock, unidad, stock_minimo, favorito,
                    creado_en, actualizado_en, eliminado, dispositivo_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, 0, ?8, ?9, 'pieza', ?10, 0, ?11, ?11, 0, ?12)",
                rusqlite::params![
                    prod_id,
                    codigo_val,
                    nombre,
                    categoria_uuid,
                    a_centavos(p.precio),
                    a_centavos(p.costo),
                    mayoreo_cent,
                    if p.controla_stock { 1 } else { 0 },
                    p.stock,
                    p.stock_minimo,
                    ts,
                    dispositivo_id,
                ],
            )
            .map_err(|e| format!("error al crear producto {nombre}: {e}"))?;

            // Stock inicial como ajuste de inventario (rastro), si controla stock
            // y tiene cantidad. Necesita stock_resultante y un usuario dueño.
            if p.controla_stock && p.stock != 0.0 {
                let ajuste_id = nuevo_id();
                tx.execute(
                    "INSERT INTO ajustes_inventario
                       (id, producto_id, tipo, cantidad, stock_resultante, motivo,
                        usuario_pos_id, creado_en, actualizado_en, sincronizado, dispositivo_id)
                     VALUES (?1, ?2, 'entrada', ?3, ?3, 'Importación inicial desde Eleventa',
                             ?4, ?5, ?5, 0, ?6)",
                    rusqlite::params![ajuste_id, prod_id, p.stock, usuario_dueno, ts, dispositivo_id],
                )
                .map_err(|e| format!("error al registrar stock inicial de {nombre}: {e}"))?;
            }

            r.productos_creados += 1;
        }
    }

    // -------------------------------------------------- Clientes
    if opciones.importar_clientes {
        for c in &export.clientes {
            let nombre = c.nombre.trim();
            if nombre.is_empty() {
                continue;
            }
            // La tabla clientes tiene: nombre, telefono, notas, límite y saldo.
            // Email y dirección no existen como columnas; los guardamos en notas.
            let mut notas = String::new();
            if !c.email.trim().is_empty() {
                notas.push_str(&format!("Email: {}", c.email.trim()));
            }
            if !c.direccion.trim().is_empty() {
                if !notas.is_empty() {
                    notas.push_str(" · ");
                }
                notas.push_str(&format!("Dirección: {}", c.direccion.trim()));
            }
            let cli_id = nuevo_id();
            tx.execute(
                "INSERT INTO clientes
                   (id, nombre, telefono, notas, limite_credito_centavos, saldo_centavos,
                    creado_en, actualizado_en, eliminado, dispositivo_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 0, ?8)",
                rusqlite::params![
                    cli_id,
                    nombre,
                    if c.telefono.trim().is_empty() { None } else { Some(c.telefono.trim()) },
                    if notas.is_empty() { None } else { Some(notas.as_str()) },
                    a_centavos(c.limite_credito),
                    a_centavos(c.saldo),
                    ts,
                    dispositivo_id,
                ],
            )
            .map_err(|e| format!("error al crear cliente {nombre}: {e}"))?;
            r.clientes_creados += 1;
        }
    }

    // -------------------------------------------------- Ventas históricas
    if opciones.importar_ventas {
        // Mapa código_barras → producto_id (POS) para enlazar las líneas.
        // Las líneas cuyo producto no exista se omiten (la venta conserva su
        // total en la cabecera, que es lo que más usa Diego).
        let mut mapa_prod: HashMap<String, String> = HashMap::new();
        {
            let mut stmt = tx
                .prepare("SELECT codigo_barras, id FROM productos WHERE codigo_barras IS NOT NULL AND eliminado=0")
                .map_err(|e| format!("error al leer productos para enlace: {e}"))?;
            let filas = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(|e| format!("error al mapear productos: {e}"))?;
            for f in filas {
                let (cod, id) = f.map_err(|e| format!("error fila producto: {e}"))?;
                mapa_prod.insert(cod, id);
            }
        }

        // Las ventas históricas necesitan una sesión de caja contenedora.
        let sesion_id = crear_sesion_historica(&tx, dispositivo_id, &usuario_dueno, &ts)?;

        // Las ventas históricas usan folios NEGATIVOS para no chocar con las
        // ventas reales del POS (positivas) ni entre sí. El índice único es
        // (dispositivo_id, folio); con negativos consecutivos garantizamos
        // unicidad sin importar qué folios traía Eleventa.
        let mut folio_hist: i64 = -1;

        for v in &export.ventas {
            let venta_id = nuevo_id();
            let fecha = v.fecha.clone().unwrap_or_else(|| ts.clone());
            let metodo = mapear_forma_pago(&v.forma_pago);

            tx.execute(
                "INSERT INTO ventas
                   (id, folio, dispositivo_id, usuario_pos_id, caja_sesion_id,
                    subtotal_centavos, descuento_centavos, iva_centavos, total_centavos,
                    estado, creado_en, actualizado_en, sincronizado)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, ?7, 'completada', ?8, ?8, 0)",
                rusqlite::params![
                    venta_id,
                    folio_hist,
                    dispositivo_id,
                    usuario_dueno,
                    sesion_id,
                    a_centavos(v.subtotal),
                    a_centavos(v.total),
                    fecha,
                ],
            )
            .map_err(|e| format!("error al crear venta histórica (folio Eleventa {}): {e}", v.folio))?;
            folio_hist -= 1;

            // Líneas de la venta. Solo se insertan las que enlazan a un
            // producto existente (producto_id es obligatorio). Las demás se
            // omiten; la venta conserva su total en la cabecera.
            for l in &v.lineas {
                let codigo = l.codigo.trim();
                let prod_id = match mapa_prod.get(codigo) {
                    Some(id) => id.clone(),
                    None => continue, // sin producto en el POS: omitir línea
                };
                let linea_id = nuevo_id();
                tx.execute(
                    "INSERT INTO venta_lineas
                       (id, venta_id, producto_id, descripcion, cantidad,
                        precio_unitario_centavos, costo_unitario_centavos,
                        descuento_linea_centavos, total_linea_centavos, creado_en, actualizado_en)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, ?7, ?8, ?8)",
                    rusqlite::params![
                        linea_id,
                        venta_id,
                        prod_id,
                        l.nombre.trim(),
                        l.cantidad,
                        a_centavos(l.precio),
                        a_centavos(l.total),
                        fecha,
                    ],
                )
                .map_err(|e| format!("error en línea de venta #{}: {e}", v.folio))?;
            }

            // Un pago por el total con el método mapeado.
            let pago_id = nuevo_id();
            tx.execute(
                "INSERT INTO pagos (id, venta_id, metodo, monto_centavos, creado_en, actualizado_en)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                rusqlite::params![pago_id, venta_id, metodo, a_centavos(v.total), fecha],
            )
            .map_err(|e| format!("error en pago de venta #{}: {e}", v.folio))?;

            r.ventas_creadas += 1;
        }
    }

    tx.commit().map_err(|e| format!("error al confirmar importación: {e}"))?;
    Ok(r)
}

/// Crea una sesión de caja cerrada para colgar las ventas históricas.
fn crear_sesion_historica(tx: &Connection, dispositivo_id: &str, usuario_id: &str, ts: &str) -> Result<String, String> {
    let sesion_id = nuevo_id();
    tx.execute(
        "INSERT INTO caja_sesiones
           (id, dispositivo_id, usuario_pos_id, fondo_inicial_centavos, abierta_en,
            cerrada_en, estado, actualizado_en, sincronizado)
         VALUES (?1, ?2, ?3, 0, ?4, ?4, 'cerrada', ?4, 0)",
        rusqlite::params![sesion_id, dispositivo_id, usuario_id, ts],
    )
    .map_err(|e| format!("error al crear sesión histórica: {e}"))?;
    Ok(sesion_id)
}

/// Mapea la forma de pago de Eleventa (códigos de una letra) al POS.
fn mapear_forma_pago(forma: &str) -> &'static str {
    match forma.trim().to_lowercase().as_str() {
        "e" => "efectivo",
        "t" => "tarjeta",
        "c" => "credito",
        "v" => "vale",
        _ => "efectivo", // por defecto
    }
}
