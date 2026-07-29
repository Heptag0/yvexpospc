// YvexPOS Móvil — Reglas PURAS de la tienda en línea (escaparate).
//
// Sin imports nativos ni de expo: texto y números nada más. 100% testeable
// con node puro (test-tienda-movil.mjs), igual que lealtadReglas.ts.
//
// El backend (tienda.yvexiq.com) también normaliza slug y whatsapp; aquí
// hacemos lo mismo del lado del móvil para que el usuario VEA lo que se va a
// publicar antes de picar "Publicar", y para validar sin gastar una llamada.

/** Slug amable a partir del nombre del negocio: minúsculas, sin acentos,
 *  todo lo que no sea letra/número → guiones, guiones colapsados y sin
 *  guiones laterales, máx. 40 caracteres. Si queda vacío → "mi-tienda". */
export function sugerirSlug(nombreNegocio: string): string {
  if (typeof nombreNegocio !== "string") return "mi-tienda";
  let s = nombreNegocio
    .toLowerCase()
    // NFD separa la tilde de la letra (á -> a + ´) y así se quita fácil.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    // El recorte a 40 puede dejar un guion colgando al final.
    .replace(/^-+|-+$/g, "");
  return s === "" ? "mi-tienda" : s;
}

/** Valida y NORMALIZA un número de WhatsApp: acepta con o sin +52, con
 *  espacios/guiones/paréntesis, y devuelve SOLO dígitos (10-15). Si no
 *  cuadra, null (la UI avisa, nunca truena). */
export function whatsappValido(w: string | null | undefined): string | null {
  if (typeof w !== "string") return null;
  const digitos = w.replace(/\D/g, "");
  if (digitos.length < 10 || digitos.length > 15) return null;
  return digitos;
}

/** Texto cálido para compartir el enlace de la tienda (Share nativo). */
export function armarTextoAyuda(url: string, nombreNegocio: string): string {
  const nombre =
    typeof nombreNegocio === "string" && nombreNegocio.trim()
      ? nombreNegocio.trim()
      : "mi negocio";
  return (
    `¡Ya puedes ver el catálogo de ${nombre} en línea! ` +
    `Entra, escoge lo que quieras y pídelo por WhatsApp: ${url}`
  );
}

/** URL pública de una tienda a partir de su slug. */
export function urlPublica(base: string, slug: string): string {
  const b = base.replace(/\/+$/, "");
  return `${b}/t/${slug}`;
}

// ---------------------------------------------------------------------------
// v2 — enlace propio, plantillas, redes, pedidos
// ---------------------------------------------------------------------------

/** Normaliza lo que el dueño escribió como su enlace (slug): minúsculas,
 *  sin acentos ni espacios, solo [a-z0-9-], guiones colapsados y sin
 *  guiones laterales, máx. 40. NO inventa un default: si queda vacío
 *  devuelve "" para que la UI avise (a diferencia de sugerirSlug). */
export function normalizarSlug(texto: string | null | undefined): string {
  if (typeof texto !== "string") return "";
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
}

/** ¿El slug normalizado cumple el formato estricto del servidor?
 *  (3-40 chars, alfanumérico + guiones). Vacío o muy corto → false. */
export function slugFormatoValido(slug: string | null | undefined): boolean {
  if (typeof slug !== "string") return false;
  return /^[a-z0-9][a-z0-9-]{2,39}$/.test(slug) && !slug.includes("--");
}

/** URL de subdominio de la tienda: https://{slug}.yvexiq.com */
export function urlSubdominio(slug: string): string {
  return `https://${slug}.yvexiq.com`;
}

export type PlantillaId =
  | "aurora"
  | "noche"
  | "mercado"
  | "boutique"
  | "menu"
  | "catalogo";

/** Mapa giro → plantilla, ESPEJO del backend (tienda_utils.GIRO_A_PLANTILLA):
 *  ropa/belleza/mascotas → boutique; cafeteria/restaurante → menu;
 *  abarrotes/farmacia/ferreteria/electronica/otro → catalogo;
 *  cualquier giro desconocido → aurora. */
export function plantillaParaGiro(giro: string | null | undefined): PlantillaId {
  const g = (typeof giro === "string" ? giro : "").trim().toLowerCase();
  if (g === "ropa" || g === "belleza" || g === "mascotas") return "boutique";
  if (g === "cafeteria" || g === "restaurante") return "menu";
  if (
    g === "abarrotes" ||
    g === "farmacia" ||
    g === "ferreteria" ||
    g === "electronica" ||
    g === "otro"
  )
    return "catalogo";
  return "aurora";
}

/** Pesos (texto del teclado, admite coma) → centavos enteros. Redondea al
 *  centavo más cercano y jamás devuelve negativo. Entrada inválida → null
 *  (la UI avisa, no truena). */
export function pesosACentavos(texto: string | null | undefined): number | null {
  if (typeof texto !== "string") return null;
  const limpio = texto.trim().replace(",", ".").replace(/[$\s]/g, "");
  if (limpio === "") return null;
  const n = Number(limpio);
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Normaliza una red social: acepta "@usuario", "usuario", URL completa
 *  (https://instagram.com/usuario, con o sin www) o URL sin protocolo.
 *  Devuelve:
 *   - instagram/tiktok → "@usuario" (minúsculas)
 *   - facebook → "usuario" o la URL completa si es perfil largo (sin @)
 *  Vacío o irreconocible → "". */
export function normalizarRed(
  red: "instagram" | "facebook" | "tiktok",
  entrada: string | null | undefined
): string {
  if (typeof entrada !== "string") return "";
  let s = entrada.trim();
  if (s === "") return "";

  // Quitar protocolo y www para analizar.
  const sinProto = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const dominios: Record<string, RegExp> = {
    instagram: /^instagram\.com\/([^/?#]+)/i,
    facebook: /^facebook\.com\/([^/?#]+)/i,
    tiktok: /^tiktok\.com\/@?([^/?#]+)/i,
  };
  const m = sinProto.match(dominios[red]);
  let usuario = m ? m[1] : s;

  // Limpieza del usuario: sin @ inicial, sin diagonales, sin espacios.
  usuario = usuario.replace(/^@/, "").replace(/[/\s]/g, "").trim();
  if (usuario === "") return "";

  if (red === "instagram" || red === "tiktok") {
    usuario = usuario.toLowerCase();
    return `@${usuario}`;
  }
  // Facebook acepta páginas con puntos/guiones; se conserva sin @.
  return usuario;
}

/** Link de pago en línea: debe ser una URL http(s) con dominio. Vacío es
 *  válido (es opcional) → true. Inválido → false (la UI avisa). */
export function linkPagoValido(link: string | null | undefined): boolean {
  if (typeof link !== "string") return false;
  const s = link.trim();
  if (s === "") return true; // opcional
  return /^https?:\/\/[^\s]+\.[^\s]{2,}/i.test(s);
}

// ---------------------------------------------------------------------------
// v3 — tema de la tienda, vista previa y pedidos web
// ---------------------------------------------------------------------------

export type TemaTienda = "claro" | "oscuro" | "auto";

/** Normaliza el tema de la tienda. Espejo de tienda_utils.validar_tema:
 *  cualquier valor raro cae a "auto" (sigue el tema del teléfono del cliente). */
export function temaTiendaValido(tema: string | null | undefined): TemaTienda {
  const t = (typeof tema === "string" ? tema : "").trim().toLowerCase();
  return t === "claro" || t === "oscuro" || t === "auto" ? t : "auto";
}

/** URL de la vista previa REAL de la tienda con el look forzado
 *  (GET /t/{slug}/preview?plantilla=X&tema=Y&acento=%23hex del backend v3).
 *  El acento viaja URL-encoded (el # como %23). */
export function urlPreviewTienda(
  base: string,
  slug: string,
  plantilla: string,
  tema: string,
  acento: string
): string {
  const b = base.replace(/\/+$/, "");
  const q =
    `?plantilla=${encodeURIComponent(plantilla)}` +
    `&tema=${encodeURIComponent(temaTiendaValido(tema))}` +
    `&acento=${encodeURIComponent(acento)}`;
  return `${b}/t/${encodeURIComponent(slug)}/preview${q}`;
}

// --- Pedidos web ---

export type EstadoPedido =
  | "nuevo"
  | "preparando"
  | "listo"
  | "entregado"
  | "cancelado";

/** Transiciones válidas, ESPEJO del backend (tienda_utils.TRANSICIONES_PEDIDO):
 *  nuevo → preparando → listo → entregado; cancelado desde cualquiera menos
 *  entregado (y nada sale de entregado ni de cancelado). */
export const TRANSICIONES_PEDIDO: Record<EstadoPedido, EstadoPedido[]> = {
  nuevo: ["preparando", "cancelado"],
  preparando: ["listo", "cancelado"],
  listo: ["entregado", "cancelado"],
  entregado: [],
  cancelado: [],
};

/** ¿El pedido puede pasar de `actual` a `nuevo`? Estados raros → false. */
export function transicionPedidoValida(
  actual: string | null | undefined,
  nuevo: string | null | undefined
): boolean {
  const a = (typeof actual === "string" ? actual : "") as EstadoPedido;
  const n = (typeof nuevo === "string" ? nuevo : "") as EstadoPedido;
  const permitidas = TRANSICIONES_PEDIDO[a];
  return Array.isArray(permitidas) && permitidas.includes(n);
}

/** Etiqueta cálida del estado del pedido (la del chip y los botones). */
export function etiquetaEstadoPedido(estado: string | null | undefined): string {
  switch (estado) {
    case "nuevo":
      return "Nuevo";
    case "preparando":
      return "En preparación";
    case "listo":
      return "Listo";
    case "entregado":
      return "Entregado";
    case "cancelado":
      return "Cancelado";
    default:
      return "Desconocido";
  }
}

/** Folio corto del pedido web: primeros 8 del UUID en mayúsculas, ESPEJO
 *  del backend ("Folio web: {pedido_id[:8].upper()}"). Con # para leerse
 *  como folio: "#A1B2C3D4". */
export function folioCortoPedido(id: string | null | undefined): string {
  const limpio = (typeof id === "string" ? id : "").replace(/-/g, "");
  if (limpio === "") return "#—";
  return `#${limpio.slice(0, 8).toUpperCase()}`;
}

/** Hora relativa cálida: "hace un momento", "hace 5 min", "hace 2 h",
 *  "hace 3 d"; una semana o más → "hace 2 sem". `ahoraMs` es inyectable
 *  para las pruebas; fecha inválida o futura → "hace un momento". */
export function horaRelativa(
  iso: string | null | undefined,
  ahoraMs?: number
): string {
  if (typeof iso !== "string" || iso.trim() === "") return "hace un momento";
  const t = Date.parse(iso);
  if (!isFinite(t)) return "hace un momento";
  const ahora = typeof ahoraMs === "number" && isFinite(ahoraMs) ? ahoraMs : Date.now();
  const seg = Math.floor((ahora - t) / 1000);
  if (seg < 60) return "hace un momento";
  const min = Math.floor(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? "hace 1 h" : `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return d === 1 ? "hace 1 día" : `hace ${d} días`;
  const sem = Math.floor(d / 7);
  return sem === 1 ? "hace 1 semana" : `hace ${sem} semanas`;
}

/** Etiqueta de la entrega del pedido ("pickup" | "domicilio" del backend). */
export function etiquetaEntregaPedido(entrega: string | null | undefined): string {
  return entrega === "domicilio" ? "A domicilio" : "Recoger en tienda";
}

/** Etiqueta del pago del pedido ("efectivo" | "en_linea" del backend). */
export function etiquetaPagoPedido(pago: string | null | undefined): string {
  return pago === "en_linea" ? "Pago en línea" : "Efectivo al recibir";
}
