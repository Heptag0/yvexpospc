// YvexPOS Móvil — Detecta si el sistema operativo tiene activado "reducir
// movimiento" (accesibilidad).
//
// Distinto de Modo Rendimiento (Ajustes → Apariencia): ese lo prende el
// dueño a mano, pensado para hardware lento. Esto lee directo del sistema
// operativo —Ajustes > Accesibilidad en Android, Ajustes > Accesibilidad >
// Movimiento en iOS— y se aplica solo, sin que nadie configure nada dentro
// de la app. Las dos cosas pueden convivir: alguien con hardware rápido
// pero mareo por movimiento prende esto en su teléfono sin tocar Modo
// Rendimiento; alguien con hardware lento prende Modo Rendimiento sin que
// el sistema operativo tenga nada que ver.
//
// API verificada contra la documentación real de React Native (no de
// memoria): AccessibilityInfo.isReduceMotionEnabled() + el evento
// 'reduceMotionChanged', con el mismo patrón de suscripción (.remove())
// que ya usa BackHandler en toda la app.

import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useReduceMotion(): boolean {
  const [activo, setActivo] = useState(false);

  useEffect(() => {
    let vivo = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (vivo) setActivo(v);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => {
      setActivo(v);
    });
    return () => {
      vivo = false;
      sub.remove();
    };
  }, []);

  return activo;
}
