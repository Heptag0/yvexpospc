// YvexPOS Móvil — Escanear ticket de compra con IA.
//
// Flujo: elegir foto → previsualizar → analizando → revisión → aplicando → listo.
// La IA propone y el tendero dispone: NADA se aplica sin revisión humana.
//   - Emparejes "sugeridos" (ámbar) exigen confirmación.
//   - Costos en "alerta" (rojo) exigen decisión línea por línea.
//   - Costos "irreales" se CONSERVAN por defecto (regla inquebrantable).
//   - El catálogo (máx. 300) viaja en la petición: si la IA responde
//     catalogo_idx válido, el empareje es SEGURO con chip distinto.
//   - Ancla histórica: si el costo leído queda fuera del rango de TUS costos
//     confirmados (historial_costos), arranca en MANTENER con nota neutra
//     ámbar, sin alerta roja — el historial manda sobre la config.
// Toda la lógica pesada (empareje, umbrales, precio sugerido, empaques,
// ancla histórica) vive en src/base/escaner.ts y la persistencia de la
// config en escanerConfig.ts; este archivo es solo la pantalla.

import { ReactNode, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
// El KeyboardAvoidingView viene de `react-native-keyboard-controller`, no de
// React Native: ver el porqué en ui.tsx. Misma API, mismo "padding", pero
// construido para `edgeToEdgeEnabled`, donde la ventana ya no se redimensiona
// sola al abrirse el teclado.
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import {
  AvisoCosto,
  ConfigEscaner,
  DEFAULT_CONFIG_ESCANER,
  DecisionCostoHistorial,
  EstadoEmpareje,
  LineaTicket,
  ModoRedondeo,
  RangoEsperadoCosto,
  RespuestaTicket,
  decisionCostoHistorial,
  emparejarLineas,
  extraerPiezasEmpaque,
  conflictoPresentacion,
  importeLineaCentavos,
  markupPct,
  modoRedondeoDesdeConfig,
  nivelAvisoCosto,
  nombreBonito,
  normalizarClave,
  precioDesdeMarkup,
  precioSugerido,
  rangoEsperadoCosto,
  recalcularPorEmpaque,
  redondearPrecio,
  sumaCuadra,
} from "@/src/base/escaner";
import { obtenerConfigEscaner } from "@/src/base/escanerConfig";
import { registrarCompraDesdeTicket } from "@/src/base/proveedores";
import {
  Categoria,
  LineaResurtido,
  Producto,
  ResultadoResurtido,
  aplicarResurtido,
  cargarHistorialesCostos,
  cargarMapaAlias,
  cargarMapaPerfiles,
  catalogoParaIA,
  listarCategorias,
  listarProductos,
} from "@/src/base/inventario";
import { analizarTicket, estadoCuenta } from "@/src/base/nube";
import {
  leerConsentimientoEscaner,
  guardarConsentimientoEscaner,
} from "@/src/base/config";
import { aCentavos, aNumero, centavosATexto, pesos } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import {
  Banner,
  Boton,
  CabeceraModal,
  Insignia,
  useEstiloInput,
} from "@/src/componentes/ui";
import { IconoUI } from "@/src/componentes/iconos";
import ModalAjustesEscaner from "@/src/componentes/ModalAjustesEscaner";

type Tema = ReturnType<typeof useTema>["tema"];

type Props = {
  onCerrar: () => void;
  onAplicado: () => void;
};

type Paso =
  // Puerta previa: mientras el consentimiento no este dado, el escaner NO se
  // puede usar. Ver el comentario de vistaConsentimiento.
  | "consentimiento"
  | "elegir"
  | "previsualizar"
  | "analizando"
  | "revision"
  | "aplicando"
  | "listo";

const TITULOS: Record<Paso, string> = {
  consentimiento: "Antes de empezar",
  elegir: "Escanear ticket",
  previsualizar: "Revisa la foto",
  analizando: "Analizando…",
  revision: "Revisar ticket",
  aplicando: "Aplicando…",
  listo: "Ticket aplicado",
};

/** Decisión de costo para productos existentes:
 *  "mantener" = conserva costo y precio actuales · "sugerido" = usa el costo
 *  del ticket y el precio calculado · null = el usuario aún no decide. */
type DecisionCosto = "mantener" | "sugerido" | null;

/** Estado editable de una línea de venta del ticket. */
type LineaEstado = {
  linea: LineaTicket;
  incluida: boolean;             // toggle "entra al inventario"
  nombre: string;                // editable solo en productos nuevos
  productoId: string | null;     // null = producto nuevo
  estado: EstadoEmpareje | null; // seguro | sugerido | null (nuevo)
  viaAlias: boolean;             // lo resolvió el diccionario del negocio
  viaIA: boolean;                // la IA lo reconoció del catálogo enviado (catalogo_idx)
  cantidadTxt: string;           // empaques (o piezas si no hay empaque)
  conEmpaque: boolean;
  piezasEmpaqueTxt: string;
  costoTxt: string;              // costo POR EMPAQUE (o por pieza suelta), pesos
  decision: DecisionCosto;
  precioTxt: string;
  pctTxt: string;                // % de ganancia sobre costo (liga con precio)
  aprendido: boolean;            // el usuario confirmó o cambió el empareje
  departamentoId: string | null; // solo se usa si el producto es nuevo
  viaDiccionario: boolean;       // el diccionario universal reconoció la línea
  departamentoSugeridoNombre: string | null; // nombre de la categoría sugerida (perfil o diccionario)
  notaConflicto: string | null;  // presentación del ticket ≠ la del producto (degradado a ámbar)
};

/** Datos derivados de una línea (se recalculan en cada render). */
type DatosLinea = {
  prod: Producto | null;
  nEmp: number;
  cantidad: number;
  piezas: number;
  costoEmpaque: number;
  costoPieza: number;
  aviso: AvisoCosto;
  sugerido: number;
  rangoHistorial: RangoEsperadoCosto | null;
  historialEstado: DecisionCostoHistorial;
};

/** Fecha del ticket ("2026-07-14") → "14 jul 2026". */
function fmtFechaTicket(f: string): string {
  try {
    const d = new Date(f.includes("T") ? f : `${f}T12:00:00`);
    return d.toLocaleDateString("es-MX", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return f;
  }
}

const TIPO_OTRA: Record<string, string> = {
  cambio: "Cambio físico",
  envase: "Envase",
  otro: "Otro",
};

export default function ModalEscanearTicket({ onCerrar, onAplicado }: Props) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const estInput = useEstiloInput();

  // Arranca en la puerta, NO en "elegir". Si arrancara en "elegir" habria un
  // fotograma en el que los botones de camara y galeria son pulsables antes de
  // que el efecto lea la decision guardada — y con un toque rapido se podria
  // mandar una foto sin haber aceptado nunca.
  const [paso, setPaso] = useState<Paso>("consentimiento");
  const [guardandoConsent, setGuardandoConsent] = useState(false);
  const [vinculado, setVinculado] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [fotoUri, setFotoUri] = useState<string | null>(null);
  const [fotoB64, setFotoB64] = useState<string | null>(null);
  const [fotoMime, setFotoMime] = useState("image/jpeg");
  const [respuesta, setRespuesta] = useState<RespuestaTicket | null>(null);
  const [lineas, setLineas] = useState<LineaEstado[]>([]);
  const [otrasLineas, setOtrasLineas] = useState<LineaTicket[]>([]);
  const [historiales, setHistoriales] = useState<Map<string, number[]>>(
    new Map()
  );
  const [cfg, setCfg] = useState<ConfigEscaner>(DEFAULT_CONFIG_ESCANER);
  const [modo, setModo] = useState<ModoRedondeo>("50");
  const [catalogo, setCatalogo] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [selectorIdx, setSelectorIdx] = useState<number | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [ajustesEsc, setAjustesEsc] = useState(false);
  const [resultado, setResultado] = useState<ResultadoResurtido | null>(null);
  const [otrasAbierto, setOtrasAbierto] = useState(false);
  const [deptoSelectorIdx, setDeptoSelectorIdx] = useState<number | null>(null);
  const [avisosTicketAbiertos, setAvisosTicketAbiertos] = useState(false);

  useEffect(() => {
    estadoCuenta().then((c) => setVinculado(c.vinculado));
  }, []);

  // Si ya acepto antes, se salta la puerta y entra directo a "elegir".
  useEffect(() => {
    let vivo = true;
    leerConsentimientoEscaner().then((ok) => {
      if (vivo && ok) setPaso("elegir");
    });
    return () => {
      vivo = false;
    };
  }, []);

  async function aceptarEnvioIA() {
    setGuardandoConsent(true);
    try {
      await guardarConsentimientoEscaner(true);
      setPaso("elegir");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setGuardandoConsent(false);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers de línea (cierran sobre cfg/modo/catalogo; un solo camino de
  // cálculo: TODO pasa por recalcularPorEmpaque + datosLinea)
  // -------------------------------------------------------------------------

  function nEmpDe(le: LineaEstado): number {
    if (!le.conEmpaque) return 1;
    return Math.max(1, Math.round(aNumero(le.piezasEmpaqueTxt)) || 1);
  }

  function costoPiezaDe(le: LineaEstado): number {
    return recalcularPorEmpaque(aCentavos(le.costoTxt), nEmpDe(le), null, modo)
      .costoPieza;
  }

  function datosLinea(le: LineaEstado): DatosLinea {
    const prod = le.productoId
      ? catalogo.find((p) => p.id === le.productoId) ?? null
      : null;
    const nEmp = nEmpDe(le);
    const cantidad = Math.max(0, Math.round(aNumero(le.cantidadTxt)));
    const piezas = cantidad * nEmp;
    const costoEmpaque = aCentavos(le.costoTxt);
    const costoPieza = recalcularPorEmpaque(costoEmpaque, nEmp, null, modo).costoPieza;
    const aviso = nivelAvisoCosto(prod?.costo_centavos ?? null, costoPieza, cfg);
    const sugerido = redondearPrecio(
      precioSugerido(
        costoPieza,
        prod?.costo_centavos ?? null,
        prod?.precio_venta_centavos ?? 0,
        cfg.margenDefaultPct
      ),
      modo,
      costoPieza
    );
    // Ancla histórica (solo productos existentes): rango esperado y si el
    // costo leído cae dentro o fuera de él.
    const historial = prod ? (historiales.get(prod.id) ?? []) : [];
    const rangoHistorial = prod ? rangoEsperadoCosto(historial) : null;
    const historialEstado: DecisionCostoHistorial = prod
      ? decisionCostoHistorial(costoPieza, historial)
      : "sin_historial";
    return {
      prod,
      nEmp,
      cantidad,
      piezas,
      costoEmpaque,
      costoPieza,
      aviso,
      sugerido,
      rangoHistorial,
      historialEstado,
    };
  }

  /** Claves de alias que se aprenden al aplicar: el crudo del ticket y el
   *  nombre final (bonito), normalizadas y sin duplicados. */
  function clavesDeLinea(le: LineaEstado): string[] {
    const cruda = normalizarClave(le.linea.nombre_crudo);
    const bonita = normalizarClave(le.nombre || le.linea.nombre_sugerido);
    return [...new Set([cruda, bonita].filter((c) => c.length > 0))];
  }

  function mutarLinea(i: number, fn: (l: LineaEstado) => LineaEstado) {
    setLineas((prev) => prev.map((l, idx) => (idx === i ? fn(l) : l)));
  }

  function actualizarLinea(i: number, parcial: Partial<LineaEstado>) {
    mutarLinea(i, (l) => ({ ...l, ...parcial }));
  }

  /** Recalcula lo que toca tras mover empaque/costo. En producto EXISTENTE el
   *  precio de venta NO se recalcula ni cambia automáticamente: queda el que
   *  traía (precioTxt intacto) y solo se actualiza el % informativo. En
   *  producto NUEVO el precio sugerido sí sigue al costo. */
  function conCostoRecalculado(nl: LineaEstado): LineaEstado {
    const costoPieza = costoPiezaDe(nl);
    const prod = nl.productoId
      ? catalogo.find((p) => p.id === nl.productoId) ?? null
      : null;
    if (prod) {
      const pct = markupPct(costoPieza, aCentavos(nl.precioTxt));
      return { ...nl, pctTxt: pct == null ? "" : String(pct) };
    }
    const sug = redondearPrecio(
      precioSugerido(costoPieza, null, 0, cfg.margenDefaultPct),
      modo,
      costoPieza
    );
    const pct = markupPct(costoPieza, sug);
    return {
      ...nl,
      precioTxt: centavosATexto(sug),
      pctTxt: pct == null ? "" : String(pct),
    };
  }

  function editarCosto(i: number, txt: string) {
    mutarLinea(i, (l) => conCostoRecalculado({ ...l, costoTxt: txt }));
  }

  function editarPiezasEmpaque(i: number, txt: string) {
    mutarLinea(i, (l) => conCostoRecalculado({ ...l, piezasEmpaqueTxt: txt }));
  }

  /** Pieza suelta ↔ caja/pack. Al activar, intenta detectar el número en el
   *  nombre del ticket; si no hay patrón, queda vacío para que lo escriban. */
  function conmutarEmpaque(i: number, on: boolean) {
    mutarLinea(i, (l) => {
      if (!on) return conCostoRecalculado({ ...l, conEmpaque: false });
      const detectado = extraerPiezasEmpaque(l.linea.nombre_crudo);
      const previo = Math.round(aNumero(l.piezasEmpaqueTxt));
      const n = detectado ?? (previo > 1 ? previo : null);
      return conCostoRecalculado({
        ...l,
        conEmpaque: true,
        piezasEmpaqueTxt: n ? String(n) : "",
      });
    });
  }

  function editarPrecio(i: number, txt: string) {
    mutarLinea(i, (l) => {
      const pct = markupPct(costoPiezaDe(l), aCentavos(txt));
      return { ...l, precioTxt: txt, pctTxt: pct == null ? "" : String(pct) };
    });
  }

  function editarPct(i: number, txt: string) {
    mutarLinea(i, (l) => {
      const costoPieza = costoPiezaDe(l);
      const precio = precioDesdeMarkup(costoPieza, aNumero(txt), modo);
      return { ...l, pctTxt: txt, precioTxt: centavosATexto(precio) };
    });
  }

  function confirmarEmpareje(i: number) {
    // Confirmado por el usuario: la nota de conflicto ya cumplió su aviso.
    actualizarLinea(i, { estado: "seguro", aprendido: true, notaConflicto: null });
  }

  function abrirSelector(i: number) {
    setBusqueda("");
    setSelectorIdx(i);
  }

  /** Nombre visible del departamento de una línea (null → "Sin departamento"). */
  function nombreDepto(id: string | null): string {
    if (!id) return "Sin departamento";
    return categorias.find((c) => c.id === id)?.nombre ?? "Sin departamento";
  }

  /** El usuario eligió el departamento del producto nuevo desde el selector. */
  function elegirDepartamento(id: string | null) {
    if (deptoSelectorIdx == null) return;
    actualizarLinea(deptoSelectorIdx, { departamentoId: id });
    setDeptoSelectorIdx(null);
  }

  /** El usuario eligió a mano el producto correcto: queda seguro y se
   *  recalcula aviso/decisión/precio contra ESE producto. Si su historial
   *  de costos aún no está cargado (empareje manual), se trae al vuelo. */
  async function elegirProducto(p: Producto) {
    const i = selectorIdx;
    if (i == null) return;
    let hist = historiales.get(p.id);
    if (!hist) {
      const mapa = await cargarHistorialesCostos([p.id]);
      hist = mapa.get(p.id) ?? [];
      const histFinal = hist;
      setHistoriales((prev) => new Map(prev).set(p.id, histFinal));
    }
    const histDec = decisionCostoHistorial(costoPiezaDe(lineas[i]), hist);
    mutarLinea(i, (l) => {
      const nl: LineaEstado = {
        ...l,
        productoId: p.id,
        estado: "seguro",
        aprendido: true,
        viaIA: false,
        viaDiccionario: false,
        notaConflicto: null, // lo eligió a mano: manda como el alias
      };
      const costoPieza = costoPiezaDe(nl);
      const aviso = nivelAvisoCosto(p.costo_centavos, costoPieza, cfg);
      const sug = redondearPrecio(
        precioSugerido(
          costoPieza,
          p.costo_centavos,
          p.precio_venta_centavos,
          cfg.margenDefaultPct
        ),
        modo,
        costoPieza
      );
      // Producto existente: el precio de venta arranca del ACTUAL del
      // producto (no se recalcula solo); el % es informativo.
      const precioActual = p.precio_venta_centavos > 0 ? p.precio_venta_centavos : null;
      const pct = markupPct(costoPieza, precioActual ?? sug);
      // El ancla histórica manda sobre los umbrales de la config; la
      // variación dentro de lo normal ("aviso") también arranca en MANTENER.
      return {
        ...nl,
        decision:
          histDec === "fuera"
            ? "mantener"
            : aviso.nivel === "irreal"
              ? "mantener"
              : aviso.nivel === "alerta"
                ? null
                : aviso.nivel === "aviso" || aviso.pct != null
                  ? "mantener"
                  : "sugerido",
        precioTxt: centavosATexto(precioActual ?? sug),
        pctTxt: pct == null ? "" : String(pct),
      };
    });
    setSelectorIdx(null);
    setBusqueda("");
  }

  /** La línea no es ningún producto existente: se creará uno nuevo.
   *  Conserva el departamento que ya se hubiera propuesto. */
  function crearNuevoDesdeSelector() {
    const i = selectorIdx;
    if (i == null) return;
    mutarLinea(i, (l) => ({
      ...l,
      productoId: null,
      estado: null,
      aprendido: true,
      viaIA: false,
      viaDiccionario: false,
      notaConflicto: null,
      decision: "sugerido",
    }));
    setSelectorIdx(null);
    setBusqueda("");
  }

  // -------------------------------------------------------------------------
  // Captura de la foto
  // -------------------------------------------------------------------------

  function manejarFoto(r: ImagePicker.ImagePickerResult) {
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    if (!a.base64) {
      setError("No se pudo leer la foto. Intenta otra vez.");
      return;
    }
    setFotoUri(a.uri);
    setFotoB64(a.base64);
    setFotoMime(a.mimeType ?? "image/jpeg");
    setPaso("previsualizar");
  }

  async function tomarFoto() {
    setError("");
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setError("Necesito permiso de cámara para escanear el ticket.");
        return;
      }
      const r = await ImagePicker.launchCameraAsync({
        quality: 0.7,
        base64: true,
      });
      manejarFoto(r);
    } catch {
      setError("No se pudo abrir la cámara.");
    }
  }

  async function elegirDeGaleria() {
    setError("");
    try {
      const r = await ImagePicker.launchImageLibraryAsync({
        quality: 0.7,
        base64: true,
        mediaTypes: ["images"],
      });
      manejarFoto(r);
    } catch {
      setError("No se pudo abrir la galería.");
    }
  }

  function repetirFoto() {
    setFotoUri(null);
    setFotoB64(null);
    setRespuesta(null);
    setLineas([]);
    setOtrasLineas([]);
    setHistoriales(new Map());
    setError("");
    setPaso("elegir");
  }

  // -------------------------------------------------------------------------
  // Analizar con IA + emparejar contra el catálogo
  // -------------------------------------------------------------------------

  async function analizar() {
    if (!fotoB64 || paso === "analizando") return;
    setPaso("analizando");
    setError("");
    try {
      // El catálogo (máx. 300 productos con alias, pack y último costo)
      // viaja CON la foto: la IA lo usa de contexto y puede responder
      // catalogo_idx por línea apuntando a la entrada enviada.
      const catalogoIA = await catalogoParaIA(300);
      const [resp, prods, cfgEscaner, aliasMap, perfiles, cats] =
        await Promise.all([
          analizarTicket(fotoB64, fotoMime, catalogoIA.paraEnvio),
          listarProductos(),
          obtenerConfigEscaner(),
          cargarMapaAlias(),
          cargarMapaPerfiles(),
          listarCategorias(),
        ]);

      const modoR = modoRedondeoDesdeConfig(cfgEscaner.redondeo);
      const emparejes = emparejarLineas(resp.lineas, prods, aliasMap);

      // catalogo_idx del backend: índice 0-based del catálogo ENVIADO. Si es
      // válido y el producto sigue existiendo, es empareje SEGURO vía IA
      // (gana sobre alias/fuzzy local). Índice inválido: se ignora.
      // CONFLICTO DE PRESENTACIÓN: si la IA apuntó a un producto cuyo nombre
      // indica otro tamaño/envase que el ticket, DEGRADA a sugerido con nota.
      const viaIAPorLinea: boolean[] = resp.lineas.map(() => false);
      const emparejesFinales = emparejes.map((emp, i) => {
        const idx = resp.lineas[i]?.catalogo_idx;
        if (
          typeof idx === "number" &&
          Number.isInteger(idx) &&
          idx >= 0 &&
          idx < catalogoIA.productoIds.length
        ) {
          const pid = catalogoIA.productoIds[idx];
          const encontrado = prods.find((p) => p.id === pid);
          if (encontrado) {
            viaIAPorLinea[i] = true;
            const conf = conflictoPresentacion(
              `${resp.lineas[i]?.nombre_crudo ?? ""} ${resp.lineas[i]?.nombre_sugerido ?? ""}`,
              encontrado.nombre
            );
            if (conf) {
              return {
                ...emp,
                producto: encontrado,
                estado: "sugerido" as const,
                notaConflicto: conf,
              };
            }
            return { ...emp, producto: encontrado, estado: "seguro" as const };
          }
        }
        return emp;
      });

      // Ancla histórica: historiales de costo de TODOS los emparejados en una
      // sola consulta (los del empareje manual se cargan al vuelo después).
      const idsEmparejados = [
        ...new Set(
          emparejesFinales
            .map((e) => e.producto?.id)
            .filter((x): x is string => !!x)
        ),
      ];
      const historialesMap = await cargarHistorialesCostos(idsEmparejados);
      setHistoriales(historialesMap);

      setCatalogo(prods);
      setCategorias(cats);
      setCfg(cfgEscaner);
      setModo(modoR);
      setRespuesta(resp);

      const iniciales: LineaEstado[] = [];
      const otras: LineaTicket[] = [];
      let irrealInit = 0;
      let bajasInit = 0;
      resp.lineas.forEach((linea, i) => {
        if (linea.tipo !== "venta") {
          otras.push(linea);
          return;
        }
        const emp = emparejesFinales[i];
        const prod = emp.producto;
        const viaIA = viaIAPorLinea[i];

        // Piezas por empaque: 1) lo que leyó la IA, 2) lo recordado por el
        // alias del negocio, 3) sospecha por el nombre cuando la línea es por
        // pieza y el costo (≥$80) o la confianza media delatan un pack,
        // 4) el diccionario universal (solo producto NUEVO y solo si el
        // ticket trae señal de caja/pack: número en el nombre o unidad
        // caja/pack) — sin señal NO se infla una venta de pieza suelta.
        let nEmp = 1;
        if (linea.piezas_por_empaque && linea.piezas_por_empaque > 1) {
          nEmp = linea.piezas_por_empaque;
        } else if (emp.piezasEmpaqueRecordado && emp.piezasEmpaqueRecordado > 1) {
          nEmp = emp.piezasEmpaqueRecordado;
        } else if (
          (linea.unidad_ticket == null || linea.unidad_ticket === "pieza") &&
          (linea.costo_unitario_centavos >= 8000 || linea.confianza === "media")
        ) {
          nEmp = extraerPiezasEmpaque(linea.nombre_crudo) ?? 1;
        }
        if (nEmp === 1 && !prod && emp.diccionario?.piezasEmpaque) {
          const delNombre = extraerPiezasEmpaque(linea.nombre_crudo);
          if (delNombre) nEmp = delNombre;
          else if (
            linea.unidad_ticket === "caja" ||
            linea.unidad_ticket === "pack"
          )
            nEmp = emp.diccionario.piezasEmpaque;
        }
        const conEmpaque = nEmp > 1;

        // Un solo camino: el costo por pieza siempre sale de repartir el
        // costo del empaque (n=1 en pieza suelta).
        const costoPieza = recalcularPorEmpaque(
          linea.costo_unitario_centavos,
          nEmp,
          null,
          modoR
        ).costoPieza;
        const aviso = nivelAvisoCosto(
          prod?.costo_centavos ?? null,
          costoPieza,
          cfgEscaner
        );
        const sug = redondearPrecio(
          precioSugerido(
            costoPieza,
            prod?.costo_centavos ?? null,
            prod?.precio_venta_centavos ?? 0,
            cfgEscaner.margenDefaultPct
          ),
          modoR,
          costoPieza
        );
        // Ancla histórica (manda sobre la config): si el costo leído queda
        // FUERA del rango esperado del historial, arranca en MANTENER con
        // nota neutra ámbar y SIN alerta roja. REGLA INQUEBRANTABLE intacta:
        // "irreal" también arranca en MANTENER y "alerta" queda sin decidir
        // (bloquea el aplicar hasta que el usuario elija).
        // DEFAULTS DE COSTO (ronda de cierre): la variación dentro de lo
        // normal ("aviso" ámbar) y el cambio mínimo ("ninguno" con %) también
        // arrancan en MANTENER — el usuario puede cambiar a "usar ticket".
        const histDec = prod
          ? decisionCostoHistorial(costoPieza, historialesMap.get(prod.id) ?? [])
          : "sin_historial";
        const decision: DecisionCosto = !prod
          ? "sugerido"
          : histDec === "fuera"
            ? "mantener"
            : aviso.nivel === "irreal"
              ? "mantener"
              : aviso.nivel === "alerta"
                ? null
                : aviso.nivel === "aviso" || aviso.pct != null
                  ? "mantener"
                  : "sugerido";
        // Precio de venta: en producto EXISTENTE ya no arranca del cálculo —
        // arranca del precio ACTUAL del producto (solo cambia si el usuario
        // lo edita a mano). En producto nuevo, el sugerido como siempre.
        const precioActual =
          prod && prod.precio_venta_centavos > 0
            ? prod.precio_venta_centavos
            : null;
        const pct = markupPct(costoPieza, precioActual ?? sug);

        // Notas de verificación por doble lectura: "dos lecturas discrepan"
        // y "solo apareció en una de dos lecturas" dejan la línea DESMARCADA
        // por defecto (misma regla que confianza baja).
        const notaDesmarca =
          !!linea.nota && /discrepan|solo apareci/i.test(linea.nota);

        // Departamento sugerido (solo productos nuevos): 1) el perfil
        // aprendido del negocio manda; 2) si no, el departamento que trae el
        // diccionario universal, conectado a una categoría EXISTENTE por
        // nombre (si la categoría no existe, no se sugiere nada).
        let departamentoId: string | null = null;
        let departamentoSugeridoNombre: string | null = null;
        if (!prod) {
          const dePerfil =
            perfiles.get(normalizarClave(linea.nombre_crudo))?.departamentoId ??
            perfiles.get(normalizarClave(linea.nombre_sugerido))?.departamentoId ??
            null;
          if (dePerfil) {
            departamentoId = dePerfil;
            departamentoSugeridoNombre =
              cats.find((c) => c.id === dePerfil)?.nombre ?? null;
          } else if (emp.diccionario?.departamento) {
            const buscado = emp.diccionario.departamento.trim().toLowerCase();
            const cat = cats.find(
              (c) => c.nombre.trim().toLowerCase() === buscado
            );
            if (cat) {
              departamentoId = cat.id;
              departamentoSugeridoNombre = cat.nombre;
            }
          }
        }

        iniciales.push({
          linea,
          incluida: linea.confianza !== "baja" && !notaDesmarca,
          nombre:
            emp.diccionario?.nombre ??
            nombreBonito(linea.nombre_crudo, linea.nombre_sugerido),
          productoId: prod?.id ?? null,
          estado: emp.estado,
          viaAlias: !!emp.viaAlias,
          viaIA,
          viaDiccionario: !!emp.viaDiccionario,
          cantidadTxt: String(linea.cantidad),
          conEmpaque,
          piezasEmpaqueTxt: conEmpaque ? String(nEmp) : "",
          costoTxt: centavosATexto(linea.costo_unitario_centavos),
          decision,
          precioTxt: centavosATexto(precioActual ?? sug),
          pctTxt: pct == null ? "" : String(pct),
          aprendido: false,
          departamentoId,
          departamentoSugeridoNombre,
          notaConflicto: emp.notaConflicto ?? null,
        });
        // Contadores para el default del colapsable de avisos del ticket
        // (misma fórmula que el banner "ticket dudoso" del render).
        if (linea.confianza === "baja") bajasInit++;
        if (
          linea.confianza !== "baja" &&
          !notaDesmarca &&
          aviso.nivel === "irreal"
        )
          irrealInit++;
      });

      // Los avisos del ticket arrancan EXPANDIDOS solo si el ticket es dudoso.
      setAvisosTicketAbiertos(irrealInit > 2 || bajasInit > 3);

      setLineas(iniciales);
      setOtrasLineas(otras);
      setOtrasAbierto(false);
      setPaso("revision");
    } catch (e: any) {
      setError(e?.message ?? "No se pudo analizar el ticket.");
      setPaso("previsualizar");
    }
  }

  // -------------------------------------------------------------------------
  // Aplicar al inventario
  // -------------------------------------------------------------------------

  async function aplicar() {
    if (paso !== "revision") return;
    setPaso("aplicando");
    setError("");
    try {
      const payload: LineaResurtido[] = [];
      for (const le of lineas) {
        if (!le.incluida) continue;
        const d = datosLinea(le);
        if (d.piezas <= 0) continue;
        const esNuevo = !d.prod;
        const conserva = !esNuevo && le.decision === "mantener";
        const claves = clavesDeLinea(le);
        payload.push({
          productoId: d.prod?.id ?? null,
          nombre: esNuevo ? le.nombre.trim() || le.linea.nombre_crudo : d.prod!.nombre,
          codigo_barras: esNuevo ? le.linea.codigo_barras : null,
          piezas: d.piezas,
          costo_centavos: conserva
            ? (d.prod!.costo_centavos ?? d.costoPieza)
            : d.costoPieza,
          precio_centavos: conserva ? null : aCentavos(le.precioTxt) || null,
          aliasClaves: claves.length ? claves : undefined,
          aliasMuestra: le.linea.nombre_crudo,
          piezasEmpaque: le.conEmpaque ? d.nEmp : null,
          departamentoId: esNuevo ? le.departamentoId : null,
        });
      }
      if (!payload.length) {
        setError("No hay líneas incluidas con piezas.");
        setPaso("revision");
        return;
      }
      const res = await aplicarResurtido(payload);
      // Gancho ADITIVO de Proveedores/Compras: registra la compra del ticket
      // (proveedor, folio, fecha, tipo, total, líneas) en el módulo nuevo.
      // Si el ticket no trajo proveedor, la compra queda en el histórico
      // general (proveedor NULL). Silencioso: JAMÁS rompe el resurtido.
      if (respuesta) {
        try {
          await registrarCompraDesdeTicket(respuesta).catch(() => null);
        } catch {
          // ignorar: el resurtido ya quedó aplicado
        }
      }
      setResultado(res);
      setPaso("listo");
    } catch (e: any) {
      setError(e?.message ?? "No se pudo aplicar el resurtido.");
      setPaso("revision");
    }
  }

  // -------------------------------------------------------------------------
  // Derivados de la revisión (bloqueos y contadores del footer)
  // -------------------------------------------------------------------------
  const evaluadas = lineas.map((le) => ({ le, d: datosLinea(le) }));
  const incluidas = evaluadas.filter((x) => x.le.incluida && x.d.piezas > 0);
  const alertasSinDecidir = incluidas.filter(
    (x) => x.d.prod && x.d.aviso.nivel === "alerta" && x.le.decision == null
  );
  const sugeridosSinConfirmar = incluidas.filter(
    (x) => x.le.estado === "sugerido"
  );
  const totalPiezas = incluidas.reduce((s, x) => s + x.d.piezas, 0);
  const irrealCount = evaluadas.filter(
    (x) => x.le.incluida && x.d.aviso.nivel === "irreal"
  ).length;
  const bajasCount = lineas.filter((le) => le.linea.confianza === "baja").length;
  // Banner global: demasiadas lecturas raras = probablemente la foto no sirve.
  const ticketDudoso = irrealCount > 2 || bajasCount > 3;
  const aplicable =
    incluidas.length > 0 &&
    alertasSinDecidir.length === 0 &&
    sugeridosSinConfirmar.length === 0;

  // Avisos globales del ticket: si hay más de uno se colapsan en una sola
  // caja ("⚠ N avisos de este ticket"), expandida por defecto SOLO cuando el
  // ticket se ve dudoso (ver setAvisosTicketAbiertos en analizar()).
  const avisosTicket: { tipo: "alerta" | "info"; texto: string }[] = [];
  if (respuesta && sumaCuadra(respuesta) === false)
    avisosTicket.push({
      tipo: "alerta",
      texto:
        "Las líneas no cuadran con el total impreso en el ticket. Revisa con calma: la IA pudo leer mal una cantidad o un costo.",
    });
  for (const a of respuesta?.avisos ?? [])
    avisosTicket.push({ tipo: "info", texto: a });
  if (respuesta?.mock)
    avisosTicket.push({
      tipo: "info",
      texto:
        "Respuesta de prueba del servidor (mock): los datos no son de tu foto.",
    });
  if (ticketDudoso)
    avisosTicket.push({
      tipo: "alerta",
      texto:
        "Este ticket se ve dudoso: la IA pudo leer mal varios costos. Revisa con calma; si algo no cuadra, repite la foto.",
    });

  // Banner suave de aprendizaje: muchas líneas nuevas o varias dudas ámbar
  // indican un negocio que la IA aún no conoce. UNA línea discreta, no caja.
  const nuevasCount = evaluadas.filter((x) => !x.d.prod).length;
  const mostrarAprendizaje =
    nuevasCount >= 3 || sugeridosSinConfirmar.length >= 2;

  // -------------------------------------------------------------------------
  // Vista: ELEGIR fuente de la foto
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // Vista: CONSENTIMIENTO. Puerta obligatoria antes del primer escaneo.
  // -------------------------------------------------------------------------
  //
  // POR QUE ES UNA PUERTA Y NO UN CARTEL
  // La politica publicada afirma que el aviso sale antes del primer uso y que
  // no se manda nada hasta aceptar. Un cartel informativo que se pueda ignorar
  // convertiria esa frase en mentira. Aqui no hay forma de llegar a la camara
  // ni a la galeria sin pasar por el boton de aceptar.
  //
  // POR QUE EL TEXTO DICE LO QUE DICE
  // El escaner usa la capa GRATUITA de Gemini, donde Google puede usar el
  // contenido para mejorar sus modelos, con posible revision humana. Y un
  // ticket de proveedor no es un dato del usuario: lleva informacion comercial
  // de un TERCERO (que compra, a quien y a que precio). Omitirlo dejaria un
  // consentimiento que no informa de lo unico que hay que decidir.
  // Cuando se pase a la capa de pago, esto se suaviza: se quita el parrafo de
  // "mejorar sus modelos" y la fecha guardada permite volver a preguntar.
  const vistaConsentimiento = (
    <ScrollView contentContainerStyle={est.cuerpo} keyboardShouldPersistTaps="handled">
      <Banner texto={error} tipo="error" />

      <Text style={est.explica}>
        El escáner de tickets no lee la foto en tu teléfono: la envía a Google
        para que su inteligencia artificial la interprete. Antes de usarlo por
        primera vez conviene que sepas qué implica.
      </Text>

      <AvisoCaja T={T} tipo="alerta">
        La foto del ticket se envía a Google (Gemini). En el plan que usamos hoy,
        Google puede emplear ese contenido para mejorar sus modelos, y eso
        incluye la posibilidad de que una persona lo revise.
      </AvisoCaja>

      <AvisoCaja T={T} tipo="info">
        Un ticket de proveedor no habla solo de ti: dice qué compras, a quién y a
        qué precio. Si eso es información que prefieres no compartir, no uses el
        escáner y captura la compra a mano — el resto de YvexPOS funciona igual.
      </AvisoCaja>

      <Text style={est.explica}>
        Solo se envía la foto que tú elijas, en el momento en que tocas
        «Analizar ticket». No se manda nada más de tu negocio, ni se envía nada
        en segundo plano. Puedes retirar este permiso cuando quieras desde
        Ajustes.
      </Text>

      <Boton
        titulo="Entiendo y acepto usar el escáner"
        onPress={() => void aceptarEnvioIA()}
        cargando={guardandoConsent}
      />
      <View style={{ height: 10 }} />
      <Boton titulo="Ahora no" tipo="secundario" onPress={onCerrar} />

      <View style={est.consentEnlaces}>
        <Pressable onPress={() => void Linking.openURL("https://yvexiq.com/privacidad")} hitSlop={8}>
          <Text style={est.enlaceTxt}>Aviso de privacidad ›</Text>
        </Pressable>
        <Pressable onPress={() => void Linking.openURL("https://yvexiq.com/terminos")} hitSlop={8}>
          <Text style={est.enlaceTxt}>Términos ›</Text>
        </Pressable>
      </View>
    </ScrollView>
  );

  const vistaElegir = (
    <ScrollView
      contentContainerStyle={est.cuerpo}
      keyboardShouldPersistTaps="handled"
    >
      {vinculado === false && (
        <Banner
          tipo="info"
          texto="Para usar el escáner primero vincula tu cuenta en Ajustes › Cuenta."
        />
      )}
      <Banner texto={error} tipo="error" />
      <Text style={est.explica}>
        Tómale una foto clara al ticket de compra: completo, sin dobleces y con
        buena luz. La IA leerá las líneas y las emparejará con tu inventario.
      </Text>

      <View style={est.opcionesFoto}>
        <Pressable
          onPress={tomarFoto}
          disabled={vinculado === false}
          style={({ pressed }) => [
            est.opcionFoto,
            pressed && { opacity: 0.85 },
            vinculado === false && { opacity: 0.4 },
          ]}
        >
          <IconoUI id="camara" size={30} color={T.acento} />
          <Text style={est.opcionFotoTxt}>Tomar foto</Text>
        </Pressable>
        <Pressable
          onPress={elegirDeGaleria}
          disabled={vinculado === false}
          style={({ pressed }) => [
            est.opcionFoto,
            pressed && { opacity: 0.85 },
            vinculado === false && { opacity: 0.4 },
          ]}
        >
          <IconoUI id="imagen" size={30} color={T.acento} />
          <Text style={est.opcionFotoTxt}>Elegir de galería</Text>
        </Pressable>
      </View>

      <AvisoCaja T={T} tipo="info">
        La IA puede equivocarse: tú revisas y confirmas TODO antes de que se
        toque tu inventario. Nada se aplica solo.
      </AvisoCaja>

      <Pressable onPress={() => setAjustesEsc(true)} hitSlop={8} style={est.enlace}>
        <Text style={est.enlaceTxt}>Ajustes del escáner ›</Text>
      </Pressable>
    </ScrollView>
  );

  // -------------------------------------------------------------------------
  // Vista: PREVISUALIZAR la foto antes de mandarla
  // -------------------------------------------------------------------------
  const vistaPrevisualizar = (
    <ScrollView
      contentContainerStyle={est.cuerpo}
      keyboardShouldPersistTaps="handled"
    >
      <Banner texto={error} tipo="error" />
      {fotoUri && (
        <Image source={{ uri: fotoUri }} style={est.foto} resizeMode="contain" />
      )}
      <AvisoCaja T={T} tipo="info">
        Verifica que el ticket se lea completo y sin reflejos. Si se ve borroso
        o cortado, repite la foto: la IA no adivina lo que no alcanza a leer.
      </AvisoCaja>
      <Boton titulo="Analizar ticket" onPress={analizar} />
      <View style={{ height: 10 }} />
      <Boton titulo="Repetir foto" tipo="secundario" onPress={repetirFoto} />
      <Pressable onPress={() => setAjustesEsc(true)} hitSlop={8} style={est.enlace}>
        <Text style={est.enlaceTxt}>Ajustes del escáner ›</Text>
      </Pressable>
    </ScrollView>
  );

  // -------------------------------------------------------------------------
  // Vista genérica de espera (analizando / aplicando)
  // -------------------------------------------------------------------------
  const vistaCargando = (texto: string) => (
    <View style={est.cargandoCaja}>
      <ActivityIndicator size="large" color={T.acento} />
      <Text style={est.cargandoTxt}>{texto}</Text>
    </View>
  );

  // -------------------------------------------------------------------------
  // Tarjeta de una línea de venta
  // -------------------------------------------------------------------------
  function tarjetaLinea(le: LineaEstado, i: number) {
    const d = datosLinea(le);
    const atenuada = !le.incluida;
    const pctAviso =
      d.aviso.pct != null
        ? `${d.aviso.pct > 0 ? "+" : ""}${d.aviso.pct.toFixed(1)}%`
        : "";
    // Ancla histórica: fuera del rango esperado → nota neutra ámbar y NADA
    // de alerta roja (el historial manda sobre los umbrales de la config).
    const fueraHist = d.prod != null && d.historialEstado === "fuera";
    return (
      <View key={i} style={[est.tarjeta, atenuada && { opacity: 0.45 }]}>
        {/* Nombre: fijo si ya existe en el catálogo, editable si es nuevo */}
        {d.prod ? (
          <Text style={est.prodNombre}>{d.prod.nombre}</Text>
        ) : (
          <TextInput
            value={le.nombre}
            onChangeText={(t) => actualizarLinea(i, { nombre: t })}
            style={[estInput, est.nombreInput]}
            placeholder="Nombre del producto nuevo"
            placeholderTextColor={T.textoTenue}
          />
        )}
        <Text style={est.crudo}>En el ticket: {le.linea.nombre_crudo}</Text>

        {/* Confianza de la lectura y nota de la IA */}
        {(le.linea.confianza !== "alta" || le.linea.nota) && (
          <View style={est.filaWrap}>
            {le.linea.confianza !== "alta" && (
              <Insignia
                texto={`CONFIANZA ${le.linea.confianza.toUpperCase()}`}
                color={le.linea.confianza === "media" ? T.alerta : T.peligro}
              />
            )}
            {le.linea.nota ? (
              <Text style={est.notaTxt}>{le.linea.nota}</Text>
            ) : null}
          </View>
        )}

        {/* Empareje con el catálogo */}
        {le.estado === "sugerido" && d.prod ? (
          <View style={est.emparejeDudoso}>
            <Text style={est.emparejeDudosoTxt}>
              ¿Es “{d.prod.nombre}”? Toca para confirmar.
            </Text>
            <View style={est.filaBotones}>
              <Boton
                titulo="Confirmar"
                chico
                onPress={() => confirmarEmpareje(i)}
              />
              <Pressable onPress={() => abrirSelector(i)} hitSlop={8}>
                <Text style={est.cambiarTxt}>cambiar ›</Text>
              </Pressable>
            </View>
          </View>
        ) : d.prod ? (
          <View style={est.emparejeOk}>
            {le.viaIA && !le.aprendido ? (
              <Insignia
                texto="✓ LA IA LO RECONOCIÓ DE TU CATÁLOGO"
                color={T.exito}
              />
            ) : (
              <Text style={est.emparejeOkTxt}>
                {le.aprendido || le.viaAlias ? "✓ aprendido" : "✓ seguro"}
              </Text>
            )}
            <Pressable onPress={() => abrirSelector(i)} hitSlop={8}>
              <Text style={est.cambiarTxt}>cambiar ›</Text>
            </Pressable>
          </View>
        ) : (
          <View style={est.emparejeOk}>
            <Insignia texto="PRODUCTO NUEVO" color={T.acento} />
            <Pressable onPress={() => abrirSelector(i)} hitSlop={8}>
              <Text style={est.cambiarTxt}>emparejar ›</Text>
            </Pressable>
          </View>
        )}

        {/* Conflicto de presentación: el ticket dice otro tamaño/envase que
            el producto emparejado (degradado a ámbar; exige confirmación) */}
        {le.notaConflicto && (
          <View style={est.bloque}>
            <AvisoCaja T={T} tipo="alerta">
              {le.notaConflicto}
            </AvisoCaja>
          </View>
        )}

        {/* Departamento (solo cuando se creará un producto nuevo): fila
            compacta que abre el selector modal */}
        {!d.prod && (
          <Pressable
            onPress={() => setDeptoSelectorIdx(i)}
            style={[est.emparejeOk, est.bloque]}
            hitSlop={6}
          >
            <Text style={est.deptoFilaTxt}>
              Departamento:{" "}
              <Text style={est.deptoFilaValor}>
                {nombreDepto(le.departamentoId)}
              </Text>
              {le.departamentoSugeridoNombre != null &&
              nombreDepto(le.departamentoId) === le.departamentoSugeridoNombre
                ? " · sugerido"
                : ""}
            </Text>
            <Text style={est.cambiarTxt}>cambiar ›</Text>
          </Pressable>
        )}

        {/* Cantidad y empaque en una fila compacta:
            "2 × 12 = 24 pzs" + enlace para conmutar pieza suelta ↔ pack */}
        <View style={[est.filaNums, est.bloque]}>
          <Text style={est.numLabel}>
            {le.conEmpaque
              ? le.linea.unidad_ticket === "caja"
                ? "Cajas"
                : "Packs"
              : "Piezas"}
          </Text>
          <TextInput
            value={le.cantidadTxt}
            onChangeText={(t) => actualizarLinea(i, { cantidadTxt: t })}
            keyboardType="number-pad"
            style={[estInput, est.inputNum]}
          />
          {le.conEmpaque && (
            <>
              <Text style={est.numSigno}>×</Text>
              <TextInput
                value={le.piezasEmpaqueTxt}
                onChangeText={(t) => editarPiezasEmpaque(i, t)}
                keyboardType="number-pad"
                placeholder="¿?"
                placeholderTextColor={T.textoTenue}
                style={[estInput, est.inputNum]}
              />
            </>
          )}
          <Text style={est.numIgual}>= {d.piezas} pzs</Text>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => conmutarEmpaque(i, !le.conEmpaque)}
            hitSlop={8}
          >
            <Text style={est.enlaceMini}>
              {le.conEmpaque ? "es pieza suelta ›" : "¿viene en caja o pack? ›"}
            </Text>
          </Pressable>
        </View>

        {/* Costo (por empaque si viene en caja/pack; por pieza si no):
            "Costo caja $417.38 · por pieza $34.78 (antes $34.00 · +1.4%)".
            El cambio dentro de lo normal viaja INLINE aquí (sin caja aparte)
            y la línea arranca en MANTENER. */}
        <View style={[est.filaNums, est.bloque]}>
          <Text style={est.numLabel}>
            {le.conEmpaque ? "Costo caja" : "Costo"}
          </Text>
          <Text style={est.numSigno}>$</Text>
          <TextInput
            value={le.costoTxt}
            onChangeText={(t) => editarCosto(i, t)}
            keyboardType="decimal-pad"
            style={[estInput, est.inputNumDinero]}
          />
          <Text style={est.numSufijo} numberOfLines={2}>
            {[
              le.conEmpaque && d.nEmp > 1
                ? `· por pieza ${pesos(d.costoPieza)}`
                : null,
              d.prod?.costo_centavos != null
                ? `(antes ${pesos(d.prod.costo_centavos)}${
                    !fueraHist &&
                    d.aviso.nivel === "ninguno" &&
                    d.aviso.pct != null
                      ? ` · ${pctAviso}`
                      : ""
                  })`
                : null,
            ]
              .filter(Boolean)
              .join(" ")}
          </Text>
        </View>

        {/* Ancla histórica de costo: fuera de TU rango → nota neutra ámbar
            (arranca conservando; tú decides si el ticket tenía razón). */}
        {fueraHist && d.rangoHistorial && (
          <View style={est.bloque}>
            <AvisoCaja T={T} tipo="alerta">
              {le.decision === "mantener"
                ? `Fuera de tu rango histórico (${pesos(
                    d.rangoHistorial.min
                  )}–${pesos(d.rangoHistorial.max)}); el ticket dice ${pesos(
                    d.costoPieza
                  )}. Se conservará el costo actual.`
                : `El ticket dice ${pesos(
                    d.costoPieza
                  )}, fuera de tu rango histórico (${pesos(
                    d.rangoHistorial.min
                  )}–${pesos(
                    d.rangoHistorial.max
                  )}). Se aplicará el costo del ticket.`}
            </AvisoCaja>
            {le.decision === "mantener" ? (
              <Boton
                titulo="Usar costo del ticket"
                tipo="secundario"
                chico
                onPress={() => actualizarLinea(i, { decision: "sugerido" })}
              />
            ) : (
              <Boton
                titulo="Mejor conservar el actual"
                tipo="fantasma"
                chico
                onPress={() => actualizarLinea(i, { decision: "mantener" })}
              />
            )}
          </View>
        )}

        {/* Avisos de cambio de costo (solo contra producto existente; el
            ancla histórica los sustituye cuando aplica). El de "dentro de lo
            normal" ya viaja inline junto al costo (arranca en mantener). */}
        {!fueraHist && d.prod && d.aviso.nivel === "aviso" && (
          <AvisoCaja T={T} tipo="alerta">
            {`El costo cambió ${pctAviso}: antes ${pesos(
              d.prod.costo_centavos ?? 0
            )}, ahora ${pesos(d.costoPieza)}. Revisa que esté bien.`}
          </AvisoCaja>
        )}
        {!fueraHist && d.prod && d.aviso.nivel === "alerta" && (
          <AvisoCaja T={T} tipo="peligro">
            {`El costo cambió ${pctAviso} (antes ${pesos(
              d.prod.costo_centavos ?? 0
            )} → ahora ${pesos(d.costoPieza)}). Decide abajo qué hacer.`}
          </AvisoCaja>
        )}
        {!fueraHist && d.prod && d.aviso.nivel === "irreal" && (
          <View style={est.bloque}>
            <AvisoCaja T={T} tipo="peligro">
              {le.decision === "mantener"
                ? `El costo del ticket difiere ${pctAviso} del actual: parece un error de lectura, así que se conservará el costo actual (${pesos(
                    d.prod.costo_centavos ?? 0
                  )}).`
                : `Se aplicará el costo del ticket (${pctAviso}).`}
            </AvisoCaja>
            {le.decision === "mantener" ? (
              <Boton
                titulo="Usar costo del ticket"
                tipo="secundario"
                chico
                onPress={() => actualizarLinea(i, { decision: "sugerido" })}
              />
            ) : (
              <Boton
                titulo="Mejor conservar el actual"
                tipo="fantasma"
                chico
                onPress={() => actualizarLinea(i, { decision: "mantener" })}
              />
            )}
          </View>
        )}

        {/* Decisión de costo (no aplica en "irreal" ni con ancla histórica:
            en ambos casos manda su propia caja) */}
        {!fueraHist && d.prod && d.aviso.nivel !== "irreal" && (
          <View style={[est.segmento, est.bloque]}>
            <Pressable
              onPress={() => actualizarLinea(i, { decision: "mantener" })}
              style={[
                est.segOpcion,
                le.decision === "mantener" && {
                  backgroundColor: T.acento,
                  borderColor: T.acento,
                },
              ]}
            >
              <Text
                style={[
                  est.segTxt,
                  le.decision === "mantener" && { color: T.acentoTexto },
                ]}
              >
                Mantener
              </Text>
              <Text
                style={[
                  est.segSub,
                  le.decision === "mantener" && { color: T.acentoTexto },
                ]}
              >
                {pesos(d.prod.costo_centavos ?? 0)}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => actualizarLinea(i, { decision: "sugerido" })}
              style={[
                est.segOpcion,
                le.decision === "sugerido" && {
                  backgroundColor: T.acento,
                  borderColor: T.acento,
                },
              ]}
            >
              <Text
                style={[
                  est.segTxt,
                  le.decision === "sugerido" && { color: T.acentoTexto },
                ]}
              >
                Usar ticket
              </Text>
              <Text
                style={[
                  est.segSub,
                  le.decision === "sugerido" && { color: T.acentoTexto },
                ]}
              >
                {pesos(d.costoPieza)}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Precio de venta + % de ganancia (ligados): "Venta $44.00 · 28%" */}
        {(!d.prod || le.decision === "sugerido") && (
          <View style={[est.filaNums, est.bloque]}>
            <Text style={est.numLabel}>Venta</Text>
            <Text style={est.numSigno}>$</Text>
            <TextInput
              value={le.precioTxt}
              onChangeText={(t) => editarPrecio(i, t)}
              keyboardType="decimal-pad"
              style={[estInput, est.inputNumDinero]}
            />
            <Text style={est.numOp}>·</Text>
            <TextInput
              value={le.pctTxt}
              onChangeText={(t) => editarPct(i, t)}
              keyboardType="number-pad"
              style={[estInput, est.inputNum]}
            />
            <Text style={est.numSigno}>%</Text>
          </View>
        )}

        {/* Incluir / excluir la línea */}
        <View style={est.filaIncluir}>
          <Text style={est.incluirTxt}>Incluir esta línea</Text>
          <Switch
            value={le.incluida}
            onValueChange={(v) => actualizarLinea(i, { incluida: v })}
            trackColor={{ false: T.superficie3, true: T.acento + "66" }}
            thumbColor={le.incluida ? T.acento : T.textoTenue}
          />
        </View>
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Vista: REVISIÓN completa del ticket
  // -------------------------------------------------------------------------
  const vistaRevision = (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={est.cuerpo}
        keyboardShouldPersistTaps="handled"
      >
        <Banner texto={error} tipo="error" />

        {/* Cabecera del ticket */}
        {respuesta && (
          <View style={est.ticketCab}>
            <Text style={est.ticketProveedor}>
              {respuesta.proveedor ?? "Proveedor no identificado"}
            </Text>
            <Text style={est.ticketMeta}>
              {[
                respuesta.fecha ? fmtFechaTicket(respuesta.fecha) : null,
                respuesta.folio ? `Folio ${respuesta.folio}` : null,
                respuesta.total_ticket_centavos != null
                  ? `Total ${pesos(respuesta.total_ticket_centavos)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
        )}

        {respuesta?.verificacion?.aplicada && (
          <Text style={est.verificacionTxt}>
            {`Doble lectura aplicada: ${respuesta.verificacion.lineas_verificadas} verificadas, ${respuesta.verificacion.lineas_discrepantes} por revisar` +
              (respuesta.verificacion.lineas_sin_pareja > 0
                ? `, ${respuesta.verificacion.lineas_sin_pareja} solo en una lectura`
                : "")}
          </Text>
        )}

        {/* Avisos del ticket: uno solo se muestra directo; varios se
            colapsan (expandidos por defecto solo si el ticket es dudoso) */}
        {avisosTicket.length === 1 && (
          <AvisoCaja T={T} tipo={avisosTicket[0].tipo}>
            {avisosTicket[0].texto}
          </AvisoCaja>
        )}
        {avisosTicket.length > 1 && (
          <View style={est.avisosTicketCaja}>
            <Pressable
              onPress={() => setAvisosTicketAbiertos(!avisosTicketAbiertos)}
              style={est.otrasHeader}
              hitSlop={6}
            >
              <Text style={est.otrasTitulo}>
                ⚠ {avisosTicket.length} avisos de este ticket
              </Text>
              <Text style={est.otrasFlecha}>
                {avisosTicketAbiertos ? "▾" : "▸"}
              </Text>
            </Pressable>
            {avisosTicketAbiertos && (
              <View style={est.avisosTicketCuerpo}>
                {avisosTicket.map((a, idx) => (
                  <AvisoCaja key={idx} T={T} tipo={a.tipo}>
                    {a.texto}
                  </AvisoCaja>
                ))}
              </View>
            )}
          </View>
        )}

        {mostrarAprendizaje && (
          <Text style={est.aprendizajeTxt}>
            La IA está aprendiendo tu negocio: las primeras veces puede fallar
            más; cada corrección tuya la hace más precisa.
          </Text>
        )}

        {/* Líneas de venta */}
        {lineas.map((le, i) => tarjetaLinea(le, i))}

        {/* Lo que no entra al inventario */}
        {otrasLineas.length > 0 && (
          <View style={est.otrasCaja}>
            <Pressable
              onPress={() => setOtrasAbierto(!otrasAbierto)}
              style={est.otrasHeader}
              hitSlop={6}
            >
              <Text style={est.otrasTitulo}>
                También se leyó (no entra al inventario)
              </Text>
              <Text style={est.otrasFlecha}>{otrasAbierto ? "▾" : "▸"}</Text>
            </Pressable>
            {otrasAbierto &&
              otrasLineas.map((l, idx) => (
                <View key={idx} style={est.otraFila}>
                  <Text style={est.otraNombre} numberOfLines={1}>
                    {l.nombre_crudo}
                  </Text>
                  <Text style={est.otraMeta}>
                    {TIPO_OTRA[l.tipo] ?? "Otro"} ·{" "}
                    {pesos(importeLineaCentavos(l))}
                  </Text>
                </View>
              ))}
          </View>
        )}
        <View style={{ height: 12 }} />
      </ScrollView>

      {/* Footer fijo con el resumen y la acción */}
      <View style={est.footer}>
        <Text style={est.footerResumen}>
          Entran {totalPiezas} pzs · {incluidas.length}{" "}
          {incluidas.length === 1 ? "línea" : "líneas"}
        </Text>
        {sugeridosSinConfirmar.length > 0 && (
          <Text style={est.footerBloqueo}>
            Confirma los emparejes marcados en ámbar.
          </Text>
        )}
        {alertasSinDecidir.length > 0 && (
          <Text style={est.footerBloqueo}>
            Decide qué hacer con los costos marcados en rojo.
          </Text>
        )}
        {incluidas.length === 0 && (
          <Text style={est.footerBloqueo}>
            Incluye al menos una línea con piezas.
          </Text>
        )}
        <Boton
          titulo="Aplicar al inventario"
          onPress={aplicar}
          deshabilitado={!aplicable}
        />
      </View>
    </View>
  );

  // -------------------------------------------------------------------------
  // Vista: LISTO
  // -------------------------------------------------------------------------
  const vistaListo = (
    <View style={est.listoCaja}>
      <View style={est.listoCirculo}>
        <Text style={est.listoPalomita}>✓</Text>
      </View>
      <Text style={est.listoTitulo}>Ticket aplicado</Text>
      <Text style={est.listoResumen}>
        {resultado
          ? `${resultado.actualizados} ${
              resultado.actualizados === 1 ? "actualizado" : "actualizados"
            } · ${resultado.creados} ${
              resultado.creados === 1 ? "creado" : "creados"
            } · ${resultado.piezas} piezas`
          : ""}
      </Text>
      <View style={{ alignSelf: "stretch", marginTop: 26 }}>
        <Boton titulo="Listo" onPress={onAplicado} />
      </View>
    </View>
  );

  // -------------------------------------------------------------------------
  // Selector de producto (empareje manual de una línea)
  // -------------------------------------------------------------------------
  const termino = busqueda.trim().toLowerCase();
  const catalogoFiltrado = (
    termino
      ? catalogo.filter((p) => p.nombre.toLowerCase().includes(termino))
      : catalogo
  ).slice(0, 50);

  const selector = selectorIdx != null && lineas[selectorIdx] && (
    <Modal
      visible
      animationType="slide"
      onRequestClose={() => setSelectorIdx(null)}
    >
      {/* KeyboardAvoidingView: este modal no usa <Hoja>, y con
          `edgeToEdgeEnabled: true` el `softwareKeyboardLayoutMode: "resize"`
          de app.json ya no encoge la ventana — el teclado se monta ENCIMA.
          "padding", nunca "height" (rebota al cerrarse). */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <SafeAreaView style={est.raiz}>
        <CabeceraModal
          titulo="Emparejar línea"
          izquierda="Cancelar"
          onIzquierda={() => setSelectorIdx(null)}
        />
        <View style={est.selectorCuerpo}>
          <Text style={est.selectorCrudo} numberOfLines={2}>
            En el ticket: {lineas[selectorIdx].linea.nombre_crudo}
          </Text>
          <TextInput
            autoFocus
            value={busqueda}
            onChangeText={setBusqueda}
            placeholder="Buscar en tu catálogo…"
            placeholderTextColor={T.textoTenue}
            style={estInput}
          />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{ marginTop: 12 }}
          >
            <Pressable onPress={crearNuevoDesdeSelector} style={est.selectorNuevo}>
              <Text style={est.selectorNuevoTxt}>＋ Crear producto nuevo</Text>
            </Pressable>
            {catalogoFiltrado.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => elegirProducto(p)}
                style={({ pressed }) => [
                  est.selectorFila,
                  pressed && { backgroundColor: T.superficie2 },
                ]}
              >
                <Text style={est.selectorFilaTxt} numberOfLines={1}>
                  {p.nombre}
                </Text>
                {p.costo_centavos != null && (
                  <Text style={est.selectorFilaMeta}>
                    costo {pesos(p.costo_centavos)}
                  </Text>
                )}
              </Pressable>
            ))}
            {catalogoFiltrado.length === 0 && (
              <Text style={est.selectorVacio}>
                Sin resultados para “{busqueda}”.
              </Text>
            )}
            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );

  // -------------------------------------------------------------------------
  // Selector de departamento (producto nuevo): "Sin departamento" primero y
  // la categoría sugerida (perfil o diccionario) arriba con su insignia.
  // -------------------------------------------------------------------------
  const lineaDepto = deptoSelectorIdx != null ? lineas[deptoSelectorIdx] : null;
  const sugeridoNombre = lineaDepto?.departamentoSugeridoNombre ?? null;
  const sugeridoDeptoCat = sugeridoNombre
    ? (categorias.find(
        (c) =>
          c.nombre.trim().toLowerCase() === sugeridoNombre.trim().toLowerCase()
      ) ?? null)
    : null;
  const catsOrdenadas = sugeridoDeptoCat
    ? [sugeridoDeptoCat, ...categorias.filter((c) => c.id !== sugeridoDeptoCat.id)]
    : categorias;

  const selectorDepto = lineaDepto && (
    <Modal
      visible
      animationType="slide"
      onRequestClose={() => setDeptoSelectorIdx(null)}
    >
      {/* KeyboardAvoidingView: este modal no usa <Hoja>, y con
          `edgeToEdgeEnabled: true` el `softwareKeyboardLayoutMode: "resize"`
          de app.json ya no encoge la ventana — el teclado se monta ENCIMA.
          "padding", nunca "height" (rebota al cerrarse). */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <SafeAreaView style={est.raiz}>
        <CabeceraModal
          titulo="Departamento"
          izquierda="Cancelar"
          onIzquierda={() => setDeptoSelectorIdx(null)}
        />
        <View style={est.selectorCuerpo}>
          <Text style={est.selectorCrudo} numberOfLines={2}>
            {lineaDepto.nombre || lineaDepto.linea.nombre_crudo}
          </Text>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{ marginTop: 12 }}
          >
            <Pressable
              onPress={() => elegirDepartamento(null)}
              style={({ pressed }) => [
                est.selectorFila,
                pressed && { backgroundColor: T.superficie2 },
              ]}
            >
              <Text style={est.selectorFilaTxt}>Sin departamento</Text>
              {lineaDepto.departamentoId == null && (
                <Text style={est.selectorCheck}>✓</Text>
              )}
            </Pressable>
            {catsOrdenadas.map((c) => {
              const activo = lineaDepto.departamentoId === c.id;
              const esSugerido = sugeridoDeptoCat?.id === c.id;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => elegirDepartamento(c.id)}
                  style={({ pressed }) => [
                    est.selectorFila,
                    pressed && { backgroundColor: T.superficie2 },
                  ]}
                >
                  <Text style={est.selectorFilaTxt} numberOfLines={1}>
                    {c.nombre}
                  </Text>
                  <View style={est.selectorFilaDer}>
                    {esSugerido && (
                      <Insignia texto="SUGERIDO" color={T.acento} />
                    )}
                    {activo && <Text style={est.selectorCheck}>✓</Text>}
                  </View>
                </Pressable>
              );
            })}
            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );

  // -------------------------------------------------------------------------
  // Render principal
  // -------------------------------------------------------------------------
  const bloqueado = paso === "analizando" || paso === "aplicando";
  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      {/* KeyboardAvoidingView: este modal no usa <Hoja>, y con
          `edgeToEdgeEnabled: true` el `softwareKeyboardLayoutMode: "resize"`
          de app.json ya no encoge la ventana — el teclado se monta ENCIMA.
          "padding", nunca "height" (rebota al cerrarse). */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <SafeAreaView style={est.raiz}>
        <CabeceraModal
          titulo={TITULOS[paso]}
          izquierda={paso === "listo" ? "Cerrar" : "Cancelar"}
          onIzquierda={bloqueado ? () => {} : onCerrar}
        />
        {paso === "consentimiento" && vistaConsentimiento}
        {paso === "elegir" && vistaElegir}
        {paso === "previsualizar" && vistaPrevisualizar}
        {paso === "analizando" &&
          vistaCargando(
            "Analizando el ticket con IA…\nPuede tardar hasta un minuto."
          )}
        {paso === "revision" && vistaRevision}
        {paso === "aplicando" && vistaCargando("Aplicando al inventario…")}
        {paso === "listo" && vistaListo}
        {selector}
        {selectorDepto}
        {ajustesEsc && (
          <ModalAjustesEscaner onCerrar={() => setAjustesEsc(false)} />
        )}
      </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Caja de aviso reutilizable (alerta ámbar / peligro rojo / éxito / info).
// ---------------------------------------------------------------------------
function AvisoCaja({
  T,
  tipo,
  children,
}: {
  T: Tema;
  tipo: "alerta" | "peligro" | "exito" | "info";
  children: ReactNode;
}) {
  const borde =
    tipo === "alerta"
      ? T.alerta
      : tipo === "peligro"
        ? T.peligro
        : tipo === "exito"
          ? T.exito
          : T.acento;
  const fondo =
    tipo === "alerta"
      ? T.alertaSuave
      : tipo === "peligro"
        ? T.peligroSuave
        : tipo === "exito"
          ? T.exitoSuave
          : T.acentoSuave;
  const texto =
    tipo === "alerta"
      ? T.alertaTexto
      : tipo === "peligro"
        ? T.peligroTexto
        : tipo === "exito"
          ? T.exitoTexto
          : T.esClaro
            ? T.texto
            : "#e4dbff";
  return (
    <View style={[ea.caja, { borderColor: borde, backgroundColor: fondo }]}>
      <Text style={[ea.txt, { color: texto }]}>{children}</Text>
    </View>
  );
}

const ea = StyleSheet.create({
  caja: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
    marginBottom: 10,
  },
  txt: { fontSize: 12.5, lineHeight: 18, fontWeight: "600" },
});

// ---------------------------------------------------------------------------
// Estilos (todo del tema dinámico)
// ---------------------------------------------------------------------------
function crearEstilos(T: Tema) {
  return StyleSheet.create({
    consentEnlaces: {
      flexDirection: "row",
      justifyContent: "center",
      gap: 22,
      marginTop: 18,
    },
    raiz: { flex: 1, backgroundColor: T.fondo },
    cuerpo: { padding: T.esp },
    // --- elegir ---
    explica: {
      color: T.textoSuave,
      fontSize: 14,
      lineHeight: 21,
      marginBottom: 18,
    },
    opcionesFoto: { flexDirection: "row", gap: 12, marginBottom: 18 },
    opcionFoto: {
      flex: 1,
      backgroundColor: T.superficie,
      borderWidth: 1,
      borderColor: T.borde,
      borderRadius: T.radio,
      paddingVertical: 26,
      alignItems: "center",
      gap: 10,
    },
    opcionFotoTxt: { color: T.texto, fontSize: 15, fontWeight: "800" },
    enlace: { alignSelf: "center", marginTop: 8, padding: 8 },
    enlaceTxt: { color: T.acento, fontSize: 14, fontWeight: "700" },
    enlaceMini: {
      color: T.acento,
      fontSize: 12.5,
      fontWeight: "700",
    },
    // --- previsualizar ---
    foto: {
      height: 330,
      borderRadius: T.radio,
      backgroundColor: T.superficie2,
      marginBottom: 14,
    },
    // --- cargando ---
    cargandoCaja: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      padding: 30,
    },
    cargandoTxt: {
      color: T.textoSuave,
      fontSize: 14,
      textAlign: "center",
      lineHeight: 21,
    },
    // --- cabecera del ticket ---
    ticketCab: { marginBottom: 14 },
    ticketProveedor: { color: T.texto, fontSize: 17, fontWeight: "800" },
    ticketMeta: { color: T.textoTenue, fontSize: 12.5, marginTop: 3 },
    verificacionTxt: {
      color: T.textoTenue,
      fontSize: 12,
      marginTop: -6,
      marginBottom: 12,
    },
    aprendizajeTxt: {
      color: T.textoTenue,
      fontSize: 12,
      lineHeight: 17,
      textAlign: "center",
      marginBottom: 14,
      paddingHorizontal: 8,
    },
    // --- tarjeta de línea ---
    tarjeta: {
      backgroundColor: T.superficie,
      borderWidth: 1,
      borderColor: T.borde,
      borderRadius: T.radio,
      padding: 14,
      marginBottom: 12,
    },
    prodNombre: { color: T.texto, fontSize: 16, fontWeight: "800" },
    nombreInput: { fontSize: 16, fontWeight: "800", paddingVertical: 9 },
    crudo: {
      color: T.textoTenue,
      fontSize: 11.5,
      marginTop: 5,
      fontStyle: "italic",
    },
    filaWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      marginTop: 10,
    },
    notaTxt: { color: T.alertaTexto, fontSize: 12, flexShrink: 1 },
    emparejeDudoso: {
      borderWidth: 1,
      borderColor: T.alerta,
      backgroundColor: T.alertaSuave,
      borderRadius: T.radioChico,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginTop: 12,
    },
    emparejeDudosoTxt: {
      color: T.alertaTexto,
      fontSize: 13,
      fontWeight: "700",
      lineHeight: 19,
    },
    filaBotones: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      marginTop: 10,
    },
    emparejeOk: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 10,
    },
    emparejeOkTxt: { color: T.exito, fontSize: 12.5, fontWeight: "800" },
    cambiarTxt: { color: T.acento, fontSize: 12.5, fontWeight: "700" },
    bloque: { marginTop: 12 },
    deptoFilaTxt: { color: T.textoSuave, fontSize: 13, fontWeight: "700" },
    deptoFilaValor: { color: T.texto, fontWeight: "800" },
    filaNums: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    numLabel: {
      color: T.textoSuave,
      fontSize: 13,
      fontWeight: "700",
      minWidth: 56,
    },
    numSigno: { color: T.textoTenue, fontSize: 14, fontWeight: "700" },
    numOp: { color: T.textoTenue, fontSize: 14, fontWeight: "700" },
    numIgual: { color: T.texto, fontSize: 14, fontWeight: "800" },
    numSufijo: { color: T.textoTenue, fontSize: 12, flex: 1 },
    inputNum: {
      width: 52,
      paddingVertical: 8,
      paddingHorizontal: 6,
      fontSize: 15,
      textAlign: "center",
    },
    inputNumDinero: {
      width: 88,
      paddingVertical: 8,
      paddingHorizontal: 6,
      fontSize: 15,
      textAlign: "center",
    },
    datoTenue: { color: T.textoTenue, fontSize: 12 },
    segmento: { flexDirection: "row", gap: 10 },
    segOpcion: {
      flex: 1,
      borderWidth: 1.5,
      borderColor: T.borde,
      borderRadius: T.radioChico,
      paddingVertical: 9,
      alignItems: "center",
      backgroundColor: T.superficie2,
    },
    segTxt: { color: T.texto, fontSize: 13.5, fontWeight: "800" },
    segSub: { color: T.textoTenue, fontSize: 11.5, marginTop: 2 },
    filaIncluir: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 14,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: T.borde,
    },
    incluirTxt: { color: T.textoSuave, fontSize: 13.5, fontWeight: "700" },
    // --- otras líneas ---
    otrasCaja: {
      borderWidth: 1,
      borderColor: T.borde,
      borderRadius: T.radio,
      backgroundColor: T.superficie,
      marginTop: 2,
      overflow: "hidden",
    },
    // --- avisos del ticket (colapsables cuando son varios) ---
    avisosTicketCaja: {
      borderWidth: 1,
      borderColor: T.borde,
      borderRadius: T.radio,
      backgroundColor: T.superficie,
      marginBottom: 12,
      overflow: "hidden",
    },
    avisosTicketCuerpo: {
      paddingHorizontal: 12,
      paddingTop: 4,
      borderTopWidth: 1,
      borderTopColor: T.borde,
    },
    otrasHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    otrasTitulo: { color: T.textoSuave, fontSize: 13, fontWeight: "700" },
    otrasFlecha: { color: T.textoTenue, fontSize: 13 },
    otraFila: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderTopWidth: 1,
      borderTopColor: T.borde,
    },
    otraNombre: { color: T.texto, fontSize: 13, fontWeight: "600" },
    otraMeta: { color: T.textoTenue, fontSize: 11.5, marginTop: 2 },
    // --- footer ---
    footer: {
      padding: T.esp,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: T.borde,
      backgroundColor: T.fondo,
    },
    footerResumen: {
      color: T.texto,
      fontSize: 14,
      fontWeight: "800",
      textAlign: "center",
      marginBottom: 4,
    },
    footerBloqueo: {
      color: T.alertaTexto,
      fontSize: 12,
      textAlign: "center",
      marginBottom: 2,
    },
    // --- listo ---
    listoCaja: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 30,
    },
    listoCirculo: {
      width: 74,
      height: 74,
      borderRadius: 37,
      borderWidth: 2,
      borderColor: T.exito,
      backgroundColor: T.exitoSuave,
      alignItems: "center",
      justifyContent: "center",
    },
    listoPalomita: { color: T.exito, fontSize: 34, fontWeight: "900" },
    listoTitulo: {
      color: T.texto,
      fontSize: 21,
      fontWeight: "900",
      marginTop: 18,
    },
    listoResumen: {
      color: T.textoSuave,
      fontSize: 14,
      marginTop: 8,
      textAlign: "center",
    },
    // --- selector ---
    selectorCuerpo: { flex: 1, padding: T.esp },
    selectorCrudo: {
      color: T.textoTenue,
      fontSize: 12,
      fontStyle: "italic",
      marginBottom: 10,
    },
    selectorNuevo: {
      borderWidth: 1.5,
      borderColor: T.acento,
      borderRadius: T.radioChico,
      paddingVertical: 12,
      alignItems: "center",
      marginBottom: 8,
    },
    selectorNuevoTxt: { color: T.acento, fontSize: 14, fontWeight: "800" },
    selectorFila: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 6,
      borderBottomWidth: 1,
      borderBottomColor: T.borde,
      borderRadius: 6,
    },
    selectorFilaTxt: {
      color: T.texto,
      fontSize: 14.5,
      fontWeight: "700",
      flexShrink: 1,
    },
    selectorFilaMeta: { color: T.textoTenue, fontSize: 12 },
    selectorCheck: { color: T.exito, fontSize: 15, fontWeight: "900" },
    selectorFilaDer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    selectorVacio: {
      color: T.textoTenue,
      fontSize: 13,
      textAlign: "center",
      marginTop: 18,
    },
  });
}
