// YvexPOS Móvil — Formulario de producto (crear/editar).
//
// Modo Kit (paquete): selector Producto/Kit; en modo kit hay un armador de
// componentes (buscar producto -> añadir con cantidad), el costo se calcula
// de los componentes (como el PC), y el kit no maneja stock propio.
//
// ---------------------------------------------------------------------------
// QUÉ CAMBIÓ EN ESTA MIGRACIÓN
// ---------------------------------------------------------------------------
// 1. "Guardar" pasó de la esquina del header a un botón fijo en el pie,
//    en la zona del pulgar. <Hoja> no expone un slot de acción en su
//    cabecera (solo "Cerrar"); en vez de romper esa cáscara para este
//    archivo, se usa el mismo patrón que ya tienen ModalMovimientoCaja y
//    las sub-hojas de Ajustes — un botón fijo abajo. Es además más fácil
//    de alcanzar con el pulgar que una esquina superior.
// 2. Alert.alert (confirmar borrado) -> una <Hoja> chica anidada, igual que
//    en ModalDepartamentos. Mismo motivo: el diálogo nativo rompe la
//    identidad de la app justo en el momento de una decisión importante.
// 3. T.turquesa (costo del kit, margen positivo) -> T.exito. Son cifras
//    buenas —el margen no está en rojo—, les toca el verde de la marca, no
//    un segundo acento que nadie eligió.
// 4. `Insignia` estaba importada desde antes de esta migración pero nunca
//    se usó en ningún lado del archivo — import muerto, se quitó.
//
// El picker de foto (cámara/galería/recorte/lightbox) y el recortador con
// gestos se conservan como overlays absolutos, NO como <Modal> anidados —
// la razón ya estaba documentada en el original y sigue siendo válida: un
// Modal dentro de otro Modal no siempre cubre toda la pantalla en RN.

import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  StyleSheet,
  Switch,
  Image,
} from "react-native";
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
import { IconoUI, IdUI } from "@/src/componentes/iconos";
import { Boton, Banner, Campo, Hoja, Txt, Monto, useEstiloInput } from "@/src/componentes/ui";
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

/** "¿Cómo se vende?" — mismo criterio que el PC (src/vistas/inventario.js):
 *  pieza = piezas enteras · granel = peso/volumen con báscula (kg o litro,
 *  con decimales) · kit = paquete que agrupa otros productos. */
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
  const { tema: T, prefs } = useTema();
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
  // Confirmación de borrado sin Alert nativo — igual que en ModalDepartamentos.
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);

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
      setAvisoFotoVisible(false);
      setAjustarAbierto(true);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function quitarFoto() {
    await borrarImagen(imagenUri);
    setImagenUri(null);
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
      setAvisoFotoVisible(true);
      setAjustarAbierto(true);
    } catch {
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

  async function confirmarBorrado() {
    if (!producto) return;
    setGuardando(true);
    try {
      await eliminarProducto(producto.id);
      onGuardado();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setGuardando(false);
      setConfirmandoBorrado(false);
    }
  }

  return (
    <Hoja
      visible
      onCerrar={guardando ? () => {} : onCerrar}
      titulo={esEdicion ? "Editar producto" : "Nuevo producto"}
      tipo="completa"
      pie={
        <Boton
          titulo={esEdicion ? "Guardar cambios" : "Crear producto"}
          onPress={guardar}
          cargando={guardando}
        />
      }
    >
      <Banner texto={error} tipo="error" />

      {/* Foto del producto — mantener pulsada para verla en grande */}
      <View style={{ alignItems: "center", marginBottom: T.esps.xl }}>
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
        <View style={{ flexDirection: "row", gap: T.esps.lg, marginTop: T.esps.md }}>
          <BotonFoto icono="camara" label="Cámara" onPress={() => cambiarFoto("camara")} />
          <BotonFoto icono="imagen" label="Galería" onPress={() => cambiarFoto("galeria")} />
          {imagenUri ? (
            <Pressable onPress={quitarFoto} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Txt escala="pie" tono="peligro" fuerte>
                Quitar
              </Txt>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* ¿Cómo se vende? — mismo criterio que el PC */}
      <View style={{ marginBottom: T.esps.lg }}>
        <Segmentado
          opciones={[
            { id: "pieza", label: "Pieza" },
            { id: "granel", label: "A granel" },
            { id: "kit", label: "Paquete" },
          ]}
          valor={modoVenta}
          onCambio={(v) => setModoVenta(v as ModoVenta)}
        />
        <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.sm }}>
          {modoVenta === "pieza"
            ? "Se vende por piezas enteras: refrescos, cigarros, dulces."
            : modoVenta === "granel"
            ? "Se vende por peso o volumen con decimales, usando báscula: fruta, verdura, carnes."
            : "Un paquete que agrupa otros productos y descuenta sus componentes del inventario al venderse."}
        </Txt>
        {modoVenta === "granel" && (
          <View style={{ marginTop: T.esps.md }}>
            <Campo label="Unidad de granel">
              <View style={{ flexDirection: "row", gap: T.esps.sm }}>
                <Chip activo={unidadGranel === "kg"} label="Kilogramo" onPress={() => setUnidadGranel("kg")} />
                <Chip activo={unidadGranel === "litro"} label="Litro" onPress={() => setUnidadGranel("litro")} />
              </View>
            </Campo>
          </View>
        )}
      </View>

      {/* Foto que ofrece el catálogo abierto */}
      {fotoSugerida && !imagenUri && (
        <Pressable
          onPress={usarFotoSugerida}
          disabled={buscandoFoto}
          style={{
            backgroundColor: T.acentoSuave,
            borderWidth: 1,
            borderColor: T.acento,
            borderRadius: T.radio,
            padding: T.esps.md,
            marginBottom: T.esps.lg,
          }}
        >
          <Txt escala="pie" tono="acento" fuerte estilo={{ textAlign: "center" }}>
            {buscandoFoto ? "Descargando…" : "Encontramos una foto de este producto — tócala para usarla"}
          </Txt>
        </Pressable>
      )}

      {/* Aviso de calidad: la foto viene de un catálogo abierto, cerrable */}
      {avisoFotoVisible && imagenUri && (
        <View
          style={{
            flexDirection: "row",
            gap: T.esps.md,
            backgroundColor: T.alertaSuave,
            borderRadius: T.radio,
            padding: T.esps.md,
            marginBottom: T.esps.lg,
          }}
        >
          <Txt escala="pie" tono="alerta" estilo={{ flex: 1 }}>
            Esta foto viene de un catálogo abierto — la calidad varía según
            quién la subió. Si no se ve bien, tómala tú o usa "Quitar fondo".
          </Txt>
          <Pressable onPress={() => setAvisoFotoVisible(false)} hitSlop={10}>
            <Txt escala="pie" tono="alerta" fuerte>
              ✕
            </Txt>
          </Pressable>
        </View>
      )}

      {/* Quitar fondo: sirve para la foto del catálogo y para la propia */}
      {imagenUri && hayRecorte && (
        <Pressable
          onPress={recortarFondo}
          disabled={recortando}
          style={{ flexDirection: "row", alignItems: "center", gap: T.esps.sm, marginBottom: T.esps.lg }}
        >
          <IconoUI id="imagen" size={16} color={T.textoSuave} />
          <Txt escala="pie" tono="suave">
            {recortando ? "Quitando fondo…" : "Quitar fondo"}
          </Txt>
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
          autoCorrect={false}
          placeholder={esKit ? "Ej. Six Corona 355ml" : "Ej. Coca-Cola 600ml"}
          placeholderTextColor={T.textoTenue}
        />
      </Campo>

      <Campo label="Código de barras · opcional">
        <View style={{ flexDirection: "row", gap: T.esps.sm }}>
          <TextInput
            style={[estiloInput, { flex: 1 }]}
            value={codigo}
            onChangeText={setCodigo}
            placeholder="Escanea o escribe"
            placeholderTextColor={T.textoTenue}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <Pressable
            onPress={() => {
              setAvisoEscaner("");
              setEscanerAbierto(true);
            }}
            hitSlop={6}
            style={{
              width: 48,
              height: 48,
              borderRadius: T.radioChico,
              backgroundColor: T.superficie2,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconoUI id="escaner" size={19} color={T.acento} grosor={1.8} />
          </Pressable>
        </View>
        {(buscandoNombre || avisoEscaner) && (
          <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.xs }}>
            {buscandoNombre ? "Buscando el nombre del producto…" : avisoEscaner}
          </Txt>
        )}
      </Campo>

      <Campo label="Departamento">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
          <View style={{ flexDirection: "row", gap: T.esps.sm }}>
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

      <FilaSwitch
        titulo="Favorito ★"
        meta="Aparece primero en la cuadrícula rápida de Vender."
        valor={favorito}
        onCambio={setFavorito}
      />

      {/* ---------- MODO KIT: armador de componentes ---------- */}
      {esKit && (
        <View
          style={{
            backgroundColor: T.superficie,
            borderRadius: T.radio,
            borderWidth: 1,
            borderColor: T.bordeFuerte,
            padding: T.esps.lg,
            marginBottom: T.esps.lg,
          }}
        >
          <Txt escala="cuerpo" fuerte>
            Componentes del kit
          </Txt>
          <Txt escala="pie" tono="suave" estilo={{ marginTop: 2, marginBottom: T.esps.md }}>
            Al vender el kit se descuenta el stock de cada componente.
          </Txt>

          {componentes.map((c) => (
            <View
              key={c.producto_id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: T.esps.sm,
                paddingVertical: T.esps.sm,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: T.borde,
              }}
            >
              <View style={{ flex: 1 }}>
                <Txt escala="pie" fuerte lineas={1}>
                  {c.nombre}
                </Txt>
                <Txt escala="micro" tono="tenue">
                  stock: {fmtStock(c.stock, "")} · costo {pesos(c.costo_centavos ?? 0)}
                </Txt>
              </View>
              <TextInput
                style={[estiloInput, { width: 64, textAlign: "center", paddingHorizontal: 4 }]}
                value={c.cantidad}
                onChangeText={(t) => cambiarCantidad(c.producto_id, t)}
                keyboardType="decimal-pad"
              />
              <Pressable onPress={() => quitarComponente(c.producto_id)} hitSlop={10}>
                <Txt escala="cuerpo" tono="peligro" fuerte>
                  ✕
                </Txt>
              </Pressable>
            </View>
          ))}

          <TextInput
            style={[estiloInput, { marginTop: T.esps.sm }]}
            value={buscaComp}
            onChangeText={setBuscaComp}
            placeholder="Buscar producto para añadir…"
            placeholderTextColor={T.textoTenue}
          />
          {resultadosComp.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => agregarComponente(p)}
              style={{ paddingVertical: T.esps.sm }}
            >
              <Txt escala="pie" fuerte>
                {p.nombre}
              </Txt>
              <Txt escala="micro" tono="tenue">
                {pesos(p.precio_venta_centavos)} · stock {fmtStock(p.stock, p.unidad)}
              </Txt>
            </Pressable>
          ))}

          {componentes.length > 0 && (
            <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.sm }}>
              Costo del kit (suma de componentes):{" "}
              <Monto texto={pesos(Math.round(costoKit))} escala="pie" tono="exito" />
            </Txt>
          )}
        </View>
      )}

      {/* Precios */}
      <View style={{ flexDirection: "row", gap: T.esps.md }}>
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
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: margen < 0 ? T.peligroSuave : T.exitoSuave,
            borderRadius: T.radioChico,
            padding: T.esps.md,
            marginBottom: T.esps.lg,
          }}
        >
          <Txt escala="pie" tono="suave" fuerte>
            Margen
          </Txt>
          <View style={{ alignItems: "flex-end" }}>
            <Monto texto={`${margen}%`} escala="cuerpo" tono={margen < 0 ? "peligro" : "exito"} />
            {margen < 0 ? (
              <Txt escala="micro" tono="peligro">
                Estás vendiendo bajo costo
              </Txt>
            ) : null}
          </View>
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
          <FilaSwitch
            titulo="Controlar stock"
            meta="Apágalo para servicios o venta sin inventario."
            valor={controlaStock}
            onCambio={setControlaStock}
          />

          {controlaStock && (
            <View style={{ flexDirection: "row", gap: T.esps.md }}>
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
        <View style={{ marginTop: T.esps.md }}>
          <Boton titulo="Eliminar producto" tipo="peligro" onPress={() => setConfirmandoBorrado(true)} />
        </View>
      )}

      {/* Confirmación de borrado: hoja chica, sin Alert nativo. */}
      <Hoja
        visible={confirmandoBorrado}
        onCerrar={() => setConfirmandoBorrado(false)}
        titulo="Eliminar producto"
        pie={
          <View style={{ gap: T.esps.sm }}>
            <Boton titulo="Eliminar" tipo="peligro" onPress={confirmarBorrado} cargando={guardando} />
            <Boton titulo="Cancelar" tipo="secundario" onPress={() => setConfirmandoBorrado(false)} />
          </View>
        }
      >
        <Txt escala="pie" tono="suave">
          {producto ? `¿Eliminar "${producto.nombre}"? No aparecerá más en el inventario.` : ""}
        </Txt>
      </Hoja>

      {/* Escáner de código de barras (modo único: rellena el campo y cierra) */}
      {escanerAbierto && (
        <EscanerCamara
          modo="unico"
          onCodigo={(c) => void alEscanearCodigo(c)}
          onCerrar={() => setEscanerAbierto(false)}
        />
      )}

      {/* Vista grande de la foto (mantener pulsada): el formulario queda
          difuminado detrás. Desde aquí también se puede cambiar o recortar
          el fondo sin tener que cerrarla primero.
          Overlay absoluto, NO un <Modal> anidado — un Modal dentro de otro
          Modal no siempre cubre toda la pantalla en React Native. */}
      {lightboxAbierto && imagenUri && (
        <View style={estLightbox.raiz}>
          {/* Modo Rendimiento: el desenfoque con GPU es lo único pesado de
              toda esta pantalla — en un dispositivo de gama baja se siente
              con lag. Apagado, se compensa oscureciendo más fuerte en vez
              de dejar la foto de fondo asomando sin difuminar. */}
          {!prefs.modoRendimiento && (
            <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
          )}
          <View
            style={[
              StyleSheet.absoluteFill,
              estLightbox.oscurecer,
              prefs.modoRendimiento && { backgroundColor: "rgba(0,0,0,0.75)" },
            ]}
          />
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setLightboxAbierto(false)} />
          <View style={estLightbox.imagenWrap} pointerEvents="box-none">
            <Image source={{ uri: imagenUri }} style={estLightbox.imagen} resizeMode="contain" />
          </View>
          <View style={estLightbox.acciones}>
            <BotonLightbox icono="imagen" label="Ajustar" onPress={() => accionDesdeLightbox(() => void abrirAjustarActual())} />
            <BotonLightbox icono="camara" label="Cámara" onPress={() => accionDesdeLightbox(() => cambiarFoto("camara"))} />
            <BotonLightbox icono="imagen" label="Galería" onPress={() => accionDesdeLightbox(() => cambiarFoto("galeria"))} />
            {hayRecorte && (
              <BotonLightbox icono="imagen" label="Quitar fondo" onPress={() => accionDesdeLightbox(() => void recortarFondo())} />
            )}
          </View>
          <Pressable style={estLightbox.cerrar} onPress={() => setLightboxAbierto(false)} hitSlop={10}>
            <Text style={estLightbox.cerrarTxt}>✕</Text>
          </Pressable>
        </View>
      )}

      {/* Recortador con pellizco/arrastre: mismo patrón de overlay absoluto
          que el lightbox (no un <Modal> anidado). */}
      {ajustarAbierto && ajusteUri && (
        <View style={estLightbox.raiz}>
          <RecortadorFoto
            uri={ajusteUri}
            onCancelar={cancelarAjuste}
            onListo={(u, orig) => void alConfirmarRecorte(u, orig)}
          />
        </View>
      )}
    </Hoja>
  );
}

// ---------------------------------------------------------------------------
// Piezas locales
// ---------------------------------------------------------------------------

function BotonFoto({
  icono,
  label,
  onPress,
}: {
  icono: IdUI;
  label: string;
  onPress: () => void;
}) {
  const { tema: T } = useTema();
  return (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <IconoUI id={icono} size={16} color={T.textoSuave} />
      <Txt escala="pie" tono="suave">
        {label}
      </Txt>
    </Pressable>
  );
}

function FilaSwitch({
  titulo,
  meta,
  valor,
  onCambio,
}: {
  titulo: string;
  meta: string;
  valor: boolean;
  onCambio: (v: boolean) => void;
}) {
  const { tema: T } = useTema();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: T.esps.md,
        marginBottom: T.esps.lg,
      }}
    >
      <View style={{ flex: 1 }}>
        <Txt escala="cuerpo" fuerte>
          {titulo}
        </Txt>
        <Txt escala="micro" tono="tenue" estilo={{ marginTop: 2 }}>
          {meta}
        </Txt>
      </View>
      <Switch
        value={valor}
        onValueChange={onCambio}
        trackColor={{ false: T.superficie3, true: T.acentoBorde }}
        thumbColor={valor ? T.acento : T.textoTenue}
      />
    </View>
  );
}

function Segmentado({
  opciones,
  valor,
  onCambio,
}: {
  opciones: { id: string; label: string }[];
  valor: string;
  onCambio: (v: string) => void;
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
  // Con color de departamento, el texto siempre es blanco (igual que ya
  // hacía el original). SIN color propio, el chip usa el acento del tema
  // — y ahí el texto tiene que ser T.acentoTexto, no blanco fijo: con el
  // acento "Perla" el texto correcto es oscuro, blanco sería ilegible.
  const usaColorPropio = activo && !!color;
  const fondo = activo ? (color ?? T.acentoRelleno) : T.superficie2;
  const colorTexto = usaColorPropio ? "#ffffff" : activo ? T.acentoTexto : undefined;
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: T.esps.md,
        paddingVertical: T.esps.sm,
        borderRadius: T.radioPildora,
        borderWidth: 1,
        borderColor: activo ? fondo : T.borde,
        backgroundColor: fondo,
      }}
    >
      <Txt
        escala="pie"
        tono={activo ? "principal" : "suave"}
        fuerte={activo}
        estilo={colorTexto ? { color: colorTexto } : undefined}
      >
        {label}
      </Txt>
    </Pressable>
  );
}

function BotonLightbox({
  icono,
  label,
  onPress,
}: {
  icono: IdUI;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={estLightbox.btn}>
      <IconoUI id={icono} size={17} color="#fff" />
      <Text style={estLightbox.btnTxt}>{label}</Text>
    </Pressable>
  );
}

// El lightbox y el recortador viven SIEMPRE sobre fondo oscuro (la foto es
// la protagonista, igual que EscanerCamara): estilos fijos, no dependen del
// tema activo — a propósito, igual que se documentó en EscanerCamara.tsx.
const estLightbox = StyleSheet.create({
  raiz: { ...StyleSheet.absoluteFill, zIndex: 50 },
  oscurecer: { backgroundColor: "rgba(0,0,0,0.35)" },
  imagenWrap: {
    position: "absolute",
    top: 90,
    left: 20,
    right: 20,
    bottom: 140,
    alignItems: "center",
    justifyContent: "center",
  },
  imagen: { width: "100%", height: "100%" },
  acciones: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 40,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  btnTxt: { color: "#fff", fontSize: 13, fontWeight: "700" },
  cerrar: {
    position: "absolute",
    top: 50,
    right: 20,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  cerrarTxt: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
