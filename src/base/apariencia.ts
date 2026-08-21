// YvexPOS Móvil — Apariencia: temas, acentos y preferencias visuales.
//
// El usuario elige en Configuración: tema (paleta), acento, pack de iconos,
// densidad y estilo de bordes. Todo se guarda en la tabla `config` de la base
// local, así persiste entre sesiones. Igual que el POS de escritorio.
//
// ---------------------------------------------------------------------------
// CÓMO ESTÁ ORGANIZADO ESTE ARCHIVO (leer antes de tocar nada)
// ---------------------------------------------------------------------------
// 1. Tipografía  — familias y escala. UNA escala para toda la app.
// 2. Espaciado   — base 4. No se inventan números fuera de esta escala.
// 3. Radios      — dependen del estilo de bordes elegido.
// 4. TEMAS       — solo superficies y tinta. NINGÚN tema define color de marca.
// 5. ACENTOS     — color de marca. Cada uno trae variante clara y oscura.
// 6. ESTADOS     — éxito / peligro / alerta. Iguales en los 7 temas.
// 7. construirTema — arma el objeto que consume toda la interfaz.
//
// REGLA DE ORO: una pantalla NUNCA escribe un color, un tamaño de fuente ni un
// número de separación a mano. Todo sale del objeto que devuelve construirTema.
// Si algo no existe aquí, se añade aquí — no se improvisa en la pantalla.

import { bd } from "./db";
import { PackIconos } from "@/src/componentes/iconos";

// ===========================================================================
// 1. TIPOGRAFÍA
// ===========================================================================
//
// Dos familias, con roles que no se mezclan:
//   · Archivo      → toda la interfaz.
//   · IBM Plex Mono → EXCLUSIVO para cifras de dinero, con numeral tabular.
//     Ningún texto que no sea un monto usa Plex Mono. Ningún monto deja de
//     usarlo. Los montos son lo único que el usuario realmente lee.
//
// Mientras las fuentes no estén cargadas con expo-font, las familias quedan en
// `undefined` y React Native usa la del sistema: la app se ve como hoy pero NO
// se rompe. Para activarlas:
//   1) npx expo install expo-font @expo-google-fonts/archivo @expo-google-fonts/ibm-plex-mono
//   2) cargarlas con useFonts en app/_layout.tsx
//   3) poner FUENTES_CARGADAS = true aquí
// Es un paso aparte y a propósito: cambiar la fuente altera CADA pantalla y
// merece probarse solo.
export const FUENTES_CARGADAS = true;

const FAM_UI = FUENTES_CARGADAS ? "Archivo_500Medium" : undefined;
const FAM_UI_FUERTE = FUENTES_CARGADAS ? "Archivo_700Bold" : undefined;
const FAM_NUM = FUENTES_CARGADAS ? "IBMPlexMono_500Medium" : undefined;
const FAM_NUM_FUERTE = FUENTES_CARGADAS ? "IBMPlexMono_600SemiBold" : undefined;

// Escala tipográfica: CINCO tamaños. No hay un sexto.
// (El archivo anterior de la pantalla Inicio llegó a usar 14 tamaños distintos,
// con medios puntos incluidos. Esa es la razón de que nada tuviera ritmo.)
export const TIPO = {
  /** 11 · etiquetas de sección en mayúsculas, insignias. */
  micro: 11,
  /** 13 · metadatos, ayudas, texto secundario de una fila. */
  pie: 13,
  /** 15 · texto normal, títulos de fila, entradas de formulario. */
  cuerpo: 15,
  /** 20 · título de pantalla o de sección importante. */
  titulo: 20,
  /** 40 · la métrica protagonista. UNA por pantalla. */
  protagonista: 40,
} as const;

// DOS pesos. Nada más. Si todo es negrita, la negrita no significa nada.
export const PESO = {
  normal: "500",
  fuerte: "700",
} as const;

// ===========================================================================
// 2. ESPACIADO (base 4)
// ===========================================================================
export const ESP = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// ===========================================================================
// 3. TEMAS — superficies y tinta
// ===========================================================================
// Cinco temas, no siete. "Aurora" y "Duna" se quitaron por redundancia
// medida, no por gusto: Aurora quedaba a ΔE 3.78 de Nocturno (ambos violeta
// casi negro, distinguibles solo puestos uno junto al otro) y Duna a ΔE 1.58
// de Papel — por debajo del umbral en que el ojo humano distingue algo
// incluso comparando lado a lado. Un selector con dos pares que se ven
// iguales no es variedad, es ruido: cuesta decisión sin dar nada a cambio.
//
// Nota de paridad: el PC todavía tiene los 6 temas originales (incluye
// Aurora y Duna, no tiene Papel). Este recorte es solo de móvil por ahora;
// si el PC pasa por su propio rediseño, probablemente le convenga el mismo
// ajuste, pero esa decisión no se tomó aquí.
export type IdTema =
  | "papel"
  | "nocturno"
  | "grafito"
  | "alba"
  | "mediodia";

export type Paleta = {
  fondo: string;
  superficie: string;
  superficie2: string;
  superficie3: string;
  borde: string;
  bordeFuerte: string;
  texto: string;
  textoSuave: string;
  textoTenue: string;
};

export const TEMAS: {
  id: IdTema;
  nombre: string;
  desc: string;
  esClaro: boolean;
  paleta: Paleta;
}[] = [
  {
    // Tema de marca. Marfil del logo nuevo: la app se siente papel, no pantalla.
    // Ningún otro POS del mercado se ve así — todos son azul corporativo o
    // neón. Éste es el material real del negocio: libreta, ticket, tinta.
    id: "papel",
    nombre: "Papel",
    desc: "Marfil y tinta · la identidad YvexPOS",
    esClaro: true,
    paleta: {
      fondo: "#f4ede1",
      superficie: "#fbf7ef",
      superficie2: "#ede4d4",
      superficie3: "#e3d8c4",
      borde: "#e0d5c2",
      bordeFuerte: "#c9b99f",
      // Tinta con tinte cálido/vino, no negro neutro: 13.7:1 sobre el fondo.
      texto: "#2a1f22",
      textoSuave: "#6b5a57",
      textoTenue: "#8a7972",
    },
  },
  {
    id: "nocturno",
    nombre: "Nocturno",
    desc: "Violeta profundo · el clásico YvexPOS",
    esClaro: false,
    paleta: {
      fondo: "#0b0819", superficie: "#151024", superficie2: "#1d1733",
      superficie3: "#251d40", borde: "#251d40", bordeFuerte: "#352a5c",
      texto: "#f4f2ff", textoSuave: "#a9a4c0", textoTenue: "#6f6a8a",
    },
  },
  {
    id: "grafito",
    nombre: "Grafito",
    desc: "Negro puro · ahorra batería en OLED",
    esClaro: false,
    paleta: {
      fondo: "#000000", superficie: "#0d0d0f", superficie2: "#151517",
      superficie3: "#1d1d20", borde: "#1d1d20", bordeFuerte: "#2e2e33",
      texto: "#f5f5f7", textoSuave: "#9e9ea6", textoTenue: "#66666e",
    },
  },
  {
    id: "alba",
    nombre: "Alba",
    desc: "Claro y limpio · para verlo todo a plena luz",
    esClaro: true,
    paleta: {
      fondo: "#f4f5f7", superficie: "#ffffff", superficie2: "#eef0f4",
      superficie3: "#e3e6ec", borde: "#e0e3e9", bordeFuerte: "#c9ced8",
      texto: "#171a21", textoSuave: "#4d5566", textoTenue: "#8a92a3",
    },
  },
  {
    // Paridad con el POS de escritorio, que sí lo tiene. Para mostrador a
    // pleno sol: máximo contraste, bordes visibles.
    id: "mediodia",
    nombre: "Mediodía",
    desc: "Alto contraste · a plena luz del día",
    esClaro: true,
    paleta: {
      fondo: "#ffffff", superficie: "#ffffff", superficie2: "#f2f2f4",
      superficie3: "#e6e6ea", borde: "#d4d4da", bordeFuerte: "#8e8e96",
      texto: "#000000", textoSuave: "#3a3a42", textoTenue: "#5f5f68",
    },
  },
];

// ===========================================================================
// 4. ACENTOS — color de marca
// ===========================================================================
//
// QUÉ CAMBIÓ Y POR QUÉ (importante):
//
// El modelo anterior daba a cada acento un `secundario` de un tono
// COMPLETAMENTE distinto (Bugambilia rosa arrastraba un lila #a78bfa), que
// luego se exponía como `turquesa` y pintaba flechas, montos, "Guardar" y
// "Ver". Resultado: un segundo color de marca que el usuario nunca eligió,
// compitiendo contra el que sí eligió, y con un nombre que casi nunca
// correspondía al color. Ese campo ya no existe.
//
// Cada acento trae ahora cuatro valores, todos verificados por contraste:
//   claro          → para texto/iconos/bordes SOBRE temas claros  (≥ 4.5:1)
//   oscuro         → lo mismo SOBRE temas oscuros                 (≥ 4.5:1)
//   relleno        → fondo de botón en temas claros
//   rellenoOscuro  → fondo de botón en temas oscuros (≥ 3:1 vs fondo)
// más el color de la etiqueta que va ENCIMA del relleno (≥ 4.5:1).
//
// `color` se conserva: es el círculo que se ve en el selector de Ajustes.
export type IdAcento =
  | "borgona" | "violeta" | "turquesa" | "ambar" | "esmeralda" | "indigo"
  | "rosa" | "perla" | "carbon";

export type Acento = {
  id: IdAcento;
  nombre: string;
  /** Muestra del selector en Ajustes. */
  color: string;
  claro: string;
  oscuro: string;
  relleno: string;
  rellenoOscuro: string;
  sobre: string;
  sobreOscuro: string;
};

export const ACENTOS: Acento[] = [
  {
    // Borgoña quemado del logo. Por defecto y ancla de marca.
    // En temas oscuros NO puede usarse el borgoña original: sobre #0b0819 da
    // 1.79:1, prácticamente invisible. La variante sube luminosidad en HSL
    // conservando el tono 346° y la saturación, así sigue siendo el mismo
    // color de familia y no un rosa deslavado.
    id: "borgona", nombre: "Borgoña", color: "#6b2233",
    claro: "#6b2233", oscuro: "#ca5973",
    relleno: "#6b2233", rellenoOscuro: "#b63553",
    sobre: "#ffffff", sobreOscuro: "#ffffff",
  },
  {
    id: "violeta", nombre: "Amatista", color: "#8b5cf6",
    claro: "#7a51d8", oscuro: "#8b5cf6",
    relleno: "#7a51d8", rellenoOscuro: "#7c4ff0",
    sobre: "#ffffff", sobreOscuro: "#ffffff",
  },
  {
    id: "turquesa", nombre: "Laguna", color: "#2dd4bf",
    claro: "#1a796d", oscuro: "#2dd4bf",
    relleno: "#1a796d", rellenoOscuro: "#2dd4bf",
    sobre: "#ffffff", sobreOscuro: "#0e1a18",
  },
  {
    id: "ambar", nombre: "Miel", color: "#f59e0b",
    claro: "#956007", oscuro: "#f59e0b",
    relleno: "#956007", rellenoOscuro: "#f59e0b",
    sobre: "#ffffff", sobreOscuro: "#1c1408",
  },
  {
    id: "esmeralda", nombre: "Jade", color: "#10b981",
    claro: "#0b7a55", oscuro: "#10b981",
    relleno: "#0b7a55", rellenoOscuro: "#10b981",
    sobre: "#ffffff", sobreOscuro: "#06231a",
  },
  {
    id: "indigo", nombre: "Zafiro", color: "#6366f1",
    claro: "#595cd9", oscuro: "#6669f1",
    relleno: "#595cd9", rellenoOscuro: "#5457e8",
    sobre: "#ffffff", sobreOscuro: "#ffffff",
  },
  {
    // El rosa es tan luminoso que la etiqueta blanca encima no llega a 4.5:1.
    // Se resuelve al revés: relleno pleno con etiqueta oscura (4.76:1).
    id: "rosa", nombre: "Bugambilia", color: "#ec4899",
    claro: "#ba3979", oscuro: "#ec4899",
    relleno: "#ba3979", rellenoOscuro: "#ec4899",
    sobre: "#ffffff", sobreOscuro: "#1c1d24",
  },
  {
    // Neutros a propósito: quien los elige quiere una app sin color de marca.
    id: "perla", nombre: "Perla", color: "#dcdde3",
    claro: "#6a6a6d", oscuro: "#dcdde3",
    relleno: "#6a6a6d", rellenoOscuro: "#dcdde3",
    sobre: "#ffffff", sobreOscuro: "#1c1d24",
  },
  {
    id: "carbon", nombre: "Carbón", color: "#3a3d47",
    claro: "#3a3d47", oscuro: "#9a9ca3",
    // #777980 dejaba la etiqueta blanca en 4.35:1. Se oscurece el relleno:
    // 5.48:1 para la etiqueta y sigue leyéndose como forma (3.58:1).
    relleno: "#3a3d47", rellenoOscuro: "#676970",
    sobre: "#ffffff", sobreOscuro: "#ffffff",
  },
];

// ===========================================================================
// 5. ESTADOS — iguales en los 7 temas
// ===========================================================================
//
// Antes había cuatro sistemas de color de estado peleando entre sí: verde
// #34d399 de librería, ámbar #fbbf24, coral #fb7185 y el azul del Alert
// nativo de Android. Ninguno se sentía de la misma familia.
//
// Ahora el éxito es JADE — el verde del logo, no un verde de paquete. Así el
// "todo bien" de la app es un color de marca, no un genérico.
const JADE = {
  base: "#4e7c6e",
  claro: "#456e61", // texto sobre fondos claros  (≥ 4.9:1)
  oscuro: "#598d7d", // texto sobre fondos oscuros (≥ 5.1:1)
};
const CORAL = { base: "#c2415a", claro: "#a83049", oscuro: "#e8798d" };
const MIEL = { base: "#b07807", claro: "#8a5d05", oscuro: "#e3a52a" };

// ===========================================================================
// 6. PREFERENCIAS
// ===========================================================================
export type Densidad = "comoda" | "compacta";
export type EstiloBordes = "suaves" | "rectos";

export type Preferencias = {
  tema: IdTema;
  acento: IdAcento;
  pack: PackIconos;
  densidad: Densidad;
  bordes: EstiloBordes;
  /** Apaga efectos visuales costosos (hoy: el desenfoque del recorte de
   *  foto en FormularioProducto) para dispositivos de gama baja donde ese
   *  tipo de blur puede sentirse con lag. Apagado por defecto — mismo
   *  criterio que conteo_ciego_activo: nadie lo nota hasta que lo necesita,
   *  así que no se le impone a quien no lo necesita. */
  modoRendimiento: boolean;
};

export const PREFS_DEFECTO: Preferencias = {
  tema: "papel",
  acento: "borgona",
  pack: "trazo",
  densidad: "comoda",
  bordes: "suaves",
  modoRendimiento: false,
};

// ---------------------------------------------------------------------------
// Persistencia en la tabla `config`
// ---------------------------------------------------------------------------

export type ClavePref = "tema" | "acento" | "pack_iconos" | "densidad" | "bordes" | "modo_rendimiento";

export async function leerPreferencias(): Promise<Preferencias> {
  const db = await bd();
  const filas = await db.getAllAsync<{ clave: string; valor: string }>(
    "SELECT clave, valor FROM config WHERE clave IN ('tema', 'acento', 'pack_iconos', 'densidad', 'bordes', 'modo_rendimiento')"
  );
  const m = new Map(filas.map((f) => [f.clave, f.valor]));
  return {
    tema: (m.get("tema") as IdTema) ?? PREFS_DEFECTO.tema,
    acento: (m.get("acento") as IdAcento) ?? PREFS_DEFECTO.acento,
    pack: (m.get("pack_iconos") as PackIconos) ?? PREFS_DEFECTO.pack,
    densidad: (m.get("densidad") as Densidad) ?? PREFS_DEFECTO.densidad,
    bordes: (m.get("bordes") as EstiloBordes) ?? PREFS_DEFECTO.bordes,
    modoRendimiento: m.get("modo_rendimiento") === "1",
  };
}

export async function guardarPreferencia(
  clave: ClavePref,
  valor: string
): Promise<void> {
  const db = await bd();
  await db.runAsync(
    "INSERT INTO config (clave, valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor = ?",
    [clave, valor, valor]
  );
}

// ===========================================================================
// 7. construirTema — lo único que consume la interfaz
// ===========================================================================

/** Añade opacidad (0–255) a un hex de 6 dígitos. */
function alfa(hex: string, aa: string): string {
  return hex.length === 7 ? hex + aa : hex;
}

/** Construye la paleta completa (tema + acento + densidad + bordes). */
export function construirTema(prefs: Preferencias) {
  const t = TEMAS.find((x) => x.id === prefs.tema) ?? TEMAS[0];
  const a = ACENTOS.find((x) => x.id === prefs.acento) ?? ACENTOS[0];
  const claro = t.esClaro;
  const compacta = prefs.densidad === "compacta";
  const rectos = prefs.bordes === "rectos";

  // El acento se resuelve UNA vez, según la luminosidad del tema. Ninguna
  // pantalla debe volver a decidir esto.
  const acento = claro ? a.claro : a.oscuro;
  const acentoRelleno = claro ? a.relleno : a.rellenoOscuro;
  const acentoTexto = claro ? a.sobre : a.sobreOscuro;

  return {
    // --- Superficies y tinta ---
    ...t.paleta,
    esClaro: claro,

    // --- Acento ---
    acento,
    acentoRelleno,
    acentoTexto,
    acentoSuave: alfa(acento, claro ? "1f" : "24"),
    acentoBorde: alfa(acento, claro ? "4d" : "59"),

    /**
     * @deprecated Alias de compatibilidad. Antes era un SEGUNDO color de marca
     * (el lila fantasma). Ahora apunta al acento real, así el morado
     * desaparece de toda la app sin tocar ninguna pantalla. Conforme se
     * migren las pantallas, cambiar `T.turquesa` por `T.acento` y borrar esto.
     */
    turquesa: acento,
    /** @deprecated Ver `turquesa`. */
    turquesaSuave: alfa(acento, "20"),

    // --- Estados ---
    exito: JADE.base,
    exitoSuave: claro ? "rgba(78, 124, 110, 0.13)" : "rgba(89, 141, 125, 0.18)",
    exitoTexto: claro ? JADE.claro : JADE.oscuro,
    peligro: claro ? CORAL.claro : CORAL.oscuro,
    peligroSuave: claro ? "rgba(194, 65, 90, 0.12)" : "rgba(232, 121, 141, 0.16)",
    // Faltaba: T.peligro nunca se pensó como RELLENO sólido con texto
    // encima, solo como color de texto o tinte translúcido (peligroSuave).
    // Blanco fijo sobre peligro-oscuro da 2.78:1 — falla. Mismo patrón que
    // acentoTexto/acentoRelleno, aplicado aquí porque el hueco es real:
    // blanco en claro (6.60:1), tinta oscura en oscuro (6.04:1).
    peligroTextoFuerte: claro ? "#ffffff" : "#1c1d24",
    peligroTexto: claro ? CORAL.claro : CORAL.oscuro,
    alerta: claro ? MIEL.claro : MIEL.oscuro,
    alertaSuave: claro ? "rgba(176, 120, 7, 0.13)" : "rgba(227, 165, 42, 0.15)",
    alertaTexto: claro ? MIEL.claro : MIEL.oscuro,

    // --- Tipografía ---
    fuente: {
      ui: FAM_UI,
      uiFuerte: FAM_UI_FUERTE,
      /** SOLO para montos de dinero. */
      num: FAM_NUM,
      numFuerte: FAM_NUM_FUERTE,
    },
    tipo: TIPO,
    peso: PESO,

    // --- Espaciado ---
    esps: ESP,
    /** Separación estándar del cuerpo de una pantalla. */
    esp: compacta ? 16 : 20,
    /** Alto mínimo de una fila tocable (44 es el mínimo accesible). */
    filaAlto: compacta ? 48 : 56,

    // --- Radios ---
    radioChico: rectos ? 4 : 8,
    radio: rectos ? 6 : 12,
    radioGrande: rectos ? 8 : 16,
    radioPildora: rectos ? 8 : 999,

    // --- Preferencias crudas, por si una pantalla necesita ramificar ---
    densidad: prefs.densidad,
    bordes: prefs.bordes,
  };
}

export type TemaActivo = ReturnType<typeof construirTema>;
