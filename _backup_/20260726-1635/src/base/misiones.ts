// YvexPOS Móvil — Misiones de arranque (lógica pura, sin JSX).
//
// Un checklist con espíritu de "misiones" que empuja a dejar la app lista:
//   1. Registra tu negocio        (nombre_negocio distinto del default)
//   2. Tus primeros 10 productos  (progreso N/10 desde productos)
//   3. Tus primeras 3 ventas      (progreso N/3 desde ventas)
//   4. Escanea tu primer ticket   (el escáner IA aprende con cada producto)
//
// La misión del escáner se detecta con un rastro REAL en la base: la tabla
// `historial_costos` solo recibe filas cuando un escaneo de ticket confirma
// costos (ver inventario.ts). Sin escaneo exitoso, la tabla está vacía.
//
// Al completarse las cuatro, Inicio muestra UNA sola vez una celebración
// sobria y guarda la bandera `misiones_festejo_visto` en config; después
// la sección desaparece para siempre.

import { bd } from "./db";
import { leerConfig, guardarConfig } from "./config";
import { leerGiro, obtenerGiro, leerNombreNegocio } from "./giro";

export type Mision = {
  id: "negocio" | "productos" | "ventas" | "escaner";
  titulo: string;
  detalle: string;
  hecho: boolean;
  progreso: number;
  meta: number;
};

const META_PRODUCTOS = 10;
const META_VENTAS = 3;

const CLAVE_FESTEJO = "misiones_festejo_visto";

export async function obtenerMisiones(): Promise<Mision[]> {
  const db = await bd();
  const [nombre, giroId, productos, ventas, escaneos] = await Promise.all([
    leerNombreNegocio(),
    leerGiro(),
    db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM productos"),
    db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM ventas WHERE estado <> 'cancelada'"
    ),
    db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM historial_costos"),
  ]);

  const giro = obtenerGiro(giroId);
  const nProd = productos?.n ?? 0;
  const nVentas = ventas?.n ?? 0;
  const negocioListo = nombre.trim() !== "" && nombre !== "Mi negocio";

  return [
    {
      id: "negocio",
      titulo: "Registra tu negocio",
      detalle: "Ponle nombre: así saldrá en cada ticket que compartas.",
      hecho: negocioListo,
      progreso: negocioListo ? 1 : 0,
      meta: 1,
    },
    {
      id: "productos",
      titulo: `Agrega tus primeros ${META_PRODUCTOS} productos`,
      detalle: "Con foto y precio, tu catálogo cobra vida.",
      hecho: nProd >= META_PRODUCTOS,
      progreso: Math.min(nProd, META_PRODUCTOS),
      meta: META_PRODUCTOS,
    },
    {
      id: "ventas",
      titulo: `Haz tus primeras ${META_VENTAS} ventas`,
      detalle: "Abre un turno y cobra: la caja ya está lista.",
      hecho: nVentas >= META_VENTAS,
      progreso: Math.min(nVentas, META_VENTAS),
      meta: META_VENTAS,
    },
    {
      id: "escaner",
      titulo: "Escanea tu primer ticket de compra",
      detalle:
        `Fotografía el ticket de tu proveedor: la IA lee los costos de ` +
        `${giro.nombre.toLowerCase()} y el resurtido cae solo.`,
      hecho: (escaneos?.n ?? 0) > 0,
      progreso: (escaneos?.n ?? 0) > 0 ? 1 : 0,
      meta: 1,
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
