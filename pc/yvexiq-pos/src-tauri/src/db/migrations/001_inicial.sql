-- ============================================================================
-- YvexIQ POS — Migración 001: esquema inicial
-- Fuente de verdad: references/esquema-bd.md
--
-- Convenciones (NO romper, el sync depende de esto):
--   - Dinero en INTEGER de centavos. Nunca float.
--   - Bool como INTEGER 0/1 en SQLite.
--   - Timestamps como TEXT ISO-8601 UTC.
--   - IDs sincronizables = UUID v4 (TEXT), generados en Rust.
--   - Soft delete vía columna `eliminado` en tablas de operación.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- dispositivos: cada instalación física del POS (cada caja).
-- ----------------------------------------------------------------------------
CREATE TABLE dispositivos (
    id            TEXT PRIMARY KEY,
    nombre        TEXT NOT NULL,
    negocio_id    TEXT,
    creado_en     TEXT NOT NULL,
    actualizado_en TEXT NOT NULL
);

-- ----------------------------------------------------------------------------
-- usuarios_pos: operadores de caja (login por PIN).
-- ----------------------------------------------------------------------------
CREATE TABLE usuarios_pos (
    id            TEXT PRIMARY KEY,
    nombre        TEXT NOT NULL,
    pin_hash      TEXT NOT NULL,
    rol           TEXT NOT NULL CHECK (rol IN ('dueno', 'gerente', 'cajero')),
    activo        INTEGER NOT NULL DEFAULT 1,
    creado_en     TEXT NOT NULL,
    actualizado_en TEXT NOT NULL,
    eliminado     INTEGER NOT NULL DEFAULT 0,
    dispositivo_id TEXT NOT NULL
);

-- ----------------------------------------------------------------------------
-- categorias: agrupación de productos (cuadrícula de venta).
-- ----------------------------------------------------------------------------
CREATE TABLE categorias (
    id            TEXT PRIMARY KEY,
    nombre        TEXT NOT NULL,
    color         TEXT,
    orden         INTEGER NOT NULL DEFAULT 0,
    creado_en     TEXT NOT NULL,
    actualizado_en TEXT NOT NULL,
    eliminado     INTEGER NOT NULL DEFAULT 0,
    dispositivo_id TEXT NOT NULL
);

-- ----------------------------------------------------------------------------
-- productos: catálogo. Stock en REAL por venta a granel (kg).
-- ----------------------------------------------------------------------------
CREATE TABLE productos (
    id                      TEXT PRIMARY KEY,
    codigo_barras           TEXT,
    nombre                  TEXT NOT NULL,
    categoria_id            TEXT REFERENCES categorias(id),
    precio_venta_centavos   INTEGER NOT NULL DEFAULT 0,
    costo_centavos          INTEGER NOT NULL DEFAULT 0,
    precio_mayoreo_centavos INTEGER,
    cantidad_mayoreo        INTEGER,
    iva_tasa                INTEGER NOT NULL DEFAULT 0 CHECK (iva_tasa IN (0, 16)),
    controla_stock          INTEGER NOT NULL DEFAULT 1,
    stock                   REAL NOT NULL DEFAULT 0,
    unidad                  TEXT NOT NULL DEFAULT 'pieza'
                                CHECK (unidad IN ('pieza', 'kg', 'litro')),
    stock_minimo            REAL NOT NULL DEFAULT 0,
    imagen_ruta             TEXT,
    favorito                INTEGER NOT NULL DEFAULT 0,
    creado_en               TEXT NOT NULL,
    actualizado_en          TEXT NOT NULL,
    eliminado               INTEGER NOT NULL DEFAULT 0,
    dispositivo_id          TEXT NOT NULL
);

CREATE INDEX idx_productos_codigo_barras ON productos(codigo_barras);
CREATE INDEX idx_productos_nombre        ON productos(nombre);
CREATE INDEX idx_productos_categoria     ON productos(categoria_id);

-- ----------------------------------------------------------------------------
-- caja_sesiones: turno de caja (apertura -> cierre / corte Z).
-- Se define ANTES de `ventas` porque ventas referencia caja_sesion_id.
-- ----------------------------------------------------------------------------
CREATE TABLE caja_sesiones (
    id                              TEXT PRIMARY KEY,
    dispositivo_id                  TEXT NOT NULL,
    usuario_pos_id                  TEXT NOT NULL REFERENCES usuarios_pos(id),
    fondo_inicial_centavos          INTEGER NOT NULL DEFAULT 0,
    abierta_en                      TEXT NOT NULL,
    cerrada_en                      TEXT,
    total_efectivo_esperado_centavos INTEGER,
    total_efectivo_contado_centavos  INTEGER,
    diferencia_centavos             INTEGER,
    estado                          TEXT NOT NULL DEFAULT 'abierta'
                                        CHECK (estado IN ('abierta', 'cerrada')),
    actualizado_en                  TEXT NOT NULL,
    sincronizado                    INTEGER NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------------------------
-- ventas: cabecera del ticket.
-- `folio` es consecutivo POR dispositivo; la unicidad global la da `id`.
-- ----------------------------------------------------------------------------
CREATE TABLE ventas (
    id                  TEXT PRIMARY KEY,
    folio               INTEGER NOT NULL,
    dispositivo_id      TEXT NOT NULL,
    usuario_pos_id      TEXT NOT NULL REFERENCES usuarios_pos(id),
    caja_sesion_id      TEXT NOT NULL REFERENCES caja_sesiones(id),
    subtotal_centavos   INTEGER NOT NULL DEFAULT 0,
    descuento_centavos  INTEGER NOT NULL DEFAULT 0,
    iva_centavos        INTEGER NOT NULL DEFAULT 0,
    total_centavos      INTEGER NOT NULL DEFAULT 0,
    estado              TEXT NOT NULL DEFAULT 'completada'
                            CHECK (estado IN ('completada', 'cancelada',
                                              'devuelta_parcial', 'devuelta_total')),
    creado_en           TEXT NOT NULL,
    actualizado_en      TEXT NOT NULL,
    sincronizado        INTEGER NOT NULL DEFAULT 0
);

-- folio único por dispositivo (no global): evita colisión "Venta #143" entre cajas.
CREATE UNIQUE INDEX idx_ventas_folio_dispositivo ON ventas(dispositivo_id, folio);
CREATE INDEX idx_ventas_caja_sesion ON ventas(caja_sesion_id);
CREATE INDEX idx_ventas_creado_en   ON ventas(creado_en);

-- ----------------------------------------------------------------------------
-- venta_lineas: renglones del ticket. `descripcion` es copia histórica.
-- ----------------------------------------------------------------------------
CREATE TABLE venta_lineas (
    id                       TEXT PRIMARY KEY,
    venta_id                 TEXT NOT NULL REFERENCES ventas(id),
    producto_id              TEXT NOT NULL REFERENCES productos(id),
    descripcion              TEXT NOT NULL,
    cantidad                 REAL NOT NULL,
    precio_unitario_centavos INTEGER NOT NULL,
    descuento_linea_centavos INTEGER NOT NULL DEFAULT 0,
    total_linea_centavos     INTEGER NOT NULL,
    creado_en                TEXT NOT NULL,
    actualizado_en           TEXT NOT NULL
);

CREATE INDEX idx_venta_lineas_venta    ON venta_lineas(venta_id);
CREATE INDEX idx_venta_lineas_producto ON venta_lineas(producto_id);

-- ----------------------------------------------------------------------------
-- pagos: una venta puede tener varios (efectivo + tarjeta).
-- ----------------------------------------------------------------------------
CREATE TABLE pagos (
    id                 TEXT PRIMARY KEY,
    venta_id           TEXT NOT NULL REFERENCES ventas(id),
    metodo             TEXT NOT NULL CHECK (metodo IN ('efectivo', 'tarjeta',
                                                       'transferencia', 'vale')),
    monto_centavos     INTEGER NOT NULL,
    recibido_centavos  INTEGER,
    cambio_centavos    INTEGER,
    creado_en          TEXT NOT NULL,
    actualizado_en     TEXT NOT NULL
);

CREATE INDEX idx_pagos_venta ON pagos(venta_id);

-- ----------------------------------------------------------------------------
-- movimientos_caja: entradas/salidas de efectivo que no son ventas.
-- ----------------------------------------------------------------------------
CREATE TABLE movimientos_caja (
    id              TEXT PRIMARY KEY,
    caja_sesion_id  TEXT NOT NULL REFERENCES caja_sesiones(id),
    tipo            TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida')),
    motivo          TEXT,
    monto_centavos  INTEGER NOT NULL,
    usuario_pos_id  TEXT NOT NULL REFERENCES usuarios_pos(id),
    creado_en       TEXT NOT NULL,
    actualizado_en  TEXT NOT NULL
);

CREATE INDEX idx_movimientos_caja_sesion ON movimientos_caja(caja_sesion_id);

-- ----------------------------------------------------------------------------
-- devoluciones: cabecera de una devolución contra una venta original.
-- ----------------------------------------------------------------------------
CREATE TABLE devoluciones (
    id                      TEXT PRIMARY KEY,
    venta_id                TEXT NOT NULL REFERENCES ventas(id),
    caja_sesion_id          TEXT NOT NULL REFERENCES caja_sesiones(id),
    usuario_pos_id          TEXT NOT NULL REFERENCES usuarios_pos(id),
    motivo                  TEXT,
    total_devuelto_centavos INTEGER NOT NULL,
    creado_en               TEXT NOT NULL,
    actualizado_en          TEXT NOT NULL,
    sincronizado            INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_devoluciones_venta ON devoluciones(venta_id);

-- ----------------------------------------------------------------------------
-- devolucion_lineas: renglones devueltos (puede ser parcial).
-- ----------------------------------------------------------------------------
CREATE TABLE devolucion_lineas (
    id              TEXT PRIMARY KEY,
    devolucion_id   TEXT NOT NULL REFERENCES devoluciones(id),
    venta_linea_id  TEXT NOT NULL REFERENCES venta_lineas(id),
    cantidad        REAL NOT NULL,
    monto_centavos  INTEGER NOT NULL,
    reingresa_stock INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_devolucion_lineas_dev ON devolucion_lineas(devolucion_id);

-- ----------------------------------------------------------------------------
-- ajustes_inventario: toda mutación de stock que no sea venta/devolución.
-- ----------------------------------------------------------------------------
CREATE TABLE ajustes_inventario (
    id                TEXT PRIMARY KEY,
    producto_id       TEXT NOT NULL REFERENCES productos(id),
    tipo              TEXT NOT NULL CHECK (tipo IN ('entrada', 'merma', 'ajuste_conteo')),
    cantidad          REAL NOT NULL,
    stock_resultante  REAL NOT NULL,
    motivo            TEXT,
    usuario_pos_id    TEXT NOT NULL REFERENCES usuarios_pos(id),
    creado_en         TEXT NOT NULL,
    actualizado_en    TEXT NOT NULL,
    sincronizado      INTEGER NOT NULL DEFAULT 0,
    dispositivo_id    TEXT NOT NULL
);

CREATE INDEX idx_ajustes_producto ON ajustes_inventario(producto_id);

-- ----------------------------------------------------------------------------
-- cola_sync: cola local de operaciones pendientes hacia el VPS.
-- AUTOINCREMENT local; esta tabla NO se sincroniza.
-- ----------------------------------------------------------------------------
CREATE TABLE cola_sync (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    entidad      TEXT NOT NULL,
    entidad_id   TEXT NOT NULL,
    operacion    TEXT NOT NULL CHECK (operacion IN ('insert', 'update')),
    payload      TEXT NOT NULL,
    intentos     INTEGER NOT NULL DEFAULT 0,
    ultimo_error TEXT,
    creado_en    TEXT NOT NULL
);

CREATE INDEX idx_cola_sync_entidad ON cola_sync(entidad, entidad_id);

-- ----------------------------------------------------------------------------
-- config: clave-valor para personalización (tema, negocio, impresora, fiscal).
-- ----------------------------------------------------------------------------
CREATE TABLE config (
    clave TEXT PRIMARY KEY,
    valor TEXT
);
