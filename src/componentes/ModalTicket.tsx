// YvexPOS Móvil — Modal del ticket de venta.
//
// La confirmación de cobro con cara de recibo profesional: tarjeta clara con
// borde dentado arriba y abajo (triángulos SVG propios), encabezado con el
// negocio, folio y fecha, tabla de ítems, totales a la derecha y un cierre
// cálido. Botones: "Compartir" (Share nativo con el recibo en texto plano)
// y "Listo".
//
// ---------------------------------------------------------------------------
// POR QUÉ ESTE ARCHIVO CONSERVA SU DISEÑO PROPIO
// ---------------------------------------------------------------------------
// Esta pantalla es EL momento pico de una venta — el pago acaba de
// confirmarse, es el "recibo en la mano" del cajero. Forzarla dentro de la
// cáscara genérica de <Hoja> la habría vuelto una lista más entre las
// muchas de la app, y es justo lo contrario de lo que este instante merece.
// El recibo dentado se queda: es la firma visual correcta AQUÍ.
//
// Lo que SÍ se corrigió:
//   1. T.turquesa (color de "Descuento" y "Cambio") -> T.exito. Son cifras
//      buenas para el cliente — el verde de éxito de la marca, no un
//      segundo acento que nadie eligió.
//   2. Los montos ahora usan Plex Mono (T.fuente.numFuerte) con la misma
//      regla que rige el resto de la app: todo número de dinero pasa por la
//      fuente tabular, sin excepción — antes solo tenían
//      `fontVariant:["tabular-nums"]` sin la familia tipográfica real.

import { useMemo } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  Share,
  useWindowDimensions,
  StyleSheet,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Svg, { Polygon } from "react-native-svg";
import { TicketVenta, textoRecibo } from "@/src/base/ticket";
import { etiquetaFolio } from "@/src/base/venta";
import type { MetodoPago } from "@/src/base/venta";
import { pesos } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import { IconoUI } from "@/src/componentes/iconos";

const NOMBRE_METODO: Record<MetodoPago, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  credito: "Crédito",
};

type Tema = ReturnType<typeof useTema>["tema"];

/** 31/08/26 19:13 — con AÑO. Un recibo que solo dice "31 ago" no sirve para
 *  buscar una venta meses después, que es justo cuando alguien saca un ticket
 *  viejo del cajón. */
function fechaConAnio(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${p(d.getFullYear() % 100)}  ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const DIENTE = 9; // ancho de cada triángulo del borde dentado

/** Fila de triángulos SVG que simula el corte dentado del recibo.
 *
 *  El número de dientes se calcula del ancho REAL de la tarjeta, no de una
 *  constante fija. Antes eran 40 dientes × 9px = 360px fijos dentro de una
 *  tarjeta de 340: el SVG sobresalía por la derecha y, en pantallas
 *  estrechas, arrastraba el recibo fuera del área visible — por eso los
 *  importes de la derecha aparecían cortados en la previsualización. */
function BordeDentado({
  color,
  arriba,
  ancho,
}: {
  color: string;
  arriba?: boolean;
  ancho: number;
}) {
  const columnas = Math.max(1, Math.ceil(ancho / DIENTE));
  const puntas = useMemo(() => {
    const arr: string[] = [];
    for (let i = 0; i < columnas; i++) {
      const x = i * DIENTE;
      // Triángulo isósceles: arriba apunta hacia arriba, abajo hacia abajo.
      arr.push(
        arriba
          ? `${x},${DIENTE} ${x + DIENTE},${DIENTE} ${x + DIENTE / 2},0`
          : `${x},0 ${x + DIENTE},0 ${x + DIENTE / 2},${DIENTE}`
      );
    }
    return arr;
  }, [arriba, columnas]);
  return (
    <View style={{ overflow: "hidden", width: ancho }}>
      <Svg width={columnas * DIENTE} height={DIENTE}>
        {puntas.map((p, i) => (
          <Polygon key={i} points={p} fill={color} />
        ))}
      </Svg>
    </View>
  );
}

export default function ModalTicket({
  ticket,
  onCerrar,
}: {
  ticket: TicketVenta;
  onCerrar: () => void;
}) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const papel = T.esClaro ? "#ffffff" : T.superficie2;
  // Ancho REAL de la tarjeta: nunca más que la pantalla menos el margen
  // del fondo (22 por lado). Con esto el recibo cabe siempre, y el borde
  // dentado se dibuja exactamente de ese ancho.
  const { width: anchoPantalla } = useWindowDimensions();
  const anchoTicket = Math.min(340, Math.max(240, anchoPantalla - 44));

  async function compartir() {
    try {
      await Share.share({ message: textoRecibo(ticket) });
    } catch {
      // El usuario canceló el diálogo: no es error.
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCerrar}>
      <View style={est.fondo}>
        <View style={[est.zonaTicket, { maxWidth: anchoTicket }]}>
          {/* Palomita de confirmación */}
          <View style={est.ok}>
            <Text style={est.okTxt}>✓</Text>
          </View>
          <Text style={est.okTitulo}>Venta cobrada</Text>

          <ScrollView
            style={{ maxHeight: 420 }}
            showsVerticalScrollIndicator={false}
          >
            {/* El recibo */}
            <View style={est.recibo}>
              <BordeDentado color={papel} arriba ancho={anchoTicket} />
              <View style={[est.papel, { backgroundColor: papel }]}>
                <Text style={est.negocio}>{ticket.nombre_negocio}</Text>

                {/* Folio y fecha en extremos, como un recibo de verdad — antes
                    iban centrados en una sola línea, que es lo que hacía que
                    esto pareciera una nota y no un ticket. */}
                <View style={est.cabFila}>
                  <Text style={est.cabFolio}>
                    Ticket {etiquetaFolio(ticket.folio, ticket.folio_prefijo, true)}
                  </Text>
                  <Text style={est.cabFecha}>{fechaConAnio(ticket.fecha_iso)}</Text>
                </View>
                {ticket.atendio ? (
                  <Text style={est.cabAtendio}>Atendió: {ticket.atendio}</Text>
                ) : null}

                <View style={est.sep} />

                {ticket.lineas.map((l, i) => (
                  <View key={i} style={est.linea}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={est.lineaNombre} numberOfLines={2}>
                        {l.nombre}
                      </Text>
                      <Text style={est.lineaMeta}>
                        {l.cantidad} × {pesos(l.precio_unitario_centavos)}
                      </Text>
                    </View>
                    <Text style={est.lineaImporte}>{pesos(l.importe_centavos)}</Text>
                  </View>
                ))}

                <View style={est.sep} />

                {/* "Subtotal" solo cuando hay un descuento que explicar: sin
                    él repetía el mismo número que Total y sobraba. */}
                {ticket.descuento_centavos > 0 && (
                  <>
                    <Totales etiqueta="Subtotal" valor={ticket.subtotal_centavos} est={est} />
                    <Totales
                      etiqueta="Descuento lealtad"
                      valor={-ticket.descuento_centavos}
                      est={est}
                      bien
                    />
                  </>
                )}
                {/* Base + impuesto ANTES del total, igual que el PC: se lee
                    como una suma que termina en el total, y no como algo que
                    pudiera sumarse encima. */}
                {ticket.impuesto_centavos > 0 && (
                  <>
                    <Totales etiqueta="Base" valor={ticket.base_centavos} est={est} />
                    <Totales
                      etiqueta={`${ticket.impuesto_nombre} incl.`}
                      valor={ticket.impuesto_centavos}
                      est={est}
                    />
                  </>
                )}
                <Totales etiqueta="Total" valor={ticket.total_centavos} est={est} fuerte />
                {/* Un renglón por cada pago real aplicado — con un solo
                    método (el caso de siempre) se ve exactamente igual que
                    antes; con varios, cada uno se lee por su cuenta. */}
                {ticket.pagos.map((p, i) => (
                  <Totales
                    key={i}
                    etiqueta={NOMBRE_METODO[p.metodo]}
                    valor={p.metodo === "efectivo" ? (p.recibido_centavos ?? p.monto_centavos) : p.monto_centavos}
                    est={est}
                  />
                ))}
                {ticket.cambio_centavos > 0 && (
                  <Totales etiqueta="Cambio" valor={ticket.cambio_centavos} est={est} bien />
                )}

                <View style={est.sep} />
                {ticket.cliente_nombre && (
                  <Text style={est.lealtad}>
                    Cliente: {ticket.cliente_nombre}
                    {(ticket.puntos_ganados ?? 0) > 0 ? ` · +${ticket.puntos_ganados} pts` : ""}
                    {ticket.saldo_puntos != null ? ` · Saldo: ${ticket.saldo_puntos}` : ""}
                  </Text>
                )}
                <Text style={est.despedida}>{ticket.despedida}</Text>
              </View>
              <BordeDentado color={papel} ancho={anchoTicket} />
            </View>
          </ScrollView>

          {/* Acciones */}
          <View style={est.acciones}>
            <Pressable
              style={({ pressed }) => [est.btnCompartir, pressed && { opacity: 0.85 }]}
              onPress={compartir}
            >
              <IconoUI id="lista" size={17} color={T.acentoTexto} grosor={2} />
              <Text style={est.btnCompartirTxt}>Compartir</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [est.btnListo, pressed && { opacity: 0.85 }]}
              onPress={onCerrar}
            >
              <Text style={est.btnListoTxt}>Listo</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Totales({
  etiqueta,
  valor,
  est,
  fuerte,
  bien,
}: {
  etiqueta: string;
  valor: number;
  est: any;
  fuerte?: boolean;
  /** Cifra que es buena noticia para el cliente (descuento, cambio):
   *  antes era T.turquesa (morado fantasma), ahora T.exito. */
  bien?: boolean;
}) {
  const { tema: T } = useTema();
  return (
    <View style={est.totalFila}>
      <Text style={[est.totalEtq, fuerte && est.totalEtqFuerte]}>{etiqueta}</Text>
      <Text
        style={[
          est.totalVal,
          fuerte && est.totalValFuerte,
          bien && { color: T.exito, fontWeight: "800" },
        ]}
      >
        {pesos(valor)}
      </Text>
    </View>
  );
}

function crearEstilos(T: Tema) {
  const sombra: ViewStyle = {
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  };
  // Montos: Plex Mono real, no solo el atributo tabular-nums suelto. Es la
  // misma regla que rige toda la app — aquí solo se aplicaba a medias.
  const cifras: TextStyle = {
    fontVariant: ["tabular-nums"],
    fontFamily: T.fuente.numFuerte,
  };
  return StyleSheet.create({
    fondo: {
      flex: 1,
      backgroundColor: "rgba(5,3,15,0.72)",
      alignItems: "center",
      justifyContent: "center",
      padding: 22,
    },
    zonaTicket: { width: "100%", maxWidth: 340, alignItems: "center" },
    ok: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: T.exitoSuave,
      borderWidth: 1.5,
      borderColor: T.exito,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 8,
    },
    okTxt: { color: T.exito, fontSize: 26, fontWeight: "800" },
    okTitulo: {
      color: T.texto,
      fontSize: T.tipo.titulo,
      fontWeight: "800",
      fontFamily: T.fuente.uiFuerte,
      marginBottom: 16,
    },
    recibo: { alignSelf: "stretch", ...sombra },
    papel: { paddingHorizontal: 20, paddingVertical: 18 },
    negocio: {
      color: T.texto,
      fontSize: 18,
      fontWeight: "900",
      fontFamily: T.fuente.uiFuerte,
      textAlign: "center",
      letterSpacing: 0.4,
    },
    cabFila: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "baseline",
      marginTop: 10,
    },
    cabFolio: {
      color: T.texto,
      fontSize: 12.5,
      fontWeight: "800",
      fontFamily: T.fuente.numFuerte,
      letterSpacing: 0.3,
    },
    cabFecha: {
      color: T.textoTenue,
      fontSize: T.tipo.micro,
      fontFamily: T.fuente.num,
      fontVariant: ["tabular-nums"],
    },
    cabAtendio: {
      color: T.textoTenue,
      fontSize: T.tipo.micro,
      fontFamily: T.fuente.ui,
      marginTop: 3,
    },
    sep: {
      borderTopWidth: 1,
      borderStyle: "dashed",
      borderColor: T.bordeFuerte,
      marginVertical: 12,
    },
    linea: { flexDirection: "row", alignItems: "center", marginBottom: 9 },
    lineaNombre: {
      color: T.texto,
      fontSize: 13.5,
      fontWeight: "700",
      fontFamily: T.fuente.uiFuerte,
    },
    lineaMeta: { color: T.textoTenue, fontSize: T.tipo.micro, marginTop: 2, ...cifras },
    lineaImporte: { color: T.texto, fontSize: 13.5, fontWeight: "800", ...cifras },
    totalFila: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "baseline",
      marginBottom: 5,
    },
    totalEtq: {
      color: T.textoSuave,
      fontSize: 12.5,
      fontWeight: "600",
      fontFamily: T.fuente.ui,
    },
    totalEtqFuerte: {
      color: T.texto,
      fontSize: T.tipo.cuerpo,
      fontWeight: "900",
      fontFamily: T.fuente.uiFuerte,
    },
    totalVal: { color: T.textoSuave, fontSize: 13, fontWeight: "700", ...cifras },
    totalValFuerte: { color: T.texto, fontSize: T.tipo.titulo, fontWeight: "900", ...cifras },
    despedida: {
      color: T.textoSuave,
      fontSize: T.tipo.pie,
      fontWeight: "700",
      fontFamily: T.fuente.ui,
      textAlign: "center",
    },
    lealtad: {
      color: T.acento,
      fontSize: 12.5,
      fontWeight: "800",
      fontFamily: T.fuente.uiFuerte,
      textAlign: "center",
      marginBottom: 8,
    },
    acciones: { flexDirection: "row", gap: 10, marginTop: 18, alignSelf: "stretch" },
    btnCompartir: {
      flex: 1,
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: T.acentoRelleno,
      borderRadius: T.radio,
      minHeight: 50,
    },
    btnCompartirTxt: {
      color: T.acentoTexto,
      fontSize: T.tipo.cuerpo,
      fontWeight: "800",
      fontFamily: T.fuente.uiFuerte,
    },
    btnListo: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: T.superficie2,
      borderWidth: 1,
      borderColor: T.bordeFuerte,
      borderRadius: T.radio,
      minHeight: 50,
    },
    btnListoTxt: {
      color: T.textoSuave,
      fontSize: T.tipo.cuerpo,
      fontWeight: "800",
      fontFamily: T.fuente.uiFuerte,
    },
  });
}
