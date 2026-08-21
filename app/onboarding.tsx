// YvexPOS Móvil — ONBOARDING (primer arranque).
//
// Asistente conversacional de 7 pasos, una pregunta por pantalla:
//   1. Bienvenida
//   2. ¿Cómo se llama tu negocio?
//   3. ¿Qué vende {negocio}? (grid de giros)
//   4. ¿Para qué lo vas a usar? (modo: pos / monitor / ambos)
//   5. Tu usuario (nombre + PIN elegido por el dueño, NUNCA uno por defecto)
//   6. Apariencia (tema y acento, aplicados EN VIVO)
//   7. ¡Listo! (cierre personalizado con sugerencias del giro + nube opcional)
//
// Al terminar: guarda nombre del negocio y giro, crea el usuario dueño,
// siembra los departamentos sugeridos si el inventario está vacío, guarda
// el modo y entra a la app.
//
// ---------------------------------------------------------------------------
// QUÉ CAMBIÓ EN ESTA MIGRACIÓN
// ---------------------------------------------------------------------------
// Esta es la primera pantalla que ve cualquier persona que instala la app —
// donde más importa que se sienta terminada. Por eso, a diferencia de
// ModalTienda (donde el tamaño hacía preferible una corrección quirúrgica),
// aquí sí se re-vistió por completo con las primitivas del sistema
// (Boton, Campo, Txt, Banner), igual que FormularioProducto y ModalLealtad.
//
//   1. T.turquesa en el wordmark ("Yvex[POS]") y en "Mostrar/Ocultar PIN"
//      -> T.acento. El morado fantasma de siempre.
//   2. El botón principal usaba T.acento crudo como fondo -> T.acentoRelleno,
//      el mismo bug de contraste con acentos claros que ya se corrigió en
//      toda la app.
//   3. BackHandler para el wizard: antes, presionar Atrás de Android en
//      CUALQUIER paso salía del onboarding completo, no retrocedía un
//      paso. En la primera experiencia de la app, perder todo el progreso
//      así — el nombre del negocio, el giro, el PIN ya escrito — se siente
//      pésimo. Ahora Atrás hace lo mismo que la flecha de la barra
//      superior; solo en el paso 1 se deja el comportamiento por defecto.
//
// Lo que NO se tocó, y por qué: el check ✓ del selector de acento (paso 6)
// ya usaba T.acentoTexto en vez de blanco fijo — el patrón CORRECTO que
// tuvo que corregirse en ModalTienda. Aquí ya estaba bien resuelto desde
// antes.

import { useEffect, useState, type ReactNode } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  BackHandler,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTema } from "@/src/componentes/TemaProvider";
import { IconoUI, IdUI } from "@/src/componentes/iconos";
import { TEMAS, ACENTOS } from "@/src/base/apariencia";
import { MODOS, ModoUso, guardarModoUso, marcarOnboardingHecho } from "@/src/base/modoUso";
import { GIROS, Giro, guardarGiro, guardarNombreNegocio } from "@/src/base/giro";
import { crearUsuario, activarUsuario, setPedirPin } from "@/src/base/usuarios";
import { estadoCuenta } from "@/src/base/nube";
import { listarProductos, listarCategorias, crearCategoria } from "@/src/base/inventario";
import ModalCuenta from "@/src/componentes/ModalCuenta";
import MuestraTema from "@/src/componentes/MuestraTema";
import { Boton, Banner, Campo, Txt, useEstiloInput } from "@/src/componentes/ui";

const ICONO_MODO: Record<ModoUso, IdUI> = {
  pos: "vender",
  monitor: "reportes",
  ambos: "inicio",
};

// Paleta neutral para los departamentos sugeridos (datos, no UI: no aplica
// la regla de tema). Rotan según el orden de creación.
const COLORES_DEPTO = [
  "#e11d48", "#d97706", "#059669", "#2563eb",
  "#7c3aed", "#db2777", "#0891b2", "#65a30d",
];

const TOTAL_PASOS = 7;

// --- Animaciones del wizard (shared values controlados, sin layout anims) ---

/** Entrada suave de cada paso: fade + desplazamiento de 20px (~200ms).
 *  Se usa con key={paso}, así se remonta y anima en cada cambio de paso. */
function PasoAnimado({ children }: { children: ReactNode }) {
  const op = useSharedValue(0);
  const dy = useSharedValue(20);
  useEffect(() => {
    op.value = withTiming(1, { duration: 200 });
    dy.value = withTiming(0, { duration: 200 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const st = useAnimatedStyle(() => ({
    opacity: op.value,
    transform: [{ translateY: dy.value }],
  }));
  return <Animated.View style={[{ flexGrow: 1 }, st]}>{children}</Animated.View>;
}

/** Tarjeta de giro: al elegirla hace un "pop" con resorte (1→1.04→1, ~250ms). */
function TarjetaGiro({
  g,
  activo,
  onElegir,
}: {
  g: Giro;
  activo: boolean;
  onElegir: () => void;
}) {
  const { tema: T } = useTema();
  const escala = useSharedValue(1);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: escala.value }] }));
  function presionar() {
    escala.value = withSequence(
      withTiming(1.04, { duration: 110 }),
      withSpring(1, { damping: 13, stiffness: 260 })
    );
    onElegir();
  }
  return (
    <Pressable
      onPress={presionar}
      style={{
        width: "47.5%",
        backgroundColor: T.superficie,
        borderWidth: 1.5,
        borderColor: activo ? T.acento : T.borde,
        borderRadius: T.radioGrande,
        padding: T.esps.lg,
        ...(activo ? { backgroundColor: T.acentoSuave } : null),
      }}
    >
      <Animated.View style={st}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 15,
            borderWidth: 1,
            borderColor: activo ? T.acento : T.bordeFuerte,
            backgroundColor: activo ? T.acentoSuave : T.superficie2,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: T.esps.md,
          }}
        >
          <IconoUI id={g.icono} size={26} color={activo ? T.acento : T.textoSuave} />
        </View>
        <Txt escala="pie" fuerte>{g.nombre}</Txt>
        {/* Texto COMPLETO: la tarjeta crece en altura lo que necesite */}
        <Txt escala="micro" tono="tenue" estilo={{ marginTop: 4 }}>{g.frase}</Txt>
      </Animated.View>
      {activo && (
        <Txt
          escala="pie"
          fuerte
          tono="acento"
          estilo={{ position: "absolute", top: 12, right: 14 }}
        >
          ✓
        </Txt>
      )}
    </Pressable>
  );
}

export default function OnboardingScreen() {
  const { tema: T, prefs, setTema, setAcento } = useTema();
  const estiloInput = useEstiloInput();

  const [paso, setPaso] = useState(1);
  const [nombreNegocio, setNombreNegocio] = useState("");
  const [giro, setGiro] = useState<Giro | null>(null);
  const [modo, setModo] = useState<ModoUso | null>(null);

  const [nombre, setNombre] = useState("Dueño");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [verPin, setVerPin] = useState(false);
  const [errorUsuario, setErrorUsuario] = useState("");

  const [creando, setCreando] = useState(false);
  const [errorFinal, setErrorFinal] = useState("");
  const [cuentaAbierta, setCuentaAbierta] = useState(false);

  // Nombre que usan los textos a partir del paso 3 (con su default cálido).
  const negocio = nombreNegocio.trim() === "" ? "Mi negocio" : nombreNegocio.trim();

  // --- Validación del paso 5 (usuario) ---
  function validarUsuario(): boolean {
    if (!nombre.trim()) {
      setErrorUsuario("Escribe tu nombre.");
      return false;
    }
    if (!/^\d{4}$/.test(pin)) {
      setErrorUsuario("El PIN debe ser de 4 dígitos.");
      return false;
    }
    if (pin2 !== pin) {
      setErrorUsuario("Los PIN no coinciden. Revísalos.");
      return false;
    }
    setErrorUsuario("");
    return true;
  }

  function continuar() {
    if (paso === 3 && !giro) return;
    if (paso === 5 && !validarUsuario()) return;
    if (paso < TOTAL_PASOS) setPaso(paso + 1);
  }

  function retroceder() {
    if (paso > 1) setPaso(paso - 1);
  }

  // Atrás del sistema: retrocede un paso del wizard, igual que la flecha de
  // la barra superior. Sin esto, Atrás de Android salía del onboarding
  // completo desde cualquier paso — en la primera experiencia de la app,
  // perder todo lo ya escrito así se siente pésimo. Solo en el paso 1 se
  // deja el comportamiento por defecto (nada que retroceder).
  useEffect(() => {
    const alPresionarAtras = () => {
      if (paso > 1) {
        retroceder();
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", alPresionarAtras);
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso]);

  /** Siembra los departamentos sugeridos del giro SOLO si el inventario está
   *  vacío (instalación nueva). Nunca pisa trabajo ya hecho. */
  async function sembrarDepartamentos(g: Giro) {
    if (g.departamentos.length === 0) return;
    const [prods, cats] = await Promise.all([listarProductos(), listarCategorias()]);
    if (prods.length > 0 || cats.length > 0) return;
    for (let i = 0; i < g.departamentos.length; i++) {
      await crearCategoria(
        g.departamentos[i],
        COLORES_DEPTO[i % COLORES_DEPTO.length],
        "caja"
      );
    }
  }

  async function terminar() {
    if (creando) return;
    setCreando(true);
    setErrorFinal("");
    try {
      await guardarNombreNegocio(negocio);
      await guardarGiro(giro?.id ?? "otro");
      const id = await crearUsuario(nombre, pin, "dueno");
      await activarUsuario(id);
      await setPedirPin(false); // sin fricción si es una sola persona
      await guardarModoUso(modo ?? "ambos");
      if (giro) {
        try {
          await sembrarDepartamentos(giro);
        } catch (e) {
          // No bloquea el arranque: los departamentos se pueden crear después.
          console.warn("No se pudieron sembrar los departamentos sugeridos:", e);
        }
      }
      await marcarOnboardingHecho();
      router.replace("/(tabs)");
    } catch (e) {
      setErrorFinal(e instanceof Error ? e.message : "No se pudo crear tu usuario. Intenta de nuevo.");
      setCreando(false);
    }
  }

  // Al cerrar el modal de cuenta: si quedó vinculada, terminamos el
  // onboarding igual que con el botón principal; si no, seguimos aquí.
  async function cerrarModalCuenta() {
    setCuentaAbierta(false);
    const c = await estadoCuenta();
    if (c.vinculado) terminar();
  }

  const botonDeshabilitado =
    (paso === 3 && !giro) ||
    (paso === 5 && (!nombre.trim() || pin.length < 4 || pin2.length < 4));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.fondo }} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Progreso + atrás */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: T.esp,
            paddingTop: 10,
            paddingBottom: 4,
          }}
        >
          {paso > 1 ? (
            <Pressable onPress={retroceder} hitSlop={12} style={{ width: 36, height: 36, justifyContent: "center" }}>
              <IconoUI id="atras" size={20} color={T.textoSuave} />
            </Pressable>
          ) : (
            <View style={{ width: 36, height: 36 }} />
          )}
          <View style={{ flex: 1, flexDirection: "row", justifyContent: "center", gap: 8 }}>
            {Array.from({ length: TOTAL_PASOS }, (_, i) => (
              <View
                key={i}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: i + 1 <= paso ? T.acento : T.superficie3,
                }}
              />
            ))}
          </View>
          <View style={{ width: 36, height: 36 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ padding: T.esp, paddingTop: T.esps.xxl, paddingBottom: T.esps.md, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Al cambiar de paso este bloque se remonta y entra suave */}
          <PasoAnimado key={paso}>
          {paso === 1 && (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 30 }}>
              <Text style={{ color: T.texto, fontSize: 46, fontWeight: "900", letterSpacing: -1.5 }}>
                Yvex<Text style={{ color: T.acento }}>POS</Text>
              </Text>
              <Txt escala="titulo" fuerte estilo={{ marginTop: T.esps.lg, textAlign: "center" }}>
                Qué gusto tenerte por aquí
              </Txt>
              <Txt escala="cuerpo" tono="suave" estilo={{ marginTop: T.esps.md, textAlign: "center", paddingHorizontal: 12 }}>
                En unos minutos tu negocio va a vender, cuidar su inventario y
                ver cómo va el día, todo desde este dispositivo. Vamos paso a
                paso, sin prisa.
              </Txt>
            </View>
          )}

          {paso === 2 && (
            <View>
              <Txt escala="protagonista" fuerte>¿Cómo se llama tu negocio?</Txt>
              <Txt escala="cuerpo" tono="suave" estilo={{ marginTop: T.esps.sm, marginBottom: T.esps.xl }}>
                Así lo verás en la pantalla de inicio. Si lo dejas vacío, le
                diremos "Mi negocio" con mucho cariño.
              </Txt>
              <TextInput
                style={[estiloInput, { fontSize: 21, fontWeight: "700", paddingVertical: T.esps.lg }]}
                value={nombreNegocio}
                onChangeText={setNombreNegocio}
                placeholder="Ej. Abarrotes Lupita"
                placeholderTextColor={T.textoTenue}
                autoCapitalize="words"
                returnKeyType="done"
              />
            </View>
          )}

          {paso === 3 && (
            <View>
              <Txt escala="protagonista" fuerte>¿Qué vende {negocio}?</Txt>
              <Txt escala="cuerpo" tono="suave" estilo={{ marginTop: T.esps.sm, marginBottom: T.esps.xl }}>
                Elige el giro que más se parezca. Con eso te sugerimos
                departamentos y te contamos qué partes de la app te van a
                servir más.
              </Txt>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: T.esps.md, alignItems: "flex-start" }}>
                {GIROS.map((g) => (
                  <TarjetaGiro
                    key={g.id}
                    g={g}
                    activo={giro?.id === g.id}
                    onElegir={() => setGiro(g)}
                  />
                ))}
              </View>
            </View>
          )}

          {paso === 4 && (
            <View>
              <Txt escala="protagonista" fuerte>¿Para qué lo vas a usar?</Txt>
              <Txt escala="cuerpo" tono="suave" estilo={{ marginTop: T.esps.sm, marginBottom: T.esps.xl }}>
                Puedes cambiarlo después en Ajustes.
              </Txt>
              {MODOS.map((m) => {
                const activo = modo === m.id;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => setModo(m.id)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: T.esps.lg,
                      backgroundColor: activo ? T.acentoSuave : T.superficie,
                      borderWidth: 1.5,
                      borderColor: activo ? T.acento : T.borde,
                      borderRadius: T.radioGrande,
                      padding: T.esps.lg,
                      marginBottom: T.esps.md,
                    }}
                  >
                    <View
                      style={{
                        width: 48, height: 48, borderRadius: 14, borderWidth: 1,
                        borderColor: activo ? T.acento : T.bordeFuerte,
                        backgroundColor: activo ? T.acentoSuave : T.superficie2,
                        alignItems: "center", justifyContent: "center",
                      }}
                    >
                      <IconoUI id={ICONO_MODO[m.id]} size={24} color={activo ? T.acento : T.textoSuave} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Txt escala="cuerpo" fuerte>{m.nombre}</Txt>
                      <Txt escala="pie" tono="suave" estilo={{ marginTop: 2 }}>{m.desc}</Txt>
                      <Txt escala="micro" tono="tenue" estilo={{ marginTop: 5 }}>{m.ejemplo}</Txt>
                    </View>
                    {activo && <Txt escala="cuerpo" fuerte tono="acento">✓</Txt>}
                  </Pressable>
                );
              })}
            </View>
          )}

          {paso === 5 && (
            <View>
              <Txt escala="protagonista" fuerte>Tu usuario</Txt>
              <Txt escala="cuerpo" tono="suave" estilo={{ marginTop: T.esps.sm, marginBottom: T.esps.xl }}>
                Perfecto, {negocio} ya casi está listo. Ahora, ¿quién eres tú?
                El PIN es tuyo, lo eliges tú. Lo pedirá la app si varias
                personas usan este dispositivo. No hay PIN por defecto: si lo
                olvidas, otro dueño puede cambiarlo desde Ajustes.
              </Txt>

              <Campo label="Nombre">
                <TextInput
                  style={estiloInput}
                  value={nombre}
                  onChangeText={setNombre}
                  placeholder="Tu nombre"
                  placeholderTextColor={T.textoTenue}
                  autoCapitalize="words"
                />
              </Campo>

              <Campo label="PIN de 4 dígitos">
                <TextInput
                  style={estiloInput}
                  value={pin}
                  onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••"
                  placeholderTextColor={T.textoTenue}
                  keyboardType="number-pad"
                  maxLength={4}
                  secureTextEntry={!verPin}
                />
              </Campo>

              <Campo label="Confirma tu PIN">
                <TextInput
                  style={estiloInput}
                  value={pin2}
                  onChangeText={(v) => setPin2(v.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••"
                  placeholderTextColor={T.textoTenue}
                  keyboardType="number-pad"
                  maxLength={4}
                  secureTextEntry={!verPin}
                />
              </Campo>

              <Pressable
                onPress={() => setVerPin(!verPin)}
                hitSlop={8}
                style={{ alignSelf: "flex-end", marginTop: -6, marginBottom: T.esps.md }}
              >
                <Txt escala="pie" fuerte tono="acento">{verPin ? "Ocultar PIN" : "Mostrar PIN"}</Txt>
              </Pressable>

              <Banner texto={errorUsuario} tipo="error" />
            </View>
          )}

          {paso === 6 && (
            <View>
              <Txt escala="protagonista" fuerte>Apariencia</Txt>
              <Txt escala="cuerpo" tono="suave" estilo={{ marginTop: T.esps.sm, marginBottom: T.esps.xl }}>
                Elige cómo se ve tu app. Lo que toques se aplica al momento.
              </Txt>

              {TEMAS.map((t) => {
                const activo = prefs.tema === t.id;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => setTema(t.id)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: T.esps.lg,
                      backgroundColor: activo ? T.acentoSuave : T.superficie,
                      borderWidth: 1.5,
                      borderColor: activo ? T.acento : T.borde,
                      borderRadius: T.radio,
                      padding: T.esps.lg,
                      marginBottom: T.esps.md,
                    }}
                  >
                    {/* Mini-mock de la app con la paleta del tema y el acento ACTIVO */}
                    <MuestraTema paleta={t.paleta} acentoColor={T.acento} esClaro={t.esClaro} />
                    <View style={{ flex: 1 }}>
                      <Txt escala="cuerpo" fuerte>{t.nombre}</Txt>
                      <Txt escala="micro" tono="tenue" estilo={{ marginTop: 5 }}>{t.desc}</Txt>
                    </View>
                    {activo && <Txt escala="cuerpo" fuerte tono="acento">✓</Txt>}
                  </Pressable>
                );
              })}

              <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginTop: T.esps.lg, marginBottom: T.esps.sm }}>
                Color de acento
              </Txt>
              <View style={{ flexDirection: "row", gap: T.esps.lg, flexWrap: "wrap", marginTop: 4 }}>
                {ACENTOS.map((a) => {
                  const activo = prefs.acento === a.id;
                  return (
                    <Pressable
                      key={a.id}
                      onPress={() => setAcento(a.id)}
                      style={{
                        width: 40, height: 40, borderRadius: 20,
                        backgroundColor: a.color,
                        alignItems: "center", justifyContent: "center",
                        borderWidth: activo ? 3 : 0,
                        borderColor: T.texto,
                      }}
                      accessibilityLabel={a.nombre}
                    >
                      {/* T.acentoTexto: correcto aquí porque este swatch, cuando
                          está activo, ES el acento actual — mismo color, mismo
                          contraste calculado. Es el patrón que ModalTienda tuvo
                          que adoptar; aquí ya estaba bien. */}
                      {activo && (
                        <Txt escala="pie" fuerte estilo={{ color: T.acentoTexto }}>✓</Txt>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {paso === 7 && (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 30 }}>
              <View
                style={{
                  width: 64, height: 64, borderRadius: 18, borderWidth: 1,
                  borderColor: T.bordeFuerte, backgroundColor: T.superficie2,
                  alignItems: "center", justifyContent: "center", marginBottom: T.esps.xl,
                }}
              >
                <IconoUI id={giro?.icono ?? "puntos"} size={30} color={T.acento} />
              </View>
              <Txt escala="titulo" fuerte estilo={{ textAlign: "center" }}>¡Listo, {negocio}!</Txt>
              <Txt escala="cuerpo" tono="suave" estilo={{ marginTop: T.esps.md, textAlign: "center", paddingHorizontal: 8 }}>
                Ya puedes empezar a vender. Mira lo que le va a servir a tu
                negocio:
              </Txt>
              <View style={{ alignSelf: "stretch", marginTop: T.esps.lg, gap: T.esps.sm }}>
                {(giro?.sugerencias ?? []).map((s, i) => (
                  <View
                    key={i}
                    style={{
                      flexDirection: "row", alignItems: "flex-start", gap: T.esps.sm,
                      backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
                      borderRadius: T.radio, padding: T.esps.lg,
                    }}
                  >
                    <Txt escala="pie" fuerte tono="acento" estilo={{ marginTop: 1 }}>✓</Txt>
                    <Txt escala="pie" tono="suave" estilo={{ flex: 1 }}>{s}</Txt>
                  </View>
                ))}
              </View>
              <Txt escala="pie" tono="tenue" estilo={{ textAlign: "center", marginTop: T.esps.lg, paddingHorizontal: 8 }}>
                La app funciona al 100% sin cuenta. Si quieres respaldo en la
                nube, vincula tu cuenta abajo o después en Ajustes.
              </Txt>
            </View>
          )}

          <Banner texto={errorFinal} tipo="error" />
          </PasoAnimado>
        </ScrollView>

        {/* Botón inferior */}
        <View style={{ padding: T.esp, paddingTop: T.esps.sm }}>
          {paso < TOTAL_PASOS ? (
            <Boton
              titulo={paso === 1 ? "Empezar" : "Continuar"}
              onPress={continuar}
              deshabilitado={botonDeshabilitado}
            />
          ) : (
            <View>
              <Boton
                titulo="Empezar a usar YvexPOS"
                onPress={terminar}
                cargando={creando}
              />
              <View style={{ marginTop: T.esps.sm }}>
                <Boton
                  titulo="Iniciar sesión o crear cuenta"
                  tipo="secundario"
                  onPress={() => setCuentaAbierta(true)}
                  deshabilitado={creando}
                />
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Modal de cuenta (mismo que Ajustes): si vincula, terminamos aquí */}
      {cuentaAbierta && (
        <ModalCuenta onCerrar={cerrarModalCuenta} onCambio={() => {}} />
      )}
    </SafeAreaView>
  );
}
