// YvexPOS Móvil — Sonidos de la app (lógica pura, sin JSX).
//
// Beep de escáner y celebración de misiones. Fire-and-forget: NUNCA lanzan
// error ni bloquean el flujo (si el audio falla, la app sigue igual).
// Los .wav viven en assets/sonidos/ y se generaron sintetizados (sin assets
// de terceros): beep = tono corto tipo caja registradora; exito = arpegio.

import { Audio } from "expo-av";

// Metro tipa require() de assets en el build real; esta declaración solo
// silencia la validación tsc aislada del proyecto (devuelve el id del asset).
declare const require: (ruta: string) => number;

const SONIDOS = {
  beep: require("../../assets/sonidos/beep.wav"),
  exito: require("../../assets/sonidos/exito.wav"),
} as const;

export type IdSonido = keyof typeof SONIDOS;

/** Reproduce un sonido una vez y libera el recurso al terminar. Nunca lanza. */
export async function reproducirSonido(id: IdSonido): Promise<void> {
  try {
    const { sound } = await Audio.Sound.createAsync(SONIDOS[id], {
      shouldPlay: true,
      volume: 1.0,
    });
    sound.setOnPlaybackStatusUpdate((estado) => {
      if (estado.isLoaded && estado.didJustFinish) {
        sound.unloadAsync().catch(() => {});
      }
    });
  } catch {
    // Sin audio disponible (silencio del sistema, emulador, etc.): seguimos.
  }
}

/** Beep corto al leer un código de barras. */
export function sonidoBeep(): void {
  void reproducirSonido("beep");
}

/** Arpegio de celebración (misiones completas). */
export function sonidoExito(): void {
  void reproducirSonido("exito");
}
