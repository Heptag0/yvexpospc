// YvexPOS Móvil — Pantalla de Inventario (rediseñada, completa).
//
// ARREGLOS DE RAÍZ:
//   - Los modales se montan CONDICIONALMENTE ({visible && <Modal/>}): cada
//     apertura crea estado fresco -> se acabaron los datos viejos pegados.
//   - Carruseles horizontales con flexGrow:0 y alturas correctas -> se acabó
//     el layout roto de "cuadrados gigantes".
//   - Filtro de stock bajo con banner claro y botón "Quitar" -> nunca atascado.
//
// COMPLETO: métricas, búsqueda, filtro por departamento, crear/editar (con
// kits), ajuste rápido de stock (botón ± en cada tarjeta), reporte de
// valorización y conteo físico.

import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Pressable,
  ScrollView,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import {
  Producto,
  ProductoLista,
  Categoria,
  MetricasInventario,
  listarProductos,
  listarCategorias,
  metricasInventario,
} from "@/src/base/inventario";
import { sembrarSiVacio } from "@/src/base/semilla";
import { pesos, fmtStock } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import { Insignia } from "@/src/componentes/ui";
import ImagenProducto from "@/src/componentes/ImagenProducto";
import SelectorVista, { Vista, columnasDe } from "@/src/componentes/SelectorVista";
import FormularioProducto from "@/src/componentes/FormularioProducto";
import ModalDepartamentos from "@/src/componentes/ModalDepartamentos";
import ModalAjusteStock from "@/src/componentes/ModalAjusteStock";
import ModalReporte from "@/src/componentes/ModalReporte";
import ModalConteo from "@/src/componentes/ModalConteo";
import ModalEscanearTicket from "@/src/componentes/ModalEscanearTicket";
import ModalProveedores from "@/src/componentes/ModalProveedores";

type Tema = ReturnType<typeof useTema>["tema"];

export default function InventarioScreen() {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const [productos, setProductos] = useState<ProductoLista[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [metricas, setMetricas] = useState<MetricasInventario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);

  const [busqueda, setBusqueda] = useState("");
  const [catFiltro, setCatFiltro] = useState<string | null>(null);
  const [soloStockBajo, setSoloStockBajo] = useState(false);
  const [vista, setVista] = useState<Vista>("lista");

  // Modales: null/false = NO MONTADO (estado fresco en cada apertura).
  const [formAbierto, setFormAbierto] = useState(false);
  const [productoEditar, setProductoEditar] = useState<Producto | null>(null);
  const [deptosAbierto, setDeptosAbierto] = useState(false);
  const [ajusteProducto, setAjusteProducto] = useState<Producto | null>(null);
  const [reporteAbierto, setReporteAbierto] = useState(false);
  const [conteoAbierto, setConteoAbierto] = useState(false);
  const [escanerAbierto, setEscanerAbierto] = useState(false);
  const [proveedoresAbierto, setProveedoresAbierto] = useState(false);

  const cargar = useCallback(async () => {
    await sembrarSiVacio();
    const [prods, cats, mets] = await Promise.all([
      listarProductos({ filtro: busqueda, categoriaId: catFiltro, soloStockBajo }),
      listarCategorias(),
      metricasInventario(),
    ]);
    setProductos(prods);
    setCategorias(cats);
    setMetricas(mets);
    setCargando(false);
  }, [busqueda, catFiltro, soloStockBajo]);

  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar])
  );

  const onRefresh = useCallback(async () => {
    setRefrescando(true);
    await cargar();
    setRefrescando(false);
  }, [cargar]);

  function cerrarYRecargar() {
    setFormAbierto(false);
    setProductoEditar(null);
    setAjusteProducto(null);
    setConteoAbierto(false);
    cargar();
  }

  return (
    <SafeAreaView style={est.raiz} edges={["top"]}>
      {/* ---------- Marca + título ---------- */}
      <View style={est.cabecera}>
        <Text style={est.marca}>
          Yvex<Text style={{ color: T.turquesa }}>POS</Text>
        </Text>
        <Text style={est.titulo}>Inventario</Text>
      </View>

      {/* ---------- Acciones (fila flex con wrap: caben 4 botones) ---------- */}
      <View style={est.acciones}>
        <BotonAccion label="Reporte" onPress={() => setReporteAbierto(true)} />
        <BotonAccion label="Conteo físico" onPress={() => setConteoAbierto(true)} />
        <BotonAccion label="Departamentos" onPress={() => setDeptosAbierto(true)} />
        <BotonAccion label="Escanear" onPress={() => setEscanerAbierto(true)} />
        <BotonAccion label="Proveedores" onPress={() => setProveedoresAbierto(true)} />
      </View>

      {/* ---------- Métricas: UNA sola fila con scroll horizontal ----------
          Las cifras importantes de un vistazo sin robarle pantalla a la
          lista de productos; la tarjeta a medias indica que hay más. */}
      {metricas && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={est.metricas}
        >
          <Metrica
            label="Valor inventario"
            valor={pesos(metricas.valor_costo_centavos)}
            pie="a costo"
            principal
          />
          <Metrica
            label="Margen prom."
            valor={
              metricas.margen_promedio != null
                ? `${Math.round(metricas.margen_promedio)}%`
                : "—"
            }
            pie="precio vs costo"
          />
          <Metrica
            label="Stock bajo"
            valor={String(metricas.stock_bajo)}
            pie="por resurtir"
            color={metricas.stock_bajo > 0 ? T.alerta : undefined}
            onPress={() => setSoloStockBajo((v) => !v)}
            activo={soloStockBajo}
          />
          {metricas.en_negativo > 0 && (
            <Metrica
              label="En negativo"
              valor={String(metricas.en_negativo)}
              pie="revisar"
              color={T.peligro}
            />
          )}
          <Metrica label="Productos" valor={String(metricas.total_productos)} pie="en catálogo" />
        </ScrollView>
      )}

      {/* ---------- Buscador ---------- */}
      <View style={est.buscadorCaja}>
        <TextInput
          style={est.buscador}
          placeholder="Buscar por nombre o código…"
          placeholderTextColor={T.textoTenue}
          value={busqueda}
          onChangeText={setBusqueda}
        />
      </View>

      {/* ---------- Filtro de departamentos ---------- */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={est.filtrosScroll}
        contentContainerStyle={est.filtros}
      >
        <ChipFiltro label="Todos" activo={catFiltro === null} onPress={() => setCatFiltro(null)} />
        {categorias.map((c) => (
          <ChipFiltro
            key={c.id}
            label={c.nombre}
            color={c.color ?? undefined}
            activo={catFiltro === c.id}
            onPress={() => setCatFiltro(catFiltro === c.id ? null : c.id)}
          />
        ))}
      </ScrollView>

      {/* ---------- Banner de filtro activo (nunca más atascado) ---------- */}
      {soloStockBajo && (
        <View style={est.filtroActivo}>
          <Text style={est.filtroActivoTxt}>Mostrando solo stock bajo</Text>
          <Pressable onPress={() => setSoloStockBajo(false)} hitSlop={10}>
            <Text style={est.filtroQuitar}>Quitar ✕</Text>
          </Pressable>
        </View>
      )}

      {/* ---------- Barra de vista ---------- */}
      <View style={est.barraVista}>
        <Text style={est.barraVistaTxt}>
          {productos.length} producto{productos.length === 1 ? "" : "s"}
        </Text>
        <SelectorVista vista={vista} onCambio={setVista} />
      </View>

      {/* ---------- Lista / cuadrícula ---------- */}
      {cargando ? (
        <View style={est.centro}>
          <ActivityIndicator size="large" color={T.acento} />
        </View>
      ) : (
        <FlatList
          data={productos}
          key={vista}
          numColumns={columnasDe(vista)}
          columnWrapperStyle={columnasDe(vista) > 1 ? { gap: 9 } : undefined}
          keyExtractor={(item) => item.id}
          contentContainerStyle={est.lista}
          refreshControl={
            <RefreshControl refreshing={refrescando} onRefresh={onRefresh} tintColor={T.acento} />
          }
          ListEmptyComponent={
            <Text style={est.vacio}>
              {busqueda || catFiltro || soloStockBajo
                ? "Sin resultados con estos filtros."
                : "No hay productos. Toca + para crear el primero."}
            </Text>
          }
          renderItem={({ item }) =>
            vista === "lista" ? (
              <TarjetaProducto
                item={item}
                onEditar={() => {
                  setProductoEditar(item);
                  setFormAbierto(true);
                }}
                onAjustar={() => setAjusteProducto(item)}
              />
            ) : (
              <TarjetaGrid
                item={item}
                cols={columnasDe(vista)}
                onEditar={() => {
                  setProductoEditar(item);
                  setFormAbierto(true);
                }}
              />
            )
          }
        />
      )}

      {/* ---------- FAB crear ---------- */}
      <Pressable
        style={est.fab}
        onPress={() => {
          setProductoEditar(null);
          setFormAbierto(true);
        }}
      >
        <Text style={est.fabTxt}>+</Text>
      </Pressable>

      {/* ---------- Modales (montaje condicional = estado fresco) ---------- */}
      {formAbierto && (
        <FormularioProducto
          producto={productoEditar}
          categorias={categorias}
          onCerrar={() => {
            setFormAbierto(false);
            setProductoEditar(null);
          }}
          onGuardado={cerrarYRecargar}
        />
      )}
      {deptosAbierto && (
        <ModalDepartamentos
          onCerrar={() => setDeptosAbierto(false)}
          onCambio={cargar}
        />
      )}
      {ajusteProducto && (
        <ModalAjusteStock
          producto={ajusteProducto}
          onCerrar={() => setAjusteProducto(null)}
          onAjustado={cerrarYRecargar}
        />
      )}
      {reporteAbierto && <ModalReporte onCerrar={() => setReporteAbierto(false)} />}
      {conteoAbierto && (
        <ModalConteo
          onCerrar={() => setConteoAbierto(false)}
          onAplicado={cerrarYRecargar}
        />
      )}
      {escanerAbierto && (
        <ModalEscanearTicket
          onCerrar={() => setEscanerAbierto(false)}
          onAplicado={() => {
            setEscanerAbierto(false);
            cargar();
          }}
        />
      )}
      {proveedoresAbierto && (
        <ModalProveedores
          onCerrar={() => setProveedoresAbierto(false)}
          onCambio={cargar}
        />
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

function TarjetaProducto({
  item,
  onEditar,
  onAjustar,
}: {
  item: ProductoLista;
  onEditar: () => void;
  onAjustar: () => void;
}) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const esKit = item.es_kit === 1;
  const bajo = !esKit && item.controla_stock === 1 && item.stock <= item.stock_minimo;
  return (
    <Pressable style={({ pressed }) => [est.tarjeta, pressed && { backgroundColor: T.superficie3 }]} onPress={onEditar}>
      {/* Barra de color del departamento */}
      <View style={[est.tarjetaBarra, { backgroundColor: item.categoria_color ?? T.borde }]} />
      <View style={est.tarjetaCuerpo}>
        <ImagenProducto
          uri={item.imagen_uri}
          nombre={item.nombre}
          color={item.categoria_color}
          icono={item.categoria_icono}
          size={46}
          radio={11}
        />
        <View style={est.tarjetaIzq}>
          <View style={est.nombreFila}>
            <Text style={est.nombre} numberOfLines={1}>{item.nombre}</Text>
            {esKit && <Insignia texto="KIT" color={T.turquesa} />}
          </View>
          <Text style={est.meta} numberOfLines={1}>
            {item.categoria_nombre ?? "Sin depto."}
            {item.codigo_barras ? `  ·  ${item.codigo_barras}` : ""}
          </Text>
        </View>
        <View style={est.tarjetaDer}>
          <Text style={est.precio}>{pesos(item.precio_venta_centavos)}</Text>
          {esKit ? (
            <Text style={est.stock}>arma {item.kit_disponible ?? 0}</Text>
          ) : item.controla_stock === 1 ? (
            <Text style={[est.stock, bajo && { color: T.peligro, fontWeight: "700" }]}>
              {fmtStock(item.stock, item.unidad)}
              {bajo ? "  ▼" : ""}
            </Text>
          ) : (
            <Text style={est.stock}>sin control</Text>
          )}
        </View>
        {/* Ajuste rápido de stock */}
        {!esKit && item.controla_stock === 1 && (
          <Pressable
            onPress={onAjustar}
            hitSlop={8}
            style={({ pressed }) => [est.btnAjuste, pressed && { backgroundColor: T.acento }]}
          >
            <Text style={est.btnAjusteTxt}>±</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

function TarjetaGrid({
  item,
  cols,
  onEditar,
}: {
  item: ProductoLista;
  cols: number;
  onEditar: () => void;
}) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const esKit = item.es_kit === 1;
  const bajo = !esKit && item.controla_stock === 1 && item.stock <= item.stock_minimo;
  const chico = cols >= 4;
  return (
    <Pressable
      style={({ pressed }) => [
        est.gCard,
        bajo && { borderColor: T.peligro + "88" },
        pressed && { transform: [{ scale: 0.96 }], backgroundColor: T.superficie3 },
      ]}
      onPress={onEditar}
    >
      <ImagenProducto
        uri={item.imagen_uri}
        nombre={item.nombre}
        color={item.categoria_color}
        icono={item.categoria_icono}
        size={chico ? 44 : cols === 2 ? 78 : 60}
        radio={chico ? 11 : 14}
      />
      <Text style={[est.gNombre, chico && { fontSize: 10, minHeight: 24 }]} numberOfLines={2}>
        {item.nombre}
      </Text>
      <Text style={[est.gPrecio, chico && { fontSize: 11.5 }]}>
        {pesos(item.precio_venta_centavos)}
      </Text>
      {!esKit && item.controla_stock === 1 && (
        <Text style={[est.gStock, bajo && { color: T.peligro, fontWeight: "800" }]}>
          {fmtStock(item.stock, item.unidad)}
        </Text>
      )}
    </Pressable>
  );
}

function BotonAccion({ label, onPress }: { label: string; onPress: () => void }) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [est.accion, pressed && { backgroundColor: T.superficie3 }]}
    >
      <Text style={est.accionTxt} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
    </Pressable>
  );
}

function Metrica({
  label,
  valor,
  pie,
  principal,
  color,
  onPress,
  activo,
}: {
  label: string;
  valor: string;
  pie?: string;
  principal?: boolean;
  color?: string;
  onPress?: () => void;
  activo?: boolean;
}) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const Cont: any = onPress ? Pressable : View;
  return (
    <Cont
      onPress={onPress}
      style={[est.metrica, principal && est.metricaPrincipal, activo && est.metricaActiva]}
    >
      <Text style={est.metricaLbl} numberOfLines={1}>{label}</Text>
      <Text
        style={[est.metricaVal, color ? { color } : null]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {valor}
      </Text>
      <Text style={est.metricaPie} numberOfLines={1}>{pie ?? " "}</Text>
    </Cont>
  );
}

function ChipFiltro({
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
        est.chipF,
        activo && { backgroundColor: color ?? T.acento, borderColor: color ?? T.acento },
      ]}
    >
      {color && !activo ? <View style={[est.chipPunto, { backgroundColor: color }]} /> : null}
      <Text style={[est.chipFTxt, activo && { color: T.acentoTexto, fontWeight: "800" }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Estilos (se construyen con el tema ACTIVO)
// ---------------------------------------------------------------------------
function crearEstilos(T: Tema) {
  // Sombra/brillo de marca (antes `brilloAcento` de la paleta fija).
  const brilloAcento: ViewStyle = {
    shadowColor: T.acento,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  };
  // Profundidad sutil, igual que en Inicio y Vender.
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
  cabecera: {
    paddingHorizontal: T.esp,
    paddingTop: 10,
    paddingBottom: 4,
  },
  marca: { color: T.texto, fontSize: 13, fontWeight: "900", letterSpacing: 1.5, opacity: 0.85 },
  titulo: { fontSize: 27, fontWeight: "800", color: T.texto, letterSpacing: -0.7, marginTop: 1 },
  acciones: {
    flexDirection: "row", flexWrap: "wrap", gap: 8,
    paddingHorizontal: T.esp, marginBottom: 6,
  },
  accion: {
    flex: 1,
    minWidth: 70,
    backgroundColor: T.superficie2,
    borderWidth: 1,
    borderColor: T.bordeFuerte,
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 8,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  accionTxt: { color: T.textoSuave, fontSize: 11.5, fontWeight: "700" },

  // Métricas: fila única compacta con scroll horizontal; las tarjetas son
  // bajitas para que la lista de productos recupere la pantalla.
  metricas: {
    gap: 8,
    paddingHorizontal: T.esp,
    paddingVertical: 4,
    marginTop: 2,
    marginBottom: 2,
  },
  metrica: {
    minWidth: 106,
    backgroundColor: T.superficie,
    borderRadius: T.radio,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: T.borde,
    justifyContent: "center",
    ...sombraSuave,
  },
  metricaPrincipal: { borderLeftWidth: 4, borderLeftColor: T.acento },
  metricaActiva: { borderColor: T.alerta, borderWidth: 1.5 },
  metricaLbl: {
    color: T.textoSuave, fontSize: 9, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 0.6,
  },
  metricaVal: { color: T.texto, fontSize: 17, fontWeight: "800", marginTop: 2, ...cifras },
  metricaPie: { color: T.textoTenue, fontSize: 9, marginTop: 1 },

  buscadorCaja: { paddingHorizontal: T.esp, paddingTop: 12, paddingBottom: 8 },
  buscador: {
    backgroundColor: T.superficie2,
    borderRadius: T.radio,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 15,
    color: T.texto,
    borderWidth: 1,
    borderColor: T.borde,
  },

  // Filtros: alto FIJO con aire suficiente -> nada se corta (bug 2 resuelto).
  filtrosScroll: { flexGrow: 0, height: 52 },
  filtros: { paddingHorizontal: T.esp, gap: 8, alignItems: "center", paddingVertical: 3 },
  chipF: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 15,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: T.borde,
    backgroundColor: T.superficie2,
  },
  chipFTxt: { color: T.textoSuave, fontSize: 13, fontWeight: "600" },
  chipPunto: { width: 8, height: 8, borderRadius: 4 },

  filtroActivo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: T.alertaSuave,
    borderWidth: 1,
    borderColor: T.alerta,
    borderRadius: T.radioChico,
    marginHorizontal: T.esp,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  filtroActivoTxt: { color: T.alertaTexto, fontSize: 13, fontWeight: "700" },
  filtroQuitar: { color: T.alerta, fontSize: 13, fontWeight: "800" },

  centro: { flex: 1, alignItems: "center", justifyContent: "center" },
  lista: { paddingHorizontal: T.esp, paddingTop: 10, paddingBottom: 140 },
  vacio: {
    textAlign: "center", color: T.textoTenue, marginTop: 44,
    fontSize: 15, paddingHorizontal: 40, lineHeight: 22,
  },

  tarjeta: {
    flexDirection: "row",
    backgroundColor: T.superficie,
    borderRadius: T.radio,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: T.borde,
    overflow: "hidden",
    ...sombraSuave,
  },
  tarjetaBarra: { width: 4 },
  tarjetaCuerpo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 10,
  },
  tarjetaIzq: { flex: 1 },
  nombreFila: { flexDirection: "row", alignItems: "center", gap: 8 },
  nombre: { fontSize: 15.5, fontWeight: "700", color: T.texto, flexShrink: 1 },
  meta: { fontSize: 12, color: T.textoTenue, marginTop: 3 },
  tarjetaDer: { alignItems: "flex-end" },
  precio: { fontSize: 16, fontWeight: "800", color: T.turquesa, ...cifras },
  stock: { fontSize: 12.5, color: T.textoSuave, marginTop: 3 },
  btnAjuste: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: T.superficie2,
    borderWidth: 1,
    borderColor: T.bordeFuerte,
    alignItems: "center",
    justifyContent: "center",
  },
  btnAjusteTxt: { color: T.texto, fontSize: 18, fontWeight: "800", marginTop: -1 },

  fab: {
    position: "absolute",
    right: T.esp,
    bottom: 26,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: T.acento,
    alignItems: "center",
    justifyContent: "center",
    ...brilloAcento,
  },
  fabTxt: { color: T.acentoTexto, fontSize: 34, fontWeight: "300", marginTop: -2 },
  barraVista: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: T.esp, paddingTop: 8, paddingBottom: 6,
  },
  barraVistaTxt: { color: T.textoTenue, fontSize: 12, fontWeight: "700" },
  gCard: {
    flex: 1, backgroundColor: T.superficie, borderRadius: T.radio + 2,
    borderWidth: 1, borderColor: T.borde, alignItems: "center",
    paddingVertical: 12, paddingHorizontal: 6, marginBottom: 9,
  },
  gNombre: {
    color: T.texto, fontSize: 11.5, fontWeight: "700", textAlign: "center",
    marginTop: 8, lineHeight: 14, minHeight: 28,
  },
  gPrecio: { color: T.turquesa, fontSize: 13, fontWeight: "800", marginTop: 3, ...cifras },
  gStock: { color: T.textoTenue, fontSize: 10.5, marginTop: 2 },
  });
}
