-- ============================================================================
-- YvexPOS — Migración 006: kits (productos compuestos / paquetes)
--
-- Un "kit" es un producto que se vende como uno solo pero que, al venderse,
-- descuenta del inventario a sus PRODUCTOS COMPONENTES (no a sí mismo).
-- Ejemplos: "8 Pacífico Light" (8 botes), "2 Sabritas surtidas" (1 sal + 1 limón).
--
-- Diseño:
--   * En `productos` se marca con `es_kit = 1`. El kit SÍ usa su
--     `precio_venta_centavos` (precio fijo del paquete) y `costo_centavos`
--     (por defecto = suma de costos de componentes, ajustable). El kit NO usa
--     su propio `stock`: su disponibilidad se deriva de los componentes.
--   * `kit_componentes` guarda de qué se compone cada kit.
--
-- La columna `producto_componente_id` referencia a `productos(id)`, así que
-- técnicamente un componente podría ser otro kit (kits anidados). Por ahora la
-- interfaz solo dejará elegir productos normales como componentes; la estructura
-- queda lista por si en el futuro se habilitan kits dentro de kits (requerirá
-- detección de ciclos antes de activarlo).
-- ============================================================================

ALTER TABLE productos ADD COLUMN es_kit INTEGER NOT NULL DEFAULT 0;

CREATE TABLE kit_componentes (
    id                      TEXT PRIMARY KEY,
    kit_id                  TEXT NOT NULL REFERENCES productos(id),
    producto_componente_id  TEXT NOT NULL REFERENCES productos(id),
    cantidad                REAL NOT NULL DEFAULT 1,
    creado_en               TEXT NOT NULL,
    actualizado_en          TEXT NOT NULL,
    dispositivo_id          TEXT NOT NULL
);

CREATE INDEX idx_kit_componentes_kit ON kit_componentes(kit_id);
