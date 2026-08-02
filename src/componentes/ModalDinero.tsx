// YvexPOS Móvil — Modal DINERO: la agenda financiera del dueño.
//
// DOS LIBROS intercambiables (negocio / personal). La pantalla que se abre a
// diario no es la de capturar gastos — es la que contesta "¿cómo voy?".
// La captura es el peaje, no el objetivo.
//
// EL PUENTE: un "Retiro para mí" en el negocio aparece solo como ingreso en
// el libro personal. Por eso el libro personal puede decir algo que ninguna
// app de finanzas dice: "tu negocio te dio $12,400 este mes".

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, CabeceraModal, Campo, useEstiloInput } from "@/src/componentes/ui";
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

type Tema = ReturnType<typeof useTema>["tema"];
type Vista = "panel" | "form" | "fijos" | "presupuestos";

const DIAS_SEM = ["L", "M", "M", "J", "V", "S", "D"];

export default function ModalDinero({ onCerrar }: { onCerrar: () => void }) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
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

  function Panel() {
    if (cargando || !r) {
      return <ActivityIndicator color={T.acento} style={{ marginTop: 40 }} />;
    }
    if (!r.hay_datos) return <Arranque />;

    const esNegocio = ambito === "negocio";
    return (
      <ScrollView contentContainerStyle={est.cuerpo}>
        <Banner texto={error} tipo="error" />

        {r.avisos.slice(0, 2).map((a, i) => (
          <View key={i} style={[est.aviso, a.tono === "peligro" ? est.avisoPeligro : est.avisoAlerta]}>
            <Text style={est.avisoTitulo}>{a.titulo}</Text>
            <Text style={est.avisoDetalle}>{a.detalle}</Text>
          </View>
        ))}

        {esNegocio ? <HeroNegocio /> : <HeroPersonal />}

        <Calendario />

        {r.proximos_fijos.length > 0 && (
          <View style={est.bloque}>
            <Text style={est.bloqueTitulo}>POR PAGAR</Text>
            {r.proximos_fijos.map((f) => (
              <Pressable
                key={f.id}
                style={({ pressed }) => [est.prox, pressed && { backgroundColor: T.superficie3 }]}
                onPress={() => abrirForm({ concepto: f.concepto, categoria: f.categoria, monto: f.monto_centavos, fijoId: f.id })}
              >
                <Text style={[est.proxDia, f.dias_faltan < 0 && { color: T.peligro }]}>
                  {f.dias_faltan < 0 ? "Venció" : f.dias_faltan === 0 ? "Hoy" : `En ${f.dias_faltan}d`}
                </Text>
                <Text style={est.proxConcepto} numberOfLines={1}>{f.concepto}</Text>
                <Text style={est.proxMonto}>{pesos(f.monto_centavos)}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {r.presupuestos.length > 0 && (
          <View style={est.bloque}>
            <Text style={est.bloqueTitulo}>TUS LÍMITES DEL MES</Text>
            {r.presupuestos.map((p) => (
              <View key={p.categoria} style={{ paddingVertical: 7 }}>
                <View style={est.filaEntre}>
                  <Text style={[est.presuCat, p.estado === "excedido" && { color: T.peligro, fontWeight: "800" }]}>
                    {nombreCategoria(ambito, p.categoria)}
                  </Text>
                  <Text style={est.presuVal}>
                    {pesos(p.gastado_centavos)} <Text style={{ color: T.textoTenue }}>de {pesos(p.limite_centavos)}</Text>
                  </Text>
                </View>
                <View style={est.barraFondo}>
                  <View style={[
                    est.barraRelleno,
                    { width: `${Math.min(100, p.pct)}%` },
                    p.estado === "cerca" && { backgroundColor: T.alerta ?? "#f59e0b" },
                    p.estado === "excedido" && { backgroundColor: T.peligro },
                  ]} />
                </View>
              </View>
            ))}
          </View>
        )}

        {r.por_categoria.length > 0 && (
          <View style={est.bloque}>
            <Text style={est.bloqueTitulo}>EN QUÉ SE FUE</Text>
            {r.por_categoria.map((c) => (
              <View key={c.categoria} style={{ paddingVertical: 6 }}>
                <View style={est.filaEntre}>
                  <Text style={est.catNombre}>{nombreCategoria(ambito, c.categoria)}</Text>
                  <Text style={est.catMonto}>{pesos(c.total_centavos)} <Text style={{ color: T.textoTenue, fontSize: 11 }}>{c.pct}%</Text></Text>
                </View>
                <View style={est.barraFondo}>
                  <View style={[est.barraRelleno, { width: `${c.pct}%`, opacity: 0.7 }]} />
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={est.bloque}>
          <Text style={est.bloqueTitulo}>
            {diaAbierto ? `MOVIMIENTOS DEL ${diaAbierto.slice(8)}` : "ÚLTIMOS MOVIMIENTOS"}
          </Text>
          <Movimientos />
        </View>

        <View style={{ height: 90 }} />
      </ScrollView>
    );
  }

  function HeroNegocio() {
    if (!r) return null;
    const gano = r.ganancia_hoy_centavos >= 0;
    const cubierto = r.falta_hoy_centavos <= 0;
    const objetivo = r.ventas_hoy_centavos + r.falta_hoy_centavos;
    const pct = objetivo > 0 ? Math.min(100, Math.round((r.ventas_hoy_centavos / objetivo) * 100)) : 100;
    return (
      <>
        <View style={[est.hero, { borderLeftColor: gano ? T.exito : T.peligro }]}>
          <Text style={est.heroLbl}>GANANCIA REAL DE HOY</Text>
          <Text style={[est.heroNum, { color: gano ? T.exito : T.peligro }]}>
            {gano ? "" : "−"}{pesos(Math.abs(r.ganancia_hoy_centavos))}
          </Text>
          <Text style={est.heroDesglose}>
            Vendiste <Text style={est.heroB}>{pesos(r.ventas_hoy_centavos)}</Text> · mercancía{" "}
            <Text style={est.heroB}>{pesos(r.costo_vendido_hoy_centavos)}</Text> · gastos{" "}
            <Text style={est.heroB}>{pesos(r.gastos_hoy_centavos)}</Text>
          </Text>
        </View>
        <View style={[est.equilibrio, cubierto && { borderColor: T.exito + "66", backgroundColor: T.exito + "14" }]}>
          {cubierto ? (
            <>
              <Text style={est.eqTitulo}>Ya cubriste el día ✓</Text>
              <Text style={est.eqSub}>De aquí en adelante, lo que vendas es ganancia.</Text>
            </>
          ) : (
            <>
              <Text style={est.eqTitulo}>Te faltan {pesos(r.falta_hoy_centavos)} de venta</Text>
              <Text style={est.eqSub}>
                Tener abierto cuesta {pesos(r.costo_diario_centavos)} al día. Con tu margen de{" "}
                {r.margen_pct.toFixed(0)}%, esa es la venta que lo cubre.
              </Text>
            </>
          )}
          <View style={[est.barraFondo, { marginTop: 10 }]}>
            <View style={[est.barraRelleno, { width: `${pct}%` }, cubierto && { backgroundColor: T.exito }]} />
          </View>
        </View>
        <View style={est.minis}>
          <Mini lbl="Ventas del mes" val={pesos(r.ventas_mes_centavos)} />
          <Mini lbl="Gastos del mes" val={pesos(r.gastos_mes_centavos)} />
          <Mini
            lbl="Ganancia del mes"
            val={(r.ganancia_mes_centavos < 0 ? "−" : "") + pesos(Math.abs(r.ganancia_mes_centavos))}
            color={r.ganancia_mes_centavos >= 0 ? T.exito : T.peligro}
          />
          {r.retiros_mes_centavos > 0 && <Mini lbl="Sacaste para ti" val={pesos(r.retiros_mes_centavos)} />}
        </View>
      </>
    );
  }

  function HeroPersonal() {
    if (!r) return null;
    const bien = r.balance_mes_centavos >= 0;
    return (
      <>
        <View style={[est.hero, { borderLeftColor: bien ? T.exito : T.peligro }]}>
          <Text style={est.heroLbl}>{bien ? "TE SOBRA ESTE MES" : "TE FALTA ESTE MES"}</Text>
          <Text style={[est.heroNum, { color: bien ? T.exito : T.peligro }]}>
            {bien ? "" : "−"}{pesos(Math.abs(r.balance_mes_centavos))}
          </Text>
          <Text style={est.heroDesglose}>
            Entró <Text style={est.heroB}>{pesos(r.ingresos_mes_centavos)}</Text> · gastaste{" "}
            <Text style={est.heroB}>{pesos(r.gastos_mes_centavos)}</Text> · hoy{" "}
            <Text style={est.heroB}>{pesos(r.gastos_hoy_centavos)}</Text>
          </Text>
        </View>
        {r.retiros_mes_centavos > 0 && (
          <View style={est.puente}>
            <Text style={est.puenteTitulo}>
              Tu negocio te dio {pesos(r.retiros_mes_centavos)} este mes
            </Text>
            <Text style={est.puenteSub}>
              {r.gastos_mes_centavos > r.retiros_mes_centavos
                ? `Llevas ${pesos(r.gastos_mes_centavos)} de gastos personales: ${pesos(r.gastos_mes_centavos - r.retiros_mes_centavos)} más de lo que sacaste.`
                : `Llevas ${pesos(r.gastos_mes_centavos)} de gastos personales. Vas dentro de lo que te dio.`}
            </Text>
          </View>
        )}
        <View style={est.minis}>
          <Mini lbl="Ingresos del mes" val={pesos(r.ingresos_mes_centavos)} />
          <Mini lbl="Gastos del mes" val={pesos(r.gastos_mes_centavos)} />
          <Mini lbl="A este ritmo, el mes" val={pesos(r.proyeccion_mes_centavos)} />
        </View>
      </>
    );
  }

  function Mini({ lbl, val, color }: { lbl: string; val: string; color?: string }) {
    return (
      <View style={est.mini}>
        <Text style={est.miniLbl}>{lbl}</Text>
        <Text style={[est.miniVal, color ? { color } : null]}>{val}</Text>
      </View>
    );
  }

  function Calendario() {
    if (!r || r.calendario.length === 0) return null;
    const maxG = Math.max(1, ...r.calendario.map((d) => d.gastos_centavos));
    const primera = new Date(r.calendario[0].fecha + "T12:00:00");
    const offset = (primera.getDay() + 6) % 7;
    const hoyD = Number(hoyYmd().slice(8, 10));
    return (
      <View style={est.bloque}>
        <Text style={est.bloqueTitulo}>TU MES DÍA POR DÍA</Text>
        <View style={est.cal}>
          {DIAS_SEM.map((d, i) => (
            <View key={`dow${i}`} style={est.calCelda}>
              <Text style={est.calDow}>{d}</Text>
            </View>
          ))}
          {Array.from({ length: offset }).map((_, i) => (
            <View key={`v${i}`} style={est.calCelda} />
          ))}
          {r.calendario.map((d) => {
            const int = d.gastos_centavos > 0 ? Math.max(0.18, d.gastos_centavos / maxG) : 0;
            const esHoy = d.dia === hoyD;
            const sel = diaAbierto === d.fecha;
            return (
              <View key={d.fecha} style={est.calCelda}>
                <Pressable
                  style={[
                    est.calDia,
                    esHoy && { borderColor: T.acento },
                    sel && { backgroundColor: T.acento + "22", borderColor: T.acento },
                  ]}
                  onPress={() => setDiaAbierto(sel ? null : d.fecha)}
                >
                  <Text style={[est.calNum, esHoy && { color: T.acento }]}>{d.dia}</Text>
                  {int > 0 && (
                    <View style={[est.calPunto, { backgroundColor: T.peligro, opacity: int }]} />
                  )}
                  {d.fijos_pendientes > 0 && <View style={[est.calFijo, { backgroundColor: T.alerta ?? "#f59e0b" }]} />}
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>
    );
  }

  function Movimientos() {
    const lista = diaAbierto ? movs.filter((m) => m.fecha === diaAbierto) : movs.slice(0, 12);
    if (lista.length === 0) {
      return <Text style={est.vacioChico}>{diaAbierto ? "Nada ese día." : "Aún no hay movimientos este mes."}</Text>;
    }
    return (
      <>
        {lista.map((m) => (
          <View key={m.id} style={est.mov}>
            <View style={[est.movSigno, { backgroundColor: (m.clase === "ingreso" ? T.exito : T.peligro) + "22" }]}>
              <Text style={{ color: m.clase === "ingreso" ? T.exito : T.peligro, fontWeight: "800", fontSize: 14 }}>
                {m.clase === "ingreso" ? "+" : "−"}
              </Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={est.movConcepto} numberOfLines={1}>{m.concepto}</Text>
              <Text style={est.movMeta}>{m.fecha} · {nombreCategoria(ambito, m.categoria)}</Text>
            </View>
            <Text style={[est.movMonto, m.clase === "ingreso" && { color: T.exito }]}>
              {pesos(m.monto_centavos)}
            </Text>
            <Pressable
              hitSlop={10}
              onPress={async () => {
                if (m.clase === "ingreso") await eliminarIngreso(m.id);
                else await eliminarGasto(m.id);
                await cargar();
              }}
            >
              <Text style={{ color: T.textoTenue, fontSize: 18 }}>×</Text>
            </Pressable>
          </View>
        ))}
      </>
    );
  }

  function Arranque() {
    const esNegocio = ambito === "negocio";
    return (
      <ScrollView contentContainerStyle={est.cuerpo}>
        <View style={est.arranque}>
          <View style={est.arranqueIco}>
            <IconoUI id="dinero" size={28} color={T.acento} />
          </View>
          <Text style={est.arranqueH}>
            {esNegocio ? "¿Tu negocio de verdad gana dinero?" : "¿A dónde se va tu dinero?"}
          </Text>
          <Text style={est.arranqueP}>
            {esNegocio
              ? "Tu POS ya sabe cuánto vendes y cuánto te cuesta la mercancía. Falta lo demás: la renta, la luz, los sueldos… y lo que sacas para tus cosas."
              : "Aquí llevas tus gastos de casa aparte de los del negocio: la luz de tu casa, la despensa, la escuela. Con lo que sacas del negocio y lo que entra por fuera, sabes si te alcanza."}
          </Text>
          <Text style={est.arranqueP}>
            Empieza por tus gastos fijos — los que pagas cada mes sin falta. Con eso solo, esta
            pantalla ya te dice {esNegocio ? "cuánto vender al día para no perder" : "cuánto necesitas al mes para vivir"}.
          </Text>
          <View style={{ gap: 10, marginTop: 20 }}>
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

  function Form() {
    const cats = clase === "gasto" ? CATS_GASTO[ambito] : CATS_INGRESO[ambito];
    const esRetiro = clase === "gasto" && ambito === "negocio" && categoria === "retiro";
    return (
      <ScrollView contentContainerStyle={est.cuerpo} keyboardShouldPersistTaps="handled">
        <Banner texto={error} tipo="error" />
        <View style={est.claseSel}>
          {(["gasto", "ingreso"] as ClaseMov[]).map((c) => (
            <Pressable
              key={c}
              style={[est.claseBtn, clase === c && { backgroundColor: T.acento }]}
              onPress={() => {
                setClase(c);
                const lista = c === "gasto" ? CATS_GASTO[ambito] : CATS_INGRESO[ambito];
                if (!lista.some((x) => x.id === categoria)) setCategoria(lista[lista.length - 1].id);
              }}
            >
              <Text style={[est.claseTxt, clase === c && { color: T.acentoTexto ?? "#fff" }]}>
                {c === "gasto" ? "Gasto" : "Ingreso"}
              </Text>
            </Pressable>
          ))}
        </View>

        <Campo label="¿Cuánto?">
          <TextInput
            style={[estiloInput, est.montoInput]}
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

        <Text style={est.bloqueTitulo}>CATEGORÍA</Text>
        <View style={est.chips}>
          {cats.map((c) => (
            <Pressable
              key={c.id}
              style={[est.chip, categoria === c.id && { backgroundColor: T.acento, borderColor: T.acento }]}
              onPress={() => {
                setCategoria(c.id);
                if (!concepto.trim()) setConcepto(c.n);
              }}
            >
              <Text style={[est.chipTxt, categoria === c.id && { color: T.acentoTexto ?? "#fff", fontWeight: "700" }]}>
                {c.n}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ marginTop: 16 }}>
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
        </View>

        {clase === "gasto" && (
          <Pressable style={est.check} onPress={() => setEfectivo((v) => !v)}>
            <View style={[est.checkCaja, efectivo && { backgroundColor: T.acento, borderColor: T.acento }]}>
              {efectivo && <Text style={{ color: T.acentoTexto ?? "#fff", fontSize: 13, fontWeight: "800" }}>✓</Text>}
            </View>
            <Text style={est.checkTxt}>Se pagó en efectivo</Text>
          </Pressable>
        )}

        {esRetiro && (
          <Text style={est.hint}>
            Este dinero sale del negocio y entra a tu libro personal — se registra en los dos con
            una sola captura.
          </Text>
        )}
        {clase === "gasto" && efectivo && ambito === "negocio" && turno && (
          <Text style={est.hint}>
            También se registra la salida del cajón, para que tu corte cuadre. No lo captures dos veces.
          </Text>
        )}

        <View style={{ marginTop: 20 }}>
          <Boton titulo="Guardar" onPress={guardar} cargando={guardando} />
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // ---------------------------------------------------------------------------
  // Gastos fijos
  // ---------------------------------------------------------------------------

  function Fijos() {
    const total = fijos.reduce((s, f) => s + f.monto_centavos, 0);
    const cats = CATS_GASTO[ambito].filter((c) => c.id !== "retiro");
    return (
      <ScrollView contentContainerStyle={est.cuerpo} keyboardShouldPersistTaps="handled">
        <Banner texto={error} tipo="error" />
        <Text style={est.arranqueP}>
          Lo que pagas cada mes sin falta. Regístralos una vez y esta pantalla te avisa antes de
          que venzan.
        </Text>
        {total > 0 && (
          <View style={est.fijosTotal}>
            <Text style={est.fijosTotalTxt}>
              {ambito === "negocio" ? "Tu negocio cuesta" : "Tu vida cuesta"}{" "}
              <Text style={{ fontWeight: "800" }}>{pesos(total)}</Text> al mes ·{" "}
              <Text style={{ fontWeight: "800" }}>{pesos(Math.round(total / 30))}</Text> al día
            </Text>
          </View>
        )}

        {fijos.length === 0 ? (
          <Text style={est.vacioChico}>Aún no tienes gastos fijos aquí.</Text>
        ) : (
          fijos.map((f) => (
            <View key={f.id} style={[est.fijo, f.pagado_este_mes && { opacity: 0.5 }]}>
              <View style={est.fijoDia}>
                <Text style={est.fijoDiaTxt}>{f.dia_mes}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={est.fijoConcepto} numberOfLines={1}>{f.concepto}</Text>
                <Text style={est.fijoMeta}>
                  {nombreCategoria(ambito, f.categoria)}{f.pagado_este_mes ? " · pagado ✓" : ""}
                </Text>
              </View>
              <Text style={est.fijoMonto}>{pesos(f.monto_centavos)}</Text>
              <Pressable
                hitSlop={10}
                onPress={async () => {
                  await eliminarFijo(f.id);
                  setFijos(await listarFijos(ambito, hoyYmd()));
                }}
              >
                <Text style={{ color: T.textoTenue, fontSize: 18 }}>×</Text>
              </Pressable>
            </View>
          ))
        )}

        <Text style={[est.bloqueTitulo, { marginTop: 20 }]}>AGREGAR UNO NUEVO</Text>
        <TextInput
          style={[estiloInput, { marginBottom: 8 }]}
          value={fjConcepto}
          onChangeText={setFjConcepto}
          placeholder={ambito === "negocio" ? "Ej. Renta del local" : "Ej. Renta de la casa"}
          placeholderTextColor={T.textoTenue}
        />
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
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
        <View style={est.chips}>
          {cats.map((c) => (
            <Pressable
              key={c.id}
              style={[est.chip, fjCat === c.id && { backgroundColor: T.acento, borderColor: T.acento }]}
              onPress={() => setFjCat(c.id)}
            >
              <Text style={[est.chipTxt, fjCat === c.id && { color: T.acentoTexto ?? "#fff", fontWeight: "700" }]}>
                {c.n}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={{ marginTop: 14 }}>
          <Boton titulo="Agregar gasto fijo" tipo="secundario" onPress={agregarFijo} />
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // ---------------------------------------------------------------------------
  // Presupuestos
  // ---------------------------------------------------------------------------

  function Presupuestos() {
    const cats = CATS_GASTO[ambito].filter((c) => c.id !== "retiro");
    return (
      <ScrollView contentContainerStyle={est.cuerpo} keyboardShouldPersistTaps="handled">
        <Banner texto={error} tipo="error" />
        <Text style={est.arranqueP}>
          Ponle un tope a lo que quieres gastar por categoría. Cuando te acerques, te aviso — sin
          un límite tuyo, cualquier aviso sería una opinión mía, no un dato tuyo.
        </Text>
        {cats.map((c) => (
          <View key={c.id} style={est.presuCampo}>
            <Text style={est.presuCampoLbl}>{c.n}</Text>
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
        <View style={{ marginTop: 20 }}>
          <Boton titulo="Guardar límites" onPress={guardarPresupuestos} cargando={guardando} />
        </View>
        <View style={{ height: 40 }} />
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
      <SafeAreaView style={est.raiz}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <CabeceraModal titulo={cab.titulo} izquierda={cab.izq} onIzquierda={cab.onIzq} />

          {vista === "panel" && (
            <View style={est.libros}>
              {(["negocio", "personal"] as Ambito[]).map((a) => (
                <Pressable
                  key={a}
                  style={[est.libro, ambito === a && { borderColor: T.acento, backgroundColor: T.acento + "18" }]}
                  onPress={() => { setAmbito(a); setDiaAbierto(null); }}
                >
                  <Text style={est.libroN}>{a === "negocio" ? "Mi negocio" : "Personal"}</Text>
                  <Text style={est.libroS}>
                    {a === "negocio" ? "Local y mercancía" : "Casa y tus gastos"}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {vista === "panel" && <Panel />}
          {vista === "form" && <Form />}
          {vista === "fijos" && <Fijos />}
          {vista === "presupuestos" && <Presupuestos />}

          {vista === "panel" && r?.hay_datos && (
            <View style={est.barraAcciones}>
              <Pressable style={est.accionSec} onPress={abrirFijos}>
                <Text style={est.accionSecTxt}>Fijos</Text>
              </Pressable>
              <Pressable style={est.accionSec} onPress={abrirPresupuestos}>
                <Text style={est.accionSecTxt}>Límites</Text>
              </Pressable>
              <Pressable style={est.accionPri} onPress={() => abrirForm()}>
                <Text style={est.accionPriTxt}>+ Movimiento</Text>
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function crearEstilos(T: Tema) {
  return StyleSheet.create({
    raiz: { flex: 1, backgroundColor: T.fondo },
    cuerpo: { padding: T.esp },

    libros: { flexDirection: "row", gap: 8, paddingHorizontal: T.esp, paddingBottom: 4 },
    libro: {
      flex: 1, padding: 11, borderRadius: T.radio,
      borderWidth: 1, borderColor: T.borde, backgroundColor: T.superficie,
    },
    libroN: { color: T.texto, fontSize: 14, fontWeight: "800" },
    libroS: { color: T.textoTenue, fontSize: 11, marginTop: 1 },

    aviso: { padding: 11, borderRadius: T.radio, borderWidth: 1, marginBottom: 8 },
    avisoPeligro: { borderColor: T.peligro + "66", backgroundColor: T.peligro + "14" },
    avisoAlerta: { borderColor: (T.alerta ?? "#f59e0b") + "66", backgroundColor: (T.alerta ?? "#f59e0b") + "14" },
    avisoTitulo: { color: T.texto, fontSize: 13.5, fontWeight: "700" },
    avisoDetalle: { color: T.textoTenue, fontSize: 12, marginTop: 2 },

    hero: {
      backgroundColor: T.superficie, borderRadius: T.radio,
      borderWidth: 1, borderColor: T.borde, borderLeftWidth: 4,
      padding: 18, marginBottom: 10,
    },
    heroLbl: { color: T.textoTenue, fontSize: 10.5, fontWeight: "800", letterSpacing: 0.6 },
    heroNum: { fontSize: 38, fontWeight: "800", letterSpacing: -1.2, marginVertical: 4 },
    heroDesglose: { color: T.textoTenue, fontSize: 12, lineHeight: 18 },
    heroB: { color: T.texto, fontWeight: "700" },

    equilibrio: {
      borderRadius: T.radio, borderWidth: 1, borderColor: T.acento + "55",
      backgroundColor: T.acento + "12", padding: 14, marginBottom: 10,
    },
    eqTitulo: { color: T.texto, fontSize: 14.5, fontWeight: "700" },
    eqSub: { color: T.textoTenue, fontSize: 12, marginTop: 3, lineHeight: 17 },

    puente: {
      borderRadius: T.radio, borderWidth: 1, borderStyle: "dashed",
      borderColor: T.acento + "66", backgroundColor: T.superficie2 ?? T.superficie,
      padding: 13, marginBottom: 10,
    },
    puenteTitulo: { color: T.texto, fontSize: 14, fontWeight: "700" },
    puenteSub: { color: T.textoTenue, fontSize: 12, marginTop: 3, lineHeight: 17 },

    minis: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
    mini: {
      flexGrow: 1, minWidth: "47%", padding: 11, borderRadius: T.radio,
      borderWidth: 1, borderColor: T.borde, backgroundColor: T.superficie,
    },
    miniLbl: { color: T.textoTenue, fontSize: 10.5, fontWeight: "600" },
    miniVal: { color: T.texto, fontSize: 17, fontWeight: "800", marginTop: 2 },

    bloque: {
      backgroundColor: T.superficie, borderRadius: T.radio,
      borderWidth: 1, borderColor: T.borde, padding: 14, marginTop: 10,
    },
    bloqueTitulo: {
      color: T.textoTenue, fontSize: 10.5, fontWeight: "800",
      letterSpacing: 0.6, marginBottom: 8,
    },
    filaEntre: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },

    barraFondo: { height: 5, borderRadius: 3, backgroundColor: T.superficie3, marginTop: 5, overflow: "hidden" },
    barraRelleno: { height: 5, borderRadius: 3, backgroundColor: T.acento },

    presuCat: { color: T.texto, fontSize: 13 },
    presuVal: { color: T.texto, fontSize: 13, fontWeight: "700" },
    catNombre: { color: T.textoTenue, fontSize: 12.5 },
    catMonto: { color: T.texto, fontSize: 12.5, fontWeight: "600" },

    cal: { flexDirection: "row", flexWrap: "wrap" },
    calCelda: { width: `${100 / 7}%`, padding: 2 },
    calDow: { textAlign: "center", color: T.textoTenue, fontSize: 10, fontWeight: "800" },
    calDia: {
      aspectRatio: 1, borderRadius: 8, borderWidth: 1, borderColor: "transparent",
      backgroundColor: T.superficie2 ?? T.superficie3,
      alignItems: "center", justifyContent: "center",
    },
    calNum: { color: T.textoTenue, fontSize: 11.5, fontWeight: "700" },
    calPunto: { position: "absolute", bottom: 4, width: 14, height: 3, borderRadius: 2 },
    calFijo: { position: "absolute", top: 3, right: 3, width: 5, height: 5, borderRadius: 3 },

    prox: {
      flexDirection: "row", alignItems: "center", gap: 10,
      paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: T.borde,
    },
    proxDia: { color: T.alerta ?? "#f59e0b", fontSize: 10.5, fontWeight: "800", minWidth: 48 },
    proxConcepto: { flex: 1, color: T.texto, fontSize: 13.5, fontWeight: "600" },
    proxMonto: { color: T.texto, fontSize: 13.5, fontWeight: "700" },

    mov: {
      flexDirection: "row", alignItems: "center", gap: 10,
      paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: T.borde,
    },
    movSigno: { width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center" },
    movConcepto: { color: T.texto, fontSize: 13.5, fontWeight: "600" },
    movMeta: { color: T.textoTenue, fontSize: 11 },
    movMonto: { color: T.texto, fontSize: 13.5, fontWeight: "700" },

    vacioChico: { color: T.textoTenue, fontSize: 13, textAlign: "center", paddingVertical: 14 },

    claseSel: {
      flexDirection: "row", gap: 4, padding: 4, borderRadius: T.radio,
      backgroundColor: T.superficie2 ?? T.superficie3, marginBottom: 14,
    },
    claseBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: "center" },
    claseTxt: { color: T.textoTenue, fontSize: 14, fontWeight: "700" },
    montoInput: { fontSize: 28, fontWeight: "800", textAlign: "center", paddingVertical: 12 },

    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: {
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
      borderWidth: 1, borderColor: T.borde, backgroundColor: T.superficie,
    },
    chipTxt: { color: T.textoTenue, fontSize: 12.5, fontWeight: "600" },

    check: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
    checkCaja: {
      width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: T.borde,
      alignItems: "center", justifyContent: "center",
    },
    checkTxt: { color: T.texto, fontSize: 14 },
    hint: { color: T.textoTenue, fontSize: 12, lineHeight: 17, marginTop: 12 },

    fijosTotal: {
      padding: 12, borderRadius: T.radio, borderWidth: 1,
      borderColor: T.acento + "55", backgroundColor: T.acento + "12", marginBottom: 12,
    },
    fijosTotalTxt: { color: T.texto, fontSize: 13, lineHeight: 19 },
    fijo: {
      flexDirection: "row", alignItems: "center", gap: 10,
      paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: T.borde,
    },
    fijoDia: {
      width: 30, height: 30, borderRadius: 9, backgroundColor: T.superficie3,
      alignItems: "center", justifyContent: "center",
    },
    fijoDiaTxt: { color: T.textoTenue, fontSize: 12, fontWeight: "800" },
    fijoConcepto: { color: T.texto, fontSize: 13.5, fontWeight: "700" },
    fijoMeta: { color: T.textoTenue, fontSize: 11 },
    fijoMonto: { color: T.texto, fontSize: 13.5, fontWeight: "700" },

    presuCampo: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      gap: 12, marginBottom: 8,
    },
    presuCampoLbl: { color: T.texto, fontSize: 13.5, flex: 1 },

    arranque: { paddingVertical: 20, alignItems: "center" },
    arranqueIco: {
      width: 56, height: 56, borderRadius: 16, marginBottom: 16,
      backgroundColor: T.acento + "22", alignItems: "center", justifyContent: "center",
    },
    arranqueH: { color: T.texto, fontSize: 19, fontWeight: "800", textAlign: "center", marginBottom: 12 },
    arranqueP: { color: T.textoTenue, fontSize: 13.5, lineHeight: 20, textAlign: "center", marginBottom: 10 },

    barraAcciones: {
      flexDirection: "row", gap: 8, padding: T.esp,
      borderTopWidth: 1, borderTopColor: T.borde, backgroundColor: T.superficie,
    },
    accionSec: {
      paddingHorizontal: 14, paddingVertical: 12, borderRadius: T.radio,
      borderWidth: 1, borderColor: T.borde, justifyContent: "center",
    },
    accionSecTxt: { color: T.textoTenue, fontSize: 13.5, fontWeight: "700" },
    accionPri: {
      flex: 1, paddingVertical: 12, borderRadius: T.radio,
      backgroundColor: T.acento, alignItems: "center", justifyContent: "center",
    },
    accionPriTxt: { color: T.acentoTexto ?? "#fff", fontSize: 14.5, fontWeight: "800" },
  });
}
