// YvexPOS Móvil — Giro del negocio.
//
// El giro (abarrotes, ropa, cafetería…) personaliza la experiencia:
//   - el onboarding pregunta "¿Qué vende tu negocio?" y lo guarda aquí
//   - cada giro trae departamentos sugeridos (se crean si el inventario
//     está vacío al terminar el onboarding)
//   - y "sugerencias": rasgos de YvexPOS que brillan para ese giro,
//     redactados como recomendación personal para la pantalla de cierre
//
// Se persiste con leerConfig/guardarConfig (claves "giro" y
// "nombre_negocio"), igual que el modo de uso. Default: "otro".

import { leerConfig, guardarConfig } from "./config";
import type { IdUI } from "@/src/componentes/iconos";

export type Giro = {
  id: string;
  nombre: string;
  icono: IdUI;
  frase: string;
  departamentos: string[];
  sugerencias: string[];
};

export const GIROS: Giro[] = [
  {
    id: "abarrotes",
    nombre: "Abarrotes y tienda",
    icono: "tienda",
    frase: "La tiendita de la esquina, el Modelorama, el mini súper.",
    departamentos: [
      "Cerveza", "Refrescos", "Botanas", "Dulces",
      "Lácteos", "Panadería y tortillas", "Limpieza", "Cigarros",
    ],
    sugerencias: [
      "El escáner de tickets con IA aprende rápido con productos de cervecería y refrescos: fotografiá el ticket de tu proveedor y el resurtido cae solo.",
      "Los departamentos te dejan ver qué línea deja más: cerveza, botanas o limpieza.",
      "Con el corte de turno sabes exactamente cuánto efectivo debe haber en el cajón al cerrar.",
    ],
  },
  {
    id: "ropa",
    nombre: "Ropa y calzado",
    icono: "ropa",
    frase: "Boutique, tenis, ropa de niños, puesto de moda.",
    departamentos: ["Dama", "Caballero", "Niños", "Calzado", "Accesorios"],
    sugerencias: [
      "Una tienda en línea y las variantes de talla/color (próximamente) le quedan como anillo al dedo a tu giro.",
      "La foto de cada producto hace que tu catálogo se vea tan bien como tu mercancía.",
      "Los reportes por departamento te dicen si vendes más dama, caballero o calzado.",
    ],
  },
  {
    id: "cafeteria",
    nombre: "Cafetería",
    icono: "taza",
    frase: "Café de olla, latte, pan dulce y buena plática.",
    departamentos: [
      "Cafés", "Tés e infusiones", "Bebidas frías", "Panadería", "Postres",
    ],
    sugerencias: [
      "El ticket promedio del día te dice si van por el puro café o se animan con el pan.",
      "Cobrar desde el teléfono es perfecto para una barra chica: cero caja registradora ocupando espacio.",
      "Los productos más vendidos se aprenden solos y aparecen primero al cobrar.",
    ],
  },
  {
    id: "restaurante",
    nombre: "Restaurante y comida",
    icono: "cubiertos",
    frase: "Cocina económica, mariscos, tacos, fondita.",
    departamentos: ["Entradas", "Platos fuertes", "Bebidas", "Postres"],
    sugerencias: [
      "El corte de turno cuadra perfecto con el servicio de comida y el de cena.",
      "Separar bebidas de platos fuertes en departamentos te muestra tu margen real.",
      "Vende con o sin internet: si se va la señal a media comida, la caja no se detiene.",
    ],
  },
  {
    id: "farmacia",
    nombre: "Farmacia",
    icono: "capsula",
    frase: "Medicamentos, cuidado personal y lo que urge.",
    departamentos: [
      "Medicamentos", "Cuidado personal", "Higiene", "Bebés", "Vitaminas y suplementos",
    ],
    sugerencias: [
      "El stock mínimo te avisa antes de que se acabe lo que la gente busca seguido.",
      "El escáner de tickets con IA lee los tickets de tu distribuidor y actualiza costos y existencias.",
      "Con tantos productos chicos, el buscador por nombre o código te salva en cada venta.",
    ],
  },
  {
    id: "ferreteria",
    nombre: "Ferretería y tlapalería",
    icono: "llave",
    frase: "Tornillos, pintura, herramienta y soluciones.",
    departamentos: [
      "Herramientas", "Pintura", "Electricidad", "Plomería", "Tornillería",
    ],
    sugerencias: [
      "El escáner de tickets con IA aguanta catálogos enormes: entre más lo usas, mejor empareja tus productos.",
      "Las unidades por pieza, metro, litro o caja se ajustan a cómo vendes de verdad.",
      "El conteo físico te ayuda a cuadrar la tornillería sin cerrar el negocio un día entero.",
    ],
  },
  {
    id: "electronica",
    nombre: "Electrónica y cómputo",
    icono: "chip",
    frase: "Celulares, accesorios, cables y reparaciones.",
    departamentos: [
      "Celulares y accesorios", "Cómputo", "Audio y video", "Cables y cargadores",
    ],
    sugerencias: [
      "Costo y precio por producto te muestran el margen real de cada accesorio.",
      "Los reportes por departamento separan lo que se vende seguido (cables) de lo que deja más (equipos).",
      "Tu inventario queda respaldado en la nube: tranquilo si cambias de teléfono.",
    ],
  },
  {
    id: "belleza",
    nombre: "Belleza y estética",
    icono: "brillo",
    frase: "Salón, barbería, cosméticos y cuidado personal.",
    departamentos: [
      "Cabello", "Maquillaje", "Cuidado de la piel", "Uñas", "Fragancias",
    ],
    sugerencias: [
      "La foto de cada producto hace que vender cosméticos sea tan bonito como usarlos.",
      "El stock mínimo te avisa cuando se está acabando la línea que más se mueve.",
      "Varias personas pueden vender con su propio usuario y PIN, cada quien con su corte.",
    ],
  },
  {
    id: "mascotas",
    nombre: "Mascotas",
    icono: "pata",
    frase: "Croquetas, accesorios y consentidos de cuatro patas.",
    departamentos: [
      "Alimento para perro", "Alimento para gato", "Accesorios",
      "Higiene y cuidado", "Juguetes",
    ],
    sugerencias: [
      "El alimento se vende por pieza, kilo o paquete: YvexPOS maneja las unidades como tú las manejas.",
      "El resurtido con foto del ticket de tu proveedor actualiza costos y existencias en un toque.",
      "Los reportes por departamento te dicen si se vende más perro, gato o accesorios.",
    ],
  },
  {
    id: "otro",
    nombre: "Otro giro",
    icono: "puntos",
    frase: "Tu negocio es único, y aquí cabe perfecto.",
    departamentos: [],
    sugerencias: [
      "YvexPOS se amolda a tu giro: departamentos, unidades y precios los defines tú.",
      "Vende con o sin internet y revisa cómo va el día desde el mismo teléfono.",
    ],
  },
];

const GIRO_DEFECTO = "otro";

export function obtenerGiro(id: string | null | undefined): Giro {
  return GIROS.find((g) => g.id === id) ?? GIROS.find((g) => g.id === GIRO_DEFECTO)!;
}

export async function leerGiro(): Promise<string> {
  const v = await leerConfig("giro");
  return GIROS.some((g) => g.id === v) ? (v as string) : GIRO_DEFECTO;
}

export async function guardarGiro(id: string): Promise<void> {
  await guardarConfig("giro", GIROS.some((g) => g.id === id) ? id : GIRO_DEFECTO);
}

export async function leerNombreNegocio(): Promise<string> {
  const v = await leerConfig("nombre_negocio");
  return v && v.trim() ? v.trim() : "Mi negocio";
}

export async function guardarNombreNegocio(nombre: string): Promise<void> {
  const limpio = nombre.trim();
  await guardarConfig("nombre_negocio", limpio === "" ? "Mi negocio" : limpio);
}
