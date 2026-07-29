// YvexPOS Móvil — Misiones de arranque (lógica pura, sin JSX).
//
// Un checklist con espíritu de "misiones" que empuja a dejar la app lista:
//   1. Registra tu negocio        (nombre_negocio distinto del default)
//   2. Tus primeros 10 productos  (progreso N/10 desde productos)
//   3. Tus primeras 3 ventas      (progreso N/3 desde ventas)
//   4. Misión POR GIRO            (ver giro.mision4 en giro.ts)
//
// La misión 4 cambia según el giro y TODAS se cumplen 100% en local, sin
// cuenta ni nube (el escáner de tickets con IA exige cuenta vinculada y no
// aplica a todos los giros, así que ya no es misión universal):
//   codigos → 5 productos con código de barras   (abarrotes, farmacia,
//                                                  ferretería, otro)
//   fotos   → 5 productos con foto               (ropa, belleza, mascotas,
//                                                  electrónica)
//   kit     → 1 kit o paquete creado             (cafetería, restaurante)
//
// Detección con rastro REAL en la base:
//   - códigos: productos.codigo_barras no vacío
//   - fotos:   productos.imagen_uri no vacía (ver imagenes.ts / inventario.ts)
//   - kit:     productos.es_kit = 1 (ver inventario.ts / venta.ts)
//
// Al completarse las cuatro, Inicio muestra UNA sola vez una celebración
// y guarda la bandera `misiones_festejo_visto` en config; después la
// sección desaparece para siempre.

import { bd } from "./db";
import { leerConfig, guardarConfig } from "./config";
import { leerGiro, obtenerGiro, leerNombreNegocio, TipoMision4 } from "./giro";
import type { IdUI } from "@/src/componentes/iconos";

export type Mision = {
  id: "negocio" | "productos" | "ventas" | "giro";
  titulo: string;
  detalle: string;
  icono: IdUI;
  hecho: boolean;
  progreso: number;
  meta: number;
};

const META_PRODUCTOS = 10;
const META_VENTAS = 3;
const META_CODIGOS = 5;
const META_FOTOS = 5;

const CLAVE_FESTEJO = "misiones_festejo_visto";

/** Cuenta el progreso real de la misión 4 según el tipo que toca al giro. */
async function progresoMision4(tipo: TipoMision4): Promise<number> {
  const db = await bd();
  if (tipo === "fotos") {
    const r = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM productos
       WHERE eliminado = 0 AND imagen_uri IS NOT NULL AND TRIM(imagen_uri) <> ''`
    );
    return r?.n ?? 0;
  }
  if (tipo === "kit") {
    const r = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM productos WHERE eliminado = 0 AND es_kit = 1"
    );
    return r?.n ?? 0;
  }
  const r = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM productos
     WHERE eliminado = 0 AND codigo_barras IS NOT NULL AND TRIM(codigo_barras) <> ''`
  );
  return r?.n ?? 0;
}

/** Textos e ícono de la misión 4 según el giro. */
function fichaMision4(tipo: TipoMision4): { titulo: string; detalle: string; icono: IdUI; meta: number } {
  if (tipo === "fotos") {
    return {
      titulo: `Ponle foto a ${META_FOTOS} productos`,
      detalle:
        "En tu giro se vende con los ojos: una foto bonita hace que cada " +
        "producto se antoje desde la pantalla de cobro.",
      icono: "camara",
      meta: META_FOTOS,
    };
  }
  if (tipo === "kit") {
    return {
      titulo: "Crea tu primer kit o paquete",
      detalle:
        "Arma un combo de los que se te ocurren todos los días — café con " +
        "pan, desayuno completo — y véndelo con un solo toque.",
      icono: "inventario",
      meta: 1,
    };
  }
  return {
    titulo: `Escanea ${META_CODIGOS} códigos de barras`,
    detalle:
      "Apunta la cámara al código de tus productos: cobrarás rapidísimo y " +
      "sin equivocarte al teclear.",
    icono: "camara",
    meta: META_CODIGOS,
  };
}

export async function obtenerMisiones(): Promise<Mision[]> {
  const db = await bd();
  const [nombre, giroId, productos, ventas] = await Promise.all([
    leerNombreNegocio(),
    leerGiro(),
    db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM productos WHERE eliminado = 0"
    ),
    db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM ventas WHERE estado <> 'cancelada'"
    ),
  ]);

  const giro = obtenerGiro(giroId);
  const nProd = productos?.n ?? 0;
  const nVentas = ventas?.n ?? 0;
  const negocioListo = nombre.trim() !== "" && nombre !== "Mi negocio";

  const ficha = fichaMision4(giro.mision4);
  const n4 = await progresoMision4(giro.mision4);

  return [
    {
      id: "negocio",
      titulo: "Registra tu negocio",
      detalle:
        "Ponle nombre con cariño: así saldrá en la pantalla de inicio y en " +
        "cada ticket que compartas.",
      icono: "tienda",
      hecho: negocioListo,
      progreso: negocioListo ? 1 : 0,
      meta: 1,
    },
    {
      id: "productos",
      titulo: `Agrega tus primeros ${META_PRODUCTOS} productos`,
      detalle:
        "Con nombre, precio y su departamento, tu catálogo empieza a cobrar " +
        "vida y cobrar se vuelve un gustito.",
      icono: "inventario",
      hecho: nProd >= META_PRODUCTOS,
      progreso: Math.min(nProd, META_PRODUCTOS),
      meta: META_PRODUCTOS,
    },
    {
      id: "ventas",
      titulo: `Haz tus primeras ${META_VENTAS} ventas`,
      detalle:
        "Abre un turno y cobra: la caja ya está lista y cada venta te va " +
        "contando cómo va tu día.",
      icono: "vender",
      hecho: nVentas >= META_VENTAS,
      progreso: Math.min(nVentas, META_VENTAS),
      meta: META_VENTAS,
    },
    {
      id: "giro",
      titulo: ficha.titulo,
      detalle: ficha.detalle,
      icono: ficha.icono,
      hecho: n4 >= ficha.meta,
      progreso: Math.min(n4, ficha.meta),
      meta: ficha.meta,
    },
  ];
}

/** true cuando las cuatro misiones están completas. */
export async function misionesCompletas(): Promise<boolean> {
  const m = await obtenerMisiones();
  return m.every((x) => x.hecho);
}

/** ¿La celebración por misiones completas ya se mostró alguna vez? */
export async function festejoVisto(): Promise<boolean> {
  return (await leerConfig(CLAVE_FESTEJO)) === "1";
}

/** Marca la celebración como vista (se muestra una sola vez en la vida). */
export async function marcarFestejoVisto(): Promise<void> {
  await guardarConfig(CLAVE_FESTEJO, "1");
}
