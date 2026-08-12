// YvexPOS Móvil — Formulario de producto (crear/editar), rediseñado.
//
// ARREGLOS DE RAÍZ de los bugs reportados:
//   1. Estado viejo entre aperturas: este componente ahora SE MONTA FRESCO en
//      cada apertura (el padre lo renderiza condicionalmente). El estado
//      inicial siempre corresponde al producto actual. Además `guardando` ya
//      no puede quedarse pegado.
//   2. Errores invisibles: usa <Banner tipo="error"> con contraste garantizado.
//
// NUEVO: modo Kit (paquete). Selector Producto/Kit; en modo kit hay un armador
// de componentes (buscar producto -> añadir con cantidad), el costo se calcula
// de los componentes (como el PC), y el kit no maneja stock propio.

import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  StyleSheet,
  Switch,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import {
  Producto,
  Categoria,
  ComponenteKit,
  DatosProducto,
  crearProducto,
  editarProducto,
  eliminarProducto,
  componentesDeKit,
  candidatosComponente,
} from "@/src/base/inventario";
import { aCentavos, centavosATexto, aNumero, pesos, fmtStock } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import {
  elegirImagen, borrarImagen,
  descargarImagen, quitarFondo, recorteDisponible,
  persistirRecorteConOriginal, originalDe,
} from "@/src/base/imagenes";
import ImagenProducto from "@/src/componentes/ImagenProducto";
import RecortadorFoto from "@/src/componentes/RecortadorFoto";
import { IconoUI } from "@/src/componentes/iconos";
import { Boton, Banner, CabeceraModal, Campo, Insignia, useEstiloInput } from "@/src/componentes/ui";
import EscanerCamara from "@/src/componentes/EscanerCamara";
import { consultarNombreUniversal, consultarFichaUniversal } from "@/src/base/codigos";

type Props = {
  producto: Producto | null; // null = crear
  categorias: Categoria[];
  onCerrar: () => void;
  onGuardado: () => void;
  /** Alta prellenada desde el escáner de Vender: código (y nombre universal
   *  si la consulta respondió). El usuario siempre confirma antes de guardar. */
  prellenado?: { codigo: string; nombre?: string | null } | null;
};

type CompLocal = { producto_id: string; nombre: string; cantidad: string; costo_centavos: number | null; stock: number };

type Tema = ReturnType<typeof useTema>["tema"];

/** "¿Cómo se vende?" — mismo criterio que el PC (src/vistas/inventario.js):
 *  pieza = piezas enteras · granel = peso/volumen con báscula (kg o litro,
 *  con decimales) · kit = paquete que agrupa otros productos. Reemplaza el
 *  viejo selector "Producto/Kit" + el dropdown suelto de unidad. */
type ModoVenta = "pieza" | "granel" | "kit";

/** Deriva el modo inicial de un producto existente, igual que aplicarModo()
 *  hace en el PC: kit si es_kit, granel si su unidad ya es kg/litro, pieza
 *  en cualquier otro caso (incluye unidades viejas ya retiradas: g, ml,
 *  caja, paquete, metro — se re-clasifican como pieza al guardar). */
function modoVentaInicial(p: Producto | null): ModoVenta {
  if (!p) return "pieza";
  if (p.es_kit === 1) return "kit";
  if (p.unidad === "kg" || p.unidad === "litro") return "granel";
  return "pieza";
}

export default function FormularioProducto({ producto, categorias, onCerrar, onGuardado, prellenado }: Props) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const estiloInput = useEstiloInput();
  const esEdicion = !!producto;

  const [modoVenta, setModoVenta] = useState<ModoVenta>(modoVentaInicial(producto));
  const [unidadGranel, setUnidadGranel] = useState<"kg" | "litro">(
    producto?.unidad === "litro" ? "litro" : "kg"
  );
  // esKit y unidad se DERIVAN de modoVenta (nunca se editan directo), así
  // nunca quedan desincronizados entre sí.
  const esKit = modoVenta === "kit";
  const unidad = modoVenta === "granel" ? unidadGranel : "pieza";

  const [nombre, setNombre] = useState(producto?.nombre ?? prellenado?.nombre ?? "");
  // ¿El nombre actual es una sugerencia sin confirmar (del catálogo
  // universal) o algo que el tendero escribió a mano? Solo lo primero se
  // reemplaza solo al re-escanear un código distinto.
  const [nombreEsSugerido, setNombreEsSugerido] = useState(!esEdicion && !!prellenado?.nombre);
  const [codigo, setCodigo] = useState(producto?.codigo_barras ?? prellenado?.codigo ?? "");
  const [categoriaId, setCategoriaId] = useState<string | null>(producto?.categoria_id ?? null);
  const [precio, setPrecio] = useState(producto ? centavosATexto(producto.precio_venta_centavos) : "");
  const [costo, setCosto] = useState(centavosATexto(producto?.costo_centavos ?? null));
  const [mayoreo, setMayoreo] = useState(centavosATexto(producto?.precio_mayoreo_centavos ?? null));
  const [controlaStock, setControlaStock] = useState(producto ? producto.controla_stock === 1 : true);
  const [stock, setStock] = useState(String(producto?.stock ?? 0));
  const [stockMin, setStockMin] = useState(String(producto?.stock_minimo ?? 0));
  const [favorito, setFavorito] = useState(producto?.favorito === 1);
  const [imagenUri, setImagenUri] = useState<string | null>(producto?.imagen_uri ?? null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  // Escáner de código (modo único) y aviso discreto del nombre universal.
  const [escanerAbierto, setEscanerAbierto] = useState(false);
  const [avisoEscaner, setAvisoEscaner] = useState("");
  const [buscandoNombre, setBuscandoNombre] = useState(false);
  const [fotoSugerida, setFotoSugerida] = useState<string | null>(null);
  const [buscandoFoto, setBuscandoFoto] = useState(false);
  const [recortando, setRecortando] = useState(false);
  const [hayRecorte, setHayRecorte] = useState(false);
  // ¿La foto actual vino del catálogo abierto? Sirve para el aviso de
  // calidad (cerrable) y para saber si dejar de mostrarlo al cambiar de foto.
  const [fotoEsSugerida, setFotoEsSugerida] = useState(false);
  const [avisoFotoVisible, setAvisoFotoVisible] = useState(false);
  // Vista grande al mantener pulsada la foto (con el formulario difuminado
  // detrás) + acciones rápidas (cámara/galería/quitar fondo/ajustar) sin cerrarla.
  const [lightboxAbierto, setLightboxAbierto] = useState(false);
  // Recortador con pellizco/arrastre: reemplaza el recorte destructivo del
  // picker nativo. ajusteEsNuevo distingue "foto recién elegida/descargada,
  // sin persistir todavía" de "re-ajustar la foto que ya estaba puesta"
  // (para saber qué limpiar si se cancela o se confirma).
  const [ajustarAbierto, setAjustarAbierto] = useState(false);
  const [ajusteUri, setAjusteUri] = useState<string | null>(null);
  const [ajusteEsNuevo, setAjusteEsNuevo] = useState(false);

  // ¿El servidor puede quitar fondos? Se consulta al abrir, para no ofrecer
  // un botón que va a fallar.
  useEffect(() => {
    let vivo = true;
    recorteDisponible().then((v) => { if (vivo) setHayRecorte(v); });
    return () => { vivo = false; };
  }, []);

  /** El escáner rellena el campo de código. Si el nombre está vacío o es
   *  una sugerencia sin confirmar (de OTRO código), intentamos el nombre
   *  universal. Con try/catch: si la consulta falla, se avisa en vez de
   *  quedarse a medias en silencio (y sin trabar la búsqueda de la foto). */
  async function alEscanearCodigo(c: string) {
    setCodigo(c);
    setAvisoEscaner("");

    if (!nombre.trim() || nombreEsSugerido) {
      setBuscandoNombre(true);
      try {
        const sugerido = await consultarNombreUniversal(c);
        if (sugerido) {
          setNombre(sugerido);
          setNombreEsSugerido(true);
          setAvisoEscaner("Sugerimos el nombre desde el catálogo universal; revísalo antes de guardar.");
        } else {
          // El nombre que había era de OTRO código: ya no aplica aquí.
          if (nombreEsSugerido) setNombre("");
          setNombreEsSugerido(false);
          setAvisoEscaner("No encontramos el nombre de este código; escríbelo tú.");
        }
      } catch {
        setAvisoEscaner("No se pudo consultar el catálogo universal; escríbelo tú.");
      } finally {
        setBuscandoNombre(false);
      }
    }

    // Foto (igual que antes): solo si aún no hay una foto propia.
    if (!imagenUri) {
      setBuscandoFoto(true);
      try {
        const ficha = await consultarFichaUniversal(c);
        if (ficha.imagenUrl) setFotoSugerida(ficha.imagenUrl);
      } catch {
        // Silencioso: la foto es un plus, no debe bloquear el alta.
      } finally {
        setBuscandoFoto(false);
      }
    }
  }

  // --- Kit: componentes ---
  const [componentes, setComponentes] = useState<CompLocal[]>([]);
  const [buscaComp, setBuscaComp] = useState("");
  const [resultadosComp, setResultadosComp] = useState<Producto[]>([]);

  // Cargar componentes si editamos un kit existente.
  useEffect(() => {
    if (producto?.es_kit === 1) {
      componentesDeKit(producto.id).then((lista: ComponenteKit[]) =>
        setComponentes(
          lista.map((c) => ({
            producto_id: c.producto_id,
            nombre: c.nombre,
            cantidad: String(c.cantidad),
            costo_centavos: c.costo_centavos,
            stock: c.stock,
          }))
        )
      );
    }
  }, [producto]);

  // Búsqueda de candidatos a componente.
  useEffect(() => {
    let vivo = true;
    if (!esKit || !buscaComp.trim()) {
      setResultadosComp([]);
      return;
    }
    candidatosComponente(buscaComp).then((r) => {
      if (vivo) setResultadosComp(r.filter((p) => p.id !== producto?.id));
    });
    return () => {
      vivo = false;
    };
  }, [buscaComp, esKit, producto]);

  // Costo del kit = suma de componentes (como el PC).
  const costoKit = useMemo(() => {
    return componentes.reduce((s, c) => {
      const cant = aNumero(c.cantidad);
      return s + (c.costo_centavos ?? 0) * cant;
    }, 0);
  }, [componentes]);

  const precioC = aCentavos(precio);
  const costoC = esKit ? Math.round(costoKit) : costo.trim() ? aCentavos(costo) : null;
  const margen =
    costoC != null && precioC > 0
      ? Math.round(((precioC - costoC) * 100) / precioC)
      : null;

  function agregarComponente(p: Producto) {
    if (componentes.some((c) => c.producto_id === p.id)) return;
    setComponentes((prev) => [
      ...prev,
      { producto_id: p.id, nombre: p.nombre, cantidad: "1", costo_centavos: p.costo_centavos, stock: p.stock },
    ]);
    setBuscaComp("");
    setResultadosComp([]);
  }

  function cambiarCantidad(id: string, texto: string) {
    setComponentes((prev) =>
      prev.map((c) => (c.producto_id === id ? { ...c, cantidad: texto } : c))
    );
  }

  function quitarComponente(id: string) {
    setComponentes((prev) => prev.filter((c) => c.producto_id !== id));
  }

  async function cambiarFoto(desde: "camara" | "galeria") {
    setError("");
    try {
      const tmp = await elegirImagen(desde);
      if (!tmp) return; // canceló
      // Ya no se persiste directo: primero pasa por el recortador, para
      // que el tendero encuadre a su gusto (el picker ya no recorta solo).
      setAjusteUri(tmp);
      setAjusteEsNuevo(true);
      setFotoEsSugerida(false);
      setAvisoFotoVisible(false);
      setAjustarAbierto(true);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function quitarFoto() {
    await borrarImagen(imagenUri);
    setImagenUri(null);
    setFotoEsSugerida(false);
    setAvisoFotoVisible(false);
  }

  /** Abre el recortador para reencuadrar la foto que YA está puesta.
   *  Usa la foto COMPLETA original si se conserva (así se puede alejar y
   *  recuperar lo que quedó fuera del recorte anterior); si no existe
   *  —fotos guardadas antes de esta versión— cae al recorte, que es lo
   *  único disponible. */
  async function abrirAjustarActual() {
    if (!imagenUri) return;
    const original = await originalDe(imagenUri);
    setAjusteUri(original ?? imagenUri);
    setAjusteEsNuevo(false);
    setAjustarAbierto(true);
  }

  function cancelarAjuste() {
    // Si era una foto nueva sin usar todavía (recién elegida/descargada),
    // se borra para no dejar huérfanos; si era la que ya estaba puesta (o
    // su original conservada), no se toca.
    if (ajusteEsNuevo && ajusteUri) void borrarImagen(ajusteUri);
    setAjustarAbierto(false);
    setAjusteUri(null);
  }

  async function alConfirmarRecorte(uriRecortada: string, uriOriginal: string) {
    setError("");
    try {
      // Se guardan EMPAREJADAS: el recorte (lo que se ve en el producto) y
      // la foto completa de la que salió, para poder reajustar el encuadre
      // más adelante sin haber perdido lo que quedó fuera.
      const final = await persistirRecorteConOriginal(uriRecortada, uriOriginal);
      await borrarImagen(imagenUri); // la foto anterior y su original, si eran nuestras
      if (ajusteEsNuevo && ajusteUri) await borrarImagen(ajusteUri); // el temporal sin recortar
      setImagenUri(final);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setAjustarAbierto(false);
      setAjusteUri(null);
    }
  }

  /** Descarga la foto que ofreció el catálogo universal y abre el
   *  recortador (nunca viene recortada de OFF: aquí es donde el tendero
   *  decide el encuadre, con toda la foto disponible). */
  async function usarFotoSugerida() {
    if (!fotoSugerida) return;
    setError("");
    setBuscandoFoto(true);
    try {
      const local = await descargarImagen(fotoSugerida);
      setFotoSugerida(null);
      setAjusteUri(local);
      setAjusteEsNuevo(true);
      setFotoEsSugerida(true);
      setAvisoFotoVisible(true);
      setAjustarAbierto(true);
    } catch (e: any) {
      setError("No se pudo descargar la foto. Toma una tú.");
    } finally {
      setBuscandoFoto(false);
    }
  }

  /** Vista grande de la foto (mantener pulsada). No-op sin foto. */
  function abrirLightbox() {
    if (!imagenUri) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setLightboxAbierto(true);
  }

  /** Cierra el lightbox y luego ejecuta la acción (cámara/galería/recorte),
   *  para que el resultado y sus mensajes se vean en el formulario normal. */
  function accionDesdeLightbox(fn: () => void) {
    setLightboxAbierto(false);
    fn();
  }

  /** Quita el fondo de la foto actual, sea del catálogo o propia. */
  async function recortarFondo() {
    if (!imagenUri) return;
    setError("");
    setRecortando(true);
    const r = await quitarFondo(imagenUri);
    setRecortando(false);
    if (r.ok) {
      // La anterior se borra SOLO después de que el recorte salió bien.
      const anterior = imagenUri;
      setImagenUri(r.uri);
      await borrarImagen(anterior);
    } else {
      setError(r.motivo);
    }
  }

  async function guardar() {
    setError("");
    const datos: DatosProducto = {
      id: producto?.id,
      nombre,
      codigo_barras: codigo.trim() || null,
      categoria_id: categoriaId,
      precio_venta_centavos: precioC,
      costo_centavos: costoC,
      precio_mayoreo_centavos: mayoreo.trim() ? aCentavos(mayoreo) : null,
      controla_stock: controlaStock,
      stock: aNumero(stock),
      stock_minimo: aNumero(stockMin),
      unidad,
      es_kit: esKit,
      favorito,
      imagen_uri: imagenUri,
      componentes: componentes.map((c) => ({
        producto_id: c.producto_id,
        cantidad: aNumero(c.cantidad),
      })),
    };
    setGuardando(true);
    try {
      if (esEdicion) await editarProducto(datos);
      else await crearProducto(datos);
      onGuardado();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setGuardando(false);
    }
  }

  function confirmarBorrado() {
    if (!producto) return;
    Alert.alert(
      "Eliminar producto",
      `¿Eliminar "${producto.nombre}"? No aparecerá más en el inventario.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            setGuardando(true);
            try {
              await eliminarProducto(producto.id);
              onGuardado();
            } catch (e: any) {
              setError(e?.message ?? String(e));
              setGuardando(false);
            }
          },
        },
      ]
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={est.raiz}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <CabeceraModal
            titulo={esEdicion ? "Editar producto" : "Nuevo producto"}
            onIzquierda={onCerrar}
            derecha="Guardar"
            onDerecha={guardar}
            derechaCargando={guardando}
          />

          <ScrollView contentContainerStyle={est.cuerpo} keyboardShouldPersistTaps="handled">
            <Banner texto={error} tipo="error" />

            {/* Foto del producto — mantener pulsada para verla en grande */}
            <View style={est.fotoZona}>
              <Pressable onLongPress={abrirLightbox} delayLongPress={280}>
                <ImagenProducto
                  uri={imagenUri}
                  nombre={nombre || "?"}
                  color={categorias.find((c) => c.id === categoriaId)?.color}
                  icono={categorias.find((c) => c.id === categoriaId)?.icono}
                  size={104}
                  radio={18}
                />
              </Pressable>
              <View style={est.fotoBotones}>
                <Pressable style={est.fotoBtn} onPress={() => cambiarFoto("camara")}>
                  <IconoUI id="camara" size={16} color={T.textoSuave} />
                  <Text style={est.fotoBtnTxt}>Cámara</Text>
                </Pressable>
                <Pressable style={est.fotoBtn} onPress={() => cambiarFoto("galeria")}>
                  <IconoUI id="imagen" size={16} color={T.textoSuave} />
                  <Text style={est.fotoBtnTxt}>Galería</Text>
                </Pressable>
                {imagenUri && (
                  <Pressable style={est.fotoBtn} onPress={quitarFoto}>
                    <Text style={[est.fotoBtnTxt, { color: T.peligro }]}>Quitar</Text>
                  </Pressable>
                )}
              </View>
            </View>

            {/* ¿Cómo se vende? — mismo criterio que el PC */}
            <View style={est.tipoFila}>
              <Segmento
                opciones={[
                  { id: "pieza", label: "Pieza" },
                  { id: "granel", label: "A granel" },
                  { id: "kit", label: "Paquete" },
                ]}
                valor={modoVenta}
                onCambio={(v) => setModoVenta(v as ModoVenta)}
              />
              <Text style={est.modoVentaTip}>
                {modoVenta === "pieza"
                  ? "Se vende por piezas enteras: refrescos, cigarros, dulces."
                  : modoVenta === "granel"
                  ? "Se vende por peso o volumen con decimales, usando báscula: fruta, verdura, carnes."
                  : "Un paquete que agrupa otros productos y descuenta sus componentes del inventario al venderse."}
              </Text>
              {modoVenta === "granel" && (
                <View style={{ marginTop: 10 }}>
                  <Campo label="Unidad de granel">
                    <View style={est.chips}>
                      <Chip
                        activo={unidadGranel === "kg"}
                        label="Kilogramo"
                        onPress={() => setUnidadGranel("kg")}
                      />
                      <Chip
                        activo={unidadGranel === "litro"}
                        label="Litro"
                        onPress={() => setUnidadGranel("litro")}
                      />
                    </View>
                  </Campo>
                </View>
              )}
            </View>

            {/* Foto que ofrece el catálogo abierto */}
            {fotoSugerida && !imagenUri && (
              <Pressable style={est.sugerenciaFoto} onPress={usarFotoSugerida} disabled={buscandoFoto}>
                <Text style={est.sugerenciaFotoTxt}>
                  {buscandoFoto ? "Descargando…" : "Encontramos una foto de este producto — tócala para usarla"}
                </Text>
              </Pressable>
            )}

            {/* Aviso de calidad: la foto viene de un catálogo abierto, cerrable */}
            {avisoFotoVisible && imagenUri && (
              <View style={est.avisoFoto}>
                <Text style={est.avisoFotoTxt}>
                  Esta foto viene de un catálogo abierto — la calidad varía
                  según quién la subió. Si no se ve bien, tómala tú o usa
                  "Quitar fondo".
                </Text>
                <Pressable
                  onPress={() => setAvisoFotoVisible(false)}
                  hitSlop={10}
                  style={est.avisoFotoCerrar}
                >
                  <Text style={est.avisoFotoCerrarTxt}>✕</Text>
                </Pressable>
              </View>
            )}

            {/* Quitar fondo: sirve para la foto del catálogo y para la propia */}
            {imagenUri && hayRecorte && (
              <Pressable style={est.fotoBtn} onPress={recortarFondo} disabled={recortando}>
                <IconoUI id="imagen" size={16} color={T.textoSuave} />
                <Text style={est.fotoBtnTxt}>{recortando ? "Quitando fondo…" : "Quitar fondo"}</Text>
              </Pressable>
            )}

            <Campo label="Nombre">
              <TextInput
                style={estiloInput}
                value={nombre}
                onChangeText={(t) => {
                  setNombre(t);
                  // Ya es texto del tendero: un re-escaneo no lo debe pisar.
                  setNombreEsSugerido(false);
                }}
                placeholder={esKit ? "Ej. Six Corona 355ml" : "Ej. Coca-Cola 600ml"}
                placeholderTextColor={T.textoTenue}
              />
            </Campo>

            <Campo label="Código de barras · opcional">
              <View style={est.codigoFila}>
                <TextInput
                  style={[estiloInput, { flex: 1 }]}
                  value={codigo}
                  onChangeText={setCodigo}
                  placeholder="Escanea o escribe"
                  placeholderTextColor={T.textoTenue}
                  autoCapitalize="characters"
                />
                <Pressable
                  style={est.scanBtn}
                  onPress={() => {
                    setAvisoEscaner("");
                    setEscanerAbierto(true);
                  }}
                  hitSlop={6}
                >
                  <IconoUI id="escaner" size={19} color={T.acento} grosor={1.8} />
                </Pressable>
              </View>
              {(buscandoNombre || avisoEscaner) && (
                <Text style={est.avisoEscaner}>
                  {buscandoNombre ? "Buscando el nombre del producto…" : avisoEscaner}
                </Text>
              )}
            </Campo>

            <Campo label="Departamento">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
                <View style={est.chips}>
                  <Chip activo={categoriaId === null} label="Sin depto." onPress={() => setCategoriaId(null)} />
                  {categorias.map((c) => (
                    <Chip
                      key={c.id}
                      activo={categoriaId === c.id}
                      label={c.nombre}
                      color={c.color ?? undefined}
                      onPress={() => setCategoriaId(c.id)}
                    />
                  ))}
                </View>
              </ScrollView>
            </Campo>

            <View style={est.switchFila}>
              <View style={{ flex: 1 }}>
                <Text style={est.switchLbl}>Favorito ★</Text>
                <Text style={est.switchAyuda}>
                  Aparece primero en la cuadrícula rápida de Vender.
                </Text>
              </View>
              <Switch
                value={favorito}
                onValueChange={setFavorito}
                trackColor={{ true: T.acento, false: T.borde }}
                thumbColor="#fff"
              />
            </View>

            {/* ---------- MODO KIT: armador de componentes ---------- */}
            {esKit && (
              <View style={est.kitCaja}>
                <Text style={est.kitTitulo}>Componentes del kit</Text>
                <Text style={est.kitAyuda}>
                  Al vender el kit se descuenta el stock de cada componente.
                </Text>

                {componentes.map((c) => (
                  <View key={c.producto_id} style={est.compFila}>
                    <View style={{ flex: 1 }}>
                      <Text style={est.compNombre} numberOfLines={1}>{c.nombre}</Text>
                      <Text style={est.compMeta}>
                        stock: {fmtStock(c.stock, "")} · costo {pesos(c.costo_centavos ?? 0)}
                      </Text>
                    </View>
                    <TextInput
                      style={est.compCant}
                      value={c.cantidad}
                      onChangeText={(t) => cambiarCantidad(c.producto_id, t)}
                      keyboardType="decimal-pad"
                    />
                    <Pressable onPress={() => quitarComponente(c.producto_id)} hitSlop={10}>
                      <Text style={est.compQuitar}>✕</Text>
                    </Pressable>
                  </View>
                ))}

                <TextInput
                  style={[estiloInput, { marginTop: 8 }]}
                  value={buscaComp}
                  onChangeText={setBuscaComp}
                  placeholder="Buscar producto para añadir…"
                  placeholderTextColor={T.textoTenue}
                />
                {resultadosComp.map((p) => (
                  <Pressable key={p.id} style={est.compResultado} onPress={() => agregarComponente(p)}>
                    <Text style={est.compResNombre}>{p.nombre}</Text>
                    <Text style={est.compResMeta}>
                      {pesos(p.precio_venta_centavos)} · stock {fmtStock(p.stock, p.unidad)}
                    </Text>
                  </Pressable>
                ))}

                {componentes.length > 0 && (
                  <Text style={est.kitCosto}>
                    Costo del kit (suma de componentes):{" "}
                    <Text style={{ color: T.turquesa, fontWeight: "800" }}>{pesos(Math.round(costoKit))}</Text>
                  </Text>
                )}
              </View>
            )}

            {/* Precios */}
            <View style={est.fila}>
              <Campo label="Precio venta" flex>
                <TextInput
                  style={estiloInput}
                  value={precio}
                  onChangeText={setPrecio}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={T.textoTenue}
                />
              </Campo>
              {!esKit && (
                <Campo label="Costo" flex>
                  <TextInput
                    style={estiloInput}
                    value={costo}
                    onChangeText={setCosto}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={T.textoTenue}
                  />
                </Campo>
              )}
            </View>

            {margen != null && (
              <View style={est.margenCaja}>
                <Text style={est.margenLbl}>Margen</Text>
                <Text style={[est.margenVal, { color: margen < 0 ? T.peligro : T.turquesa }]}>
                  {margen}%
                </Text>
                {margen < 0 && <Text style={est.margenAviso}>Estás vendiendo bajo costo</Text>}
              </View>
            )}

            <Campo label="Precio mayoreo · opcional">
              <TextInput
                style={estiloInput}
                value={mayoreo}
                onChangeText={setMayoreo}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={T.textoTenue}
              />
            </Campo>

            {/* Stock (solo producto normal) */}
            {!esKit && (
              <>
                <View style={est.switchFila}>
                  <View style={{ flex: 1 }}>
                    <Text style={est.switchLbl}>Controlar stock</Text>
                    <Text style={est.switchAyuda}>
                      Apágalo para servicios o venta sin inventario.
                    </Text>
                  </View>
                  <Switch
                    value={controlaStock}
                    onValueChange={setControlaStock}
                    trackColor={{ true: T.acento, false: T.borde }}
                    thumbColor="#fff"
                  />
                </View>

                {controlaStock && (
                  <View style={est.fila}>
                    <Campo label="Stock actual" flex>
                      <TextInput
                        style={estiloInput}
                        value={stock}
                        onChangeText={setStock}
                        keyboardType="decimal-pad"
                        placeholderTextColor={T.textoTenue}
                      />
                    </Campo>
                    <Campo label="Stock mínimo" flex>
                      <TextInput
                        style={estiloInput}
                        value={stockMin}
                        onChangeText={setStockMin}
                        keyboardType="decimal-pad"
                        placeholderTextColor={T.textoTenue}
                      />
                    </Campo>
                  </View>
                )}
              </>
            )}

            {esEdicion && (
              <View style={{ marginTop: 12 }}>
                <Boton titulo="Eliminar producto" tipo="peligro" onPress={confirmarBorrado} />
              </View>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Escáner de código de barras (modo único: rellena el campo y cierra) */}
        {escanerAbierto && (
          <EscanerCamara
            modo="unico"
            onCodigo={(c) => void alEscanearCodigo(c)}
            onCerrar={() => setEscanerAbierto(false)}
          />
        )}

        {/* Vista grande de la foto (mantener pulsada): el formulario queda
            difuminado detrás. Desde aquí también se puede cambiar o
            recortar el fondo sin tener que cerrarla primero.
            NOTA: es un overlay absoluto, no un <Modal> anidado — un Modal
            dentro de otro Modal no siempre cubre toda la pantalla. */}
        {lightboxAbierto && imagenUri && (
          <View style={est.lightboxOverlayRoot}>
            <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
            <View style={[StyleSheet.absoluteFill, est.lightboxOscurecer]} />
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setLightboxAbierto(false)}
            />
            <View style={est.lightboxImagenWrap} pointerEvents="box-none">
              <Image
                source={{ uri: imagenUri }}
                style={est.lightboxImagen}
                resizeMode="contain"
              />
            </View>
            <View style={est.lightboxAcciones}>
              <Pressable
                style={est.lightboxBtn}
                onPress={() => accionDesdeLightbox(() => void abrirAjustarActual())}
              >
                <IconoUI id="imagen" size={17} color="#fff" />
                <Text style={est.lightboxBtnTxt}>Ajustar</Text>
              </Pressable>
              <Pressable
                style={est.lightboxBtn}
                onPress={() => accionDesdeLightbox(() => cambiarFoto("camara"))}
              >
                <IconoUI id="camara" size={17} color="#fff" />
                <Text style={est.lightboxBtnTxt}>Cámara</Text>
              </Pressable>
              <Pressable
                style={est.lightboxBtn}
                onPress={() => accionDesdeLightbox(() => cambiarFoto("galeria"))}
              >
                <IconoUI id="imagen" size={17} color="#fff" />
                <Text style={est.lightboxBtnTxt}>Galería</Text>
              </Pressable>
              {hayRecorte && (
                <Pressable
                  style={est.lightboxBtn}
                  onPress={() => accionDesdeLightbox(() => void recortarFondo())}
                >
                  <IconoUI id="imagen" size={17} color="#fff" />
                  <Text style={est.lightboxBtnTxt}>Quitar fondo</Text>
                </Pressable>
              )}
            </View>
            <Pressable
              style={est.lightboxCerrar}
              onPress={() => setLightboxAbierto(false)}
              hitSlop={10}
            >
              <Text style={est.lightboxCerrarTxt}>✕</Text>
            </Pressable>
          </View>
        )}

        {/* Recortador con pellizco/arrastre: mismo patrón de overlay
            absoluto que el lightbox (no un <Modal> anidado). */}
        {ajustarAbierto && ajusteUri && (
          <View style={est.lightboxOverlayRoot}>
            <RecortadorFoto
              uri={ajusteUri}
              onCancelar={cancelarAjuste}
              onListo={(u, orig) => void alConfirmarRecorte(u, orig)}
            />
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// --- Piezas locales ---

function Segmento({
  opciones,
  valor,
  onCambio,
}: {
  opciones: { id: string; label: string }[];
  valor: string;
  onCambio: (v: string) => void;
}) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  return (
    <View style={est.segmento}>
      {opciones.map((o) => (
        <Pressable
          key={o.id}
          onPress={() => onCambio(o.id)}
          style={[est.segBtn, valor === o.id && est.segActivo]}
        >
          <Text style={[est.segTxt, valor === o.id && est.segTxtActivo]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Chip({
  label,
  activo,
  color,
  onPress,
}: {
  label: string;
  activo: boolean;
  color?: string;
  onPress: () => void;
}) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  return (
    <Pressable
      onPress={onPress}
      style={[
        est.chip,
        activo && { backgroundColor: color ?? T.acento, borderColor: color ?? T.acento },
      ]}
    >
      <Text style={[est.chipTxt, activo && { color: color ? "#fff" : T.acentoTexto, fontWeight: "700" }]}>{label}</Text>
    </Pressable>
  );
}

function crearEstilos(T: Tema) {
  return StyleSheet.create({
    raiz: { flex: 1, backgroundColor: T.fondo },
    cuerpo: { padding: T.esp, paddingBottom: 60 },
    fila: { flexDirection: "row", gap: 12 },
    tipoFila: { marginBottom: 18 },
    segmento: {
      flexDirection: "row",
      backgroundColor: T.superficie,
      borderRadius: T.radioChico + 2,
      borderWidth: 1,
      borderColor: T.borde,
      padding: 4,
    },
    segBtn: { flex: 1, paddingVertical: 10, borderRadius: T.radioChico - 2, alignItems: "center" },
    segActivo: { backgroundColor: T.acento },
    segTxt: { color: T.textoSuave, fontSize: 14, fontWeight: "600" },
    segTxtActivo: { color: T.acentoTexto, fontWeight: "800" },
    chips: { flexDirection: "row", gap: 8, paddingVertical: 2 },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: T.borde,
      backgroundColor: T.superficie2,
    },
    chipTxt: { color: T.textoSuave, fontSize: 14 },
    switchFila: { flexDirection: "row", alignItems: "center", marginBottom: 18, gap: 12 },
    switchLbl: { color: T.texto, fontSize: 15, fontWeight: "700" },
    switchAyuda: { color: T.textoTenue, fontSize: 12, marginTop: 2, paddingRight: 12 },
    margenCaja: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: T.superficie,
      borderRadius: T.radioChico,
      borderWidth: 1,
      borderColor: T.borde,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginTop: -6,
      marginBottom: 16,
    },
    margenLbl: { color: T.textoSuave, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
    margenVal: { fontSize: 18, fontWeight: "800" },
    margenAviso: { color: T.peligro, fontSize: 12, flex: 1, textAlign: "right" },
    kitCaja: {
      backgroundColor: T.superficie,
      borderRadius: T.radio,
      borderWidth: 1,
      borderColor: T.bordeFuerte,
      padding: 14,
      marginBottom: 18,
    },
    kitTitulo: { color: T.texto, fontSize: 15, fontWeight: "800" },
    kitAyuda: { color: T.textoTenue, fontSize: 12, marginTop: 3, marginBottom: 10 },
    compFila: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 9,
      borderBottomWidth: 1,
      borderBottomColor: T.borde,
    },
    compNombre: { color: T.texto, fontSize: 14, fontWeight: "600" },
    compMeta: { color: T.textoTenue, fontSize: 11, marginTop: 1 },
    compCant: {
      backgroundColor: T.superficie2,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: T.borde,
      color: T.texto,
      width: 62,
      textAlign: "center",
      paddingVertical: 7,
      fontSize: 15,
    },
    compQuitar: { color: T.peligro, fontSize: 16, fontWeight: "800", paddingHorizontal: 4 },
    compResultado: {
      backgroundColor: T.superficie2,
      borderRadius: T.radioChico,
      borderWidth: 1,
      borderColor: T.borde,
      padding: 11,
      marginTop: 6,
    },
    compResNombre: { color: T.texto, fontSize: 14, fontWeight: "600" },
    compResMeta: { color: T.textoTenue, fontSize: 12, marginTop: 1 },
    kitCosto: { color: T.textoSuave, fontSize: 13, marginTop: 12 },
    fotoZona: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 20 },
    fotoBotones: { flex: 1, gap: 8 },
    fotoBtn: {
      flexDirection: "row",
      gap: 7,
      backgroundColor: T.superficie2,
      borderWidth: 1,
      borderColor: T.bordeFuerte,
      borderRadius: T.radioChico,
      paddingVertical: 9,
      alignItems: "center",
      justifyContent: "center",
    },
    fotoBtnTxt: { color: T.textoSuave, fontSize: 13, fontWeight: "700" },
    codigoFila: { flexDirection: "row", alignItems: "center", gap: 9 },
    scanBtn: {
      width: 46,
      height: 46,
      borderRadius: T.radioChico + 2,
      borderWidth: 1,
      borderColor: T.bordeFuerte,
      backgroundColor: T.superficie2,
      alignItems: "center",
      justifyContent: "center",
    },
    avisoEscaner: { color: T.textoTenue, fontSize: 12, marginTop: 6, lineHeight: 17 },
    
    // Nuevos estilos para la foto sugerida y quitar fondo
    sugerenciaFoto: {
      marginTop: 10,
      padding: 11,
      borderRadius: T.radio,
      backgroundColor: T.acento + "14",
      borderWidth: 1,
      borderColor: T.acento + "55",
    },
    sugerenciaFotoTxt: {
      color: T.acento,
      fontSize: 12.5,
      fontWeight: "600",
      textAlign: "center",
    },

    // "¿Cómo se vende?" — texto de ayuda bajo el selector.
    modoVentaTip: {
      color: T.textoTenue,
      fontSize: 12,
      marginTop: 8,
      lineHeight: 17,
    },

    // Aviso de calidad de la foto del catálogo abierto (cerrable, discreto).
    avisoFoto: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 10,
      padding: 11,
      borderRadius: T.radio,
      backgroundColor: T.superficie2,
      borderWidth: 1,
      borderColor: T.borde,
    },
    avisoFotoTxt: {
      flex: 1,
      color: T.textoSuave,
      fontSize: 12,
      lineHeight: 17,
    },
    avisoFotoCerrar: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    avisoFotoCerrarTxt: { color: T.textoTenue, fontSize: 14, fontWeight: "700" },

    // Lightbox de la foto (mantener pulsada): overlay absoluto de pantalla
    // completa (NO un <Modal> anidado — ver nota en el JSX) con BlurView
    // real detrás + un oscurecido sutil encima para contraste de texto.
    lightboxOverlayRoot: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 50,
      elevation: 50,
    },
    lightboxOscurecer: { backgroundColor: "#00000026" },
    lightboxImagenWrap: {
      width: "86%",
      height: "58%",
    },
    lightboxImagen: { width: "100%", height: "100%" },
    lightboxAcciones: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: 10,
      marginTop: 26,
      paddingHorizontal: 20,
    },
    lightboxBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      backgroundColor: "#ffffff26",
      borderWidth: 1,
      borderColor: "#ffffff44",
      borderRadius: T.radioChico + 2,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    lightboxBtnTxt: { color: "#fff", fontSize: 13, fontWeight: "700" },
    lightboxCerrar: {
      position: "absolute",
      top: 54,
      right: 22,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: "#ffffff26",
      alignItems: "center",
      justifyContent: "center",
    },
    lightboxCerrarTxt: { color: "#fff", fontSize: 16, fontWeight: "800" },
  });
}