"""Utilidades PURAS de YvexPOS Tiendas — sin FastAPI, sin DB, sin red.

Aquí vive toda la lógica determinista que se puede probar en local:
  - normalizar_slug: slug de URL a partir del nombre deseado.
  - sniff_imagen: validación de fotos por magic bytes (nunca por extensión).
  - formato_precio: centavos enteros → "$1,234.50".
  - normalizar_whatsapp / construir_texto_pedido / construir_url_whatsapp:
    el mensaje del pedido que se abre en wa.me. El JavaScript de las
    plantillas replica EXACTAMENTE este formato; si cambias uno, cambia ambos.
  - validar_color_hex: acento de color seguro para meter al CSS.

Reglas del proyecto: dinero SIEMPRE en centavos enteros; nada de flotantes
de pesos ni de formateo con locale del servidor (debe verse igual en cualquier
VPS).
"""
import re
import unicodedata
from urllib.parse import quote

# ==========================================================================
# Slug
# ==========================================================================
_REGEX_NO_SLUG = re.compile(r"[^a-z0-9]+")


def normalizar_slug(texto, defecto: str = "tienda") -> str:
    """Convierte un texto libre en slug de URL: minúsculas, sin acentos,
    guiones en vez de espacios/símbolos, sin guiones repetidos ni en bordes.

    "Abarrotes Doña María's!" -> "abarrotes-dona-marias"
    "  " -> defecto
    """
    s = unicodedata.normalize("NFD", str(texto or "").strip().lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("'", "").replace("'", "").replace("`", "")
    s = _REGEX_NO_SLUG.sub("-", s).strip("-")
    s = re.sub(r"-{2,}", "-", s)
    return s[:60] or defecto


# ==========================================================================
# Slug: validación estricta (para elegir) y resolución por subdominio
# ==========================================================================
_REGEX_SLUG_ESTRICTO = re.compile(r"^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$")

# Subdominios que NUNCA pueden ser tienda (servicios propios de yvexiq.com).
# Se bloquean en la validación y nunca se asignan.
SLUGS_RESERVADOS = frozenset({
    "pos", "www", "mail", "api", "app", "tienda", "admin", "smtp", "imap",
    "ftp", "ns1", "ns2", "soporte", "ayuda", "blog", "status",
})


def validar_slug(texto):
    """Valida un slug ELEGIDO por el negocio (a diferencia de normalizar_slug,
    que convierte texto libre). Reglas: minúsculas, 3-40 caracteres,
    alfanumérico + guiones, sin guiones al inicio/fin ni dobles, y NO puede
    ser un subdominio reservado (pos, www, mail, ...).

    Devuelve (slug, None) si es válido, o (None, motivo) si no."""
    s = str(texto or "").strip().lower()
    if not (3 <= len(s) <= 40):
        return None, "Debe tener entre 3 y 40 caracteres."
    if not _REGEX_SLUG_ESTRICTO.match(s):
        return None, "Solo minúsculas, números y guiones, sin guiones al inicio o al final."
    if "--" in s:
        return None, "No se permiten guiones dobles."
    if s in SLUGS_RESERVADOS:
        return None, f"«{s}» es un subdominio reservado de yvexiq.com."
    return s, None


def extraer_slug_de_host(host, dominio: str):
    """Resuelve el slug de una tienda a partir del header Host.

    Los subdominios de tienda van DIRECTOS sobre el dominio:
    "modelorama.yvexiq.com" -> "modelorama" (solo el PRIMER label: hosts más
    profundos como "a.b.yvexiq.com" NO resuelven, y los reservados como
    "pos.yvexiq.com" o "tienda.yvexiq.com" tampoco — validar_slug los excluye).
    Cualquier otro host (dominio pelón, otro dominio, con puerto, vacío) -> None.
    Función pura, sin red.
    """
    h = str(host or "").strip().lower().split(":")[0].strip(".")
    d = str(dominio or "").strip().lower().strip(".")
    if not h or not d or not h.endswith("." + d):
        return None
    prefijo = h[: -(len(d) + 1)]
    if not prefijo or "." in prefijo:
        return None
    slug, motivo = validar_slug(prefijo)
    return slug if motivo is None else None


# ==========================================================================
# Giro -> plantilla por defecto (el móvil puede mandar plantilla explícita;
# este mapa solo se usa cuando publican giro SIN plantilla)
# ==========================================================================
GIRO_A_PLANTILLA = {
    "ropa": "boutique",
    "belleza": "boutique",
    "mascotas": "boutique",
    "cafeteria": "menu",
    "restaurante": "menu",
    "abarrotes": "catalogo",
    "farmacia": "catalogo",
    "ferreteria": "catalogo",
    "electronica": "catalogo",
    "otro": "catalogo",
}


def plantilla_para_giro(giro, defecto: str = "aurora") -> str:
    """Plantilla por defecto según el giro del negocio; desconocido -> defecto."""
    return GIRO_A_PLANTILLA.get(str(giro or "").strip().lower(), defecto)


# ==========================================================================
# Fotos: magic bytes (NUNCA confiar en la extensión que manda el cliente)
# ==========================================================================
MAGIC_JPEG = b"\xff\xd8\xff"
MAGIC_PNG = b"\x89PNG\r\n\x1a\n"
# WebP: bytes 0-3 "RIFF", bytes 8-11 "WEBP"

MAX_FOTO_BYTES = 2 * 1024 * 1024  # 2 MB por foto, ya decodificada


def sniff_imagen(datos: bytes):
    """Devuelve la extensión real según magic bytes: 'jpg' | 'png' | 'webp',
    o None si no es una imagen aceptada."""
    if not datos:
        return None
    if datos[:3] == MAGIC_JPEG:
        return "jpg"
    if datos[:8] == MAGIC_PNG:
        return "png"
    if len(datos) >= 12 and datos[:4] == b"RIFF" and datos[8:12] == b"WEBP":
        return "webp"
    return None


# ==========================================================================
# Dinero
# ==========================================================================
def formato_precio(centavos) -> str:
    """Centavos enteros → "$1,234.50". Entradas inválidas → "$0.00"."""
    try:
        c = int(centavos)
    except (TypeError, ValueError):
        c = 0
    signo = "-" if c < 0 else ""
    c = abs(c)
    pesos, dec = divmod(c, 100)
    return f"{signo}${pesos:,}.{dec:02d}"


# ==========================================================================
# WhatsApp
# ==========================================================================
def normalizar_whatsapp(numero) -> str:
    """Deja solo dígitos (wa.me exige número internacional sin '+' ni espacios).
    " +52 669 123 4567 " -> "526691234567". Vacío/None -> ""."""
    return re.sub(r"\D", "", str(numero or ""))


def construir_texto_pedido(items, nombre_cliente: str = "", notas: str = "",
                           entrega: str = "", pago: str = "",
                           costo_envio_centavos: int = 0) -> str:
    """Texto del pedido que viaja en el wa.me.

    items: lista de dicts {nombre, cantidad, precio_centavos}.
    entrega: etiqueta libre ("Recoger en tienda" / "A domicilio"), "" = sin sección.
    pago: etiqueta libre ("Efectivo al recibir" / "Pago en línea: https://...").
    costo_envio_centavos: se SUMA al total cuando aplica (envío a domicilio).
    Formato EXACTO (las plantillas JS lo replican):

        Hola {negocio}...   <- el saludo lo pone la plantilla, no esta función
        • 2 × Coca 600 — $36.00
        • 1 × Sabritas — $18.00

        Entrega: A domicilio (+$30.00 de envío)
        Pago: Efectivo al recibir

        Total: $84.00

        Nombre: Juan
        Notas: sin chile

    Aquí solo se arman las LÍNEAS + entrega/pago + total + nombre/notas; el
    encabezado con el nombre del negocio lo agrega quien llama (plantilla/JS).
    """
    lineas = []
    total = 0
    for it in items or []:
        nombre = str(it.get("nombre") or "Producto").strip()[:80]
        cantidad = int(it.get("cantidad") or 0)
        precio = int(it.get("precio_centavos") or 0)
        if cantidad <= 0:
            continue
        subtotal = cantidad * precio
        total += subtotal
        lineas.append(f"• {cantidad} × {nombre} — {formato_precio(subtotal)}")
    texto = "\n".join(lineas)
    envio = max(0, int(costo_envio_centavos or 0))
    entrega = str(entrega or "").strip()
    pago = str(pago or "").strip()
    if entrega:
        sufijo_envio = f" (+{formato_precio(envio)} de envío)" if envio else ""
        texto += f"\n\nEntrega: {entrega}{sufijo_envio}"
    if pago:
        texto += f"\nPago: {pago}" if entrega else f"\n\nPago: {pago}"
    texto += f"\n\nTotal: {formato_precio(total + envio)}"
    nombre_cliente = str(nombre_cliente or "").strip()
    notas = str(notas or "").strip()
    if nombre_cliente:
        texto += f"\n\nNombre: {nombre_cliente}"
    if notas:
        texto += f"\nNotas: {notas}"
    return texto, total + envio


def construir_url_whatsapp(whatsapp, texto: str) -> str:
    """URL wa.me con el texto URL-encoded. whatsapp ya normalizado (dígitos)."""
    num = normalizar_whatsapp(whatsapp)
    return f"https://wa.me/{num}?text={quote(texto, safe='')}"


# ==========================================================================
# Color de acento
# ==========================================================================
_REGEX_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def validar_color_hex(color, defecto: str = "#2563eb") -> str:
    """Acepta solo #RRGGBB (evita inyección de CSS); lo demás → defecto."""
    c = str(color or "").strip()
    return c.lower() if _REGEX_HEX.match(c) else defecto


PLANTILLAS_VALIDAS = ("aurora", "noche", "mercado", "boutique", "menu", "catalogo")


def validar_plantilla(nombre, defecto: str = "aurora") -> str:
    n = str(nombre or "").strip().lower()
    return n if n in PLANTILLAS_VALIDAS else defecto
