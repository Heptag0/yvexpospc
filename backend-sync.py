"""Receptor de sincronización genérico — el "aplicador de operaciones".

Recibe la lista de operaciones tal como el PC las tiene en cola_sync:
    { entidad, entidad_id, operacion, payload }
y aplica cada una a la tabla espejo correspondiente con un UPSERT.

Principios de diseño (robustez a futuro):
  - El empujador del PC es "tonto": manda las filas de cola_sync tal cual. Toda
    la inteligencia de mapeo vive aquí. Añadir una entidad nueva = añadir una
    entrada al MAPA, sin tocar el PC.
  - LISTA BLANCA: solo se aceptan entidades conocidas. Un payload con una
    entidad desconocida se rechaza (no se puede inyectar una tabla arbitraria).
  - El negocio_id SIEMPRE se toma del dispositivo autenticado, NUNCA del
    payload. Una caja no puede escribir en el negocio de otra aunque mienta.
  - Las operaciones se aplican EN ORDEN (la venta antes que su línea), porque
    el PC las encola en orden transaccional. Se preserva esa garantía.
  - Idempotencia por lote (sync_lotes) y por fila (ON CONFLICT DO UPDATE):
    reenviar nunca duplica ni corrompe.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

import auth
from database import get_db
from models import Dispositivo

router = APIRouter()


# ==========================================================================
# Autenticación del dispositivo (igual que antes)
# ==========================================================================
def dispositivo_actual(
    x_dispositivo_id: str = Header(None),
    x_dispositivo_token: str = Header(None),
    db: Session = Depends(get_db),
) -> Dispositivo:
    if not x_dispositivo_id or not x_dispositivo_token:
        raise HTTPException(401, "Faltan credenciales del dispositivo.")
    disp = db.query(Dispositivo).filter(Dispositivo.id == x_dispositivo_id).first()
    if not disp or not disp.activo or not disp.token_hash:
        raise HTTPException(401, "Dispositivo no autorizado.")
    if not auth.verificar_token(x_dispositivo_token, disp.token_hash):
        raise HTTPException(401, "Token de dispositivo inválido.")
    return disp


# ==========================================================================
# MAPA de entidades sincronizables
# Cada entrada define: tabla destino, columnas que se copian del payload, y la
# columna de conflicto (PK) para el UPSERT. `inyecta_negocio` añade negocio_id
# desde el dispositivo. Añadir una entidad nueva = una entrada aquí.
# ==========================================================================
MAPA = {
    "ventas": {
        "tabla": "ventas",
        "columnas": ["id", "folio", "usuario_pos_id", "caja_sesion_id", "cliente_id",
                     "subtotal_centavos", "descuento_centavos", "iva_centavos",
                     "total_centavos", "estado", "creado_en", "actualizado_en"],
        "pk": "id",
        "update_cols": ["estado", "actualizado_en"],
        "inyecta_dispositivo": True,
    },
    "venta_lineas": {
        "tabla": "venta_lineas",
        "columnas": ["id", "venta_id", "producto_id", "descripcion", "cantidad",
                     "precio_unitario_centavos", "costo_unitario_centavos",
                     "descuento_linea_centavos", "total_linea_centavos",
                     "creado_en", "actualizado_en"],
        "pk": "id",
        "update_cols": [],  # las líneas no se modifican; insert o nada
    },
    "pagos": {
        "tabla": "pagos",
        "columnas": ["id", "venta_id", "metodo", "monto_centavos",
                     "recibido_centavos", "cambio_centavos", "creado_en", "actualizado_en"],
        "pk": "id",
        "update_cols": [],
    },
    "caja_sesiones": {
        "tabla": "caja_sesiones",
        "columnas": ["id", "usuario_pos_id", "fondo_inicial_centavos", "abierta_en",
                     "cerrada_en", "total_efectivo_esperado_centavos",
                     "total_efectivo_contado_centavos", "diferencia_centavos",
                     "estado", "actualizado_en"],
        "pk": "id",
        "update_cols": ["cerrada_en", "total_efectivo_esperado_centavos",
                        "total_efectivo_contado_centavos", "diferencia_centavos",
                        "estado", "actualizado_en"],
        "inyecta_dispositivo": True,
    },
    "movimientos_caja": {
        "tabla": "movimientos_caja",
        "columnas": ["id", "caja_sesion_id", "tipo", "motivo", "monto_centavos",
                     "usuario_pos_id", "creado_en", "actualizado_en"],
        "pk": "id",
        "update_cols": [],
    },
    "productos": {
        "tabla": "productos",
        "columnas": ["id", "codigo_barras", "nombre", "categoria_id",
                     "precio_venta_centavos", "costo_centavos", "precio_mayoreo_centavos",
                     "cantidad_mayoreo", "iva_tasa", "controla_stock", "stock", "unidad",
                     "stock_minimo", "favorito", "es_kit", "eliminado",
                     "creado_en", "actualizado_en"],
        "pk": "id",
        "update_cols": ["codigo_barras", "nombre", "categoria_id", "precio_venta_centavos",
                        "costo_centavos", "precio_mayoreo_centavos", "cantidad_mayoreo",
                        "iva_tasa", "controla_stock", "stock", "unidad", "stock_minimo",
                        "favorito", "es_kit", "eliminado", "actualizado_en"],
    },
    "clientes": {
        "tabla": "clientes",
        "columnas": ["id", "nombre", "telefono", "notas", "limite_credito_centavos",
                     "saldo_centavos", "eliminado", "creado_en", "actualizado_en"],
        "pk": "id",
        "update_cols": ["nombre", "telefono", "notas", "limite_credito_centavos",
                        "saldo_centavos", "eliminado", "actualizado_en"],
    },
    "categorias": {
        "tabla": "categorias",
        "columnas": ["id", "nombre", "color", "eliminado", "creado_en", "actualizado_en"],
        "pk": "id",
        "update_cols": ["nombre", "color", "eliminado", "actualizado_en"],
    },
    "usuarios": {  # entidad local "usuarios" -> tabla espejo "usuarios_pos"
        "tabla": "usuarios_pos",
        "columnas": ["id", "nombre", "rol", "activo", "eliminado", "creado_en", "actualizado_en"],
        "pk": "id",
        "update_cols": ["nombre", "rol", "activo", "eliminado", "actualizado_en"],
        "inyecta_dispositivo": True,
    },
    # Alias: el PC encola como "usuarios_pos" (nombre de su tabla local).
    # MISMA entrada; sin esto el receptor los descartaba en la lista blanca
    # (bug: los cajeros del PC nunca llegaban a la nube). El pin_hash NUNCA
    # está en columnas: un PIN de una caja no debe viajar a otra.
    "usuarios_pos": {
        "tabla": "usuarios_pos",
        "columnas": ["id", "nombre", "rol", "activo", "eliminado", "creado_en", "actualizado_en"],
        "pk": "id",
        "update_cols": ["nombre", "rol", "activo", "eliminado", "actualizado_en"],
        "inyecta_dispositivo": True,
    },
    "config": {
        "tabla": "config",
        "columnas": ["clave", "valor", "actualizado_en"],
        "pk": "negocio_id, clave",  # PK compuesta
        "update_cols": ["valor", "actualizado_en"],
        "pk_es_compuesta": True,
    },
    "devoluciones": {
        "tabla": "devoluciones",
        "columnas": ["id", "venta_id", "caja_sesion_id", "usuario_pos_id", "motivo",
                     "metodo_reembolso", "total_devuelto_centavos", "creado_en", "actualizado_en"],
        "pk": "id",
        "update_cols": [],
    },
    "devolucion_lineas": {
        "tabla": "devolucion_lineas",
        "columnas": ["id", "devolucion_id", "venta_linea_id", "cantidad",
                     "monto_centavos", "reingresa_stock"],
        "pk": "id",
        "update_cols": [],
    },
}


# ==========================================================================
# ORDEN DE APLICACIÓN
# Las tablas "padre" deben insertarse antes que las que las referencian por
# foreign key. El empujador manda las operaciones en cualquier orden (de hecho,
# ventas.rs encola las líneas antes que la cabecera); aquí las reordenamos de
# forma estable para respetar las dependencias, sin que el PC tenga que saber
# nada de esto. Menor número = se aplica primero.
# ==========================================================================
# Defaults para columnas NOT NULL que el POS puede no incluir en el payload
# (en SQLite tienen DEFAULT, así que su código no siempre las manda). Cuando
# llegan como None, el receptor las rellena con estos valores para no violar
# el NOT NULL del espejo. Es el mismo principio que con los timestamps.
# Columnas que en el espejo (PostgreSQL) son BOOLEAN, pero que el POS (SQLite)
# envía como enteros 0/1. Postgres es estricto con tipos, así que convertimos
# 0/1 -> False/True antes de insertar. Robusto y general.
COLUMNAS_BOOL = {
    "eliminado", "favorito", "es_kit", "activo", "controla_stock", "reingresa_stock",
}


def _a_bool(v):
    """Normaliza 0/1/'0'/'1'/True/False/None a bool (o None si venía None)."""
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    if isinstance(v, str):
        return v.strip() not in ("0", "", "false", "False")
    return bool(v)


DEFAULTS_COLUMNA = {
    "eliminado": False,
    "favorito": False,
    "es_kit": False,
    "activo": True,
    "controla_stock": True,
    "iva_tasa": 0,
    "stock": 0,
    "stock_minimo": 0,
    "precio_venta_centavos": 0,
    "costo_centavos": 0,
    "subtotal_centavos": 0,
    "descuento_centavos": 0,
    "iva_centavos": 0,
    "total_centavos": 0,
    "descuento_linea_centavos": 0,
    "fondo_inicial_centavos": 0,
    "saldo_centavos": 0,
    "limite_credito_centavos": 0,
    "reingresa_stock": True,
    "estado": "completada",
    "unidad": "pieza",
}


ORDEN_ENTIDAD = {
    "usuarios": 0,
    "usuarios_pos": 0,       # alias: el PC encola con este nombre
    "categorias": 1,
    "clientes": 1,
    "productos": 2,          # depende de categorias
    "caja_sesiones": 3,      # depende de usuarios
    "ventas": 4,             # depende de caja_sesiones, usuarios, clientes
    "venta_lineas": 5,       # depende de ventas y productos
    "pagos": 5,              # depende de ventas
    "movimientos_caja": 5,   # depende de caja_sesiones
    "devoluciones": 6,       # depende de ventas
    "devolucion_lineas": 7,  # depende de devoluciones
    "config": 8,             # independiente
}
# Valor por defecto para entidades no listadas: al final, pero antes de fallar.
_ORDEN_DEFECTO = 99


# ==========================================================================
# Esquema del lote
# ==========================================================================
class Operacion(BaseModel):
    entidad: str
    entidad_id: str
    operacion: str  # "insert" | "update"
    payload: dict


class LoteSync(BaseModel):
    lote_id: str  # UUID único del lote (generado por el PC)
    operaciones: list[Operacion] = Field(default_factory=list)


class LoteResp(BaseModel):
    ok: bool
    lote_id: str
    ya_procesado: bool
    aplicadas: int
    ignoradas: int


def _construir_upsert(cfg: dict, negocio_id: str) -> str:
    """Arma el SQL de UPSERT para una entidad según su entrada del MAPA."""
    cols = list(cfg["columnas"])
    # Inyectar negocio_id siempre (seguridad multi-inquilino).
    cols_final = ["negocio_id"] + cols
    if cfg.get("inyecta_dispositivo"):
        cols_final = ["negocio_id", "dispositivo_id"] + cols

    placeholders = []
    for c in cols_final:
        if c == "negocio_id":
            placeholders.append(f"'{negocio_id}'")
        elif c == "dispositivo_id":
            placeholders.append(":__disp__")
        else:
            placeholders.append(f":{c}")

    lista_cols = ", ".join(cols_final)
    lista_val = ", ".join(placeholders)
    conflicto = cfg["pk"]

    if cfg.get("update_cols"):
        sets = ", ".join(f"{c} = EXCLUDED.{c}" for c in cfg["update_cols"])
        accion = f"DO UPDATE SET {sets}"
    else:
        accion = "DO NOTHING"

    return (f"INSERT INTO {cfg['tabla']} ({lista_cols}) VALUES ({lista_val}) "
            f"ON CONFLICT ({conflicto}) {accion}")


@router.post("/sync/lote", response_model=LoteResp)
def recibir_lote(
    lote: LoteSync,
    disp: Dispositivo = Depends(dispositivo_actual),
    db: Session = Depends(get_db),
):
    negocio_id = str(disp.negocio_id)

    # Idempotencia por lote.
    if db.execute(text("SELECT 1 FROM sync_lotes WHERE id = :id"), {"id": lote.lote_id}).first():
        return LoteResp(ok=True, lote_id=lote.lote_id, ya_procesado=True, aplicadas=0, ignoradas=0)

    aplicadas = 0
    ignoradas = 0
    # Reordenar de forma ESTABLE: padres antes que hijos (respeta FKs). Python
    # sorted() es estable, así que dentro del mismo nivel se preserva el orden
    # original de encolado (importante para actualizaciones sucesivas del mismo
    # registro).
    operaciones_ordenadas = sorted(
        lote.operaciones,
        key=lambda o: ORDEN_ENTIDAD.get(o.entidad, _ORDEN_DEFECTO),
    )
    try:
        _ahora_iso = datetime.now(timezone.utc).isoformat()
        for op in operaciones_ordenadas:
            cfg = MAPA.get(op.entidad)
            if not cfg:
                # Entidad desconocida: se ignora (lista blanca). No rompe el lote.
                ignoradas += 1
                continue

            # ¿Qué columnas trae realmente este payload? (las que existen y no
            # son None; los timestamps None se rellenan con la hora del servidor).
            presentes = {}
            for col in cfg["columnas"]:
                if col in op.payload:
                    val = op.payload[col]
                    if val is None and col in ("creado_en", "actualizado_en"):
                        val = _ahora_iso
                    presentes[col] = val

            # ¿Es un payload COMPLETO? Lo es si trae todas las columnas NOT NULL
            # que la entidad necesita. Una forma robusta y simple: consideramos
            # completo si trae la mayoría de columnas; parcial si trae pocas.
            # En la práctica, un update de stock trae {id, stock, actualizado_en}
            # (3 de ~18 columnas). Un insert completo trae casi todas.
            pk = cfg["pk"]
            es_pk_compuesta = cfg.get("pk_es_compuesta", False)
            # Columnas mínimas para considerar "completo": más de la mitad.
            umbral = max(2, len(cfg["columnas"]) // 2)
            es_completo = len(presentes) >= umbral

            if es_completo:
                # UPSERT normal (insert o update completo).
                sql = _construir_upsert(cfg, negocio_id)
                params = {c: presentes.get(c) for c in cfg["columnas"]}
                # rellenar timestamps faltantes que no estaban en el payload
                for _col in ("creado_en", "actualizado_en"):
                    if _col in cfg["columnas"] and params.get(_col) is None:
                        params[_col] = _ahora_iso
                # rellenar columnas NOT NULL con default cuando llegan en None
                for _col, _def in DEFAULTS_COLUMNA.items():
                    if _col in cfg["columnas"] and params.get(_col) is None:
                        params[_col] = _def
                # convertir enteros 0/1 de SQLite a booleanos de Postgres
                for _col in COLUMNAS_BOOL:
                    if _col in params:
                        params[_col] = _a_bool(params[_col])
                if cfg.get("inyecta_dispositivo"):
                    params["__disp__"] = str(disp.id)
                db.execute(text(sql), params)
                aplicadas += 1
            else:
                # Payload PARCIAL (p. ej. update de stock): UPDATE puro de solo
                # los campos presentes, SOLO si el registro ya existe. Si no
                # existe, se ignora: llegará el registro completo por otra
                # operación de la cola. Así nunca violamos NOT NULL.
                cols_a_actualizar = [c for c in presentes if c != "id"]
                if not cols_a_actualizar:
                    ignoradas += 1
                    continue
                # convertir booleanas 0/1 -> bool también en updates parciales
                for _col in COLUMNAS_BOOL:
                    if _col in presentes:
                        presentes[_col] = _a_bool(presentes[_col])
                sets = ", ".join(f"{c} = :{c}" for c in cols_a_actualizar)
                if es_pk_compuesta:
                    # config: PK (negocio_id, clave). Update por esa PK.
                    where = "negocio_id = :__neg__ AND clave = :clave"
                    upd = f"UPDATE {cfg['tabla']} SET {sets} WHERE {where}"
                    params = {c: presentes[c] for c in presentes}
                    params["__neg__"] = negocio_id
                else:
                    upd = f"UPDATE {cfg['tabla']} SET {sets} WHERE id = :id AND negocio_id = :__neg__"
                    params = {c: presentes[c] for c in presentes}
                    params["__neg__"] = negocio_id
                res = db.execute(text(upd), params)
                if res.rowcount and res.rowcount > 0:
                    aplicadas += 1
                else:
                    # El registro aún no existe en el espejo: se ignora sin
                    # error. Llegará completo en otra operación (o ya vendrá).
                    ignoradas += 1

        db.execute(text("""
            INSERT INTO sync_lotes (id, dispositivo_id, negocio_id, entidades)
            VALUES (:id, :disp, :neg, :ent)
        """), {"id": lote.lote_id, "disp": str(disp.id), "neg": negocio_id, "ent": aplicadas})
        db.execute(text("UPDATE dispositivos SET ultimo_visto_en = now() WHERE id = :id"),
                   {"id": str(disp.id)})
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Error aplicando el lote: {e}")

    return LoteResp(ok=True, lote_id=lote.lote_id, ya_procesado=False,
                    aplicadas=aplicadas, ignoradas=ignoradas)


# ==========================================================================
# Lectura para el móvil: resumen del día por negocio del dueño
# ==========================================================================
from vinculacion import dueno_actual  # noqa: E402  (import al final: evita ciclo)


# Zonas horarias válidas: validamos contra la base de datos de PostgreSQL para
# no confiar ciegamente en el texto del cliente (evita inyección en AT TIME ZONE).
def _zona_valida(db: Session, zona: str) -> bool:
    r = db.execute(
        text("SELECT 1 FROM pg_timezone_names WHERE name = :z LIMIT 1"),
        {"z": zona},
    ).first()
    return r is not None


@router.get("/monitor/dia")
def monitor_dia(
    fecha: str | None = None,
    zona: str | None = None,
    dueno=Depends(dueno_actual),
    db: Session = Depends(get_db),
):
    """Resumen del día para el móvil. El dueño solo ve SUS negocios.

    `zona` es una zona horaria IANA (ej. 'America/Mazatlan'). El "día" se
    calcula en ESA zona: una venta hecha a las 11pm hora local cuenta en el día
    local correcto, no en el día UTC. Si no se pasa zona (o es inválida), se
    usa UTC (comportamiento anterior, compatible).

    Las ventas guardan `creado_en` en UTC. Convertimos a la zona del dueño con
    AT TIME ZONE y comparamos la fecha resultante.
    """
    # Determinar la zona a usar (validada contra Postgres).
    zona_usar = zona if (zona and _zona_valida(db, zona)) else "UTC"

    # Determinar la fecha objetivo: la indicada, o "hoy" EN LA ZONA del dueño.
    if not fecha:
        hoy = db.execute(
            text("SELECT (now() AT TIME ZONE :z)::date::text"),
            {"z": zona_usar},
        ).scalar()
        fecha = hoy

    negocios = db.execute(
        text("SELECT id, nombre FROM negocios WHERE dueno_id = :d"),
        {"d": str(dueno.id)},
    ).fetchall()

    # Expresión que obtiene la fecha local de la venta. creado_en es texto ISO
    # en UTC; lo convertimos a timestamptz y luego a la zona del dueño.
    #   (creado_en::timestamptz AT TIME ZONE zona)::date = fecha
    filtro_dia = "CAST((CAST(v.creado_en AS timestamptz) AT TIME ZONE :zona) AS date) = CAST(:fecha AS date)"

    salida = []
    for neg in negocios:
        neg_id = str(neg[0])
        base = {"fecha": fecha, "neg": neg_id, "zona": zona_usar}
        tot = db.execute(text(
            "SELECT COALESCE(SUM(v.total_centavos),0), COUNT(*) FROM ventas v "
            f"WHERE v.negocio_id = :neg AND v.estado <> 'cancelada' AND {filtro_dia}"
        ), base).first()
        por_caja = db.execute(text(
            "SELECT d.nombre, COALESCE(SUM(v.total_centavos),0), COUNT(*) "
            "FROM ventas v JOIN dispositivos d ON d.id = v.dispositivo_id "
            f"WHERE v.negocio_id = :neg AND v.estado <> 'cancelada' AND {filtro_dia} "
            "GROUP BY d.nombre ORDER BY d.nombre"
        ), base).fetchall()
        por_vend = db.execute(text(
            "SELECT u.nombre, COALESCE(SUM(v.total_centavos),0), COUNT(*) "
            "FROM ventas v JOIN usuarios_pos u ON u.id = v.usuario_pos_id "
            f"WHERE v.negocio_id = :neg AND v.estado <> 'cancelada' AND {filtro_dia} "
            "GROUP BY u.nombre ORDER BY 2 DESC"
        ), base).fetchall()
        salida.append({
            "negocio_id": neg_id, "negocio_nombre": neg[1], "fecha": fecha, "zona": zona_usar,
            "total_vendido_centavos": int(tot[0]), "num_ventas": int(tot[1]),
            "por_caja": [{"caja": r[0], "vendido_centavos": int(r[1]), "tickets": int(r[2])} for r in por_caja],
            "por_vendedor": [{"vendedor": r[0], "vendido_centavos": int(r[1]), "tickets": int(r[2])} for r in por_vend],
        })
    return {"negocios": salida}
