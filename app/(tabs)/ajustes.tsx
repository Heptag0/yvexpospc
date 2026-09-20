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
import { View, TextInput, Pressable, Switch, Linking, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation, router } from "expo-router";
import { useTema } from "@/src/componentes/TemaProvider";
import { TEMAS, ACENTOS } from "@/src/base/apariencia";
import { Icono, IconoUI } from "@/src/componentes/iconos";
import MuestraTema from "@/src/componentes/MuestraTema";
import ModalUsuarios from "@/src/componentes/ModalUsuarios";
import { permisosActuales, type MapaPermisos } from "@/src/base/permisos";
import ModalSync from "@/src/componentes/ModalSync";
import ModalCuenta from "@/src/componentes/ModalCuenta";
import ModalAjustesEscaner from "@/src/componentes/ModalAjustesEscaner";
import ModalBolsa from "@/src/componentes/ModalBolsa";
import { pideePin, setPedirPin, listarUsuarios } from "@/src/base/usuarios";
import { EstadoCuenta, estadoCuenta } from "@/src/base/nube";
import { MODOS, ModoUso, leerModoUso, guardarModoUso } from "@/src/base/modoUso";
import {
  GIROS,
  leerGiro,
  guardarGiro,
  leerNombreNegocio,
  guardarNombreNegocio,
} from "@/src/base/giro";
import {
  leerConfig,
  leerConsentimientoEscaner,
  guardarConsentimientoEscaner,
} from "@/src/base/config";
import { leerConteoCiegoActivo, guardarConteoCiegoActivo } from "@/src/base/venta";
import { ReglasLealtad, leerReglas, guardarReglas } from "@/src/base/lealtad";
import { ConfigImpuesto, leerConfigImpuesto, guardarConfigImpuesto } from "@/src/base/impuestos";
import { fmtFecha } from "@/src/base/formato";
import {
  Pantalla,
  Encabezado,
  Seccion,
  Grupo,
  Fila,
  Txt,
  Monto,
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

type SubVista =
  | "apariencia" | "modo" | "negocio" | "acerca" | "lealtad" | "impuesto"
  | "plan"   // qué es gratis, qué será de pago
  | null;

// ---------------------------------------------------------------------------
// CONTACTO Y LEGAL
//
// Un solo sitio para las direcciones y las URL. Están repetidas en la web, en
// la política y en la ficha de Play: si algún día cambian, que en la app haya
// que tocar UNA línea y no buscarlas por todo el archivo.
// ---------------------------------------------------------------------------
const CORREO_CONTACTO = "contacto@yvexiq.com";
const CORREO_PRIVACIDAD = "privacidad@yvexiq.com";
const URL_PRIVACIDAD = "https://yvexiq.com/privacidad";
const URL_TERMINOS = "https://yvexiq.com/terminos";

/** Precio orientativo del plan de pago. "desde" a propósito: deja margen para
 *  un escalón superior sin desmentir lo que se prometió en la beta. */
const PRECIO_DESDE = "$69";

/**
 * Abre el correo con el asunto y el cuerpo ya escritos.
 *
 * POR QUÉ EL REPORTE LLEVA DATOS TÉCNICOS DELANTE
 * Un reporte que dice "no funciona" no se puede rastrear. La versión de la
 * app, el sistema y si la caja está vinculada son las tres cosas que primero
 * se preguntan siempre, así que van escritas de antemano. El usuario solo
 * tiene que contar qué pasó.
 *
 * Van al final del cuerpo y bajo una línea, para que quien escribe no sienta
 * que tiene que rellenar un formulario técnico antes de poder quejarse.
 */
async function abrirCorreo(
  destino: string,
  asunto: string,
  cuerpo: string,
): Promise<boolean> {
  const url =
    `mailto:${destino}` +
    `?subject=${encodeURIComponent(asunto)}` +
    `&body=${encodeURIComponent(cuerpo)}`;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    // Sin app de correo configurada. No es un error de la app y no debe
    // parecerlo: el llamador enseña la dirección para copiarla a mano.
    return false;
  }
}

export default function AjustesScreen() {
  const { prefs, tema: T, setTema, setAcento, setPack, setDensidad, setBordes, setModoRendimiento } = useTema();
  const [sub, setSub] = useState<SubVista>(null);
  const [usuariosAbierto, setUsuariosAbierto] = useState(false);
  // null mientras cargan: se oculta lo sensible hasta saber quién es. Es
  // preferible que una tarjeta aparezca un instante después a que se vea y
  // desaparezca. Ocultar es cortesía; quien protege es exigirPermiso() en la
  // capa de datos (ver permisos.ts).
  const [permisos, setPermisos] = useState<MapaPermisos | null>(null);
  const [syncAbierto, setSyncAbierto] = useState(false);
  const [cuentaAbierta, setCuentaAbierta] = useState(false);
  const [ajustesEscanerAbierto, setAjustesEscanerAbierto] = useState(false);
  const [cuenta, setCuenta] = useState<EstadoCuenta | null>(null);
  const [modo, setModo] = useState<ModoUso | null>(null);
  const [pedirPin, setPedirPinEstado] = useState(false);
  const [iaEscaner, setIaEscaner] = useState(false);
  // Conteo a ciegas: opcional, apagado por defecto — el dueño lo activa si
  // quiere. Con esto activo, el corte de turno oculta el efectivo esperado
  // hasta que el cajero captura lo que contó físicamente.
  const [conteoCiegoActivo, setConteoCiegoActivoEstado] = useState(false);
  const [bolsaAbierta, setBolsaAbierta] = useState(false);
  // Cuántos usuarios hay. Es el tipo de dato que convierte una fila de menú
  // en información: "Usuarios · 3" se lee sin entrar; "Usuarios · quién
  // puede vender" obliga a entrar para saber lo mismo.
  const [numUsuarios, setNumUsuarios] = useState<number | null>(null);
  const [ultimaSync, setUltimaSync] = useState<string | null>(null);
  const [avisoModo, setAvisoModo] = useState(false);
  // Cuando no hay app de correo, se muestra la dirección para copiarla en vez
  // de fallar en silencio. null = oculto.
  const [correoManual, setCorreoManual] = useState<string | null>(null);
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

  // Impuesto (IVA/Sales Tax/IEPS…): configuración del NEGOCIO, se sincroniza
  // a las demás cajas (ver src/base/impuestos.ts + sync.ts::guardarConfigCompartida).
  // La mayoría de negocios lo deja apagado — por eso "activo" arranca en
  // false hasta que cargue el real, igual que el resto de esta pantalla.
  const [cfgImpuesto, setCfgImpuesto] = useState<ConfigImpuesto | null>(null);
  const [impuestoEdit, setImpuestoEdit] = useState({ nombre: "IVA", tasaPct: "16" });

  const cargar = useCallback(() => {
    estadoCuenta().then(setCuenta);
    leerModoUso().then(setModo);
    pideePin().then(setPedirPinEstado);
    leerConsentimientoEscaner().then(setIaEscaner);
    leerConfig("ultima_sync").then(setUltimaSync);
    leerNombreNegocio().then(setNombreNegocio);
    leerGiro().then(setGiroId);
    leerReglas().then(setReglas);
    leerConfigImpuesto().then(setCfgImpuesto);
    leerConteoCiegoActivo().then(setConteoCiegoActivoEstado);
    // Tolerante: si falla, la fila de Usuarios se queda sin cifra y muestra
    // su descripción. Nunca debe impedir que Ajustes cargue.
    listarUsuarios()
      .then((us) => setNumUsuarios(us.length))
      .catch(() => setNumUsuarios(null));
    // Se recarga al enfocar, igual que el resto: cambiar de usuario y volver
    // a Ajustes actualiza qué secciones se ven.
    permisosActuales().then(setPermisos).catch(() => setPermisos(null));
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

  // UN OPT-IN SIN SALIDA NO ES UN OPT-IN
  // ---------------------------------------------------------------------------
  // Al apagarlo, el escaner vuelve a pedir el consentimiento la proxima vez que
  // se abra: no se queda a medias ni sigue mandando fotos "porque ya habia
  // aceptado una vez". Encenderlo desde aqui tambien vale como aceptacion — es
  // la misma decision, tomada en otro sitio.
  async function cambiarIaEscaner(valor: boolean) {
    setIaEscaner(valor);
    await guardarConsentimientoEscaner(valor);
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

  function abrirImpuesto() {
    if (cfgImpuesto) {
      setImpuestoEdit({
        nombre: cfgImpuesto.nombre,
        // La tasa vive en puntos base (1600 = 16%) — se muestra como
        // porcentaje simple, igual que la tasa por producto en
        // FormularioProducto (0/16%). puntosBaseDesdePct() hace la vuelta
        // al guardar.
        tasaPct: String(Math.round(cfgImpuesto.tasaGeneral / 100)),
      });
    }
    setSub("impuesto");
  }

  async function cambiarImpuestoActivo(valor: boolean) {
    if (!cfgImpuesto) return;
    const nuevo = { ...cfgImpuesto, activo: valor };
    setCfgImpuesto(nuevo);
    await guardarConfigImpuesto({ activo: valor });
  }

  async function guardarImpuesto() {
    if (!cfgImpuesto) return;
    const nombre = impuestoEdit.nombre.trim() || "Impuesto";
    const tasaPct = Math.max(0, Math.round(parseFloat(impuestoEdit.tasaPct.replace(",", ".")) || 0));
    const nuevo: ConfigImpuesto = { ...cfgImpuesto, nombre, tasaGeneral: tasaPct * 100 };
    setCfgImpuesto(nuevo);
    await guardarConfigImpuesto({ nombre, tasaGeneral: tasaPct * 100 });
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

        {/* -------------------------------------------------------------
            IDENTIDAD — lo único de esta pantalla que no es un ajuste
            -------------------------------------------------------------
            Va arriba y con otra forma a propósito: no es algo que
            configuras, es dónde estás parado. Esa es la ÚNICA excepción a
            la lista; mezclar tarjetas y filas sin una regla hace que la
            forma deje de significar nada.

            Sustituye a la rejilla de seis tarjetas que había antes. La
            rejilla era buena para explorar, pero Ajustes no se explora: se
            busca algo concreto ("quiero cambiar el IVA"), y con seis
            tarjetas hay que leer las seis para saber en cuál está. Con
            secciones etiquetadas se salta directo. Y de paso desaparece un
            nivel: antes era tarjeta -> hoja -> fila, ahora fila -> hoja. */}
        <Pressable
          onPress={abrirNegocio}
          accessibilityRole="button"
          accessibilityLabel="Nombre y giro del negocio"
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: T.esps.md,
            paddingVertical: T.esps.lg,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: T.radio,
              backgroundColor: T.acentoSuave,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Txt escala="titulo" tono="acento" fuerte>
              {nombreNegocio.trim()[0]?.toUpperCase() ?? "?"}
            </Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt escala="titulo" fuerte lineas={1}>
              {nombreNegocio}
            </Txt>
            <Txt escala="pie" tono="suave" lineas={1} estilo={{ marginTop: 1 }}>
              {giroActivo?.nombre ?? "Otro giro"}
              {cuenta?.vinculado ? " · cuenta vinculada" : " · modo local"}
            </Txt>
          </View>
          {/* El mismo carácter que usa <Fila> para "entra aquí". Con
              IconoUI id="atras" quedaba una flecha apuntando a la IZQUIERDA
              en el borde derecho: se lee como "volver", justo lo contrario. */}
          <Txt escala="titulo" tono="tenue">
            ›
          </Txt>
        </Pressable>

        {/* -------------------------------------------------------------
            LA LISTA
            -------------------------------------------------------------
            Sin tarjetas: filas sobre el lienzo separadas por una regla, con
            el valor alineado a la derecha. Es "Cinta" tal cual — nada flota,
            la separación viene de reglas y peso tipográfico.

            La clave para que no sea un muro de renglones es la SEGUNDA
            COLUMNA: los valores de dato (una tasa, una versión, una hora)
            van en IBM Plex Mono y los de prosa en Archivo. Eso da un eje que
            el ojo puede recorrer solo, sin leer los títulos uno por uno. */}

        <Rotulo>Tienda</Rotulo>
        <FilaAjuste
          titulo="Impuestos"
          valor={
            cfgImpuesto
              ? cfgImpuesto.activo
                ? `${cfgImpuesto.nombre} ${Math.round(cfgImpuesto.tasaGeneral / 100)} % incluido`
                : "Desactivado"
              : "IVA y similares"
          }
          dato={Boolean(cfgImpuesto?.activo)}
          onPress={abrirImpuesto}
        />
        <FilaAjuste
          titulo="Programa de lealtad"
          valor={
            reglas
              ? reglas.activa
                ? `1 pt por $${reglas.pesosPorPunto}`
                : "Pausado"
              : "Puntos y canjes"
          }
          dato={Boolean(reglas?.activa)}
          onPress={abrirLealtad}
        />
        <FilaAjuste
          titulo="Modo de uso"
          valor={modoActivo?.nombre ?? "Punto de venta"}
          onPress={() => setSub("modo")}
        />

        <Rotulo>Caja y turnos</Rotulo>
        <FilaAjuste
          titulo="Conteo a ciegas"
          ayuda="El cajero cuenta primero; el esperado se revela después."
          control={
            <Switch
              value={conteoCiegoActivo}
              onValueChange={cambiarConteoCiego}
              trackColor={{ false: T.superficie3, true: T.acentoRelleno }}
              thumbColor={T.superficie}
              accessibilityLabel="Conteo a ciegas al cerrar turno"
            />
          }
        />
        <FilaAjuste
          titulo="Bolsa de caja"
          valor="Sobrantes y faltantes"
          onPress={() => setBolsaAbierta(true)}
        />

        <Rotulo>Equipo</Rotulo>
        {permisos?.gestionarUsuarios && (
          <FilaAjuste
            titulo="Usuarios y permisos"
            valor={
              numUsuarios === null
                ? "Quién puede vender aquí"
                : `${numUsuarios}`
            }
            dato={numUsuarios !== null}
            onPress={() => setUsuariosAbierto(true)}
          />
        )}
        <FilaAjuste
          titulo="Pedir PIN al cambiar"
          ayuda="Apágalo si eres la única persona que usa el POS."
          control={
            <Switch
              value={pedirPin}
              onValueChange={cambiarPedirPin}
              trackColor={{ false: T.superficie3, true: T.acentoRelleno }}
              thumbColor={T.superficie}
              accessibilityLabel="Pedir PIN al cambiar de usuario"
            />
          }
        />
        <FilaAjuste
          titulo="Escáner de tickets"
          valor="Umbrales y redondeo"
          onPress={() => setAjustesEscanerAbierto(true)}
        />
        <FilaAjuste
          titulo="Enviar tickets a la IA"
          ayuda="El escáner manda la foto del ticket a Google para leerla. Apágalo y el escáner dejará de funcionar hasta que vuelvas a aceptarlo."
          control={
            <Switch
              value={iaEscaner}
              onValueChange={cambiarIaEscaner}
              trackColor={{ false: T.superficie3, true: T.acentoRelleno }}
              thumbColor={T.superficie}
              accessibilityLabel="Enviar tickets a la IA de Google"
            />
          }
        />

        {permisos?.vincularCuenta && (
          <>
            <Rotulo>Cuenta y nube</Rotulo>
            <FilaAjuste
              titulo="Cuenta"
              valor={
                cuenta?.vinculado
                  ? cuenta.email ?? "Vinculada"
                  : "Modo local"
              }
              onPress={() => setCuentaAbierta(true)}
            />
            <FilaAjuste
              titulo="Sincronización"
              valor={ultimaSync ? fmtFecha(ultimaSync) : "Nunca"}
              dato={Boolean(ultimaSync)}
              punto={cuenta?.vinculado ? T.exito : undefined}
              onPress={() => setSyncAbierto(true)}
            />
          </>
        )}

        <Rotulo>Apariencia</Rotulo>
        <FilaAjuste
          titulo="Tema y color"
          valor={
            temaActivo && acentoActivo
              ? `${temaActivo.nombre} · ${acentoActivo.nombre}`
              : "Tema y color"
          }
          punto={acentoActivo?.color}
          onPress={() => setSub("apariencia")}
        />

        <Rotulo>Ayuda y legal</Rotulo>
        <FilaAjuste
          titulo="El plan y los precios"
          ayuda="Qué es gratis y qué será de pago"
          onPress={() => setSub("plan")}
        />
        <FilaAjuste
          titulo="Reportar un problema"
          ayuda="Nos llega con los datos para poder ayudarte"
          onPress={async () => {
            // Diagnóstico prellenado: versión, sistema y estado de la cuenta.
            const diag =
              `\n\n———\n` +
              `No borres esto, nos ayuda a encontrar el problema:\n` +
              `App ${VERSION} · ${Platform.OS} ${Platform.Version}\n` +
              `Cuenta: ${cuenta?.vinculado ? "vinculada" : "local"}`;
            const ok = await abrirCorreo(
              CORREO_CONTACTO,
              `Problema en YvexPOS (${VERSION})`,
              `Cuéntanos qué pasó y, si puedes, qué estabas haciendo justo antes:${diag}`,
            );
            if (!ok) setCorreoManual(CORREO_CONTACTO);
          }}
        />
        <FilaAjuste
          titulo="Contacto"
          ayuda="Soporte, una web para tu negocio o lo que necesites"
          onPress={async () => {
            const ok = await abrirCorreo(
              CORREO_CONTACTO,
              "Hola, quiero información",
              "",
            );
            if (!ok) setCorreoManual(CORREO_CONTACTO);
          }}
        />
        <FilaAjuste
          titulo="Aviso de privacidad"
          onPress={() => Linking.openURL(URL_PRIVACIDAD)}
        />
        <FilaAjuste
          titulo="Términos de uso"
          onPress={() => Linking.openURL(URL_TERMINOS)}
        />

        <Rotulo>Acerca de</Rotulo>
        <FilaAjuste
          titulo="Acerca de YvexPOS"
          valor={VERSION}
          dato
          onPress={() => setSub("acerca")}
        />
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

      <Hoja
        visible={sub === "impuesto"}
        onCerrar={() => setSub(null)}
        titulo="Impuesto"
        tipo="completa"
        pie={<Boton titulo="Guardar" onPress={guardarImpuesto} />}
      >
        <Txt escala="pie" tono="suave" estilo={{ marginBottom: T.esps.lg }}>
          Casi ningún negocio chico lo necesita — la mayoría lo deja apagado. Si el
          tuyo sí cobra impuesto, actívalo aquí; se aplica igual en esta caja y en
          las demás (PC incluido).
        </Txt>

        <View style={{ marginBottom: T.esps.xl }}>
          <Grupo>
            <Fila
              titulo="Impuesto activo"
              meta="Con esto apagado, el impuesto no se calcula aunque los productos tengan una tasa asignada."
              flecha={false}
              valor={
                <Switch
                  value={cfgImpuesto?.activo ?? false}
                  onValueChange={cambiarImpuestoActivo}
                  trackColor={{ false: T.superficie3, true: T.acentoBorde }}
                  thumbColor={cfgImpuesto?.activo ? T.acento : T.textoTenue}
                />
              }
            />
          </Grupo>
        </View>

        {/* El selector "¿Cómo se cobra?" se retiró: ya no hay dos modos.
            El impuesto SIEMPRE va incluido en el precio, igual que en el PC
            y como funciona de verdad en México, Latinoamérica y Europa.
            Tener dos modelos distintos entre plataformas causaba un bug
            real (la pantalla de cobro pedía un total y el registro de la
            venta exigía otro, y la venta quedaba bloqueada). */}
        <Seccion titulo="¿Cómo se cobra?">
          <Txt escala="pie" tono="suave">
            El impuesto está incluido en el precio: el precio que pones es el
            precio final que paga el cliente, y el impuesto se desglosa en el
            ticket. Así funciona en México, Latinoamérica y Europa.
          </Txt>
        </Seccion>

        <Seccion titulo="Datos">
          <CampoLealtad
            etiqueta="Nombre del impuesto"
            ayuda='Como quieres que se llame en el ticket (ej. "IVA", "Sales Tax")'
            valor={impuestoEdit.nombre}
            onCambio={(v) => setImpuestoEdit((s) => ({ ...s, nombre: v }))}
            teclado="default"
          />
          <CampoLealtad
            etiqueta="Tasa general (%)"
            ayuda="Se usa si el producto no trae su propia tasa (0% o 16%, ver el catálogo)."
            valor={impuestoEdit.tasaPct}
            onCambio={(v) => setImpuestoEdit((s) => ({ ...s, tasaPct: v }))}
          />
        </Seccion>
      </Hoja>

      {/* --------------------------------------------------------------
          EL PLAN — qué es gratis y qué será de pago.
          Aquí se cumple lo que hablamos: la promesa fuerte NO es el precio,
          es que lo local no deja de funcionar nunca. El "desde" y el "más
          adelante" dejan margen para ajustar sin desmentir a nadie.
          -------------------------------------------------------------- */}
      <Hoja visible={sub === "plan"} onCerrar={() => setSub(null)} titulo="El plan" tipo="completa">
        <View style={{ gap: T.esps.lg }}>
          <View
            style={{
              backgroundColor: T.superficie,
              borderRadius: T.radio,
              padding: T.esps.lg,
              gap: T.esps.xs,
            }}
          >
            <Txt escala="cuerpo" fuerte>Ahora estás en la beta</Txt>
            <Txt escala="pie" tono="suave">
              Todas las funciones están abiertas y son gratis. Pruébalo a fondo
              y cuéntanos qué falla — eso es justo lo que nos ayuda ahora.
            </Txt>
          </View>

          <View style={{ gap: T.esps.sm }}>
            <Txt escala="pie" tono="tenue" fuerte mayus>Gratis, siempre</Txt>
            <Txt escala="pie" tono="suave">
              Vender, inventario, fiado, corte de caja y reportes en este
              dispositivo. Lo que ya usas no va a dejar de funcionar ni a
              cobrarse después. Es tuyo.
            </Txt>
          </View>

          <View style={{ gap: T.esps.sm }}>
            <Txt escala="pie" tono="tenue" fuerte mayus>
              Más adelante, de pago (desde {PRECIO_DESDE}/mes)
            </Txt>
            <Txt escala="pie" tono="suave">
              La sincronización en la nube entre varias cajas, el respaldo en
              línea y la tienda en línea con pedidos por WhatsApp. Son las
              partes que tienen un costo para nosotros, así que serán el plan
              de paga cuando termine la beta.
            </Txt>
          </View>

          <Txt escala="micro" tono="tenue" estilo={{ marginTop: T.esps.md }}>
            Es un precio aproximado y puede cambiar antes del lanzamiento. Te
            avisaremos con tiempo dentro de la app: nada se activa ni se cobra
            sin que tú lo aceptes.
          </Txt>
        </View>
      </Hoja>

      <Hoja
        visible={correoManual !== null}
        onCerrar={() => setCorreoManual(null)}
        titulo="Escríbenos"
      >
        <View style={{ gap: T.esps.md }}>
          <Txt escala="pie" tono="suave">
            No encontramos una app de correo en este teléfono. Puedes
            escribirnos tú a esta dirección:
          </Txt>
          <View
            style={{
              backgroundColor: T.superficie,
              borderRadius: T.radio,
              padding: T.esps.lg,
              alignItems: "center",
            }}
          >
            <Txt escala="cuerpo" fuerte tono="acento">{correoManual}</Txt>
          </View>
        </View>
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
/** Rejilla de dos columnas que fluye sola.
 *
 *  Sustituye a la antigua FilaTarjetas (filas fijas de dos). Aquella metía
 *  un hueco vacío cuando una fila tenía una sola tarjeta — que es justo lo
 *  que pasaba con "Impuesto", y lo que se veía como un vacío raro entre
 *  Impuesto y Cuenta y nube.
 *
 *  El problema de fondo era estructural, no cosmético: qué tarjetas se
 *  muestran depende del ROL (un cajero no ve Impuesto ni Cuenta y nube), así
 *  que cualquier reparto fijo en filas se descuadra para alguien. Aquí las
 *  tarjetas se acomodan solas, sean las que sean.
 *
 *  Cada celda mide 50% exacto con el espacio hecho por padding interno (no
 *  por `gap` sobre anchos del 48%, que se pasa del contenedor por unos
 *  píxeles y tira una tarjeta a la fila siguiente en pantallas estrechas).
 *  El margen negativo del contenedor devuelve el borde a su sitio. */
/** Rótulo de sección: versalitas tenues con una regla debajo.
 *
 *  No es una <Seccion> del sistema porque <Seccion> asume que debajo va una
 *  superficie (un <Grupo>), y aquí no hay tarjetas: las filas van sobre el
 *  lienzo. La regla es lo que separa, que es exactamente la dirección
 *  "Cinta" — nada flota, la jerarquía la dan reglas y peso tipográfico. */
function Rotulo({ children }: { children: string }) {
  const { tema: T } = useTema();
  return (
    // La regla del rótulo era del MISMO grosor y color que las de las filas,
    // así que la pantalla se leía como una sola lista corrida de veinte
    // renglones en vez de como cuatro grupos. Dos cambios:
    //   · más aire encima (xxl en vez de xl), que es lo que separa de verdad
    //   · regla de 2 px en `bordeFuerte`, para que la del grupo pese más que
    //     las de dentro del grupo
    <View
      style={{
        marginTop: T.esps.xxl,
        paddingBottom: T.esps.sm,
        borderBottomWidth: 2,
        borderBottomColor: T.bordeFuerte,
      }}
    >
      <Txt escala="micro" tono="acento" fuerte mayus>
        {children}
      </Txt>
    </View>
  );
}

/**
 * Fila de ajuste: título a la izquierda, valor a la derecha.
 *
 * ---------------------------------------------------------------------------
 * LA SEGUNDA COLUMNA ES LO QUE EVITA EL MURO DE RENGLONES
 * ---------------------------------------------------------------------------
 * Una lista larga de filas iguales vuelve a tener el problema de que todo
 * pesa lo mismo, solo que en vertical. Lo que la salva aquí es que el valor
 * de la derecha se lee SOLO, sin pasar por el título: "IVA 16 % incluido",
 * "3", "9 sep, 21:04". El ojo recorre esa columna y encuentra lo que busca.
 *
 * Y dentro de esa columna hay una distinción más: `dato` pone el valor en
 * IBM Plex Mono. Las tasas, los conteos, las versiones y las fechas son
 * CIFRAS y se alinean entre sí; "Modo local" o "Sobrantes y faltantes" son
 * prosa y van en Archivo. Sin esa separación la columna sería un bloque
 * uniforme de texto a la derecha, que es otra forma del mismo muro.
 *
 * `control` sustituye al valor cuando la fila es un interruptor: entonces no
 * hay nada que abrir y la fila no se puede pulsar.
 */
function FilaAjuste({
  titulo,
  valor,
  ayuda,
  dato = false,
  punto,
  control,
  onPress,
}: {
  titulo: string;
  /** Estado actual, alineado a la derecha. */
  valor?: string;
  /** Segunda línea bajo el título, para lo que no cabe en el valor. */
  ayuda?: string;
  /** El valor es una cifra: se pinta en la familia numérica. */
  dato?: boolean;
  /** Punto de estado a color, antes del valor. */
  punto?: string;
  /** Interruptor u otro control. Excluye `valor` y desactiva el pulsado. */
  control?: ReactNode;
  onPress?: () => void;
}) {
  const { tema: T } = useTema();
  const contenido = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: T.esps.md,
        minHeight: T.filaAlto,
        paddingVertical: T.esps.md,
        borderBottomWidth: 1,
        borderBottomColor: T.borde,
      }}
    >
      <View style={{ flex: 1 }}>
        <Txt escala="cuerpo" lineas={1}>
          {titulo}
        </Txt>
        {ayuda ? (
          <Txt escala="pie" tono="tenue" estilo={{ marginTop: 2 }}>
            {ayuda}
          </Txt>
        ) : null}
      </View>

      {punto ? (
        <View
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: punto }}
        />
      ) : null}

      {control ??
        (valor ? (
          dato ? (
            <Monto texto={valor} escala="cuerpo" tono="suave" />
          ) : (
            <Txt escala="cuerpo" tono="suave" lineas={1}>
              {valor}
            </Txt>
          )
        ) : null)}

      {onPress ? (
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
      accessibilityRole="button"
      accessibilityLabel={valor ? `${titulo}: ${valor}` : titulo}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {contenido}
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
  teclado = "decimal-pad",
}: {
  etiqueta: string;
  ayuda: string;
  valor: string;
  onCambio: (v: string) => void;
  /** Los 4 usos de Lealtad no la pasan y siguen igual que siempre
   *  (decimal-pad). Se añadió para reutilizar este mismo campo en la
   *  sección de Impuesto, donde "nombre" es texto libre ("IVA", "Sales
   *  Tax"), no un número. */
  teclado?: "decimal-pad" | "default";
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
        keyboardType={teclado}
        placeholderTextColor={T.textoTenue}
      />
      <Txt escala="micro" tono="tenue" estilo={{ marginTop: T.esps.xs }}>
        {ayuda}
      </Txt>
    </View>
  );
}
