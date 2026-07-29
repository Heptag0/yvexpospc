// YvexPOS Móvil — Cuenta en la nube (crear / entrar / verificar).
//
// La nube es OPCIONAL y lo decimos claro: la app ya funciona sin ella. Esto
// sirve para ver el negocio a distancia y, más adelante, compartir datos entre
// el PC y el móvil.
//
// Un solo paso: crear cuenta (o entrar) vincula este teléfono como caja.

import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  EstadoCuenta,
  estadoCuenta,
  registrarYVincular,
  loginYVincular,
  cerrarSesion,
  estadoVerificacion,
  enviarCodigoVerificacion,
  confirmarCodigoVerificacion,
} from "@/src/base/nube";
import { prepararTrasVincular } from "@/src/base/sync";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, CabeceraModal } from "@/src/componentes/ui";

type Modo = "elegir" | "crear" | "entrar" | "cuenta";

export default function ModalCuenta({
  onCerrar,
  onCambio,
}: {
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const { tema: T } = useTema();
  const [modo, setModo] = useState<Modo>("elegir");
  const [cuenta, setCuenta] = useState<EstadoCuenta | null>(null);

  // Campos
  const [email, setEmail] = useState("");
  const [nombre, setNombre] = useState("");
  const [password, setPassword] = useState("");
  const [negocio, setNegocio] = useState("");
  const [nombreCaja, setNombreCaja] = useState("Móvil");

  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  // Verificación
  const [verificado, setVerificado] = useState<boolean | null>(null);
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    estadoCuenta().then((c) => {
      setCuenta(c);
      if (c.vinculado) setModo("cuenta");
    });
  }, []);

  // Al entrar en modo cuenta, consultar si el correo está verificado.
  useEffect(() => {
    if (modo === "cuenta" && cuenta?.sesionToken) {
      estadoVerificacion(cuenta.sesionToken)
        .then((v) => setVerificado(v.verificado))
        .catch(() => setVerificado(null)); // si falla, no molestamos
    }
  }, [modo, cuenta]);

  async function crear() {
    setError("");
    if (!email.trim() || !nombre.trim() || !password || !negocio.trim()) {
      setError("Completa todos los campos.");
      return;
    }
    setCargando(true);
    try {
      const c = await registrarYVincular({
        email,
        nombre,
        password,
        negocioNombre: negocio,
        nombreCaja,
      });
      // El turno abierto (si lo hay) debe existir en la nube antes que sus ventas.
      await prepararTrasVincular();
      setCuenta(c);
      setModo("cuenta");
      onCambio();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setCargando(false);
    }
  }

  async function entrar() {
    setError("");
    if (!email.trim() || !password) {
      setError("Escribe tu correo y contraseña.");
      return;
    }
    setCargando(true);
    try {
      const c = await loginYVincular({ email, password, nombreCaja });
      await prepararTrasVincular();
      setCuenta(c);
      setModo("cuenta");
      onCambio();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setCargando(false);
    }
  }

  function confirmarSalir() {
    Alert.alert(
      "Cerrar sesión",
      "Este teléfono dejará de estar vinculado a tu cuenta.\n\n" +
        "Tus productos y ventas locales NO se borran: la app sigue funcionando igual, " +
        "solo sin nube.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Cerrar sesión",
          style: "destructive",
          onPress: async () => {
            await cerrarSesion();
            setCuenta(await estadoCuenta());
            setModo("elegir");
            onCambio();
          },
        },
      ]
    );
  }

  async function reenviarCodigo() {
    if (!cuenta?.sesionToken) return;
    setAviso("");
    setEnviando(true);
    try {
      await enviarCodigoVerificacion(cuenta.sesionToken);
      setAviso("Código enviado. Revisa tu correo (y la carpeta de spam).");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setEnviando(false);
    }
  }

  async function confirmarCodigo() {
    if (!cuenta?.sesionToken) return;
    setError("");
    setCargando(true);
    try {
      await confirmarCodigoVerificacion(cuenta.sesionToken, codigo);
      setVerificado(true);
      setCodigo("");
      setAviso("Correo verificado.");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setCargando(false);
    }
  }

  const inp = {
    backgroundColor: T.superficie2,
    borderRadius: T.radioChico,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: T.texto,
    borderWidth: 1,
    borderColor: T.borde,
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={[e.raiz, { backgroundColor: T.fondo }]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <CabeceraModal
            titulo={
              modo === "cuenta"
                ? "Tu cuenta"
                : modo === "crear"
                ? "Crear cuenta"
                : modo === "entrar"
                ? "Iniciar sesión"
                : "Cuenta y nube"
            }
            izquierda={modo === "crear" || modo === "entrar" ? "← Atrás" : "Cerrar"}
            onIzquierda={() => {
              if (modo === "crear" || modo === "entrar") {
                setModo("elegir");
                setError("");
              } else onCerrar();
            }}
          />

          <ScrollView
            contentContainerStyle={{ padding: T.esp, paddingBottom: 50 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* ---------------- ELEGIR ---------------- */}
            {modo === "elegir" && (
              <>
                <View
                  style={[
                    e.intro,
                    { backgroundColor: T.acentoSuave, borderColor: T.acento },
                  ]}
                >
                  <Text style={[e.introTitulo, { color: T.texto }]}>
                    La nube es opcional
                  </Text>
                  <Text style={[e.introTxt, { color: T.textoSuave }]}>
                    Tu POS ya funciona perfecto sin cuenta: vendes, manejas
                    inventario y ves reportes, todo en el teléfono.
                    {"\n\n"}
                    Vincular una cuenta te permite ver tu negocio a distancia y
                    respaldar tus ventas en la nube.
                  </Text>
                </View>

                <Banner texto={error} tipo="error" />

                <View style={{ gap: 10, marginTop: 6 }}>
                  <Boton titulo="Crear cuenta nueva" onPress={() => setModo("crear")} />
                  <Boton
                    titulo="Ya tengo cuenta"
                    tipo="secundario"
                    onPress={() => setModo("entrar")}
                  />
                </View>

                <Text style={[e.pie, { color: T.textoTenue }]}>
                  Si ya usas YvexPOS en tu computadora, entra con esa misma
                  cuenta para conectar los dos.
                </Text>
              </>
            )}

            {/* ---------------- CREAR ---------------- */}
            {modo === "crear" && (
              <>
                <Banner texto={error} tipo="error" />

                <Etiqueta T={T}>Tu nombre</Etiqueta>
                <TextInput
                  style={inp}
                  value={nombre}
                  onChangeText={setNombre}
                  placeholder="Ej. María"
                  placeholderTextColor={T.textoTenue}
                />

                <Etiqueta T={T}>Correo</Etiqueta>
                <TextInput
                  style={inp}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="tucorreo@ejemplo.com"
                  placeholderTextColor={T.textoTenue}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Etiqueta T={T}>Contraseña</Etiqueta>
                <TextInput
                  style={inp}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Mínimo 8 caracteres"
                  placeholderTextColor={T.textoTenue}
                  secureTextEntry
                />

                <Etiqueta T={T}>Nombre de tu negocio</Etiqueta>
                <TextInput
                  style={inp}
                  value={negocio}
                  onChangeText={setNegocio}
                  placeholder="Ej. Tienda La Esquina"
                  placeholderTextColor={T.textoTenue}
                />

                <Etiqueta T={T}>Nombre de esta caja</Etiqueta>
                <TextInput
                  style={inp}
                  value={nombreCaja}
                  onChangeText={setNombreCaja}
                  placeholder="Móvil"
                  placeholderTextColor={T.textoTenue}
                />
                <Text style={[e.ayuda, { color: T.textoTenue }]}>
                  Así identificarás este teléfono entre tus cajas.
                </Text>

                <View style={{ marginTop: 8 }}>
                  <Boton titulo="Crear cuenta y vincular" onPress={crear} cargando={cargando} />
                </View>
              </>
            )}

            {/* ---------------- ENTRAR ---------------- */}
            {modo === "entrar" && (
              <>
                <Banner texto={error} tipo="error" />

                <Etiqueta T={T}>Correo</Etiqueta>
                <TextInput
                  style={inp}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="tucorreo@ejemplo.com"
                  placeholderTextColor={T.textoTenue}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Etiqueta T={T}>Contraseña</Etiqueta>
                <TextInput
                  style={inp}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Tu contraseña"
                  placeholderTextColor={T.textoTenue}
                  secureTextEntry
                />

                <Etiqueta T={T}>Nombre de esta caja</Etiqueta>
                <TextInput
                  style={inp}
                  value={nombreCaja}
                  onChangeText={setNombreCaja}
                  placeholder="Móvil"
                  placeholderTextColor={T.textoTenue}
                />
                <Text style={[e.ayuda, { color: T.textoTenue }]}>
                  Este teléfono se añadirá como una caja más de tu negocio.
                </Text>

                <View style={{ marginTop: 8 }}>
                  <Boton titulo="Entrar y vincular" onPress={entrar} cargando={cargando} />
                </View>
              </>
            )}

            {/* ---------------- CUENTA VINCULADA ---------------- */}
            {modo === "cuenta" && cuenta && (
              <>
                <Banner texto={error} tipo="error" />
                <Banner texto={aviso} tipo="exito" />

                {/* Aviso suave de verificación (no bloquea nada) */}
                {verificado === false && (
                  <View
                    style={[
                      e.verifCaja,
                      { backgroundColor: T.alertaSuave, borderColor: T.alerta },
                    ]}
                  >
                    <Text style={[e.verifTitulo, { color: "#ffe9bd" }]}>
                      Verifica tu correo
                    </Text>
                    <Text style={[e.verifTxt, { color: T.textoSuave }]}>
                      Te enviamos un código de 6 dígitos a {cuenta.email}. No es
                      obligatorio ahora, pero lo necesitarás para recuperar tu
                      contraseña.
                    </Text>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                      <TextInput
                        style={[inp, { flex: 1, textAlign: "center", fontWeight: "800", letterSpacing: 3 }]}
                        value={codigo}
                        onChangeText={setCodigo}
                        placeholder="000000"
                        placeholderTextColor={T.textoTenue}
                        keyboardType="number-pad"
                        maxLength={6}
                      />
                      <Pressable
                        style={[e.btnCod, { backgroundColor: T.acento }]}
                        onPress={confirmarCodigo}
                        disabled={cargando || codigo.length < 6}
                      >
                        <Text style={[e.btnCodTxt, { color: T.acentoTexto }]}>Confirmar</Text>
                      </Pressable>
                    </View>
                    <Pressable onPress={reenviarCodigo} disabled={enviando}>
                      <Text style={[e.reenviar, { color: T.turquesa }]}>
                        {enviando ? "Enviando…" : "Reenviar código"}
                      </Text>
                    </Pressable>
                  </View>
                )}

                <View style={[e.tarjeta, { backgroundColor: T.superficie, borderColor: T.borde }]}>
                  <Dato T={T} lbl="CUENTA" val={cuenta.nombre ?? "—"} />
                  <Dato T={T} lbl="CORREO" val={cuenta.email ?? "—"} />
                  <Dato
                    T={T}
                    lbl="ESTA CAJA"
                    val={`${cuenta.nombreCaja ?? "Móvil"}  ·  serie ${cuenta.prefijoFolio ?? "?"}`}
                  />
                  {verificado === true && (
                    <Dato T={T} lbl="CORREO" val="Verificado" color={T.exito} />
                  )}
                </View>

                <View
                  style={[
                    e.notaCaja,
                    { backgroundColor: T.superficie, borderColor: T.borde },
                  ]}
                >
                  <Text style={[e.notaTxt, { color: T.textoSuave }]}>
                    Este teléfono está vinculado a tu negocio. La sincronización
                    de ventas hacia la nube llegará en la próxima actualización.
                  </Text>
                </View>

                <View style={{ marginTop: 18 }}>
                  <Boton titulo="Cerrar sesión" tipo="peligro" onPress={confirmarSalir} />
                </View>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function Etiqueta({ children, T }: { children: string; T: any }) {
  return (
    <Text
      style={{
        color: T.textoSuave,
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        marginBottom: 7,
        marginTop: 16,
      }}
    >
      {children}
    </Text>
  );
}

function Dato({
  lbl,
  val,
  T,
  color,
}: {
  lbl: string;
  val: string;
  T: any;
  color?: string;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: T.textoTenue, fontSize: 10, fontWeight: "800", letterSpacing: 0.8 }}>
        {lbl}
      </Text>
      <Text style={{ color: color ?? T.texto, fontSize: 15, fontWeight: "700", marginTop: 2 }}>
        {val}
      </Text>
    </View>
  );
}

const e = StyleSheet.create({
  raiz: { flex: 1 },
  intro: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 18 },
  introTitulo: { fontSize: 16, fontWeight: "800", marginBottom: 6 },
  introTxt: { fontSize: 14, lineHeight: 21 },
  pie: { fontSize: 12.5, lineHeight: 19, textAlign: "center", marginTop: 20 },
  ayuda: { fontSize: 12, marginTop: 6 },
  tarjeta: { borderRadius: 16, borderWidth: 1, padding: 16 },
  notaCaja: { borderRadius: 12, borderWidth: 1, padding: 14, marginTop: 12 },
  notaTxt: { fontSize: 13, lineHeight: 19 },
  verifCaja: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 16 },
  verifTitulo: { fontSize: 15, fontWeight: "800", marginBottom: 5 },
  verifTxt: { fontSize: 13, lineHeight: 19 },
  btnCod: {
    borderRadius: 10,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  btnCodTxt: { fontSize: 14, fontWeight: "800" },
  reenviar: { fontSize: 13, fontWeight: "700", textAlign: "center", marginTop: 12 },
});
