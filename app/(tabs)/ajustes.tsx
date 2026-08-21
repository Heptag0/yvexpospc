// YvexPOS Móvil — Pantalla AJUSTES.
//
// ---------------------------------------------------------------------------
// CÓMO SE REORGANIZÓ (y por qué se veía mal antes)
// ---------------------------------------------------------------------------
// Antes había 8 grupos de tamaños muy distintos (de 1 a 3 filas) con el
// mismo peso visual cada uno, y "Departamentos" aparecía aquí bajo "Ventas y
// usuarios" — una TERCERA entrada a la misma pantalla que ya vive en el
// panel de Herramientas ("Tu catálogo") y en la propia barra de acciones de
// Inventario. Ajustes es para PREFERENCIAS de cómo se comporta la app, no
// un tercer camino a gestionar el catálogo — así que esa fila se quitó de
// aquí, no se está perdiendo nada, solo dejó de duplicarse.
//
// Reorganización:
//   · TU NEGOCIO       — solo, una fila. Es la identidad del negocio, no
//                         necesita compañía para pesar.
//   · APARIENCIA        — Tema, Acento, Iconos, Densidad, Bordes. Estos dos
//                         últimos ya existían como tokens desde la Fase 1
//                         (apariencia.ts) pero nunca tuvieron una pantalla
//                         que los expusiera — el mismo tipo de función a
//                         medias que el badge de pedidos web en Inicio.
//   · OPERACIÓN         — Modo de uso + Escáner de tickets. Antes "Escáner
//                         de tickets" tenía su propio grupo "INVENTARIO"
//                         para una sola fila — un encabezado que no pesaba
//                         lo suficiente para justificar existir solo.
//   · VENTAS Y USUARIOS — Usuarios y PIN, sin Departamentos.
//   · PROGRAMA DE LEALTAD, CUENTA Y NUBE, ACERCA DE — igual que antes,
//                         porque ya estaban bien delimitados.
//
// ---------------------------------------------------------------------------
// LAS SUB-VISTAS AHORA SON <Hoja>, NO PANTALLAS DE ESTADO LOCAL
// ---------------------------------------------------------------------------
// Antes "Apariencia", "Modo de uso", etc. eran una variable `vista` en
// estado local que sustituía el contenido de toda la pantalla — sin que el
// botón Atrás de Android supiera nada de eso (el mismo bug que se corrigió
// en Vender para el drill-down de departamentos). <Hoja> usa el <Modal> real
// de React Native, que SÍ intercepta el botón Atrás de forma nativa — el
// arreglo llega gratis, como efecto del cambio de arquitectura, no como un
// parche aparte.

import { useState, useCallback, useEffect, memo, type ReactNode } from "react";
import { View, TextInput, Pressable, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation, router } from "expo-router";
import { useTema } from "@/src/componentes/TemaProvider";
import { TEMAS, ACENTOS } from "@/src/base/apariencia";
import { Icono, IconoUI, IdUI } from "@/src/componentes/iconos";
import MuestraTema from "@/src/componentes/MuestraTema";
import ModalUsuarios from "@/src/componentes/ModalUsuarios";
import ModalSync from "@/src/componentes/ModalSync";
import ModalCuenta from "@/src/componentes/ModalCuenta";
import ModalAjustesEscaner from "@/src/componentes/ModalAjustesEscaner";
import ModalBolsa from "@/src/componentes/ModalBolsa";
import { pideePin, setPedirPin } from "@/src/base/usuarios";
import { EstadoCuenta, estadoCuenta } from "@/src/base/nube";
import { MODOS, ModoUso, leerModoUso, guardarModoUso } from "@/src/base/modoUso";
import {
  GIROS,
  leerGiro,
  guardarGiro,
  leerNombreNegocio,
  guardarNombreNegocio,
} from "@/src/base/giro";
import { leerConfig } from "@/src/base/config";
import { leerConteoCiegoActivo, guardarConteoCiegoActivo } from "@/src/base/venta";
import { ReglasLealtad, leerReglas, guardarReglas } from "@/src/base/lealtad";
import { fmtFecha } from "@/src/base/formato";
import {
  Pantalla,
  Encabezado,
  Seccion,
  Grupo,
  Fila,
  Txt,
  Boton,
  Hoja,
  useEstiloInput,
} from "@/src/componentes/ui";
import appJson from "../../app.json";

const VERSION: string = (appJson as any)?.expo?.version ?? "1.0.0";

const PACKS: { id: string; nombre: string; desc: string }[] = [
  { id: "trazo", nombre: "Trazo", desc: "Líneas finas · elegante y ligero" },
  { id: "solido", nombre: "Sólido", desc: "Rellenos · más presencia visual" },
  { id: "inicial", nombre: "Inicial", desc: "Solo la letra · minimalista" },
];

type SubVista = "apariencia" | "modo" | "negocio" | "acerca" | "lealtad" | null;

export default function AjustesScreen() {
  const { prefs, tema: T, setTema, setAcento, setPack, setDensidad, setBordes, setModoRendimiento } = useTema();
  const [sub, setSub] = useState<SubVista>(null);
  const [usuariosAbierto, setUsuariosAbierto] = useState(false);
  const [syncAbierto, setSyncAbierto] = useState(false);
  const [cuentaAbierta, setCuentaAbierta] = useState(false);
  const [ajustesEscanerAbierto, setAjustesEscanerAbierto] = useState(false);
  // Las dos tarjetas nuevas del hub abren una Hoja propia que agrupa lo
  // que antes eran filas sueltas en el menú plano.
  const [cuentaNubeAbierta, setCuentaNubeAbierta] = useState(false);
  const [sistemaAbierto, setSistemaAbierto] = useState(false);
  const [cuenta, setCuenta] = useState<EstadoCuenta | null>(null);
  const [modo, setModo] = useState<ModoUso | null>(null);
  const [pedirPin, setPedirPinEstado] = useState(false);
  // Conteo a ciegas: opcional, apagado por defecto — el dueño lo activa si
  // quiere. Con esto activo, el corte de turno oculta el efectivo esperado
  // hasta que el cajero captura lo que contó físicamente.
  const [conteoCiegoActivo, setConteoCiegoActivoEstado] = useState(false);
  const [bolsaAbierta, setBolsaAbierta] = useState(false);
  const [ultimaSync, setUltimaSync] = useState<string | null>(null);
  const [avisoModo, setAvisoModo] = useState(false);
  const [nombreNegocio, setNombreNegocio] = useState("Mi negocio");
  const [giroId, setGiroId] = useState("otro");
  const [negocioEdit, setNegocioEdit] = useState("Mi negocio");
  const [giroEdit, setGiroEdit] = useState("otro");

  const [reglas, setReglas] = useState<ReglasLealtad | null>(null);
  const [lealtadEdit, setLealtadEdit] = useState({
    pesosPorPunto: "10",
    puntosVisita: "5",
    valorPuntoPesos: "1.00",
    topePct: "50",
  });

  const cargar = useCallback(() => {
    estadoCuenta().then(setCuenta);
    leerModoUso().then(setModo);
    pideePin().then(setPedirPinEstado);
    leerConfig("ultima_sync").then(setUltimaSync);
    leerNombreNegocio().then(setNombreNegocio);
    leerGiro().then(setGiroId);
    leerReglas().then(setReglas);
    leerConteoCiegoActivo().then(setConteoCiegoActivoEstado);
  }, []);

  useFocusEffect(cargar);

  // Re-tap en la pestaña Ajustes estando en una sub-vista: vuelve al menú.
  const navigation = useNavigation();
  useEffect(() => {
    const quitar = (navigation as any).addListener("tabPress", () => setSub(null));
    return quitar;
  }, [navigation]);

  async function elegirModo(m: ModoUso) {
    setModo(m);
    setAvisoModo(true);
    await guardarModoUso(m);
    // Las pestañas cambian según el modo: vamos a Inicio para que el cambio
    // se aplique al momento, sin el texto confuso de "actualizan al volver".
    setTimeout(() => router.replace("/(tabs)"), 600);
  }

  async function cambiarPedirPin(valor: boolean) {
    setPedirPinEstado(valor);
    await setPedirPin(valor);
  }

  async function cambiarConteoCiego(valor: boolean) {
    setConteoCiegoActivoEstado(valor);
    await guardarConteoCiegoActivo(valor);
  }

  function abrirNegocio() {
    setNegocioEdit(nombreNegocio);
    setGiroEdit(giroId);
    setSub("negocio");
  }

  async function guardarNegocio() {
    await guardarNombreNegocio(negocioEdit);
    await guardarGiro(giroEdit);
    setNombreNegocio(negocioEdit.trim() === "" ? "Mi negocio" : negocioEdit.trim());
    setGiroId(GIROS.some((g) => g.id === giroEdit) ? giroEdit : "otro");
    setSub(null);
  }

  function abrirLealtad() {
    if (reglas) {
      setLealtadEdit({
        pesosPorPunto: String(reglas.pesosPorPunto),
        puntosVisita: String(reglas.puntosVisita),
        valorPuntoPesos: (reglas.valorPuntoCentavos / 100).toFixed(2),
        topePct: String(reglas.topeDescuentoPct),
      });
    }
    setSub("lealtad");
  }

  async function cambiarLealtadActiva(valor: boolean) {
    if (!reglas) return;
    const nuevas = { ...reglas, activa: valor };
    setReglas(nuevas);
    await guardarReglas(nuevas);
  }

  async function guardarLealtad() {
    if (!reglas) return;
    const aNum = (t: string, defecto: number) => {
      const n = parseFloat(t.replace(",", "."));
      return Number.isFinite(n) && n > 0 ? n : defecto;
    };
    const nuevas: ReglasLealtad = {
      activa: reglas.activa,
      pesosPorPunto: aNum(lealtadEdit.pesosPorPunto, reglas.pesosPorPunto),
      puntosVisita: Math.round(aNum(lealtadEdit.puntosVisita, reglas.puntosVisita)),
      valorPuntoCentavos: Math.round(
        aNum(lealtadEdit.valorPuntoPesos, reglas.valorPuntoCentavos / 100) * 100
      ),
      topeDescuentoPct: Math.min(100, Math.round(aNum(lealtadEdit.topePct, reglas.topeDescuentoPct))),
    };
    setReglas(nuevas);
    await guardarReglas(nuevas);
    setSub(null);
  }

  const temaActivo = TEMAS.find((t) => t.id === prefs.tema);
  const acentoActivo = ACENTOS.find((a) => a.id === prefs.acento);
  const modoActivo = MODOS.find((m) => m.id === modo);
  const giroActivo = GIROS.find((g) => g.id === giroId);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.fondo }} edges={["top"]}>
      <Pantalla>
        <Encabezado titulo="Ajustes" />

        {/* -----------------------------------------------------------
            EL HUB: cuadrícula de 6 tarjetas, no una lista larga.
            -----------------------------------------------------------
            Antes era una sola lista de 7 grupos desiguales (de 1 a 3 filas)
            todos con el mismo peso visual. Ahora cada categoría es una
            tarjeta con su propio estado glanceable — el tema activo, el
            nombre del negocio, si la nube está al día — así la pantalla
            informa antes de que el usuario toque nada, en vez de ser un
            menú de texto que hay que leer fila por fila.

            "Sistema" es la excepción a propósito: agrupa lo que NO necesita
            una tarjeta propia porque no cambia casi nunca ni tiene estado
            interesante que mostrar (usuarios, PIN, umbrales del escáner,
            versión). Es la lista tipo Ajustes de Android/iOS de siempre,
            pero como UNA tarjeta entre varias, no como toda la pantalla. */}
        <View style={{ gap: T.esps.md }}>
          <FilaTarjetas>
            <TarjetaAjuste
              icono="tienda"
              titulo="Tu negocio"
              meta={`${nombreNegocio} · ${giroActivo?.nombre ?? "Otro giro"}`}
              onPress={abrirNegocio}
            />
            <TarjetaAjuste
              icono="imagen"
              titulo="Apariencia"
              meta={temaActivo && acentoActivo ? `${temaActivo.nombre} · ${acentoActivo.nombre}` : "Tema y color"}
              punto={acentoActivo?.color}
              onPress={() => setSub("apariencia")}
            />
          </FilaTarjetas>
          <FilaTarjetas>
            <TarjetaAjuste
              icono="vender"
              titulo="Operación"
              meta={modoActivo ? modoActivo.nombre : "Modo de uso"}
              onPress={() => setSub("modo")}
            />
            <TarjetaAjuste
              icono="regalo"
              titulo="Lealtad"
              meta={reglas ? (reglas.activa ? "Programa activo" : "Pausado") : "Puntos y canjes"}
              onPress={abrirLealtad}
            />
          </FilaTarjetas>
          <FilaTarjetas>
            <TarjetaAjuste
              titulo="Cuenta y nube"
              meta={
                cuenta?.vinculado
                  ? ultimaSync
                    ? `Sincronizado · ${fmtFecha(ultimaSync)}`
                    : "Vinculada"
                  : "Modo local"
              }
              punto={cuenta?.vinculado ? T.exito : T.textoTenue}
              onPress={() => setCuentaNubeAbierta(true)}
            />
            <TarjetaAjuste
              icono="ajustes"
              titulo="Sistema"
              meta={`Usuarios, versión ${VERSION} y más`}
              onPress={() => setSistemaAbierto(true)}
            />
          </FilaTarjetas>
        </View>
      </Pantalla>

      {/* ---------------------------------------------------------------
          SUB-VISTAS — todas <Hoja>. El Modal real de RN intercepta Atrás
          nativamente: no hace falta un BackHandler aparte para esto.
          --------------------------------------------------------------- */}

      <Hoja
        visible={sub === "apariencia"}
        onCerrar={() => setSub(null)}
        titulo="Apariencia"
        tipo="completa"
      >
        <Seccion titulo="Tema">
          <View style={{ gap: T.esps.sm }}>
            {TEMAS.map((t) => {
              const activo = prefs.tema === t.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setTema(t.id)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: T.esps.md,
                    backgroundColor: T.superficie,
                    borderRadius: T.radio,
                    borderWidth: activo ? 1.5 : 1,
                    borderColor: activo ? T.acento : T.borde,
                    padding: T.esps.md,
                  }}
                >
                  <MuestraTema paleta={t.paleta} acentoColor={T.acento} esClaro={t.esClaro} />
                  <View style={{ flex: 1 }}>
                    <Txt escala="cuerpo" fuerte>
                      {t.nombre}
                    </Txt>
                    <Txt escala="pie" tono="tenue">
                      {t.desc}
                    </Txt>
                  </View>
                  {activo ? <Marca /> : null}
                </Pressable>
              );
            })}
          </View>
        </Seccion>

        <Seccion titulo="Color de acento">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: T.esps.lg }}>
            {ACENTOS.map((a) => {
              const activo = prefs.acento === a.id;
              return (
                <Pressable
                  key={a.id}
                  onPress={() => setAcento(a.id)}
                  style={{ alignItems: "center", gap: T.esps.xs, width: 64 }}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: a.color,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: activo ? 2.5 : 0,
                      borderColor: T.texto,
                    }}
                  >
                    {/* Antes: check ✓ blanco fijo — medido y falla en 7 de 9
                        acentos (mismo bug que ModalTienda y onboarding). El
                        anillo de arriba + la etiqueta en negrita de abajo ya
                        marcan la selección sin depender del color del swatch. */}
                  </View>
                  <Txt escala="micro" tono={activo ? "principal" : "suave"} fuerte={activo}>
                    {a.nombre}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </Seccion>

        <Seccion titulo="Iconos de producto">
          <View style={{ gap: T.esps.sm }}>
            {PACKS.map((p) => {
              const activo = prefs.pack === p.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setPack(p.id)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: T.esps.md,
                    backgroundColor: T.superficie,
                    borderRadius: T.radio,
                    borderWidth: activo ? 1.5 : 1,
                    borderColor: activo ? T.acento : T.borde,
                    padding: T.esps.md,
                  }}
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
                    {p.id === "inicial" ? (
                      <Txt escala="cuerpo" fuerte tono="acento">
                        C
                      </Txt>
                    ) : (
                      <Icono id="refresco" size={24} color={T.acento} relleno={p.id === "solido"} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt escala="cuerpo" fuerte>
                      {p.nombre}
                    </Txt>
                    <Txt escala="pie" tono="tenue">
                      {p.desc}
                    </Txt>
                  </View>
                  {activo ? <Marca /> : null}
                </Pressable>
              );
            })}
          </View>
        </Seccion>

        {/* Densidad y bordes: tokens que existen desde la Fase 1 pero nunca
            tuvieron dónde cambiarse. Segmentados, no tarjetas — son solo dos
            opciones cada uno y ya usan este patrón en Reportes e Inventario,
            así el usuario reconoce el control en vez de aprender uno nuevo. */}
        <Seccion titulo="Densidad">
          <Segmentado
            opciones={[
              { id: "comoda", label: "Cómoda" },
              { id: "compacta", label: "Compacta" },
            ]}
            valor={prefs.densidad}
            onCambio={(v) => setDensidad(v)}
          />
        </Seccion>

        <Seccion titulo="Bordes">
          <Segmentado
            opciones={[
              { id: "suaves", label: "Suaves" },
              { id: "rectos", label: "Rectos" },
            ]}
            valor={prefs.bordes}
            onCambio={(v) => setBordes(v)}
          />
        </Seccion>

        <Seccion titulo="Rendimiento">
          <Grupo>
            <Fila
              titulo="Modo rendimiento"
              meta="Apaga el desenfoque al ver fotos de producto en grande — ayuda en equipos más lentos"
              flecha={false}
              valor={
                <Switch
                  value={prefs.modoRendimiento}
                  onValueChange={setModoRendimiento}
                  trackColor={{ false: T.superficie3, true: T.acentoBorde }}
                  thumbColor={prefs.modoRendimiento ? T.acento : T.textoTenue}
                />
              }
            />
          </Grupo>
        </Seccion>
      </Hoja>

      <Hoja visible={sub === "modo"} onCerrar={() => setSub(null)} titulo="Modo de uso" tipo="completa">
        <Txt escala="pie" tono="suave" estilo={{ marginBottom: T.esps.lg }}>
          ¿Para qué usas este dispositivo? Puedes cambiarlo cuando quieras.
        </Txt>
        <View style={{ gap: T.esps.sm }}>
          {MODOS.map((m) => {
            const activo = modo === m.id;
            return (
              <Pressable
                key={m.id}
                onPress={() => elegirModo(m.id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: T.superficie,
                  borderRadius: T.radio,
                  borderWidth: activo ? 1.5 : 1,
                  borderColor: activo ? T.acento : T.borde,
                  padding: T.esps.md,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Txt escala="cuerpo" fuerte>
                    {m.nombre}
                  </Txt>
                  <Txt escala="pie" tono="suave" estilo={{ marginTop: 2 }}>
                    {m.desc}
                  </Txt>
                  <Txt escala="micro" tono="tenue" estilo={{ marginTop: 2 }}>
                    {m.ejemplo}
                  </Txt>
                </View>
                {activo ? <Marca /> : null}
              </Pressable>
            );
          })}
        </View>
        {avisoModo ? (
          <Txt escala="pie" tono="tenue" estilo={{ marginTop: T.esps.lg }}>
            Modo actualizado · volviendo a Inicio…
          </Txt>
        ) : null}
      </Hoja>

      <Hoja
        visible={sub === "negocio"}
        onCerrar={() => setSub(null)}
        titulo="Tu negocio"
        tipo="completa"
        pie={<Boton titulo="Guardar cambios" onPress={guardarNegocio} />}
      >
        <Txt escala="pie" tono="suave" estilo={{ marginBottom: T.esps.lg }}>
          El nombre aparece en la pantalla de inicio; el giro nos ayuda a sugerirte lo
          que más le sirve a tu negocio.
        </Txt>

        <Seccion titulo="Nombre del negocio">
          <CampoTexto
            valor={negocioEdit}
            onCambio={setNegocioEdit}
            placeholder="Ej. Abarrotes Lupita"
          />
        </Seccion>

        <Seccion titulo="Giro">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: T.esps.sm }}>
            {GIROS.map((g) => {
              const activo = giroEdit === g.id;
              return (
                <Pressable
                  key={g.id}
                  onPress={() => setGiroEdit(g.id)}
                  style={{
                    width: "31%",
                    alignItems: "center",
                    gap: T.esps.sm,
                    backgroundColor: activo ? T.acentoSuave : T.superficie,
                    borderRadius: T.radio,
                    borderWidth: 1,
                    borderColor: activo ? T.acento : T.borde,
                    paddingVertical: T.esps.md,
                  }}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: T.radioChico,
                      backgroundColor: T.superficie2,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderColor: activo ? T.acento : T.bordeFuerte,
                    }}
                  >
                    <IconoUI id={g.icono} size={20} color={activo ? T.acento : T.textoSuave} />
                  </View>
                  <Txt escala="micro" lineas={2} estilo={{ textAlign: "center" }}>
                    {g.nombre}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </Seccion>
      </Hoja>

      <Hoja
        visible={sub === "lealtad"}
        onCerrar={() => setSub(null)}
        titulo="Programa de lealtad"
        tipo="completa"
        pie={<Boton titulo="Guardar reglas" onPress={guardarLealtad} />}
      >
        <Txt escala="pie" tono="suave" estilo={{ marginBottom: T.esps.lg }}>
          Tus clientes ganan puntos por cada compra y por visitar tu negocio; al cobrar
          pueden canjearlos como descuento (tú siempre confirmas en pantalla, nada se
          descuenta solo).
        </Txt>

        <View style={{ marginBottom: T.esps.xl }}>
          <Grupo>
            <Fila
              titulo="Programa activo"
              meta="Si lo apagas, el botón Cliente y la fila de Inicio se ocultan; los puntos guardados se conservan."
              flecha={false}
              valor={
                <Switch
                  value={reglas?.activa ?? true}
                  onValueChange={cambiarLealtadActiva}
                  trackColor={{ false: T.superficie3, true: T.acentoBorde }}
                  thumbColor={reglas?.activa ? T.acento : T.textoTenue}
                />
              }
            />
          </Grupo>
        </View>

        <Seccion titulo="Sumar puntos">
          <CampoLealtad
            etiqueta="Pesos por punto"
            ayuda="1 punto por cada $X de compra (ej. 10 = un punto por cada $10)"
            valor={lealtadEdit.pesosPorPunto}
            onCambio={(v) => setLealtadEdit((s) => ({ ...s, pesosPorPunto: v }))}
          />
          <CampoLealtad
            etiqueta="Puntos por visita"
            ayuda="Se otorgan una vez al día por cliente, aunque no compre"
            valor={lealtadEdit.puntosVisita}
            onCambio={(v) => setLealtadEdit((s) => ({ ...s, puntosVisita: v }))}
          />
        </Seccion>

        <Seccion titulo="Canjear puntos">
          <CampoLealtad
            etiqueta="Valor del punto (pesos)"
            ayuda="Cuánto descuenta cada punto al canjear (ej. 1.00 = $1 por punto)"
            valor={lealtadEdit.valorPuntoPesos}
            onCambio={(v) => setLealtadEdit((s) => ({ ...s, valorPuntoPesos: v }))}
          />
          <CampoLealtad
            etiqueta="Tope del ticket (%)"
            ayuda="Qué porcentaje del ticket puede pagarse con puntos (ej. 50 = hasta la mitad)"
            valor={lealtadEdit.topePct}
            onCambio={(v) => setLealtadEdit((s) => ({ ...s, topePct: v }))}
          />
        </Seccion>
      </Hoja>

      <Hoja visible={sub === "acerca"} onCerrar={() => setSub(null)} titulo="Acerca de" tipo="completa">
        <View style={{ alignItems: "center", marginTop: T.esps.xxl }}>
          <Txt escala="titulo" fuerte>
            YvexPOS
          </Txt>
          <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.xs }}>
            YvexPOS Móvil · Versión {VERSION}
          </Txt>
          <Txt
            escala="pie"
            tono="tenue"
            estilo={{ textAlign: "center", marginTop: T.esps.lg, paddingHorizontal: T.esps.lg }}
          >
            Hecho para tu negocio: vende con o sin internet y revisa cómo va el día,
            estés donde estés.
          </Txt>
        </View>
      </Hoja>

      {/* Cuenta y nube: agrupa las dos filas que antes vivían sueltas en el
          menú plano. Cada una sigue abriendo su propio modal, sin cambios
          en esa parte. */}
      <Hoja
        visible={cuentaNubeAbierta}
        onCerrar={() => setCuentaNubeAbierta(false)}
        titulo="Cuenta y nube"
        tipo="completa"
      >
        <Grupo>
          <Fila
            titulo="Cuenta"
            meta={cuenta?.vinculado ? (cuenta.email ?? "Cuenta vinculada") : "Modo local — sin cuenta"}
            onPress={() => setCuentaAbierta(true)}
          />
          <Fila
            titulo="Sincronización"
            meta={ultimaSync ? `Última sincronización: ${fmtFecha(ultimaSync)}` : "Respaldar y sincronizar"}
            onPress={() => setSyncAbierto(true)}
          />
        </Grupo>
      </Hoja>

      {/* Sistema: lo que no necesita tarjeta propia porque no cambia casi
          nunca ni tiene estado interesante que mostrar. La lista tipo
          Ajustes de Android/iOS de siempre, ahora como UNA tarjeta más. */}
      <Hoja
        visible={sistemaAbierto}
        onCerrar={() => setSistemaAbierto(false)}
        titulo="Sistema"
        tipo="completa"
      >
        <Seccion titulo="Ventas y usuarios">
          <Grupo>
            <Fila
              titulo="Usuarios y PIN"
              meta="Quién puede vender aquí"
              onPress={() => setUsuariosAbierto(true)}
            />
            <Fila
              titulo="Pedir PIN al cambiar de usuario"
              meta="Cada quien entra con su código"
              flecha={false}
              valor={
                <Switch
                  value={pedirPin}
                  onValueChange={cambiarPedirPin}
                  trackColor={{ false: T.superficie3, true: T.acentoBorde }}
                  thumbColor={pedirPin ? T.acento : T.textoTenue}
                />
              }
            />
          </Grupo>
        </Seccion>

        <Seccion titulo="Caja y turnos">
          <Grupo>
            <Fila
              titulo="Conteo a ciegas al cerrar turno"
              meta="El cajero cuenta primero; el esperado se revela después. Apagado, se ve como siempre."
              flecha={false}
              valor={
                <Switch
                  value={conteoCiegoActivo}
                  onValueChange={cambiarConteoCiego}
                  trackColor={{ false: T.superficie3, true: T.acentoBorde }}
                  thumbColor={conteoCiegoActivo ? T.acento : T.textoTenue}
                />
              }
            />
            <Fila
              titulo="Bolsa de caja"
              meta="Sobrantes y faltantes acumulados, por usuario"
              onPress={() => setBolsaAbierta(true)}
            />
          </Grupo>
        </Seccion>

        <Seccion titulo="Inventario">
          <Grupo>
            <Fila
              titulo="Escáner de tickets"
              meta="Umbrales de aviso, margen y redondeo"
              onPress={() => setAjustesEscanerAbierto(true)}
            />
          </Grupo>
        </Seccion>

        <Seccion titulo="Acerca de">
          <Grupo>
            <Fila
              titulo="Acerca de YvexPOS"
              meta={`Versión ${VERSION}`}
              onPress={() => setSub("acerca")}
            />
          </Grupo>
        </Seccion>
      </Hoja>

      {/* --- Modales de contexto --- */}
      {usuariosAbierto && (
        <ModalUsuarios modo="gestionar" onCerrar={() => setUsuariosAbierto(false)} onCambio={cargar} />
      )}
      {syncAbierto && <ModalSync onCerrar={() => setSyncAbierto(false)} onCambio={cargar} />}
      {cuentaAbierta && (
        <ModalCuenta
          onCerrar={() => {
            setCuentaAbierta(false);
            cargar();
          }}
          onCambio={cargar}
        />
      )}
      {ajustesEscanerAbierto && (
        <ModalAjustesEscaner onCerrar={() => setAjustesEscanerAbierto(false)} />
      )}
      {bolsaAbierta && <ModalBolsa onCerrar={() => setBolsaAbierta(false)} />}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Marca de "seleccionado" — el mismo check en todas las listas de opciones.
// ---------------------------------------------------------------------------
// El hub de tarjetas
// ---------------------------------------------------------------------------

/** Envuelve hasta 2 tarjetas en una fila de igual ancho. Si el conteo total
 *  de tarjetas alguna vez es impar, la última fila queda con una tarjeta y
 *  un espacio vacío — no se estira sola para llenar el ancho, así la
 *  cuadrícula se sigue leyendo como cuadrícula. */
function FilaTarjetas({ children }: { children: ReactNode }) {
  const { tema: T } = useTema();
  const hijos = Array.isArray(children) ? children : [children];
  return (
    <View style={{ flexDirection: "row", gap: T.esps.md }}>
      {hijos.map((h, i) => (
        <View key={i} style={{ flex: 1 }}>
          {h}
        </View>
      ))}
      {hijos.length === 1 ? <View style={{ flex: 1 }} /> : null}
    </View>
  );
}

/** Tarjeta del hub. Sin el tratamiento "con luz" de <Lamina> a propósito:
 *  esa firma visual está reservada para LA métrica protagonista de una
 *  pantalla (Vendido hoy, Valor de inventario...). Usarla en 6 tarjetas a
 *  la vez la volvería decoración en vez de significado. Aquí basta con una
 *  superficie elevada y, cuando aplica, un punto de estado a color — el
 *  mismo lenguaje que ya usa "Todo sincronizado" en Inicio. */
function TarjetaAjuste({
  icono,
  titulo,
  meta,
  punto,
  onPress,
}: {
  icono?: IdUI;
  titulo: string;
  meta: string;
  /** Punto de estado a color, alternativa al icono (p. ej. sync: verde/gris). */
  punto?: string;
  onPress: () => void;
}) {
  const { tema: T } = useTema();
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: T.acentoBorde }}
      style={({ pressed }) => ({
        backgroundColor: T.superficie,
        borderRadius: T.radioGrande,
        padding: T.esps.lg,
        minHeight: 112,
        justifyContent: "space-between",
        opacity: pressed ? 0.92 : 1,
        shadowColor: "#000",
        shadowOpacity: T.esClaro ? 0.06 : 0.22,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 2,
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
        {punto ? (
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: punto }} />
        ) : icono ? (
          <IconoUI id={icono} size={18} color={T.acento} />
        ) : null}
      </View>
      <View>
        <Txt escala="cuerpo" fuerte lineas={1}>
          {titulo}
        </Txt>
        <Txt escala="micro" tono="suave" lineas={2} estilo={{ marginTop: 2 }}>
          {meta}
        </Txt>
      </View>
    </Pressable>
  );
}

function Marca() {
  const { tema: T } = useTema();
  return (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: T.acentoRelleno,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Txt escala="micro" fuerte estilo={{ color: T.acentoTexto }}>
        ✓
      </Txt>
    </View>
  );
}

// Segmentado de 2 opciones — el mismo patrón visual que el selector de rango
// en Reportes y el toggle Costo/Venta en Inventario. Reconocible, no un
// control nuevo que aprender.
function SegmentadoBase({
  opciones,
  valor,
  onCambio,
}: {
  opciones: { id: string; label: string }[];
  valor: string;
  onCambio: (id: string) => void;
}) {
  const { tema: T } = useTema();
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: T.superficie2,
        borderRadius: T.radio,
        padding: 3,
      }}
    >
      {opciones.map((o) => {
        const activo = valor === o.id;
        return (
          <Pressable
            key={o.id}
            onPress={() => onCambio(o.id)}
            style={{
              flex: 1,
              minHeight: 40,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: T.radioChico,
              backgroundColor: activo ? T.acentoRelleno : "transparent",
            }}
          >
            <Txt
              escala="pie"
              fuerte={activo}
              tono="suave"
              estilo={activo ? { color: T.acentoTexto } : undefined}
            >
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
const Segmentado = memo(SegmentadoBase);

function CampoTexto({
  valor,
  onCambio,
  placeholder,
}: {
  valor: string;
  onCambio: (v: string) => void;
  placeholder: string;
}) {
  const { tema: T } = useTema();
  const estilo = useEstiloInput();
  return (
    <TextInput
      style={estilo}
      value={valor}
      onChangeText={onCambio}
      placeholder={placeholder}
      placeholderTextColor={T.textoTenue}
      autoCapitalize="words"
      returnKeyType="done"
    />
  );
}

function CampoLealtad({
  etiqueta,
  ayuda,
  valor,
  onCambio,
}: {
  etiqueta: string;
  ayuda: string;
  valor: string;
  onCambio: (v: string) => void;
}) {
  const { tema: T } = useTema();
  const estilo = useEstiloInput();
  return (
    <View style={{ marginBottom: T.esps.lg }}>
      <Txt escala="pie" fuerte estilo={{ marginBottom: T.esps.xs }}>
        {etiqueta}
      </Txt>
      <TextInput
        style={estilo}
        value={valor}
        onChangeText={onCambio}
        keyboardType="decimal-pad"
        placeholderTextColor={T.textoTenue}
      />
      <Txt escala="micro" tono="tenue" estilo={{ marginTop: T.esps.xs }}>
        {ayuda}
      </Txt>
    </View>
  );
}
