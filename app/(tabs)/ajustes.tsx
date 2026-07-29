// YvexPOS Móvil — Pantalla AJUSTES.
//
// Menú de configuración por secciones, estilo "Configuración" de teléfono:
// grupos con tarjetas de filas (icono + texto + chevron). Las sub-vistas
// (Apariencia, Modo de uso, Acerca de) se renderizan aquí mismo con botón
// de regreso "‹ Ajustes", sin rutas nuevas.

import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation, router } from "expo-router";
import { useTema } from "@/src/componentes/TemaProvider";
import { TEMAS, ACENTOS } from "@/src/base/apariencia";
import { Icono, IconoUI, IdUI } from "@/src/componentes/iconos";
import MuestraTema from "@/src/componentes/MuestraTema";
import ModalDepartamentos from "@/src/componentes/ModalDepartamentos";
import ModalCuenta from "@/src/componentes/ModalCuenta";
import ModalUsuarios from "@/src/componentes/ModalUsuarios";
import ModalSync from "@/src/componentes/ModalSync";
import ModalAjustesEscaner from "@/src/componentes/ModalAjustesEscaner";
import {
  UsuarioPOS,
  listarUsuarios,
  pideePin,
  setPedirPin,
} from "@/src/base/usuarios";
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
import { ReglasLealtad, leerReglas, guardarReglas } from "@/src/base/lealtad";
import { fmtFecha } from "@/src/base/formato";
import appJson from "../../app.json";

const VERSION: string = (appJson as any)?.expo?.version ?? "1.0.0";

const PACKS: { id: string; nombre: string; desc: string }[] = [
  { id: "trazo",   nombre: "Trazo",   desc: "Líneas finas · elegante y ligero" },
  { id: "solido",  nombre: "Sólido",  desc: "Rellenos · más presencia visual" },
  { id: "inicial", nombre: "Inicial", desc: "Solo la letra · minimalista" },
];

type Vista = "menu" | "apariencia" | "modo" | "negocio" | "acerca" | "lealtad";
type Tema = ReturnType<typeof useTema>["tema"];

export default function AjustesScreen() {
  const { prefs, tema: T, setTema, setAcento, setPack } = useTema();
  const [vista, setVista] = useState<Vista>("menu");
  const [deptos, setDeptos] = useState(false);
  const [cuentaAbierta, setCuentaAbierta] = useState(false);
  const [cuenta, setCuenta] = useState<EstadoCuenta | null>(null);
  const [usuariosAbierto, setUsuariosAbierto] = useState(false);
  const [syncAbierto, setSyncAbierto] = useState(false);
  const [ajustesEscanerAbierto, setAjustesEscanerAbierto] = useState(false);
  const [usuarios, setUsuarios] = useState<UsuarioPOS[]>([]);
  const [modo, setModo] = useState<ModoUso | null>(null);
  const [pedirPin, setPedirPinEstado] = useState(false);
  const [ultimaSync, setUltimaSync] = useState<string | null>(null);
  const [avisoModo, setAvisoModo] = useState(false);
  const [nombreNegocio, setNombreNegocio] = useState("Mi negocio");
  const [giroId, setGiroId] = useState("otro");
  const [negocioEdit, setNegocioEdit] = useState("Mi negocio");
  const [giroEdit, setGiroEdit] = useState("otro");

  // Programa de lealtad: reglas vigentes + borrador editable (texto).
  const [reglas, setReglas] = useState<ReglasLealtad | null>(null);
  const [lealtadEdit, setLealtadEdit] = useState({
    pesosPorPunto: "10",
    puntosVisita: "5",
    valorPuntoPesos: "1.00", // se muestra en pesos, se guarda en centavos
    topePct: "50",
  });

  const cargar = useCallback(() => {
    estadoCuenta().then(setCuenta);
    listarUsuarios().then(setUsuarios);
    leerModoUso().then(setModo);
    pideePin().then(setPedirPinEstado);
    leerConfig("ultima_sync").then(setUltimaSync);
    leerNombreNegocio().then(setNombreNegocio);
    leerGiro().then(setGiroId);
    leerReglas().then(setReglas);
  }, []);

  useFocusEffect(cargar);

  // Re-tap en la pestaña Ajustes estando en una sub-vista: vuelve al menú.
  const navigation = useNavigation();
  useEffect(() => {
    const quitar = (navigation as any).addListener("tabPress", () => {
      setVista((v) => (v === "menu" ? v : "menu"));
    });
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

  function abrirNegocio() {
    setNegocioEdit(nombreNegocio);
    setGiroEdit(giroId);
    setVista("negocio");
  }

  async function guardarNegocio() {
    await guardarNombreNegocio(negocioEdit);
    await guardarGiro(giroEdit);
    setNombreNegocio(negocioEdit.trim() === "" ? "Mi negocio" : negocioEdit.trim());
    setGiroId(GIROS.some((g) => g.id === giroEdit) ? giroEdit : "otro");
    setVista("menu");
  }

  // --- Programa de lealtad ---
  function abrirLealtad() {
    if (reglas) {
      setLealtadEdit({
        pesosPorPunto: String(reglas.pesosPorPunto),
        puntosVisita: String(reglas.puntosVisita),
        valorPuntoPesos: (reglas.valorPuntoCentavos / 100).toFixed(2),
        topePct: String(reglas.topeDescuentoPct),
      });
    }
    setVista("lealtad");
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
      topeDescuentoPct: Math.min(
        100,
        Math.round(aNum(lealtadEdit.topePct, reglas.topeDescuentoPct))
      ),
    };
    setReglas(nuevas);
    await guardarReglas(nuevas);
    setVista("menu");
  }

  const temaActivo = TEMAS.find((t) => t.id === prefs.tema);
  const acentoActivo = ACENTOS.find((a) => a.id === prefs.acento);
  const modoActivo = MODOS.find((m) => m.id === modo);
  const giroActivo = GIROS.find((g) => g.id === giroId);

  // -------------------------------------------------------------------------
  // Sub-vista: APARIENCIA (los selectores de siempre, mejor presentados)
  // -------------------------------------------------------------------------
  const vistaApariencia = (
    <SubVista T={T} titulo="Apariencia" onVolver={() => setVista("menu")}>
      <Text style={[e.seccion, { color: T.textoSuave }]}>TEMA</Text>
      <View style={{ gap: 9, marginBottom: 24 }}>
        {TEMAS.map((t) => {
          const activo = prefs.tema === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => setTema(t.id)}
              style={[
                e.opcion,
                { backgroundColor: T.superficie, borderColor: activo ? T.acento : T.borde },
                activo && { borderWidth: 1.5 },
              ]}
            >
              {/* Mini-mock de la app con la paleta del tema y el acento ACTIVO */}
              <MuestraTema paleta={t.paleta} acentoColor={T.acento} esClaro={t.esClaro} />
              <View style={{ flex: 1 }}>
                <Text style={[e.opTitulo, { color: T.texto }]}>{t.nombre}</Text>
                <Text style={[e.opDesc, { color: T.textoTenue }]}>{t.desc}</Text>
              </View>
              {activo && <Check color={T.acento} />}
            </Pressable>
          );
        })}
      </View>

      <Text style={[e.seccion, { color: T.textoSuave }]}>COLOR DE ACENTO</Text>
      <View style={e.acentos}>
        {ACENTOS.map((a) => {
          const activo = prefs.acento === a.id;
          return (
            <Pressable
              key={a.id}
              onPress={() => setAcento(a.id)}
              style={e.acentoItem}
            >
              <View
                style={[
                  e.acentoCirculo,
                  { backgroundColor: a.color },
                  activo && { borderWidth: 2.5, borderColor: T.texto },
                ]}
              >
                {activo && (
                  <Text style={{ color: T.acentoTexto, fontSize: 15, fontWeight: "900" }}>✓</Text>
                )}
              </View>
              <Text
                style={{
                  color: activo ? T.texto : T.textoSuave,
                  fontSize: 11,
                  fontWeight: activo ? "800" : "600",
                }}
              >
                {a.nombre}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[e.seccion, { color: T.textoSuave }]}>ICONOS DE PRODUCTO</Text>
      <View style={{ gap: 9, marginBottom: 24 }}>
        {PACKS.map((p) => {
          const activo = prefs.pack === p.id;
          return (
            <Pressable
              key={p.id}
              onPress={() => setPack(p.id)}
              style={[
                e.opcion,
                { backgroundColor: T.superficie, borderColor: activo ? T.acento : T.borde },
                activo && { borderWidth: 1.5 },
              ]}
            >
              {/* Vista previa del pack */}
              <View
                style={[
                  e.packPreview,
                  { backgroundColor: T.acento + "1e", borderColor: T.acento + "55" },
                ]}
              >
                {p.id === "inicial" ? (
                  <Text style={{ color: T.acento, fontSize: 17, fontWeight: "800" }}>C</Text>
                ) : (
                  <Icono
                    id="refresco"
                    size={24}
                    color={T.acento}
                    relleno={p.id === "solido"}
                  />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[e.opTitulo, { color: T.texto }]}>{p.nombre}</Text>
                <Text style={[e.opDesc, { color: T.textoTenue }]}>{p.desc}</Text>
              </View>
              {activo && <Check color={T.acento} />}
            </Pressable>
          );
        })}
      </View>
    </SubVista>
  );

  // -------------------------------------------------------------------------
  // Sub-vista: MODO DE USO
  // -------------------------------------------------------------------------
  const vistaModo = (
    <SubVista T={T} titulo="Modo de uso" onVolver={() => setVista("menu")}>
      <Text style={[e.textoIntro, { color: T.textoSuave }]}>
        ¿Para qué usas este dispositivo? Puedes cambiarlo cuando quieras.
      </Text>
      <View style={{ gap: 9, marginBottom: 14 }}>
        {MODOS.map((m) => {
          const activo = modo === m.id;
          return (
            <Pressable
              key={m.id}
              onPress={() => elegirModo(m.id)}
              style={[
                e.opcion,
                { backgroundColor: T.superficie, borderColor: activo ? T.acento : T.borde },
                activo && { borderWidth: 1.5 },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[e.opTitulo, { color: T.texto }]}>{m.nombre}</Text>
                <Text style={[e.opDesc, { color: T.textoSuave }]}>{m.desc}</Text>
                <Text style={[e.opEjemplo, { color: T.textoTenue }]}>{m.ejemplo}</Text>
              </View>
              {activo && <Check color={T.acento} />}
            </Pressable>
          );
        })}
      </View>
      {avisoModo && (
        <Text style={[e.pie, { color: T.textoTenue, textAlign: "left", marginTop: 0 }]}>
          Modo actualizado · volviendo a Inicio…
        </Text>
      )}
    </SubVista>
  );

  // -------------------------------------------------------------------------
  // Sub-vista: TU NEGOCIO (nombre + giro, mismo catálogo del onboarding)
  // -------------------------------------------------------------------------
  const vistaNegocio = (
    <SubVista T={T} titulo="Tu negocio" onVolver={() => setVista("menu")}>
      <Text style={[e.textoIntro, { color: T.textoSuave }]}>
        El nombre aparece en la pantalla de inicio; el giro nos ayuda a
        sugerirte lo que más le sirve a tu negocio.
      </Text>

      <Text style={[e.seccion, { color: T.textoSuave }]}>NOMBRE DEL NEGOCIO</Text>
      <TextInput
        style={[
          e.inputNegocio,
          {
            backgroundColor: T.superficie2,
            borderColor: T.borde,
            color: T.texto,
            borderRadius: T.radioChico,
          },
        ]}
        value={negocioEdit}
        onChangeText={setNegocioEdit}
        placeholder="Ej. Abarrotes Lupita"
        placeholderTextColor={T.textoTenue}
        autoCapitalize="words"
        returnKeyType="done"
      />

      <Text style={[e.seccion, { color: T.textoSuave }]}>GIRO</Text>
      <View style={e.giroGrid}>
        {GIROS.map((g) => {
          const activo = giroEdit === g.id;
          return (
            <Pressable
              key={g.id}
              onPress={() => setGiroEdit(g.id)}
              style={[
                e.giroTarjeta,
                {
                  backgroundColor: activo ? T.acentoSuave : T.superficie,
                  borderColor: activo ? T.acento : T.borde,
                  borderRadius: T.radio,
                },
              ]}
            >
              <View
                style={[
                  e.giroIcono,
                  {
                    backgroundColor: T.superficie2,
                    borderColor: activo ? T.acento : T.bordeFuerte,
                  },
                ]}
              >
                <IconoUI id={g.icono} size={22} color={activo ? T.acento : T.textoSuave} />
              </View>
              <Text style={[e.giroNombre, { color: T.texto }]} numberOfLines={2}>
                {g.nombre}
              </Text>
              {activo && (
                <View style={[e.check, { backgroundColor: T.acento, position: "absolute", top: 10, right: 10 }]}>
                  <Text style={{ color: T.acentoTexto, fontSize: 12, fontWeight: "900" }}>✓</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={guardarNegocio}
        style={({ pressed }) => [
          e.botonGuardar,
          { backgroundColor: T.acento, borderRadius: T.radioChico + 2 },
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={{ color: T.acentoTexto, fontSize: 15.5, fontWeight: "800" }}>
          Guardar cambios
        </Text>
      </Pressable>
    </SubVista>
  );

  // -------------------------------------------------------------------------
  // Sub-vista: PROGRAMA DE LEALTAD
  // -------------------------------------------------------------------------
  const vistaLealtad = (
    <SubVista T={T} titulo="Programa de lealtad" onVolver={() => setVista("menu")}>
      <Text style={[e.textoIntro, { color: T.textoSuave }]}>
        Tus clientes ganan puntos por cada compra y por visitar tu negocio;
        al cobrar pueden canjearlos como descuento (tú siempre confirmas en
        pantalla, nada se descuenta solo).
      </Text>

      <View
        style={[
          e.opcion,
          { backgroundColor: T.superficie, borderColor: T.borde, marginBottom: 20 },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[e.opTitulo, { color: T.texto }]}>Programa activo</Text>
          <Text style={[e.opDesc, { color: T.textoTenue }]}>
            Si lo apagas, el botón Cliente y la fila de Inicio se ocultan; los
            puntos guardados se conservan.
          </Text>
        </View>
        <Switch
          value={reglas?.activa ?? true}
          onValueChange={cambiarLealtadActiva}
          trackColor={{ false: T.superficie3, true: T.acento + "66" }}
          thumbColor={reglas?.activa ? T.acento : T.textoTenue}
        />
      </View>

      <Text style={[e.seccion, { color: T.textoSuave }]}>SUMAR PUNTOS</Text>
      <CampoLealtad
        T={T}
        etiqueta="Pesos por punto"
        ayuda="1 punto por cada $X de compra (ej. 10 = un punto por cada $10)"
        valor={lealtadEdit.pesosPorPunto}
        onCambio={(v) => setLealtadEdit((s) => ({ ...s, pesosPorPunto: v }))}
      />
      <CampoLealtad
        T={T}
        etiqueta="Puntos por visita"
        ayuda="Se otorgan una vez al día por cliente, aunque no compre"
        valor={lealtadEdit.puntosVisita}
        onCambio={(v) => setLealtadEdit((s) => ({ ...s, puntosVisita: v }))}
      />

      <Text style={[e.seccion, { color: T.textoSuave }]}>CANJEAR PUNTOS</Text>
      <CampoLealtad
        T={T}
        etiqueta="Valor del punto (pesos)"
        ayuda="Cuánto descuenta cada punto al canjear (ej. 1.00 = $1 por punto)"
        valor={lealtadEdit.valorPuntoPesos}
        onCambio={(v) => setLealtadEdit((s) => ({ ...s, valorPuntoPesos: v }))}
      />
      <CampoLealtad
        T={T}
        etiqueta="Tope del ticket (%)"
        ayuda="Qué porcentaje del ticket puede pagarse con puntos (ej. 50 = hasta la mitad)"
        valor={lealtadEdit.topePct}
        onCambio={(v) => setLealtadEdit((s) => ({ ...s, topePct: v }))}
      />

      <Pressable
        onPress={guardarLealtad}
        style={({ pressed }) => [
          e.botonGuardar,
          { backgroundColor: T.acento, borderRadius: T.radioChico + 2 },
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={{ color: T.acentoTexto, fontSize: 15.5, fontWeight: "800" }}>
          Guardar reglas
        </Text>
      </Pressable>
    </SubVista>
  );


  // -------------------------------------------------------------------------
  // Sub-vista: ACERCA DE
  // -------------------------------------------------------------------------
  const vistaAcerca = (
    <SubVista T={T} titulo="Acerca de" onVolver={() => setVista("menu")}>
      <View style={{ alignItems: "center", marginTop: 44 }}>
        <Text style={[e.marcaGrande, { color: T.texto }]}>
          Yvex<Text style={{ color: T.turquesa }}>POS</Text>
        </Text>
        <Text style={{ color: T.textoSuave, fontSize: 14, marginTop: 4 }}>
          YvexPOS Móvil · Versión {VERSION}
        </Text>
        <Text
          style={{
            color: T.textoTenue,
            fontSize: 13,
            textAlign: "center",
            lineHeight: 20,
            marginTop: 22,
            paddingHorizontal: 18,
          }}
        >
          Hecho para tu negocio: vende con o sin internet y revisa cómo va el
          día, estés donde estés.
        </Text>
      </View>
    </SubVista>
  );

  // -------------------------------------------------------------------------
  // Menú principal
  // -------------------------------------------------------------------------
  const menu = (
    <SafeAreaView style={[e.raiz, { backgroundColor: T.fondo }]} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: T.esp }}>
        <Text style={[e.marca, { color: T.texto }]}>
          Yvex<Text style={{ color: T.turquesa }}>POS</Text>
        </Text>
        <Text style={[e.titulo, { color: T.texto }]}>Ajustes</Text>

        {/* --------- TU NEGOCIO --------- */}
        <Grupo T={T} titulo="TU NEGOCIO">
          <Fila
            T={T}
            icono="tienda"
            titulo="Tu negocio"
            sub={`${nombreNegocio} · ${giroActivo?.nombre ?? "Otro giro"}`}
            onPress={abrirNegocio}
            ultima
          />
        </Grupo>

        {/* --------- APARIENCIA --------- */}
        <Grupo T={T} titulo="APARIENCIA">
          <Fila
            T={T}
            icono="imagen"
            titulo="Apariencia"
            sub={
              temaActivo && acentoActivo
                ? `Tema ${temaActivo.nombre} · Acento ${acentoActivo.nombre}`
                : "Tema, acento e iconos"
            }
            onPress={() => setVista("apariencia")}
            ultima
          />
        </Grupo>

        {/* --------- MODO DE USO --------- */}
        <Grupo T={T} titulo="MODO DE USO">
          <Fila
            T={T}
            icono="vender"
            titulo="Modo de uso"
            sub={modoActivo ? modoActivo.nombre : "Para qué usas este dispositivo"}
            onPress={() => setVista("modo")}
            ultima
          />
        </Grupo>

        {/* --------- VENTAS Y USUARIOS --------- */}
        <Grupo T={T} titulo="VENTAS Y USUARIOS">
          <Fila
            T={T}
            titulo="Usuarios y PIN"
            sub="Quién puede vender aquí"
            onPress={() => setUsuariosAbierto(true)}
          />
          <Fila
            T={T}
            titulo="Pedir PIN al cambiar de usuario"
            sub="Cada quien entra con su código"
            trailing={
              <Switch
                value={pedirPin}
                onValueChange={cambiarPedirPin}
                trackColor={{ false: T.superficie3, true: T.acento + "66" }}
                thumbColor={pedirPin ? T.acento : T.textoTenue}
              />
            }
          />
          <Fila
            T={T}
            icono="etiqueta"
            titulo="Departamentos"
            sub="Categorías con su icono y color"
            onPress={() => setDeptos(true)}
            ultima
          />
        </Grupo>

        {/* --------- INVENTARIO --------- */}
        <Grupo T={T} titulo="INVENTARIO">
          <Fila
            T={T}
            icono="etiqueta"
            titulo="Escáner de tickets"
            sub="Umbrales de aviso, margen y redondeo"
            onPress={() => setAjustesEscanerAbierto(true)}
            ultima
          />
        </Grupo>

        {/* --------- PROGRAMA DE LEALTAD --------- */}
        <Grupo T={T} titulo="PROGRAMA DE LEALTAD">
          <Fila
            T={T}
            titulo="Programa activo"
            sub="Puntos por compra y visita, canjeables al cobrar"
            trailing={
              <Switch
                value={reglas?.activa ?? true}
                onValueChange={cambiarLealtadActiva}
                trackColor={{ false: T.superficie3, true: T.acento + "66" }}
                thumbColor={reglas?.activa ? T.acento : T.textoTenue}
              />
            }
          />
          <Fila
            T={T}
            icono="regalo"
            titulo="Reglas del programa"
            sub={
              reglas
                ? `$${reglas.pesosPorPunto} = 1 pt · visita +${reglas.puntosVisita} pts · 1 pt = $${(reglas.valorPuntoCentavos / 100).toFixed(2)} · tope ${reglas.topeDescuentoPct}%`
                : "Pesos por punto, visita, valor y tope"
            }
            onPress={abrirLealtad}
            ultima
          />
        </Grupo>

        {/* --------- CUENTA Y NUBE --------- */}
        <Grupo T={T} titulo="CUENTA Y NUBE">
          <Fila
            T={T}
            titulo="Cuenta"
            sub={
              cuenta?.vinculado
                ? cuenta.email ?? "Cuenta vinculada"
                : "Modo local — sin cuenta"
            }
            onPress={() => setCuentaAbierta(true)}
          />
          <Fila
            T={T}
            titulo="Sincronización"
            sub={
              ultimaSync
                ? `Última sincronización: ${fmtFecha(ultimaSync)}`
                : "Respaldar y sincronizar"
            }
            onPress={() => setSyncAbierto(true)}
            ultima
          />
        </Grupo>

        {/* --------- ACERCA DE --------- */}
        <Grupo T={T} titulo="ACERCA DE">
          <Fila
            T={T}
            titulo="Acerca de YvexPOS"
            sub={`Versión ${VERSION}`}
            onPress={() => setVista("acerca")}
            ultima
          />
        </Grupo>

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );

  return (
    <>
      {vista === "menu" && menu}
      {vista === "apariencia" && vistaApariencia}
      {vista === "modo" && vistaModo}
      {vista === "negocio" && vistaNegocio}
      {vista === "acerca" && vistaAcerca}
      {vista === "lealtad" && vistaLealtad}

      {deptos && (
        <ModalDepartamentos onCerrar={() => setDeptos(false)} onCambio={() => {}} />
      )}
      {usuariosAbierto && (
        <ModalUsuarios
          modo="gestionar"
          onCerrar={() => setUsuariosAbierto(false)}
          onCambio={cargar}
        />
      )}
      {syncAbierto && (
        <ModalSync onCerrar={() => setSyncAbierto(false)} onCambio={cargar} />
      )}
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
    </>
  );
}

// ---------------------------------------------------------------------------
// Piezas del menú
// ---------------------------------------------------------------------------

function Grupo({
  T,
  titulo,
  children,
}: {
  T: Tema;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 24 }}>
      <Text style={[e.seccion, { color: T.textoSuave }]}>{titulo}</Text>
      <View
        style={{
          backgroundColor: T.superficie,
          borderColor: T.borde,
          borderWidth: 1,
          borderRadius: T.radio,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
    </View>
  );
}

function Fila({
  T,
  icono,
  titulo,
  sub,
  onPress,
  trailing,
  ultima = false,
}: {
  T: Tema;
  icono?: IdUI;
  titulo: string;
  sub?: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
  ultima?: boolean;
}) {
  return (
    <View>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={({ pressed }) => [
          e.fila,
          pressed && onPress ? { backgroundColor: T.superficie2 } : null,
        ]}
      >
        {icono && (
          <View
            style={[
              e.filaIcono,
              { backgroundColor: T.acento + "1e", borderColor: T.acento + "55" },
            ]}
          >
            <IconoUI id={icono} size={19} color={T.acento} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[e.filaTitulo, { color: T.texto }]}>{titulo}</Text>
          {sub ? (
            <Text style={[e.filaSub, { color: T.textoSuave }]} numberOfLines={2}>
              {sub}
            </Text>
          ) : null}
        </View>
        {trailing ??
          (onPress ? (
            <Text style={{ color: T.textoTenue, fontSize: 22, fontWeight: "500" }}>
              ›
            </Text>
          ) : null)}
      </Pressable>
      {!ultima && (
        <View
          style={{
            height: StyleSheet.hairlineWidth,
            backgroundColor: T.borde,
            marginLeft: icono ? 62 : 16,
          }}
        />
      )}
    </View>
  );
}

function SubVista({
  T,
  titulo,
  onVolver,
  children,
}: {
  T: Tema;
  titulo: string;
  onVolver: () => void;
  children: React.ReactNode;
}) {
  return (
    <SafeAreaView style={[e.raiz, { backgroundColor: T.fondo }]} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: T.esp }}>
        <Pressable onPress={onVolver} hitSlop={10} style={{ marginBottom: 6 }}>
          <Text style={{ color: T.acento, fontSize: 16, fontWeight: "700" }}>
            ‹ Ajustes
          </Text>
        </Pressable>
        <Text style={[e.titulo, { color: T.texto }]}>{titulo}</Text>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

function Check({ color }: { color: string }) {
  const { tema: T } = useTema();
  return (
    <View style={[e.check, { backgroundColor: color }]}>
      <Text style={{ color: T.acentoTexto, fontSize: 12, fontWeight: "900" }}>✓</Text>
    </View>
  );
}

/** Campo numérico del programa de lealtad (mismo patrón que los umbrales
 *  del escáner: etiqueta + input + ayuda). */
function CampoLealtad({
  T,
  etiqueta,
  ayuda,
  valor,
  onCambio,
}: {
  T: Tema;
  etiqueta: string;
  ayuda: string;
  valor: string;
  onCambio: (v: string) => void;
}) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={[e.campoLealtadLbl, { color: T.textoSuave }]}>{etiqueta}</Text>
      <TextInput
        style={[
          e.campoLealtadInput,
          {
            backgroundColor: T.superficie2,
            borderColor: T.borde,
            color: T.texto,
            borderRadius: T.radioChico,
          },
        ]}
        value={valor}
        onChangeText={(t) => onCambio(t.replace(/[^0-9.,]/g, ""))}
        keyboardType="decimal-pad"
      />
      <Text style={{ color: T.textoTenue, fontSize: 12, marginTop: 5 }}>{ayuda}</Text>
    </View>
  );
}

const e = StyleSheet.create({
  raiz: { flex: 1 },
  marca: { fontSize: 12, fontWeight: "900", letterSpacing: 1.5, opacity: 0.8 },
  marcaGrande: { fontSize: 34, fontWeight: "900", letterSpacing: -0.8 },
  titulo: { fontSize: 30, fontWeight: "800", letterSpacing: -0.7, marginTop: 1, marginBottom: 20 },
  seccion: {
    fontSize: 11, fontWeight: "800", letterSpacing: 1, marginBottom: 8, marginLeft: 4,
  },
  textoIntro: { fontSize: 13.5, lineHeight: 20, marginBottom: 16 },
  // Filas del menú
  fila: {
    flexDirection: "row", alignItems: "center", gap: 13,
    minHeight: 56, paddingHorizontal: 14, paddingVertical: 10,
  },
  filaIcono: {
    width: 34, height: 34, borderRadius: 9, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  filaTitulo: { fontSize: 15, fontWeight: "700" },
  filaSub: { fontSize: 12, marginTop: 2 },
  // Tarjetas de opciones (sub-vistas)
  opcion: {
    flexDirection: "row", alignItems: "center", gap: 13,
    borderRadius: 14, borderWidth: 1, padding: 14,
  },
  opTitulo: { fontSize: 15, fontWeight: "800" },
  opDesc: { fontSize: 12, marginTop: 2 },
  opEjemplo: { fontSize: 11.5, marginTop: 5, lineHeight: 16, fontStyle: "italic" },
  packPreview: {
    width: 46, height: 46, borderRadius: 11, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  check: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: "center", justifyContent: "center",
  },
  acentos: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginBottom: 26 },
  acentoItem: { alignItems: "center", width: 58, gap: 6 },
  acentoCirculo: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  pie: { textAlign: "center", fontSize: 12, marginTop: 24 },
  // Sub-vista "Tu negocio"
  inputNegocio: {
    borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontWeight: "700", marginBottom: 20,
  },
  giroGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginBottom: 22 },
  giroTarjeta: {
    width: "48%", borderWidth: 1.5, padding: 12, alignItems: "flex-start",
  },
  giroIcono: {
    width: 40, height: 40, borderRadius: 10, borderWidth: 1,
    alignItems: "center", justifyContent: "center", marginBottom: 9,
  },
  giroNombre: { fontSize: 13.5, fontWeight: "800" },
  botonGuardar: {
    paddingVertical: 15, alignItems: "center", justifyContent: "center",
    minHeight: 52, marginTop: 4,
  },
  // Campos del programa de lealtad
  campoLealtadLbl: {
    fontSize: 13, fontWeight: "700", marginBottom: 7,
    textTransform: "uppercase", letterSpacing: 0.6,
  },
  campoLealtadInput: {
    borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"],
  },
});
