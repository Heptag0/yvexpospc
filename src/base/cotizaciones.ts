// YvexPOS Móvil — Cotizaciones (lógica de base de datos, sin JSX).
//
// Carrito armado SIN cobrar: se comparte al cliente (texto por WhatsApp o
// lo que sea, mismo mecanismo que el recibo) y si acepta, se convierte en
// venta real. Puerto 1:1 de la lógica del PC (src-tauri/src/db/cotizaciones.rs).
//
// Útil sobre todo en giros donde "cuánto me costaría" es el primer paso
// natural (construcción, materiales, servicios), no solo abarrotes.
//
// LOCAL-ONLY por ahora — mismo punto de partida que tuvieron proveedores y
// lealtad antes de sincronizarse.
//
// Dinero SIEMPRE en centavos enteros. Soft delete vía `eliminado`.

import { bd, uuid, ahoraISO } from "./db";

export type LineaCotizacion = {
  id: string;
  producto_id: string | null;
  descripcion: string;
  cantidad: number;
  precio_unitario_centavos: number;
  descuento_linea_centavos: number;
  total_linea_centavos: number;
};

export type Cotizacion = {
  id: string;
  folio: number;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  cliente_correo: string | null;
  notas: string | null;
  subtotal_centavos: number;
  descuento_centavos: number;
  total_centavos: number;
  valida_hasta: string | null; // "AAAA-MM-DD"
  estado: "abierta" | "convertida" | "vencida" | "cancelada";
  venta_id: string | null;
  creado_en: string;
};

export type CotizacionConLineas = Cotizacion & { lineas: LineaCotizacion[] };

export type DatosLinea = {
  productoId?: string | null;
  descripcion: string;
  cantidad: number;
  precioUnitarioCentavos: number;
  descuentoLineaCentavos?: number;
};

export type DatosCotizacion = {
  clienteNombre?: string | null;
  clienteTelefono?: string | null;
  clienteCorreo?: string | null;
  notas?: string | null;
  validaHasta?: string | null;
  descuentoCentavos?: number;
  lineas: DatosLinea[];
};

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

async function siguienteFolio(): Promise<number> {
  const db = await bd();
  const r = await db.getFirstAsync<{ f: number }>(
    "SELECT COALESCE(MAX(folio), 0) + 1 AS f FROM cotizaciones"
  );
  return r?.f ?? 1;
}

function totales(lineas: DatosLinea[], descuentoCentavos: number): { subtotal: number; total: number } {
  const subtotal = lineas.reduce((s, l) => {
    const bruto = Math.round(l.precioUnitarioCentavos * l.cantidad);
    return s + Math.max(0, bruto - (l.descuentoLineaCentavos ?? 0));
  }, 0);
  const total = Math.max(0, subtotal - descuentoCentavos);
  return { subtotal: Math.max(0, subtotal), total };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function crearCotizacion(d: DatosCotizacion): Promise<CotizacionConLineas> {
  if (!d.lineas || d.lineas.length === 0) {
    throw new Error("La cotización necesita al menos un producto o concepto.");
  }
  const db = await bd();
  const descuento = Math.max(0, d.descuentoCentavos ?? 0);
  const { subtotal, total } = totales(d.lineas, descuento);
  const id = uuid();
  const ts = ahoraISO();
  const folio = await siguienteFolio();

  await db.runAsync(
    `INSERT INTO cotizaciones
       (id, folio, cliente_nombre, cliente_telefono, cliente_correo, notas,
        subtotal_centavos, descuento_centavos, total_centavos, valida_hasta,
        estado, venta_id, eliminado, creado_en, actualizado_en)
     VALUES (?,?,?,?,?,?,?,?,?,?,'abierta',NULL,0,?,?)`,
    [
      id, folio,
      d.clienteNombre?.trim() || null, d.clienteTelefono?.trim() || null, d.clienteCorreo?.trim() || null,
      d.notas?.trim() || null, subtotal, descuento, total, d.validaHasta || null, ts, ts,
    ]
  );

  for (const l of d.lineas) {
    const bruto = Math.round(l.precioUnitarioCentavos * l.cantidad);
    const descLinea = Math.max(0, l.descuentoLineaCentavos ?? 0);
    const totalLinea = Math.max(0, bruto - descLinea);
    await db.runAsync(
      `INSERT INTO cotizacion_lineas
         (id, cotizacion_id, producto_id, descripcion, cantidad,
          precio_unitario_centavos, descuento_linea_centavos, total_linea_centavos, creado_en)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [uuid(), id, l.productoId || null, l.descripcion.trim(), l.cantidad, l.precioUnitarioCentavos, descLinea, totalLinea, ts]
    );
  }

  const creada = await obtenerCotizacion(id);
  if (!creada) throw new Error("No se pudo leer la cotización recién creada.");
  return creada;
}

export async function listarCotizaciones(filtro?: string): Promise<Cotizacion[]> {
  const db = await bd();
  const q = (filtro ?? "").trim().toLowerCase();
  if (!q) {
    return db.getAllAsync<Cotizacion>(
      `SELECT id, folio, cliente_nombre, cliente_telefono, cliente_correo, notas,
              subtotal_centavos, descuento_centavos, total_centavos, valida_hasta,
              estado, venta_id, creado_en
         FROM cotizaciones WHERE eliminado = 0 ORDER BY creado_en DESC`
    );
  }
  const like = `%${q}%`;
  return db.getAllAsync<Cotizacion>(
    `SELECT id, folio, cliente_nombre, cliente_telefono, cliente_correo, notas,
            subtotal_centavos, descuento_centavos, total_centavos, valida_hasta,
            estado, venta_id, creado_en
       FROM cotizaciones
      WHERE eliminado = 0 AND (lower(COALESCE(cliente_nombre,'')) LIKE ? OR CAST(folio AS TEXT) LIKE ?)
      ORDER BY creado_en DESC`,
    [like, like]
  );
}

export async function obtenerCotizacion(id: string): Promise<CotizacionConLineas | null> {
  const db = await bd();
  const c = await db.getFirstAsync<Cotizacion>(
    `SELECT id, folio, cliente_nombre, cliente_telefono, cliente_correo, notas,
            subtotal_centavos, descuento_centavos, total_centavos, valida_hasta,
            estado, venta_id, creado_en
       FROM cotizaciones WHERE id = ? AND eliminado = 0`,
    [id]
  );
  if (!c) return null;
  const lineas = await db.getAllAsync<LineaCotizacion>(
    `SELECT id, producto_id, descripcion, cantidad, precio_unitario_centavos,
            descuento_linea_centavos, total_linea_centavos
       FROM cotizacion_lineas WHERE cotizacion_id = ? ORDER BY creado_en`,
    [id]
  );
  return { ...c, lineas };
}

export async function cancelarCotizacion(id: string): Promise<void> {
  const db = await bd();
  const r = await db.runAsync(
    "UPDATE cotizaciones SET estado = 'cancelada', actualizado_en = ? WHERE id = ? AND eliminado = 0 AND estado = 'abierta'",
    [ahoraISO(), id]
  );
  if (r.changes === 0) throw new Error("Solo se pueden cancelar cotizaciones abiertas.");
}

export async function eliminarCotizacion(id: string): Promise<void> {
  const db = await bd();
  await db.runAsync(
    "UPDATE cotizaciones SET eliminado = 1, actualizado_en = ? WHERE id = ?",
    [ahoraISO(), id]
  );
}

/** Marca como vencidas las abiertas cuya validez ya pasó. Barato: se llama
 *  cada vez que se abre la lista, sin necesidad de una tarea programada. */
export async function marcarVencidas(hoyYmd: string): Promise<void> {
  const db = await bd();
  await db.runAsync(
    `UPDATE cotizaciones SET estado = 'vencida', actualizado_en = ?
      WHERE estado = 'abierta' AND valida_hasta IS NOT NULL AND valida_hasta < ?`,
    [ahoraISO(), hoyYmd]
  );
}

/** Entrega la cotización lista para precargar el carrito de venta. NO cobra
 *  nada — la pantalla de venta cobra normal y, si tiene éxito, debe llamar
 *  a `marcarConvertida`. */
export async function prepararParaVenta(id: string): Promise<CotizacionConLineas> {
  const c = await obtenerCotizacion(id);
  if (!c) throw new Error("No se encontró la cotización.");
  if (c.estado !== "abierta") {
    const razon = c.estado === "convertida" ? "ya convertida"
      : c.estado === "vencida" ? "vencida"
      : c.estado === "cancelada" ? "cancelada" : "en un estado inesperado";
    throw new Error(`Esta cotización está ${razon} y no se puede convertir.`);
  }
  return c;
}

export async function marcarConvertida(id: string, ventaId: string): Promise<void> {
  const db = await bd();
  const r = await db.runAsync(
    "UPDATE cotizaciones SET estado = 'convertida', venta_id = ?, actualizado_en = ? WHERE id = ? AND estado = 'abierta'",
    [ventaId, ahoraISO(), id]
  );
  if (r.changes === 0) {
    throw new Error("La cotización ya no estaba abierta (¿se convirtió desde otro dispositivo?).");
  }
}

// ---------------------------------------------------------------------------
// Texto plano para compartir (mismo espíritu que textoRecibo en ticket.ts)
// ---------------------------------------------------------------------------

const ANCHO = 32;
function centro(t: string): string {
  const s = t.length > ANCHO ? t.slice(0, ANCHO) : t;
  return " ".repeat(Math.max(0, Math.floor((ANCHO - s.length) / 2))) + s;
}
function extremos(izq: string, der: string): string {
  const hueco = ANCHO - izq.length - der.length;
  if (hueco >= 1) return izq + " ".repeat(hueco) + der;
  const maxIzq = ANCHO - der.length - 1;
  return izq.slice(0, Math.max(1, maxIzq)) + " " + der;
}
function pesos(centavos: number): string {
  return `$${(centavos / 100).toFixed(2)}`;
}

/** Texto listo para `Share.share({ message })`. */
export function textoCotizacion(c: CotizacionConLineas, nombreNegocio: string): string {
  const r: string[] = [];
  r.push(centro(nombreNegocio.toUpperCase()));
  r.push(centro(`Cotización #${c.folio}`));
  if (c.valida_hasta) r.push(centro(`Válida hasta ${c.valida_hasta}`));
  r.push("=".repeat(ANCHO));
  for (const l of c.lineas) {
    const cant = l.cantidad % 1 === 0 ? String(l.cantidad) : l.cantidad.toFixed(3);
    r.push(extremos(`${cant} x ${l.descripcion}`, pesos(l.total_linea_centavos)));
  }
  r.push("-".repeat(ANCHO));
  r.push(extremos("SUBTOTAL", pesos(c.subtotal_centavos)));
  if (c.descuento_centavos > 0) r.push(extremos("DESCUENTO", `-${pesos(c.descuento_centavos)}`));
  r.push(extremos("TOTAL", pesos(c.total_centavos)));
  if (c.notas) {
    r.push("");
    r.push(c.notas);
  }
  r.push("=".repeat(ANCHO));
  r.push(centro("Hecho con YvexPOS"));
  return r.join("\n");
}
