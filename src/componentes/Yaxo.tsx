// YvexPOS Móvil — Yaxo, la mascota y asistente de Yvex.
//
// ---------------------------------------------------------------------------
// UN SOLO CUERPO, OCHO CARAS
// ---------------------------------------------------------------------------
// Los ocho estados comparten EXACTAMENTE los mismos paths de cuerpo, branquias
// y patitas: no parecidos, idénticos. Solo cambian ojos, boca y lo que aparece
// al lado.
//
// No es una decisión estética. Cuando cada pose se redibuja por separado, las
// proporciones bailan un poco entre una y otra, y el ojo lo detecta aunque no
// sepa nombrarlo: se ve como ocho dibujos parecidos en vez de uno con ocho
// expresiones. Compartir el path lo garantiza por construcción.
//
// Si algún día hace falta otra pose, se añade a cara() y ya. Tocar CUERPO
// afecta a los ocho a la vez, que es justo lo que se quiere.
//
// ---------------------------------------------------------------------------
// POR QUÉ HAY UNA VERSIÓN COMPACTA
// ---------------------------------------------------------------------------
// A tamaño icono las seis branquias se empastan en una mancha rosa y el
// personaje deja de leerse como ajolote. Por debajo de UMBRAL_COMPACTO se
// dibujan dos branquias por lado en vez de tres y el trazo va más grueso. Es lo
// normal en un sistema de iconos, no un parche: un dibujo que funciona a 64 px
// casi nunca funciona a 16 sin simplificarse.
//
// ---------------------------------------------------------------------------
// COLORES
// ---------------------------------------------------------------------------
// Yaxo NO usa el acento del tema. Es un personaje, no un icono de interfaz: si
// cambiara de color con cada tema dejaría de ser reconocible, que es lo único
// que se le pide a una mascota. Las props `piel` y `trazo` existen para casos
// puntuales (fondos oscuros, impresión), no para el uso normal.
//
// PENDIENTE DE PROBAR EN EL TEMA GRAFITO: sobre fondo oscuro el contorno
// borgoña puede perder contraste. Si se ve mal, la salida es pasar `trazo` a un
// tono claro en ese tema, no repintar la piel.

import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import Svg, { Circle, Ellipse, G, Path } from "react-native-svg";
import { useReduceMotion } from "@/src/componentes/useReduceMotion";

export type EstadoYaxo =
  | "reposo"
  | "feliz"
  | "pensativo"
  | "preocupado"
  | "sorpresa"
  | "alerta"
  | "trabajando"
  | "contable";

const PIEL = "#F6C2CC";
const TRAZO = "#6B2233";
const CREMA = "#fbf7ef";

/** Por debajo de esto se usa la silueta simplificada: 28 px es donde las
 *  branquias empiezan a tocarse entre sí en un teléfono normal. */
const UMBRAL_COMPACTO = 28;

// El dibujo va de y=16 a y=94 y de x=1 a x=99. El viewBox lleva margen
// alrededor para que no quede pegado al borde del contenedor.
const CAJA = "-8 6 116 100";

const CUERPO =
  "M50 16 C68 16 80 27 80 40 C80 50 75 55 72 58 C78 63 82 72 82 80 " +
  "C82 88 70 91 50 91 C30 91 18 88 18 80 C18 72 22 63 28 58 " +
  "C25 55 20 50 20 40 C20 27 32 16 50 16 Z";

const BRANQUIAS = [
  "M22 30 C14 24 5 25 2 29 C5 34 14 35 22 34 Z",
  "M21 39 C12 36 3 38 1 42 C4 46 13 46 21 43 Z",
  "M23 47 C15 47 7 51 6 55 C10 58 18 56 24 52 Z",
  "M78 30 C86 24 95 25 98 29 C95 34 86 35 78 34 Z",
  "M79 39 C88 36 97 38 99 42 C96 46 87 46 79 43 Z",
  "M77 47 C85 47 93 51 94 55 C90 58 82 56 76 52 Z",
];

// En compacto se quedan la primera y la tercera de cada lado: las de en medio
// son las que primero se funden con sus vecinas al reducir.
const BRANQUIAS_COMPACTO = [BRANQUIAS[0], BRANQUIAS[2], BRANQUIAS[3], BRANQUIAS[5]];

const AnimatedG = Animated.createAnimatedComponent(G);

export default function Yaxo({
  estado = "reposo",
  size = 64,
  piel = PIEL,
  trazo = TRAZO,
}: {
  estado?: EstadoYaxo;
  size?: number;
  piel?: string;
  trazo?: string;
}) {
  const reducirMovimiento = useReduceMotion();
  const compacto = size < UMBRAL_COMPACTO;
  const grosor = compacto ? 6 : 3.4;
  const branquias = compacto ? BRANQUIAS_COMPACTO : BRANQUIAS;

  // Los tres puntos de "trabajando" laten en cadena. Sin esto, Yaxo con los
  // ojos bajos parece colgado en vez de ocupado — justo lo que no queremos
  // comunicar mientras el asistente calcula algo.
  const p1 = useRef(new Animated.Value(0.25)).current;
  const p2 = useRef(new Animated.Value(0.25)).current;
  const p3 = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    if (estado !== "trabajando" || reducirMovimiento) {
      // Fuera de ese estado, o con movimiento reducido, los puntos se quedan
      // visibles y quietos: siguen diciendo "estoy en ello" sin animar nada.
      p1.setValue(1);
      p2.setValue(1);
      p3.setValue(1);
      return;
    }
    const pulso = (v: Animated.Value, retraso: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(retraso),
          Animated.timing(v, { toValue: 1, duration: 320, useNativeDriver: false }),
          Animated.timing(v, { toValue: 0.25, duration: 320, useNativeDriver: false }),
          Animated.delay(Math.max(0, 360 - retraso)),
        ])
      );
    // useNativeDriver: false a propósito. react-native-svg no expone `opacity`
    // al hilo nativo de forma fiable y con el driver nativo la animación
    // simplemente no se ve. Son tres valores, el coste es irrelevante.
    const anims = [pulso(p1, 0), pulso(p2, 180), pulso(p3, 360)];
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [estado, reducirMovimiento, p1, p2, p3]);

  const ojo = (cx: number, cy: number, r: number) => (
    <Circle cx={cx} cy={cy} r={r} fill={trazo} />
  );
  const linea = (d: string, ancho = grosor) => (
    <Path
      d={d}
      fill="none"
      stroke={trazo}
      strokeWidth={ancho}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );

  function cara() {
    switch (estado) {
      case "feliz":
        return (
          <>
            {linea("M33 43 C36 36 41 36 44 43 M56 43 C59 36 64 36 67 43")}
            {linea("M43 52 C47 60 53 60 57 52")}
          </>
        );
      case "pensativo":
        return (
          <>
            {ojo(40, 37, 5)}
            {ojo(64, 37, 5)}
            {linea("M45 55 L56 53")}
            {/* Los puntos de pensar desaparecen en compacto: a ese tamaño son
                dos motas sueltas que ensucian en vez de aportar. */}
            {!compacto && <Circle cx={88} cy={18} r={2.6} fill={trazo} />}
            {!compacto && <Circle cx={96} cy={10} r={3.6} fill={trazo} />}
          </>
        );
      case "preocupado":
        return (
          <>
            {linea("M31 32 L44 37 M69 32 L56 37")}
            {ojo(38, 44, 5)}
            {ojo(62, 44, 5)}
            {linea("M44 59 C47 55 53 55 56 59")}
          </>
        );
      case "sorpresa":
        return (
          <>
            {ojo(37, 41, 7)}
            {ojo(63, 41, 7)}
            <Ellipse
              cx={50}
              cy={57}
              rx={4.5}
              ry={5.5}
              fill="none"
              stroke={trazo}
              strokeWidth={grosor}
            />
          </>
        );
      case "alerta":
        return (
          <>
            {ojo(38, 41, 5)}
            {ojo(62, 41, 5)}
            {/* Boca RECTA, no triste. Cuando Yaxo avisa de que se acaba el
                stock no está apenado, está informando. Con la misma cara que
                "preocupado", el aviso perdería fuerza por repetición. */}
            {linea("M44 55 L56 55")}
            <Path
              d="M99 6 L114 32 L84 32 Z"
              fill={CREMA}
              stroke={trazo}
              strokeWidth={grosor * 0.94}
              strokeLinejoin="round"
            />
            {linea("M99 15 L99 23", grosor * 1.2)}
            <Circle cx={99} cy={28} r={2.2} fill={trazo} />
          </>
        );
      case "trabajando":
        return (
          <>
            {linea("M33 40 C36 46 41 46 44 40 M56 40 C59 46 64 46 67 40")}
            {linea("M45 55 L55 55")}
            <AnimatedG opacity={p1}>
              <Circle cx={82} cy={66} r={2.4} fill={trazo} />
            </AnimatedG>
            <AnimatedG opacity={p2}>
              <Circle cx={92} cy={60} r={2.4} fill={trazo} />
            </AnimatedG>
            <AnimatedG opacity={p3}>
              <Circle cx={102} cy={54} r={2.4} fill={trazo} />
            </AnimatedG>
          </>
        );
      case "contable":
        return (
          <>
            <Circle cx={38} cy={41} r={10.5} fill="none" stroke={trazo} strokeWidth={grosor * 0.94} />
            <Circle cx={62} cy={41} r={10.5} fill="none" stroke={trazo} strokeWidth={grosor * 0.94} />
            {linea("M48.5 41 L51.5 41 M27.5 38 L21 35 M72.5 38 L79 35", grosor * 0.94)}
            {ojo(38, 41, 4)}
            {ojo(62, 41, 4)}
            {linea("M44 56 C47 60 53 60 56 56")}
          </>
        );
      case "reposo":
      default:
        return (
          <>
            {ojo(38, 41, 5)}
            {ojo(62, 41, 5)}
            {linea("M44 54 C47 58 53 58 56 54")}
          </>
        );
    }
  }

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={CAJA}>
        <G
          fill={piel}
          stroke={trazo}
          strokeWidth={grosor}
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          {branquias.map((d, i) => (
            <Path key={i} d={d} />
          ))}
          {/* Patitas ANTES del cuerpo: asoman por debajo sin cortarle la
              silueta. Si fueran después, el contorno quedaría partido por dos
              óvalos y se vería como un parche pegado encima. */}
          <Ellipse cx={34} cy={89} rx={9} ry={5.5} />
          <Ellipse cx={66} cy={89} rx={9} ry={5.5} />
          <Path d={CUERPO} />
        </G>
        {cara()}
      </Svg>
    </View>
  );
}
