// YvexPOS Móvil — Motor de sincronización bidireccional.
//
// MODELO MENTAL
// -------------
// La nube es el punto de encuentro. Nadie habla directo con nadie:
//     PC    --subir-->  NUBE  --bajar-->  MÓVIL
//     MÓVIL --subir-->  NUBE  --bajar-->  PC
// Así funciona aunque los dispositivos nunca coincidan encendidos.
//
// SUBIR: cada venta se apunta en `cola_sync` al hacerse. Un proceso vacía esa
// cola contra /sync/lote cuando hay red. Si no hay internet, la venta se queda
// en la cola — NUNCA se pierde, y vender nunca se bloquea por falta de red.
//
// BAJAR: pedimos a /sync/bajar "qué cambió desde la última vez" y lo aplicamos
// a la base local. Incremental: solo lo nuevo.
//
// EL STOCK ES ESPECIAL, y es la decisión más delicada de todo esto:
// El stock NO se puede resolver con "gana el más reciente", porque no es un
// valor que se fija sino que se decrementa. Si el PC vendió 3 Cocas y el móvil
// 2, el stock correcto no es "el último número que escribió alguien": es el
// resultado de ambas ventas. Por eso, para los productos del NEGOCIO, el stock
// que manda es el de la nube (que ya refleja las ventas de todas las cajas), y
// el móvil lo adopta tal cual al bajar. Sus propias ventas ya subieron y están
// contadas ahí. Es simple y converge.

import { bd, uuid, ahoraISO } from "./db";
import { leerConfig, guardarConfig } from "./config";
import { estadoCuenta } from "./nube";
import { asegurarUsuario } from "./usuarios";

const BASE = "https://pos.yvexiq.com";
const LIMITE_INTENTOS = 5;

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

export type EstadoSync = {
  vinculado: boolean;
  pendientes: number;
  ultimaSync: string | null;
  sincronizando: boolean;
  error: string | null;
};

let _sincronizando = false;

export async function estadoSync(): Promise<EstadoSync> {
  const cuenta = await estadoCuenta();
  const db = await bd();
  const p = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM cola_sync"
  );
  return {
    vinculado: cuenta.vinculado,
    pendientes: p?.n ?? 0,
    ultimaSync: await leerConfig("ultima_sync"),
    sincronizando: _sincronizando,
    error: await leerConfig("sync_error"),
  };
}

// ---------------------------------------------------------------------------
// Sincronización automática (decisión del usuario)
// ---------------------------------------------------------------------------

// Regla de producto: los datos siempre son decisión del usuario. Si no hay
// respaldo automático activado, NADA sube a la nube por sí solo: solo sube
// cuando el usuario toca "Sincronizar ahora" (su copia de seguridad manual).
//
// Compatibilidad con instalaciones que YA venían auto-sincronizando: si la
// clave "sync_auto" no existe pero "ultima_sync" tiene valor, la app ya
// sincronizaba sola y no le cambiamos el comportamiento → true. Solo las
// instalaciones nuevas (que nunca han sincronizado) arrancan en manual.

/** ¿La app puede sincronizar sola (tras venta / al abrir Inicio)? */
export async function leerSyncAuto(): Promise<boolean> {
  const v = await leerConfig("sync_auto");
  if (v !== null && v !== "") return v === "1";
  // Sin preferencia guardada: ¿ya sincronizaba antes? (instalación vieja).
  const ultima = await leerConfig("ultima_sync");
  return !!ultima; // si ya hubo sync alguna vez, conservar comportamiento
}

/** Guarda la preferencia del usuario ("1"/"0", como todo booleano aquí). */
export async function guardarSyncAuto(v: boolean): Promise<void> {
  await guardarConfig("sync_auto", v ? "1" : "0");
}

/** Compuerta para los disparadores AUTOMÁTICOS: solo sincroniza si hay cuenta
 *  vinculada Y el usuario tiene activada la sincronización automática.
 *  Los disparos manuales (botón "Sincronizar ahora", "Volver a bajar todo")
 *  NO pasan por aquí: esos siempre funcionan. */
export async function sincronizarSiAuto(): Promise<void> {
  const cuenta = await estadoCuenta();
  if (!cuenta.vinculado) return;
  if (!(await leerSyncAuto())) return;
  await sincronizar();
}

// ---------------------------------------------------------------------------
// Encolar (lo llama venta.ts al cobrar)
// ---------------------------------------------------------------------------

/** Apunta una operación para subirla. No hace red: es instantáneo. */
export async function encolar(
  entidad: string,
  entidadId: string,
  payload: Record<string, any>,
  operacion: "insert" | "update" = "insert"
): Promise<void> {
  // Si no hay cuenta, no encolamos nada (modo local puro, cero desperdicio).
  const cuenta = await estadoCuenta();
  if (!cuenta.vinculado) return;

  const db = await bd();
  await db.runAsync(
    `INSERT INTO cola_sync (entidad, entidad_id, operacion, payload, creado_en)
     VALUES (?,?,?,?,?)`,
    [entidad, entidadId, operacion, JSON.stringify(payload), ahoraISO()]
  );
}

// ---------------------------------------------------------------------------
// SUBIR: vaciar la cola contra /sync/lote
// ---------------------------------------------------------------------------

type Operacion = {
  id: number;
  entidad: string;
  entidad_id: string;
  operacion: string;
  payload: string;
  intentos: number;
};

/** Asegura que las dependencias de lo que vamos a subir existan tambien en la
 *  cola. Caso real: el turno se abrio ANTES de vincular la cuenta, asi que
 *  nunca se encolo, y sus ventas llegarian huerfanas (la nube tiene FK
 *  ventas -> caja_sesiones y las rechaza con ForeignKeyViolation).
 *  Aqui reconstruimos lo que falte desde la base local. */
async function reconstruirDependencias(): Promise<void> {
  const db = await bd();

  // Usuario con el que rellenamos lo que venga sin dueño (datos anteriores a
  // la migracion de usuarios). Si no hay usuarios no hay ventas/turnos que
  // reparar: nada que hacer aqui.
  const reparador = await asegurarUsuario();
  if (!reparador) return;
  const usuarioReparador = reparador.id;

  // Reparar la tabla local (para nuevas ventas futuras).
  await db.runAsync(
    "UPDATE caja_sesiones SET usuario_pos_id = ? WHERE usuario_pos_id IS NULL",
    [usuarioReparador]
  );
  await db.runAsync(
    "UPDATE ventas SET usuario_pos_id = ? WHERE usuario_pos_id IS NULL AND origen = 'local'",
    [usuarioReparador]
  );

  const ahora = ahoraISO();

  // ---- PASO CLAVE: reparar los PAYLOADS que YA están en la cola. ----
  // El payload es una foto fija tomada al encolar; un UPDATE en la tabla NO
  // lo toca. Sin esto, una fila envenenada repite el mismo error para
  // siempre, sin importar cuánto reparemos la tabla.
  const filasCaja = await db.getAllAsync<{ id: number; entidad_id: string; payload: string }>(
    "SELECT id, entidad_id, payload FROM cola_sync WHERE entidad = 'caja_sesiones'"
  );
  for (const f of filasCaja) {
    try {
      const p = JSON.parse(f.payload);
      if (!p.usuario_pos_id) {
        p.usuario_pos_id = usuarioReparador;
        p.fondo_inicial_centavos = p.fondo_inicial_centavos ?? 0;
        p.estado = p.estado ?? "abierta";
        await db.runAsync(
          "UPDATE cola_sync SET payload = ?, intentos = 0, ultimo_error = NULL WHERE id = ?",
          [JSON.stringify(p), f.id]
        );
      }
    } catch {}
  }

  // Ídem para ventas encoladas sin usuario.
  const filasVentas = await db.getAllAsync<{ id: number; payload: string }>(
    "SELECT id, payload FROM cola_sync WHERE entidad = 'ventas'"
  );
  for (const f of filasVentas) {
    try {
      const p = JSON.parse(f.payload);
      if (!p.usuario_pos_id) {
        p.usuario_pos_id = usuarioReparador;
        await db.runAsync(
          "UPDATE cola_sync SET payload = ?, intentos = 0, ultimo_error = NULL WHERE id = ?",
          [JSON.stringify(p), f.id]
        );
      }
    } catch {}
  }

  // ---- Turnos que faltan en la cola (nunca se encolaron) ----
  const ventasEnCola = await db.getAllAsync<{ payload: string }>(
    "SELECT payload FROM cola_sync WHERE entidad = 'ventas'"
  );
  const turnosNecesarios = new Set<string>();
  for (const v of ventasEnCola) {
    try {
      const p = JSON.parse(v.payload);
      if (p.caja_sesion_id) turnosNecesarios.add(p.caja_sesion_id);
    } catch {}
  }

  const yaEnCola = await db.getAllAsync<{ entidad_id: string }>(
    "SELECT entidad_id FROM cola_sync WHERE entidad = 'caja_sesiones'"
  );
  const presentes = new Set(yaEnCola.map((f) => f.entidad_id));

  for (const turnoId of turnosNecesarios) {
    if (presentes.has(turnoId)) continue;

    const t = await db.getFirstAsync<any>(
      "SELECT * FROM caja_sesiones WHERE id = ?",
      [turnoId]
    );
    if (!t) continue;

    await db.runAsync(
      `INSERT INTO cola_sync (entidad, entidad_id, operacion, payload, creado_en)
       VALUES ('caja_sesiones', ?, 'insert', ?, ?)`,
      [
        turnoId,
        JSON.stringify({
          id: t.id,
          usuario_pos_id: t.usuario_pos_id ?? usuarioReparador,
          fondo_inicial_centavos: t.fondo_inicial_centavos ?? 0,
          abierta_en: t.abierta_en,
          cerrada_en: t.cerrada_en,
          estado: t.estado ?? "abierta",
          actualizado_en: t.actualizado_en ?? ahora,
        }),
        ahora,
      ]
    );
  }

  // ---- Reset general: cualquier fila que agotó intentos vuelve a intentarse.
  // Ahora que las causas raíz están reparadas, no tiene sentido dejarlas
  // paradas para siempre por fallos previos ya resueltos.
  await db.runAsync(
    `UPDATE cola_sync SET intentos = 0, ultimo_error = NULL WHERE intentos >= ?`,
    [LIMITE_INTENTOS]
  );
}

async function subir(cuenta: Awaited<ReturnType<typeof estadoCuenta>>): Promise<number> {
  const db = await bd();

  // Antes de nada: que no falte ninguna dependencia (turnos huerfanos).
  await reconstruirDependencias();

  const filas = await db.getAllAsync<Operacion>(
    `SELECT id, entidad, entidad_id, operacion, payload, intentos
     FROM cola_sync WHERE intentos < ? ORDER BY id LIMIT 200`,
    [LIMITE_INTENTOS]
  );
  if (filas.length === 0) return 0;

  // Blindaje final: la nube tiene columnas NOT NULL que un payload viejo puede
  // traer en null (usuario_pos_id, sobre todo). Un solo null tumba el lote
  // ENTERO. Lo saneamos aqui, en el ultimo momento, con el usuario activo.
  const usuarioSeguro = (await asegurarUsuario())?.id;

  const loteId = uuid();
  const operaciones = filas.map((f) => {
    const payload = JSON.parse(f.payload);

    if (f.entidad === "caja_sesiones" || f.entidad === "ventas") {
      if (!payload.usuario_pos_id && usuarioSeguro) payload.usuario_pos_id = usuarioSeguro;
    }
    if (f.entidad === "caja_sesiones") {
      payload.fondo_inicial_centavos = payload.fondo_inicial_centavos ?? 0;
      payload.estado = payload.estado ?? "abierta";
    }

    return {
      entidad: f.entidad,
      entidad_id: f.entidad_id,
      operacion: f.operacion,
      payload,
    };
  });

  const res = await fetch(BASE + "/sync/lote", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dispositivo-Id": cuenta.dispositivoId!,
      "X-Dispositivo-Token": cuenta.dispositivoToken!,
    },
    body: JSON.stringify({ lote_id: loteId, operaciones }),
  });

  if (!res.ok) {
    const txt = await res.text();
    // El backend manda el motivo real en `detail`. Mostrarlo: un error opaco
    // no ayuda a nadie.
    let motivo = txt.slice(0, 300);
    try {
      const j = JSON.parse(txt);
      if (j?.detail) motivo = String(j.detail);
    } catch {}

    const ids = filas.map((f) => f.id);
    await db.runAsync(
      `UPDATE cola_sync SET intentos = intentos + 1, ultimo_error = ?
       WHERE id IN (${ids.map(() => "?").join(",")})`,
      [motivo.slice(0, 300), ...ids]
    );
    throw new Error(`Servidor (${res.status}): ${motivo}`);
  }

  // Éxito: quitar de la cola lo que se subió.
  const ids = filas.map((f) => f.id);
  await db.runAsync(
    `DELETE FROM cola_sync WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
  return filas.length;
}

// ---------------------------------------------------------------------------
// BAJAR: traer los cambios del negocio y aplicarlos
// ---------------------------------------------------------------------------

type Bajada = {
  hasta: string;
  hay_mas: boolean;
  categorias: any[];
  productos: any[];
  ventas: any[];
  venta_lineas: any[];
  pagos: any[];
  caja_sesiones: any[];
  usuarios?: any[]; // cajeros de otras cajas (sin PIN), desde backend nuevo
  // Clientes del negocio: compartidos. `puntos` YA viene calculado por el
  // servidor (nunca se recalcula aquí, solo se adopta tal cual).
  clientes?: any[];
  proveedores?: any[];
  compras?: any[];
  // Bitácora de puntos de OTRAS cajas (rastro; el saldo real viaja en `clientes`).
  puntos_movimientos?: any[];
  // Config del negocio (lista blanca del servidor: lealtad, IVA, datos
  // fiscales). Nunca preferencias por-dispositivo (usuario activo, etc.).
  config?: any[];
  // Cotizaciones del negocio (de cualquier caja): carrito armado sin cobrar.
  cotizaciones?: any[];
  cotizacion_lineas?: any[];
};

async function bajar(
  cuenta: Awaited<ReturnType<typeof estadoCuenta>>
): Promise<{ aplicados: number; hayMas: boolean }> {
  const desde = (await leerConfig("sync_desde")) ?? "";
  const url =
    BASE + "/sync/bajar" + (desde ? `?desde=${encodeURIComponent(desde)}` : "");

  const res = await fetch(url, {
    headers: {
      "X-Dispositivo-Id": cuenta.dispositivoId!,
      "X-Dispositivo-Token": cuenta.dispositivoToken!,
    },
  });
  if (!res.ok) throw new Error(`No se pudo bajar (${res.status}).`);

  const d: Bajada = await res.json();
  const db = await bd();
  let aplicados = 0;

  const ahoraSync = ahoraISO();

  // Las FK se apagan durante la bajada: los datos del negocio referencian
  // filas que este teléfono puede no tener todavía (usuarios de otras cajas,
  // productos de un lote posterior...). El servidor ya garantizó su
  // integridad; aquí solo somos un espejo. Se reactivan al terminar.
  await db.execAsync("PRAGMA foreign_keys = OFF;");

  try {
    await db.withTransactionAsync(async () => {
    // --- Categorías del negocio ---
    for (const c of d.categorias) {
      await db.runAsync(
        `INSERT INTO categorias
          (id, nombre, color, orden, icono, activo, eliminado, origen, creado_en, actualizado_en)
         VALUES (?,?,?,0,NULL,1,?, 'nube', ?,?)
         ON CONFLICT(id) DO UPDATE SET
           nombre = excluded.nombre,
           color = excluded.color,
           eliminado = excluded.eliminado,
           actualizado_en = excluded.actualizado_en`,
        [c.id, c.nombre, c.color, c.eliminado ? 1 : 0, c.creado_en, c.actualizado_en]
      );
      aplicados++;
    }

    // --- Productos del negocio ---
    // El stock viene de la nube y se adopta: ya refleja las ventas de TODAS
    // las cajas (incluidas las nuestras, que ya subimos).
    for (const p of d.productos) {
      await db.runAsync(
        `INSERT INTO productos
          (id, codigo_barras, nombre, categoria_id, precio_venta_centavos,
           costo_centavos, precio_mayoreo_centavos, controla_stock, stock,
           stock_minimo, unidad, es_kit, imagen_uri, activo, eliminado, origen,
           creado_en, actualizado_en)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,1,?, 'nube', ?,?)
         ON CONFLICT(id) DO UPDATE SET
           codigo_barras = excluded.codigo_barras,
           nombre = excluded.nombre,
           categoria_id = excluded.categoria_id,
           precio_venta_centavos = excluded.precio_venta_centavos,
           costo_centavos = excluded.costo_centavos,
           precio_mayoreo_centavos = excluded.precio_mayoreo_centavos,
           controla_stock = excluded.controla_stock,
           stock = excluded.stock,
           stock_minimo = excluded.stock_minimo,
           unidad = excluded.unidad,
           es_kit = excluded.es_kit,
           eliminado = excluded.eliminado,
           actualizado_en = excluded.actualizado_en`,
        [
          p.id, p.codigo_barras, p.nombre, p.categoria_id,
          p.precio_venta_centavos, p.costo_centavos ?? 0, p.precio_mayoreo_centavos,
          p.controla_stock ? 1 : 0, p.stock, p.stock_minimo, p.unidad,
          p.es_kit ? 1 : 0, p.eliminado ? 1 : 0, p.creado_en, p.actualizado_en,
        ]
      );
      aplicados++;
    }

    // --- Usuarios de otras cajas ---
    // Las ventas y turnos que bajamos apuntan a usuarios del PC que este
    // teléfono no conoce. Creamos un registro mínimo (sin PIN utilizable) para
    // que las referencias existan y los reportes muestren algo coherente.
    const idsUsuarios = new Set<string>();
    for (const s of d.caja_sesiones) if (s.usuario_pos_id) idsUsuarios.add(s.usuario_pos_id);
    for (const v of d.ventas) if (v.usuario_pos_id) idsUsuarios.add(v.usuario_pos_id);
    for (const uid of idsUsuarios) {
      await db.runAsync(
        `INSERT INTO usuarios_pos
          (id, nombre, pin_hash, rol, activo, eliminado, creado_en, actualizado_en)
         VALUES (?, 'Otra caja', '', 'cajero', 0, 0, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [uid, ahoraSync, ahoraSync]
      );
    }

    // --- Nombres reales de los cajeros de otras cajas ---
    // El servidor manda los usuarios (sin PIN): se actualiza el nombre/rol del
    // espejo creado arriba. NUNCA se toca pin_hash ni se activan: no se puede
    // entrar como ellos en este teléfono, solo se muestra quién vendió.
    for (const u of d.usuarios ?? []) {
      await db.runAsync(
        `INSERT INTO usuarios_pos
          (id, nombre, pin_hash, rol, activo, eliminado, creado_en, actualizado_en)
         VALUES (?, ?, '', ?, 0, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           nombre = excluded.nombre,
           rol = excluded.rol,
           eliminado = excluded.eliminado,
           actualizado_en = excluded.actualizado_en`,
        [
          u.id, u.nombre ?? "Otra caja",
          ["dueno", "gerente", "cajero"].includes(u.rol) ? u.rol : "cajero",
          u.eliminado ? 1 : 0,
          u.creado_en ?? ahoraSync, u.actualizado_en ?? ahoraSync,
        ]
      );
    }

    // --- Turnos de otras cajas (necesarios: las ventas los referencian) ---
    for (const s of d.caja_sesiones) {
      await db.runAsync(
        `INSERT INTO caja_sesiones
          (id, usuario_pos_id, fondo_inicial_centavos, abierta_en, cerrada_en,
           estado, creado_en, actualizado_en)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           cerrada_en = excluded.cerrada_en,
           estado = excluded.estado,
           actualizado_en = excluded.actualizado_en`,
        [
          s.id, s.usuario_pos_id, s.fondo_inicial_centavos, s.abierta_en,
          s.cerrada_en, s.estado, s.abierta_en, s.actualizado_en,
        ]
      );
      aplicados++;
    }

    // --- Ventas de otras cajas (para reportes completos del negocio) ---
    for (const v of d.ventas) {
      await db.runAsync(
        `INSERT INTO ventas
          (id, caja_sesion_id, usuario_pos_id, folio, subtotal_centavos,
           descuento_centavos, iva_centavos, total_centavos, estado, origen,
           creado_en, actualizado_en)
         VALUES (?,?,?,?,?,?,?,?,?, 'nube', ?,?)
         ON CONFLICT(id) DO UPDATE SET
           estado = excluded.estado,
           actualizado_en = excluded.actualizado_en`,
        [
          v.id, v.caja_sesion_id, v.usuario_pos_id, v.folio,
          v.subtotal_centavos, v.descuento_centavos, v.iva_centavos,
          v.total_centavos, v.estado, v.creado_en, v.actualizado_en,
        ]
      );
      aplicados++;
    }

    for (const l of d.venta_lineas) {
      await db.runAsync(
        `INSERT INTO venta_lineas
          (id, venta_id, producto_id, nombre_producto, cantidad,
           precio_unitario_centavos, costo_unitario_centavos, descuento_linea_centavos,
           total_linea_centavos, creado_en)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO NOTHING`,
        [
          l.id, l.venta_id, l.producto_id, l.descripcion, l.cantidad,
          l.precio_unitario_centavos, l.costo_unitario_centavos ?? 0,
          l.descuento_linea_centavos ?? 0,
          l.total_linea_centavos, l.creado_en,
        ]
      );
    }

    for (const pg of d.pagos) {
      await db.runAsync(
        `INSERT INTO pagos (id, venta_id, metodo, monto_centavos, creado_en)
         VALUES (?,?,?,?,?)
         ON CONFLICT(id) DO NOTHING`,
        [pg.id, pg.venta_id, pg.metodo, pg.monto_centavos, pg.creado_en]
      );
    }

    // --- Clientes del negocio (compartidos). `puntos` es el saldo REAL
    // que calculó el servidor: se adopta tal cual, nunca se suma aquí. ---
    for (const cli of (d.clientes ?? [])) {
      await db.runAsync(
        `INSERT INTO clientes
          (id, codigo, nombre, telefono, correo, notas, puntos, eliminado, creado_en, actualizado_en)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           codigo = excluded.codigo, nombre = excluded.nombre,
           telefono = excluded.telefono, correo = excluded.correo,
           notas = excluded.notas, puntos = excluded.puntos,
           eliminado = excluded.eliminado, actualizado_en = excluded.actualizado_en`,
        [
          cli.id, cli.codigo ?? null, cli.nombre, cli.telefono ?? null,
          cli.correo ?? null, cli.notas ?? null, cli.puntos ?? 0,
          cli.eliminado ? 1 : 0, cli.creado_en, cli.actualizado_en,
        ]
      );
      // NOTA: el móvil no tiene columnas de crédito (limite_credito_centavos,
      // saldo_centavos) — el payload del servidor las trae porque el PC sí
      // las usa, pero aquí simplemente se ignoran (no están en el INSERT).
      aplicados++;
    }

    for (const prov of (d.proveedores ?? [])) {
      await db.runAsync(
        `INSERT INTO proveedores
          (id, nombre, contacto, telefono, notas, dias_visita, eliminado, creado_en, actualizado_en)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           nombre = excluded.nombre, contacto = excluded.contacto,
           telefono = excluded.telefono, notas = excluded.notas,
           dias_visita = excluded.dias_visita, eliminado = excluded.eliminado,
           actualizado_en = excluded.actualizado_en`,
        [
          prov.id, prov.nombre, prov.contacto ?? null, prov.telefono ?? null,
          prov.notas ?? null, prov.dias_visita ?? null,
          prov.eliminado ? 1 : 0, prov.creado_en, prov.actualizado_en,
        ]
      );
      aplicados++;
    }

    for (const c of (d.compras ?? [])) {
      await db.runAsync(
        `INSERT INTO compras
          (id, proveedor_id, proveedor_nombre, folio, fecha, tipo, total_centavos,
           num_lineas, origen, notas, eliminado, creado_en, actualizado_en)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           eliminado = excluded.eliminado, actualizado_en = excluded.actualizado_en`,
        [
          c.id, c.proveedor_id ?? null, c.proveedor_nombre ?? null,
          c.folio ?? null, c.fecha ?? null, c.tipo ?? "normal",
          c.total_centavos ?? 0, c.num_lineas ?? 0, c.origen ?? "manual",
          c.notas ?? null, c.eliminado ? 1 : 0, c.creado_en, c.actualizado_en,
        ]
      );
      aplicados++;
    }

    for (const m of (d.puntos_movimientos ?? [])) {
      await db.runAsync(
        `INSERT INTO puntos_movimientos
          (id, cliente_id, venta_id, tipo, puntos, nota, creado_en)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO NOTHING`,
        [m.id, m.cliente_id, m.venta_id ?? null, m.tipo, m.puntos, m.nota ?? null, m.creado_en]
      );
      // El saldo real ya llegó en el bloque de `clientes` de arriba — este
      // insert es solo para que el historial del cliente muestre el
      // movimiento que hizo la otra caja.
      aplicados++;
    }

    // --- Cotizaciones del negocio (de cualquier caja) ---
    // DO UPDATE en todo el estado: una cotización SÍ cambia después de creada
    // (se cancela, vence, o se convierte en venta desde otro dispositivo).
    for (const cot of (d.cotizaciones ?? [])) {
      await db.runAsync(
        `INSERT INTO cotizaciones
          (id, folio, cliente_nombre, cliente_telefono, cliente_correo, notas,
           subtotal_centavos, descuento_centavos, total_centavos, valida_hasta,
           estado, venta_id, eliminado, creado_en, actualizado_en)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           cliente_nombre = excluded.cliente_nombre,
           cliente_telefono = excluded.cliente_telefono,
           cliente_correo = excluded.cliente_correo,
           notas = excluded.notas,
           subtotal_centavos = excluded.subtotal_centavos,
           descuento_centavos = excluded.descuento_centavos,
           total_centavos = excluded.total_centavos,
           valida_hasta = excluded.valida_hasta,
           estado = excluded.estado,
           venta_id = excluded.venta_id,
           eliminado = excluded.eliminado,
           actualizado_en = excluded.actualizado_en`,
        [
          cot.id, cot.folio, cot.cliente_nombre ?? null, cot.cliente_telefono ?? null,
          cot.cliente_correo ?? null, cot.notas ?? null, cot.subtotal_centavos ?? 0,
          cot.descuento_centavos ?? 0, cot.total_centavos ?? 0, cot.valida_hasta ?? null,
          cot.estado ?? "abierta", cot.venta_id ?? null, cot.eliminado ? 1 : 0,
          cot.creado_en, cot.actualizado_en,
        ]
      );
      aplicados++;
    }

    // --- Líneas de esas cotizaciones (no cambian una vez creadas) ---
    for (const l of (d.cotizacion_lineas ?? [])) {
      await db.runAsync(
        `INSERT INTO cotizacion_lineas
          (id, cotizacion_id, producto_id, descripcion, cantidad,
           precio_unitario_centavos, descuento_linea_centavos, total_linea_centavos, creado_en)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO NOTHING`,
        [
          l.id, l.cotizacion_id, l.producto_id ?? null, l.descripcion, l.cantidad,
          l.precio_unitario_centavos, l.descuento_linea_centavos ?? 0,
          l.total_linea_centavos, l.creado_en,
        ]
      );
    }

    // --- Config del negocio (lealtad, IVA, datos fiscales…). El servidor
    // ya filtra con lista blanca, pero por seguridad extra nunca tocamos
    // "dispositivo_id" desde aquí tampoco. ---
    for (const cfg of (d.config ?? [])) {
      if (cfg.clave === "dispositivo_id") continue;
      await db.runAsync(
        `INSERT INTO config (clave, valor) VALUES (?, ?)
         ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
        [cfg.clave, cfg.valor]
      );
      aplicados++;
    }
    });
  } finally {
    await db.execAsync("PRAGMA foreign_keys = ON;");
  }

  // Avanzar la marca solo si hubo algo (si no, la dejamos igual).
  if (d.hasta && d.hasta !== desde) await guardarConfig("sync_desde", d.hasta);

  return { aplicados, hayMas: d.hay_mas };
}

// ---------------------------------------------------------------------------
// Sincronizar (las dos direcciones)
// ---------------------------------------------------------------------------

export type ResultadoSync = {
  ok: boolean;
  subidas: number;
  bajados: number;
  error?: string;
};

export async function sincronizar(): Promise<ResultadoSync> {
  if (_sincronizando) return { ok: false, subidas: 0, bajados: 0, error: "Ya en curso." };

  const cuenta = await estadoCuenta();
  if (!cuenta.vinculado)
    return { ok: false, subidas: 0, bajados: 0, error: "Sin cuenta vinculada." };

  _sincronizando = true;
  let subidas = 0;
  let bajados = 0;

  try {
    // 1. SUBIR primero (en vueltas, hasta vaciar la cola): así lo nuestro ya
    //    cuenta cuando bajemos el stock. Si algo se resuelve en una vuelta
    //    (p.ej. un turno reparado) pero deja más pendientes, hay que seguir.
    let vueltasSubida = 0;
    while (vueltasSubida < 10) {
      const n = await subir(cuenta);
      subidas += n;
      vueltasSubida++;
      if (n === 0) break; // cola vacía: ya no hay nada más que subir
    }

    // 2. BAJAR (en páginas si hace falta).
    let vueltas = 0;
    let hayMas = true;
    while (hayMas && vueltas < 10) {
      const r = await bajar(cuenta);
      bajados += r.aplicados;
      hayMas = r.hayMas;
      vueltas++;
    }

    await guardarConfig("ultima_sync", ahoraISO());
    await guardarConfig("sync_error", "");
    return { ok: true, subidas, bajados };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await guardarConfig("sync_error", msg);
    return { ok: false, subidas, bajados, error: msg };
  } finally {
    _sincronizando = false;
  }
}

// ---------------------------------------------------------------------------
// Sync automático tras venta
// ---------------------------------------------------------------------------

/** Dispara un ciclo de sync en segundo plano tras cada venta ("dispara y
 *  olvida"): el cobro NO espera al servidor y la UI nunca se bloquea. Si no
 *  hay internet o falla, no pasa nada: la operación ya está en la cola y
 *  saldrá en la próxima oportunidad (botón o siguiente venta).
 *
 *  ¿Por qué existe? El PC ya hace esto mismo. Sin él, el móvil solo subía
 *  cuando el usuario pulsaba "Sincronizar", y la ventana en que dos cajas
 *  podían vender el mismo producto sin verse era de horas; con esto baja a
 *  segundos. Si ya hay un sync en curso, sincronizar() lo detecta y sale
 *  sin hacer nada.
 *
 *  Pasa por la compuerta sincronizarSiAuto(): si el usuario apagó el respaldo
 *  automático, aquí no sube nada — la venta ya quedó encolada y saldrá cuando
 *  él toque "Sincronizar ahora". */
export function sincronizarTrasVenta(): void {
  void sincronizarSiAuto().catch(() => {
    /* silencioso a propósito: la venta ya cobró, el sync reintentará */
  });
}


//
// "El negocio manda": cuando este teléfono se vincula a un negocio que YA tiene
// catálogo, adopta el del negocio. Sus productos locales se ARCHIVAN (no se
// borran: quedan guardados por si acaso).
//
// Se ejecuta una sola vez, tras vincular.

/** Tras vincular una cuenta, encola lo que ya existia en local y que la nube
 *  necesitara: el turno abierto. Sin esto, las ventas del turno actual
 *  llegarian huerfanas a la nube. */
export async function prepararTrasVincular(): Promise<void> {
  const db = await bd();
  const ahora = ahoraISO();

  const abierto = await db.getFirstAsync<any>(
    "SELECT * FROM caja_sesiones WHERE estado = 'abierta' ORDER BY abierta_en DESC LIMIT 1"
  );
  if (abierto) {
    await encolar("caja_sesiones", abierto.id, {
      id: abierto.id,
      usuario_pos_id: abierto.usuario_pos_id,
      fondo_inicial_centavos: abierto.fondo_inicial_centavos,
      abierta_en: abierto.abierta_en,
      cerrada_en: abierto.cerrada_en,
      estado: abierto.estado,
      actualizado_en: abierto.actualizado_en ?? ahora,
    });
  }
}

export async function hayCatalogoLocal(): Promise<number> {
  const db = await bd();
  const f = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM productos WHERE eliminado = 0 AND origen = 'local'"
  );
  return f?.n ?? 0;
}

/** Archiva los productos locales y deja el catálogo listo para adoptar el del negocio. */
export async function archivarCatalogoLocal(motivo: string): Promise<number> {
  const db = await bd();
  const locales = await db.getAllAsync<any>(
    "SELECT * FROM productos WHERE eliminado = 0 AND origen = 'local'"
  );
  const ahora = ahoraISO();

  await db.withTransactionAsync(async () => {
    for (const p of locales) {
      await db.runAsync(
        `INSERT INTO productos_archivados (id, datos_json, archivado_en, motivo)
         VALUES (?,?,?,?)
         ON CONFLICT(id) DO NOTHING`,
        [p.id, JSON.stringify(p), ahora, motivo]
      );
      await db.runAsync(
        "UPDATE productos SET eliminado = 1, actualizado_en = ? WHERE id = ?",
        [ahora, p.id]
      );
    }
    // Las categorías locales también salen de circulación.
    await db.runAsync(
      "UPDATE categorias SET eliminado = 1, actualizado_en = ? WHERE origen = 'local'",
      [ahora]
    );
  });

  return locales.length;
}

/** Cuántos productos hay archivados (por si el usuario quiere recuperarlos). */
export async function contarArchivados(): Promise<number> {
  const db = await bd();
  const f = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM productos_archivados"
  );
  return f?.n ?? 0;
}

/** DIAGNÓSTICO: contenido real de la cola (entidad, intentos, error). */
export async function inspeccionarCola(): Promise<
  { entidad: string; entidad_id: string; intentos: number; ultimo_error: string | null }[]
> {
  const db = await bd();
  return db.getAllAsync(
    "SELECT entidad, entidad_id, intentos, ultimo_error FROM cola_sync ORDER BY id"
  );
}

/** Olvida la marca de sincronización: la próxima bajada trae TODO otra vez.
 *  Útil cuando algo se descuadró y quieres partir de cero (no borra nada). */
export async function resincronizarDesdeCero(): Promise<ResultadoSync> {
  await guardarConfig("sync_desde", "");
  await guardarConfig("sync_error", "");
  return sincronizar();
}

/** Restaura los productos archivados: vuelven al inventario tal como estaban.
 *  Red de seguridad real: archivar NUNCA es destructivo. */
export async function restaurarArchivados(): Promise<number> {
  const db = await bd();
  const filas = await db.getAllAsync<{ id: string; datos_json: string }>(
    "SELECT id, datos_json FROM productos_archivados"
  );
  const ahora = ahoraISO();
  let n = 0;

  await db.withTransactionAsync(async () => {
    for (const f of filas) {
      const p = JSON.parse(f.datos_json);
      // Devolver el producto a la vida (sigue siendo 'local').
      await db.runAsync(
        "UPDATE productos SET eliminado = 0, actualizado_en = ? WHERE id = ?",
        [ahora, p.id]
      );
      n++;
    }
    // Y sus categorías locales.
    await db.runAsync(
      "UPDATE categorias SET eliminado = 0, actualizado_en = ? WHERE origen = 'local'",
      [ahora]
    );
    await db.runAsync("DELETE FROM productos_archivados");
  });

  return n;
}
