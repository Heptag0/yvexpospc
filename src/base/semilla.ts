// YvexPOS Móvil — Datos de prueba (semilla).
//
// Inserta unas categorías y productos de ejemplo para poder ver la app
// funcionando mientras la construimos. Solo siembra si la base está vacía,
// así no duplica cada vez que abres la app.
//
// Cuando la app esté lista, esto se quita o se deja tras una bandera de "demo".

import { bd, uuid, ahoraISO } from "./db";

/** Siembra datos de ejemplo SOLO si no hay productos todavía. */
export async function sembrarSiVacio(): Promise<void> {
  const db = await bd();
  const fila = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM productos"
  );
  if ((fila?.n ?? 0) > 0) return; // ya hay datos, no sembrar

  const ahora = ahoraISO();

  // Categorías de ejemplo (típicas de una tienda de abarrotes).
  const catBebidas = uuid();
  const catBotanas = uuid();
  const catCigarros = uuid();
  await db.runAsync(
    `INSERT INTO categorias (id, nombre, orden, color, activo, eliminado, creado_en, actualizado_en)
     VALUES (?,?,?,?,1,0,?,?)`,
    [catBebidas, "Bebidas", 1, "#8b5cf6", ahora, ahora]
  );
  await db.runAsync(
    `INSERT INTO categorias (id, nombre, orden, color, activo, eliminado, creado_en, actualizado_en)
     VALUES (?,?,?,?,1,0,?,?)`,
    [catBotanas, "Botanas", 2, "#2dd4bf", ahora, ahora]
  );
  await db.runAsync(
    `INSERT INTO categorias (id, nombre, orden, color, activo, eliminado, creado_en, actualizado_en)
     VALUES (?,?,?,?,1,0,?,?)`,
    [catCigarros, "Cigarros", 3, "#fb7185", ahora, ahora]
  );

  // Productos de ejemplo. Precios en centavos (ej. 1800 = $18.00).
  const productos: Array<[string, string, string, number, number, number]> = [
    // [codigo, nombre, categoria, precio_centavos, stock, stock_minimo]
    ["7501055310531", "Coca-Cola 600ml", catBebidas, 1800, 24, 6],
    ["7501055363513", "Agua Ciel 1L", catBebidas, 1500, 30, 6],
    ["7501055300114", "Sprite 600ml", catBebidas, 1800, 18, 6],
    ["7501000110119", "Sabritas Original 45g", catBotanas, 1900, 15, 4],
    ["7501000112110", "Doritos Nacho 62g", catBotanas, 2100, 12, 4],
    ["7502271500011", "Cacahuates Kiyakis 60g", catBotanas, 1600, 20, 5],
    ["7501234567890", "Marlboro Rojo 20s", catCigarros, 7800, 8, 3],
    ["7501234567891", "Camel Azul 20s", catCigarros, 7500, 6, 3],
  ];

  for (const [codigo, nombre, catId, precio, stock, minimo] of productos) {
    const id = uuid();
    await db.runAsync(
      `INSERT INTO productos
        (id, codigo_barras, nombre, categoria_id, precio_venta_centavos,
         costo_centavos, controla_stock, stock, stock_minimo, unidad,
         activo, eliminado, creado_en, actualizado_en)
       VALUES (?,?,?,?,?,?,1,?,?,'pieza',1,0,?,?)`,
      [
        id,
        codigo,
        nombre,
        catId,
        precio,
        Math.round(precio * 0.7), // costo ~70% del precio, de ejemplo
        stock,
        minimo,
        ahora,
        ahora,
      ]
    );
  }

  console.log("[semilla] datos de prueba insertados");
}
