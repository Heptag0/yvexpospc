// YvexPOS Móvil — Perfiles de etiqueta NOM-051 (guardado local).
//
// Solo guarda lo que el usuario capturó. El cálculo de qué sellos aplican
// vive en src/base/sellos.ts — un solo lugar, porque son reglas de gobierno
// que ya cambiaron de fecha dos veces.
//
// LOCAL-ONLY (v1).
//
// producto_id — AÑADIDO para Recetas: cuando una receta se manda al
// catálogo (recetas.ts::crearProductoDesdeReceta), genera un perfil de
// etiqueta automático VINCULADO a ese producto (mismo comportamiento que
// ya tenía el PC — recetas.rs, crear_producto_desde_receta). Nullable: los
// perfiles capturados a mano, sin pasar por una receta, no tienen producto
// vinculado y siguen funcionando igual que antes.

import { bd, uuid, ahoraISO } from "./db";

export type PerfilEtiqueta = {
  id: string;
  nombre: string;
  tipo: "solido" | "liquido";
  calorias_kcal: number;
  azucares_g: number;
  grasas_saturadas_g: number;
  grasas_trans_g: number;
  sodio_mg: number;
  proteinas_g: number;
  carbohidratos_g: number;
  grasas_totales_g: number;
  fibra_g: number;
  anade_azucares: number;      // 0/1 en SQLite
  anade_grasas: number;
  anade_sodio: number;
  contiene_cafeina: number;
  contiene_edulcorantes: number;
  exencion: string;
  area_cm2: number;
  /** Tipo de receta: define qué tan seguro es sugerir bajar un ingrediente
   *  sin arriesgar la conservación del producto (ver sustituciones.ts). */
  categoria_receta: string;
  /** Producto de venta vinculado, si este perfil nació de una receta
   *  mandada al catálogo. NULL para perfiles capturados a mano. */
  producto_id: string | null;
  denominacion: string | null;
  marca: string | null;
  ingredientes: string | null;
  alergenos: string | null;
  contenido_neto: string | null;
  porcion: string | null;
  porciones_envase: string | null;
  responsable_nombre: string | null;
  responsable_domicilio: string | null;
  lote: string | null;
  caducidad: string | null;
  conservacion: string | null;
  pais_origen: string | null;
  notas: string | null;
  actualizado_en: string;
};

export const PERFIL_VACIO: Omit<PerfilEtiqueta, "id" | "actualizado_en"> = {
  nombre: "", tipo: "solido",
  calorias_kcal: 0, azucares_g: 0, grasas_saturadas_g: 0, grasas_trans_g: 0, sodio_mg: 0,
  proteinas_g: 0, carbohidratos_g: 0, grasas_totales_g: 0, fibra_g: 0,
  anade_azucares: 0, anade_grasas: 0, anade_sodio: 0,
  contiene_cafeina: 0, contiene_edulcorantes: 0,
  exencion: "ninguna", area_cm2: 0,
  categoria_receta: "otro",
  producto_id: null,
  denominacion: null, marca: null, ingredientes: null, alergenos: null,
  contenido_neto: null, porcion: null, porciones_envase: null,
  responsable_nombre: null, responsable_domicilio: null, lote: null,
  caducidad: null, conservacion: null, pais_origen: "Hecho en México", notas: null,
};

const COLS = `id, nombre, tipo, calorias_kcal, azucares_g, grasas_saturadas_g,
  grasas_trans_g, sodio_mg, proteinas_g, carbohidratos_g, grasas_totales_g, fibra_g,
  anade_azucares, anade_grasas, anade_sodio, contiene_cafeina, contiene_edulcorantes,
  exencion, area_cm2, categoria_receta, producto_id, denominacion, marca, ingredientes,
  alergenos, contenido_neto, porcion, porciones_envase, responsable_nombre,
  responsable_domicilio, lote, caducidad, conservacion, pais_origen, notas, actualizado_en`;

export async function listarPerfiles(): Promise<PerfilEtiqueta[]> {
  const db = await bd();
  return db.getAllAsync<PerfilEtiqueta>(
    `SELECT ${COLS} FROM perfiles_etiqueta WHERE eliminado = 0 ORDER BY actualizado_en DESC`
  );
}

export async function obtenerPerfil(id: string): Promise<PerfilEtiqueta | null> {
  const db = await bd();
  const r = await db.getFirstAsync<PerfilEtiqueta>(
    `SELECT ${COLS} FROM perfiles_etiqueta WHERE eliminado = 0 AND id = ?`,
    [id]
  );
  return r ?? null;
}

/** Crea o actualiza. Si `p.id` viene vacío, crea. */
export async function guardarPerfil(p: Partial<PerfilEtiqueta>): Promise<string> {
  const nombre = (p.nombre ?? "").trim();
  if (!nombre) throw new Error("Ponle un nombre a esta receta o producto.");
  const db = await bd();
  const ts = ahoraISO();
  const esNuevo = !p.id || !p.id.trim();
  const id = esNuevo ? uuid() : p.id!;
  const lim = (s?: string | null) => (s && s.trim() ? s.trim() : null);
  const n = (v?: number) => Math.max(0, Number(v) || 0);

  const vals = [
    nombre, p.tipo === "liquido" ? "liquido" : "solido",
    n(p.calorias_kcal), n(p.azucares_g), n(p.grasas_saturadas_g), n(p.grasas_trans_g),
    n(p.sodio_mg), n(p.proteinas_g), n(p.carbohidratos_g), n(p.grasas_totales_g), n(p.fibra_g),
    p.anade_azucares ? 1 : 0, p.anade_grasas ? 1 : 0, p.anade_sodio ? 1 : 0,
    p.contiene_cafeina ? 1 : 0, p.contiene_edulcorantes ? 1 : 0,
    (p.exencion ?? "ninguna").trim() || "ninguna", n(p.area_cm2),
    (p.categoria_receta ?? "otro").trim() || "otro",
    p.producto_id ?? null,
    lim(p.denominacion), lim(p.marca), lim(p.ingredientes), lim(p.alergenos),
    lim(p.contenido_neto), lim(p.porcion), lim(p.porciones_envase),
    lim(p.responsable_nombre), lim(p.responsable_domicilio), lim(p.lote),
    lim(p.caducidad), lim(p.conservacion), lim(p.pais_origen), lim(p.notas),
    ts,
  ];

  if (esNuevo) {
    await db.runAsync(
      `INSERT INTO perfiles_etiqueta
        (id, nombre, tipo, calorias_kcal, azucares_g, grasas_saturadas_g, grasas_trans_g,
         sodio_mg, proteinas_g, carbohidratos_g, grasas_totales_g, fibra_g,
         anade_azucares, anade_grasas, anade_sodio, contiene_cafeina, contiene_edulcorantes,
         exencion, area_cm2, categoria_receta, producto_id, denominacion, marca, ingredientes,
         alergenos, contenido_neto, porcion, porciones_envase, responsable_nombre,
         responsable_domicilio, lote, caducidad, conservacion, pais_origen, notas,
         eliminado, creado_en, actualizado_en)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
      [id, ...vals, ts]
    );
  } else {
    await db.runAsync(
      `UPDATE perfiles_etiqueta SET
         nombre=?, tipo=?, calorias_kcal=?, azucares_g=?, grasas_saturadas_g=?,
         grasas_trans_g=?, sodio_mg=?, proteinas_g=?, carbohidratos_g=?, grasas_totales_g=?,
         fibra_g=?, anade_azucares=?, anade_grasas=?, anade_sodio=?, contiene_cafeina=?,
         contiene_edulcorantes=?, exencion=?, area_cm2=?, categoria_receta=?, producto_id=?,
         denominacion=?, marca=?, ingredientes=?, alergenos=?, contenido_neto=?, porcion=?,
         porciones_envase=?, responsable_nombre=?, responsable_domicilio=?, lote=?,
         caducidad=?, conservacion=?, pais_origen=?, notas=?, actualizado_en=?
       WHERE id = ? AND eliminado = 0`,
      [...vals, id]
    );
  }
  return id;
}

export async function eliminarPerfil(id: string): Promise<void> {
  const db = await bd();
  await db.runAsync(
    "UPDATE perfiles_etiqueta SET eliminado = 1, actualizado_en = ? WHERE id = ?",
    [ahoraISO(), id]
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Texto para compartir (WhatsApp, correo…)
// ───────────────────────────────────────────────────────────────────────────

import { calcularSellos, reglasImpresion, FECHA_VERIFICACION } from "./sellos";

export function textoEtiqueta(p: PerfilEtiqueta): string {
  const d = {
    tipo: p.tipo,
    caloriasKcal: p.calorias_kcal, azucaresG: p.azucares_g,
    grasasSaturadasG: p.grasas_saturadas_g, grasasTransG: p.grasas_trans_g,
    sodioMg: p.sodio_mg,
    anadeAzucares: !!p.anade_azucares, anadeGrasas: !!p.anade_grasas,
    anadeSodio: !!p.anade_sodio,
    contieneCafeina: !!p.contiene_cafeina, contieneEdulcorantes: !!p.contiene_edulcorantes,
    exencion: p.exencion || "ninguna", areaCm2: p.area_cm2,
  };
  const r = calcularSellos(d);
  const reglas = reglasImpresion(p.area_cm2, r.sellos.length);
  const u = p.tipo === "liquido" ? "ml" : "g";
  const L: string[] = [];

  L.push(`ETIQUETA — ${(p.denominacion || p.nombre).toUpperCase()}`);
  if (p.marca) L.push(p.marca);
  L.push("");
  L.push("SELLOS DE ADVERTENCIA");
  if (r.sellos.length === 0) {
    L.push(r.explicacion ? `• ${r.explicacion}` : "• Ninguno con estos valores.");
  } else {
    r.sellos.forEach((s) => L.push(`• ${s.etiqueta} (${s.razon})`));
  }
  r.leyendas.forEach((l) => L.push(`• ${l.etiqueta}`));

  if (reglas.conocida && r.sellos.length > 0) {
    L.push("");
    L.push("CÓMO VAN EN EL ENVASE");
    L.push(`• Tamaño: ${reglas.ancho ? `${reglas.ancho} × ${reglas.alto} cm` : reglas.nota}`);
    L.push(`• Ubicación: ${reglas.ubicacion}`);
    if (reglas.usaNumero) L.push(`• Va UN solo sello con el número ${r.sellos.length} (envase de 40 cm² o menos)`);
  }

  L.push("");
  L.push(`INFORMACIÓN NUTRIMENTAL (por 100 ${u})`);
  L.push(`• Energía: ${p.calorias_kcal.toFixed(0)} kcal`);
  L.push(`• Proteínas: ${p.proteinas_g.toFixed(1)} g`);
  L.push(`• Grasas totales: ${p.grasas_totales_g.toFixed(1)} g`);
  L.push(`   Saturadas: ${p.grasas_saturadas_g.toFixed(1)} g`);
  L.push(`   Trans: ${p.grasas_trans_g.toFixed(1)} g`);
  L.push(`• Hidratos de carbono: ${p.carbohidratos_g.toFixed(1)} g`);
  L.push(`   Azúcares: ${p.azucares_g.toFixed(1)} g`);
  L.push(`• Fibra: ${p.fibra_g.toFixed(1)} g`);
  L.push(`• Sodio: ${p.sodio_mg.toFixed(0)} mg`);

  const extras: [string, string | null][] = [
    ["Ingredientes", p.ingredientes], ["Alérgenos", p.alergenos],
    ["Contenido neto", p.contenido_neto], ["Lote", p.lote],
    ["Caducidad", p.caducidad], ["Conservación", p.conservacion],
    ["Origen", p.pais_origen], ["Responsable", p.responsable_nombre],
    ["Domicilio", p.responsable_domicilio],
  ];
  const conDatos = extras.filter(([, v]) => v);
  if (conDatos.length) {
    L.push("");
    L.push("DATOS DE LA ETIQUETA");
    conDatos.forEach(([k, v]) => L.push(`• ${k}: ${v}`));
  }

  L.push("");
  L.push(`Generado con YvexPOS · NOM-051 Fase ${r.fase} · verificado el ${FECHA_VERIFICACION}`);
  L.push("Guía de apoyo, no un certificado oficial.");
  return L.join("\n");
}
