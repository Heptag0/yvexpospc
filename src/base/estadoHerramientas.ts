// YvexPOS Móvil — Estado real de cada herramienta.
//
// ---------------------------------------------------------------------------
// POR QUÉ EXISTE
// ---------------------------------------------------------------------------
// El panel de Herramientas listaba doce filas con una DESCRIPCIÓN cada una:
// "Quién te debe, cuánto, y abona rápido". Es correcto y no dice nada: la
// misma frase el primer día y el día trescientos. Doce descripciones apiladas
// se leen como un menú de ajustes, y ahí viven Cotizaciones, Crédito, Recetas,
// Etiquetado NOM o la tienda en línea — media docena de cosas que la
// competencia no tiene.
//
// Una herramienta que REPORTA ("Crédito · $310.00 por cobrar de 3 clientes")
// deja de ser una opción de menú y pasa a ser un panel de instrumentos.
//
// ---------------------------------------------------------------------------
// LA REGLA: sin dato real, no hay estado
// ---------------------------------------------------------------------------
// Cada función devuelve `null` cuando la herramienta NO se ha usado nunca. El
// panel entonces cae a la descripción de siempre. Nunca se pinta un "0" ni un
// hueco.
//
// Esto tiene una propiedad que vale la pena conservar: un usuario nuevo ve
// DESCRIPCIONES, que es exactamente lo que necesita para entender qué hay ahí;
// y uno con meses de uso ve CIFRAS, que es lo que necesita para decidir dónde
// entrar. La misma pantalla enseña al principio e informa después, sin un
// interruptor que alguien tenga que encontrar.
//
// ---------------------------------------------------------------------------
// TODO ES LOCAL Y TOLERANTE A FALLOS
// ---------------------------------------------------------------------------
// Solo SQL contra la base del teléfono: el panel abre igual sin señal. Cada
// consulta va en su try/catch y devuelve null si algo falla — una tabla que
// todavía no existe en una instalación vieja no puede impedir que se abra
// Herramientas.
//
// El estado de la tienda en línea y los pedidos web NO están aquí: dependen
// del servidor y ya los consulta Inicio con estadoTienda(). Se inyectan al
// panel desde fuera.

import { bd } from "./db";
import { puede } from "./permisos";
import { pesos } from "./formato";
import { IdHerramienta } from "./herramientas";

/** Lo que se pinta en la fila, en lugar de la descripción. */
export type EstadoHerramienta = {
  /** Texto corto. Puede llevar montos ya formateados. */
  texto: string;
  /** Hay algo que atender: la fila se marca. No es lo mismo "tienes 4
   *  proveedores" que "3 clientes te deben dinero". */
  atencion?: boolean;
};

export type MapaEstados = Partial<Record<IdHerramienta, EstadoHerramienta>>;

/** ISO UTC del primer instante del mes local en curso. */
function inicioMesLocalISO(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Fecha local YYYY-MM-01, para las tablas que guardan fecha y no instante. */
function primerDiaMesYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

/**
 * Estados de todas las herramientas locales.
 *
 * Se resuelve en paralelo y ninguna consulta puede tumbar a las demás: cada
 * bloque tiene su try/catch y, ante cualquier problema, esa herramienta se
 * queda sin estado y cae a su descripción.
 */
export async function estadosHerramientas(): Promise<MapaEstados> {
  const m: MapaEstados = {};
  let db: Awaited<ReturnType<typeof bd>>;
  try {
    db = await bd();
  } catch {
    return m;
  }

  const uno = async <T>(sql: string, args: unknown[] = []): Promise<T | null> => {
    try {
      return (await db.getFirstAsync<T>(sql, args as never)) ?? null;
    } catch {
      return null;
    }
  };

  // --- Crédito: el ejemplo que da sentido a todo esto ---------------------
  const cred = await uno<{ n: number; total: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(saldo_centavos),0) AS total
     FROM clientes WHERE eliminado = 0 AND saldo_centavos > 0`
  );
  if (cred && cred.n > 0) {
    m.credito = {
      texto: `${pesos(cred.total)} por cobrar de ${plural(cred.n, "cliente", "clientes")}`,
      atencion: true,
    };
  }

  // --- Cotizaciones abiertas ---------------------------------------------
  const cot = await uno<{ n: number; total: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total_centavos),0) AS total
     FROM cotizaciones WHERE eliminado = 0 AND estado = 'abierta'`
  );
  if (cot && cot.n > 0) {
    m.cotizaciones = {
      texto: `${plural(cot.n, "abierta", "abiertas")} por ${pesos(cot.total)}`,
    };
  }

  // --- Clientes y lealtad -------------------------------------------------
  const lea = await uno<{ n: number; pts: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(puntos),0) AS pts
     FROM clientes WHERE eliminado = 0`
  );
  if (lea && lea.n > 0) {
    m.lealtad = {
      texto:
        lea.pts > 0
          ? `${plural(lea.n, "cliente", "clientes")} · ${lea.pts} puntos sin canjear`
          : plural(lea.n, "cliente registrado", "clientes registrados"),
    };
  }

  // --- Productos: el catálogo y lo que se está acabando -------------------
  //
  // El bajo stock solo cuenta productos que CONTROLAN stock y que tienen un
  // mínimo configurado. Sin ese filtro, todo producto sin control saldría
  // como "por resurtir" en cuanto llegara a cero, que es su estado normal.
  const prod = await uno<{ n: number; bajos: number }>(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN controla_stock = 1 AND stock_minimo > 0
                               AND stock <= stock_minimo THEN 1 ELSE 0 END),0) AS bajos
     FROM productos WHERE eliminado = 0 AND activo = 1`
  );
  if (prod && prod.n > 0) {
    m.productos = {
      texto:
        prod.bajos > 0
          ? `${prod.n} en catálogo · ${plural(prod.bajos, "por resurtir", "por resurtir")}`
          : `${plural(prod.n, "producto", "productos")} en catálogo`,
      atencion: prod.bajos > 0,
    };
  }

  // --- Departamentos ------------------------------------------------------
  const dep = await uno<{ n: number }>(
    `SELECT COUNT(*) AS n FROM categorias WHERE eliminado = 0 AND activo = 1`
  );
  if (dep && dep.n > 0) {
    m.departamentos = { texto: plural(dep.n, "departamento", "departamentos") };
  }

  // --- Proveedores y su última compra ------------------------------------
  const prov = await uno<{ n: number }>(
    `SELECT COUNT(*) AS n FROM proveedores WHERE eliminado = 0`
  );
  if (prov && prov.n > 0) {
    const ult = await uno<{ f: string | null }>(
      `SELECT MAX(COALESCE(fecha, creado_en)) AS f FROM compras WHERE eliminado = 0`
    );
    const dias = ult?.f ? diasDesde(ult.f) : null;
    m.proveedores = {
      texto:
        dias === null
          ? plural(prov.n, "proveedor", "proveedores")
          : `${plural(prov.n, "proveedor", "proveedores")} · última compra ${hace(dias)}`,
    };
  }

  // --- Recetas ------------------------------------------------------------
  const rec = await uno<{ n: number }>(
    `SELECT COUNT(*) AS n FROM recetas WHERE eliminado = 0`
  );
  if (rec && rec.n > 0) {
    m.recetas = { texto: plural(rec.n, "receta costeada", "recetas costeadas") };
  }

  // --- Etiquetado NOM -----------------------------------------------------
  const eti = await uno<{ n: number }>(
    `SELECT COUNT(*) AS n FROM perfiles_etiqueta WHERE eliminado = 0`
  );
  if (eti && eti.n > 0) {
    m.etiquetas = { texto: plural(eti.n, "etiqueta guardada", "etiquetas guardadas") };
  }

  // --- Devoluciones del mes ----------------------------------------------
  //
  // Mismo filtro que en reportes.ts y en el corte: sin el JOIN, una venta
  // CANCELADA (que devoluciones.ts implementa como devolución total) contaría
  // aquí como si el cliente hubiera regresado mercancía.
  const dev = await uno<{ n: number; total: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(dv.total_devuelto_centavos),0) AS total
     FROM devoluciones dv JOIN ventas v ON v.id = dv.venta_id
     WHERE v.estado <> 'cancelada' AND dv.creado_en >= ?`,
    [inicioMesLocalISO()]
  );
  if (dev && dev.n > 0) {
    m.devoluciones = {
      texto: `${pesos(dev.total)} devueltos este mes`,
    };
  }

  // --- Dinero: gastos del mes --------------------------------------------
  //
  // Detrás de permiso. Los gastos del negocio (y los de casa, que esta
  // herramienta también guarda) no son algo que un dueño de tiendita ponga
  // delante de su cajero. Se usa "verReportes", que es el permiso que ya
  // protege ganancias y márgenes: misma clase de información.
  //
  // puede() no lanza — devuelve false y aquí simplemente no hay estado.
  try {
    if (await puede("verReportes")) {
      const gas = await uno<{ total: number }>(
        `SELECT COALESCE(SUM(monto_centavos),0) AS total
         FROM gastos WHERE eliminado = 0 AND ambito = 'negocio' AND fecha >= ?`,
        [primerDiaMesYmd()]
      );
      if (gas && gas.total > 0) {
        m.dinero = { texto: `${pesos(gas.total)} en gastos este mes` };
      }
    }
  } catch {
    // Sin permiso resuelto, sin estado. La fila cae a su descripción.
  }

  return m;
}

/** Días completos entre una fecha (ISO o YYYY-MM-DD) y hoy. null si no parsea. */
function diasDesde(fecha: string): number | null {
  const t = Date.parse(fecha);
  if (Number.isNaN(t)) return null;
  const ms = Date.now() - t;
  if (ms < 0) return 0;
  return Math.floor(ms / 86400000);
}

function hace(dias: number): string {
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias < 7) return `hace ${dias} días`;
  if (dias < 14) return "hace una semana";
  if (dias < 60) return `hace ${Math.round(dias / 7)} semanas`;
  return `hace ${Math.round(dias / 30)} meses`;
}
