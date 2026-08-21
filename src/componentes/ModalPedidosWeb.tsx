// YvexPOS Móvil — Modal de PEDIDOS WEB (tienda en línea v3).
//
// Los pedidos que llegan por la tienda en internet se atienden aquí: lista
// más nuevos primero, filtro por estado, actualización manual
// (pull-to-refresh y botón) y auto-refresh cada ~30 s mientras el modal
// está abierto. Las transiciones son las del backend: nuevo → preparando →
// listo → entregado; cancelado desde cualquiera menos entregado.
//
// Si no hay cuenta vinculada, una pantalla cálida explica qué es y ofrece
// vincular (ModalCuenta), igual que ModalTienda.
//
// ---------------------------------------------------------------------------
// QUÉ CAMBIÓ EN ESTA MIGRACIÓN
// ---------------------------------------------------------------------------
// 1. T.turquesa (enlace "Ver en el mapa") -> T.acento.
// 2. El chip de filtro activo fijaba `color: "#ffffff"` en el texto. Con el
//    acento "Perla" (claro) eso deja el texto ilegible sobre el propio
//    chip — el mismo bug de contraste que ya se corrigió en el Chip de
//    FormularioProducto. Ahora usa T.acentoTexto, que SÍ se resuelve según
//    la luminosidad de cada acento.
// 3. <Modal animationType="slide" onRequestClose={onCerrar}> no pasaba
//    `visible` explícito — funcionaba (el valor por defecto de RN es
//    true), pero rompía la convención del resto del código, donde todos
//    los demás modales lo pasan explícito. Se añadió por consistencia, no
//    porque estuviera roto.
// 4. Alert.alert (cancelar pedido) -> <Hoja> chica anidada.
// 5. Este modal NO tiene drill-down local (una sola vista, con lista +
//    filtros) — no necesitaba BackHandler; el <Modal> ya cierra bien solo
//    con onRequestClose.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Pressable, Modal, FlatList, RefreshControl, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, CabeceraModal, Hoja, Txt, Monto } from "@/src/componentes/ui";
import { IconoUI } from "@/src/componentes/iconos";
import ModalCuenta from "@/src/componentes/ModalCuenta";
import { pesos } from "@/src/base/formato";
import { estadoCuenta } from "@/src/base/nube";
import { leerNombreNegocio } from "@/src/base/giro";
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
  telefonoParaWhatsApp,
  urlWhatsAppCliente,
  urlCorreoCliente,
  mensajePedidoCancelado,
  mensajePedidoListo,
  urlMapaUbicacion,
} from "@/src/base/tiendaReglas";
import { registrarVentaWeb } from "@/src/base/venta";

// Filtros de la barra superior (flujo v3.1: nuevo → listo → entregado).
// "nuevo" junta también los pedidos viejos en 'preparando' (legado: se
// atienden con la misma acción "Aceptar pedido"); "historial" junta
// entregados y cancelados.
type Filtro = "nuevo" | "listo" | "historial";

const FILTROS: { id: Filtro; etiqueta: string }[] = [
  { id: "nuevo", etiqueta: "Nuevos" },
  { id: "listo", etiqueta: "Listos" },
  { id: "historial", etiqueta: "Historial" },
];

// Texto del botón de AVANCE según el estado actual (la transición principal).
const AVANCE: Partial<Record<EstadoPedido, { a: EstadoPedido; titulo: string }>> = {
  nuevo: { a: "listo", titulo: "Aceptar pedido" },
  preparando: { a: "listo", titulo: "Aceptar pedido" }, // legado
  listo: { a: "entregado", titulo: "Marcar completado" },
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

  const [cargando, setCargando] = useState(true);
  const [vinculado, setVinculado] = useState(false);
  const [cuentaAbierta, setCuentaAbierta] = useState(false);
  const [pedidos, setPedidos] = useState<PedidoTienda[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("nuevo");
  const [refrescando, setRefrescando] = useState(false);
  const [cambiandoId, setCambiandoId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState<{ texto: string; tipo: "exito" | "info" } | null>(null);
  const [negocio, setNegocio] = useState("tu tienda");
  const [porCancelar, setPorCancelar] = useState<PedidoTienda | null>(null);

  // Aviso opcional al cliente tras cancelar o marcar listo (v3.1).
  const [avisoCliente, setAvisoCliente] = useState<{
    pedido: PedidoTienda;
    tipo: "cancelado" | "listo";
  } | null>(null);

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
    const nombre = await leerNombreNegocio().catch(() => "tu tienda");
    if (!montado.current) return;
    setNegocio(nombre || "tu tienda");
    setVinculado(cuenta.vinculado);
    if (cuenta.vinculado) await cargar();
    if (montado.current) setCargando(false);
  }, [cargar]);

  useEffect(() => {
    void arranque();
  }, [arranque]);

  // Auto-refresh cada ~30 s mientras el modal está abierto (silencioso: no
  // muestra spinner ni borra la lista si falla).
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
    const c: Record<Filtro, number> = { nuevo: 0, listo: 0, historial: 0 };
    for (const p of pedidos) {
      if (p.estado === "nuevo" || p.estado === "preparando") c.nuevo++;
      else if (p.estado === "listo") c.listo++;
      else c.historial++;
    }
    return c;
  }, [pedidos]);

  const visibles = useMemo(() => {
    if (filtro === "historial")
      return pedidos.filter((p) => p.estado === "entregado" || p.estado === "cancelado");
    if (filtro === "nuevo")
      return pedidos.filter((p) => p.estado === "nuevo" || p.estado === "preparando");
    return pedidos.filter((p) => p.estado === filtro);
  }, [pedidos, filtro]);

  // --- Cambio de estado ---

  async function mover(p: PedidoTienda, a: EstadoPedido) {
    setError("");
    setAviso(null);
    setAvisoCliente(null);
    setCambiandoId(p.id);
    try {
      await cambiarEstadoPedido(p.id, a);
      // Optimista: refleja el cambio al momento; el refresh confirma.
      setPedidos((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, estado: a } : x))
      );
      if (a === "entregado") {
        // Venta web: se apunta en el POS para que salga en Vendido hoy y
        // Reportes. Si falla, el pedido YA se entregó (no se revierte):
        // solo avisamos cálidamente.
        try {
          const rv = await registrarVentaWeb({
            id: p.id,
            items: p.items,
            total_centavos: p.total_centavos,
            entrega: p.entrega,
            pago: p.pago,
          });
          setAviso({
            texto: rv.ya_registrada
              ? "Pedido completado. Su venta ya estaba apuntada en tus ventas de hoy."
              : "Pedido completado y apuntado en tus ventas de hoy. ¡Qué buena venta!",
            tipo: "exito",
          });
        } catch (err: any) {
          console.warn("registrarVentaWeb falló:", err);
          setAviso({
            texto:
              "El pedido se completó, pero no pudimos apuntar la venta; anótala manual si la necesitas.",
            tipo: "info",
          });
        }
      }
      // v3.1: tras cancelar o marcar listo, se ofrece avisar al cliente:
      // WhatsApp si hay teléfono; correo si SOLO hay correo.
      if (a === "cancelado" || a === "listo") {
        const actualizado = { ...p, estado: a };
        const hayTel = !!telefonoParaWhatsApp(p.cliente_telefono);
        const hayCorreo = (p.cliente_correo ?? "").trim() !== "";
        if (hayTel || hayCorreo) {
          setAvisoCliente({ pedido: actualizado, tipo: a });
        } else if (a === "cancelado") {
          // Pedidos viejos (anteriores a v3.1) pueden no tener contacto.
          setAviso({
            texto:
              "Pedido cancelado. Este pedido no tiene teléfono ni correo del cliente, así que no podemos ofrecerte avisarle.",
            tipo: "info",
          });
        }
      }
      void cargar(true);
      onCambio?.();
    } catch (e: any) {
      setError(mensajeError(e));
      void cargar(true); // por si quedó en otro estado (409)
    } finally {
      if (montado.current) setCambiandoId(null);
    }
  }

  function abrirAvisoCliente() {
    if (!avisoCliente) return;
    const { pedido, tipo } = avisoCliente;
    const folio = folioCortoPedido(pedido.id);
    const cuerpo =
      tipo === "cancelado"
        ? mensajePedidoCancelado(pedido.cliente_nombre, negocio, folio)
        : mensajePedidoListo(pedido.cliente_nombre, negocio, folio, pedido.entrega);
    const tel = telefonoParaWhatsApp(pedido.cliente_telefono);
    let url = "";
    if (tel) {
      url = urlWhatsAppCliente(tel, cuerpo);
    } else {
      // Solo correo: mailto con asunto y cuerpo pre-redactados.
      const asunto =
        tipo === "cancelado"
          ? `Tu pedido ${folio} fue cancelado`
          : `Tu pedido ${folio} ya está listo`;
      url = urlCorreoCliente(pedido.cliente_correo, asunto, cuerpo);
    }
    if (!url) return;
    void Linking.openURL(url).catch(() => {
      setAviso({
        texto: tel
          ? "No se pudo abrir WhatsApp. Intenta de nuevo en un momento."
          : "No se pudo abrir tu app de correo. Intenta de nuevo en un momento.",
        tipo: "info",
      });
    });
    setAvisoCliente(null);
  }

  async function confirmarCancelar() {
    if (!porCancelar) return;
    const p = porCancelar;
    setPorCancelar(null);
    await mover(p, "cancelado");
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
      <ScrollView contentContainerStyle={{ padding: T.esp }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: T.radioGrande,
            backgroundColor: T.acentoSuave,
            borderWidth: 1,
            borderColor: T.acento,
            alignItems: "center",
            justifyContent: "center",
            alignSelf: "center",
            marginTop: T.esps.xl,
            marginBottom: T.esps.lg,
          }}
        >
          <IconoUI id="pedido" size={34} color={T.acento} />
        </View>
        <Txt escala="titulo" fuerte estilo={{ textAlign: "center", marginBottom: T.esps.md }}>
          Tus pedidos de internet, aquí mismo
        </Txt>
        <Txt escala="pie" tono="suave" estilo={{ marginBottom: T.esps.md }}>
          Cuando publicas tu tienda en línea, tus clientes pueden pedir desde
          su teléfono y esos pedidos llegan a esta pantalla: los preparas, los
          marcas listos y los entregas, todo desde tu POS.
        </Txt>
        <Boton titulo="Vincular mi cuenta" onPress={() => setCuentaAbierta(true)} />
        <Txt escala="pie" tono="tenue" estilo={{ textAlign: "center", marginTop: T.esps.md }}>
          Sin cuenta, la app sigue funcionando igual de completa: vender,
          inventario, clientes y reportes no necesitan internet.
        </Txt>
      </ScrollView>
    );
  }

  function renderFiltros() {
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: T.esps.sm, marginBottom: T.esps.lg }}>
        {FILTROS.map((f) => {
          const activo = filtro === f.id;
          const n = conteos[f.id];
          return (
            <Pressable
              key={f.id}
              onPress={() => setFiltro(f.id)}
              style={{
                paddingHorizontal: T.esps.md,
                paddingVertical: T.esps.sm,
                borderRadius: T.radioPildora,
                borderWidth: 1.5,
                borderColor: activo ? T.acentoRelleno : T.borde,
                backgroundColor: activo ? T.acentoRelleno : T.superficie,
              }}
            >
              <Txt
                escala="pie"
                fuerte
                tono={activo ? "principal" : "suave"}
                estilo={activo ? { color: T.acentoTexto } : undefined}
              >
                {f.etiqueta}
                {n > 0 ? ` (${n})` : ""}
              </Txt>
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
      <View
        style={{
          backgroundColor: T.superficie,
          borderWidth: 1,
          borderColor: T.borde,
          borderRadius: T.radioGrande,
          padding: T.esps.lg,
          marginBottom: T.esps.md,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: T.esps.sm, marginBottom: T.esps.sm }}>
          <Monto texto={folioCortoPedido(p.id)} escala="pie" />
          <Txt escala="pie" tono="tenue" estilo={{ flex: 1 }}>
            {horaRelativa(p.creado_en, ahoraMs)}
          </Txt>
          <View style={{ borderRadius: T.radioPildora, paddingHorizontal: T.esps.sm, paddingVertical: 4, backgroundColor: col.fondo }}>
            <Txt escala="micro" fuerte estilo={{ color: col.texto }}>
              {etiquetaEstadoPedido(p.estado)}
            </Txt>
          </View>
        </View>

        <Txt escala="cuerpo" fuerte estilo={{ marginBottom: T.esps.sm }}>
          {p.cliente_nombre}
        </Txt>
        {(p.cliente_telefono.trim() !== "" || (p.cliente_correo ?? "").trim() !== "") && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: T.esps.xs, marginTop: -4, marginBottom: T.esps.sm }}>
            <IconoUI id="persona" size={13} color={T.textoTenue} />
            <Txt escala="micro" tono="tenue" lineas={1} estilo={{ flex: 1 }}>
              {[p.cliente_telefono.trim(), (p.cliente_correo ?? "").trim()].filter((c) => c !== "").join(" · ")}
            </Txt>
          </View>
        )}

        <View style={{ gap: 4, marginBottom: T.esps.sm }}>
          {p.items.map((it, i) => (
            <View key={`${it.producto_id}-${i}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: T.esps.sm }}>
              <Txt escala="pie" tono="suave" fuerte estilo={{ minWidth: 34 }}>
                {it.cantidad} ×
              </Txt>
              <Txt escala="pie" estilo={{ flex: 1 }} lineas={2}>
                {it.nombre}
              </Txt>
              <Monto texto={pesos(it.precio_centavos * it.cantidad)} escala="pie" tono="suave" />
            </View>
          ))}
        </View>

        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            borderTopWidth: 1,
            borderTopColor: T.borde,
            paddingTop: T.esps.sm,
            marginBottom: T.esps.sm,
          }}
        >
          <Txt escala="pie" tono="suave" fuerte>Total</Txt>
          <Monto texto={pesos(p.total_centavos)} escala="cuerpo" />
        </View>

        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: T.esps.sm, marginBottom: 5 }}>
          <IconoUI id={p.entrega === "domicilio" ? "camion" : "tienda"} size={15} color={T.textoSuave} />
          <Txt escala="pie" tono="suave" estilo={{ flex: 1 }}>
            {etiquetaEntregaPedido(p.entrega)}
            {p.entrega === "domicilio" && p.direccion ? ` — ${p.direccion}` : ""}
          </Txt>
        </View>
        {urlMapaUbicacion(p.ubicacion) !== "" && (
          <Pressable
            style={{ flexDirection: "row", alignItems: "flex-start", gap: T.esps.sm, marginBottom: 5 }}
            onPress={() => {
              void Linking.openURL(urlMapaUbicacion(p.ubicacion)).catch(() => {
                setAviso({ texto: "No se pudo abrir el mapa. Intenta de nuevo en un momento.", tipo: "info" });
              });
            }}
          >
            <IconoUI id="enlace" size={15} color={T.acento} />
            <Txt escala="pie" tono="acento" fuerte>
              Ver en el mapa
            </Txt>
          </Pressable>
        )}
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: T.esps.sm, marginBottom: 5 }}>
          <IconoUI id="etiqueta" size={15} color={T.textoSuave} />
          <Txt escala="pie" tono="suave">{etiquetaPagoPedido(p.pago)}</Txt>
        </View>
        {p.cliente_notas ? (
          <View style={{ backgroundColor: T.superficie2, borderRadius: T.radio, padding: T.esps.sm, marginTop: 4 }}>
            <Txt escala="pie" tono="suave">"{p.cliente_notas}"</Txt>
          </View>
        ) : null}

        {(avance || puedeCancelar) && (
          <View style={{ flexDirection: "row", gap: T.esps.sm, marginTop: T.esps.md, flexWrap: "wrap" }}>
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
                onPress={() => setPorCancelar(p)}
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
      listo: "No hay pedidos listos esperando entrega.",
      historial: "Aquí verás tus pedidos entregados y cancelados.",
    };
    return (
      <Txt escala="pie" tono="tenue" estilo={{ textAlign: "center", marginTop: T.esps.xl, paddingHorizontal: T.esps.lg }}>
        {textos[filtro]}
      </Txt>
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={{ flex: 1, backgroundColor: T.fondo }} edges={["top"]}>
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
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Txt escala="pie" tono="tenue">Buscando tus pedidos…</Txt>
          </View>
        ) : !vinculado ? (
          renderSinCuenta()
        ) : (
          <FlatList
            data={visibles}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ padding: T.esp, paddingTop: T.esps.md, paddingBottom: T.esps.xxl }}
            refreshControl={
              <RefreshControl refreshing={refrescando} onRefresh={() => void refrescarManual()} tintColor={T.acento} />
            }
            ListHeaderComponent={
              <>
                {error ? <Banner texto={error} tipo="error" /> : null}
                {aviso ? <Banner texto={aviso.texto} tipo={aviso.tipo} /> : null}
                {avisoCliente && (
                  <View
                    style={{
                      backgroundColor: T.acentoSuave,
                      borderWidth: 1,
                      borderColor: T.acento,
                      borderRadius: T.radioGrande,
                      padding: T.esps.md,
                      marginBottom: T.esps.md,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: T.esps.sm }}>
                      <IconoUI id="compartir" size={18} color={T.acento} />
                      <Txt escala="pie" fuerte estilo={{ flex: 1 }}>
                        {(() => {
                          const porCorreo = !telefonoParaWhatsApp(avisoCliente.pedido.cliente_telefono);
                          const canal = porCorreo ? "por correo" : "por WhatsApp";
                          return avisoCliente.tipo === "cancelado"
                            ? `Pedido ${folioCortoPedido(avisoCliente.pedido.id)} cancelado. ¿Le avisamos a ${avisoCliente.pedido.cliente_nombre} ${canal}?`
                            : `¡${folioCortoPedido(avisoCliente.pedido.id)} listo! ¿Le avisamos a ${avisoCliente.pedido.cliente_nombre} ${canal}?`;
                        })()}
                      </Txt>
                    </View>
                    <View style={{ flexDirection: "row", gap: T.esps.sm, marginTop: T.esps.md, flexWrap: "wrap" }}>
                      <Boton
                        titulo={(() => {
                          const porCorreo = !telefonoParaWhatsApp(avisoCliente.pedido.cliente_telefono);
                          if (avisoCliente.tipo === "cancelado")
                            return porCorreo ? "Avisar al cliente por correo" : "Avisar al cliente por WhatsApp";
                          return porCorreo ? "Avisar que está listo por correo" : "Avisar que está listo";
                        })()}
                        chico
                        onPress={abrirAvisoCliente}
                      />
                      <Boton titulo="Ahora no" chico tipo="fantasma" onPress={() => setAvisoCliente(null)} />
                    </View>
                  </View>
                )}
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

      {/* Confirmación de cancelar pedido: hoja chica, sin Alert nativo. */}
      <Hoja
        visible={porCancelar !== null}
        onCerrar={() => setPorCancelar(null)}
        titulo="Cancelar pedido"
        pie={
          <View style={{ gap: T.esps.sm }}>
            <Boton titulo="Cancelar pedido" tipo="peligro" onPress={confirmarCancelar} />
            <Boton titulo="Conservar pedido" tipo="secundario" onPress={() => setPorCancelar(null)} />
          </View>
        }
      >
        <Txt escala="pie" tono="suave">
          {porCancelar
            ? `¿Cancelar el pedido ${folioCortoPedido(porCancelar.id)} de ${porCancelar.cliente_nombre}? Esta acción no se puede deshacer.`
            : ""}
        </Txt>
      </Hoja>
    </Modal>
  );
}
