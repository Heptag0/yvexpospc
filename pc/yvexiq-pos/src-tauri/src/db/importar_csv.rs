//! Importación desde CSV (Excel exportado a CSV).
//!
//! El cliente tiene su catálogo en Excel con columnas en cualquier orden y
//! nombres. El flujo:
//!   1. `csv_analizar`: parsea el CSV, devuelve encabezados, filas de muestra,
//!      y una DETECCIÓN automática de qué columna es qué.
//!   2. El frontend muestra el mapeo, el cliente lo confirma o corrige.
//!   3. `csv_importar_productos`: con el mapeo final, inserta en SQLite.
//!
//! Reutiliza la lógica de inserción del importador (centavos, UUIDs, dedup).

use std::collections::HashMap;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::comun::{ahora, nuevo_id};

// ----------------------------------------------------------- Parseo CSV

/// Detecta el separador más probable mirando la primera línea: cuenta comas
/// vs punto y coma fuera de comillas y usa el que más aparezca.
fn detectar_separador(texto: &str) -> char {
    let primera = texto.lines().next().unwrap_or("");
    let mut comas = 0;
    let mut puntoycoma = 0;
    let mut en_comillas = false;
    for c in primera.chars() {
        match c {
            '"' => en_comillas = !en_comillas,
            ',' if !en_comillas => comas += 1,
            ';' if !en_comillas => puntoycoma += 1,
            _ => {}
        }
    }
    if puntoycoma > comas { ';' } else { ',' }
}

/// Parsea texto CSV en filas de campos. Maneja comillas dobles, el separador
/// dentro de comillas, y comillas escapadas (""). Detecta el separador.
fn parsear_csv(texto: &str) -> Vec<Vec<String>> {
    let sep = detectar_separador(texto);
    let mut filas = Vec::new();
    let mut campo = String::new();
    let mut fila: Vec<String> = Vec::new();
    let mut en_comillas = false;
    let mut chars = texto.chars().peekable();

    // Saltar BOM si está presente.
    if chars.peek() == Some(&'\u{FEFF}') {
        chars.next();
    }

    while let Some(c) = chars.next() {
        if en_comillas {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    campo.push('"');
                    chars.next();
                } else {
                    en_comillas = false;
                }
            } else {
                campo.push(c);
            }
        } else if c == '"' {
            en_comillas = true;
        } else if c == sep {
            fila.push(campo.trim().to_string());
            campo = String::new();
        } else if c == '\r' {
            // ignorar
        } else if c == '\n' {
            fila.push(campo.trim().to_string());
            campo = String::new();
            if !fila.iter().all(|c| c.is_empty()) {
                filas.push(fila);
            }
            fila = Vec::new();
        } else {
            campo.push(c);
        }
    }
    // Última fila si no terminó en salto de línea.
    if !campo.is_empty() || !fila.is_empty() {
        fila.push(campo.trim().to_string());
        if !fila.iter().all(|c| c.is_empty()) {
            filas.push(fila);
        }
    }
    filas
}

// ----------------------------------------------------------- Detección

/// Campos del POS que intentamos detectar en el CSV.
/// El frontend usa estas claves para el mapeo.
const CAMPOS_POS: [&str; 7] = [
    "nombre", "codigo", "precio", "costo", "categoria", "stock", "unidad",
];

/// Detecta qué índice de columna corresponde a cada campo del POS, mirando los
/// encabezados. Devuelve mapa campo_pos → índice de columna (o ausente).
fn detectar(encabezados: &[String]) -> HashMap<String, usize> {
    let mut mapa = HashMap::new();
    for (i, h) in encabezados.iter().enumerate() {
        let h_norm = normalizar(h);
        // El orden importa. Stock antes que precio porque "DINVENTARIO"
        // contiene "venta"; y min/max antes que stock.
        let campo = if h_norm == "dept" || contiene(&h_norm, &["categoria", "departamento", "depto", "familia", "grupo", "rubro"]) {
            "categoria"
        } else if contiene(&h_norm, &["preciomayoreo", "mayoreo"]) {
            continue; // mayoreo no se mapea (evita confundir con precio)
        } else if contiene(&h_norm, &["dinvminimo", "dinvmaximo", "stockminimo", "minimo", "maximo"]) {
            continue; // min/max de inventario, no es el stock actual
        } else if h_norm == "dinventario"
            || (contiene(&h_norm, &["existencia", "exist", "stock", "saldo"]) && !contiene(&h_norm, &["controla"]))
            || (contiene(&h_norm, &["inventario"]) && !contiene(&h_norm, &["minimo", "maximo"]))
        {
            "stock"
        } else if h_norm == "pventa" || h_norm == "pv" || contiene(&h_norm, &["precioventa", "preciopublico", "precio"]) {
            "precio"
        } else if h_norm == "pcosto" || contiene(&h_norm, &["costo", "compra"]) {
            "costo"
        } else if contiene(&h_norm, &["nombre", "descripcion", "producto", "articulo", "concepto"]) {
            "nombre"
        } else if contiene(&h_norm, &["codigo", "clave", "barras", "sku", "upc"]) {
            "codigo"
        } else if contiene(&h_norm, &["umedida", "unidad", "medida"]) {
            "unidad"
        } else {
            continue;
        };
        // Primera coincidencia gana.
        mapa.entry(campo.to_string()).or_insert(i);
    }
    mapa
}

fn normalizar(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ñ' => 'n',
            _ => c,
        })
        .filter(|c| c.is_alphanumeric())
        .collect()
}

fn contiene(h: &str, claves: &[&str]) -> bool {
    claves.iter().any(|k| h.contains(k))
}

// ----------------------------------------------------------- Estructuras

#[derive(Debug, Serialize)]
pub struct AnalisisCsv {
    pub encabezados: Vec<String>,
    pub muestra: Vec<Vec<String>>,      // primeras filas de datos (para vista previa)
    pub total_filas: usize,
    pub deteccion: HashMap<String, usize>, // campo_pos → índice columna
    pub campos_pos: Vec<String>,        // lista de campos que el POS reconoce
    pub parece_productos: bool,         // heurística: ¿este CSV parece de productos?
    pub motivo_sospecha: Option<String>, // si no parece, por qué
}

/// Heurística: decide si el CSV parece de productos. Detecta archivos de
/// ventas, movimientos o departamentos para avisar al usuario.
fn evaluar_productos(encabezados: &[String], deteccion: &HashMap<String, usize>) -> (bool, Option<String>) {
    let cols_norm: Vec<String> = encabezados.iter().map(|h| normalizar(h)).collect();
    let tiene = |claves: &[&str]| cols_norm.iter().any(|c| claves.iter().any(|k| c.contains(k)));

    // Archivos de ventas/tickets.
    if tiene(&["folio", "ticket", "venta"]) && tiene(&["total", "importe", "subtotal"]) && deteccion.get("precio").is_none() {
        return (false, Some("Este archivo parece ser de ventas o tickets, no de productos.".into()));
    }
    // Archivos de movimientos de inventario.
    if tiene(&["movimiento", "entrada", "salida", "ajuste"]) && !tiene(&["precio", "pventa", "costo"]) {
        return (false, Some("Este archivo parece ser de movimientos de inventario, no del catálogo de productos.".into()));
    }
    // Archivo de solo departamentos/categorías.
    if encabezados.len() <= 2 && deteccion.get("precio").is_none() && deteccion.get("costo").is_none() {
        return (false, Some("Este archivo parece tener solo departamentos o categorías, no productos.".into()));
    }
    // Para ser productos, lo mínimo es detectar un nombre.
    let tiene_nombre = deteccion.get("nombre").is_some();
    let tiene_precio = deteccion.get("precio").is_some();
    if !tiene_nombre && !tiene_precio {
        return (false, Some("No se detectaron columnas de nombre ni precio de producto.".into()));
    }
    if !tiene_nombre {
        return (false, Some("No se detectó una columna con el nombre del producto.".into()));
    }

    (true, None)
}

/// Analiza el CSV: encabezados, muestra, detección. No inserta nada.
pub fn analizar(texto: &str) -> Result<AnalisisCsv, String> {
    let filas = parsear_csv(texto);
    if filas.is_empty() {
        return Err("El archivo está vacío.".into());
    }
    let encabezados = filas[0].clone();
    if encabezados.is_empty() {
        return Err("No se encontraron columnas en el archivo.".into());
    }
    let datos: Vec<Vec<String>> = filas[1..].to_vec();
    let muestra: Vec<Vec<String>> = datos.iter().take(5).cloned().collect();
    let deteccion = detectar(&encabezados);
    let (parece_productos, motivo_sospecha) = evaluar_productos(&encabezados, &deteccion);

    Ok(AnalisisCsv {
        encabezados,
        muestra,
        total_filas: datos.len(),
        deteccion,
        campos_pos: CAMPOS_POS.iter().map(|s| s.to_string()).collect(),
        parece_productos,
        motivo_sospecha,
    })
}

// ----------------------------------------------------------- Importación

/// Mapeo final: campo_pos → índice de columna. Lo manda el frontend tras la
/// confirmación del usuario. Los campos no mapeados se omiten.
#[derive(Debug, Deserialize)]
pub struct MapeoCsv {
    pub mapa: HashMap<String, usize>,
}

#[derive(Debug, Serialize, Default)]
pub struct ResumenCsv {
    pub productos_creados: i64,
    pub productos_omitidos: i64,
    pub categorias_creadas: i64,
    pub advertencias: Vec<String>,
}

/// Convierte un texto de precio ("16.00", "16", "16,50", "$16.00") a centavos.
fn a_centavos(texto: &str) -> i64 {
    let limpio: String = texto
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',' || *c == '-')
        .collect();
    // Si usa coma como decimal (y no como miles), convertir a punto.
    let normalizado = if limpio.contains(',') && !limpio.contains('.') {
        limpio.replace(',', ".")
    } else {
        limpio.replace(',', "")
    };
    let valor: f64 = normalizado.parse().unwrap_or(0.0);
    (valor * 100.0).round() as i64
}

fn a_numero(texto: &str) -> f64 {
    let limpio: String = texto
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',' || *c == '-')
        .collect();
    let normalizado = if limpio.contains(',') && !limpio.contains('.') {
        limpio.replace(',', ".")
    } else {
        limpio.replace(',', "")
    };
    normalizado.parse().unwrap_or(0.0)
}

/// Importa productos desde el CSV usando el mapeo confirmado.
pub fn importar_productos(
    con: &mut Connection,
    dispositivo_id: &str,
    texto: &str,
    mapeo: &MapeoCsv,
) -> Result<ResumenCsv, String> {
    // El nombre es obligatorio.
    let idx_nombre = *mapeo
        .mapa
        .get("nombre")
        .ok_or("Debes indicar qué columna tiene el nombre del producto.")?;

    let idx = |campo: &str| mapeo.mapa.get(campo).copied();

    let filas = parsear_csv(texto);
    if filas.len() < 2 {
        return Err("El archivo no tiene filas de datos.".into());
    }
    let datos = &filas[1..];

    let mut r = ResumenCsv::default();
    let ts = ahora();
    let tx = con.transaction().map_err(|e| format!("error al iniciar transacción: {e}"))?;

    // Caché de categorías por nombre (para no duplicar).
    let mut cat_por_nombre: HashMap<String, String> = HashMap::new();
    // Precargar las categorías existentes.
    {
        let mut stmt = tx
            .prepare("SELECT id, nombre FROM categorias WHERE eliminado=0 AND dispositivo_id=?1")
            .map_err(|e| format!("error al leer categorías: {e}"))?;
        let cats = stmt
            .query_map(rusqlite::params![dispositivo_id], |r| {
                Ok((r.get::<_, String>(1)?, r.get::<_, String>(0)?))
            })
            .map_err(|e| format!("error al mapear categorías: {e}"))?;
        for c in cats {
            let (nombre, id) = c.map_err(|e| format!("error fila categoría: {e}"))?;
            cat_por_nombre.insert(nombre.to_lowercase(), id);
        }
    }

    // Códigos ya vistos (dedup).
    let mut codigos_vistos: HashMap<String, ()> = HashMap::new();

    let get = |fila: &[String], i: Option<usize>| -> String {
        i.and_then(|idx| fila.get(idx)).cloned().unwrap_or_default()
    };

    for fila in datos {
        let nombre = fila.get(idx_nombre).cloned().unwrap_or_default().trim().to_string();
        if nombre.is_empty() {
            r.productos_omitidos += 1;
            continue;
        }
        let codigo = get(fila, idx("codigo")).trim().to_string();
        if !codigo.is_empty() {
            if codigos_vistos.contains_key(&codigo) {
                r.productos_omitidos += 1;
                r.advertencias.push(format!("Código duplicado: {nombre} ({codigo})"));
                continue;
            }
            codigos_vistos.insert(codigo.clone(), ());
        }

        // Categoría: buscar o crear.
        let cat_texto = get(fila, idx("categoria")).trim().to_string();
        let categoria_id = if cat_texto.is_empty() {
            None
        } else {
            let clave = cat_texto.to_lowercase();
            if let Some(id) = cat_por_nombre.get(&clave) {
                Some(id.clone())
            } else {
                let id = nuevo_id();
                tx.execute(
                    "INSERT INTO categorias (id, nombre, orden, creado_en, actualizado_en, eliminado, dispositivo_id)
                     VALUES (?1, ?2, 0, ?3, ?3, 0, ?4)",
                    rusqlite::params![id, cat_texto, ts, dispositivo_id],
                )
                .map_err(|e| format!("error al crear categoría {cat_texto}: {e}"))?;
                cat_por_nombre.insert(clave, id.clone());
                r.categorias_creadas += 1;
                Some(id)
            }
        };

        let precio = a_centavos(&get(fila, idx("precio")));
        let costo = a_centavos(&get(fila, idx("costo")));
        let stock = a_numero(&get(fila, idx("stock")));
        let unidad = {
            let u = get(fila, idx("unidad")).trim().to_lowercase();
            if u.is_empty() { "pieza".to_string() } else { u }
        };
        let controla_stock = idx("stock").is_some(); // si trae columna de stock, lo controla
        let codigo_val: Option<&str> = if codigo.is_empty() { None } else { Some(&codigo) };

        let prod_id = nuevo_id();
        tx.execute(
            "INSERT INTO productos
               (id, codigo_barras, nombre, categoria_id, precio_venta_centavos,
                costo_centavos, precio_mayoreo_centavos, cantidad_mayoreo, iva_tasa,
                controla_stock, stock, unidad, stock_minimo, favorito,
                creado_en, actualizado_en, eliminado, dispositivo_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, 0, ?7, ?8, ?9, 0, 0, ?10, ?10, 0, ?11)",
            rusqlite::params![
                prod_id, codigo_val, nombre, categoria_id, precio, costo,
                if controla_stock { 1 } else { 0 }, stock, unidad, ts, dispositivo_id,
            ],
        )
        .map_err(|e| format!("error al crear producto {nombre}: {e}"))?;

        // Stock inicial como ajuste (rastro), si trae stock.
        if controla_stock && stock != 0.0 {
            let ajuste_id = nuevo_id();
            // Buscar un usuario dueño para el ajuste.
            let usuario: String = tx
                .query_row(
                    "SELECT id FROM usuarios_pos WHERE rol='dueno' AND eliminado=0 LIMIT 1",
                    [],
                    |r| r.get(0),
                )
                .map_err(|_| "No hay usuario dueño para el ajuste.".to_string())?;
            tx.execute(
                "INSERT INTO ajustes_inventario
                   (id, producto_id, tipo, cantidad, stock_resultante, motivo, usuario_pos_id,
                    creado_en, actualizado_en, sincronizado, dispositivo_id)
                 VALUES (?1, ?2, 'entrada', ?3, ?3, 'Importación desde Excel/CSV', ?4, ?5, ?5, 0, ?6)",
                rusqlite::params![ajuste_id, prod_id, stock, usuario, ts, dispositivo_id],
            )
            .map_err(|e| format!("error al registrar stock de {nombre}: {e}"))?;
        }

        r.productos_creados += 1;
    }

    tx.commit().map_err(|e| format!("error al confirmar importación: {e}"))?;
    Ok(r)
}
