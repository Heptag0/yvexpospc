// YvexPOS Móvil — Etiquetado frontal NOM-051 (México).
//
// Puerto de src/util/sellos.js del PC: mismas reglas, mismos umbrales, mismos
// resultados. Verificado contra el texto ÍNTEGRO de la norma:
//   · NOM-051-SCFI/SSA1-2010, DOF 27/03/2020 (con Apéndice A Normativo)
//   · Acuerdo DOF 31/07/2025 (fases)
//
// FASES: Fase 2 vigente hasta el 31/dic/2027; Fase 3 desde el 1/ene/2028.
// En Fase 2 solo se evalúan los sellos ligados al nutrimento AÑADIDO; en
// Fase 3 se evalúan los cinco. Los umbrales no cambian entre fases.
//
// ADEMÁS DEL PC, este módulo trae el motor de SUGERENCIAS: calcula cuánto
// exactamente hay que bajar de cada ingrediente para perder cada sello,
// tomando en cuenta que quitar azúcar o grasa TAMBIÉN baja las calorías.

export const FECHA_VERIFICACION = "31 de julio de 2026";
export const FUENTE_OFICIAL =
  "NOM-051-SCFI/SSA1-2010 (DOF 27/03/2020, texto íntegro con Apéndice A) · Acuerdo DOF 31/07/2025";

export function faseVigente(fecha: Date = new Date()): 2 | 3 {
  return fecha >= new Date("2028-01-01") ? 3 : 2;
}

// Factores de conversión energética del numeral 5.1.1.
const KCAL_G_AZUCAR = 4;
const KCAL_G_GRASA = 9;

export type Tipo = "solido" | "liquido";

export type DatosNutrimentales = {
  tipo: Tipo;
  caloriasKcal: number;
  azucaresG: number;
  grasasSaturadasG: number;
  grasasTransG: number;
  sodioMg: number;
  anadeAzucares: boolean;
  anadeGrasas: boolean;
  anadeSodio: boolean;
  contieneCafeina: boolean;
  contieneEdulcorantes: boolean;
  exencion: string;
  areaCm2: number;
};

export type Sello = { id: string; etiqueta: string; razon: string };
export type Leyenda = { id: string; etiqueta: string; razon: string };

export type Resultado = {
  sellos: Sello[];
  leyendas: Leyenda[];
  fase: 2 | 3;
  motivo: "exento" | "sin_anadidos" | "sin_exceso" | "con_sellos";
  explicacion?: string;
};

// ───────────────────────────────────────────────────────────────────────────
// Productos exentos (numeral 4.5.3.3)
// ───────────────────────────────────────────────────────────────────────────

export const EXENCIONES = [
  { id: "ninguna", n: "Ninguna — sí está sujeto a la norma", exento: false, ref: "" },
  { id: "basicos", n: "Aceite, grasa, azúcar, miel, sal yodada o harina", exento: true, ref: "4.5.3.3 d" },
  { id: "un_ingrediente", n: "Un solo ingrediente, sin aditivos", exento: true, ref: "4.5.2.3 i" },
  { id: "especias", n: "Hierbas o especias", exento: true, ref: "4.5.2.3 ii" },
  { id: "cafe", n: "Café en grano o molido, sin añadidos", exento: true, ref: "4.5.2.3 iii" },
  { id: "te", n: "Té o infusiones, sin añadidos", exento: true, ref: "4.5.2.3 iv" },
  { id: "vinagre", n: "Vinagres fermentados", exento: true, ref: "4.5.2.3 v" },
  { id: "agua", n: "Agua para consumo humano o mineral", exento: true, ref: "4.5.2.3 vi" },
  { id: "lactantes", n: "Fórmulas o alimentos para lactantes", exento: true, ref: "4.5.3.3 b y c" },
];

export function esExento(id: string): boolean {
  const e = EXENCIONES.find((x) => x.id === id);
  return !!(e && e.exento);
}

// ───────────────────────────────────────────────────────────────────────────
// Cálculo de sellos
// ───────────────────────────────────────────────────────────────────────────

export function calcularSellos(d: DatosNutrimentales, fase?: 2 | 3): Resultado {
  const f = fase ?? faseVigente();

  if (esExento(d.exencion)) {
    const e = EXENCIONES.find((x) => x.id === d.exencion)!;
    return {
      sellos: [], leyendas: [], fase: f, motivo: "exento",
      explicacion: `Los productos de este tipo están exceptuados del etiquetado frontal (numeral ${e.ref}). No llevan sellos ni leyendas, sin importar sus valores.`,
    };
  }

  const liquido = d.tipo === "liquido";
  const cal = Math.max(0, d.caloriasKcal);
  const kcalAz = Math.max(0, d.azucaresG) * KCAL_G_AZUCAR;
  const kcalGs = Math.max(0, d.grasasSaturadasG) * KCAL_G_GRASA;
  const kcalGt = Math.max(0, d.grasasTransG) * KCAL_G_GRASA;
  const sodio = Math.max(0, d.sodioMg);

  // Las leyendas NO dependen de lo añadido: aplican por la sola presencia de
  // cafeína adicionada (7.1.4) o edulcorantes en los ingredientes (7.1.3).
  const leyendas: Leyenda[] = [];
  if (d.contieneCafeina) {
    leyendas.push({ id: "cafeina", etiqueta: "CONTIENE CAFEÍNA EVITAR EN NIÑOS",
      razon: "Por cafeína adicionada, en cualquier cantidad (7.1.4)." });
  }
  if (d.contieneEdulcorantes) {
    leyendas.push({ id: "edulcorantes", etiqueta: "CONTIENE EDULCORANTES, NO RECOMENDABLE EN NIÑOS",
      razon: "Porque la lista de ingredientes incluye edulcorantes (7.1.3)." });
  }

  if (!(d.anadeAzucares || d.anadeGrasas || d.anadeSodio)) {
    return {
      sellos: [], leyendas, fase: f, motivo: "sin_anadidos",
      explicacion: "Los sellos solo aplican a productos con nutrimentos críticos AÑADIDOS (4.5.3). Un producto naturalmente alto en azúcar o sodio, al que no se le agregó nada, no lleva sellos.",
    };
  }

  const ev = f >= 3
    ? { calorias: true, azucares: true, grasasSat: true, grasasTrans: true, sodio: true }
    : {
        calorias: d.anadeAzucares || d.anadeGrasas,
        azucares: d.anadeAzucares,
        grasasSat: d.anadeGrasas,
        grasasTrans: d.anadeGrasas,
        sodio: d.anadeSodio,
      };

  const sellos: Sello[] = [];

  if (ev.calorias) {
    if (!liquido && cal >= 275) {
      sellos.push({ id: "calorias", etiqueta: "EXCESO CALORÍAS",
        razon: `${cal.toFixed(0)} kcal por 100 g (límite: 275)` });
    } else if (liquido && (cal >= 70 || kcalAz >= 8)) {
      sellos.push({ id: "calorias", etiqueta: "EXCESO CALORÍAS",
        razon: cal >= 70 ? `${cal.toFixed(0)} kcal por 100 ml (límite: 70)`
                         : `${kcalAz.toFixed(1)} kcal de azúcares por 100 ml (límite: 8)` });
    }
  }

  if (cal > 0) {
    if (ev.azucares) {
      const pct = (kcalAz / cal) * 100;
      if (pct >= 10) sellos.push({ id: "azucares", etiqueta: "EXCESO AZÚCARES",
        razon: `${pct.toFixed(0)}% de la energía viene de azúcares (límite: 10%)` });
    }
    if (ev.grasasSat) {
      const pct = (kcalGs / cal) * 100;
      if (pct >= 10) sellos.push({ id: "grasas_sat", etiqueta: "EXCESO GRASAS SATURADAS",
        razon: `${pct.toFixed(0)}% de la energía viene de grasas saturadas (límite: 10%)` });
    }
    if (ev.grasasTrans) {
      const pct = (kcalGt / cal) * 100;
      if (pct >= 1) sellos.push({ id: "grasas_trans", etiqueta: "EXCESO GRASAS TRANS",
        razon: `${pct.toFixed(1)}% de la energía viene de grasas trans (límite: 1%)` });
    }
  }

  // Tabla 6: los 45 mg son SOLO para bebidas sin calorías; el resto va por
  // "≥1 mg de sodio por kcal o ≥300 mg".
  if (ev.sodio) {
    const sinCalorias = liquido && cal < 5;
    if (sinCalorias) {
      if (sodio >= 45) sellos.push({ id: "sodio", etiqueta: "EXCESO SODIO",
        razon: `${sodio.toFixed(0)} mg por 100 ml (límite para bebidas sin calorías: 45)` });
    } else if (sodio >= 300) {
      sellos.push({ id: "sodio", etiqueta: "EXCESO SODIO",
        razon: `${sodio.toFixed(0)} mg por 100 ${liquido ? "ml" : "g"} (límite: 300)` });
    } else if (cal > 0 && sodio / cal >= 1) {
      sellos.push({ id: "sodio", etiqueta: "EXCESO SODIO",
        razon: `${(sodio / cal).toFixed(2)} mg de sodio por kcal (límite: 1)` });
    }
  }

  const ORDEN = ["calorias", "azucares", "grasas_sat", "grasas_trans", "sodio"];
  sellos.sort((a, b) => ORDEN.indexOf(a.id) - ORDEN.indexOf(b.id));

  return { sellos, leyendas, fase: f, motivo: sellos.length ? "con_sellos" : "sin_exceso" };
}

export function compararFases(d: DatosNutrimentales) {
  const hoy = calcularSellos(d, 2);
  const futuro = calcularSellos(d, 3);
  const ids = new Set(hoy.sellos.map((s) => s.id));
  return { hoy, futuro, nuevos: futuro.sellos.filter((s) => !ids.has(s.id)) };
}

// ───────────────────────────────────────────────────────────────────────────
// MOTOR DE SUGERENCIAS — "¿cómo le quito este sello?"
// ───────────────────────────────────────────────────────────────────────────
//
// Como los umbrales son fórmulas, se puede calcular EXACTAMENTE cuánto hay
// que bajar de cada ingrediente. Y hay un detalle que no se puede ignorar:
// quitar azúcar o grasa TAMBIÉN baja las calorías, así que numerador y
// denominador se mueven juntos.
//
// Ejemplo con azúcares (límite: 10% de la energía). Si quitas Δ gramos:
//     4(azúcar − Δ) / (calorías − 4Δ) < 0.10
//   → 4·azúcar − 0.1·calorías < 3.6Δ
//   → Δ > (4·azúcar − 0.1·calorías) / 3.6
//
// Sin esa corrección, una calculadora ingenua pediría quitar de más. Aquí se
// resuelve la ecuación de verdad, y de paso se avisa cuando un solo ajuste
// tumba dos sellos (porque las calorías también bajan).

export type Sugerencia = {
  selloId: string;
  etiqueta: string;
  /** ¿Se puede lograr bajando este ingrediente? */
  viable: boolean;
  /** Qué hacer, en lenguaje llano. */
  accion: string;
  /** Cuánto hay que quitar y de qué (para la barra de progreso). */
  actual: number;
  objetivo: number;
  unidad: string;
  /** Efecto colateral: qué más mejora si haces esto. */
  bonus?: string;
  nota?: string;
};

const MARGEN = 1.02; // 2% de holgura: quedar justo en el límite es arriesgado

function fmt(n: number, dec = 1): string {
  return n.toFixed(dec).replace(/\.0$/, "");
}

/**
 * Para cada sello, calcula qué haría falta para perderlo.
 * Devuelve también un resumen de si el producto podría quedar limpio.
 */
export function sugerenciasParaQuitarSellos(d: DatosNutrimentales): {
  sugerencias: Sugerencia[];
  quedariaLimpio: boolean;
  /** Los valores finales tras resolver el acoplamiento entre sellos. */
  objetivoFinal: DatosNutrimentales;
  leyendasFijas: Leyenda[];
} {
  const r = calcularSellos(d);
  const liquido = d.tipo === "liquido";
  const cal = Math.max(0, d.caloriasKcal);
  const az = Math.max(0, d.azucaresG);
  const gs = Math.max(0, d.grasasSaturadasG);
  const gt = Math.max(0, d.grasasTransG);
  const sodio = Math.max(0, d.sodioMg);
  const sug: Sugerencia[] = [];

  for (const s of r.sellos) {
    if (s.id === "azucares") {
      // Δ > (4·az − 0.1·cal) / 3.6, contando que las calorías también bajan.
      const delta = Math.max(0, ((KCAL_G_AZUCAR * az - 0.1 * cal) / 3.6) * MARGEN);
      const objetivo = az - delta;
      // Si el objetivo sale negativo o casi cero, el producto ES azúcar en
      // esencia (una mermelada, un dulce) y no hay ajuste que lo salve.
      // Decirlo claro vale más que dar un número imposible.
      if (objetivo <= 0.3) {
        sug.push({
          selloId: s.id, etiqueta: s.etiqueta, viable: false,
          accion: "Este sello no se puede quitar solo bajando el azúcar",
          actual: az, objetivo: 0, unidad: "g",
          nota: `Casi toda la energía de tu producto viene del azúcar (${((KCAL_G_AZUCAR * az / cal) * 100).toFixed(0)}%). Para bajar del 10% tendrías que quitarle prácticamente todo, y sería otro producto. Es normal en dulces, mermeladas y jarabes: llevan el sello y no pasa nada — solo hay que ponerlo.`,
        });
      } else {
        const calNueva = cal - delta * KCAL_G_AZUCAR;
        const tieneSelloCal = r.sellos.some((x) => x.id === "calorias");
        const quitaCal = tieneSelloCal && !liquido && calNueva < 275;
        sug.push({
          selloId: s.id, etiqueta: s.etiqueta, viable: true,
          accion: `Baja el azúcar de ${fmt(az)} g a ${fmt(objetivo)} g por cada 100 ${liquido ? "ml" : "g"}`,
          actual: az, objetivo, unidad: "g",
          bonus: quitaCal
            ? `Además pierdes el sello de calorías: al quitar ${fmt(delta)} g de azúcar, bajas ${fmt(delta * KCAL_G_AZUCAR, 0)} kcal y quedas en ${fmt(calNueva, 0)}.`
            : `Al quitar ${fmt(delta)} g de azúcar bajas ${fmt(delta * KCAL_G_AZUCAR, 0)} kcal (de ${fmt(cal, 0)} a ${fmt(calNueva, 0)}).`,
        });
      }
    }

    if (s.id === "grasas_sat") {
      const delta = Math.max(0, ((KCAL_G_GRASA * gs - 0.1 * cal) / 8.1) * MARGEN);
      const objetivo = gs - delta;
      if (objetivo <= 0.2) {
        sug.push({
          selloId: s.id, etiqueta: s.etiqueta, viable: false,
          accion: "Este sello no se puede quitar solo bajando la grasa saturada",
          actual: gs, objetivo: 0, unidad: "g",
          nota: "Casi toda la energía de tu producto viene de grasa saturada. Cambiar mantequilla o manteca por aceite vegetal sí puede ayudar: baja las saturadas sin quitar grasa total.",
        });
      } else {
        const calNueva = cal - delta * KCAL_G_GRASA;
        const tieneSelloCal = r.sellos.some((x) => x.id === "calorias");
        const quitaCal = tieneSelloCal && !liquido && calNueva < 275;
        sug.push({
          selloId: s.id, etiqueta: s.etiqueta, viable: true,
          accion: `Baja las grasas saturadas de ${fmt(gs)} g a ${fmt(objetivo)} g por cada 100 ${liquido ? "ml" : "g"}`,
          actual: gs, objetivo, unidad: "g",
          bonus: quitaCal
            ? `Además pierdes el sello de calorías: quitar ${fmt(delta)} g de grasa baja ${fmt(delta * KCAL_G_GRASA, 0)} kcal y te deja en ${fmt(calNueva, 0)}.`
            : `Al quitar ${fmt(delta)} g de grasa saturada bajas ${fmt(delta * KCAL_G_GRASA, 0)} kcal.`,
          nota: "Cambiar mantequilla o manteca por aceite vegetal baja las saturadas sin quitar grasa total.",
        });
      }
    }

    if (s.id === "grasas_trans") {
      const delta = Math.max(0, ((KCAL_G_GRASA * gt - 0.01 * cal) / 8.91) * MARGEN);
      const objetivo = Math.max(0, gt - delta);
      sug.push({
        selloId: s.id, etiqueta: s.etiqueta, viable: true,
        accion: `Baja las grasas trans de ${fmt(gt, 2)} g a ${fmt(objetivo, 2)} g por cada 100 ${liquido ? "ml" : "g"}`,
        actual: gt, objetivo, unidad: "g",
        nota: "Las grasas trans vienen sobre todo de grasas parcialmente hidrogenadas (margarina industrial, manteca vegetal). Cambiarlas por aceite o mantequilla suele eliminarlas casi por completo.",
      });
    }

    if (s.id === "sodio") {
      const sinCalorias = liquido && cal < 5;
      let objetivo: number;
      let explica: string;
      if (sinCalorias) {
        objetivo = 45 / MARGEN;
        explica = "Para bebidas sin calorías el límite es 45 mg.";
      } else {
        // Hay que quedar por debajo de AMBOS: 300 mg y 1 mg por kcal.
        const porKcal = cal > 0 ? cal : Infinity;
        objetivo = Math.min(300, porKcal) / MARGEN;
        explica = cal > 0 && porKcal < 300
          ? `Con ${fmt(cal, 0)} kcal, el sodio no puede llegar a ${fmt(cal, 0)} mg (regla de 1 mg por kcal).`
          : "El límite general es 300 mg.";
      }
      sug.push({
        selloId: s.id, etiqueta: s.etiqueta, viable: true,
        accion: `Baja el sodio de ${fmt(sodio, 0)} mg a ${fmt(objetivo, 0)} mg por cada 100 ${liquido ? "ml" : "g"}`,
        actual: sodio, objetivo, unidad: "mg",
        nota: `${explica} Una cucharadita de sal aporta unos 2,300 mg de sodio: bajarle tantito rinde mucho.`,
      });
    }

    if (s.id === "calorias") {
      // Solo se sugiere directo si no hay otro sello que ya lo resuelva —
      // cuando hay azúcar o grasa de por medio, bajarlos ya tumba este.
      const yaCubierto = r.sellos.some((x) => x.id === "azucares" || x.id === "grasas_sat");
      if (!yaCubierto) {
        if (!liquido) {
          const objetivo = 275 / MARGEN;
          const bajar = cal - objetivo;
          sug.push({
            selloId: s.id, etiqueta: s.etiqueta, viable: true,
            accion: `Baja de ${fmt(cal, 0)} a ${fmt(objetivo, 0)} kcal por cada 100 g`,
            actual: cal, objetivo, unidad: "kcal",
            nota: `Son ${fmt(bajar, 0)} kcal menos: equivalen a quitar ${fmt(bajar / KCAL_G_AZUCAR)} g de azúcar o ${fmt(bajar / KCAL_G_GRASA)} g de grasa.`,
          });
        } else {
          const porAzucar = KCAL_G_AZUCAR * az >= 8;
          if (porAzucar) {
            const objetivo = 2 / MARGEN; // 8 kcal ÷ 4 kcal/g
            sug.push({
              selloId: s.id, etiqueta: s.etiqueta, viable: true,
              accion: `Baja el azúcar de ${fmt(az)} g a menos de ${fmt(objetivo)} g por cada 100 ml`,
              actual: az, objetivo, unidad: "g",
              nota: "En bebidas el límite es más estricto: bastan 8 kcal provenientes de azúcares (2 g) para llevar el sello.",
            });
          } else {
            const objetivo = 70 / MARGEN;
            sug.push({
              selloId: s.id, etiqueta: s.etiqueta, viable: true,
              accion: `Baja de ${fmt(cal, 0)} a ${fmt(objetivo, 0)} kcal por cada 100 ml`,
              actual: cal, objetivo, unidad: "kcal",
            });
          }
        }
      }
    }
  }

  // ¿Quedaría sin sellos si aplica todo?
  //
  // Ojo: los ajustes están ACOPLADOS. Bajar azúcar reduce las calorías, y al
  // bajar las calorías sube el porcentaje que representan las grasas (mismo
  // gramaje, menos energía total). Así que aplicar las tres sugerencias de un
  // jalón puede dejar sellos que antes no estaban.
  //
  // Se resuelve iterando: se aplican los ajustes, se recalcula, y si aún
  // quedan sellos se vuelve a ajustar sobre los valores nuevos. Converge en
  // pocas vueltas porque cada iteración reduce los excesos.
  const ajustado = resolverIterando(d);
  const final = calcularSellos(ajustado);
  const limpio = final.sellos.length === 0;

  // Las metas que se muestran deben ser las RESUELTAS, no las del primer
  // paso: si se aplican por separado, el acoplamiento entre sellos hace que
  // no funcionen juntas. Solo se corrigen cuando el producto sí puede quedar
  // limpio (si no, la meta del primer paso ya es la información útil).
  if (limpio) {
    for (const s of sug) {
      if (!s.viable) continue;
      if (s.selloId === "azucares" && s.unidad === "g") s.objetivo = ajustado.azucaresG;
      if (s.selloId === "grasas_sat") s.objetivo = ajustado.grasasSaturadasG;
      if (s.selloId === "grasas_trans") s.objetivo = ajustado.grasasTransG;
      if (s.selloId === "sodio") s.objetivo = ajustado.sodioMg;
      if (s.selloId === "calorias" && s.unidad === "kcal") s.objetivo = ajustado.caloriasKcal;
      // El texto de la acción se rehace con la meta corregida.
      const u = s.unidad;
      const dec = u === "mg" || u === "kcal" ? 0 : 1;
      const nombre = s.selloId === "azucares" ? "el azúcar"
        : s.selloId === "grasas_sat" ? "las grasas saturadas"
        : s.selloId === "grasas_trans" ? "las grasas trans"
        : s.selloId === "sodio" ? "el sodio" : "las calorías";
      s.accion = `Baja ${nombre} de ${fmt(s.actual, dec)} a ${fmt(s.objetivo, dec)} ${u} por cada 100 ${d.tipo === "liquido" ? "ml" : "g"}`;
    }
  }

  return {
    sugerencias: sug,
    quedariaLimpio: limpio,
    objetivoFinal: ajustado,
    leyendasFijas: r.leyendas,
  };
}

/**
 * Encuentra un juego de valores que no lleve sellos, ajustando poco a poco.
 * Devuelve los datos ya ajustados (o los últimos alcanzados si no converge:
 * hay productos que no pueden quedar limpios, como una mermelada).
 */
function resolverIterando(d: DatosNutrimentales, vueltas = 12): DatosNutrimentales {
  let act: DatosNutrimentales = { ...d };

  for (let i = 0; i < vueltas; i++) {
    const r = calcularSellos(act);
    if (r.sellos.length === 0) return act;

    const cal = act.caloriasKcal;
    let cambio = false;

    for (const s of r.sellos) {
      if (s.id === "azucares") {
        const delta = Math.max(0, ((KCAL_G_AZUCAR * act.azucaresG - 0.1 * cal) / 3.6) * MARGEN);
        const nuevo = act.azucaresG - delta;
        if (nuevo < 0) return act; // imposible: el producto ES azúcar
        act.caloriasKcal = Math.max(0, act.caloriasKcal - delta * KCAL_G_AZUCAR);
        act.azucaresG = nuevo;
        cambio = true;
      }
      if (s.id === "grasas_sat") {
        const delta = Math.max(0, ((KCAL_G_GRASA * act.grasasSaturadasG - 0.1 * cal) / 8.1) * MARGEN);
        const nuevo = act.grasasSaturadasG - delta;
        if (nuevo < 0) return act;
        act.caloriasKcal = Math.max(0, act.caloriasKcal - delta * KCAL_G_GRASA);
        act.grasasSaturadasG = nuevo;
        cambio = true;
      }
      if (s.id === "grasas_trans") {
        const delta = Math.max(0, ((KCAL_G_GRASA * act.grasasTransG - 0.01 * cal) / 8.91) * MARGEN);
        const nuevo = act.grasasTransG - delta;
        if (nuevo < 0) return act;
        act.caloriasKcal = Math.max(0, act.caloriasKcal - delta * KCAL_G_GRASA);
        act.grasasTransG = nuevo;
        cambio = true;
      }
      if (s.id === "sodio") {
        const liq = act.tipo === "liquido";
        const sinCal = liq && act.caloriasKcal < 5;
        const objetivo = sinCal ? 45 / MARGEN
          : Math.min(300, act.caloriasKcal > 0 ? act.caloriasKcal : Infinity) / MARGEN;
        if (act.sodioMg > objetivo) { act.sodioMg = objetivo; cambio = true; }
      }
      if (s.id === "calorias") {
        // Solo si no hay otro sello que ya vaya a bajar las calorías.
        const otro = r.sellos.some((x) => x.id === "azucares" || x.id === "grasas_sat");
        if (!otro) {
          const limite = act.tipo === "liquido" ? 70 : 275;
          if (act.caloriasKcal >= limite) { act.caloriasKcal = limite / MARGEN; cambio = true; }
        }
      }
    }
    if (!cambio) return act; // no se pudo mover nada más
  }
  return act;
}

// ───────────────────────────────────────────────────────────────────────────
// Tamaño del sello — Tabla A1 del Apéndice A
// ───────────────────────────────────────────────────────────────────────────

const TABLA_A1 = [
  { hasta: 5, ancho: null as number | null, alto: null as number | null,
    nota: "Al menos el 15% de la superficie principal" },
  { hasta: 30, ancho: 1.0, alto: 1.11, nota: null },
  { hasta: 40, ancho: 1.5, alto: 1.66, nota: null },
  { hasta: 60, ancho: 1.5, alto: 1.66, nota: null },
  { hasta: 100, ancho: 2.0, alto: 2.22, nota: null },
  { hasta: 200, ancho: 2.5, alto: 2.77, nota: null },
  { hasta: 300, ancho: 3.0, alto: 3.32, nota: null },
  { hasta: Infinity, ancho: 3.5, alto: 3.88, nota: null },
];

export function reglasImpresion(areaCm2: number, numSellos: number) {
  const area = Number(areaCm2) > 0 ? Number(areaCm2) : null;
  if (!area) {
    return { conocida: false, usaNumero: false, area: 0, ancho: null, alto: null,
      nota: "Captura el área de la cara principal del envase para saber el tamaño exacto del sello.",
      ubicacion: "", leyendaSinRecuadro: false };
  }
  const fila = TABLA_A1.find((f) => area <= f.hasta)!;
  return {
    conocida: true,
    area,
    // 4.5.3.4.2: envases ≤40 cm² llevan UN sello con el número, no los individuales.
    usaNumero: area <= 40 && numSellos > 0,
    ancho: fila.ancho,
    alto: fila.alto,
    nota: fila.nota,
    ubicacion: area < 60
      ? "En cualquier parte de la cara principal (por ser menor a 60 cm²)."
      : "En la esquina superior derecha de la cara principal.",
    leyendaSinRecuadro: area <= 20,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Checklist de la etiqueta completa
// ───────────────────────────────────────────────────────────────────────────

export const CHECKLIST_ETIQUETA = [
  { id: "denominacion", n: "Denominación del producto", ref: "4.2.1",
    ayuda: "Lo que ES, no la marca. Va en negritas en la cara principal." },
  { id: "ingredientes", n: "Lista de ingredientes", ref: "4.2.2",
    ayuda: "De mayor a menor cantidad." },
  { id: "alergenos", n: "Declaración de alérgenos", ref: "4.2.2.2.3",
    ayuda: "Al final de la lista, en negritas, con la palabra «Contiene»." },
  { id: "contenido", n: "Contenido neto", ref: "NOM-030", ayuda: "En g o ml." },
  { id: "responsable", n: "Nombre y domicilio del responsable", ref: "4.2.4.1",
    ayuda: "Calle, número, código postal y estado." },
  { id: "lote", n: "Identificación del lote", ref: "3.32", ayuda: "En cualquier parte del envase." },
  { id: "caducidad", n: "Fecha de caducidad", ref: "3.20", ayuda: "En cualquier parte del envase." },
  { id: "origen", n: "País de origen", ref: "4.2", ayuda: "«Hecho en México» o el que corresponda." },
  { id: "nutrimental", n: "Declaración nutrimental", ref: "4.5.2",
    ayuda: "Por 100 g/ml y por envase. Letra de al menos 1.5 mm." },
  { id: "conservacion", n: "Instrucciones de conservación", ref: "4.3",
    ayuda: "Si el producto las necesita." },
];

// ───────────────────────────────────────────────────────────────────────────
// Trámites (numeral 9: la evaluación "no es certificable")
// ───────────────────────────────────────────────────────────────────────────

export const TRAMITES = [
  { id: "aviso", n: "Aviso de Funcionamiento (COFEPRIS)", quien: "Tú, en línea y gratis",
    detalle: "Es sobre tu establecimiento, no sobre la etiqueta. Los alimentos preenvasados NO requieren registro sanitario individual." },
  { id: "constancia", n: "Constancia de Conformidad (opcional)", quien: "Unidad de Verificación acreditada (de paga)",
    detalle: "La norma dice que su evaluación «no es certificable» y es voluntaria. No la necesitas para vender por tu cuenta, pero sí te la piden cadenas y aduanas." },
  { id: "analisis", n: "Análisis de laboratorio", quien: "Laboratorio acreditado",
    detalle: "La norma pide que los valores de tu etiqueta vengan de análisis o tablas reconocidas (4.5.2.4.15). Esta calculadora usa los números que TÚ capturas." },
  { id: "vigilancia", n: "Quién te puede inspeccionar", quien: "PROFECO y COFEPRIS",
    detalle: "No hay aprobación previa de tu sello: etiquetas bajo tu responsabilidad y ellos verifican después (numeral 8)." },
];