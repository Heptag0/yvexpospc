//! Exportación de datos a CSV (productos, inventario, ventas).
//!
//! El CSV se genera en memoria y el frontend lo guarda con el diálogo de
//! archivos. Usamos CSV porque Excel lo abre nativo y no añade dependencias.
//!
//! Formato: separador coma, UTF-8 con BOM (para que Excel respete acentos),
//! campos con coma/comilla/salto de línea entre comillas dobles.

use rusqlite::Connection;

/// Escapa un campo para CSV: si contiene el separador, comilla o salto de
/// línea, lo envuelve en comillas dobles y duplica las comillas internas.
/// Usamos punto y coma (;) como separador porque Excel en configuración
/// regional española lo espera así (con coma, Excel mete todo en una columna).
fn campo(s: &str) -> String {
    if s.contains(';') || s.contains('"') || s.contains('\n') || s.contains('\r') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// Convierte centavos a texto de pesos con dos decimales (sin símbolo).
fn pesos(centavos: i64) -> String {
    format!("{}.{:02}", centavos / 100, (centavos % 100).abs())
}

/// Une una fila de campos en una línea CSV (separador punto y coma).
fn fila(campos: &[String]) -> String {
    campos.iter().map(|c| campo(c)).collect::<Vec<_>>().join(";") + "\r\n"
}

/// El BOM UTF-8 para que Excel abra el CSV con acentos correctos.
const BOM: &str = "\u{FEFF}";

/// Exporta el catálogo de productos.
pub fn productos(con: &Connection, dispositivo_id: &str) -> Result<String, String> {
    let mut out = String::from(BOM);
    out.push_str(&fila(&[
        "Codigo".into(), "Nombre".into(), "Categoria".into(), "Precio".into(),
        "Costo".into(), "Precio_mayoreo".into(), "Cantidad_mayoreo".into(),
        "Controla_stock".into(), "Stock".into(), "Unidad".into(),
        "Stock_minimo".into(), "IVA".into(),
    ]));

    let mut stmt = con
        .prepare(
            "SELECT p.codigo_barras, p.nombre, COALESCE(c.nombre,''),
                    p.precio_venta_centavos, p.costo_centavos,
                    p.precio_mayoreo_centavos, p.cantidad_mayoreo,
                    p.controla_stock, p.stock, p.unidad, p.stock_minimo, p.iva_tasa
             FROM productos p
             LEFT JOIN categorias c ON p.categoria_id = c.id
             WHERE p.eliminado=0 AND p.dispositivo_id=?1
             ORDER BY p.nombre COLLATE NOCASE",
        )
        .map_err(|e| format!("error al preparar exportación: {e}"))?;

    let filas = stmt
        .query_map(rusqlite::params![dispositivo_id], |r| {
            let codigo: Option<String> = r.get(0)?;
            let nombre: String = r.get(1)?;
            let categoria: String = r.get(2)?;
            let precio: i64 = r.get(3)?;
            let costo: i64 = r.get(4)?;
            let may: Option<i64> = r.get(5)?;
            let cant_may: Option<i64> = r.get(6)?;
            let controla: i64 = r.get(7)?;
            let stock: f64 = r.get(8)?;
            let unidad: String = r.get(9)?;
            let stock_min: f64 = r.get(10)?;
            let iva: i64 = r.get(11)?;
            Ok(fila(&[
                codigo.unwrap_or_default(),
                nombre,
                categoria,
                pesos(precio),
                pesos(costo),
                may.map(pesos).unwrap_or_default(),
                cant_may.map(|v| v.to_string()).unwrap_or_default(),
                if controla == 1 { "Si".into() } else { "No".into() },
                fmt_num(stock),
                unidad,
                fmt_num(stock_min),
                iva.to_string(),
            ]))
        })
        .map_err(|e| format!("error al exportar productos: {e}"))?;

    for f in filas {
        out.push_str(&f.map_err(|e| format!("error en fila: {e}"))?);
    }
    Ok(out)
}

/// Exporta el inventario (existencias y su valor).
pub fn inventario(con: &Connection, dispositivo_id: &str) -> Result<String, String> {
    let mut out = String::from(BOM);
    out.push_str(&fila(&[
        "Codigo".into(), "Nombre".into(), "Categoria".into(), "Stock".into(),
        "Unidad".into(), "Costo_unitario".into(), "Valor_a_costo".into(),
        "Precio_venta".into(), "Valor_a_venta".into(), "Stock_minimo".into(),
    ]));

    let mut stmt = con
        .prepare(
            "SELECT p.codigo_barras, p.nombre, COALESCE(c.nombre,''),
                    p.stock, p.unidad, p.costo_centavos, p.precio_venta_centavos, p.stock_minimo
             FROM productos p
             LEFT JOIN categorias c ON p.categoria_id = c.id
             WHERE p.eliminado=0 AND p.controla_stock=1 AND p.dispositivo_id=?1
             ORDER BY c.nombre, p.nombre COLLATE NOCASE",
        )
        .map_err(|e| format!("error al preparar inventario: {e}"))?;

    let filas = stmt
        .query_map(rusqlite::params![dispositivo_id], |r| {
            let codigo: Option<String> = r.get(0)?;
            let nombre: String = r.get(1)?;
            let categoria: String = r.get(2)?;
            let stock: f64 = r.get(3)?;
            let unidad: String = r.get(4)?;
            let costo: i64 = r.get(5)?;
            let precio: i64 = r.get(6)?;
            let stock_min: f64 = r.get(7)?;
            let valor_costo = (stock * costo as f64).round() as i64;
            let valor_venta = (stock * precio as f64).round() as i64;
            Ok(fila(&[
                codigo.unwrap_or_default(),
                nombre,
                categoria,
                fmt_num(stock),
                unidad,
                pesos(costo),
                pesos(valor_costo),
                pesos(precio),
                pesos(valor_venta),
                fmt_num(stock_min),
            ]))
        })
        .map_err(|e| format!("error al exportar inventario: {e}"))?;

    for f in filas {
        out.push_str(&f.map_err(|e| format!("error en fila: {e}"))?);
    }
    Ok(out)
}

/// Exporta las ventas (una fila por venta, con totales).
pub fn ventas(con: &Connection, dispositivo_id: &str) -> Result<String, String> {
    let mut out = String::from(BOM);
    out.push_str(&fila(&[
        "Folio".into(), "Fecha".into(), "Subtotal".into(), "Descuento".into(),
        "IVA".into(), "Total".into(), "Estado".into(), "Cajero".into(),
    ]));

    let mut stmt = con
        .prepare(
            "SELECT v.folio, v.creado_en, v.subtotal_centavos, v.descuento_centavos,
                    v.iva_centavos, v.total_centavos, v.estado, COALESCE(u.nombre,'')
             FROM ventas v
             LEFT JOIN usuarios_pos u ON v.usuario_pos_id = u.id
             WHERE v.dispositivo_id=?1
             ORDER BY v.creado_en DESC",
        )
        .map_err(|e| format!("error al preparar ventas: {e}"))?;

    let filas = stmt
        .query_map(rusqlite::params![dispositivo_id], |r| {
            let folio: i64 = r.get(0)?;
            let fecha: String = r.get(1)?;
            let subtotal: i64 = r.get(2)?;
            let descuento: i64 = r.get(3)?;
            let iva: i64 = r.get(4)?;
            let total: i64 = r.get(5)?;
            let estado: String = r.get(6)?;
            let cajero: String = r.get(7)?;
            Ok(fila(&[
                folio.to_string(),
                fecha,
                pesos(subtotal),
                pesos(descuento),
                pesos(iva),
                pesos(total),
                estado,
                cajero,
            ]))
        })
        .map_err(|e| format!("error al exportar ventas: {e}"))?;

    for f in filas {
        out.push_str(&f.map_err(|e| format!("error en fila: {e}"))?);
    }
    Ok(out)
}

/// Formatea un número: entero si no tiene decimales, si no hasta 3 decimales.
fn fmt_num(n: f64) -> String {
    if n.fract() == 0.0 {
        format!("{}", n as i64)
    } else {
        let s = format!("{:.3}", n);
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}
