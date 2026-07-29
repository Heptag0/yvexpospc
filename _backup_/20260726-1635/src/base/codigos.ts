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
 *  Devuelve un nombre sugerido limpio: "Marca Nombre, cantidad" (las partes
 *  vacías se omiten y los espacios se sanean). */
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
    // A veces hay varias marcas separadas por coma: nos quedamos la primera.
    const marca = sanea(datos.product.brands).split(",")[0]?.trim() ?? "";
    const nombre = sanea(datos.product.product_name);
    const cantidad = sanea(datos.product.quantity);
    if (!nombre) return null;

    let sugerido = marca && !nombre.toLowerCase().includes(marca.toLowerCase())
      ? `${marca} ${nombre}`
      : nombre;
    if (cantidad) sugerido += `, ${cantidad}`;
    return sugerido;
  } catch {
    // Sin internet, timeout, JSON raro…: no pasa nada, seguimos sin sugerencia.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
