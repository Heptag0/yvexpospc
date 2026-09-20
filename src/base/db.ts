// YvexPOS Móvil — Base de datos local (SQLite en el teléfono).
//
// Calca el esquema ESENCIAL del POS de escritorio para funcionar 100% offline
// y para que la sincronización futura hable el mismo idioma que el PC.
//
// Montos SIEMPRE en centavos enteros. Stock REAL (float) por el granel.
// IDs en UUID texto (sync futura idempotente, sin colisiones).
//
// v1: config, categorias, productos, caja_sesiones, ventas, venta_lineas, pagos
// v2: kits (es_kit + kit_componentes) y rastro de ajustes de inventario

import * as SQLite from "expo-sqlite";

const VERSION_ESQUEMA = 33;
const NOMBRE_BD = "yvexpos.db";

let _dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Abre (o crea) la base y aplica migraciones. Idempotente.
 *
 *  IMPORTANTE: se cachea la PROMESA, no solo la instancia. Al arrancar la app
 *  hay varias llamadas simultáneas a bd() (tema, puerta de onboarding, semilla,
 *  pantalla inicial); si cada una abriera la base por su cuenta, expo-sqlite
 *  abre el mismo archivo varias veces a la vez y los handles nativos se pisan
 *  (NullPointerException en prepareAsync, app congelada en blanco — sobre todo
 *  en instalación nueva, cuando las migraciones hacen lenta la primera
 *  apertura). Con la promesa cacheada, todos esperan la MISMA apertura. */
export function abrirBD(): Promise<SQLite.SQLiteDatabase> {
  if (!_dbPromise) {
    _dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(NOMBRE_BD);
      await db.execAsync("PRAGMA journal_mode = WAL;");
      await db.execAsync("PRAGMA foreign_keys = ON;");
      await migrar(db);
      return db;
    })();
    // Si la apertura falla (p. ej. datos de la app borrados con la app viva),
    // descarta la promesa rechazada para que la próxima llamada REINTENTE
    // en vez de quedarse con el error para siempre.
    _dbPromise.catch(() => {
      _dbPromise = null;
    });
  }
  return _dbPromise;
}

/** Devuelve la instancia ya abierta (o la abre si hace falta). */
export async function bd(): Promise<SQLite.SQLiteDatabase> {
  return abrirBD();
}

// ---------------------------------------------------------------------------
// Migraciones (user_version de SQLite, mismo espíritu que migrations.rs del PC)
// ---------------------------------------------------------------------------
async function migrar(db: SQLite.SQLiteDatabase): Promise<void> {
  const fila = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version;"
  );
  const actual = fila?.user_version ?? 0;

  // Marca la versión TRAS CADA migración, no solo al final.
  //
  // Antes, `PRAGMA user_version` se escribía una sola vez al terminar todo.
  // Si una migración intermedia fallaba de verdad (no un "duplicate column",
  // que ya está protegido, sino un error real), las anteriores YA habían
  // corrido pero la versión seguía en el valor viejo: el siguiente arranque
  // las repetía todas desde cero. Hoy eso se aguanta porque cada paso es
  // idempotente, pero es suerte, no diseño — y la primera migración futura
  // que no lo sea reproduciría el bloqueo total de la app que ya vivimos.
  // Marcando paso a paso, un fallo en la v29 deja la base en v28 y el
  // siguiente arranque continúa desde ahí en vez de empezar de nuevo.
  const marcar = async (v: number) => {
    await db.execAsync(`PRAGMA user_version = ${v};`);
  };

  if (actual < 1) {
    await db.execAsync(ESQUEMA_V1);
    await marcar(1);
  }
  if (actual < 2) {
    // Antes: este ALTER TABLE vivía dentro de ESQUEMA_V2 sin protección —
    // era la causa exacta del bloqueo total de la app (ver la nota grande
    // al final de esta función). Aparte y protegido, como los de v14+.
    try {
      await db.execAsync(
        "ALTER TABLE productos ADD COLUMN es_kit INTEGER NOT NULL DEFAULT 0;"
      );
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    await db.execAsync(ESQUEMA_V2);
    await marcar(2);
  }
  if (actual < 3) {
    try {
      await db.execAsync("ALTER TABLE productos ADD COLUMN imagen_uri TEXT;");
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    await marcar(3);
  }
  if (actual < 4) {
    try {
      await db.execAsync("ALTER TABLE categorias ADD COLUMN icono TEXT;");
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    await marcar(4);
  }
  if (actual < 5) {
    await db.execAsync(ESQUEMA_V5);
    await marcar(5);
  }
  if (actual < 6) {
    await db.execAsync(ESQUEMA_V6);
    // Dependen de que usuarios_pos ya exista (se acaba de crear arriba),
    // por eso van después del bloque, no antes como en v2/v7.
    for (const tabla of ["ventas", "caja_sesiones"]) {
      try {
        await db.execAsync(
          `ALTER TABLE ${tabla} ADD COLUMN usuario_pos_id TEXT REFERENCES usuarios_pos(id);`
        );
      } catch {
        // La columna ya existía: no pasa nada, seguimos.
      }
    }
    await marcar(6);
  }
  if (actual < 7) {
    // Mismo motivo que la v2: estos 3 ALTER TABLE vivían sin protección
    // dentro de ESQUEMA_V7. Cada uno en su propio try/catch — si van
    // juntos en una sola cadena y el primero choca, los otros dos ni se
    // intentan.
    for (const col of ["productos", "categorias", "ventas"]) {
      try {
        await db.execAsync(
          `ALTER TABLE ${col} ADD COLUMN origen TEXT NOT NULL DEFAULT 'local';`
        );
      } catch {
        // La columna ya existía: no pasa nada, seguimos.
      }
    }
    await db.execAsync(ESQUEMA_V7);
    await marcar(7);
  }
  if (actual < 8) {
    await db.execAsync(ESQUEMA_V8);
    await marcar(8);
  }
  if (actual < 9) {
    await db.execAsync(ESQUEMA_V9);
    await marcar(9);
  }
  if (actual < 10) {
    try {
      await db.execAsync("ALTER TABLE alias_ticket ADD COLUMN piezas_empaque INTEGER;");
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    await marcar(10);
  }
  if (actual < 11) {
    await db.execAsync(ESQUEMA_V11);
    await marcar(11);
  }
  if (actual < 12) {
    await db.execAsync(ESQUEMA_V12);
    await marcar(12);
  }
  if (actual < 13) {
    await db.execAsync(ESQUEMA_V13);
    await marcar(13);
  }
  if (actual < 14) {
    // ALTER TABLE no es idempotente: si la columna ya existe (reinstalación
    // rara con user_version atrasado), SQLite lanza error y la migración
    // entera tronaría. Lo protegemos como se hace en otras migraciones con
    // columnas nuevas: intentar y, si ya estaba, seguir.
    try {
      await db.execAsync("ALTER TABLE ventas ADD COLUMN cliente_id TEXT;");
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    await db.execAsync(ESQUEMA_V14);
    await marcar(14);
  }
  if (actual < 15) {
    // Correo del cliente (opcional): servirá después para promociones.
    // Mismo patrón try/catch que la v14: si la columna ya existe, seguimos.
    try {
      await db.execAsync("ALTER TABLE clientes ADD COLUMN correo TEXT;");
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    await marcar(15);
  }

  if (actual < 16) {
    // v16 — Escaparate en línea: en_tienda marca QUÉ productos quiere el
    // dueño mostrar en su tienda. Es una selección LOCAL (persiste entre
    // publicaciones); la publicación en sí es una acción explícita por
    // HTTPS propio (src/base/tienda.ts), NUNCA viaja por cola_sync.
    // Mismo patrón try/catch que la v14/v15: si la columna ya existe, seguimos.
    try {
      await db.execAsync(
        "ALTER TABLE productos ADD COLUMN en_tienda INTEGER NOT NULL DEFAULT 0;"
      );
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    await marcar(16);
  }

  if (actual < 17) {
    await db.execAsync(ESQUEMA_V17);
    await marcar(17);
  }
  if (actual < 18) {
    await db.execAsync(ESQUEMA_V18);
    await marcar(18);
  }
  if (actual < 19) {
    await db.execAsync(ESQUEMA_V19);
    await marcar(19);
  }
  if (actual < 20) {
    // v20 — Categoría de receta, para saber qué tan seguro es sugerir bajar
    // un ingrediente sin arriesgar la conservación del producto.
    try {
      await db.execAsync(
        "ALTER TABLE perfiles_etiqueta ADD COLUMN categoria_receta TEXT NOT NULL DEFAULT 'otro';"
      );
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    await marcar(20);
  }

  if (actual < 21) {
    // v21 — Favorito: el móvil se pone al parejo del PC, que ya marca
    // productos favoritos (se ven con ★ en la lista de inventario del PC).
    // Mismo patrón try/catch que las columnas anteriores: si ya existía
    // (reinstalación con user_version atrasado), seguimos sin tronar.
    try {
      await db.execAsync(
        "ALTER TABLE productos ADD COLUMN favorito INTEGER NOT NULL DEFAULT 0;"
      );
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    await marcar(21);
  }

  if (actual < 22) {
    // v22 — Costo histórico en venta_lineas (misma migración 004 del PC).
    // Sin esto, "cuánto gané" en una venta pasada se recalculaba con el
    // costo ACTUAL del producto, así que la ganancia de una venta de hace
    // un mes cambiaba sola cada vez que el costo del producto cambiaba.
    // Ventas previas a esta migración quedan en 0 ("sin costo registrado"),
    // igual que en el PC — no se inventa un costo histórico que no se
    // guardó.
    try {
      await db.execAsync(
        "ALTER TABLE venta_lineas ADD COLUMN costo_unitario_centavos INTEGER NOT NULL DEFAULT 0;"
      );
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    await marcar(22);
  }

  if (actual < 23) {
    // v23 — Conteo a ciegas del corte + bolsa de sobrante/faltante.
    //
    // efectivo_contado_centavos / diferencia_centavos son LOCALES a
    // propósito, mismo criterio que productos.en_tienda (v16): el backend
    // no conoce estas columnas, así que NUNCA se agregan al payload de
    // encolar() en cerrarTurno() — hacerlo rompería algo que hoy funciona
    // sin necesidad. Si el conteo a ciegas está apagado (por defecto),
    // ambas quedan en NULL para siempre: no se le pide nada al cajero.
    //
    // bolsa_movimientos: LOCAL-ONLY, mismo punto de partida que
    // proveedores/compras (v13) y clientes/lealtad (v14) antes de tener
    // soporte en el backend. Una sola bolsa del negocio (no por cajero) —
    // cada fila queda atribuida a qué usuario cerró ESE turno, para que el
    // dueño pueda ver si un cajero en particular acumula faltantes.
    try {
      await db.execAsync(
        "ALTER TABLE caja_sesiones ADD COLUMN efectivo_contado_centavos INTEGER;"
      );
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    try {
      await db.execAsync(
        "ALTER TABLE caja_sesiones ADD COLUMN diferencia_centavos INTEGER;"
      );
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    await db.execAsync(ESQUEMA_V23);
    await marcar(23);
  }

  if (actual < 24) {
    // v24 — Alinear las columnas del conteo a ciegas con lo que sync.py YA
    // espera en caja_sesiones. Se descubrió que el backend ya tiene
    // `total_efectivo_esperado_centavos` / `total_efectivo_contado_centavos`
    // / `diferencia_centavos` en su MAPA — el PC probablemente ya hace algo
    // parecido al conteo a ciegas. La v23 usó nombres propios
    // (`efectivo_contado_centavos`, sin persistir el esperado) sin saber
    // esto; con el renombre, el conteo del móvil puede sincronizar de
    // verdad en vez de quedarse solo local.
    //
    // RENAME COLUMN, no un ALTER+borrar+crear: conserva los datos que ya
    // hubiera en dispositivos donde la v23 alcanzó a correr. Si la columna
    // vieja nunca existió (instalación nueva que arranca directo en v24,
    // o un dispositivo donde la v23 ya se corrió con este nombre nuevo por
    // algún motivo), el RENAME falla y el catch lo deja pasar.
    try {
      await db.execAsync(
        "ALTER TABLE caja_sesiones RENAME COLUMN efectivo_contado_centavos TO total_efectivo_contado_centavos;"
      );
    } catch {
      // Ya se llamaba así, o la columna vieja nunca existió: seguimos.
    }
    try {
      await db.execAsync(
        "ALTER TABLE caja_sesiones ADD COLUMN total_efectivo_esperado_centavos INTEGER;"
      );
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    await marcar(24);
  }

  if (actual < 25) {
    // v25 — dispositivo_id en caja_sesiones. El PC ya lo tenía desde su
    // esquema inicial (001_inicial.sql) y filtra por él en
    // sesion_abierta(); el móvil nunca lo tuvo. Sin esta columna,
    // turnoActivo() no puede distinguir "mi turno abierto" de un turno
    // abierto en OTRO dispositivo que ya bajó por sync — el más reciente
    // gana sin importar de quién era, y un cajero podría terminar
    // vendiendo o cerrando el turno de otra caja sin darse cuenta.
    //
    // NULL para los turnos que ya existan (locales, de antes de esta
    // columna, o abiertos antes de vincular cuenta — dispositivoId no
    // existe hasta ese momento, ver nube.ts): turnoActivo() los sigue
    // reconociendo como propios porque son los únicos que puede haber
    // sin dispositivo_id.
    try {
      await db.execAsync(
        "ALTER TABLE caja_sesiones ADD COLUMN dispositivo_id TEXT;"
      );
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    await marcar(25);
  }

  if (actual < 26) {
    await db.execAsync(ESQUEMA_V26);
    await marcar(26);
  }

  if (actual < 27) {
    // v27 — producto_id en perfiles_etiqueta. El PC ya lo tenía: cuando
    // una receta se manda al catálogo, crea el producto Y un perfil de
    // etiqueta NOM-051 automático, VINCULADO a ese producto. Sin esta
    // columna, el móvil podía crear el perfil pero no enlazarlo — perdía
    // justo la parte que hace útil la automatización.
    try {
      await db.execAsync(
        "ALTER TABLE perfiles_etiqueta ADD COLUMN producto_id TEXT REFERENCES productos(id);"
      );
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    await marcar(27);
  }

  if (actual < 28) {
    // v28 — Crédito (cobranza). Puerto del modelo de clientes.rs del PC:
    //   - clientes.limite_credito_centavos / saldo_centavos: el límite
    //     AVISA, no bloquea (la decisión es del cajero/dueño) — igual que
    //     el PC. limite = 0 significa "sin límite definido".
    //   - movimientos_cuenta: 'cargo' (venta a crédito, sube el saldo) o
    //     'abono' (pago, lo baja). La suma reconstruye el saldo — rastro
    //     auditable, igual que ajustes_inventario con el stock.
    //
    // Nombres de columna en clientes IDÉNTICOS a los que sync.py ya espera
    // (confirmado: su MAPA ya tiene "limite_credito_centavos" y
    // "saldo_centavos" en clientes) — el backend ya sabía recibir esto,
    // solo el móvil no lo tenía, mismo patrón que se encontró con el
    // conteo a ciegas en caja_sesiones.
    //
    // movimientos_cuenta NO se agrega al MAPA de sync.py todavía — se
    // revisó y esa entidad no está ahí (aunque el PC sí la encola). Por
    // ahora se queda LOCAL-ONLY aquí también: encolarla sin que el
    // servidor la acepte no serviría de nada, solo la dejaría en
    // cola_sync sin nunca aplicarse.
    try {
      await db.execAsync(
        "ALTER TABLE clientes ADD COLUMN limite_credito_centavos INTEGER NOT NULL DEFAULT 0;"
      );
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    try {
      await db.execAsync(
        "ALTER TABLE clientes ADD COLUMN saldo_centavos INTEGER NOT NULL DEFAULT 0;"
      );
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    await db.execAsync(ESQUEMA_V28);
    await marcar(28);
  }

  // v29 — kit_componentes sincronizable.
  //
  // La tabla existía desde v2 en las dos plataformas, pero NADIE la encolaba
  // y el servidor no la conocía. El kit llegaba al otro dispositivo marcado
  // como kit pero VACÍO: no se podía editar, y venderlo NO DESCONTABA NADA
  // del inventario (el kit no tiene stock propio, se deriva de sus piezas).
  //
  // `eliminado` es imprescindible para poder sincronizarla: editar un kit
  // REEMPLAZA su lista de componentes, y con borrado duro el otro dispositivo
  // nunca se entera de que quitaste una pieza — se queda con la lista vieja
  // y descuenta stock de más.
  if (actual < 29) {
    for (const sql of [
      "ALTER TABLE kit_componentes ADD COLUMN eliminado INTEGER NOT NULL DEFAULT 0;",
      "ALTER TABLE kit_componentes ADD COLUMN actualizado_en TEXT;",
    ]) {
      try {
        await db.execAsync(sql);
      } catch {
        // La columna ya existía: no pasa nada, seguimos.
      }
    }
    await db.execAsync(
      "CREATE INDEX IF NOT EXISTS idx_kit_comp_vivo ON kit_componentes(kit_id, eliminado);"
    );
    await marcar(29);
  }

  // v30 — `origen` en cotizaciones, para que el folio sea de ESTA caja.
  //
  // Las cotizaciones SÍ sincronizan, así que la tabla acaba mezclando las
  // propias con las bajadas de otras cajas. Sin poder distinguirlas,
  // `MAX(folio)` tomaba también las ajenas y el folio saltaba a la serie del
  // PC en cuanto se sincronizaba — el mismo fallo que tenía el folio de
  // ventas. `ventas` ya resolvía esto con una columna `origen`; se replica.
  if (actual < 30) {
    try {
      await db.execAsync(
        "ALTER TABLE cotizaciones ADD COLUMN origen TEXT NOT NULL DEFAULT 'local';"
      );
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    await marcar(30);
  }

  // v31 — IVA por producto. Puerto de `productos.iva_tasa` del PC: un
  // PORCENTAJE entero (0 o 16), NO puntos base — la conversión a puntos
  // base para el cálculo real del impuesto vive en
  // impuestos.ts::puntosBaseDesdePct(), nunca aquí.
  //
  // El PC ya tenía esta columna y ya la manda en cada bajada (sync_bajar.py);
  // el móvil la recibía y la IGNORABA a propósito (ver el comentario viejo
  // en sync.ts::bajar()) porque no tenía dónde guardarla. Con esta columna,
  // prepararTrasVincular() y bajar() dejan de descartarla.
  //
  // SQLite no permite añadir un CHECK con ALTER TABLE sobre una tabla ya
  // creada (a diferencia del CHECK (iva_tasa IN (0,16)) que sí tiene el PC
  // desde su esquema inicial) — la validación 0/16 se hace en
  // inventario.ts::validar(), a nivel de aplicación.
  if (actual < 31) {
    try {
      await db.execAsync(
        "ALTER TABLE productos ADD COLUMN iva_tasa INTEGER NOT NULL DEFAULT 0;"
      );
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
    await marcar(31);
  }

  // v32 — Tablas espejo de devoluciones. Puerto exacto de 001_inicial.sql +
  // 003_metodo_reembolso.sql del PC: mismas columnas, mismos tipos.
  //
  // El servidor YA manda estas dos entidades en cada bajada — el móvil las
  // recibía y las DESCARTABA a propósito (ver el comentario viejo en
  // sync.ts::bajar()) porque no tenía dónde guardarlas. Sin esto, el corte
  // del negocio en un teléfono quedaba incompleto en cuanto OTRA caja hacía
  // una devolución: esas ventas seguían contando su total original completo,
  // como si nunca se hubieran devuelto.
  //
  // Son tablas ESPEJO, solo para lectura/reportes por ahora — el móvil
  // todavía no CREA devoluciones (eso es una pantalla completa, aparte).
  // `devolucion_lineas` no lleva `actualizado_en` a propósito: mismo motivo
  // que en el PC (comentario original en 001_inicial.sql) — no hay conflicto
  // que resolver en una fila que nunca se actualiza tras crearse.
  //
  // Sin claves foráneas declaradas (a diferencia del PC): las filas bajadas
  // referencian ventas/caja_sesiones de OTRAS cajas que pueden no existir
  // localmente todavía, y aquí no hay un mecanismo de "usuario espejo" como
  // en el PC (sync_pull.rs) para rellenar ese hueco. Igual que
  // ajustes_inventario y kit_componentes ya hacen en este mismo archivo.
  if (actual < 32) {
    try {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS devoluciones (
          id TEXT PRIMARY KEY,
          venta_id TEXT NOT NULL,
          caja_sesion_id TEXT NOT NULL,
          usuario_pos_id TEXT,
          motivo TEXT,
          metodo_reembolso TEXT,
          total_devuelto_centavos INTEGER NOT NULL,
          creado_en TEXT NOT NULL,
          actualizado_en TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_devoluciones_venta ON devoluciones(venta_id);
        CREATE TABLE IF NOT EXISTS devolucion_lineas (
          id TEXT PRIMARY KEY,
          devolucion_id TEXT NOT NULL,
          venta_linea_id TEXT NOT NULL,
          cantidad REAL NOT NULL,
          monto_centavos INTEGER NOT NULL,
          reingresa_stock INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_devolucion_lineas_dev ON devolucion_lineas(devolucion_id);
      `);
    } catch {
      // Las tablas ya existían: no pasa nada, seguimos.
    }
    await marcar(32);
  }

  // v33 — Cobro mixto. Puerto de 001_inicial.sql del PC: `pagos` necesita
  // `recibido_centavos` (lo que el cliente entregó, solo efectivo),
  // `cambio_centavos` (por pago, no global) y `actualizado_en` — ninguna
  // existía en el móvil, aunque `venta.ts::cobrar()` ya las MANDABA en el
  // payload de `encolar()` desde antes (se perdían al no tener dónde
  // guardarlas localmente; el servidor las recibía igual, calculadas al
  // vuelo con el único pago que existía entonces).
  //
  // `actualizado_en` no puede ir NOT NULL en el ALTER (SQLite exige un
  // default para filas existentes si es NOT NULL) — se agrega nullable y se
  // rellena con `creado_en` para las filas viejas, la mejor aproximación
  // honesta que hay: nunca se guardó el dato real.
  if (actual < 33) {
    try {
      await db.execAsync("ALTER TABLE pagos ADD COLUMN recibido_centavos INTEGER;");
    } catch {
      // Ya existía.
    }
    try {
      await db.execAsync("ALTER TABLE pagos ADD COLUMN cambio_centavos INTEGER;");
    } catch {
      // Ya existía.
    }
    try {
      await db.execAsync("ALTER TABLE pagos ADD COLUMN actualizado_en TEXT;");
    } catch {
      // Ya existía.
    }
    try {
      await db.execAsync(
        "UPDATE pagos SET actualizado_en = creado_en WHERE actualizado_en IS NULL;"
      );
    } catch {
      // Nada que rellenar, o la columna no se pudo crear arriba.
    }
    await marcar(33);
  }

  if (actual < VERSION_ESQUEMA) {
    // Red final: cubre el caso de subir VERSION_ESQUEMA sin añadir un bloque
    // nuevo. Cada migración ya marca la suya con marcar(), así que esto
    // normalmente no cambia nada.
    //
    // NOTA HISTÓRICA — ESTE PRAGMA FALTABA POR COMPLETO. migrar() leía user_version pero
    // nunca lo escribía — cada arranque en frío de la app (Android matando
    // el proceso y reabriéndolo) creía que la base nunca se había migrado
    // y volvía a correr las 28 migraciones desde cero. Las CREATE TABLE IF
    // NOT EXISTS sobreviven porque son repetibles; los ALTER TABLE sin
    // try/catch (v2, v7) no — la segunda vez que corrían chocaban con
    // "duplicate column name" y migrar() entero se detenía ahí, dejando la
    // app sin poder abrir la base nunca más. Con esto, cada migración se
    // corre una sola vez de verdad.
    await db.execAsync(`PRAGMA user_version = ${VERSION_ESQUEMA};`);
  }
}

const ESQUEMA_V1 = `
CREATE TABLE IF NOT EXISTS config (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE IF NOT EXISTS categorias (
  id         TEXT PRIMARY KEY,
  nombre     TEXT NOT NULL,
  orden      INTEGER NOT NULL DEFAULT 0,
  color      TEXT,
  activo     INTEGER NOT NULL DEFAULT 1,
  eliminado  INTEGER NOT NULL DEFAULT 0,
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS productos (
  id                     TEXT PRIMARY KEY,
  codigo_barras          TEXT,
  nombre                 TEXT NOT NULL,
  categoria_id           TEXT REFERENCES categorias(id),
  precio_venta_centavos  INTEGER NOT NULL DEFAULT 0,
  costo_centavos         INTEGER,
  precio_mayoreo_centavos INTEGER,
  controla_stock         INTEGER NOT NULL DEFAULT 1,
  stock                  REAL NOT NULL DEFAULT 0,
  stock_minimo           REAL NOT NULL DEFAULT 0,
  unidad                 TEXT NOT NULL DEFAULT 'pieza',
  activo                 INTEGER NOT NULL DEFAULT 1,
  eliminado              INTEGER NOT NULL DEFAULT 0,
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_productos_codigo ON productos(codigo_barras);
CREATE INDEX IF NOT EXISTS idx_productos_nombre ON productos(nombre);
CREATE INDEX IF NOT EXISTS idx_productos_categoria ON productos(categoria_id);

CREATE TABLE IF NOT EXISTS caja_sesiones (
  id                      TEXT PRIMARY KEY,
  fondo_inicial_centavos  INTEGER NOT NULL DEFAULT 0,
  abierta_en              TEXT NOT NULL,
  cerrada_en              TEXT,
  estado                  TEXT NOT NULL DEFAULT 'abierta',
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ventas (
  id                  TEXT PRIMARY KEY,
  caja_sesion_id      TEXT REFERENCES caja_sesiones(id),
  folio               INTEGER NOT NULL,
  subtotal_centavos   INTEGER NOT NULL DEFAULT 0,
  descuento_centavos  INTEGER NOT NULL DEFAULT 0,
  iva_centavos        INTEGER NOT NULL DEFAULT 0,
  total_centavos      INTEGER NOT NULL DEFAULT 0,
  estado              TEXT NOT NULL DEFAULT 'completada',
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ventas_creado ON ventas(creado_en);
CREATE INDEX IF NOT EXISTS idx_ventas_caja ON ventas(caja_sesion_id);

CREATE TABLE IF NOT EXISTS venta_lineas (
  id                        TEXT PRIMARY KEY,
  venta_id                  TEXT NOT NULL REFERENCES ventas(id),
  producto_id               TEXT REFERENCES productos(id),
  nombre_producto           TEXT NOT NULL,
  cantidad                  REAL NOT NULL,
  precio_unitario_centavos  INTEGER NOT NULL,
  descuento_linea_centavos  INTEGER NOT NULL DEFAULT 0,
  total_linea_centavos      INTEGER NOT NULL,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lineas_venta ON venta_lineas(venta_id);

CREATE TABLE IF NOT EXISTS pagos (
  id             TEXT PRIMARY KEY,
  venta_id       TEXT NOT NULL REFERENCES ventas(id),
  metodo         TEXT NOT NULL,
  monto_centavos INTEGER NOT NULL,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pagos_venta ON pagos(venta_id);
`;

// v2 — Kits (paquetes) y rastro de ajustes de inventario.
// Regla del PC: el stock NUNCA se edita a mano sin dejar rastro. Todo ajuste
// queda en ajustes_inventario (motivo: 'ajuste', 'resurtido', 'conteo').
const ESQUEMA_V2 = `
CREATE TABLE IF NOT EXISTS kit_componentes (
  id          TEXT PRIMARY KEY,
  kit_id      TEXT NOT NULL REFERENCES productos(id),
  producto_id TEXT NOT NULL REFERENCES productos(id),
  cantidad    REAL NOT NULL,
  creado_en   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kit_comp_kit ON kit_componentes(kit_id);

CREATE TABLE IF NOT EXISTS ajustes_inventario (
  id             TEXT PRIMARY KEY,
  producto_id    TEXT NOT NULL REFERENCES productos(id),
  stock_antes    REAL NOT NULL,
  stock_despues  REAL NOT NULL,
  motivo         TEXT NOT NULL,
  creado_en      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ajustes_prod ON ajustes_inventario(producto_id);
`;

// v3 — Imagen del producto (POS móvil visual: se vende tocando fotos).
// v4 — Icono del departamento (sus productos lo heredan por defecto).
// (Los ALTER TABLE de v3/v4 se movieron arriba, a migrar(), protegidos con
// try/catch — eran de una sola columna cada uno, no necesitaban un bloque
// de texto aparte.)

// v5 — Cuenta en la nube (opcional; la app funciona igual sin ella).
// Guardamos DOS tokens distintos, como manda el backend:
//   sesion_token     -> JWT del dueño (30 días), para llamadas de cuenta
//   dispositivo_token-> token de ESTA caja, para /sync
// Todo vive en `config`, no hace falta tabla nueva; esta migración solo
// documenta las claves y limpia restos de sesiones anteriores.
const ESQUEMA_V5 = `
DELETE FROM config WHERE clave IN (
  'sesion_token','dispositivo_token','dispositivo_id','negocio_id',
  'cuenta_email','cuenta_nombre','nombre_caja','prefijo_folio'
);
`;

// v6 — Usuarios POS (cajeros). Necesarios para que las ventas puedan
// sincronizarse (el espejo de la nube exige usuario_pos_id) y para el caso
// real de una tablet compartida por varios empleados.
//
// Roles (como el PC): dueno | gerente | cajero.
// El PIN se guarda hasheado — nunca en claro.
const ESQUEMA_V6 = `
CREATE TABLE IF NOT EXISTS usuarios_pos (
  id         TEXT PRIMARY KEY,
  nombre     TEXT NOT NULL,
  pin_hash   TEXT NOT NULL,
  rol        TEXT NOT NULL DEFAULT 'cajero',
  activo     INTEGER NOT NULL DEFAULT 1,
  eliminado  INTEGER NOT NULL DEFAULT 0,
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);
`;

// v7 — Sincronización bidireccional con la nube.
//
// cola_sync: lo que este dispositivo tiene pendiente de SUBIR. Una fila por
//   operación (venta, línea, pago, turno...). Se vacía al confirmar el lote.
//   Es local: nunca se sincroniza a sí misma.
//
// `origen` en productos/categorías/ventas: 'local' (creado aquí) o 'nube'
//   (bajado del negocio). Sirve para saber qué es propio y qué es espejo,
//   y para archivar lo local al adoptar el catálogo del negocio.
const ESQUEMA_V7 = `
CREATE TABLE IF NOT EXISTS cola_sync (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entidad      TEXT NOT NULL,
  entidad_id   TEXT NOT NULL,
  operacion    TEXT NOT NULL DEFAULT 'insert',
  payload      TEXT NOT NULL,
  intentos     INTEGER NOT NULL DEFAULT 0,
  ultimo_error TEXT,
  creado_en    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cola_entidad ON cola_sync(entidad, entidad_id);

-- Productos archivados al adoptar el catálogo del negocio (no se borran).
CREATE TABLE IF NOT EXISTS productos_archivados (
  id             TEXT PRIMARY KEY,
  datos_json     TEXT NOT NULL,
  archivado_en   TEXT NOT NULL,
  motivo         TEXT NOT NULL
);
`;

// v8 — Reparar datos anteriores a los usuarios.
//
// Los turnos y ventas creados ANTES de la migración v6 tienen usuario_pos_id
// en NULL. La nube exige esa columna NOT NULL, así que un solo NULL tumba el
// lote entero al sincronizar. Aquí les asignamos el primer usuario disponible
// (si no hay ninguno, la app lo crea al arrancar y `sync.ts` los repara).
const ESQUEMA_V8 = `
UPDATE caja_sesiones
   SET usuario_pos_id = (SELECT id FROM usuarios_pos WHERE eliminado = 0 LIMIT 1)
 WHERE usuario_pos_id IS NULL
   AND EXISTS (SELECT 1 FROM usuarios_pos WHERE eliminado = 0);

UPDATE ventas
   SET usuario_pos_id = (SELECT id FROM usuarios_pos WHERE eliminado = 0 LIMIT 1)
 WHERE usuario_pos_id IS NULL
   AND EXISTS (SELECT 1 FROM usuarios_pos WHERE eliminado = 0);
`;

// v9 — Diccionario del negocio: alias de nombres de ticket → producto.
// Memoria local del dispositivo (el tendero corrige una vez y la app recuerda).
// NO se encola a sync: cada caja aprende sus propios alias.
const ESQUEMA_V9 = `
CREATE TABLE IF NOT EXISTS alias_ticket (
  id             TEXT PRIMARY KEY,
  clave          TEXT NOT NULL UNIQUE,
  muestra        TEXT NOT NULL,
  producto_id    TEXT NOT NULL REFERENCES productos(id),
  veces          INTEGER NOT NULL DEFAULT 1,
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alias_producto ON alias_ticket(producto_id);
`;

// v10 — La memoria recuerda el PACK: el alias v9 solo guardaba producto_id,
// así que un "PWMOR 600ML NRP" corregido a pack de 6 volvía a salir como 1
// pieza al re-escanear. piezas_empaque = piezas por empaque recordadas
// (NULL = pieza suelta; también sirve para DESaprender un pack).
// (El ALTER TABLE se movió arriba, a migrar(), protegido con try/catch.)

// v11 — Perfil de producto por departamento (memoria del negocio para
// validación de costos en escaneos futuros). Cada producto confirmado
// se guarda con su departamento y costo; al re-escanear, se compara
// contra este perfil para detectar lecturas erróneas de la IA.
const ESQUEMA_V11 = `
CREATE TABLE IF NOT EXISTS perfil_producto (
  id             TEXT PRIMARY KEY,
  clave          TEXT NOT NULL UNIQUE,
  departamento_id TEXT REFERENCES categorias(id),
  costo_centavos INTEGER NOT NULL,
  piezas_empaque INTEGER,
  veces          INTEGER NOT NULL DEFAULT 1,
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_perfil_depto ON perfil_producto(departamento_id);
CREATE INDEX IF NOT EXISTS idx_perfil_clave ON perfil_producto(clave);
`;

// v12 — Ancla histórica de costo del escáner de tickets.
// Cada vez que un ticket confirma el costo de un producto (aplicado o
// conservado a propósito), se guarda aquí el costo vigente. El escáner lo
// usa como referencia local: si la próxima lectura cae fuera del rango
// histórico (±15% sobre min/max), se asume lectura dudosa y se conserva
// por defecto — sin alerta roja, el historial manda. Máx. 20 filas por
// producto (se podan las más viejas al insertar). Es memoria LOCAL de
// cada caja: no se encola a sync.
const ESQUEMA_V12 = `
CREATE TABLE IF NOT EXISTS historial_costos (
  id             TEXT PRIMARY KEY,
  producto_id    TEXT NOT NULL REFERENCES productos(id),
  costo_centavos INTEGER NOT NULL,
  confirmado_en  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hist_costos_prod ON historial_costos(producto_id);
`;

// v13 — Proveedores y compras (LOCAL-ONLY por ahora).
//
// proveedores: quién te surte (Coca, Bimbo, el de la verdura...). dias_visita
//   es un JSON array de números 0-6 (0 = domingo): la rutina de reparto, para
//   avisar en Inicio "mañana llega tu proveedor". NULL = sin rutina.
// compras: cada surtido registrado (por el escáner de tickets o a mano).
//   proveedor_id puede ser NULL si el ticket no traía proveedor identificable;
//   proveedor_nombre guarda el snapshot del nombre tal como vino, aunque el
//   proveedor se edite o borre después (historial fiel).
//
// SYNC: estas tablas NO se encolan a cola_sync en v1 — el backend todavía no
// las tiene. Cuando el PC las soporte, se enchufa el encolar() aquí.
const ESQUEMA_V13 = `
CREATE TABLE IF NOT EXISTS proveedores (
  id             TEXT PRIMARY KEY,
  nombre         TEXT NOT NULL,
  contacto       TEXT,
  telefono       TEXT,
  notas          TEXT,
  dias_visita    TEXT,
  eliminado      INTEGER NOT NULL DEFAULT 0,
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS compras (
  id               TEXT PRIMARY KEY,
  proveedor_id     TEXT REFERENCES proveedores(id),
  proveedor_nombre TEXT,
  folio            TEXT,
  fecha            TEXT,
  tipo             TEXT NOT NULL DEFAULT 'normal',
  total_centavos   INTEGER NOT NULL DEFAULT 0,
  num_lineas       INTEGER NOT NULL DEFAULT 0,
  origen           TEXT NOT NULL DEFAULT 'manual',
  notas            TEXT,
  eliminado        INTEGER NOT NULL DEFAULT 0,
  creado_en        TEXT NOT NULL,
  actualizado_en   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_compras_proveedor ON compras(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_compras_fecha ON compras(fecha);
`;

// v14 — PROGRAMA DE LEALTAD (clientes y puntos).
//
// clientes: tu clientela frecuente. `codigo` es corto y legible ("YV-8K3Q2Z"):
//   es lo que va en el QR que el cliente enseña y tú escaneas al cobrar.
//   `puntos` es el SALDO vivo (se actualiza en cada movimiento).
// puntos_movimientos: bitácora de puntos (compra, visita, canje, ajuste).
//   Positivo acumula, negativo canjea. venta_id enlaza al ticket que lo generó
//   (NULL en visitas y ajustes manuales).
// ventas.cliente_id: NULL = venta de mostrador sin cliente identificado
//   (lo de siempre). El ALTER va protegido arriba con try/catch.
//
// SYNC: clientes y puntos son LOCAL-ONLY en v1 (como proveedores/compras en
// v13): el backend todavía no tiene estas tablas y NO se encolan a cola_sync.
// La venta sí viaja con cliente_id (columna que el backend ya esperaba).
const ESQUEMA_V14 = `
CREATE TABLE IF NOT EXISTS clientes (
  id             TEXT PRIMARY KEY,
  codigo         TEXT NOT NULL UNIQUE,
  nombre         TEXT NOT NULL,
  telefono       TEXT,
  notas          TEXT,
  puntos         INTEGER NOT NULL DEFAULT 0,
  eliminado      INTEGER NOT NULL DEFAULT 0,
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON clientes(nombre);

CREATE TABLE IF NOT EXISTS puntos_movimientos (
  id          TEXT PRIMARY KEY,
  cliente_id  TEXT NOT NULL REFERENCES clientes(id),
  venta_id    TEXT,
  tipo        TEXT NOT NULL,
  puntos      INTEGER NOT NULL,
  nota        TEXT,
  creado_en   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_puntos_cliente ON puntos_movimientos(cliente_id);
`;

// v17 — Cotizaciones (LOCAL-ONLY por ahora, mismo punto de partida que
// tuvieron proveedores/compras en v13 y clientes/lealtad en v14).
//
// cotizaciones: carrito armado SIN cobrar, con validez opcional. Si el
//   cliente acepta, se convierte en una venta real (marcarConvertida enlaza
//   venta_id) — nunca se borra la cotización al convertirla, es su rastro.
// cotizacion_lineas: cada concepto, con su propio snapshot de descripción y
//   precio (el precio COTIZADO se respeta al convertir, aunque el catálogo
//   haya cambiado desde entonces — cotizar es prometer un precio).
//
// SYNC: NO se encola a cola_sync en v1 — mismo criterio que proveedores y
// lealtad antes de sincronizarse.
const ESQUEMA_V17 = `
CREATE TABLE IF NOT EXISTS cotizaciones (
  id                  TEXT PRIMARY KEY,
  folio               INTEGER NOT NULL,
  cliente_nombre      TEXT,
  cliente_telefono    TEXT,
  cliente_correo      TEXT,
  notas               TEXT,
  subtotal_centavos   INTEGER NOT NULL DEFAULT 0,
  descuento_centavos  INTEGER NOT NULL DEFAULT 0,
  total_centavos      INTEGER NOT NULL DEFAULT 0,
  valida_hasta        TEXT,
  estado              TEXT NOT NULL DEFAULT 'abierta',
  venta_id            TEXT,
  eliminado           INTEGER NOT NULL DEFAULT 0,
  creado_en           TEXT NOT NULL,
  actualizado_en      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_folio ON cotizaciones(folio);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_estado ON cotizaciones(estado);

CREATE TABLE IF NOT EXISTS cotizacion_lineas (
  id                        TEXT PRIMARY KEY,
  cotizacion_id             TEXT NOT NULL REFERENCES cotizaciones(id),
  producto_id               TEXT REFERENCES productos(id),
  descripcion               TEXT NOT NULL,
  cantidad                  REAL NOT NULL,
  precio_unitario_centavos  INTEGER NOT NULL,
  descuento_linea_centavos  INTEGER NOT NULL DEFAULT 0,
  total_linea_centavos      INTEGER NOT NULL DEFAULT 0,
  creado_en                 TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cotizacion_lineas_cot ON cotizacion_lineas(cotizacion_id);
`;

// v18 — Agenda financiera + el hueco de movimientos de caja.
//
// movimientos_caja: EL ARREGLO. Hasta ahora el corte hacía "fondo + ventas en
//   efectivo" y ya — no había forma de registrar que salió dinero del cajón.
//   Si el dueño le pagaba al proveedor con efectivo de la caja, el corte le
//   decía que faltaban $500 sin manera de explicarlo. El PC sí lo tenía; el
//   móvil se pone al parejo. El servidor YA conoce esta entidad (está en el
//   MAPA de sync.py), así que sincroniza sola.
//
// gastos / ingresos: DOS LIBROS separados (negocio y personal). La misma
//   categoría vive en los dos y está bien: la luz del local y la luz de la
//   casa son el mismo tipo de gasto en dos bolsillos distintos.
//
// EL PUENTE: un gasto de categoría "retiro" en el negocio genera su ingreso
//   espejo en el libro personal (ingreso_espejo_id / gasto_origen_id). Una
//   captura, las dos verdades correctas.
//
// gastos_fijos: plantillas mensuales, para avisar antes de que venzan y para
//   calcular cuánto cuesta el día/mes de arranque.
// presupuestos: el límite por categoría. Sin un límite puesto por el dueño,
//   cualquier aviso de "te estás pasando" sería una opinión, no un dato suyo.
//
// LOCAL-ONLY salvo movimientos_caja (que sí sincroniza, ver arriba).
const ESQUEMA_V18 = `
CREATE TABLE IF NOT EXISTS movimientos_caja (
  id             TEXT PRIMARY KEY,
  caja_sesion_id TEXT NOT NULL REFERENCES caja_sesiones(id),
  tipo           TEXT NOT NULL,
  motivo         TEXT,
  monto_centavos INTEGER NOT NULL,
  usuario_pos_id TEXT,
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mov_caja_sesion ON movimientos_caja(caja_sesion_id);

CREATE TABLE IF NOT EXISTS gastos_fijos (
  id             TEXT PRIMARY KEY,
  ambito         TEXT NOT NULL DEFAULT 'negocio',
  concepto       TEXT NOT NULL,
  categoria      TEXT NOT NULL,
  monto_centavos INTEGER NOT NULL,
  dia_mes        INTEGER NOT NULL,
  activo         INTEGER NOT NULL DEFAULT 1,
  notas          TEXT,
  eliminado      INTEGER NOT NULL DEFAULT 0,
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gastos (
  id                 TEXT PRIMARY KEY,
  ambito             TEXT NOT NULL DEFAULT 'negocio',
  concepto           TEXT NOT NULL,
  categoria          TEXT NOT NULL,
  monto_centavos     INTEGER NOT NULL,
  fecha              TEXT NOT NULL,
  metodo_pago        TEXT NOT NULL DEFAULT 'efectivo',
  gasto_fijo_id      TEXT,
  movimiento_caja_id TEXT,
  ingreso_espejo_id  TEXT,
  notas              TEXT,
  eliminado          INTEGER NOT NULL DEFAULT 0,
  creado_en          TEXT NOT NULL,
  actualizado_en     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gastos_fecha ON gastos(ambito, fecha);

CREATE TABLE IF NOT EXISTS ingresos (
  id              TEXT PRIMARY KEY,
  ambito          TEXT NOT NULL DEFAULT 'personal',
  concepto        TEXT NOT NULL,
  categoria       TEXT NOT NULL,
  monto_centavos  INTEGER NOT NULL,
  fecha           TEXT NOT NULL,
  gasto_origen_id TEXT,
  notas           TEXT,
  eliminado       INTEGER NOT NULL DEFAULT 0,
  creado_en       TEXT NOT NULL,
  actualizado_en  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ingresos_fecha ON ingresos(ambito, fecha);

CREATE TABLE IF NOT EXISTS presupuestos (
  id             TEXT PRIMARY KEY,
  ambito         TEXT NOT NULL,
  categoria      TEXT NOT NULL,
  monto_centavos INTEGER NOT NULL,
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL,
  UNIQUE (ambito, categoria)
);
`;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** UUID v4 (para IDs de filas, como el PC). */
export function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Fecha ISO actual en UTC (formato de creado_en, igual que el PC). */
export function ahoraISO(): string {
  return new Date().toISOString();
}

/** Borra TODOS los datos (para pruebas). No borra el esquema. */
export async function vaciarTodo(): Promise<void> {
  const db = await bd();
  await db.execAsync(`
    DELETE FROM ajustes_inventario;
    DELETE FROM kit_componentes;
    DELETE FROM pagos;
    DELETE FROM venta_lineas;
    DELETE FROM ventas;
    DELETE FROM caja_sesiones;
    DELETE FROM productos;
    DELETE FROM categorias;
  `);
}

// v19 — Etiquetado frontal NOM-051.
//
// Para negocios que FABRICAN su propio producto y necesitan saber qué sellos
// de advertencia le tocan antes de mandar a imprimir el empaque.
//
// Guarda TODO lo que necesita una etiqueta, no solo lo del cálculo: así la
// pantalla puede ser una calculadora rápida para quien solo quiere saber, y
// una herramienta completa para quien va a producir en serio.
//
// El CÁLCULO no vive aquí: está en src/base/sellos.ts, para que si cambia la
// norma —y ya cambió de fecha dos veces— se actualice en un solo lugar y los
// perfiles guardados se recalculen solos al abrirse.
//
// LOCAL-ONLY.
const ESQUEMA_V19 = `
CREATE TABLE IF NOT EXISTS perfiles_etiqueta (
  id                 TEXT PRIMARY KEY,
  nombre             TEXT NOT NULL,
  tipo               TEXT NOT NULL DEFAULT 'solido',

  calorias_kcal        REAL NOT NULL DEFAULT 0,
  azucares_g           REAL NOT NULL DEFAULT 0,
  grasas_saturadas_g   REAL NOT NULL DEFAULT 0,
  grasas_trans_g       REAL NOT NULL DEFAULT 0,
  sodio_mg             REAL NOT NULL DEFAULT 0,
  proteinas_g          REAL NOT NULL DEFAULT 0,
  carbohidratos_g      REAL NOT NULL DEFAULT 0,
  grasas_totales_g     REAL NOT NULL DEFAULT 0,
  fibra_g              REAL NOT NULL DEFAULT 0,

  anade_azucares       INTEGER NOT NULL DEFAULT 0,
  anade_grasas         INTEGER NOT NULL DEFAULT 0,
  anade_sodio          INTEGER NOT NULL DEFAULT 0,
  contiene_cafeina     INTEGER NOT NULL DEFAULT 0,
  contiene_edulcorantes INTEGER NOT NULL DEFAULT 0,

  exencion           TEXT NOT NULL DEFAULT 'ninguna',
  area_cm2           REAL NOT NULL DEFAULT 0,

  denominacion          TEXT,
  marca                 TEXT,
  ingredientes          TEXT,
  alergenos             TEXT,
  contenido_neto        TEXT,
  porcion               TEXT,
  porciones_envase      TEXT,
  responsable_nombre    TEXT,
  responsable_domicilio TEXT,
  lote                  TEXT,
  caducidad             TEXT,
  conservacion          TEXT,
  pais_origen           TEXT,
  notas                 TEXT,

  eliminado          INTEGER NOT NULL DEFAULT 0,
  creado_en          TEXT NOT NULL,
  actualizado_en     TEXT NOT NULL
);
`;

// v23 — Bolsa de sobrante/faltante del corte de turno.
//
// Una sola bolsa del negocio (no una por cajero): cada fila queda atribuida
// a qué usuario cerró ESE turno con esa diferencia, así el dueño puede
// filtrar/sumar por usuario y detectar si alguien acumula faltantes sin
// tener que abrir una tabla por persona.
//
// LOCAL-ONLY, mismo punto de partida que proveedores/compras (v13) y
// clientes/lealtad (v14): el backend todavía no la tiene. Las columnas
// nuevas de caja_sesiones (efectivo_contado_centavos, diferencia_centavos)
// se agregan por separado arriba, con try/catch, porque son ALTER TABLE
// sobre una tabla existente — no pueden ir en este bloque de solo CREATE.
const ESQUEMA_V23 = `
CREATE TABLE IF NOT EXISTS bolsa_movimientos (
  id                  TEXT PRIMARY KEY,
  caja_sesion_id      TEXT NOT NULL REFERENCES caja_sesiones(id),
  usuario_pos_id      TEXT REFERENCES usuarios_pos(id),
  diferencia_centavos INTEGER NOT NULL,
  creado_en           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bolsa_sesion ON bolsa_movimientos(caja_sesion_id);
CREATE INDEX IF NOT EXISTS idx_bolsa_usuario ON bolsa_movimientos(usuario_pos_id);
`;

// v26 — Despensa de ingredientes + Recetas (costeo de productos fabricados).
//
// Puerto de despensa.rs y recetas.rs del PC. Mismos nombres de columna,
// mismos tipos — con una diferencia deliberada: el PC guarda dispositivo_id
// en estas tablas (arrastra el patrón general de su esquema), pero el móvil
// NUNCA lo hace en tablas local-only (proveedores, clientes, cotizaciones,
// perfiles_etiqueta tampoco lo tienen) — se omite aquí por la misma razón:
// no hay noción de multi-dispositivo para datos que nunca salen de este
// teléfono. Ver la nota de sync en recetas.ts sobre qué implica esto.
//
// despensa_ingredientes: insumos que se COMPRAN a granel para fabricar
//   (harina, queso crema, cajas...). NUNCA son productos de venta — son
//   catálogos deliberadamente separados (ver despensa.rs). Nutrición
//   opcional, capturada a mano o rellenada por búsqueda en Open Food Facts.
//
// recetas: costeo de un producto fabricado a partir de ingredientes de la
//   despensa. `margen_deseado_pct` y `producto_id` (si ya se mandó al
//   catálogo) viven aquí; el costo NO se guarda como columna — se calcula
//   sumando receta_lineas.costo_congelado_centavos, igual que el PC.
//
// receta_lineas: cada ingrediente usado, con su costo CONGELADO al momento
//   de guardar (mismo principio que costo_unitario_centavos en
//   venta_lineas) — no se recalcula solo si el ingrediente cambia de precio
//   en la despensa. `orden` preserva el orden de captura al reemplazar
//   todas las líneas de una receta (mismo patrón que kit_componentes).
//
// LOCAL-ONLY (v1), mismo criterio que perfiles_etiqueta.
const ESQUEMA_V26 = `
CREATE TABLE IF NOT EXISTS despensa_ingredientes (
  id                        TEXT PRIMARY KEY,
  nombre                    TEXT NOT NULL,
  unidad                    TEXT NOT NULL,
  tamano_paquete            REAL NOT NULL,
  costo_paquete_centavos    INTEGER NOT NULL,
  calorias_kcal             REAL NOT NULL DEFAULT 0,
  azucares_g                REAL NOT NULL DEFAULT 0,
  grasas_saturadas_g        REAL NOT NULL DEFAULT 0,
  grasas_trans_g            REAL NOT NULL DEFAULT 0,
  sodio_mg                  REAL NOT NULL DEFAULT 0,
  proteinas_g               REAL NOT NULL DEFAULT 0,
  carbohidratos_g           REAL NOT NULL DEFAULT 0,
  grasas_totales_g          REAL NOT NULL DEFAULT 0,
  fibra_g                   REAL NOT NULL DEFAULT 0,
  notas                     TEXT,
  eliminado                 INTEGER NOT NULL DEFAULT 0,
  creado_en                 TEXT NOT NULL,
  actualizado_en            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_despensa_nombre ON despensa_ingredientes(nombre);

CREATE TABLE IF NOT EXISTS recetas (
  id                        TEXT PRIMARY KEY,
  nombre                    TEXT NOT NULL,
  rendimiento_cantidad      REAL NOT NULL,
  rendimiento_unidad        TEXT NOT NULL,
  margen_deseado_pct        REAL NOT NULL DEFAULT 50,
  producto_id               TEXT REFERENCES productos(id),
  notas                     TEXT,
  eliminado                 INTEGER NOT NULL DEFAULT 0,
  creado_en                 TEXT NOT NULL,
  actualizado_en            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recetas_actualizado ON recetas(actualizado_en);

CREATE TABLE IF NOT EXISTS receta_lineas (
  id                        TEXT PRIMARY KEY,
  receta_id                 TEXT NOT NULL REFERENCES recetas(id),
  ingrediente_id            TEXT NOT NULL REFERENCES despensa_ingredientes(id),
  nombre_congelado          TEXT NOT NULL,
  unidad                    TEXT NOT NULL,
  cantidad_usada            REAL NOT NULL,
  costo_congelado_centavos  INTEGER NOT NULL,
  orden                     INTEGER NOT NULL DEFAULT 0,
  creado_en                 TEXT NOT NULL,
  actualizado_en            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receta_lineas_receta ON receta_lineas(receta_id);
`;

// v28 — movimientos_cuenta: bitácora de cargos y abonos de crédito.
// Puerto de clientes.rs (movimientos_cuenta) del PC. `tipo` es 'cargo'
// (venta a crédito, sube el saldo) o 'abono' (pago, lo baja).
// `saldo_resultante_centavos` es una FOTO del saldo justo después de este
// movimiento — no se recalcula, se guarda tal como el PC lo hace, para que
// el estado de cuenta pueda mostrar la evolución sin tener que sumar toda
// la bitácora en cada consulta.
//
// LOCAL-ONLY: ver la nota completa arriba, en el bloque `if (actual < 28)`.
const ESQUEMA_V28 = `
CREATE TABLE IF NOT EXISTS movimientos_cuenta (
  id                          TEXT PRIMARY KEY,
  cliente_id                  TEXT NOT NULL REFERENCES clientes(id),
  tipo                        TEXT NOT NULL,
  monto_centavos              INTEGER NOT NULL,
  venta_id                    TEXT,
  metodo                      TEXT,
  saldo_resultante_centavos   INTEGER NOT NULL,
  motivo                      TEXT,
  usuario_pos_id              TEXT,
  caja_sesion_id              TEXT,
  creado_en                   TEXT NOT NULL,
  actualizado_en              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mov_cuenta_cliente ON movimientos_cuenta(cliente_id);
`;
