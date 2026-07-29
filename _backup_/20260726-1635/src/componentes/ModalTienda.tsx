// YvexPOS Móvil — Modal de MI TIENDA EN LÍNEA (escaparate).
//
// Publica el catálogo en tienda.yvexiq.com/t/{slug}: plantilla, color de
// acento, WhatsApp de pedidos, mensaje de bienvenida y qué productos se
// muestran. Todo se guarda local al instante; PUBLICAR es siempre un botón
// explícito del dueño (nada automático).
//
// Sub-vistas: "principal" (estado + configura + publicar) y "productos"
// (la lista del catálogo con su switch). Si no hay cuenta vinculada, una
// pantalla cálida explica qué es y ofrece vincular (ModalCuenta).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Modal,
  FlatList,
  ScrollView,
  Switch,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Share,
  Image,
} from "react-native";
import * as Linking from "expo-linking";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, CabeceraModal, Campo, useEstiloInput } from "@/src/componentes/ui";
import { IconoUI } from "@/src/componentes/iconos";
import ModalCuenta from "@/src/componentes/ModalCuenta";
import { pesos, fmtFecha } from "@/src/base/formato";
import { ACENTOS } from "@/src/base/apariencia";
import { estadoCuenta } from "@/src/base/nube";
import { leerNombreNegocio } from "@/src/base/giro";
import {
  PlantillaTienda,
  TiendaLocal,
  EstadoTiendaRemoto,
  CONTACTO_WEBMASTER,
  leerTiendaLocal,
  guardarTiendaLocal,
  catalogoConMarca,
  marcarEnTienda,
  publicarTienda,
  estadoTienda,
  desactivarTienda,
  FalloTienda,
} from "@/src/base/tienda";
import { sugerirSlug, whatsappValido, armarTextoAyuda } from "@/src/base/tiendaReglas";

type Tema = ReturnType<typeof useTema>["tema"];
type Vista = "principal" | "productos";

type ProductoFila = {
  id: string;
  nombre: string;
  precio_venta_centavos: number;
  imagen_uri: string | null;
  categoria_nombre: string | null;
  en_tienda: number;
  stock: number;
};

// Paletas de las plantillas del servidor (entrega-pc/tienda/plantillas.py):
// aurora clara / noche oscura / mercado cálida. Se usan en el mini-mock.
const PLANTILLAS: {
  id: PlantillaTienda;
  nombre: string;
  desc: string;
  fondo: string;
  tarjeta: string;
  texto: string;
  borde: string;
}[] = [
  { id: "aurora", nombre: "Aurora", desc: "Clara y moderna", fondo: "#f6f7fb", tarjeta: "#ffffff", texto: "#1c2030", borde: "#e8eaf1" },
  { id: "noche", nombre: "Noche", desc: "Oscura y elegante", fondo: "#0d0f16", tarjeta: "#171a26", texto: "#e8eaf2", borde: "#262b3d" },
  { id: "mercado", nombre: "Mercado", desc: "Cálida y cercana", fondo: "#fdf6ec", tarjeta: "#fffdf8", texto: "#3f2f23", borde: "#f0e2cf" },
];

/** Mini-mock de la plantilla (mismo espíritu que MuestraTema: ver, no
 *  adivinar): cabecera, dos tarjetitas de producto y una píldora de acento. */
function MuestraPlantilla({
  p,
  acento,
}: {
  p: (typeof PLANTILLAS)[number];
  acento: string;
}) {
  return (
    <View
      style={{
        width: 92,
        height: 62,
        borderRadius: 11,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: p.borde,
        backgroundColor: p.fondo,
      }}
    >
      {/* Cabecera de la tienda */}
      <View
        style={{
          height: 12,
          backgroundColor: p.tarjeta,
          borderBottomWidth: 1,
          borderBottomColor: p.borde,
          justifyContent: "center",
          paddingHorizontal: 6,
        }}
      >
        <View style={{ height: 4, width: 30, borderRadius: 2, backgroundColor: p.texto }} />
      </View>
      <View style={{ flex: 1, flexDirection: "row", gap: 5, padding: 6 }}>
        {[0, 1].map((i) => (
          <View
            key={i}
            style={{
              flex: 1,
              borderRadius: 5,
              backgroundColor: p.tarjeta,
              borderWidth: 1,
              borderColor: p.borde,
              padding: 4,
              justifyContent: "flex-end",
            }}
          >
            <View
              style={{
                height: 5,
                width: i === 0 ? 20 : 14,
                borderRadius: 3,
                backgroundColor: i === 0 ? acento : p.borde,
              }}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

/** Traduce errores tipados de tienda.ts a mensajes cálidos. */
function mensajeError(e: any): string {
  if (e instanceof FalloTienda) {
    switch (e.tipo) {
      case "sin_cuenta":
        return "Para publicar tu tienda primero vincula tu cuenta. Toca «Vincular mi cuenta» arriba.";
      case "sin_productos":
        return "Aún no eliges productos para tu tienda. Entra a «Productos» y prende los que quieras mostrar.";
      case "sin_internet":
        return "Sin conexión a internet. Tu selección quedó guardada: publica cuando tengas señal.";
      case "servidor":
        return e.message && e.message !== "servidor"
          ? `El servidor dijo: ${e.message}`
          : "El servidor tuvo un problema. Intenta de nuevo en un momento.";
    }
  }
  return e?.message ?? "Algo salió mal. Intenta de nuevo.";
}

export default function ModalTienda({
  onCerrar,
  onCambio,
}: {
  onCerrar: () => void;
  onCambio?: () => void;
}) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const estiloInput = useEstiloInput();

  const [cargando, setCargando] = useState(true);
  const [vinculado, setVinculado] = useState(false);
  const [cuentaAbierta, setCuentaAbierta] = useState(false);
  const [vista, setVista] = useState<Vista>("principal");
  const [cfg, setCfg] = useState<TiendaLocal | null>(null);
  const [remoto, setRemoto] = useState<EstadoTiendaRemoto | null>(null);
  const [productos, setProductos] = useState<ProductoFila[]>([]);
  const [negocio, setNegocio] = useState("Mi negocio");

  const [publicando, setPublicando] = useState(false);
  const [desactivando, setDesactivando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState<{ texto: string; tipo: "exito" | "info" } | null>(null);

  const cargar = useCallback(async () => {
    const [cuenta, local, prods, nombre] = await Promise.all([
      estadoCuenta(),
      leerTiendaLocal(),
      catalogoConMarca(),
      leerNombreNegocio(),
    ]);
    setVinculado(cuenta.vinculado);
    setCfg(local);
    setProductos(prods);
    setNegocio(nombre);
    if (cuenta.vinculado) {
      // Tolerante a fallo: null sin internet; la UI vive de la config local.
      setRemoto(await estadoTienda());
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const seleccionados = useMemo(
    () => productos.filter((p) => p.en_tienda === 1),
    [productos]
  );
  const sinFoto = useMemo(
    () => seleccionados.filter((p) => !p.imagen_uri).length,
    [seleccionados]
  );
  const tiendaAlAire = remoto?.activa === true;
  const urlTienda = remoto?.url_publica ?? cfg?.url ?? null;
  const slugSugerido = sugerirSlug(negocio);
  const waNormalizado = cfg ? whatsappValido(cfg.whatsapp) : null;

  // --- Acciones ---

  async function actualizarCfg(parcial: Parameters<typeof guardarTiendaLocal>[0]) {
    if (!cfg) return;
    setCfg({
      ...cfg,
      ...(parcial.plantilla !== undefined && { plantilla: parcial.plantilla }),
      ...(parcial.color !== undefined && { color: parcial.color }),
      ...(parcial.whatsapp !== undefined && { whatsapp: parcial.whatsapp }),
      ...(parcial.mensaje !== undefined && { mensaje: parcial.mensaje }),
      ...(parcial.mostrarStock !== undefined && { mostrarStock: parcial.mostrarStock }),
    });
    await guardarTiendaLocal(parcial);
  }

  async function alternarProducto(p: ProductoFila, valor: boolean) {
    // Optimista: se refleja al momento y se guarda local (en_tienda).
    setProductos((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, en_tienda: valor ? 1 : 0 } : x))
    );
    await marcarEnTienda(p.id, valor);
  }

  async function compartir() {
    if (!urlTienda) return;
    try {
      await Share.share({ message: armarTextoAyuda(urlTienda, negocio) });
    } catch {
      // Share cancelado: no pasa nada.
    }
  }

  async function publicar() {
    setError("");
    setAviso(null);
    setPublicando(true);
    try {
      const r = await publicarTienda();
      setRemoto(await estadoTienda());
      setAviso({
        texto:
          `¡Tu tienda quedó al aire! Comparte tu enlace: ${r.url}` +
          (r.advertencias.length ? `\n\n${r.advertencias.join("\n")}` : ""),
        tipo: "exito",
      });
      onCambio?.();
    } catch (e: any) {
      setError(mensajeError(e));
    } finally {
      setPublicando(false);
    }
  }

  function confirmarDesactivar() {
    Alert.alert(
      "Desactivar tienda",
      "Tu página dejará de mostrarse en internet, pero tu catálogo y tu selección se quedan guardados aquí. Puedes volver a publicar cuando quieras.",
      [
        { text: "Conservar tienda", style: "cancel" },
        {
          text: "Desactivar",
          style: "destructive",
          onPress: async () => {
            setError("");
            setDesactivando(true);
            try {
              await desactivarTienda();
              setRemoto(await estadoTienda());
              setAviso({
                texto: "Tu tienda quedó desactivada. Aquí sigue todo listo para volverla a publicar.",
                tipo: "info",
              });
            } catch (e: any) {
              setError(mensajeError(e));
            } finally {
              setDesactivando(false);
            }
          },
        },
      ]
    );
  }

  function contactarWebmaster() {
    const texto = encodeURIComponent(
      `Hola, tengo mi tienda en línea con YvexPOS (${urlTienda ?? `tienda.yvexiq.com/t/${slugSugerido}`}) ` +
        `y me interesa una página web con dominio propio.`
    );
    void Linking.openURL(`https://wa.me/${CONTACTO_WEBMASTER}?text=${texto}`).catch(() => {
      Alert.alert("No se pudo abrir WhatsApp", "Intenta de nuevo en un momento.");
    });
  }

  // --- Render ---

  function renderSinCuenta() {
    return (
      <ScrollView contentContainerStyle={est.cuerpo}>
        <View style={est.heroVacio}>
          <IconoUI id="tienda" size={34} color={T.acento} />
        </View>
        <Text style={est.tituloGrande}>Tu tienda, también en internet</Text>
        <Text style={est.parrafo}>
          Con tu cuenta vinculada puedes publicar un escaparate con tu catálogo:
          tus clientes entran a tu enlace, ven tus productos con foto y precio,
          y te piden por WhatsApp. Tú eliges exactamente qué se muestra.
        </Text>
        <Text style={est.parrafo}>
          Tu dirección quedaría algo así:{" "}
          <Text style={{ fontWeight: "800", color: T.texto }}>
            tienda.yvexiq.com/t/{slugSugerido}
          </Text>
        </Text>
        <Boton titulo="Vincular mi cuenta" onPress={() => setCuentaAbierta(true)} />
        <Text style={est.notaCalma}>
          Sin cuenta, la app sigue funcionando igual de completa: vender,
          inventario, clientes y reportes no necesitan internet. La tienda es
          el extra para llegar a más gente.
        </Text>
      </ScrollView>
    );
  }

  function renderEstado() {
    if (!cfg) return null;
    if (tiendaAlAire && urlTienda) {
      return (
        <View style={est.estadoAlAire}>
          <View style={est.estadoFilaTitulo}>
            <View style={est.puntoVivo} />
            <Text style={est.estadoTitulo}>Tu tienda está al aire</Text>
          </View>
          <Text style={est.estadoUrl} selectable>
            {urlTienda}
          </Text>
          {cfg.ultimaPublicacion && (
            <Text style={est.estadoMeta}>
              Última publicación: {fmtFecha(cfg.ultimaPublicacion)}
            </Text>
          )}
          <View style={est.estadoBotones}>
            <Boton titulo="Compartir enlace" chico onPress={compartir} />
            <Boton
              titulo={`Ver productos publicados (${remoto?.num_productos ?? seleccionados.length})`}
              chico
              tipo="secundario"
              onPress={() => setVista("productos")}
            />
          </View>
        </View>
      );
    }
    return (
      <View style={est.estadoApagada}>
        <Text style={est.estadoTituloApagada}>Aún no publicas tu tienda</Text>
        <Text style={est.estadoMetaApagada}>
          Configura abajo, elige tus productos y toca «Publicar mi tienda». Tu
          enlace será tienda.yvexiq.com/t/{slugSugerido}
        </Text>
      </View>
    );
  }

  function renderConfigura() {
    if (!cfg) return null;
    return (
      <>
        <Text style={est.seccion}>CONFIGURA TU ESCAPARATE</Text>

        <Campo label="Plantilla">
          <View style={est.plantillas}>
            {PLANTILLAS.map((p) => {
              const activa = cfg.plantilla === p.id;
              return (
                <Pressable
                  key={p.id}
                  style={[est.plantilla, activa && { borderColor: T.acento, backgroundColor: T.acentoSuave }]}
                  onPress={() => actualizarCfg({ plantilla: p.id })}
                >
                  <MuestraPlantilla p={p} acento={cfg.color} />
                  <Text style={est.plantillaNombre}>{p.nombre}</Text>
                  <Text style={est.plantillaDesc}>{p.desc}</Text>
                </Pressable>
              );
            })}
          </View>
        </Campo>

        <Campo label="Color de acento">
          <View style={est.chipsColor}>
            {ACENTOS.map((a) => {
              const activo = cfg.color.toLowerCase() === a.color.toLowerCase();
              return (
                <Pressable
                  key={a.id}
                  onPress={() => actualizarCfg({ color: a.color })}
                  style={[
                    est.chipColor,
                    { backgroundColor: a.color },
                    activo && { borderColor: T.texto, transform: [{ scale: 1.12 }] },
                  ]}
                  accessibilityLabel={a.nombre}
                >
                  {activo && <Text style={est.chipPaloma}>✓</Text>}
                </Pressable>
              );
            })}
          </View>
        </Campo>

        <Campo
          label="WhatsApp para pedidos"
          ayuda={
            cfg.whatsapp.trim() === ""
              ? "Con código de país, por ejemplo +52 55 1234 5678."
              : waNormalizado
                ? `Se publicará como: ${waNormalizado}`
                : "Ese número no parece completo: revisa que lleve 10 dígitos (más el 52 si aplica)."
          }
        >
          <TextInput
            style={estiloInput}
            value={cfg.whatsapp}
            onChangeText={(v) => actualizarCfg({ whatsapp: v })}
            placeholder="+52 55 1234 5678"
            placeholderTextColor={T.textoTenue}
            keyboardType="phone-pad"
          />
        </Campo>

        <Campo label="Mensaje de bienvenida">
          <TextInput
            style={[estiloInput, { minHeight: 70, textAlignVertical: "top" }]}
            value={cfg.mensaje}
            onChangeText={(v) => actualizarCfg({ mensaje: v })}
            placeholder="¡Bienvenido! Escoge lo que gustes y pídelo por WhatsApp."
            placeholderTextColor={T.textoTenue}
            multiline
          />
        </Campo>

        <View style={est.switchFila}>
          <View style={{ flex: 1 }}>
            <Text style={est.switchTitulo}>Mostrar existencias</Text>
            <Text style={est.switchMeta}>
              Tus clientes verán cuántas piezas quedan de cada producto.
            </Text>
          </View>
          <Switch
            value={cfg.mostrarStock}
            onValueChange={(v) => actualizarCfg({ mostrarStock: v })}
            trackColor={{ true: T.acento, false: T.superficie3 }}
            thumbColor="#ffffff"
          />
        </View>
      </>
    );
  }

  function renderProductos() {
    return (
      <>
        <Text style={est.seccion}>PRODUCTOS EN TU TIENDA</Text>
        <Pressable style={est.filaProductos} onPress={() => setVista("productos")}>
          <IconoUI id="inventario" size={20} color={T.acento} />
          <View style={{ flex: 1 }}>
            <Text style={est.filaProductosTitulo}>
              {seleccionados.length === 0
                ? "Elige qué productos se muestran"
                : `${seleccionados.length} producto${seleccionados.length === 1 ? "" : "s"} en tu escaparate`}
            </Text>
            {sinFoto > 0 && (
              <Text style={est.filaProductosMeta}>
                {sinFoto} sin foto — con foto venden más.
              </Text>
            )}
          </View>
          <Text style={est.flecha}>→</Text>
        </Pressable>
      </>
    );
  }

  function renderPublicar() {
    if (!cfg) return null;
    const yaPublicada = !!cfg.url;
    return (
      <>
        <Boton
          titulo={yaPublicada ? "Actualizar tienda" : "Publicar mi tienda"}
          onPress={publicar}
          cargando={publicando}
          deshabilitado={seleccionados.length === 0}
        />
        {seleccionados.length === 0 && (
          <Text style={est.notaCalma}>
            Primero entra a «Productos en tu tienda» y prende al menos uno.
          </Text>
        )}
        {yaPublicada && (
          <Boton
            titulo="Desactivar tienda"
            tipo="fantasma"
            chico
            cargando={desactivando}
            onPress={confirmarDesactivar}
          />
        )}
      </>
    );
  }

  function renderPie() {
    return (
      <Pressable onPress={contactarWebmaster} style={est.pie}>
        <Text style={est.pieTxt}>
          ¿Quieres una página web con dominio propio y diseño a la medida?{" "}
          <Text style={{ color: T.turquesa, fontWeight: "800" }}>Habla con nosotros</Text>
        </Text>
      </Pressable>
    );
  }

  function renderPrincipal() {
    return (
      <ScrollView contentContainerStyle={est.cuerpo} keyboardShouldPersistTaps="handled">
        {error ? <Banner texto={error} tipo="error" /> : null}
        {aviso ? <Banner texto={aviso.texto} tipo={aviso.tipo} /> : null}
        {renderEstado()}
        {renderConfigura()}
        {renderProductos()}
        {renderPublicar()}
        {renderPie()}
        <View style={{ height: 30 }} />
      </ScrollView>
    );
  }

  function renderListaProductos() {
    return (
      <FlatList
        data={productos}
        keyExtractor={(p) => p.id}
        contentContainerStyle={est.cuerpo}
        ListHeaderComponent={
          sinFoto > 0 ? (
            <Banner
              texto={`${sinFoto} producto${sinFoto === 1 ? "" : "s"} de tu escaparate ${sinFoto === 1 ? "no tiene" : "no tienen"} foto. Con foto venden más: agrégala desde Productos.`}
              tipo="info"
            />
          ) : null
        }
        ListEmptyComponent={
          <Text style={est.vacio}>
            Aún no tienes productos. Agrégalos desde la sección Productos del inicio.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={est.prodFila}>
            {item.imagen_uri ? (
              <Image source={{ uri: item.imagen_uri }} style={est.prodFoto} />
            ) : (
              <View style={[est.prodFoto, est.prodFotoVacia]}>
                <IconoUI id="imagen" size={18} color={T.textoTenue} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={est.prodNombre} numberOfLines={2}>
                {item.nombre}
              </Text>
              <Text style={est.prodMeta}>
                {pesos(item.precio_venta_centavos)}
                {item.categoria_nombre ? ` · ${item.categoria_nombre}` : ""}
              </Text>
            </View>
            <Switch
              value={item.en_tienda === 1}
              onValueChange={(v) => alternarProducto(item, v)}
              trackColor={{ true: T.acento, false: T.superficie3 }}
              thumbColor="#ffffff"
            />
          </View>
        )}
      />
    );
  }

  return (
    <Modal animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={est.raiz} edges={["top"]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <CabeceraModal
            titulo={vista === "productos" ? "Productos en tu tienda" : "Mi tienda en línea"}
            izquierda={vista === "productos" ? "Atrás" : "Cerrar"}
            onIzquierda={() => {
              if (vista === "productos") setVista("principal");
              else {
                onCambio?.();
                onCerrar();
              }
            }}
          />
          {cargando ? (
            <View style={est.cargando}>
              <Text style={est.vacio}>Preparando tu escaparate…</Text>
            </View>
          ) : !vinculado ? (
            renderSinCuenta()
          ) : vista === "productos" ? (
            renderListaProductos()
          ) : (
            renderPrincipal()
          )}
        </KeyboardAvoidingView>

        {cuentaAbierta && (
          <ModalCuenta
            onCerrar={() => {
              setCuentaAbierta(false);
              void cargar();
            }}
            onCambio={() => {
              setCuentaAbierta(false);
              void cargar();
            }}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

function crearEstilos(T: Tema) {
  return StyleSheet.create({
    raiz: { flex: 1, backgroundColor: T.fondo },
    cuerpo: { padding: T.esp, paddingTop: 16 },
    cargando: { flex: 1, alignItems: "center", justifyContent: "center" },
    vacio: { color: T.textoTenue, fontSize: 14 },
    seccion: {
      color: T.textoSuave,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 1,
      marginTop: 8,
      marginBottom: 12,
    },

    // Sin cuenta
    heroVacio: {
      width: 72,
      height: 72,
      borderRadius: 22,
      backgroundColor: T.acentoSuave,
      borderWidth: 1,
      borderColor: T.acento,
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "center",
      marginTop: 26,
      marginBottom: 18,
    },
    tituloGrande: {
      color: T.texto,
      fontSize: 22,
      fontWeight: "800",
      letterSpacing: -0.4,
      textAlign: "center",
      marginBottom: 14,
    },
    parrafo: { color: T.textoSuave, fontSize: 14.5, lineHeight: 21, marginBottom: 12 },
    notaCalma: {
      color: T.textoTenue,
      fontSize: 12.5,
      lineHeight: 18,
      textAlign: "center",
      marginTop: 14,
    },

    // Estado
    estadoAlAire: {
      backgroundColor: T.exitoSuave,
      borderWidth: 1,
      borderColor: T.exito,
      borderRadius: T.radioGrande,
      padding: 18,
      marginBottom: 18,
      gap: 6,
    },
    estadoFilaTitulo: { flexDirection: "row", alignItems: "center", gap: 8 },
    puntoVivo: { width: 9, height: 9, borderRadius: 5, backgroundColor: T.exito },
    estadoTitulo: { color: T.exitoTexto, fontSize: 16, fontWeight: "900" },
    estadoUrl: { color: T.exitoTexto, fontSize: 14, fontWeight: "700" },
    estadoMeta: { color: T.exitoTexto, fontSize: 12, opacity: 0.85 },
    estadoBotones: { flexDirection: "row", gap: 10, marginTop: 8, flexWrap: "wrap" },
    estadoApagada: {
      backgroundColor: T.superficie,
      borderWidth: 1,
      borderColor: T.borde,
      borderRadius: T.radioGrande,
      padding: 18,
      marginBottom: 18,
      gap: 6,
    },
    estadoTituloApagada: { color: T.texto, fontSize: 16, fontWeight: "800" },
    estadoMetaApagada: { color: T.textoSuave, fontSize: 13, lineHeight: 19 },

    // Plantillas
    plantillas: { flexDirection: "row", gap: 10 },
    plantilla: {
      flex: 1,
      alignItems: "center",
      gap: 6,
      padding: 10,
      borderRadius: T.radio,
      borderWidth: 1.5,
      borderColor: T.borde,
      backgroundColor: T.superficie,
    },
    plantillaNombre: { color: T.texto, fontSize: 13, fontWeight: "800" },
    plantillaDesc: { color: T.textoTenue, fontSize: 11, textAlign: "center" },

    // Color de acento
    chipsColor: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    chipColor: {
      width: 38,
      height: 38,
      borderRadius: 19,
      borderWidth: 2,
      borderColor: "transparent",
      alignItems: "center",
      justifyContent: "center",
    },
    chipPaloma: { color: "#ffffff", fontSize: 16, fontWeight: "900" },

    // Switch mostrar existencias
    switchFila: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: T.superficie,
      borderWidth: 1,
      borderColor: T.borde,
      borderRadius: T.radio,
      padding: 14,
      marginBottom: 18,
    },
    switchTitulo: { color: T.texto, fontSize: 14.5, fontWeight: "800" },
    switchMeta: { color: T.textoTenue, fontSize: 12, marginTop: 2 },

    // Fila de acceso a productos
    filaProductos: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: T.superficie,
      borderWidth: 1,
      borderColor: T.borde,
      borderRadius: T.radio,
      padding: 15,
      marginBottom: 18,
    },
    filaProductosTitulo: { color: T.texto, fontSize: 14.5, fontWeight: "800" },
    filaProductosMeta: { color: T.textoTenue, fontSize: 12, marginTop: 2 },
    flecha: { color: T.turquesa, fontSize: 16, fontWeight: "800" },

    // Lista de productos
    prodFila: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: T.superficie,
      borderWidth: 1,
      borderColor: T.borde,
      borderRadius: T.radio,
      padding: 12,
      marginBottom: 8,
    },
    prodFoto: { width: 46, height: 46, borderRadius: 10 },
    prodFotoVacia: {
      backgroundColor: T.superficie2,
      borderWidth: 1,
      borderColor: T.borde,
      alignItems: "center",
      justifyContent: "center",
    },
    prodNombre: { color: T.texto, fontSize: 14, fontWeight: "700" },
    prodMeta: { color: T.textoTenue, fontSize: 12, marginTop: 2 },

    // Pie de contacto
    pie: { marginTop: 22, paddingVertical: 8 },
    pieTxt: {
      color: T.textoSuave,
      fontSize: 13,
      lineHeight: 19,
      textAlign: "center",
    },
  });
}
