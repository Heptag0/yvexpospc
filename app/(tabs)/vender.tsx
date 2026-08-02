// YvexPOS Móvil — Pantalla VENDER (táctil, por departamentos).
//
// Flujo pensado para dedos y catálogos grandes:
//   1. Ves los DEPARTAMENTOS como tarjetas grandes con icono y color.
//   2. Tocas "Bebidas" -> entras y ves SUS productos (no todos revueltos).
//   3. Tocas el producto -> entra al ticket, con contador en la tarjeta.
// Botón "Todos" para el modo antiguo (todo el catálogo), y lupa para el
// lector de códigos. Vista configurable: cuadrícula 2/3/4 o lista.
// El ticket se expande desde abajo y permite QUITAR líneas (bug reportado).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  FlatList,
  Modal,
  ScrollView,
  Switch,
  KeyboardAvoidingView,
  Platform,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import {
  Turno,
  ItemCarrito,
  MetodoPago,
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
import { pesos, aCentavos } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, CabeceraModal, useEstiloInput } from "@/src/componentes/ui";
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
  const [aviso, setAviso] = useState<{ texto: string; accion?: { label: string; onPress: () => void } } | null>(null);
  const avisoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Alta de producto desde un código desconocido (prellenado, usuario confirma).
  const [formNuevo, setFormNuevo] = useState<{ codigo: string; nombre: string | null } | null>(null);

  function mostrarAviso(texto: string, accion?: { label: string; onPress: () => void }) {
    if (avisoTimer.current) clearTimeout(avisoTimer.current);
    setAviso({ texto, accion });
    avisoTimer.current = setTimeout(() => setAviso(null), 4000);
  }

  useEffect(() => () => { if (avisoTimer.current) clearTimeout(avisoTimer.current); }, []);

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

  // Guarda de modo Monitoreo: la pestaña Vender se oculta, pero si alguien
  // llega aquí por una ruta vieja, ve el motivo en vez de la caja.
  if (modo === "monitor") {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: T.fondo,
          alignItems: "center",
          justifyContent: "center",
          padding: T.esp,
        }}
        edges={["top"]}
      >
        <IconoUI id="reportes" size={34} color={T.textoTenue} />
        <Text
          style={{
            color: T.texto,
            fontSize: 17,
            fontWeight: "800",
            marginTop: 14,
            textAlign: "center",
          }}
        >
          Este dispositivo está en modo Monitoreo.
        </Text>
        <Text style={{ color: T.textoSuave, fontSize: 14, marginTop: 8, textAlign: "center" }}>
          Puedes cambiarlo en Ajustes.
        </Text>
      </SafeAreaView>
    );
  }

  const total = carrito.reduce((s, i) => s + Math.round(i.precio_centavos * i.cantidad), 0);
  const articulos = carrito.reduce((s, i) => s + i.cantidad, 0);
  const cantidadDe = (id: string) =>
    carrito.find((i) => i.producto_id === id)?.cantidad ?? 0;

  // Productos visibles según la selección y la búsqueda.
  const q = busqueda.trim().toLowerCase();
  const visibles = productos.filter((p) => {
    if (buscando && q) {
      return (
        p.nombre.toLowerCase().includes(q) ||
        (p.codigo_barras ?? "").toLowerCase().includes(q)
      );
    }
    if (seleccion === "__todos__") return true;
    if (seleccion === "__sin__") return p.categoria_id === null;
    return p.categoria_id === seleccion;
  });

  const sinDepto = conteos.get("__sin__") ?? 0;
  const catActual = categorias.find((c) => c.id === seleccion);

  function agregar(p: Producto | ProductoLista) {
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
  }

  function cambiarCantidad(id: string, delta: number) {
    setCarrito((prev) =>
      prev
        .map((i) => (i.producto_id === id ? { ...i, cantidad: i.cantidad + delta } : i))
        .filter((i) => i.cantidad > 0)
    );
  }

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

  /** Quita una línea completa del ticket (bug reportado: no se podía). */
  function quitarLinea(id: string) {
    setCarrito((prev) => prev.filter((i) => i.producto_id !== id));
  }

  function vaciarTicket() {
    setCarrito([]);
    setClienteTicket(null);
    setTicketAbierto(false);
  }

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

  if (turno === undefined) return <SafeAreaView style={est.raiz} />;

  // ---------------- Sin turno ----------------
  if (!turno) {
    return (
      <SafeAreaView style={est.raiz} edges={["top"]}>
        <View style={est.abrirCaja}>
          <Text style={est.marca}>
            Yvex<Text style={{ color: T.turquesa }}>POS</Text>
          </Text>
          <Text style={est.abrirTitulo}>Abrir turno</Text>
          <Text style={est.abrirSub}>
            ¿Con cuánto efectivo abre el cajón? Puedes dejarlo vacío para
            empezar sin fondo.
          </Text>
          <Banner texto={error} tipo="error" />
          <TextInput
            style={[estiloInput, est.abrirInput]}
            value={fondo}
            onChangeText={setFondo}
            keyboardType="decimal-pad"
            placeholder="$ 0.00"
            placeholderTextColor={T.textoTenue}
            onSubmitEditing={abrir}
          />
          <View style={est.abrirRapidos}>
            {["0", "200", "500", "1000"].map((m) => (
              <Pressable key={m} style={est.rapido} onPress={() => setFondo(m)}>
                <Text style={est.rapidoTxt}>{m === "0" ? "Sin fondo" : `$${m}`}</Text>
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

  return (
    <SafeAreaView style={est.raiz} edges={["top"]}>
      {/* Cabecera: atrás (si estás dentro), título, lupa */}
      <View style={est.cabecera}>
        {!enDeptos && (
          <Pressable
            style={est.atras}
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
          <Text style={est.marca}>
            Yvex<Text style={{ color: T.turquesa }}>POS</Text>
          </Text>
          <Text style={est.titulo} numberOfLines={1}>
            {enDeptos
              ? "Vender"
              : buscando && q
              ? "Búsqueda"
              : seleccion === "__todos__"
              ? "Todo el catálogo"
              : seleccion === "__sin__"
              ? "Sin departamento"
              : catActual?.nombre ?? "Productos"}
          </Text>
        </View>
        <Pressable
          style={est.iconBtn}
          onPress={() => setEscanerAbierto(true)}
        >
          <IconoUI id="escaner" size={19} color={T.textoSuave} grosor={1.8} />
        </Pressable>
        <Pressable
          style={[est.iconBtn, buscando && { backgroundColor: T.acento, borderColor: T.acento }]}
          onPress={() => {
            setBuscando((v) => !v);
            setBusqueda("");
          }}
        >
          <IconoUI id="buscar" size={19} color={buscando ? T.acentoTexto : T.textoSuave} grosor={2} />
        </Pressable>
      </View>

      {/* Buscador */}
      {buscando && (
        <View style={est.buscadorCaja}>
          <TextInput
            style={est.buscador}
            placeholder="Escanea un código o escribe…"
            placeholderTextColor={T.textoTenue}
            value={busqueda}
            onChangeText={setBusqueda}
            onSubmitEditing={enviarBusqueda}
            autoCapitalize="none"
            autoFocus
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
          contentContainerStyle={est.grid}
          columnWrapperStyle={{ gap: 10 }}
          ListHeaderComponent={
            <Pressable style={est.todoBtn} onPress={() => setSeleccion("__todos__")}>
              <IconoUI id="grid3" size={21} color={T.acento} />
              <View style={{ flex: 1 }}>
                <Text style={est.todoTitulo}>Todo el catálogo</Text>
                <Text style={est.todoMeta}>{productos.length} productos</Text>
              </View>
              <Text style={est.todoFlecha}>→</Text>
            </Pressable>
          }
          ListEmptyComponent={
            <Text style={est.vacio}>
              No tienes departamentos. Créalos en Inventario → Departamentos.
            </Text>
          }
          ListFooterComponent={
            sinDepto > 0 ? (
              <Pressable
                style={[est.todoBtn, { marginTop: 10 }]}
                onPress={() => setSeleccion("__sin__")}
              >
                <IconoUI id="inventario" size={21} color={T.textoSuave} />
                <View style={{ flex: 1 }}>
                  <Text style={est.todoTitulo}>Sin departamento</Text>
                  <Text style={est.todoMeta}>{sinDepto} productos</Text>
                </View>
                <Text style={est.todoFlecha}>→</Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => {
            const c = item.color ?? T.acento;
            const n = conteos.get(item.id) ?? 0;
            return (
              <Pressable
                style={({ pressed }) => [
                  est.deptoCard,
                  { borderColor: c + "66", backgroundColor: c + "14" },
                  pressed && { transform: [{ scale: 0.97 }], backgroundColor: c + "26" },
                ]}
                onPress={() => setSeleccion(item.id)}
              >
                <Icono id={item.icono} size={38} color={c} />
                <Text style={est.deptoNombre} numberOfLines={2}>{item.nombre}</Text>
                <Text style={[est.deptoMeta, { color: c }]}>{n} productos</Text>
              </Pressable>
            );
          }}
        />
      ) : (
        /* ---------- NIVEL 2: productos ---------- */
        <>
          <View style={est.barraVista}>
            <Text style={est.barraVistaTxt}>
              {visibles.length} producto{visibles.length === 1 ? "" : "s"}
            </Text>
            <SelectorVista vista={vista} onCambio={setVista} />
          </View>

          <FlatList
            data={visibles}
            key={vista}
            numColumns={cols}
            keyExtractor={(p) => p.id}
            contentContainerStyle={est.grid}
            columnWrapperStyle={cols > 1 ? { gap: 9 } : undefined}
            ListEmptyComponent={
              <Text style={est.vacio}>
                {q ? "Sin resultados." : "No hay productos aquí."}
              </Text>
            }
            renderItem={({ item }) => {
              const enTicket = cantidadDe(item.id);
              // --- Vista LISTA ---
              if (vista === "lista") {
                return (
                  <Pressable
                    style={({ pressed }) => [
                      est.filaCard,
                      enTicket > 0 && est.cardActiva,
                      pressed && { backgroundColor: T.superficie3 },
                    ]}
                    onPress={() => agregar(item)}
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
                      <Text style={est.filaNombre} numberOfLines={1}>{item.nombre}</Text>
                      <Text style={est.filaPrecio}>{pesos(item.precio_venta_centavos)}</Text>
                    </View>
                    {enTicket > 0 && (
                      <>
                        <Pressable
                          style={est.filaQuitar}
                          onPress={() => cambiarCantidad(item.id, -1)}
                          hitSlop={8}
                        >
                          <Text style={est.cardQuitarTxt}>−</Text>
                        </Pressable>
                        <View style={est.filaBadge}>
                          <Text style={est.cardBadgeTxt}>{enTicket}</Text>
                        </View>
                      </>
                    )}
                  </Pressable>
                );
              }
              // --- Vista CUADRÍCULA ---
              const chico = cols >= 4;
              return (
                <Pressable
                  style={({ pressed }) => [
                    est.card,
                    enTicket > 0 && est.cardActiva,
                    pressed && { transform: [{ scale: 0.95 }], backgroundColor: T.superficie3 },
                  ]}
                  onPress={() => agregar(item)}
                >
                  {enTicket > 0 && (
                    <>
                      {/* Contador (derecha) */}
                      <View style={est.cardBadge}>
                        <Text style={est.cardBadgeTxt}>{enTicket}</Text>
                      </View>
                      {/* Restar / quitar (izquierda) */}
                      <Pressable
                        style={est.cardQuitar}
                        onPress={() => cambiarCantidad(item.id, -1)}
                        hitSlop={10}
                      >
                        <Text style={est.cardQuitarTxt}>−</Text>
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
                  <Text
                    style={[est.cardNombre, chico && { fontSize: 10, minHeight: 24 }]}
                    numberOfLines={2}
                  >
                    {item.nombre}
                  </Text>
                  <Text style={[est.cardPrecio, chico && { fontSize: 11.5 }]}>
                    {pesos(item.precio_venta_centavos)}
                  </Text>
                </Pressable>
              );
            }}
          />
        </>
      )}

      {/* Barra de ticket */}
      <View style={est.barraCobro}>
        <Pressable style={{ flex: 1 }} onPress={() => carrito.length > 0 && setTicketAbierto(true)}>
          <Text style={est.totalLbl}>
            {articulos > 0 ? `TICKET · ${articulos} art. · toca para ver` : "TICKET VACÍO"}
          </Text>
          <Text style={est.totalVal}>{pesos(total)}</Text>
        </Pressable>
        {/* Cliente de lealtad (solo si el programa está activo) */}
        {reglas?.activa && (
          clienteTicket ? (
            <View style={est.clienteChip}>
              <Pressable onPress={() => setModalClienteAbierto(true)} style={{ flexShrink: 1 }}>
                <Text style={est.clienteChipNombre} numberOfLines={1}>
                  {clienteTicket.nombre}
                </Text>
                <Text style={est.clienteChipPts}>{clienteTicket.puntos} pts</Text>
              </Pressable>
              <Pressable onPress={() => setClienteTicket(null)} hitSlop={8}>
                <Text style={est.clienteChipQuitar}>✕</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={est.clienteBtn}
              onPress={() => setModalClienteAbierto(true)}
              hitSlop={6}
            >
              <IconoUI id="persona" size={20} color={T.textoSuave} grosor={1.9} />
              <Text style={est.clienteBtnTxt}>Cliente</Text>
            </Pressable>
          )
        )}
        <Pressable
          style={[est.btnCobrar, carrito.length === 0 && { opacity: 0.4 }]}
          disabled={carrito.length === 0}
          onPress={() => setCobroAbierto(true)}
        >
          <Text style={est.btnCobrarTxt}>Cobrar</Text>
        </Pressable>
      </View>

      {/* Ticket expandido (con QUITAR y VACIAR) */}
      {ticketAbierto && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setTicketAbierto(false)}>
          <Pressable style={est.ticketFondo} onPress={() => setTicketAbierto(false)}>
            <Pressable style={est.ticketPanel} onPress={() => {}}>
              <View style={est.ticketAsa} />
              <View style={est.ticketCab}>
                <Text style={est.ticketTitulo}>Ticket · {articulos} artículos</Text>
                <Pressable onPress={vaciarTicket} hitSlop={10}>
                  <Text style={est.ticketVaciar}>Vaciar</Text>
                </Pressable>
              </View>
              <ScrollView style={{ maxHeight: 330 }}>
                {carrito.map((i) => (
                  <View key={i.producto_id} style={est.linea}>
                    <View style={{ flex: 1, paddingRight: 6 }}>
                      <Text style={est.lineaNombre} numberOfLines={1}>{i.nombre}</Text>
                      <Text style={est.lineaMeta}>
                        {pesos(i.precio_centavos)} c/u ·{" "}
                        <Text style={{ color: T.turquesa, fontWeight: "800" }}>
                          {pesos(Math.round(i.precio_centavos * i.cantidad))}
                        </Text>
                      </Text>
                    </View>
                    <View style={est.cantCtrl}>
                      <Pressable style={est.cantBtn} onPress={() => cambiarCantidad(i.producto_id, -1)}>
                        <Text style={est.cantBtnTxt}>−</Text>
                      </Pressable>
                      <Text style={est.cantNum}>{i.cantidad}</Text>
                      <Pressable style={est.cantBtn} onPress={() => cambiarCantidad(i.producto_id, +1)}>
                        <Text style={est.cantBtnTxt}>+</Text>
                      </Pressable>
                    </View>
                    {/* QUITAR línea completa */}
                    <Pressable
                      style={est.quitarBtn}
                      onPress={() => quitarLinea(i.producto_id)}
                      hitSlop={8}
                    >
                      <Text style={est.quitarTxt}>✕</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
              <View style={est.ticketPie}>
                <View style={{ flex: 1 }}>
                  <Text style={est.totalLbl}>TOTAL</Text>
                  <Text style={est.totalVal}>{pesos(total)}</Text>
                </View>
                <Pressable
                  style={est.btnCobrar}
                  onPress={() => {
                    setTicketAbierto(false);
                    setCobroAbierto(true);
                  }}
                >
                  <Text style={est.btnCobrarTxt}>Cobrar</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {cobroAbierto && (
        <ModalCobro
          total={total}
          items={carrito}
          cliente={reglas?.activa ? clienteTicket : null}
          reglas={reglas}
          onCerrar={() => setCobroAbierto(false)}
          onCobrado={async (r, metodo, pagadoCentavos, canje) => {
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
            let extrasLealtad: { clienteNombre: string; puntosGanados: number; saldoPuntos: number } | undefined;
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
            const t = await construirTicket(r, carrito, metodo, pagadoCentavos, extrasLealtad);
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

      {/* Aviso breve (toast) */}
      {aviso && (
        <View style={[est.avisoCaja, !escanerAbierto && { bottom: 108 }]} pointerEvents="box-none">
          <View style={est.avisoInterior}>
            <Text style={est.avisoTxt} numberOfLines={2}>{aviso.texto}</Text>
            {aviso.accion && (
              <Pressable
                style={est.avisoBtn}
                onPress={() => aviso.accion?.onPress()}
                hitSlop={8}
              >
                <Text style={est.avisoBtnTxt}>{aviso.accion.label}</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
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
    metodo: MetodoPago,
    pagadoCentavos: number,
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

  // Canje de puntos: REGLA DE NEGOCIO — NUNCA se aplica automáticamente. El
  // switch nace APAGADO; el cajero lo prende, ve el cálculo en vivo y
  // confirma con el mismo botón de cobro.
  const [canjeOn, setCanjeOn] = useState(false);
  const [puntosTxt, setPuntosTxt] = useState("");

  const puedeCanjear =
    !!cliente && !!reglas?.activa && (cliente?.puntos ?? 0) > 0;

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

  const recibidoC = recibido.trim() === "" ? totalFinal : aCentavos(recibido);
  const cambio = metodo === "efectivo" ? recibidoC - totalFinal : 0;

  async function confirmar() {
    setError("");
    setCobrando(true);
    try {
      const r = await cobrar(
        items,
        metodo,
        metodo === "efectivo" ? recibidoC : totalFinal,
        {
          clienteId: cliente?.id,
          descuentoCentavos: canje.descuentoCentavos,
        }
      );
      onCobrado(
        r,
        metodo,
        metodo === "efectivo" ? recibidoC : totalFinal,
        canje.descuentoCentavos > 0 ? canje : undefined
      );
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setCobrando(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={est.raiz}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <CabeceraModal titulo="Cobrar" onIzquierda={onCerrar} />
          <View style={{ padding: T.esp }}>
            <Text style={est.cobroTotalLbl}>TOTAL A COBRAR</Text>
            <Text style={est.cobroTotal}>{pesos(totalFinal)}</Text>
            <Banner texto={error} tipo="error" />

            {/* Canje de puntos: solo con cliente ligado, saldo > 0 y lealtad
                activa. Nace APAGADO — el cajero decide y confirma. */}
            {puedeCanjear && cliente && reglas && (
              <View style={[est.canjeCaja, canjeOn && { borderColor: T.acento }]}>
                <View style={est.canjeFila}>
                  <IconoUI id="regalo" size={18} color={T.acento} />
                  <View style={{ flex: 1 }}>
                    <Text style={est.canjeTitulo}>Canjear puntos de {cliente.nombre}</Text>
                    <Text style={est.canjeMeta}>Tiene {cliente.puntos} pts disponibles</Text>
                  </View>
                  <Switch
                    value={canjeOn}
                    onValueChange={setCanjeOn}
                    trackColor={{ false: T.superficie3, true: T.acento + "66" }}
                    thumbColor={canjeOn ? T.acento : T.textoTenue}
                  />
                </View>
                {canjeOn && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={est.canjeMeta}>
                      ¿Cuántos puntos? Vacío = todos ({cliente.puntos}).
                    </Text>
                    <TextInput
                      style={[estiloInput, est.canjeInput]}
                      value={puntosTxt}
                      onChangeText={(t) => setPuntosTxt(t.replace(/[^0-9]/g, ""))}
                      keyboardType="number-pad"
                      placeholder={String(cliente.puntos)}
                      placeholderTextColor={T.textoTenue}
                    />
                    <View style={est.canjeResumen}>
                      {canje.descuentoCentavos > 0 ? (
                        <Text style={est.canjeResumenTxt}>
                          −{pesos(canje.descuentoCentavos)} por {canje.puntosUsados}{" "}
                          punto{canje.puntosUsados === 1 ? "" : "s"} · su saldo quedaría
                          en {cliente.puntos - canje.puntosUsados}
                        </Text>
                      ) : (
                        <Text style={[est.canjeResumenTxt, { color: T.textoTenue }]}>
                          Con este ticket no aplica descuento (revisa el tope o el total).
                        </Text>
                      )}
                    </View>
                  </View>
                )}
              </View>
            )}

            <View style={est.segmento}>
              {(["efectivo", "tarjeta"] as MetodoPago[]).map((m) => (
                <Pressable key={m} onPress={() => setMetodo(m)} style={[est.segBtn, metodo === m && est.segActivo]}>
                  <Text style={[est.segTxt, metodo === m && est.segTxtActivo]}>
                    {m === "efectivo" ? "Efectivo" : "Tarjeta"}
                  </Text>
                </Pressable>
              ))}
            </View>
            {metodo === "efectivo" && (
              <>
                <Text style={est.cobroAyuda}>¿Con cuánto paga? Vacío = pago exacto.</Text>
                <TextInput
                  style={[estiloInput, est.cobroInput]}
                  value={recibido}
                  onChangeText={setRecibido}
                  keyboardType="decimal-pad"
                  placeholder={pesos(totalFinal)}
                  placeholderTextColor={T.textoTenue}
                  autoFocus
                />
                <View style={est.abrirRapidos}>
                  {sugerenciasBillete(totalFinal).map((m) => (
                    <Pressable key={m} style={est.rapido} onPress={() => setRecibido(String(m))}>
                      <Text style={est.rapidoTxt}>${m}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={[est.cambioCaja, cambio < 0 && { borderColor: T.peligro }]}>
                  <Text style={est.cambioLbl}>{cambio < 0 ? "FALTA" : "CAMBIO"}</Text>
                  <Text style={[est.cambioVal, cambio < 0 && { color: T.peligro }]}>
                    {pesos(Math.abs(cambio))}
                  </Text>
                </View>
              </>
            )}
            <Boton
              titulo={metodo === "efectivo" ? "Confirmar cobro" : "Cobrar con tarjeta"}
              onPress={confirmar}
              cargando={cobrando}
              deshabilitado={metodo === "efectivo" && cambio < 0}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function sugerenciasBillete(totalCentavos: number): number[] {
  const t = totalCentavos / 100;
  return [20, 50, 100, 200, 500, 1000].filter((b) => b >= t).slice(0, 4);
}

// ---------------------------------------------------------------------------
function crearEstilos(T: Tema) {
  // Sombra/brillo de marca, suavizado: levanta solo los CTA clave.
  const brilloAcento: ViewStyle = {
    shadowColor: T.acento,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  };
  // Profundidad sutil para superficies: casi imperceptible, pero ordena.
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
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: T.esp,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 11,
  },
  marca: { color: T.texto, fontSize: 12, fontWeight: "900", letterSpacing: 1.5, opacity: 0.8 },
  titulo: { fontSize: 27, fontWeight: "800", color: T.texto, letterSpacing: -0.7, marginTop: 1 },
  atras: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: T.superficie2, borderWidth: 1, borderColor: T.bordeFuerte,
    alignItems: "center", justifyContent: "center",
  },
  atrasTxt: { color: T.texto, fontSize: 20, fontWeight: "800" },
  iconBtn: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: T.superficie2, borderWidth: 1, borderColor: T.bordeFuerte,
    alignItems: "center", justifyContent: "center",
  },
  iconBtnTxt: { color: T.textoSuave, fontSize: 21, fontWeight: "800", marginTop: -2 },

  buscadorCaja: { paddingHorizontal: T.esp, paddingBottom: 8 },
  buscador: {
    backgroundColor: T.superficie2, borderRadius: T.radio,
    paddingHorizontal: 16, paddingVertical: 12, fontSize: 15,
    color: T.texto, borderWidth: 1.5, borderColor: T.acento,
  },

  barraVista: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: T.esp, paddingBottom: 8,
  },
  barraVistaTxt: { color: T.textoTenue, fontSize: 12, fontWeight: "700" },

  grid: { paddingHorizontal: T.esp, paddingTop: 4, paddingBottom: 16, gap: 10 },

  // Departamentos
  todoBtn: {
    flexDirection: "row", alignItems: "center", gap: 13,
    backgroundColor: T.superficie, borderRadius: T.radio + 2,
    borderWidth: 1, borderColor: T.bordeFuerte, padding: 16, marginBottom: 10,
    ...sombraSuave,
  },
  todoIcono: { fontSize: 22, color: T.acento },
  todoTitulo: { color: T.texto, fontSize: 15, fontWeight: "800" },
  todoMeta: { color: T.textoTenue, fontSize: 12, marginTop: 2 },
  todoFlecha: { color: T.turquesa, fontSize: 17, fontWeight: "800" },
  deptoCard: {
    flex: 1, borderRadius: T.radio + 4, borderWidth: 1.5,
    alignItems: "center", paddingVertical: 22, paddingHorizontal: 10,
  },
  deptoIcono: { fontSize: 40 },
  deptoNombre: {
    color: T.texto, fontSize: 15, fontWeight: "800",
    textAlign: "center", marginTop: 10,
  },
  deptoMeta: { fontSize: 12, fontWeight: "700", marginTop: 3 },

  // Productos cuadrícula
  card: {
    flex: 1, backgroundColor: T.superficie, borderRadius: T.radio + 2,
    borderWidth: 1, borderColor: T.borde, alignItems: "center",
    paddingVertical: 12, paddingHorizontal: 6, ...sombraSuave,
  },
  // En carrito: borde de acento de 2px + fondo acentoSuave sutil. Sin velos
  // ni opacidades fangosas: la imagen queda limpia, la tarjeta se distingue
  // por el contorno, no por un lavado encima.
  cardActiva: { borderColor: T.acento, borderWidth: 2, backgroundColor: T.acentoSuave },
  cardBadge: {
    position: "absolute", top: 6, right: 6, minWidth: 22, height: 22,
    borderRadius: 11, backgroundColor: T.acento, alignItems: "center",
    justifyContent: "center", paddingHorizontal: 5, zIndex: 3, ...brilloAcento,
  },
  cardBadgeTxt: { color: T.acentoTexto, fontSize: 12, fontWeight: "800" },
  // "Quitar uno": círculo sólido del tema, bien alineado, legible en los 6
  // temas. No tapa la imagen con translúcidos: es un botón limpio.
  cardQuitar: {
    position: "absolute", top: 6, left: 6,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: T.superficie3, borderWidth: 1.5, borderColor: T.peligro,
    alignItems: "center", justifyContent: "center", zIndex: 3,
    elevation: 4,
  },
  cardQuitarTxt: { color: T.peligro, fontSize: 15, fontWeight: "900", marginTop: -2 },
  filaQuitar: {
    width: 30, height: 30, borderRadius: 9,
    backgroundColor: T.peligroSuave, borderWidth: 1, borderColor: T.peligro + "88",
    alignItems: "center", justifyContent: "center",
  },
  cardNombre: {
    color: T.texto, fontSize: 11.5, fontWeight: "700", textAlign: "center",
    marginTop: 8, lineHeight: 14, minHeight: 28,
  },
  cardPrecio: { color: T.turquesa, fontSize: 13, fontWeight: "800", marginTop: 3, ...cifras },

  // Productos lista
  filaCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: T.superficie, borderRadius: T.radio,
    borderWidth: 1, borderColor: T.borde, padding: 12, marginBottom: 8,
    ...sombraSuave,
  },
  filaNombre: { color: T.texto, fontSize: 15, fontWeight: "700" },
  filaPrecio: { color: T.turquesa, fontSize: 14, fontWeight: "800", marginTop: 2, ...cifras },
  filaBadge: {
    minWidth: 26, height: 26, borderRadius: 13, backgroundColor: T.acento,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 6,
  },

  vacio: {
    textAlign: "center", color: T.textoTenue, marginTop: 44,
    fontSize: 15, paddingHorizontal: 40, lineHeight: 22,
  },

  barraCobro: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: T.esp, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: T.borde, backgroundColor: T.superficie,
  },
  totalLbl: { color: T.textoSuave, fontSize: 10.5, fontWeight: "800", letterSpacing: 0.7 },
  totalVal: { color: T.texto, fontSize: 27, fontWeight: "800", letterSpacing: -0.5, ...cifras },
  btnCobrar: {
    backgroundColor: T.acento, borderRadius: T.radio,
    paddingHorizontal: 32, minHeight: 56,
    alignItems: "center", justifyContent: "center", ...brilloAcento,
  },
  btnCobrarTxt: { color: T.acentoTexto, fontSize: 17, fontWeight: "800" },

  ticketFondo: { flex: 1, backgroundColor: "rgba(5,3,15,0.62)", justifyContent: "flex-end" },
  ticketPanel: {
    backgroundColor: T.superficie,
    borderTopLeftRadius: T.radioGrande + 4, borderTopRightRadius: T.radioGrande + 4,
    borderWidth: 1, borderColor: T.bordeFuerte, padding: T.esp, paddingBottom: 30,
  },
  ticketAsa: {
    alignSelf: "center", width: 46, height: 5, borderRadius: 3,
    backgroundColor: T.textoTenue, marginBottom: 14,
  },
  ticketCab: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 12,
  },
  ticketTitulo: { color: T.texto, fontSize: 17, fontWeight: "800", letterSpacing: -0.2 },
  ticketVaciar: { color: T.peligro, fontSize: 13, fontWeight: "800" },
  ticketPie: {
    flexDirection: "row", alignItems: "center", gap: 14, marginTop: 12,
    paddingTop: 12, borderTopWidth: 1, borderTopColor: T.borde,
  },
  linea: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: T.superficie2, borderRadius: T.radioChico + 2,
    borderWidth: 1, borderColor: T.borde, padding: 11, marginBottom: 7,
  },
  lineaNombre: { color: T.texto, fontSize: 14, fontWeight: "700" },
  lineaMeta: { color: T.textoTenue, fontSize: 11, marginTop: 2, ...cifras },
  cantCtrl: { flexDirection: "row", alignItems: "center", gap: 2 },
  cantBtn: {
    width: 31, height: 31, borderRadius: 8, backgroundColor: T.superficie3,
    borderWidth: 1, borderColor: T.bordeFuerte,
    alignItems: "center", justifyContent: "center",
  },
  cantBtnTxt: { color: T.texto, fontSize: 17, fontWeight: "800", marginTop: -1 },
  cantNum: { color: T.texto, fontSize: 15, fontWeight: "800", minWidth: 26, textAlign: "center", ...cifras },
  quitarBtn: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: T.peligroSuave, borderWidth: 1, borderColor: T.peligro + "66",
    alignItems: "center", justifyContent: "center",
  },
  quitarTxt: { color: T.peligro, fontSize: 13, fontWeight: "800" },

  // Aviso breve (toast) del escáner
  avisoCaja: {
    position: "absolute", left: T.esp, right: T.esp, bottom: 26,
  },
  avisoInterior: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: T.superficie3, borderWidth: 1, borderColor: T.bordeFuerte,
    borderRadius: T.radio, paddingVertical: 12, paddingHorizontal: 15,
    ...sombraSuave,
  },
  avisoTxt: { flex: 1, color: T.texto, fontSize: 13.5, fontWeight: "700" },
  avisoBtn: {
    backgroundColor: T.acento, borderRadius: T.radioChico,
    paddingVertical: 8, paddingHorizontal: 13,
  },
  avisoBtnTxt: { color: T.acentoTexto, fontSize: 13, fontWeight: "800" },

  abrirCaja: { flex: 1, justifyContent: "center", padding: T.esp + 8 },
  abrirTitulo: { color: T.texto, fontSize: 26, fontWeight: "800", marginTop: 14 },
  abrirSub: { color: T.textoSuave, fontSize: 14, lineHeight: 21, marginTop: 6, marginBottom: 18 },
  abrirInput: { fontSize: 26, fontWeight: "800", textAlign: "center", paddingVertical: 16, ...cifras },
  abrirRapidos: { flexDirection: "row", gap: 8, marginVertical: 14 },
  rapido: {
    flex: 1, backgroundColor: T.superficie2, borderWidth: 1,
    borderColor: T.bordeFuerte, borderRadius: T.radioChico + 2,
    paddingVertical: 12, alignItems: "center",
  },
  rapidoTxt: { color: T.textoSuave, fontSize: 13, fontWeight: "700", ...cifras },

  cobroTotalLbl: { color: T.textoSuave, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textAlign: "center", marginTop: 6 },
  cobroTotal: { color: T.texto, fontSize: 40, fontWeight: "800", textAlign: "center", marginBottom: 16, letterSpacing: -1, ...cifras },
  segmento: {
    flexDirection: "row", backgroundColor: T.superficie,
    borderRadius: T.radioChico + 2, borderWidth: 1, borderColor: T.borde,
    padding: 4, marginBottom: 14,
  },
  segBtn: { flex: 1, paddingVertical: 12, borderRadius: T.radioChico - 2, alignItems: "center" },
  segActivo: { backgroundColor: T.acento },
  segTxt: { color: T.textoSuave, fontSize: 15, fontWeight: "600" },
  segTxtActivo: { color: T.acentoTexto, fontWeight: "800" },
  cobroAyuda: { color: T.textoTenue, fontSize: 13, marginBottom: 8 },
  cobroInput: { fontSize: 26, fontWeight: "800", textAlign: "center", paddingVertical: 14, ...cifras },
  cambioCaja: {
    backgroundColor: T.turquesaSuave, borderWidth: 1, borderColor: T.turquesa,
    borderRadius: T.radio, alignItems: "center", paddingVertical: 14, marginBottom: 16,
  },
  cambioLbl: { color: T.textoSuave, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  cambioVal: { color: T.turquesa, fontSize: 28, fontWeight: "800", ...cifras },

  // Cliente de lealtad en la barra del ticket
  clienteBtn: {
    alignItems: "center", justifyContent: "center", gap: 3,
    paddingHorizontal: 10, minHeight: 56,
    borderRadius: T.radio, borderWidth: 1, borderColor: T.bordeFuerte,
    backgroundColor: T.superficie2,
  },
  clienteBtnTxt: { color: T.textoSuave, fontSize: 10.5, fontWeight: "800" },
  clienteChip: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, minHeight: 56, maxWidth: 150,
    borderRadius: T.radio, borderWidth: 1.5, borderColor: T.acento,
    backgroundColor: T.acentoSuave,
  },
  clienteChipNombre: { color: T.texto, fontSize: 13, fontWeight: "800" },
  clienteChipPts: { color: T.acento, fontSize: 11, fontWeight: "800", ...cifras },
  clienteChipQuitar: { color: T.textoTenue, fontSize: 14, fontWeight: "800", padding: 2 },

  // Canje de puntos en el cobro
  canjeCaja: {
    backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
    borderRadius: T.radio, padding: 14, marginBottom: 14,
  },
  canjeFila: { flexDirection: "row", alignItems: "center", gap: 11 },
  canjeTitulo: { color: T.texto, fontSize: 14, fontWeight: "800" },
  canjeMeta: { color: T.textoTenue, fontSize: 12, marginTop: 2 },
  canjeInput: {
    fontSize: 20, fontWeight: "800", textAlign: "center",
    paddingVertical: 10, marginTop: 8, ...cifras,
  },
  canjeResumen: {
    marginTop: 10, backgroundColor: T.turquesaSuave, borderWidth: 1,
    borderColor: T.turquesa, borderRadius: T.radioChico + 2,
    paddingVertical: 10, paddingHorizontal: 12,
  },
  canjeResumenTxt: {
    color: T.turquesa, fontSize: 13.5, fontWeight: "800",
    textAlign: "center", ...cifras,
  },
  });
}
