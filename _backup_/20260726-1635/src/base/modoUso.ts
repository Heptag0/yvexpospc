// YvexPOS Móvil — Modo de uso del dispositivo.
//
// La misma app sirve para dos cosas: COBRAR (punto de venta) y/o VIGILAR
// el negocio (ventas, inventario y reportes sin vender aquí). El dueño lo
// elige en el onboarding y puede cambiarlo después en Ajustes.
//
// También vive aquí la bandera de "onboarding hecho": decide si al arrancar
// la app muestra el asistente de bienvenida o entra directo a trabajar.

import { bd } from "./db";
import { leerConfig, guardarConfig } from "./config";

export type ModoUso = "pos" | "monitor" | "ambos";

export const MODOS: { id: ModoUso; nombre: string; desc: string; ejemplo: string }[] = [
  {
    id: "pos",
    nombre: "Punto de venta",
    desc: "Para cobrar con este dispositivo.",
    ejemplo: "Tu tienda no tiene caja registradora, o quieres una caja extra en el piso.",
  },
  {
    id: "monitor",
    nombre: "Monitoreo",
    desc: "Para vigilar el negocio sin vender aquí.",
    ejemplo: "Ya tienes YvexPOS en tu PC y quieres ver ventas, inventario y reportes desde el teléfono.",
  },
  {
    id: "ambos",
    nombre: "Vender y monitorear",
    desc: "Cobras aquí y también le das seguimiento a tu negocio.",
    ejemplo: "Cobras en el mostrador y también revisas cómo va el día.",
  },
];

const MODO_DEFECTO: ModoUso = "ambos";

export async function leerModoUso(): Promise<ModoUso> {
  const v = await leerConfig("modo_uso");
  return v === "pos" || v === "monitor" || v === "ambos" ? v : MODO_DEFECTO;
}

export async function guardarModoUso(m: ModoUso): Promise<void> {
  await guardarConfig("modo_uso", m);
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export async function onboardingHecho(): Promise<boolean> {
  return (await leerConfig("onboarding_hecho")) === "1";
}

export async function marcarOnboardingHecho(): Promise<void> {
  await guardarConfig("onboarding_hecho", "1");
}

/**
 * Decide qué ve el usuario al arrancar.
 *
 * - Onboarding hecho -> directo a la app.
 * - NO hecho pero YA hay usuarios (instalación anterior al onboarding):
 *   se marca hecho en silencio con modo "ambos" y entra directo. Nadie que
 *   ya usa la app debe toparse con el asistente de golpe.
 * - Sin usuarios -> onboarding (instalación nueva).
 */
export async function resolverEstadoInicial(): Promise<"onboarding" | "app"> {
  if (await onboardingHecho()) return "app";

  const db = await bd();
  const fila = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM usuarios_pos WHERE eliminado = 0"
  );
  if ((fila?.n ?? 0) > 0) {
    await guardarModoUso(MODO_DEFECTO);
    await marcarOnboardingHecho();
    return "app";
  }
  return "onboarding";
}
