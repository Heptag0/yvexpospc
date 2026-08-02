// YvexPOS Móvil — Etiquetado NOM-051.
//
// Pensada para el teléfono: lo primero y más rápido es CALCULAR. Cinco
// números y ya sabes si tu producto lleva sellos. Todo lo demás —los datos
// completos de la etiqueta, el checklist— está ahí para quien lo quiera,
// pero nunca estorba a quien solo vino a preguntar.
//
// La pantalla "Mejorar" calcula EXACTAMENTE cuánto hay que bajar de cada
// ingrediente para perder cada sello, contando que quitar azúcar o grasa
// también baja las calorías.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, Modal, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Share,
} from "react-native";
import Svg, { Polygon, Rect, Text as SvgText } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, CabeceraModal, Campo, useEstiloInput } from "@/src/componentes/ui";
import {
  calcularSellos, compararFases, faseVigente, reglasImpresion,
  sugerenciasParaQuitarSellos, EXENCIONES, CHECKLIST_ETIQUETA, TRAMITES,
  FECHA_VERIFICACION,
  type DatosNutrimentales, type Sugerencia,
} from "@/src/base/sellos";
import {
  listarPerfiles, guardarPerfil, eliminarPerfil, textoEtiqueta,
  PERFIL_VACIO, type PerfilEtiqueta,
} from "@/src/base/etiquetas";
import {
  sustitucionesPara, CATEGORIAS_RECETA,
  type CategoriaReceta, type NivelSustitucion,
} from "@/src/base/sustituciones";

type Tema = ReturnType<typeof useTema>["tema"];
type Vista = "lista" | "calc" | "mejorar" | "etiqueta" | "checklist" | "tramites";

// ───────────────────────────────────────────────────────────────────────────
// Sello dibujado con las proporciones del Apéndice A (Figura A2):
// 64x de ancho × 72x de alto; octágono de 56x × 62x; franja de 10x abajo con
// "SECRETARÍA DE SALUD"; tipografía del mensaje 6x, interlineado 4x.
// ───────────────────────────────────────────────────────────────────────────

function envolver(texto: string, max: number): string[] {
  const palabras = texto.split(" ");
  const out: string[] = [];
  let act = "";
  for (const p of palabras) {
    if ((act + " " + p).trim().length > max && act) { out.push(act.trim()); act = p; }
    else act = (act + " " + p).trim();
  }
  if (act) out.push(act);
  return out;
}

function SelloSVG({ texto, size = 96 }: { texto: string; size?: number }) {
  const lineas = envolver(texto, 13);
  const fuente = lineas.length >= 4 ? 4.6 : lineas.length === 3 ? 5.6 : 6.2;
  const inter = fuente + (lineas.length >= 4 ? 0.8 : 1.4);
  // En SVG el eje Y del texto es la línea base, no el centro: por eso se
  // suma ~0.35 del cuerpo para que el bloque quede centrado en la banda.
  const y0 = 31.5 - ((lineas.length - 1) * inter) / 2 + fuente * 0.35;
  return (
    <Svg width={size} height={size * (72 / 64)} viewBox="0 0 64 72">
      <Rect x={0} y={0} width={64} height={72} fill="#fff" />
      <Polygon
        points="19,0 45,0 60,20 60,43 45,62 19,62 4,43 4,20"
        fill="#000" stroke="#fff" strokeWidth={1.6} strokeLinejoin="round"
      />
      {lineas.map((l, i) => (
        <SvgText key={i} x={32} y={y0 + i * inter} textAnchor="middle"
          fontSize={fuente} fontWeight="bold" fill="#fff">{l}</SvgText>
      ))}
      <Rect x={4} y={63} width={56} height={9} fill="#fff" />
      <SvgText x={32} y={69.2} textAnchor="middle" fontSize={3.9} fontWeight="bold" fill="#000">
        SECRETARÍA DE SALUD
      </SvgText>
    </Svg>
  );
}

/** Sello agrupado con número, para envases ≤40 cm² (numeral 4.5.3.4.2). */
function SelloNumeroSVG({ cuantos, size = 110 }: { cuantos: number; size?: number }) {
  return (
    <Svg width={size} height={size * (72 / 65)} viewBox="0 0 65 72">
      <Rect x={0} y={0} width={65} height={72} fill="#fff" />
      <Polygon
        points="19,0 46,0 61,21 61,44 46,65 19,65 4,44 4,21"
        fill="#000" stroke="#fff" strokeWidth={1.6} strokeLinejoin="round"
      />
      <SvgText x={32.5} y={33} textAnchor="middle" fontSize={24} fontWeight="bold" fill="#fff">
        {String(cuantos)}
      </SvgText>
      <SvgText x={32.5} y={50} textAnchor="middle" fontSize={9} fontWeight="bold" fill="#fff">
        {cuantos === 1 ? "SELLO" : "SELLOS"}
      </SvgText>
      <Rect x={4} y={65} width={57} height={7} fill="#fff" />
      <SvgText x={32.5} y={69.7} textAnchor="middle" fontSize={3.3} fontWeight="bold" fill="#000">
        SECRETARÍA DE SALUD
      </SvgText>
    </Svg>
  );
}

function LeyendaSVG({ texto, ancho = 280 }: { texto: string; ancho?: number }) {
  const lineas = envolver(texto, 26);
  const altoU = 14 + (lineas.length - 1) * 11;
  const y0 = altoU / 2 - ((lineas.length - 1) * 11) / 2 + 3;
  return (
    <Svg width={ancho} height={ancho * (altoU / 180)} viewBox={`0 0 180 ${altoU}`}>
      <Rect x={0} y={0} width={180} height={altoU} fill="#fff" />
      <Rect x={2} y={1.5} width={176} height={altoU - 3} fill="#000" />
      {lineas.map((l, i) => (
        <SvgText key={i} x={90} y={y0 + i * 11} textAnchor="middle"
          fontSize={8} fontWeight="bold" fill="#fff">{l}</SvgText>
      ))}
    </Svg>
  );
}

// ───────────────────────────────────────────────────────────────────────────

export default function ModalEtiquetas({ onCerrar }: { onCerrar: () => void }) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const estiloInput = useEstiloInput();

  const [vista, setVista] = useState<Vista>("lista");
  const [perfiles, setPerfiles] = useState<PerfilEtiqueta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [avanzado, setAvanzado] = useState(false);

  // Perfil en edición (siempre hay uno, aunque no se haya guardado).
  const [p, setP] = useState<Partial<PerfilEtiqueta>>({ ...PERFIL_VACIO });

  const cargar = useCallback(async () => {
    setCargando(true);
    try { setPerfiles(await listarPerfiles()); }
    finally { setCargando(false); }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const datos: DatosNutrimentales = useMemo(() => ({
    tipo: p.tipo === "liquido" ? "liquido" : "solido",
    caloriasKcal: Number(p.calorias_kcal) || 0,
    azucaresG: Number(p.azucares_g) || 0,
    grasasSaturadasG: Number(p.grasas_saturadas_g) || 0,
    grasasTransG: Number(p.grasas_trans_g) || 0,
    sodioMg: Number(p.sodio_mg) || 0,
    anadeAzucares: !!p.anade_azucares,
    anadeGrasas: !!p.anade_grasas,
    anadeSodio: !!p.anade_sodio,
    contieneCafeina: !!p.contiene_cafeina,
    contieneEdulcorantes: !!p.contiene_edulcorantes,
    exencion: p.exencion ?? "ninguna",
    areaCm2: Number(p.area_cm2) || 0,
  }), [p]);

  const resultado = useMemo(() => calcularSellos(datos), [datos]);
  const reglas = useMemo(
    () => reglasImpresion(datos.areaCm2, resultado.sellos.length),
    [datos.areaCm2, resultado.sellos.length]
  );

  const set = (k: keyof PerfilEtiqueta, v: any) => setP((x) => ({ ...x, [k]: v }));
  const setNum = (k: keyof PerfilEtiqueta, txt: string) =>
    set(k, parseFloat((txt || "0").replace(",", ".")) || 0);
  const valNum = (v: any) => (v === 0 || v === undefined || v === null ? "" : String(v));

  function nuevo() {
    setP({ ...PERFIL_VACIO });
    setAvanzado(false);
    setError("");
    setVista("calc");
  }

  function abrir(perfil: PerfilEtiqueta) {
    setP({ ...perfil });
    setAvanzado(false);
    setError("");
    setVista("calc");
  }

  async function guardar() {
    setError("");
    if (!(p.nombre ?? "").trim()) return setError("Ponle un nombre a esta receta.");
    setGuardando(true);
    try {
      const id = await guardarPerfil(p);
      setP((x) => ({ ...x, id }));
      await cargar();
      setVista("lista");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setGuardando(false);
    }
  }

  async function borrar() {
    if (!p.id) return setVista("lista");
    await eliminarPerfil(p.id);
    await cargar();
    setVista("lista");
  }

  async function compartir() {
    if (!p.id) {
      setError("Guarda primero la etiqueta para poder compartirla.");
      return;
    }
    const completo = perfiles.find((x) => x.id === p.id);
    if (completo) await Share.share({ message: textoEtiqueta({ ...completo, ...p } as PerfilEtiqueta) });
  }

  // ─────────────────────────────────────────────────────────── Lista

  function VistaLista() {
    return (
      <ScrollView contentContainerStyle={est.cuerpo}>
        <View style={est.vigencia}>
          <View style={est.vigPunto} />
          <Text style={est.vigTxt}>
            Vigente: <Text style={{ fontWeight: "800", color: T.texto }}>Fase {faseVigente()}</Text> ·
            la Fase 3 aplica desde el 1 de enero de 2028
          </Text>
        </View>
        <Text style={est.vigFecha}>Verificado contra el texto oficial el {FECHA_VERIFICACION}</Text>

        <View style={{ marginTop: 14, marginBottom: 16 }}>
          <Boton titulo="+ Calcular un producto" onPress={nuevo} />
        </View>

        {cargando ? (
          <ActivityIndicator color={T.acento} style={{ marginTop: 24 }} />
        ) : perfiles.length === 0 ? (
          <View style={est.arranque}>
            <Text style={est.arranqueH}>¿Tu producto necesita sellos?</Text>
            <Text style={est.arranqueP}>
              Si fabricas lo que vendes — postres, panadería, conservas, salsas — captura cinco
              números y te digo qué sellos te tocan, de qué tamaño van en tu envase, y qué tendrías
              que ajustar para quitártelos.
            </Text>
            <Text style={est.arranqueNota}>Todo el cálculo se hace en tu teléfono.</Text>
          </View>
        ) : (
          perfiles.map((x) => {
            const r = calcularSellos({
              tipo: x.tipo, caloriasKcal: x.calorias_kcal, azucaresG: x.azucares_g,
              grasasSaturadasG: x.grasas_saturadas_g, grasasTransG: x.grasas_trans_g,
              sodioMg: x.sodio_mg, anadeAzucares: !!x.anade_azucares,
              anadeGrasas: !!x.anade_grasas, anadeSodio: !!x.anade_sodio,
              contieneCafeina: !!x.contiene_cafeina, contieneEdulcorantes: !!x.contiene_edulcorantes,
              exencion: x.exencion, areaCm2: x.area_cm2,
            });
            const n = r.sellos.length;
            return (
              <Pressable key={x.id}
                style={({ pressed }) => [est.fila, pressed && { backgroundColor: T.superficie3 }]}
                onPress={() => abrir(x)}
              >
                <View style={[est.filaCont, n === 0 && { backgroundColor: T.exito + "22" }]}>
                  <Text style={[est.filaContTxt, n === 0 && { color: T.exito }]}>{n}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={est.filaNombre} numberOfLines={1}>{x.nombre}</Text>
                  <Text style={est.filaMeta}>
                    {x.tipo === "liquido" ? "Líquido" : "Sólido"} ·{" "}
                    {r.motivo === "exento" ? "exento"
                      : r.motivo === "sin_anadidos" ? "sin añadidos"
                      : n === 0 ? "sin sellos" : `${n} sello${n > 1 ? "s" : ""}`}
                  </Text>
                </View>
                <Text style={est.flecha}>→</Text>
              </Pressable>
            );
          })
        )}

        <View style={{ marginTop: 20 }}>
          <Boton titulo="¿Qué trámites necesito?" tipo="secundario" onPress={() => setVista("tramites")} />
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // ─────────────────────────────────────────────────────── Calculadora

  function VistaCalc() {
    const exento = (p.exencion ?? "ninguna") !== "ninguna";
    const u = p.tipo === "liquido" ? "ml" : "g";
    return (
      <ScrollView contentContainerStyle={est.cuerpo} keyboardShouldPersistTaps="handled">
        <Banner texto={error} tipo="error" />

        <Campo label="¿Qué producto es?">
          <TextInput style={estiloInput} value={p.nombre ?? ""} onChangeText={(v) => set("nombre", v)}
            placeholder="Ej. Galletas de avena" placeholderTextColor={T.textoTenue} />
        </Campo>

        <View style={est.segmento}>
          {(["solido", "liquido"] as const).map((t) => (
            <Pressable key={t} style={[est.segBtn, p.tipo === t && { backgroundColor: T.acento }]}
              onPress={() => set("tipo", t)}>
              <Text style={[est.segTxt, p.tipo === t && { color: T.acentoTexto ?? "#fff" }]}>
                {t === "solido" ? "Sólido (100 g)" : "Líquido (100 ml)"}
              </Text>
            </Pressable>
          ))}
        </View>

        {!exento && (
          <>
            <Text style={est.lbl}>¿QUÉ LE AGREGASTE?</Text>
            <Text style={est.hint}>
              Define qué sellos se evalúan. Sin nada añadido no hay sellos, aunque sea alto en
              azúcar natural.
            </Text>
            {([
              ["anade_azucares", "Azúcar, miel o jarabe"],
              ["anade_grasas", "Grasa, aceite o manteca"],
              ["anade_sodio", "Sal o algo con sodio"],
            ] as const).map(([k, txt]) => (
              <Pressable key={k} style={est.check} onPress={() => set(k, p[k] ? 0 : 1)}>
                <View style={[est.checkCaja, !!p[k] && { backgroundColor: T.acento, borderColor: T.acento }]}>
                  {!!p[k] && <Text style={est.checkMarca}>✓</Text>}
                </View>
                <Text style={est.checkTxt}>{txt}</Text>
              </Pressable>
            ))}

            <Text style={est.lbl}>POR CADA 100 {u.toUpperCase()}</Text>
            <View style={est.filaCampos}>
              <View style={{ flex: 1 }}>
                <Campo label="Calorías (kcal)">
                  <TextInput style={estiloInput} value={valNum(p.calorias_kcal)}
                    onChangeText={(v) => setNum("calorias_kcal", v)} keyboardType="decimal-pad"
                    placeholder="0" placeholderTextColor={T.textoTenue} />
                </Campo>
              </View>
              <View style={{ flex: 1 }}>
                <Campo label="Azúcares (g)" ayuda="Añadidos + los de miel y jugos">
                  <TextInput style={estiloInput} value={valNum(p.azucares_g)}
                    onChangeText={(v) => setNum("azucares_g", v)} keyboardType="decimal-pad"
                    placeholder="0" placeholderTextColor={T.textoTenue} />
                </Campo>
              </View>
            </View>
            <View style={est.filaCampos}>
              <View style={{ flex: 1 }}>
                <Campo label="Grasas saturadas (g)">
                  <TextInput style={estiloInput} value={valNum(p.grasas_saturadas_g)}
                    onChangeText={(v) => setNum("grasas_saturadas_g", v)} keyboardType="decimal-pad"
                    placeholder="0" placeholderTextColor={T.textoTenue} />
                </Campo>
              </View>
              <View style={{ flex: 1 }}>
                <Campo label="Grasas trans (g)">
                  <TextInput style={estiloInput} value={valNum(p.grasas_trans_g)}
                    onChangeText={(v) => setNum("grasas_trans_g", v)} keyboardType="decimal-pad"
                    placeholder="0" placeholderTextColor={T.textoTenue} />
                </Campo>
              </View>
            </View>
            <Campo label="Sodio (mg)">
              <TextInput style={estiloInput} value={valNum(p.sodio_mg)}
                onChangeText={(v) => setNum("sodio_mg", v)} keyboardType="decimal-pad"
                placeholder="0" placeholderTextColor={T.textoTenue} />
            </Campo>
          </>
        )}

        {/* Resultado, siempre visible bajo los campos */}
        <Resultado />

        {/* Lo avanzado no estorba: se despliega solo si lo piden */}
        <Pressable style={est.masBtn} onPress={() => setAvanzado((v) => !v)}>
          <Text style={est.masTxt}>{avanzado ? "− Menos opciones" : "+ Más opciones"}</Text>
        </Pressable>

        {avanzado && (
          <View style={est.avanzado}>
            <Campo label="Tamaño del envase (cm²)" ayuda="La cara principal, la que ve el cliente. Define el tamaño del sello.">
              <TextInput style={estiloInput} value={valNum(p.area_cm2)}
                onChangeText={(v) => setNum("area_cm2", v)} keyboardType="decimal-pad"
                placeholder="Ej. 120" placeholderTextColor={T.textoTenue} />
            </Campo>

            {([
              ["contiene_cafeina", "Lleva cafeína añadida"],
              ["contiene_edulcorantes", "Lleva edulcorantes"],
            ] as const).map(([k, txt]) => (
              <Pressable key={k} style={est.check} onPress={() => set(k, p[k] ? 0 : 1)}>
                <View style={[est.checkCaja, !!p[k] && { backgroundColor: T.acento, borderColor: T.acento }]}>
                  {!!p[k] && <Text style={est.checkMarca}>✓</Text>}
                </View>
                <Text style={est.checkTxt}>{txt}</Text>
              </Pressable>
            ))}

            <Text style={est.lbl}>¿ES UN PRODUCTO EXENTO?</Text>
            <Text style={est.hint}>
              Algunos productos no llevan sellos nunca, sin importar sus valores.
            </Text>
            {EXENCIONES.map((x) => (
              <Pressable key={x.id} style={est.radio} onPress={() => set("exencion", x.id)}>
                <View style={[est.radioCaja, p.exencion === x.id && { borderColor: T.acento }]}>
                  {p.exencion === x.id && <View style={[est.radioPunto, { backgroundColor: T.acento }]} />}
                </View>
                <Text style={est.checkTxt}>{x.n}</Text>
              </Pressable>
            ))}

            <Text style={est.lbl}>¿QUÉ TIPO DE RECETA ES?</Text>
            <Text style={est.hint}>
              Para que, si algún día quieres bajar un sello, la app sepa si el ingrediente que
              tocarías está ahí solo por sabor o si además conserva tu producto.
            </Text>
            {CATEGORIAS_RECETA.map((c) => (
              <Pressable key={c.id} style={est.radio}
                onPress={() => set("categoria_receta", c.id)}>
                <View style={[est.radioCaja, (p.categoria_receta ?? "otro") === c.id && { borderColor: T.acento }]}>
                  {(p.categoria_receta ?? "otro") === c.id && <View style={[est.radioPunto, { backgroundColor: T.acento }]} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={est.checkTxt}>{c.n}</Text>
                  {!!c.ejemplos && <Text style={est.radioEjemplo}>{c.ejemplos}</Text>}
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    );
  }

  function Resultado() {
    const r = resultado;
    if (r.motivo === "exento" || r.motivo === "sin_anadidos") {
      return (
        <View style={est.ok}>
          <Text style={est.okTitulo}>✓ No lleva sellos</Text>
          <Text style={est.okNota}>{r.explicacion}</Text>
          {r.leyendas.length > 0 && (
            <View style={{ marginTop: 12, gap: 8 }}>
              {r.leyendas.map((l) => <LeyendaSVG key={l.id} texto={l.etiqueta} ancho={250} />)}
            </View>
          )}
        </View>
      );
    }
    if (r.sellos.length === 0 && r.leyendas.length === 0) {
      const comp = compararFases(datos);
      return (
        <View style={est.ok}>
          <Text style={est.okTitulo}>✓ Con estos datos, no lleva sellos</Text>
          {comp.nuevos.length > 0 && (
            <Text style={est.okNota}>
              Ojo: a partir de 2028 tendría {comp.nuevos.length} sello
              {comp.nuevos.length > 1 ? "s" : ""}.
            </Text>
          )}
          <Text style={est.okNota}>
            Puedes declararlo por escrito: «Este producto no contiene sellos ni leyendas» (4.1.4 Bis).
          </Text>
        </View>
      );
    }

    const comp = compararFases(datos);
    const usaNumero = reglas.usaNumero && r.sellos.length > 0;
    return (
      <View style={est.resultado}>
        <Text style={est.resTitulo}>
          {r.sellos.length > 0
            ? `Llevaría ${r.sellos.length} sello${r.sellos.length === 1 ? "" : "s"}`
            : "Llevaría estas leyendas"}
        </Text>

        {usaNumero ? (
          <>
            <View style={est.numAviso}>
              <Text style={est.numAvisoTxt}>
                Tu envase mide {reglas.area} cm². Por ser de 40 cm² o menos, va{" "}
                <Text style={{ fontWeight: "800" }}>un solo sello con el número</Text> en vez de los
                individuales (4.5.3.4.2).
              </Text>
            </View>
            <View style={est.sellosFila}>
              <SelloNumeroSVG cuantos={r.sellos.length} size={120} />
            </View>
            <View style={{ marginTop: 10, gap: 6 }}>
              {r.sellos.map((s) => (
                <Text key={s.id} style={est.razonFila}>
                  <Text style={{ fontWeight: "700", color: T.texto }}>{s.etiqueta}</Text> — {s.razon}
                </Text>
              ))}
            </View>
          </>
        ) : (
          <View style={est.sellosFila}>
            {r.sellos.map((s) => (
              <View key={s.id} style={est.selloCaja}>
                <SelloSVG texto={s.etiqueta} size={92} />
                <Text style={est.selloRazon}>{s.razon}</Text>
              </View>
            ))}
          </View>
        )}

        {r.leyendas.length > 0 && (
          <View style={{ marginTop: 14, gap: 10 }}>
            {r.leyendas.map((l) => (
              <View key={l.id}>
                <LeyendaSVG texto={l.etiqueta} ancho={280} />
                <Text style={est.selloRazonIzq}>{l.razon}</Text>
              </View>
            ))}
          </View>
        )}

        {r.sellos.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Boton titulo="¿Cómo le quito un sello?" tipo="secundario"
              onPress={() => setVista("mejorar")} />
          </View>
        )}

        {reglas.conocida && r.sellos.length > 0 && (
          <View style={est.impresion}>
            <Text style={est.impTitulo}>CÓMO VA EN TU ENVASE</Text>
            <Text style={est.impFila}>
              Tamaño de cada sello:{" "}
              <Text style={{ fontWeight: "700", color: T.texto }}>
                {reglas.ancho ? `${reglas.ancho} × ${reglas.alto} cm` : reglas.nota}
              </Text>
            </Text>
            <Text style={est.impFila}>{reglas.ubicacion}</Text>
            {r.sellos.length > 1 && !usaNumero && (
              <Text style={est.impFila}>Van de izquierda a derecha, en el orden de arriba.</Text>
            )}
          </View>
        )}

        {comp.nuevos.length > 0 && (
          <View style={est.futuro}>
            <Text style={est.futuroTxt}>
              <Text style={{ fontWeight: "800" }}>Desde el 1 de enero de 2028</Text> (Fase 3), este
              mismo producto llevaría {comp.nuevos.length} sello
              {comp.nuevos.length > 1 ? "s" : ""} más sin cambiarle nada:{" "}
              {comp.nuevos.map((s) => s.etiqueta).join(", ")}.
            </Text>
          </View>
        )}
      </View>
    );
  }

  // ─────────────────────────────────────────────────────── Mejorar

  function VistaMejorar() {
    const { sugerencias, quedariaLimpio, leyendasFijas } = sugerenciasParaQuitarSellos(datos);
    return (
      <ScrollView contentContainerStyle={est.cuerpo}>
        <Text style={est.hint}>
          Estos son los números exactos para perder cada sello. Al bajar azúcar o grasa también
          bajan las calorías, así que a veces un solo ajuste quita dos sellos — ya está contado.
        </Text>

        {sugerencias.map((s: Sugerencia) => {
          const esNutriente = s.selloId === "azucares" || s.selloId === "grasas_sat"
            || s.selloId === "grasas_trans" || s.selloId === "sodio";
          const categoria = (p.categoria_receta ?? "otro") as CategoriaReceta;
          const opciones = esNutriente ? sustitucionesPara(s.selloId as any, categoria) : [];
          return (
            <View key={s.selloId} style={[est.sug, !s.viable && est.sugNoViable]}>
              <Text style={est.sugSello}>{s.etiqueta}</Text>
              <Text style={[est.sugAccion, !s.viable && { color: T.textoTenue }]}>{s.accion}</Text>

              {s.viable && s.actual > 0 && (
                <View style={est.sugBarraFondo}>
                  <View style={[est.sugBarraObjetivo, { width: `${Math.max(4, (s.objetivo / s.actual) * 100)}%` }]} />
                </View>
              )}
              {s.viable && s.actual > 0 && (
                <View style={est.sugNums}>
                  <Text style={est.sugNumTxt}>Ahora: {s.actual.toFixed(1).replace(/\.0$/, "")} {s.unidad}</Text>
                  <Text style={[est.sugNumTxt, { color: T.exito, fontWeight: "800" }]}>
                    Meta: {s.objetivo.toFixed(1).replace(/\.0$/, "")} {s.unidad}
                  </Text>
                </View>
              )}

              {s.bonus && <Text style={est.sugBonus}>↳ {s.bonus}</Text>}
              {s.nota && <Text style={est.sugNota}>{s.nota}</Text>}

              {opciones.map((op, i) => (
                <View key={i} style={[est.sust, estilosSustNivel(op.nivel, T)]}>
                  <View style={est.sustCab}>
                    <View style={[est.sustBadge, estilosBadgeNivel(op.nivel, T)]}>
                      <Text style={est.sustBadgeTxt}>
                        {op.nivel === "segura" ? "SEGURA" : op.nivel === "advertencia" ? "CON AVISO" : "NO SE ACONSEJA"}
                      </Text>
                    </View>
                  </View>
                  <Text style={est.sustTitulo}>{op.titulo}</Text>
                  <Text style={est.sustTxt}>{op.explicacion}</Text>
                  {op.como && <Text style={est.sustComo}>{op.como}</Text>}
                </View>
              ))}
              {esNutriente && opciones.length === 0 && (p.categoria_receta ?? "otro") === "otro" && (
                <Pressable style={est.sustFalta} onPress={() => setVista("calc")}>
                  <Text style={est.sustFaltaTxt}>
                    Dinos qué tipo de receta es (en «+ Más opciones») para darte un consejo
                    específico de sustitución →
                  </Text>
                </Pressable>
              )}
            </View>
          );
        })}

        {sugerencias.length > 0 && (
          <View style={[est.ok, { marginTop: 8 }]}>
            <Text style={est.okTitulo}>
              {quedariaLimpio ? "✓ Aplicando todo, tu producto quedaría sin sellos"
                              : "Aun aplicando todo, quedaría con algún sello"}
            </Text>
            {leyendasFijas.length > 0 && (
              <Text style={est.okNota}>
                Las leyendas de cafeína o edulcorantes no dependen de las cantidades: para quitarlas
                habría que sacar ese ingrediente de la receta.
              </Text>
            )}
          </View>
        )}

        <View style={est.aviso}>
          <Text style={est.avisoTxt}>
            Bajar estos ingredientes cambia el sabor y la textura, y a veces la conservación.
            Después de ajustar tu receta, los valores hay que medirlos de nuevo — no basta con
            restar en el papel.
          </Text>
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>
    );
  }

  // ─────────────────────────────────────────────────────── Etiqueta

  function VistaEtiqueta() {
    const u = p.tipo === "liquido" ? "ml" : "g";
    const campo = (k: keyof PerfilEtiqueta, label: string, ph: string, multi = false) => (
      <Campo label={label}>
        <TextInput
          style={[estiloInput, multi && { minHeight: 60, textAlignVertical: "top" }]}
          value={(p[k] as string) ?? ""} onChangeText={(v) => set(k, v)} multiline={multi}
          placeholder={ph} placeholderTextColor={T.textoTenue}
        />
      </Campo>
    );
    return (
      <ScrollView contentContainerStyle={est.cuerpo} keyboardShouldPersistTaps="handled">
        <Text style={est.hint}>
          Todo esto es opcional — llena lo que tengas. Sirve para compartir la etiqueta completa
          con tu diseñador o tu imprenta.
        </Text>
        {campo("denominacion", "Denominación", "Lo que ES: «Galletas de avena»")}
        {campo("marca", "Marca", "Tu marca")}
        {campo("ingredientes", "Ingredientes", "De mayor a menor cantidad", true)}
        {campo("alergenos", "Alérgenos", "Contiene: trigo, leche, nuez…")}
        {campo("contenido_neto", "Contenido neto", "250 g")}
        {campo("porcion", "Porción", "1 pieza (30 g)")}
        {campo("porciones_envase", "Porciones por envase", "8")}
        {campo("lote", "Lote", "L-2026-001")}
        {campo("caducidad", "Caducidad", "Consumir antes de: 12/2026")}
        {campo("conservacion", "Conservación", "Mantener en lugar fresco y seco")}
        {campo("pais_origen", "País de origen", "Hecho en México")}
        {campo("responsable_nombre", "Responsable", "Quien fabrica o comercializa")}
        {campo("responsable_domicilio", "Domicilio fiscal", "Calle, número, CP y estado", true)}

        <Text style={est.lbl}>RESTO DE LA TABLA — POR 100 {u.toUpperCase()}</Text>
        <Text style={est.hint}>No cambian los sellos, pero la tabla de tu etiqueta sí los exige.</Text>
        <View style={est.filaCampos}>
          <View style={{ flex: 1 }}>
            <Campo label="Proteínas (g)">
              <TextInput style={estiloInput} value={valNum(p.proteinas_g)}
                onChangeText={(v) => setNum("proteinas_g", v)} keyboardType="decimal-pad"
                placeholder="0" placeholderTextColor={T.textoTenue} />
            </Campo>
          </View>
          <View style={{ flex: 1 }}>
            <Campo label="Carbohidratos (g)">
              <TextInput style={estiloInput} value={valNum(p.carbohidratos_g)}
                onChangeText={(v) => setNum("carbohidratos_g", v)} keyboardType="decimal-pad"
                placeholder="0" placeholderTextColor={T.textoTenue} />
            </Campo>
          </View>
        </View>
        <View style={est.filaCampos}>
          <View style={{ flex: 1 }}>
            <Campo label="Grasas totales (g)">
              <TextInput style={estiloInput} value={valNum(p.grasas_totales_g)}
                onChangeText={(v) => setNum("grasas_totales_g", v)} keyboardType="decimal-pad"
                placeholder="0" placeholderTextColor={T.textoTenue} />
            </Campo>
          </View>
          <View style={{ flex: 1 }}>
            <Campo label="Fibra (g)">
              <TextInput style={estiloInput} value={valNum(p.fibra_g)}
                onChangeText={(v) => setNum("fibra_g", v)} keyboardType="decimal-pad"
                placeholder="0" placeholderTextColor={T.textoTenue} />
            </Campo>
          </View>
        </View>
        <View style={{ height: 80 }} />
      </ScrollView>
    );
  }

  // ─────────────────────────────────────────────────────── Checklist

  function VistaChecklist() {
    const tiene: Record<string, boolean> = {
      denominacion: !!p.denominacion, ingredientes: !!p.ingredientes,
      alergenos: !!p.alergenos, contenido: !!p.contenido_neto,
      responsable: !!(p.responsable_nombre && p.responsable_domicilio),
      lote: !!p.lote, caducidad: !!p.caducidad, origen: !!p.pais_origen,
      nutrimental: (Number(p.calorias_kcal) || 0) > 0, conservacion: !!p.conservacion,
    };
    const listos = Object.values(tiene).filter(Boolean).length;
    return (
      <ScrollView contentContainerStyle={est.cuerpo}>
        <Text style={est.hint}>
          Los sellos son una parte de la etiqueta, no toda. Esto es lo demás que exige la norma.
        </Text>
        <View style={est.progreso}>
          <Text style={est.progresoTxt}>{listos} de {CHECKLIST_ETIQUETA.length} completos</Text>
        </View>
        {CHECKLIST_ETIQUETA.map((c) => (
          <View key={c.id} style={est.chk}>
            <View style={[est.chkMarca, tiene[c.id] && { backgroundColor: T.exito + "22", borderColor: T.exito + "66" }]}>
              {tiene[c.id] && <Text style={{ color: T.exito, fontWeight: "800", fontSize: 12 }}>✓</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[est.chkN, tiene[c.id] && { color: T.textoTenue }]}>
                {c.n} <Text style={est.chkRef}>{c.ref}</Text>
              </Text>
              <Text style={est.chkAyuda}>{c.ayuda}</Text>
            </View>
          </View>
        ))}
        <View style={{ height: 60 }} />
      </ScrollView>
    );
  }

  // ─────────────────────────────────────────────────────── Trámites

  function VistaTramites() {
    return (
      <ScrollView contentContainerStyle={est.cuerpo}>
        <View style={est.aclara}>
          <Text style={est.aclaraTxt}>
            <Text style={{ fontWeight: "800" }}>No existe un trámite para que te «aprueben» el sello.</Text>{" "}
            La norma lo dice textualmente: su evaluación «no es certificable y se puede llevar a cabo
            a través de un esquema voluntario» (numeral 9). Tú etiquetas bajo tu responsabilidad y la
            autoridad verifica después.
          </Text>
        </View>
        {TRAMITES.map((t) => (
          <View key={t.id} style={est.tramite}>
            <Text style={est.tramiteN}>{t.n}</Text>
            <Text style={est.tramiteQuien}>{t.quien}</Text>
            <Text style={est.tramiteDet}>{t.detalle}</Text>
          </View>
        ))}
        <View style={est.fuente}>
          <Text style={est.fuenteTxt}>
            Verificado el {FECHA_VERIFICACION} contra el texto íntegro de la NOM-051
            (DOF 27/03/2020) y el Acuerdo de fases (DOF 31/07/2025). Las fechas se han recorrido
            dos veces: si lees esto después de 2027, confirma en el Diario Oficial.
          </Text>
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // ───────────────────────────────────────────────────────────────────────

  const cab = (() => {
    switch (vista) {
      case "calc": return { t: p.id ? (p.nombre || "Etiqueta") : "Calcular", i: "Atrás", f: () => setVista("lista") };
      case "mejorar": return { t: "Cómo quitar sellos", i: "Atrás", f: () => setVista("calc") };
      case "etiqueta": return { t: "Datos de etiqueta", i: "Atrás", f: () => setVista("calc") };
      case "checklist": return { t: "Checklist", i: "Atrás", f: () => setVista("calc") };
      case "tramites": return { t: "Trámites", i: "Atrás", f: () => setVista("lista") };
      default: return { t: "Etiquetado NOM-051", i: "Listo", f: onCerrar };
    }
  })();

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={est.raiz}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <CabeceraModal titulo={cab.t} izquierda={cab.i} onIzquierda={cab.f} />

          {vista === "lista" && <VistaLista />}
          {vista === "calc" && <VistaCalc />}
          {vista === "mejorar" && <VistaMejorar />}
          {vista === "etiqueta" && <VistaEtiqueta />}
          {vista === "checklist" && <VistaChecklist />}
          {vista === "tramites" && <VistaTramites />}

          {/* Barra de acciones: solo en las vistas de trabajo */}
          {(vista === "calc" || vista === "etiqueta" || vista === "checklist") && (
            <View style={est.barra}>
              {vista === "calc" ? (
                <>
                  <Pressable style={est.accSec} onPress={() => setVista("etiqueta")}>
                    <Text style={est.accSecTxt}>Etiqueta</Text>
                  </Pressable>
                  <Pressable style={est.accSec} onPress={() => setVista("checklist")}>
                    <Text style={est.accSecTxt}>Checklist</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable style={est.accSec} onPress={() => setVista("calc")}>
                  <Text style={est.accSecTxt}>Sellos</Text>
                </Pressable>
              )}
              {p.id ? (
                <Pressable style={est.accSec} onPress={compartir}>
                  <Text style={est.accSecTxt}>Compartir</Text>
                </Pressable>
              ) : null}
              <Pressable style={[est.accPri, guardando && { opacity: 0.6 }]} onPress={guardar} disabled={guardando}>
                <Text style={est.accPriTxt}>{guardando ? "Guardando…" : "Guardar"}</Text>
              </Pressable>
            </View>
          )}

          {vista === "calc" && p.id ? (
            <Pressable style={est.borrar} onPress={borrar}>
              <Text style={est.borrarTxt}>Eliminar esta etiqueta</Text>
            </Pressable>
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function crearEstilos(T: Tema) {
  return StyleSheet.create({
    raiz: { flex: 1, backgroundColor: T.fondo },
    cuerpo: { padding: T.esp },

    vigencia: {
      flexDirection: "row", alignItems: "center", gap: 8,
      padding: 10, borderRadius: T.radio,
      backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
    },
    vigPunto: { width: 7, height: 7, borderRadius: 4, backgroundColor: T.exito },
    vigTxt: { flex: 1, color: T.textoTenue, fontSize: 12, lineHeight: 17 },
    vigFecha: { color: T.textoTenue, fontSize: 10.5, marginTop: 5, textAlign: "center" },

    arranque: { paddingVertical: 20, alignItems: "center" },
    arranqueH: { color: T.texto, fontSize: 18, fontWeight: "800", textAlign: "center", marginBottom: 10 },
    arranqueP: { color: T.textoTenue, fontSize: 13.5, lineHeight: 20, textAlign: "center", marginBottom: 8 },
    arranqueNota: { color: T.textoTenue, fontSize: 12, textAlign: "center", opacity: 0.8 },

    fila: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
      borderRadius: T.radio, padding: 13, marginBottom: 8,
    },
    filaCont: {
      width: 34, height: 34, borderRadius: 10,
      backgroundColor: T.peligro + "22",
      alignItems: "center", justifyContent: "center",
    },
    filaContTxt: { color: T.peligro, fontWeight: "800", fontSize: 15 },
    filaNombre: { color: T.texto, fontSize: 15, fontWeight: "700" },
    filaMeta: { color: T.textoTenue, fontSize: 12, marginTop: 1 },
    flecha: { color: T.textoTenue, fontSize: 16 },

    segmento: {
      flexDirection: "row", gap: 4, padding: 4, marginBottom: 6,
      backgroundColor: T.superficie2 ?? T.superficie3, borderRadius: T.radio,
    },
    segBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: "center" },
    segTxt: { color: T.textoTenue, fontSize: 13, fontWeight: "700" },

    lbl: {
      color: T.textoTenue, fontSize: 10.5, fontWeight: "800",
      letterSpacing: 0.6, marginTop: 18, marginBottom: 6,
    },
    hint: { color: T.textoTenue, fontSize: 12, lineHeight: 17, marginBottom: 10 },
    filaCampos: { flexDirection: "row", gap: 10 },

    check: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
    checkCaja: {
      width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: T.borde,
      alignItems: "center", justifyContent: "center",
    },
    checkMarca: { color: "#fff", fontSize: 13, fontWeight: "800" },
    checkTxt: { flex: 1, color: T.texto, fontSize: 14 },

    radio: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
    radioCaja: {
      width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: T.borde,
      alignItems: "center", justifyContent: "center",
    },
    radioPunto: { width: 10, height: 10, borderRadius: 5 },
    radioEjemplo: { color: T.textoTenue, fontSize: 11, marginTop: 1 },

    masBtn: { paddingVertical: 14, alignItems: "center" },
    masTxt: { color: T.acento, fontSize: 13.5, fontWeight: "700" },
    avanzado: {
      padding: 14, borderRadius: T.radio,
      backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
    },

    ok: {
      padding: 14, borderRadius: T.radio, marginTop: 16,
      backgroundColor: T.exito + "14", borderWidth: 1, borderColor: T.exito + "55",
    },
    okTitulo: { color: T.exito, fontSize: 14.5, fontWeight: "800" },
    okNota: { color: T.textoTenue, fontSize: 12.5, lineHeight: 18, marginTop: 6 },

    resultado: { marginTop: 18 },
    resTitulo: { color: T.texto, fontSize: 15, fontWeight: "800", marginBottom: 12 },
    sellosFila: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    selloCaja: { alignItems: "center", width: 100 },
    selloRazon: { color: T.textoTenue, fontSize: 10, textAlign: "center", marginTop: 5, lineHeight: 14 },
    selloRazonIzq: { color: T.textoTenue, fontSize: 11, marginTop: 4, lineHeight: 15 },
    razonFila: { color: T.textoTenue, fontSize: 12, lineHeight: 17 },

    numAviso: {
      padding: 11, borderRadius: T.radio, marginBottom: 12,
      backgroundColor: T.acento + "14", borderWidth: 1, borderColor: T.acento + "55",
    },
    numAvisoTxt: { color: T.texto, fontSize: 12.5, lineHeight: 18 },

    impresion: {
      marginTop: 16, padding: 13, borderRadius: T.radio,
      backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
    },
    impTitulo: { color: T.textoTenue, fontSize: 10, fontWeight: "800", letterSpacing: 0.6, marginBottom: 7 },
    impFila: { color: T.textoTenue, fontSize: 12.5, lineHeight: 18, marginBottom: 3 },

    futuro: {
      marginTop: 14, padding: 12, borderRadius: T.radio,
      backgroundColor: (T.alerta ?? "#f59e0b") + "14",
      borderWidth: 1, borderColor: (T.alerta ?? "#f59e0b") + "55",
    },
    futuroTxt: { color: T.texto, fontSize: 12.5, lineHeight: 18 },

    sug: {
      padding: 14, borderRadius: T.radio, marginBottom: 10,
      backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
    },
    sugNoViable: { borderStyle: "dashed", opacity: 0.9 },
    sugSello: { color: T.textoTenue, fontSize: 10.5, fontWeight: "800", letterSpacing: 0.5 },
    sugAccion: { color: T.texto, fontSize: 14.5, fontWeight: "700", marginTop: 4, lineHeight: 20 },
    sugBarraFondo: {
      height: 8, borderRadius: 4, backgroundColor: T.peligro + "33",
      marginTop: 12, overflow: "hidden",
    },
    sugBarraObjetivo: { height: 8, borderRadius: 4, backgroundColor: T.exito },
    sugNums: { flexDirection: "row", justifyContent: "space-between", marginTop: 5 },
    sugNumTxt: { color: T.textoTenue, fontSize: 11.5 },
    sugBonus: { color: T.exito, fontSize: 12, lineHeight: 17, marginTop: 9 },
    sugNota: { color: T.textoTenue, fontSize: 11.5, lineHeight: 16, marginTop: 7 },

    aviso: {
      marginTop: 14, padding: 12, borderRadius: T.radio,
      backgroundColor: T.superficie2 ?? T.superficie3,
    },
    avisoTxt: { color: T.textoTenue, fontSize: 12, lineHeight: 17 },

    progreso: {
      alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 7,
      borderRadius: 8, backgroundColor: T.acento + "1f", marginBottom: 12,
    },
    progresoTxt: { color: T.acento, fontSize: 12.5, fontWeight: "700" },
    chk: {
      flexDirection: "row", gap: 11, paddingVertical: 10,
      borderBottomWidth: 1, borderBottomColor: T.borde,
    },
    chkMarca: {
      width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: T.borde,
      backgroundColor: T.superficie2 ?? T.superficie3,
      alignItems: "center", justifyContent: "center",
    },
    chkN: { color: T.texto, fontSize: 13.5, fontWeight: "600" },
    chkRef: { color: T.textoTenue, fontSize: 10.5, fontWeight: "400" },
    chkAyuda: { color: T.textoTenue, fontSize: 11.5, lineHeight: 16, marginTop: 2 },

    aclara: {
      padding: 14, borderRadius: T.radio, marginBottom: 16,
      backgroundColor: T.acento + "14", borderWidth: 1, borderColor: T.acento + "55",
    },
    aclaraTxt: { color: T.texto, fontSize: 13, lineHeight: 19 },
    tramite: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: T.borde },
    tramiteN: { color: T.texto, fontSize: 14.5, fontWeight: "700" },
    tramiteQuien: { color: T.textoTenue, fontSize: 11.5, marginTop: 2, marginBottom: 5 },
    tramiteDet: { color: T.textoTenue, fontSize: 12.5, lineHeight: 18 },
    fuente: {
      marginTop: 16, padding: 12, borderRadius: 8,
      backgroundColor: T.superficie2 ?? T.superficie3,
    },
    fuenteTxt: { color: T.textoTenue, fontSize: 11, lineHeight: 16 },

    barra: {
      flexDirection: "row", gap: 8, padding: T.esp,
      borderTopWidth: 1, borderTopColor: T.borde, backgroundColor: T.superficie,
    },
    accSec: {
      paddingHorizontal: 13, paddingVertical: 12, borderRadius: T.radio,
      borderWidth: 1, borderColor: T.borde, justifyContent: "center",
    },
    accSecTxt: { color: T.textoTenue, fontSize: 13, fontWeight: "700" },
    accPri: {
      flex: 1, paddingVertical: 12, borderRadius: T.radio,
      backgroundColor: T.acento, alignItems: "center", justifyContent: "center",
    },
    accPriTxt: { color: T.acentoTexto ?? "#fff", fontSize: 14.5, fontWeight: "800" },

    borrar: { paddingVertical: 12, alignItems: "center", backgroundColor: T.superficie },
    borrarTxt: { color: T.peligro, fontSize: 13, fontWeight: "600" },

    // Tarjeta de sustitución dentro de "Mejorar" — el color según nivel
    // (segura/advertencia/no_recomendada) se aplica aparte, con
    // estilosSustNivel/estilosBadgeNivel, porque depende de un valor en
    // tiempo de ejecución y StyleSheet.create no admite eso.
    sust: {
      marginTop: 12, padding: 12, borderRadius: T.radio, borderWidth: 1,
    },
    sustCab: { flexDirection: "row", marginBottom: 7 },
    sustBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
    sustBadgeTxt: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.4, color: "#fff" },
    sustTitulo: { color: T.texto, fontSize: 13.5, fontWeight: "700", marginBottom: 4 },
    sustTxt: { color: T.textoTenue, fontSize: 12, lineHeight: 17 },
    sustComo: { color: T.textoTenue, fontSize: 11.5, lineHeight: 16, marginTop: 7, fontStyle: "italic" },
    sustFalta: {
      marginTop: 10, padding: 10, borderRadius: T.radio,
      backgroundColor: T.acento + "14", borderWidth: 1, borderColor: T.acento + "44",
    },
    sustFaltaTxt: { color: T.acento, fontSize: 12, fontWeight: "600", lineHeight: 17 },
  });
}

/**
 * Color de la tarjeta según el nivel de la sustitución. Función aparte del
 * StyleSheet a propósito: el nivel se sabe hasta que se calcula la
 * sugerencia, no se puede fijar de antemano como el resto de los estilos.
 */
function estilosSustNivel(nivel: NivelSustitucion, T: Tema) {
  if (nivel === "segura") return { backgroundColor: T.exito + "12", borderColor: T.exito + "55" };
  if (nivel === "no_recomendada") return { backgroundColor: T.peligro + "12", borderColor: T.peligro + "55" };
  return { backgroundColor: (T.alerta ?? "#f59e0b") + "12", borderColor: (T.alerta ?? "#f59e0b") + "55" };
}

function estilosBadgeNivel(nivel: NivelSustitucion, T: Tema) {
  if (nivel === "segura") return { backgroundColor: T.exito };
  if (nivel === "no_recomendada") return { backgroundColor: T.peligro };
  return { backgroundColor: T.alerta ?? "#f59e0b" };
}
