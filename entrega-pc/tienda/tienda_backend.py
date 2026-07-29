"""YvexPOS Tiendas — backend del escaparate público en línea.

Servicio NUEVO y SEPARADO del backend del escáner (systemd "yvexpos"):
corre como systemd "yvexpos-tienda" en el puerto 8100, detrás de
tienda.yvexiq.com en nginx. NO comparte código con backend-ia_tickets.py,
pero ESPEJA su autenticación: headers X-Dispositivo-Id / X-Dispositivo-Token
contra la tabla `dispositivos` (token_hash), verificando con el MISMO
módulo `auth` del backend existente (se importa desde el directorio del
backend en producción; ver TIENDA_BACKEND_DIR abajo). Si ese import no está
disponible, se cae al respaldo SHA-256 (ver _verificar_token_dispositivo).

Qué hace:
  - Cada negocio publica su catálogo elegido (foto, nombre, precio, depto)
    y obtiene una página pública en tienda.yvexiq.com/t/{slug}.
  - v3: el cliente final hace su pedido DIRECTO desde la página
    (POST /t/{slug}/pedido, sin auth): el total se recalcula server-side
    desde tienda_productos, se guarda en tienda_pedidos y el negocio lo
    atiende desde el POS (GET /api/tienda/pedidos, cambio de estado).
    Como respaldo, la página también ofrece mandarlo por WhatsApp.
  - Las fotos se guardan en ./media/{negocio_id}/{producto_id}.{ext}
    (tope 2 MB, solo jpeg/png/webp por magic bytes).

Tablas nuevas (CREATE TABLE IF NOT EXISTS al arrancar, en yvexpos_db):
  tienda_config, tienda_productos, tienda_pedidos (v3).

Variables de entorno:
  DATABASE_URL        = cadena SQLAlchemy de PostgreSQL (la misma que usa el
                        backend del escáner; si no se pone, se usa el default
                        local de abajo).
  TIENDA_URL_PUBLICA  = base pública (default "https://tienda.yvexiq.com").
  TIENDA_MEDIA_DIR    = carpeta de fotos (default "./media" relativo al CWD).
  TIENDA_BACKEND_DIR  = directorio del backend existente para importar `auth`
                        (default "/var/www/yvexpos/backend").

Dinero SIEMPRE en centavos enteros; timestamps ISO-8601 UTC; IDs UUID.
"""
import base64
import binascii
import hashlib
import hmac
import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection

from plantillas import PLANTILLAS
from tienda_utils import (
    ESTADOS_PEDIDO,
    MAX_FOTO_BYTES,
    PLANTILLAS_VALIDAS,
    SLUGS_RESERVADOS,
    TEMAS_VALIDOS,
    ALIAS_TEMAS,
    LimitadorPedidos,
    calcular_pedido,
    construir_texto_pedido,
    construir_url_whatsapp,
    correo_valido,
    extraer_slug_de_host,
    formato_precio,
    normalizar_correo,
    normalizar_slug,
    normalizar_ubicacion,
    normalizar_whatsapp,
    plantilla_para_giro,
    sniff_imagen,
    telefono_valido,
    transicion_pedido_valida,
    validar_color_hex,
    validar_plantilla,
    validar_slug,
    validar_tema,
)

# ==========================================================================
# Configuración
# ==========================================================================
DATABASE_URL = (
    os.environ.get("DATABASE_URL")
    or os.environ.get("YVEXPOS_DATABASE_URL")
    or "postgresql+psycopg2://yvexpos:yvexpos@127.0.0.1:5432/yvexpos_db"
)
URL_PUBLICA = os.environ.get("TIENDA_URL_PUBLICA", "https://tienda.yvexiq.com").rstrip("/")
MEDIA_DIR = Path(os.environ.get("TIENDA_MEDIA_DIR", "./media")).resolve()
BACKEND_DIR = os.environ.get("TIENDA_BACKEND_DIR", "/var/www/yvexpos/backend")

# Dominio sobre el que cuelgan los subdominios de tienda: {slug}.yvexiq.com.
# La forma path (tienda.yvexiq.com/t/{slug}) sigue funcionando sin wildcard.
DOMINIO_TIENDAS = os.environ.get("TIENDA_DOMINIO", "yvexiq.com").strip().lower()


def url_subdominio(slug: str) -> str:
    """URL canónica v2: https://{slug}.yvexiq.com"""
    return f"https://{slug}.{DOMINIO_TIENDAS}"


def url_path(slug: str) -> str:
    """URL fallback (funciona sin DNS wildcard): tienda.yvexiq.com/t/{slug}"""
    return f"{URL_PUBLICA}/t/{slug}"

# >>> ARTURO: pon aquí tu número de WhatsApp (solo dígitos, con código de
# país) para el bloque "¿Quieres una página web propia?" del pie de cada
# tienda. Ejemplo México: "52" + 10 dígitos = "526691234567".
CONTACTO_WEBMASTER = "526693328500"  # PLACEHOLDER — cámbialo por tu número real

MAX_PRODUCTOS = 500          # tope defensivo por tienda
MAX_FOTO_B64 = 3_000_000     # ~2.2 MB en base64 → bajo los 2 MB decodificados
MAX_TEXTO = 200

# Rate-limit simple en memoria para pedidos web (por IP del cliente final):
# máx 10 pedidos cada 10 minutos. Disuasorio; se reinicia con el proceso.
_limitador_pedidos = LimitadorPedidos(maximo=10, ventana_seg=600)

_engine = None


def _get_engine():
    global _engine
    if _engine is None:
        _engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=5)
    return _engine


def _ahora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ==========================================================================
# Autenticación del dispositivo (MISMO esquema que backend-ia_tickets.py)
# ==========================================================================
def _verificar_token_dispositivo(token: str, token_hash: str) -> bool:
    """Verifica el token del dispositivo contra token_hash.

    Primero intenta con el MISMO módulo `auth` del backend existente
    (auth.verificar_token), para que si el esquema de hash cambia allá, aquí
    cambie igual. Si no se puede importar, respaldo: SHA-256 hex del token
    comparado en tiempo constante (el esquema esperado; si el servidor usa
    otro, SOLO hay que hacer accesible auth.py con TIENDA_BACKEND_DIR).
    """
    try:
        if BACKEND_DIR not in sys.path:
            sys.path.insert(0, BACKEND_DIR)
        import auth  # noqa: PLC0415  (import tardío a propósito)

        return bool(auth.verificar_token(token, token_hash))
    except ImportError:
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        return hmac.compare_digest(digest, str(token_hash or ""))


def dispositivo_actual(
    x_dispositivo_id: str = Header(None),
    x_dispositivo_token: str = Header(None),
) -> dict:
    """Devuelve {"id", "negocio_id"} del dispositivo autenticado o 401.

    Mismo contrato que el backend del escáner: headers X-Dispositivo-Id /
    X-Dispositivo-Token, dispositivo activo y con token_hash.
    """
    if not x_dispositivo_id or not x_dispositivo_token:
        raise HTTPException(401, "Faltan credenciales del dispositivo.")
    with _get_engine().connect() as conn:
        fila = conn.execute(
            text("SELECT id, negocio_id, activo, token_hash "
                 "FROM dispositivos WHERE id::text = :id"),
            {"id": x_dispositivo_id},
        ).first()
    if not fila or not fila.activo or not fila.token_hash:
        raise HTTPException(401, "Dispositivo no autorizado.")
    if not _verificar_token_dispositivo(x_dispositivo_token, fila.token_hash):
        raise HTTPException(401, "Token de dispositivo inválido.")
    return {"id": str(fila.id), "negocio_id": str(fila.negocio_id)}


# ==========================================================================
# Tablas (CREATE TABLE IF NOT EXISTS al arrancar)
# ==========================================================================
DDL = """
CREATE TABLE IF NOT EXISTS tienda_config (
    negocio_id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    activa INTEGER NOT NULL DEFAULT 1,
    plantilla TEXT NOT NULL DEFAULT 'aurora',
    color_acento TEXT NOT NULL DEFAULT '#2563eb',
    whatsapp TEXT NOT NULL DEFAULT '',
    mensaje_bienvenida TEXT NOT NULL DEFAULT '',
    mostrar_stock INTEGER NOT NULL DEFAULT 0,
    publicada_en TEXT,
    actualizado_en TEXT
);
CREATE TABLE IF NOT EXISTS tienda_productos (
    negocio_id TEXT NOT NULL,
    producto_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    precio_centavos INTEGER NOT NULL DEFAULT 0,
    departamento TEXT,
    foto_url TEXT,
    orden INTEGER NOT NULL DEFAULT 0,
    actualizado_en TEXT,
    PRIMARY KEY (negocio_id, producto_id)
);
CREATE TABLE IF NOT EXISTS tienda_pedidos (
    id TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    cliente_nombre TEXT NOT NULL DEFAULT '',
    cliente_telefono TEXT NOT NULL DEFAULT '',
    cliente_notas TEXT NOT NULL DEFAULT '',
    entrega TEXT NOT NULL DEFAULT 'pickup',
    direccion TEXT NOT NULL DEFAULT '',
    pago TEXT NOT NULL DEFAULT 'efectivo',
    items TEXT NOT NULL DEFAULT '[]',
    total_centavos INTEGER NOT NULL DEFAULT 0,
    estado TEXT NOT NULL DEFAULT 'nuevo',
    creado_en TEXT,
    actualizado_en TEXT
);
CREATE INDEX IF NOT EXISTS idx_tienda_pedidos_negocio_estado
    ON tienda_pedidos (negocio_id, estado);
"""


# ALTER idempotentes para tiendas ya publicadas (patrón try/except:
# si la columna ya existe, Postgres lanza error y se ignora).
ALTER_V2 = [
    "ALTER TABLE tienda_config ADD COLUMN domicilio TEXT",
    "ALTER TABLE tienda_config ADD COLUMN horarios TEXT",
    "ALTER TABLE tienda_config ADD COLUMN instagram TEXT",
    "ALTER TABLE tienda_config ADD COLUMN facebook TEXT",
    "ALTER TABLE tienda_config ADD COLUMN tiktok TEXT",
    "ALTER TABLE tienda_config ADD COLUMN entrega_pickup INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE tienda_config ADD COLUMN entrega_domicilio INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE tienda_config ADD COLUMN costo_envio_centavos INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE tienda_config ADD COLUMN pago_efectivo INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE tienda_config ADD COLUMN link_pago TEXT",
    "ALTER TABLE tienda_config ADD COLUMN ocultar_agotados INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE tienda_config ADD COLUMN banner_url TEXT",
    "ALTER TABLE tienda_config ADD COLUMN giro TEXT",
    "ALTER TABLE tienda_productos ADD COLUMN stock INTEGER",
    # --- v3 ---
    "ALTER TABLE tienda_config ADD COLUMN tema TEXT NOT NULL DEFAULT 'auto'",
    # --- v3.1 ---
    "ALTER TABLE tienda_pedidos ADD COLUMN cliente_correo TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE tienda_pedidos ADD COLUMN ubicacion TEXT NOT NULL DEFAULT ''",
]


app = FastAPI(title="YvexPOS Tiendas", docs_url=None, redoc_url=None, openapi_url=None)


@app.on_event("startup")
def _crear_tablas():
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    with _get_engine().begin() as conn:
        for sentencia in DDL.strip().split(";"):
            if sentencia.strip():
                conn.execute(text(sentencia))
    # Los ALTER van cada uno en su propia transacción: en Postgres un error
    # ("column already exists") aborta la transacción completa, así que no
    # pueden compartir la de arriba.
    for sentencia in ALTER_V2:
        try:
            with _get_engine().begin() as conn:
                conn.execute(text(sentencia))
        except Exception:
            pass  # la columna ya existe


# ==========================================================================
# Esquemas de la API
# ==========================================================================
class ProductoPublicar(BaseModel):
    producto_id: str
    nombre: str
    descripcion: str | None = None
    precio_centavos: int = 0
    departamento: str | None = None
    foto_base64: str | None = None
    orden: int = 0
    stock: int | None = None  # None = sin dato de stock (nunca limita)


class PeticionPublicar(BaseModel):
    # plantilla None = no enviada: se decide por giro (fallback aurora).
    plantilla: str | None = None
    color_acento: str | None = None
    whatsapp: str | None = None
    mensaje_bienvenida: str | None = None
    mostrar_stock: bool = False
    slug_deseado: str | None = None
    productos: list[ProductoPublicar] = Field(default_factory=list)
    # --- v2 ---
    giro: str | None = None
    domicilio: str | None = None
    horarios: str | None = None
    instagram: str | None = None
    facebook: str | None = None
    tiktok: str | None = None
    entrega_pickup: bool = True
    entrega_domicilio: bool = False
    costo_envio_centavos: int = 0
    pago_efectivo: bool = True
    link_pago: str | None = None
    ocultar_agotados: bool = False
    banner_base64: str | None = None
    # --- v3 ---
    tema: str | None = None  # 'claro' | 'oscuro' | 'auto' (defecto auto)


class ItemPedidoWeb(BaseModel):
    """Item que manda el cliente final. El precio se IGNORA en el servidor:
    siempre se recalcula desde tienda_productos."""
    producto_id: str
    cantidad: int = 1
    precio_centavos: int | None = None


class PedidoWebCliente(BaseModel):
    """Pedido del cliente final (POST /t/{slug}/pedido, SIN auth).

    v3.1: exige al menos UN contacto (cliente_telefono o cliente_correo) —
    sin contacto el negocio no puede avisarle nada de su pedido."""
    cliente_nombre: str
    cliente_telefono: str | None = None
    cliente_correo: str | None = None
    cliente_notas: str | None = None
    entrega: str = "pickup"            # 'pickup' | 'domicilio'
    direccion: str | None = None
    ubicacion: str | None = None       # "lat,lng" opcional (best-effort)
    pago: str = "efectivo"             # 'efectivo' | 'en_linea'
    items: list[ItemPedidoWeb] = Field(default_factory=list)


class CambioEstadoPedido(BaseModel):
    estado: str


# ==========================================================================
# Helpers
# ==========================================================================
def _t(v, maximo: int = MAX_TEXTO) -> str:
    return (str(v) if v is not None else "").strip()[:maximo]


def _nombre_negocio(conn: Connection, negocio_id: str) -> str:
    fila = conn.execute(
        text("SELECT nombre FROM negocios WHERE id::text = :id"), {"id": negocio_id}
    ).first()
    return str(fila[0]) if fila else "Mi tienda"


def _resolver_slug(conn: Connection, deseado: str, negocio_id: str) -> str:
    """Slug único: si lo ocupa OTRO negocio, sufijo numérico (-2, -3, ...).
    Los subdominios reservados (pos, www, ...) NUNCA se asignan."""
    base = normalizar_slug(deseado, defecto="tienda")
    if base in SLUGS_RESERVADOS:
        base = f"{base}-tienda"
    slug = base
    n = 1
    while True:
        fila = conn.execute(
            text("SELECT negocio_id FROM tienda_config WHERE slug = :s"),
            {"s": slug},
        ).first()
        if not fila or str(fila[0]) == negocio_id:
            return slug
        n += 1
        slug = f"{base}-{n}"


def _sugerir_slug(conn: Connection, base: str, max_intentos: int = 50) -> str:
    """Primera variante libre del slug pedido: base-2, base-3, ..."""
    n = 1
    while n <= max_intentos:
        n += 1
        candidato = f"{base}-{n}"
        fila = conn.execute(
            text("SELECT 1 FROM tienda_config WHERE slug = :s"), {"s": candidato}
        ).first()
        if not fila and candidato not in SLUGS_RESERVADOS:
            return candidato
    return f"{base}-nueva"


def _guardar_foto(negocio_id: str, producto_id: str, foto_b64: str) -> str:
    """Decodifica, valida por magic bytes y escribe a media/{neg}/{pid}.{ext}.
    Devuelve la foto_url pública. Lanza HTTPException si no es válida."""
    if len(foto_b64) > MAX_FOTO_B64:
        raise HTTPException(413, f"La foto del producto {producto_id} supera el máximo (2 MB).")
    try:
        datos = base64.b64decode(foto_b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, f"La foto del producto {producto_id} no es base64 válido.")
    if len(datos) > MAX_FOTO_BYTES:
        raise HTTPException(413, f"La foto del producto {producto_id} supera 2 MB.")
    ext = sniff_imagen(datos)
    if ext is None:
        raise HTTPException(400, f"La foto del producto {producto_id} no es jpeg, png ni webp.")
    carpeta = MEDIA_DIR / negocio_id
    carpeta.mkdir(parents=True, exist_ok=True)
    # Limpiar variantes de extensión anteriores del mismo producto.
    for vieja in carpeta.glob(f"{producto_id}.*"):
        try:
            vieja.unlink()
        except OSError:
            pass
    (carpeta / f"{producto_id}.{ext}").write_bytes(datos)
    return f"/media/{negocio_id}/{producto_id}.{ext}"


def _tienda_por_slug(conn: Connection, slug: str, solo_activas: bool = True):
    sql = ("SELECT c.*, COALESCE(n.nombre, 'Mi tienda') AS nombre_negocio "
           "FROM tienda_config c LEFT JOIN negocios n ON n.id::text = c.negocio_id "
           "WHERE c.slug = :s")
    if solo_activas:
        sql += " AND c.activa = 1"
    return conn.execute(text(sql), {"s": slug}).first()


def _productos_de(conn: Connection, negocio_id: str) -> list[dict]:
    filas = conn.execute(
        text("SELECT producto_id, nombre, descripcion, precio_centavos, "
             "departamento, foto_url, orden, stock FROM tienda_productos "
             "WHERE negocio_id = :n ORDER BY orden, nombre"),
        {"n": negocio_id},
    ).fetchall()
    return [
        {
            "producto_id": f.producto_id,
            "nombre": f.nombre,
            "descripcion": f.descripcion or "",
            "precio_centavos": int(f.precio_centavos or 0),
            "departamento": f.departamento or "",
            "foto_url": f.foto_url or "",
            "orden": int(f.orden or 0),
            "stock": None if f.stock is None else int(f.stock),
        }
        for f in filas
    ]


def _config_publica_dict(config) -> dict:
    """Dict para las plantillas y el JSON público: incluye v2/v3, NUNCA
    expone el whatsapp en crudo en el JSON (eso se controla en el endpoint)."""
    def _b(v):
        return int(v or 0) == 1

    return {
        "nombre_negocio": config.nombre_negocio,
        "mensaje_bienvenida": config.mensaje_bienvenida or "",
        "color_acento": config.color_acento,
        "whatsapp": config.whatsapp or "",
        "slug": config.slug,
        "contacto_webmaster": CONTACTO_WEBMASTER,
        "domicilio": getattr(config, "domicilio", None) or "",
        "horarios": getattr(config, "horarios", None) or "",
        "instagram": getattr(config, "instagram", None) or "",
        "facebook": getattr(config, "facebook", None) or "",
        "tiktok": getattr(config, "tiktok", None) or "",
        "entrega_pickup": _b(getattr(config, "entrega_pickup", 1)),
        "entrega_domicilio": _b(getattr(config, "entrega_domicilio", 0)),
        "costo_envio_centavos": int(getattr(config, "costo_envio_centavos", 0) or 0),
        "pago_efectivo": _b(getattr(config, "pago_efectivo", 1)),
        "link_pago": getattr(config, "link_pago", None) or "",
        "ocultar_agotados": _b(getattr(config, "ocultar_agotados", 0)),
        "mostrar_stock": _b(getattr(config, "mostrar_stock", 0)),
        "banner_url": getattr(config, "banner_url", None) or "",
        "giro": getattr(config, "giro", None) or "",
        "tema": validar_tema(getattr(config, "tema", None)),
    }


def _pedido_dict(fila) -> dict:
    """Fila de tienda_pedidos -> dict de API (items como lista)."""
    try:
        items = json.loads(fila.items or "[]")
    except (TypeError, ValueError):
        items = []
    return {
        "id": fila.id,
        "negocio_id": fila.negocio_id,
        "slug": fila.slug,
        "cliente_nombre": fila.cliente_nombre,
        "cliente_telefono": fila.cliente_telefono,
        "cliente_correo": getattr(fila, "cliente_correo", "") or "",
        "cliente_notas": fila.cliente_notas,
        "entrega": fila.entrega,
        "direccion": fila.direccion,
        "ubicacion": getattr(fila, "ubicacion", "") or "",
        "pago": fila.pago,
        "items": items,
        "total_centavos": int(fila.total_centavos or 0),
        "estado": fila.estado,
        "creado_en": fila.creado_en,
        "actualizado_en": fila.actualizado_en,
    }


# ==========================================================================
# Endpoints privados (auth de dispositivo)
# ==========================================================================
@app.post("/api/tienda/publicar")
def publicar(peticion: PeticionPublicar, disp: dict = Depends(dispositivo_actual)):
    """Publica (o actualiza) la tienda del negocio: upsert de config y
    REEMPLAZO transaccional del set de productos."""
    negocio_id = disp["negocio_id"]
    productos = (peticion.productos or [])[:MAX_PRODUCTOS]

    ahora = _ahora_iso()
    giro = _t(peticion.giro, 40).lower()
    # plantilla explícita > mapeo por giro > aurora (compatibilidad v1).
    if peticion.plantilla is None:
        plantilla = plantilla_para_giro(giro)
    else:
        plantilla = validar_plantilla(peticion.plantilla, defecto=plantilla_para_giro(giro))
    color = validar_color_hex(peticion.color_acento or "#2563eb")
    whatsapp = normalizar_whatsapp(peticion.whatsapp)
    bienvenida = _t(peticion.mensaje_bienvenida, 300)
    domicilio = _t(peticion.domicilio, 300)
    horarios = _t(peticion.horarios, 500)
    instagram = _t(peticion.instagram, 300)
    facebook = _t(peticion.facebook, 300)
    tiktok = _t(peticion.tiktok, 300)
    link_pago = _t(peticion.link_pago, 500)
    costo_envio = max(0, int(peticion.costo_envio_centavos or 0))
    tema = validar_tema(peticion.tema)

    with _get_engine().begin() as conn:  # transacción: todo o nada
        nombre_negocio = _nombre_negocio(conn, negocio_id)
        slug = _resolver_slug(conn, peticion.slug_deseado or nombre_negocio, negocio_id)

        # Banner nuevo (mismo pipeline de fotos: magic bytes, media/{neg}/banner.ext).
        banner_url = None
        if peticion.banner_base64:
            banner_url = _guardar_foto(negocio_id, "banner", peticion.banner_base64)
        else:
            fila_banner = conn.execute(
                text("SELECT banner_url FROM tienda_config WHERE negocio_id = :n"),
                {"n": negocio_id},
            ).first()
            banner_url = (fila_banner[0] if fila_banner else None) or ""

        conn.execute(
            text("""
                INSERT INTO tienda_config
                    (negocio_id, slug, activa, plantilla, color_acento, whatsapp,
                     mensaje_bienvenida, mostrar_stock, publicada_en, actualizado_en,
                     domicilio, horarios, instagram, facebook, tiktok,
                     entrega_pickup, entrega_domicilio, costo_envio_centavos,
                     pago_efectivo, link_pago, ocultar_agotados, banner_url, giro,
                     tema)
                VALUES (:n, :s, 1, :p, :c, :w, :m, :ms, :pub, :act,
                        :dom, :hor, :ig, :fb, :tt, :ep, :ed, :ce, :pe, :lp, :oa, :ban, :giro,
                        :tema)
                ON CONFLICT (negocio_id) DO UPDATE SET
                    slug = EXCLUDED.slug,
                    activa = 1,
                    plantilla = EXCLUDED.plantilla,
                    color_acento = EXCLUDED.color_acento,
                    whatsapp = EXCLUDED.whatsapp,
                    mensaje_bienvenida = EXCLUDED.mensaje_bienvenida,
                    mostrar_stock = EXCLUDED.mostrar_stock,
                    actualizado_en = EXCLUDED.actualizado_en,
                    domicilio = EXCLUDED.domicilio,
                    horarios = EXCLUDED.horarios,
                    instagram = EXCLUDED.instagram,
                    facebook = EXCLUDED.facebook,
                    tiktok = EXCLUDED.tiktok,
                    entrega_pickup = EXCLUDED.entrega_pickup,
                    entrega_domicilio = EXCLUDED.entrega_domicilio,
                    costo_envio_centavos = EXCLUDED.costo_envio_centavos,
                    pago_efectivo = EXCLUDED.pago_efectivo,
                    link_pago = EXCLUDED.link_pago,
                    ocultar_agotados = EXCLUDED.ocultar_agotados,
                    banner_url = EXCLUDED.banner_url,
                    giro = EXCLUDED.giro,
                    tema = EXCLUDED.tema
            """),
            {"n": negocio_id, "s": slug, "p": plantilla, "c": color, "w": whatsapp,
             "m": bienvenida, "ms": 1 if peticion.mostrar_stock else 0,
             "pub": ahora, "act": ahora,
             "dom": domicilio, "hor": horarios, "ig": instagram, "fb": facebook,
             "tt": tiktok, "ep": 1 if peticion.entrega_pickup else 0,
             "ed": 1 if peticion.entrega_domicilio else 0, "ce": costo_envio,
             "pe": 1 if peticion.pago_efectivo else 0, "lp": link_pago,
             "oa": 1 if peticion.ocultar_agotados else 0, "ban": banner_url or "",
             "giro": giro, "tema": tema},
        )

        # Fotos actuales ANTES de reemplazar: los productos que no traen foto
        # nueva conservan la anterior.
        fotos_viejas = {
            str(f.producto_id): f.foto_url
            for f in conn.execute(
                text("SELECT producto_id, foto_url FROM tienda_productos "
                     "WHERE negocio_id = :n"),
                {"n": negocio_id},
            ).fetchall()
        }

        # Fotos a disco ANTES de reemplazar filas (si una falla, rollback y
        # no queda basura de filas; los archivos huérfanos se sobreescriben
        # en la próxima publicación).
        foto_urls: dict[str, str] = {}
        for prod in productos:
            if prod.foto_base64:
                foto_urls[prod.producto_id] = _guardar_foto(
                    negocio_id, prod.producto_id, prod.foto_base64
                )

        conn.execute(
            text("DELETE FROM tienda_productos WHERE negocio_id = :n"),
            {"n": negocio_id},
        )
        for prod in productos:
            pid = _t(prod.producto_id, 80)
            if not pid:
                continue
            foto_url = foto_urls.get(prod.producto_id) or fotos_viejas.get(pid)
            stock = None if prod.stock is None else max(0, int(prod.stock))
            conn.execute(
                text("""
                    INSERT INTO tienda_productos
                        (negocio_id, producto_id, nombre, descripcion,
                         precio_centavos, departamento, foto_url, orden, stock,
                         actualizado_en)
                    VALUES (:n, :p, :nom, :des, :pre, :dep, :foto, :ord, :stk, :act)
                """),
                {"n": negocio_id, "p": pid, "nom": _t(prod.nombre) or "Producto",
                 "des": _t(prod.descripcion, 500), "pre": int(prod.precio_centavos or 0),
                 "dep": _t(prod.departamento, 80), "foto": foto_url,
                 "ord": int(prod.orden or 0), "stk": stock, "act": ahora},
            )

    return {
        "ok": True,
        "slug": slug,
        "url_publica": url_subdominio(slug),
        "url_path": url_path(slug),
    }


@app.post("/api/tienda/desactivar")
def desactivar(disp: dict = Depends(dispositivo_actual)):
    """Apaga la tienda (activa=0): la página pública devuelve 404."""
    with _get_engine().begin() as conn:
        res = conn.execute(
            text("UPDATE tienda_config SET activa = 0, actualizado_en = :a "
                 "WHERE negocio_id = :n"),
            {"a": _ahora_iso(), "n": disp["negocio_id"]},
        )
    if res.rowcount == 0:
        raise HTTPException(404, "Este negocio no tiene tienda publicada.")
    return {"ok": True}


@app.get("/api/tienda/slug-disponible")
def slug_disponible(slug: str, disp: dict = Depends(dispositivo_actual)):
    """¿Está libre este slug para {slug}.yvexiq.com? Valida formato estricto
    (minúsculas, 3-40, alfanumérico+guiones, sin guiones extremos ni dobles)
    y slugs reservados; si está ocupado sugiere la primera variante libre."""
    s, motivo = validar_slug(slug)
    if motivo:
        base = (s or normalizar_slug(slug, defecto="tienda"))[:40].strip("-") or "tienda"
        with _get_engine().connect() as conn:
            sugerencia = _sugerir_slug(conn, base)
        return {"disponible": False, "motivo": motivo, "sugerencia": sugerencia}
    with _get_engine().connect() as conn:
        fila = conn.execute(
            text("SELECT negocio_id FROM tienda_config WHERE slug = :s"), {"s": s}
        ).first()
        libre = not fila or str(fila[0]) == disp["negocio_id"]
        sugerencia = None if libre else _sugerir_slug(conn, s)
    return {"disponible": libre, "motivo": None if libre else "Ese slug ya está ocupado.",
            "sugerencia": sugerencia}


@app.get("/api/tienda/estado")
def estado(disp: dict = Depends(dispositivo_actual)):
    """Config + conteo de productos y pedidos nuevos, para que la app
    muestre "tu tienda está al aire" y el badge de pedidos pendientes."""
    with _get_engine().connect() as conn:
        config = conn.execute(
            text("SELECT * FROM tienda_config WHERE negocio_id = :n"),
            {"n": disp["negocio_id"]},
        ).first()
        if not config:
            return {"tiene_tienda": False}
        conteo = conn.execute(
            text("SELECT COUNT(*) FROM tienda_productos WHERE negocio_id = :n"),
            {"n": disp["negocio_id"]},
        ).scalar()
        pedidos_nuevos = conn.execute(
            text("SELECT COUNT(*) FROM tienda_pedidos "
                 "WHERE negocio_id = :n AND estado = 'nuevo'"),
            {"n": disp["negocio_id"]},
        ).scalar()
    activa = int(config.activa) == 1

    def _b(v):
        return int(v or 0) == 1

    return {
        "tiene_tienda": True,
        "activa": activa,
        "slug": config.slug,
        "url_publica": url_subdominio(config.slug) if activa else None,
        "url_path": url_path(config.slug) if activa else None,
        "plantilla": config.plantilla,
        "color_acento": config.color_acento,
        "whatsapp": config.whatsapp,
        "mensaje_bienvenida": config.mensaje_bienvenida,
        "mostrar_stock": _b(config.mostrar_stock),
        "num_productos": int(conteo or 0),
        "publicada_en": config.publicada_en,
        "actualizado_en": config.actualizado_en,
        # --- v2 ---
        "giro": getattr(config, "giro", None) or "",
        "domicilio": getattr(config, "domicilio", None) or "",
        "horarios": getattr(config, "horarios", None) or "",
        "instagram": getattr(config, "instagram", None) or "",
        "facebook": getattr(config, "facebook", None) or "",
        "tiktok": getattr(config, "tiktok", None) or "",
        "entrega_pickup": _b(getattr(config, "entrega_pickup", 1)),
        "entrega_domicilio": _b(getattr(config, "entrega_domicilio", 0)),
        "costo_envio_centavos": int(getattr(config, "costo_envio_centavos", 0) or 0),
        "pago_efectivo": _b(getattr(config, "pago_efectivo", 1)),
        "link_pago": getattr(config, "link_pago", None) or "",
        "ocultar_agotados": _b(getattr(config, "ocultar_agotados", 0)),
        "banner_url": getattr(config, "banner_url", None) or "",
        # --- v3 ---
        "tema": validar_tema(getattr(config, "tema", None)),
        "num_pedidos_nuevos": int(pedidos_nuevos or 0),
    }


# ==========================================================================
# Pedidos web (v3) — privados: el POS consulta y cambia estados
# ==========================================================================
@app.get("/api/tienda/pedidos")
def listar_pedidos(estado: str | None = None, desde: str | None = None,
                   disp: dict = Depends(dispositivo_actual)):
    """Pedidos del negocio, más nuevos primero (máx 200).

    estado: filtra por 'nuevo' | 'preparando' | 'listo' | 'entregado' | 'cancelado'.
    desde:  ISO-8601; solo pedidos creados en o después de esa fecha.
    """
    sql = "SELECT * FROM tienda_pedidos WHERE negocio_id = :n"
    params: dict = {"n": disp["negocio_id"]}
    if estado:
        e = str(estado).strip().lower()
        if e not in ESTADOS_PEDIDO:
            raise HTTPException(400, f"Estado inválido. Usa: {', '.join(ESTADOS_PEDIDO)}.")
        sql += " AND estado = :e"
        params["e"] = e
    if desde:
        sql += " AND creado_en >= :d"
        params["d"] = _t(desde, 40)
    sql += " ORDER BY creado_en DESC LIMIT 200"
    with _get_engine().connect() as conn:
        filas = conn.execute(text(sql), params).fetchall()
    return {"pedidos": [_pedido_dict(f) for f in filas]}


@app.post("/api/tienda/pedidos/{pedido_id}/estado")
def cambiar_estado_pedido(pedido_id: str, cambio: CambioEstadoPedido,
                          disp: dict = Depends(dispositivo_actual)):
    """Cambia el estado de un pedido. Transiciones válidas:
    nuevo → preparando → listo → entregado; cancelado desde cualquiera
    menos entregado."""
    nuevo = str(cambio.estado or "").strip().lower()
    if nuevo not in ESTADOS_PEDIDO:
        raise HTTPException(400, f"Estado inválido. Usa: {', '.join(ESTADOS_PEDIDO)}.")
    with _get_engine().begin() as conn:
        fila = conn.execute(
            text("SELECT id, estado FROM tienda_pedidos "
                 "WHERE id = :p AND negocio_id = :n"),
            {"p": _t(pedido_id, 60), "n": disp["negocio_id"]},
        ).first()
        if not fila:
            raise HTTPException(404, "Pedido no encontrado.")
        if not transicion_pedido_valida(fila.estado, nuevo):
            raise HTTPException(
                409, f"No se puede pasar de «{fila.estado}» a «{nuevo}».")
        conn.execute(
            text("UPDATE tienda_pedidos SET estado = :e, actualizado_en = :a "
                 "WHERE id = :p"),
            {"e": nuevo, "a": _ahora_iso(), "p": fila.id},
        )
    return {"ok": True, "pedido_id": fila.id, "estado": nuevo}


# ==========================================================================
# Endpoints públicos
# ==========================================================================
_HTML_404 = """<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tienda no disponible</title>
<style>
body{font-family:'Space Grotesk',-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
background:#faf8f5;color:#221f1a;display:flex;align-items:center;justify-content:center;
min-height:100vh;margin:0}
.caja{text-align:center;max-width:420px;padding:32px}
h1{font-size:1.4rem;letter-spacing:-.02em;margin-bottom:10px;text-wrap:balance}
p{color:#7c776b;line-height:1.55}
.marca{margin-top:28px;font-size:.8rem;color:#a49a8f}
</style></head>
<body><div class="caja">
<h1>Esta tienda no está disponible</h1>
<p>El enlace puede estar mal escrito o la tienda fue desactivada por su dueño.</p>
<p class="marca">Hecho con YvexPOS</p>
</div></body></html>"""

_HTML_PORTADA = """<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>YvexPOS Tiendas</title>
<style>
body{font-family:'Space Grotesk',-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
background:#faf8f5;color:#221f1a;display:flex;align-items:center;justify-content:center;
min-height:100vh;margin:0}
.caja{text-align:center;max-width:420px;padding:32px}
h1{font-size:1.4rem;letter-spacing:-.02em;margin-bottom:10px;text-wrap:balance}
p{color:#7c776b;line-height:1.55}
.marca{margin-top:28px;font-size:.8rem;color:#a49a8f}
</style></head>
<body><div class="caja">
<h1>YvexPOS Tiendas</h1>
<p>Cada negocio tiene su propia dirección. Pide al negocio el enlace de su tienda.</p>
<p class="marca">Hecho con YvexPOS</p>
</div></body></html>"""


def _render_tienda(slug: str):
    """Busca la tienda por slug y devuelve el HTML de su plantilla
    (o la 404 elegante). Compartida por la ruta path y la de subdominio."""
    with _get_engine().connect() as conn:
        config = _tienda_por_slug(conn, slug, solo_activas=True)
        if not config:
            return HTMLResponse(_HTML_404, status_code=404)
        productos = _productos_de(conn, config.negocio_id)
    config_dict = _config_publica_dict(config)
    renderizar = PLANTILLAS.get(config.plantilla, PLANTILLAS["aurora"])
    return HTMLResponse(renderizar(config_dict, productos))


@app.get("/", response_class=HTMLResponse)
def inicio(request: Request):
    """Raíz: si el Host es {slug}.yvexiq.com, sirve ESA tienda (subdominio);
    si no, una portada mínima del servicio."""
    slug = extraer_slug_de_host(request.headers.get("host"), DOMINIO_TIENDAS)
    if slug:
        return _render_tienda(slug)
    return HTMLResponse(_HTML_PORTADA)


@app.get("/t/{slug}", response_class=HTMLResponse)
def pagina_tienda(slug: str):
    """Página pública de la tienda (forma path, funciona sin wildcard)."""
    return _render_tienda(slug)


@app.get("/t/{slug}/preview", response_class=HTMLResponse)
def preview_tienda(slug: str, plantilla: str | None = None,
                   tema: str | None = None, acento: str | None = None):
    """Vista previa del escaparate para la app móvil (pública, sin auth — el
    catálogo ya es público vía catalogo.json, así que no expone nada nuevo).

    Renderiza la tienda REAL forzando plantilla / tema / acento si vienen en
    la query (si se omiten, usa los guardados). NO persiste nada; el carrito
    y el checkout funcionan igual y los pedidos siguen yendo a
    POST /t/{slug}/pedido (es preview con datos reales)."""
    config_dict_override = {}
    if plantilla is not None:
        p = str(plantilla).strip().lower()
        if p not in PLANTILLAS_VALIDAS:
            raise HTTPException(
                400, f"Esa plantilla no existe. Usa una de: {', '.join(PLANTILLAS_VALIDAS)}.")
        config_dict_override["plantilla"] = p
    if tema is not None:
        crudo = str(tema).strip().lower()
        if crudo not in TEMAS_VALIDOS and crudo not in ALIAS_TEMAS:
            raise HTTPException(
                400, "El tema debe ser «auto», «perla», «medianoche», «arena» o «cielo».")
        config_dict_override["tema"] = validar_tema(crudo)
    if acento is not None:
        color = validar_color_hex(str(acento).strip(), defecto=None)
        if color is None:
            raise HTTPException(
                400, "El acento debe ser un color hexadecimal tipo #rrggbb (ej. #e11d48).")
        config_dict_override["color_acento"] = color

    with _get_engine().connect() as conn:
        config = _tienda_por_slug(conn, slug, solo_activas=True)
        if not config:
            return HTMLResponse(_HTML_404, status_code=404)
        productos = _productos_de(conn, config.negocio_id)

    config_dict = _config_publica_dict(config)
    nombre_plantilla = config_dict_override.pop("plantilla", config.plantilla)
    config_dict.update(config_dict_override)
    renderizar = PLANTILLAS.get(nombre_plantilla, PLANTILLAS["aurora"])
    return HTMLResponse(renderizar(config_dict, productos))


@app.post("/t/{slug}/pedido")
def recibir_pedido(slug: str, pedido: PedidoWebCliente, request: Request):
    """Pedido web del CLIENTE FINAL (sin auth). Validaciones duras:
      - rate-limit en memoria por IP (máx 10 pedidos / 10 min),
      - tienda activa,
      - entrega y pago permitidos por la config del negocio,
      - dirección requerida si la entrega es a domicilio,
      - precios y total RE-CALCULADOS server-side desde tienda_productos
        (nunca se confía en lo que mande el cliente).
    Responde {ok, pedido_id, total_centavos, whatsapp_url}."""
    ip = (request.client.host if request.client else "?")
    if not _limitador_pedidos.permitir(ip):
        raise HTTPException(429, "Demasiados pedidos seguidos. Intenta de nuevo en unos minutos.")

    with _get_engine().connect() as conn:
        config = _tienda_por_slug(conn, slug, solo_activas=True)
        if not config:
            raise HTTPException(404, "Tienda no disponible.")
        productos = _productos_de(conn, config.negocio_id)

    cfg = _config_publica_dict(config)
    entrega = str(pedido.entrega or "").strip().lower()
    if entrega not in ("pickup", "domicilio"):
        raise HTTPException(400, "Tipo de entrega inválido.")
    if entrega == "pickup" and not cfg["entrega_pickup"]:
        raise HTTPException(400, "Esta tienda no tiene recogida en tienda.")
    if entrega == "domicilio" and not cfg["entrega_domicilio"]:
        raise HTTPException(400, "Esta tienda no tiene entrega a domicilio.")
    pago = str(pedido.pago or "").strip().lower()
    if pago == "linea":
        pago = "en_linea"
    if pago not in ("efectivo", "en_linea"):
        raise HTTPException(400, "Método de pago inválido.")
    if pago == "efectivo" and not cfg["pago_efectivo"]:
        raise HTTPException(400, "Esta tienda no acepta pago en efectivo.")
    if pago == "en_linea" and not cfg["link_pago"]:
        raise HTTPException(400, "Esta tienda no tiene pago en línea.")

    nombre = _t(pedido.cliente_nombre, 60)
    if not nombre:
        raise HTTPException(400, "Cuéntanos tu nombre para identificar tu pedido.")
    # v3.1: teléfono O correo (al menos uno) — sin contacto no hay pedido.
    telefono = normalizar_whatsapp(pedido.cliente_telefono)[:20]
    correo = normalizar_correo(pedido.cliente_correo)
    if not telefono and not correo:
        raise HTTPException(400, "Déjanos tu teléfono o correo para avisarte de tu pedido.")
    if telefono and not telefono_valido(pedido.cliente_telefono):
        raise HTTPException(400, "Revisa tu teléfono: debe tener entre 10 y 15 dígitos.")
    if correo and not correo_valido(correo):
        raise HTTPException(400, "Revisa tu correo: parece que está incompleto.")
    notas = _t(pedido.cliente_notas, 300)
    direccion = _t(pedido.direccion, 200)
    if entrega == "domicilio" and not direccion:
        raise HTTPException(400, "Escribe la dirección para llevarte tu pedido.")
    # Ubicación GPS: best-effort — inválida se ignora (guarda ''), nunca
    # rechaza el pedido por eso.
    ubicacion = normalizar_ubicacion(pedido.ubicacion)

    catalogo = {p["producto_id"]: p for p in productos}
    try:
        detalle, _subtotal, total = calcular_pedido(
            [it.model_dump() for it in (pedido.items or [])],
            catalogo,
            entrega=entrega,
            costo_envio_centavos=cfg["costo_envio_centavos"],
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    ahora = _ahora_iso()
    pedido_id = str(uuid.uuid4())
    with _get_engine().begin() as conn:
        conn.execute(
            text("""
                INSERT INTO tienda_pedidos
                    (id, negocio_id, slug, cliente_nombre, cliente_telefono,
                     cliente_correo, cliente_notas, entrega, direccion, ubicacion,
                     pago, items, total_centavos, estado, creado_en, actualizado_en)
                VALUES (:id, :n, :s, :nom, :tel, :cor, :not, :ent, :dir, :ubi,
                        :pag, :items, :tot, 'nuevo', :c, :a)
            """),
            {"id": pedido_id, "n": config.negocio_id, "s": config.slug,
             "nom": nombre, "tel": telefono, "cor": correo, "not": notas,
             "ent": entrega, "dir": direccion, "ubi": ubicacion, "pag": pago,
             "items": json.dumps(detalle, ensure_ascii=False),
             "tot": total, "c": ahora, "a": ahora},
        )

    # Texto de WhatsApp de respaldo: mismo formato EXACTO de siempre.
    etiqueta_entrega = "Recoger en tienda" if entrega == "pickup" else "A domicilio"
    etiqueta_pago = ("Efectivo al recibir" if pago == "efectivo"
                     else f"Pago en línea: {cfg['link_pago']}")
    envio = cfg["costo_envio_centavos"] if entrega == "domicilio" else 0
    cuerpo, _ = construir_texto_pedido(
        detalle, nombre_cliente=nombre, notas=notas,
        entrega=etiqueta_entrega, pago=etiqueta_pago,
        costo_envio_centavos=envio)
    if direccion:
        cuerpo += f"\nDirección: {direccion}"
    if telefono:
        cuerpo += f"\nTel: {telefono}"
    cuerpo += f"\nFolio web: {pedido_id[:8].upper()}"
    texto = f"Hola {cfg['nombre_negocio']}, quiero hacer un pedido:\n\n{cuerpo}"
    whatsapp_url = (construir_url_whatsapp(cfg["whatsapp"], texto)
                    if cfg["whatsapp"] else "")

    return {"ok": True, "pedido_id": pedido_id,
            "total_centavos": total, "whatsapp_url": whatsapp_url}


@app.get("/t/{slug}/catalogo.json")
def catalogo_json(slug: str):
    """Catálogo público en JSON (sin auth), cacheable. Contrato v1/v2
    intacto (v3 solo AGREGA el campo tema); NUNCA el whatsapp en crudo."""
    with _get_engine().connect() as conn:
        config = _tienda_por_slug(conn, slug, solo_activas=True)
        if not config:
            raise HTTPException(404, "Tienda no disponible.")
        productos = _productos_de(conn, config.negocio_id)
    publica = _config_publica_dict(config)
    publica.pop("contacto_webmaster", None)
    publica["whatsapp"] = bool(publica["whatsapp"])  # nunca el número en crudo
    publica["plantilla"] = config.plantilla
    publica["productos"] = productos
    return JSONResponse(publica, headers={"Cache-Control": "public, max-age=60"})


_REGEX_ARCHIVO = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$")


@app.get("/media/{negocio_id}/{archivo}")
def media(negocio_id: str, archivo: str):
    """Sirve las fotos con caché. Valida path traversal a doble nivel:
    formato del nombre Y que la ruta resuelta quede dentro de MEDIA_DIR."""
    if not _REGEX_ARCHIVO.match(archivo) or not _REGEX_ARCHIVO.match(negocio_id):
        raise HTTPException(404, "No encontrado.")
    ruta = (MEDIA_DIR / negocio_id / archivo).resolve()
    try:
        ruta.relative_to(MEDIA_DIR)
    except ValueError:
        raise HTTPException(404, "No encontrado.")
    if not ruta.is_file():
        raise HTTPException(404, "No encontrado.")
    return FileResponse(ruta, headers={"Cache-Control": "public, max-age=86400, immutable"})


@app.get("/salud")
def salud():
    return {"ok": True, "servicio": "yvexpos-tienda"}
