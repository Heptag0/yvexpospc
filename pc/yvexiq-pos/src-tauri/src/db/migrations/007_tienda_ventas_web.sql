-- ============================================================================
-- YvexPOS — Migración 007: tienda en línea (ventas web)
--
-- Dos ajustes para registrar las ventas que llegan de la tienda en línea:
--
--   1. `ventas.origen` (TEXT, nullable): identifica de dónde salió la venta.
--      Las de caja quedan NULL; las web llevan "Pedido web {FOLIO8}".
--      La nube NO la recibe (el sync no la incluye en su payload).
--
--   2. `venta_lineas.producto_id` pasa a NULLABLE: un pedido web puede traer
--      una línea libre "Envío a domicilio" o un producto que ya se borró del
--      catálogo local; en ambos casos la línea conserva nombre y precio
--      históricos sin apuntar a `productos` (como hace el móvil).
--      SQLite no permite ALTER COLUMN, así que se recrea la tabla
--      (crear-copiar-borrar-renombrar, con FK apagadas por el cargador).
-- ============================================================================

ALTER TABLE ventas ADD COLUMN origen TEXT;

CREATE TABLE venta_lineas_nueva (
    id                       TEXT PRIMARY KEY,
    venta_id                 TEXT NOT NULL REFERENCES ventas(id),
    producto_id              TEXT REFERENCES productos(id),
    descripcion              TEXT NOT NULL,
    cantidad                 REAL NOT NULL,
    precio_unitario_centavos INTEGER NOT NULL,
    descuento_linea_centavos INTEGER NOT NULL DEFAULT 0,
    total_linea_centavos     INTEGER NOT NULL,
    creado_en                TEXT NOT NULL,
    actualizado_en           TEXT NOT NULL,
    costo_unitario_centavos  INTEGER NOT NULL DEFAULT 0
);

INSERT INTO venta_lineas_nueva
    (id, venta_id, producto_id, descripcion, cantidad, precio_unitario_centavos,
     descuento_linea_centavos, total_linea_centavos, creado_en, actualizado_en,
     costo_unitario_centavos)
SELECT
    id, venta_id, producto_id, descripcion, cantidad, precio_unitario_centavos,
    descuento_linea_centavos, total_linea_centavos, creado_en, actualizado_en,
    costo_unitario_centavos
FROM venta_lineas;

DROP TABLE venta_lineas;
ALTER TABLE venta_lineas_nueva RENAME TO venta_lineas;

CREATE INDEX idx_venta_lineas_venta    ON venta_lineas(venta_id);
CREATE INDEX idx_venta_lineas_producto ON venta_lineas(producto_id);
