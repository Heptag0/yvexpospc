// YvexPOS Móvil — Modal de CLIENTES Y LEALTAD (gestión).
//
// Lista con buscador + saldo de puntos, alta rápida (nombre + teléfono
// opcional) y detalle por cliente: tarjeta QR, saldo grande, "Registrar
// visita" (máx. 1 al día), historial de movimientos y edición/borrado suave.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Modal,
  FlatList,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, CabeceraModal, useEstiloInput } from "@/src/componentes/ui";
import { IconoUI } from "@/src/componentes/iconos";
import CodigoCliente from "@/src/componentes/CodigoCliente";
import { pesos, fmtFecha } from "@/src/base/formato";
import {
  Cliente,
  MovimientoPuntos,
  ReglasLealtad,
  buscarClientes,
  crearCliente,
  editarCliente,
  eliminarCliente,
  registrarVisita,
  historialPuntos,
  leerReglas,
  correoValido,
} from "@/src/base/lealtad";
import { leerNombreNegocio } from "@/src/base/giro";

type Tema = ReturnType<typeof useTema>["tema"];
type Vista = "lista" | "nuevo" | "detalle" | "editar";

export default function ModalLealtad({
  onCerrar,
  onCambio,
}: {
  onCerrar: () => void;
  onCambio?: () => void;
}) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const estiloInput = useEstiloInput();

  const [vista, setVista] = useState<Vista>("lista");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [seleccionado, setSeleccionado] = useState<Cliente | null>(null);
  const [historial, setHistorial] = useState<MovimientoPuntos[]>([]);
  const [reglas, setReglas] = useState<ReglasLealtad | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; tipo: "exito" | "info" } | null>(null);
  const [error, setError] = useState("");

  // Formulario (alta / edición)
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [correo, setCorreo] = useState("");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setClientes(await buscarClientes(busqueda));
    setReglas(await leerReglas());
  }, [busqueda]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function abrirDetalle(c: Cliente) {
    setSeleccionado(c);
    setHistorial(await historialPuntos(c.id));
    setAviso(null);
    setVista("detalle");
  }

  async function guardarNuevo() {
    setError("");
    setGuardando(true);
    try {
      const c = await crearCliente(nombre, telefono, correo);
      await cargar();
      onCambio?.();
      const correoRechazado = correo.trim() !== "" && !correoValido(correo);
      setNombre("");
      setTelefono("");
      setCorreo("");
      setNotas("");
      abrirDetalle(c); // cae directo en su tarjeta QR, listo para enseñar
      if (correoRechazado) {
        // Nunca bloqueamos el alta por un correo raro: solo avisamos.
        setAviso({
          texto: "El correo no parecía válido y no se guardó. Puedes corregirlo en «Editar».",
          tipo: "info",
        });
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setGuardando(false);
    }
  }

  async function guardarEdicion() {
    if (!seleccionado) return;
    setError("");
    setGuardando(true);
    try {
      await editarCliente(seleccionado.id, nombre, telefono, notas, correo);
      await cargar();
      onCambio?.();
      const correoRechazado = correo.trim() !== "" && !correoValido(correo);
      setSeleccionado({
        ...seleccionado,
        nombre: nombre.trim(),
        telefono: telefono.trim() || null,
        correo: correoRechazado ? seleccionado.correo : correo.trim().toLowerCase() || null,
        notas: notas.trim() || null,
      });
      setVista("detalle");
      if (correoRechazado) {
        setAviso({
          texto: "El correo no parecía válido y se conservó el anterior.",
          tipo: "info",
        });
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setGuardando(false);
    }
  }

  async function alRegistrarVisita() {
    if (!seleccionado) return;
    try {
      const r = await registrarVisita(seleccionado.id);
      if (r.otorgados > 0) {
        setAviso({
          texto: `Listo: +${r.otorgados} puntos por la visita de hoy.`,
          tipo: "exito",
        });
      } else {
        setAviso({
          texto:
            r.motivo === "ya registrada hoy"
              ? "La visita de hoy ya quedó registrada. ¡Que vuelva mañana!"
              : r.motivo ?? "No se otorgaron puntos.",
          tipo: "info",
        });
      }
      const fresco = (await buscarClientes("")).find((c) => c.id === seleccionado.id);
      if (fresco) setSeleccionado(fresco);
      setHistorial(await historialPuntos(seleccionado.id));
      await cargar();
    } catch (e: any) {
      setAviso({ texto: e?.message ?? String(e), tipo: "info" });
    }
  }

  /** Comparte el código del cliente por WhatsApp/SMS/etc. con el Share nativo
   *  de react-native (sin dependencias nuevas). La imagen del QR viaja como
   *  URL pública (qrserver.com): WhatsApp la muestra como preview tappable,
   *  pero el CÓDIGO siempre viaja en texto por si la imagen no carga.
   *  NOTA: cuando exista un backend público propio, esta URL pasará a ser una
   *  página del negocio (con su QR, reglas y promociones) en vez del servicio
   *  externo de QR. */
  async function compartirCliente() {
    if (!seleccionado) return;
    try {
      const negocio = await leerNombreNegocio();
      const urlQr = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(seleccionado.codigo)}`;
      await Share.share({
        message:
          `¡Hola! Este es tu código de puntos de ${negocio}: *${seleccionado.codigo}*. ` +
          `Enséñalo en caja (o tu QR) cada que vengas y acumula puntos en tus compras.\n\n` +
          `Tu QR: ${urlQr}`,
      });
    } catch {
      // Si el Share falla o se cancela, no pasa nada: la app sigue igual.
    }
  }

  function confirmarEliminar() {
    if (!seleccionado) return;
    Alert.alert(
      "Quitar cliente",
      `${seleccionado.nombre} dejará de aparecer en tu lista, pero su historial se conserva. ¿Continuar?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Quitar",
          style: "destructive",
          onPress: async () => {
            await eliminarCliente(seleccionado.id);
            await cargar();
            onCambio?.();
            setSeleccionado(null);
            setVista("lista");
          },
        },
      ]
    );
  }

  const etiquetaTipo = (t: MovimientoPuntos["tipo"]) =>
    t === "compra" ? "Compra" : t === "visita" ? "Visita" : t === "canje" ? "Canje" : "Ajuste";

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={est.raiz}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {vista === "lista" && (
            <CabeceraModal
              titulo="Clientes y lealtad"
              onIzquierda={onCerrar}
              derecha="+ Nuevo"
              onDerecha={() => {
                setNombre("");
                setTelefono("");
                setCorreo("");
                setNotas("");
                setError("");
                setVista("nuevo");
              }}
            />
          )}
          {vista === "nuevo" && (
            <CabeceraModal titulo="Nuevo cliente" onIzquierda={() => setVista("lista")} />
          )}
          {vista === "detalle" && (
            <CabeceraModal
              titulo={seleccionado?.nombre ?? "Cliente"}
              onIzquierda={() => {
                setSeleccionado(null);
                setVista("lista");
              }}
              derecha="Editar"
              onDerecha={() => {
                if (!seleccionado) return;
                setNombre(seleccionado.nombre);
                setTelefono(seleccionado.telefono ?? "");
                setCorreo(seleccionado.correo ?? "");
                setNotas(seleccionado.notas ?? "");
                setError("");
                setVista("editar");
              }}
            />
          )}
          {vista === "editar" && (
            <CabeceraModal titulo="Editar cliente" onIzquierda={() => setVista("detalle")} />
          )}

          {/* ---------------- LISTA ---------------- */}
          {vista === "lista" && (
            <>
              <View style={est.buscadorCaja}>
                <TextInput
                  style={estiloInput}
                  placeholder="Busca por nombre, teléfono, correo o código…"
                  placeholderTextColor={T.textoTenue}
                  value={busqueda}
                  onChangeText={setBusqueda}
                />
              </View>
              <FlatList
                data={clientes}
                keyExtractor={(c) => c.id}
                contentContainerStyle={{ paddingHorizontal: T.esp, paddingBottom: 20 }}
                ListEmptyComponent={
                  <Text style={est.vacio}>
                    {busqueda
                      ? "Sin resultados. ¿Lo damos de alta con «+ Nuevo»?"
                      : "Aún no tienes clientes. Toca «+ Nuevo» para registrar al primero: gana puntos en cada compra y en cada visita."}
                  </Text>
                }
                renderItem={({ item }) => (
                  <Pressable
                    style={({ pressed }) => [
                      est.filaCliente,
                      pressed && { backgroundColor: T.superficie3 },
                    ]}
                    onPress={() => abrirDetalle(item)}
                  >
                    <View style={est.avatar}>
                      <Text style={est.avatarTxt}>
                        {item.nombre.trim()[0]?.toUpperCase() ?? "?"}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={est.filaNombre} numberOfLines={1}>
                        {item.nombre}
                      </Text>
                      <Text style={est.filaMeta}>
                        {item.codigo}
                        {item.telefono ? ` · ${item.telefono}` : ""}
                      </Text>
                    </View>
                    <View style={est.saldoChip}>
                      <IconoUI id="regalo" size={13} color={T.acento} />
                      <Text style={est.saldoTxt}>{item.puntos} pts</Text>
                    </View>
                  </Pressable>
                )}
              />
            </>
          )}

          {/* ---------------- ALTA / EDICIÓN ---------------- */}
          {(vista === "nuevo" || vista === "editar") && (
            <ScrollView contentContainerStyle={{ padding: T.esp }}>
              <Banner texto={error} tipo="error" />
              <Text style={est.campoLbl}>NOMBRE</Text>
              <TextInput
                style={[estiloInput, { marginBottom: 16 }]}
                value={nombre}
                onChangeText={setNombre}
                placeholder="Ej. Doña Mari"
                placeholderTextColor={T.textoTenue}
                autoCapitalize="words"
                autoFocus={vista === "nuevo"}
              />
              <Text style={est.campoLbl}>TELÉFONO (OPCIONAL)</Text>
              <TextInput
                style={[estiloInput, { marginBottom: 16 }]}
                value={telefono}
                onChangeText={setTelefono}
                placeholder="Para identificarlo sin QR"
                placeholderTextColor={T.textoTenue}
                keyboardType="phone-pad"
              />
              <Text style={est.campoLbl}>CORREO (OPCIONAL)</Text>
              <TextInput
                style={[
                  estiloInput,
                  { marginBottom: correo.trim() !== "" && !correoValido(correo) ? 4 : 16 },
                  correo.trim() !== "" && !correoValido(correo) && {
                    borderColor: T.peligro,
                  },
                ]}
                value={correo}
                onChangeText={setCorreo}
                placeholder="Para promociones más adelante"
                placeholderTextColor={T.textoTenue}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {correo.trim() !== "" && !correoValido(correo) && (
                <Text style={est.correoAviso}>
                  Ese correo no parece válido; puedes guardar sin correo y corregirlo después.
                </Text>
              )}
              {vista === "editar" && (
                <>
                  <Text style={est.campoLbl}>NOTAS (OPCIONAL)</Text>
                  <TextInput
                    style={[estiloInput, { marginBottom: 16 }]}
                    value={notas}
                    onChangeText={setNotas}
                    placeholder="Ej. siempre pide fiado los viernes"
                    placeholderTextColor={T.textoTenue}
                    multiline
                  />
                </>
              )}
              <Boton
                titulo={vista === "nuevo" ? "Registrar cliente" : "Guardar cambios"}
                onPress={vista === "nuevo" ? guardarNuevo : guardarEdicion}
                cargando={guardando}
                deshabilitado={nombre.trim() === ""}
              />
              {vista === "editar" && (
                <View style={{ marginTop: 14 }}>
                  <Boton titulo="Quitar cliente" tipo="peligro" onPress={confirmarEliminar} />
                </View>
              )}
            </ScrollView>
          )}

          {/* ---------------- DETALLE ---------------- */}
          {vista === "detalle" && seleccionado && (
            <ScrollView contentContainerStyle={{ padding: T.esp, paddingBottom: 30 }}>
              {aviso && <Banner texto={aviso.texto} tipo={aviso.tipo} />}

              {/* Tarjeta QR */}
              <View style={est.tarjetaQr}>
                <CodigoCliente codigo={seleccionado.codigo} size={190} />
              </View>

              {/* Contacto (si existe): servirá después para promociones */}
              {(seleccionado.telefono || seleccionado.correo) && (
                <Text style={est.contacto}>
                  {[seleccionado.telefono, seleccionado.correo]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              )}

              {/* Regla vigente, en lenguaje de mostrador */}
              {reglas && reglas.activa && (
                <Text style={est.reglaTxt}>
                  Gana 1 punto por cada {pesos(reglas.pesosPorPunto * 100)} · 1 punto ={" "}
                  {pesos(reglas.valorPuntoCentavos)} al canjear
                </Text>
              )}

              <View style={{ marginTop: 14 }}>
                <Boton titulo="Compartir código" tipo="secundario" onPress={compartirCliente} />
              </View>

              {/* Saldo grande */}
              <View style={est.saldoCaja}>
                <Text style={est.saldoVal}>{seleccionado.puntos}</Text>
                <Text style={est.saldoLbl}>
                  puntos · valen {pesos(seleccionado.puntos * (reglas?.valorPuntoCentavos ?? 0))} al canjear
                </Text>
              </View>

              <Boton
                titulo={`Registrar visita (+${reglas?.puntosVisita ?? 0} pts)`}
                onPress={alRegistrarVisita}
              />
              <Text style={est.visitaAyuda}>
                Un regalito por pasar a saludar: una vez al día por cliente.
              </Text>

              {/* Historial */}
              <Text style={[est.campoLbl, { marginTop: 22, marginBottom: 8 }]}>
                HISTORIAL DE PUNTOS
              </Text>
              {historial.length === 0 ? (
                <Text style={est.vacioChico}>
                  Sin movimientos todavía. Aquí aparecerán sus compras, visitas y canjes.
                </Text>
              ) : (
                historial.map((m) => (
                  <View key={m.id} style={est.mov}>
                    <View style={{ flex: 1 }}>
                      <Text style={est.movTipo}>{etiquetaTipo(m.tipo)}</Text>
                      <Text style={est.movMeta}>
                        {fmtFecha(m.creado_en)}
                        {m.nota ? ` · ${m.nota}` : ""}
                      </Text>
                    </View>
                    <Text
                      style={[
                        est.movPuntos,
                        { color: m.puntos >= 0 ? T.exito : T.peligro },
                      ]}
                    >
                      {m.puntos >= 0 ? `+${m.puntos}` : m.puntos}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function crearEstilos(T: Tema) {
  return StyleSheet.create({
    raiz: { flex: 1, backgroundColor: T.fondo },
    buscadorCaja: { paddingHorizontal: T.esp, paddingVertical: 10 },
    vacio: {
      color: T.textoTenue, fontSize: 14.5, textAlign: "center",
      marginTop: 50, paddingHorizontal: 36, lineHeight: 22,
    },
    vacioChico: { color: T.textoTenue, fontSize: 13, lineHeight: 19 },
    filaCliente: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
      borderRadius: T.radio, padding: 12, marginBottom: 8,
    },
    avatar: {
      width: 40, height: 40, borderRadius: 12,
      backgroundColor: T.acento + "1f", borderWidth: 1, borderColor: T.acento + "44",
      alignItems: "center", justifyContent: "center",
    },
    avatarTxt: { color: T.acento, fontSize: 16, fontWeight: "800" },
    filaNombre: { color: T.texto, fontSize: 15, fontWeight: "800" },
    filaMeta: { color: T.textoTenue, fontSize: 12, marginTop: 2 },
    saldoChip: {
      flexDirection: "row", alignItems: "center", gap: 5,
      backgroundColor: T.acentoSuave, borderWidth: 1, borderColor: T.acento + "66",
      borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
    },
    saldoTxt: { color: T.acento, fontSize: 12.5, fontWeight: "800", fontVariant: ["tabular-nums"] },
    campoLbl: {
      color: T.textoSuave, fontSize: 12, fontWeight: "800",
      letterSpacing: 0.6, marginBottom: 7,
    },
    tarjetaQr: {
      backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
      borderRadius: T.radioGrande, padding: 18, alignItems: "center",
    },
    saldoCaja: { alignItems: "center", paddingVertical: 18 },
    saldoVal: {
      color: T.texto, fontSize: 46, fontWeight: "900",
      letterSpacing: -1.5, fontVariant: ["tabular-nums"],
    },
    saldoLbl: { color: T.textoSuave, fontSize: 13, marginTop: 2 },
    visitaAyuda: {
      color: T.textoTenue, fontSize: 12, textAlign: "center",
      marginTop: 10, paddingHorizontal: 20,
    },
    contacto: {
      color: T.textoSuave, fontSize: 13.5, textAlign: "center", marginTop: 12,
    },
    reglaTxt: {
      color: T.textoTenue, fontSize: 12, textAlign: "center",
      marginTop: 6, paddingHorizontal: 20,
    },
    correoAviso: {
      color: T.peligro, fontSize: 12, marginBottom: 14, lineHeight: 17,
    },
    mov: {
      flexDirection: "row", alignItems: "center", gap: 10,
      backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
      borderRadius: T.radioChico + 2, padding: 11, marginBottom: 7,
    },
    movTipo: { color: T.texto, fontSize: 13.5, fontWeight: "800" },
    movMeta: { color: T.textoTenue, fontSize: 11.5, marginTop: 2 },
    movPuntos: { fontSize: 15, fontWeight: "900", fontVariant: ["tabular-nums"] },
  });
}
