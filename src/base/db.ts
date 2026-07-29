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

const VERSION_ESQUEMA = 16;
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

  if (actual < 1) await db.execAsync(ESQUEMA_V1);
  if (actual < 2) await db.execAsync(ESQUEMA_V2);
  if (actual < 3) await db.execAsync(ESQUEMA_V3);
  if (actual < 4) await db.execAsync(ESQUEMA_V4);
  if (actual < 5) await db.execAsync(ESQUEMA_V5);
  if (actual < 6) await db.execAsync(ESQUEMA_V6);
  if (actual < 7) await db.execAsync(ESQUEMA_V7);
  if (actual < 8) await db.execAsync(ESQUEMA_V8);
  if (actual < 9) await db.execAsync(ESQUEMA_V9);
  if (actual < 10) await db.execAsync(ESQUEMA_V10);
  if (actual < 11) await db.execAsync(ESQUEMA_V11);
  if (actual < 12) await db.execAsync(ESQUEMA_V12);
  if (actual < 13) await db.execAsync(ESQUEMA_V13);
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
  }
  if (actual < 15) {
    // Correo del cliente (opcional): servirá después para promociones.
    // Mismo patrón try/catch que la v14: si la columna ya existe, seguimos.
    try {
      await db.execAsync("ALTER TABLE clientes ADD COLUMN correo TEXT;");
    } catch {
      // La columna ya existía: no pasa nada, seguimos.
    }
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
  }

  if (actual < VERSION_ESQUEMA) {
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
ALTER TABLE productos ADD COLUMN es_kit INTEGER NOT NULL DEFAULT 0;

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
const ESQUEMA_V3 = `
ALTER TABLE productos ADD COLUMN imagen_uri TEXT;
`;

// v4 — Icono del departamento (sus productos lo heredan por defecto).
const ESQUEMA_V4 = `
ALTER TABLE categorias ADD COLUMN icono TEXT;
`;

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

ALTER TABLE ventas ADD COLUMN usuario_pos_id TEXT REFERENCES usuarios_pos(id);
ALTER TABLE caja_sesiones ADD COLUMN usuario_pos_id TEXT REFERENCES usuarios_pos(id);
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

ALTER TABLE productos  ADD COLUMN origen TEXT NOT NULL DEFAULT 'local';
ALTER TABLE categorias ADD COLUMN origen TEXT NOT NULL DEFAULT 'local';
ALTER TABLE ventas     ADD COLUMN origen TEXT NOT NULL DEFAULT 'local';

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
const ESQUEMA_V10 = `
ALTER TABLE alias_ticket ADD COLUMN piezas_empaque INTEGER;
`;

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
