// YvexPOS Móvil — Crédito (cobranza).
//
// Puerto de la parte de crédito de clientes.rs del PC. El CRUD de clientes
// (crear/editar/eliminar/buscar) ya vive en lealtad.ts — aquí solo lo
// específico de crédito: cargos (venta a crédito), abonos (pago de deuda),
// estado de cuenta, y la verificación de límite que AVISA pero nunca
// bloquea (la decisión es del cajero/dueño, igual que el PC).
//
// clientes.limite_credito_centavos / saldo_centavos viven en lealtad.ts
// (tipo Cliente) — se agregaron ahí para no duplicar el tipo.
//
// ⚠️ movimientos_cuenta YA NO ES LOCAL-ONLY. El comentario anterior decía
// que el servidor la descartaba en silencio, y era cierto: el PC la encolaba
// y el MAPA no la tenía. Ahora la entidad existe en el servidor, y con ella
// un cambio de fondo en QUIÉN MANDA sobre el saldo:
//
//   El saldo del cliente lo calcula el SERVIDOR, no los dispositivos.
//   El trigger recalcular_saldo_cliente() lo reconstruye sumando toda la
//   bitácora de movimientos_cuenta, igual que ya se hacía con `puntos`.
//
// Por qué: cada caja hacía "leo saldo, sumo, escribo" y subía el resultado.
// Si el PC y este teléfono le fían al mismo cliente casi a la vez, el último
// en sincronizar pisaba al otro y UNA DE LAS DOS DEUDAS DESAPARECÍA. Nadie
// lo nota hasta que el cliente paga de menos.
//
// Consecuencia práctica para este archivo: encolar `clientes.saldo_centavos`
// ya no sirve de nada (el servidor lo ignora a propósito: saldo_centavos no
// está en las update_cols de esa entidad). Lo que SÍ hay que subir es el
// MOVIMIENTO. Si un cargo no sube, para la nube esa deuda no existe.

import { bd, uuid, ahoraISO } from "./db";
import { encolar } from "./sync";
import { pesos } from "./formato";
import { clientePorId, type Cliente } from "./lealtad";
import { usuarioActivoId } from "./usuarios";

export type TipoMovimientoCuenta = "cargo" | "abono";

export type MovimientoCuenta = {
  id: string;
  cliente_id: string;
  tipo: TipoMovimientoCuenta;
  monto_centavos: number;
  venta_id: string | null;
  metodo: string | null;
  saldo_resultante_centavos: number;
  motivo: string | null;
  creado_en: string;
};

const METODOS_ABONO = ["efectivo", "tarjeta", "transferencia"] as const;
export type MetodoAbono = (typeof METODOS_ABONO)[number];

/** Estado de cuenta: los movimientos del cliente, más reciente primero. */
export async function estadoCuenta(clienteId: string): Promise<MovimientoCuenta[]> {
  const db = await bd();
  return db.getAllAsync<MovimientoCuenta>(
    `SELECT id, cliente_id, tipo, monto_centavos, venta_id, metodo,
            saldo_resultante_centavos, motivo, creado_en
       FROM movimientos_cuenta WHERE cliente_id = ?
       ORDER BY creado_en DESC`,
    [clienteId]
  );
}

export type ResultadoLimite = {
  /** true si un cargo de este monto dejaría al cliente sobre su límite.
   *  NUNCA bloquea nada por sí solo — es información para que el cajero o
   *  el dueño decidan, igual que el PC. */
  excede: boolean;
  saldo: number;
  /** 0 significa "sin límite definido": excede siempre es false. */
  limite: number;
};

/** Verifica si un cargo adicional dejaría al cliente sobre su límite. */
export async function verificarLimite(
  clienteId: string,
  montoCargoCentavos: number
): Promise<ResultadoLimite> {
  const c = await clientePorId(clienteId);
  if (!c) throw new Error("No se encontró el cliente.");
  if (c.limite_credito_centavos === 0) {
    return { excede: false, saldo: c.saldo_centavos, limite: 0 };
  }
  const excede = c.saldo_centavos + montoCargoCentavos > c.limite_credito_centavos;
  return { excede, saldo: c.saldo_centavos, limite: c.limite_credito_centavos };
}

/** Registra un cargo (venta a crédito). DEBE llamarse desde DENTRO de una
 *  transacción ya abierta — la llama cobrar() en venta.ts, nunca se usa
 *  suelta. Sube el saldo del cliente y deja rastro en movimientos_cuenta,
 *  igual que registrar_cargo_en_tx del PC. */
export async function registrarCargoEnTx(
  clienteId: string,
  montoCentavos: number,
  ventaId: string,
  usuarioPosId: string,
  cajaSesionId: string
): Promise<number> {
  const db = await bd();
  const cli = await db.getFirstAsync<{ saldo_centavos: number }>(
    "SELECT saldo_centavos FROM clientes WHERE id = ? AND eliminado = 0",
    [clienteId]
  );
  if (!cli) throw new Error("El cliente no existe.");

  const nuevoSaldo = cli.saldo_centavos + montoCentavos;
  const ahora = ahoraISO();

  await db.runAsync(
    "UPDATE clientes SET saldo_centavos = ?, actualizado_en = ? WHERE id = ?",
    [nuevoSaldo, ahora, clienteId]
  );
  const movId = uuid();
  await db.runAsync(
    `INSERT INTO movimientos_cuenta
       (id, cliente_id, tipo, monto_centavos, venta_id, metodo, saldo_resultante_centavos,
        motivo, usuario_pos_id, caja_sesion_id, creado_en, actualizado_en)
     VALUES (?,?,'cargo',?,?,NULL,?,NULL,?,?,?,?)`,
    [movId, clienteId, montoCentavos, ventaId, nuevoSaldo, usuarioPosId, cajaSesionId, ahora, ahora]
  );

  // El MOVIMIENTO es lo que sube: de él deriva el servidor el saldo real.
  // Va dentro de esta misma transacción (la abrió cobrar()), así que el cargo
  // local y su entrada de sync nacen juntos o no nace ninguno.
  await encolar("movimientos_cuenta", movId, {
    id: movId, cliente_id: clienteId, tipo: "cargo",
    monto_centavos: montoCentavos, venta_id: ventaId, metodo: null,
    saldo_resultante_centavos: nuevoSaldo, motivo: null,
    usuario_pos_id: usuarioPosId, caja_sesion_id: cajaSesionId,
    creado_en: ahora, actualizado_en: ahora,
  }, "insert");

  return nuevoSaldo;
}

export type DatosAbono = {
  clienteId: string;
  montoCentavos: number;
  metodo: MetodoAbono;
  cajaSesionId?: string | null;
  motivo?: string | null;
};

/** Registra un abono (pago de deuda). A diferencia del cargo, abre su
 *  PROPIA transacción — un abono no nace dentro de una venta. Rechaza si
 *  el abono es mayor que la deuda (mismo criterio que registrar_abono del
 *  PC — no se permite dejar al cliente con saldo negativo). */
export async function registrarAbono(d: DatosAbono): Promise<number> {
  if (d.montoCentavos <= 0) throw new Error("El abono debe ser mayor a cero.");
  if (!METODOS_ABONO.includes(d.metodo)) {
    throw new Error(`Método de abono inválido: ${d.metodo}`);
  }

  const db = await bd();
  const usuario = await usuarioActivoId();
  const ahora = ahoraISO();
  const movId = uuid();
  let nuevoSaldo = 0;

  await db.withTransactionAsync(async () => {
    const cli = await db.getFirstAsync<{ saldo_centavos: number }>(
      "SELECT saldo_centavos FROM clientes WHERE id = ? AND eliminado = 0",
      [d.clienteId]
    );
    if (!cli) throw new Error("El cliente no existe.");
    if (d.montoCentavos > cli.saldo_centavos) {
      throw new Error(
        `El abono (${pesos(d.montoCentavos)}) es mayor que la deuda (${pesos(cli.saldo_centavos)}).`
      );
    }
    nuevoSaldo = cli.saldo_centavos - d.montoCentavos;

    await db.runAsync(
      "UPDATE clientes SET saldo_centavos = ?, actualizado_en = ? WHERE id = ?",
      [nuevoSaldo, ahora, d.clienteId]
    );
    await db.runAsync(
      `INSERT INTO movimientos_cuenta
         (id, cliente_id, tipo, monto_centavos, venta_id, metodo, saldo_resultante_centavos,
          motivo, usuario_pos_id, caja_sesion_id, creado_en, actualizado_en)
       VALUES (?,?,'abono',?,NULL,?,?,?,?,?,?,?)`,
      [
        movId, d.clienteId, d.montoCentavos, d.metodo, nuevoSaldo,
        d.motivo ?? null, usuario, d.cajaSesionId ?? null, ahora, ahora,
      ]
    );

    // DENTRO de la transacción, no después: antes el encolado quedaba fuera
    // del withTransactionAsync, así que un fallo entre ambos dejaba un abono
    // cobrado en el teléfono que la nube nunca veía — y con el trigger nuevo
    // eso significa una deuda que el servidor sigue creyendo viva.
    await encolar("movimientos_cuenta", movId, {
      id: movId, cliente_id: d.clienteId, tipo: "abono",
      monto_centavos: d.montoCentavos, venta_id: null, metodo: d.metodo,
      saldo_resultante_centavos: nuevoSaldo, motivo: d.motivo ?? null,
      usuario_pos_id: usuario, caja_sesion_id: d.cajaSesionId ?? null,
      creado_en: ahora, actualizado_en: ahora,
    }, "insert");
  });

  return nuevoSaldo;
}

/** Clientes con deuda viva (saldo > 0), los que más deben primero — mismo
 *  criterio que credito.js del PC (la tabla de deudores). */
export async function listarDeudores(): Promise<Cliente[]> {
  const db = await bd();
  return db.getAllAsync<Cliente>(
    `SELECT id, codigo, nombre, telefono, correo, notas, puntos,
            limite_credito_centavos, saldo_centavos, creado_en
       FROM clientes
      WHERE eliminado = 0 AND saldo_centavos > 0
      ORDER BY saldo_centavos DESC`
  );
}

/** Dinero total por cobrar de todo el negocio — el "héroe" de la pantalla
 *  de Crédito, igual que credito.js. */
export async function totalPorCobrar(): Promise<number> {
  const db = await bd();
  const f = await db.getFirstAsync<{ s: number }>(
    "SELECT COALESCE(SUM(saldo_centavos),0) AS s FROM clientes WHERE eliminado = 0 AND saldo_centavos > 0"
  );
  return f?.s ?? 0;
}
