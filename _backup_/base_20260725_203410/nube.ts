// YvexPOS Móvil — Cliente de la nube (pos.yvexiq.com).
//
// La nube es OPCIONAL: la app funciona 100% sin cuenta. Vincular sirve para
// ver el negocio a distancia y (más adelante) compartir datos entre PC y móvil.
//
// DOS TOKENS, como manda el backend:
//   sesion_token      -> JWT del dueño (30 días). Autentica llamadas de cuenta.
//   dispositivo_token -> token de ESTA caja. Autenticará /sync (Fase 2).
//
// Flujo del móvil (una sola pantalla, sin códigos):
//   registrar/login -> devuelve sesion_token
//   /vincular/directo con ese token -> crea la caja y devuelve dispositivo_token
// Es el mismo camino que ya usa el PC.

import { leerVarias, guardarConfig, borrarConfig } from "./config";
import type { RespuestaTicket } from "./escaner";

const BASE = "https://pos.yvexiq.com";
const TIEMPO_LIMITE_MS = 15000;

// Claves de config donde vive la cuenta.
const CLAVES = [
  "sesion_token",
  "dispositivo_token",
  "dispositivo_id",
  "negocio_id",
  "cuenta_email",
  "cuenta_nombre",
  "nombre_caja",
  "prefijo_folio",
];

export type EstadoCuenta = {
  vinculado: boolean;
  email: string | null;
  nombre: string | null;
  nombreCaja: string | null;
  prefijoFolio: string | null;
  negocioId: string | null;
  dispositivoId: string | null;
  sesionToken: string | null;
  dispositivoToken: string | null;
};

// ---------------------------------------------------------------------------
// Peticiones HTTP con manejo de errores legible
// ---------------------------------------------------------------------------

async function pedir<T>(
  ruta: string,
  opciones: { metodo?: "GET" | "POST"; cuerpo?: any; token?: string } = {}
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIEMPO_LIMITE_MS);

  try {
    const cabeceras: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (opciones.token) cabeceras["Authorization"] = `Bearer ${opciones.token}`;

    const res = await fetch(BASE + ruta, {
      method: opciones.metodo ?? "POST",
      headers: cabeceras,
      body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
      signal: ctrl.signal,
    });

    const texto = await res.text();
    let datos: any = null;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch {
      // Respuesta no-JSON (ej. error de nginx): mostramos algo útil.
      if (!res.ok) throw new Error(`El servidor respondió ${res.status}.`);
    }

    if (!res.ok) {
      // FastAPI manda el mensaje en `detail`. Puede ser texto o lista.
      const d = datos?.detail;
      if (typeof d === "string") throw new Error(d);
      if (Array.isArray(d) && d[0]?.msg) throw new Error(String(d[0].msg));
      throw new Error(`Error ${res.status} del servidor.`);
    }

    return datos as T;
  } catch (e: any) {
    if (e?.name === "AbortError")
      throw new Error("El servidor no respondió. Revisa tu conexión.");
    if (String(e?.message ?? "").includes("Network request failed"))
      throw new Error("Sin conexión a internet.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Estado de la cuenta (local)
// ---------------------------------------------------------------------------

export async function estadoCuenta(): Promise<EstadoCuenta> {
  const m = await leerVarias(CLAVES);
  const dispToken = m.get("dispositivo_token") ?? null;
  return {
    vinculado: !!dispToken,
    email: m.get("cuenta_email") ?? null,
    nombre: m.get("cuenta_nombre") ?? null,
    nombreCaja: m.get("nombre_caja") ?? null,
    prefijoFolio: m.get("prefijo_folio") ?? null,
    negocioId: m.get("negocio_id") ?? null,
    dispositivoId: m.get("dispositivo_id") ?? null,
    sesionToken: m.get("sesion_token") ?? null,
    dispositivoToken: dispToken,
  };
}

// ---------------------------------------------------------------------------
// Registro / Login / Vinculación
// ---------------------------------------------------------------------------

type SesionResp = { token: string; dueno_id: string; nombre: string };

type VincularResp = {
  ok: boolean;
  dispositivo_id: string;
  token: string;
  negocio_id: string;
  nombre_caja: string;
  prefijo_folio: string;
};

/** Vincula ESTE teléfono como caja del negocio, usando el token de sesión. */
async function vincularDispositivo(
  sesionToken: string,
  nombreCaja: string
): Promise<VincularResp> {
  return pedir<VincularResp>("/vincular/directo", {
    cuerpo: { nombre_caja: nombreCaja, tipo: "movil" },
    token: sesionToken,
  });
}

/** Guarda todo lo que devuelve el servidor tras vincular. */
async function guardarSesion(
  sesion: SesionResp,
  email: string,
  v: VincularResp
): Promise<void> {
  await guardarConfig("sesion_token", sesion.token);
  await guardarConfig("cuenta_email", email.toLowerCase());
  await guardarConfig("cuenta_nombre", sesion.nombre);
  await guardarConfig("dispositivo_token", v.token);
  await guardarConfig("dispositivo_id", v.dispositivo_id);
  await guardarConfig("negocio_id", v.negocio_id);
  await guardarConfig("nombre_caja", v.nombre_caja);
  await guardarConfig("prefijo_folio", v.prefijo_folio);
}

/** Crea cuenta nueva + su negocio, y vincula este teléfono en un paso. */
export async function registrarYVincular(datos: {
  email: string;
  nombre: string;
  password: string;
  negocioNombre: string;
  nombreCaja: string;
}): Promise<EstadoCuenta> {
  if (datos.password.length < 8)
    throw new Error("La contraseña debe tener al menos 8 caracteres.");

  const sesion = await pedir<SesionResp>("/cuenta/registrar", {
    cuerpo: {
      email: datos.email.trim().toLowerCase(),
      nombre: datos.nombre.trim(),
      password: datos.password,
      negocio_nombre: datos.negocioNombre.trim(),
    },
  });

  const v = await vincularDispositivo(sesion.token, datos.nombreCaja.trim() || "Móvil");
  await guardarSesion(sesion, datos.email, v);
  return estadoCuenta();
}

/** Inicia sesión en una cuenta existente y vincula este teléfono. */
export async function loginYVincular(datos: {
  email: string;
  password: string;
  nombreCaja: string;
}): Promise<EstadoCuenta> {
  const sesion = await pedir<SesionResp>("/cuenta/login", {
    cuerpo: {
      email: datos.email.trim().toLowerCase(),
      password: datos.password,
    },
  });

  const v = await vincularDispositivo(sesion.token, datos.nombreCaja.trim() || "Móvil");
  await guardarSesion(sesion, datos.email, v);
  return estadoCuenta();
}

/** Desvincula este teléfono: borra la sesión local. Los datos locales se quedan. */
export async function cerrarSesion(): Promise<void> {
  await borrarConfig(CLAVES);
}

// ---------------------------------------------------------------------------
// Verificación de correo (suave: no bloquea el uso de la app)
// ---------------------------------------------------------------------------

export type EstadoVerificacion = { verificado: boolean; email: string | null };

export async function estadoVerificacion(
  sesionToken: string
): Promise<EstadoVerificacion> {
  return pedir<EstadoVerificacion>("/cuenta/verificar/estado", {
    metodo: "GET",
    token: sesionToken,
  });
}

export async function enviarCodigoVerificacion(sesionToken: string): Promise<void> {
  await pedir("/cuenta/verificar/enviar", { token: sesionToken });
}

export async function confirmarCodigoVerificacion(
  sesionToken: string,
  codigo: string
): Promise<void> {
  await pedir("/cuenta/verificar/confirmar", {
    cuerpo: { codigo: codigo.trim() },
    token: sesionToken,
  });
}

/** Comprueba que el servidor está vivo (para diagnóstico). */
export async function probarConexion(): Promise<boolean> {
  try {
    await pedir("/salud", { metodo: "GET" });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Escáner de tickets con IA (POST /ia/ticket)
// ---------------------------------------------------------------------------

// La IA puede tardar bastante más que una llamada normal: margen amplio.
const TIEMPO_LIMITE_IA_MS = 90000;

/** Manda la foto del ticket al backend y devuelve lo que la IA entendió.
 *  Autentica con los headers de dispositivo de la cuenta vinculada (los mismos
 *  que /sync). Los errores salen SIEMPRE en español llano, sin tecnicismos. */
export async function analizarTicket(
  imagenB64: string,
  mime: string
): Promise<RespuestaTicket> {
  const cuenta = await estadoCuenta();
  if (!cuenta.vinculado || !cuenta.dispositivoId || !cuenta.dispositivoToken)
    throw new Error("Vincula tu cuenta para usar el escáner.");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIEMPO_LIMITE_IA_MS);

  try {
    const res = await fetch(BASE + "/ia/ticket", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dispositivo-Id": cuenta.dispositivoId,
        "X-Dispositivo-Token": cuenta.dispositivoToken,
      },
      body: JSON.stringify({ imagen_b64: imagenB64, mime }),
      signal: ctrl.signal,
    });

    const texto = await res.text();
    let datos: any = null;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch {
      // Respuesta no-JSON: se resuelve abajo según el status.
    }

    if (!res.ok) {
      // Si el servidor manda `detail` en español, lo respetamos.
      const d = typeof datos?.detail === "string" ? datos.detail : null;
      if (res.status === 503)
        throw new Error("El análisis con IA aún no está configurado en el servidor.");
      if (res.status === 502)
        throw new Error("No se pudo analizar la foto, intenta con mejor iluminación.");
      if (res.status === 401)
        throw new Error(d ?? "Este dispositivo ya no tiene acceso. Vuelve a vincular tu cuenta.");
      throw new Error(d ?? "El servidor tuvo un problema. Intenta de nuevo en un momento.");
    }

    if (!datos || !Array.isArray(datos.lineas))
      throw new Error("El servidor respondió algo inesperado. Intenta de nuevo.");
    return datos as RespuestaTicket;
  } catch (e: any) {
    if (e?.name === "AbortError")
      throw new Error("El análisis tardó demasiado. Revisa tu conexión e intenta otra vez.");
    if (String(e?.message ?? "").includes("Network request failed"))
      throw new Error("Sin conexión a internet.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
