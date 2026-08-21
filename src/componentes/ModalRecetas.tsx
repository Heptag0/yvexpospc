// YvexPOS Móvil — Recetas y Despensa.
//
// Costeo de productos fabricados (pasteles, pizzas, hamburguesas...) a
// partir de una despensa de ingredientes reutilizable. Cada línea de
// receta congela su costo al guardar; el usuario puede refrescarlo al
// precio actual de la despensa (editando la receta) o escribir uno manual
// si esta vez lo compró distinto.
//
// La despensa y el catálogo de productos son mundos separados a propósito:
// un ingrediente JAMÁS aparece en Inventario. Solo la receta terminada,
// con un botón explícito, crea un producto de venta normal.
//
// ---------------------------------------------------------------------------
// LO QUE SE AÑADIÓ RESPECTO AL PC
// ---------------------------------------------------------------------------
// El PC no tiene forma de sumarle IVA al precio sugerido — hay que hacerlo
// a mano antes de mandar la receta al catálogo. Aquí sí: un interruptor
// junto al precio sugerido, "Agregar 16% de IVA", que se puede prender o
// apagar por receta. Al mandar al catálogo, el precio que se manda ya
// refleja el interruptor (pero sigue siendo editable a mano justo ahí).
//
// El margen se controla con un stepper −/+ de 5 en 5, no un slider: el PC
// usa <input type="range">, que no tiene equivalente confirmado instalado
// en este proyecto (no se asume @react-native-community/slider sin
// verificarlo). Mismo rango (0-90%) y mismo paso (5) que el PC.

import { useCallback, useEffect, useRef, useState } from "react";
import { View, TextInput, Pressable, ScrollView, ActivityIndicator, BackHandler } from "react-native";
import { useTema } from "@/src/componentes/TemaProvider";
import {
  Boton, Banner, Campo, Hoja, Grupo, Fila, Lamina,
  Txt, Monto, Vacio, useEstiloInput,
} from "@/src/componentes/ui";
import { pesos } from "@/src/base/formato";
import {
  Ingrediente, NuevoIngrediente, CandidatoNutricion,
  listarIngredientes, crearIngrediente, editarIngrediente, eliminarIngrediente,
  buscarNutricionPorNombre,
} from "@/src/base/despensa";
import {
  RecetaResumen, LineaRecetaEntrada,
  listarResumen, obtenerReceta, guardarReceta, eliminarReceta, crearProductoDesdeReceta,
} from "@/src/base/recetas";

type Vista = "lista" | "despensa" | "despensaForm" | "detalle";

const UNIDADES: { id: "g" | "ml" | "pieza"; nombre: string }[] = [
  { id: "g", nombre: "gramos" },
  { id: "ml", nombre: "mililitros" },
  { id: "pieza", nombre: "pieza" },
];

const IVA_TASA = 0.16;

type LineaEditor = {
  ingrediente_id: string;
  nombre: string;
  unidad: string;
  cantidad_usada: string; // texto mientras se captura
  costo_manual_centavos: string; // vacío = usar el calculado de la despensa
};

type IngredienteEditor = {
  id?: string;
  nombre: string;
  unidad: "g" | "ml" | "pieza";
  tamano_paquete: string;
  costo_paquete_centavos: string;
  calorias_kcal: string; azucares_g: string; grasas_saturadas_g: string;
  grasas_trans_g: string; sodio_mg: string; proteinas_g: string;
  carbohidratos_g: string; grasas_totales_g: string; fibra_g: string;
  notas: string;
};

const INGREDIENTE_VACIO: IngredienteEditor = {
  nombre: "", unidad: "g", tamano_paquete: "", costo_paquete_centavos: "",
  calorias_kcal: "", azucares_g: "", grasas_saturadas_g: "", grasas_trans_g: "",
  sodio_mg: "", proteinas_g: "", carbohidratos_g: "", grasas_totales_g: "",
  fibra_g: "", notas: "",
};

function numTexto(v: number | undefined): string {
  return v === undefined || v === 0 ? "" : String(v);
}
function aNum(t: string): number {
  const n = parseFloat(t.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export default function ModalRecetas({ onCerrar }: { onCerrar: () => void }) {
  const { tema: T } = useTema();
  const estiloInput = useEstiloInput();

  const [vista, setVista] = useState<Vista>("lista");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const [recetas, setRecetas] = useState<RecetaResumen[]>([]);
  const [despensaCache, setDespensaCache] = useState<Ingrediente[]>([]);

  // --- Confirmaciones de borrado, sin Alert nativo ---
  const [porBorrarReceta, setPorBorrarReceta] = useState<RecetaResumen | null>(null);
  const [porBorrarIngrediente, setPorBorrarIngrediente] = useState<Ingrediente | null>(null);

  // --- Editor de receta ---
  const [recetaId, setRecetaId] = useState<string | null>(null); // null = nueva
  const [recetaProductoId, setRecetaProductoId] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [rendCantidad, setRendCantidad] = useState("1");
  const [rendUnidad, setRendUnidad] = useState("porción");
  const [margen, setMargen] = useState(50);
  const [ivaActivo, setIvaActivo] = useState(false);
  const [notasReceta, setNotasReceta] = useState("");
  const [lineas, setLineas] = useState<LineaEditor[]>([]);
  const [buscaIngrediente, setBuscaIngrediente] = useState("");
  const [mandandoCatalogo, setMandandoCatalogo] = useState(false);
  const [precioManual, setPrecioManual] = useState("");

  // --- Editor de ingrediente de despensa ---
  const [ing, setIng] = useState<IngredienteEditor>({ ...INGREDIENTE_VACIO });
  const [avanzadoNutricion, setAvanzadoNutricion] = useState(false);
  const [candidatosNutricion, setCandidatosNutricion] = useState<CandidatoNutricion[]>([]);
  const [buscandoNutricion, setBuscandoNutricion] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sin esto: si se cierra el modal completo mientras la búsqueda de
  // nutrición está en espera (dentro de los 400ms del debounce), el
  // temporizador dispara igual y llama setState sobre un componente que ya
  // no existe. Encontrado en la auditoría de listeners/temporizadores —
  // los demás (EscanerCamara, vender.tsx, inventario.tsx) ya lo hacían bien.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [r, d] = await Promise.all([listarResumen(), listarIngredientes()]);
      setRecetas(r);
      setDespensaCache(d);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Atrás del sistema: retrocede un nivel en vez de cerrar todo el modal.
  useEffect(() => {
    const alPresionarAtras = () => {
      if (vista === "despensaForm") {
        setVista("despensa");
        return true;
      }
      if (vista === "despensa" || vista === "detalle") {
        setVista("lista");
        void cargar();
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", alPresionarAtras);
    return () => sub.remove();
  }, [vista, cargar]);

  // ---------------------------------------------------------------------------
  // Despensa
  // ---------------------------------------------------------------------------

  function abrirNuevoIngrediente() {
    setIng({ ...INGREDIENTE_VACIO });
    setCandidatosNutricion([]);
    setAvanzadoNutricion(false);
    setError("");
    setVista("despensaForm");
  }

  function abrirEditarIngrediente(i: Ingrediente) {
    setIng({
      id: i.id, nombre: i.nombre, unidad: i.unidad,
      tamano_paquete: String(i.tamano_paquete),
      costo_paquete_centavos: (i.costo_paquete_centavos / 100).toFixed(2),
      calorias_kcal: numTexto(i.calorias_kcal), azucares_g: numTexto(i.azucares_g),
      grasas_saturadas_g: numTexto(i.grasas_saturadas_g), grasas_trans_g: numTexto(i.grasas_trans_g),
      sodio_mg: numTexto(i.sodio_mg), proteinas_g: numTexto(i.proteinas_g),
      carbohidratos_g: numTexto(i.carbohidratos_g), grasas_totales_g: numTexto(i.grasas_totales_g),
      fibra_g: numTexto(i.fibra_g), notas: i.notas ?? "",
    });
    setCandidatosNutricion([]);
    setAvanzadoNutricion(false);
    setError("");
    setVista("despensaForm");
  }

  // Búsqueda de nutrición con debounce de 400ms — igual de espíritu que el
  // resto de buscadores de la app (Inventario usa 300ms para el catálogo
  // propio; aquí es más largo porque cada tecleo dispara una llamada a un
  // servicio externo, no una consulta local).
  function alCambiarNombreIngrediente(v: string) {
    setIng((s) => ({ ...s, nombre: v }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (v.trim().length < 3) {
      setCandidatosNutricion([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setBuscandoNutricion(true);
      try {
        setCandidatosNutricion(await buscarNutricionPorNombre(v));
      } finally {
        setBuscandoNutricion(false);
      }
    }, 400);
  }

  function usarCandidato(c: CandidatoNutricion) {
    setIng((s) => ({
      ...s,
      calorias_kcal: numTexto(c.calorias_kcal), azucares_g: numTexto(c.azucares_g),
      grasas_saturadas_g: numTexto(c.grasas_saturadas_g), grasas_trans_g: numTexto(c.grasas_trans_g),
      sodio_mg: numTexto(c.sodio_mg), proteinas_g: numTexto(c.proteinas_g),
      carbohidratos_g: numTexto(c.carbohidratos_g), grasas_totales_g: numTexto(c.grasas_totales_g),
      fibra_g: numTexto(c.fibra_g),
    }));
    setCandidatosNutricion([]);
    setAvanzadoNutricion(true);
  }

  async function guardarIngredienteForm() {
    setError("");
    const datos: NuevoIngrediente = {
      nombre: ing.nombre,
      unidad: ing.unidad,
      tamano_paquete: aNum(ing.tamano_paquete),
      costo_paquete_centavos: Math.round(aNum(ing.costo_paquete_centavos) * 100),
      calorias_kcal: aNum(ing.calorias_kcal), azucares_g: aNum(ing.azucares_g),
      grasas_saturadas_g: aNum(ing.grasas_saturadas_g), grasas_trans_g: aNum(ing.grasas_trans_g),
      sodio_mg: aNum(ing.sodio_mg), proteinas_g: aNum(ing.proteinas_g),
      carbohidratos_g: aNum(ing.carbohidratos_g), grasas_totales_g: aNum(ing.grasas_totales_g),
      fibra_g: aNum(ing.fibra_g), notas: ing.notas,
    };
    setGuardando(true);
    try {
      if (ing.id) await editarIngrediente({ ...datos, id: ing.id });
      else await crearIngrediente(datos);
      setDespensaCache(await listarIngredientes());
      setVista("despensa");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setGuardando(false);
    }
  }

  async function confirmarBorrarIngrediente() {
    if (!porBorrarIngrediente) return;
    try {
      await eliminarIngrediente(porBorrarIngrediente.id);
      setDespensaCache(await listarIngredientes());
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setPorBorrarIngrediente(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Editor de receta
  // ---------------------------------------------------------------------------

  function abrirNuevaReceta() {
    setRecetaId(null);
    setRecetaProductoId(null);
    setNombre("");
    setRendCantidad("1");
    setRendUnidad("porción");
    setMargen(50);
    setIvaActivo(false);
    setNotasReceta("");
    setLineas([]);
    setBuscaIngrediente("");
    setPrecioManual("");
    setError("");
    setVista("detalle");
  }

  async function abrirReceta(resumen: RecetaResumen) {
    setError("");
    const r = await obtenerReceta(resumen.id);
    if (!r) {
      setError("No se encontró la receta.");
      return;
    }
    setRecetaId(r.id);
    setRecetaProductoId(r.producto_id);
    setNombre(r.nombre);
    setRendCantidad(String(r.rendimiento_cantidad));
    setRendUnidad(r.rendimiento_unidad);
    setMargen(r.margen_deseado_pct);
    setIvaActivo(false);
    setNotasReceta(r.notas ?? "");
    setLineas(
      r.lineas.map((l) => ({
        ingrediente_id: l.ingrediente_id,
        nombre: l.nombre_congelado,
        unidad: l.unidad,
        cantidad_usada: String(l.cantidad_usada),
        costo_manual_centavos: "",
      }))
    );
    setBuscaIngrediente("");
    setPrecioManual("");
    setVista("detalle");
  }

  function agregarLinea(i: Ingrediente) {
    if (lineas.some((l) => l.ingrediente_id === i.id)) return;
    setLineas((ls) => [
      ...ls,
      { ingrediente_id: i.id, nombre: i.nombre, unidad: i.unidad, cantidad_usada: "1", costo_manual_centavos: "" },
    ]);
    setBuscaIngrediente("");
  }
  function quitarLinea(id: string) {
    setLineas((ls) => ls.filter((l) => l.ingrediente_id !== id));
  }
  function cambiarCantidadLinea(id: string, v: string) {
    setLineas((ls) => ls.map((l) => (l.ingrediente_id === id ? { ...l, cantidad_usada: v } : l)));
  }

  // Costo en vivo mientras se arma la receta — mismo cálculo que el
  // servidor hará al guardar, para que el usuario vea el número real antes
  // de tocar "Guardar", no una sorpresa después.
  const costoTotalLineas = lineas.reduce((s, l) => {
    const ingr = despensaCache.find((d) => d.id === l.ingrediente_id);
    if (!ingr) return s;
    const cantidad = aNum(l.cantidad_usada);
    const manual = l.costo_manual_centavos.trim() ? Math.round(aNum(l.costo_manual_centavos) * 100) : null;
    return s + (manual ?? Math.round(ingr.costo_por_unidad_centavos * cantidad));
  }, 0);
  const rendimientoNum = Math.max(0.001, aNum(rendCantidad));
  const costoPorRendimiento = Math.round(costoTotalLineas / rendimientoNum);
  const precioSugerido =
    margen >= 100 || margen < 0 ? costoPorRendimiento : Math.round(costoPorRendimiento / (1 - margen / 100));
  const precioConIva = ivaActivo ? Math.round(precioSugerido * (1 + IVA_TASA)) : precioSugerido;

  const candidatosDespensa = despensaCache.filter(
    (d) =>
      !lineas.some((l) => l.ingrediente_id === d.id) &&
      (buscaIngrediente.trim() === "" || d.nombre.toLowerCase().includes(buscaIngrediente.trim().toLowerCase()))
  );

  async function guardarRecetaForm() {
    setError("");
    if (lineas.length === 0) {
      setError("Agrega al menos un ingrediente.");
      return;
    }
    setGuardando(true);
    try {
      const entradas: LineaRecetaEntrada[] = lineas.map((l) => ({
        ingrediente_id: l.ingrediente_id,
        cantidad_usada: aNum(l.cantidad_usada),
        costo_manual_centavos: l.costo_manual_centavos.trim()
          ? Math.round(aNum(l.costo_manual_centavos) * 100)
          : null,
      }));
      const id = await guardarReceta({
        id: recetaId ?? undefined,
        nombre,
        rendimiento_cantidad: rendimientoNum,
        rendimiento_unidad: rendUnidad,
        margen_deseado_pct: margen,
        notas: notasReceta,
        lineas: entradas,
      });
      setRecetaId(id);
      await cargar();
      setVista("lista");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setGuardando(false);
    }
  }

  async function confirmarBorrarReceta() {
    if (!porBorrarReceta) return;
    try {
      await eliminarReceta(porBorrarReceta.id);
      await cargar();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setPorBorrarReceta(null);
    }
  }

  async function mandarAlCatalogo() {
    if (!recetaId) return;
    setMandandoCatalogo(true);
    setError("");
    try {
      const precioFinal = precioManual.trim() ? Math.round(aNum(precioManual) * 100) : precioConIva;
      await crearProductoDesdeReceta(recetaId, precioFinal, null);
      const fresca = await obtenerReceta(recetaId);
      setRecetaProductoId(fresca?.producto_id ?? null);
      await cargar();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setMandandoCatalogo(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Vistas
  // ---------------------------------------------------------------------------

  function VistaLista() {
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }}>
        <Banner texto={error} tipo="error" />
        <Txt escala="pie" tono="suave" estilo={{ marginBottom: T.esps.lg }}>
          Cuánto te cuesta de verdad cada producto que fabricas.
        </Txt>

        <View style={{ flexDirection: "row", gap: T.esps.sm, marginBottom: T.esps.lg }}>
          <View style={{ flex: 1 }}>
            <Boton
              titulo="Despensa"
              tipo="secundario"
              onPress={() => setVista("despensa")}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Boton titulo="+ Nueva receta" onPress={abrirNuevaReceta} />
          </View>
        </View>

        {cargando ? (
          <ActivityIndicator color={T.acento} style={{ marginTop: T.esps.xl }} />
        ) : recetas.length === 0 ? (
          <Vacio
            titulo="Aún no tienes recetas"
            texto="Primero agrega ingredientes a tu Despensa (lo que compras), luego arma una receta con ellos y sabrás cuánto cuesta de verdad cada producto."
          />
        ) : (
          <Grupo>
            {recetas.map((r) => (
              <Fila
                key={r.id}
                titulo={r.nombre}
                meta={`${r.num_ingredientes} ingrediente${r.num_ingredientes === 1 ? "" : "s"} · por ${r.rendimiento_cantidad} ${r.rendimiento_unidad}${r.producto_id ? " · En catálogo" : ""}`}
                onPress={() => abrirReceta(r)}
                valor={<Monto texto={pesos(r.costo_por_rendimiento_centavos)} escala="pie" />}
              />
            ))}
          </Grupo>
        )}
        <View style={{ height: T.esps.xl }} />
      </ScrollView>
    );
  }

  function VistaDespensa() {
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }}>
        <Banner texto={error} tipo="error" />
        <Txt escala="pie" tono="suave" estilo={{ marginBottom: T.esps.lg }}>
          Ingredientes que compras para fabricar tus productos. No aparecen en Inventario.
        </Txt>
        <View style={{ marginBottom: T.esps.lg }}>
          <Boton titulo="+ Nuevo ingrediente" onPress={abrirNuevoIngrediente} />
        </View>

        {despensaCache.length === 0 ? (
          <Vacio titulo="Despensa vacía" texto="Agrega tu primer ingrediente — solo necesitas cuánto pagaste y de qué tamaño era el paquete." />
        ) : (
          <Grupo>
            {despensaCache.map((i) => (
              <Fila
                key={i.id}
                titulo={i.nombre}
                meta={`${pesos(i.costo_paquete_centavos)} por ${i.tamano_paquete} ${i.unidad}`}
                onPress={() => abrirEditarIngrediente(i)}
                valor={
                  <View style={{ flexDirection: "row", alignItems: "center", gap: T.esps.md }}>
                    <Monto texto={`${pesos(Math.round(i.costo_por_unidad_centavos * 100))} / 100 ${i.unidad === "pieza" ? "pza" : i.unidad}`} escala="micro" tono="suave" />
                    <Pressable onPress={() => setPorBorrarIngrediente(i)} hitSlop={10}>
                      <Txt escala="cuerpo" tono="peligro" fuerte>×</Txt>
                    </Pressable>
                  </View>
                }
              />
            ))}
          </Grupo>
        )}
        <View style={{ height: T.esps.xl }} />
      </ScrollView>
    );
  }

  function VistaDespensaForm() {
    const campo = (
      etiqueta: string,
      valor: string,
      onCambio: (v: string) => void
    ) => (
      <View style={{ width: "48%" }}>
        <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.xs }}>
          {etiqueta}
        </Txt>
        <TextInput
          style={estiloInput}
          value={valor}
          onChangeText={onCambio}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={T.textoTenue}
        />
      </View>
    );
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }} keyboardShouldPersistTaps="handled">
        <Banner texto={error} tipo="error" />

        <Campo label="Nombre">
          <TextInput
            style={estiloInput}
            value={ing.nombre}
            onChangeText={alCambiarNombreIngrediente}
            placeholder="Ej. Queso crema"
            placeholderTextColor={T.textoTenue}
          />
        </Campo>

        {(buscandoNutricion || candidatosNutricion.length > 0) && (
          <View
            style={{
              backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
              borderRadius: T.radio, marginTop: -T.esps.sm, marginBottom: T.esps.lg,
              maxHeight: 220, overflow: "hidden",
            }}
          >
            {buscandoNutricion ? (
              <Txt escala="pie" tono="tenue" estilo={{ padding: T.esps.md, textAlign: "center" }}>
                Buscando…
              </Txt>
            ) : (
              <ScrollView>
                {candidatosNutricion.map((c, i) => (
                  <Pressable
                    key={i}
                    onPress={() => usarCandidato(c)}
                    style={{
                      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                      paddingHorizontal: T.esps.md, paddingVertical: T.esps.sm,
                      borderBottomWidth: i === candidatosNutricion.length - 1 ? 0 : 1, borderBottomColor: T.borde,
                    }}
                  >
                    <Txt escala="pie" estilo={{ flex: 1 }} lineas={1}>{c.nombre}</Txt>
                    {c.marca ? <Txt escala="micro" tono="tenue">{c.marca}</Txt> : null}
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        )}

        <View style={{ flexDirection: "row", gap: T.esps.sm }}>
          <View style={{ flex: 1 }}>
            <Campo label="Costo del paquete">
              <TextInput
                style={estiloInput}
                value={ing.costo_paquete_centavos}
                onChangeText={(v) => setIng((s) => ({ ...s, costo_paquete_centavos: v }))}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={T.textoTenue}
              />
            </Campo>
          </View>
          <View style={{ flex: 1 }}>
            <Campo label="Tamaño del paquete">
              <TextInput
                style={estiloInput}
                value={ing.tamano_paquete}
                onChangeText={(v) => setIng((s) => ({ ...s, tamano_paquete: v }))}
                keyboardType="decimal-pad"
                placeholder="1000"
                placeholderTextColor={T.textoTenue}
              />
            </Campo>
          </View>
        </View>

        <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.sm }}>
          Unidad
        </Txt>
        <View style={{ flexDirection: "row", gap: T.esps.sm, marginBottom: T.esps.md }}>
          {UNIDADES.map((u) => {
            const activo = ing.unidad === u.id;
            return (
              <Pressable
                key={u.id}
                onPress={() => setIng((s) => ({ ...s, unidad: u.id }))}
                style={{
                  flex: 1, height: 44, borderRadius: T.radioChico, alignItems: "center", justifyContent: "center",
                  backgroundColor: activo ? T.acentoRelleno : T.superficie2,
                  borderWidth: 1, borderColor: activo ? T.acentoRelleno : T.borde,
                }}
              >
                <Txt escala="pie" fuerte={activo} tono={activo ? "principal" : "suave"} estilo={activo ? { color: T.acentoTexto } : undefined}>
                  {u.nombre}
                </Txt>
              </Pressable>
            );
          })}
        </View>
        <Txt escala="micro" tono="tenue" estilo={{ marginTop: -T.esps.sm, marginBottom: T.esps.lg }}>
          Ejemplo: pagaste $45 por una bolsa de 1000 g → escribe 1000 en tamaño (siempre en gramos, mililitros o piezas, nunca en kg/L).
        </Txt>

        <Pressable onPress={() => setAvanzadoNutricion((v) => !v)} style={{ paddingVertical: T.esps.sm, marginBottom: T.esps.sm }}>
          <Txt escala="pie" tono="acento" fuerte>
            {avanzadoNutricion ? "− Ocultar nutrición" : "+ Nutrición (opcional) — por 100 g/ml, o por 1 pieza"}
          </Txt>
        </Pressable>
        {avanzadoNutricion && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: T.esps.md, marginBottom: T.esps.lg }}>
            {campo("Calorías (kcal)", ing.calorias_kcal, (v) => setIng((s) => ({ ...s, calorias_kcal: v })))}
            {campo("Azúcares (g)", ing.azucares_g, (v) => setIng((s) => ({ ...s, azucares_g: v })))}
            {campo("Grasas saturadas (g)", ing.grasas_saturadas_g, (v) => setIng((s) => ({ ...s, grasas_saturadas_g: v })))}
            {campo("Grasas trans (g)", ing.grasas_trans_g, (v) => setIng((s) => ({ ...s, grasas_trans_g: v })))}
            {campo("Sodio (mg)", ing.sodio_mg, (v) => setIng((s) => ({ ...s, sodio_mg: v })))}
            {campo("Proteínas (g)", ing.proteinas_g, (v) => setIng((s) => ({ ...s, proteinas_g: v })))}
            {campo("Carbohidratos (g)", ing.carbohidratos_g, (v) => setIng((s) => ({ ...s, carbohidratos_g: v })))}
            {campo("Grasas totales (g)", ing.grasas_totales_g, (v) => setIng((s) => ({ ...s, grasas_totales_g: v })))}
            {campo("Fibra (g)", ing.fibra_g, (v) => setIng((s) => ({ ...s, fibra_g: v })))}
          </View>
        )}

        <Campo label="Notas (opcional)">
          <TextInput
            style={[estiloInput, { minHeight: 60, textAlignVertical: "top" }]}
            value={ing.notas}
            onChangeText={(v) => setIng((s) => ({ ...s, notas: v }))}
            placeholder="Comprado en Costco, presentación de 5 kg…"
            placeholderTextColor={T.textoTenue}
            multiline
          />
        </Campo>

        <Boton titulo={ing.id ? "Guardar cambios" : "Agregar"} onPress={guardarIngredienteForm} cargando={guardando} />
        {ing.id && (
          <View style={{ marginTop: T.esps.md }}>
            <Boton
              titulo="Eliminar ingrediente"
              tipo="peligro"
              onPress={() => {
                const i = despensaCache.find((d) => d.id === ing.id);
                if (i) setPorBorrarIngrediente(i);
              }}
            />
          </View>
        )}
        <View style={{ height: T.esps.xxl }} />
      </ScrollView>
    );
  }

  function VistaDetalleReceta() {
    return (
      <ScrollView contentContainerStyle={{ padding: T.esp }} keyboardShouldPersistTaps="handled">
        <Banner texto={error} tipo="error" />

        <Campo label="Nombre de la receta">
          <TextInput
            style={estiloInput}
            value={nombre}
            onChangeText={setNombre}
            placeholder="Ej. Tarta Vasca"
            placeholderTextColor={T.textoTenue}
          />
        </Campo>

        {/* Costo y precio — la lámina protagonista de esta pantalla. */}
        <View style={{ marginVertical: T.esps.lg }}>
          <Lamina>
            <Txt escala="micro" tono="suave" fuerte mayus>
              Costo por {rendUnidad || "unidad"}
            </Txt>
            <View style={{ marginTop: T.esps.xs }}>
              <Monto texto={pesos(costoPorRendimiento)} escala="protagonista" />
            </View>
            <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.xs }}>
              costo total de la receta: {pesos(costoTotalLineas)}
            </Txt>
          </Lamina>
        </View>

        <View style={{ flexDirection: "row", gap: T.esps.sm, marginBottom: T.esps.lg }}>
          <View style={{ flex: 1 }}>
            <Campo label="Rinde">
              <TextInput
                style={estiloInput}
                value={rendCantidad}
                onChangeText={setRendCantidad}
                keyboardType="decimal-pad"
                placeholderTextColor={T.textoTenue}
              />
            </Campo>
          </View>
          <View style={{ flex: 1 }}>
            <Campo label="Unidad">
              <TextInput
                style={estiloInput}
                value={rendUnidad}
                onChangeText={setRendUnidad}
                placeholder="porción, rebanada…"
                placeholderTextColor={T.textoTenue}
              />
            </Campo>
          </View>
        </View>

        {/* Margen deseado — stepper -/+ de 5 en 5, 0 a 90%. */}
        <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.sm }}>
          Margen deseado
        </Txt>
        <View style={{ flexDirection: "row", alignItems: "center", gap: T.esps.lg, marginBottom: T.esps.lg }}>
          <Pressable
            onPress={() => setMargen((m) => Math.max(0, m - 5))}
            disabled={margen <= 0}
            style={{
              width: 44, height: 44, borderRadius: T.radioChico, alignItems: "center", justifyContent: "center",
              backgroundColor: T.superficie2, borderWidth: 1, borderColor: T.borde, opacity: margen <= 0 ? 0.4 : 1,
            }}
          >
            <Txt escala="titulo" tono="suave">−</Txt>
          </Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Monto texto={`${margen}%`} escala="titulo" tono="acento" />
          </View>
          <Pressable
            onPress={() => setMargen((m) => Math.min(90, m + 5))}
            disabled={margen >= 90}
            style={{
              width: 44, height: 44, borderRadius: T.radioChico, alignItems: "center", justifyContent: "center",
              backgroundColor: T.superficie2, borderWidth: 1, borderColor: T.borde, opacity: margen >= 90 ? 0.4 : 1,
            }}
          >
            <Txt escala="titulo" tono="suave">+</Txt>
          </Pressable>
        </View>

        {/* Precio sugerido + IVA opcional — lo que el PC no tiene todavía. */}
        <View
          style={{
            backgroundColor: T.superficie, borderRadius: T.radio, borderWidth: 1, borderColor: T.borde,
            padding: T.esps.lg, marginBottom: T.esps.lg,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Txt escala="pie" tono="suave" fuerte>Precio de venta sugerido</Txt>
            <Monto texto={pesos(precioConIva)} escala="cuerpo" />
          </View>
          <Pressable
            onPress={() => setIvaActivo((v) => !v)}
            style={{ flexDirection: "row", alignItems: "center", gap: T.esps.sm, marginTop: T.esps.md }}
          >
            <View
              style={{
                width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center",
                borderColor: ivaActivo ? T.acentoRelleno : T.borde,
                backgroundColor: ivaActivo ? T.acentoRelleno : "transparent",
              }}
            >
              {ivaActivo && <Txt escala="micro" fuerte estilo={{ color: T.acentoTexto }}>✓</Txt>}
            </View>
            <Txt escala="pie">Agregar 16% de IVA al precio</Txt>
          </Pressable>
        </View>

        {/* Ingredientes */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: T.esps.sm }}>
          <Txt escala="micro" tono="suave" fuerte mayus>Ingredientes</Txt>
        </View>
        {lineas.length === 0 ? (
          <Txt escala="pie" tono="tenue" estilo={{ marginBottom: T.esps.md }}>
            Agrega ingredientes de tu despensa para calcular el costo.
          </Txt>
        ) : (
          lineas.map((l) => (
            <View
              key={l.ingrediente_id}
              style={{
                flexDirection: "row", alignItems: "center", gap: T.esps.sm,
                paddingVertical: T.esps.sm, borderBottomWidth: 1, borderBottomColor: T.borde,
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt escala="pie" fuerte lineas={1}>{l.nombre}</Txt>
                <Txt escala="micro" tono="tenue">{l.unidad}</Txt>
              </View>
              <TextInput
                style={[estiloInput, { width: 70, textAlign: "center", paddingHorizontal: 4 }]}
                value={l.cantidad_usada}
                onChangeText={(v) => cambiarCantidadLinea(l.ingrediente_id, v)}
                keyboardType="decimal-pad"
              />
              <Pressable onPress={() => quitarLinea(l.ingrediente_id)} hitSlop={10}>
                <Txt escala="cuerpo" tono="peligro" fuerte>×</Txt>
              </Pressable>
            </View>
          ))
        )}

        <TextInput
          style={[estiloInput, { marginTop: T.esps.sm }]}
          value={buscaIngrediente}
          onChangeText={setBuscaIngrediente}
          placeholder="Buscar en tu despensa para agregar…"
          placeholderTextColor={T.textoTenue}
        />
        {buscaIngrediente.trim() !== "" &&
          candidatosDespensa.slice(0, 6).map((d) => (
            <Pressable key={d.id} onPress={() => agregarLinea(d)} style={{ paddingVertical: T.esps.sm }}>
              <Txt escala="pie" fuerte>{d.nombre}</Txt>
              <Txt escala="micro" tono="tenue">
                {pesos(Math.round(d.costo_por_unidad_centavos * 100))} / 100 {d.unidad === "pieza" ? "pza" : d.unidad}
              </Txt>
            </Pressable>
          ))}
        {despensaCache.length === 0 && (
          <Txt escala="micro" tono="tenue" estilo={{ marginTop: T.esps.sm }}>
            Tu despensa está vacía — agrega ingredientes primero desde "Despensa" en la lista de recetas.
          </Txt>
        )}

        <View style={{ marginTop: T.esps.lg }}>
          <Campo label="Notas (opcional)">
            <TextInput
              style={[estiloInput, { minHeight: 60, textAlignVertical: "top" }]}
              value={notasReceta}
              onChangeText={setNotasReceta}
              placeholder="Preparación, variaciones, lo que sea útil recordar…"
              placeholderTextColor={T.textoTenue}
              multiline
            />
          </Campo>
        </View>

        <Boton titulo="Guardar receta" onPress={guardarRecetaForm} cargando={guardando} />

        {/* Mandar al catálogo: solo si ya está guardada y no tiene producto vinculado. */}
        {recetaId && !recetaProductoId && (
          <View style={{ marginTop: T.esps.lg, padding: T.esps.lg, backgroundColor: T.acentoSuave, borderRadius: T.radio, borderWidth: 1, borderColor: T.acentoBorde }}>
            <Txt escala="pie" fuerte estilo={{ marginBottom: T.esps.sm }}>Mandar al catálogo</Txt>
            <Txt escala="micro" tono="suave" estilo={{ marginBottom: T.esps.md }}>
              Crea un producto de venta con este costo, y —si hay suficiente peso pesable en la receta— un perfil de etiqueta NOM-051 automático.
            </Txt>
            <Campo label={`Precio de venta (sugerido: ${pesos(precioConIva)})`}>
              <TextInput
                style={estiloInput}
                value={precioManual}
                onChangeText={setPrecioManual}
                placeholder={pesos(precioConIva)}
                placeholderTextColor={T.textoTenue}
                keyboardType="decimal-pad"
              />
            </Campo>
            <Boton titulo="Crear producto de venta" onPress={mandarAlCatalogo} cargando={mandandoCatalogo} />
          </View>
        )}
        {recetaProductoId && (
          <View style={{ marginTop: T.esps.lg, flexDirection: "row", alignItems: "center", gap: T.esps.sm }}>
            <Txt escala="pie" tono="exito" fuerte>✓ Ya está en tu catálogo</Txt>
          </View>
        )}
        {recetaId && (
          <View style={{ marginTop: T.esps.lg }}>
            <Boton
              titulo="Eliminar receta"
              tipo="peligro"
              onPress={() => {
                const r = recetas.find((x) => x.id === recetaId);
                if (r) setPorBorrarReceta(r);
                else setPorBorrarReceta({ id: recetaId, nombre, rendimiento_cantidad: rendimientoNum, rendimiento_unidad: rendUnidad, costo_por_rendimiento_centavos: costoPorRendimiento, num_ingredientes: lineas.length, producto_id: recetaProductoId, actualizado_en: "" });
              }}
            />
          </View>
        )}
        <View style={{ height: T.esps.xxl }} />
      </ScrollView>
    );
  }

  const cab = (() => {
    switch (vista) {
      case "despensa": return { t: "Despensa", i: "Atrás", f: () => { setVista("lista"); void cargar(); } };
      case "despensaForm": return { t: ing.id ? "Editar ingrediente" : "Nuevo ingrediente", i: "Atrás", f: () => setVista("despensa") };
      case "detalle": return { t: recetaId ? nombre || "Receta" : "Nueva receta", i: "Atrás", f: () => { setVista("lista"); void cargar(); } };
      default: return { t: "Recetas", i: "Listo", f: onCerrar };
    }
  })();

  return (
    <Hoja visible onCerrar={onCerrar} titulo={cab.t} tipo="completa">
      {/* CabeceraModal propia no aplica aquí (Hoja ya trae la suya con
          "Cerrar" fijo); el título dinámico se resuelve arriba y el botón
          de retroceso vive dentro de cada vista como parte del flujo. */}
      {vista === "lista" && <VistaLista />}
      {vista === "despensa" && <VistaDespensa />}
      {vista === "despensaForm" && <VistaDespensaForm />}
      {vista === "detalle" && <VistaDetalleReceta />}

      {/* Confirmaciones de borrado: hoja chica, sin Alert nativo. */}
      <Hoja
        visible={porBorrarReceta !== null}
        onCerrar={() => setPorBorrarReceta(null)}
        titulo="Eliminar receta"
        pie={
          <View style={{ gap: T.esps.sm }}>
            <Boton titulo="Eliminar" tipo="peligro" onPress={confirmarBorrarReceta} />
            <Boton titulo="Cancelar" tipo="secundario" onPress={() => setPorBorrarReceta(null)} />
          </View>
        }
      >
        <Txt escala="pie" tono="suave">
          {porBorrarReceta ? `¿Eliminar "${porBorrarReceta.nombre}"? No se puede deshacer.` : ""}
        </Txt>
      </Hoja>

      <Hoja
        visible={porBorrarIngrediente !== null}
        onCerrar={() => setPorBorrarIngrediente(null)}
        titulo="Eliminar ingrediente"
        pie={
          <View style={{ gap: T.esps.sm }}>
            <Boton titulo="Eliminar" tipo="peligro" onPress={confirmarBorrarIngrediente} />
            <Boton titulo="Cancelar" tipo="secundario" onPress={() => setPorBorrarIngrediente(null)} />
          </View>
        }
      >
        <Txt escala="pie" tono="suave">
          {porBorrarIngrediente
            ? `¿Eliminar "${porBorrarIngrediente.nombre}"? Las recetas que ya lo usaron conservan su costo congelado y no se rompen.`
            : ""}
        </Txt>
      </Hoja>
    </Hoja>
  );
}
