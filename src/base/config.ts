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

// ---------------------------------------------------------------------------
// Consentimiento del escáner de tickets (Gemini)
// ---------------------------------------------------------------------------
//
// POR QUE NO BASTA CON LOS TERMINOS DEL REGISTRO
// El escaner manda la FOTO del ticket a Google (Gemini). Eso es una cesion a
// un tercero, y hay dos motivos concretos por los que aceptar los terminos al
// crear la cuenta no lo cubre:
//
//   1. La politica publicada ya declara otra cosa: dice que el aviso aparece
//      ANTES del primer uso del escaner y que no se envia nada hasta aceptar.
//      Si el consentimiento fuera el del registro, esa frase seria falsa — y
//      es comprobable por quien revise la aplicacion.
//   2. YvexPOS funciona SIN cuenta. Alguien puede llegar al escaner sin
//      haberse registrado nunca, y por tanto sin haber aceptado nada.
//
// Por eso vive aqui, en la config LOCAL del aparato, y no en la cuenta: es una
// decision de quien usa este telefono, no del titular de la cuenta.
//
// Guarda la fecha ISO de aceptacion, no un "1". Si algun dia cambia lo que se
// manda o a quien, se puede comparar contra la fecha del cambio y volver a
// preguntar solo a quien acepto la version vieja.

const CLAVE_CONSENTIMIENTO_IA = "escaner_ia_consentido_en";

export async function leerConsentimientoEscaner(): Promise<boolean> {
  const v = await leerConfig(CLAVE_CONSENTIMIENTO_IA);
  return Boolean(v && v.trim());
}

export async function guardarConsentimientoEscaner(acepta: boolean): Promise<void> {
  if (acepta) await guardarConfig(CLAVE_CONSENTIMIENTO_IA, new Date().toISOString());
  else await borrarConfig([CLAVE_CONSENTIMIENTO_IA]);
}
