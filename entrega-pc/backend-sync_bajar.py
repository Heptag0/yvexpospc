"""Emisor de sincronización — el lado que faltaba: BAJAR cambios del negocio.

Hasta ahora la nube solo RECIBÍA (sync.py). Este módulo permite que un
dispositivo se DESCARGUE lo que cambió en su negocio: el catálogo (categorías
y productos) y las ventas de las otras cajas.

Con esto la sincronización es bidireccional:
    PC  --subir-->  NUBE  --bajar-->  MÓVIL
    MÓVIL --subir-->  NUBE  --bajar-->  PC

Principios:
  - INCREMENTAL: el dispositivo dice "desde cuándo" y solo recibe lo nuevo.
    La marca es `actualizado_en` (texto ISO, como lo guardan las cajas).
  - AISLAMIENTO: solo se devuelve lo del negocio del dispositivo autenticado.
    El negocio_id sale SIEMPRE del token, nunca del cliente.
  - NO TE DEVUELVO LO TUYO: las ventas que subió este mismo dispositivo se
    excluyen (ya las tiene en local). El catálogo sí viene completo: es
    compartido y el dispositivo necesita la versión canónica del negocio.
  - PAGINADO: un tope por página evita respuestas enormes en catálogos grandes.

NOTA SOBRE LOS CASTS:
  1. IDs: las columnas son `uuid` y los parámetros llegan como texto. Postgres
     NO castea implícitamente uuid <-> text ("operator does not exist"), así que
     toda comparación lleva CAST. Para listas: CAST(:ids AS uuid[]).

  2. FECHAS — y esto es CRÍTICO: `actualizado_en` se guarda como TEXTO ISO, pero
     cada cliente usa su propio formato:
         PC:    2026-07-02T02:53:44.723252600+00:00   (offset explícito)
         Móvil: 2026-07-12T23:49:00.000Z              (sufijo Z)
     Comparar eso como texto es una BOMBA: el orden lexicográfico no coincide
     con el orden temporal cuando los formatos difieren. Un producto de julio 2
     "parece menor" que una marca de julio 12 aunque el cliente nunca lo haya
     recibido... y con otros formatos podría pasar lo contrario.
     Por eso comparamos como TIMESTAMP REAL:
         CAST(actualizado_en AS timestamptz) > CAST(:desde AS timestamptz)
     Postgres entiende ambos formatos ISO y los ordena por tiempo de verdad.
"""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from models import Dispositivo
from sync import dispositivo_actual  # reutiliza la misma autenticación

router = APIRouter()

# Tope de filas por entidad y por página. Suficiente para catálogos normales
# y evita que una respuesta se dispare en memoria.
LIMITE = 500

# Marca inicial cuando el dispositivo nunca ha sincronizado.
EPOCA = "1970-01-01T00:00:00Z"


class BajadaResp(BaseModel):
    # Marca hasta la que llegó esta bajada. El dispositivo la guarda y la manda
    # en la próxima petición. Si hay_mas=True, debe volver a pedir enseguida.
    hasta: str
    hay_mas: bool
    categorias: list[dict]
    productos: list[dict]
    ventas: list[dict]
    venta_lineas: list[dict]
    pagos: list[dict]
    caja_sesiones: list[dict]
    # Usuarios (cajeros) de OTRAS cajas: para que los reportes y etiquetas
    # muestren el nombre real de quién vendió, no "Otra caja". NUNCA incluye
    # pin_hash: un PIN de una caja no debe viajar a otra.
    usuarios: list[dict] = []


def _filas(db: Session, sql: str, params: dict) -> list[dict]:
    """Ejecuta y devuelve filas como dicts JSON-serializables."""
    res = db.execute(text(sql), params)
    cols = res.keys()
    salida = []
    for fila in res.fetchall():
        d = {}
        for c, v in zip(cols, fila):
            # UUID -> str; el resto (int, float, bool, str, None) va tal cual.
            d[c] = str(v) if hasattr(v, "hex") else v
        salida.append(d)
    return salida


@router.get("/sync/bajar", response_model=BajadaResp)
def bajar(
    desde: str | None = Query(None, description="ISO UTC de la última bajada"),
    con_ventas: bool = Query(True, description="Incluir ventas de otras cajas"),
    disp: Dispositivo = Depends(dispositivo_actual),
    db: Session = Depends(get_db),
):
    negocio_id = str(disp.negocio_id)
    marca = desde or EPOCA
    base = {"neg": negocio_id, "desde": marca, "disp": str(disp.id), "lim": LIMITE}

    # --- Catálogo: viene completo (es compartido; el dispositivo lo adopta) ---
    categorias = _filas(db, """
        SELECT id, nombre, color, eliminado, creado_en, actualizado_en
        FROM categorias
        WHERE negocio_id = CAST(:neg AS uuid)
          AND CAST(actualizado_en AS timestamptz) > CAST(:desde AS timestamptz)
        ORDER BY CAST(actualizado_en AS timestamptz)
        LIMIT :lim
    """, base)

    productos = _filas(db, """
        SELECT id, codigo_barras, nombre, categoria_id, precio_venta_centavos,
               costo_centavos, precio_mayoreo_centavos, controla_stock, stock,
               stock_minimo, unidad, es_kit, eliminado, creado_en, actualizado_en
        FROM productos
        WHERE negocio_id = CAST(:neg AS uuid)
          AND CAST(actualizado_en AS timestamptz) > CAST(:desde AS timestamptz)
        ORDER BY CAST(actualizado_en AS timestamptz)
        LIMIT :lim
    """, base)

    ventas = []
    venta_lineas = []
    pagos = []
    caja_sesiones = []

    if con_ventas:
        # Turnos de OTRAS cajas (los propios ya los tiene en local).
        caja_sesiones = _filas(db, """
            SELECT id, dispositivo_id, usuario_pos_id, fondo_inicial_centavos,
                   abierta_en, cerrada_en, estado, actualizado_en
            FROM caja_sesiones
            WHERE negocio_id = CAST(:neg AS uuid)
              AND dispositivo_id <> CAST(:disp AS uuid)
              AND CAST(actualizado_en AS timestamptz) > CAST(:desde AS timestamptz)
            ORDER BY CAST(actualizado_en AS timestamptz)
            LIMIT :lim
        """, base)

        # Ventas de OTRAS cajas.
        ventas = _filas(db, """
            SELECT id, dispositivo_id, folio, usuario_pos_id, caja_sesion_id,
                   subtotal_centavos, descuento_centavos, iva_centavos,
                   total_centavos, estado, creado_en, actualizado_en
            FROM ventas
            WHERE negocio_id = CAST(:neg AS uuid)
              AND dispositivo_id <> CAST(:disp AS uuid)
              AND CAST(actualizado_en AS timestamptz) > CAST(:desde AS timestamptz)
            ORDER BY CAST(actualizado_en AS timestamptz)
            LIMIT :lim
        """, base)

        # Líneas y pagos SOLO de las ventas que van en esta página, para que la
        # respuesta sea coherente (nunca una línea sin su venta).
        ids = [v["id"] for v in ventas]
        if ids:
            venta_lineas = _filas(db, """
                SELECT id, venta_id, producto_id, descripcion, cantidad,
                       precio_unitario_centavos, descuento_linea_centavos,
                       total_linea_centavos, creado_en
                FROM venta_lineas
                WHERE negocio_id = CAST(:neg AS uuid)
                  AND venta_id = ANY(CAST(:ids AS uuid[]))
            """, {"neg": negocio_id, "ids": ids})

            pagos = _filas(db, """
                SELECT id, venta_id, metodo, monto_centavos, creado_en
                FROM pagos
                WHERE negocio_id = CAST(:neg AS uuid)
                  AND venta_id = ANY(CAST(:ids AS uuid[]))
            """, {"neg": negocio_id, "ids": ids})

    # --- Usuarios de OTRAS cajas (sin PIN): para etiquetar ventas con el
    # nombre real del cajero en reportes y tickets. También es incremental:
    # solo viajan los que cambiaron desde la marca. ---
    usuarios = _filas(db, """
        SELECT id, dispositivo_id, nombre, rol, activo, eliminado,
               creado_en, actualizado_en
        FROM usuarios_pos
        WHERE negocio_id = CAST(:neg AS uuid)
          AND dispositivo_id <> CAST(:disp AS uuid)
          AND CAST(actualizado_en AS timestamptz) > CAST(:desde AS timestamptz)
        ORDER BY CAST(actualizado_en AS timestamptz)
        LIMIT :lim
    """, base)

    # --- Nueva marca: el mayor actualizado_en REAL de lo que devolvimos ---
    # Ojo: max() sobre texto daría el máximo LEXICOGRÁFICO, que no es el máximo
    # temporal cuando hay formatos mezclados. Lo calculamos en Postgres, que sí
    # sabe comparar tiempos, y lo devolvemos NORMALIZADO en ISO con Z.
    marcas = [
        f["actualizado_en"]
        for grupo in (categorias, productos, ventas, caja_sesiones, usuarios)
        for f in grupo
        if f.get("actualizado_en")
    ]
    if marcas:
        hasta = db.execute(
            text("""
                SELECT to_char(
                    MAX(CAST(m AS timestamptz)) AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                )
                FROM unnest(CAST(:marcas AS text[])) AS m
            """),
            {"marcas": marcas},
        ).scalar() or marca
    else:
        hasta = marca

    # ¿Alguna entidad llegó al tope? Entonces hay más y el cliente debe repetir.
    hay_mas = any(
        len(g) >= LIMITE for g in (categorias, productos, ventas, caja_sesiones, usuarios)
    )

    return BajadaResp(
        hasta=hasta,
        hay_mas=hay_mas,
        categorias=categorias,
        productos=productos,
        ventas=ventas,
        venta_lineas=venta_lineas,
        pagos=pagos,
        caja_sesiones=caja_sesiones,
        usuarios=usuarios,
    )
