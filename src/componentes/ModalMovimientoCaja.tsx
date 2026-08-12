// YvexPOS Móvil — Entrada / salida de efectivo del cajón (fuera de ventas).
//
// Dinero que se mueve del cajón sin ser una venta: pagarle a un proveedor en
// efectivo, un retiro del dueño, meter cambio. NO duplica lógica: reusa
// registrarMovimientoCaja() de venta.ts, la misma función que ya usa Dinero
// cuando un gasto en efectivo genera su salida automática. corteTurno() ya
// suma/resta estos movimientos (entradas_centavos / salidas_centavos), así
// que en cuanto se registra uno el corte queda correcto de inmediato.
//
// Hoja inferior compacta (no pantalla completa a la "CabeceraModal"): es una
// acción rápida y secundaria, pensada para no sacar al dueño de Inicio.

import { useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Turno, TipoMovimiento, registrarMovimientoCaja } from "@/src/base/venta";
import { aCentavos } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, Campo, useEstiloInput } from "@/src/componentes/ui";

type Tema = ReturnType<typeof useTema>["tema"];

export default function ModalMovimientoCaja({
  turno,
  onCerrar,
  onGuardado,
}: {
  turno: Turno;
  onCerrar: () => void;
  /** Se llama tras guardar con éxito, para refrescar Inicio (resumen/corte). */
  onGuardado: () => void;
}) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const estiloInput = useEstiloInput();

  const [tipo, setTipo] = useState<TipoMovimiento>("salida");
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setError("");
    const centavos = aCentavos(monto);
    if (centavos <= 0) {
      setError("Ingresa un monto válido.");
      return;
    }
    setGuardando(true);
    try {
      await registrarMovimientoCaja({
        cajaSesionId: turno.id,
        tipo,
        motivo: motivo.trim() || null,
        montoCentavos: centavos,
      });
      onGuardado();
      onCerrar();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setGuardando(false);
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onCerrar}>
      <View style={est.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={guardando ? undefined : onCerrar}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <SafeAreaView edges={["bottom"]} style={est.hoja}>
            <View style={est.agarradera} />
            <Text style={est.titulo}>Entrada / salida de efectivo</Text>
            <Text style={est.sub}>
              Registra dinero que entra o sale del cajón fuera de las ventas.
              El corte de hoy lo cuenta automáticamente.
            </Text>

            <View style={est.tipos}>
              <Pressable
                style={[est.tipoBtn, tipo === "salida" && est.tipoBtnActivo]}
                onPress={() => setTipo("salida")}
              >
                <Text style={[est.tipoTxt, tipo === "salida" && est.tipoTxtActivo]}>
                  − Salida
                </Text>
              </Pressable>
              <Pressable
                style={[est.tipoBtn, tipo === "entrada" && est.tipoBtnActivo]}
                onPress={() => setTipo("entrada")}
              >
                <Text style={[est.tipoTxt, tipo === "entrada" && est.tipoTxtActivo]}>
                  + Entrada
                </Text>
              </Pressable>
            </View>

            {error ? <Banner texto={error} tipo="error" /> : null}

            <Campo label="Monto">
              <TextInput
                style={estiloInput}
                value={monto}
                onChangeText={setMonto}
                placeholder="0.00"
                placeholderTextColor={T.textoTenue}
                keyboardType="decimal-pad"
                autoFocus
              />
            </Campo>

            <Campo label="Motivo (opcional)">
              <TextInput
                style={estiloInput}
                value={motivo}
                onChangeText={setMotivo}
                placeholder="Pago a proveedor, retiro, depósito…"
                placeholderTextColor={T.textoTenue}
                returnKeyType="done"
                onSubmitEditing={guardar}
              />
            </Campo>

            <View style={est.acciones}>
              <View style={{ flex: 1 }}>
                <Boton
                  titulo="Cancelar"
                  tipo="secundario"
                  onPress={onCerrar}
                  deshabilitado={guardando}
                />
              </View>
              <View style={{ width: 10 }} />
              <View style={{ flex: 1 }}>
                <Boton titulo="Registrar" onPress={guardar} cargando={guardando} />
              </View>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function crearEstilos(T: Tema) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "#00000066",
    },
    hoja: {
      backgroundColor: T.fondo,
      borderTopLeftRadius: T.radioGrande,
      borderTopRightRadius: T.radioGrande,
      padding: T.esp,
      paddingTop: 10,
    },
    agarradera: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: T.bordeFuerte,
      alignSelf: "center",
      marginBottom: 14,
    },
    titulo: { color: T.texto, fontSize: 18, fontWeight: "800" },
    sub: {
      color: T.textoSuave,
      fontSize: 13,
      marginTop: 4,
      marginBottom: 18,
      lineHeight: 18,
    },
    tipos: {
      flexDirection: "row",
      backgroundColor: T.superficie,
      borderRadius: T.radioChico + 2,
      borderWidth: 1,
      borderColor: T.borde,
      padding: 4,
      marginBottom: 16,
    },
    tipoBtn: {
      flex: 1,
      paddingVertical: 11,
      borderRadius: T.radioChico - 2,
      alignItems: "center",
    },
    tipoBtnActivo: { backgroundColor: T.acento },
    tipoTxt: { color: T.textoSuave, fontSize: 14.5, fontWeight: "700" },
    tipoTxtActivo: { color: T.acentoTexto, fontWeight: "800" },
    acciones: { flexDirection: "row", marginTop: 8, marginBottom: 10 },
  });
}
