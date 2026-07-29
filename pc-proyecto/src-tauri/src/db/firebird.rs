//! Lectura directa del .FDB de Eleventa desde Rust (sin puente Python).
//!
//! Usa rsfbclient con `with_dyn_load`: la DLL de Firebird se carga en tiempo
//! de EJECUCIÓN, no de compilación. Así el binario compila sin las DLLs y solo
//! las necesita al momento de leer un .fdb real.
//!
//! Produce la misma estructura `ExportEleventa` que el importador ya sabe
//! insertar (mapeo validado con el puente Python sobre un FDB real).
//!
//! ⚠️ Solo lectura. Nunca modifica el .fdb (es el respaldo del cliente).
//!
//! Mapeo (schema Eleventa 214, confirmado con FDB real):
//!   DEPARTAMENTOS        → categorías
//!   PRODUCTOS            → productos (omite ELIMINADO_EN no nulo y kits)
//!   INVENTARIO_BALANCES  → stock por producto
//!   CLIENTESV2(+CREDITO) → clientes
//!   VENTATICKETS(+ARTS)  → ventas históricas
//!
//! NOTA MONTOS: Eleventa guarda NUMERIC(escala -4). rsfbclient los entrega como
//! decimales reales (un PVENTA "120" = $120.00). El importador los pasa a
//! centavos (×100). Aquí los dejamos como f64 decimales, igual que el puente.

use std::collections::HashMap;
use std::path::Path;

use rsfbclient::charset::WIN_1252;
use rsfbclient::prelude::*;

use super::importador::{CatJson, CliJson, ExportEleventa, LineaJson, ProdJson, VentaJson};

/// Resultado del conteo previo (vista previa antes de importar).
#[derive(Debug, serde::Serialize)]
pub struct ConteoEleventa {
    pub categorias: i64,
    pub productos: i64,
    pub clientes: i64,
    pub ventas: i64,
}

/// Localiza la DLL de Firebird (fbclient.dll) junto al ejecutable o en una
/// subcarpeta `firebird/`. Devuelve la ruta como String.
fn ruta_fbclient() -> Result<String, String> {
    // Buscar junto al ejecutable y en ./firebird/.
    let exe = std::env::current_exe().map_err(|e| format!("no se ubicó el ejecutable: {e}"))?;
    let dir = exe.parent().ok_or("ruta de ejecutable inválida")?;
    let candidatos = [
        dir.join("fbclient.dll"),
        dir.join("firebird").join("fbclient.dll"),
        dir.join("firebird").join("bin").join("fbclient.dll"),
    ];
    for c in &candidatos {
        if c.exists() {
            return Ok(c.to_string_lossy().to_string());
        }
    }
    Err("No se encontró fbclient.dll. Debe estar junto al programa o en la carpeta 'firebird'.".into())
}

/// Abre una conexión embedded de solo lectura al .fdb.
/// Devolvemos `impl Queryable` para no depender del nombre exacto del tipo
/// interno de rsfbclient (que cambia entre versiones).
fn conectar(ruta_fdb: &str) -> Result<impl Queryable, String> {
    if !Path::new(ruta_fdb).exists() {
        return Err(format!("No existe el archivo: {ruta_fdb}"));
    }
    let dll = ruta_fbclient()?;
    // Firebird embedded autentica vía las variables de entorno ISC_USER e
    // ISC_PASSWORD. Las fijamos antes de conectar; así el builder no necesita
    // métodos .user()/.pass() (que en embedded no siempre están disponibles).
    std::env::set_var("ISC_USER", "SYSDBA");
    std::env::set_var("ISC_PASSWORD", "masterkey");

    rsfbclient::builder_native()
        .with_dyn_load(&dll)
        .with_embedded()
        .db_name(ruta_fdb)
        .charset(WIN_1252)
        .connect()
        .map_err(|e| format!("No se pudo abrir la base de Eleventa: {e}. ¿Está Eleventa cerrado?"))
}

fn s(v: Option<String>) -> String {
    v.unwrap_or_default().trim().to_string()
}

fn n(v: Option<f64>) -> f64 {
    v.unwrap_or(0.0)
}

/// Cuenta cuántos hay de cada cosa, sin traer todo (para la vista previa).
pub fn contar(ruta_fdb: &str) -> Result<ConteoEleventa, String> {
    let mut conn = conectar(ruta_fdb)?;

    let categorias = contar_una(&mut conn, "SELECT COUNT(*) FROM DEPARTAMENTOS")?;
    let productos = contar_una(&mut conn, "SELECT COUNT(*) FROM PRODUCTOS WHERE ELIMINADO_EN IS NULL")?;
    let clientes = contar_una(&mut conn, "SELECT COUNT(*) FROM CLIENTESV2 WHERE ACTIVO = 1 AND (DE_SISTEMA IS NULL OR DE_SISTEMA = 0)")?;
    let ventas = contar_una(&mut conn, "SELECT COUNT(*) FROM VENTATICKETS WHERE ESTA_ABIERTO = 'f' AND ESTA_CANCELADO = 'f'")?;

    Ok(ConteoEleventa { categorias, productos, clientes, ventas })
}

/// Ejecuta un COUNT(*) y devuelve el número.
fn contar_una(conn: &mut impl Queryable, sql: &str) -> Result<i64, String> {
    let r: Option<(i64,)> = conn
        .query_first(sql, ())
        .map_err(|e| format!("error al contar: {e}"))?;
    Ok(r.map(|t| t.0).unwrap_or(0))
}

/// Lee TODO el .fdb y produce un ExportEleventa listo para importar.
/// `incluir_ventas` permite saltar el histórico (que puede ser enorme).
pub fn leer(ruta_fdb: &str, incluir_ventas: bool) -> Result<ExportEleventa, String> {
    let mut conn = conectar(ruta_fdb)?;

    // ---------------- Categorías (DEPARTAMENTOS) ----------------
    let mut categorias = Vec::new();
    {
        let filas = conn
            .query_iter("SELECT ID, NOMBRE FROM DEPARTAMENTOS ORDER BY ID", ())
            .map_err(|e| format!("error al leer departamentos: {e}"))?;
        for f in filas {
            let (id, nombre): (i32, Option<String>) =
                f.map_err(|e| format!("error fila departamento: {e}"))?;
            categorias.push(CatJson {
                id_eleventa: id as i64,
                nombre: {
                    let nm = s(nombre);
                    if nm.is_empty() { "General".to_string() } else { nm }
                },
            });
        }
    }

    // ---------------- Stock (INVENTARIO_BALANCES) ----------------
    let mut stock: HashMap<i64, f64> = HashMap::new();
    {
        let filas = conn
            .query_iter("SELECT PRODUCTO_ID, CANTIDAD_ACTUAL FROM INVENTARIO_BALANCES", ())
            .map_err(|e| format!("error al leer balances: {e}"))?;
        for f in filas {
            let (pid, cant): (i32, Option<f64>) =
                f.map_err(|e| format!("error fila balance: {e}"))?;
            *stock.entry(pid as i64).or_insert(0.0) += n(cant);
        }
    }

    // ---------------- Productos (PRODUCTOS) ----------------
    let mut productos = Vec::new();
    {
        let filas = conn
            .query_iter(
                "SELECT ID, CODIGO, DESCRIPCION, PCOSTO, PVENTA, MAYOREO, DEPT,
                        USA_INVENTARIO, ELIMINADO_EN, DINVMINIMO, ES_KIT
                 FROM PRODUCTOS WHERE ELIMINADO_EN IS NULL ORDER BY ID",
                (),
            )
            .map_err(|e| format!("error al leer productos: {e}"))?;
        for f in filas {
            // ELIMINADO_EN ya filtrado en SQL; lo leemos como Option para el tipo.
            let (id, codigo, desc, pcosto, pventa, mayoreo, dept, usa_inv, _elim, inv_min, es_kit):
                (i32, Option<String>, Option<String>, Option<f64>, Option<f64>, Option<f64>,
                 Option<i32>, Option<String>, Option<String>, Option<f64>, Option<String>) =
                f.map_err(|e| format!("error fila producto: {e}"))?;

            // Saltar kits (productos compuestos): el POS no los maneja aún.
            if s(es_kit).to_lowercase() == "t" {
                continue;
            }

            productos.push(ProdJson {
                codigo: s(codigo),
                nombre: s(desc),
                costo: n(pcosto),
                precio: n(pventa),
                mayoreo: n(mayoreo),
                categoria_id_eleventa: dept.map(|d| d as i64),
                controla_stock: s(usa_inv).to_lowercase() == "t",
                stock: *stock.get(&(id as i64)).unwrap_or(&0.0),
                stock_minimo: n(inv_min),
            });
        }
    }

    // ---------------- Clientes (CLIENTESV2 + CREDITO) ----------------
    let mut credito: HashMap<i64, (f64, f64)> = HashMap::new();
    {
        // Algunos esquemas no tienen ELIMINADO_EN aquí; envolvemos por si falla.
        let q = conn.query_iter(
            "SELECT CLIENTESV2_ID, LIMITE_CREDITO, SALDO_ACTUAL FROM CLIENTESV2_CREDITO",
            (),
        );
        if let Ok(filas) = q {
            for f in filas {
                if let Ok((cid, limite, saldo)) = f as Result<(i32, Option<f64>, Option<f64>), _> {
                    credito.insert(cid as i64, (n(limite), n(saldo)));
                }
            }
        }
    }

    let mut clientes = Vec::new();
    {
        let filas = conn
            .query_iter(
                "SELECT ID, NOMBRES, APELLIDOS, TELEFONO, EMAIL, DOMICILIO1, DE_SISTEMA
                 FROM CLIENTESV2 WHERE ACTIVO = 1 ORDER BY ID",
                (),
            )
            .map_err(|e| format!("error al leer clientes: {e}"))?;
        for f in filas {
            let (id, nombres, apellidos, tel, email, dom, de_sistema):
                (i32, Option<String>, Option<String>, Option<String>, Option<String>,
                 Option<String>, Option<i16>) =
                f.map_err(|e| format!("error fila cliente: {e}"))?;
            // Saltar clientes de sistema (Público en General, etc.).
            if de_sistema.unwrap_or(0) != 0 {
                continue;
            }
            let nombre = format!("{} {}", s(nombres), s(apellidos)).trim().to_string();
            if nombre.is_empty() {
                continue;
            }
            let (limite, saldo) = credito.get(&(id as i64)).copied().unwrap_or((0.0, 0.0));
            clientes.push(CliJson {
                nombre,
                telefono: s(tel),
                email: s(email),
                direccion: s(dom),
                saldo,
                limite_credito: limite,
            });
        }
    }

    // ---------------- Ventas históricas (opcional) ----------------
    let mut ventas = Vec::new();
    if incluir_ventas {
        // Cabeceras.
        let mut mapa_ventas: HashMap<i64, usize> = HashMap::new();
        {
            let filas = conn
                .query_iter(
                    "SELECT ID, FOLIO, VENDIDO_EN, CREADO_EN, SUBTOTAL, TOTAL, FORMA_PAGO
                     FROM VENTATICKETS
                     WHERE ESTA_ABIERTO = 'f' AND ESTA_CANCELADO = 'f' ORDER BY ID",
                    (),
                )
                .map_err(|e| format!("error al leer ventas: {e}"))?;
            for f in filas {
                let (id, folio, vendido, creado, subtotal, total, forma):
                    (i32, Option<i32>, Option<chrono::NaiveDateTime>, Option<chrono::NaiveDateTime>,
                     Option<f64>, Option<f64>, Option<String>) =
                    f.map_err(|e| format!("error fila venta: {e}"))?;
                let fecha = vendido.or(creado).map(|d| d.format("%Y-%m-%dT%H:%M:%S").to_string());
                mapa_ventas.insert(id as i64, ventas.len());
                ventas.push(VentaJson {
                    folio: folio.unwrap_or(0) as i64,
                    fecha,
                    subtotal: n(subtotal),
                    total: n(total),
                    forma_pago: s(forma),
                    lineas: Vec::new(),
                });
            }
        }

        // Líneas (las colgamos de su venta por TICKET_ID).
        {
            let filas = conn
                .query_iter(
                    "SELECT TICKET_ID, PRODUCTO_CODIGO, PRODUCTO_NOMBRE, CANTIDAD,
                            PRECIO_USADO, TOTAL_ARTICULO
                     FROM VENTATICKETS_ARTICULOS",
                    (),
                )
                .map_err(|e| format!("error al leer líneas de venta: {e}"))?;
            for f in filas {
                let (tid, codigo, nombre, cant, precio, total):
                    (i32, Option<String>, Option<String>, Option<f64>, Option<f64>, Option<f64>) =
                    f.map_err(|e| format!("error fila línea venta: {e}"))?;
                if let Some(&idx) = mapa_ventas.get(&(tid as i64)) {
                    ventas[idx].lineas.push(LineaJson {
                        codigo: s(codigo),
                        nombre: s(nombre),
                        cantidad: n(cant),
                        precio: n(precio),
                        total: n(total),
                    });
                }
            }
        }
    }

    Ok(ExportEleventa { categorias, productos, clientes, ventas })
}