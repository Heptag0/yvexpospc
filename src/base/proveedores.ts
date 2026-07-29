// YvexPOS Móvil — Proveedores y compras (lógica de base de datos, sin JSX).
//
// De quién surtes y cada surtido registrado: el escáner de tickets deja aquí
// su compra automáticamente (gancho en ModalEscanearTicket) y el dueño puede
// registrar compras a mano o marcar los días que pasa cada proveedor para
// que Inicio le avise ("mañana llega Coca").
//
// SYNC (v1): proveedores y compras son LOCAL-ONLY. NO se encolan a
// cola_sync — el backend todavía no tiene esas tablas; el PC las recibirá
// en una versión posterior y entonces se enchufa el encolar() aquí.
//
// Dinero SIEMPRE en centavos enteros. Bools INTEGER 0/1. IDs UUID v4.
// Soft delete vía `eliminado` (las compras conservan el snapshot del nombre).

import { bd, uuid, ahoraISO } from "./db";
import { RespuestaTicket } from "./escaner";
import { proximaFechaVisita, etiquetaAviso } from "./visitas";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type Proveedor = {
  id: string;
  nombre: string;
  contacto: string | null;
  telefono: string | null;
  notas: string | null;
  /** Días de visita (0 = domingo … 6 = sábado). null = sin rutina. */
  dias_visita: number[] | null;
  creado_en: string;
  actualizado_en: string;
};

/** Proveedor con su resumen de compras (para la lista del modal). */
export type ProveedorResumen = Proveedor & {
  totalCompras: number;
  ultimoTicketCentavos: number | null;
  ultimaFecha: string | null;
  ticketPromedioCentavos: number | null;
};

export type Compra = {
  id: string;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  folio: string | null;
  fecha: string | null;
  tipo: "normal" | "preventa";
  total_centavos: number;
  num_lineas: number;
  origen: "escaner" | "manual";
  notas: string | null;
  creado_en: string;
  actualizado_en: string;
};

/** Aviso de visita para la tarjeta de Inicio. */
export type AvisoVisita = {
  proveedor: Proveedor;
  fechaVisita: string;
  etiqueta: string; // "Hoy" | "Mañana" | "El {weekday}"
  ultimoTicketCentavos: number | null;
  ticketPromedioCentavos: number | null;
};

export type DatosProveedor = {
  nombre: string;
  contacto?: string | null;
  telefono?: string | null;
  notas?: string | null;
  diasVisita?: number[] | null;
};

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

/** Nombre normalizado para el MATCH (no se guarda): minúsculas, sin
 *  acentos, sin espacios dobles, trim. Así "Coca Cola", "Coca-Cola  " y
 *  "cocacola" pegan en el mismo proveedor, pero conservando el nombre
 *  bonito original en la fila. */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type FilaProveedor = Omit<Proveedor, "dias_visita"> & { dias_visita: string | null };

function filaAProveedor(f: FilaProveedor): Proveedor {
  let dias: number[] | null = null;
  if (f.dias_visita) {
    try {
      const arr = JSON.parse(f.dias_visita);
      if (Array.isArray(arr)) {
        const nums = arr.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
        dias = nums.length ? nums : null;
      }
    } catch {
      dias = null;
    }
  }
  return { ...f, dias_visita: dias };
}

function diasAJson(dias: number[] | null | undefined): string | null {
  if (!dias || !dias.length) return null;
  const limpios = [...new Set(dias.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  return limpios.length ? JSON.stringify(limpios) : null;
}

// ---------------------------------------------------------------------------
// CRUD de proveedores
// ---------------------------------------------------------------------------

export async function crearProveedor(datos: DatosProveedor): Promise<string> {
  const nombre = datos.nombre.trim();
  if (!nombre) throw new Error("El nombre del proveedor no puede estar vacío.");
  const db = await bd();
  const id = uuid();
  const ahora = ahoraISO();
  await db.runAsync(
    `INSERT INTO proveedores (id, nombre, contacto, telefono, notas, dias_visita, eliminado, creado_en, actualizado_en)
     VALUES (?,?,?,?,?,?,0,?,?)`,
    [
      id,
      nombre,
      datos.contacto?.trim() || null,
      datos.telefono?.trim() || null,
      datos.notas?.trim() || null,
      diasAJson(datos.diasVisita),
      ahora,
      ahora,
    ]
  );
  return id;
}

export async function editarProveedor(id: string, datos: DatosProveedor): Promise<void> {
  const nombre = datos.nombre.trim();
  if (!nombre) throw new Error("El nombre del proveedor no puede estar vacío.");
  const db = await bd();
  await db.runAsync(
    `UPDATE proveedores
        SET nombre = ?, contacto = ?, telefono = ?, notas = ?, dias_visita = ?, actualizado_en = ?
      WHERE id = ?`,
    [
      nombre,
      datos.contacto?.trim() || null,
      datos.telefono?.trim() || null,
      datos.notas?.trim() || null,
      diasAJson(datos.diasVisita),
      ahoraISO(),
      id,
    ]
  );
}

/** Soft delete: el historial de compras NO se borra (guarda el snapshot
 *  del nombre en proveedor_nombre). */
export async function eliminarProveedor(id: string): Promise<void> {
  const db = await bd();
  await db.runAsync(
    "UPDATE proveedores SET eliminado = 1, actualizado_en = ? WHERE id = ?",
    [ahoraISO(), id]
  );
}

/** Lista de proveedores activos, cada uno con su resumen de compras.
 *  Orden: por nombre (acentos fuera para ordenar parejo). */
export async function listarProveedores(): Promise<ProveedorResumen[]> {
  const db = await bd();
  const filas = await db.getAllAsync<
    FilaProveedor & {
      totalCompras: number;
      ultimoTicketCentavos: number | null;
      ultimaFecha: string | null;
      ticketPromedioCentavos: number | null;
    }
  >(
    `SELECT p.*,
            (SELECT COUNT(*) FROM compras c
              WHERE c.proveedor_id = p.id AND c.eliminado = 0) AS totalCompras,
            (SELECT c.total_centavos FROM compras c
              WHERE c.proveedor_id = p.id AND c.eliminado = 0
              ORDER BY COALESCE(c.fecha, c.creado_en) DESC LIMIT 1) AS ultimoTicketCentavos,
            (SELECT COALESCE(c.fecha, c.creado_en) FROM compras c
              WHERE c.proveedor_id = p.id AND c.eliminado = 0
              ORDER BY COALESCE(c.fecha, c.creado_en) DESC LIMIT 1) AS ultimaFecha,
            (SELECT CAST(AVG(c.total_centavos) AS INTEGER) FROM compras c
              WHERE c.proveedor_id = p.id AND c.eliminado = 0) AS ticketPromedioCentavos
       FROM proveedores p
      WHERE p.eliminado = 0
      ORDER BY p.nombre COLLATE NOCASE`
  );
  return filas.map((f) => ({ ...filaAProveedor(f), ...{
    totalCompras: f.totalCompras,
    ultimoTicketCentavos: f.ultimoTicketCentavos,
    ultimaFecha: f.ultimaFecha,
    ticketPromedioCentavos: f.ticketPromedioCentavos,
  } }));
}

export async function obtenerProveedor(id: string): Promise<ProveedorResumen | null> {
  const db = await bd();
  const f = await db.getFirstAsync<
    FilaProveedor & {
      totalCompras: number;
      ultimoTicketCentavos: number | null;
      ultimaFecha: string | null;
      ticketPromedioCentavos: number | null;
    }
  >(
    `SELECT p.*,
            (SELECT COUNT(*) FROM compras c
              WHERE c.proveedor_id = p.id AND c.eliminado = 0) AS totalCompras,
            (SELECT c.total_centavos FROM compras c
              WHERE c.proveedor_id = p.id AND c.eliminado = 0
              ORDER BY COALESCE(c.fecha, c.creado_en) DESC LIMIT 1) AS ultimoTicketCentavos,
            (SELECT COALESCE(c.fecha, c.creado_en) FROM compras c
              WHERE c.proveedor_id = p.id AND c.eliminado = 0
              ORDER BY COALESCE(c.fecha, c.creado_en) DESC LIMIT 1) AS ultimaFecha,
            (SELECT CAST(AVG(c.total_centavos) AS INTEGER) FROM compras c
              WHERE c.proveedor_id = p.id AND c.eliminado = 0) AS ticketPromedioCentavos
       FROM proveedores p
      WHERE p.id = ? AND p.eliminado = 0`,
    [id]
  );
  if (!f) return null;
  return {
    ...filaAProveedor(f),
    totalCompras: f.totalCompras,
    ultimoTicketCentavos: f.ultimoTicketCentavos,
    ultimaFecha: f.ultimaFecha,
    ticketPromedioCentavos: f.ticketPromedioCentavos,
  };
}

/** Busca un proveedor por nombre normalizado; si no existe, LO CREA con ese
 *  nombre (tal como vino, bonito) y devuelve el id. Pensada para el escáner:
 *  "Coca-Cola" del ticket pega con tu "Coca" solo si coincide normalizado;
 *  si no, nace un proveedor nuevo en vez de forzar un match dudoso. */
export async function buscarOCrearProveedorPorNombre(nombre: string): Promise<string> {
  const limpio = nombre.trim();
  if (!limpio) throw new Error("Nombre de proveedor vacío.");
  const clave = normalizarNombre(limpio);
  const db = await bd();
  const filas = await db.getAllAsync<{ id: string; nombre: string }>(
    "SELECT id, nombre FROM proveedores WHERE eliminado = 0"
  );
  const encontrado = filas.find((f) => normalizarNombre(f.nombre) === clave);
  if (encontrado) return encontrado.id;
  return crearProveedor({ nombre: limpio });
}

// ---------------------------------------------------------------------------
// Compras
// ---------------------------------------------------------------------------

export type DatosCompra = {
  proveedorNombre?: string | null;
  folio?: string | null;
  /** "AAAA-MM-DD" (fecha del ticket o elegida). null = sin fecha impresa. */
  fecha?: string | null;
  tipo?: "normal" | "preventa";
  totalCentavos: number;
  numLineas?: number;
  origen?: "escaner" | "manual";
  notas?: string | null;
};

/** Registra una compra. Si hay nombre de proveedor, lo busca o crea (match
 *  por nombre normalizado). Si no hay nombre, la compra queda con
 *  proveedor_id y proveedor_nombre en NULL: histórico general sin dueño
 *  (decisión documentada: mejor registrar el surtido que perderlo). */
export async function registrarCompra(datos: DatosCompra): Promise<string> {
  const db = await bd();
  let proveedorId: string | null = null;
  const proveedorNombre = datos.proveedorNombre?.trim() || null;
  if (proveedorNombre) {
    proveedorId = await buscarOCrearProveedorPorNombre(proveedorNombre);
  }
  const id = uuid();
  const ahora = ahoraISO();
  await db.runAsync(
    `INSERT INTO compras
       (id, proveedor_id, proveedor_nombre, folio, fecha, tipo, total_centavos,
        num_lineas, origen, notas, eliminado, creado_en, actualizado_en)
     VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?)`,
    [
      id,
      proveedorId,
      proveedorNombre,
      datos.folio?.trim() || null,
      datos.fecha || null,
      datos.tipo ?? "normal",
      Math.max(0, Math.round(datos.totalCentavos)),
      Math.max(0, Math.round(datos.numLineas ?? 0)),
      datos.origen ?? "manual",
      datos.notas?.trim() || null,
      ahora,
      ahora,
    ]
  );
  return id;
}

/**
 * Gancho del escáner de tickets: mapea la respuesta de la IA a una compra.
 * NUNCA lanza errores (el resurtido ya se aplicó; perder el registro de la
 * compra no debe estropearle la pantalla al dueño). Si el ticket no trajo
 * proveedor, registra la compra igual (histórico general, proveedor NULL).
 */
export async function registrarCompraDesdeTicket(respuesta: RespuestaTicket): Promise<string | null> {
  try {
    return await registrarCompra({
      proveedorNombre: respuesta.proveedor ?? null,
      folio: respuesta.folio ?? null,
      fecha: respuesta.fecha ?? null,
      tipo: respuesta.es_preventa ? "preventa" : "normal",
      totalCentavos: respuesta.total_ticket_centavos ?? 0,
      numLineas: respuesta.lineas?.length ?? 0,
      origen: "escaner",
    });
  } catch {
    return null;
  }
}

/** Historial de compras de un proveedor (o de todos si proveedorId es null),
 *  descendente por fecha (fecha impresa del ticket, o creación si no hay). */
export async function historialCompras(proveedorId?: string | null): Promise<Compra[]> {
  const db = await bd();
  const base = `SELECT id, proveedor_id, proveedor_nombre, folio, fecha, tipo,
                       total_centavos, num_lineas, origen, notas, creado_en, actualizado_en
                  FROM compras
                 WHERE eliminado = 0`;
  const orden = ` ORDER BY COALESCE(fecha, creado_en) DESC, creado_en DESC`;
  if (proveedorId) {
    return db.getAllAsync<Compra>(`${base} AND proveedor_id = ?${orden}`, [proveedorId]);
  }
  return db.getAllAsync<Compra>(`${base}${orden}`);
}

export async function eliminarCompra(id: string): Promise<void> {
  const db = await bd();
  await db.runAsync(
    "UPDATE compras SET eliminado = 1, actualizado_en = ? WHERE id = ?",
    [ahoraISO(), id]
  );
}

// ---------------------------------------------------------------------------
// Avisos de visita (tarjeta de Inicio)
// ---------------------------------------------------------------------------

/** Proveedores con rutina cuya próxima visita cae HOY o MAÑANA, con el
 *  contexto que ayuda a decidir el pedido (último ticket y promedio).
 *  Orden: primero los de hoy, luego los de mañana; dentro, por nombre. */
export async function avisosDeVisita(hoy: string): Promise<AvisoVisita[]> {
  const proveedores = await listarProveedores();
  const avisos: AvisoVisita[] = [];
  for (const p of proveedores) {
    if (!p.dias_visita || !p.dias_visita.length) continue;
    const prox = proximaFechaVisita(p.dias_visita, hoy);
    if (!prox) continue;
    const etiqueta = etiquetaAviso(prox, hoy);
    if (etiqueta !== "Hoy" && etiqueta !== "Mañana") continue;
    avisos.push({
      proveedor: p,
      fechaVisita: prox,
      etiqueta,
      ultimoTicketCentavos: p.ultimoTicketCentavos,
      ticketPromedioCentavos: p.ticketPromedioCentavos,
    });
  }
  avisos.sort((a, b) =>
    a.etiqueta === b.etiqueta
      ? a.proveedor.nombre.localeCompare(b.proveedor.nombre, "es")
      : a.etiqueta === "Hoy"
        ? -1
        : 1
  );
  return avisos;
}
