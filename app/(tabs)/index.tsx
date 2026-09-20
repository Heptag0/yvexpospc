// YvexPOS Móvil — Pantalla INICIO.
//
// ---------------------------------------------------------------------------
// QUÉ RESPONDE ESTA PANTALLA
// ---------------------------------------------------------------------------
// UNA sola pregunta: ¿cómo va mi negocio AHORA MISMO?
//   · Cuánto llevo vendido hoy   (la única protagonista)
//   · Cómo va el turno
//   · Quién está vendiendo y cómo va la nube
//   · La última venta, en una línea
//
// Todo lo demás salió de aquí. Departamentos, proveedores, cotizaciones o la
// tienda en línea son HERRAMIENTAS: se usan de vez en cuando y se abren a
// propósito. Listarlas en Inicio convertía el tablero en un menú disfrazado,
// y obligaba a pasar por encima de nueve filas para ver dos cifras.
//
// Las últimas ventas eran una lista de seis. Se queda UNA línea: sirve para
// "¿sí pasó el cobro?", que es un caso real. El historial vive en Reportes,
// que es donde alguien va a buscarlo de verdad.
//
// ---------------------------------------------------------------------------
// CÓMO SE ENTRA A LAS HERRAMIENTAS — hay dos variantes, se elige abajo
// ---------------------------------------------------------------------------
// Cambia VARIANTE_PANEL y compara. El panel es el mismo en ambas: solo cambia
// la puerta.
//
//   "tirador"  Barra fija sobre las pestañas. Se abre tocándola o
//              arrastrándola hacia arriba. Siempre a mano, en la zona del
//              pulgar, y no gasta un destino de navegación.
//              El gesto NO es la única vía: quien no lo descubra, la toca.
//
//   "cajon"    Bloque dentro del contenido. Imposible de no ver, cero
//              gestos que aprender. A cambio se va con el scroll: si el
//              usuario bajó, tiene que subir para alcanzarlo.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  View,
  Pressable,
  StyleSheet,
  RefreshControl,
  TextInput,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  interpolate,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, router } from "expo-router";
import {
  Turno,
  ResumenHoy,
  VentaReciente,
  turnoActivo,
  resumenHoy,
  ventasRecientes,
  corteTurno,
  cerrarTurno,
  leerConteoCiegoActivo,
  registrarConteoTurno,
  registrarMovimientoBolsa,
} from "@/src/base/venta";
import { pesos, fmtFecha, aCentavos } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import { useReduceMotion } from "@/src/componentes/useReduceMotion";
import BotonYaxo from "@/src/componentes/BotonYaxo";
import {
  Pantalla,
  Encabezado,
  Seccion,
  Lamina,
  Grupo,
  Fila,
  Txt,
  Monto,
  Vacio,
  Hoja,
  Boton,
  Campo,
  Banner,
  useEstiloInput,
} from "@/src/componentes/ui";
import ModalDepartamentos from "@/src/componentes/ModalDepartamentos";
import { IconoUI } from "@/src/componentes/iconos";
import ModalUsuarios from "@/src/componentes/ModalUsuarios";
import { UsuarioPOS, usuarioActivo, asegurarUsuario } from "@/src/base/usuarios";
import ModalSync from "@/src/componentes/ModalSync";
import { EstadoSync, estadoSync, sincronizarSiAuto, leerSyncAuto } from "@/src/base/sync";
import { leerNombreNegocio } from "@/src/base/giro";
import { leerModoUso, ModoUso } from "@/src/base/modoUso";
import { AvisoVisita, avisosDeVisita } from "@/src/base/proveedores";
import { hoyYmd } from "@/src/base/visitas";
import ModalProveedores from "@/src/componentes/ModalProveedores";
import ModalLealtad from "@/src/componentes/ModalLealtad";
import ModalTienda from "@/src/componentes/ModalTienda";
import ModalPedidosWeb from "@/src/componentes/ModalPedidosWeb";
import ModalCotizaciones from "@/src/componentes/ModalCotizaciones";
import ModalDevoluciones from "@/src/componentes/ModalDevoluciones";
import { estadoTienda } from "@/src/base/tienda";
import { leerReglas } from "@/src/base/lealtad";
import ModalDinero from "@/src/componentes/ModalDinero";
import ModalEtiquetas from "@/src/componentes/ModalEtiquetas";
import ModalRecetas from "@/src/componentes/ModalRecetas";
import ModalCredito from "@/src/componentes/ModalCredito";
import ModalMovimientoCaja from "@/src/componentes/ModalMovimientoCaja";
import {
  PanelHerramientas,
  useCajonAnim,
  TiradorHerramientas,
  CajonHerramientas,
} from "@/src/componentes/PanelHerramientas";
import {
  IdHerramienta,
  TODAS_HERRAMIENTAS,
  herramientaPorId,
  leerAncladas,
  MAX_ANCLADAS,
  leerAccesosOcultos,
  guardarAccesosOcultos,
} from "@/src/base/herramientas";
import { permisosActuales, type MapaPermisos } from "@/src/base/permisos";
import {
  Mision,
  obtenerMisiones,
  festejoVisto,
  marcarFestejoVisto,
} from "@/src/base/misiones";
import { sonidoExito } from "@/src/base/sonidos";

type Tema = ReturnType<typeof useTema>["tema"];
type Corte = Awaited<ReturnType<typeof corteTurno>>;

// La bandera que decide la puerta de entrada al panel. Cambia esto y prueba.
const VARIANTE_PANEL: "tirador" | "cajon" = "tirador";


// ---------------------------------------------------------------------------
// Aviso descartable
// ---------------------------------------------------------------------------
// Un aviso es un HECHO que acaba de pasar y que se puede atender: llegó un
// pedido, hoy visita un proveedor, un producto se quedó en negativo. NO es un
// estado permanente: "3 productos sin sellos NOM" en un abarrotes que nunca
// usará esa herramienta sería ruido eterno, y un aviso que no se puede quitar
// deja de leerse a los dos días.
//
// Por eso se descartan deslizando a un lado, como las notificaciones del
// teléfono: el gesto ya lo conoce todo el mundo y no hay que enseñarlo. El
// descarte es de esta sesión — si el hecho sigue vigente mañana, el aviso
// vuelve. Es deliberado: descartar significa "ya lo vi", no "no me lo
// vuelvas a decir nunca".
// REGLA GENERAL PARA CUALQUIER AVISO NUEVO QUE SE AÑADA AQUÍ
// ---------------------------------------------------------------------------
// Descartar un aviso NUNCA silencia a la herramienta que lo emitió. Se
// comporta como una notificación del teléfono: si vuelve a pasar algo, vuelve
// a avisar.
//
// Para conseguirlo, la clave de descarte tiene que ser la IDENTIDAD DEL
// HECHO, no el nombre de la herramienta:
//
//   MAL   "proveedores"            -> lo descartas una vez y no vuelve nunca
//   MAL   "proveedores:1"          -> otro proveedor distinto sigue siendo 1
//   BIEN  "proveedores:<día>:<quién>~<cuándo>"
//
// La regla práctica: si el usuario consideraría que "ha pasado algo nuevo",
// la clave DEBE cambiar. Ante la duda, mete más cosas en la clave: un aviso
// repetido molesta un segundo; uno que no llega puede costar una venta.
//
// Lo que NO resuelve esto y necesita su propio diseño: la frecuencia. Un
// aviso de crédito ("$310 por cobrar") es un estado que sigue siendo verdad
// mañana, así que no debe salir cada día — necesita una cadencia propia
// (cada 2 o 3 días, configurable). Eso va en la herramienta que lo emite, no
// aquí.
function AvisoDescartable({
  children,
  onDescartar,
}: {
  children: ReactNode;
  onDescartar: () => void;
}) {
  const x = useSharedValue(0);

  const gesto = Gesture.Pan()
    .activeOffsetX([-14, 14]) // no robar el scroll vertical de la pantalla
    .onUpdate((e) => {
      x.value = e.translationX;
    })
    .onEnd((e) => {
      const fuera = Math.abs(e.translationX) > 110 || Math.abs(e.velocityX) > 780;
      if (fuera) {
        // La llamada va enganchada a ESTA animación, no a una segunda en
        // paralelo: cuando la tarjeta termina de salir, se descarta.
        x.value = withTiming(
          e.translationX > 0 ? 500 : -500,
          { duration: 160 },
          (fin) => {
            "worklet";
            if (fin) runOnJS(onDescartar)();
          }
        );
      } else {
        x.value = withSpring(0, { damping: 18, stiffness: 220 });
      }
    });

  const estilo = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    opacity: interpolate(Math.abs(x.value), [0, 140], [1, 0.35]),
  }));

  return (
    <GestureDetector gesture={gesto}>
      <Animated.View style={estilo}>{children}</Animated.View>
    </GestureDetector>
  );
}

// ===========================================================================
// Celebración de misiones completas (una sola vez en la vida de la app)
// ===========================================================================

/** Partícula de confeti. Trayectoria determinista por índice: sube un poco y
 *  cae mientras se desvanece. Los colores salen del tema, así se ve bien en
 *  los 7 temas, claros y oscuros. */
function Particula({ i, T }: { i: number; T: Tema }) {
  const cfg = useMemo(() => {
    const r = (n: number) => {
      const x = Math.sin(i * 127.1 + n * 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    return {
      dx: (r(1) - 0.5) * 230,
      sube: 40 + r(2) * 70,
      cae: 120 + r(3) * 120,
      dur: 950 + r(4) * 750,
      delay: r(5) * 260,
      tam: 5 + r(6) * 5,
      // Antes el tercer color era T.turquesa (el segundo acento fantasma).
      // Ahora: acento, éxito y el acento atenuado — una sola familia.
      color: [T.acento, T.exito, T.acentoBorde][i % 3],
      rombo: i % 2 === 1,
      giro: (r(7) - 0.5) * 340,
    };
  }, [i, T.acento, T.exito, T.acentoBorde]);

  const p = useSharedValue(0);
  useEffect(() => {
    const t = setTimeout(() => {
      p.value = withTiming(1, { duration: cfg.dur });
    }, cfg.delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const st = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.12, 0.72, 1], [0, 1, 1, 0]),
    transform: [
      { translateX: cfg.dx * p.value },
      { translateY: -cfg.sube * p.value + cfg.cae * p.value * p.value },
      { rotate: `${cfg.giro * p.value}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          top: 60,
          left: "50%",
          width: cfg.tam,
          height: cfg.tam,
          borderRadius: cfg.rombo ? 2 : cfg.tam / 2,
          backgroundColor: cfg.color,
        },
        st,
      ]}
    />
  );
}

/** Tarjeta de celebración: entra con resorte + fade, ráfaga de confeti y
 *  sonidoExito() la primera vez. "Entendido" cierra con animación de salida. */
function Celebracion({ T, onCerrar }: { T: Tema; onCerrar: () => void }) {
  const reducirMovimiento = useReduceMotion();
  const entrada = useSharedValue(0);
  const salida = useSharedValue(0);

  useEffect(() => {
    sonidoExito();
    void marcarFestejoVisto(); // la celebración se vive una sola vez
    entrada.value = reducirMovimiento ? 1 : withSpring(1, { damping: 13, stiffness: 170 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stCard = useAnimatedStyle(() => ({
    opacity: entrada.value * (1 - salida.value),
    transform: [{ scale: (0.85 + 0.15 * entrada.value) * (1 - 0.08 * salida.value) }],
  }));

  function cerrar() {
    salida.value = reducirMovimiento ? 1 : withTiming(1, { duration: 180 });
    setTimeout(onCerrar, reducirMovimiento ? 0 : 190);
  }

  return (
    <View
      style={{
        marginBottom: T.esps.xl,
        alignItems: "center",
        justifyContent: "center",
      }}
      pointerEvents="box-none"
    >
      <Animated.View
        style={[
          {
            width: "100%",
            backgroundColor: T.superficie,
            borderRadius: T.radioGrande,
            padding: T.esps.xl,
            gap: T.esps.md,
            borderWidth: 1,
            borderColor: T.acentoBorde,
            shadowColor: T.acento,
            shadowOpacity: 0.3,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
          },
          stCard,
        ]}
      >
        <Txt escala="titulo" fuerte>
          Tu negocio ya está listo para despegar
        </Txt>
        <Txt escala="pie" tono="suave">
          Nombre, catálogo, primeras ventas y ese toque final de tu giro: lo
          esencial quedó en su lugar. Ahora sí, a venderle con todo.
        </Txt>
        {/* CÓDIGO PROMOCIONAL: cuando exista el paywall, insertar aquí el
            código de descuento de bienvenida. La celebración es el momento de
            mayor cariño del usuario: es el lugar natural para ese regalo. */}
        <View style={{ marginTop: T.esps.xs }}>
          <Boton titulo="Entendido" chico onPress={cerrar} />
        </View>
      </Animated.View>
      {/* Confeti: puramente decorativo, partículas que se mueven por la
          pantalla — justo lo que un ajuste de movimiento reducido pide
          evitar. Sin él, la tarjeta y el mensaje se ven exactamente igual;
          no se pierde nada funcional al quitarlo. */}
      {!reducirMovimiento &&
        Array.from({ length: 14 }, (_, i) => <Particula key={i} i={i} T={T} />)}
    </View>
  );
}

// ===========================================================================
// HOJA DE CORTE — reemplaza el Alert nativo
// ===========================================================================
//
// Formato de ticket: las cifras bajan en columna, alineadas con Plex Mono
// tabular, y el efectivo esperado cierra en grande. Es el número que el
// tendero va a comparar contra lo que tiene en el cajón, así que es lo único
// que crece.
//
// Las dos acciones viven abajo, en la zona del pulgar. "Seguir vendiendo"
// primero por peso visual: cerrar el turno es la decisión irreversible.
function HojaCorte({
  visible,
  corte,
  turno,
  conteoCiegoActivo,
  onCerrarTurno,
  onSeguir,
}: {
  visible: boolean;
  corte: Corte | null;
  turno: Turno | null;
  /** Si está activo, el efectivo esperado y el desglose de efectivo se
   *  ocultan hasta que el cajero captura lo que contó — mostrar el desglose
   *  antes dejaría reconstruir el esperado a mano (fondo + efectivo +
   *  entradas − salidas), así que no basta con ocultar solo el resultado
   *  final. Ver nota completa más abajo. */
  conteoCiegoActivo: boolean;
  onCerrarTurno: () => void;
  onSeguir: () => void;
}) {
  const { tema: T } = useTema();
  const estiloInput = useEstiloInput();
  const [cerrando, setCerrando] = useState(false);
  const [errorCierre, setErrorCierre] = useState("");
  const [contadoTexto, setContadoTexto] = useState("");
  const [registrandoConteo, setRegistrandoConteo] = useState(false);
  const [resultadoConteo, setResultadoConteo] = useState<{ diferenciaCentavos: number } | null>(null);
  const [errorConteo, setErrorConteo] = useState("");
  const [registrandoBolsa, setRegistrandoBolsa] = useState(false);
  const [bolsaRegistrada, setBolsaRegistrada] = useState(false);

  // Cada vez que se abre un corte nuevo, el conteo anterior no debe
  // arrastrarse — si no, cerrar un turno y abrir el siguiente heredaría la
  // respuesta del turno pasado.
  useEffect(() => {
    if (visible) {
      setContadoTexto("");
      setResultadoConteo(null);
      setErrorConteo("");
      setErrorCierre("");
      setBolsaRegistrada(false);
    }
  }, [visible]);

  if (!corte) return null;

  // ¿Ya se puede mostrar el desglose de efectivo? Con el conteo a ciegas
  // apagado, siempre. Con el conteo a ciegas prendido, solo después de que
  // el cajero confirmó lo que contó — antes de eso, "Cómo te pagaron" y
  // "Movimientos de caja" se quedan ocultos A PROPÓSITO: fondo + efectivo +
  // entradas − salidas ES el efectivo esperado, así que enseñar esas partes
  // sueltas sería lo mismo que enseñar la respuesta.
  const puedeVerDesglose = !conteoCiegoActivo || resultadoConteo !== null;

  const linea = (etiqueta: string, valor: string, tono?: "suave" | "peligro") => (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: T.esps.sm,
      }}
    >
      <Txt escala="pie" tono="suave">
        {etiqueta}
      </Txt>
      <Monto texto={valor} escala="pie" tono={tono === "peligro" ? "peligro" : "principal"} />
    </View>
  );

  async function confirmarConteo() {
    if (!turno) return;
    setErrorConteo("");
    if (contadoTexto.trim() === "") {
      setErrorConteo("Escribe cuánto contaste en el cajón.");
      return;
    }
    const centavos = aCentavos(contadoTexto);
    if (centavos < 0) {
      setErrorConteo("Ese monto no es válido.");
      return;
    }
    setRegistrandoConteo(true);
    try {
      const r = await registrarConteoTurno(turno, centavos);
      setResultadoConteo(r);
    } catch (e: any) {
      setErrorConteo(e?.message ?? String(e));
    } finally {
      setRegistrandoConteo(false);
    }
  }

  async function agregarABolsa() {
    if (!turno || !resultadoConteo) return;
    setRegistrandoBolsa(true);
    try {
      await registrarMovimientoBolsa(turno.id, resultadoConteo.diferenciaCentavos);
      setBolsaRegistrada(true);
    } finally {
      setRegistrandoBolsa(false);
    }
  }

  // Con el conteo a ciegas activo, cerrar el turno sin haber contado
  // primero dejaría la función entera sin efecto — el mismo hueco que tenía
  // el corte antes de todo esto. Se exige confirmar el conteo primero.
  const cierreBloqueado = conteoCiegoActivo && resultadoConteo === null;

  return (
    <Hoja
      visible={visible}
      onCerrar={onSeguir}
      titulo="Corte del turno"
      tipo="completa"
      pie={
        <View style={{ gap: T.esps.sm }}>
          <Boton titulo="Seguir vendiendo" tipo="secundario" onPress={onSeguir} />
          <Boton
            titulo="Cerrar turno"
            tipo="peligro"
            cargando={cerrando}
            deshabilitado={cierreBloqueado}
            onPress={async () => {
              setErrorCierre("");
              setCerrando(true);
              try {
                await onCerrarTurno();
              } catch (e: any) {
                // Antes: sin try/catch, un error aquí (p. ej. "este turno
                // lo abrió otro usuario") dejaba el botón trabado en
                // "cargando" para siempre y el usuario nunca veía por qué.
                setErrorCierre(e?.message ?? String(e));
              } finally {
                setCerrando(false);
              }
            }}
          />
        </View>
      }
    >
      <Banner texto={errorCierre} tipo="error" />

      {/* Lo vendido: la lámina de esta hoja. No revela nada del efectivo en
          el cajón (mezcla tarjeta y efectivo), así que se ve siempre. */}
      <Lamina>
        <Txt escala="micro" tono="suave" fuerte mayus>
          Vendido en el turno
        </Txt>
        <View style={{ marginTop: T.esps.xs }}>
          <Monto texto={pesos(corte.total_centavos)} escala="protagonista" />
        </View>
        <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.xs }}>
          {corte.tickets} {corte.tickets === 1 ? "ticket" : "tickets"}
        </Txt>
      </Lamina>

      <View style={{ height: T.esps.xl }} />

      {!puedeVerDesglose ? (
        // --- Conteo a ciegas: aquí va el conteo, no la respuesta ---
        <View
          style={{
            backgroundColor: T.acentoSuave,
            borderRadius: T.radio,
            padding: T.esps.lg,
            borderWidth: 1,
            borderColor: T.acentoBorde,
          }}
        >
          <Txt escala="micro" tono="suave" fuerte mayus>
            ¿Cuánto contaste en el cajón?
          </Txt>
          <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.xs, marginBottom: T.esps.md }}>
            Cuenta todo el efectivo físico primero. Al confirmar se revela si
            cuadra o no — así el conteo no se ajusta viendo la respuesta antes.
          </Txt>
          <Campo label="Efectivo contado">
            <TextInput
              style={estiloInput}
              value={contadoTexto}
              onChangeText={setContadoTexto}
              placeholder="0.00"
              placeholderTextColor={T.textoTenue}
              keyboardType="decimal-pad"
              autoFocus
            />
          </Campo>
          <Banner texto={errorConteo} tipo="error" />
          <Boton titulo="Confirmar conteo" onPress={confirmarConteo} cargando={registrandoConteo} />
        </View>
      ) : (
        <>
          {/* Desglose, en formato de ticket impreso. */}
          <View
            style={{
              backgroundColor: T.superficie,
              borderRadius: T.radio,
              paddingHorizontal: T.esps.lg,
              paddingVertical: T.esps.md,
            }}
          >
            <Txt escala="micro" tono="suave" fuerte mayus>
              Cómo te pagaron
            </Txt>
            {linea("Efectivo", pesos(corte.efectivo_centavos))}
            {linea("Tarjeta", pesos(corte.tarjeta_centavos))}
            {corte.transferencia_centavos > 0
              ? linea("Transferencia", pesos(corte.transferencia_centavos))
              : null}
            {corte.credito_centavos > 0
              ? linea("Crédito (fiado)", pesos(corte.credito_centavos))
              : null}

            <View
              style={{
                height: StyleSheet.hairlineWidth,
                backgroundColor: T.borde,
                marginVertical: T.esps.sm,
              }}
            />

            <Txt escala="micro" tono="suave" fuerte mayus>
              Movimientos de caja
            </Txt>
            {linea("Fondo inicial", pesos(corte.fondo_centavos))}
            {corte.entradas_centavos > 0
              ? linea("Entradas de efectivo", pesos(corte.entradas_centavos))
              : null}
            {corte.salidas_centavos > 0
              ? linea("Salidas de efectivo", `−${pesos(corte.salidas_centavos)}`, "peligro")
              : null}
            {corte.devoluciones_efectivo_centavos > 0
              ? linea("Devoluciones en efectivo", `−${pesos(corte.devoluciones_efectivo_centavos)}`, "peligro")
              : null}
          </View>

          <View style={{ height: T.esps.lg }} />

          {/* El número que se compara contra el cajón. */}
          <View
            style={{
              backgroundColor: T.acentoSuave,
              borderRadius: T.radio,
              padding: T.esps.lg,
              borderWidth: 1,
              borderColor: T.acentoBorde,
            }}
          >
            <Txt escala="micro" tono="suave" fuerte mayus>
              Efectivo esperado en cajón
            </Txt>
            <View style={{ marginTop: T.esps.xs }}>
              <Monto texto={pesos(corte.efectivo_esperado_centavos)} escala="titulo" tono="acento" />
            </View>
            {!conteoCiegoActivo && (
              <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.xs }}>
                Cuenta el cajón y compáralo con esta cifra antes de cerrar.
              </Txt>
            )}
          </View>

          {/* Resultado del conteo a ciegas: solo aparece tras confirmar. */}
          {conteoCiegoActivo && resultadoConteo !== null && (
            <View style={{ marginTop: T.esps.lg }}>
              <View
                style={{
                  backgroundColor:
                    resultadoConteo.diferenciaCentavos === 0
                      ? T.exitoSuave
                      : T.peligroSuave,
                  borderRadius: T.radio,
                  padding: T.esps.lg,
                  borderWidth: 1,
                  borderColor:
                    resultadoConteo.diferenciaCentavos === 0 ? T.exito : T.peligro,
                }}
              >
                <Txt escala="micro" tono="suave" fuerte mayus>
                  {resultadoConteo.diferenciaCentavos === 0
                    ? "Cuadró exacto"
                    : resultadoConteo.diferenciaCentavos > 0
                    ? "Sobró"
                    : "Faltó"}
                </Txt>
                <View style={{ marginTop: T.esps.xs }}>
                  <Monto
                    texto={pesos(Math.abs(resultadoConteo.diferenciaCentavos))}
                    escala="titulo"
                    tono={
                      resultadoConteo.diferenciaCentavos === 0
                        ? "exito"
                        : "peligro"
                    }
                  />
                </View>
                <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.xs }}>
                  Contaste {pesos(aCentavos(contadoTexto))} contra{" "}
                  {pesos(corte.efectivo_esperado_centavos)} esperado.
                </Txt>
              </View>

              {resultadoConteo.diferenciaCentavos !== 0 && (
                <View style={{ marginTop: T.esps.md }}>
                  {bolsaRegistrada ? (
                    <Txt escala="pie" tono="exito" fuerte estilo={{ textAlign: "center" }}>
                      ✓ Registrado en la bolsa de caja
                    </Txt>
                  ) : (
                    <Boton
                      titulo="Registrar en la bolsa del negocio"
                      tipo="secundario"
                      onPress={agregarABolsa}
                      cargando={registrandoBolsa}
                    />
                  )}
                </View>
              )}
            </View>
          )}
        </>
      )}
    </Hoja>
  );
}

// ===========================================================================
// PANTALLA
// ===========================================================================

export default function InicioScreen() {
  const { tema: T } = useTema();
  const [turno, setTurno] = useState<Turno | null>(null);
  const [resumen, setResumen] = useState<ResumenHoy | null>(null);
  const [recientes, setRecientes] = useState<VentaReciente[]>([]);
  const [refrescando, setRefrescando] = useState(false);
  const [usuario, setUsuario] = useState<UsuarioPOS | null>(null);
  const [sync, setSync] = useState<EstadoSync | null>(null);
  const [syncAuto, setSyncAuto] = useState<boolean>(true);
  const [negocio, setNegocio] = useState<string | null>(null);
  const [misiones, setMisiones] = useState<Mision[] | null>(null);
  const [festejo, setFestejo] = useState(false);
  const [avisosProv, setAvisosProv] = useState<AvisoVisita[]>([]);
  const [modoUso, setModoUso] = useState<ModoUso>("ambos");
  const [lealtadActiva, setLealtadActiva] = useState(true);
  // Conteo a ciegas del corte de turno: opcional, se lee de Ajustes. Con
  // esto activo, HojaCorte oculta el efectivo esperado hasta que el
  // cajero captura lo que contó.
  const [conteoCiegoActivo, setConteoCiegoActivo] = useState(false);
  // Badge de pedidos web nuevos (viene de /api/tienda/estado, tolerante a
  // offline: null → 0 y la fila se muestra igual).
  const [pedidosNuevos, setPedidosNuevos] = useState(0);
  // Avisos descartados. Se comportan como las notificaciones del teléfono:
  // descartar una NO silencia las siguientes.
  //
  // La clave identifica el HECHO concreto, no el tipo de aviso:
  //   pedidos      -> cuántos hay pendientes
  //   proveedores  -> QUIÉNES vienen y QUÉ DÍA
  //
  // Por qué la identidad y no la cantidad: si el miércoles visita un
  // proveedor y descartas el aviso, y el viernes visita OTRO, la cantidad
  // sigue siendo 1 — con una clave por cantidad el segundo aviso nunca
  // aparecería. Con la identidad, la clave cambia y vuelve a avisar, que es
  // lo que hace WhatsApp cuando borras una notificación y llega otro
  // mensaje.
  //
  // Vive en memoria, no en la base: descartar significa "ya lo vi", no
  // "silencia esta herramienta". Para eso, más adelante, un ajuste de qué
  // herramientas pueden avisar.
  const [descartados, setDescartados] = useState<Set<string>>(new Set());
  const descartar = useCallback((id: string) => {
    setDescartados((s) => new Set(s).add(id));
  }, []);

  // Identidad del aviso de proveedores: QUIÉN visita, CUÁNDO ("hoy",
  // "mañana"…) y en qué día se está avisando.
  //
  // La etiqueta forma parte de la identidad a propósito: "mañana llega
  // Coca" y "hoy llega Coca" son hechos DISTINTOS aunque sea el mismo
  // proveedor. Sin ella, descartar el domingo el aviso de "mañana llega"
  // enterraba también el del lunes "hoy llega" — que es justo el que
  // importa. Y la semana siguiente los dos vuelven a salir, porque cambia
  // la fecha.
  const firmaProv = useMemo(
    () =>
      `proveedores:${new Date().toDateString()}:${avisosProv
        .map((a) => `${a.etiqueta}~${a.proveedor.nombre}`)
        .sort()
        .join("|")}`,
    [avisosProv]
  );

  // Un solo estado para saber qué herramienta está abierta, en vez de nueve
  // banderas booleanas independientes que podían quedar en estados imposibles
  // (dos modales "abiertos" a la vez).
  const [abierta, setAbierta] = useState<IdHerramienta | null>(null);
  const [permisos, setPermisos] = useState<MapaPermisos | null>(null);
  const [panelAbierto, setPanelAbierto] = useState(false);
  // Valores compartidos entre el tirador y la hoja: son los que permiten que
  // arrastrar el primero mueva la segunda fotograma a fotograma. Se crean
  // aquí porque es el único sitio que ve a las dos piezas.
  const cajon = useCajonAnim();
  // Estables a propósito: TiradorHerramientas memoiza el gesto con estas dos
  // funciones entre sus dependencias. Con flechas creadas en cada render, el
  // gesto se reconstruiría mientras el dedo está encima y el arrastre se
  // cortaría a media apertura.
  const abrirPanel = useCallback(() => setPanelAbierto(true), []);
  const cerrarPanel = useCallback(() => setPanelAbierto(false), []);
  const [accesosOcultos, setAccesosOcultos] = useState(false);

  // Estados que el panel NO puede calcular en local porque dependen del
  // servidor. Solo se inyecta lo que este archivo ya consultó de verdad
  // (num_pedidos_nuevos): el resto de herramientas resuelve su estado por SQL
  // en src/base/estadoHerramientas.ts.
  const estadosRemotos = useMemo(
    () =>
      pedidosNuevos > 0
        ? {
            pedidos: {
              texto: `${pedidosNuevos} ${
                pedidosNuevos === 1 ? "pedido nuevo" : "pedidos nuevos"
              } sin atender`,
              atencion: true,
            },
          }
        : {},
    [pedidosNuevos]
  );
  const [ancladas, setAncladas] = useState<IdHerramienta[]>([]);
  const [usuariosAbierto, setUsuariosAbierto] = useState(false);
  const [syncAbierto, setSyncAbierto] = useState(false);
  const [movimientoAbierto, setMovimientoAbierto] = useState(false);
  const [corte, setCorte] = useState<Corte | null>(null);

  const cargar = useCallback(async () => {
    // Garantiza usuario activo si ya existen usuarios. Si la base está limpia
    // (sin onboarding hecho), manda al asistente: aquí nunca se crea un PIN
    // por defecto.
    const asegurado = await asegurarUsuario();
    if (!asegurado) {
      router.replace("/onboarding");
      return;
    }
    const [t, r, v, u, perm] = await Promise.all([
      turnoActivo(),
      resumenHoy(),
      ventasRecientes(6),
      usuarioActivo(),
      permisosActuales(),
    ]);
    setTurno(t);
    setResumen(r);
    setRecientes(v);
    setUsuario(u);
    setPermisos(perm);
    setSync(await estadoSync());
    setSyncAuto(await leerSyncAuto());
    setNegocio(await leerNombreNegocio());
    // Programa de lealtad: si está apagado, la herramienta no aparece.
    setLealtadActiva((await leerReglas()).activa);
    setConteoCiegoActivo(await leerConteoCiegoActivo());
    setAncladas(await leerAncladas());
    setAccesosOcultos(await leerAccesosOcultos());

    // Pedidos web nuevos: consulta ligera al enfocar Inicio. estadoTienda
    // devuelve null sin internet o sin cuenta y aquí no molesta.
    try {
      const remoto = await estadoTienda();
      setPedidosNuevos(remoto?.num_pedidos_nuevos ?? 0);
    } catch {
      setPedidosNuevos(0);
    }

    // Avisos de visita de proveedores: solo si este dispositivo vende
    // (modo pos o ambos). En modo monitor no estorban.
    const modo = await leerModoUso();
    setModoUso(modo);
    if (modo !== "monitor") {
      try {
        setAvisosProv(await avisosDeVisita(hoyYmd()));
      } catch {
        setAvisosProv([]);
      }
    } else {
      setAvisosProv([]);
    }

    // Misiones de arranque: si están todas, la sección se retira (y la
    // celebración se muestra una sola vez en la vida de la app).
    const m = await obtenerMisiones();
    if (m.every((x) => x.hecho)) {
      setMisiones(null);
      setFestejo(!(await festejoVisto()));
    } else {
      setMisiones(m);
      setFestejo(false);
    }
  }, []);

  // Sincronización automática al abrir la pantalla (silenciosa: si falla, no
  // molesta; el estado queda visible en la fila). Respeta la preferencia del
  // usuario: si apagó el respaldo automático, aquí no sube nada.
  const autoSync = useCallback(async () => {
    const e = await estadoSync();
    if (!e.vinculado) return;
    await sincronizarSiAuto();
    cargar();
  }, [cargar]);

  useFocusEffect(
    useCallback(() => {
      cargar();
      autoSync();
    }, [cargar, autoSync])
  );

  const onRefresh = useCallback(async () => {
    setRefrescando(true);
    await cargar();
    setRefrescando(false);
  }, [cargar]);

  async function pedirCorte() {
    if (!turno) return;
    setCorte(await corteTurno(turno));
  }

  async function confirmarCierre() {
    if (!turno) return;
    await cerrarTurno(turno.id);
    setCorte(null);
    cargar();
  }

  const saludo = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Buenos días";
    if (h < 19) return "Buenas tardes";
    return "Buenas noches";
  })();

  // Visibilidad de cada herramienta: estado del negocio Y PERMISOS del
  // usuario activo.
  //
  // Ocultar es CORTESÍA, no seguridad: quien protege de verdad es
  // `exigirPermiso()` dentro de cada función de datos (ver permisos.ts). Pero
  // un cajero no debería ver la puerta de "Dinero" —que son las finanzas
  // PERSONALES del dueño, la renta de su casa— aunque al abrirla no pudiera
  // hacer nada.
  //
  // Mientras los permisos cargan, `permisos` es null y solo se muestra lo que
  // cualquier rol puede usar. Es preferible que una herramienta aparezca un
  // instante después a que se vea y desaparezca.
  function visible(id: IdHerramienta): boolean {
    if (id === "lealtad" && !lealtadActiva) return false;
    if ((id === "tienda" || id === "pedidos") && modoUso === "monitor") return false;
    if (!permisos) {
      // Sin permisos resueltos todavía: solo lo que no exige rol.
      return !["dinero", "proveedores", "recetas", "despensa", "etiquetas",
               "cotizaciones", "compras"].includes(id);
    }
    if (id === "dinero") return permisos.verFinanzas;
    if (id === "proveedores" || id === "compras") return permisos.gestionarProveedores;
    if (id === "recetas" || id === "despensa") return permisos.editarRecetas;
    if (id === "etiquetas") return permisos.editarCatalogo;
    if (id === "cotizaciones") return permisos.editarCatalogo;
    return true;
  }

  function abrir(id: IdHerramienta) {
    // "Productos" no es un modal: es la pestaña de Inventario.
    if (id === "productos") {
      router.push("/inventario");
      return;
    }
    setAbierta(id);
  }

  const cerrarHerramienta = useCallback(() => setAbierta(null), []);
  const cerrarYRecargar = useCallback(() => {
    setAbierta(null);
    cargar();
  }, [cargar]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.fondo }} edges={["top"]}>
      <Pantalla
        refresco={
          <RefreshControl refreshing={refrescando} onRefresh={onRefresh} tintColor={T.acento} />
        }
      >
        {/* El saludo ES el título de la pantalla. El wordmark "YvexPOS" se
            retiró: se repetía en las cinco pestañas robando altura vertical,
            que en un punto de venta es lo más caro que hay. La marca vive en
            el ícono de la app y en el arranque. */}
        {/* Yaxo vive en `acciones`, que es donde el Encabezado ya pone lo
            pulsable de cada pantalla. Va AQUÍ y no en una tarjeta aparte por
            dos motivos:

            1. La misma posición en todas las pantallas. Si el acceso salta de
               sitio deja de ser un gesto y pasa a ser algo que hay que buscar.
            2. No roba altura. Inicio existe para responder "cuánto llevo hoy";
               una tarjeta del asistente empujaría esa cifra hacia abajo, y es
               lo único por lo que alguien abre esta pantalla.

            `desde="inicio"` hace que abra con todas las preguntas. Desde
            Inventario o Reportes se pasa el origen de esa pantalla y Yaxo
            ordena las suyas primero. */}
        <Encabezado
          titulo={saludo}
          meta={negocio && negocio !== "Mi negocio" ? negocio : undefined}
          acciones={<BotonYaxo desde="inicio" />}
        />

        {/* Quién vende y cómo va la nube: UNA línea, no una tarjeta.
            Antes era un Grupo con dos filas completas justo bajo el saludo,
            y competía con "Vendido hoy" — que es la única cifra por la que
            alguien abre esta pantalla. Ninguno de esos dos datos es algo que
            se consulte: son contexto de fondo ("¿con qué cuenta estoy?",
            "¿subió todo?"). Como línea tenue siguen ahí y siguen siendo
            tocables, pero dejan de pelear por la atención.
            Se conservan los dos destinos de siempre: el nombre abre el
            cambio de usuario, el estado de nube abre Sincronización. */}
        {(usuario || sync?.vinculado) && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              flexWrap: "wrap",
              gap: T.esps.sm,
              marginTop: -T.esps.sm,
              marginBottom: T.esps.lg,
            }}
          >
            {usuario ? (
              <Pressable onPress={() => setUsuariosAbierto(true)} hitSlop={8}>
                <Txt escala="micro" tono="tenue">
                  {usuario.nombre}
                </Txt>
              </Pressable>
            ) : null}

            {usuario && sync?.vinculado ? (
              <Txt escala="micro" tono="tenue">
                ·
              </Txt>
            ) : null}

            {sync?.vinculado ? (
              <Pressable onPress={() => setSyncAbierto(true)} hitSlop={8}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  {/* El punto de color es lo único que puede necesitar una
                      mirada rápida: rojo = hay algo sin subir. */}
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: sync.pendientes > 0 ? T.alerta : T.exito,
                    }}
                  />
                  <Txt escala="micro" tono="tenue">
                    {sync.pendientes > 0
                      ? `${sync.pendientes} por subir`
                      : syncAuto
                        ? "Sincronizado"
                        : "Respaldo manual"}
                  </Txt>
                </View>
              </Pressable>
            ) : null}
          </View>
        )}

        {modoUso !== "monitor" && avisosProv.length > 0 && !descartados.has(firmaProv) && (
          <AvisoDescartable onDescartar={() => descartar(firmaProv)}>
          <View style={{ marginBottom: T.esps.xl }}>
            <Grupo>
              <Fila
                destacado
                titulo={`${avisosProv[0].etiqueta} llega ${avisosProv[0].proveedor.nombre}${
                  avisosProv.length > 1 ? ` y ${avisosProv.length - 1} más` : ""
                }`}
                meta={
                  avisosProv[0].ultimoTicketCentavos != null
                    ? `Último ticket ${pesos(avisosProv[0].ultimoTicketCentavos)}${
                        avisosProv[0].ticketPromedioCentavos != null
                          ? ` · promedio ${pesos(avisosProv[0].ticketPromedioCentavos)}`
                          : ""
                      }`
                    : undefined
                }
                icono={<IconoUI id="camion" size={20} color={T.acento} />}
                onPress={() => setAbierta("proveedores")}
              />
            </Grupo>
          </View>
          </AvisoDescartable>
        )}
        {pedidosNuevos > 0 && !descartados.has(`pedidos:${pedidosNuevos}`) && (
          <AvisoDescartable onDescartar={() => descartar(`pedidos:${pedidosNuevos}`)}>
            <View style={{ marginBottom: T.esps.md }}>
              <Grupo>
                <Fila
                  destacado
                  titulo={`${pedidosNuevos} ${pedidosNuevos === 1 ? "pedido nuevo" : "pedidos nuevos"} de tu tienda en línea`}
                  meta="Tocar para revisarlos · desliza para descartar"
                  icono={<IconoUI id="pedido" size={20} color={T.acento} />}
                  onPress={() => abrir("pedidos")}
                />
              </Grupo>
            </View>
          </AvisoDescartable>
        )}

        {/* Vendido hoy — la ÚNICA protagonista de la pantalla. */}
        <View style={{ marginBottom: T.esps.xl }}>
          <Lamina>
            <Txt escala="micro" tono="suave" fuerte mayus>
              Vendido hoy
            </Txt>
            <View style={{ marginTop: T.esps.xs }}>
              <Monto texto={pesos(resumen?.total_centavos ?? 0)} escala="protagonista" />
            </View>
            <View
              style={{
                flexDirection: "row",
                marginTop: T.esps.lg,
                paddingTop: T.esps.lg,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: T.borde,
              }}
            >
              <View style={{ flex: 1 }}>
                <Monto texto={String(resumen?.tickets ?? 0)} escala="titulo" />
                <Txt escala="pie" tono="suave">
                  tickets
                </Txt>
              </View>
              <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: T.borde }} />
              <View style={{ flex: 1, paddingLeft: T.esps.lg }}>
                <Monto texto={pesos(resumen?.promedio_centavos ?? 0)} escala="titulo" />
                <Txt escala="pie" tono="suave">
                  ticket promedio
                </Txt>
              </View>
            </View>
          </Lamina>
        </View>

        {/* Turno */}
        <View style={{ marginBottom: T.esps.xl }}>
          <Grupo>
            {turno ? (
              <Fila
                titulo="Turno abierto"
                meta={`Desde ${fmtFecha(turno.abierta_en)} · fondo ${pesos(
                  turno.fondo_inicial_centavos
                )}`}
                icono={
                  <View
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 5,
                      backgroundColor: T.exito,
                    }}
                  />
                }
                flecha={false}
                valor={
                  <View style={{ flexDirection: "row", gap: T.esps.sm }}>
                    {/* Movimiento manual de efectivo: acción rápida sin salir
                        de Inicio. El corte ya suma/resta lo que se registre. */}
                    <Pressable
                      onPress={() => setMovimientoAbierto(true)}
                      hitSlop={8}
                      accessibilityLabel="Entrada o salida de efectivo"
                      style={{
                        minWidth: 44,
                        minHeight: 44,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: T.radioChico,
                        backgroundColor: T.superficie2,
                      }}
                    >
                      <IconoUI id="dinero" size={18} color={T.textoSuave} />
                    </Pressable>
                    <Pressable
                      onPress={pedirCorte}
                      style={{
                        minHeight: 44,
                        paddingHorizontal: T.esps.lg,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: T.radioChico,
                        backgroundColor: T.acentoSuave,
                      }}
                    >
                      <Txt escala="pie" tono="acento" fuerte>
                        Corte
                      </Txt>
                    </Pressable>
                  </View>
                }
              />
            ) : (
              <Fila
                titulo="Sin turno abierto"
                meta="Abre un turno para empezar a vender."
                flecha={false}
                valor={
                  <Pressable
                    onPress={() => router.push("/vender")}
                    style={{
                      minHeight: 44,
                      paddingHorizontal: T.esps.lg,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: T.radioChico,
                      backgroundColor: T.acentoRelleno,
                    }}
                  >
                    <Txt escala="pie" fuerte estilo={{ color: T.acentoTexto }}>
                      Abrir
                    </Txt>
                  </Pressable>
                }
              />
            )}
          </Grupo>
        </View>

        {/* Aviso de visita de proveedores. Solo si este dispositivo vende. */}

        {/* Tu arranque — misiones para dejar el negocio listo */}
        {misiones && misiones.length > 0 && (
          <Seccion titulo="Tu arranque">
            <Grupo>
              {misiones.map((m) => (
                <Fila
                  key={m.id}
                  titulo={m.titulo}
                  meta={m.hecho ? undefined : m.detalle}
                  flecha={!m.hecho}
                  onPress={
                    m.hecho
                      ? undefined
                      : () => {
                          if (m.id === "ventas") router.push("/vender");
                          else if (m.id === "productos" || m.id === "giro")
                            router.push("/inventario");
                          else router.push("/ajustes");
                        }
                  }
                  icono={
                    m.hecho ? (
                      <Txt escala="cuerpo" tono="exito" fuerte>
                        ✓
                      </Txt>
                    ) : (
                      <IconoUI id={m.icono} size={19} color={T.acento} />
                    )
                  }
                  valor={
                    m.hecho ? (
                      <Txt escala="pie" tono="exito" fuerte>
                        Hecho
                      </Txt>
                    ) : (
                      <Monto texto={`${m.progreso}/${m.meta}`} escala="pie" tono="acento" />
                    )
                  }
                />
              ))}
            </Grupo>
            {/* Progreso global: una sola barra en vez de una por misión.
                Antes cada fila llevaba su propia barra, lo que hacía la
                sección más ruidosa que informativa. */}
            <BarraProgreso
              hechas={misiones.filter((x) => x.hecho).length}
              total={misiones.length}
            />
          </Seccion>
        )}

        {/* Celebración con confeti: una sola vez al completar las misiones */}
        {festejo && <Celebracion T={T} onCerrar={() => setFestejo(false)} />}

        {/* Accesos anclados: los que el usuario eligió, SIEMPRE en el mismo
            sitio y en el mismo orden. Nunca una lista automática por
            frecuencia: si el orden cambia solo, se pierde la memoria muscular
            y el usuario pasa de mirar a leer. */}
        {/* Accesos anclados: los que el usuario eligió, SIEMPRE en el mismo
            sitio y en el mismo orden. Nunca una lista automática por
            frecuencia: si el orden cambia solo, se pierde la memoria muscular
            y el usuario pasa de mirar a leer.

            REHECHO. Antes era una fila de cuatro columnas con `flex: 1` por
            acceso, y eso tenía dos fallos que solo se ven con datos reales:

              · Con UN solo acceso anclado, ese `flex: 1` lo estiraba a todo
                el ancho de la pantalla: una tarjeta enorme con un icono de
                19px perdido en el centro.
              · El nombre iba a cuatro columnas, así que "Departamentos" se
                partía en "Departament / os" y "Devolver o cancelar" ocupaba
                dos renglones.

            Ahora es una rejilla de DOS columnas con el icono a la izquierda y
            el nombre corto a su lado, en una sola línea. Un acceso ocupa media
            fila, que se lee como una decisión y no como un hueco. Y se añade
            una ranura "+" mientras quede sitio, que enseña que esto se puede
            llenar sin necesidad de un texto de ayuda. */}
        {!accesosOcultos && ancladas.length > 0 && (
          <View style={{ marginBottom: T.esps.xl }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: T.esps.md,
              }}
            >
              <Txt escala="micro" tono="suave" fuerte mayus>
                Tus accesos
              </Txt>
              {/* Ocultar SÍ existe, pero ya no es un callejón sin salida: la
                  vuelta está en el panel de Herramientas, sección "Tus
                  accesos", a un toque del tirador que se ve siempre. */}
              <Pressable
                onPress={async () => {
                  setAccesosOcultos(true);
                  await guardarAccesosOcultos(true);
                }}
                hitSlop={10}
                accessibilityLabel="Ocultar accesos de Inicio"
                style={{ minHeight: 32, justifyContent: "center" }}
              >
                <Txt escala="pie" tono="tenue">
                  Ocultar
                </Txt>
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 }}>
              {ancladas.map((id) => {
                const h = herramientaPorId(id);
                if (!h || !visible(id)) return null;
                const badge = id === "pedidos" ? pedidosNuevos : 0;
                return (
                  <View key={id} style={{ width: "50%", padding: 4 }}>
                    <Pressable
                      onPress={() => abrir(id)}
                      accessibilityRole="button"
                      accessibilityLabel={
                        badge > 0 ? `${h.titulo}, ${badge} pendientes` : h.titulo
                      }
                      android_ripple={{ color: T.acentoBorde }}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: T.esps.md,
                        paddingVertical: T.esps.md,
                        paddingHorizontal: T.esps.md,
                        borderRadius: T.radio,
                        backgroundColor: T.superficie,
                        opacity: pressed ? 0.85 : 1,
                        minHeight: 60,
                      })}
                    >
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: T.radioChico,
                          backgroundColor: T.acentoSuave,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <IconoUI id={h.icono} size={19} color={T.acento} />
                        {badge > 0 ? (
                          <View
                            style={{
                              position: "absolute",
                              top: -4,
                              right: -4,
                              backgroundColor: T.peligro,
                              borderRadius: T.radioPildora,
                              minWidth: 17,
                              height: 17,
                              alignItems: "center",
                              justifyContent: "center",
                              paddingHorizontal: 4,
                            }}
                          >
                            <Txt escala="micro" fuerte estilo={{ color: T.peligroTextoFuerte, fontSize: 9 }}>
                              {badge > 9 ? "9+" : String(badge)}
                            </Txt>
                          </View>
                        ) : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Txt escala="pie" fuerte lineas={1}>
                          {h.corto ?? h.titulo}
                        </Txt>
                      </View>
                    </Pressable>
                  </View>
                );
              })}

              {/* Ranura vacía: invita a llenar sin ocupar una fila de texto
                  explicativo. Desaparece sola al llegar al tope. */}
              {ancladas.length < MAX_ANCLADAS ? (
                <View style={{ width: "50%", padding: 4 }}>
                  <Pressable
                    onPress={() => setPanelAbierto(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Anclar otra herramienta"
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: T.esps.md,
                      paddingVertical: T.esps.md,
                      paddingHorizontal: T.esps.md,
                      borderRadius: T.radio,
                      borderWidth: 1,
                      borderStyle: "dashed",
                      borderColor: T.borde,
                      opacity: pressed ? 0.7 : 1,
                      minHeight: 60,
                    })}
                  >
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <IconoUI id="mas" size={19} color={T.textoTenue} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Txt escala="pie" tono="tenue" lineas={1}>
                        Anclar otra
                      </Txt>
                    </View>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        )}

        {/* Variante B: el cajón vive en el cuerpo, con el resto del contenido. */}
        {VARIANTE_PANEL === "cajon" && (
          <View style={{ marginBottom: T.esps.xl }}>
            <CajonHerramientas
              onAbrir={() => setPanelAbierto(true)}
              cuantas={TODAS_HERRAMIENTAS.filter((h) => visible(h.id)).length}
            />
          </View>
        )}

        {/* Última venta: UNA línea, no una lista. Resuelve el caso real
            ("¿sí pasó el cobro?") sin convertir el tablero en un historial.
            El historial completo vive en Reportes. */}
        {recientes.length > 0 ? (
          <View style={{ marginBottom: T.esps.xl }}>
            <Grupo>
              <Fila
                titulo="Última venta"
                meta={`${fmtFecha(recientes[0].creado_en)} · ${
                  recientes[0].articulos
                } artículo${recientes[0].articulos === 1 ? "" : "s"}`}
                icono={<Monto texto={`#${recientes[0].folio}`} escala="micro" tono="tenue" />}
                valor={<Monto texto={pesos(recientes[0].total_centavos)} escala="cuerpo" />}
                onPress={() => router.push("/reportes")}
              />
            </Grupo>
          </View>
        ) : (
          <View style={{ marginBottom: T.esps.xl }}>
            <Grupo>
              <Vacio
                titulo="Aún no hay ventas"
                texto="Cuando cobres tu primer ticket aparecerá aquí."
                accion={
                  modoUso !== "monitor"
                    ? { texto: "Ir a vender", onPress: () => router.push("/vender") }
                    : undefined
                }
              />
            </Grupo>
          </View>
        )}

        {/* Aire extra para que el tirador no tape el último elemento. */}
        {VARIANTE_PANEL === "tirador" ? <View style={{ height: 76 }} /> : null}

      </Pantalla>

      {/* Variante A: tirador fijo. Siempre visible, siempre en el pulgar. */}
      {VARIANTE_PANEL === "tirador" && (
        <TiradorHerramientas
          cajon={cajon}
          onAbrir={abrirPanel}
          onCancelar={cerrarPanel}
        />
      )}

      <PanelHerramientas
        visible={panelAbierto}
        onCerrar={cerrarPanel}
        visibleId={visible}
        onAncladasCambio={setAncladas}
        // El panel es un Modal montado dentro de esta pantalla, así que al
        // cerrarlo NO se dispara el useFocusEffect que releía la preferencia:
        // había que salir a otra pestaña y volver para que los accesos
        // reaparecieran. Con este aviso se actualiza en el acto.
        onVisibilidadCambio={setAccesosOcultos}
        badges={pedidosNuevos > 0 ? { pedidos: pedidosNuevos } : undefined}
        estadosExtra={estadosRemotos}
        cajon={cajon}
        onAbrir={(id) => {
          setPanelAbierto(false);
          abrir(id);
        }}
      />

      {/* --- Corte del turno (ya no es un Alert nativo) --- */}
      <HojaCorte
        visible={corte !== null}
        corte={corte}
        turno={turno}
        conteoCiegoActivo={conteoCiegoActivo}
        onSeguir={() => setCorte(null)}
        onCerrarTurno={confirmarCierre}
      />

      {/* --- Herramientas --- */}
      {abierta === "departamentos" && (
        <ModalDepartamentos onCerrar={cerrarHerramienta} onCambio={cargar} />
      )}
      {abierta === "proveedores" && (
        <ModalProveedores onCerrar={cerrarHerramienta} onCambio={cargar} />
      )}
      {abierta === "cotizaciones" && (
        <ModalCotizaciones
          onCerrar={cerrarHerramienta}
          onIrAVenta={() => {
            setAbierta(null);
            router.push("/vender");
          }}
        />
      )}
      {abierta === "dinero" && <ModalDinero onCerrar={cerrarYRecargar} />}
      {abierta === "devoluciones" && (
        <ModalDevoluciones onCerrar={cerrarHerramienta} onCambio={cargar} />
      )}
      {/* Antes este modal se renderizaba POR ERROR en medio de la lista de
          accesos, entre dos filas. Su sitio es aquí, con los demás. */}
      {abierta === "etiquetas" && <ModalEtiquetas onCerrar={cerrarHerramienta} />}
      {abierta === "recetas" && <ModalRecetas onCerrar={cerrarYRecargar} />}
      {abierta === "credito" && <ModalCredito onCerrar={cerrarYRecargar} />}
      {abierta === "lealtad" && (
        <ModalLealtad onCerrar={cerrarHerramienta} onCambio={cargar} />
      )}
      {abierta === "tienda" && (
        <ModalTienda onCerrar={cerrarHerramienta} onCambio={cargar} />
      )}
      {abierta === "pedidos" && (
        <ModalPedidosWeb onCerrar={cerrarHerramienta} onCambio={cargar} />
      )}

      {/* --- Modales de contexto --- */}
      {syncAbierto && <ModalSync onCerrar={() => setSyncAbierto(false)} onCambio={cargar} />}
      {usuariosAbierto && (
        <ModalUsuarios
          modo="cambiar"
          onCerrar={() => setUsuariosAbierto(false)}
          onCambio={cargar}
        />
      )}
      {movimientoAbierto && turno && (
        <ModalMovimientoCaja
          turno={turno}
          onCerrar={() => setMovimientoAbierto(false)}
          onGuardado={cargar}
        />
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
function BarraProgreso({ hechas, total }: { hechas: number; total: number }) {
  const { tema: T } = useTema();
  const pct = total > 0 ? Math.round((hechas / total) * 100) : 0;
  return (
    <View style={{ marginTop: T.esps.md }}>
      <View
        style={{
          height: 6,
          backgroundColor: T.superficie2,
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: "100%",
            width: `${pct}%`,
            backgroundColor: T.acento,
            borderRadius: 3,
          }}
        />
      </View>
      <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.sm }}>
        {hechas} de {total} listo{hechas === 1 ? "" : "s"}
      </Txt>
    </View>
  );
}
