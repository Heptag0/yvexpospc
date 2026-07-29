// YvexPOS Móvil — Modal de MI TIENDA EN LÍNEA (escaparate, v2).
//
// Publica el catálogo en https://{slug}.yvexiq.com: plantilla (6 diseños),
// color de acento, enlace propio verificable, banner de portada, WhatsApp,
// datos del negocio (domicilio, horarios, redes), opciones de pedido
// (pickup / domicilio / pagos) y qué productos se muestran. Todo se guarda
// local al instante; PUBLICAR es siempre un botón explícito del dueño
// (nada automático).
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
  ActivityIndicator,
} from "react-native";
import * as Linking from "expo-linking";
import * as ImagePicker from "expo-image-picker";
import { WebView as WebViewNativo } from "react-native-webview";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, CabeceraModal, Campo, useEstiloInput } from "@/src/componentes/ui";
import { IconoUI, IdUI } from "@/src/componentes/iconos";
import ModalCuenta from "@/src/componentes/ModalCuenta";
import { pesos, fmtFecha } from "@/src/base/formato";
import { ACENTOS } from "@/src/base/apariencia";
import { estadoCuenta } from "@/src/base/nube";
import { leerNombreNegocio, leerGiro } from "@/src/base/giro";
import {
  PlantillaTienda,
  TiendaLocal,
  EstadoTiendaRemoto,
  CONTACTO_WEBMASTER,
  MAX_BANNER_BASE64,
  TIENDA_BASE,
  leerTiendaLocal,
  guardarTiendaLocal,
  catalogoConMarca,
  marcarEnTienda,
  publicarTienda,
  estadoTienda,
  desactivarTienda,
  verificarSlugDisponible,
  FalloTienda,
} from "@/src/base/tienda";
import {
  sugerirSlug,
  normalizarSlug,
  slugFormatoValido,
  urlSubdominio,
  plantillaParaGiro,
  pesosACentavos,
  normalizarRed,
  linkPagoValido,
  whatsappValido,
  armarTextoAyuda,
  urlPreviewTienda,
  TemaTienda,
} from "@/src/base/tiendaReglas";

type Tema = ReturnType<typeof useTema>["tema"];
type Vista = "principal" | "productos";

// expo-clipboard se instala aparte; copiarEnlace() lo intenta con require
// protegido y, si falta el módulo, cae al Share nativo para no dejar al
// dueño sin forma de llevarse su enlace.
declare const require: any;

type ProductoFila = {
  id: string;
  nombre: string;
  precio_venta_centavos: number;
  imagen_uri: string | null;
  categoria_nombre: string | null;
  en_tienda: number;
  stock: number;
};

// Paletas de las plantillas del servidor (entrega-pc/tienda/plantillas.py).
// Se usan en el mini-mock de cada diseño.
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
  { id: "boutique", nombre: "Boutique", desc: "Elegante, foto grande", fondo: "#faf5f2", tarjeta: "#ffffff", texto: "#2b2320", borde: "#eadfd8" },
  { id: "menu", nombre: "Menú", desc: "Lista para comida", fondo: "#fbf8f1", tarjeta: "#ffffff", texto: "#2e2416", borde: "#ece1c8" },
  { id: "catalogo", nombre: "Catálogo", desc: "Muchos productos", fondo: "#f4f6f8", tarjeta: "#ffffff", texto: "#1d2733", borde: "#dfe5ec" },
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

/** Switch con título y explicación (misma línea visual que el resto). */
function FilaSwitch({
  T,
  titulo,
  meta,
  valor,
  onCambio,
}: {
  T: Tema;
  titulo: string;
  meta?: string;
  valor: boolean;
  onCambio: (v: boolean) => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        backgroundColor: T.superficie,
        borderWidth: 1,
        borderColor: T.borde,
        borderRadius: T.radio,
        padding: 14,
        marginBottom: 10,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: T.texto, fontSize: 14.5, fontWeight: "800" }}>{titulo}</Text>
        {meta ? (
          <Text style={{ color: T.textoTenue, fontSize: 12, marginTop: 2, lineHeight: 17 }}>
            {meta}
          </Text>
        ) : null}
      </View>
      <Switch
        value={valor}
        onValueChange={onCambio}
        trackColor={{ true: T.acento, false: T.superficie3 }}
        thumbColor="#ffffff"
      />
    </View>
  );
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
  const [giro, setGiro] = useState("otro");

  // "Tu enlace": el texto crudo que teclea el dueño y el estado del chequeo.
  const [slugTexto, setSlugTexto] = useState("");
  const [verificandoSlug, setVerificandoSlug] = useState(false);
  const [chequeoSlug, setChequeoSlug] = useState<{
    slug: string;
    disponible: boolean;
    motivo: string | null;
    sugerencia: string | null;
  } | null>(null);

  // Costo de envío en PESOS tal como lo teclea el dueño.
  const [envioTexto, setEnvioTexto] = useState("");

  // Vista previa real de una plantilla (WebView a pantalla casi completa).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [publicando, setPublicando] = useState(false);
  const [desactivando, setDesactivando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState<{ texto: string; tipo: "exito" | "info" } | null>(null);

  const cargar = useCallback(async () => {
    const [cuenta, local, prods, nombre, giroId] = await Promise.all([
      estadoCuenta(),
      leerTiendaLocal(),
      catalogoConMarca(),
      leerNombreNegocio(),
      leerGiro(),
    ]);
    setVinculado(cuenta.vinculado);
    setCfg(local);
    setProductos(prods);
    setNegocio(nombre);
    setGiro(giroId);
    // El input del enlace arranca con el slug guardado (o la sugerencia).
    setSlugTexto(local.slug ?? sugerirSlug(nombre));
    setEnvioTexto(
      local.costoEnvioCentavos > 0
        ? (local.costoEnvioCentavos / 100).toFixed(2).replace(/\.?0+$/, "")
        : ""
    );
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
  const urlPathTienda = remoto?.url_path ?? cfg?.urlPath ?? null;
  const slugSugerido = sugerirSlug(negocio);
  const waNormalizado = cfg ? whatsappValido(cfg.whatsapp) : null;
  const slugNormalizado = normalizarSlug(slugTexto);
  const plantillaSugerida = plantillaParaGiro(giro);

  // La plantilla sugerida por el giro va PRIMERA con su etiqueta.
  const plantillasOrdenadas = useMemo(() => {
    const sugerida = PLANTILLAS.find((p) => p.id === plantillaSugerida);
    const resto = PLANTILLAS.filter((p) => p.id !== plantillaSugerida);
    return sugerida ? [sugerida, ...resto] : PLANTILLAS;
  }, [plantillaSugerida]);

  // --- Acciones ---

  async function actualizarCfg(parcial: Parameters<typeof guardarTiendaLocal>[0]) {
    if (!cfg) return;
    setCfg({ ...cfg, ...parcial });
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

  async function copiarEnlace() {
    if (!urlTienda) return;
    try {
      const mod = require("expo-clipboard");
      await mod.setStringAsync(urlTienda);
      setAviso({ texto: "Enlace copiado. Ya puedes pegarlo donde quieras.", tipo: "exito" });
    } catch {
      // Sin expo-clipboard en este build: el Share nativo también sirve.
      try {
        await Share.share({ message: urlTienda });
      } catch {
        // Share cancelado: no pasa nada.
      }
    }
  }

  // --- Diseño: vista previa real de una plantilla (mantener pulsada) ---

  function abrirPreviewPlantilla(id: PlantillaTienda) {
    if (!cfg) return;
    const slug = remoto?.slug ?? cfg.slug;
    // La vista previa necesita la tienda YA publicada (renderiza productos
    // reales del servidor).
    if (!slug || (!tiendaAlAire && !cfg.url)) {
      setAviso({
        texto:
          "Publica tu tienda primero para ver la vista previa real con tus productos.",
        tipo: "info",
      });
      return;
    }
    const url = urlPreviewTienda(TIENDA_BASE, slug, id, cfg.tema, cfg.color);
    setPreviewUrl(url);
  }

  // --- Tu enlace ---

  function alCambiarSlug(texto: string) {
    setSlugTexto(texto);
    setChequeoSlug(null); // cualquier cambio invalida el chequeo anterior
    const limpio = normalizarSlug(texto);
    void actualizarCfg({ slug: limpio === "" ? null : limpio });
  }

  async function verificarSlug() {
    setError("");
    setAviso(null);
    const limpio = normalizarSlug(slugTexto);
    if (!slugFormatoValido(limpio)) {
      setChequeoSlug({
        slug: limpio,
        disponible: false,
        motivo:
          limpio === ""
            ? "Escribe tu enlace con letras y números, sin espacios ni acentos."
            : "Tu enlace necesita al menos 3 letras o números, sin espacios ni acentos.",
        sugerencia: null,
      });
      return;
    }
    setVerificandoSlug(true);
    try {
      const r = await verificarSlugDisponible(limpio);
      setChequeoSlug({
        slug: limpio,
        disponible: r.disponible,
        motivo: r.motivo,
        sugerencia: r.sugerencia,
      });
    } catch (e: any) {
      if (e instanceof FalloTienda && e.tipo === "sin_internet") {
        setChequeoSlug(null);
        setAviso({
          texto:
            "Sin conexión a internet: no pudimos verificar el enlace. Tu selección quedó guardada; verifícalo cuando tengas señal.",
          tipo: "info",
        });
      } else {
        setError(mensajeError(e));
      }
    } finally {
      setVerificandoSlug(false);
    }
  }

  // --- Banner ---

  async function elegirBanner() {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.7,
        base64: true,
      });
      if (r.canceled || !r.assets?.[0]?.base64) return;
      const b64 = r.assets[0].base64;
      if (b64.length > MAX_BANNER_BASE64) {
        setAviso({
          texto:
            "Esa foto está muy pesada para subirla como portada. Elige una imagen más ligera o recórtala un poco.",
          tipo: "info",
        });
        return;
      }
      await actualizarCfg({ bannerBase64: b64 });
    } catch {
      setAviso({
        texto: "No pudimos abrir tu galería. Revisa los permisos de fotos e intenta de nuevo.",
        tipo: "info",
      });
    }
  }

  // --- Pedidos: costo de envío ---

  function alCambiarEnvio(texto: string) {
    setEnvioTexto(texto);
    const centavos = pesosACentavos(texto);
    if (centavos !== null) void actualizarCfg({ costoEnvioCentavos: centavos });
  }

  // --- Promociona tu tienda ---

  function abrirCatalogoWhatsApp() {
    if (!waNormalizado) {
      Alert.alert(
        "Primero configura tu WhatsApp",
        "Arriba, en «Configura tu escaparate», escribe tu WhatsApp para pedidos: con ese número se arma tu catálogo de WhatsApp Business."
      );
      return;
    }
    void Linking.openURL(`https://wa.me/c/${waNormalizado}`).catch(() => {
      Alert.alert("No se pudo abrir WhatsApp", "Intenta de nuevo en un momento.");
    });
  }

  async function publicar() {
    setError("");
    setAviso(null);
    // Un link de pago mal escrito no detiene la publicación: se avisa y se
    // publica sin él (mejor eso a perder la venta).
    if (cfg && cfg.linkPago.trim() && !linkPagoValido(cfg.linkPago)) {
      setAviso({
        texto:
          "El link de pago no parece una dirección válida (debe empezar con https://). Se publicó sin él; corrígelo y actualiza tu tienda.",
        tipo: "info",
      });
      await actualizarCfg({ linkPago: "" });
    }
    setPublicando(true);
    try {
      const r = await publicarTienda();
      setRemoto(await estadoTienda());
      setCfg((prev) =>
        prev ? { ...prev, slug: r.slug, url: r.url, urlPath: r.urlPath } : prev
      );
      setSlugTexto(r.slug);
      setAviso((prevAviso) => ({
        texto:
          (prevAviso ? `${prevAviso.texto}\n\n` : "") +
          `¡Tu tienda quedó al aire! Comparte tu enlace: ${r.url}` +
          (r.advertencias.length ? `\n\n${r.advertencias.join("\n")}` : ""),
        tipo: "exito",
      }));
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
            {urlSubdominio(slugSugerido)}
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
          {urlPathTienda && (
            <Text style={est.estadoMeta}>
              También funciona en {urlPathTienda.replace(/^https?:\/\//, "")}
            </Text>
          )}
          {cfg.ultimaPublicacion && (
            <Text style={est.estadoMeta}>
              Última publicación: {fmtFecha(cfg.ultimaPublicacion)}
            </Text>
          )}
          <View style={est.estadoBotones}>
            <Boton titulo="Compartir enlace" chico onPress={compartir} />
            <Boton titulo="Copiar enlace" chico tipo="secundario" onPress={copiarEnlace} />
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
          enlace será {urlSubdominio(slugNormalizado || slugSugerido)}
        </Text>
      </View>
    );
  }

  function renderTuEnlace() {
    if (!cfg) return null;
    const slug = slugNormalizado;
    return (
      <>
        <Text style={est.seccion}>TU ENLACE</Text>
        <Campo
          label="Elige tu dirección"
          ayuda="Minúsculas, sin espacios ni acentos. Si está ocupado, te sugerimos uno parecido."
        >
          <View style={est.slugFila}>
            <TextInput
              style={[estiloInput, { flex: 1 }]}
              value={slugTexto}
              onChangeText={alCambiarSlug}
              placeholder={slugSugerido}
              placeholderTextColor={T.textoTenue}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Boton
              titulo="Verificar"
              chico
              tipo="secundario"
              cargando={verificandoSlug}
              onPress={verificarSlug}
            />
          </View>
        </Campo>

        {slug !== "" && (
          <View style={est.urlFinal}>
            <IconoUI id="enlace" size={16} color={T.turquesa} />
            <View style={{ flex: 1 }}>
              <Text style={est.urlFinalTxt} selectable>
                {urlSubdominio(slug)}
              </Text>
              <Text style={est.urlFinalMeta}>
                También funciona en tienda.yvexiq.com/t/{slug}
              </Text>
            </View>
          </View>
        )}

        {chequeoSlug && (
          <View
            style={[
              est.chequeo,
              chequeoSlug.disponible
                ? { borderColor: T.exito, backgroundColor: T.exitoSuave }
                : { borderColor: T.borde, backgroundColor: T.superficie2 },
            ]}
          >
            <Text
              style={[
                est.chequeoTxt,
                { color: chequeoSlug.disponible ? T.exitoTexto : T.textoSuave },
              ]}
            >
              {chequeoSlug.disponible
                ? "¡Está libre! Ese enlace puede ser tuyo al publicar."
                : chequeoSlug.motivo ?? "Ese enlace no está disponible."}
              {!chequeoSlug.disponible && chequeoSlug.sugerencia
                ? ` Prueba con «${chequeoSlug.sugerencia}».`
                : ""}
            </Text>
            {!chequeoSlug.disponible && chequeoSlug.sugerencia && (
              <Pressable
                onPress={() => alCambiarSlug(chequeoSlug.sugerencia!)}
                style={est.chequeoUsar}
              >
                <Text style={{ color: T.turquesa, fontWeight: "800", fontSize: 13 }}>
                  Usar «{chequeoSlug.sugerencia}»
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </>
    );
  }

  function renderBanner() {
    if (!cfg) return null;
    return (
      <Campo
        label="Imagen de portada"
        ayuda="Sale al tope de tu tienda, como el toldo de tu local. Horizontal se ve mejor."
      >
        {cfg.bannerBase64 ? (
          <View>
            <Image
              source={{ uri: `data:image/jpeg;base64,${cfg.bannerBase64}` }}
              style={est.bannerPreview}
              resizeMode="cover"
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <Boton titulo="Cambiar imagen" chico tipo="secundario" onPress={elegirBanner} />
              <Pressable
                style={est.botonQuitar}
                onPress={() => actualizarCfg({ bannerBase64: null })}
              >
                <IconoUI id="basura" size={16} color={T.peligro ?? T.textoSuave} />
                <Text style={{ color: T.peligro ?? T.textoSuave, fontWeight: "800", fontSize: 13 }}>
                  Quitar
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={est.botonBanner} onPress={elegirBanner}>
            <IconoUI id="imagen" size={22} color={T.acento} />
            <Text style={est.botonBannerTxt}>Agregar imagen de portada</Text>
          </Pressable>
        )}
      </Campo>
    );
  }

  function renderDiseno() {
    if (!cfg) return null;
    const temas: { id: TemaTienda; etiqueta: string }[] = [
      { id: "claro", etiqueta: "Claro" },
      { id: "oscuro", etiqueta: "Oscuro" },
      { id: "auto", etiqueta: "Auto" },
    ];
    return (
      <>
        <Text style={est.seccion}>DISEÑO</Text>

        <Campo
          label="Plantilla"
          ayuda="Toca para elegir. Mantén presionada una plantilla para previsualizarla con tus productos reales."
        >
          <View style={est.plantillas}>
            {plantillasOrdenadas.map((p) => {
              const activa = cfg.plantilla === p.id;
              const sugerida = p.id === plantillaSugerida;
              return (
                <Pressable
                  key={p.id}
                  style={[est.plantilla, activa && { borderColor: T.acento, backgroundColor: T.acentoSuave }]}
                  onPress={() => actualizarCfg({ plantilla: p.id })}
                  onLongPress={() => abrirPreviewPlantilla(p.id)}
                  delayLongPress={350}
                >
                  {sugerida && (
                    <Text style={est.etiquetaIdeal}>Ideal para tu giro</Text>
                  )}
                  <MuestraPlantilla p={p} acento={cfg.color} />
                  <Text style={est.plantillaNombre}>{p.nombre}</Text>
                  <Text style={est.plantillaDesc}>{p.desc}</Text>
                  <View style={est.plantillaHint}>
                    <IconoUI id="ojo" size={11} color={T.textoTenue} />
                    <Text style={est.plantillaHintTxt}>mantén para ver</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Campo>

        <Campo
          label="Tema de tu tienda"
          ayuda="Auto sigue el tema del teléfono de tu cliente: si él usa el modo oscuro, tu tienda también se ve oscura."
        >
          <View style={est.segmentado}>
            {temas.map((t) => {
              const activo = cfg.tema === t.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => actualizarCfg({ tema: t.id })}
                  style={[
                    est.segmento,
                    activo && { backgroundColor: T.acento, borderColor: T.acento },
                  ]}
                >
                  <Text style={[est.segmentoTxt, activo && { color: "#ffffff" }]}>
                    {t.etiqueta}
                  </Text>
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

        {renderBanner()}

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

        <FilaSwitch
          T={T}
          titulo="Mostrar existencias"
          meta="Tus clientes verán cuántas piezas quedan de cada producto."
          valor={cfg.mostrarStock}
          onCambio={(v) => actualizarCfg({ mostrarStock: v })}
        />
        <View style={{ height: 8 }} />
      </>
    );
  }

  function renderDatosNegocio() {
    if (!cfg) return null;
    const redes: {
      red: "instagram" | "facebook" | "tiktok";
      etiqueta: string;
      valor: string;
      ejemplo: string;
    }[] = [
      { red: "instagram", etiqueta: "Instagram", valor: cfg.instagram, ejemplo: "@tutienda" },
      { red: "facebook", etiqueta: "Facebook", valor: cfg.facebook, ejemplo: "Tu página o usuario" },
      { red: "tiktok", etiqueta: "TikTok", valor: cfg.tiktok, ejemplo: "@tutienda" },
    ];
    return (
      <>
        <Text style={est.seccion}>DATOS DEL NEGOCIO</Text>

        <Campo label="Domicilio" ayuda="Para que tus clientes sepan dónde recoger o visitarte.">
          <TextInput
            style={estiloInput}
            value={cfg.domicilio}
            onChangeText={(v) => actualizarCfg({ domicilio: v })}
            placeholder="Calle, número, colonia, ciudad"
            placeholderTextColor={T.textoTenue}
          />
        </Campo>

        <Campo label="Horarios">
          <TextInput
            style={[estiloInput, { minHeight: 60, textAlignVertical: "top" }]}
            value={cfg.horarios}
            onChangeText={(v) => actualizarCfg({ horarios: v })}
            placeholder={"Lun a Vie 9:00 a 19:00\nSábados 10:00 a 14:00"}
            placeholderTextColor={T.textoTenue}
            multiline
          />
        </Campo>

        {redes.map((r) => (
          <Campo
            key={r.red}
            label={r.etiqueta}
            ayuda={
              r.valor.trim()
                ? `Se publicará como: ${normalizarRed(r.red, r.valor) || "…"}`
                : "Puedes poner tu usuario o pegar el enlace completo."
            }
          >
            <TextInput
              style={estiloInput}
              value={r.valor}
              onChangeText={(v) => {
                const guardado = normalizarRed(r.red, v);
                if (r.red === "instagram") actualizarCfg({ instagram: guardado });
                else if (r.red === "facebook") actualizarCfg({ facebook: guardado });
                else actualizarCfg({ tiktok: guardado });
              }}
              placeholder={r.ejemplo}
              placeholderTextColor={T.textoTenue}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Campo>
        ))}
      </>
    );
  }

  function renderPedidos() {
    if (!cfg) return null;
    const envioInvalido =
      cfg.entregaDomicilio && envioTexto.trim() !== "" && pesosACentavos(envioTexto) === null;
    return (
      <>
        <Text style={est.seccion}>PEDIDOS Y ENTREGAS</Text>

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

        <FilaSwitch
          T={T}
          titulo="Recoger en tienda"
          meta="Tu cliente pasa por su pedido a tu local."
          valor={cfg.entregaPickup}
          onCambio={(v) => actualizarCfg({ entregaPickup: v })}
        />
        <FilaSwitch
          T={T}
          titulo="Entrega a domicilio"
          meta="Tú llevas el pedido a la puerta de tu cliente."
          valor={cfg.entregaDomicilio}
          onCambio={(v) => actualizarCfg({ entregaDomicilio: v })}
        />

        {cfg.entregaDomicilio && (
          <Campo
            label="Costo de envío"
            ayuda={
              envioInvalido
                ? "Escribe solo el número, por ejemplo 30 o 35.50. Déjalo en 0 si el envío es gratis."
                : cfg.costoEnvioCentavos > 0
                  ? `Se cobrará: ${pesos(cfg.costoEnvioCentavos)}`
                  : "Déjalo en 0 si el envío es gratis."
            }
          >
            <TextInput
              style={estiloInput}
              value={envioTexto}
              onChangeText={alCambiarEnvio}
              placeholder="0"
              placeholderTextColor={T.textoTenue}
              keyboardType="decimal-pad"
            />
          </Campo>
        )}

        <FilaSwitch
          T={T}
          titulo="Pago en efectivo"
          meta="Tu cliente paga al recoger o al recibir su pedido."
          valor={cfg.pagoEfectivo}
          onCambio={(v) => actualizarCfg({ pagoEfectivo: v })}
        />

        <Campo
          label="Link de pago en línea (opcional)"
          ayuda={
            cfg.linkPago.trim() && !linkPagoValido(cfg.linkPago)
              ? "No parece una dirección válida: debe empezar con https://"
              : "Tu link de Mercado Pago, transferencia u otro. Debe empezar con https://"
          }
        >
          <TextInput
            style={estiloInput}
            value={cfg.linkPago}
            onChangeText={(v) => actualizarCfg({ linkPago: v.trim() })}
            placeholder="https://…"
            placeholderTextColor={T.textoTenue}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </Campo>

        <FilaSwitch
          T={T}
          titulo="Ocultar productos agotados"
          meta="Los productos sin existencias no se muestran en tu tienda hasta que resurtas."
          valor={cfg.ocultarAgotados}
          onCambio={(v) => actualizarCfg({ ocultarAgotados: v })}
        />
        <View style={{ height: 8 }} />
      </>
    );
  }

  function renderTarjetaPromo({
    icono,
    titulo,
    pasos,
    accion,
  }: {
    icono: IdUI;
    titulo: string;
    pasos: string[];
    accion?: { titulo: string; onPress: () => void };
  }) {
    return (
      <View style={est.tarjetaPromo}>
        <View style={est.tarjetaPromoCabecera}>
          <IconoUI id={icono} size={20} color={T.acento} />
          <Text style={est.tarjetaPromoTitulo}>{titulo}</Text>
        </View>
        {pasos.map((p, i) => (
          <View key={i} style={est.pasoFila}>
            <View style={est.pasoNumero}>
              <Text style={est.pasoNumeroTxt}>{i + 1}</Text>
            </View>
            <Text style={est.pasoTxt}>{p}</Text>
          </View>
        ))}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          {accion && <Boton titulo={accion.titulo} chico onPress={accion.onPress} />}
          <Boton
            titulo="Copiar enlace"
            chico
            tipo="secundario"
            onPress={copiarEnlace}
            deshabilitado={!urlTienda}
          />
        </View>
      </View>
    );
  }

  function renderPromociona() {
    return (
      <>
        <Text style={est.seccion}>PROMOCIONA TU TIENDA</Text>
        {!urlTienda && (
          <Text style={[est.notaCalma, { textAlign: "left", marginTop: 0, marginBottom: 12 }]}>
            Publica tu tienda primero: así ya tendrás tu enlace listo para
            compartirlo en estos pasos.
          </Text>
        )}
        {renderTarjetaPromo({
          icono: "camara",
          titulo: "En Instagram",
          pasos: [
            "Copia el enlace de tu tienda con el botón de abajo.",
            "Abre Instagram y toca «Editar perfil».",
            "En «Enlaces» (o en tu bio) pega tu enlace y guarda.",
            "En tus fotos e historias invita a tus clientes: «pide en el enlace de mi perfil».",
          ],
        })}
        {renderTarjetaPromo({
          icono: "tienda",
          titulo: "En WhatsApp Business",
          pasos: [
            "WhatsApp Business tiene su propio catálogo: tus clientes lo ven sin salir del chat.",
            "Abre tu catálogo con el botón de abajo y agrega tus productos estrella.",
            "Pega también el enlace de tu tienda en tu mensaje de bienvenida y en tu info del negocio.",
          ],
          accion: { titulo: "Abrir WhatsApp", onPress: abrirCatalogoWhatsApp },
        })}
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
        {renderTuEnlace()}
        {renderDiseno()}
        {renderPedidos()}
        {renderDatosNegocio()}
        {renderProductos()}
        {renderPromociona()}
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

        {/* Vista previa real de la plantilla dentro de la app (WebView). */}
        {previewUrl && (
          <Modal animationType="slide" onRequestClose={() => setPreviewUrl(null)}>
            <SafeAreaView style={est.raiz} edges={["top"]}>
              <CabeceraModal
                titulo="Vista previa de tu tienda"
                izquierda="Cerrar"
                onIzquierda={() => setPreviewUrl(null)}
              />
              <WebViewNativo
                source={{ uri: previewUrl }}
                style={{ flex: 1 }}
                startInLoadingState
                renderLoading={() => (
                  <View style={est.cargando}>
                    <ActivityIndicator color={T.acento} size="large" />
                    <Text style={[est.vacio, { marginTop: 12 }]}>
                      Cargando tu tienda…
                    </Text>
                  </View>
                )}
              />
              <Text style={est.previewNota}>
                Así se verá tu tienda con ese diseño. Los cambios se aplican al
                tocar «{cfg?.url ? "Actualizar tienda" : "Publicar mi tienda"}».
              </Text>
            </SafeAreaView>
          </Modal>
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

    // Tu enlace
    slugFila: { flexDirection: "row", gap: 10, alignItems: "center" },
    urlFinal: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: T.superficie,
      borderWidth: 1,
      borderColor: T.borde,
      borderRadius: T.radio,
      padding: 13,
      marginBottom: 12,
    },
    urlFinalTxt: { color: T.texto, fontSize: 14, fontWeight: "800" },
    urlFinalMeta: { color: T.textoTenue, fontSize: 11.5, marginTop: 2 },
    chequeo: {
      borderWidth: 1,
      borderRadius: T.radio,
      padding: 13,
      marginBottom: 14,
      gap: 6,
    },
    chequeoTxt: { fontSize: 13, fontWeight: "700", lineHeight: 19 },
    chequeoUsar: { alignSelf: "flex-start", paddingVertical: 2 },

    // Plantillas
    plantillas: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    plantilla: {
      width: "31%",
      minWidth: 108,
      flexGrow: 1,
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
    plantillaHint: { flexDirection: "row", alignItems: "center", gap: 4 },
    plantillaHintTxt: { color: T.textoTenue, fontSize: 9.5, fontWeight: "700" },
    // Tema de la tienda (segmentado claro/oscuro/auto)
    segmentado: {
      flexDirection: "row",
      gap: 8,
    },
    segmento: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 12,
      borderRadius: T.radio,
      borderWidth: 1.5,
      borderColor: T.borde,
      backgroundColor: T.superficie,
    },
    segmentoTxt: { color: T.textoSuave, fontSize: 13.5, fontWeight: "800" },
    previewNota: {
      color: T.textoTenue,
      fontSize: 12,
      lineHeight: 17,
      textAlign: "center",
      paddingHorizontal: 24,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: T.borde,
      backgroundColor: T.superficie,
    },
    etiquetaIdeal: {
      color: T.turquesa,
      fontSize: 10,
      fontWeight: "900",
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },

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

    // Banner de portada
    botonBanner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      borderWidth: 1.5,
      borderStyle: "dashed",
      borderColor: T.acento,
      borderRadius: T.radio,
      backgroundColor: T.acentoSuave,
      paddingVertical: 22,
    },
    botonBannerTxt: { color: T.acento, fontSize: 14, fontWeight: "800" },
    bannerPreview: {
      width: "100%",
      height: 120,
      borderRadius: T.radio,
      borderWidth: 1,
      borderColor: T.borde,
      backgroundColor: T.superficie2,
    },
    botonQuitar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 14,
      borderRadius: T.radio,
      borderWidth: 1,
      borderColor: T.borde,
      backgroundColor: T.superficie,
    },

    // Promoción
    tarjetaPromo: {
      backgroundColor: T.superficie,
      borderWidth: 1,
      borderColor: T.borde,
      borderRadius: T.radioGrande,
      padding: 16,
      marginBottom: 14,
    },
    tarjetaPromoCabecera: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 12,
    },
    tarjetaPromoTitulo: { color: T.texto, fontSize: 15, fontWeight: "900" },
    pasoFila: { flexDirection: "row", gap: 10, marginBottom: 8, alignItems: "flex-start" },
    pasoNumero: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: T.acentoSuave,
      borderWidth: 1,
      borderColor: T.acento,
      alignItems: "center",
      justifyContent: "center",
    },
    pasoNumeroTxt: { color: T.acento, fontSize: 11, fontWeight: "900" },
    pasoTxt: { flex: 1, color: T.textoSuave, fontSize: 13, lineHeight: 19 },

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
