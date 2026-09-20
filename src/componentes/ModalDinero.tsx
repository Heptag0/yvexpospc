// YvexPOS Móvil — Modal DINERO: la agenda financiera del dueño.
//
// DOS LIBROS intercambiables (negocio / personal). La pantalla que se abre a
// diario no es la de capturar gastos — es la que contesta "¿cómo voy?".
// La captura es el peaje, no el objetivo.
//
// EL PUENTE: un "Retiro para mí" en el negocio aparece solo como ingreso en
// el libro personal. Por eso el libro personal puede decir algo que ninguna
// app de finanzas dice: "tu negocio te dio $12,400 este mes".
//
// ---------------------------------------------------------------------------
// QUÉ CAMBIÓ EN ESTA MIGRACIÓN
// ---------------------------------------------------------------------------
// 1. BORRAR UN MOVIMIENTO O UN GASTO FIJO NO TENÍA NINGUNA CONFIRMACIÓN —
//    ni Alert nativo, ni nada. Un toque en la "×" y desaparecía. En la
//    pantalla de dinero del negocio eso pesa más que en casi cualquier
//    otro lado: se agregaron dos <Hoja> de confirmación, mismo patrón que
//    el resto de la app.
// 2. NUEVE FALLBACKS DEFENSIVOS MUERTOS: `T.alerta ?? "#f59e0b"`,
//    `T.acentoTexto ?? "#fff"`, `T.superficie2 ?? T.superficie`, etc. — con
//    el objeto de tema actual esos campos SIEMPRE existen (no son
//    opcionales), así que el fallback nunca se ejecuta. No era un bug
//    activo, pero sí código que sugiere una incertidumbre que ya no existe;
//    se limpiaron a la referencia directa.
// 3. El botón "+ Movimiento" usaba `T.acento` crudo como fondo en vez de
//    `T.acentoRelleno` — el mismo bug de contraste con acentos claros
//    (como "Perla") que ya se corrigió en toda la app.
// 4. El panel "GANANCIA REAL DE HOY" / "TE SOBRA ESTE MES" pasa a <Lamina>
//    — es exactamente la cifra protagonista que ese componente existe para
//    resaltar (el mismo tratamiento que "Vendido hoy" en Inicio), y antes
//    era una caja con borde de color a la izquierda sin ese peso visual.
// 5. Toda cifra de dinero pasa por <Monto> (Plex Mono tabular) — esta es,
//    con diferencia, la pantalla con más densidad de dinero de toda la
//    app, así que es donde más importa que la regla se cumpla sin excepción.
// 6. BackHandler para el drill-down (panel -> form/fijos/presupuestos).

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { View, TextInput, Pressable, Modal, ScrollView, KeyboardAvoidingView, ActivityIndicator, BackHandler } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, CabeceraModal, Campo, Hoja, Lamina, Txt, Monto, useEstiloInput } from "@/src/componentes/ui";
import BotonYaxo from "@/src/componentes/BotonYaxo";
import { IconoUI } from "@/src/componentes/iconos";
import { pesos } from "@/src/base/formato";
import { turnoActivo, type Turno } from "@/src/base/venta";
import {
  type Ambito,
  type ClaseMov,
  type Movimiento,
  type GastoFijo,
  type ResumenFinanzas,
  CATS_GASTO,
  CATS_INGRESO,
  nombreCategoria,
  hoyYmd,
  resumen,
  listarMovimientos,
  registrarGasto,
  registrarIngreso,
  eliminarGasto,
  eliminarIngreso,
  listarFijos,
  crearFijo,
  eliminarFijo,
  guardarPresupuesto,
} from "@/src/base/finanzas";

type Vista = "panel" | "form" | "fijos" | "presupuestos";

const DIAS_SEM = ["L", "M", "M", "J", "V", "S", "D"];

export default function ModalDinero({ onCerrar }: { onCerrar: () => void }) {
  const { tema: T } = useTema();
  const estiloInput = useEstiloInput();

  const [vista, setVista] = useState<Vista>("panel");
  const [ambito, setAmbito] = useState<Ambito>("negocio");
  const [r, setR] = useState<ResumenFinanzas | null>(null);
  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [fijos, setFijos] = useState<GastoFijo[]>([]);
  const [turno, setTurno] = useState<Turno | null>(null);
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  // --- Formulario ---
  const [clase, setClase] = useState<ClaseMov>("gasto");
  const [monto, setMonto] = useState("");
  const [concepto, setConcepto] = useState("");
  const [categoria, setCategoria] = useState("otro");
  const [fecha, setFecha] = useState(hoyYmd());
  const [efectivo, setEfectivo] = useState(true);
  const [fijoIdPre, setFijoIdPre] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // --- Alta de fijo ---
  const [fjConcepto, setFjConcepto] = useState("");
  const [fjMonto, setFjMonto] = useState("");
  const [fjDia, setFjDia] = useState("");
  const [fjCat, setFjCat] = useState("");

  // --- Presupuestos ---
  const [presuEdit, setPresuEdit] = useState<Record<string, string>>({});

  // --- Confirmaciones de borrado, antes inexistentes ---
  const [porBorrarMov, setPorBorrarMov] = useState<Movimiento | null>(null);
  const [porBorrarFijo, setPorBorrarFijo] = useState<GastoFijo | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const hoy = hoyYmd();
      const mesInicio = hoy.slice(0, 7) + "-01";
      const ultimo = new Date(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)), 0).getDate();
      const mesFin = `${hoy.slice(0, 7)}-${String(ultimo).padStart(2, "0")}`;
      const [res, ms, t] = await Promise.all([
        resumen(ambito, hoy),
        listarMovimientos(ambito, mesInicio, mesFin),
        turnoActivo(),
      ]);
      setR(res);
      setMovs(ms);
      setTurno(t);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setCargando(false);
    }
  }, [ambito]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Atrás del sistema: retrocede al panel en vez de cerrar todo el modal.
  useEffect(() => {
    const alPresionarAtras = () => {
      if (vista !== "panel") {
        if (vista === "fijos") void cargar();
        setVista("panel");
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", alPresionarAtras);
    return () => sub.remove();
  }, [vista, cargar]);

  function abrirForm(pre?: { concepto: string; categoria: string; monto: number; fijoId: string }) {
    setClase("gasto");
    setMonto(pre ? (pre.monto / 100).toFixed(2) : "");
    setConcepto(pre?.concepto ?? "");
    setCategoria(pre?.categoria ?? "otro");
    setFijoIdPre(pre?.fijoId ?? null);
    setFecha(hoyYmd());
    setEfectivo(true);
    setError("");
    setVista("form");
  }

  async function guardar() {
    setError("");
    const v = parseFloat((monto || "0").replace(",", "."));
    if (isNaN(v) || v <= 0) return setError("Escribe cuánto fue.");
    const cent = Math.round(v * 100);
    const conceptoFinal = concepto.trim() || nombreCategoria(ambito, categoria);
    setGuardando(true);
    try {
      if (clase === "ingreso") {
        await registrarIngreso({ ambito, concepto: conceptoFinal, categoria, montoCentavos: cent, fecha });
      } else {
        await registrarGasto({
          ambito,
          concepto: conceptoFinal,
          categoria,
          montoCentavos: cent,
          fecha,
          metodoPago: efectivo ? "efectivo" : "otro",
          gastoFijoId: fijoIdPre,
          // Solo el libro del negocio toca el cajón físico.
          cajaSesionId: efectivo && ambito === "negocio" && turno ? turno.id : null,
        });
      }
      await cargar();
      setVista("panel");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setGuardando(false);
    }
  }

  async function abrirFijos() {
    const lista = CATS_GASTO[ambito].filter((c) => c.id !== "retiro");
    setFjCat(lista[0].id);
    setFjConcepto("");
    setFjMonto("");
    setFjDia("");
    setFijos(await listarFijos(ambito, hoyYmd()));
    setError("");
    setVista("fijos");
  }

  async function agregarFijo() {
    setError("");
    const v = parseFloat((fjMonto || "0").replace(",", "."));
    const dia = parseInt(fjDia || "0", 10);
    if (!fjConcepto.trim()) return setError("Ponle nombre al gasto fijo.");
    if (isNaN(v) || v <= 0) return setError("Escribe cuánto es.");
    if (isNaN(dia) || dia < 1 || dia > 31) return setError("El día debe estar entre 1 y 31.");
    try {
      await crearFijo({
        ambito, concepto: fjConcepto.trim(), categoria: fjCat,
        montoCentavos: Math.round(v * 100), diaMes: dia,
      });
      setFjConcepto(""); setFjMonto(""); setFjDia("");
      setFijos(await listarFijos(ambito, hoyYmd()));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function confirmarBorrarMov() {
    if (!porBorrarMov) return;
    const m = porBorrarMov;
    setPorBorrarMov(null);
    if (m.clase === "ingreso") await eliminarIngreso(m.id);
    else await eliminarGasto(m.id);
    await cargar();
  }

  async function confirmarBorrarFijo() {
    if (!porBorrarFijo) return;
    const f = porBorrarFijo;
    setPorBorrarFijo(null);
    await eliminarFijo(f.id);
    setFijos(await listarFijos(ambito, hoyYmd()));
  }

  function abrirPresupuestos() {
    const actuales: Record<string, string> = {};
    for (const p of r?.presupuestos ?? []) {
      actuales[p.categoria] = (p.limite_centavos / 100).toFixed(2);
    }
    setPresuEdit(actuales);
    setError("");
    setVista("presupuestos");
  }

  async function guardarPresupuestos() {
    setGuardando(true);
    try {
      for (const c of CATS_GASTO[ambito].filter((x) => x.id !== "retiro")) {
        const v = parseFloat((presuEdit[c.id] || "0").replace(",", "."));
        await guardarPresupuesto(ambito, c.id, isNaN(v) ? 0 : Math.round(v * 100));
      }
      await cargar();
      setVista("panel");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setGuardando(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Panel principal
  // ---------------------------------------------------------------------------

  // LOS BLOQUES DE ABAJO SON FUNCIONES, NO COMPONENTES — Y ES A PROPOSITO
  // ------------------------------------------------------------------------
  // Antes eran `function Panel()` y se montaban como `<Panel />`. Al
  // escribir en cualquier campo, cada letra cambiaba el estado, este modal se
  // volvia a renderizar, y JavaScript creaba una funcion `Panel` NUEVA:
  // identica en codigo, distinta en identidad. React lo lee como "otro
  // componente", no como el mismo actualizado: desmonta el subarbol entero y
  // monta uno nuevo. El TextInput con el foco dejaba de existir y Android
  // cerraba el teclado, obligando a teclear letra por letra.
  //
  // Llamandolas como funciones (`renderPanel()`), el JSX queda inlineado
  // en el render del padre: React compara View / TextInput / ScrollView, que
  // son tipos estables. No hay remontaje y el foco sobrevive.
  //
  // Dos reglas para no repetirlo:
  //  1. Ninguna de estas puede usar hooks. Hoy ninguna los usa. Si alguna
  //     llegara a necesitar useState, NO basta con volverla componente
  //     interno otra vez: hay que sacarla a nivel de modulo y pasarle lo que
  //     necesite por props.
  //  2. Al llamarlas dentro de JSX hay que envolverlas en llaves:
  //     {renderPanel()}. Sin llaves, React imprime el texto literal.
  function renderPanel() {
    if (cargando || !r) {
      return <ActivityIndicator color={T.acento} style={{ marginTop: T.esps.xxl }} />;
    }
    if (!r.hay_datos) return renderArranque();

    const esNegocio = ambito === "negocio";
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }}>
        <Banner texto={error} tipo="error" />

        {r.avisos.slice(0, 2).map((a, i) => (
          <View
            key={i}
            style={{
              padding: T.esps.md,
              borderRadius: T.radio,
              borderWidth: 1,
              marginBottom: T.esps.sm,
              borderColor: (a.tono === "peligro" ? T.peligro : T.alerta) + "66",
              backgroundColor: (a.tono === "peligro" ? T.peligro : T.alerta) + "14",
            }}
          >
            <Txt escala="pie" fuerte>{a.titulo}</Txt>
            <Txt escala="micro" tono="tenue" estilo={{ marginTop: 2 }}>{a.detalle}</Txt>
          </View>
        ))}

        {esNegocio ? renderHeroNegocio() : renderHeroPersonal()}

        {renderCalendario()}

        {r.proximos_fijos.length > 0 && (
          <Bloque titulo="Por pagar">
            {r.proximos_fijos.map((f) => (
              <Pressable
                key={f.id}
                style={({ pressed }) => [
                  { flexDirection: "row", alignItems: "center", gap: T.esps.sm, paddingVertical: T.esps.sm, borderBottomWidth: 1, borderBottomColor: T.borde },
                  pressed && { backgroundColor: T.superficie3 },
                ]}
                onPress={() => abrirForm({ concepto: f.concepto, categoria: f.categoria, monto: f.monto_centavos, fijoId: f.id })}
              >
                <Txt escala="micro" tono={f.dias_faltan < 0 ? "peligro" : "tenue"} fuerte estilo={{ minWidth: 48 }}>
                  {f.dias_faltan < 0 ? "Venció" : f.dias_faltan === 0 ? "Hoy" : `En ${f.dias_faltan}d`}
                </Txt>
                <Txt escala="pie" estilo={{ flex: 1 }} lineas={1}>{f.concepto}</Txt>
                <Monto texto={pesos(f.monto_centavos)} escala="pie" />
              </Pressable>
            ))}
          </Bloque>
        )}

        {r.presupuestos.length > 0 && (
          <Bloque titulo="Tus límites del mes">
            {r.presupuestos.map((p) => (
              <View key={p.categoria} style={{ paddingVertical: T.esps.xs }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Txt escala="pie" tono={p.estado === "excedido" ? "peligro" : "principal"} fuerte={p.estado === "excedido"}>
                    {nombreCategoria(ambito, p.categoria)}
                  </Txt>
                  <View style={{ flexDirection: "row", gap: 4 }}>
                    <Monto texto={pesos(p.gastado_centavos)} escala="pie" />
                    <Txt escala="pie" tono="tenue">de {pesos(p.limite_centavos)}</Txt>
                  </View>
                </View>
                <BarraProgreso
                  pct={Math.min(100, p.pct)}
                  color={p.estado === "excedido" ? T.peligro : p.estado === "cerca" ? T.alerta : T.acento}
                />
              </View>
            ))}
          </Bloque>
        )}

        {r.por_categoria.length > 0 && (
          <Bloque titulo="En qué se fue">
            {r.por_categoria.map((c) => (
              <View key={c.categoria} style={{ paddingVertical: T.esps.xs }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Txt escala="pie" tono="tenue">{nombreCategoria(ambito, c.categoria)}</Txt>
                  <View style={{ flexDirection: "row", gap: 4 }}>
                    <Monto texto={pesos(c.total_centavos)} escala="pie" tono="suave" />
                    <Txt escala="micro" tono="tenue">{c.pct}%</Txt>
                  </View>
                </View>
                <BarraProgreso pct={c.pct} color={T.acento} opacidad={0.7} />
              </View>
            ))}
          </Bloque>
        )}

        <Bloque titulo={diaAbierto ? `Movimientos del ${diaAbierto.slice(8)}` : "Últimos movimientos"}>
          {renderMovimientos()}
        </Bloque>

        <View style={{ height: 90 }} />
      </ScrollView>
    );
  }

  // La cifra protagonista de esta pantalla: la ganancia real de hoy (o el
  // balance del mes en el libro personal). Mismo tratamiento "con luz" que
  // "Vendido hoy" en Inicio — antes era una caja con borde de color, sin
  // ese peso visual.
  function renderHeroNegocio() {
    if (!r) return null;
    const gano = r.ganancia_hoy_centavos >= 0;
    const cubierto = r.falta_hoy_centavos <= 0;
    const objetivo = r.ventas_hoy_centavos + r.falta_hoy_centavos;
    const pct = objetivo > 0 ? Math.min(100, Math.round((r.ventas_hoy_centavos / objetivo) * 100)) : 100;
    return (
      <>
        <View style={{ marginBottom: T.esps.md }}>
          <Lamina>
            <Txt escala="micro" tono="suave" fuerte mayus>
              Ganancia real de hoy
            </Txt>
            <View style={{ marginTop: T.esps.xs }}>
              <Monto
                texto={`${gano ? "" : "−"}${pesos(Math.abs(r.ganancia_hoy_centavos))}`}
                escala="protagonista"
                tono={gano ? "exito" : "peligro"}
              />
            </View>
            <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.xs }}>
              Vendiste {pesos(r.ventas_hoy_centavos)} · mercancía {pesos(r.costo_vendido_hoy_centavos)} · gastos{" "}
              {pesos(r.gastos_hoy_centavos)}
            </Txt>
          </Lamina>
        </View>

        <View
          style={{
            borderRadius: T.radio,
            borderWidth: 1,
            borderColor: cubierto ? T.exito + "66" : T.acento + "55",
            backgroundColor: cubierto ? T.exito + "14" : T.acento + "12",
            padding: T.esps.md,
            marginBottom: T.esps.sm,
          }}
        >
          {cubierto ? (
            <>
              <Txt escala="pie" fuerte>Ya cubriste el día ✓</Txt>
              <Txt escala="micro" tono="tenue" estilo={{ marginTop: 3 }}>
                De aquí en adelante, lo que vendas es ganancia.
              </Txt>
            </>
          ) : (
            <>
              <Txt escala="pie" fuerte>Te faltan {pesos(r.falta_hoy_centavos)} de venta</Txt>
              <Txt escala="micro" tono="tenue" estilo={{ marginTop: 3 }}>
                Tener abierto cuesta {pesos(r.costo_diario_centavos)} al día. Con tu margen de{" "}
                {r.margen_pct.toFixed(0)}%, esa es la venta que lo cubre.
              </Txt>
            </>
          )}
          <BarraProgreso pct={pct} color={cubierto ? T.exito : T.acento} estilo={{ marginTop: T.esps.sm }} />
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: T.esps.sm, marginBottom: T.esps.xs }}>
          {renderMini({ lbl: "Ventas del mes", val: pesos(r.ventas_mes_centavos) })}
          {renderMini({ lbl: "Gastos del mes", val: pesos(r.gastos_mes_centavos) })}
          {renderMini({
            lbl: "Ganancia del mes",
            val: (r.ganancia_mes_centavos < 0 ? "−" : "") + pesos(Math.abs(r.ganancia_mes_centavos)),
            tono: r.ganancia_mes_centavos >= 0 ? "exito" : "peligro",
          })}
          {r.retiros_mes_centavos > 0 && renderMini({ lbl: "Sacaste para ti", val: pesos(r.retiros_mes_centavos) })}
        </View>
      </>
    );
  }

  function renderHeroPersonal() {
    if (!r) return null;
    const bien = r.balance_mes_centavos >= 0;
    return (
      <>
        <View style={{ marginBottom: T.esps.md }}>
          <Lamina>
            <Txt escala="micro" tono="suave" fuerte mayus>
              {bien ? "Te sobra este mes" : "Te falta este mes"}
            </Txt>
            <View style={{ marginTop: T.esps.xs }}>
              <Monto
                texto={`${bien ? "" : "−"}${pesos(Math.abs(r.balance_mes_centavos))}`}
                escala="protagonista"
                tono={bien ? "exito" : "peligro"}
              />
            </View>
            <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.xs }}>
              Entró {pesos(r.ingresos_mes_centavos)} · gastaste {pesos(r.gastos_mes_centavos)} · hoy{" "}
              {pesos(r.gastos_hoy_centavos)}
            </Txt>
          </Lamina>
        </View>

        {r.retiros_mes_centavos > 0 && (
          <View
            style={{
              borderRadius: T.radio,
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: T.acento + "66",
              backgroundColor: T.superficie2,
              padding: T.esps.md,
              marginBottom: T.esps.sm,
            }}
          >
            <Txt escala="pie" fuerte>
              Tu negocio te dio {pesos(r.retiros_mes_centavos)} este mes
            </Txt>
            <Txt escala="micro" tono="tenue" estilo={{ marginTop: 3 }}>
              {r.gastos_mes_centavos > r.retiros_mes_centavos
                ? `Llevas ${pesos(r.gastos_mes_centavos)} de gastos personales: ${pesos(r.gastos_mes_centavos - r.retiros_mes_centavos)} más de lo que sacaste.`
                : `Llevas ${pesos(r.gastos_mes_centavos)} de gastos personales. Vas dentro de lo que te dio.`}
            </Txt>
          </View>
        )}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: T.esps.sm, marginBottom: T.esps.xs }}>
          {renderMini({ lbl: "Ingresos del mes", val: pesos(r.ingresos_mes_centavos) })}
          {renderMini({ lbl: "Gastos del mes", val: pesos(r.gastos_mes_centavos) })}
          {renderMini({ lbl: "A este ritmo, el mes", val: pesos(r.proyeccion_mes_centavos) })}
        </View>
      </>
    );
  }

  function renderMini({ lbl, val, tono }: { lbl: string; val: string; tono?: "exito" | "peligro" }) {
    return (
      <View
        style={{
          flexGrow: 1,
          minWidth: "47%",
          padding: T.esps.md,
          borderRadius: T.radio,
          borderWidth: 1,
          borderColor: T.borde,
          backgroundColor: T.superficie,
        }}
      >
        <Txt escala="micro" tono="tenue">{lbl}</Txt>
        <View style={{ marginTop: 2 }}>
          <Monto texto={val} escala="cuerpo" tono={tono} />
        </View>
      </View>
    );
  }

  function renderCalendario() {
    if (!r || r.calendario.length === 0) return null;
    const maxG = Math.max(1, ...r.calendario.map((d) => d.gastos_centavos));
    const primera = new Date(r.calendario[0].fecha + "T12:00:00");
    const offset = (primera.getDay() + 6) % 7;
    const hoyD = Number(hoyYmd().slice(8, 10));
    return (
      <Bloque titulo="Tu mes día por día">
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {DIAS_SEM.map((d, i) => (
            <View key={`dow${i}`} style={{ width: `${100 / 7}%`, padding: 2 }}>
              <Txt escala="micro" tono="tenue" estilo={{ textAlign: "center", fontWeight: "800" }}>{d}</Txt>
            </View>
          ))}
          {Array.from({ length: offset }).map((_, i) => (
            <View key={`v${i}`} style={{ width: `${100 / 7}%`, padding: 2 }} />
          ))}
          {r.calendario.map((d) => {
            const int = d.gastos_centavos > 0 ? Math.max(0.18, d.gastos_centavos / maxG) : 0;
            const esHoy = d.dia === hoyD;
            const sel = diaAbierto === d.fecha;
            return (
              <View key={d.fecha} style={{ width: `${100 / 7}%`, padding: 2 }}>
                <Pressable
                  style={{
                    aspectRatio: 1,
                    borderRadius: T.radioChico,
                    borderWidth: 1,
                    borderColor: sel ? T.acento : esHoy ? T.acento : "transparent",
                    backgroundColor: sel ? T.acento + "22" : T.superficie2,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  onPress={() => setDiaAbierto(sel ? null : d.fecha)}
                >
                  <Txt escala="micro" tono={esHoy ? "acento" : "tenue"} fuerte={esHoy}>{d.dia}</Txt>
                  {int > 0 && (
                    <View
                      style={{
                        position: "absolute", bottom: 4, width: 14, height: 3, borderRadius: 2,
                        backgroundColor: T.peligro, opacity: int,
                      }}
                    />
                  )}
                  {d.fijos_pendientes > 0 && (
                    <View
                      style={{
                        position: "absolute", top: 3, right: 3, width: 5, height: 5, borderRadius: 3,
                        backgroundColor: T.alerta,
                      }}
                    />
                  )}
                </Pressable>
              </View>
            );
          })}
        </View>
      </Bloque>
    );
  }

  function renderMovimientos() {
    const lista = diaAbierto ? movs.filter((m) => m.fecha === diaAbierto) : movs.slice(0, 12);
    if (lista.length === 0) {
      return (
        <Txt escala="pie" tono="tenue" estilo={{ textAlign: "center", paddingVertical: T.esps.md }}>
          {diaAbierto ? "Nada ese día." : "Aún no hay movimientos este mes."}
        </Txt>
      );
    }
    return (
      <>
        {lista.map((m) => (
          <View
            key={m.id}
            style={{ flexDirection: "row", alignItems: "center", gap: T.esps.sm, paddingVertical: T.esps.sm, borderBottomWidth: 1, borderBottomColor: T.borde }}
          >
            <View
              style={{
                width: 24, height: 24, borderRadius: T.radioChico, alignItems: "center", justifyContent: "center",
                backgroundColor: (m.clase === "ingreso" ? T.exito : T.peligro) + "22",
              }}
            >
              <Txt escala="pie" fuerte tono={m.clase === "ingreso" ? "exito" : "peligro"}>
                {m.clase === "ingreso" ? "+" : "−"}
              </Txt>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt escala="pie" fuerte lineas={1}>{m.concepto}</Txt>
              <Txt escala="micro" tono="tenue">{m.fecha} · {nombreCategoria(ambito, m.categoria)}</Txt>
            </View>
            <Monto texto={pesos(m.monto_centavos)} escala="pie" tono={m.clase === "ingreso" ? "exito" : "principal"} />
            <Pressable hitSlop={10} onPress={() => setPorBorrarMov(m)}>
              <Txt escala="titulo" tono="tenue">×</Txt>
            </Pressable>
          </View>
        ))}
      </>
    );
  }

  function renderArranque() {
    const esNegocio = ambito === "negocio";
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }}>
        <View style={{ paddingVertical: T.esps.xl, alignItems: "center" }}>
          <View
            style={{
              width: 56, height: 56, borderRadius: T.radioGrande, marginBottom: T.esps.lg,
              backgroundColor: T.acentoSuave, alignItems: "center", justifyContent: "center",
            }}
          >
            <IconoUI id="dinero" size={28} color={T.acento} />
          </View>
          <Txt escala="titulo" fuerte estilo={{ textAlign: "center", marginBottom: T.esps.md }}>
            {esNegocio ? "¿Tu negocio de verdad gana dinero?" : "¿A dónde se va tu dinero?"}
          </Txt>
          <Txt escala="pie" tono="tenue" estilo={{ textAlign: "center", marginBottom: T.esps.sm }}>
            {esNegocio
              ? "Tu POS ya sabe cuánto vendes y cuánto te cuesta la mercancía. Falta lo demás: la renta, la luz, los sueldos… y lo que sacas para tus cosas."
              : "Aquí llevas tus gastos de casa aparte de los del negocio: la luz de tu casa, la despensa, la escuela. Con lo que sacas del negocio y lo que entra por fuera, sabes si te alcanza."}
          </Txt>
          <Txt escala="pie" tono="tenue" estilo={{ textAlign: "center", marginBottom: T.esps.sm }}>
            Empieza por tus gastos fijos — los que pagas cada mes sin falta. Con eso solo, esta
            pantalla ya te dice {esNegocio ? "cuánto vender al día para no perder" : "cuánto necesitas al mes para vivir"}.
          </Txt>
          <View style={{ gap: T.esps.sm, marginTop: T.esps.lg, alignSelf: "stretch" }}>
            <Boton titulo="Poner mis gastos fijos" onPress={abrirFijos} />
            <Boton titulo="Registrar un movimiento" tipo="secundario" onPress={() => abrirForm()} />
          </View>
        </View>
      </ScrollView>
    );
  }

  // ---------------------------------------------------------------------------
  // Formulario
  // ---------------------------------------------------------------------------

  function renderForm() {
    const cats = clase === "gasto" ? CATS_GASTO[ambito] : CATS_INGRESO[ambito];
    const esRetiro = clase === "gasto" && ambito === "negocio" && categoria === "retiro";
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }} keyboardShouldPersistTaps="handled">
        <Banner texto={error} tipo="error" />
        <Segmentado
          opciones={[{ id: "gasto", label: "Gasto" }, { id: "ingreso", label: "Ingreso" }]}
          valor={clase}
          onCambio={(v) => {
            const c = v as ClaseMov;
            setClase(c);
            const lista = c === "gasto" ? CATS_GASTO[ambito] : CATS_INGRESO[ambito];
            if (!lista.some((x) => x.id === categoria)) setCategoria(lista[lista.length - 1].id);
          }}
        />

        <View style={{ height: T.esps.lg }} />

        <Campo label="¿Cuánto?">
          <TextInput
            style={[estiloInput, { fontFamily: T.fuente.numFuerte, fontSize: 28, textAlign: "center", paddingVertical: T.esps.md }]}
            value={monto}
            onChangeText={setMonto}
            placeholder="0.00"
            placeholderTextColor={T.textoTenue}
            keyboardType="decimal-pad"
            autoFocus
          />
        </Campo>
        <Campo label="¿Qué fue?">
          <TextInput
            style={estiloInput}
            value={concepto}
            onChangeText={setConcepto}
            placeholder="Ej. Recibo de luz, despensa, gasolina"
            placeholderTextColor={T.textoTenue}
          />
        </Campo>

        <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.sm }}>Categoría</Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: T.esps.xs, marginBottom: T.esps.lg }}>
          {cats.map((c) => (
            <Chip
              key={c.id}
              label={c.n}
              activo={categoria === c.id}
              onPress={() => {
                setCategoria(c.id);
                if (!concepto.trim()) setConcepto(c.n);
              }}
            />
          ))}
        </View>

        <Campo label="Fecha" ayuda="Formato AAAA-MM-DD">
          <TextInput
            style={estiloInput}
            value={fecha}
            onChangeText={setFecha}
            placeholder="AAAA-MM-DD"
            placeholderTextColor={T.textoTenue}
            keyboardType="numbers-and-punctuation"
          />
        </Campo>

        {clase === "gasto" && (
          <Pressable
            onPress={() => setEfectivo((v) => !v)}
            style={{ flexDirection: "row", alignItems: "center", gap: T.esps.sm, marginTop: T.esps.sm, marginBottom: T.esps.md }}
          >
            <View
              style={{
                width: 22, height: 22, borderRadius: 6, borderWidth: 1,
                borderColor: efectivo ? T.acentoRelleno : T.borde,
                backgroundColor: efectivo ? T.acentoRelleno : "transparent",
                alignItems: "center", justifyContent: "center",
              }}
            >
              {efectivo && <Txt escala="micro" fuerte estilo={{ color: T.acentoTexto }}>✓</Txt>}
            </View>
            <Txt escala="pie">Se pagó en efectivo</Txt>
          </Pressable>
        )}

        {esRetiro && (
          <Txt escala="micro" tono="tenue" estilo={{ marginTop: T.esps.sm }}>
            Este dinero sale del negocio y entra a tu libro personal — se registra en los dos con
            una sola captura.
          </Txt>
        )}
        {clase === "gasto" && efectivo && ambito === "negocio" && turno && (
          <Txt escala="micro" tono="tenue" estilo={{ marginTop: T.esps.sm }}>
            También se registra la salida del cajón, para que tu corte cuadre. No lo captures dos veces.
          </Txt>
        )}

        <View style={{ marginTop: T.esps.xl }}>
          <Boton titulo="Guardar" onPress={guardar} cargando={guardando} />
        </View>
        <View style={{ height: T.esps.xxl }} />
      </ScrollView>
    );
  }

  // ---------------------------------------------------------------------------
  // Gastos fijos
  // ---------------------------------------------------------------------------

  function renderFijos() {
    const total = fijos.reduce((s, f) => s + f.monto_centavos, 0);
    const cats = CATS_GASTO[ambito].filter((c) => c.id !== "retiro");
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }} keyboardShouldPersistTaps="handled">
        <Banner texto={error} tipo="error" />
        <Txt escala="pie" tono="tenue" estilo={{ textAlign: "center", marginBottom: T.esps.md }}>
          Lo que pagas cada mes sin falta. Regístralos una vez y esta pantalla te avisa antes de
          que venzan.
        </Txt>
        {total > 0 && (
          <View
            style={{
              padding: T.esps.md, borderRadius: T.radio, borderWidth: 1,
              borderColor: T.acento + "55", backgroundColor: T.acentoSuave, marginBottom: T.esps.md,
            }}
          >
            <Txt escala="pie">
              {ambito === "negocio" ? "Tu negocio cuesta " : "Tu vida cuesta "}
              <Monto texto={pesos(total)} escala="pie" fuerte />
              {" al mes · "}
              <Monto texto={pesos(Math.round(total / 30))} escala="pie" fuerte />
              {" al día"}
            </Txt>
          </View>
        )}

        {fijos.length === 0 ? (
          <Txt escala="pie" tono="tenue" estilo={{ textAlign: "center", paddingVertical: T.esps.md }}>
            Aún no tienes gastos fijos aquí.
          </Txt>
        ) : (
          fijos.map((f) => (
            <View
              key={f.id}
              style={{
                flexDirection: "row", alignItems: "center", gap: T.esps.sm, paddingVertical: T.esps.sm,
                borderBottomWidth: 1, borderBottomColor: T.borde, opacity: f.pagado_este_mes ? 0.5 : 1,
              }}
            >
              <View style={{ width: 30, height: 30, borderRadius: T.radioChico, backgroundColor: T.superficie3, alignItems: "center", justifyContent: "center" }}>
                <Txt escala="micro" tono="tenue" fuerte>{f.dia_mes}</Txt>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt escala="pie" fuerte lineas={1}>{f.concepto}</Txt>
                <Txt escala="micro" tono="tenue">
                  {nombreCategoria(ambito, f.categoria)}{f.pagado_este_mes ? " · pagado ✓" : ""}
                </Txt>
              </View>
              <Monto texto={pesos(f.monto_centavos)} escala="pie" />
              <Pressable hitSlop={10} onPress={() => setPorBorrarFijo(f)}>
                <Txt escala="titulo" tono="tenue">×</Txt>
              </Pressable>
            </View>
          ))
        )}

        <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginTop: T.esps.lg, marginBottom: T.esps.sm }}>
          Agregar uno nuevo
        </Txt>
        <TextInput
          style={[estiloInput, { marginBottom: T.esps.sm }]}
          value={fjConcepto}
          onChangeText={setFjConcepto}
          placeholder={ambito === "negocio" ? "Ej. Renta del local" : "Ej. Renta de la casa"}
          placeholderTextColor={T.textoTenue}
        />
        <View style={{ flexDirection: "row", gap: T.esps.sm, marginBottom: T.esps.md }}>
          <TextInput
            style={[estiloInput, { flex: 2 }]}
            value={fjMonto}
            onChangeText={setFjMonto}
            placeholder="0.00"
            placeholderTextColor={T.textoTenue}
            keyboardType="decimal-pad"
          />
          <TextInput
            style={[estiloInput, { flex: 1 }]}
            value={fjDia}
            onChangeText={setFjDia}
            placeholder="Día"
            placeholderTextColor={T.textoTenue}
            keyboardType="number-pad"
          />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: T.esps.xs }}>
          {cats.map((c) => (
            <Chip key={c.id} label={c.n} activo={fjCat === c.id} onPress={() => setFjCat(c.id)} />
          ))}
        </View>
        <View style={{ marginTop: T.esps.md }}>
          <Boton titulo="Agregar gasto fijo" tipo="secundario" onPress={agregarFijo} />
        </View>
        <View style={{ height: T.esps.xxl }} />
      </ScrollView>
    );
  }

  // ---------------------------------------------------------------------------
  // Presupuestos
  // ---------------------------------------------------------------------------

  function renderPresupuestos() {
    const cats = CATS_GASTO[ambito].filter((c) => c.id !== "retiro");
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }} keyboardShouldPersistTaps="handled">
        <Banner texto={error} tipo="error" />
        <Txt escala="pie" tono="tenue" estilo={{ textAlign: "center", marginBottom: T.esps.md }}>
          Ponle un tope a lo que quieres gastar por categoría. Cuando te acerques, te aviso — sin
          un límite tuyo, cualquier aviso sería una opinión mía, no un dato tuyo.
        </Txt>
        {cats.map((c) => (
          <View key={c.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: T.esps.md, marginBottom: T.esps.sm }}>
            <Txt escala="pie" estilo={{ flex: 1 }}>{c.n}</Txt>
            <TextInput
              style={[estiloInput, { width: 120, textAlign: "right" }]}
              value={presuEdit[c.id] ?? ""}
              onChangeText={(v) => setPresuEdit((p) => ({ ...p, [c.id]: v }))}
              placeholder="Sin límite"
              placeholderTextColor={T.textoTenue}
              keyboardType="decimal-pad"
            />
          </View>
        ))}
        <View style={{ marginTop: T.esps.lg }}>
          <Boton titulo="Guardar límites" onPress={guardarPresupuestos} cargando={guardando} />
        </View>
        <View style={{ height: T.esps.xxl }} />
      </ScrollView>
    );
  }

  // ---------------------------------------------------------------------------

  const cab = (() => {
    switch (vista) {
      case "form": return { titulo: "Nuevo movimiento", izq: "Atrás", onIzq: () => setVista("panel") };
      case "fijos": return { titulo: "Gastos fijos", izq: "Atrás", onIzq: () => { setVista("panel"); void cargar(); } };
      case "presupuestos": return { titulo: "Tus límites", izq: "Atrás", onIzq: () => setVista("panel") };
      default: return { titulo: "Dinero", izq: "Listo", onIzq: onCerrar };
    }
  })();

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={{ flex: 1, backgroundColor: T.fondo }}>
        <KeyboardAvoidingView style={{ flex: 1 }} // "padding" en las DOS plataformas.
              //
              // Antes: Platform.OS === "ios" ? "padding" : undefined. En
              // Android eso era literalmente NINGUNA evitación de teclado. Era
              // correcto cuando `softwareKeyboardLayoutMode: "resize"`
              // redimensionaba la ventana, pero con `edgeToEdgeEnabled: true`
              // la ventana ya no se encoge: la app dibuja por debajo del
              // teclado, y los campos quedaban tapados.
              //
              // NO "height", que es la otra tentación: anima la altura del
              // contenedor y pelea con la animación del sistema, así que el
              // contenido rebota al cerrarse el teclado. Ya se probó.
              behavior="padding">
          <CabeceraModal
            titulo={cab.titulo}
            izquierda={cab.izq}
            onIzquierda={cab.onIzq}
            /* Acceso a Yaxo SOLO en el panel: dentro de un formulario de gasto
               el hueco derecho es de "Guardar", y quitárselo para poner al
               asistente sería cambiar una acción por una consulta.

               CIERRA DINERO ANTES DE ABRIR. No es un capricho: este modal se
               dibuja por encima de la vista raíz, y la pantalla de Yaxo se
               carga dentro de ella. Sin cerrar, el usuario tocaría el botón y
               no pasaría nada visible.

               Efecto secundario que conviene conocer: al volver de Yaxo se
               aterriza en Inicio, no en Dinero. Es de donde se abrió Dinero,
               así que coincide con el camino de vuelta de siempre, pero se
               pierde el ámbito (negocio/personal) que estuviera elegido. */
            derechaNodo={
              vista === "panel" ? <BotonYaxo desde="dinero" size={26} antesDeAbrir={onCerrar} /> : undefined
            }
          />

          {vista === "panel" && (
            <View style={{ flexDirection: "row", gap: T.esps.sm, paddingHorizontal: T.esp, paddingBottom: T.esps.xs }}>
              {(["negocio", "personal"] as Ambito[]).map((a) => {
                const activo = ambito === a;
                return (
                  <Pressable
                    key={a}
                    style={{
                      flex: 1, padding: T.esps.md, borderRadius: T.radio, borderWidth: 1,
                      borderColor: activo ? T.acento : T.borde,
                      backgroundColor: activo ? T.acento + "18" : T.superficie,
                    }}
                    onPress={() => { setAmbito(a); setDiaAbierto(null); }}
                  >
                    <Txt escala="pie" fuerte>{a === "negocio" ? "Mi negocio" : "Personal"}</Txt>
                    <Txt escala="micro" tono="tenue" estilo={{ marginTop: 1 }}>
                      {a === "negocio" ? "Local y mercancía" : "Casa y tus gastos"}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
          )}

          {vista === "panel" && renderPanel()}
          {vista === "form" && renderForm()}
          {vista === "fijos" && renderFijos()}
          {vista === "presupuestos" && renderPresupuestos()}

          {vista === "panel" && r?.hay_datos && (
            <View
              style={{
                flexDirection: "row", gap: T.esps.sm, padding: T.esp,
                borderTopWidth: 1, borderTopColor: T.borde, backgroundColor: T.superficie,
              }}
            >
              <Pressable
                onPress={abrirFijos}
                style={{ paddingHorizontal: T.esps.lg, paddingVertical: T.esps.md, borderRadius: T.radio, borderWidth: 1, borderColor: T.borde, justifyContent: "center" }}
              >
                <Txt escala="pie" tono="tenue" fuerte>Fijos</Txt>
              </Pressable>
              <Pressable
                onPress={abrirPresupuestos}
                style={{ paddingHorizontal: T.esps.lg, paddingVertical: T.esps.md, borderRadius: T.radio, borderWidth: 1, borderColor: T.borde, justifyContent: "center" }}
              >
                <Txt escala="pie" tono="tenue" fuerte>Límites</Txt>
              </Pressable>
              <Pressable
                onPress={() => abrirForm()}
                style={{ flex: 1, paddingVertical: T.esps.md, borderRadius: T.radio, backgroundColor: T.acentoRelleno, alignItems: "center", justifyContent: "center" }}
              >
                <Txt escala="pie" fuerte estilo={{ color: T.acentoTexto }}>+ Movimiento</Txt>
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Confirmaciones de borrado: antes NO existían — ni Alert ni hoja
          propia. Un toque en la "×" y el movimiento o el gasto fijo
          desaparecía sin poder arrepentirte. */}
      <Hoja
        visible={porBorrarMov !== null}
        onCerrar={() => setPorBorrarMov(null)}
        titulo="Eliminar movimiento"
        pie={
          <View style={{ gap: T.esps.sm }}>
            <Boton titulo="Eliminar" tipo="peligro" onPress={confirmarBorrarMov} />
            <Boton titulo="Cancelar" tipo="secundario" onPress={() => setPorBorrarMov(null)} />
          </View>
        }
      >
        <Txt escala="pie" tono="suave">
          {porBorrarMov ? `¿Eliminar "${porBorrarMov.concepto}" de ${pesos(porBorrarMov.monto_centavos)}?` : ""}
        </Txt>
      </Hoja>

      <Hoja
        visible={porBorrarFijo !== null}
        onCerrar={() => setPorBorrarFijo(null)}
        titulo="Eliminar gasto fijo"
        pie={
          <View style={{ gap: T.esps.sm }}>
            <Boton titulo="Eliminar" tipo="peligro" onPress={confirmarBorrarFijo} />
            <Boton titulo="Cancelar" tipo="secundario" onPress={() => setPorBorrarFijo(null)} />
          </View>
        }
      >
        <Txt escala="pie" tono="suave">
          {porBorrarFijo ? `¿Eliminar "${porBorrarFijo.concepto}"? Ya no te avisaré antes de que venza.` : ""}
        </Txt>
      </Hoja>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Piezas locales
// ---------------------------------------------------------------------------

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  const { tema: T } = useTema();
  return (
    <View style={{ backgroundColor: T.superficie, borderRadius: T.radio, borderWidth: 1, borderColor: T.borde, padding: T.esps.md, marginTop: T.esps.sm }}>
      <Txt escala="micro" tono="tenue" fuerte mayus estilo={{ marginBottom: T.esps.sm }}>{titulo}</Txt>
      {children}
    </View>
  );
}

function BarraProgreso({
  pct,
  color,
  opacidad,
  estilo,
}: {
  pct: number;
  color: string;
  opacidad?: number;
  estilo?: object;
}) {
  const { tema: T } = useTema();
  return (
    <View style={[{ height: 5, borderRadius: 3, backgroundColor: T.superficie3, marginTop: 5, overflow: "hidden" }, estilo]}>
      <View style={{ height: 5, borderRadius: 3, width: `${pct}%`, backgroundColor: color, opacity: opacidad ?? 1 }} />
    </View>
  );
}

function Segmentado({
  opciones,
  valor,
  onCambio,
}: {
  opciones: { id: string; label: string }[];
  valor: string;
  onCambio: (v: string) => void;
}) {
  const { tema: T } = useTema();
  return (
    <View style={{ flexDirection: "row", backgroundColor: T.superficie2, borderRadius: T.radio, padding: 3 }}>
      {opciones.map((o) => {
        const activo = valor === o.id;
        return (
          <Pressable
            key={o.id}
            onPress={() => onCambio(o.id)}
            style={{
              flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center",
              borderRadius: T.radioChico, backgroundColor: activo ? T.acentoRelleno : "transparent",
            }}
          >
            <Txt escala="pie" fuerte={activo} tono="suave" estilo={activo ? { color: T.acentoTexto } : undefined}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

function Chip({ label, activo, onPress }: { label: string; activo: boolean; onPress: () => void }) {
  const { tema: T } = useTema();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: T.esps.md, paddingVertical: T.esps.sm, borderRadius: T.radioPildora,
        borderWidth: 1, borderColor: activo ? T.acentoRelleno : T.borde,
        backgroundColor: activo ? T.acentoRelleno : T.superficie,
      }}
    >
      <Txt escala="pie" fuerte={activo} tono={activo ? "principal" : "suave"} estilo={activo ? { color: T.acentoTexto } : undefined}>
        {label}
      </Txt>
    </Pressable>
  );
}
