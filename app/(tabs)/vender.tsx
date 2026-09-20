// YvexPOS Móvil — Pantalla VENDER (táctil, por departamentos).
//
// Flujo pensado para dedos y catálogos grandes:
//   1. Ves los DEPARTAMENTOS como tarjetas grandes con icono y color.
//   2. Tocas "Bebidas" -> entras y ves SUS productos (no todos revueltos).
//   3. Tocas el producto -> entra al ticket, con contador en la tarjeta.
// Botón de escáner para el lector de códigos y lupa para buscar. Vista
// configurable: cuadrícula 2/3/4 o lista.
//
// ---------------------------------------------------------------------------
// QUÉ CAMBIÓ EN LA REESTRUCTURA
// ---------------------------------------------------------------------------
// 1. LA BARRA DEL TICKET APARECE SOLO CUANDO HAY ALGO QUE COBRAR.
//    Antes ocupaba alto permanente con "TICKET VACÍO · $0.00 · Cliente ·
//    Cobrar(apagado)". En un punto de venta el alto es lo más caro que hay:
//    cada franja fija es una fila de productos que el tendero NO ve y tiene
//    que buscar desplazándose. Con el ticket vacío no hay nada que cobrar,
//    así que la barra se retira y la cuadrícula recupera ese espacio.
//
// 2. EL TICKET SE JALA HACIA ARRIBA. La barra es también el tirador: se
//    arrastra para revisar las líneas sin salir de la cuadrícula, o se toca.
//    Es EL MISMO gesto y la misma física que el panel de Herramientas en
//    Inicio. Cuando dos partes distintas de la app responden igual al mismo
//    gesto, el producto se siente diseñado en vez de ensamblado.
//    El gesto nunca es la única vía: tocar hace exactamente lo mismo.
//
// 3. FUERA EL WORDMARK. "YvexPOS" se repetía sobre el título en las cinco
//    pestañas, robando altura. La marca vive en el ícono de la app.
//
// ---------------------------------------------------------------------------
// POR QUÉ HABÍA RETRASO ENTRE TOCAR UN PRODUCTO Y VER EL BORDE DE SELECCIÓN
// ---------------------------------------------------------------------------
// No era percepción: `agregar`, `cambiarCantidad` y `quitarLinea` se creaban
// de NUEVO en cada render (funciones normales, no memoizadas), y el
// `renderItem` de la cuadrícula era una función inline definida dentro del
// JSX. Cada vez que se tocaba un producto, `setCarrito` disparaba un
// re-render de TODA la pantalla, lo que recreaba `renderItem` con una
// identidad distinta — y React vuelve a ejecutar esa función para cada
// celda visible, no solo la tocada. Con 30-50 productos en pantalla, cada
// toque repetía el trabajo de montar 30-50 imágenes e íconos, y el navegador
// de gestos de Android negocia el toque contra el scroll del FlatList por
// encima de todo eso. El resultado es justo lo que describes: el toque se
// registra, pero el borde tarda en aparecer porque hay un re-render enorme
// de por medio.
//
// La corrección: las tarjetas (`TarjetaProducto`, `FilaProducto`,
// `TarjetaDepartamento`) son componentes memoizados con `React.memo`, y las
// funciones que reciben como props (`agregar`, `cambiarCantidad`,
// `quitarLinea`) están envueltas en `useCallback` con dependencias vacías —
// nunca cambian de identidad. Así, aunque `renderItem` se vuelva a llamar
// para las 50 celdas, React compara las props de cada tarjeta memoizada
// contra las anteriores: si el número de piezas en el carrito de ESE
// producto no cambió, la tarjeta ni siquiera vuelve a ejecutar su función de
// render. Solo la tocada. El resto del trabajo desaparece.
//
// Se añadió también `android_ripple` en las tarjetas: es una capa de
// retroalimentación nativa que Android pinta sin esperar una vuelta al hilo
// de JavaScript, así el toque se siente instantáneo incluso en el instante
// entre el toque físico y el commit del estado de React.
//
// ---------------------------------------------------------------------------
// POR QUÉ EL BOTÓN ATRÁS DEL SISTEMA MANDABA A INICIO EN VEZ DE RETROCEDER
// ---------------------------------------------------------------------------
// Estar "dentro de un departamento" es un estado local de esta pantalla
// (`seleccion`), no una ruta de navegación. El botón físico/gesto Atrás de
// Android no sabe nada de ese estado: por defecto, la navegación de pestañas
// lo interpreta como "salir de esta pestaña", y sin historial explícito cae
// al comportamiento por defecto de saltar a la pestaña inicial. Pasaba en
// cualquier pestaña porque es un comportamiento del NAVEGADOR de pestañas,
// no de esta pantalla en particular.
//
// Se resuelve en dos niveles:
//   1. Aquí, con `BackHandler`: si hay búsqueda abierta o un departamento
//      seleccionado, Atrás los cierra PRIMERO y no deja que el evento siga
//      subiendo. Solo si ya estás en la pantalla de departamentos, Atrás
//      actúa con su comportamiento normal de navegación.
//   2. En `app/(tabs)/_layout.tsx`, con `backBehavior="history"`: así Atrás
//      regresa a la pestaña que visitaste antes, no siempre a Inicio.
// Este mismo patrón de `BackHandler` habrá que repetirlo en cualquier otra
// pantalla con un nivel de navegación local (por ejemplo, el detalle de un
// producto dentro de Inventario) cuando lleguemos a ella.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  TextInput,
  Pressable,
  StyleSheet,
  FlatList,
  Modal,
  ScrollView,
  Switch,
  PanResponder,
  Platform,
  BackHandler,
  Text,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
} from "react-native";
// Ver el porqué en ui.tsx: el KeyboardAvoidingView de React Native encoge el
// contenedor pero no desplaza hasta el campo enfocado, y en una pantalla
// completa como ésta el cajero tenía que arrastrar a mano para ver lo que
// había debajo del importe.
import {
  KeyboardAwareScrollView,
  KeyboardAvoidingView,
} from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import BotonYaxo from "@/src/componentes/BotonYaxo";
import { useFocusEffect } from "expo-router";
import {
  Turno,
  ItemCarrito,
  MetodoPago,
  PagoEntrada,
  ResultadoCobro,
  turnoActivo,
  abrirTurno,
  cobrar,
} from "@/src/base/venta";
import {
  Producto,
  ProductoLista,
  Categoria,
  listarProductos,
  listarCategorias,
  buscarPorCodigo,
  conteoPorDepartamento,
} from "@/src/base/inventario";
import { pesos, aCentavos, centavosATexto } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import {
  Boton,
  Banner,
  CabeceraModal,
  Campo,
  useEstiloInput,
  Txt,
  Monto,
  Hoja,
  Vacio,
} from "@/src/componentes/ui";
import ImagenProducto from "@/src/componentes/ImagenProducto";
import { Icono, IconoUI } from "@/src/componentes/iconos";
import SelectorVista, { Vista, columnasDe } from "@/src/componentes/SelectorVista";
import { leerModoUso, ModoUso } from "@/src/base/modoUso";
import ModalTicket from "@/src/componentes/ModalTicket";
import { construirTicket, TicketVenta } from "@/src/base/ticket";
import EscanerCamara from "@/src/componentes/EscanerCamara";
import FormularioProducto from "@/src/componentes/FormularioProducto";
import ModalClienteVenta from "@/src/componentes/ModalClienteVenta";
import {
  Cliente,
  ReglasLealtad,
  leerReglas,
  acumularPorVenta,
  canjearPuntos,
} from "@/src/base/lealtad";
import { descuentoPorCanje } from "@/src/base/lealtadReglas";
import { verificarLimite } from "@/src/base/credito";
import {
  normalizarCodigo,
  buscarProductoPorCodigo,
  consultarNombreUniversal,
} from "@/src/base/codigos";
import { tomarCotizacionPendiente } from "@/src/base/handoff";
import { marcarConvertida } from "@/src/base/cotizaciones";

// Departamento seleccionado: null = pantalla de departamentos; "__todos__" =
// todo el catálogo; un id = ese departamento.
type Seleccion = null | "__todos__" | string;

type Tema = ReturnType<typeof useTema>["tema"];

export default function VenderScreen() {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const estiloInput = useEstiloInput();
  const [turno, setTurno] = useState<Turno | null | undefined>(undefined);
  const [fondo, setFondo] = useState("");
  const [error, setError] = useState("");

  const [productos, setProductos] = useState<ProductoLista[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [conteos, setConteos] = useState<Map<string, number>>(new Map());
  const [seleccion, setSeleccion] = useState<Seleccion>(null);
  const [vista, setVista] = useState<Vista>("grid3");

  const [buscando, setBuscando] = useState(false);
  const [busqueda, setBusqueda] = useState("");

  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [ticketAbierto, setTicketAbierto] = useState(false);
  const [cobroAbierto, setCobroAbierto] = useState(false);
  const [ticketCobrado, setTicketCobrado] = useState<TicketVenta | null>(null);

  // Escáner de códigos de barras (cámara) y aviso breve tipo toast.
  const [escanerAbierto, setEscanerAbierto] = useState(false);
  const [aviso, setAviso] = useState<{
    texto: string;
    accion?: { label: string; onPress: () => void };
  } | null>(null);
  const avisoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Alta de producto desde un código desconocido (prellenado, usuario confirma).
  const [formNuevo, setFormNuevo] = useState<{ codigo: string; nombre: string | null } | null>(
    null
  );

  function mostrarAviso(texto: string, accion?: { label: string; onPress: () => void }) {
    if (avisoTimer.current) clearTimeout(avisoTimer.current);
    setAviso({ texto, accion });
    avisoTimer.current = setTimeout(() => setAviso(null), 4000);
  }

  useEffect(
    () => () => {
      if (avisoTimer.current) clearTimeout(avisoTimer.current);
    },
    []
  );

  // Modo de uso: en "monitor" este dispositivo no cobra (guarda más abajo,
  // tras los hooks).
  const [modo, setModo] = useState<ModoUso | null>(null);

  // Programa de lealtad: cliente ligado al ticket (null = venta de mostrador)
  // y reglas vigentes (si está apagado, no aparece el botón Cliente).
  const [clienteTicket, setClienteTicket] = useState<Cliente | null>(null);
  const [reglas, setReglas] = useState<ReglasLealtad | null>(null);
  const [modalClienteAbierto, setModalClienteAbierto] = useState(false);
  // Si este ticket viene de "Convertir a venta" en Cotizaciones, aquí queda
  // su id hasta que el cobro tenga éxito — entonces se marca "convertida".
  const [cotizacionIdEnCurso, setCotizacionIdEnCurso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const [t, prods, cats, cnt, m, r] = await Promise.all([
      turnoActivo(),
      listarProductos({}),
      listarCategorias(),
      conteoPorDepartamento(),
      leerModoUso(),
      leerReglas(),
    ]);
    setTurno(t);
    setProductos(prods);
    setCategorias(cats);
    setConteos(cnt);
    setModo(m);
    setReglas(r);

    // ¿Venimos de "Convertir a venta" en Cotizaciones? Carga el carrito con
    // el precio QUE SE COTIZÓ (aunque el catálogo haya cambiado desde
    // entonces — cotizar es prometer un precio, no una referencia).
    const cot = tomarCotizacionPendiente();
    if (cot) {
      setCarrito(
        cot.lineas.map((l) => ({
          producto_id: l.producto_id ?? `cot-${l.id}`,
          nombre: l.descripcion,
          precio_centavos: l.precio_unitario_centavos,
          cantidad: l.cantidad,
          es_kit: false,
        }))
      );
      setCotizacionIdEnCurso(cot.id);
      setTicketAbierto(true);
      mostrarAviso(`Cotización #${cot.folio} cargada — cobra normal para convertirla en venta.`);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar])
  );

  // Atrás del sistema: primero cierra lo que hay abierto AQUÍ (búsqueda,
  // departamento) antes de dejar que la navegación de pestañas reaccione.
  // Solo se activa mientras esta pantalla tiene el foco (useFocusEffect),
  // así no intercepta el botón Atrás cuando el usuario está en otra pestaña.
  useFocusEffect(
    useCallback(() => {
      const alPresionarAtras = () => {
        if (buscando) {
          setBuscando(false);
          setBusqueda("");
          return true; // evento consumido: no sigue subiendo
        }
        if (seleccion !== null) {
          setSeleccion(null);
          return true;
        }
        return false; // nada que cerrar aquí: comportamiento normal
      };
      const sub = BackHandler.addEventListener("hardwareBackPress", alPresionarAtras);
      return () => sub.remove();
    }, [buscando, seleccion])
  );

  // Guarda de modo Monitoreo: la pestaña Vender se oculta, pero si alguien
  // llega aquí por una ruta vieja, ve el motivo en vez de la caja.
  if (modo === "monitor") {
    return (
      <SafeAreaView style={est.raiz} edges={["top"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: T.esp }}>
          <IconoUI id="reportes" size={34} color={T.textoTenue} />
          <View style={{ marginTop: T.esps.lg, alignItems: "center", gap: T.esps.sm }}>
            <Txt escala="cuerpo" fuerte estilo={{ textAlign: "center" }}>
              Este dispositivo está en modo Monitoreo.
            </Txt>
            <Txt escala="pie" tono="suave" estilo={{ textAlign: "center" }}>
              Puedes cambiarlo en Ajustes.
            </Txt>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const total = carrito.reduce((s, i) => s + Math.round(i.precio_centavos * i.cantidad), 0);
  const articulos = carrito.reduce((s, i) => s + i.cantidad, 0);
  // Qué lleva el ticket, en una sola línea. Se muestran los dos primeros y
  // el resto se cuenta ("+3"), porque el objetivo es reconocer de un
  // vistazo, no leer el detalle: para eso está abrir el ticket.
  const resumenTicket = useMemo(() => {
    if (carrito.length === 0) return "";
    // Se corta por LONGITUD, no por número de productos. Limitarlo a "los
    // dos primeros" funcionaba con nombres cortos, pero con dos como
    // "6 Bote Bud Light" la línea se pasaba de ancho y se veía cortada a la
    // mitad — peor que no mostrar nada, porque parece un fallo.
    const MAX = 34;
    const partes: string[] = [];
    let largo = 0;
    for (const i of carrito) {
      const cant = i.cantidad % 1 === 0 ? i.cantidad : Number(i.cantidad.toFixed(2));
      const txt = cant > 1 ? `${cant}× ${i.nombre}` : i.nombre;
      if (partes.length > 0 && largo + txt.length > MAX) break;
      partes.push(txt);
      largo += txt.length + 3; // " · "
    }
    const restantes = carrito.length - partes.length;
    if (restantes > 0) partes.push(`+${restantes}`);
    return partes.join(" · ");
  }, [carrito]);
  const cantidadDe = (id: string) => carrito.find((i) => i.producto_id === id)?.cantidad ?? 0;

  // Productos visibles según la selección y la búsqueda.
  const q = busqueda.trim().toLowerCase();
  const coincide = (p: ProductoLista) =>
    p.nombre.toLowerCase().includes(q) ||
    (p.codigo_barras ?? "").toLowerCase().includes(q);

  const visibles = productos.filter((p) => {
    // Búsqueda GLOBAL: la lupa desde la pantalla de departamentos. Ignora la
    // selección a propósito — se busca en todo el catálogo. Sin cambios.
    if (buscando && q) return coincide(p);

    let enSeleccion: boolean;
    if (seleccion === "__todos__") enSeleccion = true;
    else if (seleccion === "__sin__") enSeleccion = p.categoria_id === null;
    else enSeleccion = p.categoria_id === seleccion;
    if (!enSeleccion) return false;

    // Búsqueda DENTRO de la lista abierta. Es lo que hace útil tener el campo
    // siempre a la vista: con 216 productos, desplazarse hasta encontrar uno
    // no es opción, y la lupa escondida en la cabecera no se ve a simple
    // vista. Aquí sí se filtra respetando el departamento en el que estás.
    if (q) return coincide(p);
    return true;
  });

  const sinDepto = conteos.get("__sin__") ?? 0;
  const catActual = categorias.find((c) => c.id === seleccion);

  // Memoizadas con dependencias vacías: usan setCarrito funcional (prev =>
  // ...), así que nunca necesitan leer nada de fuera. Su identidad no cambia
  // NUNCA entre renders — es justo lo que permite que las tarjetas
  // memoizadas de abajo funcionen: si la función que reciben como prop
  // cambiara de referencia en cada render, el memo se rompería igual que
  // antes, solo que de forma más difícil de detectar.
  const agregar = useCallback((p: Producto | ProductoLista) => {
    setCarrito((prev) => {
      const ya = prev.find((i) => i.producto_id === p.id);
      if (ya)
        return prev.map((i) =>
          i.producto_id === p.id ? { ...i, cantidad: i.cantidad + 1 } : i
        );
      return [
        ...prev,
        {
          producto_id: p.id,
          nombre: p.nombre,
          precio_centavos: p.precio_venta_centavos,
          cantidad: 1,
          es_kit: p.es_kit === 1,
        },
      ];
    });
  }, []);

  const cambiarCantidad = useCallback((id: string, delta: number) => {
    setCarrito((prev) =>
      prev
        .map((i) => (i.producto_id === id ? { ...i, cantidad: i.cantidad + delta } : i))
        .filter((i) => i.cantidad > 0)
    );
  }, []);

  /** Un código leído por la cámara (modo continuo). REGLA DE NEGOCIO: solo
   *  AGREGA al ticket o PRELLENA el alta; el tendero siempre confirma. */
  async function alEscanear(raw: string) {
    const codigo = normalizarCodigo(raw);
    const p = await buscarProductoPorCodigo(codigo);
    if (p) {
      const sinStock = p.es_kit === 0 && p.controla_stock === 1 && p.stock <= 0;
      if (sinStock) {
        mostrarAviso(`"${p.nombre}" no tiene stock. No se agregó al ticket.`);
      } else {
        agregar(p);
        mostrarAviso(`Agregado: ${p.nombre}`);
      }
      return;
    }
    // Código desconocido: cerramos el escáner y ofrecemos crearlo (el botón
    // del aviso queda accesible; con nombre universal si hay).
    setEscanerAbierto(false);
    mostrarAviso(`Código nuevo: ${codigo}`, {
      label: "Crear producto",
      onPress: async () => {
        setAviso(null);
        const nombre = await consultarNombreUniversal(codigo);
        setFormNuevo({ codigo, nombre });
      },
    });
  }

  /** Quita una línea completa del ticket. */
  const quitarLinea = useCallback((id: string) => {
    setCarrito((prev) => prev.filter((i) => i.producto_id !== id));
  }, []);

  // --- Cambiar el precio de una línea, solo para este ticket ---
  // Mantener presionada una línea abre esto. El catálogo NUNCA se toca —
  // es una rebaja de una sola venta. Si después se agrega más del mismo
  // producto (botón +), la cantidad nueva hereda el precio ya rebajado,
  // porque cambiarCantidad() solo toca `cantidad`, nunca el precio.
  const [editandoPrecio, setEditandoPrecio] = useState<ItemCarrito | null>(null);
  const [nuevoPrecioTexto, setNuevoPrecioTexto] = useState("");

  const abrirEditarPrecio = useCallback((item: ItemCarrito) => {
    setEditandoPrecio(item);
    setNuevoPrecioTexto(centavosATexto(item.precio_centavos));
  }, []);

  function confirmarNuevoPrecio() {
    if (!editandoPrecio) return;
    const nuevo = aCentavos(nuevoPrecioTexto);
    if (nuevo < 0) return;
    // El precio "de catálogo" real es el que ya traía ANTES de esta
    // edición — si la línea ya estaba rebajada y se vuelve a editar, no se
    // pierde el original de verdad por el que ya se había cambiado antes.
    const original = editandoPrecio.precio_original_centavos ?? editandoPrecio.precio_centavos;
    setCarrito((prev) =>
      prev.map((i) =>
        i.producto_id === editandoPrecio.producto_id
          ? {
              ...i,
              precio_centavos: nuevo,
              // Si el usuario vuelve a poner el precio de catálogo, ya no
              // es una rebaja — se quita la marca en vez de guardar un
              // descuento de $0 sin sentido.
              precio_original_centavos: nuevo === original ? undefined : original,
            }
          : i
      )
    );
    setEditandoPrecio(null);
  }

  function quitarRebaja() {
    if (!editandoPrecio) return;
    const original = editandoPrecio.precio_original_centavos ?? editandoPrecio.precio_centavos;
    setCarrito((prev) =>
      prev.map((i) =>
        i.producto_id === editandoPrecio.producto_id
          ? { ...i, precio_centavos: original, precio_original_centavos: undefined }
          : i
      )
    );
    setEditandoPrecio(null);
  }

  const vaciarTicket = useCallback(() => {
    setCarrito([]);
    setClienteTicket(null);
    setTicketAbierto(false);
  }, []);

  async function enviarBusqueda() {
    const t = busqueda.trim();
    if (!t) return;
    const porCodigo = await buscarPorCodigo(t);
    if (porCodigo) {
      agregar(porCodigo);
      setBusqueda("");
    }
  }

  async function abrir() {
    setError("");
    try {
      const t = await abrirTurno(fondo.trim() === "" ? 0 : aCentavos(fondo));
      setTurno(t);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  // ⚠️ ESTE useMemo VA AQUÍ, ANTES DE CUALQUIER `return` ANTICIPADO.
  //
  // Lo puse por error más abajo, junto a `cols`, que está DESPUÉS de los
  // returns de "turno === undefined" y "!turno". Resultado: en los renders
  // que salían por ahí el hook no se ejecutaba, y React reventaba con
  // "Rendered more hooks than during the previous render". Las reglas de
  // hooks exigen que TODOS se llamen siempre, en el mismo orden.
  // Agrupación por departamento — SOLO en la vista lista, y solo cuando se
  // está viendo el catálogo entero sin filtrar.
  //
  // Por qué solo ahí: dentro de un departamento el encabezado sería el mismo
  // en todas las filas (ruido), y en una búsqueda el orden lo manda la
  // relevancia, no la categoría. Y solo en lista porque en cuadrícula los
  // encabezados romperían las columnas.
  //
  // No pide nada nuevo a la base: `categoria_nombre` ya viaja en cada
  // producto (ver ProductoLista en inventario.ts).
  type FilaSeparador = { _sep: true; id: string; titulo: string; n: number };
  const datosLista = useMemo<(ProductoLista | FilaSeparador)[]>(() => {
    if (vista !== "lista") return visibles;
    const salida: (ProductoLista | FilaSeparador)[] = [];
    let actual: string | null = null;
    let iSep = -1;
    for (const p of visibles) {
      const dep = p.categoria_nombre ?? "Sin departamento";
      if (dep !== actual) {
        actual = dep;
        salida.push({ _sep: true, id: `sep-${dep}-${salida.length}`, titulo: dep, n: 0 });
        iSep = salida.length - 1;
      }
      salida.push(p);
      const sep = salida[iSep] as FilaSeparador;
      sep.n += 1;
    }
    return salida;
  }, [vista, visibles]);

  if (turno === undefined) return <SafeAreaView style={est.raiz} />;

  // ---------------- Sin turno ----------------
  if (!turno) {
    return (
      <SafeAreaView style={est.raiz} edges={["top"]}>
        <View style={{ flex: 1, justifyContent: "center", padding: T.esp }}>
          <Txt escala="titulo" fuerte>
            Abrir turno
          </Txt>
          <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.sm, marginBottom: T.esps.xl }}>
            ¿Con cuánto efectivo abre el cajón? Puedes dejarlo vacío para
            empezar sin fondo.
          </Txt>
          <Banner texto={error} tipo="error" />
          <CampoMonto
            estilo={[estiloInput, est.montoInput]}
            valor={fondo}
            onCambio={setFondo}
            pista="$ 0.00"
            onSubmitEditing={abrir}
          />
          <View style={est.rapidos}>
            {["0", "200", "500", "1000"].map((m) => (
              <Pressable key={m} style={est.rapido} onPress={() => setFondo(m)}>
                <Txt escala="pie" tono="suave" fuerte>
                  {m === "0" ? "Sin fondo" : `$${m}`}
                </Txt>
              </Pressable>
            ))}
          </View>
          <Boton titulo="Abrir turno" onPress={abrir} />
        </View>
      </SafeAreaView>
    );
  }

  const enDeptos = seleccion === null && !(buscando && q);
  const cols = columnasDe(vista);

  const hayTicket = carrito.length > 0;

  return (
    <SafeAreaView style={est.raiz} edges={["top"]}>
      {/* EL TECLADO TAPABA LA LISTA DE PRODUCTOS
          ------------------------------------------------------------------
          El buscador vive en la cabecera, arriba, así que se veía siempre —
          pero al escribir, los resultados quedaban DEBAJO del teclado y no
          había forma de llegar a ellos sin cerrarlo. Que es justo lo que se
          hace al buscar: escribir y mirar lo que sale.

          Envuelve cabecera + lista, no los modales: cada uno trae su propio
          <Hoja>, y anidar dos capas que empujan haría que se sumaran. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      {/* Cabecera: atrás (si estás dentro), título, Yaxo, escáner, lupa.
          Sin wordmark: recupera una línea de alto en cada pantalla.

          YAXO VA PRIMERO DE LA FILA DE ICONOS, igual que en Inventario: el
          escáner y la lupa son las herramientas de esta pantalla y se quedan
          pegadas al borde, donde el pulgar ya las busca sin mirar. Mover una
          herramienta que se toca cien veces al día para hacerle sitio al
          asistente sería el peor intercambio posible.

          QUE ESTÉ AQUÍ NO CONTRADICE "NUNCA INTERRUMPE UNA VENTA": esa regla
          es sobre que Yaxo APAREZCA solo. Un botón quieto en la cabecera no
          interrumpe nada, y a Vender se entra por voluntad propia. */}
      <View style={est.cabecera}>
        {!enDeptos && (
          <Pressable
            style={est.iconBtn}
            accessibilityLabel="Volver a departamentos"
            onPress={() => {
              setSeleccion(null);
              setBuscando(false);
              setBusqueda("");
            }}
          >
            <IconoUI id="atras" size={19} color={T.texto} grosor={2.1} />
          </Pressable>
        )}
        <View style={{ flex: 1 }}>
          <Txt escala="titulo" fuerte lineas={1}>
            {enDeptos
              ? "Vender"
              : buscando && q
                ? "Búsqueda"
                : seleccion === "__todos__"
                  ? "Todo el catálogo"
                  : seleccion === "__sin__"
                    ? "Sin departamento"
                    : catActual?.nombre ?? "Productos"}
          </Txt>
        </View>
        <View style={est.iconBtn}>
          <BotonYaxo desde="vender" size={26} />
        </View>
        <Pressable
          style={est.iconBtn}
          accessibilityLabel="Escanear código"
          onPress={() => setEscanerAbierto(true)}
        >
          <IconoUI id="escaner" size={19} color={T.textoSuave} grosor={1.8} />
        </Pressable>
        <Pressable
          style={[est.iconBtn, buscando && { backgroundColor: T.acentoRelleno }]}
          accessibilityLabel="Buscar producto"
          onPress={() => {
            setBuscando((v) => !v);
            setBusqueda("");
          }}
        >
          <IconoUI
            id="buscar"
            size={19}
            color={buscando ? T.acentoTexto : T.textoSuave}
            grosor={2}
          />
        </Pressable>
      </View>

      {/* Buscador */}
      {(buscando || !enDeptos) && (
        <View style={{ paddingHorizontal: T.esp, paddingBottom: T.esps.sm }}>
          <TextInput
            style={est.buscador}
            placeholder={buscando ? "Escanea un código o escribe…" : "Buscar en esta lista…"}
            placeholderTextColor={T.textoTenue}
            value={busqueda}
            onChangeText={setBusqueda}
            onSubmitEditing={enviarBusqueda}
            autoCapitalize="none"
            autoCorrect={false}
            /* autoFocus SOLO al abrir con la lupa. Con el campo siempre
               visible, enfocarlo al entrar en un departamento levantaría el
               teclado y taparía media pantalla sin que nadie lo pidiera. */
            autoFocus={buscando}
          />
        </View>
      )}

      {/* ---------- NIVEL 1: departamentos ---------- */}
      {enDeptos ? (
        <FlatList
          data={categorias}
          key="deptos"
          numColumns={2}
          keyExtractor={(c) => c.id}
          contentContainerStyle={[est.grid, hayTicket && est.gridConBarra]}
          columnWrapperStyle={{ gap: T.esps.md }}
          ListHeaderComponent={
            <Pressable style={est.todoBtn} onPress={() => { setBusqueda(""); setSeleccion("__todos__"); }}>
              <IconoUI id="grid3" size={21} color={T.acento} />
              <View style={{ flex: 1 }}>
                <Txt escala="cuerpo" fuerte>
                  Todo el catálogo
                </Txt>
                <Txt escala="pie" tono="tenue">
                  {productos.length} productos
                </Txt>
              </View>
              <Txt escala="titulo" tono="tenue">
                ›
              </Txt>
            </Pressable>
          }
          ListEmptyComponent={
            <Vacio
              titulo="Todavía no hay departamentos"
              texto="Los departamentos agrupan tus productos con su icono y color, y hacen que vender sea de dos toques. Créalos desde Herramientas."
            />
          }
          ListFooterComponent={
            sinDepto > 0 ? (
              <Pressable
                style={[est.todoBtn, { marginTop: T.esps.md }]}
                onPress={() => { setBusqueda(""); setSeleccion("__sin__"); }}
              >
                <IconoUI id="inventario" size={21} color={T.textoSuave} />
                <View style={{ flex: 1 }}>
                  <Txt escala="cuerpo" fuerte>
                    Sin departamento
                  </Txt>
                  <Txt escala="pie" tono="tenue">
                    {sinDepto} productos
                  </Txt>
                </View>
                <Txt escala="titulo" tono="tenue">
                  ›
                </Txt>
              </Pressable>
            ) : undefined
          }
          renderItem={({ item }) => (
            <TarjetaDepartamento
              item={item}
              n={conteos.get(item.id) ?? 0}
              /* Limpiar lo escrito al entrar a un departamento: si no, el
                 filtro de la lista anterior seguiría aplicándose aquí y el
                 departamento parecería medio vacío sin motivo visible. */
              onPress={(id) => {
                setBusqueda("");
                setSeleccion(id);
              }}
            />
          )}
        />
      ) : (
        /* ---------- NIVEL 2: productos ---------- */
        <>
          <View style={est.barraVista}>
            <Txt escala="pie" tono="tenue" fuerte>
              {visibles.length} producto{visibles.length === 1 ? "" : "s"}
            </Txt>
            <SelectorVista vista={vista} onCambio={setVista} />
          </View>

          <FlatList
            data={datosLista}
            key={vista}
            numColumns={cols}
            keyExtractor={(p) => p.id}
            contentContainerStyle={[est.grid, hayTicket && est.gridConBarra]}
            columnWrapperStyle={cols > 1 ? { gap: T.esps.sm } : undefined}
            ListEmptyComponent={
              q ? (
                <Vacio
                  titulo="Sin resultados"
                  texto="Prueba con otra palabra, o escanea el código de barras del producto."
                />
              ) : (
                <Vacio
                  titulo="Aquí no hay productos"
                  texto="Este departamento está vacío. Agrega productos desde Inventario."
                />
              )
            }
            renderItem={({ item }) =>
              "_sep" in item ? (
                <View style={est.sepDepto}>
                  <Txt escala="micro" tono="tenue" fuerte mayus lineas={1} estilo={{ flex: 1 }}>
                    {item.titulo}
                  </Txt>
                  <Monto texto={String(item.n)} escala="micro" estilo={{ color: T.textoTenue }} />
                </View>
              ) : vista === "lista" ? (
                <FilaProducto
                  item={item}
                  enTicket={cantidadDe(item.id)}
                  onAgregar={agregar}
                  onQuitar={cambiarCantidad}
                />
              ) : (
                <TarjetaProducto
                  item={item}
                  enTicket={cantidadDe(item.id)}
                  cols={cols}
                  onAgregar={agregar}
                  onQuitar={cambiarCantidad}
                />
              )
            }
          />
        </>
      )}

      {/* ---------------------------------------------------------------
          BARRA DEL TICKET — solo existe cuando hay algo que cobrar.
          Es también el tirador: se jala hacia arriba para ver las líneas.
          --------------------------------------------------------------- */}
      {hayTicket && (
        <BarraTicket
          total={total}
          articulos={articulos}
          resumen={resumenTicket}
          cliente={reglas?.activa ? clienteTicket : null}
          mostrarCliente={Boolean(reglas?.activa)}
          onVerTicket={() => setTicketAbierto(true)}
          onCliente={() => setModalClienteAbierto(true)}
          onQuitarCliente={() => setClienteTicket(null)}
          onCobrar={() => setCobroAbierto(true)}
        />
      )}

      {/* Ticket expandido: hoja propia, con QUITAR y VACIAR. */}
      <Hoja
        visible={ticketAbierto}
        onCerrar={() => setTicketAbierto(false)}
        titulo={`Ticket · ${articulos} ${articulos === 1 ? "artículo" : "artículos"}`}
        pie={
          <View style={{ flexDirection: "row", alignItems: "center", gap: T.esps.md }}>
            <View style={{ flex: 1 }}>
              <Txt escala="micro" tono="suave" fuerte mayus>
                Total
              </Txt>
              <Monto texto={pesos(total)} escala="titulo" />
            </View>
            <View style={{ flex: 1 }}>
              <Boton
                titulo="Cobrar"
                onPress={() => {
                  setTicketAbierto(false);
                  setCobroAbierto(true);
                }}
              />
            </View>
          </View>
        }
      >
        <View style={{ alignItems: "flex-end", marginBottom: T.esps.sm }}>
          <Pressable onPress={vaciarTicket} hitSlop={10} style={{ minHeight: 36, justifyContent: "center" }}>
            <Txt escala="pie" tono="peligro" fuerte>
              Vaciar
            </Txt>
          </Pressable>
        </View>
        {carrito.map((i) => (
          <View key={i.producto_id} style={est.linea}>
            <Pressable
              style={{ flex: 1, paddingRight: T.esps.sm }}
              onLongPress={() => abrirEditarPrecio(i)}
              delayLongPress={350}
              android_ripple={{ color: T.acentoBorde }}
            >
              <Txt escala="pie" fuerte lineas={1}>
                {i.nombre}
              </Txt>
              <View style={{ flexDirection: "row", gap: T.esps.xs, marginTop: 2, alignItems: "baseline" }}>
                {i.precio_original_centavos ? (
                  <Txt escala="micro" tono="tenue" estilo={{ textDecorationLine: "line-through" }}>
                    {pesos(i.precio_original_centavos)}
                  </Txt>
                ) : null}
                <Monto
                  texto={`${pesos(i.precio_centavos)} c/u`}
                  escala="micro"
                  tono={i.precio_original_centavos ? "exito" : "tenue"}
                  fuerte={false}
                />
                <Txt escala="micro" tono="tenue">
                  ·
                </Txt>
                <Monto
                  texto={pesos(Math.round(i.precio_centavos * i.cantidad))}
                  escala="micro"
                  tono="acento"
                />
              </View>
            </Pressable>
            <View style={est.cantCtrl}>
              <Pressable
                style={est.cantBtn}
                onPress={() => cambiarCantidad(i.producto_id, -1)}
                android_ripple={{ color: T.acentoBorde }}
              >
                <Txt escala="cuerpo" fuerte>
                  −
                </Txt>
              </Pressable>
              <Monto texto={String(i.cantidad)} escala="pie" estilo={{ minWidth: 26, textAlign: "center" }} />
              <Pressable
                style={est.cantBtn}
                onPress={() => cambiarCantidad(i.producto_id, +1)}
                android_ripple={{ color: T.acentoBorde }}
              >
                <Txt escala="cuerpo" fuerte>
                  +
                </Txt>
              </Pressable>
            </View>
            <Pressable
              style={est.quitarBtn}
              onPress={() => quitarLinea(i.producto_id)}
              hitSlop={8}
              accessibilityLabel={`Quitar ${i.nombre} del ticket`}
              android_ripple={{ color: T.peligroSuave }}
            >
              <Txt escala="pie" tono="peligro" fuerte>
                ✕
              </Txt>
            </Pressable>
          </View>
        ))}
      </Hoja>

      {/* Cambiar precio de una línea, solo para este ticket. */}
      <Hoja
        visible={editandoPrecio !== null}
        onCerrar={() => setEditandoPrecio(null)}
        titulo="Cambiar precio en este ticket"
        pie={
          <View style={{ gap: T.esps.sm }}>
            <Boton titulo="Guardar" onPress={confirmarNuevoPrecio} />
            {editandoPrecio?.precio_original_centavos ? (
              <Boton titulo="Quitar rebaja" tipo="secundario" onPress={quitarRebaja} />
            ) : null}
          </View>
        }
      >
        <Txt escala="pie" tono="suave" estilo={{ marginBottom: T.esps.lg }}>
          Cambia el precio de "{editandoPrecio?.nombre}" solo para este ticket — el catálogo no se
          toca. Si agregas más de este producto con el botón +, las piezas nuevas heredan este
          mismo precio.
        </Txt>
        <Campo
          label={`Precio de catálogo: ${pesos(
            editandoPrecio?.precio_original_centavos ?? editandoPrecio?.precio_centavos ?? 0
          )}`}
        >
          <TextInput
            style={estiloInput}
            value={nuevoPrecioTexto}
            onChangeText={setNuevoPrecioTexto}
            keyboardType="decimal-pad"
            placeholderTextColor={T.textoTenue}
            autoFocus
          />
        </Campo>
      </Hoja>

      {cobroAbierto && (
        <ModalCobro
          total={total}
          items={carrito}
          cliente={reglas?.activa ? clienteTicket : null}
          reglas={reglas}
          onCerrar={() => setCobroAbierto(false)}
          onCobrado={async (r, canje) => {
            setCobroAbierto(false);
            // Si este ticket venía de una cotización, la cerramos como
            // "convertida". Best-effort: la venta YA está hecha, no vale la
            // pena interrumpir el flujo de cobro por esto.
            if (cotizacionIdEnCurso) {
              try {
                await marcarConvertida(cotizacionIdEnCurso, r.venta_id);
              } catch (err) {
                console.warn("No se pudo marcar la cotización como convertida:", err);
              }
              setCotizacionIdEnCurso(null);
            }
            // El ticket protagonista: se construye con el carrito ANTES de
            // vaciarlo (la lógica de cobro ya terminó; esto es solo recibo).
            let extrasLealtad:
              | { clienteNombre: string; puntosGanados: number; saldoPuntos: number }
              | undefined;
            if (clienteTicket && reglas?.activa) {
              // Puntos DESPUÉS del cobro exitoso, en try/catch silencioso:
              // NUNCA romper un cobro ya hecho; si falla, solo queda en log.
              let ganados = 0;
              let saldo = clienteTicket.puntos;
              try {
                const ac = await acumularPorVenta(
                  clienteTicket.id,
                  r.venta_id,
                  r.total_centavos
                );
                ganados = ac.otorgados;
                saldo = ac.saldo;
              } catch (err) {
                console.warn("Lealtad: no se pudieron acumular puntos:", err);
              }
              if (canje && canje.puntosUsados > 0) {
                try {
                  const cj = await canjearPuntos(
                    clienteTicket.id,
                    r.venta_id,
                    canje.puntosUsados,
                    canje.descuentoCentavos
                  );
                  saldo = cj.saldo;
                } catch (err) {
                  console.warn("Lealtad: no se pudo registrar el canje:", err);
                }
              }
              extrasLealtad = {
                clienteNombre: clienteTicket.nombre,
                puntosGanados: ganados,
                saldoPuntos: saldo,
              };
            }
            const t = await construirTicket(r, carrito, extrasLealtad);
            setCarrito([]);
            setClienteTicket(null);
            setTicketCobrado(t);
            cargar();
          }}
        />
      )}

      {/* Ligar cliente de lealtad al ticket */}
      {modalClienteAbierto && (
        <ModalClienteVenta
          totalCentavos={total}
          onElegir={async (c) => {
            setClienteTicket(c);
            setModalClienteAbierto(false);
            mostrarAviso(`Cliente ligado: ${c.nombre} · ${c.puntos} pts`);
          }}
          onCerrar={() => setModalClienteAbierto(false)}
        />
      )}

      {ticketCobrado && (
        <ModalTicket ticket={ticketCobrado} onCerrar={() => setTicketCobrado(null)} />
      )}

      {/* Escáner de códigos de barras (modo continuo: no cierra solo) */}
      {escanerAbierto && (
        <EscanerCamara
          modo="continuo"
          onCodigo={(c) => void alEscanear(c)}
          onCerrar={() => setEscanerAbierto(false)}
          aviso={aviso?.texto ?? null}
        />
      )}

      {/* Alta prellenada desde un código desconocido (el usuario confirma) */}
      {formNuevo && (
        <FormularioProducto
          producto={null}
          prellenado={{ codigo: formNuevo.codigo, nombre: formNuevo.nombre }}
          categorias={categorias}
          onCerrar={() => setFormNuevo(null)}
          onGuardado={() => {
            setFormNuevo(null);
            cargar();
          }}
        />
      )}

      {/* Aviso breve (toast). Se sube si la barra del ticket está presente. */}
      {aviso && (
        <View
          style={[est.avisoCaja, !escanerAbierto && { bottom: hayTicket ? 104 : 24 }]}
          pointerEvents="box-none"
        >
          <View style={est.avisoInterior}>
            <Txt escala="pie" lineas={2} estilo={{ flex: 1, color: T.texto }}>
              {aviso.texto}
            </Txt>
            {aviso.accion && (
              <Pressable onPress={() => aviso.accion?.onPress()} hitSlop={8}>
                <Txt escala="pie" tono="acento" fuerte>
                  {aviso.accion.label}
                </Txt>
              </Pressable>
            )}
          </View>
        </View>
      )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ===========================================================================
// BARRA DEL TICKET — a la vez resumen, tirador y botón de cobro
// ===========================================================================
//
// El arrastre hacia arriba abre el ticket. Usa PanResponder (núcleo de React
// Native): sin dependencias extra y con el mismo comportamiento en Android y
// iOS. Solo reclama el gesto si el movimiento es claramente vertical, así que
// tocar "Cobrar" nunca se confunde con arrastrar.
//
// Misma física que el tirador de Herramientas en Inicio: lo que sube desde
// abajo, sube igual en toda la app.
function BarraTicket({
  total,
  articulos,
  resumen,
  cliente,
  mostrarCliente,
  onVerTicket,
  onCliente,
  onQuitarCliente,
  onCobrar,
}: {
  total: number;
  articulos: number;
  /** Qué lleva el ticket, en una línea ("2× Coca-Cola · Sabritas · +2").
   *  Antes la barra solo decía "3 artículos": para saber QUÉ había que
   *  abrir el ticket, y el cajero abre y cierra esa hoja decenas de veces
   *  al día solo para comprobar que no metió algo de más. */
  resumen: string;
  cliente: Cliente | null;
  mostrarCliente: boolean;
  onVerTicket: () => void;
  onCliente: () => void;
  onQuitarCliente: () => void;
  onCobrar: () => void;
}) {
  const { tema: T } = useTema();
  const disparado = useRef(false);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          g.dy < -8 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => {
          if (!disparado.current && g.dy < -40) {
            disparado.current = true;
            onVerTicket();
          }
        },
        onPanResponderRelease: () => {
          disparado.current = false;
        },
        onPanResponderTerminate: () => {
          disparado.current = false;
        },
      }),
    [onVerTicket]
  );

  return (
    <View
      {...responder.panHandlers}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: T.superficie,
        borderTopLeftRadius: T.radioGrande,
        borderTopRightRadius: T.radioGrande,
        paddingTop: T.esps.sm,
        paddingHorizontal: T.esp,
        paddingBottom: Platform.OS === "ios" ? T.esps.lg : T.esps.md,
        shadowColor: T.esClaro ? T.bordeFuerte : "#000",
        shadowOpacity: 0.2,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: -6 },
        elevation: 14,
      }}
    >
      {/* Asidero: la señal de "esto sube". */}
      <View style={{ alignItems: "center", marginBottom: T.esps.sm }}>
        <View
          style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: T.bordeFuerte }}
        />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: T.esps.md }}>
        <Pressable
          style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
          onPress={onVerTicket}
          accessibilityRole="button"
          accessibilityLabel={`Ver ticket, ${articulos} artículos`}
          accessibilityHint="También puedes deslizar hacia arriba"
        >
          <Txt escala="micro" tono="suave" fuerte mayus>
            {articulos} {articulos === 1 ? "artículo" : "artículos"}
          </Txt>
          <Monto texto={pesos(total)} escala="titulo" />
          {resumen ? (
            <Txt escala="micro" tono="tenue" lineas={1}>
              {resumen}
            </Txt>
          ) : null}
        </Pressable>

        {mostrarCliente &&
          (cliente ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: T.esps.sm,
                backgroundColor: T.acentoSuave,
                borderRadius: T.radioChico,
                paddingHorizontal: T.esps.md,
                paddingVertical: T.esps.sm,
                maxWidth: 116,
              }}
            >
              <Pressable onPress={onCliente} style={{ flexShrink: 1 }}>
                <Txt escala="micro" fuerte lineas={1}>
                  {cliente.nombre}
                </Txt>
                <Monto texto={`${cliente.puntos} pts`} escala="micro" tono="acento" />
              </Pressable>
              <Pressable onPress={onQuitarCliente} hitSlop={10} accessibilityLabel="Quitar cliente">
                <Txt escala="pie" tono="tenue">
                  ✕
                </Txt>
              </Pressable>
            </View>
          ) : (
            /* Sin cliente ligado: solo el icono, sin la palabra debajo.
               Cliente y Cobrar se veían como dos botones hermanos del mismo
               peso, y no lo son: ligar un cliente es opcional y ocasional;
               cobrar es LA acción de la pantalla. Estrechar este libera
               además el ancho que necesitaba el resumen del ticket, que con
               nombres largos se cortaba a la mitad.
               El área tocable se mantiene por encima del mínimo accesible
               (44) gracias al minHeight y al hitSlop: se ve más discreto,
               pero no es más difícil de acertar. */
            <Pressable
              onPress={onCliente}
              hitSlop={10}
              accessibilityLabel="Ligar cliente"
              style={{
                alignItems: "center",
                justifyContent: "center",
                width: 46,
                minHeight: 48,
                borderRadius: T.radioChico,
                backgroundColor: T.superficie2,
              }}
            >
              <IconoUI id="persona" size={20} color={T.textoSuave} grosor={1.9} />
            </Pressable>
          ))}

        <Pressable
          onPress={onCobrar}
          accessibilityRole="button"
          style={({ pressed }) => ({
            minHeight: 52,
            paddingHorizontal: T.esps.xl,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: T.radio,
            backgroundColor: T.acentoRelleno,
            opacity: pressed ? 0.85 : 1,
            shadowColor: T.acento,
            shadowOpacity: 0.3,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 5,
          })}
        >
          <Txt escala="cuerpo" fuerte estilo={{ color: T.acentoTexto }}>
            Cobrar
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}

// ===========================================================================
// TARJETAS MEMOIZADAS — por qué existen como componentes aparte
// ===========================================================================
//
// Antes vivían como funciones inline dentro de `renderItem`. Cada toque en
// UN producto disparaba `setCarrito`, lo que re-renderizaba TODA la
// pantalla, lo que recreaba `renderItem` con una identidad nueva, lo que
// hacía que React volviera a ejecutar el render de las 30-50 celdas
// visibles — no solo la tocada. Eso es lo que se sentía como el retraso
// entre el toque y el borde de selección.
//
// Al ser `React.memo`, cada tarjeta compara sus propias props contra el
// render anterior. Si el producto no cambió de estado (su `enTicket` sigue
// en 0, por ejemplo), React ni siquiera vuelve a ejecutar su función de
// render — sin importar que `renderItem` en sí se haya vuelto a llamar. Solo
// la tarjeta realmente tocada hace trabajo.
//
// Esto solo funciona si `onAgregar`/`onQuitar` tienen identidad ESTABLE
// (por eso `agregar` y `cambiarCantidad`, arriba, están en `useCallback`):
// una función nueva en cada render sería una prop distinta cada vez y
// rompería el memo igual que antes, solo que de forma menos visible.

function TarjetaDepartamento({
  item,
  n,
  onPress,
}: {
  item: Categoria;
  n: number;
  onPress: (id: string) => void;
}) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  // REDISEÑO — tres cambios, cada uno por un motivo concreto:
  //
  // 1. Un solo color (el acento), no uno por departamento. El color por
  //    categoría no codificaba nada que el cajero necesite: nadie busca
  //    "lo verde", busca "cerveza". Nueve tintes pastel distintos rompían
  //    la paleta y hacían que la pantalla se leyera como una plantilla.
  //    Si algún día algo va en color aquí, que sea el ESTADO (por
  //    acabarse), no la categoría.
  //
  // 2. Sin cubo por defecto. `item.icono ?? "caja"` hacía que TODOS los
  //    departamentos sin icono mostraran el mismo cubo genérico — el
  //    síntoma más visible de "plantilla". Un icono equivocado cuesta más
  //    que ninguno: sin icono, manda el nombre, que es lo que de verdad
  //    se lee. (Los 16 iconos de categoría ya existen en iconos.tsx; el
  //    problema era el respaldo, no la falta de dibujos.)
  //
  // 3. El contador deja de ser protagonista. "0 productos" en rojo
  //    llamaba la atención sobre un departamento vacío, que es justo lo
  //    que NO hay que tocar. Ahora es un dato tenue a la derecha del
  //    nombre, y desaparece cuando está vacío.
  const tieneIcono = !!item.icono;
  return (
    <Pressable
      android_ripple={{ color: T.acentoSuave }}
      style={({ pressed }) => [
        est.deptoCard,
        pressed && { backgroundColor: T.acentoSuave },
      ]}
      onPress={() => onPress(item.id)}
    >
      {/* Los huecos del icono y del contador se reservan SIEMPRE, tenga o no
          contenido. Sin esto convivían cuatro composiciones distintas en la
          misma rejilla (con icono y sin contador, sin icono y con contador…)
          y cada tarjeta colocaba su nombre a una altura diferente: se leía
          como desalineado, no como variado. */}
      <View style={est.deptoIconoHueco}>
        {tieneIcono ? <Icono id={item.icono} size={28} color={T.acento} /> : null}
      </View>
      <Txt escala="cuerpo" fuerte lineas={2} estilo={est.deptoNombre}>
        {item.nombre}
      </Txt>
      <View style={est.deptoCuentaHueco}>
        {n > 0 ? (
          <Monto texto={String(n)} escala="pie" estilo={est.deptoCuenta} />
        ) : null}
      </View>
    </Pressable>
  );
}

function TarjetaProductoBase({
  item,
  enTicket,
  cols,
  onAgregar,
  onQuitar,
}: {
  item: ProductoLista;
  enTicket: number;
  cols: number;
  onAgregar: (p: ProductoLista) => void;
  onQuitar: (id: string, delta: number) => void;
}) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const chico = cols >= 4;
  return (
    <Pressable
      android_ripple={{ color: T.acentoBorde }}
      style={({ pressed }) => [
        est.card,
        enTicket > 0 && est.cardActiva,
        pressed && { transform: [{ scale: 0.95 }], backgroundColor: T.superficie2 },
      ]}
      onPress={() => onAgregar(item)}
    >
      {enTicket > 0 && (
        <>
          {/* Contador (derecha) */}
          <View style={[est.badge, est.badgeCard]}>
            <Monto texto={String(enTicket)} escala="pie" estilo={{ color: T.acentoTexto }} />
          </View>
          {/* Restar / quitar (izquierda) */}
          <Pressable
            style={est.cardQuitar}
            onPress={() => onQuitar(item.id, -1)}
            hitSlop={10}
            android_ripple={{ color: T.acentoBorde }}
          >
            <Txt escala="cuerpo" fuerte>
              −
            </Txt>
          </Pressable>
        </>
      )}
      <ImagenProducto
        uri={item.imagen_uri}
        nombre={item.nombre}
        color={item.categoria_color}
        icono={item.categoria_icono}
        size={chico ? 46 : cols === 2 ? 82 : 64}
        radio={chico ? 11 : 14}
      />
      <Txt escala={chico ? "micro" : "pie"} lineas={2} estilo={est.cardNombre}>
        {item.nombre}
      </Txt>
      <Monto
        texto={pesos(item.precio_venta_centavos)}
        escala={chico ? "micro" : "pie"}
        tono="acento"
      />
    </Pressable>
  );
}
const TarjetaProducto = memo(TarjetaProductoBase);

function FilaProductoBase({
  item,
  enTicket,
  onAgregar,
  onQuitar,
}: {
  item: ProductoLista;
  enTicket: number;
  onAgregar: (p: ProductoLista) => void;
  onQuitar: (id: string, delta: number) => void;
}) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  return (
    <Pressable
      android_ripple={{ color: T.acentoBorde }}
      style={({ pressed }) => [
        est.filaCard,
        enTicket > 0 && est.cardActiva,
        pressed && { backgroundColor: T.superficie2 },
      ]}
      onPress={() => onAgregar(item)}
    >
      <ImagenProducto
        uri={item.imagen_uri}
        nombre={item.nombre}
        color={item.categoria_color}
        icono={item.categoria_icono}
        size={44}
        radio={11}
      />
      <View style={{ flex: 1 }}>
        <Txt escala="pie" fuerte lineas={1}>
          {item.nombre}
        </Txt>
        <Monto texto={pesos(item.precio_venta_centavos)} escala="pie" tono="acento" />
      </View>
      {enTicket > 0 && (
        <>
          <Pressable
            style={est.filaQuitar}
            onPress={() => onQuitar(item.id, -1)}
            hitSlop={8}
            android_ripple={{ color: T.acentoBorde }}
          >
            <Txt escala="cuerpo" fuerte>
              −
            </Txt>
          </Pressable>
          <View style={est.badge}>
            <Monto texto={String(enTicket)} escala="pie" estilo={{ color: T.acentoTexto }} />
          </View>
        </>
      )}
    </Pressable>
  );
}
const FilaProducto = memo(FilaProductoBase);

// ---------------------------------------------------------------------------
type FilaMixta = { id: string; metodo: MetodoPago; monto: string };

const METODOS_TXT: Record<MetodoPago, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  credito: "Crédito",
};

function nuevaFilaMixta(metodo: MetodoPago): FilaMixta {
  return { id: Math.random().toString(36).slice(2), metodo, monto: "" };
}

function ModalCobro({
  total,
  items,
  cliente,
  reglas,
  onCerrar,
  onCobrado,
}: {
  total: number;
  items: ItemCarrito[];
  cliente: Cliente | null;
  reglas: ReglasLealtad | null;
  onCerrar: () => void;
  onCobrado: (
    r: ResultadoCobro,
    canje?: { puntosUsados: number; descuentoCentavos: number }
  ) => void;
}) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const estiloInput = useEstiloInput();
  const [metodo, setMetodo] = useState<MetodoPago>("efectivo");
  const [recibido, setRecibido] = useState("");
  const [error, setError] = useState("");
  const [cobrando, setCobrando] = useState(false);

  // Pago mixto: apagado por defecto — el caso de siempre (un solo método,
  // un toque) no cambia en NADA. Se activa a propósito, como el canje de
  // puntos: nunca aparece encima de lo simple, siempre al lado.
  const [mixto, setMixto] = useState(false);
  const [filas, setFilas] = useState<FilaMixta[]>([]);

  // Crédito: exige cliente (elegido ANTES de abrir este modal, mismo
  // patrón que el canje de puntos). El límite AVISA, nunca bloquea — la
  // decisión de vender igual la tiene el cajero o el dueño.
  const [limiteInfo, setLimiteInfo] = useState<{ excede: boolean; saldo: number; limite: number } | null>(null);

  // Canje de puntos: REGLA DE NEGOCIO — NUNCA se aplica automáticamente. El
  // switch nace APAGADO; el cajero lo prende, ve el cálculo en vivo y
  // confirma con el mismo botón de cobro.
  const [canjeOn, setCanjeOn] = useState(false);
  const [puntosTxt, setPuntosTxt] = useState("");

  const puedeCanjear = !!cliente && !!reglas?.activa && (cliente?.puntos ?? 0) > 0;

  // Puntos solicitados: campo vacío = todos los disponibles. Acotado al saldo.
  const puntosSolicitados = useMemo(() => {
    if (!cliente) return 0;
    const n = parseInt(puntosTxt.trim(), 10);
    if (isNaN(n) || n <= 0) return cliente.puntos;
    return Math.min(n, cliente.puntos);
  }, [puntosTxt, cliente]);

  const canje = useMemo(() => {
    if (!canjeOn || !puedeCanjear || !reglas) {
      return { descuentoCentavos: 0, puntosUsados: 0 };
    }
    const r = descuentoPorCanje(
      puntosSolicitados,
      reglas.valorPuntoCentavos,
      total,
      reglas.topeDescuentoPct
    );
    // Nunca usar más puntos de los que tiene.
    if (r.puntosUsados > (cliente?.puntos ?? 0)) {
      return descuentoPorCanje(
        cliente!.puntos,
        reglas.valorPuntoCentavos,
        total,
        reglas.topeDescuentoPct
      );
    }
    return r;
  }, [canjeOn, puedeCanjear, reglas, puntosSolicitados, total, cliente]);

  const totalFinal = total - canje.descuentoCentavos;

  function activarMixto() {
    setMixto(true);
    setFilas([nuevaFilaMixta("efectivo"), nuevaFilaMixta("tarjeta")]);
  }
  function desactivarMixto() {
    setMixto(false);
    setFilas([]);
  }
  function agregarFila() {
    if (filas.length >= 4) return;
    const usados = new Set(filas.map((f) => f.metodo));
    const disponible =
      (["efectivo", "tarjeta", "transferencia", "credito"] as MetodoPago[]).find(
        (m) => !usados.has(m)
      ) ?? "efectivo";
    setFilas((s) => [...s, nuevaFilaMixta(disponible)]);
  }
  function quitarFila(id: string) {
    setFilas((s) => (s.length > 1 ? s.filter((f) => f.id !== id) : s));
  }
  function cambiarMetodoFila(id: string, m: MetodoPago) {
    setFilas((s) => s.map((f) => (f.id === id ? { ...f, metodo: m } : f)));
  }
  function cambiarMontoFila(id: string, v: string) {
    setFilas((s) => s.map((f) => (f.id === id ? { ...f, monto: v } : f)));
  }

  const filasC = filas.map((f) => ({
    ...f,
    centavos: f.monto.trim() === "" ? 0 : aCentavos(f.monto),
  }));

  const montoCredito = mixto
    ? filasC.filter((f) => f.metodo === "credito").reduce((s, f) => s + f.centavos, 0)
    : metodo === "credito"
    ? totalFinal
    : 0;

  useEffect(() => {
    if (montoCredito <= 0 || !cliente) {
      setLimiteInfo(null);
      return;
    }
    let vivo = true;
    verificarLimite(cliente.id, montoCredito).then((r) => {
      if (vivo) setLimiteInfo(r);
    });
    return () => {
      vivo = false;
    };
  }, [montoCredito, cliente]);

  // Vista previa del reparto.
  //
  // ⚠️ EL ORDEN DE LAS PASADAS ES LA REGLA, NO UN DETALLE.
  //
  // Esto recorría `filasC` en el orden en que el cajero capturó los pagos, y
  // por eso decía cosas distintas de las que acababa haciendo el cobro. Con un
  // total de $200 y el cajero capturando "efectivo $100 + tarjeta $200":
  //
  //   por captura : efectivo aplica 100, tarjeta aplica 100 -> "Cubre el total"
  //   real        : tarjeta aplica 200, efectivo aplica 0   -> "Cambio $100"
  //
  // El ticket ya salía bien porque lo calcula cobrar(); solo mentía la
  // pantalla de cobro, que es justo donde el cajero decide cuánto dinero
  // devolver. El comentario anterior afirmaba "MISMO algoritmo que cobrar()"
  // y había dejado de serlo cuando se corrigió venta.ts.
  //
  // Ahora replica sus TRES PASADAS exactas (venta.ts, que a su vez calca
  // ventas.rs del PC):
  //   1. Crédito: cubre su parte, nunca hay vuelto sobre fiado.
  //   2. Tarjeta y transferencia: no pueden dar cambio, se aplican completas
  //      mientras quede total por cubrir.
  //   3. Efectivo AL FINAL: el único que absorbe el sobrante y lo devuelve.
  //
  // Sigue siendo una previsualización: la verdad final la calcula cobrar().
  // Pero ahora las dos dicen lo mismo.
  const previa = useMemo(() => {
    if (!mixto) return null;
    let porCubrir = Math.max(0, totalFinal - montoCredito);

    // Pasada 2: todo lo que NO es efectivo ni crédito.
    for (const f of filasC) {
      if (f.metodo === "credito" || f.metodo === "efectivo") continue;
      porCubrir -= Math.min(f.centavos, porCubrir);
    }

    // Pasada 3: el efectivo, con lo que quede. Lo que sobre es el cambio.
    let cambioPrevia = 0;
    for (const f of filasC) {
      if (f.metodo !== "efectivo") continue;
      const aplicado = Math.min(f.centavos, porCubrir);
      porCubrir -= aplicado;
      cambioPrevia += Math.max(f.centavos - aplicado, 0);
    }

    const capturado = filasC.reduce((s, f) => s + f.centavos, 0);
    return {
      falta: Math.max(0, totalFinal - capturado),
      cambio: cambioPrevia,
      cubre: capturado >= totalFinal,
    };
  }, [mixto, filasC, totalFinal, montoCredito]);

  const recibidoC = recibido.trim() === "" ? totalFinal : aCentavos(recibido);
  const cambio = !mixto && metodo === "efectivo" ? recibidoC - totalFinal : 0;

  async function confirmar() {
    setError("");
    setCobrando(true);
    try {
      const pagos: PagoEntrada[] = mixto
        ? filasC
            .filter((f) => f.centavos > 0)
            .map((f) => ({
              metodo: f.metodo,
              monto_centavos: f.centavos,
              recibido_centavos: f.metodo === "efectivo" ? f.centavos : undefined,
            }))
        : [
            {
              metodo,
              monto_centavos: metodo === "efectivo" ? recibidoC : totalFinal,
              recibido_centavos: metodo === "efectivo" ? recibidoC : undefined,
            },
          ];
      const r = await cobrar(items, pagos, {
        clienteId: cliente?.id,
        descuentoCentavos: canje.descuentoCentavos,
      });
      onCobrado(r, canje.descuentoCentavos > 0 ? canje : undefined);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setCobrando(false);
    }
  }

  const deshabilitarConfirmar = mixto
    ? !previa?.cubre || (montoCredito > 0 && !cliente)
    : (metodo === "efectivo" && cambio < 0) || (metodo === "credito" && !cliente);

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={est.raiz}>
        <View style={{ flex: 1 }}>
          {/* La cabecera queda FUERA del scroll: "Cancelar" y el título tienen
              que seguir alcanzables con el teclado abierto. */}
          <CabeceraModal titulo="Cobrar" onIzquierda={onCerrar} />
          {/* Antes: KeyboardAvoidingView + ScrollView. El importe se veía, pero
              todo lo de debajo —"+ Pago mixto", el reparto, el botón de
              confirmar— quedaba bajo el teclado y había que arrastrar a mano.
              En la pantalla del dinero eso no vale. */}
          <KeyboardAwareScrollView
            bottomOffset={16}
            contentContainerStyle={{ padding: T.esp, paddingBottom: T.esps.xxl }}
            keyboardShouldPersistTaps="handled"
          >
            {/* El total a cobrar es la protagonista de esta pantalla: es lo
                que el cajero le va a decir al cliente en voz alta. */}
            <View style={{ alignItems: "center", marginBottom: T.esps.xl }}>
              <Txt escala="micro" tono="suave" fuerte mayus>
                Total a cobrar
              </Txt>
              <Monto texto={pesos(totalFinal)} escala="protagonista" />
              {canje.descuentoCentavos > 0 ? (
                <Monto
                  texto={`−${pesos(canje.descuentoCentavos)} por puntos`}
                  escala="pie"
                  tono="exito"
                  estilo={{ marginTop: T.esps.xs }}
                />
              ) : null}
            </View>

            <Banner texto={error} tipo="error" />

            {/* Canje de puntos: solo con cliente ligado, saldo > 0 y lealtad
                activa. Nace APAGADO — el cajero decide y confirma. */}
            {puedeCanjear && cliente && reglas && (
              <View style={[est.canjeCaja, canjeOn && { borderColor: T.acento }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: T.esps.md }}>
                  <IconoUI id="regalo" size={18} color={T.acento} />
                  <View style={{ flex: 1 }}>
                    <Txt escala="pie" fuerte>
                      Canjear puntos de {cliente.nombre}
                    </Txt>
                    <Txt escala="micro" tono="suave">
                      Tiene {cliente.puntos} pts disponibles
                    </Txt>
                  </View>
                  <Switch
                    value={canjeOn}
                    onValueChange={setCanjeOn}
                    trackColor={{ false: T.superficie3, true: T.acentoBorde }}
                    thumbColor={canjeOn ? T.acento : T.textoTenue}
                  />
                </View>
                {canjeOn && (
                  <View style={{ marginTop: T.esps.md }}>
                    <Txt escala="micro" tono="suave">
                      ¿Cuántos puntos? Vacío = todos ({cliente.puntos}).
                    </Txt>
                    <TextInput
                      style={[estiloInput, { marginTop: T.esps.sm }]}
                      value={puntosTxt}
                      onChangeText={(t) => setPuntosTxt(t.replace(/[^0-9]/g, ""))}
                      keyboardType="number-pad"
                      placeholder={String(cliente.puntos)}
                      placeholderTextColor={T.textoTenue}
                    />
                    <View style={{ marginTop: T.esps.sm }}>
                      {canje.descuentoCentavos > 0 ? (
                        <Txt escala="micro" tono="exito">
                          −{pesos(canje.descuentoCentavos)} por {canje.puntosUsados} punto
                          {canje.puntosUsados === 1 ? "" : "s"} · su saldo quedaría en{" "}
                          {cliente.puntos - canje.puntosUsados}
                        </Txt>
                      ) : (
                        <Txt escala="micro" tono="tenue">
                          Con este ticket no aplica descuento (revisa el tope o el total).
                        </Txt>
                      )}
                    </View>
                  </View>
                )}
              </View>
            )}

            {!mixto ? (
              <>
                <View style={est.segmento}>
                  {(["efectivo", "tarjeta", "transferencia", "credito"] as MetodoPago[]).map((m) => {
                    const bloqueado = m === "credito" && !cliente;
                    return (
                      <Pressable
                        key={m}
                        onPress={() => !bloqueado && setMetodo(m)}
                        disabled={bloqueado}
                        style={[
                          est.segBtn,
                          metodo === m && { backgroundColor: T.acentoRelleno },
                          bloqueado && { opacity: 0.4 },
                        ]}
                      >
                        <Txt
                          escala="pie"
                          fuerte={metodo === m}
                          tono="suave"
                          estilo={metodo === m ? { color: T.acentoTexto } : undefined}
                        >
                          {METODOS_TXT[m]}
                        </Txt>
                      </Pressable>
                    );
                  })}
                </View>
                {metodo === "credito" && !cliente && (
                  <Txt escala="micro" tono="tenue" estilo={{ marginTop: -T.esps.sm, marginBottom: T.esps.md }}>
                    Elige un cliente antes de vender a crédito.
                  </Txt>
                )}
                {metodo === "credito" && cliente && limiteInfo?.excede && (
                  <View
                    style={{
                      backgroundColor: T.peligroSuave, borderWidth: 1, borderColor: T.peligro,
                      borderRadius: T.radio, padding: T.esps.md, marginTop: -T.esps.sm, marginBottom: T.esps.md,
                    }}
                  >
                    <Txt escala="pie" tono="peligro" fuerte>
                      Esta venta deja a {cliente.nombre} sobre su límite de {pesos(limiteInfo.limite)}
                      {" "}(debe {pesos(limiteInfo.saldo)} ahora). Tú decides si aun así se le vende.
                    </Txt>
                  </View>
                )}

                {metodo === "efectivo" && (
                  <>
                    <Txt escala="pie" tono="suave" estilo={{ marginBottom: T.esps.sm }}>
                      ¿Con cuánto paga? Vacío = pago exacto.
                    </Txt>
                    <CampoMonto
                      estilo={[estiloInput, est.montoInput]}
                      valor={recibido}
                      onCambio={setRecibido}
                      pista={pesos(totalFinal)}
                      autoFocus
                    />
                    <View style={est.rapidos}>
                      {sugerenciasBillete(totalFinal).map((m) => (
                        <Pressable key={m} style={est.rapido} onPress={() => setRecibido(String(m))}>
                          <Monto texto={`$${m}`} escala="pie" tono="suave" />
                        </Pressable>
                      ))}
                    </View>
                    {/* El cambio: lo segundo que el cajero dice en voz alta.
                        Con pago exacto no se muestra "$0.00" en grande —
                        sería ruido que apaga el aviso real cuando sí hay
                        cambio (mismo criterio ya usado en el ticket). */}
                    {cambio !== 0 && (
                      <View
                        style={[
                          est.cambioCaja,
                          cambio < 0 && { borderColor: T.peligro, backgroundColor: T.peligroSuave },
                        ]}
                      >
                        <Txt escala="micro" tono="suave" fuerte mayus>
                          {cambio < 0 ? "Falta" : "Cambio"}
                        </Txt>
                        <Monto
                          texto={pesos(Math.abs(cambio))}
                          escala="titulo"
                          tono={cambio < 0 ? "peligro" : "acento"}
                        />
                      </View>
                    )}
                  </>
                )}

                <Pressable onPress={activarMixto} style={est.mixtoLink} hitSlop={8}>
                  <Txt escala="pie" tono="acento" fuerte>
                    + Pago mixto (más de un método)
                  </Txt>
                </Pressable>
              </>
            ) : (
              <>
                <View style={est.mixtoCabecera}>
                  <Txt escala="pie" fuerte>
                    Pago mixto
                  </Txt>
                  <Pressable onPress={desactivarMixto} hitSlop={8}>
                    <Txt escala="pie" tono="tenue">
                      Un solo método
                    </Txt>
                  </Pressable>
                </View>

                {filasC.map((f) => (
                  <View key={f.id} style={est.filaMixta}>
                    <View style={est.filaMixtaMetodo}>
                      {(["efectivo", "tarjeta", "transferencia", "credito"] as MetodoPago[]).map((m) => {
                        const bloqueado = m === "credito" && !cliente;
                        return (
                          <Pressable
                            key={m}
                            disabled={bloqueado}
                            onPress={() => !bloqueado && cambiarMetodoFila(f.id, m)}
                            style={[
                              est.chipMetodo,
                              f.metodo === m && { backgroundColor: T.acentoRelleno },
                              bloqueado && { opacity: 0.35 },
                            ]}
                          >
                            <Txt
                              escala="micro"
                              fuerte={f.metodo === m}
                              tono="suave"
                              estilo={f.metodo === m ? { color: T.acentoTexto } : undefined}
                            >
                              {METODOS_TXT[m]}
                            </Txt>
                          </Pressable>
                        );
                      })}
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: T.esps.sm, marginTop: T.esps.xs }}>
                      <TextInput
                        style={[estiloInput, { flex: 1 }]}
                        value={f.monto}
                        onChangeText={(v) => cambiarMontoFila(f.id, v)}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={T.textoTenue}
                      />
                      {filas.length > 1 && (
                        <Pressable onPress={() => quitarFila(f.id)} hitSlop={8} style={est.quitarFila}>
                          <Txt escala="cuerpo" tono="peligro">
                            ×
                          </Txt>
                        </Pressable>
                      )}
                    </View>
                    {/* Chips de importe rápido: SOLO con efectivo — con
                        tarjeta o transferencia no significan nada (mismo
                        criterio que ya se corrigió en la pantalla de cobro
                        del PC: confundían más de lo que ayudaban). */}
                    {f.metodo === "efectivo" && (
                      <View style={[est.rapidos, { marginTop: T.esps.xs }]}>
                        {sugerenciasBillete(Math.max(0, totalFinal - montoCredito)).map((m) => (
                          <Pressable key={m} style={est.rapido} onPress={() => cambiarMontoFila(f.id, String(m))}>
                            <Monto texto={`$${m}`} escala="pie" tono="suave" />
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                ))}

                {filas.length < 4 && (
                  <Pressable onPress={agregarFila} style={est.agregarFila} hitSlop={8}>
                    <Txt escala="pie" tono="acento" fuerte>
                      + Agregar otro método
                    </Txt>
                  </Pressable>
                )}

                {montoCredito > 0 && !cliente && (
                  <Txt escala="micro" tono="tenue" estilo={{ marginTop: T.esps.sm }}>
                    Elige un cliente antes de usar crédito en el pago mixto.
                  </Txt>
                )}
                {montoCredito > 0 && cliente && limiteInfo?.excede && (
                  <View
                    style={{
                      backgroundColor: T.peligroSuave, borderWidth: 1, borderColor: T.peligro,
                      borderRadius: T.radio, padding: T.esps.md, marginTop: T.esps.sm,
                    }}
                  >
                    <Txt escala="pie" tono="peligro" fuerte>
                      Esta venta deja a {cliente.nombre} sobre su límite de {pesos(limiteInfo.limite)}
                      {" "}(debe {pesos(limiteInfo.saldo)} ahora). Tú decides si aun así se le vende.
                    </Txt>
                  </View>
                )}

                {/* Resumen en vivo: mismo lenguaje que el cambio de arriba,
                    "falta" manda si aún no cubre, "cambio" si ya cubrió de
                    más en efectivo, y un estado neutro si cubre exacto —
                    sin un "$0.00" que compita por atención. */}
                <View
                  style={[
                    est.cambioCaja,
                    previa && !previa.cubre && { borderColor: T.peligro, backgroundColor: T.peligroSuave },
                  ]}
                >
                  <Txt escala="micro" tono="suave" fuerte mayus>
                    {previa && !previa.cubre ? "Falta" : previa && previa.cambio > 0 ? "Cambio" : "Listo"}
                  </Txt>
                  {previa && (!previa.cubre || previa.cambio > 0) ? (
                    <Monto
                      texto={pesos(!previa.cubre ? previa.falta : previa.cambio)}
                      escala="titulo"
                      tono={!previa.cubre ? "peligro" : "acento"}
                    />
                  ) : (
                    <Txt escala="cuerpo" tono="exito" fuerte>
                      Cubre el total
                    </Txt>
                  )}
                </View>
              </>
            )}

            <Boton
              titulo={
                mixto
                  ? "Confirmar cobro"
                  : metodo === "efectivo"
                  ? "Confirmar cobro"
                  : metodo === "tarjeta"
                  ? "Cobrar con tarjeta"
                  : metodo === "transferencia"
                  ? "Cobrar por transferencia"
                  : "Vender a crédito"
              }
              onPress={confirmar}
              cargando={cobrando}
              deshabilitado={deshabilitarConfirmar}
            />
          </KeyboardAwareScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

/**
 * Campo de importe centrado.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ NO USA `placeholder`
 * ---------------------------------------------------------------------------
 * En Android, un TextInput vacío con `textAlign: "center"` y un placeholder
 * coloca el CURSOR al final del texto del placeholder, o sea pegado al borde
 * derecho, mientras el placeholder se ve centrado. Al escribir el primer
 * dígito todo se recoloca y el cursor salta al centro. Nada está roto, pero
 * es exactamente el tipo de detalle que hace que una app parezca sin terminar
 * — y aquí ocurre en la pantalla del cobro, mirando al cliente.
 *
 * La solución no depende de ningún truco de la plataforma: el TextInput se
 * queda SIN placeholder (vacío de verdad, cursor centrado desde el principio)
 * y la pista se dibuja debajo, como una capa propia que se retira en cuanto
 * hay texto. `pointerEvents="none"` para que no se coma los toques.
 */
function CampoMonto({
  valor,
  onCambio,
  pista,
  estilo,
  autoFocus,
  onSubmitEditing,
}: {
  valor: string;
  onCambio: (v: string) => void;
  pista: string;
  estilo: StyleProp<TextStyle>;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
}) {
  const { tema: T } = useTema();
  const vacio = valor.trim() === "";
  return (
    <View style={{ justifyContent: "center" }}>
      <TextInput
        style={estilo}
        value={valor}
        onChangeText={onCambio}
        keyboardType="decimal-pad"
        autoFocus={autoFocus}
        onSubmitEditing={onSubmitEditing}
      />
      {vacio && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={[
              estilo,
              // Sin márgenes ni alto propio: esta capa solo aporta el texto,
              // la caja ya la define el TextInput de debajo.
              { color: T.textoTenue, marginBottom: 0, includeFontPadding: false },
            ]}
          >
            {pista}
          </Text>
        </View>
      )}
    </View>
  );
}

function sugerenciasBillete(totalCentavos: number): number[] {
  const t = totalCentavos / 100;
  return [20, 50, 100, 200, 500, 1000].filter((b) => b >= t).slice(0, 4);
}

// ---------------------------------------------------------------------------
function crearEstilos(T: Tema) {
  // Profundidad sutil para superficies: casi imperceptible, pero ordena.
  const sombraSuave: ViewStyle = {
    shadowColor: T.esClaro ? T.bordeFuerte : "#000",
    shadowOpacity: T.esClaro ? 0.5 : 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  };
  return StyleSheet.create({
    raiz: { flex: 1, backgroundColor: T.fondo },

    cabecera: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: T.esp,
      paddingTop: T.esps.md,
      paddingBottom: T.esps.md,
      gap: T.esps.md,
    },
    iconBtn: {
      width: 42,
      height: 42,
      borderRadius: T.radioChico,
      backgroundColor: T.superficie2,
      alignItems: "center",
      justifyContent: "center",
    },

    buscador: {
      backgroundColor: T.superficie2,
      borderRadius: T.radio,
      paddingHorizontal: T.esps.lg,
      paddingVertical: T.esps.md,
      minHeight: 48,
      fontSize: T.tipo.cuerpo,
      fontFamily: T.fuente.ui,
      color: T.texto,
      borderWidth: 1.5,
      borderColor: T.acento,
    },

    barraVista: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: T.esp,
      paddingBottom: T.esps.sm,
    },

    grid: {
      paddingHorizontal: T.esp,
      paddingTop: T.esps.xs,
      paddingBottom: T.esps.lg,
      gap: T.esps.md,
    },
    // Espacio para que la barra del ticket no tape la última fila.
    gridConBarra: { paddingBottom: 108 },

    // Departamentos
    todoBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: T.esps.md,
      backgroundColor: T.superficie,
      borderRadius: T.radio,
      padding: T.esps.lg,
      marginBottom: T.esps.md,
      minHeight: 64,
      ...sombraSuave,
    },
    deptoCard: {
      flex: 1,
      borderRadius: T.radio,
      backgroundColor: T.superficie,
      alignItems: "center",
      justifyContent: "center",
      // Antes: paddingVertical xl, que daba azulejos de ~160 px y dejaba
      // media pantalla para seis departamentos. Con esto caben nueve o
      // diez sin desplazar, que es la diferencia entre buscar y ver.
      paddingVertical: T.esps.lg,
      paddingHorizontal: T.esps.md,
      minHeight: 92,
      ...sombraSuave,
    },
    // Encabezado de grupo en la vista lista: una regla superior y el nombre
    // en versalitas tenues. Deliberadamente NO es una tarjeta ni una píldora:
    // tiene que separar sin competir con los productos, que son lo que se
    // toca.
    sepDepto: {
      flexDirection: "row",
      alignItems: "center",
      gap: T.esps.sm,
      paddingTop: T.esps.lg,
      paddingBottom: T.esps.xs,
      paddingHorizontal: T.esps.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: T.borde,
      marginTop: T.esps.xs,
    },
    deptoIconoHueco: { height: 28, justifyContent: "center" },
    deptoNombre: { textAlign: "center", marginTop: T.esps.sm },
    deptoCuentaHueco: { height: 16, justifyContent: "center" },
    deptoCuenta: { color: T.textoTenue },

    // Productos cuadrícula
    card: {
      flex: 1,
      backgroundColor: T.superficie,
      borderRadius: T.radio,
      alignItems: "center",
      paddingVertical: T.esps.md,
      paddingHorizontal: T.esps.sm,
      ...sombraSuave,
    },
    // En carrito: borde de acento de 2px + fondo acentoSuave sutil. Sin velos
    // ni opacidades fangosas: la imagen queda limpia, la tarjeta se distingue
    // por el contorno, no por un lavado encima.
    cardActiva: { borderColor: T.acento, borderWidth: 2, backgroundColor: T.acentoSuave },
    cardNombre: { textAlign: "center", marginTop: T.esps.sm, minHeight: 30 },
    badge: {
      minWidth: 26,
      height: 26,
      borderRadius: T.radioPildora,
      backgroundColor: T.acentoRelleno,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 6,
    },
    badgeCard: { position: "absolute", top: 6, right: 6, zIndex: 2 },
    cardQuitar: {
      position: "absolute",
      top: 6,
      left: 6,
      zIndex: 2,
      width: 26,
      height: 26,
      borderRadius: T.radioPildora,
      backgroundColor: T.superficie2,
      alignItems: "center",
      justifyContent: "center",
    },

    // Productos lista
    filaCard: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: T.esps.md,
      backgroundColor: T.superficie,
      borderRadius: T.radio,
      padding: T.esps.md,
      minHeight: 64,
      ...sombraSuave,
    },
    filaQuitar: {
      width: 34,
      height: 34,
      borderRadius: T.radioChico,
      backgroundColor: T.superficie2,
      alignItems: "center",
      justifyContent: "center",
    },

    // Líneas del ticket
    linea: {
      flexDirection: "row",
      alignItems: "center",
      gap: T.esps.sm,
      paddingVertical: T.esps.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: T.borde,
    },
    cantCtrl: {
      flexDirection: "row",
      alignItems: "center",
      gap: T.esps.xs,
      backgroundColor: T.superficie2,
      borderRadius: T.radioChico,
      padding: 3,
    },
    cantBtn: {
      width: 34,
      height: 34,
      borderRadius: T.radioChico,
      backgroundColor: T.superficie,
      alignItems: "center",
      justifyContent: "center",
    },
    quitarBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },

    // Entrada de dinero: Plex Mono, grande y centrada. Es la cifra que el
    // cajero teclea mirando al cliente, no mirando la pantalla.
    montoInput: {
      fontFamily: T.fuente.numFuerte,
      fontSize: T.tipo.titulo,
      textAlign: "center",
      marginBottom: T.esps.md,
    },
    rapidos: { flexDirection: "row", gap: T.esps.sm, marginBottom: T.esps.lg },
    rapido: {
      flex: 1,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: T.radioChico,
      backgroundColor: T.superficie2,
    },

    // Cobro
    segmento: {
      flexDirection: "row",
      backgroundColor: T.superficie2,
      borderRadius: T.radio,
      padding: 3,
      marginBottom: T.esps.lg,
    },
    segBtn: {
      flex: 1,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: T.radioChico,
    },
    canjeCaja: {
      backgroundColor: T.superficie,
      borderRadius: T.radio,
      borderWidth: 1,
      borderColor: T.borde,
      padding: T.esps.lg,
      marginBottom: T.esps.lg,
    },
    cambioCaja: {
      alignItems: "center",
      backgroundColor: T.acentoSuave,
      borderRadius: T.radio,
      borderWidth: 1,
      borderColor: T.acentoBorde,
      paddingVertical: T.esps.lg,
      marginBottom: T.esps.lg,
    },

    // Pago mixto — el enlace que lo activa desde el modo simple, y todo lo
    // que aparece una vez activado. Mismo lenguaje visual que el resto del
    // modal (superficie2, radioChico, acento para lo interactivo), nada
    // nuevo que aprender.
    mixtoLink: {
      alignItems: "center",
      paddingVertical: T.esps.md,
      marginTop: -T.esps.xs,
      marginBottom: T.esps.lg,
    },
    mixtoCabecera: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: T.esps.md,
    },
    filaMixta: {
      backgroundColor: T.superficie,
      borderRadius: T.radio,
      borderWidth: 1,
      borderColor: T.borde,
      padding: T.esps.md,
      marginBottom: T.esps.md,
    },
    filaMixtaMetodo: {
      flexDirection: "row",
      gap: T.esps.xs,
      flexWrap: "wrap",
    },
    chipMetodo: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: T.radioChico,
      backgroundColor: T.superficie2,
    },
    quitarFila: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: T.radioChico,
      backgroundColor: T.peligroSuave,
    },
    agregarFila: {
      alignItems: "center",
      paddingVertical: T.esps.md,
      marginBottom: T.esps.lg,
      borderRadius: T.radioChico,
      borderWidth: 1,
      borderColor: T.borde,
      borderStyle: "dashed",
    },

    // Toast
    avisoCaja: { position: "absolute", left: 0, right: 0, paddingHorizontal: T.esp },
    avisoInterior: {
      flexDirection: "row",
      alignItems: "center",
      gap: T.esps.md,
      backgroundColor: T.superficie,
      borderRadius: T.radio,
      borderWidth: 1,
      borderColor: T.borde,
      paddingHorizontal: T.esps.lg,
      paddingVertical: T.esps.md,
      shadowColor: T.esClaro ? T.bordeFuerte : "#000",
      shadowOpacity: 0.25,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
  });
}
