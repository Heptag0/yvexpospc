// YvexPOS Móvil — Configuración clave-valor (tabla `config`).
// Un solo lugar para leer/escribir ajustes persistentes.

import { bd } from "./db";

export async function leerConfig(clave: string): Promise<string | null> {
  const db = await bd();
  const f = await db.getFirstAsync<{ valor: string | null }>(
    "SELECT valor FROM config WHERE clave = ?",
    [clave]
  );
  return f?.valor ?? null;
}

export async function leerVarias(claves: string[]): Promise<Map<string, string>> {
  const db = await bd();
  const marcas = claves.map(() => "?").join(",");
  const filas = await db.getAllAsync<{ clave: string; valor: string }>(
    `SELECT clave, valor FROM config WHERE clave IN (${marcas})`,
    claves
  );
  return new Map(filas.map((f) => [f.clave, f.valor]));
}

export async function guardarConfig(clave: string, valor: string): Promise<void> {
  const db = await bd();
  await db.runAsync(
    "INSERT INTO config (clave, valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor = ?",
    [clave, valor, valor]
  );
}

export async function borrarConfig(claves: string[]): Promise<void> {
  const db = await bd();
  const marcas = claves.map(() => "?").join(",");
  await db.runAsync(`DELETE FROM config WHERE clave IN (${marcas})`, claves);
}
