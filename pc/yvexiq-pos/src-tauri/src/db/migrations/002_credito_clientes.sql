-- ============================================================================
-- YvexPOS — Migración 002: Crédito y Clientes
--
-- Añade:
--   - tabla `clientes` (catálogo con saldo y límite)
--   - tabla `movimientos_cuenta` (rastro de cargos/abonos; suma = saldo)
--   - método 'credito' al CHECK de `pagos` (requiere recrear la tabla)
--
-- Mismas convenciones que 001: dinero en centavos, UUID v4, soft delete,
-- timestamps UTC, campos de sync.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- clientes: a quién se le fía. `saldo_centavos` = deuda actual (sube con
-- ventas a crédito, baja con abonos). `limite_credito_centavos` = 0 -> sin
-- límite definido (no bloquea, solo no avisa).
-- ----------------------------------------------------------------------------
CREATE TABLE clientes (
    id                      TEXT PRIMARY KEY,
    nombre                  TEXT NOT NULL,
    telefono                TEXT,
    notas                   TEXT,
    limite_credito_centavos INTEGER NOT NULL DEFAULT 0,
    saldo_centavos          INTEGER NOT NULL DEFAULT 0,
    creado_en               TEXT NOT NULL,
    actualizado_en          TEXT NOT NULL,
    eliminado               INTEGER NOT NULL DEFAULT 0,
    dispositivo_id          TEXT NOT NULL
);

CREATE INDEX idx_clientes_nombre   ON clientes(nombre);
CREATE INDEX idx_clientes_telefono ON clientes(telefono);

-- ----------------------------------------------------------------------------
-- movimientos_cuenta: rastro de cada cambio al saldo de un cliente.
--   - tipo 'cargo': una venta a crédito sube la deuda (lleva venta_id).
--   - tipo 'abono': un pago baja la deuda (lleva metodo: cómo pagó el abono).
-- `saldo_resultante_centavos` = saldo tras este movimiento (auditable).
-- La suma de (cargos - abonos) debe reconstruir clientes.saldo_centavos.
-- ----------------------------------------------------------------------------
CREATE TABLE movimientos_cuenta (
    id                        TEXT PRIMARY KEY,
    cliente_id                TEXT NOT NULL REFERENCES clientes(id),
    tipo                      TEXT NOT NULL CHECK (tipo IN ('cargo', 'abono')),
    monto_centavos            INTEGER NOT NULL,
    -- Para 'cargo' originado en una venta. Para 'abono' queda NULL.
    venta_id                  TEXT REFERENCES ventas(id),
    -- Para 'abono': cómo pagó (efectivo|tarjeta|transferencia). Para 'cargo' NULL.
    metodo                    TEXT CHECK (metodo IN ('efectivo', 'tarjeta', 'transferencia')),
    saldo_resultante_centavos INTEGER NOT NULL,
    motivo                    TEXT,
    usuario_pos_id            TEXT NOT NULL REFERENCES usuarios_pos(id),
    caja_sesion_id            TEXT REFERENCES caja_sesiones(id),
    creado_en                 TEXT NOT NULL,
    actualizado_en            TEXT NOT NULL,
    sincronizado              INTEGER NOT NULL DEFAULT 0,
    dispositivo_id            TEXT NOT NULL
);

CREATE INDEX idx_mov_cuenta_cliente ON movimientos_cuenta(cliente_id);
CREATE INDEX idx_mov_cuenta_venta   ON movimientos_cuenta(venta_id);

-- ----------------------------------------------------------------------------
-- ventas: añadir cliente_id opcional (quién, si fue a crédito o nominal).
-- SQLite sí permite ADD COLUMN. NULL = venta normal sin cliente.
-- ----------------------------------------------------------------------------
ALTER TABLE ventas ADD COLUMN cliente_id TEXT REFERENCES clientes(id);
CREATE INDEX idx_ventas_cliente ON ventas(cliente_id);

-- ----------------------------------------------------------------------------
-- pagos: añadir 'credito' al CHECK del método.
-- SQLite NO permite modificar un CHECK con ALTER; hay que recrear la tabla
-- con el patrón seguro: crear nueva -> copiar datos -> borrar vieja -> renombrar.
-- ----------------------------------------------------------------------------
CREATE TABLE pagos_nueva (
    id                 TEXT PRIMARY KEY,
    venta_id           TEXT NOT NULL REFERENCES ventas(id),
    metodo             TEXT NOT NULL CHECK (metodo IN ('efectivo', 'tarjeta',
                                                       'transferencia', 'vale', 'credito')),
    monto_centavos     INTEGER NOT NULL,
    recibido_centavos  INTEGER,
    cambio_centavos    INTEGER,
    creado_en          TEXT NOT NULL,
    actualizado_en     TEXT NOT NULL
);

INSERT INTO pagos_nueva
    (id, venta_id, metodo, monto_centavos, recibido_centavos, cambio_centavos, creado_en, actualizado_en)
SELECT id, venta_id, metodo, monto_centavos, recibido_centavos, cambio_centavos, creado_en, actualizado_en
FROM pagos;

DROP TABLE pagos;
ALTER TABLE pagos_nueva RENAME TO pagos;

-- Recrear el índice que vivía en la tabla original.
CREATE INDEX idx_pagos_venta ON pagos(venta_id);
