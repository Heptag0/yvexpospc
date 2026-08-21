// YvexPOS Móvil — Modal de CLIENTES Y LEALTAD (gestión).
//
// Lista con buscador + saldo de puntos, alta rápida (nombre + teléfono
// opcional) y detalle por cliente: tarjeta QR, saldo grande, "Registrar
// visita" (máx. 1 al día), historial de movimientos y edición/borrado suave.
//
// ---------------------------------------------------------------------------
// QUÉ CAMBIÓ EN ESTA MIGRACIÓN
// ---------------------------------------------------------------------------
// 1. NO se migró a <Hoja>. Este modal tiene 4 sub-vistas (lista/nuevo/
//    detalle/editar) con un header que cambia de título y de botones según
//    dónde estás — <Hoja> solo admite un header fijo. Forzarlo habría sido
//    peor que no usarlo: se mantiene <CabeceraModal> directo (ya construido
//    con tokens correctos) y se cambian sus props según `vista`, igual que
//    hacía el original.
// 2. Por lo mismo, esta pantalla SÍ necesitaba su propio BackHandler — el
//    mismo arreglo que se hizo en Vender para el drill-down de
//    departamentos. Sin él, el botón Atrás de Android cerraba todo el
//    modal desde "detalle" o "editar" en vez de retroceder un nivel.
// 3. Alert.alert (quitar cliente) -> una <Hoja> chica anidada, igual que en
//    ModalDepartamentos y FormularioProducto.
// 4. El saldo de puntos en el detalle pasa a <Lamina> — es la cifra
//    protagonista de esa pantalla (la razón por la que el cajero abrió la
//    tarjeta del cliente), con el mismo tratamiento "con luz" que ya usan
//    Inicio e Inventario para SU métrica principal.
// 5. La lista de clientes pasa a <Fila>, con <Monto> para el saldo — antes
//    era un estilo de fila y un chip propios, ahora el mismo lenguaje que
//    el resto de listas de la app.

import { useCallback, useEffect, useState } from "react";
import {
  View,
  TextInput,
  Modal,
  FlatList,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Share,
  BackHandler,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, CabeceraModal, Hoja, Grupo, Fila, Lamina, Txt, Monto, Vacio, useEstiloInput } from "@/src/componentes/ui";
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

type Vista = "lista" | "nuevo" | "detalle" | "editar";

export default function ModalLealtad({
  onCerrar,
  onCambio,
}: {
  onCerrar: () => void;
  onCambio?: () => void;
}) {
  const { tema: T } = useTema();
  const estiloInput = useEstiloInput();

  const [vista, setVista] = useState<Vista>("lista");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [seleccionado, setSeleccionado] = useState<Cliente | null>(null);
  const [historial, setHistorial] = useState<MovimientoPuntos[]>([]);
  const [reglas, setReglas] = useState<ReglasLealtad | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; tipo: "exito" | "info" } | null>(null);
  const [error, setError] = useState("");
  const [confirmandoQuitar, setConfirmandoQuitar] = useState(false);

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

  // Atrás del sistema: retrocede un nivel del drill-down en vez de cerrar
  // todo el modal. En "lista" no hace falta nada — el <Modal> ya cierra
  // solo vía onRequestClose={onCerrar}.
  useEffect(() => {
    const alPresionarAtras = () => {
      if (vista === "editar") {
        setVista("detalle");
        return true;
      }
      if (vista === "detalle") {
        setSeleccionado(null);
        setVista("lista");
        return true;
      }
      if (vista === "nuevo") {
        setVista("lista");
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", alPresionarAtras);
    return () => sub.remove();
  }, [vista]);

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

  async function confirmarEliminar() {
    if (!seleccionado) return;
    await eliminarCliente(seleccionado.id);
    await cargar();
    onCambio?.();
    setConfirmandoQuitar(false);
    setSeleccionado(null);
    setVista("lista");
  }

  const etiquetaTipo = (t: MovimientoPuntos["tipo"]) =>
    t === "compra" ? "Compra" : t === "visita" ? "Visita" : t === "canje" ? "Canje" : "Ajuste";

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={{ flex: 1, backgroundColor: T.fondo }}>
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
              <View style={{ paddingHorizontal: T.esp, paddingVertical: T.esps.sm }}>
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
                contentContainerStyle={{ paddingHorizontal: T.esp, paddingBottom: T.esps.xl }}
                ListEmptyComponent={
                  <Vacio
                    titulo={busqueda ? "Sin resultados" : "Aún no tienes clientes"}
                    texto={
                      busqueda
                        ? "¿Lo damos de alta con «+ Nuevo»?"
                        : "Toca «+ Nuevo» para registrar al primero: gana puntos en cada compra y en cada visita."
                    }
                  />
                }
                renderItem={({ item, index }) => (
                  <View style={{ marginBottom: index === clientes.length - 1 ? 0 : T.esps.sm }}>
                    <Grupo>
                      <Fila
                        titulo={item.nombre}
                        meta={`${item.codigo}${item.telefono ? ` · ${item.telefono}` : ""}`}
                        icono={
                          <View
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: T.radioChico,
                              backgroundColor: T.acentoSuave,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Txt escala="cuerpo" tono="acento" fuerte>
                              {item.nombre.trim()[0]?.toUpperCase() ?? "?"}
                            </Txt>
                          </View>
                        }
                        onPress={() => abrirDetalle(item)}
                        valor={<Monto texto={`${item.puntos} pts`} escala="pie" tono="acento" />}
                      />
                    </Grupo>
                  </View>
                )}
              />
            </>
          )}

          {/* ---------------- ALTA / EDICIÓN ---------------- */}
          {(vista === "nuevo" || vista === "editar") && (
            <ScrollView contentContainerStyle={{ padding: T.esp }} keyboardShouldPersistTaps="handled">
              <Banner texto={error} tipo="error" />
              <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.xs }}>
                Nombre
              </Txt>
              <TextInput
                style={[estiloInput, { marginBottom: T.esps.lg }]}
                value={nombre}
                onChangeText={setNombre}
                placeholder="Ej. Doña Mari"
                placeholderTextColor={T.textoTenue}
                autoCapitalize="words"
                autoFocus={vista === "nuevo"}
              />
              <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.xs }}>
                Teléfono (opcional)
              </Txt>
              <TextInput
                style={[estiloInput, { marginBottom: T.esps.lg }]}
                value={telefono}
                onChangeText={setTelefono}
                placeholder="Para identificarlo sin QR"
                placeholderTextColor={T.textoTenue}
                keyboardType="phone-pad"
              />
              <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.xs }}>
                Correo (opcional)
              </Txt>
              <TextInput
                style={[
                  estiloInput,
                  { marginBottom: correo.trim() !== "" && !correoValido(correo) ? T.esps.xs : T.esps.lg },
                  correo.trim() !== "" && !correoValido(correo) && { borderColor: T.peligro },
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
                <Txt escala="pie" tono="peligro" estilo={{ marginBottom: T.esps.lg }}>
                  Ese correo no parece válido; puedes guardar sin correo y corregirlo después.
                </Txt>
              )}
              {vista === "editar" && (
                <>
                  <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.xs }}>
                    Notas (opcional)
                  </Txt>
                  <TextInput
                    style={[estiloInput, { marginBottom: T.esps.lg }]}
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
                <View style={{ marginTop: T.esps.md }}>
                  <Boton titulo="Quitar cliente" tipo="peligro" onPress={() => setConfirmandoQuitar(true)} />
                </View>
              )}
            </ScrollView>
          )}

          {/* ---------------- DETALLE ---------------- */}
          {vista === "detalle" && seleccionado && (
            <ScrollView contentContainerStyle={{ padding: T.esp, paddingBottom: T.esps.xxl }}>
              {aviso && <Banner texto={aviso.texto} tipo={aviso.tipo} />}

              {/* Tarjeta QR */}
              <View
                style={{
                  backgroundColor: T.superficie,
                  borderWidth: 1,
                  borderColor: T.borde,
                  borderRadius: T.radioGrande,
                  padding: T.esps.lg,
                  alignItems: "center",
                }}
              >
                <CodigoCliente codigo={seleccionado.codigo} size={190} />
              </View>

              {/* Contacto (si existe): servirá después para promociones */}
              {(seleccionado.telefono || seleccionado.correo) && (
                <Txt escala="pie" tono="suave" estilo={{ textAlign: "center", marginTop: T.esps.md }}>
                  {[seleccionado.telefono, seleccionado.correo].filter(Boolean).join(" · ")}
                </Txt>
              )}

              <View style={{ marginTop: T.esps.md }}>
                <Boton titulo="Compartir código" tipo="secundario" onPress={compartirCliente} />
              </View>

              {/* Saldo — la cifra protagonista de esta pantalla: es la razón
                  por la que el cajero abrió la tarjeta del cliente. */}
              <View style={{ marginTop: T.esps.xl, marginBottom: T.esps.lg }}>
                <Lamina>
                  <Txt escala="micro" tono="suave" fuerte mayus>
                    Saldo de puntos
                  </Txt>
                  <View style={{ marginTop: T.esps.xs }}>
                    <Monto texto={String(seleccionado.puntos)} escala="protagonista" />
                  </View>
                  <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.xs }}>
                    valen {pesos(seleccionado.puntos * (reglas?.valorPuntoCentavos ?? 0))} al canjear
                  </Txt>
                  {reglas && reglas.activa ? (
                    <Txt escala="micro" tono="tenue" estilo={{ marginTop: T.esps.sm }}>
                      Gana 1 punto por cada {pesos(reglas.pesosPorPunto * 100)} · 1 punto ={" "}
                      {pesos(reglas.valorPuntoCentavos)} al canjear
                    </Txt>
                  ) : null}
                </Lamina>
              </View>

              <Boton
                titulo={`Registrar visita (+${reglas?.puntosVisita ?? 0} pts)`}
                onPress={alRegistrarVisita}
              />
              <Txt escala="pie" tono="tenue" estilo={{ textAlign: "center", marginTop: T.esps.sm }}>
                Un regalito por pasar a saludar: una vez al día por cliente.
              </Txt>

              {/* Historial */}
              <View style={{ marginTop: T.esps.xl }}>
                <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.sm }}>
                  Historial de puntos
                </Txt>
                {historial.length === 0 ? (
                  <Txt escala="pie" tono="tenue">
                    Sin movimientos todavía. Aquí aparecerán sus compras, visitas y canjes.
                  </Txt>
                ) : (
                  <Grupo>
                    {historial.map((m) => (
                      <Fila
                        key={m.id}
                        titulo={etiquetaTipo(m.tipo)}
                        meta={`${fmtFecha(m.creado_en)}${m.nota ? ` · ${m.nota}` : ""}`}
                        flecha={false}
                        valor={
                          <Monto
                            texto={m.puntos >= 0 ? `+${m.puntos}` : String(m.puntos)}
                            escala="pie"
                            tono={m.puntos >= 0 ? "exito" : "peligro"}
                          />
                        }
                      />
                    ))}
                  </Grupo>
                )}
              </View>
            </ScrollView>
          )}
        </KeyboardAvoidingView>

        {/* Confirmación de quitar cliente: hoja chica, sin Alert nativo. */}
        <Hoja
          visible={confirmandoQuitar}
          onCerrar={() => setConfirmandoQuitar(false)}
          titulo="Quitar cliente"
          pie={
            <View style={{ gap: T.esps.sm }}>
              <Boton titulo="Quitar" tipo="peligro" onPress={confirmarEliminar} />
              <Boton titulo="Cancelar" tipo="secundario" onPress={() => setConfirmandoQuitar(false)} />
            </View>
          }
        >
          <Txt escala="pie" tono="suave">
            {seleccionado
              ? `${seleccionado.nombre} dejará de aparecer en tu lista, pero su historial se conserva.`
              : ""}
          </Txt>
        </Hoja>
      </SafeAreaView>
    </Modal>
  );
}