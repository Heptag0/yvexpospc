// YvexPOS Móvil — Componentes de interfaz compartidos.
//
// ---------------------------------------------------------------------------
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------------------------------------------------------
// Antes aquí solo vivían CONTROLES (botón, banner, insignia, campo). Faltaba
// lo otro: la COMPOSICIÓN. Sin primitivas de layout, cada pantalla y cada
// modal inventaba su propio ritmo con estilos en línea — 9 accesos copiados a
// mano en Inicio, 70 estilos únicos en un solo archivo, 14 tamaños de fuente
// distintos. Ésa es la razón real de que la app "no fluyera": el ritmo se
// reinventaba en cada archivo.
//
// ---------------------------------------------------------------------------
// LAS TRES SUPERFICIES — no hay una cuarta
// ---------------------------------------------------------------------------
//   1. LIENZO  (<Pantalla>)  El fondo. No lleva nada encima por sí mismo.
//   2. GRUPO   (<Grupo> + <Fila>)  Filas relacionadas dentro de UN bloque con
//      separadores finos, como renglones de libreta. NO son tarjetas sueltas.
//   3. LÁMINA  (<Lamina>)  La superficie protagonista. UNA POR PANTALLA.
//      Lleva el tratamiento "con luz": la marca de agua del producto.
//
// Si algo no encaja en las tres, la respuesta casi siempre es que no debería
// existir esa jerarquía, no que haga falta una superficie nueva.
//
// ---------------------------------------------------------------------------
// REGLAS
// ---------------------------------------------------------------------------
// · Ningún color, tamaño de fuente ni separación se escribe a mano en una
//   pantalla. Todo sale de useTema().
// · Todo monto de dinero se pinta con <Monto>. Sin excepción.
// · Ningún Alert nativo. Se usa <Hoja>.
// · Todo elemento tocable mide 44pt como mínimo.

import { ReactNode, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Modal,
  Platform,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { useTema } from "@/src/componentes/TemaProvider";

type Tema = ReturnType<typeof useTema>["tema"];

// ===========================================================================
// TEXTO — el único camino a la escala tipográfica
// ===========================================================================
//
// Cinco tamaños, dos pesos. Si una pantalla necesita un sexto tamaño, casi
// siempre significa que la jerarquía está mal pensada, no que falte un token.

type Tono = "principal" | "suave" | "tenue" | "acento" | "exito" | "peligro" | "alerta";
type Escala = "micro" | "pie" | "cuerpo" | "titulo" | "protagonista";

function colorDeTono(T: Tema, tono: Tono): string {
  switch (tono) {
    case "suave": return T.textoSuave;
    case "tenue": return T.textoTenue;
    case "acento": return T.acento;
    case "exito": return T.exitoTexto;
    case "peligro": return T.peligroTexto;
    case "alerta": return T.alertaTexto;
    default: return T.texto;
  }
}

export function Txt({
  children,
  escala = "cuerpo",
  tono = "principal",
  fuerte = false,
  mayus = false,
  lineas,
  estilo,
}: {
  children: ReactNode;
  escala?: Escala;
  tono?: Tono;
  fuerte?: boolean;
  /** Etiquetas de sección en versalitas. Solo con escala "micro". */
  mayus?: boolean;
  lineas?: number;
  estilo?: TextStyle | TextStyle[];
}) {
  const { tema: T } = useTema();
  // Interletraje: las versalitas se abren, los tamaños grandes se cierran.
  // Es lo que hace que un título grande no parezca "texto normal estirado".
  const espaciado =
    mayus ? 0.8 : escala === "protagonista" ? -1.5 : escala === "titulo" ? -0.4 : 0;
  const base: TextStyle = {
    color: colorDeTono(T, tono),
    fontSize: T.tipo[escala],
    fontWeight: (fuerte ? T.peso.fuerte : T.peso.normal) as TextStyle["fontWeight"],
    fontFamily: fuerte ? T.fuente.uiFuerte : T.fuente.ui,
    letterSpacing: espaciado,
    textTransform: mayus ? "uppercase" : undefined,
  };
  return (
    <Text numberOfLines={lineas} style={[base, estilo]}>
      {children}
    </Text>
  );
}

// ===========================================================================
// MONTO — el único camino para pintar dinero
// ===========================================================================
//
// IBM Plex Mono con numeral tabular, SIEMPRE. Los montos son lo único que el
// tendero realmente lee: tienen que verse impresos, alineados y contables.
// Las columnas de precios cuadran solo si nadie se salta este componente.
//
// Recibe el texto YA FORMATEADO (de src/base/formato.ts) a propósito: este
// componente no duplica lógica de formato ni de moneda, solo tipografía.
export function Monto({
  texto,
  escala = "cuerpo",
  tono = "principal",
  fuerte = true,
  estilo,
}: {
  texto: string;
  escala?: Escala;
  tono?: Tono;
  fuerte?: boolean;
  estilo?: TextStyle | TextStyle[];
}) {
  const { tema: T } = useTema();
  return (
    <Text
      style={[
        {
          color: colorDeTono(T, tono),
          fontSize: T.tipo[escala],
          fontWeight: (fuerte ? T.peso.fuerte : T.peso.normal) as TextStyle["fontWeight"],
          fontFamily: fuerte ? T.fuente.numFuerte : T.fuente.num,
          fontVariant: ["tabular-nums"],
          letterSpacing: escala === "protagonista" ? -1.5 : 0,
        },
        estilo,
      ]}
    >
      {texto}
    </Text>
  );
}

// ===========================================================================
// PANTALLA — el lienzo
// ===========================================================================
export function Pantalla({
  children,
  scroll = true,
  padding = true,
  refresco,
}: {
  children: ReactNode;
  scroll?: boolean;
  padding?: boolean;
  /** Se cuela tal cual al ScrollView (RefreshControl, por ejemplo). */
  refresco?: ReactNode;
}) {
  const { tema: T } = useTema();
  const est: ViewStyle = {
    flex: 1,
    backgroundColor: T.fondo,
  };
  const inner: ViewStyle = {
    paddingHorizontal: padding ? T.esp : 0,
    // Aire al final para que el último elemento no quede pegado a la tab bar.
    paddingBottom: T.esps.xxl,
  };
  if (!scroll) {
    return <View style={[est, inner]}>{children}</View>;
  }
  return (
    <View style={est}>
      <ScrollView
        contentContainerStyle={inner}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={refresco as never}
      >
        {children}
      </ScrollView>
    </View>
  );
}

// ===========================================================================
// ENCABEZADO — título de pantalla
// ===========================================================================
//
// El wordmark "YvexPOS" se repetía en CADA pestaña, robando altura vertical
// que en un punto de venta vale oro: cada píxel de alto es una fila más de
// producto visible. La marca vive en el ícono de la app y en el arranque, no
// encima de cada pantalla.
export function Encabezado({
  titulo,
  meta,
  acciones,
}: {
  titulo: string;
  meta?: string;
  /** Botones de la derecha (buscar, escanear...). */
  acciones?: ReactNode;
}) {
  const { tema: T } = useTema();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
        paddingTop: T.esps.md,
        paddingBottom: T.esps.lg,
        gap: T.esps.md,
      }}
    >
      <View style={{ flex: 1 }}>
        {meta ? (
          <Txt escala="pie" tono="suave" lineas={1}>
            {meta}
          </Txt>
        ) : null}
        <Txt escala="titulo" fuerte lineas={1}>
          {titulo}
        </Txt>
      </View>
      {acciones ? (
        <View style={{ flexDirection: "row", gap: T.esps.sm }}>{acciones}</View>
      ) : null}
    </View>
  );
}

// ===========================================================================
// SECCION — etiqueta + contenido, con el mismo aire siempre
// ===========================================================================
export function Seccion({
  titulo,
  accion,
  children,
}: {
  titulo?: string;
  /** Enlace opcional a la derecha del título ("Ver todo"). */
  accion?: { texto: string; onPress: () => void };
  children: ReactNode;
}) {
  const { tema: T } = useTema();
  return (
    <View style={{ marginBottom: T.esps.xl }}>
      {titulo ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: T.esps.md,
          }}
        >
          <Txt escala="micro" tono="suave" fuerte mayus>
            {titulo}
          </Txt>
          {accion ? (
            <Pressable onPress={accion.onPress} hitSlop={10}>
              <Txt escala="pie" tono="acento" fuerte>
                {accion.texto}
              </Txt>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

// ===========================================================================
// LAMINA — la superficie protagonista, con el tratamiento "con luz"
// ===========================================================================
//
// UNA por pantalla. Es la métrica que importa: lo vendido hoy, el total del
// ticket, el efectivo del corte. El resplandor entra por el borde superior y
// se apaga hacia abajo — la firma visual que recorre todo el producto.
//
// Si en una pantalla hay dos láminas, ninguna es protagonista y la jerarquía
// se pierde: es exactamente lo que pasaba antes, cuando la tarjeta de
// "Vendido hoy" tenía el mismo peso visual que "Departamentos".
export function Lamina({
  children,
  onPress,
}: {
  children: ReactNode;
  onPress?: () => void;
}) {
  const { tema: T } = useTema();
  const cuerpo = (
    <View
      style={{
        backgroundColor: T.superficie,
        borderRadius: T.radioGrande,
        paddingHorizontal: T.esps.xl,
        paddingVertical: T.esps.xl,
        overflow: "hidden",
        // Sombra tintada al acento, nunca gris neutro sobre fondo de color.
        shadowColor: T.acento,
        shadowOpacity: T.esClaro ? 0.16 : 0.3,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 6 },
        elevation: 4,
      }}
    >
      {/* La luz: filo de acento en el borde superior. */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          backgroundColor: T.acento,
        }}
      />
      {/* Halo que baja del filo y se apaga. Sin gradientes: capas de opacidad
          decreciente. Si algún día entra expo-linear-gradient, esto se
          sustituye por un degradado real y se ve aún mejor. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 3,
          left: 0,
          right: 0,
          height: 28,
          backgroundColor: T.acentoSuave,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 3,
          left: 0,
          right: 0,
          height: 12,
          backgroundColor: T.acentoSuave,
        }}
      />
      {children}
    </View>
  );
  if (!onPress) return cuerpo;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.92 } : undefined)}
    >
      {cuerpo}
    </Pressable>
  );
}

// ===========================================================================
// GRUPO + FILA — el renglón de libreta
// ===========================================================================
//
// Esto reemplaza los 9 bloques Pressable copiados a mano de "Tu negocio", y
// es la base sobre la que después se arma la caja de herramientas: cuando las
// filas son un componente y no copias, reordenarlas o agruparlas cuesta una
// línea, no nueve bloques.
export function Grupo({ children }: { children: ReactNode }) {
  const { tema: T } = useTema();
  const hijos = Array.isArray(children) ? children.filter(Boolean) : [children];
  return (
    <View
      style={{
        backgroundColor: T.superficie,
        borderRadius: T.radio,
        overflow: "hidden",
        borderWidth: T.bordes === "rectos" ? StyleSheet.hairlineWidth : 0,
        borderColor: T.borde,
      }}
    >
      {hijos.map((h, i) => (
        <View key={i}>
          {i > 0 ? (
            <View
              style={{
                height: StyleSheet.hairlineWidth,
                backgroundColor: T.borde,
                // El separador arranca donde arranca el texto, no en el filo:
                // así la lista se lee como una columna, no como cajas apiladas.
                marginLeft: T.esps.lg,
              }}
            />
          ) : null}
          {h}
        </View>
      ))}
    </View>
  );
}

export function Fila({
  titulo,
  meta,
  icono,
  valor,
  onPress,
  flecha,
  destacado = false,
}: {
  titulo: string;
  meta?: string;
  icono?: ReactNode;
  /** Lado derecho: normalmente un <Monto> o una <Insignia>. */
  valor?: ReactNode;
  onPress?: () => void;
  flecha?: boolean;
  destacado?: boolean;
}) {
  const { tema: T } = useTema();
  const muestraFlecha = flecha ?? Boolean(onPress);
  const contenido = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: T.filaAlto,
        paddingHorizontal: T.esps.lg,
        paddingVertical: T.esps.md,
        gap: T.esps.md,
        backgroundColor: destacado ? T.acentoSuave : "transparent",
      }}
    >
      {icono ? <View style={{ width: 24, alignItems: "center" }}>{icono}</View> : null}
      <View style={{ flex: 1 }}>
        <Txt escala="cuerpo" fuerte lineas={1}>
          {titulo}
        </Txt>
        {meta ? (
          <Txt escala="pie" tono="suave" lineas={2} estilo={{ marginTop: 2 }}>
            {meta}
          </Txt>
        ) : null}
      </View>
      {valor}
      {muestraFlecha ? (
        <Txt escala="cuerpo" tono="tenue" estilo={{ marginLeft: 2 }}>
          ›
        </Txt>
      ) : null}
    </View>
  );
  if (!onPress) return contenido;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) =>
        pressed ? { backgroundColor: T.superficie2 } : undefined
      }
    >
      {contenido}
    </Pressable>
  );
}

// ===========================================================================
// VACIO — un estado vacío siempre ofrece una salida
// ===========================================================================
//
// "Sin ventas que graficar." a secas es una pared. Un estado vacío es la
// primera pantalla que ve un cliente nuevo: tiene que explicar y ofrecer el
// siguiente paso.
export function Vacio({
  titulo,
  texto,
  accion,
  icono,
}: {
  titulo: string;
  texto?: string;
  accion?: { texto: string; onPress: () => void };
  icono?: ReactNode;
}) {
  const { tema: T } = useTema();
  return (
    <View
      style={{
        alignItems: "center",
        paddingVertical: T.esps.xxl,
        paddingHorizontal: T.esps.xl,
        gap: T.esps.sm,
      }}
    >
      {icono ? <View style={{ marginBottom: T.esps.xs }}>{icono}</View> : null}
      <Txt escala="cuerpo" fuerte>
        {titulo}
      </Txt>
      {texto ? (
        <Txt escala="pie" tono="suave" estilo={{ textAlign: "center" }}>
          {texto}
        </Txt>
      ) : null}
      {accion ? (
        <View style={{ marginTop: T.esps.md, alignSelf: "stretch" }}>
          <Boton titulo={accion.texto} onPress={accion.onPress} />
        </View>
      ) : null}
    </View>
  );
}

// ===========================================================================
// HOJA — la única cáscara de modal. Adiós Alert nativo.
// ===========================================================================
//
// El Alert de Android aparecía justo en el momento más importante del día —
// el corte del turno — con su texto azul del sistema y sus mayúsculas de
// Material. En ese instante la app dejaba de ser tu app.
//
// `tipo`:
//   · "hoja"     sube desde abajo. Para acciones y formularios cortos.
//                Es el patrón que ya funcionaba bien en ModalMovimientoCaja.
//   · "completa" ocupa la pantalla. Para flujos largos y para el corte.
export function Hoja({
  visible,
  onCerrar,
  titulo,
  tipo = "hoja",
  children,
  pie,
}: {
  visible: boolean;
  onCerrar: () => void;
  titulo?: string;
  tipo?: "hoja" | "completa";
  children: ReactNode;
  /** Acciones fijas abajo, en la zona del pulgar. */
  pie?: ReactNode;
}) {
  const { tema: T } = useTema();
  const esHoja = tipo === "hoja";
  return (
    <Modal
      visible={visible}
      onRequestClose={onCerrar}
      transparent={esHoja}
      animationType="slide"
      presentationStyle={esHoja ? "overFullScreen" : "fullScreen"}
    >
      {esHoja ? (
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Pressable
            onPress={onCerrar}
            style={{
              position: "absolute",
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: "rgba(0,0,0,0.45)",
            }}
          />
          <View
            style={{
              backgroundColor: T.fondo,
              borderTopLeftRadius: T.radioGrande,
              borderTopRightRadius: T.radioGrande,
              paddingHorizontal: T.esp,
              paddingBottom: T.esps.xxl,
              paddingTop: T.esps.md,
              maxHeight: "88%",
            }}
          >
            {/* Asidero: comunica "esto se arrastra" sin escribirlo. */}
            <View
              style={{
                alignSelf: "center",
                width: 38,
                height: 4,
                borderRadius: 2,
                backgroundColor: T.bordeFuerte,
                marginBottom: T.esps.lg,
              }}
            />
            {titulo ? (
              <View style={{ marginBottom: T.esps.md }}>
                <Txt escala="titulo" fuerte>
                  {titulo}
                </Txt>
              </View>
            ) : null}
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
            {pie ? <View style={{ marginTop: T.esps.lg }}>{pie}</View> : null}
          </View>
        </View>
      ) : (
        <View style={{ flex: 1, backgroundColor: T.fondo }}>
          <CabeceraModal titulo={titulo ?? ""} izquierda="Cerrar" onIzquierda={onCerrar} />
          <ScrollView
            contentContainerStyle={{
              padding: T.esp,
              paddingBottom: T.esps.xxl,
            }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          {pie ? (
            <View
              style={{
                padding: T.esp,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: T.borde,
                backgroundColor: T.superficie,
              }}
            >
              {pie}
            </View>
          ) : null}
        </View>
      )}
    </Modal>
  );
}

// ===========================================================================
// Botón primario (acento de marca), secundario, peligro y fantasma.
// ===========================================================================
export function Boton({
  titulo,
  onPress,
  tipo = "primario",
  cargando = false,
  deshabilitado = false,
  chico = false,
}: {
  titulo: string;
  onPress: () => void;
  tipo?: "primario" | "secundario" | "peligro" | "fantasma";
  cargando?: boolean;
  deshabilitado?: boolean;
  chico?: boolean;
}) {
  const { tema: T } = useTema();
  const eb = useMemo(() => crearEstilosBoton(T), [T]);
  const off = deshabilitado || cargando;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: cargando }}
      style={({ pressed }) => [
        eb.base,
        chico && eb.chico,
        tipo === "primario" && eb.primario,
        tipo === "secundario" && eb.secundario,
        tipo === "peligro" && eb.peligro,
        tipo === "fantasma" && eb.fantasma,
        pressed && !off && { opacity: 0.82, transform: [{ scale: 0.99 }] },
        off && { opacity: 0.45 },
      ]}
    >
      {cargando ? (
        <ActivityIndicator color={T.acentoTexto} size="small" />
      ) : (
        <Text
          style={[
            eb.txt,
            chico && eb.txtChico,
            tipo === "secundario" && { color: T.texto },
            tipo === "peligro" && { color: T.peligroTexto },
            // Antes: T.turquesa — el lila fantasma. Ahora el acento real.
            tipo === "fantasma" && { color: T.acento },
          ]}
        >
          {titulo}
        </Text>
      )}
    </Pressable>
  );
}

function crearEstilosBoton(T: Tema) {
  return StyleSheet.create({
    base: {
      borderRadius: T.radio,
      paddingVertical: 14,
      paddingHorizontal: 18,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 52,
    },
    chico: {
      paddingVertical: 9,
      minHeight: 44, // 44 es el mínimo tocable accesible. Antes eran 38.
      paddingHorizontal: 14,
      borderRadius: T.radioChico + 2,
    },
    primario: {
      // Relleno resuelto por luminosidad del tema: garantiza que la etiqueta
      // encima siempre pase contraste, en los 7 temas y con los 9 acentos.
      backgroundColor: T.acentoRelleno,
      shadowColor: T.acento,
      shadowOpacity: 0.28,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    secundario: {
      backgroundColor: T.superficie2,
      borderWidth: 1,
      borderColor: T.bordeFuerte,
    },
    peligro: {
      backgroundColor: T.peligroSuave,
      borderWidth: 1,
      borderColor: T.peligro,
    },
    fantasma: { backgroundColor: "transparent" },
    txt: {
      color: T.acentoTexto,
      fontSize: T.tipo.cuerpo,
      fontWeight: T.peso.fuerte as TextStyle["fontWeight"],
      fontFamily: T.fuente.uiFuerte,
      letterSpacing: 0.2,
    },
    txtChico: { fontSize: T.tipo.pie },
  });
}

// ===========================================================================
// Banner de error / éxito — SIEMPRE legible.
// ===========================================================================
export function Banner({
  texto,
  tipo = "error",
}: {
  texto: string;
  tipo?: "error" | "exito" | "info" | "alerta";
}) {
  const { tema: T } = useTema();
  const ebn = useMemo(() => crearEstilosBanner(T), [T]);
  if (!texto) return null;
  return (
    <View
      style={[
        ebn.base,
        tipo === "error" && { backgroundColor: T.peligroSuave, borderColor: T.peligro },
        tipo === "exito" && { backgroundColor: T.exitoSuave, borderColor: T.exito },
        tipo === "alerta" && { backgroundColor: T.alertaSuave, borderColor: T.alerta },
        tipo === "info" && { backgroundColor: T.acentoSuave, borderColor: T.acentoBorde },
      ]}
    >
      <Text
        style={[
          ebn.txt,
          tipo === "error" && { color: T.peligroTexto },
          tipo === "exito" && { color: T.exitoTexto },
          tipo === "alerta" && { color: T.alertaTexto },
          tipo === "info" && { color: T.texto },
        ]}
      >
        {texto}
      </Text>
    </View>
  );
}

function crearEstilosBanner(T: Tema) {
  return StyleSheet.create({
    base: {
      borderRadius: T.radioChico + 2,
      borderWidth: 1,
      paddingVertical: 12,
      paddingHorizontal: 16,
      marginBottom: 14,
    },
    txt: {
      fontSize: T.tipo.pie,
      lineHeight: 20,
      fontWeight: T.peso.normal as TextStyle["fontWeight"],
      fontFamily: T.fuente.ui,
    },
  });
}

// ===========================================================================
// Insignia (badge) — para "KIT", "sin control", contadores.
// ===========================================================================
export function Insignia({ texto, color }: { texto: string; color?: string }) {
  const { tema: T } = useTema();
  const c = color ?? T.acento;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: c,
        borderRadius: T.radioPildora,
        paddingHorizontal: 8,
        paddingVertical: 2,
        alignSelf: "flex-start",
      }}
    >
      <Text
        style={{
          color: c,
          fontSize: T.tipo.micro,
          fontWeight: T.peso.fuerte as TextStyle["fontWeight"],
          fontFamily: T.fuente.uiFuerte,
          letterSpacing: 0.8,
        }}
      >
        {texto}
      </Text>
    </View>
  );
}

// ===========================================================================
// Cabecera de modal estándar: Cancelar · Título · Acción.
// ===========================================================================
export function CabeceraModal({
  titulo,
  izquierda = "Cancelar",
  derecha,
  onIzquierda,
  onDerecha,
  derechaCargando = false,
}: {
  titulo: string;
  izquierda?: string;
  derecha?: string;
  onIzquierda: () => void;
  onDerecha?: () => void;
  derechaCargando?: boolean;
}) {
  const { tema: T } = useTema();
  const ec = useMemo(() => crearEstilosCabecera(T), [T]);
  return (
    <View style={ec.base}>
      <Pressable onPress={onIzquierda} hitSlop={12} style={ec.lado}>
        <Text style={ec.izq}>{izquierda}</Text>
      </Pressable>
      <Text style={ec.titulo} numberOfLines={1}>
        {titulo}
      </Text>
      <Pressable
        onPress={onDerecha}
        disabled={!onDerecha || derechaCargando}
        hitSlop={12}
        style={[ec.lado, { alignItems: "flex-end" }]}
      >
        {derechaCargando ? (
          <ActivityIndicator color={T.acento} size="small" />
        ) : derecha ? (
          <Text style={ec.der}>{derecha}</Text>
        ) : null}
      </Pressable>
    </View>
  );
}

function crearEstilosCabecera(T: Tema) {
  return StyleSheet.create({
    base: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      // En Android el modal arranca bajo la barra de estado; en iOS no.
      paddingTop: Platform.OS === "android" ? 16 : 13,
      paddingBottom: 13,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: T.borde,
      backgroundColor: T.fondo,
    },
    lado: { width: 82, minHeight: 44, justifyContent: "center" },
    izq: {
      color: T.textoSuave,
      fontSize: T.tipo.cuerpo,
      fontFamily: T.fuente.ui,
    },
    // Antes: T.turquesa. Éste era el "Guardar" y "+ Nuevo" morados.
    der: {
      color: T.acento,
      fontSize: T.tipo.cuerpo,
      fontWeight: T.peso.fuerte as TextStyle["fontWeight"],
      fontFamily: T.fuente.uiFuerte,
      textAlign: "right",
    },
    titulo: {
      flex: 1,
      textAlign: "center",
      color: T.texto,
      fontSize: T.tipo.cuerpo,
      fontWeight: T.peso.fuerte as TextStyle["fontWeight"],
      fontFamily: T.fuente.uiFuerte,
      letterSpacing: -0.3,
    },
  });
}

// ===========================================================================
// Campo con etiqueta (envoltorio estándar de formularios).
// ===========================================================================
export function Campo({
  label,
  children,
  flex,
  ayuda,
}: {
  label: string;
  children: ReactNode;
  flex?: boolean;
  ayuda?: string;
}) {
  const { tema: T } = useTema();
  const ecp = useMemo(() => crearEstilosCampo(T), [T]);
  return (
    <View style={[ecp.campo, flex && { flex: 1 }]}>
      <Text style={ecp.label}>{label}</Text>
      {children}
      {ayuda ? <Text style={ecp.ayuda}>{ayuda}</Text> : null}
    </View>
  );
}

function crearEstilosCampo(T: Tema) {
  return StyleSheet.create({
    campo: { marginBottom: 18 },
    label: {
      color: T.textoSuave,
      fontSize: T.tipo.micro,
      fontWeight: T.peso.fuerte as TextStyle["fontWeight"],
      fontFamily: T.fuente.uiFuerte,
      marginBottom: 7,
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    ayuda: {
      color: T.textoTenue,
      fontSize: T.tipo.pie,
      fontFamily: T.fuente.ui,
      marginTop: 5,
    },
  });
}

// Estilo compartido de input (lo usan las pantallas directamente).
export function useEstiloInput() {
  const { tema: T } = useTema();
  return useMemo(
    () => ({
      backgroundColor: T.superficie2,
      borderRadius: T.radioChico + 2,
      paddingHorizontal: 14,
      paddingVertical: 13,
      fontSize: T.tipo.cuerpo,
      fontFamily: T.fuente.ui,
      color: T.texto,
      borderWidth: 1,
      borderColor: T.borde,
      minHeight: 48,
    }),
    [T]
  );
}

/** Igual que useEstiloInput pero para capturar dinero: Plex Mono tabular. */
export function useEstiloInputMonto() {
  const { tema: T } = useTema();
  const base = useEstiloInput();
  return useMemo(
    () => ({
      ...base,
      fontFamily: T.fuente.numFuerte,
      fontWeight: T.peso.fuerte as TextStyle["fontWeight"],
      fontSize: T.tipo.titulo,
      textAlign: "center" as const,
      fontVariant: ["tabular-nums"] as const,
    }),
    [base, T]
  );
}
