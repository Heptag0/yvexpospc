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
