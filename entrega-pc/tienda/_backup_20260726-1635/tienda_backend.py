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
  - El pedido del cliente se arma en la página y se envía por WhatsApp al
    negocio (v1: sin pago en línea).
  - Las fotos se guardan en ./media/{negocio_id}/{producto_id}.{ext}
    (tope 2 MB, solo jpeg/png/webp por magic bytes).

Tablas nuevas (CREATE TABLE IF NOT EXISTS al arrancar, en yvexpos_db):
  tienda_config, tienda_productos.

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
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection

from plantillas import PLANTILLAS
from tienda_utils import (
    MAX_FOTO_BYTES,
    SLUGS_RESERVADOS,
    construir_texto_pedido,  # noqa: F401  (reexportado para pruebas/futuro)
    extraer_slug_de_host,
    formato_precio,
    normalizar_slug,
    normalizar_whatsapp,
    plantilla_para_giro,
    sniff_imagen,
    validar_color_hex,
    validar_plantilla,
    validar_slug,
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
"""


# ALTER idempotentes para tiendas ya publicadas en v1 (patrón try/except:
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
    """Dict para las plantillas y el JSON público: incluye v2, NUNCA
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
                     pago_efectivo, link_pago, ocultar_agotados, banner_url, giro)
                VALUES (:n, :s, 1, :p, :c, :w, :m, :ms, :pub, :act,
                        :dom, :hor, :ig, :fb, :tt, :ep, :ed, :ce, :pe, :lp, :oa, :ban, :giro)
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
                    giro = EXCLUDED.giro
            """),
            {"n": negocio_id, "s": slug, "p": plantilla, "c": color, "w": whatsapp,
             "m": bienvenida, "ms": 1 if peticion.mostrar_stock else 0,
             "pub": ahora, "act": ahora,
             "dom": domicilio, "hor": horarios, "ig": instagram, "fb": facebook,
             "tt": tiktok, "ep": 1 if peticion.entrega_pickup else 0,
             "ed": 1 if peticion.entrega_domicilio else 0, "ce": costo_envio,
             "pe": 1 if peticion.pago_efectivo else 0, "lp": link_pago,
             "oa": 1 if peticion.ocultar_agotados else 0, "ban": banner_url or "",
             "giro": giro},
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
    """Config + conteo de productos, para que la app muestre
    "tu tienda está al aire"."""
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
    }


# ==========================================================================
# Endpoints públicos
# ==========================================================================
_HTML_404 = """<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tienda no disponible</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
background:#f6f7fb;color:#1c2030;display:flex;align-items:center;justify-content:center;
min-height:100vh;margin:0}
.caja{text-align:center;max-width:420px;padding:32px}
h1{font-size:1.4rem;margin-bottom:10px}
p{color:#6b7280;line-height:1.5}
.marca{margin-top:28px;font-size:.8rem;color:#9ca3af}
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
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
background:#f6f7fb;color:#1c2030;display:flex;align-items:center;justify-content:center;
min-height:100vh;margin:0}
.caja{text-align:center;max-width:420px;padding:32px}
h1{font-size:1.4rem;margin-bottom:10px}
p{color:#6b7280;line-height:1.5}
.marca{margin-top:28px;font-size:.8rem;color:#9ca3af}
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


@app.get("/t/{slug}/catalogo.json")
def catalogo_json(slug: str):
    """Catálogo público en JSON (sin auth), cacheable, para futuras mejoras.
    Incluye los campos públicos v2; NUNCA el whatsapp en crudo."""
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
