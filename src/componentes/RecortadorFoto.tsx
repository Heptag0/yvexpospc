// YvexPOS Móvil — Recortador de foto (pellizcar para acercar, arrastrar
// para mover), en vez del recorte cuadrado del picker nativo (destructivo:
// lo que queda fuera del recuadro se pierde para siempre, sin poder
// recuperarlo después).
//
// Usa PanResponder (API nativa de React Native, sin dependencias externas
// ni configuración de Babel) en vez de react-native-gesture-handler +
// Reanimated — más simple y sin sorpresas de configuración entre proyectos.
//
// Arranca SIEMPRE en el zoom mínimo que llena el cuadro sin dejar huecos:
// eso equivale a que el lado CORTO de la foto quepa completo — es la mayor
// cantidad de producto que un recorte cuadrado puede mostrar sin inventar
// relleno (un cuadrado nunca puede enseñar más que su lado corto). Desde
// ahí, el tendero decide si acercar (recorte más ajustado) o mover para
// elegir qué parte del lado largo se queda.
//
// Se usa para TRES orígenes, todos con la misma herramienta:
//   - Foto recién tomada con la cámara (ya sin el recorte nativo).
//   - Foto elegida de la galería (ídem).
//   - Foto descargada del catálogo abierto (nunca viene recortada).
//   - Ajustar de nuevo una foto que ya estaba puesta (desde el lightbox).

import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Image,
  ActivityIndicator,
  NativeSyntheticEvent,
  NativeTouchEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import * as ImageManipulator from "expo-image-manipulator";
import { useTema } from "./TemaProvider";

const LADO = 320; // tamaño del marco cuadrado en pantalla (px lógicos)
const ZOOM_MAX_EXTRA = 4; // hasta 4x más cerca que el mínimo posible
const SALIDA_PX = 900; // resolución del cuadrado final guardado

function acotar(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function distanciaEntreToques(touches: { pageX: number; pageY: number }[]): number {
  if (touches.length < 2) return 1;
  const [a, b] = touches;
  const dx = a.pageX - b.pageX;
  const dy = a.pageY - b.pageY;
  return Math.sqrt(dx * dx + dy * dy) || 1;
}

type Props = {
  uri: string;
  onCancelar: () => void;
  /** Recibe la uri TEMPORAL ya recortada y la foto completa normalizada
   *  de la que salió (el llamador persiste ambas, emparejadas). */
  onListo: (uriRecortada: string, uriOriginal: string) => void;
};

export default function RecortadorFoto({ uri, onCancelar, onListo }: Props) {
  const { tema: T } = useTema();
  const est = crearEstilos(T);

  const [tam, setTam] = useState<{ w: number; h: number } | null>(null);
  // Uri NORMALIZADA sobre la que se mide Y se recorta. Es clave que sean la
  // misma: las fotos de cámara traen rotación EXIF ("rótame 90°"), y ahí
  // Image.getSize devuelve las medidas YA rotadas (como se ven) mientras
  // que ImageManipulator recorta sobre los píxeles SIN rotar — ancho y alto
  // quedaban cruzados y el recorte caía en una zona equivocada (siempre
  // hacia arriba-izquierda). Pasarla una vez por manipulateAsync deja los
  // píxeles ya rotados de verdad, sin marca EXIF pendiente, y entonces
  // medir y recortar coinciden.
  const [uriNorm, setUriNorm] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  // Estado SOLO para redibujar la foto en pantalla; la fuente de verdad
  // durante el gesto vive en los refs de abajo (no depende de re-render).
  const [visual, setVisual] = useState({ escala: 1, tx: 0, ty: 0 });

  const tamRef = useRef<{ w: number; h: number } | null>(null);
  useEffect(() => {
    tamRef.current = tam;
  }, [tam]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        // Sin operaciones: solo materializa la rotación EXIF y nos devuelve
        // las medidas REALES de los píxeles resultantes.
        const norm = await ImageManipulator.manipulateAsync(uri, [], {
          compress: 1,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        if (!vivo) return;
        setUriNorm(norm.uri);
        setTam({ w: norm.width, h: norm.height });
      } catch {
        if (vivo) setError("No se pudo leer esta foto.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [uri]);

  function escalasLimite(t: { w: number; h: number } | null) {
    const min = t ? LADO / Math.min(t.w, t.h) : 1;
    return { min, max: min * ZOOM_MAX_EXTRA };
  }
  const { min: escalaMin, max: escalaMax } = escalasLimite(tam);

  // Refs: valores "en vivo" del gesto actual.
  const escalaRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);
  const baseEscala = useRef(1);
  const baseTx = useRef(0);
  const baseTy = useRef(0);
  const baseDist = useRef(1);
  const modoRef = useRef<"pan" | "pinch" | null>(null);

  // En cuanto sabemos el tamaño real, arrancamos centrados en el zoom mínimo.
  useEffect(() => {
    if (!tam) return;
    const { min } = escalasLimite(tam);
    escalaRef.current = min;
    txRef.current = 0;
    tyRef.current = 0;
    setVisual({ escala: min, tx: 0, ty: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tam]);

  function limitePan(esc: number) {
    const t = tamRef.current;
    if (!t) return { x: 0, y: 0 };
    const anchoImg = t.w * esc;
    const altoImg = t.h * esc;
    return {
      x: Math.max(0, (anchoImg - LADO) / 2),
      y: Math.max(0, (altoImg - LADO) / 2),
    };
  }

  // Punto de partida del dedo único (para calcular dx/dy del arrastre a
  // mano, ya que los eventos de toque crudos no traen esto incluido).
  const inicioX = useRef(0);
  const inicioY = useRef(0);

  function alIniciarToque(evt: NativeSyntheticEvent<NativeTouchEvent>) {
    const touches = evt.nativeEvent.touches;
    baseEscala.current = escalaRef.current;
    baseTx.current = txRef.current;
    baseTy.current = tyRef.current;
    if (touches.length >= 2) {
      modoRef.current = "pinch";
      baseDist.current = distanciaEntreToques(touches);
    } else if (touches.length === 1) {
      modoRef.current = "pan";
      inicioX.current = touches[0].pageX;
      inicioY.current = touches[0].pageY;
    }
  }

  function alMoverToque(evt: NativeSyntheticEvent<NativeTouchEvent>) {
    const t = tamRef.current;
    if (!t) return;
    const { min, max } = escalasLimite(t);
    const touches = evt.nativeEvent.touches;

    if (touches.length >= 2) {
      // Si acabamos de pasar de 1 a 2 dedos, reiniciamos la base para que
      // no dé un salto brusco de escala.
      if (modoRef.current !== "pinch") {
        modoRef.current = "pinch";
        baseEscala.current = escalaRef.current;
        baseDist.current = distanciaEntreToques(touches);
      }
      const d = distanciaEntreToques(touches);
      const factor = d / baseDist.current;
      const nuevaEscala = acotar(baseEscala.current * factor, min, max);
      const lim = limitePan(nuevaEscala);
      const nuevoTx = acotar(txRef.current, -lim.x, lim.x);
      const nuevoTy = acotar(tyRef.current, -lim.y, lim.y);
      escalaRef.current = nuevaEscala;
      txRef.current = nuevoTx;
      tyRef.current = nuevoTy;
      setVisual({ escala: nuevaEscala, tx: nuevoTx, ty: nuevoTy });
    } else if (touches.length === 1) {
      if (modoRef.current !== "pan") {
        modoRef.current = "pan";
        baseTx.current = txRef.current;
        baseTy.current = tyRef.current;
        inicioX.current = touches[0].pageX;
        inicioY.current = touches[0].pageY;
      }
      const dx = touches[0].pageX - inicioX.current;
      const dy = touches[0].pageY - inicioY.current;
      const lim = limitePan(escalaRef.current);
      const nuevoTx = acotar(baseTx.current + dx, -lim.x, lim.x);
      const nuevoTy = acotar(baseTy.current + dy, -lim.y, lim.y);
      txRef.current = nuevoTx;
      tyRef.current = nuevoTy;
      setVisual({ escala: escalaRef.current, tx: nuevoTx, ty: nuevoTy });
    }
  }

  function alSoltarToque() {
    modoRef.current = null;
  }

  async function confirmar() {
    if (!tam || !uriNorm) return;
    setError("");
    setGuardando(true);
    try {
      // Región visible, pasada de coordenadas de PANTALLA a coordenadas de
      // la imagen ORIGINAL (dividiendo entre la escala actual). Asume que
      // la foto está CENTRADA en el marco cuando tx=ty=0 (por eso el marco
      // tiene alignItems/justifyContent "center" — si eso cambia, esta
      // cuenta también hay que cambiarla).
      const esc = visual.escala;
      const ladoOrig = LADO / esc;
      const centroXOrig = tam.w / 2 - visual.tx / esc;
      const centroYOrig = tam.h / 2 - visual.ty / esc;
      let originX = centroXOrig - ladoOrig / 2;
      let originY = centroYOrig - ladoOrig / 2;
      // Nunca salirse de los bordes reales (por seguridad numérica).
      originX = Math.max(0, Math.min(tam.w - ladoOrig, originX));
      originY = Math.max(0, Math.min(tam.h - ladoOrig, originY));

      // Se recorta sobre uriNorm (NO sobre uri): es la que medimos.
      const resultado = await ImageManipulator.manipulateAsync(
        uriNorm,
        [
          { crop: { originX, originY, width: ladoOrig, height: ladoOrig } },
          { resize: { width: SALIDA_PX, height: SALIDA_PX } },
        ],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
      );
      // Se devuelve también la foto completa normalizada: el llamador la
      // guarda junto al recorte para poder RE-AJUSTAR el encuadre después
      // sin haber perdido lo que quedó fuera.
      onListo(resultado.uri, uriNorm);
    } catch {
      setError("No se pudo recortar la foto. Intenta de nuevo.");
      setGuardando(false);
    }
  }

  return (
    <View style={est.raiz}>
      {/* Fondo difuminado real (mismo tratamiento que el visor de foto),
          en vez de una banda negra plana. */}
      <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, est.velo]} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        {/* Cabecera: SOLO salida. La confirmacion ya no vive aqui — ver el
            comentario del pie. */}
        <View style={est.cabecera}>
          <Pressable onPress={onCancelar} hitSlop={10} disabled={guardando}>
            <Text style={est.cabeceraBtn}>Cancelar</Text>
          </Pressable>
          <Text style={est.titulo}>Ajustar foto</Text>
          {/* Hueco simetrico: mantiene el titulo centrado de verdad sin
              recurrir a posicion absoluta. */}
          <View style={est.huecoSimetrico} />
        </View>

        <View style={est.zona}>
          {!tam && !error && <ActivityIndicator color={T.acento} />}
          {error ? <Text style={est.error}>{error}</Text> : null}
          {tam && uriNorm && (
            <>
              <View
                style={est.marco}
                onTouchStart={alIniciarToque}
                onTouchMove={alMoverToque}
                onTouchEnd={alSoltarToque}
                onTouchCancel={alSoltarToque}
              >
                <Image
                  source={{ uri: uriNorm }}
                  resizeMode="cover"
                  style={{
                    width: tam.w * visual.escala,
                    height: tam.h * visual.escala,
                    transform: [
                      { translateX: visual.tx },
                      { translateY: visual.ty },
                    ],
                  }}
                />
              </View>
              {/* Pegada al marco, no al fondo de la pantalla: la pista
                  pertenece a la foto y tiene que leerse junto a ella. */}
              <Text style={est.ayuda}>Pellizca para acercar · arrastra para mover</Text>
            </>
          )}
        </View>

        {/* CONFIRMAR ES UN BOTON PRIMARIO ABAJO, NO UN ENLACE ARRIBA
            --------------------------------------------------------------
            Antes "Listo" era texto pequeno en la esquina superior derecha,
            mientras el "Crear producto" del formulario seguia visible abajo
            a todo color. La jerarquia quedaba invertida: lo unico que se
            leia como accion era el boton equivocado, y pulsarlo creaba el
            producto SIN la foto, en silencio.
            Ahora la accion que cierra este paso es la mas visible de la
            pantalla y esta donde el pulgar ya espera encontrarla. */}
        <View style={est.pie}>
          <Pressable
            onPress={confirmar}
            disabled={!tam || guardando}
            style={({ pressed }) => [
              est.btnListo,
              { backgroundColor: T.acentoRelleno },
              (!tam || guardando) && { opacity: 0.45 },
              pressed && { opacity: 0.85 },
            ]}
          >
            {guardando ? (
              <ActivityIndicator color={T.acentoTexto} />
            ) : (
              <Text style={[est.btnListoTxt, { color: T.acentoTexto }]}>
                Usar esta foto
              </Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

function crearEstilos(T: ReturnType<typeof useTema>["tema"]) {
  return StyleSheet.create({
    raiz: { flex: 1, backgroundColor: "transparent" },
    // Velo muy leve sobre el blur: asegura que el texto blanco y los
    // botones contrasten pase lo que pase detrás.
    velo: { backgroundColor: "#00000040" },
    cabecera: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 18,
      paddingVertical: 14,
    },
    titulo: { color: "#fff", fontSize: 15, fontWeight: "700" },
    cabeceraBtn: { color: "#fff", fontSize: 15, opacity: 0.85 },
    // Ancho aproximado de "Cancelar": equilibra la fila sin medir texto.
    huecoSimetrico: { width: 66 },
    zona: { flex: 1, alignItems: "center", justifyContent: "center" },
    marco: {
      width: LADO,
      height: LADO,
      borderRadius: 14,
      overflow: "hidden",
      borderWidth: 2,
      borderColor: "#ffffff66",
      // Sombra: despega el marco del fondo difuminado y deja claro que es
      // la zona que se va a quedar.
      shadowColor: "#000",
      shadowOpacity: 0.45,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
      // CRÍTICO: sin esto, la foto se dibuja pegada a la esquina superior
      // izquierda del marco en vez de centrada, y toda la cuenta de recorte
      // de arriba (que asume tx=ty=0 → centrada) sale desfasada.
      alignItems: "center",
      justifyContent: "center",
    },
    ayuda: {
      color: "#ffffffaa",
      textAlign: "center",
      fontSize: 12.5,
      marginTop: 18,
    },
    pie: {
      paddingHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 18,
    },
    btnListo: {
      borderRadius: T.radio,
      paddingVertical: 16,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 54,
    },
    btnListoTxt: {
      fontSize: 16,
      fontWeight: "800",
      letterSpacing: -0.2,
    },
    error: {
      color: "#ff6b6b",
      fontSize: 13,
      textAlign: "center",
      paddingHorizontal: 20,
    },
  });
}
