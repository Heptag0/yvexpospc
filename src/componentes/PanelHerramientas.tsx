// YvexPOS Móvil — Panel de herramientas.
//
// ---------------------------------------------------------------------------
// QUÉ HAY AQUÍ
// ---------------------------------------------------------------------------
//   · <PanelHerramientas>  El panel en sí: buscador, ancladas y grupos.
//                          Es IDÉNTICO en las dos variantes de entrada.
//   · <TiradorHerramientas> Variante A: barra fija abajo. Se abre tocándola
//                          o arrastrándola hacia arriba.
//   · <CajonHerramientas>  Variante B: bloque dentro de Inicio.
//
// Solo cambia CÓMO se entra. El contenido y el comportamiento son los mismos,
// así que elegir una u otra no obliga a rehacer nada.
//
// ---------------------------------------------------------------------------
// SOBRE EL GESTO Y EL MIEDO A QUE NADIE LO DESCUBRA
// ---------------------------------------------------------------------------
// El gesto NUNCA es la única entrada. El tirador es visible siempre, dice qué
// hace, y responde igual a un toque que a un arrastre hacia arriba.
//
// Quien desliza lo descubre y se siente listo. Quien toca ni se entera de que
// el gesto existe, y no lo necesita. Nadie se queda fuera. Un gesto oculto
// como única vía es una función que la mitad de los usuarios no encuentra
// jamás — y en una herramienta de trabajo eso no es elegancia, es un fallo.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
  Platform,
  Switch,
  Dimensions,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  type SharedValue,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTema } from "@/src/componentes/TemaProvider";
import { IconoUI } from "@/src/componentes/iconos";
import { Txt } from "@/src/componentes/ui";
import {
  GRUPOS_HERRAMIENTAS,
  Herramienta,
  IdHerramienta,
  MAX_ANCLADAS,
  TODAS_HERRAMIENTAS,
  alternarAnclada,
  buscarHerramientas,
  herramientaPorId,
  leerAncladas,
  leerAccesosOcultos,
  guardarAccesosOcultos,
} from "@/src/base/herramientas";
import {
  MapaEstados,
  EstadoHerramienta,
  estadosHerramientas,
} from "@/src/base/estadoHerramientas";

// ===========================================================================
// LA ANIMACIÓN DEL CAJÓN — por qué hay valores compartidos entre dos piezas
// ===========================================================================
//
// El tirador y la hoja son componentes distintos y viven en sitios distintos
// del árbol (uno fijo sobre las pestañas, la otra dentro de un Modal). Para
// que ARRASTRAR el primero mueva la segunda, los dos tienen que leer y
// escribir el mismo valor. De ahí este par de valores compartidos, que se
// crean una vez en Inicio y se pasan a las dos piezas.
//
// ---------------------------------------------------------------------------
// QUÉ ESTABA MAL ANTES
// ---------------------------------------------------------------------------
// El tirador no seguía al dedo. Su PanResponder solo miraba si habías
// superado 40 px y entonces llamaba a onAbrir():
//
//     if (!abierto.current && g.dy < -40) { abierto.current = true; onAbrir(); }
//
// O sea: un DETECTOR DE UMBRAL disfrazado de arrastre. El movimiento del dedo
// no movía nada, así que daba igual la animación que llevara la hoja después
// — siempre "aparecía". Un cajón del que no se puede tirar no es un cajón, es
// un botón con un gesto secreto.
//
// Ahora `progreso` va de 0 (cerrado) a 1 (abierto) y lo escribe el dedo,
// fotograma a fotograma, en el hilo de UI. La hoja no hace más que
// posicionarse según ese número: si sueltas a medias, se queda a medias y
// decide por velocidad.
//
// `gesto` distingue las dos formas de abrir. Sin él, al montarse el Modal la
// hoja no sabría si tiene que saltar sola a abierta (toque) o quedarse quieta
// esperando al dedo (arrastre), y el gesto pelearía contra su propio muelle.

export type CajonAnim = {
  /** 0 = cerrado, 1 = abierto. Lo escribe el dedo o un muelle. */
  progreso: SharedValue<number>;
  /** 1 mientras el dedo manda. Evita que la apertura por toque se dispare. */
  gesto: SharedValue<number>;
  /**
   * Distancia desde el borde SUPERIOR del tirador hasta el fondo de la
   * pantalla, medida en tiempo real.
   *
   * ⚠️ ESTO ARREGLA UN FALLO CONCRETO: la hoja arrancaba desde el borde
   * INFERIOR DE LA PANTALLA. Como el tirador mide unos 76 px, los primeros
   * 76 px de arrastre movían la hoja de "fuera de pantalla" a "justo detrás
   * del tirador", donde seguía sin verse. Ese recorrido muerto se sentía
   * exactamente como un tirón de lag seguido de una aparición desde abajo.
   *
   * Con la altura real, el reposo de la hoja queda con su borde superior
   * EXACTAMENTE donde está el borde superior del tirador. El primer píxel de
   * dedo es el primer píxel de movimiento visible, y la sensación es que
   * estás tirando del propio tirador, que es lo que parece que haces.
   *
   * OJO: no basta con el ALTO del tirador. El tirador no está pegado al
   * fondo de la pantalla — se apoya encima de la barra de pestañas. Usando
   * solo su alto quedarían todavía unos 68 px de recorrido muerto, que es el
   * mismo fallo en pequeño. Por eso se mide con measureInWindow y se resta
   * de la altura de la ventana: eso da la distancia real hasta el fondo,
   * barra de pestañas incluida.
   *
   * Y se mide en vez de codificarse porque depende de la densidad, de la
   * plataforma, del alto de la barra de pestañas y del ajuste de densidad
   * del usuario (T.esps sale del tema).
   */
  base: SharedValue<number>;
  /**
   * 0 = el reposo de la hoja es el borde del tirador (lo que quiere el
   * arrastre). 1 = la hoja está del todo fuera de pantalla.
   *
   * ⚠️ POR QUÉ HACEN FALTA DOS POSICIONES CERRADAS: al alinear el reposo con
   * el tirador, cerrar dejó de ser invisible. La hoja bajaba suave hasta el
   * tirador y AHÍ el Modal se desmontaba, así que el último tramo era un
   * corte seco a mitad de pantalla. Con el reposo antiguo (fuera de
   * pantalla) no se veía, pero entonces el arrastre tenía recorrido muerto.
   *
   * No se puede elegir una sola: el arrastre necesita reposo en el tirador y
   * el cierre necesita reposo fuera de pantalla. Así que el cierre anima las
   * DOS cosas a la vez y termina de verdad fuera del cuadro.
   */
  oculto: SharedValue<number>;
  /**
   * Alto REAL de la hoja, medido con onLayout.
   *
   * ⚠️ ESTO ARREGLA QUE EL CAJÓN SE VIERA CORTADO POR ABAJO. El alto se
   * calculaba como el 92 % de `Dimensions.get("window").height`. Con
   * `edgeToEdgeEnabled`, esa medida INCLUYE la barra de navegación del
   * sistema, pero el Modal no se dibuja ahí: la hoja quedaba más alta que el
   * hueco visible y su último tramo caía fuera de la pantalla, sin forma de
   * llegar a él. Por eso "Pedidos web" se veía a medias y no había manera de
   * bajar más.
   *
   * Ahora la hoja se declara con `maxHeight: "92%"` —que el propio Modal
   * resuelve contra su área real— y se MIDE. La animación usa esa medida, no
   * una cuenta hecha sobre otra referencia.
   */
  alto: SharedValue<number>;
};

/** Estimación mientras onLayout no ha medido. Se usa un solo fotograma. */
const BASE_ESTIMADA = 76;

/** Se llama UNA vez, en Inicio, y el resultado se pasa al tirador y al panel. */
export function useCajonAnim(): CajonAnim {
  const progreso = useSharedValue(0);
  const gesto = useSharedValue(0);
  const base = useSharedValue(BASE_ESTIMADA);
  const oculto = useSharedValue(1);
  const alto = useSharedValue(ALTO_ESTIMADO);
  return useMemo(
    () => ({ progreso, gesto, base, oculto, alto }),
    [progreso, gesto, base, oculto, alto]
  );
}

/** Alto de la hoja. Es también el recorrido del arrastre, así que tiene que
 *  ser el MISMO número en los dos sitios: con un 92% en CSS y otro número en
 *  la cuenta del gesto, el dedo y la hoja irían a distinta velocidad. */
/** Solo para el primer fotograma, antes de que onLayout mida de verdad. */
const ALTO_ESTIMADO = Math.round(Dimensions.get("window").height * 0.85);

/** Cuánto hay que subir para que al soltar se abra en vez de volver. Un
 *  tercio es suficiente: pedir la mitad obliga a un gesto largo e incómodo
 *  con el pulgar. Un lanzamiento rápido abre aunque no llegue. */
const UMBRAL_APERTURA = 0.3;
const VELOCIDAD_APERTURA = -800;

/**
 * A dónde va `progreso` para que la hoja quede FUERA DE PANTALLA del todo.
 *
 * ⚠️ NO ES 0. Cero es el reposo, y el reposo ahora está justo encima del
 * tirador — que es lo que hace que el arrastre empiece a moverse desde el
 * primer píxel. Pero al CERRAR eso deja la hoja tapando el tirador con su
 * asidero y su cabecera, y al desmontarse el Modal desaparecía de golpe. Ese
 * salto final era el "baja de golpe".
 *
 * Con este valor negativo, translateY = (1 − p) · (alto − base) queda
 * exactamente en `alto`: la hoja se va entera por debajo del borde de la
 * pantalla y el tirador reaparece antes de que nada se desmonte.
 */
function cerradoTotal(base: number, alto: number): number {
  "worklet";
  return -base / Math.max(1, alto - base);
}

// ===========================================================================
// Estrella de anclado
// ===========================================================================
//
// Glifo tipográfico, no emoji: hereda el color del tema y pesa lo mismo en
// Android y en iOS. Es el mismo símbolo que ya usa "Favorito" en el
// formulario de producto, así que el usuario no aprende dos lenguajes.
function Estrella({
  activa,
  onPress,
}: {
  activa: boolean;
  onPress: () => void;
}) {
  const { tema: T } = useTema();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={activa ? "Quitar de accesos" : "Anclar a accesos"}
      accessibilityState={{ selected: activa }}
      style={{
        minWidth: 44,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontSize: 18,
          color: activa ? T.acento : T.textoTenue,
          opacity: activa ? 1 : 0.55,
        }}
      >
        {activa ? "★" : "☆"}
      </Text>
    </Pressable>
  );
}

// ===========================================================================
// Fila de herramienta dentro del panel
// ===========================================================================
//
// ---------------------------------------------------------------------------
// QUÉ CAMBIÓ: la fila REPORTA en vez de describirse
// ---------------------------------------------------------------------------
// Antes cada fila mostraba su descripción fija ("Quién te debe, cuánto, y
// abona rápido"), la misma el primer día y el día trescientos. Doce filas
// idénticas en peso y en forma se leen como un menú de ajustes.
//
// Ahora, si la herramienta tiene un estado real, ese estado sustituye a la
// descripción: "$310.00 por cobrar de 3 clientes". Si NO lo tiene —porque
// nunca se ha usado— vuelve la descripción, que es justo lo que necesita
// quien todavía no sabe qué hay ahí. La misma pantalla enseña al principio e
// informa después, sin un interruptor que nadie encontraría.
//
// Las que piden atención (dinero por cobrar, productos por resurtir) llevan
// un filo de acento a la izquierda. Es la única jerarquía dentro del grupo:
// sin ella, doce filas con cifras vuelven a pesar todas lo mismo, que es el
// problema original con otro disfraz.
function FilaHerramienta({
  h,
  anclada,
  estado,
  badge,
  onAbrir,
  onAnclar,
}: {
  h: Herramienta;
  anclada: boolean;
  /** Estado real de la herramienta. Si falta, se usa la descripción. */
  estado?: EstadoHerramienta;
  /** Contador de pendientes (p. ej. pedidos web nuevos). Solo se pinta si > 0. */
  badge?: number;
  onAbrir: (id: IdHerramienta) => void;
  onAnclar: (id: IdHerramienta) => void;
}) {
  const { tema: T } = useTema();
  const atencion = Boolean(estado?.atencion);
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {/* Filo de atención. Ocupa sitio SIEMPRE (transparente cuando no
          aplica) para que los iconos de todas las filas queden en la misma
          columna: una sangría que baila fila a fila se nota más que el
          propio filo. */}
      <View
        style={{
          width: 3,
          alignSelf: "stretch",
          backgroundColor: atencion ? T.acento : "transparent",
        }}
      />
      <Pressable
        onPress={() => onAbrir(h.id)}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: T.esps.md,
          minHeight: T.filaAlto,
          paddingLeft: T.esps.lg - 3,
          paddingRight: T.esps.sm,
          paddingVertical: T.esps.md,
          backgroundColor: pressed ? T.superficie2 : "transparent",
        })}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: T.radioChico,
            backgroundColor: T.acentoSuave,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <IconoUI id={h.icono} size={19} color={T.acento} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt escala="cuerpo" fuerte lineas={1}>
            {h.titulo}
          </Txt>
          {estado ? (
            <Txt
              escala="pie"
              tono={atencion ? "acento" : "suave"}
              lineas={1}
              estilo={{ marginTop: 2 }}
            >
              {estado.texto}
            </Txt>
          ) : (
            <Txt escala="pie" tono="tenue" lineas={2} estilo={{ marginTop: 2 }}>
              {h.meta}
            </Txt>
          )}
        </View>
        {badge && badge > 0 ? (
          <View
            style={{
              backgroundColor: T.peligro,
              borderRadius: T.radioPildora,
              minWidth: 22,
              height: 22,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 6,
            }}
          >
            <Txt escala="micro" fuerte estilo={{ color: T.peligroTextoFuerte }}>
              {badge > 99 ? "99+" : String(badge)}
            </Txt>
          </View>
        ) : null}
      </Pressable>
      <View style={{ paddingRight: T.esps.sm }}>
        <Estrella activa={anclada} onPress={() => onAnclar(h.id)} />
      </View>
    </View>
  );
}

// ===========================================================================
// EL PANEL
// ===========================================================================
//
// ---------------------------------------------------------------------------
// LA ANIMACIÓN
// ---------------------------------------------------------------------------
// Era `animationType="slide"` sobre un Modal transparente. Eso desliza el
// MODAL ENTERO, velo negro incluido: la sombra entraba subiendo desde abajo
// como si fuera una cortina, en vez de aparecer donde ya estaba. Es el detalle
// que hacía que abrir Herramientas se sintiera barato.
//
// Ahora el Modal solo hace `fade` (el velo aparece donde le corresponde, sin
// moverse) y la hoja sube por su cuenta con un muelle de Reanimated. Es lo
// que hace cualquier hoja nativa, y cuesta dos valores compartidos.
export function PanelHerramientas({
  visible,
  onCerrar,
  onAbrir,
  visibleId,
  onAncladasCambio,
  onVisibilidadCambio,
  badges,
  estadosExtra,
  cajon,
}: {
  visible: boolean;
  onCerrar: () => void;
  onAbrir: (id: IdHerramienta) => void;
  /** Qué herramientas aplican al estado actual del negocio. */
  visibleId: (id: IdHerramienta) => boolean;
  onAncladasCambio?: (ids: IdHerramienta[]) => void;
  /**
   * Avisa a Inicio de que se mostraron u ocultaron los accesos.
   *
   * ⚠️ SIN ESTO HAY QUE RECARGAR A MANO. El panel es un Modal montado DENTRO
   * de Inicio, así que Inicio nunca pierde el foco mientras el panel está
   * abierto y su `useFocusEffect` no vuelve a dispararse al cerrarlo. El
   * interruptor guardaba bien la preferencia, pero Inicio seguía enseñando
   * su estado anterior hasta que se navegaba a otra pestaña y se volvía.
   */
  onVisibilidadCambio?: (ocultos: boolean) => void;
  /** Contadores de pendientes por herramienta (p. ej. pedidos web nuevos). */
  badges?: Partial<Record<IdHerramienta, number>>;
  /** Estados que NO se pueden calcular en local porque dependen del servidor
   *  (tienda en línea, pedidos web). Los inyecta quien ya los consultó, para
   *  no pedirlos dos veces ni bloquear la apertura del panel con la red. */
  estadosExtra?: MapaEstados;
  /** Valores compartidos con el tirador. Ver useCajonAnim(). */
  cajon: CajonAnim;
}) {
  const { tema: T } = useTema();
  const [busqueda, setBusqueda] = useState("");
  const [ancladas, setAncladas] = useState<IdHerramienta[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [estados, setEstados] = useState<MapaEstados>({});
  const [ocultos, setOcultos] = useState(false);

  const { progreso, gesto, base, oculto, alto } = cajon;
  // LA ÚLTIMA FILA QUEDABA CORTADA Y NO SE PODÍA BAJAR MÁS.
  //
  // Éste era el único modal grande de la app que no leía los márgenes del
  // sistema: los demás montan SafeAreaView, éste no. Con `edgeToEdgeEnabled`
  // el Modal se dibuja POR DEBAJO de la barra de navegación de Android, así
  // que los últimos ~48 px de la lista quedaban detrás de los botones —
  // visibles a medias y fuera de alcance, porque no hay scroll que valga
  // contra algo que está tapado por el sistema.
  //
  // El relleno inferior del scroll pasa a ser fijo MÁS el margen real del
  // aparato. En un teléfono con gestos ese margen es pequeño; con tres
  // botones es grande. Por eso no vale una constante.
  const insets = useSafeAreaInsets();
  // El contenido de la lista se pinta un fotograma DESPUÉS de que aparezca la
  // hoja. Montar el Modal con las doce filas de golpe costaba lo suficiente
  // como para que el primer tramo del arrastre se sintiera pegajoso. Durante
  // ese fotograma la hoja está aún prácticamente fuera de pantalla, así que
  // no se ve ningún hueco.
  const [contenido, setContenido] = useState(false);

  useEffect(() => {
    if (!visible) {
      setContenido(false);
      return;
    }
    const id = requestAnimationFrame(() => setContenido(true));
    return () => cancelAnimationFrame(id);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    // Si el Modal se montó porque el dedo empezó a tirar (gesto = 1), la hoja
    // NO se abre sola: ya la está moviendo el arrastre. Solo salta a abierta
    // cuando la apertura vino de un toque.
    // `oculto` ES UN INTERRUPTOR QUE NADIE APAGABA
    // ----------------------------------------------------------------------
    // Nacio con valor 1 y NINGUNA parte del proyecto lo escribia nunca, asi
    // que era constante. En el estilo de la hoja suma `oculto * base` al
    // translateY, de modo que incluso con progreso = 1 (abierta del todo) la
    // hoja quedaba empujada `base` pixeles hacia abajo: medía sus 92%, pero
    // su ultimo tramo caia fuera de la pantalla. De ahi que "Pedidos web"
    // saliera partido y con el icono invisible, y que ningun paddingBottom
    // lo arreglara — el contenido estaba dibujado donde no se ve.
    //
    // Se apaga en cuanto el panel se monta, SIN animar y antes que nada: si
    // la apertura vino de un arrastre, el dedo ya esta moviendo la hoja y un
    // desfase aqui se notaria durante todo el gesto.
    oculto.value = 0;

    if (gesto.value === 0) {
      // Se coloca fuera de pantalla ANTES de animar. Sin esto, una apertura
      // por toque justo después de un cierre arrancaría desde donde quedó el
      // valor anterior, y la hoja aparecería a media altura.
      progreso.value = cerradoTotal(base.value, alto.value);
      progreso.value = withSpring(1, { damping: 24, stiffness: 210, mass: 0.9 });
    }
  }, [visible, progreso, gesto, base, alto, oculto]);

  // El cierre lo anima ESTE componente y solo entonces avisa al padre para
  // que desmonte. Si el padre pusiera `visible = false` directamente, la hoja
  // desaparecería de golpe: bajar es tan parte del gesto como subir.
  const cerrar = useCallback(() => {
    progreso.value = withTiming(
      cerradoTotal(base.value, alto.value),
      { duration: 210 },
      (fin) => {
        "worklet";
        if (fin) {
          // Se restaura para que la proxima apertura arranque del mismo
          // estado que esta. El Modal ya no esta montado, asi que no mueve
          // nada visible.
          oculto.value = 1;
          runOnJS(onCerrar)();
        }
      }
    );
  }, [progreso, base, alto, oculto, onCerrar]);

  // En reposo la hoja se retira solo hasta dejar asomando lo que mide el
  // tirador, no hasta salirse de la pantalla. Ver el comentario de `base`.
  // Dos sumandos: lo que falta para estar abierta, más lo que falta para
  // estar del todo fuera de pantalla. Con progreso=0 y oculto=1 el resultado
  // es exactamente `alto.value`, es decir, la hoja entera fuera del cuadro.
  const estiloHoja = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          (1 - progreso.value) * (alto.value - base.value) +
          oculto.value * base.value,
      },
    ],
  }));
  // El velo se oscurece al mismo ritmo que sube la hoja. Antes entraba con el
  // Modal entero y se deslizaba con ella, como una cortina negra.
  const estiloVelo = useAnimatedStyle(() => ({
    opacity: progreso.value * 0.5,
  }));

  useEffect(() => {
    if (!visible) return;
    setBusqueda("");
    setAviso(null);
    leerAncladas().then(setAncladas);
    leerAccesosOcultos().then(setOcultos);
    // El panel se abre YA y los estados entran cuando llegan. Bloquear la
    // apertura con una decena de consultas sería cambiar información por
    // latencia justo en la pantalla que más se abre de pasada.
    estadosHerramientas().then(setEstados);
  }, [visible]);

  const anclar = useCallback(
    async (id: IdHerramienta) => {
      const r = await alternarAnclada(id);
      setAncladas(r.ancladas);
      onAncladasCambio?.(r.ancladas);
      // Al llegar al tope no se descarta nada en silencio: se explica.
      setAviso(
        r.lleno
          ? `Ya tienes ${MAX_ANCLADAS} accesos. Quita uno para anclar otro.`
          : null
      );
    },
    [onAncladasCambio]
  );

  const alternarVisibilidad = useCallback(
    async (mostrar: boolean) => {
      setOcultos(!mostrar);
      // Se avisa ANTES de esperar al guardado: Inicio se actualiza en el mismo
      // fotograma que el interruptor, y la escritura en almacenamiento va por
      // detrás. Si fallara, el estado en memoria y el guardado divergirían
      // hasta el siguiente arranque, que es un precio menor que una interfaz
      // que se queda quieta al tocarla.
      onVisibilidadCambio?.(!mostrar);
      await guardarAccesosOcultos(!mostrar);
    },
    [onVisibilidadCambio]
  );

  // Los estados locales se completan con los que dependen del servidor.
  const todosLosEstados = useMemo<MapaEstados>(
    () => ({ ...estados, ...(estadosExtra ?? {}) }),
    [estados, estadosExtra]
  );

  const resultados = useMemo(
    () => buscarHerramientas(busqueda).filter((h) => visibleId(h.id)),
    [busqueda, visibleId]
  );
  const buscando = busqueda.trim().length > 0;

  const listaAncladas = ancladas
    .map(herramientaPorId)
    .filter((h): h is Herramienta => Boolean(h) && visibleId(h!.id));

  const cuantas = TODAS_HERRAMIENTAS.filter((h) => visibleId(h.id)).length;

  return (
    <Modal
      visible={visible}
      onRequestClose={cerrar}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        {/* Toque fuera = cerrar. El velo deja ver que Inicio sigue detrás:
            es una hoja sobre la mesa, no otra pantalla. */}
        <Animated.View
          pointerEvents="none"
          style={[
            { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000" },
            estiloVelo,
          ]}
        />
        <Pressable
          onPress={cerrar}
          accessibilityLabel="Cerrar herramientas"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <Animated.View
          style={[
            {
              // Alto declarado como PORCENTAJE del área real del Modal, no
              // calculado sobre Dimensions: con edge-to-edge las dos medidas
              // no coinciden y la hoja se salía por abajo.
              maxHeight: "92%",
              flex: 1,
              backgroundColor: T.fondo,
              borderTopLeftRadius: T.radioGrande,
              borderTopRightRadius: T.radioGrande,
              overflow: "hidden",
            },
            estiloHoja,
          ]}
          // Medimos la hoja de verdad. Hasta que esto dispare, la animación
          // usa ALTO_ESTIMADO; después usa el alto real del área del Modal.
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0) alto.value = h;
          }}
        >
          {/* Asidero: comunica "esto se arrastra" sin escribirlo. */}
          <View style={{ alignItems: "center", paddingTop: T.esps.md }}>
            <View
              style={{
                width: 38,
                height: 4,
                borderRadius: 2,
                backgroundColor: T.bordeFuerte,
              }}
            />
          </View>

          {/* Cabecera. El "Cerrar" escrito se sustituye por una X en un botón
              redondo: la palabra ocupaba el ancho de tres caracteres del
              título y competía con él siendo la acción menos importante de
              la pantalla. */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              justifyContent: "space-between",
              paddingHorizontal: T.esp,
              paddingTop: T.esps.lg,
              paddingBottom: T.esps.md,
              gap: T.esps.md,
            }}
          >
            <View style={{ flex: 1 }}>
              <Txt escala="titulo" fuerte>
                Herramientas
              </Txt>
              <Txt escala="pie" tono="tenue" estilo={{ marginTop: 2 }}>
                {cuantas} para tu negocio
                {ancladas.length > 0 ? ` · ${ancladas.length} en Inicio` : ""}
              </Txt>
            </View>
            <Pressable
              onPress={cerrar}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Cerrar herramientas"
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: T.superficie2,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <IconoUI id="cerrar" size={17} color={T.textoSuave} />
            </Pressable>
          </View>

          {/* Buscador con lupa y botón de limpiar. Antes era un rectángulo
              gris con un placeholder: nada indicaba que fuera un buscador
              hasta leerlo, y una vez escrito había que borrar a mano. */}
          <View style={{ paddingHorizontal: T.esp, paddingBottom: T.esps.md }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: T.esps.sm,
                backgroundColor: T.superficie2,
                borderRadius: T.radio,
                paddingHorizontal: T.esps.md,
                minHeight: 48,
              }}
            >
              <IconoUI id="buscar" size={17} color={T.textoTenue} />
              <TextInput
                value={busqueda}
                onChangeText={setBusqueda}
                placeholder="Buscar: precio, fiado, sellos…"
                numberOfLines={1}
                placeholderTextColor={T.textoTenue}
                autoCorrect={false}
                returnKeyType="search"
                style={{
                  flex: 1,
                  paddingVertical: T.esps.md,
                  fontSize: T.tipo.cuerpo,
                  fontFamily: T.fuente.ui,
                  color: T.texto,
                }}
              />
              {buscando ? (
                <Pressable
                  onPress={() => setBusqueda("")}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Limpiar búsqueda"
                  style={{ minWidth: 28, minHeight: 28, alignItems: "center", justifyContent: "center" }}
                >
                  <IconoUI id="cerrar" size={15} color={T.textoTenue} />
                </Pressable>
              ) : null}
            </View>
          </View>

          {aviso ? (
            <View style={{ paddingHorizontal: T.esp, paddingBottom: T.esps.sm }}>
              <Txt escala="pie" tono="alerta">
                {aviso}
              </Txt>
            </View>
          ) : null}

          {/* `flex: 1` NO ES OPCIONAL AQUI — SIN EL, LA LISTA SE CORTA
              --------------------------------------------------------------
              La hoja que envuelve esto tiene la altura acotada (maxHeight
              92%). Un ScrollView SIN flex dentro de un contenedor acotado
              toma como altura la de su CONTENIDO: cree que cabe entero, no
              habilita recorrido, y el padre simplemente recorta lo que sobra.
              El resultado era exactamente el sintoma: la ultima herramienta
              ("Pedidos web") aparecia partida y no habia forma de bajar mas,
              por mucho paddingBottom que se le pusiera al contenido.
              Con `flex: 1` el ScrollView se queda con el hueco que dejan
              asidero, cabecera y buscador, descubre que su contenido es mas
              alto, y entonces si desplaza hasta el final. */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: T.esp,
              paddingBottom: T.esps.xxl * 2 + insets.bottom,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {!contenido ? null : buscando ? (
              resultados.length === 0 ? (
                <View style={{ paddingVertical: T.esps.xxl, alignItems: "center" }}>
                  <Txt escala="cuerpo" fuerte>
                    Nada con ese nombre
                  </Txt>
                  <Txt
                    escala="pie"
                    tono="suave"
                    estilo={{ textAlign: "center", marginTop: T.esps.xs }}
                  >
                    Prueba con lo que hace: “precio”, “compras”, “puntos”.
                  </Txt>
                </View>
              ) : (
                <Bloque>
                  {resultados.map((h) => (
                    <FilaHerramienta
                      key={h.id}
                      h={h}
                      anclada={ancladas.includes(h.id)}
                      estado={todosLosEstados[h.id]}
                      badge={badges?.[h.id]}
                      onAbrir={onAbrir}
                      onAnclar={anclar}
                    />
                  ))}
                </Bloque>
              )
            ) : (
              <>
                {listaAncladas.length > 0 ? (
                  <Seccion
                    titulo="Tus accesos"
                    desc="Toca la estrella para quitar uno."
                  >
                    <Bloque>
                      {/* LA VUELTA del "Ocultar" de Inicio.
                          Vive aquí, en la sección que es dueña del concepto y
                          a la que se llega desde el tirador que Inicio tiene
                          siempre a la vista. Sin esto, "Ocultar" era un
                          interruptor de un solo sentido: se tocaba una vez y
                          los accesos no volvían nunca. */}
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: T.esps.md,
                          minHeight: T.filaAlto,
                          paddingHorizontal: T.esps.lg,
                          paddingVertical: T.esps.md,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Txt escala="cuerpo" fuerte>
                            Mostrarlos en Inicio
                          </Txt>
                          <Txt escala="pie" tono="tenue" estilo={{ marginTop: 2 }}>
                            {ocultos
                              ? "Ahora mismo están ocultos en la pantalla de Inicio."
                              : "Aparecen bajo el turno, siempre en el mismo sitio."}
                          </Txt>
                        </View>
                        <Switch
                          value={!ocultos}
                          onValueChange={alternarVisibilidad}
                          trackColor={{ false: T.superficie3, true: T.acentoRelleno }}
                          thumbColor={T.superficie}
                          accessibilityLabel="Mostrar los accesos en Inicio"
                        />
                      </View>
                      {listaAncladas.map((h) => (
                        <FilaHerramienta
                          key={h.id}
                          h={h}
                          anclada
                          estado={todosLosEstados[h.id]}
                          badge={badges?.[h.id]}
                          onAbrir={onAbrir}
                          onAnclar={anclar}
                        />
                      ))}
                    </Bloque>
                  </Seccion>
                ) : (
                  <View
                    style={{
                      backgroundColor: T.acentoSuave,
                      borderRadius: T.radio,
                      padding: T.esps.lg,
                      marginBottom: T.esps.xl,
                    }}
                  >
                    <Txt escala="pie" fuerte>
                      Ancla lo que más uses
                    </Txt>
                    <Txt escala="pie" tono="suave" estilo={{ marginTop: 2 }}>
                      Toca la estrella de una herramienta y aparecerá en Inicio,
                      siempre en el mismo lugar. Hasta {MAX_ANCLADAS}.
                    </Txt>
                  </View>
                )}

                {GRUPOS_HERRAMIENTAS.map((g) => {
                  const items = g.items.filter((h) => visibleId(h.id));
                  if (items.length === 0) return null;
                  return (
                    <Seccion key={g.titulo} titulo={g.titulo} desc={g.desc}>
                      <Bloque>
                        {items.map((h) => (
                          <FilaHerramienta
                            key={h.id}
                            h={h}
                            anclada={ancladas.includes(h.id)}
                            estado={todosLosEstados[h.id]}
                            badge={badges?.[h.id]}
                            onAbrir={onAbrir}
                            onAnclar={anclar}
                          />
                        ))}
                      </Bloque>
                    </Seccion>
                  );
                })}
              </>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function Seccion({
  titulo,
  desc,
  children,
}: {
  titulo: string;
  desc?: string;
  children: React.ReactNode;
}) {
  const { tema: T } = useTema();
  return (
    <View style={{ marginBottom: T.esps.xl }}>
      <Txt escala="micro" tono="suave" fuerte mayus>
        {titulo}
      </Txt>
      {desc ? (
        <Txt escala="pie" tono="tenue" estilo={{ marginTop: 2, marginBottom: T.esps.md }}>
          {desc}
        </Txt>
      ) : (
        <View style={{ height: T.esps.md }} />
      )}
      {children}
    </View>
  );
}

function Bloque({ children }: { children: React.ReactNode }) {
  const { tema: T } = useTema();
  const hijos = Array.isArray(children) ? children.filter(Boolean) : [children];
  return (
    <View
      style={{
        backgroundColor: T.superficie,
        borderRadius: T.radio,
        overflow: "hidden",
      }}
    >
      {hijos.map((h, i) => (
        <View key={i}>
          {i > 0 ? (
            <View
              style={{
                height: StyleSheet.hairlineWidth,
                backgroundColor: T.borde,
                marginLeft: T.esps.lg + 34 + T.esps.md,
              }}
            />
          ) : null}
          {h}
        </View>
      ))}
    </View>
  );
}

// ===========================================================================
// VARIANTE A — Tirador deslizable, fijo sobre la barra de pestañas
// ===========================================================================
//
// Se abre tocándolo O tirando de él hacia arriba. Va fijo al borde inferior,
// justo encima de la barra de pestañas, así que está siempre a la vista y en
// la zona del pulgar sin robar un destino de navegación.
//
// ---------------------------------------------------------------------------
// EL ARRASTRE SIGUE AL DEDO — antes no lo hacía
// ---------------------------------------------------------------------------
// La versión anterior usaba PanResponder para detectar 40 px de recorrido y
// entonces llamaba a onAbrir(). El dedo no movía nada: era un botón con un
// gesto secreto, y por eso la hoja siempre "aparecía" en vez de subir.
//
// Ahora se usa Gesture.Pan de react-native-gesture-handler, que corre en el
// hilo de UI. En cuanto el gesto arranca se monta el Modal (con la hoja
// todavía fuera de pantalla, así que no se ve nada), y a partir de ahí cada
// fotograma escribe `progreso` con la posición real del dedo. Si sueltas a
// medio camino, la hoja se queda a medio camino y decide adónde ir según lo
// lejos que llegaste y lo rápido que ibas.
//
// `activeOffsetY([-10, 100000])` hace que el gesto SOLO se reclame hacia
// arriba: sin eso, el tirador se comería el scroll normal de Inicio.
// `failOffsetX` lo suelta si el movimiento se va de lado.
export function TiradorHerramientas({
  onAbrir,
  onCancelar,
  cajon,
}: {
  /** Monta el panel. Se llama al tocar y también al empezar a arrastrar. */
  onAbrir: () => void;
  /** Se llama si el arrastre se queda corto: hay que desmontar el panel que
   *  ya se había montado al empezar el gesto. */
  onCancelar: () => void;
  cajon: CajonAnim;
}) {
  const { tema: T } = useTema();
  const { progreso, gesto, base, oculto, alto } = cajon;
  // ComponentRef<typeof View> en vez de View a secas: es la forma que
  // funciona tanto con los tipos antiguos de React Native como con los
  // nuevos, donde View ya no es una clase con métodos de medición.
  const ref = useRef<ComponentRef<typeof View>>(null);

  /** Mide de dónde a dónde tiene que viajar la hoja. Se vuelve a llamar en
   *  cada onLayout: la barra de pestañas puede cambiar de alto (p. ej. al
   *  ocultarse Vender en modo monitor) y el recorrido cambiaría con ella. */
  const medir = useCallback(() => {
    const nodo = ref.current;
    if (!nodo) return;
    nodo.measureInWindow((_x, y) => {
      const altoVentana = Dimensions.get("window").height;
      const d = altoVentana - y;
      // Si la medida sale absurda (0, negativa o más de media pantalla) se
      // conserva la estimación: mejor un recorrido aproximado que una hoja
      // colocada en un sitio imposible.
      if (d > 20 && d < altoVentana * 0.5) base.value = d;
    });
  }, [base]);

  const arrastre = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-10, 100000])
        .failOffsetX([-25, 25])
        .onStart(() => {
          "worklet";
          gesto.value = 1;
          // 0 = reposo, con la hoja alineada al borde superior del tirador.
          // Ese es el punto del que el dedo empieza a tirar.
          progreso.value = 0;
          runOnJS(onAbrir)();
        })
        .onUpdate((e) => {
          "worklet";
          // El recorrido es el mismo que usa la hoja para colocarse: alto de
          // la hoja MENOS lo que ya asoma el tirador. Si aquí se dividiera
          // por el alto total a secas, el dedo y la hoja irían a distinta
          // velocidad y el arrastre se sentiría resbaladizo.
          const recorrido = Math.max(1, alto.value - base.value);
          const p = -e.translationY / recorrido;
          progreso.value = p < 0 ? 0 : p > 1 ? 1 : p;
        })
        .onEnd((e) => {
          "worklet";
          gesto.value = 0;
          if (progreso.value > UMBRAL_APERTURA || e.velocityY < VELOCIDAD_APERTURA) {
            progreso.value = withSpring(1, {
              damping: 24,
              stiffness: 210,
              mass: 0.9,
            });
          } else {
            // Igual que al cerrar: se va por DEBAJO del tirador, no se
            // queda encima esperando a que el Modal se desmonte de golpe.
            progreso.value = withTiming(
              cerradoTotal(base.value, alto.value),
              { duration: 190 },
              (fin) => {
                "worklet";
                if (fin) runOnJS(onCancelar)();
              }
            );
          }
        })
        .onFinalize(() => {
          "worklet";
          gesto.value = 0;
        }),
    [progreso, gesto, base, oculto, alto, onAbrir, onCancelar]
  );

  return (
    <GestureDetector gesture={arrastre}>
      <View
        ref={ref}
        // La hoja necesita saber desde dónde tiene que salir. Ver `base`.
        onLayout={medir}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: T.superficie,
          borderTopLeftRadius: T.radioGrande,
          borderTopRightRadius: T.radioGrande,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: T.borde,
          paddingTop: T.esps.sm,
          paddingBottom: Platform.OS === "ios" ? T.esps.lg : T.esps.md,
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -4 },
          elevation: 12,
        }}
      >
        {/* Asidero: la señal universal de "esto sube". */}
        <View style={{ alignItems: "center", marginBottom: T.esps.sm }}>
          <View
            style={{
              width: 38,
              height: 4,
              borderRadius: 2,
              backgroundColor: T.bordeFuerte,
            }}
          />
        </View>
        <Pressable
          onPress={onAbrir}
          accessibilityRole="button"
          accessibilityLabel="Abrir herramientas"
          accessibilityHint="También puedes deslizar hacia arriba"
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: T.esps.sm,
            minHeight: 44,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <IconoUI id="ajustes" size={17} color={T.acento} />
          <Txt escala="cuerpo" tono="acento" fuerte>
            Herramientas
          </Txt>
        </Pressable>
      </View>
    </GestureDetector>
  );
}

// ===========================================================================
// VARIANTE B — Cajón: bloque dentro del cuerpo de Inicio
// ===========================================================================
//
// Sin gestos, imposible de no ver, y se desplaza con el resto del contenido.
// A cambio deja de estar siempre a mano: si el usuario bajó, tiene que subir.
export function CajonHerramientas({
  onAbrir,
  cuantas,
}: {
  onAbrir: () => void;
  /** Cuántas herramientas hay disponibles, para dar peso al bloque. */
  cuantas: number;
}) {
  const { tema: T } = useTema();
  return (
    <Pressable
      onPress={onAbrir}
      accessibilityRole="button"
      accessibilityLabel="Abrir herramientas"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: T.esps.lg,
        backgroundColor: T.superficie,
        borderRadius: T.radio,
        padding: T.esps.lg,
        minHeight: 72,
        opacity: pressed ? 0.9 : 1,
        shadowColor: T.acento,
        shadowOpacity: T.esClaro ? 0.12 : 0.22,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: T.radioChico,
          backgroundColor: T.acentoSuave,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconoUI id="ajustes" size={22} color={T.acento} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt escala="cuerpo" fuerte>
          Herramientas
        </Txt>
        <Txt escala="pie" tono="suave" estilo={{ marginTop: 2 }}>
          {cuantas} herramientas para tu negocio
        </Txt>
      </View>
      <Txt escala="titulo" tono="tenue">
        ›
      </Txt>
    </Pressable>
  );
}
