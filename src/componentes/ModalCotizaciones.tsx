// YvexPOS Móvil — Modal de COTIZACIONES.
//
// Lista + constructor (productos del catálogo o conceptos libres, cada uno
// con cantidad y precio editables) + detalle con "Compartir" (texto listo
// para WhatsApp) y "Convertir a venta".
//
// ⚠️ "Convertir a venta" aquí PREPARA los datos (prepararParaVenta +
// dejarCotizacionParaVenta) y navega a la pantalla de venta — pero el
// enganche final (que la pantalla de venta LEA esos datos al montar y
// cargue el carrito) depende de cómo esté armada esa pantalla. Confirmado
// en la migración a Vender: sí lo hace (tomarCotizacionPendiente() en
// vender.tsx), así que el flujo está completo.
//
// ---------------------------------------------------------------------------
// QUÉ CAMBIÓ EN ESTA MIGRACIÓN
// ---------------------------------------------------------------------------
// 1. "Eliminar" NO TENÍA NINGUNA CONFIRMACIÓN — ni siquiera un Alert nativo.
//    Tocabas el botón y la cotización desaparecía sin poder arrepentirte.
//    Es el único de los modales de "herramientas" con ese hueco: se agregó
//    una <Hoja> de confirmación, igual que en ModalDepartamentos,
//    FormularioProducto y ModalLealtad — no por copiar el patrón, sino
//    porque faltaba de verdad.
// 2. BackHandler para el drill-down (lista -> form / detalle): sin él, el
//    botón Atrás de Android cerraba todo el modal en vez de retroceder un
//    nivel. Mismo arreglo que en Vender y ModalLealtad.
// 3. Las listas (cotizaciones, resultados del buscador) pasan a <Fila> con
//    <Monto> para los totales — antes un estilo de fila propio.
// 4. No había T.turquesa en este archivo — ya usaba T.texto correctamente.

import { useCallback, useEffect, useMemo, useState } from "react";
import { View, TextInput, Pressable, Modal, ScrollView, KeyboardAvoidingView, ActivityIndicator, Share, BackHandler } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, CabeceraModal, Campo, Hoja, Grupo, Fila, Txt, Monto, Vacio, useEstiloInput } from "@/src/componentes/ui";
import { IconoUI } from "@/src/componentes/iconos";
import { pesos } from "@/src/base/formato";
import { leerNombreNegocio } from "@/src/base/giro";
import {
  Cotizacion,
  CotizacionConLineas,
  DatosLinea,
  listarCotizaciones,
  crearCotizacion,
  obtenerCotizacion,
  cancelarCotizacion,
  eliminarCotizacion,
  marcarVencidas,
  prepararParaVenta,
  textoCotizacion,
} from "@/src/base/cotizaciones";
import { listarProductos, type ProductoLista } from "@/src/base/inventario";
import { dejarCotizacionParaVenta } from "@/src/base/handoff";

type Vista = "lista" | "form" | "detalle";
type ItemLinea = DatosLinea & { id: string }; // id local, solo para las keys de React

const ETIQUETA: Record<Cotizacion["estado"], string> = {
  abierta: "Abierta",
  convertida: "Convertida",
  vencida: "Vencida",
  cancelada: "Cancelada",
};

function hoyYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ModalCotizaciones({
  onCerrar,
  onIrAVenta,
}: {
  onCerrar: () => void;
  /** Navega a la pantalla de venta (ya con la cotización dejada en el traspaso). */
  onIrAVenta: () => void;
}) {
  const { tema: T } = useTema();
  const estiloInput = useEstiloInput();

  const [vista, setVista] = useState<Vista>("lista");
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(true);
  const [detalle, setDetalle] = useState<CotizacionConLineas | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);

  // --- Formulario (constructor) ---
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
  const [validaHasta, setValidaHasta] = useState("");
  const [notas, setNotas] = useState("");
  const [descuento, setDescuento] = useState("");
  const [lineas, setLineas] = useState<ItemLinea[]>([]);
  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const [busquedaProd, setBusquedaProd] = useState("");
  const [catalogoCompleto, setCatalogoCompleto] = useState<ProductoLista[]>([]);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      await marcarVencidas(hoyYmd());
      setCotizaciones(await listarCotizaciones(busqueda));
    } finally {
      setCargando(false);
    }
  }, [busqueda]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Atrás del sistema: retrocede un nivel en vez de cerrar todo el modal.
  useEffect(() => {
    const alPresionarAtras = () => {
      if (buscadorAbierto) {
        setBuscadorAbierto(false);
        return true;
      }
      if (vista === "form" || vista === "detalle") {
        setVista("lista");
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", alPresionarAtras);
    return () => sub.remove();
  }, [vista, buscadorAbierto]);

  useEffect(() => {
    if (!buscadorAbierto) return;
    // Trae el catálogo completo UNA vez al abrir el buscador (mismo patrón
    // que ya usa vender.tsx: filtrar en JS, sin depender de un parámetro de
    // búsqueda server-side cuya forma exacta no está confirmada aquí).
    if (catalogoCompleto.length === 0) {
      listarProductos({}).then(setCatalogoCompleto);
    }
  }, [buscadorAbierto, catalogoCompleto.length]);

  const resultadosFiltrados = useMemo(() => {
    const q = busquedaProd.trim().toLowerCase();
    if (!q) return catalogoCompleto;
    return catalogoCompleto.filter(
      (p) => p.nombre.toLowerCase().includes(q) || (p.codigo_barras ?? "").toLowerCase().includes(q)
    );
  }, [catalogoCompleto, busquedaProd]);

  function nuevaCotizacion() {
    setClienteNombre("");
    setClienteTelefono("");
    setValidaHasta("");
    setNotas("");
    setDescuento("");
    setLineas([]);
    setError("");
    setVista("form");
  }

  function agregarConcepto() {
    setLineas((ls) => [
      ...ls,
      { id: `l${Date.now()}${Math.random()}`, productoId: null, descripcion: "", cantidad: 1, precioUnitarioCentavos: 0 },
    ]);
  }

  function agregarProducto(p: ProductoLista) {
    setLineas((ls) => [
      ...ls,
      {
        id: `l${Date.now()}${Math.random()}`,
        productoId: p.id,
        descripcion: p.nombre,
        cantidad: 1,
        precioUnitarioCentavos: p.precio_venta_centavos,
      },
    ]);
    setBuscadorAbierto(false);
    setBusquedaProd("");
  }

  function actualizarLinea(id: string, cambios: Partial<ItemLinea>) {
    setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...cambios } : l)));
  }
  function quitarLinea(id: string) {
    setLineas((ls) => ls.filter((l) => l.id !== id));
  }

  const totalLineas = useMemo(
    () => lineas.reduce((s, l) => s + Math.max(0, Math.round(l.precioUnitarioCentavos * l.cantidad) - (l.descuentoLineaCentavos ?? 0)), 0),
    [lineas]
  );
  const descuentoCentavos = Math.max(0, Math.round((parseFloat((descuento || "0").replace(",", ".")) || 0) * 100));
  const totalFinal = Math.max(0, totalLineas - descuentoCentavos);

  async function guardar() {
    setError("");
    if (lineas.length === 0 || lineas.some((l) => l.descripcion.trim() === "")) {
      setError("Cada concepto necesita una descripción.");
      return;
    }
    setGuardando(true);
    try {
      await crearCotizacion({
        clienteNombre: clienteNombre.trim() || null,
        clienteTelefono: clienteTelefono.trim() || null,
        notas: notas.trim() || null,
        validaHasta: validaHasta.trim() || null,
        descuentoCentavos,
        lineas: lineas.map((l) => ({
          productoId: l.productoId,
          descripcion: l.descripcion.trim(),
          cantidad: l.cantidad,
          precioUnitarioCentavos: l.precioUnitarioCentavos,
          descuentoLineaCentavos: l.descuentoLineaCentavos ?? 0,
        })),
      });
      await cargar();
      setVista("lista");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setGuardando(false);
    }
  }

  async function abrirDetalle(c: Cotizacion) {
    const full = await obtenerCotizacion(c.id);
    setDetalle(full);
    setVista("detalle");
  }

  async function compartir() {
    if (!detalle) return;
    const nombreNegocio = await leerNombreNegocio();
    await Share.share({ message: textoCotizacion(detalle, nombreNegocio) });
  }

  async function convertirAVenta() {
    if (!detalle) return;
    try {
      const lista = await prepararParaVenta(detalle.id);
      dejarCotizacionParaVenta(lista);
      onIrAVenta();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function cancelar() {
    if (!detalle) return;
    try {
      await cancelarCotizacion(detalle.id);
      await cargar();
      setVista("lista");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function confirmarEliminar() {
    if (!detalle) return;
    await eliminarCotizacion(detalle.id);
    await cargar();
    setConfirmandoBorrado(false);
    setVista("lista");
  }

  // ---------------------------------------------------------------------------
  // Vistas
  // ---------------------------------------------------------------------------

  function VistaLista() {
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }} keyboardShouldPersistTaps="handled">
        <Banner texto={error} tipo="error" />
        <TextInput
          style={[estiloInput, { marginBottom: T.esps.md }]}
          value={busqueda}
          onChangeText={setBusqueda}
          placeholder="Buscar por folio o cliente…"
          placeholderTextColor={T.textoTenue}
        />
        <View style={{ marginBottom: T.esps.lg }}>
          <Boton titulo="+ Nueva cotización" onPress={nuevaCotizacion} />
        </View>
        {cargando ? (
          <ActivityIndicator color={T.acento} style={{ marginTop: T.esps.xl }} />
        ) : cotizaciones.length === 0 ? (
          <Vacio
            titulo={busqueda ? "Sin resultados" : "Aún no tienes cotizaciones"}
            texto={busqueda ? "Prueba con otro folio o nombre." : "Toca «+ Nueva cotización» para armar la primera."}
          />
        ) : (
          <Grupo>
            {cotizaciones.map((c) => (
              <Fila
                key={c.id}
                titulo={`#${c.folio}${c.cliente_nombre ? ` · ${c.cliente_nombre}` : ""}`}
                meta={`${ETIQUETA[c.estado]}${c.valida_hasta ? ` · vence ${c.valida_hasta}` : ""}`}
                icono={<IconoUI id="cotizacion" size={19} color={T.acento} />}
                onPress={() => abrirDetalle(c)}
                valor={<Monto texto={pesos(c.total_centavos)} escala="pie" />}
              />
            ))}
          </Grupo>
        )}
        <View style={{ height: T.esps.xl }} />
      </ScrollView>
    );
  }

  function VistaForm() {
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }} keyboardShouldPersistTaps="handled">
        <Banner texto={error} tipo="error" />
        <Campo label="Cliente (opcional)">
          <TextInput style={estiloInput} value={clienteNombre} onChangeText={setClienteNombre}
            placeholder="Nombre" placeholderTextColor={T.textoTenue} autoCapitalize="words" />
        </Campo>
        <Campo label="Teléfono (opcional)">
          <TextInput style={estiloInput} value={clienteTelefono} onChangeText={setClienteTelefono}
            placeholder="Para compartir por WhatsApp" placeholderTextColor={T.textoTenue} keyboardType="phone-pad" />
        </Campo>
        <Campo label="Válida hasta (opcional)" ayuda="Formato AAAA-MM-DD">
          <TextInput style={estiloInput} value={validaHasta} onChangeText={setValidaHasta}
            placeholder="AAAA-MM-DD" placeholderTextColor={T.textoTenue} keyboardType="numbers-and-punctuation" />
        </Campo>

        <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginTop: T.esps.xs, marginBottom: T.esps.sm }}>
          Conceptos
        </Txt>
        {lineas.map((l) => (
          <View
            key={l.id}
            style={{
              backgroundColor: T.superficie,
              borderWidth: 1,
              borderColor: T.borde,
              borderRadius: T.radio,
              padding: T.esps.sm,
              marginBottom: T.esps.sm,
            }}
          >
            <TextInput
              style={[estiloInput, { marginBottom: T.esps.xs }]}
              value={l.descripcion}
              onChangeText={(v) => actualizarLinea(l.id, { descripcion: v })}
              placeholder="Descripción"
              placeholderTextColor={T.textoTenue}
            />
            <View style={{ flexDirection: "row", gap: T.esps.sm }}>
              <TextInput
                style={[estiloInput, { flex: 1 }]}
                value={String(l.cantidad)}
                onChangeText={(v) => actualizarLinea(l.id, { cantidad: Math.max(0.001, parseFloat(v.replace(",", ".")) || 0) })}
                placeholder="Cant."
                keyboardType="decimal-pad"
                placeholderTextColor={T.textoTenue}
              />
              <TextInput
                style={[estiloInput, { flex: 1 }]}
                value={(l.precioUnitarioCentavos / 100).toFixed(2)}
                onChangeText={(v) => actualizarLinea(l.id, { precioUnitarioCentavos: Math.max(0, Math.round((parseFloat(v.replace(",", ".")) || 0) * 100)) })}
                placeholder="Precio"
                keyboardType="decimal-pad"
                placeholderTextColor={T.textoTenue}
              />
              <Pressable
                onPress={() => quitarLinea(l.id)}
                style={{ width: 44, alignItems: "center", justifyContent: "center" }}
              >
                <Txt escala="titulo" tono="tenue">
                  ×
                </Txt>
              </Pressable>
            </View>
          </View>
        ))}
        <View style={{ flexDirection: "row", gap: T.esps.sm, marginBottom: T.esps.lg }}>
          <View style={{ flex: 1 }}>
            <Boton titulo="+ Del catálogo" tipo="secundario" chico onPress={() => setBuscadorAbierto(true)} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton titulo="+ Concepto libre" tipo="secundario" chico onPress={agregarConcepto} />
          </View>
        </View>

        <Campo label="Descuento total (opcional)">
          <TextInput style={estiloInput} value={descuento} onChangeText={setDescuento}
            placeholder="0.00" placeholderTextColor={T.textoTenue} keyboardType="decimal-pad" />
        </Campo>
        <Campo label="Notas (opcional)">
          <TextInput
            style={[estiloInput, { minHeight: 60, textAlignVertical: "top" }]}
            value={notas} onChangeText={setNotas} multiline
            placeholder="Condiciones, tiempos de entrega…" placeholderTextColor={T.textoTenue}
          />
        </Campo>

        <View style={{ alignItems: "flex-end", marginBottom: T.esps.md }}>
          <Txt escala="pie" tono="suave">
            Total
          </Txt>
          <Monto texto={pesos(totalFinal)} escala="titulo" />
        </View>
        <Boton titulo="Crear cotización" onPress={guardar} cargando={guardando} />
        <View style={{ height: T.esps.xxl }} />
      </ScrollView>
    );
  }

  function VistaDetalle() {
    if (!detalle) return null;
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }}>
        <Banner texto={error} tipo="error" />
        <Txt escala="pie" tono="tenue" fuerte estilo={{ marginBottom: T.esps.md }}>
          {ETIQUETA[detalle.estado]}{detalle.valida_hasta ? ` · válida hasta ${detalle.valida_hasta}` : ""}
        </Txt>
        {detalle.lineas.map((l) => (
          <View
            key={l.id}
            style={{ flexDirection: "row", justifyContent: "space-between", gap: T.esps.sm, paddingVertical: T.esps.xs }}
          >
            <Txt escala="pie" estilo={{ flex: 1 }} lineas={2}>
              {l.cantidad % 1 === 0 ? l.cantidad : l.cantidad.toFixed(3)} × {l.descripcion}
            </Txt>
            <Monto texto={pesos(l.total_linea_centavos)} escala="pie" fuerte />
          </View>
        ))}
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: T.borde,
            marginTop: T.esps.sm,
            paddingTop: T.esps.sm,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
            <Txt escala="pie" tono="tenue">Subtotal</Txt>
            <Monto texto={pesos(detalle.subtotal_centavos)} escala="pie" tono="suave" />
          </View>
          {detalle.descuento_centavos > 0 && (
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
              <Txt escala="pie" tono="tenue">Descuento</Txt>
              <Monto texto={`−${pesos(detalle.descuento_centavos)}`} escala="pie" tono="suave" />
            </View>
          )}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              borderTopWidth: 1,
              borderTopColor: T.borde,
              marginTop: T.esps.xs,
              paddingTop: T.esps.sm,
            }}
          >
            <Txt escala="cuerpo" fuerte>Total</Txt>
            <Monto texto={pesos(detalle.total_centavos)} escala="cuerpo" />
          </View>
        </View>

        <View style={{ marginTop: T.esps.xl, gap: T.esps.sm }}>
          <Boton titulo="Compartir" tipo="secundario" onPress={compartir} />
          {detalle.estado === "abierta" && (
            <Boton titulo="Convertir a venta" onPress={convertirAVenta} />
          )}
          {detalle.estado === "abierta" && (
            <Boton titulo="Cancelar cotización" tipo="peligro" onPress={cancelar} />
          )}
          <Boton titulo="Eliminar" tipo="fantasma" onPress={() => setConfirmandoBorrado(true)} />
        </View>
        <View style={{ height: T.esps.xxl }} />
      </ScrollView>
    );
  }

  function VistaBuscadorProducto() {
    return (
      <Modal visible animationType="slide" onRequestClose={() => setBuscadorAbierto(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: T.fondo }}>
          <CabeceraModal titulo="Del catálogo" izquierda="Cerrar" onIzquierda={() => setBuscadorAbierto(false)} />
          <View style={{ padding: T.esp }}>
            <TextInput
              style={estiloInput}
              value={busquedaProd}
              onChangeText={setBusquedaProd}
              placeholder="Buscar producto por nombre o código…"
              placeholderTextColor={T.textoTenue}
              autoFocus
            />
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: T.esp }}>
            {resultadosFiltrados.length === 0 ? (
              <Vacio titulo="Sin resultados" texto="Prueba con otro nombre o código." />
            ) : (
              <Grupo>
                {resultadosFiltrados.map((p) => (
                  <Fila
                    key={p.id}
                    titulo={p.nombre}
                    onPress={() => agregarProducto(p)}
                    valor={<Monto texto={pesos(p.precio_venta_centavos)} escala="pie" />}
                  />
                ))}
              </Grupo>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    );
  }

  const cabecera = (() => {
    switch (vista) {
      case "form": return { titulo: "Nueva cotización", izquierda: "Atrás", onIzquierda: () => setVista("lista") };
      case "detalle": return { titulo: detalle ? `Cotización #${detalle.folio}` : "Cotización", izquierda: "Atrás", onIzquierda: () => setVista("lista") };
      default: return { titulo: "Cotizaciones", izquierda: "Listo", onIzquierda: onCerrar };
    }
  })();

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={{ flex: 1, backgroundColor: T.fondo }}>
        <KeyboardAvoidingView style={{ flex: 1 }} // "padding" en las DOS plataformas.
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
              behavior="padding">
          <CabeceraModal titulo={cabecera.titulo} izquierda={cabecera.izquierda} onIzquierda={cabecera.onIzquierda} />
          {vista === "lista" && VistaLista()}
          {vista === "form" && VistaForm()}
          {vista === "detalle" && VistaDetalle()}
        </KeyboardAvoidingView>
      </SafeAreaView>
      {buscadorAbierto && VistaBuscadorProducto()}

      {/* Confirmación de borrado: antes NO existía ninguna — ni Alert ni
          hoja propia. Se tocaba "Eliminar" y desaparecía sin poder
          arrepentirte. */}
      <Hoja
        visible={confirmandoBorrado}
        onCerrar={() => setConfirmandoBorrado(false)}
        titulo="Eliminar cotización"
        pie={
          <View style={{ gap: T.esps.sm }}>
            <Boton titulo="Eliminar" tipo="peligro" onPress={confirmarEliminar} />
            <Boton titulo="Cancelar" tipo="secundario" onPress={() => setConfirmandoBorrado(false)} />
          </View>
        }
      >
        <Txt escala="pie" tono="suave">
          {detalle ? `¿Eliminar la cotización #${detalle.folio}? No se puede deshacer.` : ""}
        </Txt>
      </Hoja>
    </Modal>
  );
}
