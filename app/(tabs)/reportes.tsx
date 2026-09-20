// YvexPOS Móvil — Pantalla REPORTES.
//
// Monitoreo local del negocio. La gráfica es propia (Views proporcionales):
// cero librerías extra.
//
// ---------------------------------------------------------------------------
// CÓMO ESTÁ COMPUESTA (y por qué así)
// ---------------------------------------------------------------------------
// La pantalla EMPIEZA CONTANDO QUÉ PASÓ, no listando indicadores. Antes lo
// primero que veías era una cifra sin contexto y debajo cinco bloques del
// mismo peso: apilaba datos y no concluía nada. Ahora el orden es:
//
//   0. EL TITULAR       una frase que dice qué pasó. Se lee, no se escanea.
//   1. ¿Cuánto vendí?   la LÁMINA. Una sola protagonista por pantalla.
//   2. ¿Cuánto gané?    utilidad, margen y — esto es nuevo — CUÁNTO de lo
//                       vendido tiene costo capturado de verdad.
//   3. ¿Cómo y cuándo?  gráfica con su referencia, productos, departamentos
//                       y métodos de pago.
//
// ---------------------------------------------------------------------------
// RITMO — densa donde se trabaja, con aire donde se lee
// ---------------------------------------------------------------------------
// La dirección "Cinta" llevada al extremo convierte todo en un muro de
// renglones, que es otra forma de que todo pese igual. Aquí el aire está
// repartido a propósito: mucho alrededor del titular y la lámina (la mitad de
// arriba se LEE), y densidad cerrada de la gráfica para abajo (la mitad de
// abajo se ESCANEA).
//
// Regla que se respeta: UNA sola <Lamina> por pantalla. Todo lo demás son
// grupos de filas.

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { View, Text, Pressable, StyleSheet, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, router } from "expo-router";
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
  PiezaTitular,
  COBERTURA_FIABLE,
  comparativoRango,
  utilidadRango,
  mejorHoraRango,
  mejorDiaRango,
  serieVentas,
  topProductos,
  ventasPorDepartamento,
  ventasPorMetodo,
  componerTitular,
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
import BotonYaxo from "@/src/componentes/BotonYaxo";

type Tema = ReturnType<typeof useTema>["tema"];

const RANGOS: {
  id: Rango;
  label: string;
  leyenda: string;
  anterior: string;
  /** Qué se dice cuando todavía no hay periodo anterior con el que comparar. */
  cuandoComparar: string;
}[] = [
  {
    id: "hoy", label: "Hoy", leyenda: "Hoy", anterior: "ayer",
    cuandoComparar: "Mañana ya podré compararte",
  },
  {
    id: "7d", label: "7 días", leyenda: "Últimos 7 días", anterior: "los 7 días previos",
    cuandoComparar: "En unos días ya podré compararte",
  },
  {
    id: "30d", label: "30 días", leyenda: "Últimos 30 días", anterior: "los 30 días previos",
    cuandoComparar: "Con un mes de historia ya podré compararte",
  },
  {
    id: "mes", label: "Este mes", leyenda: "Este mes", anterior: "el mes pasado",
    cuandoComparar: "El mes que viene ya podré compararte",
  },
];

// Etiquetas de método de pago.
//
// Antes esto era `m.metodo === "efectivo" ? "Efectivo" : "Tarjeta"`, y eso
// rotulaba como "Tarjeta" también la transferencia y el crédito — dos métodos
// que el cobro mixto usa a diario. Con un mapa y una caída por defecto, un
// método nuevo aparece con su propio nombre en vez de mentir.
const ETIQUETA_METODO: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  credito: "Crédito",
};
function etiquetaMetodo(metodo: string): string {
  return ETIQUETA_METODO[metodo] ?? metodo.charAt(0).toUpperCase() + metodo.slice(1);
}

/** Cuántos productos y departamentos se pintan antes de resumir el resto.
 *  Con ocho renglones, "Más vendidos" medía más que la gráfica y dejaba de
 *  ser un vistazo para convertirse en una lectura. */
const TOP_VISIBLE = 5;
const DEPTOS_VISIBLES = 6;

/** Opacidades del acento para la barra apilada de métodos de pago. Un solo
 *  color de marca en cuatro intensidades, igual que se hizo en Vender con los
 *  departamentos: cuatro colores distintos serían un segundo sistema de color
 *  que nadie eligió. */
const OPACIDAD_APILADA = [1, 0.62, 0.4, 0.24];

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
  // Las funciones de src/base/reportes.ts exigen el permiso "verReportes"
  // (exigirPermiso, ver permisos.ts) cada una por su cuenta. La pestaña ya
  // está oculta para cajero (_layout.tsx), así que en uso normal esto nunca
  // debería dispararse — pero si alguien llega aquí por otro camino, la
  // pantalla debe decirlo con claridad, no quedarse pensando para siempre.
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
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
    } catch (e: any) {
      // exigirPermiso() lanza Error("Esto solo lo puede hacer ...") — se
      // detecta por el prefijo (igual de fijo que el propio mensaje en
      // permisos.ts) en vez de por texto libre, para no confundir un
      // rechazo de permiso con un fallo real de la base.
      const msg = typeof e?.message === "string" ? e.message : "";
      setError(
        msg.startsWith("Esto solo lo puede hacer")
          ? msg
          : "No se pudieron cargar los reportes. Intenta de nuevo."
      );
    }
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
  // `comp` es null hasta que llega la primera carga. Sin esta distinción,
  // `sinVentas` valía true durante toda la carga inicial y la pantalla
  // enseñaba un instante el estado vacío completo — con su botón "Ir a
  // vender" — antes de rellenarse. Un estado vacío es una AFIRMACIÓN ("no
  // tienes ventas"), y no se puede afirmar algo que todavía no se sabe.
  const cargado = comp !== null;
  const sinVentas = cargado && (resumen?.tickets ?? 0) === 0;

  // ⚠️ TODOS los hooks van ANTES de cualquier return anticipado. Meter un
  // useMemo debajo del `if (error)` rompería las reglas de hooks y tsc NO lo
  // detecta: la app truena en tiempo de ejecución al cambiar de rama.
  const titular = useMemo<PiezaTitular[] | null>(() => {
    if (!comp) return null;
    return componerTitular({
      rango,
      comp,
      utilidad,
      serie,
      etiquetaAnterior: meta.anterior,
      cuandoComparar: meta.cuandoComparar,
      fmt: pesos,
    });
  }, [rango, comp, utilidad, serie, meta]);

  const maxDepto = useMemo(
    () => Math.max(1, ...deptos.map((d) => d.total_centavos)),
    [deptos]
  );
  const totalMetodos = useMemo(
    () => Math.max(1, metodos.reduce((s, m) => s + m.total_centavos, 0)),
    [metodos]
  );
  // Base para los restos: la suma de TODAS las líneas del rango (que es lo
  // que reparten los departamentos), no la suma de lo que se pinta. Con la
  // suma de lo pintado, cinco productos siempre darían el 100% aunque fueran
  // la cuarta parte de la venta.
  const totalLineas = useMemo(
    () => deptos.reduce((s, d) => s + d.total_centavos, 0),
    [deptos]
  );
  const maxTop = useMemo(
    () => Math.max(0, ...top.map((p) => p.total_centavos)),
    [top]
  );
  const restoTop = useMemo(() => {
    const pintado = top.slice(0, TOP_VISIBLE).reduce((s, p) => s + p.total_centavos, 0);
    return Math.max(0, totalLineas - pintado);
  }, [top, totalLineas]);
  const restoDeptos = useMemo(() => {
    return deptos
      .slice(DEPTOS_VISIBLES)
      .reduce((s, d) => s + d.total_centavos, 0);
  }, [deptos]);

  // Pantalla de error propia — nunca el hueco en blanco de una promesa que
  // truena sin avisar. Mismo componente Vacio que ya usa esta pantalla para
  // "sin ventas todavía", así que no es un lenguaje visual nuevo.
  if (error) {
    const esPermiso = error.startsWith("Esto solo lo puede hacer");
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: T.fondo }} edges={["top"]}>
        <Pantalla>
          <Encabezado
            titulo="Reportes"
            meta={esPermiso ? "Acceso restringido" : "No se pudo cargar"}
          />
          <Vacio
            titulo={esPermiso ? "Esto es para el dueño o un gerente" : "No se pudieron cargar los reportes"}
            texto={
              esPermiso
                ? "Si crees que deberías ver esto, pídele a tu dueño o gerente que revise tus permisos."
                : "Vuelve a intentarlo en un momento."
            }
          />
        </Pantalla>
      </SafeAreaView>
    );
  }

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
        {/* Yaxo NO aparece en la pantalla de error de arriba, y es a
            propósito: ese caso es casi siempre falta de permiso
            ("verReportes"), y Yaxo consulta exactamente las mismas funciones
            de reportes.ts — abriría solo para dar el mismo error otra vez.
            Ofrecer una salida que no lleva a ningún lado es peor que no
            ofrecerla.

            `desde="reportes"` ordena primero "¿cómo voy hoy?", "¿cómo va la
            semana?" y "¿estoy cobrando bien?", que es lo que se pregunta
            estando en esta pantalla. */}
        <Encabezado
          titulo="Reportes"
          meta={meta.leyenda}
          acciones={<BotonYaxo desde="reportes" />}
        />

        <SelectorRango rango={rango} onCambio={setRango} />

        {/* ---------------------------------------------------------------
            SIN VENTAS — una salida, no una pantalla de ceros.
            Antes, con el rango vacío, se pintaba la lámina en $0.00 y debajo
            seis secciones vacías. Eso no es "poca información": es ruido que
            se lee como un error de la app.
            --------------------------------------------------------------- */}
        {/* Tres estados, no dos: CARGANDO, sin ventas, y con ventas.
            Mientras no ha llegado la primera respuesta no se pinta nada bajo
            el selector. Es preferible a rellenar el hueco con la lámina en
            $0.00 (una cifra falsa) o con el estado vacío (una afirmación que
            todavía no se puede hacer). */}
        {!cargado ? null : sinVentas ? (
          <Vacio
            titulo={
              rango === "hoy"
                ? "Todavía no vendes nada hoy"
                : "Sin ventas en este periodo"
            }
            texto="En cuanto cobres tu primer ticket, aquí verás cuánto llevas, qué se vende más y a qué hora se te llena la tienda."
            accion={{ texto: "Ir a vender", onPress: () => router.push("/vender") }}
          />
        ) : (
          <>
            {/* -----------------------------------------------------------
                LA LÁMINA — la única protagonista, y ahora también la que
                concluye.
                El titular vivía suelto ENCIMA de esta tarjeta y repetía su
                cifra y su porcentaje: se leía como un texto pegado, no como
                una conclusión. Metido aquí dentro, y con la regla de no
                repetir lo que ya está en cifras, la tarjeta pasa a decir
                "esto vendiste, así te fue y esto significa" en un solo
                bloque.
                ----------------------------------------------------------- */}
            <View style={{ marginBottom: T.esps.xl }}>
              <Lamina>
                <Txt escala="micro" tono="suave" fuerte mayus>
                  Vendido
                </Txt>
                <View style={{ marginTop: T.esps.xs }}>
                  <Monto texto={pesos(resumen?.total_centavos ?? 0)} escala="protagonista" />
                </View>

                <Comparacion comp={comp} etiquetaAnterior={meta.anterior} />

                {/* Devoluciones: si las hay, la resta se explica. Un total que
                    no cuadra con la suma de los tickets sin decir por qué es
                    la clase de detalle que hace desconfiar de toda la
                    pantalla. */}
                {(resumen?.devuelto_centavos ?? 0) > 0 ? (
                  <View style={{ marginTop: T.esps.xs }}>
                    <Txt escala="pie" tono="tenue">
                      Ya descontadas {pesos(resumen!.devuelto_centavos)} en devoluciones
                    </Txt>
                  </View>
                ) : null}

                {titular ? <Titular piezas={titular} T={T} /> : null}

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

            {/* -----------------------------------------------------------
                2. ¿CUÁNTO GANÉ?
                ----------------------------------------------------------- */}
            {utilidad ? (
              <Seccion titulo="Ganancia">
                <Grupo>
                  <Fila
                    titulo="Utilidad"
                    meta={`${utilidad.margenPct.toFixed(1)}% de margen · con el costo del momento en que se vendió`}
                    flecha={false}
                    valor={
                      <Monto
                        texto={pesos(utilidad.utilidad_centavos)}
                        escala="cuerpo"
                        tono={utilidad.utilidad_centavos >= 0 ? "exito" : "peligro"}
                      />
                    }
                  />
                  <Fila
                    titulo="Costo de lo vendido"
                    flecha={false}
                    valor={
                      <Monto texto={pesos(utilidad.costo_centavos)} escala="cuerpo" tono="suave" />
                    }
                  />
                  {/* Cobertura de costo.
                      Un producto sin costo capturado se guarda con costo 0, y
                      para el cálculo eso no significa "no lo sé" sino "me lo
                      regalaron": reporta 100% de margen. Con medio catálogo
                      así, el margen de arriba no es aproximado, es falso hacia
                      arriba. Se dice, y se ofrece el arreglo. */}
                  {utilidad.cobertura < COBERTURA_FIABLE ? (
                    <Fila
                      titulo={`Falta capturar el costo de ${utilidad.productosSinCosto} ${
                        utilidad.productosSinCosto === 1 ? "producto" : "productos"
                      }`}
                      meta={`Tu margen real es mejor que este: solo ${Math.round(
                        utilidad.cobertura * 100
                      )}% de lo vendido tiene costo registrado.`}
                      onPress={() => router.push("/inventario")}
                      valor={
                        <Monto
                          texto={`${Math.round(utilidad.cobertura * 100)}%`}
                          escala="cuerpo"
                          tono="alerta"
                        />
                      }
                    />
                  ) : null}
                </Grupo>
              </Seccion>
            ) : null}

            {/* -----------------------------------------------------------
                3. ¿CÓMO Y CUÁNDO?
                De aquí abajo la pantalla se cierra: se escanea, no se lee.
                ----------------------------------------------------------- */}
            <Seccion titulo={rango === "hoy" ? "Ventas por hora" : "Ventas por día"}>
              <Grafica
                serie={serie}
                mejorHora={mejorHora}
                mejorDia={mejorDia}
                devuelto={resumen?.devuelto_centavos ?? 0}
              />
            </Seccion>

            {/* Más vendidos: CINCO, no ocho, y con barra en vez de renglón.
                Con ocho renglones numerados la sección medía más que la
                gráfica y no se veía de un vistazo cuál pesa: había que leer
                y comparar cifras a mano. Con barra, la proporción se ve sin
                leer. El resto no desaparece — se resume en una línea, que es
                honesto y ocupa un renglón en vez de tres. */}
            {top.length > 0 ? (
              <Seccion titulo="Más vendidos">
                <TarjetaBarras>
                  {top.slice(0, TOP_VISIBLE).map((p, i) => (
                    <BarraDato
                      key={p.nombre}
                      etiqueta={p.nombre}
                      meta={`${Math.round(p.cantidad)} ${
                        Math.round(p.cantidad) === 1 ? "vendido" : "vendidos"
                      }`}
                      monto={pesos(p.total_centavos)}
                      pct={maxTop > 0 ? p.total_centavos / maxTop : 0}
                      color={i === 0 ? T.acento : T.acentoBorde}
                      T={T}
                    />
                  ))}
                  {restoTop > 0 ? (
                    <Txt escala="pie" tono="tenue">
                      Y {pesos(restoTop)} más repartidos en el resto del catálogo.
                    </Txt>
                  ) : null}
                </TarjetaBarras>
              </Seccion>
            ) : null}

            {deptos.length > 0 ? (
              <Seccion titulo="Por departamento">
                <TarjetaBarras>
                  {deptos.slice(0, DEPTOS_VISIBLES).map((d) => (
                    <BarraDato
                      key={d.departamento}
                      etiqueta={d.departamento}
                      monto={pesos(d.total_centavos)}
                      pct={maxDepto > 0 ? d.total_centavos / maxDepto : 0}
                      color={d.color ?? T.acento}
                      T={T}
                    />
                  ))}
                  {restoDeptos > 0 ? (
                    <Txt escala="pie" tono="tenue">
                      Y {pesos(restoDeptos)} más en{" "}
                      {deptos.length - DEPTOS_VISIBLES}{" "}
                      {deptos.length - DEPTOS_VISIBLES === 1
                        ? "departamento"
                        : "departamentos"}{" "}
                      más.
                    </Txt>
                  ) : null}
                </TarjetaBarras>
              </Seccion>
            ) : null}

            {metodos.length > 0 ? (
              <Seccion titulo="Cómo te pagaron">
                <TarjetaBarras>
                  {/* Una sola barra apilada en vez de un porcentaje por
                      renglón: la pregunta real aquí es "¿cuánto de lo mío es
                      efectivo?", y eso es una proporción, no cuatro cifras
                      sueltas que hay que sumar mentalmente. */}
                  <View
                    style={{
                      flexDirection: "row",
                      height: 10,
                      borderRadius: 5,
                      overflow: "hidden",
                      backgroundColor: T.superficie2,
                    }}
                  >
                    {metodos.map((m, i) => (
                      <View
                        key={m.metodo}
                        style={{
                          flex: Math.max(0.0001, m.total_centavos),
                          backgroundColor: T.acento,
                          opacity: OPACIDAD_APILADA[Math.min(i, OPACIDAD_APILADA.length - 1)],
                        }}
                      />
                    ))}
                  </View>
                  {metodos.map((m, i) => (
                    <View
                      key={m.metodo}
                      style={{ flexDirection: "row", alignItems: "center", gap: T.esps.sm }}
                    >
                      <View
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 5,
                          backgroundColor: T.acento,
                          opacity: OPACIDAD_APILADA[Math.min(i, OPACIDAD_APILADA.length - 1)],
                        }}
                      />
                      <View style={{ flex: 1 }}>
                        <Txt escala="pie" lineas={1}>
                          {etiquetaMetodo(m.metodo)}
                        </Txt>
                      </View>
                      <Txt escala="pie" tono="tenue">
                        {Math.round((m.total_centavos / totalMetodos) * 100)}%
                      </Txt>
                      <Monto
                        texto={pesos(m.total_centavos)}
                        escala="pie"
                        estilo={{ marginLeft: T.esps.sm }}
                      />
                    </View>
                  ))}
                </TarjetaBarras>
              </Seccion>
            ) : null}
          </>
        )}
      </Pantalla>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// EL TITULAR — la conclusión, dentro de la lámina
// ---------------------------------------------------------------------------
//
// Se compone de PIEZAS (texto y montos) en vez de un string, porque las cifras
// tienen que salir en IBM Plex Mono como en toda la app. Un <Text> padre
// envuelve los hijos para que la frase fluya y corte de línea como prosa
// normal: con Views en fila, un titular largo se saldría de la pantalla.
//
// Escala "cuerpo" y no "titulo": aquí ya no compite por ser lo primero que se
// lee, porque está DEBAJO de la cifra de 40pt. Su trabajo es cerrar la
// tarjeta, y una frase de tres renglones a 20pt dentro de la lámina le quitaba
// el protagonismo al número. Los montos van en negrita para que la frase tenga
// anclas donde el ojo se detiene.
function Titular({ piezas, T }: { piezas: PiezaTitular[]; T: Tema }) {
  return (
    <View
      style={{
        marginTop: T.esps.md,
        paddingTop: T.esps.md,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: T.borde,
      }}
    >
      <Text style={{ lineHeight: 21 }}>
        {piezas.map((p, i) =>
          p.t === "monto" ? (
            <Monto key={i} texto={p.v} escala="cuerpo" />
          ) : (
            <Txt key={i} escala="cuerpo">
              {p.v}
            </Txt>
          )
        )}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Comparación contra el periodo anterior
// ---------------------------------------------------------------------------
//
// Sigue estando aunque el titular ya suele decirlo: el titular puede haber
// elegido otra rama de la escalera (un pico, una tendencia) y entonces esta
// línea es el único sitio donde aparece la comparación.
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
          {/* Sin "en": las etiquetas ya vienen con su preposición o son
              adverbios ("ayer", "el mes pasado", "los 7 días previos").
              Con "en" delante salía "Sin ventas en ayer para comparar". */}
          Sin ventas {etiquetaAnterior} para comparar
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
// encuentra el día bueno sin leer una sola etiqueta.
//
// NUEVO: una regla horizontal a la altura del promedio de los periodos CON
// venta. Es lo que convierte la gráfica de "unas barras" en información: de un
// vistazo se ve qué días estuvieron arriba y cuáles abajo, sin una sola
// palabra. Se calcula sobre los periodos con venta y no sobre todos, porque
// incluir las horas cerradas hundiría la referencia hasta volverla inútil (a
// las 4 de la mañana no vende nadie, y eso no debería bajar "lo normal").
//
// "Cuándo vendes más" vivía en una sección aparte que decía lo mismo que la
// gráfica con otra forma. Ahora es el pie de esta tarjeta: mismo dato, un
// bloque menos.
function Grafica({
  serie,
  mejorHora,
  mejorDia,
  devuelto,
}: {
  serie: PuntoSerie[];
  mejorHora: MejorHora | null;
  mejorDia: MejorDia | null;
  devuelto: number;
}) {
  const { tema: T } = useTema();
  const max = Math.max(1, ...serie.map((p) => p.total_centavos));
  const muchos = serie.length > 12;
  const cadaCuanto = muchos ? Math.ceil(serie.length / 6) : 1;
  const total = serie.reduce((s, p) => s + p.total_centavos, 0);

  const conVenta = serie.filter((p) => p.total_centavos > 0);
  const referencia =
    conVenta.length >= 3
      ? Math.round(conVenta.reduce((s, p) => s + p.total_centavos, 0) / conVenta.length)
      : 0;

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
      <View style={{ height: 132 }}>
        {/* Regla de referencia, DEBAJO de las barras: si fuera encima
            cortaría cada barra por la mitad y el ojo leería trozos. */}
        {referencia > 0 ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: `${Math.min(96, (referencia / max) * 100)}%`,
              height: StyleSheet.hairlineWidth,
              backgroundColor: T.bordeFuerte,
            }}
          />
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "flex-end", flex: 1, gap: 3 }}>
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
                  {i % cadaCuanto === 0 ? etiquetaEje(p, serie.length) : " "}
                </Txt>
              </View>
            );
          })}
        </View>
      </View>

      <View
        style={{
          marginTop: T.esps.md,
          paddingTop: T.esps.md,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: T.borde,
          gap: T.esps.sm,
        }}
      >
        <LineaPie etiqueta="Pico" valor={pesos(max)} T={T} />
        {referencia > 0 ? (
          <LineaPie
            etiqueta={serie[0]?.diaSemana === null ? "Hora normal" : "Día normal"}
            valor={pesos(referencia)}
            T={T}
          />
        ) : null}
        {mejorHora ? (
          <LineaPie
            etiqueta={`Tu mejor hora · ${mejorHora.hora}:00`}
            valor={pesos(mejorHora.total_centavos)}
            T={T}
          />
        ) : null}
        {mejorDia ? (
          <LineaPie
            etiqueta={`Tu mejor día · ${mejorDia.nombre}`}
            valor={pesos(mejorDia.total_centavos)}
            T={T}
          />
        ) : null}
        {/* La gráfica es BRUTA a propósito (ver cabecera de reportes.ts): una
            devolución ocurre en un momento sin relación con la hora en que se
            vendió. En vez de inventar un valle, se dice. */}
        {devuelto > 0 ? (
          <Txt escala="micro" tono="tenue">
            No incluye {pesos(devuelto)} en devoluciones: se restan del total,
            no de la hora en que se vendió.
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

/** Etiqueta del eje horizontal.
 *
 *  En una semana, "2 sep / 3 sep / 4 sep" obliga a traducir fechas a días para
 *  entender la forma: lo que el tendero quiere ver es que el sábado es su día
 *  fuerte, no qué número era. Con siete barras o menos se usa la inicial del
 *  día, que se lee sin pensar. En 30 días las iniciales se repetirían cuatro
 *  veces y ahí la fecha sí es lo único que distingue una barra de otra. */
const INICIAL_DIA = ["D", "L", "M", "M", "J", "V", "S"];
function etiquetaEje(p: PuntoSerie, largoSerie: number): string {
  if (p.diaSemana !== null && largoSerie <= 7) return INICIAL_DIA[p.diaSemana];
  return p.etiqueta;
}

function LineaPie({
  etiqueta,
  valor,
  T,
}: {
  etiqueta: string;
  valor: string;
  T: Tema;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Txt escala="pie" tono="suave" lineas={1}>
        {etiqueta}
      </Txt>
      <Monto texto={valor} escala="pie" estilo={{ marginLeft: T.esps.sm }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tarjeta de barras — la superficie compartida de la mitad de abajo
// ---------------------------------------------------------------------------
//
// Antes la mitad inferior alternaba lista, barras, lista: tres formas para
// tres preguntas del mismo tipo ("de qué se compone lo que vendí"). Al usar
// la misma tarjeta y la misma barra en las tres, la pantalla se lee como una
// tira continua y no como un cajón de bloques distintos.
function TarjetaBarras({ children }: { children: ReactNode }) {
  const { tema: T } = useTema();
  return (
    <View
      style={{
        backgroundColor: T.superficie,
        borderRadius: T.radio,
        padding: T.esps.lg,
        gap: T.esps.lg,
      }}
    >
      {children}
    </View>
  );
}

function BarraDato({
  etiqueta,
  meta,
  monto,
  pct,
  color,
  T,
}: {
  etiqueta: string;
  meta?: string;
  monto: string;
  /** 0..1 respecto al mayor de la lista. */
  pct: number;
  color: string;
  T: Tema;
}) {
  return (
    <View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          gap: T.esps.sm,
          marginBottom: T.esps.sm,
        }}
      >
        <View style={{ flex: 1 }}>
          <Txt escala="pie" lineas={1}>
            {etiqueta}
          </Txt>
        </View>
        <Monto texto={monto} escala="pie" />
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
            width: `${Math.max(3, Math.min(100, pct * 100))}%`,
            backgroundColor: color,
          }}
        />
      </View>
      {meta ? (
        <Txt escala="micro" tono="tenue" estilo={{ marginTop: 4 }}>
          {meta}
        </Txt>
      ) : null}
    </View>
  );
}
