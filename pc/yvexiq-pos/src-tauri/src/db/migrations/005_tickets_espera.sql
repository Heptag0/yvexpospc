-- ============================================================================
-- YvexPOS — Migración 005: tickets en espera (ventas simultáneas)
--
-- Permite tener varias ventas abiertas a la vez ("tickets"), guardadas en la
-- base de datos para que SOBREVIVAN a cortes de luz o cierres de la app (como
-- hace Eleventa). Cada ticket es un carrito parcial que aún no se cobra.
--
-- El contenido del carrito se guarda como JSON en `contenido` porque es una
-- estructura variable (líneas con producto, cantidad, descuento) y transitoria;
-- no amerita una tabla de líneas normalizada. Al cobrar o descartar el ticket,
-- la fila se elimina.
--
-- `numero` es el número visible de la pestaña (1, 2, 3…), único por caja
-- abierta. `nombre` es opcional (renombrado por el cajero).
-- ============================================================================

CREATE TABLE tickets_espera (
    id              TEXT PRIMARY KEY,
    numero          INTEGER NOT NULL,
    nombre          TEXT,
    caja_sesion_id  TEXT NOT NULL,
    usuario_pos_id  TEXT NOT NULL,
    contenido       TEXT NOT NULL,          -- JSON: [{producto_id, cantidad, descuento_centavos}], + descuento_global
    creado_en       TEXT NOT NULL,
    actualizado_en  TEXT NOT NULL,
    dispositivo_id  TEXT NOT NULL,
    FOREIGN KEY (caja_sesion_id) REFERENCES caja_sesiones(id),
    FOREIGN KEY (usuario_pos_id) REFERENCES usuarios_pos(id),
    FOREIGN KEY (dispositivo_id) REFERENCES dispositivos(id)
);

CREATE INDEX idx_tickets_espera_caja ON tickets_espera(caja_sesion_id);
