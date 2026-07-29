//! Generación del contenido del ticket.
//!
//! El ticket es texto monoespaciado formateado a un ancho de columnas (32 para
//! papel de 58mm, 48 para 80mm). El MISMO contenido sirve para tres cosas:
//!   - vista previa en pantalla (aspecto de papel térmico),
//!   - comandos ESC/POS al imprimir (cuando hay hardware),
//!   - reimpresión (última venta o por folio).
//!
//! Invariantes del plano (references/hardware.md):
//!   - ⚠️ La venta ya está guardada antes de imprimir; imprimir nunca la condiciona.
//!   - ⚠️ Reimpresión siempre disponible (última y por folio).
//!   - El ancho (58/80mm) cambia caracteres por línea; viene de config.

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

/// Una línea del ticket lista para mostrar/imprimir. `estilo` permite que la
/// vista previa y el ESC/POS resalten ciertas líneas (negrita, doble alto…).
#[derive(Debug, Serialize)]
pub struct LineaTicket {
    pub texto: String,
    pub estilo: String, // "normal" | "titulo" | "negrita" | "centro" | "separador"
}

#[derive(Debug, Serialize)]
pub struct Ticket {
    pub folio: i64,
    pub ancho: usize,
    pub lineas: Vec<LineaTicket>,
}

fn get_config(con: &Connection, clave: &str) -> String {
    con.query_row(
        "SELECT valor FROM config WHERE clave = ?1",
        rusqlite::params![clave],
        |r| r.get::<_, Option<String>>(0),
    )
    .optional()
    .ok()
    .flatten()
    .flatten()
    .unwrap_or_default()
}

fn pesos(centavos: i64) -> String {
    let neg = centavos < 0;
    let v = centavos.abs();
    let entero = v / 100;
    let frac = v % 100;
    // Separador de miles simple.
    let s = entero.to_string();
    let mut con_miles = String::new();
    let bytes = s.as_bytes();
    for (i, b) in bytes.iter().enumerate() {
        if i > 0 && (bytes.len() - i) % 3 == 0 {
            con_miles.push(',');
        }
        con_miles.push(*b as char);
    }
    format!("{}${}.{:02}", if neg { "-" } else { "" }, con_miles, frac)
}

/// Centra un texto en `ancho` columnas.
fn centrar(texto: &str, ancho: usize) -> String {
    let len = texto.chars().count();
    if len >= ancho {
        return texto.chars().take(ancho).collect();
    }
    let izq = (ancho - len) / 2;
    format!("{}{}", " ".repeat(izq), texto)
}

/// Pone `izq` a la izquierda y `der` a la derecha rellenando con espacios.
fn justificar(izq: &str, der: &str, ancho: usize) -> String {
    let li = izq.chars().count();
    let ld = der.chars().count();
    if li + ld >= ancho {
        // No cabe en una línea: truncar la izquierda.
        let max_izq = ancho.saturating_sub(ld + 1);
        let izq_corto: String = izq.chars().take(max_izq).collect();
        let li2 = izq_corto.chars().count();
        let espacios = ancho.saturating_sub(li2 + ld);
        return format!("{}{}{}", izq_corto, " ".repeat(espacios), der);
    }
    format!("{}{}{}", izq, " ".repeat(ancho - li - ld), der)
}

/// Genera el ticket de una venta, localizada por `venta_id` (preferido, es
/// único global) o por `folio` (respaldo: el folio solo es único POR caja,
/// así que sin id se toma la más reciente con ese folio, de cualquier caja).
pub fn generar(
    con: &Connection,
    folio: Option<i64>,
    venta_id: Option<&str>,
) -> Result<Ticket, String> {
    let ancho: usize = get_config(con, "impresora_columnas").parse().unwrap_or(48);

    // Cabecera de la venta.
    let cab: Option<(String, String, i64, i64, i64, String, Option<String>, i64, i64)> =
        if let Some(vid) = venta_id {
            con.query_row(
                "SELECT id, creado_en, total_centavos, subtotal_centavos, descuento_centavos,
                        caja_sesion_id, cliente_id, iva_centavos, folio
                 FROM ventas WHERE id = ?1",
                rusqlite::params![vid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?)),
            )
            .optional()
        } else if let Some(f) = folio {
            // Sin id: la más reciente con ese folio, de CUALQUIER caja (los
            // tickets del negocio completo son visibles desde la sync).
            con.query_row(
                "SELECT id, creado_en, total_centavos, subtotal_centavos, descuento_centavos,
                        caja_sesion_id, cliente_id, iva_centavos, folio
                 FROM ventas WHERE folio = ?1
                 ORDER BY creado_en DESC LIMIT 1",
                rusqlite::params![f],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?)),
            )
            .optional()
        } else {
            Ok(None)
        }
        .map_err(|e| format!("error al leer venta: {e}"))?;

    let (venta_id, creado_en, total, subtotal, descuento, caja_sesion_id, cliente_id, iva, folio_real) =
        cab.ok_or_else(|| match folio {
            Some(f) => format!("No se encontró la venta #{f}."),
            None => "No se encontró la venta.".to_string(),
        })?;

    // Nombre del cajero de la sesión.
    let cajero: String = con
        .query_row(
            "SELECT u.nombre FROM caja_sesiones s JOIN usuarios_pos u ON s.usuario_pos_id = u.id
             WHERE s.id = ?1",
            rusqlite::params![caja_sesion_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("error al leer cajero: {e}"))?
        .unwrap_or_else(|| "—".to_string());

    let mut lineas: Vec<LineaTicket> = Vec::new();
    let push = |v: &mut Vec<LineaTicket>, texto: String, estilo: &str| {
        v.push(LineaTicket { texto, estilo: estilo.to_string() });
    };
    let sep = |v: &mut Vec<LineaTicket>| {
        v.push(LineaTicket { texto: "-".repeat(ancho), estilo: "separador".to_string() });
    };

    // --- Encabezado ---
    let encabezado = get_config(con, "ticket_encabezado");
    if !encabezado.is_empty() {
        push(&mut lineas, centrar(&encabezado, ancho), "centro");
    }
    let nombre = {
        let n = get_config(con, "negocio_nombre");
        if n.is_empty() { "Mi Negocio".to_string() } else { n }
    };
    push(&mut lineas, centrar(&nombre, ancho), "titulo");

    let direccion = get_config(con, "negocio_direccion");
    if !direccion.is_empty() {
        push(&mut lineas, centrar(&direccion, ancho), "centro");
    }
    if get_config(con, "ticket_mostrar_telefono") != "0" {
        let tel = get_config(con, "negocio_telefono");
        if !tel.is_empty() {
            push(&mut lineas, centrar(&format!("Tel: {tel}"), ancho), "centro");
        }
    }
    if get_config(con, "ticket_mostrar_rfc") == "1" {
        let rfc = get_config(con, "negocio_rfc");
        if !rfc.is_empty() {
            push(&mut lineas, centrar(&format!("RFC: {rfc}"), ancho), "centro");
        }
    }

    sep(&mut lineas);

    // --- Datos de la venta ---
    push(&mut lineas, justificar(&format!("Ticket #{folio_real}"), &fecha_corta(&creado_en), ancho), "normal");
    push(&mut lineas, format!("Atendió: {cajero}"), "normal");
    if let Some(cid) = &cliente_id {
        let cnombre: String = con
            .query_row("SELECT nombre FROM clientes WHERE id=?1", rusqlite::params![cid], |r| r.get(0))
            .optional()
            .ok()
            .flatten()
            .unwrap_or_default();
        if !cnombre.is_empty() {
            push(&mut lineas, format!("Cliente: {cnombre}"), "normal");
        }
    }

    sep(&mut lineas);

    // --- Líneas de producto ---
    let mut stmt = con
        .prepare(
            "SELECT descripcion, cantidad, precio_unitario_centavos, total_linea_centavos
             FROM venta_lineas WHERE venta_id = ?1",
        )
        .map_err(|e| format!("error al preparar líneas: {e}"))?;
    let filas = stmt
        .query_map(rusqlite::params![venta_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, f64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })
        .map_err(|e| format!("error al leer líneas: {e}"))?;

    for f in filas {
        let (desc, cant, precio, total_l) = f.map_err(|e| format!("error línea: {e}"))?;
        // Línea 1: descripción.
        push(&mut lineas, desc.clone(), "normal");
        // Línea 2: "  cant x precio          importe"
        let cant_str = if cant.fract().abs() < 1e-9 {
            format!("{}", cant as i64)
        } else {
            format!("{:.3}", cant)
        };
        let izq = format!("  {} x {}", cant_str, pesos(precio));
        push(&mut lineas, justificar(&izq, &pesos(total_l), ancho), "normal");
    }

    sep(&mut lineas);

    // --- Totales ---
    // Si hay impuesto, mostramos el desglose. El texto depende del modo:
    //   incluido: base + impuesto = total (el total no cambió).
    //   agregado: subtotal + impuesto = total (el impuesto se sumó).
    let cfg_imp = super::config::leer_impuesto(con);
    let nombre_imp = if cfg_imp.nombre.is_empty() { "Impuesto".to_string() } else { cfg_imp.nombre.clone() };

    if descuento > 0 {
        push(&mut lineas, justificar("Subtotal", &pesos(subtotal), ancho), "normal");
        push(&mut lineas, justificar("Descuento", &format!("-{}", pesos(descuento)), ancho), "normal");
    }

    if iva > 0 {
        if cfg_imp.modo == "agregado" {
            // El impuesto se sumó: mostrar subtotal (sin impuesto) + impuesto.
            let base = total - iva;
            push(&mut lineas, justificar("Subtotal", &pesos(base), ancho), "normal");
            push(&mut lineas, justificar(&nombre_imp, &pesos(iva), ancho), "normal");
        } else {
            // Incluido: el total ya lo trae; desglosamos informativamente.
            let base = total - iva;
            push(&mut lineas, justificar("Base", &pesos(base), ancho), "normal");
            push(&mut lineas, justificar(&format!("{} incl.", nombre_imp), &pesos(iva), ancho), "normal");
        }
    }

    push(&mut lineas, justificar("TOTAL", &pesos(total), ancho), "negrita");

    // --- Pagos ---
    let mut stmt2 = con
        .prepare("SELECT metodo, monto_centavos, recibido_centavos, cambio_centavos FROM pagos WHERE venta_id = ?1")
        .map_err(|e| format!("error al preparar pagos: {e}"))?;
    let pagos = stmt2
        .query_map(rusqlite::params![venta_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, Option<i64>>(2)?,
                r.get::<_, Option<i64>>(3)?,
            ))
        })
        .map_err(|e| format!("error al leer pagos: {e}"))?;

    push(&mut lineas, String::new(), "normal");
    for p in pagos {
        let (metodo, monto, recibido, cambio) = p.map_err(|e| format!("error pago: {e}"))?;
        let etq = match metodo.as_str() {
            "efectivo" => "Efectivo",
            "tarjeta" => "Tarjeta",
            "transferencia" => "Transferencia",
            "credito" => "Crédito",
            "vale" => "Vale",
            otro => otro,
        };
        push(&mut lineas, justificar(etq, &pesos(monto), ancho), "normal");
        if let Some(rec) = recibido {
            if metodo == "efectivo" && rec > monto {
                push(&mut lineas, justificar("  Recibido", &pesos(rec), ancho), "normal");
                if let Some(c) = cambio {
                    if c > 0 {
                        push(&mut lineas, justificar("  Cambio", &pesos(c), ancho), "normal");
                    }
                }
            }
        }
    }

    // --- Pie ---
    sep(&mut lineas);
    let pie = {
        let p = get_config(con, "mensaje_ticket");
        if p.is_empty() { "¡Gracias por su compra!".to_string() } else { p }
    };
    push(&mut lineas, centrar(&pie, ancho), "centro");
    push(&mut lineas, String::new(), "normal");

    Ok(Ticket { folio: folio_real, ancho, lineas })
}

/// Genera el ticket de la última venta del dispositivo (para reimpresión rápida).
pub fn generar_ultima(con: &Connection, dispositivo_id: &str) -> Result<Ticket, String> {
    let folio: Option<i64> = con
        .query_row(
            "SELECT folio FROM ventas WHERE dispositivo_id=?1 ORDER BY folio DESC LIMIT 1",
            rusqlite::params![dispositivo_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("error al buscar última venta: {e}"))?;
    match folio {
        Some(f) => generar(con, Some(f), None),
        None => Err("No hay ventas para reimprimir.".into()),
    }
}

fn fecha_corta(iso: &str) -> String {
    // De "2026-06-27T14:30:00..." a "27/06/26 14:30". Parseo simple por posición.
    if iso.len() >= 16 {
        let fecha = &iso[0..10]; // YYYY-MM-DD
        let hora = &iso[11..16]; // HH:MM
        let partes: Vec<&str> = fecha.split('-').collect();
        if partes.len() == 3 {
            let aa = &partes[0][2..]; // YY
            return format!("{}/{}/{} {}", partes[2], partes[1], aa, hora);
        }
    }
    iso.to_string()
}

// ============================================================================
// Generación de bytes ESC/POS
//
// El estándar ESC/POS usa secuencias de control para formato. Estos son los
// comandos universales (Epson y compatibles: Xprinter, 3nStar, etc.):
//   ESC @       (1B 40)        inicializar impresora
//   ESC a n     (1B 61 n)      alineación: 0=izq, 1=centro, 2=der
//   ESC E n     (1B 45 n)      negrita: 1=on, 0=off
//   GS ! n      (1D 21 n)      tamaño: 0=normal, 0x11=doble alto+ancho
//   GS V m      (1D 56 m)      cortar papel: 0=corte total
//   ESC p m t1 t2 (1B 70 ...)  pulso para abrir cajón de dinero
//
// El texto va en CP437/Latin codificado; para acentos usamos transliteración
// simple a ASCII (á->a) para máxima compatibilidad con impresoras baratas.
// ============================================================================

/// Transcribe acentos y caracteres especiales a ASCII para impresoras que no
/// tienen una página de códigos fiable. á->a, ñ->n, etc.
fn a_ascii(texto: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(texto.len());
    for c in texto.chars() {
        let reemplazo: &[u8] = match c {
            'á' | 'à' | 'ä' | 'â' => b"a",
            'é' | 'è' | 'ë' | 'ê' => b"e",
            'í' | 'ì' | 'ï' | 'î' => b"i",
            'ó' | 'ò' | 'ö' | 'ô' => b"o",
            'ú' | 'ù' | 'ü' | 'û' => b"u",
            'Á' | 'À' | 'Ä' | 'Â' => b"A",
            'É' | 'È' | 'Ë' | 'Ê' => b"E",
            'Í' | 'Ì' | 'Ï' | 'Î' => b"I",
            'Ó' | 'Ò' | 'Ö' | 'Ô' => b"O",
            'Ú' | 'Ù' | 'Ü' | 'Û' => b"U",
            'ñ' => b"n",
            'Ñ' => b"N",
            '¿' => b"?",
            '¡' => b"!",
            '€' => b"EUR",
            '°' => b"o",
            _ => {
                if c.is_ascii() {
                    out.push(c as u8);
                } else {
                    out.push(b'?');
                }
                continue;
            }
        };
        out.extend_from_slice(reemplazo);
    }
    out
}

/// Convierte un Ticket en los bytes ESC/POS listos para enviar a la impresora.
/// `abrir_cajon` añade el pulso de apertura del cajón al final (para ventas en
/// efectivo si así se configuró).
pub fn a_escpos(ticket: &Ticket, abrir_cajon: bool) -> Vec<u8> {
    let mut b: Vec<u8> = Vec::new();

    // Inicializar.
    b.extend_from_slice(&[0x1B, 0x40]); // ESC @

    for linea in &ticket.lineas {
        match linea.estilo.as_str() {
            "titulo" => {
                b.extend_from_slice(&[0x1B, 0x61, 0x01]); // centrar
                b.extend_from_slice(&[0x1D, 0x21, 0x11]); // doble alto+ancho
                b.extend_from_slice(&[0x1B, 0x45, 0x01]); // negrita on
                b.extend_from_slice(&a_ascii(&linea.texto));
                b.extend_from_slice(&[0x1B, 0x45, 0x00]); // negrita off
                b.extend_from_slice(&[0x1D, 0x21, 0x00]); // tamaño normal
                b.extend_from_slice(&[0x1B, 0x61, 0x00]); // izquierda
            }
            "centro" => {
                b.extend_from_slice(&[0x1B, 0x61, 0x01]);
                b.extend_from_slice(&a_ascii(&linea.texto));
                b.extend_from_slice(&[0x1B, 0x61, 0x00]);
            }
            "negrita" => {
                b.extend_from_slice(&[0x1B, 0x45, 0x01]);
                b.extend_from_slice(&a_ascii(&linea.texto));
                b.extend_from_slice(&[0x1B, 0x45, 0x00]);
            }
            _ => {
                // normal y separador: texto tal cual (ya viene formateado).
                b.extend_from_slice(&a_ascii(&linea.texto));
            }
        }
        b.push(b'\n'); // salto de línea
    }

    // Avanzar papel antes de cortar (para que el corte no quede pegado al texto).
    b.extend_from_slice(&[b'\n', b'\n', b'\n']);

    // Cortar papel (corte total).
    b.extend_from_slice(&[0x1D, 0x56, 0x00]); // GS V 0

    // Pulso de apertura del cajón si corresponde.
    if abrir_cajon {
        // ESC p m t1 t2 : m=0 (pin 2), t1=25, t2=250 (tiempos de pulso).
        b.extend_from_slice(&[0x1B, 0x70, 0x00, 0x19, 0xFA]);
    }

    b
}
