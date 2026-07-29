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

// v3.1 (2ª parte) — el móvil DEJA de ofrecer "auto": solo se eligen perla,
// medianoche, arena o cielo. El backend sigue aceptando "auto", pero la app
// canonicaliza todo a un tema concreto (default para tiendas nuevas: perla).
export type TemaTienda = "perla" | "medianoche" | "arena" | "cielo";

export const TEMAS_TIENDA: TemaTienda[] = [
  "perla",
  "medianoche",
  "arena",
  "cielo",
];

const ALIAS_TEMAS: Record<string, TemaTienda> = {
  claro: "perla",
  oscuro: "medianoche",
  // Config vieja con "auto" se muestra como Perla (comportamiento amable:
  // al publicar viaja el tema elegido/canonicalizado, nunca "auto").
  auto: "perla",
};

/** Canonicaliza el tema de la tienda a uno de los 4 ofrecidos. Acepta los
 *  alias viejos ('claro'->perla, 'oscuro'->medianoche, 'auto'->perla) y
 *  cualquier valor raro cae a "perla" (default de tiendas nuevas). */
export function temaTiendaValido(tema: string | null | undefined): TemaTienda {
  let t = (typeof tema === "string" ? tema : "").trim().toLowerCase();
  t = ALIAS_TEMAS[t] ?? t;
  return (TEMAS_TIENDA as string[]).includes(t) ? (t as TemaTienda) : "perla";
}

/** Compatibilidad: antes resolvía "auto" según el sistema. Como ya no se
 *  ofrece auto, ahora equivale a temaTiendaValido (se conserva la firma
 *  para no romper llamadas existentes; `sistemaOscuro` se ignora). */
export function temaTiendaEfectivo(
  tema: string | null | undefined,
  _sistemaOscuro?: boolean
): TemaTienda {
  return temaTiendaValido(tema);
}

// Nombres con personalidad para MOSTRAR (los ids NO cambian). Espejo de
// tienda_utils.NOMBRES_PLANTILLA.
export const NOMBRES_PLANTILLA: Record<PlantillaId, string> = {
  aurora: "Amanecer",
  noche: "Nocturna",
  mercado: "Mercadito",
  boutique: "Vitrina",
  menu: "La Carta",
  catalogo: "Surtido",
};

/** Nombre display de una plantilla; id desconocido -> el propio id. */
export function nombrePlantilla(id: string | null | undefined): string {
  const n = NOMBRES_PLANTILLA[(typeof id === "string" ? id : "") as PlantillaId];
  return n ?? (typeof id === "string" && id !== "" ? id : "Amanecer");
}

// Fondos guía por tema (para el aviso de contraste en el móvil). El acento
// real por plantilla lo ajusta el backend contra el fondo exacto de cada
// paleta; aquí alcanza con el fondo guía del tema.
export const FONDOS_TEMA: Record<Exclude<TemaTienda, "auto">, string> = {
  perla: "#f6f7fb",
  medianoche: "#0d0f16",
  arena: "#f7f1e6",
  cielo: "#eef4f9",
};

// ---------------------------------------------------------------------------
// v3.1 — Guardia de contraste del acento (WCAG). Espejo EXACTO de la
// matemática de tienda_utils.py (luminancia relativa + ajuste HSL).
// ---------------------------------------------------------------------------

const REGEX_HEX = /^#[0-9a-fA-F]{6}$/;

/** Acepta solo #RRGGBB; lo demás -> defecto (espejo de validar_color_hex). */
export function validarColorHex(
  color: string | null | undefined,
  defecto = "#2563eb"
): string {
  const c = (typeof color === "string" ? color : "").trim();
  return REGEX_HEX.test(c) ? c.toLowerCase() : defecto;
}

function canalLineal(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Luminancia relativa WCAG (0 = negro, 1 = blanco). Inválido -> 0. */
export function luminanciaRelativa(hexColor: string | null | undefined): number {
  const c = validarColorHex(hexColor, "#000000");
  const r = parseInt(c.slice(1, 3), 16) / 255;
  const g = parseInt(c.slice(3, 5), 16) / 255;
  const b = parseInt(c.slice(5, 7), 16) / 255;
  return 0.2126 * canalLineal(r) + 0.7152 * canalLineal(g) + 0.0722 * canalLineal(b);
}

/** Razón de contraste WCAG entre dos colores (1.0 a 21.0). */
export function razonContraste(hexA: string, hexB: string): number {
  const l1 = luminanciaRelativa(hexA);
  const l2 = luminanciaRelativa(hexB);
  const claro = Math.max(l1, l2);
  const oscuro = Math.min(l1, l2);
  return (claro + 0.05) / (oscuro + 0.05);
}

/** True si el acento sobre el fondo alcanza el mínimo (3:1 para CTAs). */
export function contrasteSuficiente(
  acento: string,
  fondo: string,
  minimo = 3.0
): boolean {
  return razonContraste(acento, fondo) >= minimo;
}

function hexAHsl(c: string): [number, number, number] {
  const r = parseInt(c.slice(1, 3), 16) / 255;
  const g = parseInt(c.slice(3, 5), 16) / 255;
  const b = parseInt(c.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const li = (mx + mn) / 2;
  if (mx === mn) return [0, 0, li];
  const d = mx - mn;
  const s = li > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, li];
}

// Python round() es "banker's rounding" (mitad al par); JS Math.round no.
// Se espeja para que los hex del ajuste salgan idénticos al backend.
function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

function hue(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslAHex(h: number, s: number, li: number): string {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = li;
  } else {
    const q = li < 0.5 ? li * (1 + s) : li + s - li * s;
    const p = 2 * li - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  const a = (v: number) =>
    pyRound(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${a(r)}${a(g)}${a(b)}`;
}

/** Devuelve un acento que SÍ contraste con el fondo (>= minimo, 3:1).
 *  Espejo EXACTO de tienda_utils.acento_contraste_seguro: si ya cumple se
 *  regresa intacto; si no, se aclara u oscurece en pasos HSL (preservando
 *  matiz y saturación) en la dirección que más contraste da. */
export function acentoContrasteSeguro(
  acento: string,
  fondo: string,
  minimo = 3.0,
  maxPasos = 24
): string {
  const a = validarColorHex(acento);
  const f = validarColorHex(fondo, "#faf8f5");
  if (contrasteSuficiente(a, f, minimo)) return a;
  const [h, s, li] = hexAHsl(a);
  const haciaClaro = luminanciaRelativa(f) < 0.5;
  let mejor = a;
  for (let paso = 1; paso <= maxPasos; paso++) {
    const delta = paso / maxPasos;
    const nuevaLi = haciaClaro ? li + (1 - li) * delta : li * (1 - delta);
    const candidato = hslAHex(h, s, nuevaLi);
    mejor = candidato;
    if (contrasteSuficiente(candidato, f, minimo)) return candidato;
  }
  return mejor;
}

/** Fondo guía del tema, para el aviso de contraste al elegir el acento.
 *  (`sistemaOscuro` ya no aplica: el móvil no ofrece "auto".) */
export function fondoGuiaTema(
  tema: string | null | undefined,
  _sistemaOscuro?: boolean
): string {
  return FONDOS_TEMA[temaTiendaValido(tema)];
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

/** Transiciones válidas, ESPEJO del backend (tienda_utils.TRANSICIONES_PEDIDO
 *  v3.1): nuevo → listo → entregado; cancelado desde nuevo o listo.
 *  `preparando` ya NO es alcanzable para pedidos nuevos, pero se conservan
 *  sus salidas (legado: pedidos viejos no se quedan atorados). */
export const TRANSICIONES_PEDIDO: Record<EstadoPedido, EstadoPedido[]> = {
  nuevo: ["listo", "cancelado"],
  preparando: ["listo", "cancelado"], // legado
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

// ---------------------------------------------------------------------------
// v3.1 — Avisar al cliente por WhatsApp (pedidos web)
// ---------------------------------------------------------------------------

/** Normaliza el teléfono del cliente para wa.me: solo dígitos con lada.
 *  10 dígitos -> se asume México y se antepone 52. 11-15 dígitos -> se
 *  aceptan tal cual (ya traen lada). Cualquier otra cosa -> null (la UI
 *  oculta el botón y explica cálidamente por qué). */
export function telefonoParaWhatsApp(tel: string | null | undefined): string | null {
  if (typeof tel !== "string") return null;
  const d = tel.replace(/\D/g, "");
  if (d.length === 10) return `52${d}`;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

/** URL wa.me con el mensaje pre-redactado (encodeURIComponent). */
export function urlWhatsAppCliente(telefono: string, mensaje: string): string {
  return `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
}

/** URL mailto: para avisar al cliente por correo cuando NO hay teléfono
 *  (v3.1: el pedido puede traer solo correo). Asunto y cuerpo viajan
 *  encodeURIComponent; correo vacío -> "" (la UI no muestra el botón). */
export function urlCorreoCliente(
  correo: string | null | undefined,
  asunto: string,
  cuerpo: string
): string {
  const c = (typeof correo === "string" ? correo : "").trim();
  if (c === "") return "";
  return (
    `mailto:${encodeURIComponent(c)}` +
    `?subject=${encodeURIComponent(asunto)}` +
    `&body=${encodeURIComponent(cuerpo)}`
  );
}

/** Mensaje cálido de cancelación para avisar al cliente por WhatsApp. */
export function mensajePedidoCancelado(
  nombreCliente: string,
  nombreNegocio: string,
  folio: string
): string {
  const cliente = nombreCliente.trim() || "hola";
  const negocio = nombreNegocio.trim() || "tu tienda";
  return (
    `Hola ${cliente}, te saluda ${negocio}. Tu pedido ${folio} fue cancelado. ` +
    `Si tienes dudas, aquí estamos.`
  );
}

/** Mensaje cálido de "pedido listo": pickup -> pásalo a recoger;
 *  domicilio -> va en camino. */
export function mensajePedidoListo(
  nombreCliente: string,
  nombreNegocio: string,
  folio: string,
  entrega: string | null | undefined
): string {
  const cliente = nombreCliente.trim() || "hola";
  const negocio = nombreNegocio.trim() || "tu tienda";
  const cierre =
    entrega === "domicilio"
      ? "y ya va en camino a tu domicilio."
      : "y ya puedes pasar a recogerlo.";
  return `Hola ${cliente}, te saluda ${negocio}. Tu pedido ${folio} ya está listo ${cierre}`;
}

// ---------------------------------------------------------------------------
// v3.1 (2ª parte) — pin en el mapa y venta web al completar
// ---------------------------------------------------------------------------

const REGEX_UBICACION =
  /^\s*(-?\d{1,2}(?:\.\d{1,6})?)\s*,\s*(-?\d{1,3}(?:\.\d{1,6})?)\s*$/;

/** URL de Google Maps para el pin del pedido. Espejo de
 *  tienda_utils.normalizar_ubicacion: "lat,lng" (hasta 6 decimales,
 *  lat -90..90, lng -180..180) normalizada a 6 decimales; inválida o
 *  vacía -> "" (la UI no muestra el botón). */
export function urlMapaUbicacion(ubicacion: string | null | undefined): string {
  const m = REGEX_UBICACION.exec(typeof ubicacion === "string" ? ubicacion : "");
  if (!m) return "";
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!isFinite(lat) || !isFinite(lng)) return "";
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return "";
  const q = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  return `https://maps.google.com/?q=${encodeURIComponent(q)}`;
}

// --- Mapeo pedido web -> venta del POS (se registra al marcar entregado) ---

/** La venta web se identifica con ventas.origen = 'web' (columna local
 *  existente; la nube no la recibe: su MAPA de columnas no la incluye). */
export const ORIGEN_VENTA_WEB = "web";

/** Método de pago del POS para una venta web: efectivo si el cliente paga
 *  al recibir; pago en línea cae en "tarjeta" (el bucket no-efectivo del
 *  corte: ese dinero NO está en el cajón). */
export function metodoPagoVentaWeb(
  pago: string | null | undefined
): "efectivo" | "tarjeta" {
  return pago === "en_linea" ? "tarjeta" : "efectivo";
}

export type LineaVentaWeb = {
  producto_id: string | null; // null = línea libre (p. ej. el envío)
  nombre: string;
  cantidad: number;
  precio_centavos: number;
};

/** Líneas de la venta a partir del pedido: los items tal cual (precios ya
 *  validados server-side) y, si la entrega es a domicilio y el total supera
 *  la suma de items, una línea "Envío a domicilio" por la diferencia (el
 *  envío es ingreso y debe verse en Vendido hoy). */
export function lineasVentaWeb(
  items: { producto_id: string; nombre: string; cantidad: number; precio_centavos: number }[],
  totalCentavos: number,
  entrega: string | null | undefined
): LineaVentaWeb[] {
  const lineas: LineaVentaWeb[] = (Array.isArray(items) ? items : []).map((it) => ({
    producto_id: it.producto_id,
    nombre: it.nombre,
    cantidad: it.cantidad,
    precio_centavos: it.precio_centavos,
  }));
  const sumaItems = lineas.reduce(
    (s, l) => s + Math.round(l.precio_centavos * l.cantidad),
    0
  );
  const envio = Math.round(totalCentavos) - sumaItems;
  if (entrega === "domicilio" && envio > 0) {
    lineas.push({
      producto_id: null,
      nombre: "Envío a domicilio",
      cantidad: 1,
      precio_centavos: envio,
    });
  }
  return lineas;
}
