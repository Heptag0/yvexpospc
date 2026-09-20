// YvexPOS Móvil — Panel de sincronización.
//
// Escrito para personas, no para técnicos: una frase clara del estado, una
// frase clara del resultado, y la tranquilidad de que nada se pierde. El
// diagnóstico detallado (cola, intentos, errores del servidor) sigue aquí,
// escondido en "Detalles técnicos" para cuando haga falta.
//
// También resuelve el momento delicado: la primera vez que este teléfono se
// vincula a un negocio que YA tiene catálogo, hay que decidir qué pasa con los
// productos locales. Aquí se lo preguntamos claro y con opciones.

import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  EstadoSync,
  estadoSync,
  sincronizar,
  hayCatalogoLocal,
  readaptarCatalogoSiCambioNegocio,
  contarArchivados,
  restaurarArchivados,
  resincronizarDesdeCero,
  inspeccionarCola,
  leerSyncAuto,
  guardarSyncAuto,
  detectarConflictosCatalogo,
  fusionarDepartamentosDuplicados,
  prepararTrasVincular,
  subirCatalogoLocal,
  ConflictoProducto,
} from "@/src/base/sync";
import ModalConflictosCatalogo from "@/src/componentes/ModalConflictosCatalogo";
import { fmtFecha } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, CabeceraModal } from "@/src/componentes/ui";

// "hoy 14:32" si fue hoy; si no, la fecha completa.
function fmtHoraLocal(iso: string): string {
  try {
    const d = new Date(iso);
    const hhmm = d.toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return d.toDateString() === new Date().toDateString()
      ? `hoy ${hhmm}`
      : fmtFecha(iso);
  } catch {
    return iso;
  }
}

// Errores en español llano, siempre con la tranquilidad de que no se perdió
// nada. Si huele a problema de red, lo decimos directo.
function mensajeErrorHumano(msg: string): string {
  const corto = (msg ?? "").trim();
  if (/fetch|network|timeout|timed?\s?out|conex|internet|socket|econn/i.test(corto)) {
    return "Parece que no hay internet. Todo está guardado aquí y subirá solo cuando vuelva la conexión.";
  }
  const detalle = corto.length > 140 ? corto.slice(0, 140) + "…" : corto;
  return (
    `No se pudo sincronizar: ${detalle || "error desconocido"}. ` +
    "No se perdió nada: se reintentará la próxima vez que sincronices."
  );
}

function cambios(n: number): string {
  return `${n} cambio${n === 1 ? "" : "s"}`;
}

export default function ModalSync({
  onCerrar,
  onCambio,
}: {
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const { tema: T } = useTema();
  const [estado, setEstado] = useState<EstadoSync | null>(null);
  const [locales, setLocales] = useState(0);
  const [archivados, setArchivados] = useState(0);
  const [trabajando, setTrabajando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [horaAviso, setHoraAviso] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [cola, setCola] = useState<any[]>([]);
  const [detalles, setDetalles] = useState(false);
  const [syncAuto, setSyncAuto] = useState(true);
  const [conflictos, setConflictos] = useState<ConflictoProducto[]>([]);
  const [conflictosAbiertos, setConflictosAbiertos] = useState(false);

  const cargar = useCallback(async () => {
    // ANTES DE CONTAR NADA: si el telefono cambio de negocio, los productos
    // que quedaron marcados como 'nube' del negocio anterior vuelven a ser
    // locales. Sin esto, hayCatalogoLocal() devuelve 0 y la tarjeta para
    // agregarlos al catalogo no aparece nunca — el catalogo se quedaba sin
    // subir en silencio. Ver readaptarCatalogoSiCambioNegocio() en sync.ts.
    //
    // Va aqui y no en la vinculacion porque es idempotente y no depende de
    // por que pantalla se haya vinculado: si el negocio no cambio, no hace
    // nada. Conviene llamarla tambien justo despues de vincular, para que la
    // tarjeta aparezca sin tener que entrar a esta pantalla.
    await readaptarCatalogoSiCambioNegocio();

    const [e, l, a, sa, c] = await Promise.all([
      estadoSync(),
      hayCatalogoLocal(),
      contarArchivados(),
      leerSyncAuto(),
      detectarConflictosCatalogo(),
    ]);
    setEstado(e);
    setLocales(l);
    setArchivados(a);
    setSyncAuto(sa);
    setConflictos(c);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function limpiarAvisos() {
    setError("");
    setAviso("");
    setHoraAviso(null);
  }

  async function sincronizarAhora() {
    limpiarAvisos();
    setTrabajando(true);
    try {
      const r = await sincronizar();
      if (r.ok) {
        let frase: string;
        if (r.subidas === 0 && r.bajados === 0) {
          frase = "Todo al día ✓ No había nada nuevo.";
        } else if (r.subidas > 0 && r.bajados === 0) {
          frase = `Listo ✓ Se respaldaron ${cambios(r.subidas)} en la nube.`;
        } else if (r.subidas === 0 && r.bajados > 0) {
          frase = `Listo ✓ Llegaron ${cambios(r.bajados)} del negocio.`;
        } else {
          frase =
            `Listo ✓ Se respaldaron ${cambios(r.subidas)} ` +
            `y llegaron ${cambios(r.bajados)} del negocio.`;
        }
        setAviso(frase);
        setHoraAviso(fmtHoraLocal(new Date().toISOString()));
        onCambio();
      } else {
        setError(mensajeErrorHumano(r.error ?? ""));
      }
      await cargar();
    } finally {
      setTrabajando(false);
    }
  }

  /** Sube lo que sobrevivió sin conflicto (o todo, si nunca hubo ninguno) —
   *  departamentos repetidos se fusionan solos primero, sin preguntar: un
   *  nombre igual no tiene datos que valga la pena decidir uno por uno. */
  async function fusionarLoQueNoChoca() {
    const nDeptos = await fusionarDepartamentosDuplicados();
    await prepararTrasVincular();
    // La subida del catálogo vive aparte desde que se cazó el bug de los
    // duplicados (ver sync.ts): solo se llama aquí, después de que
    // revisarCatalogo() confirmó que no quedan conflictos por decidir.
    await subirCatalogoLocal();
    const r = await sincronizar();
    const partes = [`Catálogo agregado al negocio.`];
    if (nDeptos > 0) {
      partes.push(`${nDeptos} departamento${nDeptos === 1 ? "" : "s"} repetido${nDeptos === 1 ? "" : "s"} se combinó solo.`);
    }
    if (r.bajados > 0) partes.push(`Llegaron ${cambios(r.bajados)} más del negocio.`);
    setAviso(partes.join(" "));
    onCambio();
    await cargar();
  }

  async function revisarCatalogo() {
    limpiarAvisos();
    setTrabajando(true);
    try {
      // Se vuelve a comprobar aquí (no solo lo que ya trae cargar()) por si
      // algo cambió desde que se abrió esta pantalla — el usuario pudo
      // sincronizar manualmente justo antes de tocar este botón.
      const detectados = await detectarConflictosCatalogo();
      if (detectados.length > 0) {
        setConflictos(detectados);
        setConflictosAbiertos(true);
      } else {
        await fusionarLoQueNoChoca();
      }
    } catch (e: any) {
      setError(mensajeErrorHumano(e?.message ?? String(e)));
    } finally {
      setTrabajando(false);
    }
  }

  async function alResolverTodosLosConflictos() {
    setConflictosAbiertos(false);
    setTrabajando(true);
    try {
      // Lo que quedó sin conflicto (nunca chocó con nada) también se sube
      // en este mismo paso — el dueño no tiene que volver a tocar nada.
      await fusionarLoQueNoChoca();
    } catch (e: any) {
      setError(mensajeErrorHumano(e?.message ?? String(e)));
    } finally {
      setTrabajando(false);
    }
  }

  async function alternarDetalles() {
    if (!detalles) setCola(await inspeccionarCola());
    setDetalles((v) => !v);
  }

  async function cambiarSyncAuto(v: boolean) {
    setSyncAuto(v);
    await guardarSyncAuto(v);
  }

  if (!estado) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={[e.raiz, { backgroundColor: T.fondo }]}>
        <CabeceraModal titulo="Sincronización" izquierda="Cerrar" onIzquierda={onCerrar} />

        <ScrollView contentContainerStyle={{ padding: T.esp, paddingBottom: 50 }}>
          <Banner texto={error} tipo="error" />

          {aviso ? (
            <View
              style={[e.caja, { backgroundColor: T.exitoSuave, borderColor: T.exito }]}
            >
              <Text style={[e.titulo, { color: T.texto }]}>{aviso}</Text>
              {horaAviso && (
                <Text style={{ color: T.textoTenue, fontSize: 12, marginTop: 2 }}>
                  Última sincronización: {horaAviso}
                </Text>
              )}
            </View>
          ) : null}

          {!estado.vinculado ? (
            <View
              style={[e.caja, { backgroundColor: T.superficie, borderColor: T.borde }]}
            >
              <Text style={[e.titulo, { color: T.texto }]}>Sin cuenta vinculada</Text>
              <Text style={[e.txt, { color: T.textoSuave }]}>
                Vincula una cuenta en Ajustes para sincronizar tus ventas con la
                nube y ver el inventario compartido con tus otras cajas.
              </Text>
            </View>
          ) : (
            <>
              {/* Estado actual, en una línea clara */}
              <View
                style={[
                  e.caja,
                  {
                    backgroundColor:
                      estado.pendientes > 0 ? T.alertaSuave : T.exitoSuave,
                    borderColor: estado.pendientes > 0 ? T.alerta : T.exito,
                  },
                ]}
              >
                <Text style={[e.titulo, { color: T.texto }]}>
                  {estado.pendientes > 0 ? "Hay cambios sin subir" : "Todo al día ✓"}
                </Text>
                <Text style={[e.txt, { color: T.textoSuave }]}>
                  {estado.pendientes > 0
                    ? "Todo está guardado en este teléfono y subirá en cuanto sincronices. No se pierde nada."
                    : "Los datos de este teléfono están respaldados en la nube."}
                </Text>
                {estado.ultimaSync && (
                  <Text style={[e.pie, { color: T.textoTenue }]}>
                    Última sincronización: {fmtHoraLocal(estado.ultimaSync)}
                  </Text>
                )}
              </View>

              {estado.error ? (
                <View
                  style={[
                    e.caja,
                    { backgroundColor: T.peligroSuave, borderColor: T.peligro },
                  ]}
                >
                  <Text style={[e.titulo, { color: T.peligroTexto }]}>
                    La última vez no se pudo
                  </Text>
                  <Text style={[e.txt, { color: T.textoSuave }]}>
                    {mensajeErrorHumano(estado.error)}
                  </Text>
                </View>
              ) : null}

              {/* ---------------------------------------------------------
                  ORDEN: ACCIÓN PRIMERO, AJUSTE DESPUÉS, REPARACIÓN AL FINAL
                  ---------------------------------------------------------
                  Antes esto iba: interruptor → dos botones pegados → una nota
                  suelta debajo de los dos que en realidad solo hablaba del
                  segundo. Tres problemas de una vez:

                   · Quien abre esta pantalla casi siempre viene a tocar
                     "Sincronizar ahora". Estaba en tercer lugar, después de
                     un ajuste y de dos párrafos.
                   · "Volver a bajar todo" —que rehace el catálogo entero—
                     tenía el mismo peso visual que la copia de seguridad de
                     todos los días, y su explicación quedaba a dos botones de
                     distancia.
                   · La nota "el botón siempre funciona" existía porque el
                     botón estaba lejos del interruptor. Con el botón arriba
                     ya no hace falta explicarlo.
                  --------------------------------------------------------- */}
              <View style={{ marginTop: 6 }}>
                <Boton
                  titulo="Sincronizar ahora"
                  onPress={sincronizarAhora}
                  cargando={trabajando}
                />
              </View>

              {/* El ajuste, después de la acción: se toca una vez y no se
                  vuelve a mirar. */}
              <View
                style={[
                  e.caja,
                  { backgroundColor: T.superficie, borderColor: T.borde, marginTop: 14 },
                ]}
              >
                <View style={e.filaSwitch}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={[e.titulo, { color: T.texto }]}>
                      Sincronización automática
                    </Text>
                    <Text style={[e.txt, { color: T.textoSuave }]}>
                      {syncAuto
                        ? "Prendida: la app respalda sola tras cada venta."
                        : "Apagada: tus datos solo suben cuando tú lo pides."}
                    </Text>
                  </View>
                  <Switch
                    value={syncAuto}
                    onValueChange={cambiarSyncAuto}
                    trackColor={{ false: T.borde, true: T.exito }}
                    thumbColor={T.texto}
                  />
                </View>
                {/* El recuento de pendientes solo aquí, y solo cuando el
                    automático está apagado: con él prendido la tarjeta de
                    arriba ya lo dice, y repetirlo era decir dos veces lo
                    mismo con distintas palabras. */}
                {!syncAuto && estado.pendientes > 0 && (
                  <Text style={[e.pie, { color: T.alerta, fontWeight: "700" }]}>
                    {estado.pendientes} cambio
                    {estado.pendientes === 1 ? "" : "s"} esperando a que toques
                    "Sincronizar ahora".
                  </Text>
                )}
              </View>

              {/* La reparación, aparte y al final. No es una acción de
                  todos los días y no debe parecerlo: su explicación va ANTES
                  del botón, que es donde se lee. */}
              <View
                style={[
                  e.caja,
                  { backgroundColor: T.superficie, borderColor: T.borde, marginTop: 14 },
                ]}
              >
                <Text style={[e.titulo, { color: T.texto }]}>
                  ¿Algo se descuadró?
                </Text>
                <Text style={[e.txt, { color: T.textoSuave }]}>
                  Pide de nuevo el catálogo completo del negocio. Tus ventas de
                  este teléfono no se tocan.
                </Text>
                <View style={{ marginTop: 10 }}>
                  <Boton
                    titulo="Volver a bajar todo"
                    tipo="secundario"
                    onPress={async () => {
                      limpiarAvisos();
                      setTrabajando(true);
                      try {
                        const r = await resincronizarDesdeCero();
                        if (r.ok) {
                          setAviso(
                            r.bajados > 0
                              ? `Listo ✓ Llegó el catálogo completo del negocio (${cambios(r.bajados)}).`
                              : "El negocio no tiene datos que bajar."
                          );
                          onCambio();
                        } else {
                          setError(mensajeErrorHumano(r.error ?? ""));
                        }
                        await cargar();
                      } finally {
                        setTrabajando(false);
                      }
                    }}
                  />
                </View>
              </View>

              {/* Catálogo de este teléfono */}
              {locales > 0 && (
                <View
                  style={[
                    e.caja,
                    {
                      backgroundColor: T.superficie,
                      borderColor: conflictos.length > 0 ? T.alerta : T.bordeFuerte,
                      marginTop: 22,
                    },
                  ]}
                >
                  <Text style={[e.titulo, { color: T.texto }]}>
                    {conflictos.length > 0
                      ? `${conflictos.length} producto${conflictos.length === 1 ? "" : "s"} coincide${conflictos.length === 1 ? "" : "n"} con el negocio`
                      : "Catálogo de este teléfono"}
                  </Text>
                  <Text style={[e.txt, { color: T.textoSuave }]}>
                    {conflictos.length > 0 ? (
                      "Tienes productos que parecen ser los mismos que ya existen en el negocio " +
                      "(mismo código de barras o nombre). Elige cuál versión de cada uno se queda " +
                      "antes de que el resto de tu catálogo se agregue solo."
                    ) : (
                      <>
                        Tienes {locales} producto{locales === 1 ? "" : "s"} creado
                        {locales === 1 ? "" : "s"} en este teléfono, y ninguno coincide con lo que
                        ya tiene el negocio.
                        {"\n\n"}
                        Se pueden agregar tal cual a tu catálogo compartido — nada que decidir,
                        nada que perder.
                      </>
                    )}
                  </Text>
                  <View style={{ marginTop: 14 }}>
                    <Boton
                      titulo={
                        conflictos.length > 0
                          ? "Revisar y decidir"
                          : "Agregar al catálogo del negocio"
                      }
                      tipo="secundario"
                      onPress={revisarCatalogo}
                      cargando={trabajando}
                    />
                  </View>
                </View>
              )}

              {archivados > 0 && (
                <View
                  style={[
                    e.caja,
                    { backgroundColor: T.superficie, borderColor: T.bordeFuerte, marginTop: 20 },
                  ]}
                >
                  <Text style={[e.titulo, { color: T.texto }]}>
                    {archivados} producto{archivados === 1 ? "" : "s"} archivado
                    {archivados === 1 ? "" : "s"}
                  </Text>
                  <Text style={[e.txt, { color: T.textoSuave }]}>
                    Están guardados y puedes devolverlos al inventario cuando
                    quieras. Archivar nunca borra nada.
                  </Text>
                  <View style={{ marginTop: 14 }}>
                    <Boton
                      titulo="Restaurar al inventario"
                      tipo="secundario"
                      onPress={async () => {
                        setTrabajando(true);
                        limpiarAvisos();
                        try {
                          const r = await restaurarArchivados();
                          const partes: string[] = [];
                          partes.push(
                            r.restaurados === 1
                              ? "1 producto devuelto al inventario."
                              : `${r.restaurados} productos devueltos al inventario.`
                          );
                          // Los omitidos NO son un error: se quedan
                          // archivados porque el negocio ya tiene ese mismo
                          // producto. Restaurarlos dejaría dos artículos con
                          // el mismo código y el lector no sabría cuál es.
                          if (r.omitidos > 0) {
                            partes.push(
                              r.omitidos === 1
                                ? "1 se quedó archivado porque el negocio ya tiene ese mismo producto: restaurarlo dejaría dos con el mismo código. Si quieres tus datos, edita el del negocio desde Inventario."
                                : `${r.omitidos} se quedaron archivados porque el negocio ya tiene esos mismos productos: restaurarlos dejaría dos con el mismo código. Si quieres tus datos, edítalos desde Inventario.`
                            );
                          }
                          setAviso(partes.join(" "));
                          onCambio();
                          await cargar();
                        } catch (err: any) {
                          setError(mensajeErrorHumano(err?.message ?? String(err)));
                        } finally {
                          setTrabajando(false);
                        }
                      }}
                    />
                  </View>
                </View>
              )}

              <View
                style={[
                  e.caja,
                  { backgroundColor: T.superficie, borderColor: T.borde, marginTop: 22 },
                ]}
              >
                <Text style={[e.titulo, { color: T.texto }]}>Cómo funciona</Text>
                <Text style={[e.txt, { color: T.textoSuave }]}>
                  Cada venta se guarda al instante en este teléfono, con o sin
                  internet. Cuando hay conexión, se sube sola a la nube.
                  {"\n\n"}
                  Al sincronizar también recibes lo que cambió en tus otras cajas:
                  productos nuevos, precios, y el stock actualizado.
                </Text>
              </View>

              {/* Diagnóstico, escondido por defecto */}
              <Pressable
                onPress={alternarDetalles}
                style={({ pressed }) => [
                  e.detallesToggle,
                  { borderColor: T.borde },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={{ color: T.textoSuave, fontSize: 13, fontWeight: "700" }}>
                  Detalles técnicos
                </Text>
                <Text style={{ color: T.textoTenue, fontSize: 13 }}>
                  {detalles ? "▾" : "▸"}
                </Text>
              </Pressable>

              {detalles && (
                <View
                  style={[
                    e.caja,
                    { backgroundColor: T.superficie, borderColor: T.borde, marginTop: 8 },
                  ]}
                >
                  <Text style={[e.txt, { color: T.textoSuave, marginBottom: 10 }]}>
                    Operaciones esperando subir a la nube. Si algo falla, aquí
                    aparece qué fue y cuántas veces se ha intentado.
                  </Text>
                  {cola.length === 0 ? (
                    <Text style={[e.txt, { color: T.textoSuave }]}>
                      La cola está vacía (0 filas reales).
                    </Text>
                  ) : (
                    cola.map((c, i) => (
                      <View key={i} style={{ marginBottom: 10 }}>
                        <Text style={{ color: T.texto, fontSize: 13, fontWeight: "700" }}>
                          {c.entidad} · {c.entidad_id.slice(0, 8)}… · intentos: {c.intentos}
                        </Text>
                        {c.ultimo_error && (
                          <Text style={{ color: T.peligroTexto, fontSize: 11.5, marginTop: 2 }}>
                            {c.ultimo_error}
                          </Text>
                        )}
                      </View>
                    ))
                  )}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
      {conflictosAbiertos && (
        <ModalConflictosCatalogo
          conflictos={conflictos}
          onResuelto={alResolverTodosLosConflictos}
          onCerrar={() => setConflictosAbiertos(false)}
        />
      )}
    </Modal>
  );
}

const e = StyleSheet.create({
  raiz: { flex: 1 },
  caja: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14 },
  titulo: { fontSize: 16, fontWeight: "800", marginBottom: 6 },
  txt: { fontSize: 13.5, lineHeight: 20 },
  pie: { fontSize: 12, marginTop: 10 },
  filaSwitch: { flexDirection: "row", alignItems: "center" },
  detallesToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 18,
    paddingTop: 14,
    paddingBottom: 4,
    paddingHorizontal: 2,
  },
});
