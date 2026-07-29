// YvexPOS Móvil — Reporte de inventario (valorización por departamento).
//
// Cuánto vale tu inventario, departamento por departamento: productos,
// unidades, valor a costo, valor a precio de venta, y utilidad potencial.
// Con fila de totales al final. Como el reporte del PC.

import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FilaReporte, reportePorDepartamento } from "@/src/base/inventario";
import { pesos } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import { CabeceraModal } from "@/src/componentes/ui";

type Props = {
  onCerrar: () => void;
};

type Tema = ReturnType<typeof useTema>["tema"];

export default function ModalReporte({ onCerrar }: Props) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const [filas, setFilas] = useState<FilaReporte[] | null>(null);

  useEffect(() => {
    reportePorDepartamento().then(setFilas);
  }, []);

  const tot = (filas ?? []).reduce(
    (a, f) => ({
      productos: a.productos + f.productos,
      unidades: a.unidades + f.unidades,
      costo: a.costo + f.valor_costo_centavos,
      precio: a.precio + f.valor_precio_centavos,
    }),
    { productos: 0, unidades: 0, costo: 0, precio: 0 }
  );
  const utilidad = tot.precio - tot.costo;

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={est.raiz}>
        <CabeceraModal titulo="Reporte de inventario" onIzquierda={onCerrar} izquierda="Cerrar" />

        {!filas ? (
          <View style={est.centro}>
            <ActivityIndicator size="large" color={T.acento} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={est.cuerpo}>
            {/* Resumen general */}
            <View style={est.resumen}>
              <View style={est.resumenFila}>
                <ResumenDato label="Valor a costo" valor={pesos(tot.costo)} destacado />
                <ResumenDato label="Valor a precio" valor={pesos(tot.precio)} />
              </View>
              <View style={est.resumenFila}>
                <ResumenDato
                  label="Utilidad potencial"
                  valor={pesos(utilidad)}
                  color={utilidad >= 0 ? T.turquesa : T.peligro}
                />
                <ResumenDato label="Unidades" valor={String(Math.round(tot.unidades))} />
              </View>
            </View>

            <Text style={est.seccion}>Por departamento</Text>

            {filas.length === 0 ? (
              <Text style={est.vacio}>No hay productos con stock que valorizar.</Text>
            ) : (
              filas.map((f) => {
                const util = f.valor_precio_centavos - f.valor_costo_centavos;
                return (
                  <View key={f.categoria_id ?? "sin"} style={est.tarjeta}>
                    <View style={est.tarjetaCab}>
                      <View
                        style={[est.punto, { backgroundColor: f.color ?? T.textoTenue }]}
                      />
                      <Text style={est.depto} numberOfLines={1}>{f.categoria}</Text>
                      <Text style={est.deptoMeta}>
                        {f.productos} prod · {Math.round(f.unidades)} u
                      </Text>
                    </View>
                    <View style={est.datos}>
                      <Dato label="A costo" valor={pesos(f.valor_costo_centavos)} />
                      <Dato label="A precio" valor={pesos(f.valor_precio_centavos)} />
                      <Dato
                        label="Utilidad"
                        valor={pesos(util)}
                        color={util >= 0 ? T.turquesa : T.peligro}
                      />
                    </View>
                  </View>
                );
              })
            )}
            <View style={{ height: 30 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function ResumenDato({
  label,
  valor,
  destacado,
  color,
}: {
  label: string;
  valor: string;
  destacado?: boolean;
  color?: string;
}) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  return (
    <View style={[est.rDato, destacado && est.rDatoDestacado]}>
      <Text style={est.rLbl}>{label}</Text>
      <Text style={[est.rVal, color ? { color } : null]}>{valor}</Text>
    </View>
  );
}

function Dato({ label, valor, color }: { label: string; valor: string; color?: string }) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  return (
    <View style={{ flex: 1 }}>
      <Text style={est.dLbl}>{label}</Text>
      <Text style={[est.dVal, color ? { color } : null]}>{valor}</Text>
    </View>
  );
}

function crearEstilos(T: Tema) {
  return StyleSheet.create({
  raiz: { flex: 1, backgroundColor: T.fondo },
  centro: { flex: 1, alignItems: "center", justifyContent: "center" },
  cuerpo: { padding: T.esp },
  resumen: { gap: 10, marginBottom: 22 },
  resumenFila: { flexDirection: "row", gap: 10 },
  rDato: {
    flex: 1,
    backgroundColor: T.superficie,
    borderRadius: T.radio,
    borderWidth: 1,
    borderColor: T.borde,
    padding: 14,
  },
  rDatoDestacado: { borderLeftWidth: 4, borderLeftColor: T.acento },
  rLbl: {
    color: T.textoSuave,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  rVal: { color: T.texto, fontSize: 19, fontWeight: "800", marginTop: 5 },
  seccion: {
    color: T.textoSuave,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  vacio: { color: T.textoTenue, textAlign: "center", marginTop: 24 },
  tarjeta: {
    backgroundColor: T.superficie,
    borderRadius: T.radio,
    borderWidth: 1,
    borderColor: T.borde,
    padding: 14,
    marginBottom: 10,
  },
  tarjetaCab: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  punto: { width: 12, height: 12, borderRadius: 6, marginRight: 9 },
  depto: { color: T.texto, fontSize: 15, fontWeight: "800", flex: 1 },
  deptoMeta: { color: T.textoTenue, fontSize: 12 },
  datos: { flexDirection: "row", gap: 8 },
  dLbl: { color: T.textoTenue, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 },
  dVal: { color: T.texto, fontSize: 14, fontWeight: "700", marginTop: 3 },
  });
}
