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
//
// ---------------------------------------------------------------------------
// LOS SELLOS SVG NO SE TOCAN — Y ES A PROPÓSITO
// ---------------------------------------------------------------------------
// SelloSVG, SelloNumeroSVG y LeyendaSVG dibujan negro sobre blanco siempre,
// sin importar el tema activo. No es una decisión de estilo: son las
// proporciones y colores que exige el Apéndice A de la norma oficial. Un
// sello NOM-051 en el color de acento del usuario dejaría de ser un sello
// válido. Migrarlos al sistema de temas habría sido un error, no una mejora.
//
// ---------------------------------------------------------------------------
// QUÉ SÍ CAMBIÓ
// ---------------------------------------------------------------------------
// 1. "Eliminar esta etiqueta" borraba de un solo toque, sin confirmación
//    de ningún tipo. Se agregó una <Hoja> de confirmación, igual que en el
//    resto de la app.
// 2. Insignias de sustitución (SEGURA / CON AVISO / NO SE ACONSEJA): el
//    texto blanco fijo sobre el fondo de nivel FALLABA contraste de verdad
//    en tema oscuro — se midió, no se asumió: blanco sobre "alerta oscuro"
//    da 2.17:1 (el mínimo es 4.5), sobre "peligro oscuro" 2.78:1, y sobre
//    "éxito oscuro" ni el blanco (3.80) ni la tinta oscura (4.42) alcanzan
//    por sí solos. Se resolvió con texto oscuro para alerta/peligro en modo
//    oscuro (ambos pasan con holgura) y una variante de jade un poco más
//    profunda SOLO para este relleno de insignia en oscuro (contraste 5.51
//    con blanco) — sin tocar el T.exito que usa el resto de la app.
// 3. Nueve fallbacks defensivos muertos (`T.alerta ?? "#f59e0b"`,
//    `T.acentoTexto ?? "#fff"`, `T.superficie2 ?? T.superficie3`…): esos
//    campos siempre existen en el tema actual, así que el fallback nunca se
//    ejecutaba. Limpiados a la referencia directa.
// 4. Las casillas y radios usaban `T.acento` crudo con marca blanca fija —
//    el mismo bug de contraste con acentos claros ("Perla") que ya se
//    corrigió en el resto de la app. Ahora usan `T.acentoRelleno` +
//    `T.acentoTexto`.
// 5. BackHandler para las 6 sub-vistas (lista/calc/mejorar/etiqueta/
//    checklist/trámites): sin él, Atrás cerraba todo el modal en vez de
//    retroceder un nivel.

import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, Modal, ScrollView, KeyboardAvoidingView, ActivityIndicator, Share, BackHandler } from "react-native";
import Svg, { Polygon, Rect, Text as SvgText } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, CabeceraModal, Campo, Hoja, Txt, Monto, Vacio, useEstiloInput } from "@/src/componentes/ui";
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
// Sellos SVG — proporciones del Apéndice A. NO USAN T (tema). Ver nota arriba.
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
  const estiloInput = useEstiloInput();

  const [vista, setVista] = useState<Vista>("lista");
  const [perfiles, setPerfiles] = useState<PerfilEtiqueta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [avanzado, setAvanzado] = useState(false);
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);

  // Perfil en edición (siempre hay uno, aunque no se haya guardado).
  const [p, setP] = useState<Partial<PerfilEtiqueta>>({ ...PERFIL_VACIO });

  const cargar = useCallback(async () => {
    setCargando(true);
    try { setPerfiles(await listarPerfiles()); }
    finally { setCargando(false); }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  // Atrás del sistema: retrocede un nivel en vez de cerrar todo el modal.
  useEffect(() => {
    const alPresionarAtras = () => {
      if (vista === "mejorar" || vista === "etiqueta" || vista === "checklist") {
        setVista("calc");
        return true;
      }
      if (vista === "calc" || vista === "tramites") {
        setVista("lista");
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", alPresionarAtras);
    return () => sub.remove();
  }, [vista]);

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

  async function confirmarBorrado() {
    if (!p.id) {
      setConfirmandoBorrado(false);
      return setVista("lista");
    }
    await eliminarPerfil(p.id);
    await cargar();
    setConfirmandoBorrado(false);
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

  // LAS SEIS VISTAS SON FUNCIONES, NO COMPONENTES — Y ESO ES A PROPÓSITO
  // ------------------------------------------------------------------------
  // Antes eran `function VistaCalc()` y se montaban como `<VistaCalc />`. Al
  // escribir en cualquier campo, cada letra llamaba a `set(...)`, el modal se
  // volvía a renderizar, y JavaScript creaba una función `VistaCalc` NUEVA —
  // idéntica en código, distinta en identidad. React lo lee como "otro
  // componente", no como el mismo actualizado: desmonta el subárbol entero y
  // monta uno nuevo. El TextInput con el foco dejaba de existir y Android
  // cerraba el teclado. Había que tocar el campo por cada letra.
  //
  // Llamándolas como funciones (`vistaCalc()`), el JSX queda inlineado en el
  // render del padre: React compara View / TextInput / ScrollView, que son
  // estables. No hay remontaje y el foco sobrevive.
  //
  // Ninguna de las seis usa hooks, por eso el cambio es seguro. Si alguna
  // llegara a necesitar useState o useEffect, NO basta con volver a
  // convertirla en componente interno: hay que sacarla a nivel de módulo y
  // pasarle lo que necesite por props.
  function vistaLista() {
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }}>
        <View
          style={{
            flexDirection: "row", alignItems: "center", gap: T.esps.sm,
            padding: T.esps.md, borderRadius: T.radio,
            backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
          }}
        >
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: T.exito }} />
          <Txt escala="micro" tono="tenue" estilo={{ flex: 1 }}>
            Vigente: <Txt escala="micro" fuerte>Fase {faseVigente()}</Txt> · la Fase 3 aplica desde
            el 1 de enero de 2028
          </Txt>
        </View>
        <Txt escala="micro" tono="tenue" estilo={{ textAlign: "center", marginTop: T.esps.xs }}>
          Verificado contra el texto oficial el {FECHA_VERIFICACION}
        </Txt>

        <View style={{ marginTop: T.esps.lg, marginBottom: T.esps.lg }}>
          <Boton titulo="+ Calcular un producto" onPress={nuevo} />
        </View>

        {cargando ? (
          <ActivityIndicator color={T.acento} style={{ marginTop: T.esps.xl }} />
        ) : perfiles.length === 0 ? (
          <Vacio
            titulo="¿Tu producto necesita sellos?"
            texto="Si fabricas lo que vendes — postres, panadería, conservas, salsas — captura cinco números y te digo qué sellos te tocan, de qué tamaño van en tu envase, y qué tendrías que ajustar para quitártelos. Todo el cálculo se hace en tu teléfono."
          />
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
              <Pressable
                key={x.id}
                onPress={() => abrir(x)}
                style={({ pressed }) => [
                  { flexDirection: "row", alignItems: "center", gap: T.esps.md, backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde, borderRadius: T.radio, padding: T.esps.md, marginBottom: T.esps.sm },
                  pressed && { backgroundColor: T.superficie3 },
                ]}
              >
                <View
                  style={{
                    width: 34, height: 34, borderRadius: T.radioChico, alignItems: "center", justifyContent: "center",
                    backgroundColor: n === 0 ? T.exitoSuave : T.peligroSuave,
                  }}
                >
                  <Monto texto={String(n)} escala="cuerpo" tono={n === 0 ? "exito" : "peligro"} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt escala="cuerpo" fuerte lineas={1}>{x.nombre}</Txt>
                  <Txt escala="micro" tono="tenue">
                    {x.tipo === "liquido" ? "Líquido" : "Sólido"} ·{" "}
                    {r.motivo === "exento" ? "exento"
                      : r.motivo === "sin_anadidos" ? "sin añadidos"
                      : n === 0 ? "sin sellos" : `${n} sello${n > 1 ? "s" : ""}`}
                  </Txt>
                </View>
                <Txt escala="titulo" tono="tenue">›</Txt>
              </Pressable>
            );
          })
        )}

        <View style={{ marginTop: T.esps.xl }}>
          <Boton titulo="¿Qué trámites necesito?" tipo="secundario" onPress={() => setVista("tramites")} />
        </View>
        <View style={{ height: T.esps.xxl }} />
      </ScrollView>
    );
  }

  // ─────────────────────────────────────────────────────── Calculadora

  function vistaCalc() {
    const exento = (p.exencion ?? "ninguna") !== "ninguna";
    const u = p.tipo === "liquido" ? "ml" : "g";
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }} keyboardShouldPersistTaps="handled">
        <Banner texto={error} tipo="error" />

        <Campo label="¿Qué producto es?">
          <TextInput style={estiloInput} value={p.nombre ?? ""} onChangeText={(v) => set("nombre", v)}
            placeholder="Ej. Galletas de avena" placeholderTextColor={T.textoTenue} />
        </Campo>

        <Segmentado
          opciones={[
            { id: "solido", label: "Sólido (100 g)" },
            { id: "liquido", label: "Líquido (100 ml)" },
          ]}
          valor={p.tipo ?? "solido"}
          onCambio={(v) => set("tipo", v)}
        />

        {!exento && (
          <>
            <Txt escala="micro" tono="tenue" fuerte mayus estilo={{ marginTop: T.esps.lg, marginBottom: T.esps.xs }}>
              ¿Qué le agregaste durante la elaboración?
            </Txt>
            <Txt escala="pie" tono="tenue" estilo={{ marginBottom: T.esps.sm }}>
              Márcalo si el ingrediente ESTÁ en tu receta — la cantidad de
              siempre, no algo extra aparte de eso. Si tu lista lleva azúcar,
              aceite o sal, es un nutriente añadido y cuenta, aunque sea la
              medida normal de la receta. Lo que NO cuenta es lo que el
              propio ingrediente ya trae por su naturaleza (la lactosa de la
              leche, el azúcar de una fruta) — eso no lleva sello aunque el
              número salga alto.
            </Txt>
            {([
              ["anade_azucares", "Azúcar, miel o jarabe"],
              ["anade_grasas", "Grasa, aceite o manteca"],
              ["anade_sodio", "Sal o algo con sodio"],
            ] as const).map(([k, txt]) => (
              <CheckFila key={k} label={txt} valor={!!p[k]} onCambio={() => set(k, p[k] ? 0 : 1)} />
            ))}

            <Txt escala="micro" tono="tenue" fuerte mayus estilo={{ marginTop: T.esps.lg, marginBottom: T.esps.sm }}>
              Por cada 100 {u.toUpperCase()}
            </Txt>
            <View style={{ flexDirection: "row", gap: T.esps.sm }}>
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
            <View style={{ flexDirection: "row", gap: T.esps.sm }}>
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
        {renderResultado()}

        {/* Lo avanzado no estorba: se despliega solo si lo piden */}
        <Pressable onPress={() => setAvanzado((v) => !v)} style={{ paddingVertical: T.esps.md, alignItems: "center" }}>
          <Txt escala="pie" tono="acento" fuerte>{avanzado ? "− Menos opciones" : "+ Más opciones"}</Txt>
        </Pressable>

        {avanzado && (
          <View style={{ padding: T.esps.md, borderRadius: T.radio, backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde }}>
            <Campo label="Tamaño del envase (cm²)" ayuda="La cara principal, la que ve el cliente. Define el tamaño del sello.">
              <TextInput style={estiloInput} value={valNum(p.area_cm2)}
                onChangeText={(v) => setNum("area_cm2", v)} keyboardType="decimal-pad"
                placeholder="Ej. 120" placeholderTextColor={T.textoTenue} />
            </Campo>

            {([
              ["contiene_cafeina", "Lleva cafeína añadida"],
              ["contiene_edulcorantes", "Lleva edulcorantes"],
            ] as const).map(([k, txt]) => (
              <CheckFila key={k} label={txt} valor={!!p[k]} onCambio={() => set(k, p[k] ? 0 : 1)} />
            ))}

            <Txt escala="micro" tono="tenue" fuerte mayus estilo={{ marginTop: T.esps.lg, marginBottom: T.esps.xs }}>
              ¿Es un producto exento?
            </Txt>
            <Txt escala="pie" tono="tenue" estilo={{ marginBottom: T.esps.sm }}>
              Algunos productos no llevan sellos nunca, sin importar sus valores.
            </Txt>
            {EXENCIONES.map((x) => (
              <RadioFila key={x.id} label={x.n} activo={p.exencion === x.id} onPress={() => set("exencion", x.id)} />
            ))}

            <Txt escala="micro" tono="tenue" fuerte mayus estilo={{ marginTop: T.esps.lg, marginBottom: T.esps.xs }}>
              ¿Qué tipo de receta es?
            </Txt>
            <Txt escala="pie" tono="tenue" estilo={{ marginBottom: T.esps.sm }}>
              Para que, si algún día quieres bajar un sello, la app sepa si el ingrediente que
              tocarías está ahí solo por sabor o si además conserva tu producto.
            </Txt>
            {CATEGORIAS_RECETA.map((c) => (
              <RadioFila
                key={c.id}
                label={c.n}
                ejemplo={c.ejemplos}
                activo={(p.categoria_receta ?? "otro") === c.id}
                onPress={() => set("categoria_receta", c.id)}
              />
            ))}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    );
  }

  // Mismo motivo que las vistas de arriba: funcion, no componente. Este se
  // escapo en la primera pasada y dejaba la pantalla de NOM-051 con el bug
  // a medias. Se llama con llaves: {renderResultado()}.
  function renderResultado() {
    const r = resultado;
    if (r.motivo === "exento" || r.motivo === "sin_anadidos") {
      return (
        <View style={{ padding: T.esps.md, borderRadius: T.radio, marginTop: T.esps.lg, backgroundColor: T.exitoSuave, borderWidth: 1, borderColor: T.exito + "55" }}>
          <Txt escala="pie" tono="exito" fuerte>✓ No lleva sellos</Txt>
          <Txt escala="micro" tono="tenue" estilo={{ marginTop: T.esps.xs }}>{r.explicacion}</Txt>
          {r.leyendas.length > 0 && (
            <View style={{ marginTop: T.esps.md, gap: T.esps.sm }}>
              {r.leyendas.map((l) => <LeyendaSVG key={l.id} texto={l.etiqueta} ancho={250} />)}
            </View>
          )}
        </View>
      );
    }
    if (r.sellos.length === 0 && r.leyendas.length === 0) {
      const comp = compararFases(datos);
      return (
        <View style={{ padding: T.esps.md, borderRadius: T.radio, marginTop: T.esps.lg, backgroundColor: T.exitoSuave, borderWidth: 1, borderColor: T.exito + "55" }}>
          <Txt escala="pie" tono="exito" fuerte>✓ Con estos datos, no lleva sellos</Txt>
          {comp.nuevos.length > 0 && (
            <Txt escala="micro" tono="tenue" estilo={{ marginTop: T.esps.xs }}>
              Ojo: a partir de 2028 tendría {comp.nuevos.length} sello{comp.nuevos.length > 1 ? "s" : ""}.
            </Txt>
          )}
          <Txt escala="micro" tono="tenue" estilo={{ marginTop: T.esps.xs }}>
            Puedes declararlo por escrito: «Este producto no contiene sellos ni leyendas» (4.1.4 Bis).
          </Txt>
        </View>
      );
    }

    const comp = compararFases(datos);
    const usaNumero = reglas.usaNumero && r.sellos.length > 0;
    return (
      <View style={{ marginTop: T.esps.lg }}>
        <Txt escala="cuerpo" fuerte estilo={{ marginBottom: T.esps.md }}>
          {r.sellos.length > 0
            ? `Llevaría ${r.sellos.length} sello${r.sellos.length === 1 ? "" : "s"}`
            : "Llevaría estas leyendas"}
        </Txt>

        {usaNumero ? (
          <>
            <View style={{ padding: T.esps.sm, borderRadius: T.radio, marginBottom: T.esps.md, backgroundColor: T.acentoSuave, borderWidth: 1, borderColor: T.acento + "55" }}>
              <Txt escala="pie">
                Tu envase mide {reglas.area} cm². Por ser de 40 cm² o menos, va{" "}
                <Txt escala="pie" fuerte>un solo sello con el número</Txt> en vez de los
                individuales (4.5.3.4.2).
              </Txt>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: T.esps.md }}>
              <SelloNumeroSVG cuantos={r.sellos.length} size={120} />
            </View>
            <View style={{ marginTop: T.esps.sm, gap: T.esps.xs }}>
              {r.sellos.map((s) => (
                <Txt key={s.id} escala="pie" tono="tenue">
                  <Txt escala="pie" fuerte>{s.etiqueta}</Txt> — {s.razon}
                </Txt>
              ))}
            </View>
          </>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: T.esps.md }}>
            {r.sellos.map((s) => (
              <View key={s.id} style={{ alignItems: "center", width: 100 }}>
                <SelloSVG texto={s.etiqueta} size={92} />
                <Txt escala="micro" tono="tenue" estilo={{ textAlign: "center", marginTop: T.esps.xs }}>{s.razon}</Txt>
              </View>
            ))}
          </View>
        )}

        {r.leyendas.length > 0 && (
          <View style={{ marginTop: T.esps.md, gap: T.esps.sm }}>
            {r.leyendas.map((l) => (
              <View key={l.id}>
                <LeyendaSVG texto={l.etiqueta} ancho={280} />
                <Txt escala="pie" tono="tenue" estilo={{ marginTop: T.esps.xs }}>{l.razon}</Txt>
              </View>
            ))}
          </View>
        )}

        {r.sellos.length > 0 && (
          <View style={{ marginTop: T.esps.lg }}>
            <Boton titulo="¿Cómo le quito un sello?" tipo="secundario" onPress={() => setVista("mejorar")} />
          </View>
        )}

        {reglas.conocida && r.sellos.length > 0 && (
          <View style={{ marginTop: T.esps.lg, padding: T.esps.md, borderRadius: T.radio, backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde }}>
            <Txt escala="micro" tono="tenue" fuerte mayus estilo={{ marginBottom: T.esps.xs }}>Cómo va en tu envase</Txt>
            <Txt escala="pie" tono="tenue" estilo={{ marginBottom: 3 }}>
              Tamaño de cada sello: <Txt escala="pie" fuerte>{reglas.ancho ? `${reglas.ancho} × ${reglas.alto} cm` : reglas.nota}</Txt>
            </Txt>
            <Txt escala="pie" tono="tenue" estilo={{ marginBottom: 3 }}>{reglas.ubicacion}</Txt>
            {r.sellos.length > 1 && !usaNumero && (
              <Txt escala="pie" tono="tenue">Van de izquierda a derecha, en el orden de arriba.</Txt>
            )}
          </View>
        )}

        {comp.nuevos.length > 0 && (
          <View style={{ marginTop: T.esps.md, padding: T.esps.md, borderRadius: T.radio, backgroundColor: T.alertaSuave, borderWidth: 1, borderColor: T.alerta + "55" }}>
            <Txt escala="pie">
              <Txt escala="pie" fuerte>Desde el 1 de enero de 2028</Txt> (Fase 3), este mismo
              producto llevaría {comp.nuevos.length} sello{comp.nuevos.length > 1 ? "s" : ""} más
              sin cambiarle nada: {comp.nuevos.map((s) => s.etiqueta).join(", ")}.
            </Txt>
          </View>
        )}
      </View>
    );
  }

  // ─────────────────────────────────────────────────────── Mejorar

  function vistaMejorar() {
    const { sugerencias, quedariaLimpio, leyendasFijas } = sugerenciasParaQuitarSellos(datos);
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }}>
        <Txt escala="pie" tono="tenue" estilo={{ marginBottom: T.esps.md }}>
          Estos son los números exactos para perder cada sello. Al bajar azúcar o grasa también
          bajan las calorías, así que a veces un solo ajuste quita dos sellos — ya está contado.
        </Txt>

        {sugerencias.map((s: Sugerencia) => {
          const esNutriente = s.selloId === "azucares" || s.selloId === "grasas_sat"
            || s.selloId === "grasas_trans" || s.selloId === "sodio";
          const categoria = (p.categoria_receta ?? "otro") as CategoriaReceta;
          const opciones = esNutriente ? sustitucionesPara(s.selloId as any, categoria) : [];
          return (
            <View
              key={s.selloId}
              style={{
                padding: T.esps.md, borderRadius: T.radio, marginBottom: T.esps.sm,
                backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
                borderStyle: s.viable ? "solid" : "dashed", opacity: s.viable ? 1 : 0.9,
              }}
            >
              <Txt escala="micro" tono="tenue" fuerte mayus>{s.etiqueta}</Txt>
              <Txt escala="cuerpo" fuerte tono={s.viable ? "principal" : "tenue"} estilo={{ marginTop: 4 }}>
                {s.accion}
              </Txt>

              {s.viable && s.actual > 0 && (
                <View style={{ height: 8, borderRadius: 4, backgroundColor: T.peligroSuave, marginTop: T.esps.md, overflow: "hidden" }}>
                  <View style={{ height: 8, borderRadius: 4, backgroundColor: T.exito, width: `${Math.max(4, (s.objetivo / s.actual) * 100)}%` }} />
                </View>
              )}
              {s.viable && s.actual > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: T.esps.xs }}>
                  <Txt escala="micro" tono="tenue">Ahora: {s.actual.toFixed(1).replace(/\.0$/, "")} {s.unidad}</Txt>
                  <Monto texto={`Meta: ${s.objetivo.toFixed(1).replace(/\.0$/, "")} ${s.unidad}`} escala="micro" tono="exito" />
                </View>
              )}

              {s.bonus && <Txt escala="pie" tono="exito" estilo={{ marginTop: T.esps.sm }}>↳ {s.bonus}</Txt>}
              {s.nota && <Txt escala="micro" tono="tenue" estilo={{ marginTop: T.esps.xs }}>{s.nota}</Txt>}

              {opciones.map((op, i) => (
                <TarjetaSustitucion key={i} op={op} />
              ))}
              {esNutriente && opciones.length === 0 && (p.categoria_receta ?? "otro") === "otro" && (
                <Pressable
                  onPress={() => setVista("calc")}
                  style={{ marginTop: T.esps.sm, padding: T.esps.sm, borderRadius: T.radio, backgroundColor: T.acentoSuave, borderWidth: 1, borderColor: T.acento + "44" }}
                >
                  <Txt escala="pie" tono="acento" fuerte>
                    Dinos qué tipo de receta es (en «+ Más opciones») para darte un consejo
                    específico de sustitución →
                  </Txt>
                </Pressable>
              )}
            </View>
          );
        })}

        {sugerencias.length > 0 && (
          <View style={{ padding: T.esps.md, borderRadius: T.radio, marginTop: T.esps.xs, backgroundColor: T.exitoSuave, borderWidth: 1, borderColor: T.exito + "55" }}>
            <Txt escala="pie" tono="exito" fuerte>
              {quedariaLimpio ? "✓ Aplicando todo, tu producto quedaría sin sellos"
                              : "Aun aplicando todo, quedaría con algún sello"}
            </Txt>
            {leyendasFijas.length > 0 && (
              <Txt escala="micro" tono="tenue" estilo={{ marginTop: T.esps.xs }}>
                Las leyendas de cafeína o edulcorantes no dependen de las cantidades: para quitarlas
                habría que sacar ese ingrediente de la receta.
              </Txt>
            )}
          </View>
        )}

        <View style={{ marginTop: T.esps.lg, padding: T.esps.md, borderRadius: T.radio, backgroundColor: T.superficie2 }}>
          <Txt escala="pie" tono="tenue">
            Bajar estos ingredientes cambia el sabor y la textura, y a veces la conservación.
            Después de ajustar tu receta, los valores hay que medirlos de nuevo — no basta con
            restar en el papel.
          </Txt>
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>
    );
  }

  // ─────────────────────────────────────────────────────── Etiqueta

  function vistaEtiqueta() {
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
      <ScrollView contentContainerStyle={{ padding: T.esp }} keyboardShouldPersistTaps="handled">
        <Txt escala="pie" tono="tenue" estilo={{ marginBottom: T.esps.md }}>
          Todo esto es opcional — llena lo que tengas. Sirve para compartir la etiqueta completa
          con tu diseñador o tu imprenta.
        </Txt>
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

        <Txt escala="micro" tono="tenue" fuerte mayus estilo={{ marginTop: T.esps.md, marginBottom: T.esps.xs }}>
          Resto de la tabla — por 100 {u.toUpperCase()}
        </Txt>
        <Txt escala="pie" tono="tenue" estilo={{ marginBottom: T.esps.sm }}>
          No cambian los sellos, pero la tabla de tu etiqueta sí los exige.
        </Txt>
        <View style={{ flexDirection: "row", gap: T.esps.sm }}>
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
        <View style={{ flexDirection: "row", gap: T.esps.sm }}>
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

  function vistaChecklist() {
    const tiene: Record<string, boolean> = {
      denominacion: !!p.denominacion, ingredientes: !!p.ingredientes,
      alergenos: !!p.alergenos, contenido: !!p.contenido_neto,
      responsable: !!(p.responsable_nombre && p.responsable_domicilio),
      lote: !!p.lote, caducidad: !!p.caducidad, origen: !!p.pais_origen,
      nutrimental: (Number(p.calorias_kcal) || 0) > 0, conservacion: !!p.conservacion,
    };
    const listos = Object.values(tiene).filter(Boolean).length;
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }}>
        <Txt escala="pie" tono="tenue" estilo={{ marginBottom: T.esps.md }}>
          Los sellos son una parte de la etiqueta, no toda. Esto es lo demás que exige la norma.
        </Txt>
        <View style={{ alignSelf: "flex-start", paddingHorizontal: T.esps.md, paddingVertical: T.esps.sm, borderRadius: T.radioChico, backgroundColor: T.acentoSuave, marginBottom: T.esps.md }}>
          <Monto texto={`${listos} de ${CHECKLIST_ETIQUETA.length} completos`} escala="pie" tono="acento" />
        </View>
        {CHECKLIST_ETIQUETA.map((c) => (
          <View key={c.id} style={{ flexDirection: "row", gap: T.esps.md, paddingVertical: T.esps.sm, borderBottomWidth: 1, borderBottomColor: T.borde }}>
            <View
              style={{
                width: 20, height: 20, borderRadius: T.radioChico, borderWidth: 1, alignItems: "center", justifyContent: "center",
                borderColor: tiene[c.id] ? T.exito + "66" : T.borde,
                backgroundColor: tiene[c.id] ? T.exitoSuave : T.superficie2,
              }}
            >
              {tiene[c.id] && <Txt escala="micro" tono="exito" fuerte>✓</Txt>}
            </View>
            <View style={{ flex: 1 }}>
              <Txt escala="pie" tono={tiene[c.id] ? "tenue" : "principal"} fuerte={!tiene[c.id]}>
                {c.n} <Txt escala="micro" tono="tenue">{c.ref}</Txt>
              </Txt>
              <Txt escala="micro" tono="tenue" estilo={{ marginTop: 2 }}>{c.ayuda}</Txt>
            </View>
          </View>
        ))}
        <View style={{ height: 60 }} />
      </ScrollView>
    );
  }

  // ─────────────────────────────────────────────────────── Trámites

  function vistaTramites() {
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }}>
        <View style={{ padding: T.esps.md, borderRadius: T.radio, marginBottom: T.esps.lg, backgroundColor: T.acentoSuave, borderWidth: 1, borderColor: T.acento + "55" }}>
          <Txt escala="pie">
            <Txt escala="pie" fuerte>No existe un trámite para que te «aprueben» el sello.</Txt> La
            norma lo dice textualmente: su evaluación «no es certificable y se puede llevar a cabo
            a través de un esquema voluntario» (numeral 9). Tú etiquetas bajo tu responsabilidad y la
            autoridad verifica después.
          </Txt>
        </View>
        {TRAMITES.map((t) => (
          <View key={t.id} style={{ paddingVertical: T.esps.md, borderBottomWidth: 1, borderBottomColor: T.borde }}>
            <Txt escala="cuerpo" fuerte>{t.n}</Txt>
            <Txt escala="micro" tono="tenue" estilo={{ marginTop: 2, marginBottom: T.esps.xs }}>{t.quien}</Txt>
            <Txt escala="pie" tono="tenue">{t.detalle}</Txt>
          </View>
        ))}
        <View style={{ marginTop: T.esps.lg, padding: T.esps.md, borderRadius: T.radioChico, backgroundColor: T.superficie2 }}>
          <Txt escala="micro" tono="tenue">
            Verificado el {FECHA_VERIFICACION} contra el texto íntegro de la NOM-051
            (DOF 27/03/2020) y el Acuerdo de fases (DOF 31/07/2025). Las fechas se han recorrido
            dos veces: si lees esto después de 2027, confirma en el Diario Oficial.
          </Txt>
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
          <CabeceraModal titulo={cab.t} izquierda={cab.i} onIzquierda={cab.f} />

          {vista === "lista" && vistaLista()}
          {vista === "calc" && vistaCalc()}
          {vista === "mejorar" && vistaMejorar()}
          {vista === "etiqueta" && vistaEtiqueta()}
          {vista === "checklist" && vistaChecklist()}
          {vista === "tramites" && vistaTramites()}

          {/* Barra de acciones: solo en las vistas de trabajo */}
          {(vista === "calc" || vista === "etiqueta" || vista === "checklist") && (
            <View style={{ flexDirection: "row", gap: T.esps.sm, padding: T.esp, borderTopWidth: 1, borderTopColor: T.borde, backgroundColor: T.superficie }}>
              {vista === "calc" ? (
                <>
                  <BotonSecundarioChico label="Etiqueta" onPress={() => setVista("etiqueta")} />
                  <BotonSecundarioChico label="Checklist" onPress={() => setVista("checklist")} />
                </>
              ) : (
                <BotonSecundarioChico label="Sellos" onPress={() => setVista("calc")} />
              )}
              {p.id ? <BotonSecundarioChico label="Compartir" onPress={compartir} /> : null}
              <Pressable
                onPress={guardar}
                disabled={guardando}
                style={{ flex: 1, paddingVertical: T.esps.md, borderRadius: T.radio, backgroundColor: T.acentoRelleno, alignItems: "center", justifyContent: "center", opacity: guardando ? 0.6 : 1 }}
              >
                <Txt escala="pie" fuerte estilo={{ color: T.acentoTexto }}>{guardando ? "Guardando…" : "Guardar"}</Txt>
              </Pressable>
            </View>
          )}

          {vista === "calc" && p.id ? (
            <Pressable
              onPress={() => setConfirmandoBorrado(true)}
              style={{ paddingVertical: T.esps.md, alignItems: "center", backgroundColor: T.superficie }}
            >
              <Txt escala="pie" tono="peligro">Eliminar esta etiqueta</Txt>
            </Pressable>
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Confirmación de borrado: antes NO existía — un toque y desaparecía. */}
      <Hoja
        visible={confirmandoBorrado}
        onCerrar={() => setConfirmandoBorrado(false)}
        titulo="Eliminar etiqueta"
        pie={
          <View style={{ gap: T.esps.sm }}>
            <Boton titulo="Eliminar" tipo="peligro" onPress={confirmarBorrado} />
            <Boton titulo="Cancelar" tipo="secundario" onPress={() => setConfirmandoBorrado(false)} />
          </View>
        }
      >
        <Txt escala="pie" tono="suave">
          {p.nombre ? `¿Eliminar "${p.nombre}"? No se puede deshacer.` : "¿Eliminar esta etiqueta? No se puede deshacer."}
        </Txt>
      </Hoja>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Piezas locales
// ---------------------------------------------------------------------------

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
            style={{ flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: T.radioChico, backgroundColor: activo ? T.acentoRelleno : "transparent" }}
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

// Antes: fondo T.acento crudo + marca blanca fija — el mismo bug de
// contraste con acentos claros ("Perla") que ya se corrigió en el resto de
// la app. Ahora T.acentoRelleno + T.acentoTexto, que se resuelven según la
// luminosidad del acento activo.
function CheckFila({ label, valor, onCambio }: { label: string; valor: boolean; onCambio: () => void }) {
  const { tema: T } = useTema();
  return (
    <Pressable onPress={onCambio} style={{ flexDirection: "row", alignItems: "center", gap: T.esps.sm, paddingVertical: T.esps.xs }}>
      <View
        style={{
          width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center",
          borderColor: valor ? T.acentoRelleno : T.borde,
          backgroundColor: valor ? T.acentoRelleno : "transparent",
        }}
      >
        {valor && <Txt escala="micro" fuerte estilo={{ color: T.acentoTexto }}>✓</Txt>}
      </View>
      <Txt escala="pie" estilo={{ flex: 1 }}>{label}</Txt>
    </Pressable>
  );
}

function RadioFila({
  label,
  ejemplo,
  activo,
  onPress,
}: {
  label: string;
  ejemplo?: string;
  activo: boolean;
  onPress: () => void;
}) {
  const { tema: T } = useTema();
  return (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: T.esps.sm, paddingVertical: T.esps.xs }}>
      <View
        style={{
          width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center",
          borderColor: activo ? T.acentoRelleno : T.borde,
        }}
      >
        {activo && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: T.acentoRelleno }} />}
      </View>
      <View style={{ flex: 1 }}>
        <Txt escala="pie">{label}</Txt>
        {ejemplo ? <Txt escala="micro" tono="tenue" estilo={{ marginTop: 1 }}>{ejemplo}</Txt> : null}
      </View>
    </Pressable>
  );
}

function BotonSecundarioChico({ label, onPress }: { label: string; onPress: () => void }) {
  const { tema: T } = useTema();
  return (
    <Pressable
      onPress={onPress}
      style={{ paddingHorizontal: T.esps.md, paddingVertical: T.esps.md, borderRadius: T.radio, borderWidth: 1, borderColor: T.borde, justifyContent: "center" }}
    >
      <Txt escala="pie" tono="suave" fuerte>{label}</Txt>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Insignia de sustitución — el contraste se calculó, no se asumió
// ---------------------------------------------------------------------------
//
// El texto blanco fijo sobre el fondo de nivel fallaba de verdad en tema
// oscuro: 2.17:1 sobre "alerta", 2.78:1 sobre "peligro" (el mínimo es
// 4.5:1). Se resuelve con texto oscuro para esos dos en modo oscuro (ambos
// pasan con holgura verificada), y una variante de jade un poco más
// profunda SOLO para este relleno — el T.exito normal no basta ni con
// blanco (3.80) ni con tinta oscura (4.42) encima.
const JADE_INSIGNIA_OSCURO = "#477164"; // contraste 5.51 con blanco, verificado
const TINTA_OSCURA = "#1c1d24";

function coloresNivel(nivel: NivelSustitucion, T: Tema) {
  if (nivel === "segura") {
    return T.esClaro
      ? { fondo: T.exito, borde: T.exito + "55", texto: "#ffffff" }
      : { fondo: JADE_INSIGNIA_OSCURO, borde: T.exito + "55", texto: "#ffffff" };
  }
  if (nivel === "no_recomendada") {
    return T.esClaro
      ? { fondo: T.peligro, borde: T.peligro + "55", texto: "#ffffff" }
      : { fondo: T.peligro, borde: T.peligro + "55", texto: TINTA_OSCURA };
  }
  // advertencia
  return T.esClaro
    ? { fondo: T.alerta, borde: T.alerta + "55", texto: "#ffffff" }
    : { fondo: T.alerta, borde: T.alerta + "55", texto: TINTA_OSCURA };
}

function TarjetaSustitucion({ op }: { op: { nivel: NivelSustitucion; titulo: string; explicacion: string; como?: string } }) {
  const { tema: T } = useTema();
  const col = coloresNivel(op.nivel, T);
  return (
    <View style={{ marginTop: T.esps.md, padding: T.esps.md, borderRadius: T.radio, borderWidth: 1, backgroundColor: col.fondo + "12", borderColor: col.borde }}>
      <View style={{ flexDirection: "row", marginBottom: T.esps.xs }}>
        <View style={{ paddingHorizontal: T.esps.sm, paddingVertical: 3, borderRadius: T.radioPildora, backgroundColor: col.fondo }}>
          <Text style={{ fontSize: 9.5, fontWeight: "800", letterSpacing: 0.4, color: col.texto }}>
            {op.nivel === "segura" ? "SEGURA" : op.nivel === "advertencia" ? "CON AVISO" : "NO SE ACONSEJA"}
          </Text>
        </View>
      </View>
      <Txt escala="pie" fuerte estilo={{ marginBottom: T.esps.xs }}>{op.titulo}</Txt>
      <Txt escala="micro" tono="tenue">{op.explicacion}</Txt>
      {op.como && (
        <Txt escala="micro" tono="tenue" estilo={{ marginTop: T.esps.sm, fontStyle: "italic" }}>{op.como}</Txt>
      )}
    </View>
  );
}
