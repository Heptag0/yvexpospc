// YvexPOS Móvil — Costeo de recetas: cuánto de cada ingrediente de la
// despensa lleva un producto terminado (pastel, pizza, hamburguesa), para
// saber su costo real y sugerir un precio de venta. Cuando la receta está
// lista, puede mandarse al catálogo: ahí nace un producto de venta normal.
//
// Puerto de recetas.rs del PC — misma fórmula, mismas reglas.
//
// Costo CONGELADO por línea (mismo principio que costo_unitario_centavos en
// venta_lineas): se fija al guardar la receta, no se recalcula solo si
// cambia el precio del ingrediente en la despensa.
//
// Nutrición, en cambio, se calcula EN VIVO desde los valores actuales de la
// despensa cada vez que se lee la receta (no se congela): si corriges los
// gramos de azúcar de un ingrediente, quieres que la receta lo refleje.
//
// ⚠️ guardarReceta() SÍ está envuelta en transacción — a diferencia de la
// versión Rust del PC (recetas.rs::guardar), que hace el DELETE de líneas
// viejas y el loop de INSERT nuevas como llamadas sueltas. Mismo patrón de
// bug que se encontró y corrigió en inventario.ts (crearProducto/
// editarProducto): sin transacción, un fallo a media captura deja la
// receta con líneas parciales. Vale la pena el mismo arreglo en el PC.
//
// LOCAL-ONLY (v1), mismo criterio que despensa y perfiles_etiqueta.

import { bd, uuid, ahoraISO } from "./db";
import { obtenerIngrediente } from "./despensa";
import { crearProducto } from "./inventario";
import { guardarPerfil } from "./etiquetas";

export type NutricionTotal = {
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

export type RecetaLinea = {
  id: string;
  ingrediente_id: string;
  nombre_congelado: string;
  unidad: string;
  cantidad_usada: number;
  costo_congelado_centavos: number;
};

export type Receta = {
  id: string;
  nombre: string;
  rendimiento_cantidad: number;
  rendimiento_unidad: string;
  margen_deseado_pct: number;
  producto_id: string | null;
  notas: string | null;
  lineas: RecetaLinea[];
  costo_total_centavos: number;
  costo_por_rendimiento_centavos: number;
  precio_sugerido_centavos: number;
  nutricion_total: NutricionTotal;
  /** Suma aproximada del peso/volumen de la receta (g + ml tratados 1:1;
   *  los ingredientes por pieza no cuentan porque no tienen un peso
   *  conocido). Sirve para "por 100 g" al mandar a una etiqueta NOM-051 —
   *  es una aproximación de cocina, no un peso certificado. */
  peso_aprox_g: number;
  /** Nombres de ingredientes cuyos 9 campos de nutrición están en cero —
   *  probablemente porque nunca se capturaron, no porque de verdad sean
   *  cero. Heurística simple, informativa — nunca bloquea. */
  ingredientes_sin_nutricion: string[];
  creado_en: string;
  actualizado_en: string;
};

export type RecetaResumen = {
  id: string;
  nombre: string;
  rendimiento_cantidad: number;
  rendimiento_unidad: string;
  costo_por_rendimiento_centavos: number;
  num_ingredientes: number;
  producto_id: string | null;
  actualizado_en: string;
};

export type LineaRecetaEntrada = {
  ingrediente_id: string;
  cantidad_usada: number;
  /** Si el usuario escribió un costo a mano para esta línea (lo compró en
   *  otro lado, otra presentación) se usa este valor tal cual, en vez del
   *  costo calculado desde la despensa. */
  costo_manual_centavos?: number | null;
};

export type NuevaReceta = {
  id?: string;
  nombre: string;
  rendimiento_cantidad: number;
  rendimiento_unidad: string;
  margen_deseado_pct: number;
  notas?: string | null;
  lineas: LineaRecetaEntrada[];
};

function limpio(s?: string | null): string | null {
  const t = s?.trim();
  return t ? t : null;
}

/** Precio sugerido a partir del costo unitario y el margen deseado, usando
 *  la fórmula de margen sobre precio de venta (no sobre costo): margen 50%
 *  significa que la mitad del precio de venta es ganancia, no que se cobra
 *  1.5× el costo. Si el margen es 100 o más (dividir entre cero o
 *  negativo), se cae de vuelta al costo tal cual. */
function precioSugerido(costoCentavos: number, margenPct: number): number {
  if (margenPct >= 100 || margenPct < 0) return costoCentavos;
  return Math.round(costoCentavos / (1 - margenPct / 100));
}

export async function listarResumen(): Promise<RecetaResumen[]> {
  const db = await bd();
  const filas = await db.getAllAsync<{
    id: string; nombre: string; rendimiento_cantidad: number; rendimiento_unidad: string;
    producto_id: string | null; actualizado_en: string;
    costo_total: number; num_ingredientes: number;
  }>(
    `SELECT r.id, r.nombre, r.rendimiento_cantidad, r.rendimiento_unidad,
            r.producto_id, r.actualizado_en,
            COALESCE(SUM(rl.costo_congelado_centavos), 0) AS costo_total,
            COUNT(rl.id) AS num_ingredientes
       FROM recetas r
       LEFT JOIN receta_lineas rl ON rl.receta_id = r.id
      WHERE r.eliminado = 0
      GROUP BY r.id
      ORDER BY r.actualizado_en DESC`
  );
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    rendimiento_cantidad: f.rendimiento_cantidad,
    rendimiento_unidad: f.rendimiento_unidad,
    producto_id: f.producto_id,
    actualizado_en: f.actualizado_en,
    num_ingredientes: f.num_ingredientes,
    costo_por_rendimiento_centavos:
      f.rendimiento_cantidad > 0 ? Math.round(f.costo_total / f.rendimiento_cantidad) : f.costo_total,
  }));
}

/** Nutrición en VIVO: suma, para cada línea, lo que aporta el ingrediente
 *  SEGÚN SUS VALORES ACTUALES en la despensa (no lo congelado). Ignora
 *  `eliminado` a propósito — lee directo de despensa_ingredientes por id,
 *  así un ingrediente borrado (soft delete) sigue existiendo como fila y
 *  una receta vieja que lo referenciaba puede seguir mostrando su aporte. */
async function nutricionYPeso(
  db: Awaited<ReturnType<typeof bd>>,
  lineas: RecetaLinea[]
): Promise<{ total: NutricionTotal; pesoAproxG: number; sinNutricion: string[] }> {
  const total: NutricionTotal = {
    calorias_kcal: 0, azucares_g: 0, grasas_saturadas_g: 0, grasas_trans_g: 0,
    sodio_mg: 0, proteinas_g: 0, carbohidratos_g: 0, grasas_totales_g: 0, fibra_g: 0,
  };
  let pesoAproxG = 0;
  const sinNutricion: string[] = [];

  for (const l of lineas) {
    const ing = await db.getFirstAsync<{
      unidad: string; calorias_kcal: number; azucares_g: number; grasas_saturadas_g: number;
      grasas_trans_g: number; sodio_mg: number; proteinas_g: number; carbohidratos_g: number;
      grasas_totales_g: number; fibra_g: number;
    }>(
      `SELECT unidad, calorias_kcal, azucares_g, grasas_saturadas_g, grasas_trans_g,
              sodio_mg, proteinas_g, carbohidratos_g, grasas_totales_g, fibra_g
         FROM despensa_ingredientes WHERE id = ?`,
      [l.ingrediente_id]
    );
    if (!ing) continue; // ingrediente no encontrado (no debería pasar); se omite su aporte

    // Los 9 campos en cero probablemente significan "nunca se llenó", no
    // "de verdad es cero" (agua sería la única excepción real y legítima).
    if (
      ing.calorias_kcal === 0 && ing.azucares_g === 0 && ing.grasas_saturadas_g === 0 &&
      ing.grasas_trans_g === 0 && ing.sodio_mg === 0 && ing.proteinas_g === 0 &&
      ing.carbohidratos_g === 0 && ing.grasas_totales_g === 0 && ing.fibra_g === 0
    ) {
      sinNutricion.push(l.nombre_congelado);
    }

    // Base de los valores nutricionales: por 100 g/ml, o por 1 pieza.
    const factor = ing.unidad === "pieza" ? l.cantidad_usada : l.cantidad_usada / 100;

    total.calorias_kcal += ing.calorias_kcal * factor;
    total.azucares_g += ing.azucares_g * factor;
    total.grasas_saturadas_g += ing.grasas_saturadas_g * factor;
    total.grasas_trans_g += ing.grasas_trans_g * factor;
    total.sodio_mg += ing.sodio_mg * factor;
    total.proteinas_g += ing.proteinas_g * factor;
    total.carbohidratos_g += ing.carbohidratos_g * factor;
    total.grasas_totales_g += ing.grasas_totales_g * factor;
    total.fibra_g += ing.fibra_g * factor;

    if (ing.unidad === "g" || ing.unidad === "ml") pesoAproxG += l.cantidad_usada;
  }

  return { total, pesoAproxG, sinNutricion };
}

export async function obtenerReceta(id: string): Promise<Receta | null> {
  const db = await bd();
  const base = await db.getFirstAsync<{
    id: string; nombre: string; rendimiento_cantidad: number; rendimiento_unidad: string;
    margen_deseado_pct: number; producto_id: string | null; notas: string | null;
    creado_en: string; actualizado_en: string;
  }>(
    `SELECT id, nombre, rendimiento_cantidad, rendimiento_unidad, margen_deseado_pct,
            producto_id, notas, creado_en, actualizado_en
       FROM recetas WHERE eliminado = 0 AND id = ?`,
    [id]
  );
  if (!base) return null;

  const lineas = await db.getAllAsync<RecetaLinea>(
    `SELECT id, ingrediente_id, nombre_congelado, unidad, cantidad_usada, costo_congelado_centavos
       FROM receta_lineas WHERE receta_id = ? ORDER BY orden`,
    [id]
  );

  const costoTotal = lineas.reduce((s, l) => s + l.costo_congelado_centavos, 0);
  const costoPorRendimiento =
    base.rendimiento_cantidad > 0 ? Math.round(costoTotal / base.rendimiento_cantidad) : costoTotal;
  const precioSugeridoCentavos = precioSugerido(costoPorRendimiento, base.margen_deseado_pct);
  const { total, pesoAproxG, sinNutricion } = await nutricionYPeso(db, lineas);

  return {
    ...base,
    lineas,
    costo_total_centavos: costoTotal,
    costo_por_rendimiento_centavos: costoPorRendimiento,
    precio_sugerido_centavos: precioSugeridoCentavos,
    nutricion_total: total,
    peso_aprox_g: pesoAproxG,
    ingredientes_sin_nutricion: sinNutricion,
  };
}

/** Crea o actualiza una receta Y reemplaza TODAS sus líneas (se borran las
 *  viejas y se insertan las nuevas) — mismo patrón que kits en inventario.ts.
 *  `producto_id` NUNCA se toca aquí: solo lo cambia
 *  crearProductoDesdeReceta(), para no desvincular sin querer un producto ya
 *  creado con solo editar la receta. */
export async function guardarReceta(d: NuevaReceta): Promise<string> {
  const nombre = d.nombre.trim();
  if (!nombre) throw new Error("Ponle un nombre a la receta.");
  if (d.lineas.length === 0) throw new Error("Agrega al menos un ingrediente a la receta.");
  if (d.rendimiento_cantidad <= 0) throw new Error("El rendimiento debe ser mayor a cero.");
  for (const l of d.lineas) {
    if (l.cantidad_usada <= 0) throw new Error("La cantidad de cada ingrediente debe ser mayor a cero.");
  }

  const db = await bd();
  const ts = ahoraISO();
  const esNuevo = !d.id || !d.id.trim();
  const id = esNuevo ? uuid() : d.id!;

  await db.withTransactionAsync(async () => {
    if (esNuevo) {
      await db.runAsync(
        `INSERT INTO recetas
           (id, nombre, rendimiento_cantidad, rendimiento_unidad, margen_deseado_pct,
            notas, eliminado, creado_en, actualizado_en)
         VALUES (?,?,?,?,?,?,0,?,?)`,
        [id, nombre, d.rendimiento_cantidad, d.rendimiento_unidad.trim(), d.margen_deseado_pct, limpio(d.notas), ts, ts]
      );
    } else {
      const res = await db.runAsync(
        `UPDATE recetas SET
           nombre=?, rendimiento_cantidad=?, rendimiento_unidad=?, margen_deseado_pct=?,
           notas=?, actualizado_en=?
         WHERE id=? AND eliminado=0`,
        [nombre, d.rendimiento_cantidad, d.rendimiento_unidad.trim(), d.margen_deseado_pct, limpio(d.notas), ts, id]
      );
      if (res.changes === 0) throw new Error("No se encontró la receta.");
    }

    // Reemplazar líneas: borrar todas las anteriores, insertar las nuevas.
    await db.runAsync("DELETE FROM receta_lineas WHERE receta_id = ?", [id]);

    for (let i = 0; i < d.lineas.length; i++) {
      const entrada = d.lineas[i];
      const ingrediente = await obtenerIngrediente(entrada.ingrediente_id);
      if (!ingrediente) throw new Error("Un ingrediente de la receta ya no existe en la despensa.");
      const costoCalculado = Math.round(ingrediente.costo_por_unidad_centavos * entrada.cantidad_usada);
      const costoFinal = Math.max(0, entrada.costo_manual_centavos ?? costoCalculado);
      await db.runAsync(
        `INSERT INTO receta_lineas
           (id, receta_id, ingrediente_id, nombre_congelado, unidad, cantidad_usada,
            costo_congelado_centavos, orden, creado_en, actualizado_en)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          uuid(), id, ingrediente.id, ingrediente.nombre, ingrediente.unidad,
          entrada.cantidad_usada, costoFinal, i, ts, ts,
        ]
      );
    }
  });

  return id;
}

export async function eliminarReceta(id: string): Promise<void> {
  const db = await bd();
  const res = await db.runAsync(
    "UPDATE recetas SET eliminado = 1, actualizado_en = ? WHERE id = ?",
    [ahoraISO(), id]
  );
  if (res.changes === 0) throw new Error("No se encontró la receta.");
}

/** Manda la receta al catálogo: crea un producto de venta normal (mismo
 *  camino que dar de alta un producto a mano en Inventario) con el costo
 *  por rendimiento ya calculado. Falla si la receta ya tiene un producto
 *  vinculado — evita duplicados sin querer; para eso ya existe editar el
 *  producto directo en Inventario.
 *
 *  También crea automáticamente un perfil de etiqueta NOM-051 vinculado,
 *  con la nutrición de la receta convertida a "por 100 g" — solo si hay
 *  suficiente peso pesable para que esa conversión tenga sentido.
 *  `anade_azucares`/`anade_grasas`/`anade_sodio` se dejan en 0 A PROPÓSITO:
 *  es una determinación legal de la norma que no se puede inferir solo de
 *  una lista de ingredientes — se deja anotado en las notas del perfil
 *  para que el dueño lo revise a mano. */
export async function crearProductoDesdeReceta(
  recetaId: string,
  precioVentaCentavos?: number | null,
  categoriaId?: string | null
): Promise<string> {
  const receta = await obtenerReceta(recetaId);
  if (!receta) throw new Error("No se encontró la receta.");
  if (receta.producto_id) {
    throw new Error("Esta receta ya tiene un producto de venta vinculado. Edítalo desde Inventario.");
  }
  const precio = Math.max(0, precioVentaCentavos ?? receta.precio_sugerido_centavos);

  const productoId = await crearProducto({
    codigo_barras: null,
    nombre: receta.nombre,
    categoria_id: categoriaId ?? null,
    precio_venta_centavos: precio,
    costo_centavos: receta.costo_por_rendimiento_centavos,
    precio_mayoreo_centavos: null,
    controla_stock: false,
    stock: 0,
    stock_minimo: 0,
    unidad: "pieza",
    es_kit: false,
    favorito: false,
    imagen_uri: null,
    componentes: [],
  });

  const db = await bd();
  await db.runAsync(
    "UPDATE recetas SET producto_id = ?, actualizado_en = ? WHERE id = ?",
    [productoId, ahoraISO(), recetaId]
  );

  // Perfil de etiqueta automático — best effort. Si algo falla aquí, el
  // producto YA se creó (eso es lo importante); no se debe perder por un
  // problema al generar la etiqueta.
  if (receta.peso_aprox_g > 0) {
    const factor = 100 / receta.peso_aprox_g;
    const n = receta.nutricion_total;
    const avisoFaltantes =
      receta.ingredientes_sin_nutricion.length === 0
        ? ""
        : ` Ingredientes sin datos nutricionales (probablemente subestiman el total): ${receta.ingredientes_sin_nutricion.join(", ")}.`;
    try {
      await guardarPerfil({
        producto_id: productoId,
        nombre: receta.nombre,
        tipo: "solido",
        calorias_kcal: n.calorias_kcal * factor,
        azucares_g: n.azucares_g * factor,
        grasas_saturadas_g: n.grasas_saturadas_g * factor,
        grasas_trans_g: n.grasas_trans_g * factor,
        sodio_mg: n.sodio_mg * factor,
        proteinas_g: n.proteinas_g * factor,
        carbohidratos_g: n.carbohidratos_g * factor,
        grasas_totales_g: n.grasas_totales_g * factor,
        fibra_g: n.fibra_g * factor,
        anade_azucares: 0,
        anade_grasas: 0,
        anade_sodio: 0,
        contiene_cafeina: 0,
        contiene_edulcorantes: 0,
        exencion: "ninguna",
        area_cm2: 0,
        pais_origen: "Hecho en México",
        notas:
          `Nutrición calculada automáticamente desde la receta "${receta.nombre}" (por 100 g, a partir de ` +
          `los ingredientes pesables). Revisa manualmente si el producto AÑADE azúcares, grasas o sodio ` +
          `antes de calcular los sellos — eso no se infiere solo.${avisoFaltantes}`,
      });
    } catch (e) {
      console.warn("[recetas] no se pudo crear el perfil de etiqueta automático:", e);
    }
  }

  return productoId;
}
