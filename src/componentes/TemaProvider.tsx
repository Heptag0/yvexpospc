// YvexPOS Móvil — Proveedor de tema.
//
// Envuelve toda la app y reparte la paleta activa. Cuando el usuario cambia
// el tema en Configuración, TODA la interfaz se actualiza al instante sin
// reiniciar.

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
  };

  return <TemaCtx.Provider value={valor}>{children}</TemaCtx.Provider>;
}

/** Hook para usar el tema activo en cualquier pantalla. */
export function useTema(): Ctx {
  const c = useContext(TemaCtx);
  if (!c) throw new Error("useTema debe usarse dentro de <TemaProvider>");
  return c;
}
