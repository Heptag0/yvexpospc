// YvexPOS — Indicadores de negocio para Yaxo.
//
// ===========================================================================
// QUÉ HACE ESTE ARCHIVO Y POR QUÉ NO ESTÁ EN reportes.ts
// ===========================================================================
// reportes.ts responde QUÉ PASÓ: cuánto vendiste, qué se vendió más, cuánto
// ganaste. Son cifras que ya se ven en una pantalla.
//
// Esto responde QUÉ SIGNIFICA. Y lo hace CRUZANDO cosas que en la app viven
// separadas: la velocidad de venta está en Reportes y el stock en Inventario,
// y nadie los mira juntos. Un producto que se vende bien y del que quedan dos
// días de existencia no aparece en ninguna pantalla, porque hace falta mirar
// las dos a la vez.
//
// ===========================================================================
// DEVUELVEN EL RAZONAMIENTO, NO LA CONCLUSIÓN
// ===========================================================================
// Un dueño de tienda YA SABE, más o menos, qué vende y qué tiene que resurtir.
// Una lista de "resurte esto" no le enseña nada: le repite lo que ya intuye, y
// encima el aviso de stock mínimo ya existe.
//
// Lo que no sabe es el NÚMERO exacto ni de dónde sale. Por eso cada indicador
// devuelve las piezas del cálculo —unidades por día, días observados, días de
// existencia que quedan— y no solo el veredicto. Yaxo explica: "vendes 12 al
// día, te quedan 26, eso es martes". Ahí el dueño aprende algo sobre su propio
// negocio, que es el trabajo del asistente.
//
// Si algún día esto se convierte en una pantalla, seguirá sirviendo: las
// piezas también se pintan.
//
// ===========================================================================
// LOS UMBRALES SON DECISIONES DE NEGOCIO, NO TÉCNICAS
// ===========================================================================
// Todas las constantes de abajo están puestas a ojo por quien escribió el
// archivo, no medidas con datos reales. Cuántos días sin venta hacen que algo
// esté "parado" depende del giro: en una tienda de ropa 30 días es normal, en
// una abarrotería es un problema. REVISARLAS con negocios de verdad antes de
// que Yaxo dé consejos basados en ellas.
//
// ===========================================================================
// SOBRE EL SQL
// ===========================================================================
// Aquí SÍ hay SQL, a diferencia de yaxoHechos.ts, y no es contradicción: estas
// consultas no existen en ninguna otra parte, así que no pueden contradecir a
// nada. La regla que sigue en pie es que "cuánto vendí" se pregunta a
// reportes.ts, porque allí ya está resuelto.
//
// Tres cosas que toda consulta de este archivo respeta, y que son los errores
// que más fácil se cometen:
//   1. `v.estado <> 'cancelada'` — una venta cancelada no existió.
//   2. Restar `devolucion_lineas` — si se vendieron 10 y devolvieron 4, el
//      ritmo real es 6. Sin esta resta, Yaxo recomienda resurtir algo que la
//      gente está devolviendo.
//   3. `p.eliminado = 0 AND p.activo = 1 AND p.es_kit = 0` — no hablar de
//      productos dados de baja, ni de KITS: un kit no tiene stock propio, lo
//      toma de sus componentes, así que "te quedan 3" sería un número
//      inventado. inventario.rs del PC ya los excluía; aquí faltaba.
//   4. `julianday()` para comparar fechas, NUNCA texto. En `creado_en`
//      conviven TRES formatos —el PC escribió nanosegundos con "+00:00", el
//      móvil escribe milisegundos con "Z" y el servidor microsegundos con "Z"—
//      y este teléfono baja ventas del PC por sync, así que los tiene los tres
//      mezclados. Comparar cadenas de formatos distintos ordena bien por
//      casualidad mientras todo esté en UTC y se rompe en cuanto no lo esté.
//      julianday() entiende los tres y compara instantes de verdad. Es la misma
//      corrección que reportes.rs ya aplicó en el PC.
//
//      ⚠️ reportes.ts del móvil TODAVÍA compara por texto (ver sus WHERE
//      creado_en >= ?). No se toca desde aquí porque es cambio suyo, pero
//      conviene migrarlo: hoy funciona porque todo se guarda en UTC.
//
// PORTABILIDAD AL PC: las consultas NO se copian tal cual. El móvil usa
// `venta_lineas.nombre_producto` y el PC `venta_lineas.descripcion`; el PC
// tiene `ventas.usuario_pos_id` y el móvil no. Al portar a indicadores.rs hay
// que ajustar esos nombres — la lógica es idéntica, los nombres no.

import { bd } from "./db";
import { leerVarias, leerConfig, guardarConfig } from "./config";
import { guardarConfigCompartida } from "./sync";

// ---------------------------------------------------------------------------
// Umbrales. Revisar con datos reales (ver cabecera).
// ---------------------------------------------------------------------------

/** Ventana para medir el ritmo de venta. Dos semanas capturan el ciclo
 *  semanal completo (un negocio vende distinto en sábado que en martes) sin
 *  arrastrar temporadas viejas. */
export const DIAS_VENTANA_RITMO = 14;

/** Por debajo de esto, el ritmo no se afirma. Un producto vendido dos veces en
 *  catorce días no tiene "ritmo": tiene dos ventas. */
export const VENTAS_MINIMAS_PARA_RITMO = 3;

/** Días de existencia por debajo de los cuales conviene avisar. */
export const DIAS_COBERTURA_ALERTA = 7;

/** Sin vender en este plazo, con stock encima, es dinero parado. */
export const DIAS_SIN_VENTA_PARADO = 30;

/** Piso de dinero inmovilizado para mencionar un producto parado. Sin esto, la
 *  lista se llena de artículos de $8 que no le importan a nadie. */
export const CENTAVOS_MINIMOS_PARADO = 20000; // $200

// ---------------------------------------------------------------------------
// UMBRALES CONFIGURABLES POR EL DUEÑO
// ---------------------------------------------------------------------------
//
// Las constantes de arriba dejan de ser la última palabra: pasan a ser el
// VALOR POR DEFECTO. El dueño puede cambiarlos hablando con Yaxo.
//
// POR QUÉ SE AJUSTAN Y NO SE "CALIBRAN"
// Se pusieron a ojo pensando en una tiendita. En una ferretería, un producto
// que tarda dos meses en salir es normal; en una abarrotería está muerto. No
// hay un número bueno para todos, y afinarlos con los datos de UN negocio solo
// los haría correctos para ese negocio. Quien sabe si 30 días es mucho o poco
// es quien conoce su giro.
//
// Y tiene un efecto que importa más de lo que parece: si el umbral lo puso el
// dueño, un aviso deja de ser una opinión de Yaxo y pasa a ser el número que
// él mismo eligió cruzándose. Eso es lo que hace defendible que Yaxo avise.
//
// VIAJAN ENTRE DISPOSITIVOS. Las claves están en las listas de config
// compartida de las TRES capas (config.rs del PC, sync.ts del móvil,
// sync_bajar.py del servidor). Si no viajaran, el dueño los ajustaría en el
// teléfono y la caja seguiría razonando con otros números sobre el mismo
// negocio — que es exactamente lo que no puede pasar.

export type Umbrales = {
  diasVentanaRitmo: number;
  ventasMinimasRitmo: number;
  diasCoberturaAlerta: number;
  diasSinVentaParado: number;
  centavosMinimosParado: number;
};

export const UMBRALES_POR_DEFECTO: Umbrales = {
  diasVentanaRitmo: DIAS_VENTANA_RITMO,
  ventasMinimasRitmo: VENTAS_MINIMAS_PARA_RITMO,
  diasCoberturaAlerta: DIAS_COBERTURA_ALERTA,
  diasSinVentaParado: DIAS_SIN_VENTA_PARADO,
  centavosMinimosParado: CENTAVOS_MINIMOS_PARADO,
};

/** Clave de config por umbral. Prefijo `yaxo_` para que se agrupen solas,
 *  igual que `lealtad_*` e `impuesto_*`. */
export const CLAVES_UMBRAL: Record<keyof Umbrales, string> = {
  diasVentanaRitmo: "yaxo_dias_ventana_ritmo",
  ventasMinimasRitmo: "yaxo_ventas_minimas_ritmo",
  diasCoberturaAlerta: "yaxo_dias_cobertura_alerta",
  diasSinVentaParado: "yaxo_dias_sin_venta_parado",
  centavosMinimosParado: "yaxo_centavos_minimos_parado",
};

/** Rango aceptable de cada umbral. No es paranoia: un 0 en la ventana de ritmo
 *  divide entre cero, y un valor absurdo dejaría a Yaxo diciendo cosas sin
 *  sentido con total seguridad. Se recorta en vez de rechazar, porque esto se
 *  lee en cada consulta y fallar aquí dejaría al asistente mudo. */
const LIMITES: Record<keyof Umbrales, [number, number]> = {
  diasVentanaRitmo: [3, 90],
  ventasMinimasRitmo: [1, 50],
  diasCoberturaAlerta: [1, 60],
  diasSinVentaParado: [7, 365],
  centavosMinimosParado: [0, 10_000_00],
};

function recortar(k: keyof Umbrales, v: number): number {
  const [min, max] = LIMITES[k];
  if (!Number.isFinite(v)) return UMBRALES_POR_DEFECTO[k];
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** Lee los umbrales guardados; lo que falte cae al valor por defecto.
 *
 *  Se lee en CADA consulta y no se cachea a propósito: son cinco filas de una
 *  tabla clave-valor local, y cachear significaría que cambiar un umbral no se
 *  nota hasta reiniciar la app — justo cuando el dueño acaba de cambiarlo y
 *  quiere ver el efecto. */
export async function leerUmbrales(): Promise<Umbrales> {
  const mapa = await leerVarias(Object.values(CLAVES_UMBRAL));
  const out = { ...UMBRALES_POR_DEFECTO };
  for (const k of Object.keys(CLAVES_UMBRAL) as (keyof Umbrales)[]) {
    const crudo = mapa.get(CLAVES_UMBRAL[k]);
    if (crudo == null || crudo.trim() === "") continue;
    out[k] = recortar(k, Number(crudo));
  }
  return out;
}

/** Guarda un umbral. Usa `guardarConfigCompartida` y NO `guardarConfig`: es lo
 *  que hace que suba a la nube y llegue a las demás cajas. */
export async function guardarUmbral(k: keyof Umbrales, valor: number): Promise<number> {
  const v = recortar(k, valor);
  await guardarConfigCompartida(CLAVES_UMBRAL[k], String(v));
  return v;
}

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

function haceDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

/** Ventas netas por producto en una ventana, ya descontadas las devoluciones.
 *
 *  Se usa como subconsulta en varios indicadores. El LEFT JOIN contra
 *  devolucion_lineas es lo que hace el dato honesto: sin él, un producto con
 *  muchas devoluciones parece vendido. */
const SQL_VENTAS_NETAS = `
  SELECT
    vl.producto_id                                   AS producto_id,
    SUM(vl.cantidad - COALESCE(dev.devuelta, 0))     AS unidades,
    SUM(vl.total_linea_centavos)                     AS importe_centavos,
    COUNT(DISTINCT vl.venta_id)                      AS tickets,
    MAX(v.creado_en)                                 AS ultima_venta
  FROM venta_lineas vl
  JOIN ventas v ON v.id = vl.venta_id
  LEFT JOIN (
    SELECT venta_linea_id, SUM(cantidad) AS devuelta
    FROM devolucion_lineas
    GROUP BY venta_linea_id
  ) dev ON dev.venta_linea_id = vl.id
  WHERE v.estado <> 'cancelada'
    AND julianday(v.creado_en) >= julianday(?)
    AND vl.producto_id IS NOT NULL
  GROUP BY vl.producto_id
`;

// ---------------------------------------------------------------------------
// 1. Ritmo y cobertura — "¿qué debo resurtir y por qué?"
// ---------------------------------------------------------------------------

export type RitmoProducto = {
  productoId: string;
  nombre: string;
  /** Existencia actual. */
  stock: number;
  unidad: string;
  /** Unidades netas vendidas en la ventana. */
  unidadesVendidas: number;
  /** Días que se observaron. Viaja para que Yaxo pueda decir "en dos semanas"
   *  en vez de soltar un promedio sin contexto. */
  diasObservados: number;
  /** Unidades por día. La pieza central del razonamiento. */
  porDia: number;
  /** Días de existencia que quedan al ritmo actual. null si porDia es 0. */
  diasCobertura: number | null;
  /** Fecha estimada de agotamiento. null si no aplica. */
  seAcabaEl: string | null;
  /** Cuántos tickets distintos lo llevaron. Poca variedad de tickets con mucha
   *  cantidad puede ser una compra puntual, no demanda sostenida. */
  tickets: number;
  /** Dinero que costaría reponer una semana al ritmo actual. */
  reponerSemanaCentavos: number;
};

/**
 * Productos ordenados por urgencia de resurtido, con el cálculo a la vista.
 *
 * NO ES EL AVISO DE STOCK MÍNIMO, y la diferencia importa: el stock mínimo es
 * un número fijo que el dueño puso una vez. Esto mira lo que de verdad está
 * pasando. Un producto con stock 40 y mínimo 10 no dispara ninguna alerta, pero
 * si vende 12 al día se acaba pasado mañana. Ese es el caso que ninguna
 * pantalla ve hoy.
 *
 * Solo incluye productos con `controla_stock = 1`: para un servicio o algo que
 * no lleva existencias, "días de cobertura" no significa nada.
 */
export async function ritmoYCobertura(limite = 10): Promise<RitmoProducto[]> {
  const db = await bd();
  const u = await leerUmbrales();
  const desde = haceDias(u.diasVentanaRitmo);

  const filas = await db.getAllAsync<any>(
    `SELECT
       p.id            AS producto_id,
       p.nombre        AS nombre,
       p.stock         AS stock,
       p.unidad        AS unidad,
       p.costo_centavos AS costo_centavos,
       n.unidades      AS unidades,
       n.tickets       AS tickets
     FROM productos p
     JOIN (${SQL_VENTAS_NETAS}) n ON n.producto_id = p.id
     WHERE p.eliminado = 0
       AND p.activo = 1
       AND p.es_kit = 0
       AND p.controla_stock = 1
       AND n.unidades > 0
       AND n.tickets >= ?
     ORDER BY n.unidades DESC`,
    [desde, u.ventasMinimasRitmo]
  );

  const salida: RitmoProducto[] = filas.map((f) => {
    const unidades = Number(f.unidades) || 0;
    const porDia = unidades / u.diasVentanaRitmo;
    const stock = Number(f.stock) || 0;
    const diasCobertura = porDia > 0 ? stock / porDia : null;
    let seAcabaEl: string | null = null;
    if (diasCobertura !== null && Number.isFinite(diasCobertura)) {
      const d = new Date();
      d.setDate(d.getDate() + Math.floor(diasCobertura));
      seAcabaEl = d.toISOString();
    }
    const costo = Number(f.costo_centavos) || 0;
    return {
      productoId: String(f.producto_id),
      nombre: String(f.nombre),
      stock,
      unidad: String(f.unidad ?? "pieza"),
      unidadesVendidas: unidades,
      diasObservados: u.diasVentanaRitmo,
      porDia,
      diasCobertura,
      seAcabaEl,
      tickets: Number(f.tickets) || 0,
      reponerSemanaCentavos: Math.round(porDia * 7 * costo),
    };
  });

  // Se ordena por lo que queda, no por lo que se vende: lo urgente es lo que
  // se acaba antes, aunque venda menos que otro.
  salida.sort((a, b) => {
    const ca = a.diasCobertura ?? Infinity;
    const cb = b.diasCobertura ?? Infinity;
    return ca - cb;
  });
  return salida.slice(0, limite);
}

// ---------------------------------------------------------------------------
// 2. Inventario parado — "¿qué tengo ahí sin moverse?"
// ---------------------------------------------------------------------------

export type ProductoParado = {
  productoId: string;
  nombre: string;
  stock: number;
  unidad: string;
  /** Dinero inmovilizado: stock × costo. Si no hay costo capturado, se calcula
   *  con el precio de venta y se marca abajo — no es lo mismo y hay que
   *  decirlo, porque sobreestima lo que costó. */
  inmovilizadoCentavos: number;
  /** true si el importe salió del precio de venta por falta de costo. */
  estimadoConPrecio: boolean;
  /** Última venta registrada, o null si nunca se vendió. */
  ultimaVenta: string | null;
  /** Días desde la última venta. null si nunca se vendió. */
  diasSinVender: number | null;
};

/**
 * Productos con existencia que no se han movido.
 *
 * Es de los pocos datos que un dueño NO tiene en la cabeza: uno recuerda lo que
 * vende, no lo que no vende. Y es dinero que ya pagó y está ahí parado, que es
 * la forma más silenciosa de perderlo.
 *
 * Se excluyen los de poco valor con CENTAVOS_MINIMOS_PARADO: una lista de
 * treinta artículos de ocho pesos no ayuda a nadie a decidir nada.
 */
export async function inventarioParado(limite = 10): Promise<ProductoParado[]> {
  const db = await bd();
  const u = await leerUmbrales();
  const desde = haceDias(u.diasSinVentaParado);

  const filas = await db.getAllAsync<any>(
    `SELECT
       p.id                    AS producto_id,
       p.nombre                AS nombre,
       p.stock                 AS stock,
       p.unidad                AS unidad,
       p.costo_centavos        AS costo_centavos,
       p.precio_venta_centavos AS precio_centavos,
       (SELECT MAX(v2.creado_en)
          FROM venta_lineas vl2
          JOIN ventas v2 ON v2.id = vl2.venta_id
         WHERE vl2.producto_id = p.id
           AND v2.estado <> 'cancelada') AS ultima_venta
     FROM productos p
     WHERE p.eliminado = 0
       AND p.activo = 1
       AND p.es_kit = 0
       AND p.controla_stock = 1
       AND p.stock > 0
       AND p.id NOT IN (
         SELECT DISTINCT vl.producto_id
         FROM venta_lineas vl
         JOIN ventas v ON v.id = vl.venta_id
         WHERE v.estado <> 'cancelada'
           AND julianday(v.creado_en) >= julianday(?)
           AND vl.producto_id IS NOT NULL
       )`,
    [desde]
  );

  const ahora = Date.now();
  const salida: ProductoParado[] = [];

  for (const f of filas) {
    const stock = Number(f.stock) || 0;
    const costo = Number(f.costo_centavos) || 0;
    const precio = Number(f.precio_centavos) || 0;
    const estimadoConPrecio = costo <= 0;
    const unitario = estimadoConPrecio ? precio : costo;
    const inmovilizado = Math.round(stock * unitario);
    if (inmovilizado < u.centavosMinimosParado) continue;

    const ultima = f.ultima_venta ? String(f.ultima_venta) : null;
    let diasSinVender: number | null = null;
    if (ultima) {
      const t = Date.parse(ultima);
      if (!Number.isNaN(t)) diasSinVender = Math.floor((ahora - t) / 86400000);
    }

    salida.push({
      productoId: String(f.producto_id),
      nombre: String(f.nombre),
      stock,
      unidad: String(f.unidad ?? "pieza"),
      inmovilizadoCentavos: inmovilizado,
      estimadoConPrecio,
      ultimaVenta: ultima,
      diasSinVender,
    });
  }

  salida.sort((a, b) => b.inmovilizadoCentavos - a.inmovilizadoCentavos);
  return salida.slice(0, limite);
}

// ---------------------------------------------------------------------------
// 3. Margen contra su departamento — "¿estoy cobrando bien esto?"
// ---------------------------------------------------------------------------

export type MargenComparado = {
  productoId: string;
  nombre: string;
  departamento: string | null;
  margenPct: number;
  /** Margen medio del departamento, ponderado por lo vendido. */
  margenDeptoPct: number;
  /** Diferencia en puntos porcentuales. Negativa = por debajo de sus vecinos. */
  diferenciaPuntos: number;
  unidadesVendidas: number;
  importeCentavos: number;
};

/**
 * Productos cuyo margen se aparta del de su propio departamento.
 *
 * COMPARAR CONTRA EL DEPARTAMENTO Y NO CONTRA EL NEGOCIO ENTERO es lo que hace
 * útil este indicador. Los refrescos dejan menos que las botanas y eso es
 * normal en todas las tiendas: decir "los refrescos van por debajo del promedio
 * del negocio" no es un hallazgo, es cómo funciona el giro. Que un refresco
 * concreto deje menos que los demás refrescos sí lo es.
 *
 * Solo se consideran productos con costo capturado: sin costo no hay margen que
 * calcular, y suponer costo cero daría un margen del 100% que es falso.
 */
export async function margenContraDepartamento(
  limite = 10
): Promise<MargenComparado[]> {
  const db = await bd();
  const u = await leerUmbrales();
  const desde = haceDias(u.diasVentanaRitmo * 2);

  const filas = await db.getAllAsync<any>(
    `SELECT
       p.id                AS producto_id,
       p.nombre            AS nombre,
       c.nombre            AS departamento,
       p.categoria_id      AS categoria_id,
       n.unidades          AS unidades,
       n.importe_centavos  AS importe,
       p.costo_centavos    AS costo_centavos
     FROM productos p
     JOIN (${SQL_VENTAS_NETAS}) n ON n.producto_id = p.id
     LEFT JOIN categorias c ON c.id = p.categoria_id
     WHERE p.eliminado = 0
       AND p.activo = 1
       AND p.es_kit = 0
       AND p.costo_centavos > 0
       AND n.unidades > 0
       AND n.tickets >= ?`,
    [desde, u.ventasMinimasRitmo]
  );

  type Fila = {
    productoId: string;
    nombre: string;
    departamento: string | null;
    categoriaId: string | null;
    unidades: number;
    importe: number;
    costoTotal: number;
    margenPct: number;
  };

  const items: Fila[] = filas.map((f) => {
    const unidades = Number(f.unidades) || 0;
    const importe = Number(f.importe) || 0;
    const costoTotal = (Number(f.costo_centavos) || 0) * unidades;
    const margenPct = importe > 0 ? ((importe - costoTotal) / importe) * 100 : 0;
    return {
      productoId: String(f.producto_id),
      nombre: String(f.nombre),
      departamento: f.departamento ? String(f.departamento) : null,
      categoriaId: f.categoria_id ? String(f.categoria_id) : null,
      unidades,
      importe,
      costoTotal,
      margenPct,
    };
  });

  // Margen del departamento PONDERADO por importe, no promedio simple de los
  // márgenes de cada producto. Un promedio simple deja que un artículo que
  // vendió una vez pese igual que el que sostiene el departamento.
  const porDepto = new Map<string, { importe: number; costo: number }>();
  for (const it of items) {
    const k = it.categoriaId ?? "__sin__";
    const acc = porDepto.get(k) ?? { importe: 0, costo: 0 };
    acc.importe += it.importe;
    acc.costo += it.costoTotal;
    porDepto.set(k, acc);
  }

  const salida: MargenComparado[] = [];
  for (const it of items) {
    const k = it.categoriaId ?? "__sin__";
    const acc = porDepto.get(k)!;
    // Un departamento con un solo producto se compara consigo mismo y siempre
    // da cero: no aporta nada y se descarta.
    const otros = items.filter((x) => (x.categoriaId ?? "__sin__") === k);
    if (otros.length < 2) continue;
    const margenDepto =
      acc.importe > 0 ? ((acc.importe - acc.costo) / acc.importe) * 100 : 0;
    salida.push({
      productoId: it.productoId,
      nombre: it.nombre,
      departamento: it.departamento,
      margenPct: it.margenPct,
      margenDeptoPct: margenDepto,
      diferenciaPuntos: it.margenPct - margenDepto,
      unidadesVendidas: it.unidades,
      importeCentavos: it.importe,
    });
  }

  // Los que más se apartan hacia abajo primero: son los que pueden estar
  // costando dinero sin que se note.
  salida.sort((a, b) => a.diferenciaPuntos - b.diferenciaPuntos);
  return salida.slice(0, limite);
}

// ---------------------------------------------------------------------------
// 4. Volumen sin margen — "¿qué vendo mucho pero me deja poco?"
// ---------------------------------------------------------------------------
//
// De todo el inventario de preguntas, esta es la que más probablemente le
// enseñe algo que no sabía: ningún reporte cruza VOLUMEN con MARGEN. El dueño
// ve el más vendido en una pantalla y el margen en otra, y nunca los junta.
//
// Se compara contra el margen del NEGOCIO ENTERO, no contra el departamento.
// Es deliberado y es lo contrario de margenContraDepartamento():
//   · Aquella pregunta es "¿estoy cobrando bien?" — y ahí lo justo es comparar
//     un refresco con otros refrescos, porque las bebidas dejan lo que dejan.
//   · Esta es "¿dónde se me va la ganancia?" — y ahí el departamento no
//     importa: un producto que es el 40% de tus ventas con la mitad de tu
//     margen te está costando dinero real aunque sea normal en su categoría.
//
// El número que se devuelve es "cuánto MÁS habrías ganado si ese producto
// dejara como tu promedio". No es dinero perdido —nadie te lo quitó— pero es
// la única forma de expresar el tamaño del hueco en pesos en vez de en puntos
// porcentuales, que no le dicen nada a nadie.
//
// Solo entran productos con costo capturado: sin costo el margen sería una
// invención, y aquí inventar significaría acusar a un producto de algo que no
// hizo.

/** Peso mínimo sobre el ingreso para considerar que "vende mucho". Por debajo,
 *  aunque el margen sea malo, no mueve la aguja del negocio y solo sería
 *  ruido. Puesto a ojo como el resto (ver cabecera). */
export const PESO_MINIMO_VOLUMEN = 8; // % del ingreso del periodo

/** Puntos porcentuales por debajo del margen del negocio para mencionarlo. Sin
 *  esto, cualquier producto medio punto por debajo del promedio aparecería en
 *  la lista — y en cualquier negocio la mitad de los productos está por debajo
 *  del promedio, por definición. */
export const PUNTOS_MINIMOS_DEBAJO = 5;

export type VolumenSinMargen = {
  productoId: string;
  nombre: string;
  departamento: string | null;
  unidadesVendidas: number;
  importeCentavos: number;
  /** Qué porcentaje del ingreso del periodo representa este producto. */
  pesoPct: number;
  margenPct: number;
  /** Margen del negocio entero en el mismo periodo, para poder contrastar. */
  margenNegocioPct: number;
  /** Puntos porcentuales por debajo del negocio. Siempre positivo aquí. */
  puntosDebajo: number;
  /** Cuánto más habrías ganado si dejara como el promedio del negocio. */
  huecoCentavos: number;
  diasObservados: number;
};

export async function volumenSinMargen(limite = 5): Promise<VolumenSinMargen[]> {
  const db = await bd();
  const u = await leerUmbrales();
  const dias = u.diasVentanaRitmo * 2;
  const desde = haceDias(dias);

  const filas = await db.getAllAsync<{
    id: string;
    nombre: string;
    depto: string | null;
    unidades: number;
    importe: number;
    costo: number;
    tickets: number;
  }>(
    `SELECT p.id           AS id,
            p.nombre       AS nombre,
            c.nombre       AS depto,
            n.unidades     AS unidades,
            n.importe_centavos AS importe,
            n.costo_centavos   AS costo,
            n.tickets      AS tickets
     FROM (
       SELECT vl.producto_id AS producto_id,
              SUM(vl.cantidad - COALESCE(dev.devuelta, 0)) AS unidades,
              SUM(vl.total_linea_centavos) AS importe_centavos,
              SUM(vl.costo_unitario_centavos * vl.cantidad) AS costo_centavos,
              COUNT(DISTINCT vl.venta_id) AS tickets
       FROM venta_lineas vl
       JOIN ventas v ON v.id = vl.venta_id
       LEFT JOIN (
         SELECT venta_linea_id, SUM(cantidad) AS devuelta
         FROM devolucion_lineas GROUP BY venta_linea_id
       ) dev ON dev.venta_linea_id = vl.id
       WHERE v.estado <> 'cancelada'
         AND julianday(v.creado_en) >= julianday(?)
         AND vl.producto_id IS NOT NULL
       GROUP BY vl.producto_id
     ) n
     JOIN productos p ON p.id = n.producto_id
     LEFT JOIN categorias c ON c.id = p.categoria_id
     WHERE p.eliminado = 0
       AND p.activo = 1
       AND p.es_kit = 0
       AND n.unidades > 0
       AND n.importe_centavos > 0
       AND n.costo_centavos > 0
       AND n.tickets >= ?`,
    [desde, u.ventasMinimasRitmo]
  );

  if (filas.length === 0) return [];

  // El margen del negocio se calcula SOBRE ESTAS MISMAS FILAS, no sobre todo
  // lo vendido. Si se comparara contra un margen que incluye productos sin
  // costo capturado, el promedio saldría inflado y medio catálogo parecería
  // "por debajo" por un defecto de captura, no por su precio.
  const importeTotal = filas.reduce((s, f) => s + Number(f.importe), 0);
  const costoTotal = filas.reduce((s, f) => s + Number(f.costo), 0);
  if (importeTotal <= 0) return [];
  const margenNegocioPct = ((importeTotal - costoTotal) / importeTotal) * 100;

  const salida: VolumenSinMargen[] = [];
  for (const f of filas) {
    const importe = Number(f.importe) || 0;
    const costo = Number(f.costo) || 0;
    const margenPct = ((importe - costo) / importe) * 100;
    const pesoPct = (importe / importeTotal) * 100;
    const puntosDebajo = margenNegocioPct - margenPct;
    if (pesoPct < PESO_MINIMO_VOLUMEN) continue;
    if (puntosDebajo < PUNTOS_MINIMOS_DEBAJO) continue;
    salida.push({
      productoId: f.id,
      nombre: f.nombre,
      departamento: f.depto ?? null,
      unidadesVendidas: Number(f.unidades) || 0,
      importeCentavos: importe,
      pesoPct: Math.round(pesoPct * 10) / 10,
      margenPct: Math.round(margenPct * 10) / 10,
      margenNegocioPct: Math.round(margenNegocioPct * 10) / 10,
      puntosDebajo: Math.round(puntosDebajo * 10) / 10,
      huecoCentavos: Math.round((importe * puntosDebajo) / 100),
      diasObservados: dias,
    });
  }

  // Por tamaño del hueco en PESOS, no por puntos de margen: un producto 20
  // puntos por debajo que casi no vendes importa menos que uno 8 puntos por
  // debajo que es la mitad de tu negocio.
  salida.sort((a, b) => b.huecoCentavos - a.huecoCentavos);
  return salida.slice(0, limite);
}

// ---------------------------------------------------------------------------
// 5. Sin costo capturado — "¿qué me falta para que los márgenes sean fiables?"
// ---------------------------------------------------------------------------
//
// Esta es la única pregunta de todo el asistente que le dice al dueño cómo
// hacer que Yaxo sea MEJOR. Hoy la falta de costo solo aparece como una
// reserva que apaga frases: Yaxo dice "no puedo afirmar tu margen" y ahí se
// acaba. Eso deja al dueño con un problema y sin salida.
//
// Devolverle la lista concreta, ORDENADA POR LO QUE MÁS VENDE, cierra el
// círculo: no hace falta capturar el catálogo entero: con los que sostienen
// las ventas, la cobertura sube lo suficiente para que el margen deje de ser
// una ilusión.
//
// Se ordena por importe vendido y NO se filtran los que no se vendieron: los
// que nunca se han vendido van al final, que es exactamente la prioridad que
// tienen. Un producto sin costo que tampoco vendes no estropea ningún cálculo.

export type SinCosto = {
  productoId: string;
  nombre: string;
  departamento: string | null;
  stock: number;
  /** Unidades netas vendidas en la ventana. 0 si no se ha vendido. */
  unidadesVendidas: number;
  /** Lo que ha facturado en la ventana. Es el criterio de prioridad. */
  importeCentavos: number;
};

export type ResumenSinCosto = {
  /** Cuántos productos activos no tienen costo capturado. */
  total: number;
  /** Cuántos productos activos hay en total, para poder dar proporción. */
  totalProductos: number;
  /** Cuántos de los que faltan SÍ se han vendido en la ventana. Son los que
   *  de verdad estropean el cálculo del margen. */
  conVenta: number;
  /** Qué parte del ingreso de la ventana pasó por productos sin costo. */
  importeAfectadoCentavos: number;
  diasObservados: number;
  /** Los más urgentes primero. */
  productos: SinCosto[];
};

export async function sinCostoCapturado(limite = 8): Promise<ResumenSinCosto> {
  const db = await bd();
  const u = await leerUmbrales();
  const dias = u.diasVentanaRitmo * 2;
  const desde = haceDias(dias);

  const filas = await db.getAllAsync<{
    id: string;
    nombre: string;
    depto: string | null;
    stock: number;
    unidades: number;
    importe: number;
  }>(
    `SELECT p.id     AS id,
            p.nombre AS nombre,
            c.nombre AS depto,
            p.stock  AS stock,
            COALESCE(n.unidades, 0)         AS unidades,
            COALESCE(n.importe_centavos, 0) AS importe
     FROM productos p
     LEFT JOIN categorias c ON c.id = p.categoria_id
     LEFT JOIN (
       SELECT vl.producto_id AS producto_id,
              SUM(vl.cantidad - COALESCE(dev.devuelta, 0)) AS unidades,
              SUM(vl.total_linea_centavos) AS importe_centavos
       FROM venta_lineas vl
       JOIN ventas v ON v.id = vl.venta_id
       LEFT JOIN (
         SELECT venta_linea_id, SUM(cantidad) AS devuelta
         FROM devolucion_lineas GROUP BY venta_linea_id
       ) dev ON dev.venta_linea_id = vl.id
       WHERE v.estado <> 'cancelada'
         AND julianday(v.creado_en) >= julianday(?)
         AND vl.producto_id IS NOT NULL
       GROUP BY vl.producto_id
     ) n ON n.producto_id = p.id
     WHERE p.eliminado = 0
       AND p.activo = 1
       AND p.es_kit = 0
       AND COALESCE(p.costo_centavos, 0) <= 0
     ORDER BY importe DESC, p.nombre COLLATE NOCASE`,
    [desde]
  );

  // Total de productos activos, para poder decir "34 de 210" en vez de un 34
  // suelto. Los kits quedan fuera del conteo por el mismo motivo que de la
  // lista: su costo sale de sus componentes, no se captura.
  const cuenta = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM productos
     WHERE eliminado = 0 AND activo = 1 AND es_kit = 0`
  );

  const productos: SinCosto[] = filas.map((f) => ({
    productoId: f.id,
    nombre: f.nombre,
    departamento: f.depto ?? null,
    stock: Number(f.stock) || 0,
    unidadesVendidas: Number(f.unidades) || 0,
    importeCentavos: Number(f.importe) || 0,
  }));

  return {
    total: productos.length,
    totalProductos: Number(cuenta?.n) || 0,
    conVenta: productos.filter((p) => p.importeCentavos > 0).length,
    importeAfectadoCentavos: productos.reduce((s, p) => s + p.importeCentavos, 0),
    diasObservados: dias,
    productos: productos.slice(0, limite),
  };
}

// ---------------------------------------------------------------------------
// EL PUNTO DE AVISO
// ---------------------------------------------------------------------------
//
// Lo que enciende el punto del icono de Yaxo. Es la única forma que tiene el
// asistente local de señalar algo sin interrumpir: un punto se ve de reojo y
// se atiende cuando se puede.
//
// POR QUÉ AHORA SÍ Y ANTES NO
// Con los umbrales puestos a ojo, un aviso era una opinión de Yaxo, y una
// opinión equivocada que aparece sola molesta más de lo que ayuda. Desde que
// el dueño puede ajustarlos, el punto se enciende porque se cruzó EL NÚMERO
// QUE ÉL ELIGIÓ. Eso es lo que lo hace defendible.
//
// TRES REGLAS, Y LAS TRES IMPORTAN
//
// 1. Solo alerta REAL. Únicamente productos que se acaban dentro de la
//    cobertura que marcó el dueño. Nada de "hace tiempo que no entras" ni
//    sugerencias: un punto que a veces no significa nada deja de mirarse, y
//    entonces tampoco se mira el día que sí significa algo.
//
// 2. Una vez al día. Si el dueño abre Yaxo, el punto se apaga hasta mañana
//    aunque el producto siga ahí. Un punto permanentemente encendido no es un
//    aviso, es decoración — y encima castiga a quien SÍ hizo caso.
//
// 3. Nunca cuesta caro. Es un COUNT, no la consulta completa de ritmo: esto se
//    ejecuta al montar cabeceras que se abren cientos de veces al día. Si
//    avisar fuera lento, el aviso sería el problema.
//
// La marca de "ya lo vio" es LOCAL a este aparato (guardarConfig, no
// guardarConfigCompartida): que el dueño mire el aviso en el teléfono no
// significa que el cajero de la caja ya lo haya visto.

const CLAVE_AVISO_VISTO = "yaxo_aviso_visto_el";

function hoyLocalYmd(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

/**
 * ¿Hay algo que de verdad merezca el punto?
 *
 * Devuelve false —sin consultar nada— si el dueño ya abrió Yaxo hoy. Ese
 * atajo es lo que hace que la comprobación sea gratis la mayor parte de las
 * veces que se llama.
 */
export async function hayAvisoYaxo(): Promise<boolean> {
  const visto = await leerConfig(CLAVE_AVISO_VISTO);
  if (visto === hoyLocalYmd()) return false;

  const db = await bd();
  const u = await leerUmbrales();
  const desde = haceDias(u.diasVentanaRitmo);

  // Mismo criterio que ritmoYCobertura, pero contando en vez de traer filas:
  // productos con existencia cuyo ritmo de venta se la termina antes de los
  // días de cobertura que marcó el dueño.
  const f = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM (
       SELECT p.id
       FROM productos p
       JOIN venta_lineas vl ON vl.producto_id = p.id
       JOIN ventas v ON v.id = vl.venta_id
       LEFT JOIN (
         SELECT venta_linea_id, SUM(cantidad) AS devuelta
         FROM devolucion_lineas GROUP BY venta_linea_id
       ) dev ON dev.venta_linea_id = vl.id
       WHERE v.estado <> 'cancelada'
         AND julianday(v.creado_en) >= julianday(?)
         AND p.eliminado = 0
         AND p.activo = 1
         AND p.es_kit = 0
         AND p.controla_stock = 1
         AND p.stock > 0
       GROUP BY p.id
       HAVING COUNT(DISTINCT vl.venta_id) >= ?
          AND SUM(vl.cantidad - COALESCE(dev.devuelta, 0)) > 0
          AND p.stock / (SUM(vl.cantidad - COALESCE(dev.devuelta, 0)) / ?) <= ?
     )`,
    [desde, u.ventasMinimasRitmo, u.diasVentanaRitmo, u.diasCoberturaAlerta]
  );
  return (Number(f?.n) || 0) > 0;
}

/** Apaga el punto hasta mañana. Se llama al ABRIR la pantalla de Yaxo, no al
 *  tocar el botón: si alguien lo toca sin querer y sale, el aviso sigue. */
export async function marcarAvisoVisto(): Promise<void> {
  await guardarConfig(CLAVE_AVISO_VISTO, hoyLocalYmd());
}
