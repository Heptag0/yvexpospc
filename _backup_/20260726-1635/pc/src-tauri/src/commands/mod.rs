//! Comandos Tauri expuestos al frontend.
//!
//! Capa delgada: validan el estado, toman la conexión del estado compartido y
//! delegan en los módulos de `db`. No meten lógica de negocio aquí.

use crate::db::onboarding::{ejecutar_onboarding, ya_configurado, PayloadOnboarding, ResultadoOnboarding};
use crate::db::usuarios::{listar_usuarios as db_listar_usuarios, login as db_login, UsuarioPublico};
use crate::db::EstadoDb;
use crate::db::inicio::{self as db_inicio, RangosInicio, ResumenInicio};

/// ¿El POS ya fue configurado? El frontend lo llama al arrancar para decidir
/// entre mostrar el asistente de bienvenida o ir al login.
#[tauri::command]
pub fn pos_configurado(estado: tauri::State<EstadoDb>) -> Result<bool, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    ya_configurado(&con)
}

/// Ejecuta el primer arranque (dispositivo + dueño + cajeros + config).
#[tauri::command]
pub fn configurar_pos(
    estado: tauri::State<EstadoDb>,
    payload: PayloadOnboarding,
) -> Result<ResultadoOnboarding, String> {
    let mut con = estado.con.lock().map_err(|e| e.to_string())?;
    ejecutar_onboarding(&mut con, payload)
}

/// Lista los usuarios para la pantalla de login (solo datos públicos).
#[tauri::command]
pub fn listar_usuarios(estado: tauri::State<EstadoDb>) -> Result<Vec<UsuarioPublico>, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    db_listar_usuarios(&con)
}

/// Login por usuario + PIN. Devuelve el usuario público si coincide.
#[tauri::command]
pub fn login(
    estado: tauri::State<EstadoDb>,
    usuario_id: String,
    pin: String,
) -> Result<UsuarioPublico, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    db_login(&con, &usuario_id, &pin)
}

/// Diagnóstico del cimiento (lo dejamos para verificar la BD).
#[tauri::command]
pub fn db_estado(estado: tauri::State<EstadoDb>) -> Result<String, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    let version: i64 = con
        .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
            row.get::<_, Option<i64>>(0).map(|v| v.unwrap_or(0))
        })
        .map_err(|e| e.to_string())?;
    let n_tablas: i64 = con
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(format!("BD OK — esquema v{version}, {n_tablas} tablas"))
}

// ============================================================================
// Inventario: categorías, productos, ajustes de stock
// ============================================================================

use crate::db::categorias::{
    self, Categoria, EditarCategoria, NuevaCategoria,
};
use crate::db::productos::{
    self, AjusteStock, EditarProducto, NuevoProducto, Producto,
};

/// Lee el dispositivo_id guardado en config durante el onboarding.
fn dispositivo_id(con: &rusqlite::Connection) -> Result<String, String> {
    con.query_row(
        "SELECT valor FROM config WHERE clave = 'dispositivo_id'",
        [],
        |r| r.get::<_, String>(0),
    )
    .map_err(|_| "No se encontró el dispositivo. ¿El POS está configurado?".to_string())
}

// ---- Categorías ----
#[tauri::command]
pub fn cat_listar(estado: tauri::State<EstadoDb>) -> Result<Vec<Categoria>, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    categorias::listar(&con)
}

#[tauri::command]
pub fn cat_crear(estado: tauri::State<EstadoDb>, datos: NuevaCategoria) -> Result<Categoria, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    categorias::crear(&con, &disp, &datos)
}

#[tauri::command]
pub fn cat_editar(estado: tauri::State<EstadoDb>, datos: EditarCategoria) -> Result<Categoria, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    categorias::editar(&con, &datos)
}

#[tauri::command]
pub fn cat_eliminar(estado: tauri::State<EstadoDb>, id: String) -> Result<(), String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    categorias::eliminar(&con, &id)
}

#[tauri::command]
pub fn cat_reordenar(estado: tauri::State<EstadoDb>, ids: Vec<String>) -> Result<(), String> {
    let mut con = estado.con.lock().map_err(|e| e.to_string())?;
    categorias::reordenar(&mut con, &ids)
}

// ---- Productos ----
#[tauri::command]
pub fn prod_listar(
    estado: tauri::State<EstadoDb>,
    rol: String,
    filtro: Option<String>,
    solo_stock_bajo: Option<bool>,
    solo_negativos: Option<bool>,
) -> Result<Vec<Producto>, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    productos::listar(
        &con,
        &rol,
        filtro.as_deref(),
        solo_stock_bajo.unwrap_or(false),
        solo_negativos.unwrap_or(false),
    )
}

#[tauri::command]
pub fn prod_contar_negativos(estado: tauri::State<EstadoDb>) -> Result<i64, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    productos::contar_negativos(&con)
}

#[tauri::command]
pub fn prod_por_codigo(
    estado: tauri::State<EstadoDb>,
    rol: String,
    codigo: String,
) -> Result<Option<Producto>, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    productos::por_codigo(&con, &rol, &codigo)
}

#[tauri::command]
pub fn prod_crear(estado: tauri::State<EstadoDb>, datos: NuevoProducto) -> Result<String, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    productos::crear(&con, &disp, &datos)
}

#[tauri::command]
pub fn prod_editar(estado: tauri::State<EstadoDb>, datos: EditarProducto) -> Result<(), String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    productos::editar(&con, &datos)
}

#[tauri::command]
pub fn prod_eliminar(estado: tauri::State<EstadoDb>, id: String) -> Result<(), String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    productos::eliminar(&con, &id)
}

/// Elimina varios productos a la vez (selección múltiple). Devuelve cuántos.
#[tauri::command]
pub fn prod_eliminar_varios(
    estado: tauri::State<EstadoDb>,
    ids: Vec<String>,
) -> Result<i64, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    let mut n = 0;
    for id in &ids {
        productos::eliminar(&con, id)?;
        n += 1;
    }
    Ok(n)
}

#[tauri::command]
pub fn prod_ajustar_stock(
    estado: tauri::State<EstadoDb>,
    datos: AjusteStock,
) -> Result<f64, String> {
    let mut con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    productos::aplicar_ajuste(&mut con, &disp, &datos)
}

// ============================================================================
// Caja (apertura mínima) y Venta
// ============================================================================

use crate::db::caja::{self, SesionCaja};
use crate::db::ventas::{self, CobroEntrada, VentaConfirmada};

/// Devuelve la sesión de caja abierta de este dispositivo, si hay.
#[tauri::command]
pub fn caja_abierta(estado: tauri::State<EstadoDb>) -> Result<Option<SesionCaja>, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    caja::sesion_abierta(&con, &disp)
}

/// Abre una caja con el fondo inicial declarado (en centavos).
#[tauri::command]
pub fn caja_abrir(
    estado: tauri::State<EstadoDb>,
    usuario_pos_id: String,
    fondo_inicial_centavos: i64,
) -> Result<SesionCaja, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    caja::abrir_caja(&con, &disp, &usuario_pos_id, fondo_inicial_centavos)
}

/// Procesa un cobro completo de forma atómica.
#[tauri::command]
pub fn venta_cobrar(
    estado: tauri::State<EstadoDb>,
    cobro: CobroEntrada,
) -> Result<VentaConfirmada, String> {
    let resultado = {
        let mut con = estado.con.lock().map_err(|e| e.to_string())?;
        let disp = dispositivo_id(&con)?;
        ventas::cobrar(&mut con, &disp, cobro)
    }; // se suelta el lock aquí
    if resultado.is_ok() {
        empujar_sync(&estado); // dispara y olvida, no bloquea
    }
    resultado
}

// ============================================================================
// Clientes y crédito
// ============================================================================

use crate::db::clientes::{
    self, AbonoEntrada, Cliente, EditarCliente, MovimientoCuenta, NuevoCliente,
};

#[tauri::command]
pub fn cliente_listar(
    estado: tauri::State<EstadoDb>,
    filtro: Option<String>,
) -> Result<Vec<Cliente>, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    clientes::listar(&con, filtro.as_deref())
}

#[tauri::command]
pub fn cliente_obtener(estado: tauri::State<EstadoDb>, id: String) -> Result<Option<Cliente>, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    clientes::obtener(&con, &id)
}

#[tauri::command]
pub fn cliente_crear(estado: tauri::State<EstadoDb>, datos: NuevoCliente) -> Result<Cliente, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    clientes::crear(&con, &disp, &datos)
}

#[tauri::command]
pub fn cliente_editar(estado: tauri::State<EstadoDb>, datos: EditarCliente) -> Result<(), String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    clientes::editar(&con, &datos)
}

#[tauri::command]
pub fn cliente_eliminar(estado: tauri::State<EstadoDb>, id: String) -> Result<(), String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    clientes::eliminar(&con, &id)
}

#[tauri::command]
pub fn cliente_estado_cuenta(
    estado: tauri::State<EstadoDb>,
    cliente_id: String,
) -> Result<Vec<MovimientoCuenta>, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    clientes::estado_cuenta(&con, &cliente_id)
}

#[tauri::command]
pub fn cliente_abonar(estado: tauri::State<EstadoDb>, datos: AbonoEntrada) -> Result<i64, String> {
    let mut con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    clientes::registrar_abono(&mut con, &disp, &datos)
}

/// Verifica si un cargo dejaría al cliente sobre su límite. (excede, saldo, limite)
#[tauri::command]
pub fn cliente_verificar_limite(
    estado: tauri::State<EstadoDb>,
    cliente_id: String,
    monto_cargo_centavos: i64,
) -> Result<(bool, i64, i64), String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    clientes::verificar_limite(&con, &cliente_id, monto_cargo_centavos)
}

// ============================================================================
// Caja: movimientos, corte X, cierre Z
// ============================================================================

use crate::db::caja::{CorteCaja, MovimientoEntrada};

#[tauri::command]
pub fn caja_movimiento(estado: tauri::State<EstadoDb>, datos: MovimientoEntrada) -> Result<(), String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    caja::registrar_movimiento(&con, &datos)
}

/// Corte X / base del corte Z: calcula el estado actual sin cerrar.
#[tauri::command]
pub fn caja_corte(estado: tauri::State<EstadoDb>, caja_sesion_id: String) -> Result<CorteCaja, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    caja::calcular_corte(&con, &caja_sesion_id)
}

/// Cierre Z: recibe efectivo contado, calcula diferencia, cierra. (esperado, diferencia)
#[tauri::command]
pub fn caja_cerrar(
    estado: tauri::State<EstadoDb>,
    caja_sesion_id: String,
    total_contado_centavos: i64,
) -> Result<(i64, i64), String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    caja::cerrar_caja(&con, &caja_sesion_id, total_contado_centavos)
}

// ============================================================================
// Devoluciones y cancelaciones
// ============================================================================

use crate::db::devoluciones::{self, DevolucionConfirmada, DevolucionEntrada, VentaDetalle, VentaResumen};

/// Lista las ventas del día para el selector de tickets. Cajero: solo su sesión.
#[tauri::command]
pub fn ventas_del_dia(
    estado: tauri::State<EstadoDb>,
    rol: String,
    caja_sesion_id: String,
) -> Result<Vec<VentaResumen>, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    let solo = if rol == "cajero" { Some(caja_sesion_id.as_str()) } else { None };
    devoluciones::ventas_del_dia(&con, &disp, solo)
}

/// Busca una venta para devolución, por id (preferido) o por folio (respaldo).
/// Aplica permiso por rol: dueño/gerente ven cualquier venta; cajero solo de
/// la sesión indicada.
#[tauri::command]
pub fn devolucion_buscar_venta(
    estado: tauri::State<EstadoDb>,
    folio: Option<i64>,
    venta_id: Option<String>,
    rol: String,
    caja_sesion_id: String,
) -> Result<Option<VentaDetalle>, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    let venta = devoluciones::buscar_venta(&con, folio, venta_id.as_deref())?;
    // Permiso: el cajero solo puede tocar ventas de SU sesión actual.
    if let Some(ref v) = venta {
        if rol == "cajero" && v.caja_sesion_id != caja_sesion_id {
            return Err("Como cajero solo puedes devolver ventas de tu turno actual.".into());
        }
    }
    Ok(venta)
}

#[tauri::command]
pub fn devolucion_procesar(
    estado: tauri::State<EstadoDb>,
    datos: DevolucionEntrada,
) -> Result<DevolucionConfirmada, String> {
    let mut con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    devoluciones::devolver(&mut con, &disp, datos)
}

// ============================================================================
// Reportes (solo dueño/gerente)
// ============================================================================

use crate::db::reportes::{self, ReporteCompleto};

#[tauri::command]
pub fn reporte_generar(
    estado: tauri::State<EstadoDb>,
    rol: String,
    inicio: String,
    fin: String,
) -> Result<ReporteCompleto, String> {
    // Permiso: reportes con ganancias son solo para dueño/gerente.
    if rol != "dueno" && rol != "gerente" {
        return Err("No tienes permiso para ver reportes.".into());
    }
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    // Negocio completo: las ventas bajadas de otras cajas también cuentan.
    reportes::generar(&con, &inicio, &fin)
}

// ============================================================================
// Configuración del negocio
// ============================================================================

use crate::db::config::{self, Configuracion, ConfiguracionEntrada};
use std::collections::HashMap;

#[tauri::command]
pub fn config_leer_todo(estado: tauri::State<EstadoDb>) -> Result<HashMap<String, String>, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    config::leer_todo(&con)
}

#[tauri::command]
pub fn config_guardar_claves(
    estado: tauri::State<EstadoDb>,
    claves: HashMap<String, String>,
    rol: String,
) -> Result<(), String> {
    if rol != "dueno" && rol != "gerente" {
        return Err("No tienes permiso para cambiar la configuración.".into());
    }
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    config::guardar_claves(&con, &claves)
}

#[tauri::command]
pub fn config_leer(estado: tauri::State<EstadoDb>) -> Result<Configuracion, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    config::leer(&con)
}

#[tauri::command]
pub fn config_guardar(
    estado: tauri::State<EstadoDb>,
    datos: ConfiguracionEntrada,
    rol: String,
) -> Result<(), String> {
    // Solo dueño/gerente pueden cambiar la configuración del negocio.
    if rol != "dueno" && rol != "gerente" {
        return Err("No tienes permiso para cambiar la configuración.".into());
    }
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    config::guardar(&con, &datos)
}

// ============================================================================
// Gestión de usuarios (pantalla Cajeros en Configuración)
// ============================================================================

use crate::db::usuarios::{self, EditarUsuario, NuevoUsuario};

#[tauri::command]
pub fn usuario_crear(
    estado: tauri::State<EstadoDb>,
    datos: NuevoUsuario,
    rol: String,
) -> Result<UsuarioPublico, String> {
    if rol != "dueno" && rol != "gerente" {
        return Err("No tienes permiso para gestionar usuarios.".into());
    }
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    usuarios::crear_usuario(&con, &disp, &datos)
}

#[tauri::command]
pub fn usuario_editar(
    estado: tauri::State<EstadoDb>,
    datos: EditarUsuario,
    rol: String,
) -> Result<(), String> {
    if rol != "dueno" && rol != "gerente" {
        return Err("No tienes permiso para gestionar usuarios.".into());
    }
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    usuarios::editar_usuario(&con, &datos)
}

#[tauri::command]
pub fn usuario_eliminar(
    estado: tauri::State<EstadoDb>,
    id: String,
    rol: String,
) -> Result<(), String> {
    if rol != "dueno" && rol != "gerente" {
        return Err("No tienes permiso para gestionar usuarios.".into());
    }
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    usuarios::eliminar_usuario(&con, &id)
}

// ============================================================================
// Ticket (vista previa y reimpresión)
// ============================================================================

use crate::db::ticket::{self, Ticket};

/// Genera el contenido del ticket de una venta, por id (preferido) o folio
/// (respaldo). No imprime: solo arma el contenido.
#[tauri::command]
pub fn ticket_generar(
    estado: tauri::State<EstadoDb>,
    folio: Option<i64>,
    venta_id: Option<String>,
) -> Result<Ticket, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    ticket::generar(&con, folio, venta_id.as_deref())
}

/// Genera el ticket de la última venta (reimpresión rápida).
#[tauri::command]
pub fn ticket_ultima(estado: tauri::State<EstadoDb>) -> Result<Ticket, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    ticket::generar_ultima(&con, &disp)
}

/// Datos necesarios para imprimir, calculados en Rust según la config.
#[derive(serde::Serialize)]
pub struct TrabajoImpresion {
    /// "escpos" (bytes directos) | "sistema" (vía driver de Windows/HTML).
    pub modo: String,
    /// Nombre de la impresora configurada (vacío = predeterminada).
    pub impresora: String,
    /// Bytes ESC/POS (como vector de enteros) para el modo escpos.
    pub bytes: Vec<u8>,
    /// Contenido del ticket por si el frontend necesita renderizar (modo sistema).
    pub ticket: Ticket,
    /// Si debe abrir el cajón (ventas en efectivo con cajón activo).
    pub abrir_cajon: bool,
}

/// Prepara un trabajo de impresión para una venta (por id o folio): lee la
/// config, genera el ticket y los bytes ESC/POS. El frontend decide cómo
/// enviarlo según el modo.
#[tauri::command]
pub fn ticket_preparar_impresion(
    estado: tauri::State<EstadoDb>,
    folio: Option<i64>,
    venta_id: Option<String>,
) -> Result<TrabajoImpresion, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    let t = ticket::generar(&con, folio, venta_id.as_deref())?;

    let get = |clave: &str| -> String {
        con.query_row(
            "SELECT valor FROM config WHERE clave=?1",
            rusqlite::params![clave],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
        .unwrap_or_default()
    };

    let modo = {
        let m = get("impresora_modo");
        if m.is_empty() { "escpos".to_string() } else { m }
    };
    let impresora = get("impresora_dispositivo");

    // ¿Abrir cajón? Solo si está activo y la venta tuvo efectivo. La venta se
    // localiza por id (preferido) o por folio (el folio solo es único por
    // caja; sin id se toma la más reciente con ese folio).
    let abrir_cajon = if get("cajon_abrir_efectivo") != "0" {
        let vid: Option<String> = match venta_id.as_deref() {
            Some(v) => Some(v.to_string()),
            None => folio.and_then(|f| {
                con.query_row(
                    "SELECT id FROM ventas WHERE folio=?1 ORDER BY creado_en DESC LIMIT 1",
                    rusqlite::params![f],
                    |r| r.get(0),
                )
                .ok()
            }),
        };
        match vid {
            Some(id) => con
                .query_row(
                    "SELECT COUNT(*) FROM pagos WHERE venta_id=?1 AND metodo='efectivo'",
                    rusqlite::params![id],
                    |r| r.get::<_, i64>(0),
                )
                .map(|n| n > 0)
                .unwrap_or(false),
            None => false,
        }
    } else {
        false
    };

    let bytes = ticket::a_escpos(&t, abrir_cajon);

    Ok(TrabajoImpresion {
        modo,
        impresora,
        bytes,
        ticket: t,
        abrir_cajon,
    })
}

// ============================================================================
// Importador de Eleventa
// ============================================================================

use crate::db::importador::{self, ExportEleventa, OpcionesImport, ResumenImport};

/// Previsualiza un export de Eleventa (cuenta cuántos hay de cada cosa).
/// Recibe el contenido del JSON como texto (el frontend lee el archivo).
#[tauri::command]
pub fn importar_previsualizar(json: String) -> Result<ResumenImport, String> {
    let export: ExportEleventa =
        serde_json::from_str(&json).map_err(|e| format!("JSON inválido: {e}"))?;
    Ok(importador::previsualizar(&export))
}

/// Ejecuta la importación según las opciones elegidas.
#[tauri::command]
pub fn importar_ejecutar(
    estado: tauri::State<EstadoDb>,
    json: String,
    opciones: OpcionesImport,
    rol: String,
) -> Result<ResumenImport, String> {
    if rol != "dueno" {
        return Err("Solo el dueño puede importar datos.".into());
    }
    let export: ExportEleventa =
        serde_json::from_str(&json).map_err(|e| format!("JSON inválido: {e}"))?;
    let mut con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    importador::importar(&mut con, &disp, &export, &opciones)
}

// ============================================================================
// Importador directo desde .FDB (lee Firebird sin puente Python)
// ============================================================================

use crate::db::firebird::{self, ConteoEleventa};

/// Previsualiza un .fdb de Eleventa: cuenta cuántos hay de cada cosa.
/// Lee el Firebird directamente (necesita fbclient.dll junto al programa).
#[tauri::command]
pub fn fdb_previsualizar(ruta: String) -> Result<ConteoEleventa, String> {
    firebird::contar(&ruta)
}

/// Importa directamente desde un .fdb. Lee Firebird, mapea y inserta en SQLite.
#[tauri::command]
pub fn fdb_importar(
    estado: tauri::State<EstadoDb>,
    ruta: String,
    opciones: OpcionesImport,
    rol: String,
) -> Result<ResumenImport, String> {
    if rol != "dueno" {
        return Err("Solo el dueño puede importar datos.".into());
    }
    // Lee el FDB (con o sin ventas según la opción) y reutiliza el importador.
    let export = firebird::leer(&ruta, opciones.importar_ventas)?;
    let mut con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    importador::importar(&mut con, &disp, &export, &opciones)
}

// ============================================================================
// Reporte de inventario
// ============================================================================

use crate::db::inventario::{self, ReporteInventario};

#[tauri::command]
pub fn inventario_reporte(
    estado: tauri::State<EstadoDb>,
    rol: String,
) -> Result<ReporteInventario, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    inventario::generar(&con, &disp, &rol)
}

#[tauri::command]
pub fn inventario_metricas(
    estado: tauri::State<EstadoDb>,
) -> Result<inventario::MetricasInventario, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    inventario::metricas(&con, &disp)
}

use crate::db::inventario::{ConteoLinea, ResultadoConteo};

/// Aplica un conteo físico masivo (modo realizar inventario).
#[tauri::command]
pub fn inventario_conteo(
    estado: tauri::State<EstadoDb>,
    lineas: Vec<ConteoLinea>,
    usuario_pos_id: String,
) -> Result<ResultadoConteo, String> {
    let mut con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    crate::db::inventario::aplicar_conteo(&mut con, &disp, &usuario_pos_id, &lineas)
}

// ============================================================================
// Exportación a CSV
// ============================================================================

use crate::db::exportar;

/// Exporta datos a CSV. `tipo` = "productos" | "inventario" | "ventas".
/// Devuelve el contenido CSV como texto; el frontend lo guarda.
#[tauri::command]
pub fn exportar_csv(
    estado: tauri::State<EstadoDb>,
    tipo: String,
    rol: String,
) -> Result<String, String> {
    // Inventario y ventas con costos: solo dueño/gerente.
    if (tipo == "inventario" || tipo == "productos") && rol == "cajero" {
        return Err("No tienes permiso para exportar esta información.".into());
    }
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    match tipo.as_str() {
        "productos" => exportar::productos(&con, &disp),
        "inventario" => exportar::inventario(&con, &disp),
        "ventas" => exportar::ventas(&con, &disp),
        _ => Err(format!("Tipo de exportación desconocido: {tipo}")),
    }
}

// ============================================================================
// Importación desde CSV (Excel)
// ============================================================================

use crate::db::importar_csv::{self, AnalisisCsv, MapeoCsv, ResumenCsv};

/// Analiza un CSV: encabezados, muestra y detección de columnas. No inserta.
#[tauri::command]
pub fn csv_analizar(contenido: String) -> Result<AnalisisCsv, String> {
    importar_csv::analizar(&contenido)
}

/// Importa productos desde CSV con el mapeo confirmado por el usuario.
#[tauri::command]
pub fn csv_importar_productos(
    estado: tauri::State<EstadoDb>,
    contenido: String,
    mapeo: MapeoCsv,
    rol: String,
) -> Result<ResumenCsv, String> {
    if rol != "dueno" {
        return Err("Solo el dueño puede importar productos.".into());
    }
    let mut con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    importar_csv::importar_productos(&mut con, &disp, &contenido, &mapeo)
}

// ============================================================================
// Respaldo completo de la base de datos
// ============================================================================

/// Exporta TODA la base de datos a un archivo .sqlite en la ruta indicada.
/// Usa `VACUUM INTO` que genera una copia limpia y consistente (incluye lo que
/// esté pendiente en el WAL). Es el respaldo completo del negocio.
#[tauri::command]
pub fn respaldo_completo(
    estado: tauri::State<EstadoDb>,
    ruta_destino: String,
    rol: String,
) -> Result<(), String> {
    if rol != "dueno" {
        return Err("Solo el dueño puede exportar la base de datos completa.".into());
    }
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    // VACUUM INTO requiere que el archivo destino no exista.
    if std::path::Path::new(&ruta_destino).exists() {
        std::fs::remove_file(&ruta_destino)
            .map_err(|e| format!("no se pudo sobrescribir el archivo existente: {e}"))?;
    }
    // El path en SQL debe ir entre comillas simples y escapar las internas.
    let ruta_sql = ruta_destino.replace('\'', "''");
    con.execute_batch(&format!("VACUUM INTO '{ruta_sql}'"))
        .map_err(|e| format!("no se pudo crear el respaldo: {e}"))?;
    Ok(())
}

// ============================================================================
// Restauración desde respaldo
// ============================================================================

use crate::db::restaurar;
use tauri::Manager;

/// Valida que un archivo sea un respaldo de YvexPOS legítimo. Para mostrar
/// confirmación antes de restaurar.
#[tauri::command]
pub fn restaurar_validar(ruta: String) -> Result<(), String> {
    restaurar::validar(&ruta)
}

/// Restaura la base de datos desde un respaldo. DESTRUCTIVO.
/// Hace un respaldo de seguridad de la base actual, valida el archivo, y lo
/// copia sobre la base activa. La app DEBE reiniciarse después (el frontend lo
/// pide). Devuelve la ruta del respaldo de seguridad creado.
#[tauri::command]
pub fn restaurar_ejecutar(
    app: tauri::AppHandle,
    estado: tauri::State<EstadoDb>,
    ruta_respaldo: String,
    rol: String,
) -> Result<String, String> {
    if rol != "dueno" {
        return Err("Solo el dueño puede restaurar la base de datos.".into());
    }
    // 1. Validar el archivo ANTES de tocar nada.
    restaurar::validar(&ruta_respaldo)?;

    // 2. Ubicar la base activa.
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no se pudo ubicar la carpeta de datos: {e}"))?;
    let ruta_bd_activa = dir.join("yvexiq-pos.sqlite");

    // 3. Respaldo de seguridad de la base ACTUAL (con la conexión viva) y
    //    checkpoint del WAL para que el respaldo y la copia sean consistentes.
    let respaldo_seg = {
        let con = estado.con.lock().map_err(|e| e.to_string())?;
        // Forzar checkpoint: vuelca el WAL al archivo principal.
        let _ = con.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        restaurar::respaldo_seguridad(&con, &dir)?
    }; // la conexión se libera aquí

    // 4. Sobrescribir la base activa con el respaldo elegido.
    restaurar::sobrescribir_bd(&ruta_respaldo, &ruta_bd_activa)?;

    Ok(respaldo_seg.to_string_lossy().to_string())
}

/// Reinicia la aplicación (tras restaurar).
#[tauri::command]
pub fn reiniciar_app(app: tauri::AppHandle) {
    app.restart();
}

// ============================================================================
// Tickets en espera (ventas simultáneas)
// ============================================================================

use crate::db::tickets_espera::{self, TicketEspera};

#[tauri::command]
pub fn ticket_espera_listar(
    estado: tauri::State<EstadoDb>,
    caja_sesion_id: String,
) -> Result<Vec<TicketEspera>, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    tickets_espera::listar(&con, &caja_sesion_id)
}

#[tauri::command]
pub fn ticket_espera_crear(
    estado: tauri::State<EstadoDb>,
    caja_sesion_id: String,
    usuario_pos_id: String,
    contenido: String,
) -> Result<TicketEspera, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    let disp = dispositivo_id(&con)?;
    tickets_espera::crear(&con, &caja_sesion_id, &usuario_pos_id, &disp, &contenido)
}

#[tauri::command]
pub fn ticket_espera_guardar(
    estado: tauri::State<EstadoDb>,
    id: String,
    contenido: String,
) -> Result<(), String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    tickets_espera::guardar(&con, &id, &contenido)
}

#[tauri::command]
pub fn ticket_espera_renombrar(
    estado: tauri::State<EstadoDb>,
    id: String,
    nombre: Option<String>,
) -> Result<(), String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    tickets_espera::renombrar(&con, &id, nombre.as_deref())
}

#[tauri::command]
pub fn ticket_espera_eliminar(
    estado: tauri::State<EstadoDb>,
    id: String,
) -> Result<(), String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    tickets_espera::eliminar(&con, &id)
}

// ============================================================================
// Kits (productos compuestos)
// ============================================================================

use crate::db::kits::{self, ComponenteKit};

#[tauri::command]
pub fn kit_componentes(
    estado: tauri::State<EstadoDb>,
    kit_id: String,
) -> Result<Vec<ComponenteKit>, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    kits::componentes_de(&con, &kit_id)
}

#[tauri::command]
pub fn kit_disponibles(
    estado: tauri::State<EstadoDb>,
    kit_id: String,
) -> Result<Option<f64>, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    kits::disponibles(&con, &kit_id)
}

#[tauri::command]
pub fn inicio_resumen(
    estado: tauri::State<EstadoDb>,
    rol: String,
    rangos: RangosInicio,
) -> Result<ResumenInicio, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    let incluir_costos = rol == "dueno" || rol == "gerente";
    db_inicio::resumen(&con, incluir_costos, &rangos)
}

// ============================================================================
// Vinculación con la nube (YvexPOS VPS)
// Añadir estos comandos a commands/mod.rs, y los `use` correspondientes arriba.
// ============================================================================

use crate::db::vinculacion::{
    self, CodigoVinculacion, EstadoVinculacion,
};

/// ¿Esta caja ya está vinculada a una cuenta en la nube?
/// El frontend lo llama para decidir si muestra "Vincular" o "Ya vinculado".
#[tauri::command]
pub fn vinc_ya_vinculado(estado: tauri::State<EstadoDb>) -> Result<bool, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    Ok(vinculacion::ya_vinculado(&con))
}

/// Genera un código de vinculación (lo muestra el PC para que el dueño lo
/// teclee en su app). No necesita la conexión: solo habla con el VPS.
#[tauri::command]
pub fn vinc_generar_codigo() -> Result<CodigoVinculacion, String> {
    vinculacion::generar_codigo("pc")
}

/// Consulta si el código ya fue reclamado por el dueño. Si sí, guarda las
/// credenciales localmente y devuelve estado "vinculado". El frontend llama
/// esto cada 2-3 segundos mientras muestra el código.
#[tauri::command]
pub fn vinc_consultar_estado(
    estado: tauri::State<EstadoDb>,
    codigo: String,
) -> Result<EstadoVinculacion, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    vinculacion::consultar_estado(&con, &codigo)
}

/// Desvincula la caja (borra credenciales locales).
#[tauri::command]
pub fn vinc_desvincular(estado: tauri::State<EstadoDb>) -> Result<(), String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    vinculacion::desvincular(&con)
}

/// Crea una cuenta nueva y vincula este PC en un paso. Devuelve el nombre del
/// dueño para saludarlo.
#[tauri::command]
pub fn vinc_registrar(
    estado: tauri::State<EstadoDb>,
    email: String,
    nombre: String,
    password: String,
    negocio_nombre: String,
    nombre_caja: String,
) -> Result<String, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    vinculacion::registrar_y_vincular(&con, &email, &nombre, &password, &negocio_nombre, &nombre_caja)
}

/// Inicia sesión con una cuenta existente y vincula este PC.
#[tauri::command]
pub fn vinc_login(
    estado: tauri::State<EstadoDb>,
    email: String,
    password: String,
    nombre_caja: String,
) -> Result<String, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    vinculacion::login_y_vincular(&con, &email, &password, &nombre_caja)
}

/// Estado de la cuenta: vinculado, correo y si está verificado.
#[tauri::command]
pub fn vinc_estado_cuenta(estado: tauri::State<EstadoDb>) -> Result<vinculacion::EstadoCuenta, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    Ok(vinculacion::estado_cuenta(&con))
}

/// Reenvía el código de verificación al correo.
#[tauri::command]
pub fn vinc_verificar_enviar(estado: tauri::State<EstadoDb>) -> Result<String, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    vinculacion::verificar_enviar(&con)
}

/// Confirma el código de verificación de 6 dígitos.
#[tauri::command]
pub fn vinc_verificar_confirmar(estado: tauri::State<EstadoDb>, codigo: String) -> Result<String, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    vinculacion::verificar_confirmar(&con, &codigo)
}

/// Corrige el correo y manda un código nuevo. Devuelve el correo actualizado.
#[tauri::command]
pub fn vinc_verificar_cambiar_email(estado: tauri::State<EstadoDb>, email_nuevo: String) -> Result<String, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    vinculacion::verificar_cambiar_email(&con, &email_nuevo)
}

// ============================================================================
// Sincronización con la nube (manual + estado)
// Añadir a commands/mod.rs. Requiere que EstadoDb tenga el Sender del hilo sync
// (ver INTEGRA_sync.txt, cambios en db/mod.rs y lib.rs).
// ============================================================================

use crate::db::sync_push::{sincronizar_una_pasada, ResultadoSync};
use crate::db::sync_worker::SenalSync;

/// Resultado del sync que ve el frontend (para la barra de estado).
#[derive(serde::Serialize)]
pub struct EstadoSync {
    pub enviadas: usize,
    pub pendientes: i64,
    pub hubo_error: bool,
    pub mensaje: String,
}

impl From<ResultadoSync> for EstadoSync {
    fn from(r: ResultadoSync) -> Self {
        EstadoSync {
            enviadas: r.enviadas,
            pendientes: r.pendientes_restantes,
            hubo_error: r.hubo_error,
            mensaje: r.mensaje,
        }
    }
}

/// "Sincronizar ahora": el dueño fuerza una subida manual. Sincroniza usando la
/// conexión principal (bloquea brevemente, pero es una acción explícita).
#[tauri::command]
pub fn sync_ahora(estado: tauri::State<EstadoDb>) -> Result<EstadoSync, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    Ok(sincronizar_una_pasada(&con).into())
}

/// Cuántas operaciones quedan pendientes de subir (para mostrar "N sin subir").
#[tauri::command]
pub fn sync_pendientes(estado: tauri::State<EstadoDb>) -> Result<i64, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    con.query_row("SELECT COUNT(*) FROM cola_sync", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

/// Pide al hilo de fondo que sincronice ya (se llama tras cada venta).
/// No espera respuesta: dispara y olvida.
pub fn empujar_sync(estado: &tauri::State<EstadoDb>) {
    if let Some(tx) = estado.sync_tx.lock().ok().and_then(|g| g.clone()) {
        let _ = tx.send(SenalSync::Ahora);
    }
}

/// Reactiva las operaciones de la cola que agotaron sus reintentos (tras un
/// servidor caído o un bug ya resuelto). Luego conviene llamar a sync_ahora.
#[tauri::command]
pub fn sync_reintentar(estado: tauri::State<EstadoDb>) -> Result<i64, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    crate::db::sync_push::reintentar_todo(&con)
}

/// Resultado de la bajada que ve el frontend (cuántos cambios llegaron).
#[derive(serde::Serialize)]
pub struct EstadoBajada {
    pub aplicados: usize,
    pub paginas: usize,
    pub mensaje: String,
}

/// "Bajar ahora": fuerza una bajada manual (ciclo completo: sube lo pendiente
/// y baja lo del negocio, en ese orden, para que el stock llegue neto).
#[tauri::command]
pub fn sync_bajar_ahora(estado: tauri::State<EstadoDb>) -> Result<EstadoBajada, String> {
    let con = estado.con.lock().map_err(|e| e.to_string())?;
    // Subir primero: lo nuestro ya cuenta en la nube cuando bajemos el stock.
    let _ = sincronizar_una_pasada(&con);
    let r = crate::db::sync_pull::bajar_todo(&con)?;
    Ok(EstadoBajada {
        aplicados: r.aplicados,
        paginas: r.paginas,
        mensaje: r.mensaje,
    })
}