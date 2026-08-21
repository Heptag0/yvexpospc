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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
  PanResponder,
  Platform,
} from "react-native";
import { useTema } from "@/src/componentes/TemaProvider";
import { IconoUI } from "@/src/componentes/iconos";
import { Txt } from "@/src/componentes/ui";
import {
  GRUPOS_HERRAMIENTAS,
  Herramienta,
  IdHerramienta,
  MAX_ANCLADAS,
  alternarAnclada,
  buscarHerramientas,
  herramientaPorId,
  leerAncladas,
} from "@/src/base/herramientas";

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
function FilaHerramienta({
  h,
  anclada,
  badge,
  onAbrir,
  onAnclar,
}: {
  h: Herramienta;
  anclada: boolean;
  /** Contador de pendientes (p. ej. pedidos web nuevos). Solo se pinta si > 0. */
  badge?: number;
  onAbrir: (id: IdHerramienta) => void;
  onAnclar: (id: IdHerramienta) => void;
}) {
  const { tema: T } = useTema();
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Pressable
        onPress={() => onAbrir(h.id)}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: T.esps.md,
          minHeight: T.filaAlto,
          paddingLeft: T.esps.lg,
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
          <Txt escala="pie" tono="suave" lineas={2} estilo={{ marginTop: 2 }}>
            {h.meta}
          </Txt>
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
export function PanelHerramientas({
  visible,
  onCerrar,
  onAbrir,
  visibleId,
  onAncladasCambio,
  badges,
}: {
  visible: boolean;
  onCerrar: () => void;
  onAbrir: (id: IdHerramienta) => void;
  /** Qué herramientas aplican al estado actual del negocio. */
  visibleId: (id: IdHerramienta) => boolean;
  onAncladasCambio?: (ids: IdHerramienta[]) => void;
  /** Contadores de pendientes por herramienta (p. ej. pedidos web nuevos). */
  badges?: Partial<Record<IdHerramienta, number>>;
}) {
  const { tema: T } = useTema();
  const [busqueda, setBusqueda] = useState("");
  const [ancladas, setAncladas] = useState<IdHerramienta[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setBusqueda("");
    setAviso(null);
    leerAncladas().then(setAncladas);
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

  const resultados = useMemo(
    () => buscarHerramientas(busqueda).filter((h) => visibleId(h.id)),
    [busqueda, visibleId]
  );
  const buscando = busqueda.trim().length > 0;

  const listaAncladas = ancladas
    .map(herramientaPorId)
    .filter((h): h is Herramienta => Boolean(h) && visibleId(h!.id));

  return (
    <Modal
      visible={visible}
      onRequestClose={onCerrar}
      transparent
      animationType="slide"
      presentationStyle="overFullScreen"
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        {/* Toque fuera = cerrar. El velo deja ver que Inicio sigue detrás:
            es una hoja sobre la mesa, no otra pantalla. */}
        <Pressable
          onPress={onCerrar}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
          }}
        />
        <View
          style={{
            height: "92%",
            backgroundColor: T.fondo,
            borderTopLeftRadius: T.radioGrande,
            borderTopRightRadius: T.radioGrande,
            overflow: "hidden",
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

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: T.esp,
              paddingTop: T.esps.lg,
              paddingBottom: T.esps.md,
            }}
          >
            <Txt escala="titulo" fuerte>
              Herramientas
            </Txt>
            <Pressable onPress={onCerrar} hitSlop={12} style={{ minHeight: 44, justifyContent: "center" }}>
              <Txt escala="cuerpo" tono="suave">
                Cerrar
              </Txt>
            </Pressable>
          </View>

          {/* Buscador */}
          <View style={{ paddingHorizontal: T.esp, paddingBottom: T.esps.md }}>
            <TextInput
              value={busqueda}
              onChangeText={setBusqueda}
              placeholder="Buscar herramienta…"
              placeholderTextColor={T.textoTenue}
              autoCorrect={false}
              returnKeyType="search"
              style={{
                backgroundColor: T.superficie2,
                borderRadius: T.radio,
                paddingHorizontal: T.esps.lg,
                paddingVertical: T.esps.md,
                minHeight: 48,
                fontSize: T.tipo.cuerpo,
                fontFamily: T.fuente.ui,
                color: T.texto,
              }}
            />
          </View>

          {aviso ? (
            <View style={{ paddingHorizontal: T.esp, paddingBottom: T.esps.sm }}>
              <Txt escala="pie" tono="alerta">
                {aviso}
              </Txt>
            </View>
          ) : null}

          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: T.esp,
              paddingBottom: T.esps.xxl * 2,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {buscando ? (
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
                    desc="Aparecen en Inicio. Toca la estrella para quitar."
                  >
                    <Bloque>
                      {listaAncladas.map((h) => (
                        <FilaHerramienta
                          key={h.id}
                          h={h}
                          anclada
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
        </View>
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
// Se abre tocándolo O arrastrándolo hacia arriba. Va fijo al borde inferior,
// justo encima de la barra de pestañas, así que está siempre a la vista y en
// la zona del pulgar sin robar un destino de navegación.
//
// El arrastre usa PanResponder (núcleo de React Native): sin dependencias
// extra y con comportamiento idéntico en Android y iOS.
export function TiradorHerramientas({ onAbrir }: { onAbrir: () => void }) {
  const { tema: T } = useTema();
  const abierto = useRef(false);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Solo reclama el gesto si el movimiento es claramente hacia ARRIBA.
        // Así un scroll normal de Inicio nunca abre el panel por accidente.
        onMoveShouldSetPanResponder: (_e, g) =>
          g.dy < -8 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => {
          if (!abierto.current && g.dy < -40) {
            abierto.current = true;
            onAbrir();
          }
        },
        onPanResponderRelease: () => {
          abierto.current = false;
        },
        onPanResponderTerminate: () => {
          abierto.current = false;
        },
      }),
    [onAbrir]
  );

  return (
    <View
      {...responder.panHandlers}
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
