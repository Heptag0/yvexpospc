-- ============================================================================
-- YvexPOS — Migración 003: método de reembolso en devoluciones
--
-- El corte necesita saber cuánto de las devoluciones fue en efectivo (baja el
-- cajón) vs. tarjeta/transferencia/crédito (no tocan el cajón). Añadimos la
-- columna para poder separarlo en el corte como "Devoluciones de producto".
-- ============================================================================

ALTER TABLE devoluciones ADD COLUMN metodo_reembolso TEXT;
