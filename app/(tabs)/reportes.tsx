// YvexPOS Móvil — Pantalla REPORTES.
//
// Monitoreo local del negocio. La gráfica es propia (Views proporcionales):
// cero librerías extra.
//
// ---------------------------------------------------------------------------
// CÓMO ESTÁ COMPUESTA (y por qué así)
// ---------------------------------------------------------------------------
// Antes eran cuatro cajas del mismo peso visual con cuatro números sueltos.
// El problema no era que faltaran datos: era que ningún número tenía
// CONTEXTO. "$4,350" no dice nada si no sabes contra qué compararlo.
//
// Ahora la pantalla responde tres preguntas en orden, de arriba abajo:
//   1. ¿Cuánto vendí?      → la LÁMINA, con comparación contra el periodo
//                            anterior. Una sola protagonista.
//   2. ¿Cuánto gané?       → utilidad y margen reales.
//   3. ¿Cómo y cuándo?     → gráfica, mejor hora/día, productos, departamentos
//                            y métodos de pago.
//
// Regla que se respeta aquí: UNA sola <Lamina> por pantalla. Todo lo demás son
// grupos de filas. Por eso ahora sí hay jerarquía.

import { useCallback, useState } from "react";
import { View, Pressable, StyleSheet, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import {
  Rango,
  ResumenRango,
  Comparativo,
  Utilidad,
  MejorHora,
  MejorDia,
  PuntoSerie,
  TopProducto,
  VentaDepto,
  VentaMetodo,
  comparativoRango,
  utilidadRango,
  mejorHoraRango,
  mejorDiaRango,
  serieVentas,
  topProductos,
  ventasPorDepartamento,
  ventasPorMetodo,
} from "@/src/base/reportes";
import { pesos } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import {
  Pantalla,
  Encabezado,
  Seccion,
  Lamina,
  Grupo,
  Fila,
  Txt,
  Monto,
  Vacio,
} from "@/src/componentes/ui";

const RANGOS: { id: Rango; label: string; leyenda: string; anterior: string }[] = [
  { id: "hoy", label: "Hoy", leyenda: "Hoy", anterior: "ayer" },
  { id: "7d", label: "7 días", leyenda: "Últimos 7 días", anterior: "los 7 días previos" },
  { id: "30d", label: "30 días", leyenda: "Últimos 30 días", anterior: "los 30 días previos" },
  { id: "mes", label: "Este mes", leyenda: "Este mes", anterior: "el mes pasado" },
];

export default function ReportesScreen() {
  const { tema: T } = useTema();
  const [rango, setRango] = useState<Rango>("7d");
  const [comp, setComp] = useState<Comparativo | null>(null);
  const [utilidad, setUtilidad] = useState<Utilidad | null>(null);
  const [mejorHora, setMejorHora] = useState<MejorHora | null>(null);
  const [mejorDia, setMejorDia] = useState<MejorDia | null>(null);
  const [serie, setSerie] = useState<PuntoSerie[]>([]);
  const [top, setTop] = useState<TopProducto[]>([]);
  const [deptos, setDeptos] = useState<VentaDepto[]>([]);
  const [metodos, setMetodos] = useState<VentaMetodo[]>([]);
  const [refrescando, setRefrescando] = useState(false);

  const cargar = useCallback(async () => {
    const [c, u, mh, md, s, t, d, m] = await Promise.all([
      comparativoRango(rango),
      utilidadRango(rango),
      mejorHoraRango(rango),
      mejorDiaRango(rango),
      serieVentas(rango),
      topProductos(rango),
      ventasPorDepartamento(rango),
      ventasPorMetodo(rango),
    ]);
    setComp(c);
    setUtilidad(u);
    setMejorHora(mh);
    setMejorDia(md);
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

  const meta = RANGOS.find((r) => r.id === rango)!;
  const resumen: ResumenRango | null = comp?.actual ?? null;
  const sinVentas = (resumen?.tickets ?? 0) === 0;

  const maxDepto = Math.max(1, ...deptos.map((d) => d.total_centavos));
  const totalMetodos = Math.max(1, metodos.reduce((s, m) => s + m.total_centavos, 0));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.fondo }} edges={["top"]}>
      <Pantalla
        refresco={
          <RefreshControl
            refreshing={refrescando}
            onRefresh={onRefresh}
            tintColor={T.acento}
          />
        }
      >
        <Encabezado titulo="Reportes" meta={meta.leyenda} />

        <SelectorRango rango={rango} onCambio={setRango} />

        {/* ---------------------------------------------------------------
            1. ¿CUÁNTO VENDÍ? — la única protagonista de la pantalla.
            --------------------------------------------------------------- */}
        <View style={{ marginBottom: T.esps.xl }}>
          <Lamina>
            <Txt escala="micro" tono="suave" fuerte mayus>
              Vendido
            </Txt>
            <View style={{ marginTop: T.esps.xs }}>
              <Monto texto={pesos(resumen?.total_centavos ?? 0)} escala="protagonista" />
            </View>

            <Comparacion comp={comp} etiquetaAnterior={meta.anterior} />

            {/* Tickets y promedio como apoyo, no como iguales. */}
            <View
              style={{
                flexDirection: "row",
                marginTop: T.esps.lg,
                paddingTop: T.esps.lg,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: T.borde,
              }}
            >
              <View style={{ flex: 1 }}>
                <Monto texto={String(resumen?.tickets ?? 0)} escala="titulo" />
                <Txt escala="pie" tono="suave">
                  tickets
                </Txt>
              </View>
              <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: T.borde }} />
              <View style={{ flex: 1, paddingLeft: T.esps.lg }}>
                <Monto texto={pesos(resumen?.promedio_centavos ?? 0)} escala="titulo" />
                <Txt escala="pie" tono="suave">
                  ticket promedio
                </Txt>
              </View>
            </View>
          </Lamina>
        </View>

        {/* ---------------------------------------------------------------
            2. ¿CUÁNTO GANÉ?
            La utilidad solo aparece si la base tiene de dónde sacar el costo.
            Nunca un cero engañoso: o el dato es real, o no está.
            --------------------------------------------------------------- */}
        {utilidad ? (
          <Seccion titulo="Ganancia">
            <Grupo>
              <Fila
                titulo="Utilidad"
                meta={
                  utilidad.aproximado
                    ? "Con el costo actual del producto · aproximado"
                    : "Con el costo real del momento de la venta"
                }
                valor={
                  <Monto
                    texto={pesos(utilidad.utilidad_centavos)}
                    escala="cuerpo"
                    tono={utilidad.utilidad_centavos >= 0 ? "exito" : "peligro"}
                  />
                }
              />
              <Fila
                titulo="Margen"
                meta="Cuánto de cada peso vendido te queda"
                valor={<Monto texto={`${utilidad.margenPct.toFixed(1)}%`} escala="cuerpo" />}
              />
              <Fila
                titulo="Costo de lo vendido"
                valor={
                  <Monto texto={pesos(utilidad.costo_centavos)} escala="cuerpo" tono="suave" />
                }
              />
            </Grupo>
          </Seccion>
        ) : null}

        {/* ---------------------------------------------------------------
            3. ¿CÓMO Y CUÁNDO?
            --------------------------------------------------------------- */}
        <Seccion titulo={rango === "hoy" ? "Ventas por hora" : "Ventas por día"}>
          <Grafica serie={serie} />
        </Seccion>

        {(mejorHora || mejorDia) && !sinVentas ? (
          <Seccion titulo="Cuándo vendes más">
            <Grupo>
              {mejorHora ? (
                <Fila
                  titulo={`Tu mejor hora es a las ${mejorHora.hora}:00`}
                  meta={`${mejorHora.tickets} ${
                    mejorHora.tickets === 1 ? "ticket" : "tickets"
                  } en esa hora`}
                  valor={
                    <Monto texto={pesos(mejorHora.total_centavos)} escala="cuerpo" tono="acento" />
                  }
                />
              ) : null}
              {mejorDia ? (
                <Fila
                  titulo={`Tu mejor día es el ${mejorDia.nombre}`}
                  meta="Acumulado del rango"
                  valor={
                    <Monto texto={pesos(mejorDia.total_centavos)} escala="cuerpo" tono="acento" />
                  }
                />
              ) : null}
            </Grupo>
          </Seccion>
        ) : null}

        <Seccion titulo="Más vendidos">
          {top.length === 0 ? (
            <Grupo>
              <Vacio
                titulo="Todavía no hay ventas aquí"
                texto="Cuando cobres tu primer ticket en este rango, aquí verás qué se vende más y cuánto deja cada producto."
              />
            </Grupo>
          ) : (
            <Grupo>
              {top.map((p, i) => (
                <Fila
                  key={p.nombre}
                  titulo={p.nombre}
                  meta={`${Math.round(p.cantidad)} ${
                    Math.round(p.cantidad) === 1 ? "vendido" : "vendidos"
                  }`}
                  icono={
                    <Txt escala="pie" tono={i === 0 ? "acento" : "tenue"} fuerte>
                      {String(i + 1)}
                    </Txt>
                  }
                  valor={<Monto texto={pesos(p.total_centavos)} escala="cuerpo" />}
                />
              ))}
            </Grupo>
          )}
        </Seccion>

        {deptos.length > 0 ? (
          <Seccion titulo="Por departamento">
            <View
              style={{
                backgroundColor: T.superficie,
                borderRadius: T.radio,
                padding: T.esps.lg,
                gap: T.esps.lg,
              }}
            >
              {deptos.map((d) => (
                <View key={d.departamento}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: T.esps.sm,
                      marginBottom: T.esps.sm,
                    }}
                  >
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: d.color ?? T.textoTenue,
                      }}
                    />
                    <View style={{ flex: 1 }}>
                      <Txt escala="pie" lineas={1}>
                        {d.departamento}
                      </Txt>
                    </View>
                    <Monto texto={pesos(d.total_centavos)} escala="pie" tono="suave" />
                  </View>
                  <View
                    style={{
                      height: 6,
                      backgroundColor: T.superficie2,
                      borderRadius: 3,
                      overflow: "hidden",
                    }}
                  >
                    <View
                      style={{
                        height: "100%",
                        borderRadius: 3,
                        width: `${Math.max(3, (d.total_centavos / maxDepto) * 100)}%`,
                        backgroundColor: d.color ?? T.acento,
                      }}
                    />
                  </View>
                </View>
              ))}
            </View>
          </Seccion>
        ) : null}

        {metodos.length > 0 ? (
          <Seccion titulo="Cómo te pagaron">
            <Grupo>
              {metodos.map((m) => (
                <Fila
                  key={m.metodo}
                  titulo={m.metodo === "efectivo" ? "Efectivo" : "Tarjeta"}
                  meta={`${m.pagos} ${m.pagos === 1 ? "pago" : "pagos"} · ${Math.round(
                    (m.total_centavos / totalMetodos) * 100
                  )}% del total`}
                  valor={<Monto texto={pesos(m.total_centavos)} escala="cuerpo" />}
                />
              ))}
            </Grupo>
          </Seccion>
        ) : null}
      </Pantalla>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Comparación contra el periodo anterior
// ---------------------------------------------------------------------------
//
// Un número sin comparación no informa. Esta línea es lo que convierte
// "vendiste $4,350" en "vendiste $4,350, 12% más que la semana pasada" — que
// es lo único que el dueño realmente quiere saber.
//
// Sin colores de semáforo agresivos: una caída no es una regañina, es un dato.
function Comparacion({
  comp,
  etiquetaAnterior,
}: {
  comp: Comparativo | null;
  etiquetaAnterior: string;
}) {
  const { tema: T } = useTema();
  if (!comp) return null;

  // Sin base de comparación: se dice, no se inventa un 0%.
  if (comp.variacionPct === null) {
    if (comp.actual.total_centavos === 0) return null;
    return (
      <View style={{ marginTop: T.esps.sm }}>
        <Txt escala="pie" tono="tenue">
          Sin ventas en {etiquetaAnterior} para comparar
        </Txt>
      </View>
    );
  }

  const sube = comp.variacionPct >= 0;
  const pct = Math.abs(comp.variacionPct);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: T.esps.xs,
        marginTop: T.esps.sm,
      }}
    >
      <Txt escala="pie" tono={sube ? "exito" : "peligro"} fuerte>
        {sube ? "↑" : "↓"} {pct.toFixed(0)}%
      </Txt>
      <Txt escala="pie" tono="suave">
        vs {etiquetaAnterior} ({pesos(Math.abs(comp.diferencia_centavos))}{" "}
        {sube ? "más" : "menos"})
      </Txt>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Selector de rango
// ---------------------------------------------------------------------------
function SelectorRango({
  rango,
  onCambio,
}: {
  rango: Rango;
  onCambio: (r: Rango) => void;
}) {
  const { tema: T } = useTema();
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: T.superficie2,
        borderRadius: T.radio,
        padding: 3,
        marginBottom: T.esps.xl,
      }}
    >
      {RANGOS.map((r) => {
        const activo = rango === r.id;
        return (
          <Pressable
            key={r.id}
            onPress={() => onCambio(r.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: activo }}
            style={{
              flex: 1,
              minHeight: 40,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: T.radioChico,
              backgroundColor: activo ? T.acentoRelleno : "transparent",
            }}
          >
            <Txt
              escala="pie"
              fuerte={activo}
              tono="suave"
              estilo={activo ? { color: T.acentoTexto } : undefined}
            >
              {r.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Gráfica de barras propia (sin librerías)
// ---------------------------------------------------------------------------
//
// El pico se pinta con el acento pleno y el resto atenuado: así el ojo
// encuentra el día bueno sin leer una sola etiqueta. Antes el pico usaba un
// color distinto (el lila fantasma), lo que metía un segundo color de marca.
function Grafica({ serie }: { serie: PuntoSerie[] }) {
  const { tema: T } = useTema();
  const max = Math.max(1, ...serie.map((p) => p.total_centavos));
  const muchos = serie.length > 12;
  const cadaCuanto = muchos ? Math.ceil(serie.length / 6) : 1;
  const total = serie.reduce((s, p) => s + p.total_centavos, 0);

  if (serie.length === 0 || total === 0) {
    return (
      <View style={{ backgroundColor: T.superficie, borderRadius: T.radio }}>
        <Vacio
          titulo="Nada que graficar todavía"
          texto="En cuanto entren ventas en este rango, verás aquí la forma de tu día."
        />
      </View>
    );
  }

  return (
    <View
      style={{
        backgroundColor: T.superficie,
        borderRadius: T.radio,
        padding: T.esps.lg,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-end", height: 132, gap: 3 }}>
        {serie.map((p, i) => {
          const esPico = p.total_centavos === max && max > 0;
          return (
            <View key={i} style={{ flex: 1, alignItems: "center" }}>
              <View style={{ flex: 1, width: "100%", justifyContent: "flex-end" }}>
                <View
                  style={{
                    width: "100%",
                    borderRadius: 3,
                    minHeight: 3,
                    height: `${Math.max(2, (p.total_centavos / max) * 100)}%`,
                    backgroundColor: esPico ? T.acento : T.acentoBorde,
                  }}
                />
              </View>
              <Txt escala="micro" tono="tenue" lineas={1} estilo={{ marginTop: 5 }}>
                {i % cadaCuanto === 0 ? p.etiqueta : " "}
              </Txt>
            </View>
          );
        })}
      </View>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          marginTop: T.esps.md,
          paddingTop: T.esps.md,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: T.borde,
        }}
      >
        <Txt escala="pie" tono="suave">
          Pico
        </Txt>
        <Monto texto={pesos(max)} escala="pie" />
      </View>
    </View>
  );
}
