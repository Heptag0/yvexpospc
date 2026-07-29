// YvexPOS Móvil — Pantalla REPORTES.
//
// Monitoreo local del negocio: selector de rango (Hoy / 7 días / 30 días /
// Este mes), resumen, gráfica de ventas (por hora si es hoy, por día si no),
// top productos, ventas por departamento y por método de pago.
// La gráfica es propia (Views proporcionales): cero librerías extra.

import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  RefreshControl,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import {
  Rango,
  ResumenRango,
  PuntoSerie,
  TopProducto,
  VentaDepto,
  VentaMetodo,
  resumenRango,
  serieVentas,
  topProductos,
  ventasPorDepartamento,
  ventasPorMetodo,
} from "@/src/base/reportes";
import { pesos } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";

const RANGOS: { id: Rango; label: string }[] = [
  { id: "hoy", label: "Hoy" },
  { id: "7d", label: "7 días" },
  { id: "30d", label: "30 días" },
  { id: "mes", label: "Este mes" },
];

type Tema = ReturnType<typeof useTema>["tema"];

export default function ReportesScreen() {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const [rango, setRango] = useState<Rango>("7d");
  const [resumen, setResumen] = useState<ResumenRango | null>(null);
  const [serie, setSerie] = useState<PuntoSerie[]>([]);
  const [top, setTop] = useState<TopProducto[]>([]);
  const [deptos, setDeptos] = useState<VentaDepto[]>([]);
  const [metodos, setMetodos] = useState<VentaMetodo[]>([]);
  const [refrescando, setRefrescando] = useState(false);

  const cargar = useCallback(async () => {
    const [r, s, t, d, m] = await Promise.all([
      resumenRango(rango),
      serieVentas(rango),
      topProductos(rango),
      ventasPorDepartamento(rango),
      ventasPorMetodo(rango),
    ]);
    setResumen(r);
    setSerie(s);
    setTop(t);
    setDeptos(d);
    setMetodos(m);
  }, [rango]);

  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar])
  );

  const onRefresh = useCallback(async () => {
    setRefrescando(true);
    await cargar();
    setRefrescando(false);
  }, [cargar]);

  const maxDepto = Math.max(1, ...deptos.map((d) => d.total_centavos));
  const totalMetodos = Math.max(1, metodos.reduce((s, m) => s + m.total_centavos, 0));

  return (
    <SafeAreaView style={est.raiz} edges={["top"]}>
      <ScrollView
        contentContainerStyle={est.cuerpo}
        refreshControl={
          <RefreshControl refreshing={refrescando} onRefresh={onRefresh} tintColor={T.acento} />
        }
      >
        <Text style={est.marca}>
          Yvex<Text style={{ color: T.turquesa }}>POS</Text>
        </Text>
        <Text style={est.titulo}>Reportes</Text>

        {/* Selector de rango */}
        <View style={est.rangos}>
          {RANGOS.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => setRango(r.id)}
              style={[est.rangoChip, rango === r.id && est.rangoActivo]}
            >
              <Text style={[est.rangoTxt, rango === r.id && est.rangoTxtActivo]}>
                {r.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Resumen */}
        <View style={est.resumenFila}>
          <View style={[est.resumenCaja, est.resumenPrincipal]}>
            <Text style={est.resLbl}>VENDIDO</Text>
            <Text style={est.resVal}>{pesos(resumen?.total_centavos ?? 0)}</Text>
          </View>
          <View style={est.resumenCaja}>
            <Text style={est.resLbl}>TICKETS</Text>
            <Text style={est.resVal}>{resumen?.tickets ?? 0}</Text>
          </View>
        </View>
        <View style={est.resumenFila}>
          <View style={est.resumenCaja}>
            <Text style={est.resLbl}>TICKET PROM.</Text>
            <Text style={est.resVal2}>{pesos(resumen?.promedio_centavos ?? 0)}</Text>
          </View>
          <View style={est.resumenCaja}>
            <Text style={est.resLbl}>ARTÍCULOS</Text>
            <Text style={est.resVal2}>{Math.round(resumen?.articulos ?? 0)}</Text>
          </View>
        </View>

        {/* Gráfica */}
        <Text style={est.seccion}>
          {rango === "hoy" ? "VENTAS POR HORA" : "VENTAS POR DÍA"}
        </Text>
        <Grafica serie={serie} />

        {/* Top productos */}
        <Text style={est.seccion}>MÁS VENDIDOS</Text>
        {top.length === 0 ? (
          <Text style={est.vacio}>Sin ventas en este rango.</Text>
        ) : (
          top.map((p, i) => (
            <View key={p.nombre} style={est.topFila}>
              <Text style={est.topPos}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={est.topNombre} numberOfLines={1}>{p.nombre}</Text>
                <Text style={est.topMeta}>
                  {Math.round(p.cantidad)} vendidos
                </Text>
              </View>
              <Text style={est.topTotal}>{pesos(p.total_centavos)}</Text>
            </View>
          ))
        )}

        {/* Por departamento */}
        {deptos.length > 0 && (
          <>
            <Text style={est.seccion}>POR DEPARTAMENTO</Text>
            {deptos.map((d) => (
              <View key={d.departamento} style={est.depFila}>
                <View style={est.depCab}>
                  <View style={[est.depPunto, { backgroundColor: d.color ?? T.textoTenue }]} />
                  <Text style={est.depNombre} numberOfLines={1}>{d.departamento}</Text>
                  <Text style={est.depTotal}>{pesos(d.total_centavos)}</Text>
                </View>
                <View style={est.depBarraFondo}>
                  <View
                    style={[
                      est.depBarra,
                      {
                        width: `${Math.max(3, (d.total_centavos / maxDepto) * 100)}%`,
                        backgroundColor: d.color ?? T.acento,
                      },
                    ]}
                  />
                </View>
              </View>
            ))}
          </>
        )}

        {/* Por método de pago */}
        {metodos.length > 0 && (
          <>
            <Text style={est.seccion}>POR MÉTODO DE PAGO</Text>
            <View style={est.metodosFila}>
              {metodos.map((m) => (
                <View key={m.metodo} style={est.metodoCaja}>
                  <Text style={est.metodoNombre}>
                    {m.metodo === "efectivo" ? "Efectivo" : "Tarjeta"}
                  </Text>
                  <Text style={est.metodoTotal}>{pesos(m.total_centavos)}</Text>
                  <Text style={est.metodoPct}>
                    {Math.round((m.total_centavos / totalMetodos) * 100)}%
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Gráfica de barras propia (sin librerías)
// ---------------------------------------------------------------------------
function Grafica({ serie }: { serie: PuntoSerie[] }) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const max = Math.max(1, ...serie.map((p) => p.total_centavos));
  const muchos = serie.length > 12;
  // Con muchos puntos, etiquetar solo algunos para que respiren.
  const cadaCuanto = muchos ? Math.ceil(serie.length / 6) : 1;

  if (serie.length === 0 || serie.every((p) => p.total_centavos === 0)) {
    return (
      <View style={est.grafVacia}>
        <Text style={est.vacio}>Sin ventas que graficar.</Text>
      </View>
    );
  }

  return (
    <View style={est.grafCaja}>
      <View style={est.grafBarras}>
        {serie.map((p, i) => (
          <View key={i} style={est.grafCol}>
            <View style={est.grafColFondo}>
              <View
                style={[
                  est.grafBarra,
                  {
                    height: `${Math.max(2, (p.total_centavos / max) * 100)}%`,
                    backgroundColor:
                      p.total_centavos === max ? T.turquesa : T.acento,
                  },
                ]}
              />
            </View>
            <Text style={est.grafEtiqueta} numberOfLines={1}>
              {i % cadaCuanto === 0 ? p.etiqueta : " "}
            </Text>
          </View>
        ))}
      </View>
      <Text style={est.grafMax}>Pico: {pesos(max)}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
function crearEstilos(T: Tema) {
  // Profundidad sutil, igual que en Inicio y Vender.
  const sombraSuave: ViewStyle = {
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  };
  // Cifras alineadas: no "bailan" al cambiar.
  const cifras: TextStyle = { fontVariant: ["tabular-nums"] };
  return StyleSheet.create({
  raiz: { flex: 1, backgroundColor: T.fondo },
  cuerpo: { padding: T.esp, paddingTop: 12 },
  marca: { color: T.texto, fontSize: 13, fontWeight: "900", letterSpacing: 1.5, opacity: 0.85 },
  titulo: { fontSize: 27, fontWeight: "800", color: T.texto, letterSpacing: -0.7, marginTop: 1, marginBottom: 14 },

  rangos: { flexDirection: "row", gap: 8, marginBottom: 16 },
  rangoChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: T.radioChico,
    borderWidth: 1,
    borderColor: T.borde,
    backgroundColor: T.superficie2,
    alignItems: "center",
  },
  rangoActivo: { backgroundColor: T.acento, borderColor: T.acento },
  rangoTxt: { color: T.textoSuave, fontSize: 13, fontWeight: "600" },
  rangoTxtActivo: { color: T.acentoTexto, fontWeight: "800" },

  resumenFila: { flexDirection: "row", gap: 10, marginBottom: 10 },
  resumenCaja: {
    flex: 1,
    backgroundColor: T.superficie,
    borderRadius: T.radio,
    borderWidth: 1,
    borderColor: T.borde,
    padding: 14,
    ...sombraSuave,
  },
  resumenPrincipal: { borderLeftWidth: 4, borderLeftColor: T.acento },
  resLbl: { color: T.textoSuave, fontSize: 10, fontWeight: "800", letterSpacing: 0.7 },
  resVal: { color: T.texto, fontSize: 22, fontWeight: "800", marginTop: 4, letterSpacing: -0.5, ...cifras },
  resVal2: { color: T.texto, fontSize: 18, fontWeight: "800", marginTop: 4, ...cifras },

  seccion: {
    color: T.textoSuave,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    marginTop: 18,
    marginBottom: 10,
  },
  vacio: { color: T.textoTenue, fontSize: 14 },

  grafCaja: {
    backgroundColor: T.superficie,
    borderRadius: T.radio,
    borderWidth: 1,
    borderColor: T.borde,
    padding: 14,
    ...sombraSuave,
  },
  grafVacia: {
    backgroundColor: T.superficie,
    borderRadius: T.radio,
    borderWidth: 1,
    borderColor: T.borde,
    padding: 24,
    alignItems: "center",
  },
  grafBarras: { flexDirection: "row", alignItems: "flex-end", height: 140, gap: 3 },
  grafCol: { flex: 1, alignItems: "center" },
  grafColFondo: { flex: 1, width: "100%", justifyContent: "flex-end" },
  grafBarra: { width: "100%", borderRadius: 4, minHeight: 3 },
  grafEtiqueta: { color: T.textoTenue, fontSize: 9, marginTop: 5 },
  grafMax: { color: T.textoTenue, fontSize: 11, marginTop: 8, textAlign: "right" },

  topFila: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.superficie,
    borderRadius: T.radio,
    borderWidth: 1,
    borderColor: T.borde,
    padding: 12,
    marginBottom: 7,
    gap: 12,
  },
  topPos: {
    color: T.acento,
    fontSize: 15,
    fontWeight: "800",
    width: 22,
    textAlign: "center",
  },
  topNombre: { color: T.texto, fontSize: 14, fontWeight: "700" },
  topMeta: { color: T.textoTenue, fontSize: 12, marginTop: 1 },
  topTotal: { color: T.turquesa, fontSize: 15, fontWeight: "800", ...cifras },

  depFila: { marginBottom: 12 },
  depCab: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 5 },
  depPunto: { width: 10, height: 10, borderRadius: 5 },
  depNombre: { color: T.texto, fontSize: 14, fontWeight: "600", flex: 1 },
  depTotal: { color: T.textoSuave, fontSize: 13, fontWeight: "700", ...cifras },
  depBarraFondo: {
    height: 10,
    backgroundColor: T.superficie2,
    borderRadius: 5,
    overflow: "hidden",
  },
  depBarra: { height: "100%", borderRadius: 5 },

  metodosFila: { flexDirection: "row", gap: 10 },
  metodoCaja: {
    flex: 1,
    backgroundColor: T.superficie,
    borderRadius: T.radio,
    borderWidth: 1,
    borderColor: T.borde,
    padding: 14,
    alignItems: "center",
    ...sombraSuave,
  },
  metodoIcono: { fontSize: 22 },
  metodoNombre: { color: T.textoSuave, fontSize: 12, fontWeight: "700", marginTop: 4 },
  metodoTotal: { color: T.texto, fontSize: 17, fontWeight: "800", marginTop: 3, ...cifras },
  metodoPct: { color: T.turquesa, fontSize: 12, fontWeight: "800", marginTop: 2 },
  });
}
