// YvexPOS Móvil — Ajuste de stock (resurtir / ajustar).
//
// Dos modos, como en la vida real de la tienda:
//   RESURTIR: "llegaron 24 más" -> suma al stock actual.
//   AJUSTAR:  "en realidad hay 18" -> fija el valor exacto.
// Muestra vista previa del resultado antes de aplicar, y el historial de
// movimientos recientes (rastro de ajustes_inventario).

import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Producto,
  ajustarStock,
  historialAjustes,
} from "@/src/base/inventario";
import { aNumero, fmtStock, fmtFecha } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, CabeceraModal, useEstiloInput } from "@/src/componentes/ui";

type Props = {
  producto: Producto;
  onCerrar: () => void;
  onAjustado: () => void;
};

type Movimiento = {
  stock_antes: number;
  stock_despues: number;
  motivo: string;
  creado_en: string;
};

const MOTIVOS: Record<string, string> = {
  ajuste: "Ajuste manual",
  resurtido: "Resurtido",
  conteo: "Conteo físico",
};

type Tema = ReturnType<typeof useTema>["tema"];

export default function ModalAjusteStock({ producto, onCerrar, onAjustado }: Props) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const estiloInput = useEstiloInput();
  const [modo, setModo] = useState<"resurtir" | "ajustar">("resurtir");
  const [cantidad, setCantidad] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [historial, setHistorial] = useState<Movimiento[]>([]);

  useEffect(() => {
    historialAjustes(producto.id, 8).then(setHistorial);
  }, [producto.id]);

  const n = aNumero(cantidad);
  const resultado = modo === "resurtir" ? producto.stock + n : n;
  const hayEntrada = cantidad.trim() !== "";

  async function aplicar() {
    setError("");
    if (!hayEntrada) {
      setError("Escribe una cantidad.");
      return;
    }
    if (resultado < 0) {
      setError("El stock no puede quedar negativo con este ajuste.");
      return;
    }
    setGuardando(true);
    try {
      await ajustarStock(producto.id, resultado, modo === "resurtir" ? "resurtido" : "ajuste");
      onAjustado();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setGuardando(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={est.raiz}>
        <CabeceraModal titulo="Ajustar stock" onIzquierda={onCerrar} izquierda="Cerrar" />
        <ScrollView contentContainerStyle={est.cuerpo} keyboardShouldPersistTaps="handled">
          {/* Producto y stock actual */}
          <View style={est.prodCaja}>
            <Text style={est.prodNombre}>{producto.nombre}</Text>
            <Text style={est.prodStock}>
              Stock actual:{" "}
              <Text style={{ color: T.texto, fontWeight: "800" }}>
                {fmtStock(producto.stock, producto.unidad)}
              </Text>
            </Text>
          </View>

          <Banner texto={error} tipo="error" />

          {/* Selector de modo */}
          <View style={est.segmento}>
            <Pressable
              onPress={() => setModo("resurtir")}
              style={[est.segBtn, modo === "resurtir" && est.segActivo]}
            >
              <Text style={[est.segTxt, modo === "resurtir" && est.segTxtActivo]}>
                Resurtir (+)
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setModo("ajustar")}
              style={[est.segBtn, modo === "ajustar" && est.segActivo]}
            >
              <Text style={[est.segTxt, modo === "ajustar" && est.segTxtActivo]}>
                Fijar valor
              </Text>
            </Pressable>
          </View>

          <Text style={est.ayudaModo}>
            {modo === "resurtir"
              ? "¿Cuántas unidades llegaron? Se suman al stock actual."
              : "¿Cuánto hay en realidad? El stock quedará en ese valor exacto."}
          </Text>

          <TextInput
            style={[estiloInput, est.inputGrande]}
            value={cantidad}
            onChangeText={setCantidad}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={T.textoTenue}
            autoFocus
          />

          {/* Vista previa */}
          {hayEntrada && (
            <View style={est.previa}>
              <Text style={est.previaTxt}>
                {fmtStock(producto.stock, producto.unidad)} →{" "}
                <Text
                  style={{
                    color: resultado < 0 ? T.peligro : T.turquesa,
                    fontWeight: "800",
                  }}
                >
                  {fmtStock(resultado, producto.unidad)}
                </Text>
              </Text>
            </View>
          )}

          <Boton titulo="Aplicar" onPress={aplicar} cargando={guardando} />

          {/* Historial */}
          {historial.length > 0 && (
            <View style={est.histCaja}>
              <Text style={est.histTitulo}>Movimientos recientes</Text>
              {historial.map((m, i) => (
                <View key={i} style={est.histFila}>
                  <View style={{ flex: 1 }}>
                    <Text style={est.histMotivo}>{MOTIVOS[m.motivo] ?? m.motivo}</Text>
                    <Text style={est.histFecha}>{fmtFecha(m.creado_en)}</Text>
                  </View>
                  <Text style={est.histCambio}>
                    {fmtStock(m.stock_antes, "")} → {fmtStock(m.stock_despues, "")}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function crearEstilos(T: Tema) {
  return StyleSheet.create({
  raiz: { flex: 1, backgroundColor: T.fondo },
  cuerpo: { padding: T.esp, paddingBottom: 60 },
  prodCaja: {
    backgroundColor: T.superficie,
    borderRadius: T.radio,
    borderWidth: 1,
    borderColor: T.borde,
    padding: 16,
    marginBottom: 16,
  },
  prodNombre: { color: T.texto, fontSize: 17, fontWeight: "800" },
  prodStock: { color: T.textoSuave, fontSize: 14, marginTop: 4 },
  segmento: {
    flexDirection: "row",
    backgroundColor: T.superficie,
    borderRadius: T.radioChico + 2,
    borderWidth: 1,
    borderColor: T.borde,
    padding: 4,
    marginBottom: 10,
  },
  segBtn: { flex: 1, paddingVertical: 11, borderRadius: T.radioChico - 2, alignItems: "center" },
  segActivo: { backgroundColor: T.acento },
  segTxt: { color: T.textoSuave, fontSize: 14, fontWeight: "600" },
  segTxtActivo: { color: T.acentoTexto, fontWeight: "800" },
  ayudaModo: { color: T.textoTenue, fontSize: 13, marginBottom: 12, lineHeight: 18 },
  inputGrande: {
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
    paddingVertical: 16,
    marginBottom: 12,
  },
  previa: {
    backgroundColor: T.superficie,
    borderRadius: T.radioChico,
    borderWidth: 1,
    borderColor: T.borde,
    borderLeftWidth: 4,
    borderLeftColor: T.acento,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 16,
  },
  previaTxt: { color: T.texto, fontSize: 16 },
  histCaja: { marginTop: 28 },
  histTitulo: {
    color: T.textoSuave,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  histFila: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.superficie,
    borderRadius: T.radioChico,
    borderWidth: 1,
    borderColor: T.borde,
    padding: 12,
    marginBottom: 7,
  },
  histMotivo: { color: T.texto, fontSize: 13, fontWeight: "600" },
  histFecha: { color: T.textoTenue, fontSize: 11, marginTop: 1 },
  histCambio: { color: T.textoSuave, fontSize: 13, fontWeight: "700" },
  });
}
