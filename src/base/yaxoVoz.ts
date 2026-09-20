// YvexPOS — Yaxo: voz y variación de las frases.
//
// ===========================================================================
// POR QUÉ ROTACIÓN Y NO AZAR
// ===========================================================================
// Con Math.random() puro, tarde o temprano sale la misma variante dos veces
// seguidas — y eso se nota MÁS que no variar nada: el usuario acaba de leer esa
// frase y la vuelve a leer idéntica. Rotar garantiza que la siguiente sea otra.
//
// El contador arranca en un punto distinto cada día para que dos usuarios no
// lean exactamente la misma secuencia, y para que quien abre el asistente todos
// los días a la misma hora no reciba siempre el mismo saludo.
//
// ===========================================================================
// LA VARIACIÓN ES DE PALABRAS, NUNCA DE CONTENIDO
// ===========================================================================
// Todas las variantes de un mismo hueco dicen EXACTAMENTE lo mismo con otras
// palabras. Ninguna añade un dato, suaviza una reserva ni cambia una cifra.
//
// Es fácil equivocarse aquí: escribir una variante "más optimista" de una mala
// noticia es cambiar el contenido, no la forma. Si dos variantes no son
// intercambiables sin alterar lo que el usuario entiende, una de las dos sobra.

/** Estado de rotación por clave. Vive en memoria: al reiniciar la app se
 *  reinicia, y no pasa nada — lo que importa es no repetir dentro de una
 *  sesión de uso, que es donde se nota. */
const contadores = new Map<string, number>();

/** Arranque distinto por día, para que la secuencia no sea siempre la misma. */
function semillaDelDia(): number {
  const d = new Date();
  return d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate();
}

/**
 * Devuelve la siguiente variante de una lista, rotando.
 *
 * `clave` identifica el hueco: dos huecos distintos rotan por separado, así que
 * variar el saludo no arrastra la variación del cierre.
 */
export function variar(clave: string, variantes: string[]): string {
  if (variantes.length === 0) return "";
  if (variantes.length === 1) return variantes[0];
  const actual = contadores.get(clave);
  const siguiente =
    actual === undefined ? semillaDelDia() % variantes.length : (actual + 1) % variantes.length;
  contadores.set(clave, siguiente);
  return variantes[siguiente];
}

/** Igual que `variar` pero para trozos que se insertan dentro de una frase
 *  (conectores, aperturas). Se separa solo por legibilidad en quien lo lee. */
export const conector = variar;

// ===========================================================================
// PUNTO DE EXTENSIÓN — PERSONALIDADES (plan premium, con modelo)
// ===========================================================================
// En el plan local la voz es ESTA y no se elige: las plantillas están escritas
// en un tono concreto y hacer cuatro juegos completos de plantillas sería
// multiplicar el trabajo por cuatro para un plan que no se cobra.
//
// La elección de personalidad es una función del plan premium, donde el modelo
// adopta el tono a partir del prompt y no cuesta plantillas nuevas. Por eso el
// tipo vive aquí desde ya: cuando se implemente, `SYSTEM_ANALISTA` recibe un
// bloque distinto según este valor y nada más cambia.
//
// El nivel local seguirá usando sus plantillas tal cual, ignorando este ajuste.
// Eso hay que decirlo en la interfaz: "el tono se aplica con el asistente
// completo", o el usuario del plan básico cambiará el ajuste y no verá nada.
export type PersonalidadYaxo =
  /** El de las plantillas de abajo. Cercano, directo, sin adornos. */
  | "cercano"
  /** Más seco y más corto. Para quien quiere el dato y nada más. */
  | "directo"
  /** Explica más, asume menos conocimiento previo. Para quien empieza. */
  | "maestro";

export const PERSONALIDAD_POR_DEFECTO: PersonalidadYaxo = "cercano";

// ===========================================================================
// PUNTO DE EXTENSIÓN — CONTEXTO (qué Yaxo está hablando)
// ===========================================================================
// Es la MISMA criatura con distinto oficio, no dos asistentes. Lo que cambia
// según el contexto:
//   - qué preguntas se ofrecen
//   - qué indicadores se consultan
//   - qué bloque de instrucciones recibe el modelo en el plan premium
//   - el modelo mismo: el POS redacta sobre datos servidos y le basta un modelo
//     rápido; lo fiscal tiene consecuencias legales y pide uno que razone.
//
// Lo que NO cambia: el dibujo, la voz, las reglas de honestidad.
export type ContextoYaxo =
  /** Punto de venta: ventas, inventario, caja, márgenes. */
  | "pos"
  /** Contabilidad y SAT. PENDIENTE: ningún indicador ni plantilla escrita
   *  todavía. Cuando se implemente, los archivos paralelos son
   *  `indicadoresConta.ts` y `yaxoFrasesConta.ts`, y yaxoHechos.ts crece con
   *  un `reunirHechosConta()`. */
  | "conta";
