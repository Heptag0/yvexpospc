// YvexPOS Móvil — Apariencia: temas y preferencias visuales.
//
// El usuario elige en Configuración: tema (paleta), pack de iconos y densidad.
// Todo se guarda en la tabla `config` de la base local, así persiste entre
// sesiones. Igual que el POS de escritorio.

import { bd } from "./db";
import { PackIconos } from "@/src/componentes/iconos";

// --- Temas disponibles ---
export type IdTema = "nocturno" | "grafito" | "aurora" | "alba" | "duna";

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

export const TEMAS: { id: IdTema; nombre: string; desc: string; esClaro: boolean; paleta: Paleta }[] = [
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
    id: "aurora",
    nombre: "Aurora",
    desc: "Índigo profundo · el más premium",
    esClaro: false,
    paleta: {
      fondo: "#090b16", superficie: "#111527", superficie2: "#181d33",
      superficie3: "#202642", borde: "#202642", bordeFuerte: "#303a63",
      texto: "#f3f5ff", textoSuave: "#a3abd0", textoTenue: "#6a7194",
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
    id: "duna",
    nombre: "Duna",
    desc: "Crema cálido · suave a la vista",
    esClaro: true,
    paleta: {
      fondo: "#f5f0e6", superficie: "#fdfaf3", superficie2: "#efe7d7",
      superficie3: "#e6dcc7", borde: "#e2d8c3", bordeFuerte: "#cbbd9f",
      texto: "#2a241a", textoSuave: "#5c5342", textoTenue: "#968a72",
    },
  },
];

// --- Acentos disponibles ---
export type IdAcento =
  | "violeta" | "turquesa" | "ambar" | "esmeralda" | "indigo" | "rosa"
  | "perla" | "carbon";

// `sobre` = color del texto/icono que va ENCIMA del acento (botones, pills,
// badges). "#ffffff" en casi todos; Perla necesita texto oscuro.
export const ACENTOS: { id: IdAcento; nombre: string; color: string; secundario: string; sobre: string }[] = [
  { id: "violeta",   nombre: "Amatista",   color: "#8b5cf6", secundario: "#2dd4bf", sobre: "#ffffff" },
  { id: "turquesa",  nombre: "Laguna",     color: "#2dd4bf", secundario: "#8b5cf6", sobre: "#ffffff" },
  { id: "ambar",     nombre: "Miel",       color: "#f59e0b", secundario: "#34d399", sobre: "#ffffff" },
  { id: "esmeralda", nombre: "Jade",       color: "#10b981", secundario: "#60a5fa", sobre: "#ffffff" },
  { id: "indigo",    nombre: "Zafiro",     color: "#6366f1", secundario: "#22d3ee", sobre: "#ffffff" },
  { id: "rosa",      nombre: "Bugambilia", color: "#ec4899", secundario: "#a78bfa", sobre: "#ffffff" },
  { id: "perla",     nombre: "Perla",      color: "#dcdde3", secundario: "#8b5cf6", sobre: "#1c1d24" },
  { id: "carbon",    nombre: "Carbón",     color: "#3a3d47", secundario: "#2dd4bf", sobre: "#ffffff" },
];

export type Preferencias = {
  tema: IdTema;
  acento: IdAcento;
  pack: PackIconos;
};

export const PREFS_DEFECTO: Preferencias = {
  tema: "nocturno",
  acento: "violeta",
  pack: "trazo",
};

// ---------------------------------------------------------------------------
// Persistencia en la tabla `config`
// ---------------------------------------------------------------------------

export async function leerPreferencias(): Promise<Preferencias> {
  const db = await bd();
  const filas = await db.getAllAsync<{ clave: string; valor: string }>(
    "SELECT clave, valor FROM config WHERE clave IN ('tema', 'acento', 'pack_iconos')"
  );
  const m = new Map(filas.map((f) => [f.clave, f.valor]));
  return {
    tema: (m.get("tema") as IdTema) ?? PREFS_DEFECTO.tema,
    acento: (m.get("acento") as IdAcento) ?? PREFS_DEFECTO.acento,
    pack: (m.get("pack_iconos") as PackIconos) ?? PREFS_DEFECTO.pack,
  };
}

export async function guardarPreferencia(
  clave: "tema" | "acento" | "pack_iconos",
  valor: string
): Promise<void> {
  const db = await bd();
  await db.runAsync(
    "INSERT INTO config (clave, valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor = ?",
    [clave, valor, valor]
  );
}

/** Construye la paleta completa (tema + acento) lista para usar. */
export function construirTema(prefs: Preferencias) {
  const t = TEMAS.find((x) => x.id === prefs.tema) ?? TEMAS[0];
  const a = ACENTOS.find((x) => x.id === prefs.acento) ?? ACENTOS[0];
  return {
    ...t.paleta,
    esClaro: t.esClaro,
    acento: a.color,
    acentoTexto: a.sobre,
    turquesa: a.secundario,
    acentoSuave: a.color + "24",
    turquesaSuave: a.secundario + "20",
    exito: "#34d399",
    exitoSuave: "rgba(52, 211, 153, 0.14)",
    // Textos sobre fondos "suaves": en temas claros las versiones pálidas
    // (#ffd3da, #c9f7e4, #ffe9bd) serían ilegibles; se oscurecen.
    exitoTexto: t.esClaro ? "#047857" : "#c9f7e4",
    peligro: "#fb7185",
    peligroSuave: "rgba(251, 113, 133, 0.16)",
    peligroTexto: t.esClaro ? "#be123c" : "#ffd3da",
    alerta: "#fbbf24",
    alertaSuave: "rgba(251, 191, 36, 0.14)",
    alertaTexto: t.esClaro ? "#92400e" : "#ffe9bd",
    radio: 14,
    radioChico: 10,
    radioGrande: 20,
    esp: 20,
  };
}
