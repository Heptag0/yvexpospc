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

import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
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
import { TEMAS, ACENTOS, construirTema } from "@/src/base/apariencia";
import { MODOS, ModoUso, guardarModoUso, marcarOnboardingHecho } from "@/src/base/modoUso";
import { GIROS, Giro, guardarGiro, guardarNombreNegocio } from "@/src/base/giro";
import { crearUsuario, activarUsuario, setPedirPin } from "@/src/base/usuarios";
import { estadoCuenta } from "@/src/base/nube";
import { listarProductos, listarCategorias, crearCategoria } from "@/src/base/inventario";
import ModalCuenta from "@/src/componentes/ModalCuenta";
import MuestraTema from "@/src/componentes/MuestraTema";

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

type TemaT = ReturnType<typeof construirTema>;
type EstilosT = ReturnType<typeof crearEstilos>;

// --- Animaciones del wizard (shared values controlados, sin layout anims) ---

/** Entrada suave de cada paso: fade + desplazamiento de 20px (~200ms).
 *  Se usa con key={paso}, así se remonta y anima en cada cambio de paso. */
function PasoAnimado({ children }: { children: React.ReactNode }) {
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
  T,
  est,
}: {
  g: Giro;
  activo: boolean;
  onElegir: () => void;
  T: TemaT;
  est: EstilosT;
}) {
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
    <Pressable onPress={presionar} style={[est.giroTarjeta, activo && est.tarjetaActiva]}>
      <Animated.View style={st}>
        <View
          style={[
            est.giroIcono,
            activo && { borderColor: T.acento, backgroundColor: T.acentoSuave },
          ]}
        >
          <IconoUI id={g.icono} size={26} color={activo ? T.acento : T.textoSuave} />
        </View>
        <Text style={est.giroNombre}>{g.nombre}</Text>
        {/* Texto COMPLETO: la tarjeta crece en altura lo que necesite */}
        <Text style={est.giroFrase}>{g.frase}</Text>
      </Animated.View>
      {activo && <Text style={est.giroPaloma}>✓</Text>}
    </Pressable>
  );
}

export default function OnboardingScreen() {
  const { tema: T, prefs, setTema, setAcento } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);

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

  // Scale sutil del botón principal al presionar (0.97 con resorte al soltar).
  const escalaBtn = useSharedValue(1);
  const estBtnAnim = useAnimatedStyle(() => ({
    transform: [{ scale: escalaBtn.value }],
  }));
  const btnAbajo = () => { escalaBtn.value = withTiming(0.97, { duration: 90 }); };
  const btnArriba = () => { escalaBtn.value = withSpring(1, { damping: 14, stiffness: 300 }); };

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
    <SafeAreaView style={est.raiz} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Progreso + atrás */}
        <View style={est.barra}>
          {paso > 1 ? (
            <Pressable onPress={() => setPaso(paso - 1)} hitSlop={12} style={est.atrasBtn}>
              <IconoUI id="atras" size={20} color={T.textoSuave} />
            </Pressable>
          ) : (
            <View style={est.atrasBtn} />
          )}
          <View style={est.puntos}>
            {Array.from({ length: TOTAL_PASOS }, (_, i) => (
              <View
                key={i}
                style={[est.punto, i + 1 <= paso && { backgroundColor: T.acento }]}
              />
            ))}
          </View>
          <View style={est.atrasBtn} />
        </View>

        <ScrollView
          contentContainerStyle={est.cuerpo}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Al cambiar de paso este bloque se remonta y entra suave */}
          <PasoAnimado key={paso}>
          {paso === 1 && (
            <View style={est.centrado}>
              <Text style={est.marca}>
                Yvex<Text style={{ color: T.turquesa }}>POS</Text>
              </Text>
              <Text style={est.frase}>Qué gusto tenerte por aquí</Text>
              <Text style={est.subfrase}>
                En unos minutos tu negocio va a vender, cuidar su inventario y
                ver cómo va el día, todo desde este dispositivo. Vamos paso a
                paso, sin prisa.
              </Text>
            </View>
          )}

          {paso === 2 && (
            <View>
              <Text style={est.titulo}>¿Cómo se llama tu negocio?</Text>
              <Text style={est.subtitulo}>
                Así lo verás en la pantalla de inicio. Si lo dejas vacío, le
                diremos "Mi negocio" con mucho cariño.
              </Text>
              <TextInput
                style={est.inputGrande}
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
              <Text style={est.titulo}>¿Qué vende {negocio}?</Text>
              <Text style={est.subtitulo}>
                Elige el giro que más se parezca. Con eso te sugerimos
                departamentos y te contamos qué partes de la app te van a
                servir más.
              </Text>
              <View style={est.giroGrid}>
                {GIROS.map((g) => (
                  <TarjetaGiro
                    key={g.id}
                    g={g}
                    activo={giro?.id === g.id}
                    onElegir={() => setGiro(g)}
                    T={T}
                    est={est}
                  />
                ))}
              </View>
            </View>
          )}

          {paso === 4 && (
            <View>
              <Text style={est.titulo}>¿Para qué lo vas a usar?</Text>
              <Text style={est.subtitulo}>Puedes cambiarlo después en Ajustes.</Text>
              {MODOS.map((m) => {
                const activo = modo === m.id;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => setModo(m.id)}
                    style={[est.tarjeta, activo && est.tarjetaActiva]}
                  >
                    <View style={[est.tarjetaIcono, activo && { borderColor: T.acento, backgroundColor: T.acentoSuave }]}>
                      <IconoUI id={ICONO_MODO[m.id]} size={24} color={activo ? T.acento : T.textoSuave} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={est.tarjetaNombre}>{m.nombre}</Text>
                      <Text style={est.tarjetaDesc}>{m.desc}</Text>
                      <Text style={est.tarjetaEj}>{m.ejemplo}</Text>
                    </View>
                    {activo && <Text style={est.paloma}>✓</Text>}
                  </Pressable>
                );
              })}
            </View>
          )}

          {paso === 5 && (
            <View>
              <Text style={est.titulo}>Tu usuario</Text>
              <Text style={est.subtitulo}>
                Perfecto, {negocio} ya casi está listo. Ahora, ¿quién eres tú?
                El PIN es tuyo, lo eliges tú. Lo pedirá la app si varias
                personas usan este dispositivo. No hay PIN por defecto: si lo
                olvidas, otro dueño puede cambiarlo desde Ajustes.
              </Text>

              <Text style={est.label}>NOMBRE</Text>
              <TextInput
                style={est.input}
                value={nombre}
                onChangeText={setNombre}
                placeholder="Tu nombre"
                placeholderTextColor={T.textoTenue}
                autoCapitalize="words"
              />

              <Text style={est.label}>PIN DE 4 DÍGITOS</Text>
              <TextInput
                style={est.input}
                value={pin}
                onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 4))}
                placeholder="••••"
                placeholderTextColor={T.textoTenue}
                keyboardType="number-pad"
                maxLength={4}
                secureTextEntry={!verPin}
              />

              <Text style={est.label}>CONFIRMA TU PIN</Text>
              <TextInput
                style={est.input}
                value={pin2}
                onChangeText={(v) => setPin2(v.replace(/\D/g, "").slice(0, 4))}
                placeholder="••••"
                placeholderTextColor={T.textoTenue}
                keyboardType="number-pad"
                maxLength={4}
                secureTextEntry={!verPin}
              />

              <Pressable onPress={() => setVerPin(!verPin)} hitSlop={8} style={est.verPin}>
                <Text style={est.verPinTxt}>{verPin ? "Ocultar PIN" : "Mostrar PIN"}</Text>
              </Pressable>

              {errorUsuario !== "" && (
                <View style={est.errorCaja}>
                  <Text style={est.errorTxt}>{errorUsuario}</Text>
                </View>
              )}
            </View>
          )}

          {paso === 6 && (
            <View>
              <Text style={est.titulo}>Apariencia</Text>
              <Text style={est.subtitulo}>
                Elige cómo se ve tu app. Lo que toques se aplica al momento.
              </Text>

              {TEMAS.map((t) => {
                const activo = prefs.tema === t.id;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => setTema(t.id)}
                    style={[est.temaFila, activo && est.tarjetaActiva]}
                  >
                    {/* Mini-mock de la app con la paleta del tema y el acento ACTIVO */}
                    <MuestraTema paleta={t.paleta} acentoColor={T.acento} esClaro={t.esClaro} />
                    <View style={{ flex: 1 }}>
                      <Text style={est.tarjetaNombre}>{t.nombre}</Text>
                      <Text style={est.tarjetaEj}>{t.desc}</Text>
                    </View>
                    {activo && <Text style={est.paloma}>✓</Text>}
                  </Pressable>
                );
              })}

              <Text style={[est.label, { marginTop: 18 }]}>COLOR DE ACENTO</Text>
              <View style={est.acentos}>
                {ACENTOS.map((a) => {
                  const activo = prefs.acento === a.id;
                  return (
                    <Pressable
                      key={a.id}
                      onPress={() => setAcento(a.id)}
                      style={[est.acentoCirculo, { backgroundColor: a.color }, activo && est.acentoActivo]}
                      accessibilityLabel={a.nombre}
                    >
                      {activo && <Text style={est.acentoPaloma}>✓</Text>}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {paso === 7 && (
            <View style={est.centrado}>
              <View style={est.nubeIcono}>
                <IconoUI id={giro?.icono ?? "puntos"} size={30} color={T.acento} />
              </View>
              <Text style={est.tituloCentro}>¡Listo, {negocio}!</Text>
              <Text style={est.cierreTxt}>
                Ya puedes empezar a vender. Mira lo que le va a servir a tu
                negocio:
              </Text>
              <View style={est.sugerenciasCaja}>
                {(giro?.sugerencias ?? []).map((s, i) => (
                  <View key={i} style={est.sugerenciaFila}>
                    <Text style={est.sugerenciaPaloma}>✓</Text>
                    <Text style={est.sugerenciaTxt}>{s}</Text>
                  </View>
                ))}
              </View>
              <Text style={est.nubeNota}>
                La app funciona al 100% sin cuenta. Si quieres respaldo en la
                nube, vincula tu cuenta abajo o después en Ajustes.
              </Text>
            </View>
          )}

          {errorFinal !== "" && (
            <View style={est.errorCaja}>
              <Text style={est.errorTxt}>{errorFinal}</Text>
            </View>
          )}
          </PasoAnimado>
        </ScrollView>

        {/* Botón inferior */}
        <View style={est.pie}>
          {paso < TOTAL_PASOS ? (
            <Animated.View style={estBtnAnim}>
              <Pressable
                onPress={continuar}
                onPressIn={btnAbajo}
                onPressOut={btnArriba}
                disabled={botonDeshabilitado}
                style={({ pressed }) => [
                  est.boton,
                  botonDeshabilitado && { opacity: 0.4 },
                  pressed && !botonDeshabilitado && { opacity: 0.85 },
                ]}
              >
                <Text style={est.botonTxt}>{paso === 1 ? "Empezar" : "Continuar"}</Text>
              </Pressable>
            </Animated.View>
          ) : (
            <View>
              <Animated.View style={estBtnAnim}>
                <Pressable
                  onPress={terminar}
                  onPressIn={btnAbajo}
                  onPressOut={btnArriba}
                  disabled={creando}
                  style={({ pressed }) => [est.boton, pressed && !creando && { opacity: 0.85 }]}
                >
                  {creando ? (
                    <ActivityIndicator color={T.acentoTexto} size="small" />
                  ) : (
                    <Text style={est.botonTxt}>Empezar a usar YvexPOS</Text>
                  )}
                </Pressable>
              </Animated.View>
              <Pressable
                onPress={() => setCuentaAbierta(true)}
                disabled={creando}
                style={({ pressed }) => [
                  est.botonSecundario,
                  pressed && !creando && { backgroundColor: T.superficie3 },
                ]}
              >
                <Text style={est.botonSecundarioTxt}>Iniciar sesión o crear cuenta</Text>
              </Pressable>
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

// Los estilos se construyen con el tema ACTIVO (useTema): el paso de
// apariencia se ve reflejado en el wizard mismo, en vivo.
function crearEstilos(T: ReturnType<typeof construirTema>) {
  return StyleSheet.create({
    raiz: { flex: 1, backgroundColor: T.fondo },

    barra: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: T.esp,
      paddingTop: 10,
      paddingBottom: 4,
    },
    atrasBtn: { width: 36, height: 36, justifyContent: "center" },
    puntos: { flex: 1, flexDirection: "row", justifyContent: "center", gap: 8 },
    punto: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: T.superficie3,
    },

    cuerpo: { padding: T.esp, paddingTop: 26, paddingBottom: 10, flexGrow: 1 },

    centrado: { flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 30 },
    marca: { color: T.texto, fontSize: 46, fontWeight: "900", letterSpacing: -1.5 },
    frase: {
      color: T.texto,
      fontSize: 20,
      fontWeight: "700",
      marginTop: 14,
      textAlign: "center",
      letterSpacing: -0.3,
    },
    subfrase: {
      color: T.textoSuave,
      fontSize: 15,
      lineHeight: 23,
      marginTop: 12,
      textAlign: "center",
      paddingHorizontal: 12,
    },

    titulo: { color: T.texto, fontSize: 28, fontWeight: "800", letterSpacing: -0.7 },
    tituloCentro: { color: T.texto, fontSize: 26, fontWeight: "800", letterSpacing: -0.7, textAlign: "center" },
    subtitulo: { color: T.textoSuave, fontSize: 14.5, lineHeight: 22, marginTop: 8, marginBottom: 22 },

    tarjeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      backgroundColor: T.superficie,
      borderWidth: 1.5,
      borderColor: T.borde,
      borderRadius: T.radioGrande,
      padding: 18,
      marginBottom: 12,
    },
    tarjetaActiva: { borderColor: T.acento, backgroundColor: T.acentoSuave },
    tarjetaIcono: {
      width: 48,
      height: 48,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: T.bordeFuerte,
      backgroundColor: T.superficie2,
      alignItems: "center",
      justifyContent: "center",
    },
    tarjetaNombre: { color: T.texto, fontSize: 16, fontWeight: "800" },
    tarjetaDesc: { color: T.textoSuave, fontSize: 13.5, marginTop: 2 },
    tarjetaEj: { color: T.textoTenue, fontSize: 12.5, lineHeight: 18, marginTop: 5 },
    paloma: { color: T.acento, fontSize: 17, fontWeight: "900" },

    // Grid de giros (2 columnas; cada tarjeta crece a su altura natural)
    giroGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 12,
      alignItems: "flex-start",
    },
    giroTarjeta: {
      width: "47.5%",
      backgroundColor: T.superficie,
      borderWidth: 1.5,
      borderColor: T.borde,
      borderRadius: T.radioGrande,
      padding: 16,
    },
    giroIcono: {
      width: 52,
      height: 52,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: T.bordeFuerte,
      backgroundColor: T.superficie2,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    giroNombre: { color: T.texto, fontSize: 15, fontWeight: "800" },
    giroFrase: { color: T.textoTenue, fontSize: 12, lineHeight: 17, marginTop: 4 },
    giroPaloma: {
      position: "absolute",
      top: 12,
      right: 14,
      color: T.acento,
      fontSize: 16,
      fontWeight: "900",
    },

    label: {
      color: T.textoSuave,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 0.8,
      marginBottom: 8,
    },
    input: {
      backgroundColor: T.superficie2,
      borderRadius: T.radioChico,
      paddingHorizontal: 14,
      paddingVertical: 13,
      fontSize: 17,
      color: T.texto,
      borderWidth: 1,
      borderColor: T.borde,
      marginBottom: 16,
    },
    inputGrande: {
      backgroundColor: T.superficie2,
      borderRadius: T.radio,
      paddingHorizontal: 18,
      paddingVertical: 18,
      fontSize: 21,
      fontWeight: "700",
      color: T.texto,
      borderWidth: 1.5,
      borderColor: T.borde,
      marginBottom: 16,
    },
    verPin: { alignSelf: "flex-end", marginTop: -6, marginBottom: 14 },
    verPinTxt: { color: T.turquesa, fontSize: 13, fontWeight: "800" },

    errorCaja: {
      backgroundColor: T.peligroSuave,
      borderWidth: 1,
      borderColor: T.peligro,
      borderRadius: T.radioChico,
      paddingVertical: 11,
      paddingHorizontal: 14,
      marginTop: 4,
    },
    errorTxt: { color: T.peligroTexto, fontSize: 14, fontWeight: "600" },

    temaFila: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      backgroundColor: T.superficie,
      borderWidth: 1.5,
      borderColor: T.borde,
      borderRadius: T.radio,
      padding: 14,
      marginBottom: 10,
    },
    acentos: { flexDirection: "row", gap: 14, flexWrap: "wrap", marginTop: 4 },
    acentoCirculo: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
    },
    acentoActivo: { borderWidth: 3, borderColor: T.texto },
    acentoPaloma: { color: T.acentoTexto, fontSize: 15, fontWeight: "900" },

    // Cierre personalizado
    nubeIcono: {
      width: 64,
      height: 64,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: T.bordeFuerte,
      backgroundColor: T.superficie2,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 20,
    },
    cierreTxt: {
      color: T.textoSuave,
      fontSize: 15,
      lineHeight: 23,
      textAlign: "center",
      marginTop: 12,
      paddingHorizontal: 8,
    },
    sugerenciasCaja: {
      alignSelf: "stretch",
      marginTop: 18,
      gap: 10,
    },
    sugerenciaFila: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      backgroundColor: T.superficie,
      borderWidth: 1,
      borderColor: T.borde,
      borderRadius: T.radio,
      padding: 14,
    },
    sugerenciaPaloma: { color: T.acento, fontSize: 14, fontWeight: "900", marginTop: 1 },
    sugerenciaTxt: { flex: 1, color: T.textoSuave, fontSize: 13.5, lineHeight: 20 },
    nubeNota: {
      color: T.textoTenue,
      fontSize: 13,
      textAlign: "center",
      marginTop: 18,
      paddingHorizontal: 8,
    },

    pie: { padding: T.esp, paddingTop: 8 },
    boton: {
      backgroundColor: T.acento,
      borderRadius: T.radioChico + 2,
      paddingVertical: 16,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 54,
    },
    botonTxt: { color: T.acentoTexto, fontSize: 16.5, fontWeight: "800", letterSpacing: 0.2 },
    botonSecundario: {
      marginTop: 10,
      backgroundColor: T.superficie2,
      borderWidth: 1,
      borderColor: T.bordeFuerte,
      borderRadius: T.radioChico + 2,
      paddingVertical: 15,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 52,
    },
    botonSecundarioTxt: { color: T.textoSuave, fontSize: 15.5, fontWeight: "700" },
  });
}
