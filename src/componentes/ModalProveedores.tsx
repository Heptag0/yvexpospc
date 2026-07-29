// YvexPOS Móvil — Proveedores y compras (modal con sub-vistas).
//
// Vistas internas (como ModalAjustesEscaner): lista -> detalle -> form /
// compra manual. El escáner de tickets ya deja compras solito; aquí el
// dueño ve el resumen por proveedor, marca los días que pasa (para el
// aviso de Inicio) y registra compras a mano.
//
// Todo sale del tema ACTIVO (useTema): nada de colores fijos.

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
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
import { Boton, Banner, CabeceraModal, Campo, useEstiloInput } from "@/src/componentes/ui";

type Tema = ReturnType<typeof useTema>["tema"];

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
  const est = useMemo(() => crearEstilos(T), [T]);
  const estiloInput = useEstiloInput();

  const [vista, setVista] = useState<Vista>("lista");
  const [proveedores, setProveedores] = useState<ProveedorResumen[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

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

  function confirmarEliminar(p: ProveedorResumen) {
    Alert.alert(
      "Eliminar proveedor",
      `¿Eliminar "${p.nombre}"? Su historial de compras se conserva, solo deja de aparecer en la lista.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              await eliminarProveedor(p.id);
              await cargar();
              onCambio?.();
              setVista("lista");
              setDetalle(null);
            } catch (e: any) {
              setError(e?.message ?? String(e));
            }
          },
        },
      ]
    );
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
      <ScrollView contentContainerStyle={est.cuerpo} keyboardShouldPersistTaps="handled">
        <Banner texto={error} tipo="error" />
        <TextInput
          style={[estiloInput, { marginBottom: 12 }]}
          value={busqueda}
          onChangeText={setBusqueda}
          placeholder="Buscar proveedor…"
          placeholderTextColor={T.textoTenue}
        />
        <View style={{ marginBottom: 18 }}>
          <Boton titulo="+ Nuevo proveedor" onPress={() => abrirForm(null)} />
        </View>
        <View style={{ marginBottom: 18 }}>
          <Boton titulo="Registrar compra a mano" tipo="secundario" onPress={() => abrirCompra(proveedores[0]?.id ?? null)} />
        </View>
        {cargando ? (
          <ActivityIndicator color={T.acento} style={{ marginTop: 30 }} />
        ) : filtrados.length === 0 ? (
          <Text style={est.vacio}>
            {busqueda
              ? "Sin resultados con esa búsqueda."
              : "Aún no tienes proveedores.\n\nAgrégalos aquí, o escanea un ticket de surtido y se registran solos."}
          </Text>
        ) : (
          filtrados.map((p) => (
            <Pressable
              key={p.id}
              style={({ pressed }) => [est.fila, pressed && { backgroundColor: T.superficie3 }]}
              onPress={() => abrirDetalle(p)}
            >
              <View style={est.filaIcono}>
                <IconoUI id="proveedor" size={19} color={T.acento} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={est.filaNombre} numberOfLines={1}>{p.nombre}</Text>
                <Text style={est.filaMeta} numberOfLines={1}>{resumenLinea(p)}</Text>
                {p.dias_visita && p.dias_visita.length > 0 && (
                  <Text style={est.filaDias} numberOfLines={1}>
                    Viene: {DIAS.filter((d) => p.dias_visita!.includes(d.n)).map((d) => d.corto).join(" ")}
                  </Text>
                )}
              </View>
              <Text style={est.filaFlecha}>→</Text>
            </Pressable>
          ))
        )}
        <View style={{ height: 30 }} />
      </ScrollView>
    );
  }

  function VistaForm() {
    return (
      <ScrollView contentContainerStyle={est.cuerpo} keyboardShouldPersistTaps="handled">
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

        <Text style={est.subLbl}>¿QUÉ DÍAS VIENE?</Text>
        <Text style={est.ayuda}>
          Si lo marcas, Inicio te avisa cuando esté por llegar, junto con tu
          último ticket y tu promedio — para que sepas cuánto apartarle.
        </Text>
        <View style={est.dias}>
          {DIAS.map((d) => {
            const activo = dias.includes(d.n);
            return (
              <Pressable
                key={d.n}
                onPress={() => toggleDia(d.n)}
                style={[
                  est.diaChip,
                  activo && { backgroundColor: T.acento, borderColor: T.acento },
                ]}
              >
                <Text style={[est.diaChipTxt, activo && { color: T.acentoTexto, fontWeight: "800" }]}>
                  {d.corto}
                </Text>
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
        <View style={{ height: 30 }} />
      </ScrollView>
    );
  }

  function VistaDetalle() {
    if (!detalle) return null;
    const p = detalle;
    return (
      <ScrollView contentContainerStyle={est.cuerpo} keyboardShouldPersistTaps="handled">
        <Banner texto={error} tipo="error" />

        {/* Resumen grande */}
        <View style={est.resumen}>
          <Text style={est.resumenLbl}>COMPRAS REGISTRADAS</Text>
          <Text style={est.resumenVal}>{p.totalCompras}</Text>
          <View style={est.resumenFila}>
            <View style={est.resumenDato}>
              <Text style={est.resumenDatoVal}>
                {p.ultimoTicketCentavos != null ? pesos(p.ultimoTicketCentavos) : "—"}
              </Text>
              <Text style={est.resumenDatoLbl}>último ticket</Text>
            </View>
            <View style={est.resumenDato}>
              <Text style={est.resumenDatoVal}>
                {p.ticketPromedioCentavos != null ? pesos(p.ticketPromedioCentavos) : "—"}
              </Text>
              <Text style={est.resumenDatoLbl}>ticket promedio</Text>
            </View>
            <View style={est.resumenDato}>
              <Text style={est.resumenDatoVal}>
                {p.ultimaFecha ? fmtFecha(p.ultimaFecha) : "—"}
              </Text>
              <Text style={est.resumenDatoLbl}>última vez</Text>
            </View>
          </View>
        </View>

        {p.dias_visita && p.dias_visita.length > 0 && (
          <View style={est.rutina}>
            <IconoUI id="camion" size={18} color={T.turquesa} />
            <Text style={est.rutinaTxt}>
              Viene: {DIAS.filter((d) => p.dias_visita!.includes(d.n)).map((d) => d.corto).join(" · ")}
            </Text>
          </View>
        )}
        {p.telefono ? <Text style={est.metaSuelto}>Tel: {p.telefono}</Text> : null}
        {p.notas ? <Text style={est.metaSuelto}>{p.notas}</Text> : null}

        <View style={est.detalleBotones}>
          <View style={{ flex: 1 }}>
            <Boton titulo="Registrar compra" tipo="secundario" chico onPress={() => abrirCompra(p.id)} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton titulo="Editar" tipo="secundario" chico onPress={() => abrirForm(p)} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton titulo="Eliminar" tipo="peligro" chico onPress={() => confirmarEliminar(p)} />
          </View>
        </View>

        {/* Historial de compras */}
        <Text style={est.listaTitulo}>Historial de compras</Text>
        {compras.length === 0 ? (
          <Text style={est.vacio}>
            Nada todavía. Escanea un ticket de este proveedor o regístralo a mano.
          </Text>
        ) : (
          compras.map((c) => (
            <View key={c.id} style={est.compra}>
              <View style={{ flex: 1 }}>
                <Text style={est.compraFecha}>
                  {c.fecha ? fmtFecha(c.fecha) : fmtFecha(c.creado_en)}
                  {c.tipo === "preventa" && <Text style={{ color: T.alerta, fontWeight: "800" }}> · Preventa</Text>}
                </Text>
                <Text style={est.compraMeta} numberOfLines={1}>
                  {[
                    c.folio ? `Folio ${c.folio}` : null,
                    c.num_lineas > 0 ? `${c.num_lineas} línea${c.num_lineas === 1 ? "" : "s"}` : null,
                    c.origen === "escaner" ? "Escáner" : "Manual",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                {c.notas ? <Text style={est.compraNotas} numberOfLines={2}>{c.notas}</Text> : null}
              </View>
              <Text style={est.compraTotal}>{pesos(c.total_centavos)}</Text>
            </View>
          ))
        )}
        <View style={{ height: 30 }} />
      </ScrollView>
    );
  }

  function VistaCompra() {
    return (
      <ScrollView contentContainerStyle={est.cuerpo} keyboardShouldPersistTaps="handled">
        <Banner texto={error} tipo="error" />

        <Text style={est.subLbl}>PROVEEDOR</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 14 }}>
          <View style={est.provChips}>
            {proveedores.map((p) => {
              const activo = compraProvId === p.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setCompraProvId(p.id)}
                  style={[est.provChip, activo && { backgroundColor: T.acento, borderColor: T.acento }]}
                >
                  <Text style={[est.provChipTxt, activo && { color: T.acentoTexto, fontWeight: "800" }]} numberOfLines={1}>
                    {p.nombre}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setCompraProvId(null)}
              style={[est.provChip, compraProvId === null && { backgroundColor: T.acento, borderColor: T.acento }]}
            >
              <Text style={[est.provChipTxt, compraProvId === null && { color: T.acentoTexto, fontWeight: "800" }]}>
                Otro…
              </Text>
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

        <Text style={est.subLbl}>TIPO</Text>
        <View style={est.tipoFila}>
          {(["normal", "preventa"] as const).map((tp) => {
            const activo = compraTipo === tp;
            return (
              <Pressable
                key={tp}
                onPress={() => setCompraTipo(tp)}
                style={[est.tipoChip, activo && { backgroundColor: T.acento, borderColor: T.acento }]}
              >
                <Text style={[est.tipoChipTxt, activo && { color: T.acentoTexto, fontWeight: "800" }]}>
                  {tp === "normal" ? "Normal" : "Preventa"}
                </Text>
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
        <View style={{ height: 30 }} />
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
      <SafeAreaView style={est.raiz}>
        <CabeceraModal titulo={cabecera.titulo} onIzquierda={cabecera.onIzquierda} izquierda={cabecera.izquierda} />
        {vista === "lista" && VistaLista()}
        {vista === "detalle" && VistaDetalle()}
        {vista === "form" && VistaForm()}
        {vista === "compra" && VistaCompra()}
      </SafeAreaView>
    </Modal>
  );
}

function crearEstilos(T: Tema) {
  return StyleSheet.create({
    raiz: { flex: 1, backgroundColor: T.fondo },
    cuerpo: { padding: T.esp },
    vacio: {
      color: T.textoTenue, textAlign: "center", marginTop: 26,
      fontSize: 14.5, lineHeight: 22, paddingHorizontal: 20,
    },
    fila: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
      borderRadius: T.radio, padding: 14, marginBottom: 8,
    },
    filaIcono: {
      width: 38, height: 38, borderRadius: 11,
      backgroundColor: T.acento + "1f", borderWidth: 1, borderColor: T.acento + "44",
      alignItems: "center", justifyContent: "center",
    },
    filaNombre: { color: T.texto, fontSize: 15, fontWeight: "800" },
    filaMeta: { color: T.textoTenue, fontSize: 12, marginTop: 2 },
    filaDias: { color: T.turquesa, fontSize: 11.5, fontWeight: "700", marginTop: 3 },
    filaFlecha: { color: T.turquesa, fontSize: 16, fontWeight: "800" },
    subLbl: {
      color: T.textoSuave, fontSize: 12, fontWeight: "800",
      letterSpacing: 0.7, marginBottom: 9, textTransform: "uppercase",
    },
    ayuda: { color: T.textoTenue, fontSize: 12.5, lineHeight: 18, marginBottom: 12 },
    dias: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
    diaChip: {
      width: 44, height: 44, borderRadius: 22,
      backgroundColor: T.superficie2, borderWidth: 1, borderColor: T.borde,
      alignItems: "center", justifyContent: "center",
    },
    diaChipTxt: { color: T.textoSuave, fontSize: 13, fontWeight: "700" },
    resumen: {
      backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
      borderLeftWidth: 4, borderLeftColor: T.acento,
      borderRadius: T.radioGrande, padding: 20, marginBottom: 14,
    },
    resumenLbl: { color: T.textoSuave, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
    resumenVal: { color: T.texto, fontSize: 34, fontWeight: "800", marginTop: 2 },
    resumenFila: { flexDirection: "row", marginTop: 14, gap: 12 },
    resumenDato: { flex: 1 },
    resumenDatoVal: { color: T.texto, fontSize: 14.5, fontWeight: "800" },
    resumenDatoLbl: { color: T.textoSuave, fontSize: 11, marginTop: 2 },
    rutina: {
      flexDirection: "row", alignItems: "center", gap: 9,
      backgroundColor: T.superficie2, borderWidth: 1, borderColor: T.bordeFuerte,
      borderRadius: T.radioChico + 2, paddingHorizontal: 13, paddingVertical: 10,
      marginBottom: 12,
    },
    rutinaTxt: { color: T.texto, fontSize: 13.5, fontWeight: "700" },
    metaSuelto: { color: T.textoSuave, fontSize: 13, marginBottom: 6 },
    detalleBotones: { flexDirection: "row", gap: 8, marginVertical: 16 },
    listaTitulo: {
      color: T.textoSuave, fontSize: 12, fontWeight: "800",
      letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10,
    },
    compra: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
      borderRadius: T.radio, padding: 13, marginBottom: 8,
    },
    compraFecha: { color: T.texto, fontSize: 13.5, fontWeight: "700" },
    compraMeta: { color: T.textoTenue, fontSize: 12, marginTop: 2 },
    compraNotas: { color: T.textoSuave, fontSize: 12, marginTop: 4, lineHeight: 17 },
    compraTotal: { color: T.turquesa, fontSize: 15.5, fontWeight: "800" },
    provChips: { flexDirection: "row", gap: 8 },
    provChip: {
      paddingHorizontal: 15, height: 38, borderRadius: 19,
      backgroundColor: T.superficie2, borderWidth: 1, borderColor: T.borde,
      alignItems: "center", justifyContent: "center",
    },
    provChipTxt: { color: T.textoSuave, fontSize: 13, fontWeight: "600" },
    tipoFila: { flexDirection: "row", gap: 8, marginBottom: 18 },
    tipoChip: {
      flex: 1, height: 44, borderRadius: T.radioChico + 2,
      backgroundColor: T.superficie2, borderWidth: 1, borderColor: T.borde,
      alignItems: "center", justifyContent: "center",
    },
    tipoChipTxt: { color: T.textoSuave, fontSize: 14, fontWeight: "700" },
  });
}
