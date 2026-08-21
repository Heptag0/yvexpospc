// YvexPOS Móvil — Catálogo de herramientas y accesos anclados.
//
// ---------------------------------------------------------------------------
// POR QUÉ ESTE ARCHIVO EXISTE
// ---------------------------------------------------------------------------
// Inicio responde UNA pregunta: ¿cómo va mi negocio ahora mismo? Vendido hoy,
// turno, quién vende, la nube. Todo lo demás —departamentos, proveedores,
// cotizaciones, tienda en línea— son herramientas que se usan de vez en
// cuando, no información de cabecera. Tenerlas listadas en Inicio convertía
// el tablero en un menú disfrazado.
//
// Ahora viven en un panel propio, y el usuario ancla las que usa de verdad.
//
// ---------------------------------------------------------------------------
// POR QUÉ ANCLADAS A MANO Y NO "LAS MÁS USADAS"
// ---------------------------------------------------------------------------
// Una lista automática por frecuencia SE MUEVE SOLA. En un aparato que se
// toca cientos de veces al día, la memoria muscular es el activo más valioso:
// si "Proveedores" hoy está en la posición 2 y mañana en la 4, el usuario
// deja de mirar y empieza a leer, que es exactamente lo contrario de una
// herramienta profesional.
//
// Las ancladas a mano no se mueven nunca. La frecuencia sí puede usarse, pero
// como SUGERENCIA dentro del panel ("usas mucho esto, ¿lo anclas?"), jamás
// como una lista que baila sola.

import { bd } from "./db";
import { IdUI } from "@/src/componentes/iconos";

export type IdHerramienta =
  | "departamentos"
  | "productos"
  | "etiquetas"
  | "recetas"
  | "proveedores"
  | "cotizaciones"
  | "dinero"
  | "credito"
  | "lealtad"
  | "tienda"
  | "pedidos";

export type Herramienta = {
  id: IdHerramienta;
  icono: IdUI;
  titulo: string;
  meta: string;
  /** Palabras extra para el buscador: cómo lo llamaría un tendero. */
  alias: string;
};

export type GrupoHerramientas = {
  titulo: string;
  /** Una línea que explica de qué va el grupo. */
  desc: string;
  items: Herramienta[];
};

// Agrupadas por PARA QUÉ SIRVEN, no por orden de llegada: un tendero no busca
// "Cotizaciones", busca "algo para pasarle un precio a un cliente".
export const GRUPOS_HERRAMIENTAS: GrupoHerramientas[] = [
  {
    titulo: "Tu catálogo",
    desc: "Lo que vendes y cómo está organizado",
    items: [
      {
        id: "departamentos",
        icono: "etiqueta",
        titulo: "Departamentos",
        meta: "Crea categorías con su icono y color",
        alias: "categorias secciones familias",
      },
      {
        id: "productos",
        icono: "inventario",
        titulo: "Productos",
        meta: "Agrega productos con foto y precio",
        alias: "articulos inventario catalogo precios",
      },
      {
        id: "etiquetas",
        icono: "etiqueta_nom",
        titulo: "Etiquetado NOM",
        meta: "¿Tu producto necesita sellos de advertencia?",
        alias: "nom 051 sellos advertencia nutrimental",
      },
      {
        id: "recetas",
        icono: "cubiertos",
        titulo: "Recetas",
        meta: "Cuánto te cuesta de verdad cada producto que fabricas",
        alias: "costeo despensa ingredientes margen precio fabricar",
      },
    ],
  },
  {
    titulo: "Tu operación",
    desc: "El día a día del negocio",
    items: [
      {
        id: "proveedores",
        icono: "camion",
        titulo: "Proveedores",
        meta: "Compras, días de visita y su historial",
        alias: "compras surtido repartidor visitas",
      },
      {
        id: "cotizaciones",
        icono: "cotizacion",
        titulo: "Cotizaciones",
        meta: "Arma un precio sin cobrar y compártelo",
        alias: "presupuesto precio cliente enviar",
      },
      {
        id: "dinero",
        icono: "dinero",
        titulo: "Dinero",
        meta: "Tus gastos del negocio y de casa",
        alias: "gastos agenda finanzas personal caja",
      },
    ],
  },
  {
    titulo: "Tus clientes",
    desc: "Quién te compra y cómo vuelve",
    items: [
      {
        id: "lealtad",
        icono: "regalo",
        titulo: "Clientes y lealtad",
        meta: "Puntos por compra y visita, canjeables al cobrar",
        alias: "puntos premios clientes frecuentes tarjeta",
      },
      {
        // "persona" es el ícono más cercano en tu catálogo real — no hay
        // uno dedicado a deuda/cobranza. Si tienes uno mejor, dímelo.
        id: "credito",
        icono: "persona",
        titulo: "Crédito",
        meta: "Quién te debe, cuánto, y abona rápido",
        alias: "fiado deuda cobranza abono limite",
      },
      {
        id: "tienda",
        icono: "tienda",
        titulo: "Tienda en línea",
        meta: "Tu escaparate en internet con pedidos por WhatsApp",
        alias: "internet web escaparate whatsapp catalogo online",
      },
      {
        id: "pedidos",
        icono: "pedido",
        titulo: "Pedidos web",
        meta: "Los que te piden desde tu tienda en internet",
        alias: "ordenes internet online whatsapp",
      },
    ],
  },
];

/** Todas las herramientas en una sola lista (para buscar y resolver ids). */
export const TODAS_HERRAMIENTAS: Herramienta[] = GRUPOS_HERRAMIENTAS.flatMap(
  (g) => g.items
);

export function herramientaPorId(id: IdHerramienta): Herramienta | undefined {
  return TODAS_HERRAMIENTAS.find((h) => h.id === id);
}

// ---------------------------------------------------------------------------
// Buscador
// ---------------------------------------------------------------------------

/** Quita acentos y baja a minúsculas: "Cotización" encuentra "cotizacion". */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function buscarHerramientas(texto: string): Herramienta[] {
  const q = normalizar(texto.trim());
  if (!q) return [];
  return TODAS_HERRAMIENTAS.filter((h) => {
    const heno = normalizar(`${h.titulo} ${h.meta} ${h.alias}`);
    // Todas las palabras deben aparecer: "precio cliente" encuentra
    // Cotizaciones sin traer media lista.
    return q.split(/\s+/).every((p) => heno.includes(p));
  });
}

// ---------------------------------------------------------------------------
// Anclados — persistidos en la tabla `config`, igual que tema y acento
// ---------------------------------------------------------------------------

/** Cuatro caben en una fila sin apretarse y sin obligar a leer. */
export const MAX_ANCLADAS = 4;

const CLAVE_ANCLADAS = "herramientas_ancladas";
const CLAVE_ACCESOS_OCULTOS = "accesos_ocultos";

const IDS_VALIDOS = new Set<string>(TODAS_HERRAMIENTAS.map((h) => h.id));

export async function leerAncladas(): Promise<IdHerramienta[]> {
  try {
    const db = await bd();
    const fila = await db.getFirstAsync<{ valor: string }>(
      "SELECT valor FROM config WHERE clave = ?",
      [CLAVE_ANCLADAS]
    );
    if (!fila?.valor) return [];
    // Se filtra contra el catálogo real: si una herramienta desaparece en una
    // versión futura, su id guardado no rompe nada, simplemente se ignora.
    return fila.valor
      .split(",")
      .map((s) => s.trim())
      .filter((s) => IDS_VALIDOS.has(s))
      .slice(0, MAX_ANCLADAS) as IdHerramienta[];
  } catch {
    return [];
  }
}

async function guardarClave(clave: string, valor: string): Promise<void> {
  const db = await bd();
  await db.runAsync(
    "INSERT INTO config (clave, valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor = ?",
    [clave, valor, valor]
  );
}

export async function guardarAncladas(ids: IdHerramienta[]): Promise<void> {
  await guardarClave(CLAVE_ANCLADAS, ids.slice(0, MAX_ANCLADAS).join(","));
}

/**
 * Ancla o desancla, y devuelve la lista resultante.
 *
 * Al llegar al tope NO se tira la más antigua en silencio: se devuelve la
 * lista sin cambios y `lleno: true`, para que la interfaz lo pueda decir. Que
 * una acción del usuario deshaga otra sin avisar es de las cosas que más
 * rompen la confianza en una herramienta de trabajo.
 */
export async function alternarAnclada(
  id: IdHerramienta
): Promise<{ ancladas: IdHerramienta[]; lleno: boolean }> {
  const actuales = await leerAncladas();
  if (actuales.includes(id)) {
    const nuevas = actuales.filter((x) => x !== id);
    await guardarAncladas(nuevas);
    return { ancladas: nuevas, lleno: false };
  }
  if (actuales.length >= MAX_ANCLADAS) {
    return { ancladas: actuales, lleno: true };
  }
  const nuevas = [...actuales, id];
  await guardarAncladas(nuevas);
  return { ancladas: nuevas, lleno: false };
}

// ---------------------------------------------------------------------------
// Visibilidad de la fila de accesos en Inicio
// ---------------------------------------------------------------------------

export async function leerAccesosOcultos(): Promise<boolean> {
  try {
    const db = await bd();
    const fila = await db.getFirstAsync<{ valor: string }>(
      "SELECT valor FROM config WHERE clave = ?",
      [CLAVE_ACCESOS_OCULTOS]
    );
    return fila?.valor === "1";
  } catch {
    return false;
  }
}

export async function guardarAccesosOcultos(oculto: boolean): Promise<void> {
  await guardarClave(CLAVE_ACCESOS_OCULTOS, oculto ? "1" : "0");
}
