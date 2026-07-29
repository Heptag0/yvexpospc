// YvexPOS Móvil — Sistema de iconos vectoriales (SVG).
//
// Iconos monocromáticos dibujados a mano con paths SVG: toman el color que se
// les pasa, escalan sin pixelarse y se ven coherentes entre sí. Nada de
// emojis (cada uno con su estilo y color, imposible de armonizar).
//
// PACKS: el usuario elige en Configuración cómo quiere ver sus productos:
//   - "trazo": iconos de línea (elegante, ligero) — por defecto
//   - "solido": iconos rellenos (más presencia, se leen a distancia)
//   - "inicial": sin icono, la letra inicial (minimalista, como Notion)

import Svg, { Path, Circle, Rect, Line } from "react-native-svg";
import { View, Text } from "react-native";

export type PackIconos = "trazo" | "solido" | "inicial";

export type IdIcono =
  | "botana" | "refresco" | "cerveza" | "cigarro" | "encendedor"
  | "dulce" | "farmacia" | "cafe" | "pan" | "lacteo"
  | "limpieza" | "carne" | "fruta" | "hielo" | "papeleria" | "caja";

export const ICONOS: { id: IdIcono; nombre: string }[] = [
  { id: "botana",     nombre: "Botanas" },
  { id: "refresco",   nombre: "Refrescos" },
  { id: "cerveza",    nombre: "Cerveza" },
  { id: "cigarro",    nombre: "Cigarros" },
  { id: "encendedor", nombre: "Encendedor" },
  { id: "dulce",      nombre: "Dulces" },
  { id: "farmacia",   nombre: "Farmacia" },
  { id: "cafe",       nombre: "Café" },
  { id: "pan",        nombre: "Panadería" },
  { id: "lacteo",     nombre: "Lácteos" },
  { id: "limpieza",   nombre: "Limpieza" },
  { id: "carne",      nombre: "Carnes" },
  { id: "fruta",      nombre: "Frutas" },
  { id: "hielo",      nombre: "Hielo" },
  { id: "papeleria",  nombre: "Papelería" },
  { id: "caja",       nombre: "General" },
];

// Paths SVG en un lienzo 24x24 (estándar de la industria).
const PATHS: Record<IdIcono, string[]> = {
  // Bolsa de botana
  botana: ["M6 3h12l2 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8l2-5z", "M4 8h16"],
  // Botella de refresco
  refresco: ["M10 2h4v3l2 3v11a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V8l2-3V2z", "M8 12h8"],
  // Lata / tarro de cerveza
  cerveza: ["M6 6h9v14H6z", "M15 9h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2", "M6 6l1-3h7l1 3"],
  // Cigarro
  cigarro: ["M2 15h16v4H2z", "M18 15h4v4h-4z", "M17 11c1-1 1-2 0-3", "M20 11c1-1 1-2 0-3"],
  // Llama / encendedor
  encendedor: ["M12 2c0 4-4 5-4 9a4 4 0 0 0 8 0c0-2-1-3-2-4", "M9 22h6"],
  // Dulce / caramelo
  dulce: ["M9 9h6v6H9z", "M9 12L5 9v6l4-3z", "M15 12l4-3v6l-4-3z"],
  // Cápsula de farmacia
  farmacia: ["M8 4h8a4 4 0 0 1 0 8h-8a4 4 0 0 1 0-8z", "M12 4v8", "M6 16h12v4H6z"],
  // Taza de café
  cafe: ["M4 8h13v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8z", "M17 10h2a2 2 0 0 1 0 4h-2", "M8 3v2", "M12 3v2"],
  // Barra de pan
  pan: ["M4 12a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6z", "M9 12v6", "M15 12v6"],
  // Cartón de leche
  lacteo: ["M8 8h8v12H8z", "M8 8l2-5h4l2 5", "M10 13h4"],
  // Botella con spray
  limpieza: ["M9 9h6v11H9z", "M10 9V6h4v3", "M14 6h3l2-2", "M11 13h2"],
  // Corte de carne
  carne: ["M5 9a6 6 0 0 1 12 0c2 0 2 3 0 3a6 6 0 0 1-12 0", "M9 10a2 2 0 0 0 4 0"],
  // Manzana
  fruta: ["M12 7c-4-3-8 0-8 5s4 9 8 6c4 3 8-1 8-6s-4-8-8-5z", "M12 7V4", "M12 4c2 0 3-1 3-2"],
  // Cubo de hielo
  hielo: ["M5 8l7-4 7 4v8l-7 4-7-4V8z", "M12 4v16", "M5 8l14 8", "M19 8L5 16"],
  // Lápiz
  papeleria: ["M17 3l4 4L8 20H4v-4L17 3z", "M14 6l4 4"],
  // Caja genérica
  caja: ["M3 8l9-5 9 5v9l-9 5-9-5V8z", "M3 8l9 5 9-5", "M12 13v9"],
};

/** Icono vectorial. `relleno` alterna entre trazo y sólido. */
export function Icono({
  id,
  size = 24,
  color = "#8b5cf6",
  relleno = false,
}: {
  id: string | null | undefined;
  size?: number;
  color?: string;
  relleno?: boolean;
}) {
  const paths = PATHS[(id as IdIcono) ?? "caja"] ?? PATHS.caja;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {paths.map((d, i) => (
        <Path
          key={i}
          d={d}
          stroke={color}
          strokeWidth={relleno ? 1 : 1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={relleno && i === 0 ? color : "none"}
          fillOpacity={relleno && i === 0 ? 0.9 : 0}
        />
      ))}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Iconos de interfaz (navegación, acciones). Mismo lenguaje visual.
// ---------------------------------------------------------------------------
export type IdUI =
  | "inicio" | "vender" | "inventario" | "reportes" | "ajustes"
  | "buscar" | "atras" | "mas" | "menos" | "cerrar" | "etiqueta"
  | "lista" | "grid2" | "grid3" | "grid4" | "camara" | "imagen"
  | "escaner" | "linterna" | "camion" | "proveedor"
  // Giros de negocio (onboarding y ajustes)
  | "tienda" | "ropa" | "taza" | "cubiertos" | "capsula"
  | "llave" | "chip" | "brillo" | "pata" | "puntos";

const UI: Record<IdUI, string[]> = {
  inicio: ["M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10z", "M9 22V12h6v10"],
  vender: ["M2 3h3l3 12h11", "M8 15l-1 3h13", "M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z", "M18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"],
  inventario: ["M3 8l9-5 9 5v9l-9 5-9-5V8z", "M3 8l9 5 9-5", "M12 13v9"],
  reportes: ["M3 21h18", "M6 21V11", "M11 21V4", "M16 21v-7", "M21 21V8"],
  ajustes: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 2h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L6 10a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6c.1-.3.1-.7.1-1z"],
  buscar: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.3-4.3"],
  atras: ["M19 12H5", "M12 19l-7-7 7-7"],
  mas: ["M12 5v14", "M5 12h14"],
  menos: ["M5 12h14"],
  cerrar: ["M18 6L6 18", "M6 6l12 12"],
  etiqueta: ["M20 12l-8 8-9-9V3h8l9 9z", "M7 7h.01"],
  lista: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  grid2: ["M3 3h8v8H3z", "M13 3h8v8h-8z", "M3 13h8v8H3z", "M13 13h8v8h-8z"],
  grid3: ["M3 3h5v5H3z", "M9.5 3h5v5h-5z", "M16 3h5v5h-5z", "M3 9.5h5v5H3z", "M9.5 9.5h5v5h-5z", "M16 9.5h5v5h-5z", "M3 16h5v5H3z", "M9.5 16h5v5h-5z", "M16 16h5v5h-5z"],
  grid4: ["M3 3h3.5v3.5H3z", "M8 3h3.5v3.5H8z", "M13 3h3.5v3.5H13z", "M18 3h3v3.5h-3z", "M3 8h3.5v3.5H3z", "M8 8h3.5v3.5H8z", "M13 8h3.5v3.5H13z", "M18 8h3v3.5h-3z", "M3 13h3.5v3.5H3z", "M8 13h3.5v3.5H8z", "M13 13h3.5v3.5H13z", "M18 13h3v3.5h-3z"],
  camara: ["M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2v11z", "M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  imagen: ["M3 3h18v18H3z", "M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z", "M21 15l-5-5L5 21"],
  // Escáner de códigos: esquinas de visor + barras verticales
  escaner: ["M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2", "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2", "M7 9v6", "M10.5 9v6", "M13.5 9v6", "M17 9v6"],
  // Linterna
  linterna: ["M7 2h10l-1 5H8L7 2z", "M8 7h8l-1.5 3v12h-7V10L8 7z", "M12 13v4"],
  // Camión de reparto (avisos de visita de proveedores)
  camion: ["M1 7h12v10H1z", "M13 10h5l3 3v4h-8", "M5.5 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z", "M16.5 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"],
  // Proveedor (persona con caja: el que te surte)
  proveedor: ["M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M5 21v-1a7 7 0 0 1 14 0v1", "M17 11h5v5h-5z"],
  // --- Giros de negocio ---
  // Fachada de tienda
  tienda: ["M4 9l1.5-5h13L20 9", "M4 9h16", "M5 9v11h14V9", "M9 20v-6h6v6"],
  // Playera
  ropa: ["M9 4l-6 3 2 4 2-1v10h10V10l2 1 2-4-6-3a3 3 0 0 1-6 0z"],
  // Taza de café con vapor
  taza: ["M4 8h13v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8z", "M17 10h2a2 2 0 0 1 0 4h-2", "M8 3v2", "M12 3v2"],
  // Tenedor y cuchillo
  cubiertos: ["M7 3v7", "M4 3v4a3 3 0 0 0 6 0V3", "M7 14v7", "M17 3c-2 0-3 2.5-3 5v3h3v10", "M17 3v8"],
  // Cápsula
  capsula: ["M8 4h8a4 4 0 0 1 0 8h-8a4 4 0 0 1 0-8z", "M12 4v8", "M6 16h12v4H6z"],
  // Llave de apriete (ferretería)
  llave: ["M14.5 6.5a4 4 0 0 0-5.6 5L3 17.5 6.5 21l6-5.9a4 4 0 0 0 5-5.6L14 13l-2.5-.5L11 10l3.5-3.5z"],
  // Chip / circuito
  chip: ["M6 6h12v12H6z", "M10 10h4v4h-4z", "M9 3v3", "M15 3v3", "M9 18v3", "M15 18v3", "M3 9h3", "M3 15h3", "M18 9h3", "M18 15h3"],
  // Destello (belleza)
  brillo: ["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z", "M19 16l.8 2.2 2.2.8-2.2.8L19 20l-.8-2.2L16 18l2.2-.8L19 16z"],
  // Huella de mascota
  pata: ["M12 13c-3 0-6 2.2-6 4.6a2 2 0 0 0 4 .6c.6-.4 1.3-.6 2-.6s1.4.2 2 .6a2 2 0 0 0 4-.6c0-2.4-3-4.6-6-4.6z", "M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z", "M16.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z", "M4.5 14a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z", "M19.5 14a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"],
  // Tres puntos (otro giro)
  puntos: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
};

/** Icono de interfaz. */
export function IconoUI({
  id,
  size = 22,
  color = "#a9a4c0",
  grosor = 1.8,
}: {
  id: IdUI;
  size?: number;
  color?: string;
  grosor?: number;
}) {
  const paths = UI[id] ?? UI.imagen;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {paths.map((d, i) => (
        <Path
          key={i}
          d={d}
          stroke={color}
          strokeWidth={grosor}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
    </Svg>
  );
}
