// YvexPOS Móvil — Programa de lealtad (lógica con base de datos, sin JSX).
//
// Clientes con código corto ("YV-XXXXXX", va en su QR), puntos por compra y
// por visita (máx. 1 al día), y canje como descuento al cobrar.
//
// Reglas de la casa:
//   - Dinero SIEMPRE en centavos enteros; puntos en enteros.
//   - Soft delete (`eliminado`), nunca borrado físico.
//   - SINCRONIZADO: los movimientos de puntos se encolan (bitácora de
//     solo-inserción). El SALDO (clientes.puntos) NUNCA se sube como
//     columna directa — lo recalcula el servidor sumando movimientos, para
//     que dos cajas puedan sumar/restar puntos al mismo cliente sin
//     pisarse (mismo principio que el stock). El saldo real llega de
//     vuelta en la próxima bajada de "clientes".
//   - NINGÚN canje/descuento se aplica solo: aquí solo se registran
//     movimientos YA confirmados por el usuario en pantalla.

import { bd, uuid, ahoraISO } from "./db";
import { leerConfig, guardarConfig } from "./config";
import { puntosPorCompra } from "./lealtadReglas";
import { encolar } from "./sync";

export type Cliente = {
  id: string;
  codigo: string;
  nombre: string;
  telefono: string | null;
  correo: string | null;
  notas: string | null;
  puntos: number;
  creado_en: string;
};

export type MovimientoPuntos = {
  id: string;
  cliente_id: string;
  venta_id: string | null;
  tipo: "compra" | "visita" | "canje" | "ajuste";
  puntos: number; // positivo acumula, negativo canjea
  nota: string | null;
  creado_en: string;
};

// ---------------------------------------------------------------------------
// Código del cliente ("YV-8K3Q2Z")
// ---------------------------------------------------------------------------

// Alfabeto SIN caracteres ambiguos (sin 0/O ni 1/I): que se lea y se dicte
// sin confusiones en el mostrador.
const ALFABETO = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Código corto único: "YV-" + 6 chars sin ambiguos. Reintenta si choca
 *  con uno existente (probabilidad bajísima, pero la UNIQUE manda). */
export async function generarCodigoCliente(): Promise<string> {
  const db = await bd();
  for (let intento = 0; intento < 20; intento++) {
    let cuerpo = "";
    for (let i = 0; i < 6; i++) {
      cuerpo += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
    }
    const codigo = `YV-${cuerpo}`;
    const choque = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM clientes WHERE codigo = ?",
      [codigo]
    );
    if (!choque) return codigo;
  }
  throw new Error("No se pudo generar un código único. Intenta de nuevo.");
}

/** Normaliza lo que llega del QR o del teclado: quita espacios/guiones extra,
 *  acepta con o sin prefijo "YV-" y en cualquier mayúscula/minúscula. */
function normalizarCodigoCliente(raw: string): string {
  let c = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (c.startsWith("YV-")) c = c.slice(3);
  else if (c.startsWith("YV")) c = c.slice(2);
  return `YV-${c}`;
}

// ---------------------------------------------------------------------------
// CRUD de clientes
// ---------------------------------------------------------------------------

/** Validación SUAVE del correo: "algo@algo.algo". Si no pasa, devuelve null
 *  (se guarda el cliente SIN correo, nunca se bloquea el alta; la UI avisa).
 *  El correo servirá después para promociones: por eso vale la pena cuidarlo,
 *  pero jamás a costa de perder al cliente en el mostrador. */
export function correoValido(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

function correoLimpio(raw?: string): string | null {
  const c = raw?.trim().toLowerCase() ?? "";
  if (!c) return null;
  return correoValido(c) ? c : null;
}

export async function crearCliente(
  nombre: string,
  telefono?: string,
  correo?: string
): Promise<Cliente> {
  const nombreLimpio = nombre.trim();
  if (!nombreLimpio) throw new Error("Escribe el nombre del cliente.");
  const db = await bd();
  const id = uuid();
  const codigo = await generarCodigoCliente();
  const ahora = ahoraISO();
  const correoOk = correoLimpio(correo);
  await db.runAsync(
    `INSERT INTO clientes
      (id, codigo, nombre, telefono, correo, notas, puntos, eliminado, creado_en, actualizado_en)
     VALUES (?,?,?,?,?,NULL,0,0,?,?)`,
    [id, codigo, nombreLimpio, telefono?.trim() || null, correoOk, ahora, ahora]
  );
  // Nota: "limite_credito_centavos" / "saldo_centavos" no van aquí porque el
  // móvil no maneja crédito — el servidor los rellena con su default (0) al
  // recibir un payload parcial. No hace falta mandarlos.
  await encolar("clientes", id, {
    id, nombre: nombreLimpio, telefono: telefono?.trim() || null,
    correo: correoOk, codigo, notas: null,
    creado_en: ahora, actualizado_en: ahora, eliminado: 0,
  });
  return { id, codigo, nombre: nombreLimpio, telefono: telefono?.trim() || null, correo: correoOk, notas: null, puntos: 0, creado_en: ahora };
}

export async function editarCliente(
  id: string,
  nombre: string,
  telefono?: string,
  notas?: string,
  correo?: string
): Promise<void> {
  const nombreLimpio = nombre.trim();
  if (!nombreLimpio) throw new Error("Escribe el nombre del cliente.");
  const db = await bd();
  const actualizado_en = ahoraISO();
  const correoOk = correoLimpio(correo);
  const notasOk = notas?.trim() || null;
  await db.runAsync(
    `UPDATE clientes SET nombre = ?, telefono = ?, correo = ?, notas = ?, actualizado_en = ?
     WHERE id = ?`,
    [nombreLimpio, telefono?.trim() || null, correoOk, notasOk, actualizado_en, id]
  );
  await encolar("clientes", id, {
    id, nombre: nombreLimpio, telefono: telefono?.trim() || null,
    correo: correoOk, notas: notasOk, actualizado_en,
  }, "update");
}

/** Borrado SUAVE: el cliente y su historial de puntos se conservan. */
export async function eliminarCliente(id: string): Promise<void> {
  const db = await bd();
  const actualizado_en = ahoraISO();
  await db.runAsync(
    "UPDATE clientes SET eliminado = 1, actualizado_en = ? WHERE id = ?",
    [actualizado_en, id]
  );
  await encolar("clientes", id, { id, eliminado: 1, actualizado_en }, "update");
}

/** Búsqueda por nombre, teléfono, correo o código (o lista completa si el
 *  texto va vacío). El correo servirá después para promociones. */
export async function buscarClientes(texto: string): Promise<Cliente[]> {
  const db = await bd();
  const q = texto.trim().toLowerCase();
  if (!q) {
    return db.getAllAsync<Cliente>(
      `SELECT id, codigo, nombre, telefono, correo, notas, puntos, creado_en
       FROM clientes WHERE eliminado = 0 ORDER BY nombre COLLATE NOCASE`
    );
  }
  const like = `%${q}%`;
  return db.getAllAsync<Cliente>(
    `SELECT id, codigo, nombre, telefono, correo, notas, puntos, creado_en
     FROM clientes
     WHERE eliminado = 0 AND (
       lower(nombre) LIKE ? OR lower(COALESCE(telefono,'')) LIKE ?
       OR lower(COALESCE(correo,'')) LIKE ? OR lower(codigo) LIKE ?
     )
     ORDER BY nombre COLLATE NOCASE`,
    [like, like, like, like]
  );
}

export async function clientePorId(id: string): Promise<Cliente | null> {
  const db = await bd();
  const c = await db.getFirstAsync<Cliente>(
    `SELECT id, codigo, nombre, telefono, correo, notas, puntos, creado_en
     FROM clientes WHERE id = ? AND eliminado = 0`,
    [id]
  );
  return c ?? null;
}

/** Busca por código de QR: acepta "YV-8K3Q2Z", "yv-8k3q2z" o "8K3Q2Z". */
export async function clientePorCodigo(codigo: string): Promise<Cliente | null> {
  const db = await bd();
  const c = await db.getFirstAsync<Cliente>(
    `SELECT id, codigo, nombre, telefono, correo, notas, puntos, creado_en
     FROM clientes WHERE codigo = ? AND eliminado = 0`,
    [normalizarCodigoCliente(codigo)]
  );
  return c ?? null;
}

// ---------------------------------------------------------------------------
// Movimientos de puntos
// ---------------------------------------------------------------------------

function inicioHoyISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export type ResultadoVisita = {
  otorgados: number;
  motivo?: string;
};

/** +puntos por visita, MÁXIMO una vez al día por cliente (día local del
 *  teléfono). Si ya se registró hoy, no duplica: avisa con cariño. */
export async function registrarVisita(clienteId: string): Promise<ResultadoVisita> {
  const db = await bd();
  const reglas = await leerReglas();
  if (!reglas.activa) return { otorgados: 0, motivo: "El programa de lealtad está apagado." };

  const ya = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM puntos_movimientos
     WHERE cliente_id = ? AND tipo = 'visita' AND creado_en >= ?
     LIMIT 1`,
    [clienteId, inicioHoyISO()]
  );
  if (ya) return { otorgados: 0, motivo: "ya registrada hoy" };

  const ahora = ahoraISO();
  const movId = uuid();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO puntos_movimientos (id, cliente_id, venta_id, tipo, puntos, nota, creado_en)
       VALUES (?,?,NULL,'visita',?,?,?)`,
      [movId, clienteId, reglas.puntosVisita, "Visita del día", ahora]
    );
    await db.runAsync(
      "UPDATE clientes SET puntos = puntos + ?, actualizado_en = ? WHERE id = ?",
      [reglas.puntosVisita, ahora, clienteId]
    );
  });
  await encolar("puntos_movimientos", movId, {
    id: movId, cliente_id: clienteId, venta_id: null, tipo: "visita",
    puntos: reglas.puntosVisita, nota: "Visita del día",
    creado_en: ahora, actualizado_en: ahora,
  });
  return { otorgados: reglas.puntosVisita };
}

export type ResultadoAcumulacion = {
  otorgados: number;
  saldo: number;
};

/** Puntos por compra (según las reglas vigentes). Se llama DESPUÉS de un
 *  cobro exitoso; si falla, el cobro ya quedó — la app lo atrapa en silencio. */
export async function acumularPorVenta(
  clienteId: string,
  ventaId: string,
  totalCentavos: number
): Promise<ResultadoAcumulacion> {
  const reglas = await leerReglas();
  if (!reglas.activa) {
    const c = await clientePorId(clienteId);
    return { otorgados: 0, saldo: c?.puntos ?? 0 };
  }
  const ganados = puntosPorCompra(totalCentavos, reglas.pesosPorPunto);
  const db = await bd();
  const ahora = ahoraISO();
  const movId = uuid();
  await db.withTransactionAsync(async () => {
    if (ganados > 0) {
      await db.runAsync(
        `INSERT INTO puntos_movimientos (id, cliente_id, venta_id, tipo, puntos, nota, creado_en)
         VALUES (?,?,?,'compra',?,?,?)`,
        [movId, clienteId, ventaId, ganados, "Puntos por tu compra", ahora]
      );
      await db.runAsync(
        "UPDATE clientes SET puntos = puntos + ?, actualizado_en = ? WHERE id = ?",
        [ganados, ahora, clienteId]
      );
    }
  });
  if (ganados > 0) {
    await encolar("puntos_movimientos", movId, {
      id: movId, cliente_id: clienteId, venta_id: ventaId, tipo: "compra",
      puntos: ganados, nota: "Puntos por tu compra",
      creado_en: ahora, actualizado_en: ahora,
    });
  }
  const c = await clientePorId(clienteId);
  return { otorgados: ganados, saldo: c?.puntos ?? 0 };
}

/** Canje YA CONFIRMADO por el usuario: movimiento negativo + saldo nuevo.
 *  Valida saldo suficiente; el descuento en dinero ya lo aplicó cobrar(). */
export async function canjearPuntos(
  clienteId: string,
  ventaId: string,
  puntosUsados: number,
  descuentoCentavos: number
): Promise<ResultadoAcumulacion> {
  if (puntosUsados <= 0) {
    const c = await clientePorId(clienteId);
    return { otorgados: 0, saldo: c?.puntos ?? 0 };
  }
  const db = await bd();
  const actual = await clientePorId(clienteId);
  if (!actual) throw new Error("No encontré a ese cliente.");
  if (actual.puntos < puntosUsados) {
    throw new Error(
      `A ${actual.nombre} le quedan ${actual.puntos} puntos; no alcanza para ${puntosUsados}.`
    );
  }
  const ahora = ahoraISO();
  const movId = uuid();
  const nota = `Canje: $${(descuentoCentavos / 100).toFixed(2)} de descuento`;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO puntos_movimientos (id, cliente_id, venta_id, tipo, puntos, nota, creado_en)
       VALUES (?,?,?,'canje',?,?,?)`,
      [movId, clienteId, ventaId, -puntosUsados, nota, ahora]
    );
    await db.runAsync(
      "UPDATE clientes SET puntos = puntos - ?, actualizado_en = ? WHERE id = ?",
      [puntosUsados, ahora, clienteId]
    );
  });
  await encolar("puntos_movimientos", movId, {
    id: movId, cliente_id: clienteId, venta_id: ventaId, tipo: "canje",
    puntos: -puntosUsados, nota, creado_en: ahora, actualizado_en: ahora,
  });
  const c = await clientePorId(clienteId);
  return { otorgados: -puntosUsados, saldo: c?.puntos ?? 0 };
}

/** Bitácora de puntos del cliente, lo más reciente primero. */
export async function historialPuntos(clienteId: string): Promise<MovimientoPuntos[]> {
  const db = await bd();
  return db.getAllAsync<MovimientoPuntos>(
    `SELECT id, cliente_id, venta_id, tipo, puntos, nota, creado_en
     FROM puntos_movimientos WHERE cliente_id = ?
     ORDER BY creado_en DESC LIMIT 100`,
    [clienteId]
  );
}

// ---------------------------------------------------------------------------
// Reglas del programa (tabla config, NO tabla propia)
// ---------------------------------------------------------------------------

export type ReglasLealtad = {
  activa: boolean;
  pesosPorPunto: number;
  puntosVisita: number;
  valorPuntoCentavos: number;
  topeDescuentoPct: number;
};

const REGLAS_DEFECTO: ReglasLealtad = {
  activa: true,
  pesosPorPunto: 10,
  puntosVisita: 5,
  valorPuntoCentavos: 100,
  topeDescuentoPct: 50,
};

export async function leerReglas(): Promise<ReglasLealtad> {
  const [activa, pesos, visita, valor, tope] = await Promise.all([
    leerConfig("lealtad_activa"),
    leerConfig("lealtad_pesos_por_punto"),
    leerConfig("lealtad_puntos_visita"),
    leerConfig("lealtad_valor_punto_centavos"),
    leerConfig("lealtad_tope_descuento_pct"),
  ]);
  return {
    activa: activa == null ? REGLAS_DEFECTO.activa : activa === "1",
    pesosPorPunto: numeroRegla(pesos, REGLAS_DEFECTO.pesosPorPunto),
    puntosVisita: numeroRegla(visita, REGLAS_DEFECTO.puntosVisita),
    valorPuntoCentavos: numeroRegla(valor, REGLAS_DEFECTO.valorPuntoCentavos),
    topeDescuentoPct: numeroRegla(tope, REGLAS_DEFECTO.topeDescuentoPct),
  };
}

function numeroRegla(valor: string | null, defecto: number): number {
  if (valor == null) return defecto;
  const n = parseFloat(valor);
  return Number.isFinite(n) && n >= 0 ? n : defecto;
}

export async function guardarReglas(r: ReglasLealtad): Promise<void> {
  const pares: [string, string][] = [
    ["lealtad_activa", r.activa ? "1" : "0"],
    ["lealtad_pesos_por_punto", String(r.pesosPorPunto)],
    ["lealtad_puntos_visita", String(r.puntosVisita)],
    ["lealtad_valor_punto_centavos", String(r.valorPuntoCentavos)],
    ["lealtad_tope_descuento_pct", String(r.topeDescuentoPct)],
  ];
  // Guardamos local con guardarConfig (como siempre) y ADEMÁS encolamos
  // aquí explícitamente — guardarConfig es genérico y lo usan también
  // preferencias que son de ESTE teléfono (usuario activo, sync_auto), así
  // que no se debe encolar ahí. Las reglas de lealtad sí son del negocio.
  for (const [clave, valor] of pares) {
    await guardarConfig(clave, valor);
    await encolar("config", clave, { clave, valor }, "update");
  }
}
