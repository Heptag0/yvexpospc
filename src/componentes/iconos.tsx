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

import Svg, { Path } from "react-native-svg";

export type PackIconos = "trazo" | "solido" | "inicial";

// CATALOGO POR GIRO, NO POR ORDEN DE LLEGADA
// ---------------------------------------------------------------------------
// Nacio pensando solo en abarrotes: los 16 primeros ids son botana, refresco,
// cerveza, cigarro... Un local de ropa o una estetica abrian "Nuevo
// departamento" y no habia un solo icono suyo, asi que acababan poniendo
// "General" a todo.
//
// Ahora cada icono declara su categoria. El selector la usa SOLO para
// ORDENAR la cuadricula, nunca para limitar: quien vende abarrotes y ademas
// tiene cocina elige los de comida sin cambiar nada de su negocio, y el
// filtro arranca siempre en "Todos". Agrupar es ayudar a encontrar; filtrar
// por el giro guardado seria decidir por el usuario.
//
// REGLA DE DIBUJO, para que no se vean "de plantilla": silueta reconocible,
// tres trazos como mucho, y ningun detalle interior que no sirva para
// distinguir el objeto de otro. A 24 px el detalle no se lee: se convierte en
// ruido. Los originales (cerveza, caja, hielo) ya seguian esta regla; los que
// se anadieron despues no, y se notaba.
export type IdIcono =
  // Abarrotes y tienda
  | "botana" | "refresco" | "cerveza" | "cigarro" | "encendedor"
  | "dulce" | "farmacia" | "cafe" | "pan" | "lacteo"
  | "limpieza" | "carne" | "fruta" | "hielo" | "papeleria" | "caja"
  // Ropa y calzado
  | "camisa" | "pantalon" | "vestido" | "zapato" | "bolso" | "gorra"
  // Belleza
  | "labial" | "perfume" | "tijeras" | "esmalte" | "peine"
  // Ferreteria y hogar
  | "herramienta" | "tornillo" | "pintura" | "foco" | "cinta"
  // Mascotas
  | "hueso" | "collar" | "croqueta"
  // Electronica
  | "telefono" | "audifonos" | "pila" | "cable"
  // Comida preparada
  | "taco" | "pizza" | "helado" | "hamburguesa" | "bebida"
  // Papeleria y varios
  | "libro" | "mochila" | "juguete" | "flor" | "deporte";

export type IdCategoriaIconos =
  | "abarrotes" | "ropa" | "belleza" | "ferreteria"
  | "mascotas" | "electronica" | "comida" | "varios";

export const CATEGORIAS_ICONOS: { id: IdCategoriaIconos; nombre: string }[] = [
  { id: "abarrotes",   nombre: "Abarrotes" },
  { id: "comida",      nombre: "Comida" },
  { id: "ropa",        nombre: "Ropa" },
  { id: "belleza",     nombre: "Belleza" },
  { id: "ferreteria",  nombre: "Ferretería" },
  { id: "electronica", nombre: "Electrónica" },
  { id: "mascotas",    nombre: "Mascotas" },
  { id: "varios",      nombre: "Varios" },
];

export const ICONOS: { id: IdIcono; nombre: string; categoria: IdCategoriaIconos }[] = [
  // --- Abarrotes ---
  { id: "botana",      nombre: "Botanas",        categoria: "abarrotes" },
  { id: "refresco",    nombre: "Refrescos",      categoria: "abarrotes" },
  { id: "cerveza",     nombre: "Cerveza",        categoria: "abarrotes" },
  { id: "cigarro",     nombre: "Cigarros",       categoria: "abarrotes" },
  { id: "encendedor",  nombre: "Encendedor",     categoria: "abarrotes" },
  { id: "dulce",       nombre: "Dulces",         categoria: "abarrotes" },
  { id: "farmacia",    nombre: "Farmacia",       categoria: "abarrotes" },
  { id: "cafe",        nombre: "Café",           categoria: "abarrotes" },
  { id: "pan",         nombre: "Panadería",      categoria: "abarrotes" },
  { id: "lacteo",      nombre: "Lácteos",        categoria: "abarrotes" },
  { id: "limpieza",    nombre: "Limpieza",       categoria: "abarrotes" },
  { id: "carne",       nombre: "Carnes",         categoria: "abarrotes" },
  { id: "fruta",       nombre: "Frutas",         categoria: "abarrotes" },
  { id: "hielo",       nombre: "Hielo",          categoria: "abarrotes" },
  // --- Comida preparada ---
  { id: "taco",        nombre: "Antojitos",      categoria: "comida" },
  { id: "pizza",       nombre: "Pizzas",         categoria: "comida" },
  { id: "hamburguesa", nombre: "Hamburguesas",   categoria: "comida" },
  { id: "helado",      nombre: "Helados",        categoria: "comida" },
  { id: "bebida",      nombre: "Bebidas",        categoria: "comida" },
  // --- Ropa y calzado ---
  { id: "camisa",      nombre: "Camisas",        categoria: "ropa" },
  { id: "pantalon",    nombre: "Pantalones",     categoria: "ropa" },
  { id: "vestido",     nombre: "Vestidos",       categoria: "ropa" },
  { id: "zapato",      nombre: "Calzado",        categoria: "ropa" },
  { id: "bolso",       nombre: "Bolsos",         categoria: "ropa" },
  { id: "gorra",       nombre: "Gorras",         categoria: "ropa" },
  // --- Belleza ---
  { id: "labial",      nombre: "Maquillaje",     categoria: "belleza" },
  { id: "perfume",     nombre: "Perfumería",     categoria: "belleza" },
  { id: "tijeras",     nombre: "Peluquería",     categoria: "belleza" },
  { id: "esmalte",     nombre: "Uñas",           categoria: "belleza" },
  { id: "peine",       nombre: "Peines",         categoria: "belleza" },
  // --- Ferretería y hogar ---
  { id: "herramienta", nombre: "Herramienta",    categoria: "ferreteria" },
  { id: "tornillo",    nombre: "Tornillería",    categoria: "ferreteria" },
  { id: "pintura",     nombre: "Pintura",        categoria: "ferreteria" },
  { id: "foco",        nombre: "Electricidad",   categoria: "ferreteria" },
  { id: "cinta",       nombre: "Cintas",         categoria: "ferreteria" },
  // --- Electrónica ---
  { id: "telefono",    nombre: "Celulares",      categoria: "electronica" },
  { id: "audifonos",   nombre: "Audio",          categoria: "electronica" },
  { id: "pila",        nombre: "Pilas",          categoria: "electronica" },
  { id: "cable",       nombre: "Cables",         categoria: "electronica" },
  // --- Mascotas ---
  { id: "hueso",       nombre: "Mascotas",       categoria: "mascotas" },
  { id: "croqueta",    nombre: "Alimento",       categoria: "mascotas" },
  { id: "collar",      nombre: "Accesorios",     categoria: "mascotas" },
  // --- Varios ---
  { id: "papeleria",   nombre: "Papelería",      categoria: "varios" },
  { id: "libro",       nombre: "Libros",         categoria: "varios" },
  { id: "mochila",     nombre: "Mochilas",       categoria: "varios" },
  { id: "juguete",     nombre: "Juguetes",       categoria: "varios" },
  { id: "flor",        nombre: "Florería",       categoria: "varios" },
  { id: "deporte",     nombre: "Deportes",       categoria: "varios" },
  { id: "caja",        nombre: "General",        categoria: "varios" },
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
  farmacia: ["M14.5 3.5a5 5 0 0 1 7 7l-8 8a5 5 0 0 1-7-7l8-8z", "M10 7l7 7"],
  // Taza de café
  cafe: ["M4 8h13v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8z", "M17 10h2a2 2 0 0 1 0 4h-2", "M8 3v2", "M12 3v2"],
  // Barra de pan
  pan: ["M3 13a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z", "M8 9.5l-1.5 3", "M13 9.5l-1.5 3", "M18 9.5l-1.5 3"],
  // Cartón de leche
  lacteo: ["M8 8h8v12H8z", "M8 8l2-5h4l2 5", "M10 13h4"],
  // Botella con spray
  limpieza: ["M9 9h6v11H9z", "M10 9V6h4v3", "M14 6h3l2-2", "M11 13h2"],
  // Corte de carne
  carne: ["M8 4c6 0 11 3.5 11 8s-5 8-11 8c-3.5 0-5.5-2-5.5-4 0-1.4 1-2.4 2.4-2.6C3.6 12.8 3 11.6 3 10c0-3.4 2.2-6 5-6z", "M6 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
  // Manzana
  fruta: ["M12 7c-4-3-8 0-8 5s4 9 8 6c4 3 8-1 8-6s-4-8-8-5z", "M12 7V4", "M12 4c2 0 3-1 3-2"],
  // Cubo de hielo
  hielo: ["M5 8l7-4 7 4v8l-7 4-7-4V8z", "M12 4v16", "M5 8l14 8", "M19 8L5 16"],
  // Lápiz
  papeleria: ["M17 3l4 4L8 20H4v-4L17 3z", "M14 6l4 4"],
  // Caja genérica
  caja: ["M3 8l9-5 9 5v9l-9 5-9-5V8z", "M3 8l9 5 9-5", "M12 13v9"],

  // Vestido: talle ajustado que se abre en falda
  vestido: ["M9 3h6l-1 4 4 14H6l4-14-1-4z", "M9 7h6"],
  // Peine de púas
  peine: ["M3 7h18v4H3z", "M6 11v6", "M10 11v6", "M14 11v6", "M18 11v6"],
  // Rollo de cinta
  cinta: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  // Plato hondo de croquetas
  croqueta: ["M3 13h18a9 9 0 0 1-18 0z", "M7 13c0-2.2 2.2-3.5 5-3.5s5 1.3 5 3.5"],
  // Cable con conector
  cable: ["M9 3v4", "M15 3v4", "M6 7h12v4a6 6 0 0 1-6 6 6 6 0 0 1-6-6V7z", "M12 17v4"],
  // Hamburguesa: pan, relleno, pan
  hamburguesa: ["M3 9a9 5 0 0 1 18 0H3z", "M3 12h18", "M4 15h16a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"],
  // Vaso con popote
  bebida: ["M6 7h12l-1.4 13H7.4L6 7z", "M10 7l4-4", "M7 11h10"],
  // Mochila con asa y bolsillo
  mochila: ["M5 9a5 5 0 0 1 14 0v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V9z", "M10 6V5a2 2 0 0 1 4 0v1", "M9 14h6v7H9z"],

  // --- Ropa y calzado -----------------------------------------------------
  // Camisa con cuello abierto y botonadura
  camisa: ["M9 3l3 2.5L15 3l5 2.5-1.5 4L17 9v11H7V9l-1.5.5L4 5.5 9 3z", "M12 5.5V12"],
  // Pantalón: cintura y dos perneras
  pantalon: ["M7 3h10l1 18h-4l-1-9h-2l-1 9H6L7 3z", "M7 7h10"],
  // Zapato de vestir, perfil
  zapato: ["M3 17V9h4l3 3h6a5 5 0 0 1 5 5v1H3z", "M3 14h5"],
  // Bolso con asa
  bolso: ["M4 8h16l-1.2 12H5.2L4 8z", "M9 8V6a3 3 0 0 1 6 0v2"],
  // Gorra de béisbol con visera
  gorra: ["M4 15a8 8 0 0 1 16 0", "M4 15h17a2 2 0 0 1-2 2H4z"],

  // --- Belleza ------------------------------------------------------------
  // Labial abierto
  labial: ["M9 10h6v11H9z", "M9.5 10V5.5a2.5 2.5 0 0 1 5 0V10", "M9 14h6"],
  // Frasco de perfume con atomizador
  perfume: ["M7 10h10v11H7z", "M10 10V7h4v3", "M17 6h3", "M18.5 4.5v3", "M10 14h4"],
  // Tijeras de peluquería
  tijeras: ["M6.5 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z", "M6.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z", "M8.5 6.5L20 19", "M8.5 17.5L20 5"],
  // Esmalte de uñas con pincel
  esmalte: ["M8 11h8v10H8z", "M10 11V8h4v3", "M12 8V3", "M8 15h8"],

  // --- Ferretería y hogar -------------------------------------------------
  // Martillo
  herramienta: ["M4 20l8-8", "M11 9l4-4 2 2", "M14 3l7 7-3 3-7-7 3-3z"],
  // Tornillo con rosca
  tornillo: ["M9 3h6v4H9z", "M10 7h4v14l-2 2-2-2V7z", "M10 11h4", "M10 14h4", "M10 17h4"],
  // Bote de pintura con brocha
  pintura: ["M5 8h11v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8z", "M5 8a5.5 2.5 0 0 1 11 0", "M16 11h3V5h-3"],
  // Foco / bombilla
  foco: ["M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3z", "M9.5 20h5", "M10 22h4"],

  // --- Mascotas -----------------------------------------------------------
  // Hueso
  hueso: ["M7.5 8.2a2.6 2.6 0 1 1 3.4 3.4h2.2a2.6 2.6 0 1 1 3.4-3.4 2.6 2.6 0 1 1-3.4 3.4v1.2a2.6 2.6 0 1 1 3.4 3.4 2.6 2.6 0 1 1-3.4 3.4h-2.2a2.6 2.6 0 1 1-3.4-3.4 2.6 2.6 0 1 1 3.4-3.4v-1.2a2.6 2.6 0 1 1-3.4-3.4z", "M10.5 12h3"],
  // Collar con placa
  collar: ["M12 4a7 6 0 1 1-.1 0z", "M12 16v2", "M12 21a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z"],

  // --- Electrónica --------------------------------------------------------
  // Teléfono celular
  telefono: ["M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z", "M10 5h4", "M12 19h.01"],
  // Audífonos de diadema
  audifonos: ["M4 14v-2a8 8 0 0 1 16 0v2", "M4 14h3v6H5a1 1 0 0 1-1-1v-5z", "M20 14h-3v6h2a1 1 0 0 0 1-1v-5z"],
  // Pila / batería
  pila: ["M3 8h15v8H3z", "M18 11h3v2h-3", "M7 3h6v5H7z", "M7 11h4"],

  // --- Comida preparada ---------------------------------------------------
  // Taco doblado
  taco: ["M3 17a9 9 0 0 1 18 0H3z", "M6 17c0-3 2-5 3-6", "M15 11c1 1 3 3 3 6"],
  // Rebanada de pizza
  pizza: ["M12 3L3 19a34 34 0 0 0 18 0L12 3z", "M9 12h.01", "M14 12h.01", "M12 16h.01"],
  // Cono de helado
  helado: ["M8 10h8l-4 11-4-11z", "M12 3a4 4 0 0 0-4 4v3h8V7a4 4 0 0 0-4-4z"],

  // --- Varios -------------------------------------------------------------
  // Osito / juguete
  juguete: ["M5 8h14", "M5 8l7 9 7-9", "M12 8V4", "M12 17v3"],
  // Libro abierto
  libro: ["M3 5h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H3V5z", "M21 5h-7a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h7V5z"],
  // Flor en maceta
  flor: ["M12 11.5c-3 0-5-1.8-5-3.8S9 4 12 4s5 1.7 5 3.7-2 3.8-5 3.8z", "M12 11.5V21", "M12 16.5c-2.6 0-3.8-1.6-3.8-3.5 1.9 0 3.8.9 3.8 3.5z"],
  // Balón / deporte
  deporte: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7.8l3.2 2.3-1.2 3.8h-4L8.8 10 12 7.8z"],
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
  | "llave" | "chip" | "brillo" | "pata" | "puntos"
  // Programa de lealtad
  | "regalo" | "persona" | "qr"
  // Tienda en línea v2 (promoción y enlace)
  | "compartir" | "copiar" | "enlace" | "basura"
  // Tienda en línea v3 (pedidos web y vista previa)
  | "pedido" | "ojo"
    // Cotizaciones
  | "cotizacion"
  // Dinero (agenda financiera)
  | "dinero"
  // Etiquetado NOM-051
  | "etiqueta_nom"
  // Devoluciones y cancelaciones
  | "devolucion";

const UI: Record<IdUI, string[]> = {
  inicio: ["M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10z", "M9 22V12h6v10"],
  // Carrito de la compra.
  //
  // El anterior dibujaba la canasta con DOS trazos abiertos que nunca se
  // cerraban ("M2 3h3l3 12h11" + "M8 15l-1 3h13"): sin lado derecho ni base
  // cerrada, la silueta resultante era la de un diablito de carga, no la de
  // un carrito. Ahora la canasta es un trapecio cerrado (más ancho arriba,
  // como una canasta real) y el asa entronca con su esquina superior
  // izquierda en vez de cruzarla.
  vender: [
    "M2 3.5h2.6l1.2 4.5",
    "M5.8 8h15.9l-2 8.5H7.8z",
    "M9.5 20.6a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z",
    "M18 20.6a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z",
  ],
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
  // --- Programa de lealtad ---
  // Regalo (lealtad: premios y puntos)
  regalo: ["M20 12v10H4V12", "M2 7h20v5H2z", "M12 22V7", "M12 7c-1.5 0-3.5-1.5-3.5-3a1.75 1.75 0 0 1 3.5 0c0 1.5 2 3 2 3z", "M12 7c1.5 0 3.5-1.5 3.5-3a1.75 1.75 0 0 0-3.5 0c0 1.5-2 3-2 3z"],
  // Persona (ligar cliente al ticket)
  persona: ["M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 21v-1a8 8 0 0 1 16 0v1"],
  // QR (esquinas + módulos: el código del cliente)
  qr: ["M3 3h7v7H3z", "M14 3h7v7h-7z", "M3 14h7v7H3z", "M14 14h3v3h-3z", "M21 14v3", "M14 21h3", "M20 20h1v1h-1z"],
  // --- Tienda en línea v2 ---
  // Compartir (bandeja con flecha hacia afuera)
  compartir: ["M12 15V3", "M8 7l4-4 4 4", "M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"],
  // Copiar (dos hojas traslapadas)
  copiar: ["M9 9h11v12H9z", "M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"],
  // Enlace (cadena de dos eslabones)
  enlace: ["M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7", "M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"],
  // Basura (quitar imagen de portada)
  basura: ["M3 6h18", "M8 6V4h8v2", "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6", "M10 11v6", "M14 11v6"],
  // --- Tienda en línea v3 ---
  // Pedido web (nota de pedido con líneas)
  pedido: ["M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2", "M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2H9V5z", "M9 13h6", "M9 17h4"],
  // Ojo (vista previa de la tienda)
  ojo: ["M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  // --- Cotizaciones ---
  // Documento con esquina doblada + renglones (cotización/presupuesto)
    cotizacion: ["M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z", "M14 3v4h4", "M9 9h3", "M9 12.5h6", "M9 16h6"],
  // Billete con signo de pesos (agenda financiera)
  dinero: ["M12 2.5v19", "M16.5 6.8c-.8-1.1-2.4-1.8-4.5-1.8-2.8 0-4.5 1.2-4.5 3s1.7 2.6 4.5 3.2 4.8 1.4 4.8 3.4-2 3.4-4.8 3.4c-2.3 0-4-.8-4.8-2"],
  // Octágono con signo de advertencia (etiquetado NOM-051)
  etiqueta_nom: ["M9 2.5h6l4.5 4.5v6L15 17.5H9L4.5 13V7z", "M12 7.5v4", "M12 14h.01"],
  // Flecha de regreso (devoluciones): mismo lenguaje que "atras", pero con
  // la curva que distingue "regresar algo" de "navegar hacia atrás" — no
  // existía ninguno con esta connotación en el set original.
  devolucion: ["M9 14L4 9l5-5", "M20 20v-7a4 4 0 0 0-4-4H4"],
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
