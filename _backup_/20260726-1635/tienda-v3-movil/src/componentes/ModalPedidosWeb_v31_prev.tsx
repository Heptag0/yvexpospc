// YvexPOS Móvil — Modal de PEDIDOS WEB (tienda en línea v3).
//
// Los pedidos que llegan por la tienda en internet (tienda.yvexiq.com) se
// atienden aquí: lista más nuevos primero, filtro por estado, actualización
// manual (pull-to-refresh y botón) y auto-refresh cada ~30 s mientras el
// modal está abierto. Las transiciones son las del backend:
// nuevo → preparando → listo → entregado; cancelado desde cualquiera menos
// entregado. Todo con mensajes cálidos y tolerante a offline.
//
// Si no hay cuenta vinculada, una pantalla cálida explica qué es y ofrece
// vincular (ModalCuenta), igual que ModalTienda.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  FlatList,
  Alert,
  RefreshControl,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, CabeceraModal } from "@/src/componentes/ui";
import { IconoUI } from "@/src/componentes/iconos";
import ModalCuenta from "@/src/componentes/ModalCuenta";
import { pesos } from "@/src/base/formato";
import { estadoCuenta } from "@/src/base/nube";
import {
  PedidoTienda,
  EstadoPedido,
  obtenerPedidosTienda,
  cambiarEstadoPedido,
  FalloTienda,
} from "@/src/base/tienda";
import {
  TRANSICIONES_PEDIDO,
  etiquetaEstadoPedido,
  etiquetaEntregaPedido,
  etiquetaPagoPedido,
  folioCortoPedido,
  horaRelativa,
} from "@/src/base/tiendaReglas";

type Tema = ReturnType<typeof useTema>["tema"];

// Filtros de la barra superior. "historial" junta entregados y cancelados.
type Filtro = "nuevo" | "preparando" | "listo" | "historial";

const FILTROS: { id: Filtro; etiqueta: string }[] = [
  { id: "nuevo", etiqueta: "Nuevos" },
  { id: "preparando", etiqueta: "En preparación" },
  { id: "listo", etiqueta: "Listos" },
  { id: "historial", etiqueta: "Historial" },
];

// Texto del botón de AVANCE según el estado actual (la transición principal).
const AVANCE: Partial<Record<EstadoPedido, { a: EstadoPedido; titulo: string }>> = {
  nuevo: { a: "preparando", titulo: "Empezar a preparar" },
  preparando: { a: "listo", titulo: "Marcar listo" },
  listo: { a: "entregado", titulo: "Marcar entregado" },
};

/** Traduce errores tipados a mensajes cálidos. */
function mensajeError(e: any): string {
  if (e instanceof FalloTienda) {
    if (e.tipo === "sin_internet")
      return "Sin conexión a internet. Revisa tu señal y toca «Actualizar».";
    if (e.tipo === "sin_cuenta")
      return "Para ver tus pedidos web primero vincula tu cuenta.";
    if (e.codigo === 409)
      return (
        (e.message && e.message !== "servidor" ? `${e.message} ` : "") +
        "Alguien más lo actualizó: toca «Actualizar» para verlo como quedó."
      );
    return e.message && e.message !== "servidor"
      ? `El servidor dijo: ${e.message}`
      : "El servidor tuvo un problema. Intenta de nuevo en un momento.";
  }
  return e?.message ?? "Algo salió mal. Intenta de nuevo.";
}

export default function ModalPedidosWeb({
  onCerrar,
  onCambio,
}: {
  onCerrar: () => void;
  onCambio?: () => void;
}) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);

  const [cargando, setCargando] = useState(true);
  const [vinculado, setVinculado] = useState(false);
  const [cuentaAbierta, setCuentaAbierta] = useState(false);
  const [pedidos, setPedidos] = useState<PedidoTienda[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("nuevo");
  const [refrescando, setRefrescando] = useState(false);
  const [cambiandoId, setCambiandoId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState<{ texto: string; tipo: "exito" | "info" } | null>(null);

  // Reloj interno para que la "hora relativa" se repinte con cada refresh.
  const [ahoraMs, setAhoraMs] = useState(Date.now());
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setError("");
    try {
      const lista = await obtenerPedidosTienda();
      if (!montado.current) return;
      setPedidos(lista);
      setAhoraMs(Date.now());
      if (silencioso) setError("");
    } catch (e: any) {
      if (!montado.current) return;
      // En refresh silencioso no tapamos la lista con el error; solo si no
      // hay nada que mostrar.
      if (!silencioso || pedidos.length === 0) setError(mensajeError(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidos.length]);

  const arranque = useCallback(async () => {
    const cuenta = await estadoCuenta();
    if (!montado.current) return;
    setVinculado(cuenta.vinculado);
    if (cuenta.vinculado) await cargar();
    if (montado.current) setCargando(false);
  }, [cargar]);

  useEffect(() => {
    void arranque();
  }, [arranque]);

  // Auto-refresh cada ~30 s mientras el modal está abierto (silencioso:
  // no muestra spinner ni borra la lista si falla).
  useEffect(() => {
    if (!vinculado) return;
    const t = setInterval(() => {
      void cargar(true);
    }, 30000);
    return () => clearInterval(t);
  }, [vinculado, cargar]);

  async function refrescarManual() {
    setRefrescando(true);
    await cargar(true);
    if (montado.current) setRefrescando(false);
  }

  const conteos = useMemo(() => {
    const c: Record<Filtro, number> = { nuevo: 0, preparando: 0, listo: 0, historial: 0 };
    for (const p of pedidos) {
      if (p.estado === "nuevo") c.nuevo++;
      else if (p.estado === "preparando") c.preparando++;
      else if (p.estado === "listo") c.listo++;
      else c.historial++;
    }
    return c;
  }, [pedidos]);

  const visibles = useMemo(() => {
    if (filtro === "historial")
      return pedidos.filter((p) => p.estado === "entregado" || p.estado === "cancelado");
    return pedidos.filter((p) => p.estado === filtro);
  }, [pedidos, filtro]);

  // --- Cambio de estado ---

  async function mover(p: PedidoTienda, a: EstadoPedido) {
    setError("");
    setAviso(null);
    setCambiandoId(p.id);
    try {
      await cambiarEstadoPedido(p.id, a);
      // Optimista: refleja el cambio al momento; el refresh confirma.
      setPedidos((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, estado: a } : x))
      );
      if (a === "entregado") setAviso({ texto: "Pedido entregado. ¡Qué buena venta!", tipo: "exito" });
      void cargar(true);
      onCambio?.();
    } catch (e: any) {
      setError(mensajeError(e));
      void cargar(true); // por si quedó en otro estado (409)
    } finally {
      if (montado.current) setCambiandoId(null);
    }
  }

  function confirmarCancelar(p: PedidoTienda) {
    Alert.alert(
      "Cancelar pedido",
      `¿Cancelar el pedido ${folioCortoPedido(p.id)} de ${p.cliente_nombre}? ` +
        "Esta acción no se puede deshacer.",
      [
        { text: "Conservar pedido", style: "cancel" },
        { text: "Cancelar pedido", style: "destructive", onPress: () => void mover(p, "cancelado") },
      ]
    );
  }

  // --- Render ---

  function colorEstado(estado: EstadoPedido): { fondo: string; texto: string } {
    switch (estado) {
      case "nuevo":
        return { fondo: T.acentoSuave, texto: T.acento };
      case "preparando":
        return { fondo: T.superficie3, texto: T.texto };
      case "listo":
        return { fondo: T.exitoSuave, texto: T.exitoTexto };
      case "entregado":
        return { fondo: T.superficie2, texto: T.textoSuave };
      case "cancelado":
        return { fondo: T.peligroSuave, texto: T.peligroTexto };
    }
  }

  function renderSinCuenta() {
    return (
      <ScrollView contentContainerStyle={est.cuerpo}>
        <View style={est.heroVacio}>
          <IconoUI id="pedido" size={34} color={T.acento} />
        </View>
        <Text style={est.tituloGrande}>Tus pedidos de internet, aquí mismo</Text>
        <Text style={est.parrafo}>
          Cuando publicas tu tienda en línea, tus clientes pueden pedir desde
          su teléfono y esos pedidos llegan a esta pantalla: los preparas, los
          marcas listos y los entregas, todo desde tu POS.
        </Text>
        <Boton titulo="Vincular mi cuenta" onPress={() => setCuentaAbierta(true)} />
        <Text style={est.notaCalma}>
          Sin cuenta, la app sigue funcionando igual de completa: vender,
          inventario, clientes y reportes no necesitan internet.
        </Text>
      </ScrollView>
    );
  }

  function renderFiltros() {
    return (
      <View style={est.filtros}>
        {FILTROS.map((f) => {
          const activo = filtro === f.id;
          const n = conteos[f.id];
          return (
            <Pressable
              key={f.id}
              onPress={() => setFiltro(f.id)}
              style={[est.filtro, activo && { backgroundColor: T.acento, borderColor: T.acento }]}
            >
              <Text style={[est.filtroTxt, activo && { color: "#ffffff" }]}>
                {f.etiqueta}
                {n > 0 ? ` (${n})` : ""}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  function renderPedido({ item: p }: { item: PedidoTienda }) {
    const col = colorEstado(p.estado);
    const avance = AVANCE[p.estado];
    const puedeCancelar = TRANSICIONES_PEDIDO[p.estado]?.includes("cancelado") === true;
    const ocupado = cambiandoId === p.id;
    return (
      <View style={est.tarjeta}>
        <View style={est.tarjetaCabecera}>
          <Text style={est.folio}>{folioCortoPedido(p.id)}</Text>
          <Text style={est.hora}>{horaRelativa(p.creado_en, ahoraMs)}</Text>
          <View style={[est.chipEstado, { backgroundColor: col.fondo }]}>
            <Text style={[est.chipEstadoTxt, { color: col.texto }]}>
              {etiquetaEstadoPedido(p.estado)}
            </Text>
          </View>
        </View>

        <Text style={est.cliente}>{p.cliente_nombre}</Text>

        <View style={est.items}>
          {p.items.map((it, i) => (
            <View key={`${it.producto_id}-${i}`} style={est.itemFila}>
              <Text style={est.itemCant}>{it.cantidad} ×</Text>
              <Text style={est.itemNombre} numberOfLines={2}>
                {it.nombre}
              </Text>
              <Text style={est.itemPrecio}>{pesos(it.precio_centavos * it.cantidad)}</Text>
            </View>
          ))}
        </View>

        <View style={est.totalFila}>
          <Text style={est.totalEtiqueta}>Total</Text>
          <Text style={est.totalValor}>{pesos(p.total_centavos)}</Text>
        </View>

        <View style={est.metaFila}>
          <IconoUI id={p.entrega === "domicilio" ? "camion" : "tienda"} size={15} color={T.textoSuave} />
          <Text style={est.metaTxt}>
            {etiquetaEntregaPedido(p.entrega)}
            {p.entrega === "domicilio" && p.direccion ? ` — ${p.direccion}` : ""}
          </Text>
        </View>
        <View style={est.metaFila}>
          <IconoUI id="etiqueta" size={15} color={T.textoSuave} />
          <Text style={est.metaTxt}>{etiquetaPagoPedido(p.pago)}</Text>
        </View>
        {p.cliente_notas ? (
          <View style={est.notas}>
            <Text style={est.notasTxt}>“{p.cliente_notas}”</Text>
          </View>
        ) : null}

        {(avance || puedeCancelar) && (
          <View style={est.acciones}>
            {avance && (
              <Boton
                titulo={avance.titulo}
                chico
                cargando={ocupado}
                deshabilitado={cambiandoId !== null && !ocupado}
                onPress={() => void mover(p, avance.a)}
              />
            )}
            {puedeCancelar && (
              <Boton
                titulo="Cancelar"
                chico
                tipo="fantasma"
                deshabilitado={cambiandoId !== null}
                onPress={() => confirmarCancelar(p)}
              />
            )}
          </View>
        )}
      </View>
    );
  }

  function renderVacio() {
    const textos: Record<Filtro, string> = {
      nuevo: "No hay pedidos nuevos. Cuando un cliente pida desde tu tienda, aparece aquí.",
      preparando: "Nada en preparación por ahora.",
      listo: "No hay pedidos listos esperando entrega.",
      historial: "Aquí verás tus pedidos entregados y cancelados.",
    };
    return <Text style={est.vacio}>{textos[filtro]}</Text>;
  }

  return (
    <Modal animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={est.raiz} edges={["top"]}>
        <CabeceraModal
          titulo="Pedidos web"
          izquierda="Cerrar"
          derecha="Actualizar"
          onIzquierda={() => {
            onCambio?.();
            onCerrar();
          }}
          onDerecha={() => void refrescarManual()}
          derechaCargando={refrescando}
        />
        {cargando ? (
          <View style={est.cargando}>
            <Text style={est.vacio}>Buscando tus pedidos…</Text>
          </View>
        ) : !vinculado ? (
          renderSinCuenta()
        ) : (
          <FlatList
            data={visibles}
            keyExtractor={(p) => p.id}
            contentContainerStyle={est.cuerpo}
            refreshControl={
              <RefreshControl
                refreshing={refrescando}
                onRefresh={() => void refrescarManual()}
                tintColor={T.acento}
              />
            }
            ListHeaderComponent={
              <>
                {error ? <Banner texto={error} tipo="error" /> : null}
                {aviso ? <Banner texto={aviso.texto} tipo={aviso.tipo} /> : null}
                {renderFiltros()}
              </>
            }
            ListEmptyComponent={renderVacio()}
            renderItem={renderPedido}
          />
        )}

        {cuentaAbierta && (
          <ModalCuenta
            onCerrar={() => {
              setCuentaAbierta(false);
              void arranque();
            }}
            onCambio={() => {
              setCuentaAbierta(false);
              void arranque();
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
    cuerpo: { padding: T.esp, paddingTop: 16, paddingBottom: 40 },
    cargando: { flex: 1, alignItems: "center", justifyContent: "center" },
    vacio: {
      color: T.textoTenue,
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
      marginTop: 24,
      paddingHorizontal: 20,
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

    // Filtros
    filtros: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
    filtro: {
      paddingHorizontal: 13,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1.5,
      borderColor: T.borde,
      backgroundColor: T.superficie,
    },
    filtroTxt: { color: T.textoSuave, fontSize: 12.5, fontWeight: "800" },

    // Tarjeta de pedido
    tarjeta: {
      backgroundColor: T.superficie,
      borderWidth: 1,
      borderColor: T.borde,
      borderRadius: T.radioGrande,
      padding: 15,
      marginBottom: 12,
    },
    tarjetaCabecera: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
    folio: { color: T.texto, fontSize: 14, fontWeight: "900", letterSpacing: 0.3 },
    hora: { color: T.textoTenue, fontSize: 12, flex: 1 },
    chipEstado: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    chipEstadoTxt: { fontSize: 11, fontWeight: "900" },
    cliente: { color: T.texto, fontSize: 15.5, fontWeight: "800", marginBottom: 8 },
    items: { gap: 4, marginBottom: 10 },
    itemFila: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    itemCant: { color: T.textoSuave, fontSize: 13, fontWeight: "700", minWidth: 34 },
    itemNombre: { color: T.texto, fontSize: 13.5, flex: 1, lineHeight: 19 },
    itemPrecio: { color: T.textoSuave, fontSize: 13, fontWeight: "700" },
    totalFila: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      borderTopWidth: 1,
      borderTopColor: T.borde,
      paddingTop: 10,
      marginBottom: 10,
    },
    totalEtiqueta: { color: T.textoSuave, fontSize: 13, fontWeight: "800" },
    totalValor: { color: T.texto, fontSize: 16.5, fontWeight: "900" },
    metaFila: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 5 },
    metaTxt: { color: T.textoSuave, fontSize: 12.5, lineHeight: 18, flex: 1 },
    notas: {
      backgroundColor: T.superficie2,
      borderRadius: T.radio,
      padding: 10,
      marginTop: 4,
      marginBottom: 2,
    },
    notasTxt: { color: T.textoSuave, fontSize: 12.5, lineHeight: 18, fontStyle: "italic" },
    acciones: { flexDirection: "row", gap: 10, marginTop: 12, flexWrap: "wrap" },
  });
}
