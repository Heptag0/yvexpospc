// YvexPOS Móvil — Proveedor de tema.
//
// Envuelve toda la app y reparte la paleta activa. Cuando el usuario cambia
// el tema en Configuración, TODA la interfaz se actualiza al instante sin
// reiniciar.
//
// ---------------------------------------------------------------------------
// setDensidad / setBordes — por qué se añaden ahora
// ---------------------------------------------------------------------------
// `apariencia.ts` ya traía `densidad` y `bordes` en `Preferencias` y en
// `construirTema` desde la Fase 1, pero este archivo nunca se actualizó para
// exponer cómo CAMBIARLOS. El resultado era un hueco silencioso: los tokens
// existían y `Ajustes` podía en teoría mostrarlos, pero no había ninguna
// función que los guardara — exactamente el mismo tipo de "función a medias"
// que el badge de pedidos web que se quedó sin conectar en Inicio.

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  Preferencias,
  PREFS_DEFECTO,
  leerPreferencias,
  guardarPreferencia,
  construirTema,
} from "@/src/base/apariencia";

type Ctx = {
  prefs: Preferencias;
  tema: ReturnType<typeof construirTema>;
  setTema: (v: string) => void;
  setAcento: (v: string) => void;
  setPack: (v: string) => void;
  setDensidad: (v: string) => void;
  setBordes: (v: string) => void;
  setModoRendimiento: (v: boolean) => void;
  listo: boolean;
};

const TemaCtx = createContext<Ctx | null>(null);

export function TemaProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferencias>(PREFS_DEFECTO);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    leerPreferencias().then((p) => {
      setPrefs(p);
      setListo(true);
    });
  }, []);

  const valor: Ctx = {
    prefs,
    tema: construirTema(prefs),
    listo,
    setTema: (v) => {
      setPrefs((p) => ({ ...p, tema: v as any }));
      guardarPreferencia("tema", v);
    },
    setAcento: (v) => {
      setPrefs((p) => ({ ...p, acento: v as any }));
      guardarPreferencia("acento", v);
    },
    setPack: (v) => {
      setPrefs((p) => ({ ...p, pack: v as any }));
      guardarPreferencia("pack_iconos", v);
    },
    setDensidad: (v) => {
      setPrefs((p) => ({ ...p, densidad: v as any }));
      guardarPreferencia("densidad", v);
    },
    setBordes: (v) => {
      setPrefs((p) => ({ ...p, bordes: v as any }));
      guardarPreferencia("bordes", v);
    },
    setModoRendimiento: (v) => {
      setPrefs((p) => ({ ...p, modoRendimiento: v }));
      guardarPreferencia("modo_rendimiento", v ? "1" : "0");
    },
  };

  return <TemaCtx.Provider value={valor}>{children}</TemaCtx.Provider>;
}

/** Hook para usar el tema activo en cualquier pantalla. */
export function useTema(): Ctx {
  const c = useContext(TemaCtx);
  if (!c) throw new Error("useTema debe usarse dentro de <TemaProvider>");
  return c;
}
