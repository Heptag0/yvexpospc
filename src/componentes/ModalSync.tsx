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
  Alert,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  EstadoSync,
  estadoSync,
  sincronizar,
  hayCatalogoLocal,
  archivarCatalogoLocal,
  contarArchivados,
  restaurarArchivados,
  resincronizarDesdeCero,
  inspeccionarCola,
  leerSyncAuto,
  guardarSyncAuto,
} from "@/src/base/sync";
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

  const cargar = useCallback(async () => {
    const [e, l, a, sa] = await Promise.all([
      estadoSync(),
      hayCatalogoLocal(),
      contarArchivados(),
      leerSyncAuto(),
    ]);
    setEstado(e);
    setLocales(l);
    setArchivados(a);
    setSyncAuto(sa);
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

  function preguntarAdopcion() {
    Alert.alert(
      "Adoptar el catálogo del negocio",
      `Este teléfono tiene ${locales} producto${locales === 1 ? "" : "s"} propio${
        locales === 1 ? "" : "s"
      }.\n\n` +
        "Al adoptar el catálogo del negocio, esos productos se ARCHIVAN " +
        "(no se borran: quedan guardados) y el teléfono usará el catálogo " +
        "compartido con tus otras cajas.\n\n" +
        "Es lo recomendado si vas a usar este teléfono junto con tu computadora.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Adoptar catálogo",
          onPress: async () => {
            setTrabajando(true);
            limpiarAvisos();
            try {
              const n = await archivarCatalogoLocal("adopcion_catalogo_negocio");
              const r = await sincronizar();
              setAviso(
                `${n} productos archivados. ${
                  r.bajados > 0
                    ? `Llegaron ${cambios(r.bajados)} del negocio.`
                    : ""
                }`
              );
              onCambio();
              await cargar();
            } catch (e: any) {
              setError(mensajeErrorHumano(e?.message ?? String(e)));
            } finally {
              setTrabajando(false);
            }
          },
        },
      ]
    );
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

              {/* Sincronización automática: decisión del usuario */}
              <View
                style={[
                  e.caja,
                  { backgroundColor: T.superficie, borderColor: T.borde },
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
                        : "Apagada: tus datos solo suben cuando tú pides la copia."}
                    </Text>
                  </View>
                  <Switch
                    value={syncAuto}
                    onValueChange={cambiarSyncAuto}
                    trackColor={{ false: T.borde, true: T.exito }}
                    thumbColor={T.texto}
                  />
                </View>
                <Text style={[e.pie, { color: T.textoTenue }]}>
                  El botón "Sincronizar ahora" siempre funciona, esté prendida o
                  apagada: es tu copia de seguridad, y tú decides cuándo hacerla.
                </Text>
                {!syncAuto && estado.pendientes > 0 && (
                  <Text
                    style={[e.pie, { color: T.alerta, fontWeight: "700" }]}
                  >
                    Tienes {estado.pendientes} cambio
                    {estado.pendientes === 1 ? "" : "s"} guardado
                    {estado.pendientes === 1 ? "" : "s"} en este teléfono. Cuando
                    quieras respaldarlo{estado.pendientes === 1 ? "" : "s"},
                    toca "Sincronizar ahora".
                  </Text>
                )}
              </View>

              <View style={{ marginTop: 6, gap: 9 }}>
                <Boton
                  titulo="Sincronizar ahora"
                  onPress={sincronizarAhora}
                  cargando={trabajando}
                />
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
              <Text style={[e.pie, { color: T.textoTenue, marginTop: -4 }]}>
                "Volver a bajar todo" pide de nuevo el catálogo completo del
                negocio. Útil si algo se descuadró.
              </Text>

              {/* Adopción del catálogo */}
              {locales > 0 && (
                <View
                  style={[
                    e.caja,
                    {
                      backgroundColor: T.superficie,
                      borderColor: T.bordeFuerte,
                      marginTop: 22,
                    },
                  ]}
                >
                  <Text style={[e.titulo, { color: T.texto }]}>
                    Catálogo de este teléfono
                  </Text>
                  <Text style={[e.txt, { color: T.textoSuave }]}>
                    Tienes {locales} producto{locales === 1 ? "" : "s"} creado
                    {locales === 1 ? "" : "s"} en este teléfono.
                    {"\n\n"}
                    Si también usas YvexPOS en tu computadora, lo recomendable es
                    adoptar el catálogo del negocio: así ambos ven el mismo
                    inventario y el mismo stock.
                  </Text>
                  <View style={{ marginTop: 14 }}>
                    <Boton
                      titulo="Adoptar el catálogo del negocio"
                      tipo="secundario"
                      onPress={preguntarAdopcion}
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
                          const n = await restaurarArchivados();
                          setAviso(`${n} productos devueltos al inventario.`);
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
