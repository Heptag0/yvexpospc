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
//
// ===========================================================================
// LO QUE SE CORRIGIÓ EN ESTA RONDA (mismo contrato que el PC y el servidor)
// ===========================================================================
//
//  1. LA COLA SE BORRABA COMPLETA AUNQUE EL SERVIDOR DESCARTARA OPERACIONES.
//     `subir()` miraba solo `res.ok` y hacía DELETE de las 200 filas. El
//     servidor SIEMPRE respondía ok=true, así que todo lo que descartaba se
//     perdía en silencio. Ahora el servidor devuelve un veredicto POR
//     OPERACIÓN y aquí se borra ÚNICAMENTE lo que confirma haber aplicado.
//
//  2. `lote_id` NO SE PERSISTÍA, así que la idempotencia por lote era falsa:
//     si la respuesta se perdía, el reenvío llevaba un id nuevo y el servidor
//     lo trataba como un lote distinto. Ahora se guarda en config antes de
//     enviar y se reutiliza hasta que hay respuesta.
//
//  3. EL CRÉDITO SE DESCARTABA AL BAJAR.
//     El INSERT de clientes no incluía `limite_credito_centavos` ni
//     `saldo_centavos`, con un comentario que decía que el móvil no tenía
//     esas columnas. Ese comentario quedó viejo: la migración v28 las añadió.
//     Resultado: fiabas en el PC y en el móvil ese cliente aparecía con saldo
//     cero, así que un cajero podía volver a fiarle a alguien pasado de su
//     límite.
//
//  4. VINCULAR PONÍA EL IVA EN CERO EN TODO EL NEGOCIO.
//     `prepararTrasVincular()` mandaba `iva_tasa: 0` y `cantidad_mayoreo:
//     null` — columnas que el móvil NO TIENE. Afirmar un valor que no
//     conoces es peor que omitirlo: el servidor lo tomaba como dato bueno y
//     pisaba el IVA real que había puesto el PC. Regla nueva y absoluta:
//     NUNCA se manda una columna que este cliente no almacena.
//
//  5. `orden` e `icono` de categorías se clavaban en 0/NULL al bajar, así que
//     reordenar departamentos en el PC nunca se veía aquí.
//
//  6. NINGÚN DO UPDATE COMPARABA `actualizado_en`, así que una página vieja
//     podía pisar datos más nuevos. Ahora todos llevan la guarda.

import { bd, uuid, ahoraISO } from "./db";
import { leerConfig, guardarConfig } from "./config";
import { estadoCuenta } from "./nube";
import { asegurarUsuario } from "./usuarios";

const BASE = "https://pos.yvexiq.com";
const LIMITE_INTENTOS = 5;

/** Clave de config donde vive el lote en vuelo. Persistirlo es lo que hace
 *  real la idempotencia: si la respuesta se pierde, el reenvío usa el MISMO
 *  id y el servidor reconoce el lote en vez de tratarlo como nuevo. */
const CLAVE_LOTE_EN_VUELO = "sync_lote_en_vuelo";

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
  // Solo las que aún se van a intentar. Antes contaba también las apartadas,
  // así que el indicador nunca llegaba a cero y el dueño veía "pendientes"
  // para siempre sin saber cuáles ni por qué.
  const p = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM cola_sync WHERE intentos < ?",
    [LIMITE_INTENTOS]
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

/** ¿La app puede sincronizar sola (tras venta / al abrir Inicio)? */
export async function leerSyncAuto(): Promise<boolean> {
  const v = await leerConfig("sync_auto");
  if (v !== null && v !== "") return v === "1";
  // Sin preferencia guardada: ¿ya sincronizaba antes? (instalación vieja).
  const ultima = await leerConfig("ultima_sync");
  return !!ultima;
}

/** Guarda la preferencia del usuario ("1"/"0", como todo booleano aquí). */
export async function guardarSyncAuto(v: boolean): Promise<void> {
  await guardarConfig("sync_auto", v ? "1" : "0");
}

/** Compuerta para los disparadores AUTOMÁTICOS. Los disparos manuales
 *  (botón "Sincronizar ahora") NO pasan por aquí: esos siempre funcionan. */
export async function sincronizarSiAuto(): Promise<void> {
  const cuenta = await estadoCuenta();
  if (!cuenta.vinculado) return;
  if (!(await leerSyncAuto())) return;
  await sincronizar();
}

// ---------------------------------------------------------------------------
// Encolar (lo llama venta.ts al cobrar)
// ---------------------------------------------------------------------------

/** Apunta una operación para subirla. No hace red: es instantáneo.
 *
 *  ⚠️ REGLA DEL CONTRATO: el payload debe contener SOLO columnas que este
 *  cliente almacena de verdad. Mandar una columna que no tienes (aunque sea
 *  con su "valor por defecto") hace que el servidor la tome como dato bueno
 *  y pise lo que otro dispositivo sí sabía. Omitir es seguro; afirmar no. */
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

/** Veredicto del servidor para UNA operación.
 *  - "aplicada"   -> guardada en la nube. Se borra de la cola.
 *  - "diferida"   -> su fila padre aún no existe allá, o el cambio era más
 *                    viejo que lo guardado. Se conserva y se reintenta.
 *  - "descartada" -> inválida sin remedio. Se aparta con el motivo visible;
 *                    reintentarla no arreglaría nada. NO se borra. */
type ResultadoOp = {
  entidad_id: string;
  entidad: string;
  estado: string;
  motivo?: string | null;
};

type RespuestaLote = {
  ok: boolean;
  lote_id?: string;
  ya_procesado?: boolean;
  aplicadas?: number;
  ignoradas?: number;
  resultados?: ResultadoOp[];
};

/** Asegura que las dependencias de lo que vamos a subir existan también en la
 *  cola. Caso real: el turno se abrió ANTES de vincular la cuenta, así que
 *  nunca se encoló, y sus ventas llegarían huérfanas.
 *
 *  Con el contrato nuevo esta función deja de ser la red que sostiene el
 *  sistema y pasa a ser lo que debe ser: una reparación acotada de filas
 *  viejas. El servidor ya valida columnas obligatorias y responde qué falta,
 *  así que nada se envenena en silencio. */
async function reconstruirDependencias(): Promise<void> {
  const db = await bd();

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

  // ---- Reparar los PAYLOADS que YA están en la cola. ----
  // El payload es una foto fija tomada al encolar; un UPDATE en la tabla NO
  // lo toca. Sin esto, una fila envenenada repite el mismo error para
  // siempre, por mucho que reparemos la tabla.
  const filasCaja = await db.getAllAsync<{ id: number; entidad_id: string; payload: string }>(
    "SELECT id, entidad_id, payload FROM cola_sync WHERE entidad = 'caja_sesiones' AND intentos < ?",
    [LIMITE_INTENTOS]
  );
  for (const f of filasCaja) {
    try {
      const p = JSON.parse(f.payload);
      let cambio = false;
      if (!p.usuario_pos_id) {
        p.usuario_pos_id = usuarioReparador;
        p.fondo_inicial_centavos = p.fondo_inicial_centavos ?? 0;
        p.estado = p.estado ?? "abierta";
        cambio = true;
      }
      // abierta_en faltante: pasa cuando el turno se abrió ANTES de vincular
      // (encolar() era no-op sin cuenta) y lo primero que se encoló de él fue
      // un update parcial. Se repara con el valor real del turno local.
      if (!p.abierta_en) {
        const turnoLocal = await db.getFirstAsync<{ abierta_en: string }>(
          "SELECT abierta_en FROM caja_sesiones WHERE id = ?",
          [f.entidad_id]
        );
        if (turnoLocal?.abierta_en) {
          p.abierta_en = turnoLocal.abierta_en;
          cambio = true;
        }
      }
      if (cambio) {
        await db.runAsync(
          "UPDATE cola_sync SET payload = ?, intentos = 0, ultimo_error = NULL WHERE id = ?",
          [JSON.stringify(p), f.id]
        );
      }
    } catch {
      // Payload ilegible: lo aparta el barrido de corruptos más abajo.
    }
  }

  // Ídem para ventas encoladas sin usuario.
  const filasVentas = await db.getAllAsync<{ id: number; payload: string }>(
    "SELECT id, payload FROM cola_sync WHERE entidad = 'ventas' AND intentos < ?",
    [LIMITE_INTENTOS]
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
    } catch {
      // Igual que arriba.
    }
  }

  // Categorías sin nombre: eliminarCategoria() manda un update parcial
  // ({id, eliminado, actualizado_en}). Con el servidor viejo eso cruzaba el
  // umbral de "completo" e intentaba un INSERT sin nombre, tumbando el lote
  // entero. El servidor nuevo ya no lo hace (respeta la operación declarada),
  // pero reparar el payload sigue siendo mejor: así la categoría sube con su
  // nombre en vez de quedarse diferida esperando a que exista allá.
  const filasCategorias = await db.getAllAsync<{ id: number; entidad_id: string; payload: string }>(
    "SELECT id, entidad_id, payload FROM cola_sync WHERE entidad = 'categorias' AND intentos < ?",
    [LIMITE_INTENTOS]
  );
  for (const f of filasCategorias) {
    try {
      const p = JSON.parse(f.payload);
      if (!p.nombre) {
        const catLocal = await db.getFirstAsync<{ nombre: string; color: string | null }>(
          "SELECT nombre, color FROM categorias WHERE id = ?",
          [f.entidad_id]
        );
        if (catLocal?.nombre) {
          p.nombre = catLocal.nombre;
          if (p.color === undefined) p.color = catLocal.color;
          await db.runAsync(
            "UPDATE cola_sync SET payload = ?, intentos = 0, ultimo_error = NULL WHERE id = ?",
            [JSON.stringify(p), f.id]
          );
        }
      }
    } catch {
      // Igual que arriba.
    }
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
    } catch {
      // Payload ilegible: se aparta más abajo.
    }
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

  // ⚠️ AQUÍ VIVÍA UN RESET GENERAL:
  //     UPDATE cola_sync SET intentos = 0 WHERE intentos >= LIMITE_INTENTOS
  // Tenía sentido cuando "agotó intentos" solo significaba "falló por causas
  // que ya reparamos". Ya no: con el contrato nuevo, intentos >= LIMITE es
  // también la marca de "el servidor la DESCARTÓ por inválida". Resucitarla
  // en cada pasada la mandaría a rechazarse otra vez, en bucle infinito, cada
  // 30 segundos. El reintento masivo sigue disponible, pero solo cuando el
  // usuario lo pide a mano: ver `reintentarTodo()`.
}

/** Aparta las filas cuyo payload no es un objeto JSON. Una fila así no puede
 *  sincronizarse nunca; dejarla en la cola solo envenena cada lote. */
async function apartarPayloadsCorruptos(): Promise<number> {
  const db = await bd();
  const filas = await db.getAllAsync<{ id: number; payload: string }>(
    "SELECT id, payload FROM cola_sync WHERE intentos < ?",
    [LIMITE_INTENTOS]
  );
  let n = 0;
  for (const f of filas) {
    let valido = false;
    try {
      const p = JSON.parse(f.payload);
      valido = !!p && typeof p === "object" && !Array.isArray(p);
    } catch {
      valido = false;
    }
    if (!valido) {
      await db.runAsync(
        `UPDATE cola_sync SET intentos = ?,
                ultimo_error = 'Payload corrupto: no es un objeto JSON válido'
         WHERE id = ?`,
        [LIMITE_INTENTOS, f.id]
      );
      n++;
    }
  }
  return n;
}

async function subir(cuenta: Awaited<ReturnType<typeof estadoCuenta>>): Promise<number> {
  const db = await bd();

  // Antes de nada: reparar dependencias y apartar lo irreparable.
  await reconstruirDependencias();
  await apartarPayloadsCorruptos();

  const filas = await db.getAllAsync<Operacion>(
    `SELECT id, entidad, entidad_id, operacion, payload, intentos
     FROM cola_sync WHERE intentos < ? ORDER BY id LIMIT 200`,
    [LIMITE_INTENTOS]
  );
  if (filas.length === 0) return 0;

  // Blindaje: la nube tiene columnas NOT NULL que un payload viejo puede
  // traer en null (usuario_pos_id, sobre todo). Se sanea aquí, en el último
  // momento, con el usuario activo.
  const usuarioSeguro = (await asegurarUsuario())?.id;

  // lote_id PERSISTIDO. Si quedó uno en vuelo cuya respuesta se perdió, se
  // reutiliza para que el servidor reconozca el reenvío.
  let loteId = (await leerConfig(CLAVE_LOTE_EN_VUELO)) ?? "";
  if (!loteId) {
    loteId = uuid();
    await guardarConfig(CLAVE_LOTE_EN_VUELO, loteId);
  }

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
    let motivo = txt.slice(0, 300);
    try {
      const j = JSON.parse(txt);
      if (j?.detail) motivo = String(j.detail);
    } catch {
      // La respuesta no era JSON: nos quedamos con el texto crudo.
    }

    const ids = filas.map((f) => f.id);
    await db.runAsync(
      `UPDATE cola_sync SET intentos = intentos + 1, ultimo_error = ?
       WHERE id IN (${ids.map(() => "?").join(",")})`,
      [motivo.slice(0, 300), ...ids]
    );
    // El lote no se procesó: conservamos el id en vuelo para reenviarlo igual.
    throw new Error(`Servidor (${res.status}): ${motivo}`);
  }

  const datos: RespuestaLote = await res.json();

  // Llegó y se procesó: el id en vuelo ya cumplió su función.
  await guardarConfig(CLAVE_LOTE_EN_VUELO, "");

  // ---- Veredicto por operación. SOLO se borra lo confirmado. ----
  const porId = new Map<string, number>();
  for (const f of filas) porId.set(`${f.entidad}\u0000${f.entidad_id}`, f.id);

  const vistos = new Set<number>();
  let aplicadas = 0;
  let descartadas = 0;

  for (const r of datos.resultados ?? []) {
    const id = porId.get(`${r.entidad}\u0000${r.entidad_id}`);
    if (id === undefined) continue; // veredicto de algo que no mandamos
    vistos.add(id);

    if (r.estado === "aplicada") {
      await db.runAsync("DELETE FROM cola_sync WHERE id = ?", [id]);
      aplicadas++;
    } else if (r.estado === "descartada") {
      // Inválida sin remedio: se aparta con el motivo a la vista. NO se
      // borra — el dato sigue ahí para poder repararlo o auditarlo.
      await db.runAsync(
        "UPDATE cola_sync SET intentos = ?, ultimo_error = ? WHERE id = ?",
        [LIMITE_INTENTOS, (r.motivo ?? "rechazada por el servidor").slice(0, 300), id]
      );
      descartadas++;
    } else {
      // "diferida" o cualquier estado nuevo: conservar y reintentar. Ante la
      // duda NO se borra: perder una venta es peor que reintentar de más.
      await db.runAsync(
        "UPDATE cola_sync SET intentos = intentos + 1, ultimo_error = ? WHERE id = ?",
        [(r.motivo ?? "en espera de su dependencia").slice(0, 300), id]
      );
    }
  }

  // Operaciones que mandamos y de las que el servidor no dijo nada. No se
  // borran: un servidor mudo sobre una fila no es permiso para tirarla.
  for (const f of filas) {
    if (vistos.has(f.id)) continue;
    await db.runAsync(
      `UPDATE cola_sync SET intentos = intentos + 1,
              ultimo_error = 'El servidor no reportó esta operación'
       WHERE id = ?`,
      [f.id]
    );
  }

  if (descartadas > 0) {
    await guardarConfig(
      "sync_error",
      `${descartadas} operación(es) rechazadas por el servidor. Revisa el diagnóstico de la cola.`
    );
  }

  return aplicadas;
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
  /** Entradas y salidas de efectivo que no son ventas. Sin ellas el corte
   *  del negocio no cuadra cuando hay más de una caja. */
  movimientos_caja?: any[];
  /** Devoluciones de otras cajas — tablas espejo desde la migración v32.
   *  El móvil aún no las CREA (falta la pantalla); solo las recibe para que
   *  el corte del negocio cuadre cuando otra caja devuelve algo. */
  devoluciones?: any[];
  devolucion_lineas?: any[];
  usuarios?: any[];
  /** `puntos` viene calculado por el trigger del servidor. `saldo_centavos` y
   *  `limite_credito_centavos` también viajan y AHORA SÍ se guardan. */
  clientes?: any[];
  proveedores?: any[];
  compras?: any[];
  puntos_movimientos?: any[];
  /** Historial de crédito (cargos y abonos) de otras cajas. El saldo real del
   *  cliente viaja en `clientes`, ya recalculado por el trigger del servidor;
   *  esto es el rastro de por qué debe lo que debe. */
  movimientos_cuenta?: any[];
  /** Ajustes de stock de otras cajas. Llegan y se IGNORAN a propósito: la
   *  tabla `ajustes_inventario` del móvil tiene otra forma
   *  (stock_antes/stock_despues/motivo, sin `tipo` ni `usuario_pos_id`), así
   *  que no puede representarlos sin inventar datos. El stock en sí SÍ llega
   *  correcto, vía `productos`; lo que falta es el motivo del cambio.
   *  Alinear el esquema es tarea de la v29 (ver PENDIENTES.md). */
  ajustes_inventario?: any[];
  /** De qué se compone cada paquete. Sin esto el kit llegaba marcado como kit
   *  pero VACÍO: no se podía editar y venderlo no descontaba inventario. */
  kit_componentes?: any[];
  config?: any[];
  cotizaciones?: any[];
  cotizacion_lineas?: any[];
};

/** El stock viene como número. La tolerancia a texto se conserva por si el
 *  servidor regresa al bug de serializar los float como string: aceptar ambas
 *  formas no cuesta nada y evita poner el inventario en cero sin avisar. */
function num(v: any, porDefecto = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return porDefecto;
}

/** Claves de config que son de ESTA caja y jamás deben venir de la nube: si
 *  una viajara, otra caja podría desvincular este teléfono o robarle sesión. */
const CLAVES_NUNCA_SOBRESCRIBIR = new Set([
  "dispositivo_id",
  "dispositivo_token",
  "sesion_token",
  "negocio_id",
  "sync_desde",
  "sync_auto",
  "sync_error",
  CLAVE_LOTE_EN_VUELO,
]);

/** Claves de config que describen al NEGOCIO (viajan entre cajas) y SÍ deben
 *  subir a la nube. Espejo EXACTO de `COMPARTIDAS` en config.rs (PC) — si se
 *  añade una allá, hay que añadirla aquí también, o quedará atrapada en el
 *  teléfono que la cambió sin que ninguna otra caja se entere.
 *
 *  Todo lo que NO esté en esta lista se queda local a este aparato — mismo
 *  criterio que las preferencias de dispositivo en el PC (impresora, tema,
 *  calibración del escáner): si viajaran, configurar una caja cambiaría
 *  la de las demás. */
const CLAVES_CONFIG_COMPARTIDA = new Set([
  "lealtad_activa", "lealtad_pesos_por_punto", "lealtad_puntos_visita",
  "lealtad_valor_punto_centavos", "lealtad_tope_descuento_pct",
  "negocio_nombre", "negocio_direccion", "negocio_telefono", "negocio_rfc",
  "negocio_regimen_fiscal", "negocio_codigo_postal", "iva_tasa", "moneda",
  "mensaje_ticket", "impuesto_activo", "impuesto_nombre", "impuesto_modo",
  "impuesto_tasa",
  // Umbrales de Yaxo. Describen al NEGOCIO, no al aparato: "cuántos días sin
  // venderse cuenta como parado" es un juicio sobre esta tienda, y en una
  // ferretería no es lo mismo que en una abarrotería. Si no viajaran, el
  // dueño los ajustaría en el teléfono y la caja seguiría razonando con
  // otros números sobre el mismo negocio.
  "yaxo_dias_ventana_ritmo", "yaxo_ventas_minimas_ritmo",
  "yaxo_dias_cobertura_alerta", "yaxo_dias_sin_venta_parado",
  "yaxo_centavos_minimos_parado",
]);

/** Guarda una clave de config LOCAL y, si describe al negocio (está en
 *  CLAVES_CONFIG_COMPARTIDA), la encola para subir a la nube — puerto exacto
 *  de config.rs::set() del PC (misma lista blanca, mismo payload `{clave,
 *  valor}` sin `actualizado_en`, porque el PC tampoco lo manda — ver MAPA
 *  en sync.py: `actualizado_en` está en `update_cols`, así que omitirlo es
 *  seguro, simplemente no se toca esa columna en el UPDATE).
 *
 *  Usa ESTA función (no guardarConfig() a secas) para cualquier ajuste que
 *  el dueño/gerente cambie desde el móvil y que las demás cajas deban ver:
 *  datos del negocio, fiscales, impuesto, lealtad. Las preferencias de ESTE
 *  aparato (impresora, tema…) siguen usando guardarConfig() a secas.
 *
 *  El id de la cola es la CLAVE misma, no un uuid — la fila de `config` no
 *  tiene id propio, su identidad es la clave (mismo criterio que
 *  encolar_sync(&tx, "config", clave, "update", ...) en config.rs). */
export async function guardarConfigCompartida(clave: string, valor: string): Promise<void> {
  await guardarConfig(clave, valor);
  if (CLAVES_CONFIG_COMPARTIDA.has(clave)) {
    await encolar("config", clave, { clave, valor }, "update");
  }
}

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
  // filas que este teléfono puede no tener todavía. El servidor ya garantizó
  // su integridad; aquí solo somos un espejo. Se reactivan al terminar.
  await db.execAsync("PRAGMA foreign_keys = OFF;");

  try {
    await db.withTransactionAsync(async () => {
      // --- Categorías del negocio ---
      // `orden` e `icono` ahora sí se adoptan (antes se clavaban en 0/NULL,
      // así que reordenar departamentos en el PC nunca llegaba aquí).
      for (const c of d.categorias) {
        await db.runAsync(
          `INSERT INTO categorias
            (id, nombre, color, orden, icono, activo, eliminado, origen, creado_en, actualizado_en)
           VALUES (?,?,?,?,?,1,?, 'nube', ?,?)
           ON CONFLICT(id) DO UPDATE SET
             nombre = excluded.nombre,
             color = excluded.color,
             orden = excluded.orden,
             icono = excluded.icono,
             eliminado = excluded.eliminado,
             actualizado_en = excluded.actualizado_en
           WHERE excluded.actualizado_en >= categorias.actualizado_en`,
          [
            c.id, c.nombre, c.color ?? null, num(c.orden, 0), c.icono ?? null,
            c.eliminado ? 1 : 0, c.creado_en, c.actualizado_en,
          ]
        );
        aplicados++;
      }

      // --- Productos del negocio ---
      // El stock viene de la nube y se adopta: ya refleja las ventas de TODAS
      // las cajas (incluidas las nuestras, que ya subimos).
      //
      // `iva_tasa` SÍ se guarda ahora (migración v31 en db.ts). Antes se
      // ignoraba a propósito porque el móvil no tenía dónde guardarla —
      // ignorar un dato que no puedes almacenar es honesto, inventarlo no.
      // `cantidad_mayoreo` sigue sin guardarse: el móvil no implementa
      // mayoreo automático todavía.
      // `origen = 'nube'` en el UPDATE: si el producto vuelve del servidor,
      // es que YA forma parte del catálogo del negocio — deja de ser "creado
      // solo en este teléfono". Sin esa línea, `origen` se quedaba en
      // 'local' para siempre y hayCatalogoLocal() seguía contándolo, así que
      // la tarjeta "Agregar al catálogo del negocio" no se ocultaba nunca,
      // aunque ya se hubiera agregado. Se marca con la confirmación REAL del
      // servidor, no de forma optimista al encolar: si la subida falla, el
      // producto sigue siendo local y se reintenta.
      for (const p of d.productos) {
        await db.runAsync(
          `INSERT INTO productos
            (id, codigo_barras, nombre, categoria_id, precio_venta_centavos,
             costo_centavos, precio_mayoreo_centavos, controla_stock, stock,
             stock_minimo, unidad, favorito, es_kit, imagen_uri, iva_tasa, activo, eliminado, origen,
             creado_en, actualizado_en)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,1,?, 'nube', ?,?)
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
             favorito = excluded.favorito,
             es_kit = excluded.es_kit,
             iva_tasa = excluded.iva_tasa,
             eliminado = excluded.eliminado,
             origen = 'nube',
             actualizado_en = excluded.actualizado_en
           WHERE excluded.actualizado_en >= productos.actualizado_en`,
          [
            p.id, p.codigo_barras ?? null, p.nombre, p.categoria_id ?? null,
            num(p.precio_venta_centavos), num(p.costo_centavos),
            p.precio_mayoreo_centavos ?? null,
            p.controla_stock ? 1 : 0, num(p.stock), num(p.stock_minimo),
            p.unidad ?? "pieza",
            // favorito y es_kit se perdían: el primero ni se leía, el segundo
            // llegaba pero no se guardaba en el UPDATE.
            p.favorito ? 1 : 0, p.es_kit ? 1 : 0,
            num(p.iva_tasa, 0),
            p.eliminado ? 1 : 0, p.creado_en, p.actualizado_en,
          ]
        );
        aplicados++;
      }

      // --- Usuarios de otras cajas ---
      // Registro mínimo (sin PIN utilizable) para que las referencias existan
      // y los reportes muestren algo coherente. Se recorren TODAS las fuentes
      // con usuario_pos_id, incluida movimientos_caja (nueva).
      const idsUsuarios = new Set<string>();
      for (const s of d.caja_sesiones) if (s.usuario_pos_id) idsUsuarios.add(s.usuario_pos_id);
      for (const v of d.ventas) if (v.usuario_pos_id) idsUsuarios.add(v.usuario_pos_id);
      for (const m of (d.movimientos_caja ?? [])) if (m.usuario_pos_id) idsUsuarios.add(m.usuario_pos_id);
      for (const m of (d.movimientos_cuenta ?? [])) if (m.usuario_pos_id) idsUsuarios.add(m.usuario_pos_id);
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
      // NUNCA se toca pin_hash ni se activan: no se puede entrar como ellos en
      // este teléfono, solo se muestra quién vendió.
      for (const u of d.usuarios ?? []) {
        await db.runAsync(
          `INSERT INTO usuarios_pos
            (id, nombre, pin_hash, rol, activo, eliminado, creado_en, actualizado_en)
           VALUES (?, ?, '', ?, 0, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             nombre = excluded.nombre,
             rol = excluded.rol,
             eliminado = excluded.eliminado,
             actualizado_en = excluded.actualizado_en
           WHERE excluded.actualizado_en >= usuarios_pos.actualizado_en`,
          [
            u.id, u.nombre ?? "Otra caja",
            ["dueno", "gerente", "cajero"].includes(u.rol) ? u.rol : "cajero",
            u.eliminado ? 1 : 0,
            u.creado_en ?? ahoraSync, u.actualizado_en ?? ahoraSync,
          ]
        );
      }

      // --- Turnos de otras cajas (las ventas los referencian) ---
      // Los totales de arqueo faltaban por completo: un turno cerrado de otra
      // caja bajaba sin su corte, y el móvil no podía mostrarlo.
      for (const s of d.caja_sesiones) {
        await db.runAsync(
          `INSERT INTO caja_sesiones
            (id, usuario_pos_id, fondo_inicial_centavos, abierta_en, cerrada_en,
             total_efectivo_esperado_centavos, total_efectivo_contado_centavos,
             diferencia_centavos, estado, dispositivo_id, creado_en, actualizado_en)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             cerrada_en = excluded.cerrada_en,
             total_efectivo_esperado_centavos = excluded.total_efectivo_esperado_centavos,
             total_efectivo_contado_centavos = excluded.total_efectivo_contado_centavos,
             diferencia_centavos = excluded.diferencia_centavos,
             estado = excluded.estado,
             dispositivo_id = excluded.dispositivo_id,
             actualizado_en = excluded.actualizado_en
           WHERE excluded.actualizado_en >= caja_sesiones.actualizado_en`,
          [
            s.id, s.usuario_pos_id, num(s.fondo_inicial_centavos), s.abierta_en,
            s.cerrada_en ?? null,
            s.total_efectivo_esperado_centavos ?? null,
            s.total_efectivo_contado_centavos ?? null,
            s.diferencia_centavos ?? null,
            s.estado, s.dispositivo_id ?? null, s.abierta_en, s.actualizado_en,
          ]
        );
        aplicados++;
      }

      // --- Ventas de otras cajas (para reportes completos del negocio) ---
      for (const v of d.ventas) {
        await db.runAsync(
          `INSERT INTO ventas
            (id, caja_sesion_id, usuario_pos_id, folio, cliente_id, subtotal_centavos,
             descuento_centavos, iva_centavos, total_centavos, estado, origen,
             creado_en, actualizado_en)
           VALUES (?,?,?,?,?,?,?,?,?,?, 'nube', ?,?)
           ON CONFLICT(id) DO UPDATE SET
             estado = excluded.estado,
             cliente_id = excluded.cliente_id,
             actualizado_en = excluded.actualizado_en
           WHERE excluded.actualizado_en >= ventas.actualizado_en`,
          [
            v.id, v.caja_sesion_id, v.usuario_pos_id, v.folio,
            // Sin esto, una venta a crédito de otra caja bajaba sin saberse
            // de quién era la deuda.
            v.cliente_id ?? null,
            num(v.subtotal_centavos), num(v.descuento_centavos),
            num(v.iva_centavos), num(v.total_centavos), v.estado,
            v.creado_en, v.actualizado_en,
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
            // producto_id es nullable: una línea de pedido web ("Envío a
            // domicilio") o de un producto ya borrado no apunta a nada.
            l.id, l.venta_id, l.producto_id ?? null, l.descripcion, num(l.cantidad),
            num(l.precio_unitario_centavos), num(l.costo_unitario_centavos),
            num(l.descuento_linea_centavos),
            num(l.total_linea_centavos), l.creado_en,
          ]
        );
      }

      // Puerto exacto de las columnas de MAPA["pagos"] en sync.py — antes se
      // ignoraban `recibido_centavos`, `cambio_centavos` y `actualizado_en`
      // aunque el servidor ya los mandaba (existían desde antes de que el
      // móvil supiera guardarlos localmente, migración v33). Sin esto, un
      // pago mixto hecho en OTRA caja llegaba aquí con el detalle real
      // descartado en silencio — mismo patrón que las entidades huérfanas.
      for (const pg of d.pagos) {
        await db.runAsync(
          `INSERT INTO pagos (id, venta_id, metodo, monto_centavos, recibido_centavos, cambio_centavos, creado_en, actualizado_en)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO NOTHING`,
          [
            pg.id, pg.venta_id, pg.metodo, num(pg.monto_centavos),
            pg.recibido_centavos ?? null, pg.cambio_centavos ?? null,
            pg.creado_en, pg.actualizado_en ?? pg.creado_en,
          ]
        );
      }

      // --- Movimientos de caja de otras cajas ---
      // Entradas y salidas de efectivo que no son ventas. Sin esto el corte
      // del negocio no cuadra cuando hay más de una caja.
      for (const m of (d.movimientos_caja ?? [])) {
        await db.runAsync(
          `INSERT INTO movimientos_caja
            (id, caja_sesion_id, tipo, motivo, monto_centavos, usuario_pos_id,
             creado_en, actualizado_en)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO NOTHING`,
          [
            m.id, m.caja_sesion_id,
            m.tipo === "entrada" ? "entrada" : "salida",
            m.motivo ?? null, num(m.monto_centavos), m.usuario_pos_id ?? null,
            m.creado_en, m.actualizado_en ?? m.creado_en,
          ]
        );
        aplicados++;
      }

      // --- Devoluciones de otras cajas ---
      // Puerto exacto del bloque equivalente en sync_pull.rs (PC).
      // `metodo_reembolso` distingue lo que salió del cajón de lo que se
      // reembolsó por tarjeta o crédito: el corte lo necesita para no
      // restar dos veces (o de más) del efectivo esperado.
      //
      // Son tablas ESPEJO por ahora: el móvil no CREA devoluciones todavía
      // (eso es una pantalla completa — hoy solo recibe las de otras cajas,
      // que es lo que hacía falta para que el corte del negocio cuadre).
      for (const dv of (d.devoluciones ?? [])) {
        await db.runAsync(
          `INSERT INTO devoluciones
            (id, venta_id, caja_sesion_id, usuario_pos_id, motivo,
             metodo_reembolso, total_devuelto_centavos, creado_en, actualizado_en)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO NOTHING`,
          [
            dv.id, dv.venta_id, dv.caja_sesion_id, dv.usuario_pos_id ?? null,
            dv.motivo ?? null, dv.metodo_reembolso ?? null,
            num(dv.total_devuelto_centavos),
            dv.creado_en, dv.actualizado_en ?? dv.creado_en,
          ]
        );
        aplicados++;
      }

      // --- Líneas de esas devoluciones ---
      // OJO, mismo criterio que el PC (sync_pull.rs): estas filas son ESPEJO
      // para reportes. NO se reingresa stock aquí aunque `reingresa_stock`
      // sea 1 — el stock ya llegó neto en el bloque de productos, calculado
      // por la caja que hizo la devolución y ya subido. Reingresarlo aquí
      // lo duplicaría.
      for (const dl of (d.devolucion_lineas ?? [])) {
        await db.runAsync(
          `INSERT INTO devolucion_lineas
            (id, devolucion_id, venta_linea_id, cantidad, monto_centavos, reingresa_stock)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(id) DO NOTHING`,
          [
            dl.id, dl.devolucion_id, dl.venta_linea_id,
            num(dl.cantidad), num(dl.monto_centavos),
            dl.reingresa_stock ? 1 : 0,
          ]
        );
      }

      // --- Clientes del negocio (compartidos) ---
      // `puntos` es el saldo REAL que calculó el trigger del servidor: se
      // adopta tal cual, nunca se suma aquí.
      for (const cli of (d.clientes ?? [])) {
        await db.runAsync(
          `INSERT INTO clientes
            (id, codigo, nombre, telefono, correo, notas, puntos,
             limite_credito_centavos, saldo_centavos, eliminado, creado_en, actualizado_en)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             codigo = excluded.codigo, nombre = excluded.nombre,
             telefono = excluded.telefono, correo = excluded.correo,
             notas = excluded.notas, puntos = excluded.puntos,
             limite_credito_centavos = excluded.limite_credito_centavos,
             saldo_centavos = excluded.saldo_centavos,
             eliminado = excluded.eliminado, actualizado_en = excluded.actualizado_en
           WHERE excluded.actualizado_en >= clientes.actualizado_en`,
          [
            cli.id, cli.codigo ?? null, cli.nombre, cli.telefono ?? null,
            cli.correo ?? null, cli.notas ?? null, num(cli.puntos),
            // Estas dos se DESCARTABAN, con un comentario que decía que el
            // móvil no tenía columnas de crédito. La migración v28 las añadió
            // y el comentario quedó viejo: fiabas en el PC y aquí el cliente
            // salía con saldo cero, así que se le podía volver a fiar pasado
            // de su límite.
            num(cli.limite_credito_centavos), num(cli.saldo_centavos),
            cli.eliminado ? 1 : 0, cli.creado_en, cli.actualizado_en,
          ]
        );
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
             actualizado_en = excluded.actualizado_en
           WHERE excluded.actualizado_en >= proveedores.actualizado_en`,
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
             eliminado = excluded.eliminado, actualizado_en = excluded.actualizado_en
           WHERE excluded.actualizado_en >= compras.actualizado_en`,
          [
            c.id, c.proveedor_id ?? null, c.proveedor_nombre ?? null,
            c.folio ?? null, c.fecha ?? null, c.tipo ?? "normal",
            num(c.total_centavos), num(c.num_lineas), c.origen ?? "manual",
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
          [m.id, m.cliente_id, m.venta_id ?? null, m.tipo, num(m.puntos), m.nota ?? null, m.creado_en]
        );
        // El saldo real ya llegó en el bloque de `clientes`; este insert es
        // solo para que el historial muestre el movimiento de la otra caja.
        aplicados++;
      }

      // --- Cotizaciones del negocio (de cualquier caja) ---
      // DO UPDATE en todo el estado: una cotización SÍ cambia después de
      // creada (se cancela, vence, o se convierte en venta desde otro
      // dispositivo).
      for (const cot of (d.cotizaciones ?? [])) {
        await db.runAsync(
          // `origen = 'nube'`: marca las cotizaciones de OTRAS cajas para que
          // no entren en el contador de folio de esta (ver siguienteFolio()
          // en cotizaciones.ts). Mismo patrón que ventas.
          `INSERT INTO cotizaciones
            (id, folio, cliente_nombre, cliente_telefono, cliente_correo, notas,
             subtotal_centavos, descuento_centavos, total_centavos, valida_hasta,
             estado, venta_id, eliminado, origen, creado_en, actualizado_en)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'nube', ?,?)
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
             actualizado_en = excluded.actualizado_en
           WHERE excluded.actualizado_en >= cotizaciones.actualizado_en`,
          [
            cot.id, cot.folio, cot.cliente_nombre ?? null, cot.cliente_telefono ?? null,
            cot.cliente_correo ?? null, cot.notas ?? null, num(cot.subtotal_centavos),
            num(cot.descuento_centavos), num(cot.total_centavos), cot.valida_hasta ?? null,
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
            l.id, l.cotizacion_id, l.producto_id ?? null, l.descripcion, num(l.cantidad),
            num(l.precio_unitario_centavos), num(l.descuento_linea_centavos),
            num(l.total_linea_centavos), l.creado_en,
          ]
        );
      }

      // --- Historial de crédito de otras cajas ---
      // Solo-inserción: un movimiento no se edita, existe o no. El saldo del
      // cliente NO se recalcula aquí — ya llegó bueno en el bloque de
      // `clientes`, calculado por el trigger sobre TODA la bitácora del
      // negocio. Sumarlo otra vez en local lo duplicaría.
      for (const m of (d.movimientos_cuenta ?? [])) {
        await db.runAsync(
          `INSERT INTO movimientos_cuenta
            (id, cliente_id, tipo, monto_centavos, venta_id, metodo,
             saldo_resultante_centavos, motivo, usuario_pos_id, caja_sesion_id,
             creado_en, actualizado_en)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO NOTHING`,
          [
            m.id, m.cliente_id,
            m.tipo === "abono" ? "abono" : "cargo",
            num(m.monto_centavos), m.venta_id ?? null,
            ["efectivo", "tarjeta", "transferencia"].includes(m.metodo) ? m.metodo : null,
            num(m.saldo_resultante_centavos), m.motivo ?? null,
            m.usuario_pos_id ?? null, m.caja_sesion_id ?? null,
            m.creado_en, m.actualizado_en ?? m.creado_en,
          ]
        );
        aplicados++;
      }

      // --- Componentes de los kits del negocio ---
      // Con DO UPDATE: editar un kit reemplaza su lista, y las piezas que se
      // quitan llegan con eliminado = 1. Si solo insertáramos, este teléfono
      // se quedaría con la lista vieja y descontaría stock de más.
      //
      // El servidor manda `producto_componente_id` (nombre canónico); la
      // tabla local la llama `producto_id`. Se traduce aquí.
      for (const k of (d.kit_componentes ?? [])) {
        await db.runAsync(
          `INSERT INTO kit_componentes
            (id, kit_id, producto_id, cantidad, eliminado, creado_en, actualizado_en)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             cantidad = excluded.cantidad,
             eliminado = excluded.eliminado,
             actualizado_en = excluded.actualizado_en
           WHERE excluded.actualizado_en >= kit_componentes.actualizado_en`,
          [
            k.id, k.kit_id, k.producto_componente_id, num(k.cantidad, 1),
            k.eliminado ? 1 : 0, k.creado_en, k.actualizado_en ?? k.creado_en,
          ]
        );
        aplicados++;
      }

      // --- Config del negocio (lealtad, IVA, datos fiscales…) ---
      // El servidor ya filtra con lista blanca, pero aquí se blindan también
      // las claves que identifican a ESTE teléfono: si una de ellas viajara,
      // otra caja podría desvincularlo o robarle la sesión.
      for (const cfg of (d.config ?? [])) {
        if (!cfg.clave || CLAVES_NUNCA_SOBRESCRIBIR.has(cfg.clave)) continue;
        await db.runAsync(
          `INSERT INTO config (clave, valor) VALUES (?, ?)
           ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
          [cfg.clave, cfg.valor ?? null]
        );
        aplicados++;
      }
    });
  } finally {
    await db.execAsync("PRAGMA foreign_keys = ON;");
  }

  // Avanzar la marca solo si cambió.
  if (d.hasta && d.hasta !== desde) {
    await guardarConfig("sync_desde", d.hasta);
  } else if (d.hay_mas) {
    // El servidor dice que hay más pero la marca no avanzó: seguir pidiendo
    // sería un bucle infinito sobre la misma página.
    throw new Error(
      "El servidor indica más páginas pero la marca no avanza. Sincronización detenida."
    );
  }

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
  let errorSubida: string | null = null;

  try {
    // 1. SUBIR primero (en vueltas, hasta vaciar la cola): así lo nuestro ya
    //    cuenta cuando bajemos el stock.
    //
    //    Si subir() lanza (un lote roto, sin red), se recuerda el error pero
    //    se sigue a bajar de todos modos: antes la función entera se detenía
    //    ahí y un solo turno mal encolado bloqueaba para siempre que el
    //    catálogo del negocio llegara al teléfono.
    //
    //    El corte de vuelta ahora es por progreso, no solo por contador: si
    //    una pasada no aplicó NADA, insistir no va a cambiar el resultado
    //    (lo que queda está diferido esperando otra pasada, o descartado).
    let vueltasSubida = 0;
    while (vueltasSubida < 10) {
      try {
        const n = await subir(cuenta);
        subidas += n;
        vueltasSubida++;
        if (n === 0) break; // nada aplicado: no hay progreso que exprimir
      } catch (e: any) {
        errorSubida = e?.message ?? String(e);
        break;
      }
    }

    // 2. BAJAR (en páginas si hace falta) — corre SIEMPRE.
    let vueltas = 0;
    let hayMas = true;
    while (hayMas && vueltas < 10) {
      const r = await bajar(cuenta);
      bajados += r.aplicados;
      hayMas = r.hayMas;
      vueltas++;
    }

    await guardarConfig("ultima_sync", ahoraISO());
    // Solo se limpia el error si no hubo ninguno: si subir() dejó
    // operaciones descartadas, ese aviso ya se escribió y no debe borrarse.
    if (!errorSubida) {
      const previo = await leerConfig("sync_error");
      if (!previo || !previo.includes("rechazadas")) {
        await guardarConfig("sync_error", "");
      }
    } else {
      await guardarConfig("sync_error", errorSubida);
    }
    return errorSubida
      ? { ok: false, subidas, bajados, error: errorSubida }
      : { ok: true, subidas, bajados };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await guardarConfig("sync_error", msg);
    return { ok: false, subidas, bajados, error: msg };
  } finally {
    _sincronizando = false;
  }
}

/** Dispara un sync tras cobrar, sin bloquear la venta. Si ya hay uno en
 *  curso, sincronizar() lo detecta y sale sin hacer nada.
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

/** Tras vincular una cuenta, encola lo que ya existía en local y que la nube
 *  necesitará: el turno abierto Y el catálogo (categorías y productos) creado
 *  ANTES de vincular. Sin esto, todo lo que se armó offline se queda huérfano
 *  para siempre — encolar() es un no-op sin cuenta, así que nada de eso se
 *  encoló nunca por su cuenta. */
// ---------------------------------------------------------------------------
// Detector de conflictos de catálogo al vincular — PENDIENTES.md punto 32.
//
// ANTES: ModalSync.tsx preguntaba UNA sola vez, en bloque, "¿archivas TODOS
// tus productos locales y adoptas los del negocio?" — un Alert.alert() sin
// comparar nada. Un dueño con 50 productos reales en el teléfono y otros 50
// distintos en su PC perdía (archivaba) los 50 del teléfono sin que nadie
// le preguntara CUÁLES de verdad chocaban con cuáles.
//
// AHORA: se compara producto por producto. Lo que NO coincide con nada del
// negocio no es un conflicto — es catálogo nuevo, y sube solo, sin
// preguntar (mismo criterio que ya pediste: "lo que no choca se fusiona
// solo"). Solo lo que SÍ coincide (mismo código de barras, o si no hay
// código, mismo nombre) genera una decisión real: ¿cuál de las dos
// versiones se queda?
//
// Departamentos NO llevan este mismo picker — un nombre repetido
// ("Bebidas" local y "Bebidas" del negocio) no tiene datos en conflicto
// que valga la pena decidir uno por uno, así que se fusiona solo
// (fusionarDepartamentosDuplicados). Ventas tampoco: son historial, nunca
// "chocan" entre sí, simplemente coexisten.
// ---------------------------------------------------------------------------

export type ConflictoProducto = {
  localId: string;
  remotoId: string;
  coincidePor: "codigo_barras" | "nombre";
  local: {
    nombre: string;
    codigo_barras: string | null;
    precio_venta_centavos: number;
    stock: number;
  };
  remoto: {
    nombre: string;
    codigo_barras: string | null;
    precio_venta_centavos: number;
    stock: number;
  };
};

/** Compara el catálogo LOCAL (creado en este teléfono, todavía sin subir)
 *  contra el del NEGOCIO (ya bajado por sync) y detecta coincidencias.
 *  Primero por código de barras (si los dos lo tienen); si no, por nombre
 *  normalizado. Devuelve SOLO los choques reales — nada más. */
export async function detectarConflictosCatalogo(): Promise<ConflictoProducto[]> {
  const db = await bd();
  const locales = await db.getAllAsync<any>(
    "SELECT * FROM productos WHERE origen = 'local' AND eliminado = 0"
  );
  if (locales.length === 0) return [];
  // Ojo con el "eliminado": aquí NO se filtra a propósito.
  //
  // Un producto del negocio que este teléfono tiene borrado sigue ocupando
  // su código en el catálogo compartido. Al ignorarlo, un producto local con
  // ese mismo código no se detectaba como coincidencia y se subía tal cual,
  // dejando DOS artículos con el mismo código en el negocio — pasó de verdad
  // con CO9. Incluyéndolo, el dueño decide en vez de que ocurra a escondidas,
  // y al elegir "este teléfono" se reutiliza esa fila en lugar de crear otra.
  const remotos = await db.getAllAsync<any>(
    "SELECT * FROM productos WHERE origen != 'local'"
  );
  if (remotos.length === 0) return [];

  const porCodigo = new Map<string, any>();
  const porNombre = new Map<string, any>();
  for (const r of remotos) {
    const cb = String(r.codigo_barras ?? "").trim();
    if (cb) porCodigo.set(cb, r);
    porNombre.set(String(r.nombre ?? "").trim().toLowerCase(), r);
  }

  const conflictos: ConflictoProducto[] = [];
  for (const l of locales) {
    const cbLocal = String(l.codigo_barras ?? "").trim();
    let match: any = null;
    let via: "codigo_barras" | "nombre" | null = null;
    if (cbLocal && porCodigo.has(cbLocal)) {
      match = porCodigo.get(cbLocal);
      via = "codigo_barras";
    } else {
      const clave = String(l.nombre ?? "").trim().toLowerCase();
      if (clave && porNombre.has(clave)) {
        match = porNombre.get(clave);
        via = "nombre";
      }
    }
    if (match && via) {
      conflictos.push({
        localId: l.id,
        remotoId: match.id,
        coincidePor: via,
        local: {
          nombre: l.nombre, codigo_barras: l.codigo_barras,
          precio_venta_centavos: l.precio_venta_centavos, stock: l.stock,
        },
        remoto: {
          nombre: match.nombre, codigo_barras: match.codigo_barras,
          precio_venta_centavos: match.precio_venta_centavos, stock: match.stock,
        },
      });
    }
  }
  return conflictos;
}

export type DecisionConflicto = "local" | "remoto";

/** Resuelve UN conflicto ya detectado.
 *
 *  "remoto" gana: los datos del negocio se quedan tal cual — no hay nada
 *  que tocar en esa fila. Solo se archiva el duplicado local.
 *
 *  "local" gana: los datos del teléfono se copian a la fila del negocio
 *  (mismo id, mismo historial de ventas que ya lo referencian) y se
 *  encolan para subir. El duplicado local también se archiva — ya quedó
 *  fusionado dentro de la fila "oficial" del negocio.
 *
 *  En los dos casos el producto local desaparece de la lista de
 *  pendientes por resolver, pero NUNCA se borra: mismo criterio de
 *  archivarCatalogoLocal(), solo que aquí el motivo queda registrado como
 *  "conflicto_resuelto_<decisión>", no "adopcion_catalogo_negocio". */
export async function resolverConflictoProducto(
  c: ConflictoProducto,
  decision: DecisionConflicto
): Promise<void> {
  const db = await bd();
  const ahora = ahoraISO();

  if (decision === "local") {
    const l = await db.getFirstAsync<any>("SELECT * FROM productos WHERE id = ?", [c.localId]);
    if (!l) throw new Error("El producto local ya no existe.");
    await db.runAsync(
      `UPDATE productos SET
         eliminado = 0,
         nombre = ?, codigo_barras = ?, categoria_id = ?,
         precio_venta_centavos = ?, costo_centavos = ?, precio_mayoreo_centavos = ?,
         controla_stock = ?, stock = ?, unidad = ?, stock_minimo = ?,
         iva_tasa = ?, favorito = ?, es_kit = ?, actualizado_en = ?
       WHERE id = ?`,
      [
        l.nombre, l.codigo_barras, l.categoria_id,
        l.precio_venta_centavos, l.costo_centavos, l.precio_mayoreo_centavos,
        l.controla_stock, l.stock, l.unidad, l.stock_minimo,
        l.iva_tasa, l.favorito, l.es_kit, ahora,
        c.remotoId,
      ]
    );
    await encolar("productos", c.remotoId, {
      // eliminado: 0 — la fila del negocio puede estar borrada en este
      // teléfono; al quedarse con la versión local se reutiliza esa misma
      // fila (mismo id) en vez de crear una nueva con el código repetido.
      id: c.remotoId, eliminado: 0, nombre: l.nombre, codigo_barras: l.codigo_barras,
      categoria_id: l.categoria_id, precio_venta_centavos: l.precio_venta_centavos,
      costo_centavos: l.costo_centavos, precio_mayoreo_centavos: l.precio_mayoreo_centavos,
      controla_stock: l.controla_stock, stock: l.stock, unidad: l.unidad,
      stock_minimo: l.stock_minimo, iva_tasa: l.iva_tasa, favorito: l.favorito,
      es_kit: l.es_kit, actualizado_en: ahora,
    }, "update");
  }

  const paraArchivar = await db.getFirstAsync<any>(
    "SELECT * FROM productos WHERE id = ?",
    [c.localId]
  );
  if (paraArchivar) {
    await db.runAsync(
      `INSERT INTO productos_archivados (id, datos_json, archivado_en, motivo)
       VALUES (?,?,?,?)
       ON CONFLICT(id) DO NOTHING`,
      [c.localId, JSON.stringify(paraArchivar), ahora, `conflicto_resuelto_${decision}`]
    );
    await db.runAsync(
      "UPDATE productos SET eliminado = 1, actualizado_en = ? WHERE id = ?",
      [ahora, c.localId]
    );
  }

  // Colapsar CUALQUIER otro producto que comparta el código del ganador.
  //
  // BUG REAL encontrado en pruebas: el mapa del detector guarda un solo
  // producto remoto por código (`porCodigo.set(cb, r)`), así que si el
  // negocio tenía DOS productos con el mismo código —cosa que llegó a pasar
  // por el bug de subida que ya se corrigió— solo se ofrecía uno para
  // decidir. Se resolvía ese, y el otro seguía vivo: el catálogo quedaba
  // con dos artículos del mismo código para siempre, y el lector de barras
  // no sabía cuál escanear.
  //
  // Aquí se archiva todo lo que sobre, dejando en pie SOLO al ganador
  // (c.remotoId, que a estas alturas ya tiene los datos elegidos). Se encola
  // el borrado para que la limpieza llegue también a las demás cajas.
  const ganador = await db.getFirstAsync<{ codigo_barras: string | null }>(
    "SELECT codigo_barras FROM productos WHERE id = ?",
    [c.remotoId]
  );
  const cbGanador = String(ganador?.codigo_barras ?? "").trim();
  if (cbGanador) {
    const sobrantes = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM productos
        WHERE codigo_barras = ? AND eliminado = 0 AND id <> ? AND id <> ?`,
      [cbGanador, c.remotoId, c.localId]
    );
    for (const sob of sobrantes) {
      await db.runAsync(
        "UPDATE productos SET eliminado = 1, actualizado_en = ? WHERE id = ?",
        [ahora, sob.id]
      );
      await encolar(
        "productos",
        sob.id,
        { id: sob.id, eliminado: 1, actualizado_en: ahora },
        "update"
      );
    }
  }
}

/** Resuelve TODOS los conflictos detectados con la misma decisión — atajo
 *  para cuando el dueño ya sabe qué prefiere en general ("quédate con todo
 *  lo del negocio" / "quédate con todo lo de este teléfono") y no quiere
 *  revisar producto por producto. Sigue siendo reversible: cada uno se
 *  archiva, ninguno se borra. */
export async function resolverTodosLosConflictos(
  conflictos: ConflictoProducto[],
  decision: DecisionConflicto
): Promise<void> {
  for (const c of conflictos) {
    await resolverConflictoProducto(c, decision);
  }
}

/** Departamentos: a diferencia de productos, no hace falta preguntar uno
 *  por uno — un nombre repetido ("Bebidas" local y "Bebidas" del negocio)
 *  no tiene datos en conflicto que valga la pena decidir, así que se
 *  fusiona solo: el local se archiva, el del negocio se queda con todos
 *  sus productos ya reasignados por el propio servidor (los productos
 *  apuntan a categoria_id, no al nombre). Devuelve cuántos se fusionaron.
 *
 *  Se llama SIEMPRE, sin preguntar — es la única pieza de este bloque que
 *  no necesita una pantalla, solo un aviso informativo después. */
export async function fusionarDepartamentosDuplicados(): Promise<number> {
  const db = await bd();
  const locales = await db.getAllAsync<any>(
    "SELECT * FROM categorias WHERE origen = 'local' AND eliminado = 0"
  );
  if (locales.length === 0) return 0;
  const remotas = await db.getAllAsync<any>(
    "SELECT * FROM categorias WHERE origen != 'local' AND eliminado = 0"
  );
  const nombresRemotos = new Set(
    remotas.map((r: any) => String(r.nombre ?? "").trim().toLowerCase())
  );
  const ahora = ahoraISO();
  let n = 0;
  for (const l of locales) {
    const clave = String(l.nombre ?? "").trim().toLowerCase();
    if (clave && nombresRemotos.has(clave)) {
      await db.runAsync(
        "UPDATE categorias SET eliminado = 1, actualizado_en = ? WHERE id = ?",
        [ahora, l.id]
      );
      n++;
    }
  }
  return n;
}

/** Sube a la nube SOLO el turno de caja abierto. Se llama justo al vincular
 *  (ModalCuenta): el turno tiene que existir en la nube antes que cualquier
 *  venta suya, o el servidor las rechaza por clave foránea.
 *
 *  ⚠️ ANTES ESTA FUNCIÓN TAMBIÉN SUBÍA TODO EL CATÁLOGO LOCAL, y eso causó
 *  un bug real y grave encontrado en pruebas: al vincular, ModalCuenta la
 *  llamaba de inmediato, sin que existiera todavía ninguna comprobación de
 *  conflictos (y a veces ni siquiera había llegado aún el catálogo del
 *  negocio contra el cual comparar). Un producto local con el mismo código
 *  de barras que uno del negocio se subía igual, creando en el servidor una
 *  SEGUNDA fila con ese mismo código — el PC terminaba con dos productos
 *  idénticos y el lector de barras ya no sabía cuál escanear. La pantalla
 *  de "coincidencias de catálogo" aparecía después, con el daño ya hecho.
 *
 *  La subida del catálogo vive ahora en subirCatalogoLocal(), que SOLO se
 *  llama desde el flujo de ModalSync — después de haber detectado y
 *  resuelto los conflictos. Mismo reparto que en el PC. */
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

/** Sube el catálogo creado EN ESTE TELÉFONO (categorías y productos con
 *  `origen = 'local'`) al catálogo compartido del negocio.
 *
 *  ⚠️ NO LLAMAR DIRECTO AL VINCULAR. Esta función asume que quien la llama
 *  YA comprobó que no hay conflictos pendientes (ver ModalSync:
 *  revisarCatalogo → detectarConflictosCatalogo → fusionarLoQueNoChoca).
 *  Subir sin esa comprobación duplica en el servidor cualquier producto que
 *  choque por código de barras — ver el comentario de prepararTrasVincular.
 *
 *  Como segunda red de seguridad, aquí se vuelven a excluir los productos
 *  que ahora mismo chocan con uno del negocio: si alguna pantalla futura
 *  llama a esto por error, el daño no puede ocurrir de todas formas. */
export async function subirCatalogoLocal(): Promise<void> {
  const db = await bd();
  const ahora = ahoraISO();

  // Categorías locales sin subir. `origen = 'local'` es la marca que ya
  // existe para esto (migración v7): lo creado en este teléfono, no lo bajado.
  const categorias = await db.getAllAsync<any>(
    "SELECT * FROM categorias WHERE origen = 'local' AND eliminado = 0"
  );
  for (const c of categorias) {
    await encolar("categorias", c.id, {
      id: c.id,
      nombre: c.nombre,
      color: c.color,
      // orden e icono SÍ existen en el móvil y ahora también en Postgres:
      // mandarlos evita que el orden que armó el usuario se pierda al vincular.
      orden: c.orden ?? 0,
      icono: c.icono ?? null,
      eliminado: c.eliminado,
      creado_en: c.creado_en,
      actualizado_en: c.actualizado_en ?? ahora,
    });
  }

  // Productos locales sin subir.
  //
  // `iva_tasa` SÍ se manda ahora — el móvil ya la guarda (migración v31 en
  // db.ts). Antes se omitía a propósito: no existía la columna, y mandar
  // `iva_tasa: 0` fijo "porque el backend la espera así" era destructivo, el
  // servidor lo tomaba como dato bueno y PISABA el IVA real que había puesto
  // el PC — vincular un teléfono ponía en cero el IVA de todo el negocio.
  // `cantidad_mayoreo` sigue sin mandarse: el móvil no implementa mayoreo
  // automático todavía. La regla general se mantiene para lo que sí falta:
  // omitir una columna que no tienes es seguro; afirmar un valor que no
  // tienes, no.
  const productos = await db.getAllAsync<any>(
    "SELECT * FROM productos WHERE origen = 'local' AND eliminado = 0"
  );
  // Red de seguridad (ver el aviso de esta función): un producto que ahora
  // mismo choca con uno del negocio NO se sube — subirlo es exactamente lo
  // que creaba el duplicado en el servidor. Se queda esperando a que el
  // dueño decida en la pantalla de coincidencias.
  const enConflicto = new Set(
    (await detectarConflictosCatalogo()).map((c) => c.localId)
  );

  for (const p of productos) {
    if (enConflicto.has(p.id)) continue;
    await encolar("productos", p.id, {
      id: p.id,
      codigo_barras: p.codigo_barras,
      nombre: p.nombre,
      categoria_id: p.categoria_id,
      precio_venta_centavos: p.precio_venta_centavos,
      costo_centavos: p.costo_centavos,
      precio_mayoreo_centavos: p.precio_mayoreo_centavos,
      controla_stock: p.controla_stock,
      stock: p.stock,
      unidad: p.unidad,
      stock_minimo: p.stock_minimo,
      iva_tasa: p.iva_tasa,
      favorito: p.favorito,
      es_kit: p.es_kit,
      eliminado: p.eliminado,
      creado_en: p.creado_en,
      actualizado_en: p.actualizado_en ?? ahora,
    });
  }
}

/** EL CATALOGO NO SUBIA AL CAMBIAR DE CUENTA — ESTO LO ARREGLA
 *  -------------------------------------------------------------------------
 *  Cuando un producto se sube a un negocio y vuelve del servidor, se marca
 *  `origen = 'nube'` (ver el UPDATE de productos en bajar()). Eso es correcto:
 *  ya forma parte del catalogo de ESE negocio.
 *
 *  El problema era lo que NO pasaba despues. `cerrarSesion()` borra las claves
 *  de la cuenta pero no toca `origen`, asi que los productos se quedaban en
 *  'nube' para siempre. Al vincular a OTRA cuenta:
 *
 *    - `subirCatalogoLocal()` filtra por `origen = 'local'`, no los
 *      seleccionaba, y el catalogo nunca se encolaba.
 *    - `hayCatalogoLocal()` usa el mismo filtro, devolvia 0, y la tarjeta
 *      "Agregar al catalogo del negocio" ni siquiera aparecia.
 *
 *  Resultado: el catalogo se quedaba sin subir EN SILENCIO y el usuario no
 *  tenia forma de darse cuenta ni de forzarlo a mano.
 *
 *  POR QUE NO SE SUBE SOLO
 *  Esta funcion NO encola nada. Solo devuelve los productos a 'local' para que
 *  reaparezca la tarjeta y decida el usuario. Subirlos automaticamente seria
 *  peor que el bug: si el telefono trae el catalogo del negocio A y se vincula
 *  al negocio B de otro dueno, estariamos filtrando el catalogo de A a B sin
 *  que nadie lo autorice. Devolverlos a 'local' reusa lo que ya existe —
 *  deteccion de conflictos, fusion de departamentos y archivarCatalogoLocal()
 *  para decir que no.
 *
 *  Es idempotente: si el negocio no cambio, no hace nada. En la primera
 *  vinculacion tampoco, porque no hay negocio anterior con el que comparar. */
const CLAVE_ULTIMO_NEGOCIO = "ultimo_negocio_sync";

export async function readaptarCatalogoSiCambioNegocio(): Promise<number> {
  const negocioActual = (await leerConfig("negocio_id") ?? "").trim();
  // Sin cuenta vinculada no hay nada que readaptar.
  if (!negocioActual) return 0;

  const anterior = (await leerConfig(CLAVE_ULTIMO_NEGOCIO) ?? "").trim();

  // Primera vinculacion de esta instalacion: solo se deja constancia. Lo que
  // haya en el telefono ya es 'local' si nunca se sincronizo.
  if (!anterior) {
    await guardarConfig(CLAVE_ULTIMO_NEGOCIO, negocioActual);
    return 0;
  }

  // Mismo negocio (desvincular y volver a vincular la misma cuenta): nada que
  // hacer. Los productos siguen perteneciendo a donde ya estan.
  if (anterior === negocioActual) return 0;

  const db = await bd();

  // `actualizado_en` NO se toca: cambiar el origen es contabilidad interna de
  // este telefono, no una edicion del producto. Si se tocara, el reloj de
  // ultima modificacion pisaria al del servidor en la proxima bajada.
  const rp = await db.runAsync(
    "UPDATE productos SET origen = 'local' WHERE origen = 'nube' AND eliminado = 0"
  );
  await db.runAsync(
    "UPDATE categorias SET origen = 'local' WHERE origen = 'nube' AND eliminado = 0"
  );

  await guardarConfig(CLAVE_ULTIMO_NEGOCIO, negocioActual);
  return rp.changes ?? 0;
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

/** Las operaciones que el servidor apartó, con su motivo. Para que la UI
 *  pueda avisarle al dueño en vez de callarlo. */
export async function listarApartadas(): Promise<
  { entidad: string; entidad_id: string; ultimo_error: string | null }[]
> {
  const db = await bd();
  return db.getAllAsync(
    `SELECT entidad, entidad_id, ultimo_error FROM cola_sync
     WHERE intentos >= ? ORDER BY id LIMIT 100`,
    [LIMITE_INTENTOS]
  );
}

/** Reintenta TODO lo apartado. Es MANUAL a propósito: antes esto corría solo
 *  en cada pasada, y con el contrato nuevo eso resucitaría en bucle infinito
 *  las operaciones que el servidor descartó por inválidas.
 *
 *  Ojo: esto NO repara payloads. Una operación descartada por faltarle una
 *  columna obligatoria volverá a descartarse igual — su `ultimo_error` dice
 *  exactamente qué le falta. */
export async function reintentarTodo(): Promise<number> {
  const db = await bd();
  await db.runAsync(
    "UPDATE cola_sync SET intentos = 0, ultimo_error = NULL WHERE intentos > 0"
  );
  await guardarConfig(CLAVE_LOTE_EN_VUELO, "");
  await guardarConfig("sync_error", "");
  const f = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM cola_sync"
  );
  return f?.n ?? 0;
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
export type ResultadoRestauracion = {
  restaurados: number;
  /** Se quedaron archivados porque volverían a chocar con el negocio. */
  omitidos: number;
};

/** Devuelve al inventario los productos archivados.
 *
 *  ⚠️ NO restaura los que volverían a chocar con el catálogo del negocio, y
 *  esa es la corrección de un bucle real encontrado en pruebas: un producto
 *  se archiva justamente PORQUE chocaba (el dueño eligió quedarse con la
 *  versión del negocio). Restaurarlo tal cual lo devolvía como producto
 *  local con el mismo código de barras que uno del negocio, así que el
 *  detector lo volvía a marcar como coincidencia y la pantalla de "revisar y
 *  decidir" reaparecía una y otra vez, sin forma de salir.
 *
 *  Los que sí chocan se quedan archivados (no se pierden: si algún día ese
 *  producto desaparece del negocio, restaurar vuelve a traerlos). */
export async function restaurarArchivados(): Promise<ResultadoRestauracion> {
  const db = await bd();
  const filas = await db.getAllAsync<{ id: string; datos_json: string }>(
    "SELECT id, datos_json FROM productos_archivados"
  );
  const ahora = ahoraISO();
  let restaurados = 0;
  let omitidos = 0;

  // Mismo criterio de coincidencia que detectarConflictosCatalogo(): por
  // código de barras, y si no hay, por nombre. Si aquí se usara una regla
  // distinta, un producto podría restaurarse y ser marcado como conflicto
  // acto seguido — el bucle otra vez, solo que más difícil de ver.
  const remotos = await db.getAllAsync<any>(
    "SELECT codigo_barras, nombre FROM productos WHERE origen != 'local' AND eliminado = 0"
  );
  const codigosRemotos = new Set(
    remotos.map((r: any) => String(r.codigo_barras ?? "").trim()).filter(Boolean)
  );
  const nombresRemotos = new Set(
    remotos.map((r: any) => String(r.nombre ?? "").trim().toLowerCase()).filter(Boolean)
  );

  await db.withTransactionAsync(async () => {
    for (const f of filas) {
      const p = JSON.parse(f.datos_json);
      const cb = String(p.codigo_barras ?? "").trim();
      const nom = String(p.nombre ?? "").trim().toLowerCase();
      if ((cb && codigosRemotos.has(cb)) || (nom && nombresRemotos.has(nom))) {
        omitidos++;
        continue;
      }
      await db.runAsync(
        "UPDATE productos SET eliminado = 0, actualizado_en = ? WHERE id = ?",
        [ahora, p.id]
      );
      // Solo se borra del archivo lo que de verdad se restauró — antes se
      // vaciaba la tabla entera, así que lo omitido se habría perdido.
      await db.runAsync("DELETE FROM productos_archivados WHERE id = ?", [f.id]);
      restaurados++;
    }
    // Y sus categorías locales.
    await db.runAsync(
      "UPDATE categorias SET eliminado = 0, actualizado_en = ? WHERE origen = 'local'",
      [ahora]
    );
  });

  return { restaurados, omitidos };
}
