// YvexPOS Móvil — Usuarios POS (cajeros).
//
// Caso real: una tablet en el mostrador que usan varios empleados. Cada uno
// entra con su PIN, y cada venta queda a nombre de quien la hizo.
//
// Si el negocio es de una sola persona, esto es casi invisible: el dueño se
// crea en el onboarding con el PIN que él elige y queda seleccionado solo.
// Nunca hay un PIN por defecto.
//
// El PIN se guarda HASHEADO (nunca en claro). No es criptografía de banco
// —es un PIN de 4 dígitos en un dispositivo físico— pero evita que alguien
// con acceso al archivo de la base lea los PINs de todos.

import { bd, uuid, ahoraISO } from "./db";
import { leerConfig, guardarConfig } from "./config";
import { encolar } from "./sync";
import { exigirPermiso } from "./permisos";

export type Rol = "dueno" | "gerente" | "cajero";

export type UsuarioPOS = {
  id: string;
  nombre: string;
  rol: Rol;
  activo: number;
};

export const ROLES: { id: Rol; nombre: string; desc: string }[] = [
  { id: "dueno",   nombre: "Dueño",   desc: "Acceso total: inventario, reportes, usuarios" },
  { id: "gerente", nombre: "Gerente", desc: "Vende, ajusta inventario y ve reportes" },
  { id: "cajero",  nombre: "Cajero",  desc: "Solo vende y hace su corte" },
];

// ---------------------------------------------------------------------------
// Hash de PIN (sin dependencias: suficiente para un PIN local)
// ---------------------------------------------------------------------------
function hashPin(pin: string, salt: string): string {
  // Hash iterado simple (FNV-1a con sal, muchas rondas). No es bcrypt, pero
  // hace inviable leer un PIN de 4 dígitos a ojo desde el archivo.
  let h = 2166136261;
  const texto = salt + "|" + pin + "|yvexpos";
  for (let ronda = 0; ronda < 5000; ronda++) {
    for (let i = 0; i < texto.length; i++) {
      h ^= texto.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= ronda;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function empaquetar(pin: string): string {
  const salt = uuid().slice(0, 8);
  return `${salt}$${hashPin(pin, salt)}`;
}

function verificar(pin: string, guardado: string): boolean {
  const [salt, hash] = guardado.split("$");
  if (!salt || !hash) return false;
  return hashPin(pin, salt) === hash;
}

function validarPin(pin: string): void {
  if (!/^\d{4}$/.test(pin)) throw new Error("El PIN debe ser de 4 dígitos.");
}

// ---------------------------------------------------------------------------
// CRUD de usuarios
// ---------------------------------------------------------------------------

export async function listarUsuarios(): Promise<UsuarioPOS[]> {
  const db = await bd();
  return db.getAllAsync<UsuarioPOS>(
    `SELECT id, nombre, rol, activo FROM usuarios_pos
     WHERE eliminado = 0 ORDER BY
       CASE rol WHEN 'dueno' THEN 0 WHEN 'gerente' THEN 1 ELSE 2 END,
       nombre COLLATE NOCASE`
  );
}

export async function crearUsuario(
  nombre: string,
  pin: string,
  rol: Rol
): Promise<string> {
  // La puerta más importante de la app... salvo en el arranque. Si todavía
  // no existe NINGÚN usuario, esta llamada es el propio onboarding
  // creándose a sí mismo como el primer dueño — exigir "gestionarUsuarios"
  // aquí era un candado sin llave: hacía falta ser dueño para crear al
  // primer dueño, y por eso NADIE podía terminar el onboarding ni por el
  // botón normal ni vinculando cuenta (los dos caminos llaman aquí).
  // Con usuarios ya existentes, la protección normal sigue exactamente
  // igual: solo dueño/gerente pueden dar de alta a alguien más.
  const yaHayUsuarios = (await listarUsuarios()).length > 0;
  if (yaHayUsuarios) {
    await exigirPermiso("gestionarUsuarios");
  }
  if (!nombre.trim()) throw new Error("El nombre no puede estar vacío.");
  validarPin(pin);
  const db = await bd();
  const id = uuid();
  const ahora = ahoraISO();
  // Alta y encolado en la MISMA transacción: o quedan los dos, o ninguno.
  // Suelto, un fallo entre ambos dejaba un cajero que existe en el teléfono
  // pero que las otras cajas nunca ven, así que sus ventas llegan atribuidas
  // a un usuario inexistente.
  await db.withTransactionAsync(async () => {
  await db.runAsync(
    `INSERT INTO usuarios_pos (id, nombre, pin_hash, rol, activo, eliminado, creado_en, actualizado_en)
     VALUES (?,?,?,?,1,0,?,?)`,
    [id, nombre.trim(), empaquetar(pin), rol, ahora, ahora]
  );
  // Sube a la nube SIN el PIN (el espejo nunca guarda pin_hash: un PIN de
  // una caja no debe viajar a otra). Sirve para que las demás cajas muestren
  // el nombre real del cajero en ventas y reportes.
  await encolar("usuarios_pos", id, {
    id, nombre: nombre.trim(), rol, activo: 1, eliminado: 0,
    creado_en: ahora, actualizado_en: ahora,
  });
  });
  return id;
}

export async function editarUsuario(
  id: string,
  nombre: string,
  rol: Rol,
  pinNuevo?: string
): Promise<void> {
  await exigirPermiso("gestionarUsuarios");
  if (!nombre.trim()) throw new Error("El nombre no puede estar vacío.");
  const db = await bd();
  const ahoraEd = ahoraISO();
  await db.withTransactionAsync(async () => {
  if (pinNuevo) {
    validarPin(pinNuevo);
    await db.runAsync(
      "UPDATE usuarios_pos SET nombre = ?, rol = ?, pin_hash = ?, actualizado_en = ? WHERE id = ?",
      [nombre.trim(), rol, empaquetar(pinNuevo), ahoraEd, id]
    );
  } else {
    await db.runAsync(
      "UPDATE usuarios_pos SET nombre = ?, rol = ?, actualizado_en = ? WHERE id = ?",
      [nombre.trim(), rol, ahoraEd, id]
    );
  }
  // El PIN nunca sale del teléfono; solo nombre/rol.
  await encolar("usuarios_pos", id, {
    id, nombre: nombre.trim(), rol, actualizado_en: ahoraEd,
  }, "update");
  });
}

export async function eliminarUsuario(id: string): Promise<void> {
  await exigirPermiso("gestionarUsuarios");
  const db = await bd();
  // No dejar el negocio sin dueño.
  // `activo = 1` es imprescindible: sin él, un dueño DESACTIVADO contaba
  // como "otro dueño" y dejaba borrar al último dueño activo. Resultado:
  // nadie con rol de dueño puede entrar y no hay forma de arreglarlo desde
  // la app. (El PC tenía exactamente el mismo fallo.)
  const duenos = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM usuarios_pos
      WHERE rol = 'dueno' AND eliminado = 0 AND activo = 1 AND id <> ?`,
    [id]
  );
  const esDueno = await db.getFirstAsync<{ rol: string }>(
    "SELECT rol FROM usuarios_pos WHERE id = ?",
    [id]
  );
  if (esDueno?.rol === "dueno" && (duenos?.n ?? 0) === 0)
    throw new Error("Debe quedar al menos un usuario con rol de Dueño.");

  const ahoraEl = ahoraISO();
  await db.withTransactionAsync(async () => {
    // `activo = 0` también en LOCAL. El payload ya lo mandaba, pero el UPDATE
    // local no lo ponía: la nube veía el usuario inactivo y el teléfono lo
    // seguía viendo activo. Dos verdades para el mismo hecho.
    await db.runAsync(
      "UPDATE usuarios_pos SET eliminado = 1, activo = 0, actualizado_en = ? WHERE id = ?",
      [ahoraEl, id]
    );
    await encolar("usuarios_pos", id, {
      id, eliminado: 1, activo: 0, actualizado_en: ahoraEl,
    }, "update");
  });
  // Si era el activo, se deselecciona.
  if ((await usuarioActivoId()) === id) await guardarConfig("usuario_activo", "");
}

/** Comprueba el PIN de un usuario. */
export async function verificarPin(id: string, pin: string): Promise<boolean> {
  const db = await bd();
  const u = await db.getFirstAsync<{ pin_hash: string }>(
    "SELECT pin_hash FROM usuarios_pos WHERE id = ? AND eliminado = 0",
    [id]
  );
  if (!u) return false;
  return verificar(pin, u.pin_hash);
}

// ---------------------------------------------------------------------------
// Usuario activo (quién está vendiendo ahora)
// ---------------------------------------------------------------------------

export async function usuarioActivoId(): Promise<string | null> {
  const v = await leerConfig("usuario_activo");
  return v && v.trim() !== "" ? v : null;
}

export async function usuarioActivo(): Promise<UsuarioPOS | null> {
  const id = await usuarioActivoId();
  if (!id) return null;
  const db = await bd();
  const u = await db.getFirstAsync<UsuarioPOS>(
    "SELECT id, nombre, rol, activo FROM usuarios_pos WHERE id = ? AND eliminado = 0",
    [id]
  );
  return u ?? null;
}

export async function activarUsuario(id: string): Promise<void> {
  await guardarConfig("usuario_activo", id);
}

export async function salirUsuario(): Promise<void> {
  await guardarConfig("usuario_activo", "");
}

/** ¿Se pide PIN al cambiar de usuario? (config; por defecto sí si hay varios) */
export async function pideePin(): Promise<boolean> {
  const v = await leerConfig("pedir_pin");
  if (v === "0") return false;
  if (v === "1") return true;
  // Por defecto: solo si hay más de un usuario.
  const us = await listarUsuarios();
  return us.length > 1;
}

export async function setPedirPin(valor: boolean): Promise<void> {
  await guardarConfig("pedir_pin", valor ? "1" : "0");
}

// ---------------------------------------------------------------------------
// Arranque: garantizar que haya un usuario seleccionado SI ya existen
// usuarios. Si la base está limpia NO se crea nada aquí (nada de PIN por
// defecto): el primer usuario lo crea el dueño en el onboarding, con el PIN
// que él elija. Devuelve null cuando no hay usuarios.
// ---------------------------------------------------------------------------

export async function asegurarUsuario(): Promise<UsuarioPOS | null> {
  const us = await listarUsuarios();

  if (us.length === 0) return null; // sin usuarios: corresponde al onboarding

  const activo = await usuarioActivo();
  if (activo) return activo;

  // Hay usuarios pero ninguno activo: activar el dueño (o el primero).
  const dueno = us.find((u) => u.rol === "dueno") ?? us[0];
  await activarUsuario(dueno.id);
  return dueno;
}
