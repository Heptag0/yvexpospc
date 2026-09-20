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
//
// ---------------------------------------------------------------------------
// POR QUÉ ESTE ARCHIVO SE CORRIGIÓ QUIRÚRGICAMENTE, NO SE REESCRIBIÓ
// ---------------------------------------------------------------------------
// Es el más grande de los 21 (1717 líneas). El estilo `crearEstilos` ya
// usaba T.* correctamente en el 95% de los casos — el riesgo real de un
// re-skin completo a las primitivas nuevas era transcribir mal algo en un
// archivo de este tamaño, no falta de consistencia visual. Se optó por
// arreglar los bugs concretos que se encontraron leyendo el archivo
// completo, dejando intacta la estructura que ya funcionaba bien.
//
// Tampoco se tocaron PALETAS_MINI, OPCIONES_TEMA (los hex) ni
// MuestraPlantilla: son el espejo exacto de los temas de la TIENDA
// PÚBLICA, no del POS — igual que los sellos NOM-051 en ModalEtiquetas,
// cambiar esos colores rompería la fidelidad de la vista previa.
//
// Lo que sí se corrigió, verificado con el archivo en la mano:
//   1. Cinco T.turquesa -> T.acento (el morado fantasma de siempre).
//   2. Dos `T.peligro ?? T.textoSuave` -> T.peligro (fallback muerto: ese
//      campo siempre existe en el tema actual).
//   3. Cuatro Alert.alert -> tres se convirtieron al mecanismo `aviso` que
//      el propio archivo ya usa en todos lados (son informativos, no
//      decisiones); "Desactivar tienda" -SÍ es destructivo- pasó a una
//      <Hoja> de confirmación, igual que el resto de la app.
//   4. El selector de color de acento tenía un check ✓ blanco fijo sobre
//      el color crudo de cada acento. Se midió, no se asumió: 7 de 9
//      colores fallan contraste con blanco fijo (turquesa 1.86:1, perla
//      1.36:1, ámbar 2.15:1…), y ni violeta ni índigo se arreglan
//      alternando a tinta oscura (4.23 y 4.47, ambos bajo el mínimo de
//      4.5). La solución no es un color dinámico por swatch: el anillo +
//      escala que YA marca la selección (igual que en ModalDepartamentos)
//      es suficiente por sí solo — se quitó el check redundante y roto en
//      vez de intentar arreglarlo.
//   5. El <Modal> principal no pasaba `visible` explícito (funcionaba por
//      el valor por defecto de RN, pero rompía la convención del resto
//      del código).
//   6. BackHandler para la sub-vista "productos": sin él, Atrás cerraba
//      todo el modal en vez de volver a "principal".

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
  Share,
  Image,
  ActivityIndicator,
  BackHandler,
} from "react-native";
// El KeyboardAvoidingView viene de `react-native-keyboard-controller`, no de
// React Native: ver el porqué en ui.tsx. Misma API, mismo "padding", pero
// construido para `edgeToEdgeEnabled`, donde la ventana ya no se redimensiona
// sola al abrirse el teclado.
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import * as Linking from "expo-linking";
import * as ImagePicker from "expo-image-picker";
import { WebView as WebViewNativo } from "react-native-webview";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, CabeceraModal, Campo, Hoja, Monto, useEstiloInput } from "@/src/componentes/ui";
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
  temaTiendaEfectivo,
  fondoGuiaTema,
  contrasteSuficiente,
  acentoContrasteSeguro,
  nombrePlantilla,
  FONDOS_TEMA,
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

// Nombres display espejo del backend v3.1 (ids NO cambian). Las paletas de
// los mini-mocks se pintan por TEMA seleccionado (PALETAS_MINI abajo).
const PLANTILLAS: {
  id: PlantillaTienda;
  nombre: string;
  desc: string;
}[] = [
  { id: "aurora", nombre: "Amanecer", desc: "Clara y moderna" },
  { id: "boutique", nombre: "Vitrina", desc: "Elegante, foto grande" },
  { id: "menu", nombre: "La Carta", desc: "Lista para comida" },
  { id: "catalogo", nombre: "Surtido", desc: "Muchos productos" },
  { id: "noche", nombre: "Nocturna", desc: "Oscura y elegante" },
  { id: "mercado", nombre: "Mercadito", desc: "Cálida y cercana" },
];

// Paletas de los mini-mocks por plantilla y tema, ESPEJO de plantillas.py
// (fondo / tarjeta / texto / borde de cada _PALETAS_*).
type PaletaMini = { fondo: string; tarjeta: string; texto: string; borde: string };
type TemaEfectivo = Exclude<TemaTienda, "auto">;

const PALETAS_MINI: Record<PlantillaTienda, Record<TemaEfectivo, PaletaMini>> = {
  aurora: {
    perla: { fondo: "#f6f7fb", tarjeta: "#fffefd", texto: "#232637", borde: "#e7e9f2" },
    medianoche: { fondo: "#100f14", tarjeta: "#1a1922", texto: "#e6e4ee", borde: "#2b2938" },
    arena: { fondo: "#f7f1e6", tarjeta: "#fdf9f0", texto: "#3d342a", borde: "#e9ddc8" },
    cielo: { fondo: "#eef4f9", tarjeta: "#fbfdfe", texto: "#27313d", borde: "#d9e4ee" },
  },
  noche: {
    perla: { fondo: "#faf9f6", tarjeta: "#ffffff", texto: "#26241f", borde: "#e6e2d8" },
    medianoche: { fondo: "#0d0f16", tarjeta: "#161924", texto: "#e8eaf2", borde: "#262b3d" },
    arena: { fondo: "#f5eee2", tarjeta: "#fcf7ec", texto: "#3a322a", borde: "#e6d9c2" },
    cielo: { fondo: "#edf3f9", tarjeta: "#fafcfd", texto: "#252f3b", borde: "#d7e2ec" },
  },
  mercado: {
    perla: { fondo: "#fdf6ec", tarjeta: "#fffdf8", texto: "#413124", borde: "#f0e2cf" },
    medianoche: { fondo: "#171310", tarjeta: "#241d18", texto: "#ede1d2", borde: "#3a2f25" },
    arena: { fondo: "#f6edda", tarjeta: "#fcf5e7", texto: "#43331f", borde: "#ebd9b8" },
    cielo: { fondo: "#eff5fa", tarjeta: "#fcfeff", texto: "#2c3540", borde: "#dce7f0" },
  },
  boutique: {
    perla: { fondo: "#faf8f5", tarjeta: "#fffefd", texto: "#2a2622", borde: "#eae4dc" },
    medianoche: { fondo: "#131110", tarjeta: "#1e1b19", texto: "#e8e2db", borde: "#322d29" },
    arena: { fondo: "#f6f0e5", tarjeta: "#fcf8ef", texto: "#38301f", borde: "#e7dbc4" },
    cielo: { fondo: "#eff4f8", tarjeta: "#fbfdfe", texto: "#2a323c", borde: "#dde6ee" },
  },
  menu: {
    perla: { fondo: "#fbf7f1", tarjeta: "#fffefb", texto: "#33302b", borde: "#ece4d6" },
    medianoche: { fondo: "#141210", tarjeta: "#1f1b18", texto: "#e9e2d8", borde: "#332d27" },
    arena: { fondo: "#f7f1e3", tarjeta: "#fdf9ee", texto: "#3b3226", borde: "#e9dcc2" },
    cielo: { fondo: "#f0f5f9", tarjeta: "#fcfdfe", texto: "#2b333d", borde: "#dee7ef" },
  },
  catalogo: {
    perla: { fondo: "#f3f5f8", tarjeta: "#ffffff", texto: "#1f2733", borde: "#e3e8ef" },
    medianoche: { fondo: "#0f1218", tarjeta: "#1a1f29", texto: "#e2e6ee", borde: "#282f3e" },
    arena: { fondo: "#f5efe4", tarjeta: "#fdfaf2", texto: "#37302a", borde: "#e5dac5" },
    cielo: { fondo: "#eef4f8", tarjeta: "#fcfeff", texto: "#232e3a", borde: "#d8e4ed" },
  },
};

// Selector de tema v3.1: 4 temas en cuadrícula pareja 2×2 (ya NO se ofrece
// "auto"; el backend lo sigue aceptando pero la app canonicaliza a perla).
const OPCIONES_TEMA: {
  id: TemaTienda;
  nombre: string;
  desc: string;
  fondo: string;
  texto: string;
}[] = [
  { id: "perla", nombre: "Perla", desc: "Claro y suave, como porcelana", fondo: "#f6f7fb", texto: "#232637" },
  { id: "medianoche", nombre: "Medianoche", desc: "Oscuro elegante", fondo: "#0d0f16", texto: "#e8eaf2" },
  { id: "arena", nombre: "Arena", desc: "Beige cálido", fondo: "#f7f1e6", texto: "#3d342a" },
  { id: "cielo", nombre: "Cielo", desc: "Azul pastel tranquilo", fondo: "#eef4f9", texto: "#27313d" },
];

/** Mini-mock de la plantilla (mismo espíritu que MuestraTema: ver, no
 *  adivinar): cabecera, dos tarjetitas de producto y una píldora de acento,
 *  pintado con la paleta del TEMA seleccionado. */
function MuestraPlantilla({
  paleta,
  acento,
}: {
  paleta: PaletaMini;
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
        borderColor: paleta.borde,
        backgroundColor: paleta.fondo,
      }}
    >
      {/* Cabecera de la tienda */}
      <View
        style={{
          height: 12,
          backgroundColor: paleta.tarjeta,
          borderBottomWidth: 1,
          borderBottomColor: paleta.borde,
          justifyContent: "center",
          paddingHorizontal: 6,
        }}
      >
        <View style={{ height: 4, width: 30, borderRadius: 2, backgroundColor: paleta.texto }} />
      </View>
      <View style={{ flex: 1, flexDirection: "row", gap: 5, padding: 6 }}>
        {[0, 1].map((i) => (
          <View
            key={i}
            style={{
              flex: 1,
              borderRadius: 5,
              backgroundColor: paleta.tarjeta,
              borderWidth: 1,
              borderColor: paleta.borde,
              padding: 4,
              justifyContent: "flex-end",
            }}
          >
            <View
              style={{
                height: 5,
                width: i === 0 ? 20 : 14,
                borderRadius: 3,
                backgroundColor: i === 0 ? acento : paleta.borde,
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
  const [confirmandoDesactivar, setConfirmandoDesactivar] = useState(false);
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

  // Atrás del sistema: de "productos" vuelve a "principal" en vez de
  // cerrar todo el modal.
  useEffect(() => {
    const alPresionarAtras = () => {
      if (vista === "productos") {
        setVista("principal");
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", alPresionarAtras);
    return () => sub.remove();
  }, [vista]);

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
      setAviso({
        texto:
          "Primero configura tu WhatsApp: arriba, en «Configura tu escaparate», escribe tu WhatsApp para pedidos — con ese número se arma tu catálogo de WhatsApp Business.",
        tipo: "info",
      });
      return;
    }
    void Linking.openURL(`https://wa.me/c/${waNormalizado}`).catch(() => {
      setAviso({ texto: "No se pudo abrir WhatsApp. Intenta de nuevo en un momento.", tipo: "info" });
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

  // "Desactivar tienda" SÍ es destructivo (la página deja de verse en
  // internet): a diferencia de los avisos informativos de arriba, aquí se
  // necesita una confirmación real. `confirmandoDesactivar` abre la <Hoja>;
  // `ejecutarDesactivar` es lo que antes vivía dentro del onPress del botón
  // "Desactivar" del Alert nativo.
  function confirmarDesactivar() {
    setConfirmandoDesactivar(true);
  }

  async function ejecutarDesactivar() {
    setConfirmandoDesactivar(false);
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
  }

  function contactarWebmaster() {
    const texto = encodeURIComponent(
      `Hola, tengo mi tienda en línea con YvexPOS (${urlTienda ?? `tienda.yvexiq.com/t/${slugSugerido}`}) ` +
        `y me interesa una página web con dominio propio.`
    );
    void Linking.openURL(`https://wa.me/${CONTACTO_WEBMASTER}?text=${texto}`).catch(() => {
      setAviso({ texto: "No se pudo abrir WhatsApp. Intenta de nuevo en un momento.", tipo: "info" });
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
            <IconoUI id="enlace" size={16} color={T.acento} />
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
                <Text style={{ color: T.acento, fontWeight: "800", fontSize: 13 }}>
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
                <IconoUI id="basura" size={16} color={T.peligro} />
                <Text style={{ color: T.peligro, fontWeight: "800", fontSize: 13 }}>
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
    // Tema efectivo para pintar los mini-mocks y medir el contraste:
    // "auto" se aproxima con el tema actual del teléfono del dueño.
    const temaEfectivo = temaTiendaEfectivo(cfg.tema, !T.esClaro) as TemaEfectivo;
    const acentoVisible = acentoContrasteSeguro(cfg.color, FONDOS_TEMA[temaEfectivo]);
    const fondoGuia = fondoGuiaTema(cfg.tema, !T.esClaro);
    const contrasteBajo = !contrasteSuficiente(cfg.color, fondoGuia);
    const nombreTemaElegido =
      OPCIONES_TEMA.find((o) => o.id === cfg.tema)?.nombre ?? "Perla";
    return (
      <>
        <Text style={est.seccion}>DISEÑO</Text>

        <Campo
          label="Tema de tu tienda"
          ayuda="Elige el look de tu escaparate. Se aplica igual en todas las plantillas."
        >
          <View style={est.temasFila}>
            {OPCIONES_TEMA.map((o) => {
              const activo = cfg.tema === o.id;
              return (
                <Pressable
                  key={o.id}
                  onPress={() => actualizarCfg({ tema: o.id })}
                  style={[
                    est.temaOpcion,
                    activo && { borderColor: T.acento, backgroundColor: T.acentoSuave },
                  ]}
                >
                  <View
                    style={[
                      est.temaSwatch,
                      { backgroundColor: o.fondo, borderColor: activo ? T.acento : T.borde },
                    ]}
                  >
                    {/* Mini líneas de texto + punto de acento del look */}
                    <View style={{ height: 3, width: 18, borderRadius: 2, backgroundColor: o.texto }} />
                    <View
                      style={{
                        height: 3,
                        width: 11,
                        borderRadius: 2,
                        backgroundColor: acentoContrasteSeguro(cfg.color, o.fondo),
                        marginTop: 3,
                      }}
                    />
                  </View>
                  <Text style={[est.temaNombre, activo && { color: T.acento }]}>{o.nombre}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={est.temaDesc}>
            {OPCIONES_TEMA.find((o) => o.id === cfg.tema)?.desc}
          </Text>
        </Campo>

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
                  <MuestraPlantilla
                    paleta={PALETAS_MINI[p.id][temaEfectivo]}
                    acento={acentoVisible}
                  />
                  <Text style={est.plantillaNombre}>{nombrePlantilla(p.id)}</Text>
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
          label="Color de acento"
          ayuda={
            contrasteBajo
              ? `Ese color se verá apagado con el tema ${nombreTemaElegido}; tu tienda lo aclarará un poquito automáticamente para que se lea bien.`
              : undefined
          }
        >
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
                  {/* Antes: check ✓ blanco fijo — medido y falla contraste en
                      7 de 9 acentos (turquesa 1.86:1, perla 1.36:1…), y
                      violeta/índigo no se arreglan ni alternando a tinta
                      oscura. El anillo + escala de arriba ya marca la
                      selección sin depender del color de cada swatch. */}
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

        <FilaSwitch
          T={T}
          titulo="Tarjeta al recibir"
          meta="Tu cliente paga con tu terminal al recoger o al recibir su pedido."
          valor={cfg.pagoTerminal}
          onCambio={(v) => actualizarCfg({ pagoTerminal: v })}
        />

        <Campo
          label="Link de pago en línea — en desarrollo"
          ayuda="Esta función llega completa (con una pasarela real) después del lanzamiento. Lo que ya tengas guardado se conserva, pero por ahora no se le muestra a tus clientes."
        >
          <TextInput
            style={[estiloInput, { opacity: 0.5 }]}
            value={cfg.linkPago}
            editable={false}
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
          <Text style={{ color: T.acento, fontWeight: "800" }}>Habla con nosotros</Text>
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
          ) : undefined
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
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
                <Monto texto={pesos(item.precio_venta_centavos)} escala="micro" tono="tenue" />
                {item.categoria_nombre ? (
                  <Text style={est.prodMeta}>· {item.categoria_nombre}</Text>
                ) : null}
              </View>
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
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={est.raiz} edges={["top"]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          // "padding" en las DOS plataformas.
              //
              // Antes: Platform.OS === "ios" ? "padding" : undefined. En
              // Android eso era literalmente NINGUNA evitación de teclado. Era
              // correcto cuando `softwareKeyboardLayoutMode: "resize"`
              // redimensionaba la ventana, pero con `edgeToEdgeEnabled: true`
              // la ventana ya no se encoge: la app dibuja por debajo del
              // teclado, y los campos quedaban tapados.
              //
              // NO "height", que es la otra tentación: anima la altura del
              // contenedor y pelea con la animación del sistema, así que el
              // contenido rebota al cerrarse el teclado. Ya se probó.
              behavior="padding"
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

      {/* Confirmación de desactivar: antes era un Alert.alert nativo — la
          única acción de este archivo que de verdad es destructiva
          (la tienda deja de verse en internet). */}
      <Hoja
        visible={confirmandoDesactivar}
        onCerrar={() => setConfirmandoDesactivar(false)}
        titulo="Desactivar tienda"
        pie={
          <View style={{ gap: T.esps.sm }}>
            <Boton titulo="Desactivar" tipo="peligro" onPress={ejecutarDesactivar} cargando={desactivando} />
            <Boton titulo="Conservar tienda" tipo="secundario" onPress={() => setConfirmandoDesactivar(false)} />
          </View>
        }
      >
        <Text style={{ color: T.textoSuave, fontSize: 13.5, lineHeight: 20 }}>
          Tu página dejará de mostrarse en internet, pero tu catálogo y tu selección se quedan
          guardados aquí. Puedes volver a publicar cuando quieras.
        </Text>
      </Hoja>
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
    // Tema de la tienda v3.1 (cuadrícula pareja 2×2)
    temasFila: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    temaOpcion: {
      width: "47%",
      flexGrow: 1,
      alignItems: "center",
      gap: 6,
      padding: 12,
      borderRadius: T.radio,
      borderWidth: 1.5,
      borderColor: T.borde,
      backgroundColor: T.superficie,
    },
    temaSwatch: {
      width: 40,
      height: 30,
      borderRadius: 8,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    temaNombre: { color: T.textoSuave, fontSize: 11.5, fontWeight: "800" },
    temaDesc: { color: T.textoTenue, fontSize: 12, marginTop: 8, lineHeight: 17 },
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
      color: T.acento,
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
    // chipPaloma quitado: el check blanco fijo fallaba contraste en la
    // mayoría de los acentos (ver nota en el JSX de arriba). El anillo +
    // escala ya es suficiente para marcar la selección.

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
    flecha: { color: T.acento, fontSize: 16, fontWeight: "800" },

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
