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
