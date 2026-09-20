// YvexPOS Móvil — Pantalla de Inventario.
//
// Métricas, búsqueda, filtro por departamento, crear/editar (con kits),
// ajuste rápido de stock, reporte de valorización y conteo físico.
// Los modales se montan CONDICIONALMENTE ({visible && <Modal/>}): cada
// apertura crea estado fresco, nunca datos viejos pegados.
//
// ---------------------------------------------------------------------------
// LO QUE CAMBIÓ EN ESTA PASADA
// ---------------------------------------------------------------------------
// 1. CINCO BOTONES EN UNA FILA CON WRAP → SCROLLER HORIZONTAL.
//    Reporte/Conteo/Departamentos/Escanear/Proveedores se envolvían en dos
//    filas desiguales, con "Proveedores" solo. Un scroller nunca se rompe,
//    sin importar cuántas acciones tenga — se desliza, no se acomoda mal.
//
// 2. CINCO TARJETAS DE MÉTRICA EN SCROLL, CORTADAS EN EL BORDE → JERARQUÍA.
//    "Valor inventario" es la cifra que de verdad importa (cuánto dinero
//    hay parado en el negocio): pasa a ser la ÚNICA <Lamina>, con margen y
//    productos como apoyo dentro. "Stock bajo" y "En negativo" dejan de ser
//    tarjetas pasivas y pasan a ser filas ACCIONABLES — tiene sentido que
//    algo en lo que tocas para filtrar se vea como algo que se toca.
//
// 3. UNA CONSULTA A LA BASE POR CADA LETRA TECLEADA → DEBOUNCE.
//    `cargar()` dependía de `busqueda` directamente, y como corre dentro de
//    `useFocusEffect`, cada cambio de esa dependencia volvía a disparar el
//    efecto — no solo al enfocar la pantalla, sino en cada tecla. Con un
//    catálogo grande eso es una consulta completa por carácter. Ahora el
//    campo de texto responde al instante (estado local) y la consulta real
//    espera 300ms de silencio antes de ir a la base — el patrón estándar
//    para buscadores que no quieren sentirse pesados.
//
// 4. TARJETAS MEMOIZADAS. Mismo patrón que en Vender: `onEditar`/`onAjustar`
//    son funciones estables (`useCallback`), y las tarjetas son
//    `React.memo`. El botón ± de ajuste rápido invita a toques repetidos —
//    sin esto, cada toque re-renderiza las 50+ tarjetas visibles.

import { useState, useCallback, useEffect, useMemo, useRef, memo } from "react";
import {
  View,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
// Ver ui.tsx: el KeyboardAvoidingView de React Native encoge el contenedor
// pero no desplaza hasta el campo enfocado. Aquí el buscador está arriba y la
// lista debajo, así que lo único que hace falta es que la lista se encoja de
// verdad — pero el de la librería además funciona con `edgeToEdgeEnabled`,
// donde la ventana ya no se redimensiona sola.
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
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
// PENDIENTES.md punto 24 — antes: import { sembrarSiVacio } from
// "@/src/base/semilla"; se llamaba en cargar() cada vez que se abría esta
// pantalla (vía useFocusEffect, más abajo). El comentario del propio
// semilla.ts ya avisaba "cuando la app esté lista, esto se quita" — nunca
// se le puso una bandera, así que CUALQUIER negocio real que se quedara
// con la tabla de productos vacía por cualquier motivo recibía en
// silencio 3 categorías y 8 productos falsos, cigarros de marca
// incluidos, sin ningún aviso ni forma de saber por qué aparecieron.
import { pesos, fmtStock } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import {
  Encabezado,
  Lamina,
  Grupo,
  Fila,
  Txt,
  Monto,
  Insignia,
  Vacio,
  useEstiloInput,
} from "@/src/componentes/ui";
import ImagenProducto from "@/src/componentes/ImagenProducto";
import BotonYaxo from "@/src/componentes/BotonYaxo";
import { IconoUI, IdUI } from "@/src/componentes/iconos";
import SelectorVista, { Vista, columnasDe } from "@/src/componentes/SelectorVista";
import FormularioProducto from "@/src/componentes/FormularioProducto";
import ModalDepartamentos from "@/src/componentes/ModalDepartamentos";
import ModalAjusteStock from "@/src/componentes/ModalAjusteStock";
import ModalReporte from "@/src/componentes/ModalReporte";
import ModalConteo from "@/src/componentes/ModalConteo";
import ModalEscanearTicket from "@/src/componentes/ModalEscanearTicket";
import ModalProveedores from "@/src/componentes/ModalProveedores";

// Acciones secundarias: icono confirmado contra el mismo catálogo que ya usa
// el resto de la app (ver src/base/herramientas.ts), nunca un id inventado.
// ETIQUETAS DE UNA SOLA PALABRA, A PROPOSITO
// ---------------------------------------------------------------------------
// Son cinco columnas a `flex: 1`: en un telefono normal cada una mide poco mas
// de 60 px. "Departamentos" y "Proveedores" no caben en ese ancho, y React
// Native no divide con guion: parte por donde toque. Salia "Departame /
// ntos" y "Proveedore / s", que es justo el detalle que delata una plantilla.
//
// Se arregla en el TEXTO, no en el layout: cinco etiquetas de una palabra que
// caben enteras. Estrechar el icono o bajar el tamano de letra solo mueve el
// problema al siguiente telefono mas angosto.
//
// Regla al anadir una accion aqui: una sola palabra, y de las cortas. Si hace
// falta explicarla, el sitio es la pantalla que abre, no esta rejilla.
const ACCIONES: { id: string; icono: IdUI; label: string }[] = [
  { id: "reporte", icono: "reportes", label: "Reporte" },
  { id: "conteo", icono: "inventario", label: "Conteo" },
  { id: "deptos", icono: "etiqueta", label: "Deptos." },
  { id: "escanear", icono: "escaner", label: "Escanear" },
  { id: "proveedores", icono: "camion", label: "Proveedor" },
];

export default function InventarioScreen() {
  const { tema: T } = useTema();
  const estiloInput = useEstiloInput();
  const [productos, setProductos] = useState<ProductoLista[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [metricas, setMetricas] = useState<MetricasInventario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);

  // El campo de texto responde al instante; la CONSULTA a la base espera a
  // que el usuario deje de teclear. Dos estados a propósito: uno para lo que
  // se ve, otro para lo que se busca.
  const [busqueda, setBusqueda] = useState("");
  const [busquedaConsulta, setBusquedaConsulta] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setBusquedaConsulta(busqueda), 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const [catFiltro, setCatFiltro] = useState<string | null>(null);
  const [soloStockBajo, setSoloStockBajo] = useState(false);
  // Mutuamente excluyente con soloStockBajo: son dos alertas distintas (una
  // es "hay que resurtir", la otra "algo no cuadró en el conteo"), pero solo
  // tiene sentido mirar una a la vez — un producto en negativo casi siempre
  // cuenta también como stock bajo, así que combinarlas sería redundante.
  const [soloEnNegativo, setSoloEnNegativo] = useState(false);
  const [vista, setVista] = useState<Vista>("lista");

  // Alterna qué valor muestra la lámina protagonista: a costo (lo que
  // pagaste) o a precio de venta (lo que entraría si vendieras todo hoy).
  const [mostrarPrecioVenta, setMostrarPrecioVenta] = useState(false);

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
    const [prods, cats, mets] = await Promise.all([
      listarProductos({
        filtro: busquedaConsulta,
        categoriaId: catFiltro,
        soloStockBajo,
        soloEnNegativo,
      }),
      listarCategorias(),
      metricasInventario(),
    ]);
    setProductos(prods);
    setCategorias(cats);
    setMetricas(mets);
    setCargando(false);
  }, [busquedaConsulta, catFiltro, soloStockBajo, soloEnNegativo]);

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

  const cerrarYRecargar = useCallback(() => {
    setFormAbierto(false);
    setProductoEditar(null);
    setAjusteProducto(null);
    setConteoAbierto(false);
    cargar();
  }, [cargar]);

  // Estables para siempre: solo hacen setState con el argumento recibido.
  // Es lo que permite que las tarjetas de abajo se memoicen de verdad.
  const abrirEditar = useCallback((item: Producto) => {
    setProductoEditar(item);
    setFormAbierto(true);
  }, []);
  const abrirAjuste = useCallback((item: Producto) => {
    setAjusteProducto(item);
  }, []);

  function accionar(id: string) {
    if (id === "reporte") setReporteAbierto(true);
    else if (id === "conteo") setConteoAbierto(true);
    else if (id === "deptos") setDeptosAbierto(true);
    else if (id === "escanear") setEscanerAbierto(true);
    else if (id === "proveedores") setProveedoresAbierto(true);
  }

  function alternarStockBajo() {
    setSoloStockBajo((v) => !v);
    setSoloEnNegativo(false);
  }
  function alternarEnNegativo() {
    setSoloEnNegativo((v) => !v);
    setSoloStockBajo(false);
  }
  function quitarFiltroAlerta() {
    setSoloStockBajo(false);
    setSoloEnNegativo(false);
  }

  const cols = columnasDe(vista);
  const hayFiltros = Boolean(busqueda || catFiltro || soloStockBajo || soloEnNegativo);

  // ---------------------------------------------------------------------
  // POR QUÉ LOS PRODUCTOS SE AGRUPAN EN FILAS EN VEZ DE USAR numColumns
  // ---------------------------------------------------------------------
  // React Native de verdad no permite cambiar `numColumns` en un FlatList ya
  // montado — es una limitación real de la librería, no algo que se pueda
  // configurar. La solución que ella misma documenta es forzar un remontaje
  // completo cambiando la `key` del componente al cambiar de vista. Eso
  // funciona, pero el efecto secundario ES el bug que se sentía: remontar
  // significa tirar el FlatList entero y crear uno nuevo — de ahí el
  // congelamiento de un segundo (vuelve a montar cada imagen e ícono
  // visible desde cero) y el salto al principio (una instancia nueva
  // siempre arranca con scroll en cero).
  //
  // La solución de raíz es que `numColumns` NUNCA cambie. Aquí se agrupan
  // los productos en filas A MANO — cada fila es un array de 1 producto en
  // vista de lista, o de `cols` productos en cuadrícula — y el FlatList
  // por debajo SIEMPRE tiene una sola columna (nunca se le pasa
  // `numColumns`). Cambiar de vista deja de ser un remontaje: es solo
  // volver a calcular cómo se agrupan las mismas filas, y React actualiza
  // el contenido de las celdas que ya existen en vez de crearlas de nuevo.
  const filas = useMemo(() => {
    const porFila = vista === "lista" ? 1 : cols;
    const out: ProductoLista[][] = [];
    for (let i = 0; i < productos.length; i += porFila) {
      out.push(productos.slice(i, i + porFila));
    }
    return out;
  }, [productos, vista, cols]);

  // El salto a scroll 0 al cambiar de vista SIGUE siendo la decisión de
  // producto correcta (una fila de la lista y una fila de cuadrícula no
  // corresponden al mismo punto de scroll, así que mantener la posición
  // sería mostrar productos "al azar"). La diferencia es que ahora se hace
  // a propósito y al instante, no como efecto colateral de un remontaje de
  // un segundo.
  const listaRef = useRef<FlatList<ProductoLista[]>>(null);
  useEffect(() => {
    listaRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [vista]);

  // ---------------------------------------------------------------------
  // LA CABECERA VIVE DENTRO DEL FlatList (ListHeaderComponent), NO AL LADO.
  // ---------------------------------------------------------------------
  // Antes: <Pantalla scroll={false}><View>cabecera</View><FlatList/></Pantalla>
  // — dos hermanos repartiéndose el alto disponible vía flex, a través de
  // varios niveles (SafeAreaView > Pantalla > View > FlatList). En la
  // práctica no scrolleaba: se veían los primeros productos pero no había
  // forma de bajar más — y depurar POR QUÉ exigía confiar en que cada nivel
  // intermedio propagara flex:1 sin que nada lo rompiera.
  //
  // Con ListHeaderComponent el FlatList deja de tener un hermano con el que
  // repartirse el alto — ES la única superficie con scroll de la pantalla,
  // y la cabecera se desplaza como una fila más de su propio contenido. No
  // hay reparto de flex que pueda salir mal porque ya no hay nada que
  // repartir: es el patrón que React Native documenta para exactamente este
  // caso (encabezado + lista), no un ajuste de estilo.
  //
  // Se pasa como FUNCIÓN, no como elemento ya construido: así FlatList no la
  // re-monta de más entre renders.
  //
  // SOBRE EL MARGEN HORIZONTAL — una sola fuente, nunca el contenedor.
  // El primer intento de arreglo puso `paddingHorizontal: T.esp` aquí Y lo
  // dejó también en `contentContainerStyle` del FlatList (para la vista de
  // lista). Como ListHeaderComponent se renderiza DENTRO de ese contenedor,
  // el margen se sumaba dos veces en la cabecera y una sola vez en las
  // filas — la cabecera quedaba visiblemente más angosta que la lista.
  //
  // La solución de raíz: `contentContainerStyle` YA NO aporta ningún margen
  // horizontal (ver más abajo, `paddingHorizontal: 0` siempre). Cada bloque
  // visual pone el suyo:
  //   · Esta cabecera, aquí mismo.
  //   · Cada fila en vista de lista, al envolverla en el renderItem.
  //   · Cada fila en vista de cuadrícula, vía columnWrapperStyle.
  // Ningún nivel intermedio vuelve a aportar margen por su cuenta.
  // NO ES UN COMPONENTE, Y ESO ES A PROPÓSITO — EL TECLADO SE CERRABA
  // ------------------------------------------------------------------------
  // Antes esto era `function Cabecera()` y se pasaba como
  // `ListHeaderComponent={Cabecera}`. Al escribir en el buscador, cada letra
  // cambiaba el estado, InventarioScreen se volvía a renderizar, y JavaScript
  // creaba una función `Cabecera` NUEVA — idéntica en código, distinta en
  // identidad. React lo lee como "otro componente", no como el mismo
  // actualizado: desmonta el subárbol entero y monta uno nuevo. El TextInput
  // que tenía el foco dejaba de existir y Android cerraba el teclado. Había
  // que tocar el campo de nuevo por cada letra.
  //
  // Llamándola como función normal (`cabecera()` abajo), el JSX queda
  // inlineado en el render del padre: los tipos que React compara pasan a ser
  // View / TextInput / ScrollView, que son estables. No hay remontaje y el
  // foco sobrevive.
  //
  // Regla para no repetirlo: ningún componente definido dentro de otro
  // componente puede contener un TextInput. O se saca a nivel de módulo, o se
  // llama como función. Esto NO tiene que ver con KeyboardAvoidingView ni con
  // softwareKeyboardLayoutMode — ver el comentario del render, que resuelve
  // otro problema distinto (que el teclado tapaba las filas).
  function cabecera() {
    return (
          <View style={{ paddingHorizontal: T.esp }}>
            <Encabezado
              titulo="Inventario"
              acciones={
                /* Dos acciones en la misma fila. Yaxo va a la IZQUIERDA y
                   "Nuevo producto" se queda pegado al borde: el botón de
                   acento es el que se toca a diario y no puede moverse de
                   sitio, mientras que Yaxo ocupa la misma posición relativa
                   (primera de la fila de acciones) que en Inicio. Así el
                   acceso al asistente es el mismo gesto en las dos pantallas
                   sin desplazar lo que ya estaba.

                   `desde="inventario"` hace que Yaxo abra ordenando primero
                   "¿qué debo resurtir?", "¿qué tengo parado?" y "¿estoy
                   cobrando bien?" — sin ocultar el resto. */
                <View style={{ flexDirection: "row", alignItems: "center", gap: T.esps.sm }}>
                  <BotonYaxo desde="inventario" />
                  {/* "Nuevo producto" vive AQUÍ, no en un botón flotante.
                     Un flotante siempre tapa contenido mientras se desplaza la
                     lista — el relleno inferior evita que oculte el último
                     producto, pero no que se cruce por delante de los demás.
                     En la cabecera está igual de a mano, no tapa nada, y sigue
                     la misma regla que el resto de la app: nada flota encima
                     del contenido. */}
                  <Pressable
                    onPress={() => {
                      setProductoEditar(null);
                      setFormAbierto(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Crear producto"
                    hitSlop={8}
                    style={({ pressed }) => ({
                      width: 44,
                      height: 44,
                      borderRadius: T.radio,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: pressed ? T.acento : T.acentoRelleno,
                    })}
                  >
                    <IconoUI id="mas" size={22} color={T.acentoTexto} grosor={2.2} />
                  </Pressable>
                </View>
              }
            />
    
            {/* Acciones: fila FIJA de cinco, todas visibles.
                Antes era un scroller horizontal. Resolvía el problema
                anterior (cinco píldoras anchas se envolvían en dos filas
                desiguales) pero creaba otro: siempre había una entrada
                cortada por el borde derecho, y una lista que se corta a
                mitad de palabra es el patrón más reconocible de "plantilla".
                Además nada indicaba que se pudiera deslizar, así que
                "Proveedores" era invisible en la práctica.
                Con el icono arriba y la etiqueta debajo, las cinco caben en
                el ancho de cualquier teléfono: se ven todas, no se corta
                ninguna y no hay que descubrir un gesto. */}
            <View
              style={{
                flexDirection: "row",
                paddingBottom: T.esps.lg,
              }}
            >
              {ACCIONES.map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => accionar(a.id)}
                  android_ripple={{ color: T.acentoBorde, borderless: false }}
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      alignItems: "center",
                      justifyContent: "flex-start",
                      gap: 6,
                      paddingVertical: T.esps.md,
                      paddingHorizontal: 2,
                      borderRadius: T.radio,
                      backgroundColor: pressed ? T.superficie3 : "transparent",
                    },
                  ]}
                >
                  <IconoUI id={a.icono} size={20} color={T.textoSuave} />
                  <Txt
                    escala="micro"
                    tono="suave"
                    fuerte
                    lineas={2}
                    estilo={{ textAlign: "center" }}
                  >
                    {a.label}
                  </Txt>
                </Pressable>
              ))}
            </View>
    
            {/* Valor del inventario — la única protagonista de la pantalla:
                es la pregunta que un dueño se hace de verdad ("¿cuánto dinero
                tengo parado en el changarro?"), no un dato entre cinco.
                Se toca para alternar entre costo y precio de venta — la misma
                lámina responde dos preguntas sin pedir una segunda pantalla. */}
            {metricas ? (
              <View style={{ marginBottom: T.esps.lg }}>
                <Lamina onPress={() => setMostrarPrecioVenta((v) => !v)}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Txt escala="micro" tono="suave" fuerte mayus>
                      Valor de tu inventario
                    </Txt>
                    <View
                      style={{
                        flexDirection: "row",
                        backgroundColor: T.superficie2,
                        borderRadius: T.radioPildora,
                        padding: 2,
                      }}
                    >
                      <View
                        style={{
                          paddingHorizontal: T.esps.sm,
                          paddingVertical: 3,
                          borderRadius: T.radioPildora,
                          backgroundColor: mostrarPrecioVenta ? "transparent" : T.acentoRelleno,
                        }}
                      >
                        <Txt
                          escala="micro"
                          fuerte
                          estilo={!mostrarPrecioVenta ? { color: T.acentoTexto } : { color: T.textoTenue }}
                        >
                          Costo
                        </Txt>
                      </View>
                      <View
                        style={{
                          paddingHorizontal: T.esps.sm,
                          paddingVertical: 3,
                          borderRadius: T.radioPildora,
                          backgroundColor: mostrarPrecioVenta ? T.acentoRelleno : "transparent",
                        }}
                      >
                        <Txt
                          escala="micro"
                          fuerte
                          estilo={mostrarPrecioVenta ? { color: T.acentoTexto } : { color: T.textoTenue }}
                        >
                          Venta
                        </Txt>
                      </View>
                    </View>
                  </View>
                  <View style={{ marginTop: T.esps.xs }}>
                    <Monto
                      texto={pesos(
                        mostrarPrecioVenta
                          ? metricas.valor_precio_centavos
                          : metricas.valor_costo_centavos
                      )}
                      escala="protagonista"
                    />
                  </View>
                  <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.xs }}>
                    {mostrarPrecioVenta
                      ? "Si vendieras todo hoy, a precio de venta"
                      : "A costo de tus productos"}
                  </Txt>
    
                  <View
                    style={{
                      flexDirection: "row",
                      marginTop: T.esps.lg,
                      paddingTop: T.esps.lg,
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: T.borde,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Monto
                        texto={
                          metricas.margen_promedio != null
                            ? `${Math.round(metricas.margen_promedio)}%`
                            : "—"
                        }
                        escala="titulo"
                      />
                      <Txt escala="pie" tono="suave">
                        margen promedio
                      </Txt>
                    </View>
                    <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: T.borde }} />
                    <View style={{ flex: 1, paddingLeft: T.esps.lg }}>
                      <Monto texto={String(metricas.total_productos)} escala="titulo" />
                      <Txt escala="pie" tono="suave">
                        productos en catálogo
                      </Txt>
                    </View>
                  </View>
                </Lamina>
              </View>
            ) : null}
    
            {/* Alertas accionables: se ven como algo que se toca, porque se
                tocan — a diferencia de una tarjeta de métrica pasiva. */}
            {metricas && (metricas.stock_bajo > 0 || metricas.en_negativo > 0) ? (
              <View style={{ marginBottom: T.esps.lg }}>
                <Grupo>
                  {metricas.stock_bajo > 0 ? (
                    <Fila
                      titulo="Stock bajo"
                      meta="Por resurtir pronto"
                      icono={
                        <View
                          style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: T.alerta }}
                        />
                      }
                      valor={<Monto texto={String(metricas.stock_bajo)} escala="cuerpo" tono="alerta" />}
                      onPress={alternarStockBajo}
                      flecha={false}
                      destacado={soloStockBajo}
                    />
                  ) : null}
                  {metricas.en_negativo > 0 ? (
                    <Fila
                      titulo="En negativo"
                      meta="El stock quedó por debajo de cero — revisa el conteo"
                      icono={
                        <View
                          style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: T.peligro }}
                        />
                      }
                      valor={<Monto texto={String(metricas.en_negativo)} escala="cuerpo" tono="peligro" />}
                      onPress={alternarEnNegativo}
                      flecha={false}
                      destacado={soloEnNegativo}
                    />
                  ) : null}
                </Grupo>
              </View>
            ) : null}
    
            {/* Buscador */}
            <TextInput
              style={[estiloInput, { marginBottom: T.esps.md }]}
              placeholder="Buscar por nombre o código…"
              placeholderTextColor={T.textoTenue}
              value={busqueda}
              onChangeText={setBusqueda}
            />
    
            {/* Filtro de departamentos */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: T.esps.sm, paddingBottom: T.esps.md }}
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
    
            {soloStockBajo || soloEnNegativo ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: soloEnNegativo ? T.peligroSuave : T.alertaSuave,
                  borderRadius: T.radioChico,
                  paddingHorizontal: T.esps.lg,
                  paddingVertical: T.esps.md,
                  marginBottom: T.esps.md,
                }}
              >
                <Txt escala="pie" tono={soloEnNegativo ? "peligro" : "alerta"} fuerte>
                  {soloEnNegativo ? "Mostrando solo en negativo" : "Mostrando solo stock bajo"}
                </Txt>
                <Pressable
                  onPress={quitarFiltroAlerta}
                  hitSlop={10}
                  style={{ minHeight: 32, justifyContent: "center" }}
                >
                  <Txt escala="pie" tono={soloEnNegativo ? "peligro" : "alerta"} fuerte>
                    Quitar ✕
                  </Txt>
                </Pressable>
              </View>
            ) : null}
    
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: T.esps.sm,
              }}
            >
              <Txt escala="pie" tono="tenue" fuerte>
                {productos.length} producto{productos.length === 1 ? "" : "s"}
              </Txt>
              <SelectorVista vista={vista} onCambio={setVista} />
            </View>
          </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.fondo }} edges={["top"]}>
        {/* EL TECLADO TAPABA EL BUSCADOR Y LAS FILAS DE ABAJO
            ------------------------------------------------------------------
            Esta pantalla NO usa <Pantalla>: monta SafeAreaView > FlatList
            directamente (ver el comentario de la cabecera), así que no
            heredaba nada del manejo de teclado. Y app.json no basta:
            `softwareKeyboardLayoutMode: "resize"` deja de redimensionar la
            ventana cuando `edgeToEdgeEnabled` está activo — la app dibuja por
            debajo del teclado en vez de encogerse.

            "padding" y no "height", igual que en <Hoja>: "height" anima la
            altura del contenedor y rebota al cerrarse el teclado.

            Envuelve SOLO la lista, no los modales: cada modal trae su propio
            <Hoja>, que ya resuelve lo suyo. Anidar dos capas que empujan el
            contenido las haría sumarse. */}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {/* El FlatList es la ÚNICA superficie con scroll de la pantalla: la
            cabecera entra como ListHeaderComponent, así no hay ningún
            reparto de flex entre hermanos que pueda salir mal. */}
        {cargando ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator size="large" color={T.acento} />
          </View>
        ) : (
          <FlatList
            ref={listaRef}
            style={{ flex: 1 }}
            data={filas}
            // Sin `key={vista}` y sin `numColumns`: es justo lo que evita el
            // remontaje completo al cambiar de vista (ver el comentario de
            // arriba, donde se arman `filas`). El FlatList de abajo es
            // SIEMPRE de una sola columna; lista y cuadrícula son solo
            // formas distintas de dibujar cada fila.
            keyExtractor={(fila, i) => fila[0]?.id ?? `fila-${i}`}
            // Sin paddingHorizontal aquí — a propósito. Ver el comentario en
            // Cabecera() de arriba: si el contenedor también aporta margen,
            // se suma con el de cada fila, y algo queda con el doble.
            contentContainerStyle={{
              paddingHorizontal: 0,
              // Antes 96, para que el botón flotante no tapara el último
              // producto. Ese botón ya no existe (se movió a la cabecera),
              // así que solo hace falta aire para no pegar la lista al borde.
              paddingBottom: T.esps.xxl,
              gap: T.esps.sm,
            }}
            refreshControl={
              <RefreshControl refreshing={refrescando} onRefresh={onRefresh} tintColor={T.acento} />
            }
            // `cabecera()` con paréntesis: se pasa el ELEMENTO ya construido,
            // no el tipo de componente. Ver el comentario de `cabecera` arriba
            // — es lo que impide que el teclado se cierre en cada letra.
            ListHeaderComponent={cabecera()}
            ListEmptyComponent={
              <View style={{ paddingHorizontal: T.esp }}>
                <Vacio
                  titulo={hayFiltros ? "Sin resultados con estos filtros" : "Todavía no hay productos"}
                  texto={
                    hayFiltros
                      ? "Prueba con otra palabra, quita el filtro de departamento o el de stock bajo."
                      : "Toca el botón + para crear el primero, o escanea un ticket de compra para darlos de alta de golpe."
                  }
                />
              </View>
            }
            renderItem={({ item: fila }) => (
              <View
                style={{
                  flexDirection: "row",
                  gap: T.esps.sm,
                  paddingHorizontal: T.esp,
                }}
              >
                {fila.map((p) =>
                  vista === "lista" ? (
                    <TarjetaProducto
                      key={p.id}
                      item={p}
                      onEditar={abrirEditar}
                      onAjustar={abrirAjuste}
                    />
                  ) : (
                    <TarjetaGrid key={p.id} item={p} cols={cols} onEditar={abrirEditar} />
                  )
                )}
                {/* Rellenos invisibles en la última fila de cuadrícula: sin
                    esto, si faltan piezas para completar la fila, las que sí
                    hay se estiran de más (cada una es flex:1) y el grid deja
                    de verse alineado con las filas de arriba. */}
                {vista !== "lista" &&
                  Array.from({ length: cols - fila.length }, (_, i) => (
                    <View key={`relleno-${i}`} style={{ flex: 1 }} />
                  ))}
              </View>
            )}
          />
        )}
        </KeyboardAvoidingView>

      {/* FAB crear */}

      {/* Modales (montaje condicional = estado fresco) */}
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
        <ModalDepartamentos onCerrar={() => setDeptosAbierto(false)} onCambio={cargar} />
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
        <ModalConteo onCerrar={() => setConteoAbierto(false)} onAplicado={cerrarYRecargar} />
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
        <ModalProveedores onCerrar={() => setProveedoresAbierto(false)} onCambio={cargar} />
      )}
    </SafeAreaView>
  );
}

// ===========================================================================
// Tarjetas memoizadas — mismo patrón y misma razón que en Vender: el botón ±
// invita a toques repetidos, y sin memo cada toque re-renderiza toda la
// lista visible en vez de solo la tarjeta tocada.
// ===========================================================================

function TarjetaProductoBase({
  item,
  onEditar,
  onAjustar,
}: {
  item: ProductoLista;
  onEditar: (p: Producto) => void;
  onAjustar: (p: Producto) => void;
}) {
  const { tema: T } = useTema();
  const esKit = item.es_kit === 1;
  const bajo = !esKit && item.controla_stock === 1 && item.stock <= item.stock_minimo;
  return (
    <Pressable
      android_ripple={{ color: T.acentoBorde }}
      onPress={() => onEditar(item)}
      style={({ pressed }) => [
        {
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: T.superficie,
          borderRadius: T.radio,
          overflow: "hidden",
          minHeight: 72,
        },
        pressed && { backgroundColor: T.superficie2 },
      ]}
    >
      {/* Filo de color del departamento: el mismo lenguaje que la lámina. */}
      <View style={{ width: 3, alignSelf: "stretch", backgroundColor: item.categoria_color ?? T.borde }} />
      <View
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: T.esps.md,
          padding: T.esps.md,
        }}
      >
        <ImagenProducto
          uri={item.imagen_uri}
          nombre={item.nombre}
          color={item.categoria_color}
          icono={item.categoria_icono}
          size={46}
          radio={11}
        />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: T.esps.sm }}>
            <Txt escala="cuerpo" fuerte lineas={1} estilo={{ flexShrink: 1 }}>
              {item.nombre}
            </Txt>
            {esKit ? <Insignia texto="KIT" color={T.acento} /> : null}
          </View>
          <Txt escala="pie" tono="tenue" lineas={1} estilo={{ marginTop: 2 }}>
            {item.categoria_nombre ?? "Sin depto."}
            {item.codigo_barras ? `  ·  ${item.codigo_barras}` : ""}
          </Txt>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Monto texto={pesos(item.precio_venta_centavos)} escala="cuerpo" />
          {esKit ? (
            <Txt escala="micro" tono="suave" estilo={{ marginTop: 2 }}>
              arma {item.kit_disponible ?? 0}
            </Txt>
          ) : item.controla_stock === 1 ? (
            <Txt
              escala="micro"
              tono={bajo ? "peligro" : "suave"}
              fuerte={bajo}
              estilo={{ marginTop: 2 }}
            >
              {fmtStock(item.stock, item.unidad)}
              {bajo ? " ▼" : ""}
            </Txt>
          ) : (
            <Txt escala="micro" tono="tenue" estilo={{ marginTop: 2 }}>
              sin control
            </Txt>
          )}
        </View>
        {!esKit && item.controla_stock === 1 ? (
          <Pressable
            onPress={() => onAjustar(item)}
            hitSlop={8}
            android_ripple={{ color: T.acentoBorde, borderless: true }}
            style={({ pressed }) => [
              {
                width: 34,
                height: 34,
                borderRadius: T.radioChico,
                backgroundColor: T.superficie2,
                alignItems: "center",
                justifyContent: "center",
              },
              pressed && { backgroundColor: T.acentoSuave },
            ]}
          >
            <Txt escala="cuerpo" fuerte>
              ±
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}
const TarjetaProducto = memo(TarjetaProductoBase);

function TarjetaGridBase({
  item,
  cols,
  onEditar,
}: {
  item: ProductoLista;
  cols: number;
  onEditar: (p: Producto) => void;
}) {
  const { tema: T } = useTema();
  const esKit = item.es_kit === 1;
  const bajo = !esKit && item.controla_stock === 1 && item.stock <= item.stock_minimo;
  const chico = cols >= 4;
  return (
    <Pressable
      android_ripple={{ color: T.acentoBorde }}
      onPress={() => onEditar(item)}
      style={({ pressed }) => [
        {
          flex: 1,
          alignItems: "center",
          backgroundColor: T.superficie,
          borderRadius: T.radio,
          paddingVertical: T.esps.md,
          paddingHorizontal: T.esps.sm,
          borderWidth: bajo ? 1 : 0,
          borderColor: bajo ? T.peligro : "transparent",
        },
        pressed && { transform: [{ scale: 0.96 }], backgroundColor: T.superficie2 },
      ]}
    >
      <ImagenProducto
        uri={item.imagen_uri}
        nombre={item.nombre}
        color={item.categoria_color}
        icono={item.categoria_icono}
        size={chico ? 44 : cols === 2 ? 78 : 60}
        radio={chico ? 11 : 14}
      />
      <Txt
        escala={chico ? "micro" : "pie"}
        lineas={2}
        estilo={{ textAlign: "center", marginTop: T.esps.sm, minHeight: chico ? 24 : 30 }}
      >
        {item.nombre}
      </Txt>
      <Monto texto={pesos(item.precio_venta_centavos)} escala={chico ? "micro" : "pie"} tono="acento" />
      {!esKit && item.controla_stock === 1 ? (
        <Txt
          escala="micro"
          tono={bajo ? "peligro" : "tenue"}
          fuerte={bajo}
          estilo={{ marginTop: 2 }}
        >
          {fmtStock(item.stock, item.unidad)}
        </Txt>
      ) : null}
    </Pressable>
  );
}
const TarjetaGrid = memo(TarjetaGridBase);

// ---------------------------------------------------------------------------
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
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: T.acentoBorde }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: T.esps.xs,
        minHeight: 38,
        paddingHorizontal: T.esps.lg,
        borderRadius: T.radioPildora,
        backgroundColor: activo ? (color ?? T.acentoRelleno) : T.superficie2,
      }}
    >
      {color && !activo ? (
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      ) : null}
      <Txt
        escala="pie"
        fuerte={activo}
        tono="suave"
        estilo={activo ? { color: T.acentoTexto } : undefined}
      >
        {label}
      </Txt>
    </Pressable>
  );
}