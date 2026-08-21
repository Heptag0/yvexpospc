// YvexPOS Móvil — Proveedores y compras (modal con sub-vistas).
//
// Vistas internas: lista -> detalle -> form / compra manual. El escáner de
// tickets ya deja compras solito; aquí el dueño ve el resumen por
// proveedor, marca los días que pasa (para el aviso de Inicio) y registra
// compras a mano.
//
// ---------------------------------------------------------------------------
// QUÉ CAMBIÓ EN ESTA MIGRACIÓN
// ---------------------------------------------------------------------------
// 1. T.turquesa en 4 sitios (icono del camión, "Viene: Lu Ma", la flecha de
//    cada fila, el total de cada compra) -> T.acento. El morado fantasma
//    que venimos limpiando desde la Fase 1.
// 2. Alert.alert (eliminar proveedor) -> <Hoja> chica anidada, mismo patrón
//    que ModalDepartamentos y FormularioProducto.
// 3. BackHandler para el drill-down (lista -> detalle/form/compra): sin
//    él, Atrás cerraba todo el modal en vez de retroceder un nivel.
// 4. Las listas (proveedores, historial de compras) pasan a <Fila>/<Grupo>
//    con <Monto> para los totales.

import { useState, useEffect, useCallback, useMemo } from "react";
import { Modal, View, TextInput, ScrollView, Pressable, ActivityIndicator, BackHandler } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ProveedorResumen,
  Compra,
  listarProveedores,
  obtenerProveedor,
  crearProveedor,
  editarProveedor,
  eliminarProveedor,
  registrarCompra,
  historialCompras,
} from "@/src/base/proveedores";
import { pesos, aCentavos, fmtFecha } from "@/src/base/formato";
import { hoyYmd } from "@/src/base/visitas";
import { useTema } from "@/src/componentes/TemaProvider";
import { IconoUI } from "@/src/componentes/iconos";
import { Boton, Banner, CabeceraModal, Campo, Hoja, Grupo, Fila, Lamina, Txt, Monto, Vacio, useEstiloInput } from "@/src/componentes/ui";

type Props = {
  onCerrar: () => void;
  /** Se llama cuando cambian datos (para que Inicio/Inventario recarguen). */
  onCambio?: () => void;
};

type Vista = "lista" | "detalle" | "form" | "compra";

// Chips de días: 0 = domingo … 6 = sábado (como Date.getDay()).
const DIAS: { n: number; corto: string }[] = [
  { n: 1, corto: "Lu" },
  { n: 2, corto: "Ma" },
  { n: 3, corto: "Mi" },
  { n: 4, corto: "Ju" },
  { n: 5, corto: "Vi" },
  { n: 6, corto: "Sa" },
  { n: 0, corto: "Do" },
];

export default function ModalProveedores({ onCerrar, onCambio }: Props) {
  const { tema: T } = useTema();
  const estiloInput = useEstiloInput();

  const [vista, setVista] = useState<Vista>("lista");
  const [proveedores, setProveedores] = useState<ProveedorResumen[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [confirmandoBorrado, setConfirmandoBorrado] = useState<ProveedorResumen | null>(null);

  // Detalle
  const [detalle, setDetalle] = useState<ProveedorResumen | null>(null);
  const [compras, setCompras] = useState<Compra[]>([]);

  // Form proveedor (crear / editar)
  const [editando, setEditando] = useState<ProveedorResumen | null>(null);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [notas, setNotas] = useState("");
  const [dias, setDias] = useState<number[]>([]);

  // Compra manual
  const [compraProvId, setCompraProvId] = useState<string | null>(null);
  const [compraNombreLibre, setCompraNombreLibre] = useState("");
  const [compraFecha, setCompraFecha] = useState(hoyYmd());
  const [compraFolio, setCompraFolio] = useState("");
  const [compraTotal, setCompraTotal] = useState("");
  const [compraNotas, setCompraNotas] = useState("");
  const [compraTipo, setCompraTipo] = useState<"normal" | "preventa">("normal");

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setProveedores(await listarProveedores());
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Atrás del sistema: retrocede un nivel en vez de cerrar todo el modal.
  useEffect(() => {
    const alPresionarAtras = () => {
      if (vista === "detalle") {
        setVista("lista");
        return true;
      }
      if (vista === "form") {
        setVista(editando ? "detalle" : "lista");
        return true;
      }
      if (vista === "compra") {
        setVista(detalle && compraProvId === detalle.id ? "detalle" : "lista");
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", alPresionarAtras);
    return () => sub.remove();
  }, [vista, editando, detalle, compraProvId]);

  async function abrirDetalle(p: ProveedorResumen) {
    setError("");
    const [fresco, hist] = await Promise.all([obtenerProveedor(p.id), historialCompras(p.id)]);
    setDetalle(fresco ?? p);
    setCompras(hist);
    setVista("detalle");
  }

  function abrirForm(p: ProveedorResumen | null) {
    setError("");
    setEditando(p);
    setNombre(p?.nombre ?? "");
    setTelefono(p?.telefono ?? "");
    setNotas(p?.notas ?? "");
    setDias(p?.dias_visita ?? []);
    setVista("form");
  }

  function abrirCompra(proveedorId: string | null) {
    setError("");
    setCompraProvId(proveedorId);
    setCompraNombreLibre("");
    setCompraFecha(hoyYmd());
    setCompraFolio("");
    setCompraTotal("");
    setCompraNotas("");
    setCompraTipo("normal");
    setVista("compra");
  }

  function toggleDia(n: number) {
    setDias((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n]));
  }

  async function guardarProveedor() {
    setError("");
    setGuardando(true);
    try {
      const datos = { nombre, telefono, notas, diasVisita: dias.length ? dias : null };
      if (editando) await editarProveedor(editando.id, datos);
      else await crearProveedor(datos);
      await cargar();
      onCambio?.();
      if (editando) await abrirDetalle(editando);
      else setVista("lista");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setGuardando(false);
    }
  }

  async function confirmarEliminar() {
    if (!confirmandoBorrado) return;
    try {
      await eliminarProveedor(confirmandoBorrado.id);
      await cargar();
      onCambio?.();
      setConfirmandoBorrado(null);
      setVista("lista");
      setDetalle(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setConfirmandoBorrado(null);
    }
  }

  async function guardarCompra() {
    setError("");
    const total = aCentavos(compraTotal);
    if (total <= 0) {
      setError("Escribe el total del ticket (mayor a $0.00).");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(compraFecha.trim())) {
      setError("La fecha debe verse así: AAAA-MM-DD (ej. " + hoyYmd() + ").");
      return;
    }
    let nombreProv: string | null = null;
    if (compraProvId === null) {
      nombreProv = compraNombreLibre.trim() || null;
      if (!nombreProv) {
        setError("Elige un proveedor de la lista o escribe su nombre.");
        return;
      }
    } else {
      nombreProv = proveedores.find((p) => p.id === compraProvId)?.nombre ?? null;
    }
    setGuardando(true);
    try {
      await registrarCompra({
        proveedorNombre: nombreProv,
        folio: compraFolio,
        fecha: compraFecha.trim(),
        tipo: compraTipo,
        totalCentavos: total,
        numLineas: 0,
        origen: "manual",
        notas: compraNotas,
      });
      await cargar();
      onCambio?.();
      if (compraProvId) {
        const p = await obtenerProveedor(compraProvId);
        if (p) {
          setDetalle(p);
          setCompras(await historialCompras(p.id));
          setVista("detalle");
          return;
        }
      }
      setVista("lista");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setGuardando(false);
    }
  }

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return proveedores;
    return proveedores.filter((p) => p.nombre.toLowerCase().includes(q));
  }, [proveedores, busqueda]);

  function resumenLinea(p: ProveedorResumen): string {
    if (p.totalCompras === 0) return "Sin compras registradas todavía";
    const partes = [
      `${p.totalCompras} compra${p.totalCompras === 1 ? "" : "s"}`,
      p.ultimoTicketCentavos != null ? `último ${pesos(p.ultimoTicketCentavos)}` : null,
      p.ticketPromedioCentavos != null ? `promedio ${pesos(p.ticketPromedioCentavos)}` : null,
    ];
    return partes.filter(Boolean).join(" · ");
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
          placeholder="Buscar proveedor…"
          placeholderTextColor={T.textoTenue}
        />
        <View style={{ marginBottom: T.esps.md }}>
          <Boton titulo="+ Nuevo proveedor" onPress={() => abrirForm(null)} />
        </View>
        <View style={{ marginBottom: T.esps.lg }}>
          <Boton titulo="Registrar compra a mano" tipo="secundario" onPress={() => abrirCompra(proveedores[0]?.id ?? null)} />
        </View>
        {cargando ? (
          <ActivityIndicator color={T.acento} style={{ marginTop: T.esps.xl }} />
        ) : filtrados.length === 0 ? (
          <Vacio
            titulo={busqueda ? "Sin resultados" : "Aún no tienes proveedores"}
            texto={
              busqueda
                ? "Prueba con otro nombre."
                : "Agrégalos aquí, o escanea un ticket de surtido y se registran solos."
            }
          />
        ) : (
          <Grupo>
            {filtrados.map((p) => (
              <Fila
                key={p.id}
                titulo={p.nombre}
                meta={
                  p.dias_visita && p.dias_visita.length > 0
                    ? `${resumenLinea(p)}\nViene: ${DIAS.filter((d) => p.dias_visita!.includes(d.n)).map((d) => d.corto).join(" ")}`
                    : resumenLinea(p)
                }
                icono={<IconoUI id="camion" size={19} color={T.acento} />}
                onPress={() => abrirDetalle(p)}
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
        <Campo label="Nombre">
          <TextInput
            style={estiloInput}
            value={nombre}
            onChangeText={setNombre}
            placeholder="Ej. Coca-Cola, Bimbo, El de la verdura"
            placeholderTextColor={T.textoTenue}
            autoCapitalize="words"
          />
        </Campo>
        <Campo label="Teléfono (opcional)">
          <TextInput
            style={estiloInput}
            value={telefono}
            onChangeText={setTelefono}
            placeholder="Para pedirle sin buscar el número"
            placeholderTextColor={T.textoTenue}
            keyboardType="phone-pad"
          />
        </Campo>
        <Campo label="Notas (opcional)">
          <TextInput
            style={[estiloInput, { minHeight: 70, textAlignVertical: "top" }]}
            value={notas}
            onChangeText={setNotas}
            placeholder="Ej. paga en efectivo, trae catálogo nuevo…"
            placeholderTextColor={T.textoTenue}
            multiline
          />
        </Campo>

        <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.xs }}>
          ¿Qué días viene?
        </Txt>
        <Txt escala="pie" tono="tenue" estilo={{ marginBottom: T.esps.md }}>
          Si lo marcas, Inicio te avisa cuando esté por llegar, junto con tu
          último ticket y tu promedio — para que sepas cuánto apartarle.
        </Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: T.esps.sm, marginBottom: T.esps.xl }}>
          {DIAS.map((d) => {
            const activo = dias.includes(d.n);
            return (
              <Pressable
                key={d.n}
                onPress={() => toggleDia(d.n)}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: activo ? T.acentoRelleno : T.superficie2,
                  borderWidth: 1,
                  borderColor: activo ? T.acentoRelleno : T.borde,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Txt escala="pie" fuerte tono={activo ? "principal" : "suave"} estilo={activo ? { color: T.acentoTexto } : undefined}>
                  {d.corto}
                </Txt>
              </Pressable>
            );
          })}
        </View>

        <Boton
          titulo={editando ? "Guardar cambios" : "Crear proveedor"}
          onPress={guardarProveedor}
          cargando={guardando}
          deshabilitado={!nombre.trim()}
        />
        <View style={{ height: T.esps.xl }} />
      </ScrollView>
    );
  }

  function VistaDetalle() {
    if (!detalle) return null;
    const p = detalle;
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }} keyboardShouldPersistTaps="handled">
        <Banner texto={error} tipo="error" />

        {/* Resumen — la cifra protagonista de esta pantalla. */}
        <View style={{ marginBottom: T.esps.lg }}>
          <Lamina>
            <Txt escala="micro" tono="suave" fuerte mayus>
              Compras registradas
            </Txt>
            <View style={{ marginTop: T.esps.xs }}>
              <Monto texto={String(p.totalCompras)} escala="protagonista" />
            </View>
            <View
              style={{
                flexDirection: "row",
                marginTop: T.esps.lg,
                paddingTop: T.esps.lg,
                borderTopWidth: 1,
                borderTopColor: T.borde,
              }}
            >
              <View style={{ flex: 1 }}>
                <Monto texto={p.ultimoTicketCentavos != null ? pesos(p.ultimoTicketCentavos) : "—"} escala="cuerpo" />
                <Txt escala="pie" tono="suave">último ticket</Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Monto texto={p.ticketPromedioCentavos != null ? pesos(p.ticketPromedioCentavos) : "—"} escala="cuerpo" />
                <Txt escala="pie" tono="suave">promedio</Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Txt escala="cuerpo" fuerte>{p.ultimaFecha ? fmtFecha(p.ultimaFecha) : "—"}</Txt>
                <Txt escala="pie" tono="suave">última vez</Txt>
              </View>
            </View>
          </Lamina>
        </View>

        {p.dias_visita && p.dias_visita.length > 0 && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: T.esps.sm,
              backgroundColor: T.acentoSuave,
              borderRadius: T.radioChico,
              paddingHorizontal: T.esps.md,
              paddingVertical: T.esps.sm,
              marginBottom: T.esps.md,
            }}
          >
            <IconoUI id="camion" size={18} color={T.acento} />
            <Txt escala="pie" fuerte>
              Viene: {DIAS.filter((d) => p.dias_visita!.includes(d.n)).map((d) => d.corto).join(" · ")}
            </Txt>
          </View>
        )}
        {p.telefono ? <Txt escala="pie" tono="suave" estilo={{ marginBottom: T.esps.xs }}>Tel: {p.telefono}</Txt> : null}
        {p.notas ? <Txt escala="pie" tono="suave" estilo={{ marginBottom: T.esps.md }}>{p.notas}</Txt> : null}

        <View style={{ flexDirection: "row", gap: T.esps.sm, marginVertical: T.esps.lg }}>
          <View style={{ flex: 1 }}>
            <Boton titulo="Registrar compra" tipo="secundario" chico onPress={() => abrirCompra(p.id)} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton titulo="Editar" tipo="secundario" chico onPress={() => abrirForm(p)} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton titulo="Eliminar" tipo="peligro" chico onPress={() => setConfirmandoBorrado(p)} />
          </View>
        </View>

        {/* Historial de compras */}
        <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.sm }}>
          Historial de compras
        </Txt>
        {compras.length === 0 ? (
          <Vacio
            titulo="Nada todavía"
            texto="Escanea un ticket de este proveedor o regístralo a mano."
          />
        ) : (
          <Grupo>
            {compras.map((c) => (
              <Fila
                key={c.id}
                titulo={`${c.fecha ? fmtFecha(c.fecha) : fmtFecha(c.creado_en)}${c.tipo === "preventa" ? " · Preventa" : ""}`}
                meta={[
                  c.folio ? `Folio ${c.folio}` : null,
                  c.num_lineas > 0 ? `${c.num_lineas} línea${c.num_lineas === 1 ? "" : "s"}` : null,
                  c.origen === "escaner" ? "Escáner" : "Manual",
                  c.notas || null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                flecha={false}
                valor={<Monto texto={pesos(c.total_centavos)} escala="pie" />}
              />
            ))}
          </Grupo>
        )}
        <View style={{ height: T.esps.xl }} />
      </ScrollView>
    );
  }

  function VistaCompra() {
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }} keyboardShouldPersistTaps="handled">
        <Banner texto={error} tipo="error" />

        <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.sm }}>
          Proveedor
        </Txt>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: T.esps.lg }}>
          <View style={{ flexDirection: "row", gap: T.esps.sm }}>
            {proveedores.map((p) => {
              const activo = compraProvId === p.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setCompraProvId(p.id)}
                  style={{
                    paddingHorizontal: T.esps.lg,
                    height: 38,
                    borderRadius: 19,
                    backgroundColor: activo ? T.acentoRelleno : T.superficie2,
                    borderWidth: 1,
                    borderColor: activo ? T.acentoRelleno : T.borde,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Txt escala="pie" fuerte={activo} tono={activo ? "principal" : "suave"} estilo={activo ? { color: T.acentoTexto } : undefined} lineas={1}>
                    {p.nombre}
                  </Txt>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setCompraProvId(null)}
              style={{
                paddingHorizontal: T.esps.lg,
                height: 38,
                borderRadius: 19,
                backgroundColor: compraProvId === null ? T.acentoRelleno : T.superficie2,
                borderWidth: 1,
                borderColor: compraProvId === null ? T.acentoRelleno : T.borde,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Txt
                escala="pie"
                fuerte={compraProvId === null}
                tono={compraProvId === null ? "principal" : "suave"}
                estilo={compraProvId === null ? { color: T.acentoTexto } : undefined}
              >
                Otro…
              </Txt>
            </Pressable>
          </View>
        </ScrollView>
        {compraProvId === null && (
          <Campo label="Nombre del proveedor">
            <TextInput
              style={estiloInput}
              value={compraNombreLibre}
              onChangeText={setCompraNombreLibre}
              placeholder="Escríbelo como viene en el ticket"
              placeholderTextColor={T.textoTenue}
              autoCapitalize="words"
            />
          </Campo>
        )}

        <Campo label="Fecha" ayuda="Formato AAAA-MM-DD. Hoy viene puesta por defecto.">
          <TextInput
            style={estiloInput}
            value={compraFecha}
            onChangeText={setCompraFecha}
            placeholder={hoyYmd()}
            placeholderTextColor={T.textoTenue}
            keyboardType="numbers-and-punctuation"
          />
        </Campo>
        <Campo label="Folio (opcional)">
          <TextInput
            style={estiloInput}
            value={compraFolio}
            onChangeText={setCompraFolio}
            placeholder="Número de ticket o remisión"
            placeholderTextColor={T.textoTenue}
          />
        </Campo>
        <Campo label="Total del ticket">
          <TextInput
            style={estiloInput}
            value={compraTotal}
            onChangeText={setCompraTotal}
            placeholder="0.00"
            placeholderTextColor={T.textoTenue}
            keyboardType="decimal-pad"
          />
        </Campo>

        <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.sm }}>
          Tipo
        </Txt>
        <View style={{ flexDirection: "row", gap: T.esps.sm, marginBottom: T.esps.lg }}>
          {(["normal", "preventa"] as const).map((tp) => {
            const activo = compraTipo === tp;
            return (
              <Pressable
                key={tp}
                onPress={() => setCompraTipo(tp)}
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: T.radioChico,
                  backgroundColor: activo ? T.acentoRelleno : T.superficie2,
                  borderWidth: 1,
                  borderColor: activo ? T.acentoRelleno : T.borde,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Txt escala="pie" fuerte={activo} tono={activo ? "principal" : "suave"} estilo={activo ? { color: T.acentoTexto } : undefined}>
                  {tp === "normal" ? "Normal" : "Preventa"}
                </Txt>
              </Pressable>
            );
          })}
        </View>

        <Campo label="Notas (opcional)">
          <TextInput
            style={[estiloInput, { minHeight: 60, textAlignVertical: "top" }]}
            value={compraNotas}
            onChangeText={setCompraNotas}
            placeholder="Ej. faltó la coca de 2L, me quedó a deber…"
            placeholderTextColor={T.textoTenue}
            multiline
          />
        </Campo>

        <Boton titulo="Guardar compra" onPress={guardarCompra} cargando={guardando} />
        <View style={{ height: T.esps.xl }} />
      </ScrollView>
    );
  }

  // Cabecera según vista: atrás dentro del modal, Listo solo en la lista.
  const cabecera = (() => {
    switch (vista) {
      case "detalle":
        return { titulo: detalle?.nombre ?? "Proveedor", izquierda: "Atrás", onIzquierda: () => setVista("lista") };
      case "form":
        return {
          titulo: editando ? "Editar proveedor" : "Nuevo proveedor",
          izquierda: "Atrás",
          onIzquierda: () => (editando ? setVista("detalle") : setVista("lista")),
        };
      case "compra":
        return {
          titulo: "Registrar compra",
          izquierda: "Atrás",
          onIzquierda: () => (detalle && compraProvId === detalle.id ? setVista("detalle") : setVista("lista")),
        };
      default:
        return { titulo: "Proveedores", izquierda: "Listo", onIzquierda: onCerrar };
    }
  })();

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={{ flex: 1, backgroundColor: T.fondo }}>
        <CabeceraModal titulo={cabecera.titulo} onIzquierda={cabecera.onIzquierda} izquierda={cabecera.izquierda} />
        {vista === "lista" && VistaLista()}
        {vista === "detalle" && VistaDetalle()}
        {vista === "form" && VistaForm()}
        {vista === "compra" && VistaCompra()}
      </SafeAreaView>

      {/* Confirmación de eliminar: hoja chica, sin Alert nativo. */}
      <Hoja
        visible={confirmandoBorrado !== null}
        onCerrar={() => setConfirmandoBorrado(null)}
        titulo="Eliminar proveedor"
        pie={
          <View style={{ gap: T.esps.sm }}>
            <Boton titulo="Eliminar" tipo="peligro" onPress={confirmarEliminar} />
            <Boton titulo="Cancelar" tipo="secundario" onPress={() => setConfirmandoBorrado(null)} />
          </View>
        }
      >
        <Txt escala="pie" tono="suave">
          {confirmandoBorrado
            ? `¿Eliminar "${confirmandoBorrado.nombre}"? Su historial de compras se conserva, solo deja de aparecer en la lista.`
            : ""}
        </Txt>
      </Hoja>
    </Modal>
  );
}
