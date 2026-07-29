// YvexPOS Móvil — Modal del ticket de venta.
//
// La confirmación de cobro con cara de recibo profesional: tarjeta clara con
// borde dentado arriba y abajo (triángulos SVG propios), encabezado con el
// negocio, folio y fecha, tabla de ítems, totales a la derecha y un cierre
// cálido. Botones: "Compartir" (Share nativo con el recibo en texto plano)
// y "Listo".

import { useMemo } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Svg, { Polygon } from "react-native-svg";
import { TicketVenta, textoRecibo } from "@/src/base/ticket";
import { pesos } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import { IconoUI } from "@/src/componentes/iconos";

type Tema = ReturnType<typeof useTema>["tema"];

const DIENTE = 9; // ancho de cada triángulo del borde dentado
const COLUMNAS = 40; // triángulos por fila (tapa el ancho de la tarjeta)

/** Fila de triángulos SVG que simula el corte dentado del recibo. */
function BordeDentado({ color, arriba }: { color: string; arriba?: boolean }) {
  const puntas = useMemo(() => {
    const arr: string[] = [];
    for (let i = 0; i < COLUMNAS; i++) {
      const x = i * DIENTE;
      // Triángulo isósceles: arriba apunta hacia arriba, abajo hacia abajo.
      arr.push(
        arriba
          ? `${x},${DIENTE} ${x + DIENTE},${DIENTE} ${x + DIENTE / 2},0`
          : `${x},0 ${x + DIENTE},0 ${x + DIENTE / 2},${DIENTE}`
      );
    }
    return arr;
  }, [arriba]);
  return (
    <View style={{ overflow: "hidden" }}>
      <Svg width={COLUMNAS * DIENTE} height={DIENTE}>
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
        <View style={est.zonaTicket}>
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
              <BordeDentado color={papel} arriba />
              <View style={[est.papel, { backgroundColor: papel }]}>
                <Text style={est.negocio}>{ticket.nombre_negocio}</Text>
                <Text style={est.meta}>
                  Folio #{ticket.folio} · {ticket.fecha_legible}
                </Text>

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

                <Totales etiqueta="Subtotal" valor={ticket.subtotal_centavos} est={est} />
                <Totales etiqueta="Total" valor={ticket.total_centavos} est={est} fuerte />
                <Totales
                  etiqueta={ticket.metodo === "efectivo" ? "Efectivo" : "Tarjeta"}
                  valor={
                    ticket.metodo === "efectivo"
                      ? ticket.pagado_centavos
                      : ticket.total_centavos
                  }
                  est={est}
                />
                {ticket.metodo === "efectivo" && (
                  <Totales etiqueta="Cambio" valor={ticket.cambio_centavos} est={est} verde />
                )}

                <View style={est.sep} />
                <Text style={est.despedida}>{ticket.despedida}</Text>
              </View>
              <BordeDentado color={papel} />
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
  verde,
}: {
  etiqueta: string;
  valor: number;
  est: any;
  fuerte?: boolean;
  verde?: boolean;
}) {
  const { tema: T } = useTema();
  return (
    <View style={est.totalFila}>
      <Text style={[est.totalEtq, fuerte && est.totalEtqFuerte]}>{etiqueta}</Text>
      <Text
        style={[
          est.totalVal,
          fuerte && est.totalValFuerte,
          verde && { color: T.turquesa, fontWeight: "800" },
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
  const cifras: TextStyle = { fontVariant: ["tabular-nums"] };
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
      fontSize: 17,
      fontWeight: "800",
      marginBottom: 16,
    },
    recibo: { alignSelf: "stretch", ...sombra },
    papel: { paddingHorizontal: 20, paddingVertical: 18 },
    negocio: {
      color: T.texto,
      fontSize: 18,
      fontWeight: "900",
      textAlign: "center",
      letterSpacing: 0.4,
    },
    meta: {
      color: T.textoTenue,
      fontSize: 12,
      textAlign: "center",
      marginTop: 4,
      fontWeight: "600",
    },
    sep: {
      borderTopWidth: 1,
      borderStyle: "dashed",
      borderColor: T.bordeFuerte,
      marginVertical: 12,
    },
    linea: { flexDirection: "row", alignItems: "center", marginBottom: 9 },
    lineaNombre: { color: T.texto, fontSize: 13.5, fontWeight: "700" },
    lineaMeta: { color: T.textoTenue, fontSize: 11, marginTop: 2, ...cifras },
    lineaImporte: { color: T.texto, fontSize: 13.5, fontWeight: "800", ...cifras },
    totalFila: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "baseline",
      marginBottom: 5,
    },
    totalEtq: { color: T.textoSuave, fontSize: 12.5, fontWeight: "600" },
    totalEtqFuerte: { color: T.texto, fontSize: 14, fontWeight: "900" },
    totalVal: { color: T.textoSuave, fontSize: 13, fontWeight: "700", ...cifras },
    totalValFuerte: { color: T.texto, fontSize: 19, fontWeight: "900", ...cifras },
    despedida: {
      color: T.textoSuave,
      fontSize: 13,
      fontWeight: "700",
      textAlign: "center",
    },
    acciones: { flexDirection: "row", gap: 10, marginTop: 18, alignSelf: "stretch" },
    btnCompartir: {
      flex: 1,
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: T.acento,
      borderRadius: T.radio,
      minHeight: 50,
    },
    btnCompartirTxt: { color: T.acentoTexto, fontSize: 15, fontWeight: "800" },
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
    btnListoTxt: { color: T.textoSuave, fontSize: 15, fontWeight: "800" },
  });
}
