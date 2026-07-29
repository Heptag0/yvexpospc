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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Producto,
  Categoria,
  ComponenteKit,
  DatosProducto,
  UNIDADES,
  crearProducto,
  editarProducto,
  eliminarProducto,
  componentesDeKit,
  candidatosComponente,
} from "@/src/base/inventario";
import { aCentavos, centavosATexto, aNumero, pesos, fmtStock } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import { elegirImagen, persistirImagen, borrarImagen } from "@/src/base/imagenes";
import ImagenProducto from "@/src/componentes/ImagenProducto";
import { IconoUI } from "@/src/componentes/iconos";
import { Boton, Banner, CabeceraModal, Campo, Insignia, useEstiloInput } from "@/src/componentes/ui";
import EscanerCamara from "@/src/componentes/EscanerCamara";
import { consultarNombreUniversal } from "@/src/base/codigos";

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

export default function FormularioProducto({ producto, categorias, onCerrar, onGuardado, prellenado }: Props) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const estiloInput = useEstiloInput();
  const esEdicion = !!producto;

  const [esKit, setEsKit] = useState(producto ? producto.es_kit === 1 : false);
  const [nombre, setNombre] = useState(producto?.nombre ?? prellenado?.nombre ?? "");
  const [codigo, setCodigo] = useState(producto?.codigo_barras ?? prellenado?.codigo ?? "");
  const [categoriaId, setCategoriaId] = useState<string | null>(producto?.categoria_id ?? null);
  const [precio, setPrecio] = useState(producto ? centavosATexto(producto.precio_venta_centavos) : "");
  const [costo, setCosto] = useState(centavosATexto(producto?.costo_centavos ?? null));
  const [mayoreo, setMayoreo] = useState(centavosATexto(producto?.precio_mayoreo_centavos ?? null));
  const [controlaStock, setControlaStock] = useState(producto ? producto.controla_stock === 1 : true);
  const [stock, setStock] = useState(String(producto?.stock ?? 0));
  const [stockMin, setStockMin] = useState(String(producto?.stock_minimo ?? 0));
  const [unidad, setUnidad] = useState(producto?.unidad ?? "pieza");
  const [imagenUri, setImagenUri] = useState<string | null>(producto?.imagen_uri ?? null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  // Escáner de código (modo único) y aviso discreto del nombre universal.
  const [escanerAbierto, setEscanerAbierto] = useState(false);
  const [avisoEscaner, setAvisoEscaner] = useState("");
  const [buscandoNombre, setBuscandoNombre] = useState(false);

  /** El escáner rellena el campo de código. En un ALTA con nombre vacío,
   *  intentamos sugerir el nombre universal (best-effort, editable). */
  async function alEscanearCodigo(c: string) {
    setCodigo(c);
    setAvisoEscaner("");
    if (!esEdicion && !nombre.trim()) {
      setBuscandoNombre(true);
      const sugerido = await consultarNombreUniversal(c);
      setBuscandoNombre(false);
      if (sugerido) {
        setNombre(sugerido);
        setAvisoEscaner("Sugerimos el nombre desde el catálogo universal; revísalo antes de guardar.");
      } else {
        setAvisoEscaner("No encontramos el nombre de este código; escríbelo tú.");
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
      const final = await persistirImagen(tmp);
      await borrarImagen(imagenUri); // la anterior, si era nuestra
      setImagenUri(final);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function quitarFoto() {
    await borrarImagen(imagenUri);
    setImagenUri(null);
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

            {/* Foto del producto */}
            <View style={est.fotoZona}>
              <ImagenProducto
                uri={imagenUri}
                nombre={nombre || "?"}
                color={categorias.find((c) => c.id === categoriaId)?.color}
                icono={categorias.find((c) => c.id === categoriaId)?.icono}
                size={104}
                radio={18}
              />
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

            {/* Tipo: producto normal o kit */}
            <View style={est.tipoFila}>
              <Segmento
                opciones={[
                  { id: "producto", label: "Producto" },
                  { id: "kit", label: "Kit / Paquete" },
                ]}
                valor={esKit ? "kit" : "producto"}
                onCambio={(v) => setEsKit(v === "kit")}
              />
            </View>

            <Campo label="Nombre">
              <TextInput
                style={estiloInput}
                value={nombre}
                onChangeText={setNombre}
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

            <Campo label="Unidad">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
                <View style={est.chips}>
                  {UNIDADES.map((u) => (
                    <Chip key={u} activo={unidad === u} label={u} onPress={() => setUnidad(u)} />
                  ))}
                </View>
              </ScrollView>
            </Campo>

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
  });
}
