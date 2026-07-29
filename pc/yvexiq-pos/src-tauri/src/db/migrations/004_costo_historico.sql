-- ============================================================================
-- YvexPOS — Migración 004: costo histórico en líneas de venta
--
-- Para que los reportes de ganancia/margen sean fieles a la realidad, cada
-- línea de venta guarda el costo del producto AL MOMENTO de la venta. Si el
-- costo cambia después, los reportes históricos siguen siendo correctos.
--
-- Las ventas previas a esta migración tendrán costo_unitario_centavos = 0
-- (no se puede reconstruir el costo histórico que no se guardó). El reporte
-- las trata como "sin costo registrado" para no inventar márgenes falsos.
-- ============================================================================

ALTER TABLE venta_lineas ADD COLUMN costo_unitario_centavos INTEGER NOT NULL DEFAULT 0;
