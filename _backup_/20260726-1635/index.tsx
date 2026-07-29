// YvexPOS Móvil — Pantalla INICIO.
//
// El pulso del negocio de un vistazo: resumen de hoy (vendido, tickets,
// promedio), estado del turno (con CORTE al cerrarlo: efectivo esperado,
// tarjeta, tickets), y las últimas ventas.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
  RefreshControl,
  type ViewStyle,
  type TextStyle,
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
} from "@/src/base/venta";
import { pesos, fmtFecha } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton } from "@/src/componentes/ui";
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
import {
  Mision,
  obtenerMisiones,
  festejoVisto,
  marcarFestejoVisto,
} from "@/src/base/misiones";
import { sonidoExito } from "@/src/base/sonidos";

type Tema = ReturnType<typeof useTema>["tema"];

// --- Celebración de misiones completas (una sola vez en la vida de la app) ---

/** Partícula de confeti: punto o rombo con color del tema (acento, turquesa
 *  o éxito — se ve bien en los 6 temas, claros y oscuros). Trayectoria
 *  determinista por índice: sube un poco y cae mientras se desvanece. */
function Particula({ i, T }: { i: number; T: Tema }) {
  const cfg = useMemo(() => {
    const r = (n: number) => {
      const x = Math.sin(i * 127.1 + n * 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    return {
      dx: (r(1) - 0.5) * 230,          // dispersión horizontal
      sube: 40 + r(2) * 70,            // cuánto sube al salir
      cae: 120 + r(3) * 120,           // cuánto termina cayendo
      dur: 950 + r(4) * 750,
      delay: r(5) * 260,
      tam: 5 + r(6) * 5,
      color: [T.acento, T.turquesa, T.exito][i % 3],
      rombo: i % 2 === 1,
      giro: (r(7) - 0.5) * 340,
    };
  }, [i, T.acento, T.turquesa, T.exito]);

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
      // parábola sencilla: primero sube, luego cae
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

type Estilos = ReturnType<typeof crearEstilos>;

/** Tarjeta de celebración: entra con resorte + fade, ráfaga de confeti y
 *  sonidoExito() la primera vez (junto con marcarFestejoVisto()). "Entendido"
 *  cierra con animación de salida. */
function Celebracion({ T, est, onCerrar }: { T: Tema; est: Estilos; onCerrar: () => void }) {
  const entrada = useSharedValue(0);
  const salida = useSharedValue(0);

  useEffect(() => {
    sonidoExito();
    void marcarFestejoVisto(); // la celebración se vive una sola vez
    entrada.value = withSpring(1, { damping: 13, stiffness: 170 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stCard = useAnimatedStyle(() => ({
    opacity: entrada.value * (1 - salida.value),
    transform: [
      { scale: (0.85 + 0.15 * entrada.value) * (1 - 0.08 * salida.value) },
    ],
  }));

  function cerrar() {
    salida.value = withTiming(1, { duration: 180 });
    setTimeout(onCerrar, 190);
  }

  return (
    <View style={est.festejoWrap} pointerEvents="box-none">
      <Animated.View style={[est.festejoCaja, stCard]}>
        <Text style={est.festejoTitulo}>Tu negocio ya está listo para despegar</Text>
        <Text style={est.festejoTxt}>
          Nombre, catálogo, primeras ventas y ese toque final de tu giro: lo
          esencial quedó en su lugar. Ahora sí, a venderle con todo.
        </Text>
        {/* CÓDIGO PROMOCIONAL: cuando exista el paywall, insertar aquí el
            código de descuento de bienvenida (p. ej. un Text con el código
            canjeable). La celebración es el momento de mayor cariño del
            usuario: es el lugar natural para ese regalo. */}
        <Boton titulo="Entendido" chico onPress={cerrar} />
      </Animated.View>
      {Array.from({ length: 14 }, (_, i) => (
        <Particula key={i} i={i} T={T} />
      ))}
    </View>
  );
}

export default function InicioScreen() {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const [turno, setTurno] = useState<Turno | null>(null);
  const [resumen, setResumen] = useState<ResumenHoy | null>(null);
  const [recientes, setRecientes] = useState<VentaReciente[]>([]);
  const [refrescando, setRefrescando] = useState(false);
  const [deptosAbierto, setDeptosAbierto] = useState(false);
  const [usuariosAbierto, setUsuariosAbierto] = useState(false);
  const [usuario, setUsuario] = useState<UsuarioPOS | null>(null);
  const [syncAbierto, setSyncAbierto] = useState(false);
  const [sync, setSync] = useState<EstadoSync | null>(null);
  const [syncAuto, setSyncAuto] = useState<boolean>(true);
  const [negocio, setNegocio] = useState<string | null>(null);
  const [misiones, setMisiones] = useState<Mision[] | null>(null);
  const [festejo, setFestejo] = useState(false);
  const [avisosProv, setAvisosProv] = useState<AvisoVisita[]>([]);
  const [modoUso, setModoUso] = useState<ModoUso>("ambos");
  const [proveedoresAbierto, setProveedoresAbierto] = useState(false);

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
  // molesta; el estado queda visible en la píldora). Respeta la preferencia
  // del usuario: si apagó el respaldo automático, aquí no sube nada.
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
    const c = await corteTurno(turno);
    Alert.alert(
      "Corte del turno",
      `Tickets: ${c.tickets}\n` +
        `Vendido: ${pesos(c.total_centavos)}\n\n` +
        `Efectivo: ${pesos(c.efectivo_centavos)}\n` +
        `Tarjeta: ${pesos(c.tarjeta_centavos)}\n` +
        `Fondo inicial: ${pesos(c.fondo_centavos)}\n\n` +
        `Efectivo esperado en cajón:\n${pesos(c.efectivo_esperado_centavos)}`,
      [
        { text: "Seguir vendiendo", style: "cancel" },
        {
          text: "Cerrar turno",
          style: "destructive",
          onPress: async () => {
            await cerrarTurno(turno.id);
            cargar();
          },
        },
      ]
    );
  }

  const saludo = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Buenos días";
    if (h < 19) return "Buenas tardes";
    return "Buenas noches";
  })();

  return (
    <SafeAreaView style={est.raiz} edges={["top"]}>
      <ScrollView
        contentContainerStyle={est.cuerpo}
        refreshControl={
          <RefreshControl refreshing={refrescando} onRefresh={onRefresh} tintColor={T.acento} />
        }
      >
        {/* Marca + saludo (personalizado con el nombre del negocio) */}
        <Text style={est.marca}>
          Yvex<Text style={{ color: T.turquesa }}>POS</Text>
          {negocio && negocio !== "Mi negocio" ? (
            <Text style={{ color: T.textoSuave }}>  ·  {negocio}</Text>
          ) : null}
        </Text>
        <Text style={est.saludo}>{saludo}</Text>

        {/* Quién está vendiendo */}
        {usuario && (
          <Pressable
            style={({ pressed }) => [
              est.usuarioFila,
              pressed && { backgroundColor: T.superficie3 },
            ]}
            onPress={() => setUsuariosAbierto(true)}
          >
            <View style={est.usuarioAvatar}>
              <Text style={est.usuarioInicial}>
                {usuario.nombre.trim()[0]?.toUpperCase() ?? "?"}
              </Text>
            </View>
            <Text style={est.usuarioTxt}>
              Vendiendo como <Text style={{ fontWeight: "800", color: T.texto }}>{usuario.nombre}</Text>
            </Text>
            <Text style={est.usuarioCambiar}>Cambiar</Text>
          </Pressable>
        )}

        {/* Estado de sincronización */}
        {sync?.vinculado && (
          <Pressable
            style={({ pressed }) => [
              est.syncFila,
              {
                backgroundColor:
                  sync.pendientes > 0 ? T.alertaSuave : T.superficie,
                borderColor: sync.pendientes > 0 ? T.alerta : T.borde,
              },
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => setSyncAbierto(true)}
          >
            <View
              style={[
                est.syncPunto,
                { backgroundColor: sync.pendientes > 0 ? T.alerta : T.exito },
              ]}
            />
            <Text style={est.syncTxt}>
              {sync.pendientes > 0
                ? `${sync.pendientes} por subir a la nube`
                : syncAuto
                  ? "Todo sincronizado"
                  : "Respaldo manual: tú decides cuándo subir"}
            </Text>
            <Text style={est.syncVer}>Ver</Text>
          </Pressable>
        )}

        {/* Vendido hoy — la tarjeta estrella */}
        <View style={est.heroCaja}>
          <Text style={est.heroLbl}>VENDIDO HOY</Text>
          <Text style={est.heroVal}>{pesos(resumen?.total_centavos ?? 0)}</Text>
          <View style={est.heroFila}>
            <View style={est.heroDato}>
              <Text style={est.heroDatoVal}>{resumen?.tickets ?? 0}</Text>
              <Text style={est.heroDatoLbl}>tickets</Text>
            </View>
            <View style={est.heroSep} />
            <View style={est.heroDato}>
              <Text style={est.heroDatoVal}>{pesos(resumen?.promedio_centavos ?? 0)}</Text>
              <Text style={est.heroDatoLbl}>ticket promedio</Text>
            </View>
          </View>
        </View>

        {/* Turno */}
        {turno ? (
          <View style={est.turnoCaja}>
            <View style={{ flex: 1 }}>
              <View style={est.turnoFila}>
                <View style={est.puntoVivo} />
                <Text style={est.turnoTitulo}>Turno abierto</Text>
              </View>
              <Text style={est.turnoMeta}>
                Desde {fmtFecha(turno.abierta_en)} · fondo {pesos(turno.fondo_inicial_centavos)}
              </Text>
            </View>
            <Pressable style={est.turnoBtn} onPress={pedirCorte}>
              <Text style={est.turnoBtnTxt}>Corte</Text>
            </Pressable>
          </View>
        ) : (
          <View style={est.turnoCaja}>
            <View style={{ flex: 1 }}>
              <Text style={est.turnoTitulo}>Sin turno abierto</Text>
              <Text style={est.turnoMeta}>Abre un turno para empezar a vender.</Text>
            </View>
            <Pressable style={[est.turnoBtn, { backgroundColor: T.acento, borderColor: T.acento }]} onPress={() => router.push("/vender")}>
              <Text style={[est.turnoBtnTxt, { color: T.acentoTexto }]}>Abrir</Text>
            </Pressable>
          </View>
        )}

        {/* Aviso de visita de proveedores: visible pero sin estorbar al turno.
            Solo si el modo de uso incluye POS (pos/ambos). */}
        {modoUso !== "monitor" && avisosProv.length > 0 && (
          <Pressable
            style={({ pressed }) => [
              est.avisoProv,
              pressed && { backgroundColor: T.superficie3 },
            ]}
            onPress={() => setProveedoresAbierto(true)}
          >
            <View style={est.avisoProvIcono}>
              <IconoUI id="camion" size={20} color={T.acento} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={est.avisoProvTxt}>
                {avisosProv[0].etiqueta} llega{" "}
                <Text style={{ fontWeight: "800", color: T.texto }}>
                  {avisosProv[0].proveedor.nombre}
                </Text>
                {avisosProv.length > 1 ? ` y ${avisosProv.length - 1} más` : ""}
              </Text>
              {avisosProv[0].ultimoTicketCentavos != null && (
                <Text style={est.avisoProvMeta}>
                  Último ticket {pesos(avisosProv[0].ultimoTicketCentavos)}
                  {avisosProv[0].ticketPromedioCentavos != null
                    ? ` · promedio ${pesos(avisosProv[0].ticketPromedioCentavos)}`
                    : ""}
                </Text>
              )}
            </View>
            <Text style={est.avisoProvFlecha}>→</Text>
          </Pressable>
        )}

        {/* Tu arranque — misiones para dejar el negocio listo */}
        {misiones && misiones.length > 0 && (
          <>
            <View style={est.arranqueCab}>
              <Text style={est.seccion}>TU ARRANQUE</Text>
              <Text style={est.arranqueConteo}>
                {misiones.filter((x) => x.hecho).length} de {misiones.length}
              </Text>
            </View>
            <View style={est.misiones}>
              {misiones.map((m) => (
                <Pressable
                  key={m.id}
                  style={({ pressed }) => [
                    est.mision,
                    m.hecho && est.misionHecha,
                    pressed && !m.hecho && { backgroundColor: T.superficie3 },
                  ]}
                  onPress={() => {
                    if (m.hecho) return;
                    if (m.id === "ventas") router.push("/vender");
                    else if (m.id === "productos" || m.id === "giro")
                      router.push("/inventario");
                    else router.push("/ajustes");
                  }}
                >
                  <View
                    style={[
                      est.misionIcono,
                      m.hecho && { backgroundColor: T.exitoSuave, borderColor: T.exito },
                    ]}
                  >
                    {m.hecho ? (
                      <Text style={est.misionPaloma}>✓</Text>
                    ) : (
                      <IconoUI id={m.icono} size={19} color={T.acento} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={est.misionTituloFila}>
                      <Text
                        style={[
                          est.misionTitulo,
                          m.hecho && { color: T.textoSuave },
                        ]}
                      >
                        {m.titulo}
                      </Text>
                      <Text
                        style={[
                          est.misionProgreso,
                          m.hecho && { color: T.exito },
                        ]}
                      >
                        {m.hecho ? "Hecho" : `${m.progreso}/${m.meta}`}
                      </Text>
                    </View>
                    {!m.hecho && (
                      <>
                        <View style={est.barra}>
                          <View
                            style={[
                              est.barraRelleno,
                              { width: `${Math.round((m.progreso / m.meta) * 100)}%` },
                            ]}
                          />
                        </View>
                        <Text style={est.misionDetalle}>{m.detalle}</Text>
                      </>
                    )}
                  </View>
                  {!m.hecho && <Text style={est.misionFlecha}>→</Text>}
                </Pressable>
              ))}
            </View>
          </>
        )}

        {/* Celebración con confeti: una sola vez al completar las misiones */}
        {festejo && (
          <Celebracion T={T} est={est} onCerrar={() => setFestejo(false)} />
        )}

        {/* Accesos rápidos */}
        <Text style={est.seccion}>TU NEGOCIO</Text>
        <View style={est.accesos}>
          <Pressable
            style={({ pressed }) => [est.acceso, pressed && { backgroundColor: T.superficie3 }]}
            onPress={() => setDeptosAbierto(true)}
          >
            <IconoUI id="etiqueta" size={21} color={T.acento} />
            <View style={{ flex: 1 }}>
              <Text style={est.accesoTitulo}>Departamentos</Text>
              <Text style={est.accesoMeta}>Crea categorías con su icono y color</Text>
            </View>
            <Text style={est.accesoFlecha}>→</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [est.acceso, pressed && { backgroundColor: T.superficie3 }]}
            onPress={() => router.push("/inventario")}
          >
            <IconoUI id="inventario" size={21} color={T.acento} />
            <View style={{ flex: 1 }}>
              <Text style={est.accesoTitulo}>Productos</Text>
              <Text style={est.accesoMeta}>Agrega productos con foto y precio</Text>
            </View>
            <Text style={est.accesoFlecha}>→</Text>
          </Pressable>
        </View>

        {/* Últimas ventas */}
        <Text style={est.seccion}>ÚLTIMAS VENTAS</Text>
        {recientes.length === 0 ? (
          <Text style={est.vacio}>Aún no hay ventas. ¡A vender!</Text>
        ) : (
          recientes.map((v) => (
            <View key={v.id} style={est.ventaFila}>
              <View style={est.ventaFolio}>
                <Text style={est.ventaFolioTxt}>#{v.folio}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={est.ventaHora}>{fmtFecha(v.creado_en)}</Text>
                <Text style={est.ventaArt}>
                  {v.articulos} artículo{v.articulos === 1 ? "" : "s"}
                </Text>
              </View>
              <Text style={est.ventaTotal}>{pesos(v.total_centavos)}</Text>
            </View>
          ))
        )}

        <View style={{ height: 30 }} />
      </ScrollView>

      {deptosAbierto && (
        <ModalDepartamentos
          onCerrar={() => setDeptosAbierto(false)}
          onCambio={cargar}
        />
      )}
      {proveedoresAbierto && (
        <ModalProveedores
          onCerrar={() => setProveedoresAbierto(false)}
          onCambio={cargar}
        />
      )}
      {syncAbierto && (
        <ModalSync onCerrar={() => setSyncAbierto(false)} onCambio={cargar} />
      )}
      {usuariosAbierto && (
        <ModalUsuarios
          modo="cambiar"
          onCerrar={() => setUsuariosAbierto(false)}
          onCambio={cargar}
        />
      )}
    </SafeAreaView>
  );
}

function crearEstilos(T: Tema) {
  // Profundidad sutil para las tarjetas: casi imperceptible, pero ordena.
  const sombraSuave: ViewStyle = {
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  };
  // Cifras alineadas: no "bailan" al cambiar.
  const cifras: TextStyle = { fontVariant: ["tabular-nums"] };
  return StyleSheet.create({
    raiz: { flex: 1, backgroundColor: T.fondo },
    cuerpo: { padding: T.esp, paddingTop: 12 },
    marca: { color: T.texto, fontSize: 13, fontWeight: "900", letterSpacing: 1.5, opacity: 0.85 },
    saludo: { color: T.texto, fontSize: 27, fontWeight: "800", letterSpacing: -0.7, marginTop: 1, marginBottom: 16 },

    heroCaja: {
      backgroundColor: T.superficie,
      borderWidth: 1,
      borderColor: T.borde,
      borderLeftWidth: 4,
      borderLeftColor: T.acento,
      borderRadius: T.radioGrande,
      padding: 22,
      marginBottom: 14,
      ...sombraSuave,
    },
    heroLbl: { color: T.textoSuave, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
    heroVal: { color: T.texto, fontSize: 42, fontWeight: "800", letterSpacing: -1.5, marginTop: 4, ...cifras },
    heroFila: { flexDirection: "row", alignItems: "center", marginTop: 14 },
    heroDato: { flex: 1 },
    heroDatoVal: { color: T.texto, fontSize: 18, fontWeight: "800", ...cifras },
    heroDatoLbl: { color: T.textoSuave, fontSize: 12, marginTop: 1 },
    heroSep: { width: 1, height: 30, backgroundColor: T.bordeFuerte, marginRight: 16 },

    turnoCaja: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: T.superficie,
      borderWidth: 1,
      borderColor: T.borde,
      borderRadius: T.radio,
      padding: 16,
      marginBottom: 22,
      gap: 12,
      ...sombraSuave,
    },
    turnoFila: { flexDirection: "row", alignItems: "center", gap: 7 },
    puntoVivo: { width: 9, height: 9, borderRadius: 5, backgroundColor: T.exito },
    turnoTitulo: { color: T.texto, fontSize: 15, fontWeight: "800" },
    turnoMeta: { color: T.textoTenue, fontSize: 12, marginTop: 3 },
    turnoBtn: {
      borderWidth: 1,
      borderColor: T.bordeFuerte,
      backgroundColor: T.superficie2,
      borderRadius: T.radioChico,
      paddingHorizontal: 18,
      paddingVertical: 10,
    },
    turnoBtnTxt: { color: T.turquesa, fontSize: 14, fontWeight: "800" },

    seccion: {
      color: T.textoSuave,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 1,
      marginBottom: 10,
    },
    vacio: { color: T.textoTenue, fontSize: 14, marginTop: 6 },
    ventaFila: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: T.superficie,
      borderWidth: 1,
      borderColor: T.borde,
      borderRadius: T.radio,
      padding: 12,
      marginBottom: 8,
      gap: 12,
      ...sombraSuave,
    },
    ventaFolio: {
      backgroundColor: T.superficie2,
      borderWidth: 1,
      borderColor: T.bordeFuerte,
      borderRadius: T.radioChico,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    ventaFolioTxt: { color: T.acento, fontSize: 13, fontWeight: "800" },
    ventaHora: { color: T.texto, fontSize: 13, fontWeight: "600" },
    ventaArt: { color: T.textoTenue, fontSize: 12, marginTop: 1 },
    ventaTotal: { color: T.turquesa, fontSize: 16, fontWeight: "800", ...cifras },
    accesos: { gap: 8, marginBottom: 22 },
    acceso: {
      flexDirection: "row", alignItems: "center", gap: 13,
      backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
      borderRadius: T.radio, padding: 15, ...sombraSuave,
    },
    accesoIcono: { fontSize: 22 },
    accesoTitulo: { color: T.texto, fontSize: 15, fontWeight: "800" },
    accesoMeta: { color: T.textoTenue, fontSize: 12, marginTop: 2 },
    accesoFlecha: { color: T.turquesa, fontSize: 16, fontWeight: "800" },
    usuarioFila: {
      flexDirection: "row", alignItems: "center", gap: 10,
      backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
      borderRadius: T.radioChico + 2, paddingHorizontal: 12, paddingVertical: 9,
      marginBottom: 14,
    },
    usuarioAvatar: {
      width: 28, height: 28, borderRadius: 9,
      backgroundColor: T.acento + "26", borderWidth: 1, borderColor: T.acento + "55",
      alignItems: "center", justifyContent: "center",
    },
    usuarioInicial: { color: T.acento, fontSize: 13, fontWeight: "800" },
    usuarioTxt: { flex: 1, color: T.textoSuave, fontSize: 13 },
    usuarioCambiar: { color: T.turquesa, fontSize: 12.5, fontWeight: "800" },
    syncFila: {
      flexDirection: "row", alignItems: "center", gap: 9,
      borderWidth: 1, borderRadius: T.radioChico + 2,
      paddingHorizontal: 12, paddingVertical: 9, marginBottom: 14,
    },
    syncPunto: { width: 8, height: 8, borderRadius: 4 },
    syncTxt: { flex: 1, color: T.textoSuave, fontSize: 12.5, fontWeight: "600" },
    syncVer: { color: T.turquesa, fontSize: 12.5, fontWeight: "800" },

    // Aviso de visita de proveedores (junta con la tarjeta de turno)
    avisoProv: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: T.superficie,
      borderWidth: 1, borderColor: T.borde,
      borderRadius: T.radio, padding: 14, marginBottom: 22,
      ...sombraSuave,
    },
    avisoProvIcono: {
      width: 38, height: 38, borderRadius: 11,
      backgroundColor: T.acento + "1f", borderWidth: 1, borderColor: T.acento + "44",
      alignItems: "center", justifyContent: "center",
    },
    avisoProvTxt: { color: T.textoSuave, fontSize: 14 },
    avisoProvMeta: { color: T.textoTenue, fontSize: 12, marginTop: 2 },
    avisoProvFlecha: { color: T.turquesa, fontSize: 15, fontWeight: "800" },

    // Tu arranque (misiones)
    arranqueCab: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 10,
    },
    arranqueConteo: { color: T.acento, fontSize: 12, fontWeight: "800" },
    misiones: { gap: 8, marginBottom: 22 },
    mision: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: T.superficie,
      borderWidth: 1,
      borderColor: T.borde,
      borderRadius: T.radio,
      padding: 14,
      ...sombraSuave,
    },
    misionHecha: { borderColor: T.exito + "66", backgroundColor: T.exitoSuave + "33" },
    misionIcono: {
      width: 38,
      height: 38,
      borderRadius: 11,
      backgroundColor: T.acento + "1f",
      borderWidth: 1,
      borderColor: T.acento + "44",
      alignItems: "center",
      justifyContent: "center",
    },
    misionPaloma: { color: T.exito, fontSize: 17, fontWeight: "800" },
    misionTituloFila: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    misionTitulo: { flex: 1, color: T.texto, fontSize: 14.5, fontWeight: "800" },
    misionProgreso: { color: T.acento, fontSize: 12, fontWeight: "800", ...cifras },
    barra: {
      height: 6,
      borderRadius: 3,
      backgroundColor: T.superficie3,
      marginTop: 9,
      overflow: "hidden",
    },
    barraRelleno: {
      height: 6,
      borderRadius: 3,
      backgroundColor: T.acento,
      minWidth: 0,
    },
    misionDetalle: { color: T.textoTenue, fontSize: 12, marginTop: 7, lineHeight: 17 },
    misionFlecha: { color: T.turquesa, fontSize: 15, fontWeight: "800" },

    // Celebración una sola vez
    festejoWrap: {
      overflow: "visible",
      paddingTop: 76,   // espacio para la ráfaga de confeti sobre la tarjeta
      marginTop: -54,   // sin empujar de más el contenido de abajo
      marginBottom: 22,
    },
    festejoCaja: {
      backgroundColor: T.exitoSuave,
      borderWidth: 1,
      borderColor: T.exito,
      borderRadius: T.radioGrande,
      padding: 20,
      gap: 8,
      ...sombraSuave,
    },
    festejoTitulo: { color: T.exitoTexto, fontSize: 16, fontWeight: "900" },
    festejoTxt: { color: T.exitoTexto, fontSize: 13.5, lineHeight: 20, marginBottom: 6 },
  });
}
