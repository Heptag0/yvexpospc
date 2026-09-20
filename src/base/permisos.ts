// YvexPOS Móvil — Permisos por rol.
//
// ===========================================================================
// POR QUÉ EXISTE ESTE ARCHIVO
// ===========================================================================
// El PC protege 45 comandos con `exigir_rol` (commands/mod.rs). El móvil NO
// TENÍA NADA equivalente: no hay capa de comandos, la interfaz llama directo
// a las funciones de datos, y la única lectura de `usuarioActivo()` en toda
// la app era para mostrar el nombre en Inicio.
//
// Consecuencia real: cualquiera con la tablet abría "Cajeros" en Ajustes y se
// cambiaba el rol a dueño, o entraba a Dinero y veía las finanzas PERSONALES
// del dueño (la renta de su casa, su despensa). No había ninguna puerta.
//
// ===========================================================================
// CÓMO SE USA — DOS CAPAS, igual que en el PC
// ===========================================================================
//
//   1. La INTERFAZ oculta lo que no se puede usar (pestañas, botones,
//      secciones). Es cortesía: que nadie vea puertas que no puede abrir.
//
//   2. La CAPA DE DATOS rechaza aunque alguien llegue por otro camino. Es lo
//      que de verdad protege. En el PC vive en commands/mod.rs; aquí va al
//      principio de las funciones sensibles, con `exigirPermiso()`.
//
// La capa 1 sin la capa 2 no es seguridad, es decoración.
//
// ===========================================================================
// TODO PASA POR AQUÍ
// ===========================================================================
// Ninguna pantalla debe comprobar el rol a mano (`if (rol === "dueno")`). Si
// todas preguntan a `puede()`, el día que quieras permisos por USUARIO en vez
// de por rol se cambia esta función y nada más — igual que en el PC. Ver
// PENDIENTES.md, punto 8, para el diseño de ese paso.

import { usuarioActivo, type Rol } from "./usuarios";

export type Accion =
  // ── Cajero (y por tanto todos) ──
  | "vender"
  | "abrirTurno"
  | "cerrarTurnoPropio"
  | "devolver"          // devolver y cancelar: queda en la bitácora
  | "verCortePropio"
  | "cobrarAbono"       // recibir un pago de deuda en el mostrador
  | "registrarCliente"  // dar de alta a quien le fía
  // ── Gerente y dueño ──
  | "editarCatalogo"    // crear, editar y borrar productos y departamentos
  | "ajustarStock"
  | "verReportes"       // ganancias y márgenes del negocio
  | "gestionarProveedores"
  | "registrarCompra"
  | "editarRecetas"
  | "configurarNegocio" // nombre, impuesto, apariencia del negocio
  | "sincronizarManual"
  // ── Solo dueño ──
  | "verFinanzas"       // los DOS libros, incluido el personal
  | "gestionarUsuarios" // crear, editar y borrar cajeros
  | "vincularCuenta";   // vincular y desvincular de la nube

const SOLO_DUENO: Accion[] = ["verFinanzas", "gestionarUsuarios", "vincularCuenta"];

const GERENTE_Y_DUENO: Accion[] = [
  "editarCatalogo", "ajustarStock", "verReportes", "gestionarProveedores",
  "registrarCompra", "editarRecetas", "configurarNegocio", "sincronizarManual",
];

/** ¿Este rol puede ejecutar esta acción? Función pura: sin base de datos, sin
 *  async. Se separa de `puede()` para poder probarla con node puro y para que
 *  la interfaz pueda decidir con un rol que ya tiene en memoria. */
export function rolPuede(rol: Rol | null, accion: Accion): boolean {
  // Sin usuario activo no se puede nada. Antes de que exista el primero (el
  // onboarding aún no terminó) la app no muestra estas pantallas.
  if (!rol) return false;
  if (rol === "dueno") return true;
  if (SOLO_DUENO.includes(accion)) return false;
  if (rol === "gerente") return true;
  // Cajero: todo lo que no esté en las dos listas de arriba.
  return !GERENTE_Y_DUENO.includes(accion);
}

/** ¿El usuario ACTIVO puede ejecutar esta acción? */
export async function puede(accion: Accion): Promise<boolean> {
  const u = await usuarioActivo();
  return rolPuede((u?.rol as Rol) ?? null, accion);
}

/** Igual que `puede`, pero LANZA si no. Esta es la que va en la capa de
 *  datos: la interfaz puede olvidarse de ocultar un botón, pero si la función
 *  que mueve el dato exige el permiso, el agujero no existe.
 *
 *  El mensaje dice QUÉ hace falta, no solo "no puedes": un cajero que ve
 *  "Esto solo lo puede hacer el dueño" entiende que debe pedírselo, en vez de
 *  pensar que la app está rota. */
export async function exigirPermiso(accion: Accion): Promise<void> {
  if (await puede(accion)) return;
  const quien = SOLO_DUENO.includes(accion)
    ? "el dueño"
    : "el dueño o un gerente";
  throw new Error(`Esto solo lo puede hacer ${quien}.`);
}

/** Permisos de una sola vez, para pintar una pantalla sin encadenar awaits.
 *  Útil en las pestañas: se pide una vez al enfocar y se decide todo con el
 *  resultado. */
export type MapaPermisos = Record<Accion, boolean>;

export async function permisosActuales(): Promise<MapaPermisos> {
  const u = await usuarioActivo();
  const rol = (u?.rol as Rol) ?? null;
  const acciones: Accion[] = [
    "vender", "abrirTurno", "cerrarTurnoPropio", "devolver", "verCortePropio",
    "cobrarAbono", "registrarCliente",
    ...GERENTE_Y_DUENO, ...SOLO_DUENO,
  ];
  const out = {} as MapaPermisos;
  for (const a of acciones) out[a] = rolPuede(rol, a);
  return out;
}
