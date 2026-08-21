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

import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "react-native-reanimated";
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
import { estadoTienda } from "@/src/base/tienda";
import { leerReglas } from "@/src/base/lealtad";
import ModalDinero from "@/src/componentes/ModalDinero";
import ModalEtiquetas from "@/src/componentes/ModalEtiquetas";
import ModalRecetas from "@/src/componentes/ModalRecetas";
import ModalCredito from "@/src/componentes/ModalCredito";
import ModalMovimientoCaja from "@/src/componentes/ModalMovimientoCaja";
import {
  PanelHerramientas,
  TiradorHerramientas,
  CajonHerramientas,
} from "@/src/componentes/PanelHerramientas";
import {
  IdHerramienta,
  TODAS_HERRAMIENTAS,
  herramientaPorId,
  leerAncladas,
  leerAccesosOcultos,
  guardarAccesosOcultos,
} from "@/src/base/herramientas";
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

  // Un solo estado para saber qué herramienta está abierta, en vez de nueve
  // banderas booleanas independientes que podían quedar en estados imposibles
  // (dos modales "abiertos" a la vez).
  const [abierta, setAbierta] = useState<IdHerramienta | null>(null);
  const [panelAbierto, setPanelAbierto] = useState(false);
  const [ancladas, setAncladas] = useState<IdHerramienta[]>([]);
  const [accesosOcultos, setAccesosOcultos] = useState(false);
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
    const [t, r, v, u] = await Promise.all([
      turnoActivo(),
      resumenHoy(),
      ventasRecientes(6),
      usuarioActivo(),
    ]);
    setTurno(t);
    setResumen(r);
    setRecientes(v);
    setUsuario(u);
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

  // Visibilidad de cada herramienta según el estado del negocio.
  function visible(id: IdHerramienta): boolean {
    if (id === "lealtad") return lealtadActiva;
    if (id === "tienda" || id === "pedidos") return modoUso !== "monitor";
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
        <Encabezado
          titulo={saludo}
          meta={negocio && negocio !== "Mi negocio" ? negocio : undefined}
        />

        {/* Quién vende y cómo va la nube: contexto, no protagonismo. */}
        {(usuario || sync?.vinculado) && (
          <View style={{ marginBottom: T.esps.xl }}>
            <Grupo>
              {usuario ? (
                <Fila
                  titulo={usuario.nombre}
                  meta="Vendiendo con esta cuenta"
                  onPress={() => setUsuariosAbierto(true)}
                  icono={
                    <View
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: T.radioChico,
                        backgroundColor: T.acentoSuave,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Txt escala="pie" tono="acento" fuerte>
                        {usuario.nombre.trim()[0]?.toUpperCase() ?? "?"}
                      </Txt>
                    </View>
                  }
                  valor={
                    <Txt escala="pie" tono="acento" fuerte>
                      Cambiar
                    </Txt>
                  }
                  flecha={false}
                />
              ) : null}
              {sync?.vinculado ? (
                <Fila
                  titulo={
                    sync.pendientes > 0
                      ? `${sync.pendientes} por subir a la nube`
                      : syncAuto
                        ? "Todo sincronizado"
                        : "Respaldo manual"
                  }
                  meta={
                    sync.pendientes > 0
                      ? "Se subirán solas cuando haya internet"
                      : syncAuto
                        ? undefined
                        : "Tú decides cuándo subir"
                  }
                  onPress={() => setSyncAbierto(true)}
                  icono={
                    <View
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 5,
                        backgroundColor: sync.pendientes > 0 ? T.alerta : T.exito,
                      }}
                    />
                  }
                />
              ) : null}
            </Grupo>
          </View>
        )}

        {/* Pedido web nuevo: el mismo lenguaje visual que el aviso de
            proveedor de abajo (Fila destacada), pero ANTES de la lámina de
            "Vendido hoy" — un cliente esperando su pedido es más urgente
            que la cifra de cuánto se lleva vendido, así que se gana el
            primer lugar sin robarle el protagonismo a la lámina (sigue
            siendo la única <Lamina> de la pantalla). Antes esto solo vivía
            como un número dentro del panel de Herramientas: había que
            entrar a buscarlo para enterarte. */}
        {pedidosNuevos > 0 && (
          <View style={{ marginBottom: T.esps.xl }}>
            <Grupo>
              <Fila
                destacado
                titulo={`${pedidosNuevos} ${pedidosNuevos === 1 ? "pedido nuevo" : "pedidos nuevos"} de tu tienda en línea`}
                meta="Tocar para revisarlos"
                icono={<IconoUI id="pedido" size={20} color={T.acento} />}
                onPress={() => abrir("pedidos")}
              />
            </Grupo>
          </View>
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
        {modoUso !== "monitor" && avisosProv.length > 0 && (
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
        )}

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
              <Pressable
                onPress={async () => {
                  setAccesosOcultos(true);
                  await guardarAccesosOcultos(true);
                }}
                hitSlop={10}
                accessibilityLabel="Ocultar accesos"
                style={{ minHeight: 32, justifyContent: "center" }}
              >
                <Txt escala="pie" tono="tenue">
                  Ocultar
                </Txt>
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", gap: T.esps.sm }}>
              {ancladas.map((id) => {
                const h = herramientaPorId(id);
                if (!h || !visible(id)) return null;
                const badge = id === "pedidos" ? pedidosNuevos : 0;
                return (
                  <Pressable
                    key={id}
                    onPress={() => abrir(id)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      badge > 0 ? `${h.titulo}, ${badge} pendientes` : h.titulo
                    }
                    style={({ pressed }) => ({
                      flex: 1,
                      alignItems: "center",
                      gap: T.esps.sm,
                      paddingVertical: T.esps.md,
                      paddingHorizontal: T.esps.xs,
                      borderRadius: T.radio,
                      backgroundColor: T.superficie,
                      opacity: pressed ? 0.85 : 1,
                      minHeight: 84,
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
                    <Txt
                      escala="micro"
                      tono="suave"
                      lineas={2}
                      estilo={{ textAlign: "center" }}
                    >
                      {h.titulo}
                    </Txt>
                  </Pressable>
                );
              })}
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
        <TiradorHerramientas onAbrir={() => setPanelAbierto(true)} />
      )}

      <PanelHerramientas
        visible={panelAbierto}
        onCerrar={() => setPanelAbierto(false)}
        visibleId={visible}
        onAncladasCambio={setAncladas}
        badges={pedidosNuevos > 0 ? { pedidos: pedidosNuevos } : undefined}
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
