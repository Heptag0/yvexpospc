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
import { leerNombreNegocio, leerGiro } from "./giro";
import {
  sugerirSlug,
  normalizarSlug,
  whatsappValido,
  PlantillaId,
  TemaTienda,
  temaTiendaValido,
  EstadoPedido,
} from "./tiendaReglas";

export const TIENDA_BASE = "https://tienda.yvexiq.com";

// Contacto del webmaster para el pie del modal ("¿Quieres página web a la
// medida?"). PLACEHOLDER: Arturo pone aquí su número real (solo dígitos,
// con código de país, p. ej. "5215512345678").
export const CONTACTO_WEBMASTER = "521234567890";

// El banner se guarda en config como base64; arriba de ~500 KB se rechaza
// al elegir la imagen (un banner gigante tarda muchísimo en publicar).
export const MAX_BANNER_BASE64 = 500 * 1024;

export type PlantillaTienda = PlantillaId;

export type TiendaLocal = {
  plantilla: PlantillaTienda;
  color: string;
  whatsapp: string;
  mensaje: string;
  mostrarStock: boolean;
  slug: string | null;
  url: string | null;
  urlPath: string | null;
  ultimaPublicacion: string | null;
  // --- v2 ---
  domicilio: string;
  horarios: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  entregaPickup: boolean;
  entregaDomicilio: boolean;
  costoEnvioCentavos: number;
  pagoEfectivo: boolean;
  linkPago: string;
  ocultarAgotados: boolean;
  bannerBase64: string | null;
  // --- v3 ---
  tema: TemaTienda;
};

export type ProductoTienda = {
  producto_id: string;
  nombre: string;
  descripcion: string;
  precio_centavos: number;
  departamento: string;
  imagen_uri: string | null;
  orden: number;
  stock: number | null; // null = el producto no controla stock (sin dato)
};

// Errores tipados: la UI los traduce a mensajes cálidos.
export type ErrorTienda = "sin_cuenta" | "sin_productos" | "sin_internet" | "servidor";

export class FalloTienda extends Error {
  tipo: ErrorTienda;
  // Código HTTP cuando lo dio el servidor (p. ej. 409 en transición de
  // pedido inválida); undefined en errores de red.
  codigo?: number;
  constructor(tipo: ErrorTienda, detalle?: string, codigo?: number) {
    super(detalle ?? tipo);
    this.tipo = tipo;
    this.codigo = codigo;
  }
}

export type ResultadoPublicar = {
  ok: boolean;
  slug: string;
  url: string;
  urlPath: string;
  advertencias: string[];
};

export type EstadoTiendaRemoto = {
  tiene_tienda: boolean;
  activa: boolean;
  slug: string | null;
  url_publica: string | null;
  url_path?: string | null;
  plantilla: string | null;
  color_acento: string | null;
  whatsapp: string | null;
  mensaje_bienvenida: string | null;
  mostrar_stock: number;
  num_productos: number;
  publicada_en: string | null;
  // --- v3 ---
  tema?: string | null;
  num_pedidos_nuevos?: number;
};

// --- v3: pedidos web ---

export type ItemPedidoTienda = {
  producto_id: string;
  nombre: string;
  cantidad: number;
  precio_centavos: number;
};

export type PedidoTienda = {
  id: string;
  cliente_nombre: string;
  cliente_telefono: string;
  cliente_correo: string; // v3.1: teléfono O correo (al menos uno)
  cliente_notas: string;
  entrega: string; // "pickup" | "domicilio"
  direccion: string;
  pago: string; // "efectivo" | "en_linea"
  items: ItemPedidoTienda[];
  total_centavos: number;
  estado: EstadoPedido;
  creado_en: string;
  actualizado_en: string;
};

export type ResultadoSlug = {
  disponible: boolean;
  motivo: string | null;
  sugerencia: string | null;
};

const CLAVES_TIENDA = [
  "tienda_plantilla",
  "tienda_color",
  "tienda_whatsapp",
  "tienda_mensaje",
  "tienda_mostrar_stock",
  "tienda_slug",
  "tienda_url",
  "tienda_url_path",
  "tienda_ultima_publicacion",
  "tienda_domicilio",
  "tienda_horarios",
  "tienda_instagram",
  "tienda_facebook",
  "tienda_tiktok",
  "tienda_entrega_pickup",
  "tienda_entrega_domicilio",
  "tienda_costo_envio_centavos",
  "tienda_pago_efectivo",
  "tienda_link_pago",
  "tienda_ocultar_agotados",
  "tienda_banner_base64",
  "tienda_tema",
];

const PLANTILLAS_VALIDAS: PlantillaTienda[] = [
  "aurora",
  "noche",
  "mercado",
  "boutique",
  "menu",
  "catalogo",
];

// ---------------------------------------------------------------------------
// Config local
// ---------------------------------------------------------------------------

export async function leerTiendaLocal(): Promise<TiendaLocal> {
  const m = await leerVarias(CLAVES_TIENDA);
  const plantilla = m.get("tienda_plantilla") as PlantillaTienda | undefined;
  const costoEnvio = Number(m.get("tienda_costo_envio_centavos") ?? "0");
  return {
    plantilla:
      plantilla && PLANTILLAS_VALIDAS.includes(plantilla) ? plantilla : "aurora",
    color: m.get("tienda_color") ?? "#8b5cf6",
    whatsapp: m.get("tienda_whatsapp") ?? "",
    mensaje: m.get("tienda_mensaje") ?? "",
    mostrarStock: m.get("tienda_mostrar_stock") === "1",
    slug: (m.get("tienda_slug") ?? "").trim() || null,
    url: m.get("tienda_url") ?? null,
    urlPath: m.get("tienda_url_path") ?? null,
    ultimaPublicacion: m.get("tienda_ultima_publicacion") ?? null,
    domicilio: m.get("tienda_domicilio") ?? "",
    horarios: m.get("tienda_horarios") ?? "",
    instagram: m.get("tienda_instagram") ?? "",
    facebook: m.get("tienda_facebook") ?? "",
    tiktok: m.get("tienda_tiktok") ?? "",
    // Recoger en tienda y pago en efectivo arrancan PRENDIDOS: es lo más
    // común; el dueño los apaga si no aplica.
    entregaPickup: m.get("tienda_entrega_pickup") !== "0",
    entregaDomicilio: m.get("tienda_entrega_domicilio") === "1",
    costoEnvioCentavos:
      isFinite(costoEnvio) && costoEnvio > 0 ? Math.round(costoEnvio) : 0,
    pagoEfectivo: m.get("tienda_pago_efectivo") !== "0",
    linkPago: m.get("tienda_link_pago") ?? "",
    ocultarAgotados: m.get("tienda_ocultar_agotados") === "1",
    bannerBase64: m.get("tienda_banner_base64") ?? null,
    tema: temaTiendaValido(m.get("tienda_tema")),
  };
}

export async function guardarTiendaLocal(
  parcial: Partial<{
    plantilla: PlantillaTienda;
    color: string;
    whatsapp: string;
    mensaje: string;
    mostrarStock: boolean;
    slug: string | null;
    domicilio: string;
    horarios: string;
    instagram: string;
    facebook: string;
    tiktok: string;
    entregaPickup: boolean;
    entregaDomicilio: boolean;
    costoEnvioCentavos: number;
    pagoEfectivo: boolean;
    linkPago: string;
    ocultarAgotados: boolean;
    bannerBase64: string | null;
    tema: TemaTienda;
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
  if (parcial.slug !== undefined)
    await guardarConfig("tienda_slug", parcial.slug ?? "");
  if (parcial.domicilio !== undefined)
    await guardarConfig("tienda_domicilio", parcial.domicilio);
  if (parcial.horarios !== undefined)
    await guardarConfig("tienda_horarios", parcial.horarios);
  if (parcial.instagram !== undefined)
    await guardarConfig("tienda_instagram", parcial.instagram);
  if (parcial.facebook !== undefined)
    await guardarConfig("tienda_facebook", parcial.facebook);
  if (parcial.tiktok !== undefined)
    await guardarConfig("tienda_tiktok", parcial.tiktok);
  if (parcial.entregaPickup !== undefined)
    await guardarConfig("tienda_entrega_pickup", parcial.entregaPickup ? "1" : "0");
  if (parcial.entregaDomicilio !== undefined)
    await guardarConfig(
      "tienda_entrega_domicilio",
      parcial.entregaDomicilio ? "1" : "0"
    );
  if (parcial.costoEnvioCentavos !== undefined)
    await guardarConfig(
      "tienda_costo_envio_centavos",
      String(Math.max(0, Math.round(parcial.costoEnvioCentavos)))
    );
  if (parcial.pagoEfectivo !== undefined)
    await guardarConfig("tienda_pago_efectivo", parcial.pagoEfectivo ? "1" : "0");
  if (parcial.linkPago !== undefined)
    await guardarConfig("tienda_link_pago", parcial.linkPago);
  if (parcial.ocultarAgotados !== undefined)
    await guardarConfig(
      "tienda_ocultar_agotados",
      parcial.ocultarAgotados ? "1" : "0"
    );
  if (parcial.bannerBase64 !== undefined)
    await guardarConfig("tienda_banner_base64", parcial.bannerBase64 ?? "");
  if (parcial.tema !== undefined)
    await guardarConfig("tienda_tema", temaTiendaValido(parcial.tema));
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

/** Productos marcados para la tienda, listos para el payload (sin foto).
 *  stock: si el producto NO controla existencias se manda null (sin dato). */
export async function productosParaTienda(): Promise<ProductoTienda[]> {
  const db = await bd();
  const filas = await db.getAllAsync<{
    id: string;
    nombre: string;
    descripcion: string | null;
    precio_venta_centavos: number;
    imagen_uri: string | null;
    categoria_nombre: string | null;
    controla_stock: number;
    stock: number;
  }>(
    `SELECT p.id, p.nombre, p.precio_venta_centavos, p.imagen_uri,
            p.controla_stock, p.stock,
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
    // stock REAL (piezas por kilo/decimal); la tienda trabaja con enteros.
    stock: f.controla_stock === 1 ? Math.max(0, Math.round(f.stock)) : null,
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
      throw new FalloTienda("servidor", d ?? `Error ${res.status} del servidor.`, res.status);
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

  const [cfg, productos, nombreNegocio, giro] = await Promise.all([
    leerTiendaLocal(),
    productosParaTienda(),
    leerNombreNegocio(),
    leerGiro(),
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
      stock: p.stock, // null = sin dato de stock (nunca limita)
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

  const resp = await pedirTienda<{
    ok: boolean;
    slug: string;
    url_publica: string;
    url_path?: string;
  }>("/api/tienda/publicar", {
    cuerpo: {
      plantilla: cfg.plantilla,
      color_acento: cfg.color,
      whatsapp: wa ?? "",
      mensaje_bienvenida: cfg.mensaje,
      mostrar_stock: cfg.mostrarStock ? 1 : 0,
      slug_deseado: cfg.slug ?? sugerirSlug(nombreNegocio),
      productos: payloadProductos,
      // --- v2 ---
      giro,
      domicilio: cfg.domicilio,
      horarios: cfg.horarios,
      instagram: cfg.instagram,
      facebook: cfg.facebook,
      tiktok: cfg.tiktok,
      entrega_pickup: cfg.entregaPickup,
      entrega_domicilio: cfg.entregaDomicilio,
      costo_envio_centavos: cfg.entregaDomicilio ? cfg.costoEnvioCentavos : 0,
      pago_efectivo: cfg.pagoEfectivo,
      link_pago: cfg.linkPago,
      ocultar_agotados: cfg.ocultarAgotados,
      // --- v3 ---
      tema: cfg.tema,
      ...(cfg.bannerBase64 ? { banner_base64: cfg.bannerBase64 } : {}),
    },
    // Puede subir varias fotos y el banner: margen amplio.
    timeoutMs: 30000,
  });

  const urlPath =
    resp.url_path ?? `${TIENDA_BASE}/t/${resp.slug}`;
  await guardarConfig("tienda_slug", resp.slug);
  await guardarConfig("tienda_url", resp.url_publica);
  await guardarConfig("tienda_url_path", urlPath);
  await guardarConfig("tienda_ultima_publicacion", new Date().toISOString());

  return {
    ok: true,
    slug: resp.slug,
    url: resp.url_publica,
    urlPath,
    advertencias,
  };
}

/** ¿Está libre el slug para {slug}.yvexiq.com? Lanza FalloTienda
 *  (sin_cuenta / sin_internet / servidor); la UI lo traduce. */
export async function verificarSlugDisponible(slug: string): Promise<ResultadoSlug> {
  const limpio = normalizarSlug(slug);
  if (!limpio) throw new FalloTienda("servidor", "Ese enlace no tiene letras ni números válidos.");
  const resp = await pedirTienda<{
    disponible: boolean;
    motivo: string | null;
    sugerencia: string | null;
  }>(`/api/tienda/slug-disponible?slug=${encodeURIComponent(limpio)}`, {
    metodo: "GET",
    timeoutMs: 10000,
  });
  return {
    disponible: resp.disponible === true,
    motivo: resp.motivo ?? null,
    sugerencia: resp.sugerencia ?? null,
  };
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

// ---------------------------------------------------------------------------
// v3 — Pedidos web (consulta y cambio de estado desde el POS)
// ---------------------------------------------------------------------------

/** Pedidos web del negocio, más nuevos primero (máx 200 del servidor).
 *  filtro.estado: 'nuevo' | 'preparando' | 'listo' | 'entregado' | 'cancelado'
 *  (omitir = todos); filtro.desde: ISO-8601 opcional.
 *  Lanza FalloTienda (sin_cuenta / sin_internet / servidor). */
export async function obtenerPedidosTienda(filtro?: {
  estado?: EstadoPedido;
  desde?: string;
}): Promise<PedidoTienda[]> {
  const params: string[] = [];
  if (filtro?.estado) params.push(`estado=${encodeURIComponent(filtro.estado)}`);
  if (filtro?.desde) params.push(`desde=${encodeURIComponent(filtro.desde)}`);
  const ruta = `/api/tienda/pedidos${params.length ? `?${params.join("&")}` : ""}`;
  const resp = await pedirTienda<{ pedidos: PedidoTienda[] }>(ruta, {
    metodo: "GET",
    timeoutMs: 12000,
  });
  return Array.isArray(resp?.pedidos) ? resp.pedidos : [];
}

/** Cambia el estado de un pedido web (nuevo → preparando → listo →
 *  entregado; cancelado desde cualquiera menos entregado). Lanza
 *  FalloTienda; si la transición es inválida llega con codigo 409 y el
 *  mensaje cálido del servidor ("No se puede pasar de «x» a «y»."). */
export async function cambiarEstadoPedido(
  pedidoId: string,
  estado: EstadoPedido
): Promise<void> {
  await pedirTienda<{ ok: boolean }>(
    `/api/tienda/pedidos/${encodeURIComponent(pedidoId)}/estado`,
    {
      cuerpo: { estado },
      timeoutMs: 12000,
    }
  );
}
