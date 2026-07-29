// YvexPOS Móvil — Tienda en línea (escaparate).
//
// El dueño marca QUÉ productos quiere mostrar (productos.en_tienda, flag
// LOCAL) y pica "Publicar": la app manda el catálogo por HTTPS PROPIO a
// tienda.yvexiq.com y el negocio obtiene una página pública
// (tienda.yvexiq.com/t/{slug}) con pedidos por WhatsApp.
//
// REGLA DE ORO: publicar es SIEMPRE acción explícita del usuario. Nada de
// esto se llama automáticamente ni viaja por cola_sync: es un canal aparte,
// con el mismo esquema de autenticación del sync/escáner (headers
// X-Dispositivo-Id / X-Dispositivo-Token, leídos de la misma config que
// nube.ts — sin tocar nube.ts).
//
// Dinero en centavos enteros, bools como 0/1, fechas ISO-8601.

import * as FileSystem from "expo-file-system/legacy";
import { bd } from "./db";
import { leerVarias, guardarConfig } from "./config";
import { estadoCuenta } from "./nube";
import { leerNombreNegocio } from "./giro";
import { sugerirSlug, whatsappValido } from "./tiendaReglas";

export const TIENDA_BASE = "https://tienda.yvexiq.com";

// Contacto del webmaster para el pie del modal ("¿Quieres página web a la
// medida?"). PLACEHOLDER: Arturo pone aquí su número real (solo dígitos,
// con código de país, p. ej. "5215512345678").
export const CONTACTO_WEBMASTER = "521234567890";

export type PlantillaTienda = "aurora" | "noche" | "mercado";

export type TiendaLocal = {
  plantilla: PlantillaTienda;
  color: string;
  whatsapp: string;
  mensaje: string;
  mostrarStock: boolean;
  slug: string | null;
  url: string | null;
  ultimaPublicacion: string | null;
};

export type ProductoTienda = {
  producto_id: string;
  nombre: string;
  descripcion: string;
  precio_centavos: number;
  departamento: string;
  imagen_uri: string | null;
  orden: number;
};

// Errores tipados: la UI los traduce a mensajes cálidos.
export type ErrorTienda = "sin_cuenta" | "sin_productos" | "sin_internet" | "servidor";

export class FalloTienda extends Error {
  tipo: ErrorTienda;
  constructor(tipo: ErrorTienda, detalle?: string) {
    super(detalle ?? tipo);
    this.tipo = tipo;
  }
}

export type ResultadoPublicar = {
  ok: boolean;
  slug: string;
  url: string;
  advertencias: string[];
};

export type EstadoTiendaRemoto = {
  tiene_tienda: boolean;
  activa: boolean;
  slug: string | null;
  url_publica: string | null;
  plantilla: string | null;
  color_acento: string | null;
  whatsapp: string | null;
  mensaje_bienvenida: string | null;
  mostrar_stock: number;
  num_productos: number;
  publicada_en: string | null;
};

const CLAVES_TIENDA = [
  "tienda_plantilla",
  "tienda_color",
  "tienda_whatsapp",
  "tienda_mensaje",
  "tienda_mostrar_stock",
  "tienda_slug",
  "tienda_url",
  "tienda_ultima_publicacion",
];

// ---------------------------------------------------------------------------
// Config local
// ---------------------------------------------------------------------------

export async function leerTiendaLocal(): Promise<TiendaLocal> {
  const m = await leerVarias(CLAVES_TIENDA);
  const plantilla = m.get("tienda_plantilla");
  return {
    plantilla:
      plantilla === "noche" || plantilla === "mercado" ? plantilla : "aurora",
    color: m.get("tienda_color") ?? "#8b5cf6",
    whatsapp: m.get("tienda_whatsapp") ?? "",
    mensaje: m.get("tienda_mensaje") ?? "",
    mostrarStock: m.get("tienda_mostrar_stock") === "1",
    slug: m.get("tienda_slug") ?? null,
    url: m.get("tienda_url") ?? null,
    ultimaPublicacion: m.get("tienda_ultima_publicacion") ?? null,
  };
}

export async function guardarTiendaLocal(
  parcial: Partial<{
    plantilla: PlantillaTienda;
    color: string;
    whatsapp: string;
    mensaje: string;
    mostrarStock: boolean;
  }>
): Promise<void> {
  if (parcial.plantilla !== undefined)
    await guardarConfig("tienda_plantilla", parcial.plantilla);
  if (parcial.color !== undefined) await guardarConfig("tienda_color", parcial.color);
  if (parcial.whatsapp !== undefined)
    await guardarConfig("tienda_whatsapp", parcial.whatsapp);
  if (parcial.mensaje !== undefined)
    await guardarConfig("tienda_mensaje", parcial.mensaje);
  if (parcial.mostrarStock !== undefined)
    await guardarConfig("tienda_mostrar_stock", parcial.mostrarStock ? "1" : "0");
}

// ---------------------------------------------------------------------------
// Selección de productos (flag local en_tienda)
// ---------------------------------------------------------------------------

/** Catálogo completo con su marca en_tienda (para la lista del modal). */
export async function catalogoConMarca(): Promise<
  {
    id: string;
    nombre: string;
    precio_venta_centavos: number;
    imagen_uri: string | null;
    categoria_nombre: string | null;
    en_tienda: number;
    stock: number;
  }[]
> {
  const db = await bd();
  return db.getAllAsync(
    `SELECT p.id, p.nombre, p.precio_venta_centavos, p.imagen_uri,
            p.en_tienda, p.stock, c.nombre AS categoria_nombre
     FROM productos p
     LEFT JOIN categorias c ON c.id = p.categoria_id
     WHERE p.eliminado = 0 AND p.activo = 1
     ORDER BY p.en_tienda DESC, p.nombre COLLATE NOCASE`
  );
}

/** Productos marcados para la tienda, listos para el payload (sin foto). */
export async function productosParaTienda(): Promise<ProductoTienda[]> {
  const db = await bd();
  const filas = await db.getAllAsync<{
    id: string;
    nombre: string;
    descripcion: string | null;
    precio_venta_centavos: number;
    imagen_uri: string | null;
    categoria_nombre: string | null;
  }>(
    `SELECT p.id, p.nombre, p.precio_venta_centavos, p.imagen_uri,
            c.nombre AS categoria_nombre, NULL AS descripcion
     FROM productos p
     LEFT JOIN categorias c ON c.id = p.categoria_id
     WHERE p.eliminado = 0 AND p.activo = 1 AND p.en_tienda = 1
     ORDER BY p.nombre COLLATE NOCASE
     LIMIT 500`
  );
  return filas.map((f, i) => ({
    producto_id: f.id,
    nombre: f.nombre,
    descripcion: "",
    precio_centavos: f.precio_venta_centavos,
    departamento: f.categoria_nombre ?? "General",
    imagen_uri: f.imagen_uri,
    orden: i,
  }));
}

export async function marcarEnTienda(
  productoId: string,
  enTienda: boolean
): Promise<void> {
  const db = await bd();
  await db.runAsync("UPDATE productos SET en_tienda = ? WHERE id = ?", [
    enTienda ? 1 : 0,
    productoId,
  ]);
}

// ---------------------------------------------------------------------------
// HTTP propio (mismo esquema de auth que nube.ts, sin tocar nube.ts)
// ---------------------------------------------------------------------------

async function headersDispositivo(): Promise<Record<string, string>> {
  const cuenta = await estadoCuenta();
  if (!cuenta.vinculado || !cuenta.dispositivoId || !cuenta.dispositivoToken)
    throw new FalloTienda("sin_cuenta");
  return {
    "Content-Type": "application/json",
    "X-Dispositivo-Id": cuenta.dispositivoId,
    "X-Dispositivo-Token": cuenta.dispositivoToken,
  };
}

async function pedirTienda<T>(
  ruta: string,
  opciones: { metodo?: "GET" | "POST"; cuerpo?: any; timeoutMs: number }
): Promise<T> {
  const headers = await headersDispositivo();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opciones.timeoutMs);
  try {
    const res = await fetch(TIENDA_BASE + ruta, {
      method: opciones.metodo ?? "POST",
      headers,
      body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
      signal: ctrl.signal,
    });
    const texto = await res.text();
    let datos: any = null;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch {
      // Respuesta no-JSON (nginx, etc.): se resuelve abajo con el status.
    }
    if (!res.ok) {
      const d = typeof datos?.detail === "string" ? datos.detail : null;
      throw new FalloTienda("servidor", d ?? `Error ${res.status} del servidor.`);
    }
    return datos as T;
  } catch (e: any) {
    if (e instanceof FalloTienda) throw e;
    if (e?.name === "AbortError")
      throw new FalloTienda("sin_internet", "El servidor no respondió a tiempo.");
    if (String(e?.message ?? "").includes("Network request failed"))
      throw new FalloTienda("sin_internet");
    throw new FalloTienda("servidor", String(e?.message ?? e));
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Publicar / estado / desactivar (SOLO desde botones del modal)
// ---------------------------------------------------------------------------

/** Lee la foto local de un producto como base64. Si falla, devuelve null
 *  y se publica sin esa foto (el servidor conserva la anterior). */
async function leerFotoBase64(uri: string | null): Promise<string | null> {
  if (!uri) return null;
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return b64 && b64.length > 0 ? b64 : null;
  } catch {
    return null;
  }
}

export async function publicarTienda(): Promise<ResultadoPublicar> {
  // Auth primero: si no hay cuenta, ni armamos el payload.
  await headersDispositivo();

  const [cfg, productos, nombreNegocio] = await Promise.all([
    leerTiendaLocal(),
    productosParaTienda(),
    leerNombreNegocio(),
  ]);

  if (productos.length === 0) throw new FalloTienda("sin_productos");

  const wa = whatsappValido(cfg.whatsapp);
  const advertencias: string[] = [];
  if (cfg.whatsapp.trim() && !wa)
    advertencias.push("El número de WhatsApp no parecía válido y se publicó sin él.");

  // Fotos: se leen en serie (son pocas y pueden ser pesadas); la que falle
  // se publica sin foto y queda anotada como advertencia.
  const payloadProductos: any[] = [];
  let fotosFallidas = 0;
  for (const p of productos) {
    let foto: string | null = null;
    if (p.imagen_uri) {
      foto = await leerFotoBase64(p.imagen_uri);
      if (!foto) fotosFallidas++;
    }
    const item: any = {
      producto_id: p.producto_id,
      nombre: p.nombre,
      descripcion: p.descripcion,
      precio_centavos: p.precio_centavos,
      departamento: p.departamento,
      orden: p.orden,
    };
    if (foto) item.foto_base64 = foto;
    payloadProductos.push(item);
  }
  if (fotosFallidas > 0)
    advertencias.push(
      fotosFallidas === 1
        ? "Una foto no se pudo leer; ese producto se publicó sin foto."
        : `${fotosFallidas} fotos no se pudieron leer; esos productos se publicaron sin foto.`
    );

  const resp = await pedirTienda<{ ok: boolean; slug: string; url_publica: string }>(
    "/api/tienda/publicar",
    {
      cuerpo: {
        plantilla: cfg.plantilla,
        color_acento: cfg.color,
        whatsapp: wa ?? "",
        mensaje_bienvenida: cfg.mensaje,
        mostrar_stock: cfg.mostrarStock ? 1 : 0,
        slug_deseado: sugerirSlug(nombreNegocio),
        productos: payloadProductos,
      },
      // Puede subir varias fotos: margen amplio.
      timeoutMs: 20000,
    }
  );

  await guardarConfig("tienda_slug", resp.slug);
  await guardarConfig("tienda_url", resp.url_publica);
  await guardarConfig("tienda_ultima_publicacion", new Date().toISOString());

  return { ok: true, slug: resp.slug, url: resp.url_publica, advertencias };
}

/** Estado remoto de la tienda. Tolerante a fallo: null si no hay internet,
 *  no hay cuenta o el servidor no responde (la UI vive de la config local). */
export async function estadoTienda(): Promise<EstadoTiendaRemoto | null> {
  try {
    return await pedirTienda<EstadoTiendaRemoto>("/api/tienda/estado", {
      metodo: "GET",
      timeoutMs: 8000,
    });
  } catch {
    return null;
  }
}

export async function desactivarTienda(): Promise<void> {
  await pedirTienda<{ ok: boolean }>("/api/tienda/desactivar", {
    cuerpo: {},
    timeoutMs: 15000,
  });
}
