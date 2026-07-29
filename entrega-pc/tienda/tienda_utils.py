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


# ==========================================================================
# v3 — Temas del escaparate (perla / medianoche / arena / cielo / auto)
# ==========================================================================
TEMAS_VALIDOS = ("auto", "perla", "medianoche", "arena", "cielo")

# Compatibilidad v3 temprana: los ids viejos se canonicalizan al id nuevo.
ALIAS_TEMAS = {"claro": "perla", "oscuro": "medianoche"}

# auto sigue prefers-color-scheme: perla de día, medianoche de noche.
TEMA_AUTO_CLARO = "perla"
TEMA_AUTO_OSCURO = "medianoche"


def validar_tema(tema, defecto: str = "auto") -> str:
    """Canonicaliza un tema: 'auto' | 'perla' | 'medianoche' | 'arena' | 'cielo'.
    Acepta los alias 'claro'->perla y 'oscuro'->medianoche."""
    t = str(tema or "").strip().lower()
    t = ALIAS_TEMAS.get(t, t)
    return t if t in TEMAS_VALIDOS else defecto


# Nombres con personalidad para MOSTRAR en la app móvil (los ids NO cambian;
# el cliente final nunca ve el nombre de la plantilla en el escaparate).
NOMBRES_PLANTILLA = {
    "aurora": "Amanecer",
    "noche": "Nocturna",
    "mercado": "Mercadito",
    "boutique": "Vitrina",
    "menu": "La Carta",
    "catalogo": "Surtido",
}


# ==========================================================================
# v3 — Guardia de contraste del acento (WCAG, luminancia relativa)
# ==========================================================================
def _canal_lineal(v: float) -> float:
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def luminancia_relativa(hex_color) -> float:
    """Luminancia relativa WCAG (0 = negro, 1 = blanco). Inválido -> 0."""
    c = validar_color_hex(hex_color, defecto="#000000")
    r, g, b = int(c[1:3], 16) / 255, int(c[3:5], 16) / 255, int(c[5:7], 16) / 255
    return 0.2126 * _canal_lineal(r) + 0.7152 * _canal_lineal(g) + 0.0722 * _canal_lineal(b)


def razon_contraste(hex_a, hex_b) -> float:
    """Razón de contraste WCAG entre dos colores (1.0 a 21.0)."""
    l1, l2 = luminancia_relativa(hex_a), luminancia_relativa(hex_b)
    claro, oscuro = max(l1, l2), min(l1, l2)
    return (claro + 0.05) / (oscuro + 0.05)


def contraste_suficiente(acento, fondo, minimo: float = 3.0) -> bool:
    """True si el acento sobre el fondo alcanza el contraste mínimo (3:1
    para elementos grandes y CTAs). El móvil la espeja para avisar al elegir."""
    return razon_contraste(acento, fondo) >= minimo


def _hex_a_hsl(c: str):
    r, g, b = int(c[1:3], 16) / 255, int(c[3:5], 16) / 255, int(c[5:7], 16) / 255
    mx, mn = max(r, g, b), min(r, g, b)
    li = (mx + mn) / 2
    if mx == mn:
        return 0.0, 0.0, li
    d = mx - mn
    s = d / (2 - mx - mn) if li > 0.5 else d / (mx + mn)
    if mx == r:
        h = ((g - b) / d + (6 if g < b else 0)) / 6
    elif mx == g:
        h = ((b - r) / d + 2) / 6
    else:
        h = ((r - g) / d + 4) / 6
    return h, s, li


def _hsl_a_hex(h: float, s: float, li: float) -> str:
    def _hue(p, q, t):
        if t < 0:
            t += 1
        if t > 1:
            t -= 1
        if t < 1 / 6:
            return p + (q - p) * 6 * t
        if t < 1 / 2:
            return q
        if t < 2 / 3:
            return p + (q - p) * (2 / 3 - t) * 6
        return p

    if s == 0:
        r = g = b = li
    else:
        q = li * (1 + s) if li < 0.5 else li + s - li * s
        p = 2 * li - q
        r = _hue(p, q, h + 1 / 3)
        g = _hue(p, q, h)
        b = _hue(p, q, h - 1 / 3)
    return "#{:02x}{:02x}{:02x}".format(
        round(max(0, min(1, r)) * 255),
        round(max(0, min(1, g)) * 255),
        round(max(0, min(1, b)) * 255),
    )


def acento_contraste_seguro(acento, fondo, minimo: float = 3.0,
                            max_pasos: int = 24) -> str:
    """Devuelve un acento que SÍ contraste con el fondo (>= minimo, 3:1).

    Si el acento ya cumple, se regresa intacto. Si no, se aclara u oscurece
    en pasos en HSL (preservando matiz y saturación) en la dirección que más
    contraste da, hasta alcanzar el mínimo o agotar los pasos. Función pura:
    así «tema oscuro + acento oscuro» se ve bien sin intervención del dueño.
    """
    a = validar_color_hex(acento)
    f = validar_color_hex(fondo, defecto="#faf8f5")
    if contraste_suficiente(a, f, minimo):
        return a
    h, s, li = _hex_a_hsl(a)
    # Dirección: aclarar si el fondo es oscuro, oscurecer si es claro.
    hacia_claro = luminancia_relativa(f) < 0.5
    mejor = a
    for paso in range(1, max_pasos + 1):
        delta = (paso / max_pasos)
        nueva_li = li + (1 - li) * delta if hacia_claro else li * (1 - delta)
        candidato = _hsl_a_hex(h, s, nueva_li)
        mejor = candidato
        if contraste_suficiente(candidato, f, minimo):
            return candidato
    return mejor



# ==========================================================================
# v3 — Pedidos web: cálculo server-side, estados y rate-limit en memoria
# ==========================================================================
ESTADOS_PEDIDO = ("nuevo", "preparando", "listo", "entregado", "cancelado")

# nuevo → listo → entregado; cancelado desde nuevo o listo.
# `preparando` ya NO es alcanzable para pedidos nuevos, pero se conservan
# sus transiciones salientes (legado: pedidos viejos en producción no se
# quedan atorados). transicion_pedido_valida es la única fuente de verdad.
TRANSICIONES_PEDIDO = {
    "nuevo": {"listo", "cancelado"},
    "preparando": {"listo", "cancelado"},  # legado
    "listo": {"entregado", "cancelado"},
    "entregado": set(),
    "cancelado": set(),
}


def transicion_pedido_valida(actual, nuevo) -> bool:
    """True si el pedido puede pasar de `actual` a `nuevo`."""
    return str(nuevo or "") in TRANSICIONES_PEDIDO.get(str(actual or ""), set())


MAX_LINEAS_PEDIDO = 100
MAX_CANTIDAD_ITEM = 99


def calcular_pedido(items, catalogo, entrega: str = "pickup",
                    costo_envio_centavos: int = 0):
    """Calcula un pedido web 100% server-side.

    items:    [{producto_id, cantidad, ...}] — cualquier precio que traiga el
              cliente se IGNORA (nunca se confía en él).
    catalogo: {producto_id: {"nombre": str, "precio_centavos": int}} leído de
              tienda_productos en el servidor.
    Devuelve (detalle, subtotal_centavos, total_centavos), donde detalle es
    [{producto_id, nombre, cantidad, precio_centavos}] con precios del
    catálogo. El total suma el envío si entrega == 'domicilio'.
    Lanza ValueError con mensaje en español si algo no es válido.
    """
    if not items:
        raise ValueError("Tu pedido está vacío: agrega al menos un producto.")
    items = list(items)[:MAX_LINEAS_PEDIDO]
    cantidades: dict[str, int] = {}
    for it in items:
        pid = str((it or {}).get("producto_id") or "").strip()
        if not pid:
            raise ValueError("Hay un producto inválido en el pedido.")
        try:
            cantidad = int((it or {}).get("cantidad") or 0)
        except (TypeError, ValueError):
            raise ValueError("Las cantidades deben ser números enteros.")
        if not (1 <= cantidad <= MAX_CANTIDAD_ITEM):
            raise ValueError(f"Cada producto debe llevar entre 1 y {MAX_CANTIDAD_ITEM} piezas.")
        cantidades[pid] = cantidades.get(pid, 0) + cantidad
        if cantidades[pid] > MAX_CANTIDAD_ITEM:
            raise ValueError(f"Cada producto debe llevar entre 1 y {MAX_CANTIDAD_ITEM} piezas.")
    detalle = []
    subtotal = 0
    for pid, cantidad in cantidades.items():
        prod = (catalogo or {}).get(pid)
        if not prod:
            raise ValueError("Un producto del pedido ya no está disponible en la tienda.")
        precio = int(prod.get("precio_centavos") or 0)
        subtotal += cantidad * precio
        detalle.append({
            "producto_id": pid,
            "nombre": str(prod.get("nombre") or "Producto"),
            "cantidad": cantidad,
            "precio_centavos": precio,
        })
    envio = max(0, int(costo_envio_centavos or 0)) if entrega == "domicilio" else 0
    return detalle, subtotal, subtotal + envio


class LimitadorPedidos:
    """Rate-limit simple EN MEMORIA por clave (IP del cliente final).

    Máximo `maximo` pedidos por ventana de `ventana_seg` segundos. Al
    reiniciarse el proceso se reinicia (es disuasorio, no antifraud).
    `ahora` se puede inyectar en las pruebas (segundos monótonos).
    """

    def __init__(self, maximo: int = 10, ventana_seg: int = 600):
        self.maximo = int(maximo)
        self.ventana_seg = int(ventana_seg)
        self._hits: dict[str, list] = {}

    def permitir(self, clave, ahora=None) -> bool:
        import time
        t = time.monotonic() if ahora is None else float(ahora)
        clave = str(clave or "?")
        hits = [h for h in self._hits.get(clave, []) if t - h < self.ventana_seg]
        if len(hits) >= self.maximo:
            self._hits[clave] = hits
            return False
        hits.append(t)
        self._hits[clave] = hits
        return True


# ==========================================================================
# v3.1 — Contacto del cliente: teléfono O correo (al menos uno)
# ==========================================================================
def telefono_valido(telefono) -> bool:
    """Teléfono de contacto razonable: 10-15 dígitos una vez limpio.
    Tolerta '+', espacios, guiones y paréntesis (formatos mexicanos con +52).
    Vacío -> False (el backend decide si es requerido)."""
    digitos = re.sub(r"\D", "", str(telefono or ""))
    return 10 <= len(digitos) <= 15


_REGEX_CORREO = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$")


def normalizar_correo(correo) -> str:
    """Correo normalizado para guardar: minúsculas y sin espacios a los lados."""
    return str(correo or "").strip().lower()[:200]


def correo_valido(correo) -> bool:
    """Formato básico razonable de correo (algo@dominio.tld). Vacío -> False."""
    c = str(correo or "").strip()
    return 3 <= len(c) <= 200 and bool(_REGEX_CORREO.match(c))


# ==========================================================================
# v3.1 — Ubicación GPS del cliente (estilo DiDi, sin APIs de pago)
# ==========================================================================
_REGEX_UBICACION = re.compile(
    r"^\s*(-?\d{1,2}(?:\.\d{1,6})?)\s*,\s*(-?\d{1,3}(?:\.\d{1,6})?)\s*$")


def ubicacion_valida(ubicacion) -> bool:
    """True si es "lat,lng" válida: lat -90..90, lng -180..180, hasta 6
    decimales. Tolera espacios alrededor de la coma."""
    m = _REGEX_UBICACION.match(str(ubicacion or ""))
    if not m:
        return False
    try:
        lat, lng = float(m.group(1)), float(m.group(2))
    except ValueError:
        return False
    return -90 <= lat <= 90 and -180 <= lng <= 180


def normalizar_ubicacion(ubicacion) -> str:
    """"lat,lng" normalizada a 6 decimales ("25.686600,-100.316100");
    inválida/vacía -> "" (best-effort: el pedido puede seguir sin pin)."""
    if not ubicacion_valida(ubicacion):
        return ""
    m = _REGEX_UBICACION.match(str(ubicacion))
    return f"{float(m.group(1)):.6f},{float(m.group(2)):.6f}"
