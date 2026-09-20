// YvexPOS Móvil — Cuenta en la nube (crear / entrar / verificar).
//
// La nube es OPCIONAL y lo decimos claro: la app ya funciona sin ella. Esto
// sirve para ver el negocio a distancia y, más adelante, compartir datos entre
// el PC y el móvil.
//
// Un solo paso: crear cuenta (o entrar) vincula este teléfono como caja.
//
// ---------------------------------------------------------------------------
// MIGRADO AL SISTEMA DE DISEÑO
// ---------------------------------------------------------------------------
// Montaba su propio Modal + SafeAreaView + KeyboardAvoidingView + CabeceraModal
// a mano, con 90 líneas de StyleSheet, un estilo de input local (`inp`) que
// ignoraba useEstiloInput, y dos componentes propios (Etiqueta, Dato) que
// duplicaban lo que ya hacen <Campo> y <Fila>.
//
// Importa porque esta pantalla se ve PRONTO: vincular la cuenta es de las
// primeras cosas que hace un tendero nuevo, y era una de las que peor
// representaba al producto.
//
// ⚠️ BUG DE COLOR CORREGIDO
// El título del aviso de verificación estaba escrito a mano:
//
//     <Text style={[e.verifTitulo, { color: "#ffe9bd" }]}>
//
// Un crema casi blanco, fijo, sobre fondo `alertaSuave`. Con el tema oscuro
// pasaba; con Papel —el tema por defecto— ese texto quedaba prácticamente
// invisible. Es exactamente lo que la regla de oro de apariencia.ts pretende
// evitar: una pantalla nunca escribe un color.
//
// El Alert.alert de cerrar sesión pasa a <Hoja> chica, como en
// ModalProveedores y ModalUsuarios: el Alert nativo es la única pieza de la
// app que no se puede tematizar.

import { useEffect, useState } from "react";
import { View, TextInput, Pressable, Linking } from "react-native";
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
import {
  prepararTrasVincular,
  readaptarCatalogoSiCambioNegocio,
} from "@/src/base/sync";
import { useTema } from "@/src/componentes/TemaProvider";
import {
  Boton,
  Banner,
  Campo,
  Hoja,
  Grupo,
  Fila,
  Txt,
  useEstiloInput,
} from "@/src/componentes/ui";

// Las mismas URL que en Ajustes. Repetidas a propósito en dos archivos y no
// extraídas a un módulo: son dos usos, y un módulo nuevo para dos constantes
// añade más indirección de la que ahorra. Si aparece un tercer uso, sí toca.
const URL_TERMINOS = "https://yvexiq.com/terminos";
const URL_PRIVACIDAD = "https://yvexiq.com/privacidad";

/**
 * Aviso de aceptación al crear cuenta.
 *
 * POR QUÉ NO HAY CASILLA QUE MARCAR
 * El consentimiento por uso —"al pulsar este botón aceptas"— es la práctica
 * habitual y es válido. Una casilla obligatoria añade un paso más a un
 * registro que ya pide cinco datos, y en un tendero con clientes esperando
 * eso es fricción real que no compra nada.
 *
 * Lo que SÍ importa legalmente es que se lea y que los documentos estén a un
 * toque. Por eso el texto NO va en gris minúsculo: va en el tono suave, con
 * los dos enlaces subrayados y en color de acento, y debajo del botón donde
 * la mirada ya está.
 */
function AvisoLegal() {
  const { tema: T } = useTema();

  // `Txt` NO acepta onPress (solo children, escala, tono, fuerte, mayus,
  // lineas y estilo), así que los enlaces van envueltos en Pressable. Se
  // comprobó antes de escribirlo: darlo por hecho habría roto la compilación.
  //
  // Fila en lugar de texto corrido con enlaces embebidos: sin onPress en Txt
  // no hay forma de hacer un enlace "dentro" de un párrafo, y simular uno con
  // posiciones absolutas se rompe en cuanto cambia la densidad o el tamaño de
  // fuente del sistema. Dos renglones centrados se leen igual de bien y no
  // dependen de dónde caiga el salto de línea.
  const enlace = { color: T.acento, textDecorationLine: "underline" as const };

  return (
    <View style={{ marginTop: T.esps.md, alignItems: "center", gap: T.esps.xs }}>
      <Txt escala="pie" tono="suave" estilo={{ textAlign: "center" }}>
        Al crear tu cuenta aceptas:
      </Txt>
      <View style={{ flexDirection: "row", alignItems: "center", gap: T.esps.md }}>
        <Pressable
          onPress={() => Linking.openURL(URL_TERMINOS)}
          hitSlop={10}
          android_ripple={{ color: T.superficie2, borderless: true }}
        >
          <Txt escala="pie" estilo={enlace}>Términos de uso</Txt>
        </Pressable>
        <Txt escala="pie" tono="tenue">·</Txt>
        <Pressable
          onPress={() => Linking.openURL(URL_PRIVACIDAD)}
          hitSlop={10}
          android_ripple={{ color: T.superficie2, borderless: true }}
        >
          <Txt escala="pie" estilo={enlace}>Aviso de privacidad</Txt>
        </Pressable>
      </View>
    </View>
  );
}

type Modo = "elegir" | "crear" | "entrar" | "cuenta";

const TITULOS: Record<Modo, string> = {
  elegir: "Cuenta y nube",
  crear: "Crear cuenta",
  entrar: "Iniciar sesión",
  cuenta: "Tu cuenta",
};

export default function ModalCuenta({
  onCerrar,
  onCambio,
}: {
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const { tema: T } = useTema();
  const estiloInput = useEstiloInput();

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
  const [confirmandoSalida, setConfirmandoSalida] = useState(false);

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
      // Si este telefono venia de OTRO negocio, sus productos quedaron
      // marcados como 'nube' de aquel y no volverian a subirse nunca: ni
      // subirCatalogoLocal() los seleccionaba ni la tarjeta para agregarlos
      // aparecia. Esto los devuelve a 'local' para que el dueno decida.
      // No sube nada solo — ver el comentario de la funcion en sync.ts.
      await readaptarCatalogoSiCambioNegocio();
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
      // Mismo motivo que en registrar(): este es el camino por el que de
      // verdad se cambia de cuenta, asi que es donde mas importa.
      await readaptarCatalogoSiCambioNegocio();
      setCuenta(c);
      setModo("cuenta");
      onCambio();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setCargando(false);
    }
  }

  async function salir() {
    setConfirmandoSalida(false);
    await cerrarSesion();
    setCuenta(await estadoCuenta());
    setModo("elegir");
    onCambio();
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

  /** Atrás: desde un formulario vuelve a elegir; desde el resto, cierra. */
  function cerrarOVolver() {
    if (modo === "crear" || modo === "entrar") {
      setModo("elegir");
      setError("");
    } else {
      onCerrar();
    }
  }

  return (
    <Hoja visible onCerrar={cerrarOVolver} titulo={TITULOS[modo]} tipo="completa">
      <Banner texto={error} tipo="error" />

      {/* ------------------------------ ELEGIR ------------------------------ */}
      {modo === "elegir" && (
        <>
          {/* Lo primero que se lee es que NO hace falta. Un tendero que abre
              esto y ve un formulario asume que la app se lo pide; que sea
              opcional tiene que ir antes que los botones, no en letra chica
              debajo. */}
          <View
            style={{
              backgroundColor: T.acentoSuave,
              borderRadius: T.radio,
              padding: T.esps.lg,
              marginBottom: T.esps.xl,
            }}
          >
            <Txt escala="cuerpo" fuerte>
              La nube es opcional
            </Txt>
            <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.xs }}>
              Tu POS ya funciona perfecto sin cuenta: vendes, manejas inventario
              y ves reportes, todo en el teléfono.
            </Txt>
            <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.sm }}>
              Vincular una cuenta te permite ver tu negocio a distancia y
              respaldar tus ventas en la nube.
            </Txt>
          </View>

          <View style={{ gap: T.esps.sm }}>
            <Boton titulo="Crear cuenta nueva" onPress={() => setModo("crear")} />
            <Boton
              titulo="Ya tengo cuenta"
              tipo="secundario"
              onPress={() => setModo("entrar")}
            />
          </View>

          <Txt escala="pie" tono="tenue" estilo={{ marginTop: T.esps.xl }}>
            Si ya usas YvexPOS en tu computadora, entra con esa misma cuenta para
            conectar los dos.
          </Txt>
        </>
      )}

      {/* ------------------------------- CREAR ------------------------------- */}
      {modo === "crear" && (
        <>
          <Campo label="Tu nombre">
            <TextInput
              style={estiloInput}
              value={nombre}
              onChangeText={setNombre}
              placeholder="Ej. María"
              placeholderTextColor={T.textoTenue}
              autoCapitalize="words"
            />
          </Campo>

          <Campo label="Correo">
            <TextInput
              style={estiloInput}
              value={email}
              onChangeText={setEmail}
              placeholder="tucorreo@ejemplo.com"
              placeholderTextColor={T.textoTenue}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Campo>

          <Campo label="Contraseña">
            <TextInput
              style={estiloInput}
              value={password}
              onChangeText={setPassword}
              placeholder="Mínimo 8 caracteres"
              placeholderTextColor={T.textoTenue}
              secureTextEntry
            />
          </Campo>

          <Campo label="Nombre de tu negocio">
            <TextInput
              style={estiloInput}
              value={negocio}
              onChangeText={setNegocio}
              placeholder="Ej. Tienda La Esquina"
              placeholderTextColor={T.textoTenue}
              autoCapitalize="words"
            />
          </Campo>

          <Campo
            label="Nombre de esta caja"
            ayuda="Así identificarás este teléfono entre tus cajas."
          >
            <TextInput
              style={estiloInput}
              value={nombreCaja}
              onChangeText={setNombreCaja}
              placeholder="Móvil"
              placeholderTextColor={T.textoTenue}
            />
          </Campo>

          <View style={{ marginTop: T.esps.md }}>
            <Boton titulo="Crear cuenta y vincular" onPress={crear} cargando={cargando} />
            <AvisoLegal />
          </View>
        </>
      )}

      {/* ------------------------------ ENTRAR ------------------------------ */}
      {modo === "entrar" && (
        <>
          <Campo label="Correo">
            <TextInput
              style={estiloInput}
              value={email}
              onChangeText={setEmail}
              placeholder="tucorreo@ejemplo.com"
              placeholderTextColor={T.textoTenue}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Campo>

          <Campo label="Contraseña">
            <TextInput
              style={estiloInput}
              value={password}
              onChangeText={setPassword}
              placeholder="Tu contraseña"
              placeholderTextColor={T.textoTenue}
              secureTextEntry
            />
          </Campo>

          <Campo
            label="Nombre de esta caja"
            ayuda="Este teléfono se añadirá como una caja más de tu negocio."
          >
            <TextInput
              style={estiloInput}
              value={nombreCaja}
              onChangeText={setNombreCaja}
              placeholder="Móvil"
              placeholderTextColor={T.textoTenue}
            />
          </Campo>

          <View style={{ marginTop: T.esps.md }}>
            <Boton titulo="Entrar y vincular" onPress={entrar} cargando={cargando} />
          </View>
        </>
      )}

      {/* ------------------------- CUENTA VINCULADA ------------------------- */}
      {modo === "cuenta" && cuenta && (
        <>
          <Banner texto={aviso} tipo="exito" />

          {/* Aviso de verificación. No bloquea nada: se puede usar la cuenta
              sin verificar, solo hace falta para recuperar la contraseña. */}
          {verificado === false && (
            <View
              style={{
                backgroundColor: T.alertaSuave,
                borderRadius: T.radio,
                padding: T.esps.lg,
                marginBottom: T.esps.xl,
              }}
            >
              {/* tono="alerta" del tema, no un hex a mano: el color anterior
                  (#ffe9bd) era casi blanco y desaparecía sobre este fondo en
                  el tema Papel. */}
              <Txt escala="cuerpo" tono="alerta" fuerte>
                Verifica tu correo
              </Txt>
              <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.xs }}>
                Te enviamos un código de 6 dígitos a {cuenta.email}. No es
                obligatorio ahora, pero lo necesitarás para recuperar tu
                contraseña.
              </Txt>
              <View
                style={{ flexDirection: "row", gap: T.esps.sm, marginTop: T.esps.md }}
              >
                <TextInput
                  style={[
                    estiloInput,
                    { flex: 1, textAlign: "center", letterSpacing: 6 },
                  ]}
                  value={codigo}
                  onChangeText={setCodigo}
                  placeholder="000000"
                  placeholderTextColor={T.textoTenue}
                  keyboardType="number-pad"
                  maxLength={6}
                />
                <Boton
                  titulo="Confirmar"
                  chico
                  onPress={confirmarCodigo}
                  cargando={cargando}
                  deshabilitado={codigo.length < 6}
                />
              </View>
              <View style={{ marginTop: T.esps.sm }}>
                <Boton
                  titulo={enviando ? "Enviando…" : "Reenviar código"}
                  tipo="fantasma"
                  chico
                  onPress={reenviarCodigo}
                  deshabilitado={enviando}
                />
              </View>
            </View>
          )}

          <Grupo>
            <Fila titulo="Cuenta" flecha={false} valor={<Txt escala="cuerpo" tono="suave" lineas={1}>{cuenta.nombre ?? "—"}</Txt>} />
            <Fila
              titulo="Correo"
              flecha={false}
              meta={verificado === true ? "Verificado" : undefined}
              valor={<Txt escala="cuerpo" tono="suave" lineas={1}>{cuenta.email ?? "—"}</Txt>}
            />
            <Fila
              titulo="Esta caja"
              flecha={false}
              meta={`Serie de folios ${cuenta.prefijoFolio ?? "?"}`}
              valor={
                <Txt escala="cuerpo" tono="suave" lineas={1}>
                  {cuenta.nombreCaja ?? "Móvil"}
                </Txt>
              }
            />
          </Grupo>

          <Txt escala="pie" tono="tenue" estilo={{ marginTop: T.esps.lg }}>
            Este teléfono está vinculado a tu negocio. La sincronización de
            ventas hacia la nube llegará en la próxima actualización.
          </Txt>

          <View style={{ marginTop: T.esps.xxl }}>
            <Boton
              titulo="Cerrar sesión"
              tipo="peligro"
              onPress={() => setConfirmandoSalida(true)}
            />
          </View>
        </>
      )}

      <View style={{ height: T.esps.xxl }} />

      {/* Confirmación de cierre de sesión: hoja chica, no Alert nativo. */}
      <Hoja
        visible={confirmandoSalida}
        onCerrar={() => setConfirmandoSalida(false)}
        titulo="Cerrar sesión"
        pie={
          <View style={{ gap: T.esps.sm }}>
            <Boton titulo="Cerrar sesión" tipo="peligro" onPress={salir} />
            <Boton
              titulo="Cancelar"
              tipo="secundario"
              onPress={() => setConfirmandoSalida(false)}
            />
          </View>
        }
      >
        <Txt escala="pie" tono="suave">
          Este teléfono dejará de estar vinculado a tu cuenta.
        </Txt>
        <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.sm }}>
          Tus productos y ventas locales NO se borran: la app sigue funcionando
          igual, solo sin nube.
        </Txt>
      </Hoja>
    </Hoja>
  );
}
