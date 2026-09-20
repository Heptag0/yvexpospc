// YvexPOS Móvil — Lógica de inventario (completa).
//
// Productos, categorías, métricas, ajustes de stock CON RASTRO, reporte por
// departamento, conteo físico y kits (paquetes). Calca las reglas del PC:
//   - código de barras en MAYÚSCULAS y único
//   - montos en centavos, stock real
//   - todo ajuste de stock deja rastro en ajustes_inventario
//   - kits: producto con es_kit=1 + componentes; su costo por defecto es la
//     suma de componentes; su stock es virtual (según componentes)

import { bd, uuid, ahoraISO } from "./db";
import { exigirPermiso } from "./permisos";
import { borrarImagen } from "./imagenes";
import { encolar } from "./sync";

// Mismas 3 unidades que el PC (unidad TEXT CHECK IN ('pieza','kg','litro')):
// el formulario ya no pide "unidad" suelta, pide CÓMO SE VENDE
// (Pieza / A granel / Paquete), y granel resuelve a kg o litro.
export const UNIDADES = ["pieza", "kg", "litro"] as const;
export type Unidad = (typeof UNIDADES)[number];

export type Producto = {
  id: string;
  codigo_barras: string | null;
  nombre: string;
  categoria_id: string | null;
  precio_venta_centavos: number;
  costo_centavos: number | null;
  precio_mayoreo_centavos: number | null;
  controla_stock: number;
  stock: number;
  stock_minimo: number;
  unidad: string;
  es_kit: number;
  favorito: number;
  imagen_uri: string | null;
  /** Porcentaje entero (0 o 16, igual que el PC) — NO puntos base. Ver
   *  impuestos.ts::puntosBaseDesdePct() para la conversión real al cobrar. */
  iva_tasa: number;
};

export type ProductoLista = Producto & {
  categoria_nombre: string | null;
  categoria_color: string | null;
  categoria_icono: string | null;
  kit_disponible: number | null;
};

export type Categoria = {
  id: string;
  nombre: string;
  orden: number;
  color: string | null;
  icono: string | null;
};

export type ComponenteKit = {
  producto_id: string;
  nombre: string;
  cantidad: number;
  stock: number;
  costo_centavos: number | null;
};

export type DatosProducto = {
  id?: string;
  codigo_barras: string | null;
  nombre: string;
  categoria_id: string | null;
  precio_venta_centavos: number;
  costo_centavos: number | null;
  precio_mayoreo_centavos: number | null;
  controla_stock: boolean;
  stock: number;
  stock_minimo: number;
  unidad: string;
  es_kit: boolean;
  favorito: boolean;
  imagen_uri: string | null;
  /** Porcentaje entero: 0 (exento) o 16 (IVA general MX) — mismo rango que
   *  el CHECK del PC. Solo importa si el impuesto está activo en Ajustes;
   *  si está apagado, este valor queda guardado pero no afecta nada. */
  iva_tasa: number;
  componentes: { producto_id: string; cantidad: number }[];
};

// ---------------------------------------------------------------------------
// Productos: listar / buscar
// ---------------------------------------------------------------------------

export async function listarProductos(opciones?: {
  filtro?: string;
  categoriaId?: string | null;
  soloStockBajo?: boolean;
  // Subconjunto de "stock bajo" (bajo = stock <= mínimo; negativo = stock <
  // 0). Alertas distintas para el dueño: una es "hay que resurtir pronto",
  // la otra es "algo no cuadra en el conteo" — merecen filtros separados
  // aunque casi siempre un producto en negativo también cuente como bajo.
  soloEnNegativo?: boolean;
}): Promise<ProductoLista[]> {
  const db = await bd();
  const cond: string[] = ["p.eliminado = 0"];
  const args: any[] = [];

  const filtro = opciones?.filtro?.trim();
  if (filtro) {
    cond.push("(p.nombre LIKE ? OR p.codigo_barras LIKE ?)");
    const like = `%${filtro}%`;
    args.push(like, like);
  }
  if (opciones?.categoriaId) {
    cond.push("p.categoria_id = ?");
    args.push(opciones.categoriaId);
  }
  if (opciones?.soloEnNegativo) {
    cond.push("p.es_kit = 0 AND p.controla_stock = 1 AND p.stock < 0");
  } else if (opciones?.soloStockBajo) {
    cond.push("p.es_kit = 0 AND p.controla_stock = 1 AND p.stock <= p.stock_minimo");
  }

  // Antes: siempre alfabético, incluso buscando. Escribir "coca" enterraba
  // "Coca-Cola" bajo cualquier producto que la tuviera mencionada más tarde
  // en el nombre, solo por orden de letras. Con texto de búsqueda: primero
  // coincidencia exacta, luego "empieza con", luego el resto — alfabético
  // dentro de cada grupo. Sin texto de búsqueda (navegando el catálogo
  // completo), no hay noción de relevancia: alfabético como siempre.
  let orderBy = "p.nombre COLLATE NOCASE";
  const ordArgs: any[] = [];
  if (filtro) {
    orderBy = `CASE
        WHEN p.nombre COLLATE NOCASE = ? THEN 0
        WHEN p.nombre LIKE ? THEN 1
        ELSE 2
      END, p.nombre COLLATE NOCASE`;
    ordArgs.push(filtro, `${filtro}%`);
  }

  const filas = await db.getAllAsync<ProductoLista>(
    `SELECT p.*, c.nombre AS categoria_nombre, c.color AS categoria_color,
            c.icono AS categoria_icono, NULL AS kit_disponible
     FROM productos p
     LEFT JOIN categorias c ON c.id = p.categoria_id
     WHERE ${cond.join(" AND ")}
     ORDER BY ${orderBy}`,
    [...args, ...ordArgs]
  );

  const kits = filas.filter((f) => f.es_kit === 1);
  if (kits.length) {
    const disp = await db.getAllAsync<{ kit_id: string; disp: number }>(
      // kc.eliminado = 0 es IMPRESCINDIBLE: al editar un kit, las piezas que
      // se quitan se marcan como eliminadas en vez de borrarse (así la baja
      // viaja a las otras cajas). Sin el filtro se cuentan las versiones
      // viejas y la disponibilidad sale mal.
      `SELECT kc.kit_id, CAST(MIN(p2.stock / kc.cantidad) AS INTEGER) AS disp
       FROM kit_componentes kc
       JOIN productos p2 ON p2.id = kc.producto_id
       WHERE kc.eliminado = 0
       GROUP BY kc.kit_id`
    );
    const mapa = new Map(disp.map((d) => [d.kit_id, Math.max(0, d.disp)]));
    for (const k of kits) k.kit_disponible = mapa.get(k.id) ?? 0;
  }

  return filas;
}

export async function buscarPorCodigo(codigo: string): Promise<Producto | null> {
  const db = await bd();
  const fila = await db.getFirstAsync<Producto>(
    "SELECT * FROM productos WHERE codigo_barras = ? AND eliminado = 0",
    [codigo.trim().toUpperCase()]
  );
  return fila ?? null;
}

export async function candidatosComponente(filtro: string): Promise<Producto[]> {
  const db = await bd();
  const like = `%${filtro.trim()}%`;
  return db.getAllAsync<Producto>(
    `SELECT * FROM productos WHERE eliminado = 0 AND es_kit = 0
       AND (nombre LIKE ? OR codigo_barras LIKE ?)
     ORDER BY nombre COLLATE NOCASE LIMIT 15`,
    [like, like]
  );
}

export async function componentesDeKit(kitId: string): Promise<ComponenteKit[]> {
  const db = await bd();
  return db.getAllAsync<ComponenteKit>(
    `SELECT kc.producto_id, p.nombre, kc.cantidad, p.stock, p.costo_centavos
     FROM kit_componentes kc JOIN productos p ON p.id = kc.producto_id
     WHERE kc.kit_id = ? AND kc.eliminado = 0 ORDER BY p.nombre COLLATE NOCASE`,
    [kitId]
  );
}

// ---------------------------------------------------------------------------
// Productos: crear / editar / eliminar
// ---------------------------------------------------------------------------

/** Costo de un kit: la SUMA de (costo del componente x cantidad).
 *
 *  Un valor derivado no puede venir del formulario. El PC ya lo calculaba al
 *  crear, pero al editar respetaba el costo que mandaba la pantalla (que
 *  llega precargado con el viejo): cambiabas el kit de 20 piezas a 2 y el
 *  costo se quedaba en el de 20, con el margen y el precio de venta
 *  calculados sobre una mentira. El móvil ni siquiera lo calculaba: escribía
 *  lo que dijera el formulario, así que el desfase era permanente.
 *
 *  Se redondea al centavo en cada línea (la cantidad puede ser decimal),
 *  igual que kits.rs::costo_calculado del PC. */
async function costoCalculadoKit(
  componentes: { producto_id: string; cantidad: number }[]
): Promise<number> {
  if (!componentes.length) return 0;
  const db = await bd();
  let total = 0;
  for (const c of componentes) {
    const p = await db.getFirstAsync<{ costo_centavos: number | null }>(
      "SELECT costo_centavos FROM productos WHERE id = ? AND eliminado = 0",
      [c.producto_id]
    );
    total += Math.round((p?.costo_centavos ?? 0) * c.cantidad);
  }
  return total;
}

function validar(d: DatosProducto): void {
  if (!d.nombre.trim()) throw new Error("El nombre del producto no puede estar vacío.");
  if (d.precio_venta_centavos < 0) throw new Error("El precio no puede ser negativo.");
  if (d.costo_centavos != null && d.costo_centavos < 0)
    throw new Error("El costo no puede ser negativo.");
  if (!UNIDADES.includes(d.unidad as Unidad))
    throw new Error(`Unidad inválida: ${d.unidad}`);
  if (d.es_kit && d.componentes.length === 0)
    throw new Error("Un kit necesita al menos un componente.");
  // Mismo rango que el CHECK (iva_tasa IN (0, 16)) del PC. SQLite no deja
  // añadir un CHECK con ALTER TABLE sobre una tabla existente (ver
  // db.ts, migración v31), así que la regla vive aquí.
  if (d.iva_tasa !== 0 && d.iva_tasa !== 16)
    throw new Error("La tasa de IVA debe ser 0% (exento) o 16%.");
}

function normalizarCodigo(codigo: string | null): string | null {
  if (!codigo) return null;
  const c = codigo.trim().toUpperCase();
  return c === "" ? null : c;
}

async function verificarCodigoUnico(codigo: string, exceptoId?: string): Promise<void> {
  const db = await bd();
  const dup = exceptoId
    ? await db.getFirstAsync(
        "SELECT 1 FROM productos WHERE codigo_barras = ? AND eliminado = 0 AND id <> ?",
        [codigo, exceptoId]
      )
    : await db.getFirstAsync(
        "SELECT 1 FROM productos WHERE codigo_barras = ? AND eliminado = 0",
        [codigo]
      );
  if (dup) throw new Error("Ya existe un producto con ese código de barras.");
}

/** Reemplaza la lista de componentes de un kit y la sincroniza.
 *
 *  BORRADO SUAVE, no DELETE. Editar un kit REEMPLAZA su lista, y con borrado
 *  duro la fila desaparecía sin dejar rastro: el otro dispositivo nunca se
 *  enteraba de que quitaste una pieza y se quedaba con la lista vieja,
 *  descontando stock de más en cada venta.
 *
 *  Y se ENCOLA, que antes no ocurría en ninguna de las dos plataformas: el
 *  kit llegaba al PC marcado como kit pero VACÍO. Allá no se podía editar
 *  (la pantalla exige al menos un componente) y venderlo NO DESCONTABA NADA,
 *  porque el kit no tiene stock propio — se deriva de sus piezas. */
async function guardarComponentes(
  kitId: string,
  componentes: { producto_id: string; cantidad: number }[]
): Promise<void> {
  const db = await bd();
  const ahora = ahoraISO();

  const previos = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM kit_componentes WHERE kit_id = ? AND eliminado = 0",
    [kitId]
  );
  for (const p of previos) {
    await db.runAsync(
      "UPDATE kit_componentes SET eliminado = 1, actualizado_en = ? WHERE id = ?",
      [ahora, p.id]
    );
    await encolar("kit_componentes", p.id,
      { id: p.id, eliminado: 1, actualizado_en: ahora }, "update");
  }

  for (const c of componentes) {
    if (c.cantidad <= 0) continue;
    const id = uuid();
    await db.runAsync(
      `INSERT INTO kit_componentes (id, kit_id, producto_id, cantidad, eliminado, creado_en, actualizado_en)
       VALUES (?,?,?,?,0,?,?)`,
      [id, kitId, c.producto_id, c.cantidad, ahora, ahora]
    );
    // El servidor la llama `producto_componente_id` (nombre canónico, el del
    // PC): distingue sin ambigüedad la pieza del paquete, ya que los dos son
    // productos. Aquí se traduce al construir el payload.
    await encolar("kit_componentes", id, {
      id, kit_id: kitId, producto_componente_id: c.producto_id,
      cantidad: c.cantidad, eliminado: 0,
      creado_en: ahora, actualizado_en: ahora,
    });
  }
}

/** Da de baja TODOS los componentes de un kit (cuando deja de ser kit, o al
 *  eliminar el producto). Mismo criterio: suave y sincronizado. */
async function bajaComponentes(kitId: string): Promise<void> {
  await guardarComponentes(kitId, []);
}

export async function crearProducto(d: DatosProducto): Promise<string> {
  await exigirPermiso("editarCatalogo");
  validar(d);
  const db = await bd();
  const codigo = normalizarCodigo(d.codigo_barras);
  if (codigo) await verificarCodigoUnico(codigo);

  const id = uuid();
  const ahora = ahoraISO();
  // El costo de un kit NO se toma del formulario: se deriva de sus piezas.
  const costoFinal = d.es_kit
    ? await costoCalculadoKit(d.componentes)
    : d.costo_centavos;
  // Antes: INSERT + guardarComponentes() (que a su vez hace DELETE + varios
  // INSERT) eran llamadas sueltas, sin transacción. Si algo fallaba entre
  // medio, un kit podía quedar creado con sus componentes a medias — o sin
  // ninguno. aplicarResurtido() ya usaba withTransactionAsync
  // correctamente; crearProducto y editarProducto no lo hacían.
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO productos
        (id, codigo_barras, nombre, categoria_id, precio_venta_centavos,
         costo_centavos, precio_mayoreo_centavos, controla_stock, stock,
         stock_minimo, unidad, es_kit, favorito, imagen_uri, iva_tasa, activo, eliminado, creado_en, actualizado_en)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?,?)`,
      [
        id, codigo, d.nombre.trim(), d.categoria_id, d.precio_venta_centavos,
        costoFinal, d.precio_mayoreo_centavos,
        d.es_kit ? 0 : d.controla_stock ? 1 : 0,
        d.es_kit ? 0 : d.stock,
        d.stock_minimo, d.unidad, d.es_kit ? 1 : 0, d.favorito ? 1 : 0,
        d.imagen_uri, d.iva_tasa, ahora, ahora,
      ]
    );
    if (d.es_kit) await guardarComponentes(id, d.componentes);

    await encolar("productos", id, {
      id, codigo_barras: codigo, nombre: d.nombre.trim(), categoria_id: d.categoria_id,
      precio_venta_centavos: d.precio_venta_centavos, costo_centavos: costoFinal,
      // `iva_tasa` SÍ se manda ahora — el móvil ya la guarda (migración v31).
      // Antes se omitía a propósito porque no existía la columna; mandar
      // `iva_tasa: 0` fijo era destructivo (pisaba el IVA real del PC en
      // TODO el negocio con solo editar el precio desde el teléfono). Esa
      // regla general se mantiene para lo que SÍ se sigue sin guardar aquí
      // (`cantidad_mayoreo`, mayoreo automático — no implementado en móvil
      // todavía): omitir una columna que no tienes es seguro; afirmar un
      // valor que no tienes, no.
      precio_mayoreo_centavos: d.precio_mayoreo_centavos,
      controla_stock: d.es_kit ? 0 : d.controla_stock ? 1 : 0,
      stock: d.es_kit ? 0 : d.stock, unidad: d.unidad, stock_minimo: d.stock_minimo,
      favorito: d.favorito ? 1 : 0, es_kit: d.es_kit ? 1 : 0, iva_tasa: d.iva_tasa,
      eliminado: 0, creado_en: ahora,
      actualizado_en: ahora,
    });
  });
  return id;
}

export async function editarProducto(d: DatosProducto): Promise<void> {
  await exigirPermiso("editarCatalogo");
  if (!d.id) throw new Error("Falta el id del producto a editar.");
  validar(d);
  const db = await bd();
  const codigo = normalizarCodigo(d.codigo_barras);
  if (codigo) await verificarCodigoUnico(codigo, d.id);

  const idProd = d.id;
  const ahoraEd = ahoraISO();
  // Igual que al crear: el costo de un kit se RECALCULA desde sus piezas.
  // Aquí es donde más se notaba el fallo, porque el formulario llega
  // precargado con el costo viejo y lo reenviaba tal cual.
  const costoFinalEd = d.es_kit
    ? await costoCalculadoKit(d.componentes)
    : d.costo_centavos;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE productos SET
        codigo_barras = ?, nombre = ?, categoria_id = ?, precio_venta_centavos = ?,
        costo_centavos = ?, precio_mayoreo_centavos = ?, controla_stock = ?,
        stock = ?, stock_minimo = ?, unidad = ?, es_kit = ?, favorito = ?, imagen_uri = ?,
        iva_tasa = ?, actualizado_en = ?
       WHERE id = ?`,
      [
        codigo, d.nombre.trim(), d.categoria_id, d.precio_venta_centavos,
        costoFinalEd, d.precio_mayoreo_centavos,
        d.es_kit ? 0 : d.controla_stock ? 1 : 0,
        d.es_kit ? 0 : d.stock,
        d.stock_minimo, d.unidad, d.es_kit ? 1 : 0, d.favorito ? 1 : 0,
        d.imagen_uri, d.iva_tasa, ahoraEd, idProd,
      ]
    );
    if (d.es_kit) await guardarComponentes(idProd, d.componentes);
    else await bajaComponentes(idProd);

    await encolar("productos", idProd, {
      id: idProd, codigo_barras: codigo, nombre: d.nombre.trim(),
      categoria_id: d.categoria_id, precio_venta_centavos: d.precio_venta_centavos,
      costo_centavos: costoFinalEd, precio_mayoreo_centavos: d.precio_mayoreo_centavos,
      // `iva_tasa` SÍ se manda ahora (mismo motivo que en crearProducto,
      // ver ese comentario). `cantidad_mayoreo` se sigue omitiendo: el móvil
      // no implementa mayoreo automático todavía.
      controla_stock: d.es_kit ? 0 : d.controla_stock ? 1 : 0,
      stock: d.es_kit ? 0 : d.stock, unidad: d.unidad, stock_minimo: d.stock_minimo,
      favorito: d.favorito ? 1 : 0, es_kit: d.es_kit ? 1 : 0, iva_tasa: d.iva_tasa,
      eliminado: 0, actualizado_en: ahoraEd,
    }, "update");
  });
}

export async function eliminarProducto(id: string): Promise<void> {
  await exigirPermiso("editarCatalogo");
  const db = await bd();
  const p = await db.getFirstAsync<{ imagen_uri: string | null }>(
    "SELECT imagen_uri FROM productos WHERE id = ?", [id]
  );
  await borrarImagen(p?.imagen_uri ?? null);
  // Baja suave de los componentes de este kit. Los kits de OTROS productos
  // que usaban este como pieza se quedan: el producto está eliminado y el
  // catálogo ya lo refleja; borrarlos aquí perdería la composición histórica.
  await bajaComponentes(id);
  const ahoraEl = ahoraISO();
  await db.runAsync(
    "UPDATE productos SET eliminado = 1, actualizado_en = ? WHERE id = ?",
    [ahoraEl, id]
  );
  await encolar("productos", id, { id, eliminado: 1, actualizado_en: ahoraEl }, "update");
}

// ---------------------------------------------------------------------------
// Ajustes de stock CON RASTRO
// ---------------------------------------------------------------------------

export type MotivoAjuste = "ajuste" | "resurtido" | "conteo";

export async function ajustarStock(
  productoId: string,
  nuevoStock: number,
  motivo: MotivoAjuste
): Promise<void> {
  await exigirPermiso("ajustarStock");
  const db = await bd();
  // Antes: el UPDATE de stock y el INSERT del rastro en ajustes_inventario
  // eran dos llamadas sueltas. El propio encabezado de este archivo dice
  // "todo ajuste de stock deja rastro" — sin transacción, un fallo entre
  // las dos dejaba un cambio de stock SIN rastro, justo lo que esa regla
  // dice que nunca debería pasar.
  await db.withTransactionAsync(async () => {
    const p = await db.getFirstAsync<{ stock: number }>(
      "SELECT stock FROM productos WHERE id = ?", [productoId]
    );
    if (!p) throw new Error("Producto no encontrado.");
    const ahora = ahoraISO();
    await db.runAsync(
      "UPDATE productos SET stock = ?, actualizado_en = ? WHERE id = ?",
      [nuevoStock, ahora, productoId]
    );
    await db.runAsync(
      `INSERT INTO ajustes_inventario (id, producto_id, stock_antes, stock_despues, motivo, creado_en)
       VALUES (?,?,?,?,?,?)`,
      [uuid(), productoId, p.stock, nuevoStock, motivo, ahora]
    );
    await encolar("productos", productoId, {
      id: productoId, stock: nuevoStock, actualizado_en: ahora,
    }, "update");
  });
}

export async function historialAjustes(productoId: string, limite = 10) {
  const db = await bd();
  return db.getAllAsync<{
    stock_antes: number; stock_despues: number; motivo: string; creado_en: string;
  }>(
    `SELECT stock_antes, stock_despues, motivo, creado_en
     FROM ajustes_inventario WHERE producto_id = ?
     ORDER BY creado_en DESC LIMIT ?`,
    [productoId, limite]
  );
}

// ---------------------------------------------------------------------------
// Resurtido desde ticket escaneado
// ---------------------------------------------------------------------------

export type LineaResurtido = {
  productoId: string | null;
  nombre: string;
  codigo_barras: string | null;
  piezas: number;
  costo_centavos: number;
  precio_centavos: number | null;
  aliasClaves?: string[];
  aliasMuestra?: string;
  piezasEmpaque?: number | null;
  departamentoId?: string | null;
};

export type ResultadoResurtido = {
  actualizados: number;
  creados: number;
  piezas: number;
};

export async function aplicarResurtido(
  lineas: LineaResurtido[]
): Promise<ResultadoResurtido> {
  await exigirPermiso("ajustarStock");
  const db = await bd();
  const res: ResultadoResurtido = { actualizados: 0, creados: 0, piezas: 0 };

  await db.withTransactionAsync(async () => {
    for (const l of lineas) {
      if (l.piezas <= 0) continue;
      const ahora = ahoraISO();

      if (l.productoId) {
        const p = await db.getFirstAsync<{ stock: number }>(
          "SELECT stock FROM productos WHERE id = ?", [l.productoId]
        );
        if (!p) throw new Error("Un producto del ticket ya no existe.");
        const stockNuevo = p.stock + l.piezas;
        const cambiaPrecio = l.precio_centavos != null;

        await db.runAsync(
          `UPDATE productos SET stock = ?, costo_centavos = ?,
             ${cambiaPrecio ? "precio_venta_centavos = ?," : ""} actualizado_en = ?
           WHERE id = ?`,
          cambiaPrecio
            ? [stockNuevo, l.costo_centavos, l.precio_centavos, ahora, l.productoId]
            : [stockNuevo, l.costo_centavos, ahora, l.productoId]
        );
        await db.runAsync(
          `INSERT INTO ajustes_inventario (id, producto_id, stock_antes, stock_despues, motivo, creado_en)
           VALUES (?,?,?,?,?,?)`,
          [uuid(), l.productoId, p.stock, stockNuevo, "resurtido", ahora]
        );
        const payload: Record<string, any> = {
          id: l.productoId, stock: stockNuevo, costo_centavos: l.costo_centavos,
          actualizado_en: ahora,
        };
        if (cambiaPrecio) payload.precio_venta_centavos = l.precio_centavos;
        await encolar("productos", l.productoId, payload, "update");
        if (l.aliasClaves) {
          for (const clave of l.aliasClaves) {
            await guardarAlias(clave, l.aliasMuestra ?? clave, l.productoId, l.piezasEmpaque ?? null);
          }
        }
        const clavePerfil = l.aliasClaves?.[0] ?? "";
        if (clavePerfil) {
          const pInfo = await db.getFirstAsync<{ categoria_id: string | null }>(
            "SELECT categoria_id FROM productos WHERE id = ?", [l.productoId]
          );
          void guardarPerfilProducto(clavePerfil, pInfo?.categoria_id ?? null, l.costo_centavos, l.piezasEmpaque ?? null);
        }
        // Ancla histórica: el costo vigente tras aplicar quedó CONFIRMADO
        // por el tendero (aplicado o conservado a propósito).
        await registrarHistorialCosto(db, l.productoId, l.costo_centavos, ahora);
        res.actualizados++;
      } else {
        const id = await crearProducto({
          codigo_barras: l.codigo_barras, nombre: l.nombre,
          categoria_id: l.departamentoId ?? null,
          precio_venta_centavos: l.precio_centavos ?? 0,
          costo_centavos: l.costo_centavos, precio_mayoreo_centavos: null,
          controla_stock: true, stock: l.piezas, stock_minimo: 0,
          unidad: "pieza", es_kit: false, favorito: false, imagen_uri: null,
          // El ticket del proveedor no trae dato de IVA — 0 (exento) es el
          // default seguro, igual que el DEFAULT de la columna en SQLite.
          // El dueño lo corrige después desde el catálogo si el producto sí
          // lleva impuesto.
          iva_tasa: 0,
          componentes: [],
        });
        const clavePerfilNuevo = l.aliasClaves?.[0] ?? "";
        if (clavePerfilNuevo) {
          void guardarPerfilProducto(clavePerfilNuevo, l.departamentoId ?? null, l.costo_centavos, l.piezasEmpaque ?? null);
        }
        await db.runAsync(
          `INSERT INTO ajustes_inventario (id, producto_id, stock_antes, stock_despues, motivo, creado_en)
           VALUES (?,?,?,?,?,?)`,
          [uuid(), id, 0, l.piezas, "resurtido", ahora]
        );
        if (l.aliasClaves) {
          for (const clave of l.aliasClaves) {
            await guardarAlias(clave, l.aliasMuestra ?? clave, id, l.piezasEmpaque ?? null);
          }
        }
        // Ancla histórica: primer costo confirmado del producto nuevo.
        await registrarHistorialCosto(db, id, l.costo_centavos, ahora);
        res.creados++;
      }
      res.piezas += l.piezas;
    }
  });

  return res;
}

// ---------------------------------------------------------------------------
// Categorías / Departamentos
// ---------------------------------------------------------------------------

export async function listarCategorias(): Promise<Categoria[]> {
  const db = await bd();
  return db.getAllAsync<Categoria>(
    "SELECT id, nombre, orden, color, icono FROM categorias WHERE eliminado = 0 ORDER BY orden, nombre COLLATE NOCASE"
  );
}

export async function crearCategoria(
  nombre: string, color: string, icono: string
): Promise<string> {
  await exigirPermiso("editarCatalogo");
  if (!nombre.trim()) throw new Error("El nombre del departamento no puede estar vacío.");
  const db = await bd();
  const orden = (await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM categorias WHERE eliminado = 0"
  ))?.n ?? 0;
  const id = uuid();
  const ahora = ahoraISO();
  await db.runAsync(
    `INSERT INTO categorias (id, nombre, orden, color, icono, activo, eliminado, creado_en, actualizado_en)
     VALUES (?,?,?,?,?,1,0,?,?)`,
    [id, nombre.trim(), orden, color, icono, ahora, ahora]
  );
  await encolar("categorias", id, {
    // `orden` e `icono` existen en el móvil y, desde la migración de esta
    // ronda, también en Postgres. Sin mandarlos, reordenar o poner icono a
    // un departamento desde el teléfono nunca se veía en el PC.
    id, nombre: nombre.trim(), color, orden, icono: icono ?? null,
    eliminado: 0, creado_en: ahora, actualizado_en: ahora,
  });
  return id;
}

export async function editarCategoria(
  id: string, nombre: string, color: string, icono: string
): Promise<void> {
  await exigirPermiso("editarCatalogo");
  if (!nombre.trim()) throw new Error("El nombre del departamento no puede estar vacío.");
  const db = await bd();
  const ahoraCat = ahoraISO();
  await db.runAsync(
    "UPDATE categorias SET nombre = ?, color = ?, icono = ?, actualizado_en = ? WHERE id = ?",
    [nombre.trim(), color, icono, ahoraCat, id]
  );
  await encolar("categorias", id, {
    id, nombre: nombre.trim(), color, actualizado_en: ahoraCat,
  }, "update");
}

export async function conteoPorDepartamento(): Promise<Map<string, number>> {
  const db = await bd();
  const filas = await db.getAllAsync<{ cid: string | null; n: number }>(
    `SELECT categoria_id AS cid, COUNT(*) AS n FROM productos
     WHERE eliminado = 0 GROUP BY categoria_id`
  );
  const m = new Map<string, number>();
  for (const f of filas) m.set(f.cid ?? "__sin__", f.n);
  return m;
}

export async function eliminarCategoria(id: string): Promise<void> {
  await exigirPermiso("editarCatalogo");
  const db = await bd();
  await db.runAsync("UPDATE productos SET categoria_id = NULL WHERE categoria_id = ?", [id]);
  const ahoraEC = ahoraISO();
  await db.runAsync(
    "UPDATE categorias SET eliminado = 1, actualizado_en = ? WHERE id = ?",
    [ahoraEC, id]
  );
  await encolar("categorias", id, { id, eliminado: 1, actualizado_en: ahoraEC }, "update");
}

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------

export type MetricasInventario = {
  total_productos: number;
  valor_costo_centavos: number;
  // Lo mismo que valor_costo_centavos pero a precio de venta: cuánto
  // entraría si se vendiera TODO el inventario tal como está hoy. Ambas
  // cifras conviven en el mismo dato porque la pantalla las intercambia
  // sin volver a consultar la base.
  valor_precio_centavos: number;
  margen_promedio: number | null;
  stock_bajo: number;
  en_negativo: number;
};

export async function metricasInventario(): Promise<MetricasInventario> {
  const db = await bd();
  const base = await db.getFirstAsync<{
    total: number; valor: number; valorVenta: number; bajo: number; neg: number;
  }>(`
    SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN es_kit = 0 AND controla_stock = 1
        THEN COALESCE(costo_centavos,0) * stock ELSE 0 END), 0) AS valor,
      COALESCE(SUM(CASE WHEN es_kit = 0 AND controla_stock = 1
        THEN precio_venta_centavos * stock ELSE 0 END), 0) AS valorVenta,
      COALESCE(SUM(CASE WHEN es_kit = 0 AND controla_stock = 1 AND stock <= stock_minimo
        THEN 1 ELSE 0 END), 0) AS bajo,
      COALESCE(SUM(CASE WHEN es_kit = 0 AND controla_stock = 1 AND stock < 0
        THEN 1 ELSE 0 END), 0) AS neg
    FROM productos WHERE eliminado = 0
  `);
  const margen = await db.getFirstAsync<{ m: number | null }>(`
    SELECT AVG(CASE WHEN costo_centavos IS NOT NULL AND precio_venta_centavos > 0
      THEN (precio_venta_centavos - costo_centavos) * 100.0 / precio_venta_centavos
      ELSE NULL END) AS m
    FROM productos WHERE eliminado = 0
  `);
  return {
    total_productos: base?.total ?? 0,
    valor_costo_centavos: Math.round(base?.valor ?? 0),
    valor_precio_centavos: Math.round(base?.valorVenta ?? 0),
    margen_promedio: margen?.m ?? null,
    stock_bajo: base?.bajo ?? 0,
    en_negativo: base?.neg ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Reporte por departamento
// ---------------------------------------------------------------------------

export type FilaReporte = {
  categoria_id: string | null;
  categoria: string;
  color: string | null;
  productos: number;
  unidades: number;
  valor_costo_centavos: number;
  valor_precio_centavos: number;
};

export async function reportePorDepartamento(): Promise<FilaReporte[]> {
  const db = await bd();
  return db.getAllAsync<FilaReporte>(`
    SELECT p.categoria_id, COALESCE(c.nombre, 'Sin departamento') AS categoria,
      c.color AS color, COUNT(*) AS productos,
      COALESCE(SUM(CASE WHEN p.controla_stock = 1 THEN p.stock ELSE 0 END), 0) AS unidades,
      COALESCE(SUM(CASE WHEN p.controla_stock = 1
        THEN COALESCE(p.costo_centavos,0) * p.stock ELSE 0 END), 0) AS valor_costo_centavos,
      COALESCE(SUM(CASE WHEN p.controla_stock = 1
        THEN p.precio_venta_centavos * p.stock ELSE 0 END), 0) AS valor_precio_centavos
    FROM productos p LEFT JOIN categorias c ON c.id = p.categoria_id
    WHERE p.eliminado = 0 AND p.es_kit = 0
    GROUP BY p.categoria_id ORDER BY valor_costo_centavos DESC
  `);
}

// ---------------------------------------------------------------------------
// Conteo físico
// ---------------------------------------------------------------------------

export type ProductoConteo = {
  id: string;
  nombre: string;
  codigo_barras: string | null;
  stock: number;
  unidad: string;
};

export async function productosParaConteo(categoriaId: string | null): Promise<ProductoConteo[]> {
  const db = await bd();
  const cond = categoriaId ? "AND categoria_id = ?" : "";
  const args = categoriaId ? [categoriaId] : [];
  return db.getAllAsync<ProductoConteo>(
    `SELECT id, nombre, codigo_barras, stock, unidad FROM productos
     WHERE eliminado = 0 AND es_kit = 0 AND controla_stock = 1 ${cond}
     ORDER BY nombre COLLATE NOCASE`,
    args
  );
}

export type Diferencia = {
  id: string;
  nombre: string;
  sistema: number;
  contado: number;
  diferencia: number;
};

export async function aplicarConteo(diferencias: Diferencia[]): Promise<number> {
  let aplicadas = 0;
  for (const d of diferencias) {
    if (d.diferencia === 0) continue;
    await ajustarStock(d.id, d.contado, "conteo");
    aplicadas++;
  }
  return aplicadas;
}

// ---------------------------------------------------------------------------
// Diccionario del negocio (alias de nombres de ticket → producto)
// ---------------------------------------------------------------------------

export type EntradaAlias = {
  productoId: string;
  piezasEmpaque: number | null;
};

export async function cargarMapaAlias(): Promise<Map<string, EntradaAlias>> {
  const db = await bd();
  const filas = await db.getAllAsync<{
    clave: string; producto_id: string; piezas_empaque: number | null;
  }>(
    `SELECT a.clave, a.producto_id, a.piezas_empaque FROM alias_ticket a
     JOIN productos p ON p.id = a.producto_id WHERE p.eliminado = 0`
  );
  const mapa = new Map<string, EntradaAlias>();
  for (const f of filas) {
    mapa.set(f.clave, { productoId: f.producto_id, piezasEmpaque: f.piezas_empaque ?? null });
  }
  return mapa;
}

export async function guardarAlias(
  clave: string, muestra: string, productoId: string, piezasEmpaque: number | null = null
): Promise<void> {
  if (!clave) return;
  try {
    const db = await bd();
    const ahora = ahoraISO();
    await db.runAsync(
      `INSERT INTO alias_ticket (id, clave, muestra, producto_id, piezas_empaque, veces, creado_en, actualizado_en)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(clave) DO UPDATE SET
         producto_id = excluded.producto_id, muestra = excluded.muestra,
         piezas_empaque = excluded.piezas_empaque,
         veces = alias_ticket.veces + 1, actualizado_en = excluded.actualizado_en`,
      [uuid(), clave, muestra, productoId, piezasEmpaque, 1, ahora, ahora]
    );
  } catch (e) {
    console.warn("No se pudo guardar el alias del ticket:", e);
  }
}

// ---------------------------------------------------------------------------
// Perfil de producto por departamento (validación de escaneos futuros)
// ---------------------------------------------------------------------------

export type PerfilProducto = {
  clave: string;
  departamentoId: string | null;
  costoCentavos: number;
  piezasEmpaque: number | null;
  veces: number;
};

export async function guardarPerfilProducto(
  clave: string, departamentoId: string | null, costoCentavos: number, piezasEmpaque: number | null = null
): Promise<void> {
  if (!clave) return;
  try {
    const db = await bd();
    const ahora = ahoraISO();
    await db.runAsync(
      `INSERT INTO perfil_producto (id, clave, departamento_id, costo_centavos, piezas_empaque, veces, creado_en, actualizado_en)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(clave) DO UPDATE SET
         departamento_id = excluded.departamento_id, costo_centavos = excluded.costo_centavos,
         piezas_empaque = excluded.piezas_empaque, veces = perfil_producto.veces + 1,
         actualizado_en = excluded.actualizado_en`,
      [uuid(), clave, departamentoId, costoCentavos, piezasEmpaque, 1, ahora, ahora]
    );
  } catch (e) {
    console.warn("No se pudo guardar el perfil de producto:", e);
  }
}

export async function cargarMapaPerfiles(): Promise<Map<string, PerfilProducto>> {
  const db = await bd();
  const filas = await db.getAllAsync<{
    clave: string; departamento_id: string | null;
    costo_centavos: number; piezas_empaque: number | null; veces: number;
  }>(
    `SELECT clave, departamento_id, costo_centavos, piezas_empaque, veces
     FROM perfil_producto WHERE veces >= 1`
  );
  const mapa = new Map<string, PerfilProducto>();
  for (const f of filas) {
    mapa.set(f.clave, {
      clave: f.clave, departamentoId: f.departamento_id, costoCentavos: f.costo_centavos,
      piezasEmpaque: f.piezas_empaque, veces: f.veces,
    });
  }
  return mapa;
}

// ---------------------------------------------------------------------------
// Ancla histórica de costo (tabla historial_costos, migración v12)
// ---------------------------------------------------------------------------

/** Inserta el costo CONFIRMADO de un producto y poda el historial a las 20
 *  confirmaciones más recientes. Se llama DENTRO de la transacción de
 *  aplicarResurtido (misma transacción: stock, costo, alias e historial
 *  quedan o no quedan, todo junto). */
async function registrarHistorialCosto(
  db: Awaited<ReturnType<typeof bd>>,
  productoId: string,
  costoCentavos: number,
  ahora: string
): Promise<void> {
  if (!productoId || !Number.isFinite(costoCentavos) || costoCentavos <= 0)
    return;
  await db.runAsync(
    "INSERT INTO historial_costos (id, producto_id, costo_centavos, confirmado_en) VALUES (?,?,?,?)",
    [uuid(), productoId, Math.round(costoCentavos), ahora]
  );
  await db.runAsync(
    `DELETE FROM historial_costos
     WHERE producto_id = ? AND id NOT IN (
       SELECT id FROM historial_costos
       WHERE producto_id = ?
       ORDER BY confirmado_en DESC, rowid DESC
       LIMIT 20
     )`,
    [productoId, productoId]
  );
}

/** Historiales de costo confirmado por producto (centavos, más reciente
 *  primero). UNA sola consulta para todos los emparejados de un ticket. */
export async function cargarHistorialesCostos(
  productoIds: string[]
): Promise<Map<string, number[]>> {
  const mapa = new Map<string, number[]>();
  const ids = [...new Set(productoIds.filter(Boolean))];
  if (!ids.length) return mapa;
  const db = await bd();
  const marcas = ids.map(() => "?").join(",");
  const filas = await db.getAllAsync<{
    producto_id: string;
    costo_centavos: number;
  }>(
    `SELECT producto_id, costo_centavos
     FROM historial_costos
     WHERE producto_id IN (${marcas})
     ORDER BY confirmado_en DESC, rowid DESC`,
    ids
  );
  for (const f of filas) {
    const lista = mapa.get(f.producto_id) ?? [];
    lista.push(f.costo_centavos);
    mapa.set(f.producto_id, lista);
  }
  return mapa;
}

// ---------------------------------------------------------------------------
// Catálogo para la IA del escáner (se ENVÍA en el body de POST /ia/ticket)
// ---------------------------------------------------------------------------

/** Una entrada del catálogo que viaja al backend de IA. Sin id: el backend
 *  responde con catalogo_idx (posición en ESTE arreglo) y el móvil lo
 *  traduce de vuelta con `productoIds` de CatalogoIA. */
export type EntradaCatalogoIA = {
  nombre: string;
  alias: string[];                    // claves del diccionario (máx. 5)
  presentacion: string | null;        // null: no hay dato limpio, no se inventa
  empaque_piezas: number | null;      // pack recordado (null = pieza suelta)
  ultimo_costo_centavos: number | null;
};

export type CatalogoIA = {
  paraEnvio: EntradaCatalogoIA[];
  productoIds: string[]; // productoIds[i] = id local de paraEnvio[i]
};

/** Construye el catálogo que acompaña la foto al backend de IA: productos
 *  activos y no eliminados, máx. `limite` (300 por defecto), priorizando los
 *  vendidos más recientemente (venta_lineas/ventas) y, a falta de ventas,
 *  los actualizados más recientemente. Cada entrada lleva hasta 5 alias del
 *  diccionario (los más recientes primero) y el pack recordado más reciente
 *  si existe. */
export async function catalogoParaIA(limite = 300): Promise<CatalogoIA> {
  const db = await bd();
  const productos = await db.getAllAsync<{
    id: string;
    nombre: string;
    costo_centavos: number | null;
  }>(
    `SELECT p.id, p.nombre, p.costo_centavos
     FROM productos p
     LEFT JOIN (
       SELECT vl.producto_id AS pid, MAX(v.creado_en) AS ultima_venta
       FROM venta_lineas vl
       JOIN ventas v ON v.id = vl.venta_id
       GROUP BY vl.producto_id
     ) uv ON uv.pid = p.id
     WHERE p.eliminado = 0 AND p.activo = 1
     ORDER BY uv.ultima_venta IS NULL, uv.ultima_venta DESC, p.actualizado_en DESC
     LIMIT ?`,
    [limite]
  );
  if (!productos.length) return { paraEnvio: [], productoIds: [] };

  const ids = productos.map((p) => p.id);
  const marcas = ids.map(() => "?").join(",");
  const aliasFilas = await db.getAllAsync<{
    producto_id: string;
    clave: string;
    piezas_empaque: number | null;
  }>(
    `SELECT producto_id, clave, piezas_empaque
     FROM alias_ticket
     WHERE producto_id IN (${marcas})
     ORDER BY actualizado_en DESC`,
    ids
  );

  // Alias: máx. 5 por producto (los más recientes primero). Pack: el no-nulo
  // más reciente (las filas ya vienen en orden de recencia).
  const aliasPorProd = new Map<string, string[]>();
  const packPorProd = new Map<string, number>();
  for (const f of aliasFilas) {
    const lista = aliasPorProd.get(f.producto_id) ?? [];
    if (lista.length < 5 && !lista.includes(f.clave)) lista.push(f.clave);
    aliasPorProd.set(f.producto_id, lista);
    if (
      f.piezas_empaque != null &&
      f.piezas_empaque > 1 &&
      !packPorProd.has(f.producto_id)
    ) {
      packPorProd.set(f.producto_id, f.piezas_empaque);
    }
  }

  const paraEnvio: EntradaCatalogoIA[] = [];
  const productoIds: string[] = [];
  for (const p of productos) {
    productoIds.push(p.id);
    paraEnvio.push({
      nombre: p.nombre,
      alias: aliasPorProd.get(p.id) ?? [],
      presentacion: null,
      empaque_piezas: packPorProd.get(p.id) ?? null,
      ultimo_costo_centavos: p.costo_centavos ?? null,
    });
  }
  return { paraEnvio, productoIds };
}
