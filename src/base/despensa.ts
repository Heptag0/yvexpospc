// YvexPOS Móvil — Despensa de ingredientes: insumos que se COMPRAN a granel
// para fabricar productos (harina, queso crema, cajas de pizza...),
// reutilizables entre muchas recetas.
//
// ⚠️ Un ingrediente de despensa NUNCA es un producto de `productos`. Son
// catálogos deliberadamente separados: la despensa es "lo que te cuesta
// fabricar", `productos` es "lo que vendes". Solo una RECETA terminada
// (ver recetas.ts) puede dar el salto y crear un producto de venta.
//
// Puerto de despensa.rs del PC — mismos nombres, misma validación. Una
// diferencia deliberada: el PC guarda dispositivo_id en esta tabla; el
// móvil no, porque ninguna otra tabla local-only lo hace aquí (proveedores,
// clientes, cotizaciones, perfiles_etiqueta tampoco) — no hay noción de
// multi-dispositivo para datos que nunca salen de este teléfono.
//
// LOCAL-ONLY (v1), mismo criterio que perfiles_etiqueta.

import { bd, uuid, ahoraISO } from "./db";

export type Ingrediente = {
  id: string;
  nombre: string;
  unidad: "g" | "ml" | "pieza";
  tamano_paquete: number;
  costo_paquete_centavos: number;
  /** Costo por 1 unidad base (g/ml/pieza), calculado al leer — igual que el
   *  PC, para que ninguna pantalla repita la misma división. */
  costo_por_unidad_centavos: number;
  calorias_kcal: number;
  azucares_g: number;
  grasas_saturadas_g: number;
  grasas_trans_g: number;
  sodio_mg: number;
  proteinas_g: number;
  carbohidratos_g: number;
  grasas_totales_g: number;
  fibra_g: number;
  notas: string | null;
  actualizado_en: string;
};

export type NuevoIngrediente = {
  nombre: string;
  unidad: "g" | "ml" | "pieza";
  tamano_paquete: number;
  costo_paquete_centavos: number;
  calorias_kcal?: number;
  azucares_g?: number;
  grasas_saturadas_g?: number;
  grasas_trans_g?: number;
  sodio_mg?: number;
  proteinas_g?: number;
  carbohidratos_g?: number;
  grasas_totales_g?: number;
  fibra_g?: number;
  notas?: string | null;
};

export type EditarIngrediente = NuevoIngrediente & { id: string };

const UNIDADES_VALIDAS = ["g", "ml", "pieza"] as const;

function validar(d: NuevoIngrediente): void {
  if (!d.nombre.trim()) throw new Error("Ponle un nombre al ingrediente.");
  if (!UNIDADES_VALIDAS.includes(d.unidad)) throw new Error(`Unidad inválida: ${d.unidad}`);
  if (d.tamano_paquete <= 0) throw new Error("El tamaño del paquete debe ser mayor a cero.");
  if (d.costo_paquete_centavos < 0) throw new Error("El costo del paquete no puede ser negativo.");
}

function limpio(s?: string | null): string | null {
  const t = s?.trim();
  return t ? t : null;
}

const COLS = `id, nombre, unidad, tamano_paquete, costo_paquete_centavos,
  calorias_kcal, azucares_g, grasas_saturadas_g, grasas_trans_g, sodio_mg,
  proteinas_g, carbohidratos_g, grasas_totales_g, fibra_g, notas, actualizado_en`;

type FilaCruda = {
  id: string; nombre: string; unidad: "g" | "ml" | "pieza";
  tamano_paquete: number; costo_paquete_centavos: number;
  calorias_kcal: number; azucares_g: number; grasas_saturadas_g: number;
  grasas_trans_g: number; sodio_mg: number; proteinas_g: number;
  carbohidratos_g: number; grasas_totales_g: number; fibra_g: number;
  notas: string | null; actualizado_en: string;
};

function conCostoUnitario(f: FilaCruda): Ingrediente {
  const costo_por_unidad_centavos = f.tamano_paquete > 0 ? f.costo_paquete_centavos / f.tamano_paquete : 0;
  return { ...f, costo_por_unidad_centavos };
}

export async function listarIngredientes(): Promise<Ingrediente[]> {
  const db = await bd();
  const filas = await db.getAllAsync<FilaCruda>(
    `SELECT ${COLS} FROM despensa_ingredientes WHERE eliminado = 0 ORDER BY nombre COLLATE NOCASE`
  );
  return filas.map(conCostoUnitario);
}

export async function obtenerIngrediente(id: string): Promise<Ingrediente | null> {
  const db = await bd();
  const f = await db.getFirstAsync<FilaCruda>(
    `SELECT ${COLS} FROM despensa_ingredientes WHERE eliminado = 0 AND id = ?`,
    [id]
  );
  return f ? conCostoUnitario(f) : null;
}

export async function crearIngrediente(d: NuevoIngrediente): Promise<string> {
  validar(d);
  const db = await bd();
  const id = uuid();
  const ts = ahoraISO();
  await db.runAsync(
    `INSERT INTO despensa_ingredientes
       (id, nombre, unidad, tamano_paquete, costo_paquete_centavos,
        calorias_kcal, azucares_g, grasas_saturadas_g, grasas_trans_g, sodio_mg,
        proteinas_g, carbohidratos_g, grasas_totales_g, fibra_g, notas,
        eliminado, creado_en, actualizado_en)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
    [
      id, d.nombre.trim(), d.unidad, d.tamano_paquete, d.costo_paquete_centavos,
      Math.max(0, d.calorias_kcal ?? 0), Math.max(0, d.azucares_g ?? 0),
      Math.max(0, d.grasas_saturadas_g ?? 0), Math.max(0, d.grasas_trans_g ?? 0),
      Math.max(0, d.sodio_mg ?? 0), Math.max(0, d.proteinas_g ?? 0),
      Math.max(0, d.carbohidratos_g ?? 0), Math.max(0, d.grasas_totales_g ?? 0),
      Math.max(0, d.fibra_g ?? 0), limpio(d.notas), ts, ts,
    ]
  );
  return id;
}

export async function editarIngrediente(e: EditarIngrediente): Promise<void> {
  validar(e);
  const db = await bd();
  const ts = ahoraISO();
  const res = await db.runAsync(
    `UPDATE despensa_ingredientes SET
       nombre=?, unidad=?, tamano_paquete=?, costo_paquete_centavos=?,
       calorias_kcal=?, azucares_g=?, grasas_saturadas_g=?, grasas_trans_g=?,
       sodio_mg=?, proteinas_g=?, carbohidratos_g=?, grasas_totales_g=?,
       fibra_g=?, notas=?, actualizado_en=?
     WHERE id=? AND eliminado=0`,
    [
      e.nombre.trim(), e.unidad, e.tamano_paquete, e.costo_paquete_centavos,
      Math.max(0, e.calorias_kcal ?? 0), Math.max(0, e.azucares_g ?? 0),
      Math.max(0, e.grasas_saturadas_g ?? 0), Math.max(0, e.grasas_trans_g ?? 0),
      Math.max(0, e.sodio_mg ?? 0), Math.max(0, e.proteinas_g ?? 0),
      Math.max(0, e.carbohidratos_g ?? 0), Math.max(0, e.grasas_totales_g ?? 0),
      Math.max(0, e.fibra_g ?? 0), limpio(e.notas), ts, e.id,
    ]
  );
  if (res.changes === 0) throw new Error("No se encontró el ingrediente.");
}

/** Soft delete. Las recetas que ya usaron este ingrediente NO se rompen:
 *  receta_lineas guardó su propio nombre_congelado y costo_congelado, así
 *  que siguen mostrándose completas aunque el ingrediente desaparezca de
 *  la despensa activa. */
export async function eliminarIngrediente(id: string): Promise<void> {
  const db = await bd();
  const res = await db.runAsync(
    "UPDATE despensa_ingredientes SET eliminado = 1, actualizado_en = ? WHERE id = ?",
    [ahoraISO(), id]
  );
  if (res.changes === 0) throw new Error("No se encontró el ingrediente.");
}

// ---------------------------------------------------------------------------
// Búsqueda de nutrición en Open Food Facts — DIRECTO, sin pasar por
// pos.yvexiq.com. Puerto de fotos_externas.rs::buscar_nutricion_por_nombre.
// A diferencia de "quitar fondo" (que sí exige cuenta vinculada porque corre
// en el VPS propio), esto es una consulta pública sin autenticación —
// funciona igual con o sin cuenta.
// ---------------------------------------------------------------------------

export type CandidatoNutricion = {
  nombre: string;
  marca: string | null;
  calorias_kcal: number;
  azucares_g: number;
  grasas_saturadas_g: number;
  grasas_trans_g: number;
  sodio_mg: number;
  proteinas_g: number;
  carbohidratos_g: number;
  grasas_totales_g: number;
  fibra_g: number;
};

const OFF_TIEMPO_LIMITE_MS = 8000;

type OffNutrientes = {
  "energy-kcal_100g"?: number;
  sugars_100g?: number;
  "saturated-fat_100g"?: number;
  "trans-fat_100g"?: number;
  /** OFF guarda el sodio en GRAMOS por 100 g, no en mg — se convierte abajo
   *  al mapear a CandidatoNutricion (nuestro esquema usa mg, como pide la
   *  tabla nutrimental de una etiqueta NOM-051 real). */
  sodium_100g?: number;
  proteins_100g?: number;
  carbohydrates_100g?: number;
  fat_100g?: number;
  fiber_100g?: number;
};

type OffProductoBusqueda = {
  product_name?: string;
  brands?: string;
  nutriments?: OffNutrientes;
};

type OffBusquedaRespuesta = {
  products?: OffProductoBusqueda[];
};

/** Ejecuta UNA búsqueda contra OFF. `soloMexico` filtra a productos
 *  etiquetados como vendidos en México (prioriza Lala/Alpura/Santa Clara
 *  sobre marcas españolas como Hacendado, que dominan la base por tener
 *  muchos más contribuidores). Nunca lanza: red caída, tiempo agotado o
 *  respuesta rara devuelven lista vacía — es sugerencia, no algo crítico. */
async function ejecutarBusquedaOFF(q: string, soloMexico: boolean): Promise<CandidatoNutricion[]> {
  const params = new URLSearchParams({
    search_terms: q,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: "8",
    fields: "product_name,brands,nutriments",
  });
  if (soloMexico) {
    params.set("tagtype_0", "countries");
    params.set("tag_contains_0", "contains");
    params.set("tag_0", "mexico");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OFF_TIEMPO_LIMITE_MS);
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?${params.toString()}`,
      {
        headers: { "User-Agent": "YvexPOS/1.0 (contacto: soporte@yvexiq.com)" },
        signal: ctrl.signal,
      }
    );
    if (!res.ok) return [];
    const datos: OffBusquedaRespuesta = await res.json();
    const productos = datos.products ?? [];

    const candidatos: CandidatoNutricion[] = [];
    for (const p of productos) {
      const nombre = p.product_name?.trim();
      if (!nombre) continue;
      const n = p.nutriments ?? {};
      candidatos.push({
        nombre,
        marca: p.brands ?? null,
        calorias_kcal: n["energy-kcal_100g"] ?? 0,
        azucares_g: n.sugars_100g ?? 0,
        grasas_saturadas_g: n["saturated-fat_100g"] ?? 0,
        grasas_trans_g: n["trans-fat_100g"] ?? 0,
        sodio_mg: (n.sodium_100g ?? 0) * 1000,
        proteinas_g: n.proteins_100g ?? 0,
        carbohidratos_g: n.carbohydrates_100g ?? 0,
        grasas_totales_g: n.fat_100g ?? 0,
        fibra_g: n.fiber_100g ?? 0,
      });
      if (candidatos.length >= 8) break;
    }
    return candidatos;
  } catch {
    // Sin internet, tiempo agotado, JSON raro: lista vacía, nunca error.
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Busca candidatos de nutrición por nombre de producto. Lista vacía es el
 *  caso normal — igual que el resto de búsquedas externas de la app, nunca
 *  interrumpe al usuario con un error.
 *
 *  Primero intenta SOLO productos de México (Lala, Alpura, Santa Clara...);
 *  si eso no encuentra nada, cae de vuelta a la búsqueda global sin filtro
 *  de país — mejor un resultado español que ninguno. */
export async function buscarNutricionPorNombre(nombre: string): Promise<CandidatoNutricion[]> {
  const q = nombre.trim();
  if (q.length < 3) return []; // evita disparar búsquedas con 1-2 letras mientras se escribe

  const deMexico = await ejecutarBusquedaOFF(q, true);
  if (deMexico.length > 0) return deMexico;
  return ejecutarBusquedaOFF(q, false);
}
