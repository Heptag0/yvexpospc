//! Punto de entrada de la librería Tauri de YvexIQ POS.
//!
//! Inicializa SQLite (migraciones incluidas), deja la conexión en el estado de
//! la app y registra los comandos expuestos al frontend.

mod commands;
mod db;

use db::EstadoDb;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_thermal_printer::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Carpeta de datos de la app (p. ej. %APPDATA%\com.yvexiq.pos en Windows).
            let dir = app
                .path()
                .app_data_dir()
                .expect("no se pudo resolver app_data_dir");
            std::fs::create_dir_all(&dir).expect("no se pudo crear la carpeta de datos");
            let ruta_db = dir.join("yvexiq-pos.sqlite");
            println!("[db] usando base de datos en {ruta_db:?}");

            let con = db::inicializar(&ruta_db).expect("fallo inicializando la BD");
            // Arranca el hilo de sincronización de fondo (su propia conexión).
            let sync_tx = db::sync_worker::arrancar_hilo_sync(ruta_db.clone());
            app.manage(EstadoDb {
                con: Mutex::new(con),
                sync_tx: Mutex::new(Some(sync_tx)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_estado,
            commands::pos_configurado,
            commands::configurar_pos,
            commands::listar_usuarios,
            commands::login,
            commands::cat_listar,
            commands::cat_crear,
            commands::cat_editar,
            commands::cat_eliminar,
            commands::cat_reordenar,
            commands::prod_listar,
            commands::prod_contar_negativos,
            commands::prod_por_codigo,
            commands::prod_crear,
            commands::prod_editar,
            commands::prod_eliminar,
            commands::prod_eliminar_varios,
            commands::inventario_reporte,
            commands::inventario_metricas,
            commands::inventario_conteo,
            commands::exportar_csv,
            commands::csv_analizar,
            commands::csv_importar_productos,
            commands::respaldo_completo,
            commands::restaurar_validar,
            commands::restaurar_ejecutar,
            commands::reiniciar_app,
            commands::ticket_espera_listar,
            commands::ticket_espera_crear,
            commands::ticket_espera_guardar,
            commands::ticket_espera_renombrar,
            commands::ticket_espera_eliminar,
            commands::kit_componentes,
            commands::kit_disponibles,
            commands::prod_ajustar_stock,
            commands::caja_abierta,
            commands::caja_abrir,
            commands::venta_cobrar,
            commands::cliente_listar,
            commands::cliente_obtener,
            commands::cliente_crear,
            commands::cliente_editar,
            commands::cliente_eliminar,
            commands::cliente_estado_cuenta,
            commands::cliente_abonar,
            commands::cliente_verificar_limite,
            commands::caja_movimiento,
            commands::caja_corte,
            commands::caja_cerrar,
            commands::devolucion_buscar_venta,
            commands::devolucion_procesar,
            commands::ventas_del_dia,
            commands::reporte_generar,
            commands::config_leer,
            commands::config_guardar,
            commands::config_leer_todo,
            commands::config_guardar_claves,
            commands::usuario_crear,
            commands::usuario_editar,
            commands::usuario_eliminar,
            commands::ticket_generar,
            commands::ticket_ultima,
            commands::ticket_preparar_impresion,
            commands::importar_previsualizar,
            commands::importar_ejecutar,
            commands::fdb_previsualizar,
            commands::fdb_importar,
            commands::inicio_resumen,
            commands::vinc_ya_vinculado,
            commands::vinc_generar_codigo,
            commands::vinc_consultar_estado,
            commands::vinc_desvincular,
            commands::sync_ahora,
            commands::sync_pendientes,
            commands::vinc_registrar,
            commands::vinc_login,
            commands::sync_reintentar,
            commands::sync_bajar_ahora,
            commands::vinc_estado_cuenta,
            commands::vinc_verificar_enviar,
            commands::vinc_verificar_confirmar,
            commands::vinc_verificar_cambiar_email,

            commands::tienda_estado,
            commands::tienda_publicar,
            commands::tienda_slug_disponible,
            commands::tienda_desactivar,
            commands::tienda_pedidos,
            commands::tienda_pedido_estado,
            commands::tienda_pedido_completar,
            commands::tienda_config_local,
            commands::tienda_guardar_config_local,
            commands::tienda_productos_para_publicar,
        ])
        .run(tauri::generate_context!())
        .expect("error ejecutando la aplicación Tauri");
}
