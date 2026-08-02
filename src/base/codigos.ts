// YvexPOS Móvil — Códigos de barras (lógica pura, sin pantalla).
//
// NUEVO feature: escáner de CÓDIGOS DE BARRAS con la cámara (separado del
// escáner de tickets con IA de escaner.ts; no comparten nada).
//
// Aquí vive lo que no necesita React:
//   - normalizar / validar lo que lee la cámara
//   - buscar el producto por código exacto en el inventario local
//   - consultar el "SKU universal" (OpenFoodFacts) para sugerir el nombre
//     de un producto que aún no existe en la tienda
//
// REGLA DE NEGOCIO: esto jamás aplica cambios solo; solo AGREGA al carrito
// o PRELLENA formularios. El tendero siempre confirma.

import { buscarPorCodigo, type Producto } from "./inventario";
import { simplificarNombreUniversal } from "./nombreUniversal";

// ---------------------------------------------------------------------------
// Normalizar / validar
// ---------------------------------------------------------------------------

/** Limpia lo que lee la cámara: sin espacios ni saltos. La cámara a veces
 *  pega espacios o caracteres de control alrededor del dato. */
export function normalizarCodigo(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, "").trim();
}

/** ¿Parece un código de barras real y no ruido de la cámara?
 *  Criterio simple (documentado):
 *    - numérico puro de 8, 12 o 13 dígitos (EAN-8, UPC-A, EAN-13), o
 *    - alfanumérico de 4 a 48 caracteres con solo letras, dígitos y los
 *      símbolos típicos de Code128/Code39/QR (- _ . /).
 *  Cualquier otra cosa (vacío, 1-2 caracteres, emojis…) se rechaza. */
export function esCodigoValido(c: string): boolean {
  if (!c) return false;
  if (/^\d+$/.test(c)) return [8, 12, 13].includes(c.length);
  return /^[A-Za-z0-9\-_.\/]{4,48}$/.test(c);
}

// ---------------------------------------------------------------------------
// Búsqueda local
// ---------------------------------------------------------------------------

/** Busca el producto por código EXACTO en el inventario local.
 *  El catálogo guarda los códigos en MAYÚSCULAS (ver inventario.ts), así que
 *  normalizamos y pasamos a mayúsculas antes de comparar. Devuelve null si
 *  no existe — el flujo decide qué hacer (crear, avisar…). */
export async function buscarProductoPorCodigo(codigo: string): Promise<Producto | null> {
  const c = normalizarCodigo(codigo).toUpperCase();
  if (!esCodigoValido(c)) return null;
  return buscarPorCodigo(c);
}

// ---------------------------------------------------------------------------
// SKU universal (OpenFoodFacts) — best-effort, NUNCA bloquea el flujo
// ---------------------------------------------------------------------------

const TIMEOUT_UNIVERSAL_MS = 6000;

/** Consulta el nombre "universal" de un código en OpenFoodFacts
 *  (https://world.openfoodfacts.org), base de datos abierta de productos.
 *  Cubre SOBRE TODO abarrotes/alimentos y bebidas empacados; para otros
 *  giros (ropa, ferretería, farmacia…) normalmente no hay ficha y simplemente
 *  regresa null.
 *
 *  Es best-effort: si no hay internet, tarda demasiado, el servicio falla o
 *  el código no tiene ficha (status=0), devuelve null SIN lanzar. El flujo
 *  de captura sigue igual de rápido con o sin esta sugerencia.
 *
 *  Devuelve un nombre sugerido LIMPIO y corto gracias a
 *  simplificarNombreUniversal (src/base/nombreUniversal.ts, módulo puro y
 *  probado en test-codigos.mjs): quita marca duplicada, capitaliza marcas en
 *  minúscula, descarta descripciones largas/truncadas y normaliza la
 *  presentación ("600 ml" → "600ml"). Si tras limpiar no queda nada útil,
 *  devuelve null y el tendero escribe el nombre a mano.
 *
 *  Ejemplos reales que vimos en capturas:
 *    "Coca-Cola Coca cola, 600ml"                  → "Coca-Cola 600ml"
 *    "sabritas Botana crujiente a base de pa..."   → "Sabritas 45g"
 *    "e relleno sabor mermelada Gansito, 50..."    → "Gansito 50g" */
export async function consultarNombreUniversal(codigo: string): Promise<string | null> {
  const c = normalizarCodigo(codigo);
  if (!/^\d{8,14}$/.test(c)) return null; // OFF solo indexa códigos numéricos

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_UNIVERSAL_MS);
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(c)}.json?fields=product_name,brands,quantity`,
      {
        headers: {
          // OFF pide identificar a la app; así no nos limitan por abuso.
          "User-Agent": "YvexPOS/1.0 (contacto: soporte@yvexiq.com)",
          Accept: "application/json",
        },
        signal: ctrl.signal,
      }
    );
    if (!res.ok) return null;
    const datos: any = await res.json();
    if (!datos || datos.status !== 1 || !datos.product) return null;

    const sanea = (v: any) => String(v ?? "").replace(/\s+/g, " ").trim();
    if (!sanea(datos.product.product_name)) return null;
    // La limpieza vive en nombreUniversal.ts (módulo puro, con pruebas).
    return simplificarNombreUniversal(
      datos.product.product_name,
      datos.product.brands,
      datos.product.quantity
    );
  } catch {
    // Sin internet, timeout, JSON raro…: no pasa nada, seguimos sin sugerencia.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Foto del catálogo universal — mismo origen que el nombre
// ---------------------------------------------------------------------------

export type FichaUniversal = {
  nombre: string | null;
  imagenUrl: string | null;
};

/** Consulta nombre E IMAGEN de un código en OpenFoodFacts, en UNA sola
 *  petición. Antes se pedía solo el nombre; para un producto conocido
 *  (un refresco, unas galletas de marca) es muy probable que la comunidad ya
 *  haya subido su foto, y bajarla ahorra que el tendero fotografíe él mismo
 *  cientos de productos que ya están fotografiados en internet.
 *
 *  Best-effort igual que el resto: sin internet o sin ficha, devuelve todo en
 *  null y el flujo sigue idéntico.
 *
 *  ⚠️ Las imágenes de OpenFoodFacts son de la comunidad, bajo licencia
 *  Creative Commons Attribution-ShareAlike. Para uso interno del POS (que el
 *  tendero vea sus productos) no hay problema. Si algún día se publican en la
 *  tienda en línea de cara al público, conviene revisar los términos de reuso.
 */
export async function consultarFichaUniversal(codigo: string): Promise<FichaUniversal> {
  const vacia: FichaUniversal = { nombre: null, imagenUrl: null };
  const c = normalizarCodigo(codigo);
  if (!/^\d{8,14}$/.test(c)) return vacia;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_UNIVERSAL_MS);
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(c)}.json` +
        `?fields=product_name,brands,quantity,image_front_url,image_url`,
      {
        headers: {
          "User-Agent": "YvexPOS/1.0 (contacto: soporte@yvexiq.com)",
          Accept: "application/json",
        },
        signal: ctrl.signal,
      }
    );
    if (!res.ok) return vacia;
    const datos: any = await res.json();
    // OFF responde 200 aunque el producto no exista: lo que manda es `status`.
    if (!datos || datos.status !== 1 || !datos.product) return vacia;

    const p = datos.product;
    const sanea = (v: any) => String(v ?? "").replace(/\s+/g, " ").trim();
    const nombre = sanea(p.product_name)
      ? simplificarNombreUniversal(p.product_name, p.brands, p.quantity)
      : null;
    // image_front_url es la foto del frente (la buena para un catálogo);
    // image_url es la genérica, como respaldo.
    const imagenUrl = p.image_front_url || p.image_url || null;

    return { nombre, imagenUrl };
  } catch {
    return vacia;
  } finally {
    clearTimeout(timer);
  }
}