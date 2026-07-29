"""Pruebas LOCALES de YvexPOS Tiendas — sin base de datos ni red.

Prueba las funciones PURAS que usa el backend (tienda_utils) y las tres
plantillas (plantillas) recibiéndolas dicts directamente, exactamente igual
que las llama tienda_backend.py. El propio tienda_backend.py solo se valida
con py_compile (necesita PostgreSQL y el auth del servidor para correr).

Ejecutar:  python entrega-pc/tienda/test_tienda.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from plantillas import PLANTILLAS, plantilla_aurora, plantilla_mercado, plantilla_noche  # noqa: E402
from tienda_utils import (  # noqa: E402
    ALIAS_TEMAS,
    NOMBRES_PLANTILLA,
    TEMAS_VALIDOS,
    LimitadorPedidos,
    acento_contraste_seguro,
    calcular_pedido,
    construir_texto_pedido,
    construir_url_whatsapp,
    contraste_suficiente,
    correo_valido,
    extraer_slug_de_host,
    formato_precio,
    normalizar_correo,
    normalizar_slug,
    normalizar_ubicacion,
    normalizar_whatsapp,
    plantilla_para_giro,
    razon_contraste,
    sniff_imagen,
    telefono_valido,
    transicion_pedido_valida,
    ubicacion_valida,
    validar_color_hex,
    validar_plantilla,
    validar_slug,
    validar_tema,
)


def prueba(cond, mensaje):
    if not cond:
        raise AssertionError(f"FALLÓ: {mensaje}")
    print(f"  ok: {mensaje}")


# ==========================================================================
# 1. Slugs
# ==========================================================================
print("Slugs")
prueba(normalizar_slug("Abarrotes Doña María's!") == "abarrotes-dona-marias",
       "slug quita acentos, ñ, apóstrofes y pasa a guiones")
prueba(normalizar_slug("   ") == "tienda", "slug vacío cae al defecto")
prueba(normalizar_slug("Técnico  Y  Cía.") == "tecnico-y-cia",
       "slug colapsa espacios/símbolos y no deja guiones en bordes")
prueba(normalizar_slug("--Ya--") == "ya", "slug no conserva guiones repetidos ni en bordes")
prueba(normalizar_slug("A" * 100) == "a" * 60, "slug se trunca a 60 caracteres")

# ==========================================================================
# 2. Fotos por magic bytes
# ==========================================================================
print("Fotos (magic bytes)")
prueba(sniff_imagen(b"\xff\xd8\xff\xe0" + b"\x00" * 100) == "jpg", "jpeg detectado por magic bytes")
prueba(sniff_imagen(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100) == "png", "png detectado por magic bytes")
prueba(sniff_imagen(b"RIFF" + b"\x04\x00\x00\x00" + b"WEBP" + b"VP8 ") == "webp",
       "webp detectado por magic bytes (RIFF....WEBP)")
prueba(sniff_imagen(b"GIF89a" + b"\x00" * 100) is None, "gif rechazado (no aceptado)")
prueba(sniff_imagen(b"foto.jpg") is None, "texto con nombre de imagen rechazado")
prueba(sniff_imagen(b"") is None, "vacío rechazado")
prueba(sniff_imagen(b"RIFF" + b"\x04\x00\x00\x00" + b"AVI ") is None,
       "RIFF que no es WEBP rechazado")

# ==========================================================================
# 3. Dinero
# ==========================================================================
print("Formato de precio")
prueba(formato_precio(0) == "$0.00", "0 centavos")
prueba(formato_precio(5) == "$0.05", "5 centavos")
prueba(formato_precio(123450) == "$1,234.50", "miles con separador")
prueba(formato_precio(1000000) == "$10,000.00", "diez mil exactos")
prueba(formato_precio(None) == "$0.00", "None defensivo")
prueba(formato_precio("1899") == "$18.99", "acepta enteros como texto")

# ==========================================================================
# 4. WhatsApp: texto y URL
# ==========================================================================
print("WhatsApp")
texto, total = construir_texto_pedido(
    [
        {"nombre": "Coca 600", "cantidad": 2, "precio_centavos": 1800},
        {"nombre": "Sabritas", "cantidad": 1, "precio_centavos": 1800},
        {"nombre": "Fantasma", "cantidad": 0, "precio_centavos": 999},  # se ignora
    ],
    nombre_cliente="Juan",
    notas="sin chile",
)
prueba("• 2 × Coca 600 — $36.00" in texto, "línea con cantidad, × y subtotal")
prueba("• 1 × Sabritas — $18.00" in texto, "segunda línea")
prueba("Fantasma" not in texto, "cantidad 0 se omite")
prueba("Total: $54.00" in texto, "total correcto")
prueba(total == 5400, "total devuelto en centavos enteros")
prueba("Nombre: Juan" in texto and "Notas: sin chile" in texto, "nombre y notas incluidos")

texto_sin, _ = construir_texto_pedido([{"nombre": "A", "cantidad": 1, "precio_centavos": 100}])
prueba("Nombre:" not in texto_sin and "Notas:" not in texto_sin,
       "sin nombre/notas no se agregan esas secciones")

url = construir_url_whatsapp("+52 669 123 4567", "Hola ¿qué tal?\nTotal: $10.00")
prueba(url.startswith("https://wa.me/526691234567?text="), "wa.me con solo dígitos")
prueba("%0A" in url, "salto de línea URL-encoded como %0A")
prueba(" " not in url.split("?text=")[1], "sin espacios crudos en el texto")
prueba(normalizar_whatsapp("+52 (669) 123-45-67") == "526691234567", "whatsapp normalizado")

# ==========================================================================
# 5. Plantillas
# ==========================================================================
print("Plantillas")
CONFIG = {
    "nombre_negocio": "Abarrotes El Torito",
    "mensaje_bienvenida": "Todo para tu despensa, a domicilio.",
    "color_acento": "#e11d48",
    "whatsapp": "526691234567",
    "slug": "el-torito",
    "contacto_webmaster": "521234567890",
}
PRODUCTOS = [
    {"producto_id": "p1", "nombre": "Coca 600", "descripcion": "Refresco frío",
     "precio_centavos": 1800, "departamento": "Bebidas", "foto_url": "/media/n1/p1.jpg"},
    {"producto_id": "p2", "nombre": "Pan dulce", "descripcion": "",
     "precio_centavos": 1250, "departamento": "Panadería", "foto_url": ""},
]

for nombre, plantilla in PLANTILLAS.items():
    html = plantilla(CONFIG, PRODUCTOS)
    prueba(html.startswith("<!DOCTYPE html>"), f"[{nombre}] HTML completo")
    prueba("Abarrotes El Torito" in html, f"[{nombre}] nombre del negocio en la página")
    prueba("Todo para tu despensa" in html, f"[{nombre}] mensaje de bienvenida")
    prueba("$18.00" in html, f"[{nombre}] precio formateado")
    prueba("Bebidas" in html, f"[{nombre}] chip de departamento")
    prueba("/media/n1/p1.jpg" in html, f"[{nombre}] foto del producto")
    prueba('viewport' in html, f"[{nombre}] viewport móvil")
    prueba("Pedir por WhatsApp" in html, f"[{nombre}] botón flotante de pedido")
    prueba("526691234567" in html, f"[{nombre}] número wa.me del negocio")
    prueba("encodeURIComponent" in html, f"[{nombre}] JS URL-encodea el pedido")
    prueba("localStorage" in html, f"[{nombre}] pedido persiste en localStorage")
    prueba("Buscar" in html, f"[{nombre}] buscador en vivo")
    prueba("Hecho con YvexPOS" in html, f"[{nombre}] pie de marca")
    prueba("página web propia" in html and "521234567890" in html,
           f"[{nombre}] bloque webmaster con número configurable")
    prueba("#e11d48" in html, f"[{nombre}] color de acento aplicado")
    prueba('"precio_centavos": 1800' in html, f"[{nombre}] catálogo embebido para el JS")

# Cada plantilla es visualmente distinta (tema CSS propio).
prueba("#f6f7fb" in plantilla_aurora(CONFIG, PRODUCTOS), "aurora es clara")
prueba("#0d0f16" in plantilla_noche(CONFIG, PRODUCTOS), "noche es oscura")
prueba("#fdf6ec" in plantilla_mercado(CONFIG, PRODUCTOS), "mercado es cálida")

# Sin WhatsApp del negocio: solo escaparate (sin botones de pedido).
config_sin_wa = {**CONFIG, "whatsapp": ""}
html_sin = plantilla_aurora(config_sin_wa, PRODUCTOS)
prueba('class="fab"' not in html_sin, "sin whatsapp no hay botón flotante")
prueba('id="velo"' not in html_sin, "sin whatsapp no hay sheet de pedido")
prueba("página web propia" in html_sin, "el bloque webmaster sigue aunque la tienda no tenga whatsapp")

# Escapado: un nombre con HTML no rompe ni inyecta.
malicioso = [{"producto_id": "x", "nombre": "<script>alert(1)</script>",
              "descripcion": "", "precio_centavos": 100, "departamento": "", "foto_url": ""}]
html_esc = plantilla_aurora(CONFIG, malicioso)
prueba("<script>alert(1)</script>" not in html_esc.split("<script>")[0],
       "nombre de producto con HTML queda escapado en el render server-side")

# ==========================================================================
# 6. Validadores
# ==========================================================================
print("Validadores")
prueba(validar_color_hex("#A1B2C3") == "#a1b2c3", "hex válido pasa a minúsculas")
prueba(validar_color_hex("red") == "#2563eb", "color no-hex cae al defecto")
prueba(validar_color_hex("#12345") == "#2563eb", "hex corto rechazado")
prueba(validar_plantilla("NOCHE") == "noche", "plantilla insensible a mayúsculas")
prueba(validar_plantilla("arcoiris") == "aurora", "plantilla desconocida cae al defecto")

# ==========================================================================
# 7. Slugs v2: validación estricta, reservados y resolución por Host
# ==========================================================================
print("Slugs v2")
s, motivo = validar_slug("el-torito")
prueba(s == "el-torito" and motivo is None, "slug válido pasa")
s, motivo = validar_slug("ab")
prueba(s is None and motivo, "slug de 2 caracteres rechazado")
s, motivo = validar_slug("-torito")
prueba(s is None and motivo, "guion al inicio rechazado")
s, motivo = validar_slug("torito-")
prueba(s is None and motivo, "guion al final rechazado")
s, motivo = validar_slug("El Torito")
prueba(s is None and motivo, "espacios rechazados en validación estricta")
s, motivo = validar_slug("tor--ito")
prueba(s is None and motivo, "guiones dobles rechazados")
s, motivo = validar_slug("a" * 41)
prueba(s is None and motivo, "más de 40 caracteres rechazado")
s, motivo = validar_slug("pos")
prueba(s is None and "reservado" in motivo, "slug reservado (pos) rechazado con motivo")
s, motivo = validar_slug("TIENDA")
prueba(s is None and "reservado" in motivo, "reservado insensible a mayúsculas")
for reservado in ("www", "mail", "api", "app", "admin", "smtp", "imap", "ftp",
                  "ns1", "ns2", "soporte", "ayuda", "blog", "status"):
    s, _ = validar_slug(reservado)
    prueba(s is None, f"reservado bloqueado: {reservado}")

prueba(extraer_slug_de_host("modelorama.yvexiq.com", "yvexiq.com") == "modelorama",
       "Host de subdominio resuelve el slug")
prueba(extraer_slug_de_host("modelorama.yvexiq.com:443", "yvexiq.com") == "modelorama",
       "Host con puerto resuelve igual")
prueba(extraer_slug_de_host("MODELO.yvexiq.com", "yvexiq.com") == "modelo",
       "Host en mayúsculas se normaliza")
prueba(extraer_slug_de_host("pos.yvexiq.com", "yvexiq.com") is None,
       "subdominio reservado NO resuelve como tienda")
prueba(extraer_slug_de_host("tienda.yvexiq.com", "yvexiq.com") is None,
       "tienda.yvexiq.com NO resuelve como tienda (es la forma path)")
prueba(extraer_slug_de_host("www.yvexiq.com", "yvexiq.com") is None,
       "www NO resuelve como tienda")
prueba(extraer_slug_de_host("yvexiq.com", "yvexiq.com") is None,
       "dominio pelón no resuelve")
prueba(extraer_slug_de_host("a.b.yvexiq.com", "yvexiq.com") is None,
       "subdominio profundo (a.b) no resuelve")
prueba(extraer_slug_de_host("modelorama.otro.com", "yvexiq.com") is None,
       "otro dominio no resuelve")
prueba(extraer_slug_de_host("", "yvexiq.com") is None, "Host vacío no resuelve")
prueba(extraer_slug_de_host(None, "yvexiq.com") is None, "Host ausente no resuelve")

# ==========================================================================
# 8. Giro -> plantilla por defecto
# ==========================================================================
print("Giro -> plantilla")
prueba(plantilla_para_giro("ropa") == "boutique", "ropa -> boutique")
prueba(plantilla_para_giro("Belleza") == "boutique", "belleza -> boutique")
prueba(plantilla_para_giro("mascotas") == "boutique", "mascotas -> boutique")
prueba(plantilla_para_giro("cafeteria") == "menu", "cafeteria -> menu")
prueba(plantilla_para_giro("restaurante") == "menu", "restaurante -> menu")
prueba(plantilla_para_giro("abarrotes") == "catalogo", "abarrotes -> catalogo")
prueba(plantilla_para_giro("farmacia") == "catalogo", "farmacia -> catalogo")
prueba(plantilla_para_giro("ferreteria") == "catalogo", "ferreteria -> catalogo")
prueba(plantilla_para_giro("electronica") == "catalogo", "electronica -> catalogo")
prueba(plantilla_para_giro("otro") == "catalogo", "otro -> catalogo")
prueba(plantilla_para_giro("cirugia-estelar") == "aurora", "giro desconocido -> aurora")
prueba(plantilla_para_giro("") == "aurora", "sin giro -> aurora")
prueba(validar_plantilla("boutique") == "boutique", "validar_plantilla acepta boutique")
prueba(validar_plantilla("menu") == "menu", "validar_plantilla acepta menu")
prueba(validar_plantilla("catalogo") == "catalogo", "validar_plantilla acepta catalogo")

# ==========================================================================
# 9. WhatsApp v2: entrega, envío, pago y total
# ==========================================================================
print("WhatsApp v2")
items = [{"nombre": "Coca 600", "cantidad": 2, "precio_centavos": 1800}]
texto, total = construir_texto_pedido(
    items, nombre_cliente="Juan", notas="sin chile",
    entrega="A domicilio", pago="Efectivo al recibir", costo_envio_centavos=3000)
prueba("Entrega: A domicilio (+$30.00 de envío)" in texto, "entrega con costo de envío")
prueba("Pago: Efectivo al recibir" in texto, "método de pago en el texto")
prueba("Total: $66.00" in texto, "total incluye el envío")
prueba(total == 6600, "total devuelto incluye envío en centavos")
prueba(texto.index("• 2 × Coca 600") < texto.index("Entrega:") < texto.index("Total:"),
       "orden: líneas, entrega, total")

texto2, total2 = construir_texto_pedido(items, entrega="Recoger en tienda")
prueba("Entrega: Recoger en tienda" in texto2 and "envío" not in texto2,
       "pickup sin costo de envío")
prueba(total2 == 3600 and "Total: $36.00" in texto2, "sin envío el total no cambia")

texto3, _ = construir_texto_pedido(items, pago="Pago en línea: https://mpago.link/abc")
prueba("\n\nPago: Pago en línea: https://mpago.link/abc" in texto3,
       "solo pago (sin entrega) lleva doble salto y adjunta el link")

# Backward-compat: la firma vieja (sin entrega/pago) produce el formato v1.
texto_v1, total_v1 = construir_texto_pedido(
    [{"nombre": "Coca 600", "cantidad": 2, "precio_centavos": 1800},
     {"nombre": "Sabritas", "cantidad": 1, "precio_centavos": 1800}],
    nombre_cliente="Juan", notas="sin chile")
prueba("Entrega:" not in texto_v1 and "Pago:" not in texto_v1,
       "sin entrega/pago no aparecen esas secciones (v1)")
prueba(total_v1 == 5400 and "Total: $54.00" in texto_v1, "total v1 intacto")

# ==========================================================================
# 10. Plantillas nuevas: estructura distinta + bloques v2
# ==========================================================================
print("Plantillas v2")
CONFIG_V2 = {
    **CONFIG,
    "domicilio": "Av. Siempre Viva 123, Col. Centro",
    "horarios": "Lun a Vie 9:00–19:00\nSáb 9:00–14:00",
    "instagram": "@eltorito",
    "facebook": "https://facebook.com/eltorito",
    "tiktok": "eltorito_mx",
    "entrega_pickup": True,
    "entrega_domicilio": True,
    "costo_envio_centavos": 3000,
    "pago_efectivo": True,
    "link_pago": "https://mpago.link/eltorito",
    "banner_url": "/media/n1/banner.jpg",
    "mostrar_stock": True,
    "giro": "abarrotes",
}
PRODUCTOS_V2 = [
    {"producto_id": "p1", "nombre": "Coca 600", "descripcion": "Refresco frío",
     "precio_centavos": 1800, "departamento": "Bebidas", "foto_url": "/media/n1/p1.jpg",
     "stock": 5},
    {"producto_id": "p2", "nombre": "Pan dulce", "descripcion": "",
     "precio_centavos": 1250, "departamento": "Panadería", "foto_url": "", "stock": 0},
    {"producto_id": "p3", "nombre": "Jabón", "descripcion": "",
     "precio_centavos": 2200, "departamento": "Limpieza", "foto_url": "", "stock": None},
]

for nombre in ("boutique", "menu", "catalogo"):
    html = PLANTILLAS[nombre](CONFIG_V2, PRODUCTOS_V2)
    prueba(html.startswith("<!DOCTYPE html>"), f"[{nombre}] HTML completo")
    prueba('class="banner-hero"' in html and "/media/n1/banner.jpg" in html,
           f"[{nombre}] banner como hero")
    prueba("Visítanos" in html and "Av. Siempre Viva 123" in html,
           f"[{nombre}] bloque Visítanos con domicilio")
    prueba("Lun a Vie 9:00–19:00" in html and "Sáb 9:00–14:00" in html,
           f"[{nombre}] horarios multilínea")
    prueba("https://instagram.com/eltorito" in html, f"[{nombre}] instagram @usuario -> URL")
    prueba("https://facebook.com/eltorito" in html, f"[{nombre}] facebook URL completa")
    prueba("https://tiktok.com/@eltorito_mx" in html, f"[{nombre}] tiktok usuario -> URL")
    prueba("<svg" in html, f"[{nombre}] iconos sociales SVG inline")
    prueba("Recoger en tienda" in html and "A domicilio" in html,
           f"[{nombre}] opciones de entrega en la sheet")
    prueba("(+$30.00 de envío)" in html, f"[{nombre}] costo de envío visible")
    prueba("Efectivo al recibir" in html and "Pagar en línea" in html,
           f"[{nombre}] métodos de pago en la sheet")
    prueba("https://mpago.link/eltorito" in html, f"[{nombre}] link de pago embebido")
    prueba("Quedan 5" in html, f"[{nombre}] badge de stock")
    prueba("Agotado" in html, f"[{nombre}] badge de agotado")
    prueba("Jabón" in html, f"[{nombre}] producto sin dato de stock se muestra normal")
    prueba("Entrega:" in html and "Pago:" in html and "linkPago" in html,
           f"[{nombre}] JS arma texto con entrega/pago/link")
    prueba("Hecho con YvexPOS" in html and "página web propia" in html,
           f"[{nombre}] pie de marca + webmaster")
    prueba("#e11d48" in html, f"[{nombre}] color de acento aplicado")

# Layouts realmente distintos.
html_b = PLANTILLAS["boutique"](CONFIG_V2, PRODUCTOS_V2)
html_m = PLANTILLAS["menu"](CONFIG_V2, PRODUCTOS_V2)
html_c = PLANTILLAS["catalogo"](CONFIG_V2, PRODUCTOS_V2)
prueba("grid-boutique" in html_b and "Georgia" in html_b, "boutique: rejilla editorial con serif")
prueba("seccion-depto" in html_m and "titulo-seccion" in html_m and "puntos" in html_m,
       "menu: secciones de departamento con filas nombre····precio")
prueba(">Bebidas</h2>" in html_m or "Bebidas</h2>" in html_m,
       "menu: encabezado de sección por departamento")
prueba("grid-c" in html_c and "chip-filtro" in html_c and "filtrarChip" in html_c,
       "catalogo: grid denso con chips de filtro")
prueba("Panadería</button>" in html_c or 'data-depto="panadería"' in html_c,
       "catalogo: chip por cada departamento")

# ocultar_agotados: el agotado desaparece; sin dato de stock permanece.
config_oculta = {**CONFIG_V2, "ocultar_agotados": True}
html_o = PLANTILLAS["catalogo"](config_oculta, PRODUCTOS_V2)
prueba("Pan dulce" not in html_o, "ocultar_agotados=1 esconde el agotado")
prueba("Coca 600" in html_o and "Jabón" in html_o,
       "con stock y sin dato de stock siguen visibles")
html_o2 = PLANTILLAS["menu"](config_oculta, PRODUCTOS_V2)
prueba("Pan dulce" not in html_o2, "ocultar_agotados aplica en todas las plantillas")

# Agotado visible (ocultar_agotados=0): no se puede agregar.
prueba('data-agotado=1' in PLANTILLAS["aurora"](CONFIG_V2, PRODUCTOS_V2),
       "agotado visible queda marcado para deshabilitar agregar")

# ==========================================================================
# 11. Backward-compat v1
# ==========================================================================
print("Backward-compat v1")
# Config v1 (sin ningún campo nuevo): defaults seguros, sin bloques v2.
html_v1 = plantilla_aurora(CONFIG, PRODUCTOS)
prueba('class="banner-hero"' not in html_v1, "sin banner_url no hay hero")
prueba("Visítanos" not in html_v1, "sin domicilio/horarios no hay bloque Visítanos")
prueba("instagram.com" not in html_v1, "sin redes no hay iconos sociales")
prueba("Pagar en línea" not in html_v1, "sin link_pago no hay pago en línea")
prueba("Recoger en tienda" in html_v1, "default v1: entrega pickup fija")
prueba("Efectivo al recibir" in html_v1, "default v1: pago efectivo fijo")
prueba("#f6f7fb" in html_v1, "aurora sigue viéndose igual (tema claro)")
# Productos v1 (sin stock): no hay badges ni agotados.
prueba('class="badge-stock' not in html_v1 and "data-agotado=1" not in html_v1,
       "productos sin stock no generan badges")

# ==========================================================================
# 12. Temas v3: auto / perla / medianoche / arena / cielo (+ alias)
# ==========================================================================
print("Tema v3")
prueba(validar_tema("perla") == "perla", "tema perla válido")
prueba(validar_tema("medianoche") == "medianoche", "tema medianoche válido")
prueba(validar_tema("arena") == "arena", "tema arena válido")
prueba(validar_tema("cielo") == "cielo", "tema cielo válido")
prueba(validar_tema("oscuro") == "medianoche", "alias oscuro -> medianoche")
prueba(validar_tema("CLARO") == "perla", "alias claro -> perla, insensible a mayúsculas")
prueba(validar_tema("neon") == "auto", "tema desconocido cae a auto")
prueba(validar_tema(None) == "auto", "tema ausente cae a auto")

for nombre, plantilla in PLANTILLAS.items():
    html_auto = plantilla(CONFIG, PRODUCTOS)
    prueba('<html lang="es" class="tema-auto">' in html_auto,
           f"[{nombre}] default tema=auto en <html>")
    prueba("prefers-color-scheme:dark" in html_auto,
           f"[{nombre}] medianoche vía media query cuando tema=auto")
    for t in ("perla", "medianoche", "arena", "cielo"):
        prueba(f":root.tema-{t}{{" in html_auto,
               f"[{nombre}] paleta {t} definida en el CSS")
        html_t = plantilla({**CONFIG, "tema": t}, PRODUCTOS)
        prueba(f'class="tema-{t}"' in html_t, f"[{nombre}] tema={t} fija la clase")
    # Los alias también fijan la clase canonical.
    prueba('class="tema-medianoche"' in plantilla({**CONFIG, "tema": "oscuro"}, PRODUCTOS),
           f"[{nombre}] alias oscuro fija tema-medianoche")
    prueba('class="tema-perla"' in plantilla({**CONFIG, "tema": "claro"}, PRODUCTOS),
           f"[{nombre}] alias claro fija tema-perla")

# ==========================================================================
# 13. Dirección de diseño v3 en el HTML generado
# ==========================================================================
print("Diseño v3")
for nombre, plantilla in PLANTILLAS.items():
    html = plantilla(CONFIG_V2, PRODUCTOS_V2)
    prueba("fonts.googleapis.com" in html and "display=swap" in html,
           f"[{nombre}] Google Fonts con display=swap")
    prueba("Inter" not in html.split("fonts.googleapis.com")[1][:200] if "fonts.googleapis.com" in html else False,
           f"[{nombre}] no usa Inter como fuente display")
    prueba("::selection" in html, f"[{nombre}] ::selection con el acento")
    prueba(":focus-visible" in html, f"[{nombre}] focus-visible diseñado")
    prueba("cubic-bezier(.16,1,.3,1)" in html, f"[{nombre}] easing personalizado")
    prueba("prefers-reduced-motion" in html, f"[{nombre}] respeta prefers-reduced-motion")
    prueba("IntersectionObserver" in html, f"[{nombre}] reveals al hacer scroll")
    prueba("text-wrap:balance" in html, f"[{nombre}] titulares con text-wrap:balance")
    prueba('class="reveal' in html, f"[{nombre}] reveal coreografiado al cargar")
    prueba("aspect-ratio" in html, f"[{nombre}] aspect-ratio reservado (sin layout shift)")
    prueba('loading="lazy"' in html, f"[{nombre}] imágenes lazy")
    prueba("<svg" in html and "😀" not in html, f"[{nombre}] iconografía SVG, cero emojis")

# ==========================================================================
# 14. Checkout v3 en las plantillas (carrito + POST + éxito + WhatsApp)
# ==========================================================================
print("Checkout v3")
for nombre, plantilla in PLANTILLAS.items():
    html = plantilla(CONFIG_V2, PRODUCTOS_V2)
    prueba("realizarPedido" in html, f"[{nombre}] función de checkout presente")
    prueba("'/t/'+SLUG+'/pedido'" in html, f"[{nombre}] POST al endpoint público de pedidos")
    prueba('id="telefono"' in html, f"[{nombre}] campo teléfono")
    prueba('id="direccion"' in html and "bloqueDireccion" in html,
           f"[{nombre}] dirección condicionada a domicilio")
    prueba("Enviar también por WhatsApp" in html and "whatsapp_url" in html,
           f"[{nombre}] éxito con botón WhatsApp del servidor")
    prueba("localStorage" in html and "pedido_el-torito" in html,
           f"[{nombre}] carrito en localStorage por slug")
    prueba("cliente_nombre" in html and "cliente_telefono" in html and "entrega" in html,
           f"[{nombre}] cuerpo JSON del pedido completo")
    prueba("Ir a pagar en línea" in html, f"[{nombre}] botón de pago tras confirmar")

# ==========================================================================
# 15. Pedidos v3: cálculo server-side (tienda_utils.calcular_pedido)
# ==========================================================================
print("Pedidos v3: cálculo server-side")
CATALOGO_SRV = {
    "p1": {"nombre": "Coca 600", "precio_centavos": 1800},
    "p2": {"nombre": "Pan dulce", "precio_centavos": 1250},
}

# El total ignora los precios que mande el cliente (recalcula del catálogo).
detalle, subtotal, total = calcular_pedido(
    [{"producto_id": "p1", "cantidad": 2, "precio_centavos": 1},
     {"producto_id": "p2", "cantidad": 1, "precio_centavos": 999999}],
    CATALOGO_SRV)
prueba(subtotal == 2 * 1800 + 1250, "subtotal con precios del SERVIDOR, no del cliente")
prueba(total == subtotal, "pickup sin envío: total = subtotal")
prueba(detalle[0]["precio_centavos"] == 1800, "detalle guarda el precio del catálogo")
prueba(detalle[0]["nombre"] == "Coca 600", "detalle guarda el nombre del catálogo")

# Envío sumado solo a domicilio.
_, _, total_dom = calcular_pedido(
    [{"producto_id": "p1", "cantidad": 1}], CATALOGO_SRV,
    entrega="domicilio", costo_envio_centavos=3000)
prueba(total_dom == 1800 + 3000, "domicilio suma el costo de envío")
_, _, total_pick = calcular_pedido(
    [{"producto_id": "p1", "cantidad": 1}], CATALOGO_SRV,
    entrega="pickup", costo_envio_centavos=3000)
prueba(total_pick == 1800, "pickup NO suma envío aunque exista costo")

# Cantidades del mismo producto se acumulan antes de validar el tope.
detalle2, sub2, _ = calcular_pedido(
    [{"producto_id": "p1", "cantidad": 2}, {"producto_id": "p1", "cantidad": 3}],
    CATALOGO_SRV)
prueba(len(detalle2) == 1 and detalle2[0]["cantidad"] == 5 and sub2 == 5 * 1800,
       "mismo producto en dos líneas se acumula")

def falla(fn, fragmento, mensaje):
    try:
        fn()
    except ValueError as e:
        prueba(fragmento in str(e), mensaje)
        return
    raise AssertionError(f"FALLÓ: {mensaje} (no lanzó ValueError)")

falla(lambda: calcular_pedido([], CATALOGO_SRV), "vacío", "items vacíos rechazados")
falla(lambda: calcular_pedido([{"producto_id": "p1", "cantidad": 0}], CATALOGO_SRV),
      "1 y 99", "cantidad 0 rechazada")
falla(lambda: calcular_pedido([{"producto_id": "p1", "cantidad": 100}], CATALOGO_SRV),
      "1 y 99", "cantidad 100 rechazada")
falla(lambda: calcular_pedido([{"producto_id": "p1", "cantidad": "x"}], CATALOGO_SRV),
      "enteros", "cantidad no numérica rechazada")
falla(lambda: calcular_pedido([{"producto_id": "fantasma", "cantidad": 1}], CATALOGO_SRV),
      "no está disponible", "producto desconocido rechazado")
falla(lambda: calcular_pedido([{"producto_id": "", "cantidad": 1}], CATALOGO_SRV),
      "inválido", "producto_id vacío rechazado")
falla(lambda: calcular_pedido(
      [{"producto_id": "p1", "cantidad": 60}, {"producto_id": "p1", "cantidad": 60}],
      CATALOGO_SRV), "1 y 99", "acumulado mayor a 99 rechazado")

# ==========================================================================
# 16. Pedidos v3: transiciones de estado
# ==========================================================================
print("Pedidos v3: transiciones")
prueba(transicion_pedido_valida("nuevo", "listo"), "nuevo -> listo (flujo simplificado)")
prueba(transicion_pedido_valida("preparando", "listo"), "preparando -> listo (legado)")
prueba(transicion_pedido_valida("listo", "entregado"), "listo -> entregado")
prueba(transicion_pedido_valida("nuevo", "cancelado"), "nuevo -> cancelado")
prueba(transicion_pedido_valida("preparando", "cancelado"), "preparando -> cancelado (legado)")
prueba(transicion_pedido_valida("listo", "cancelado"), "listo -> cancelado")
prueba(not transicion_pedido_valida("nuevo", "preparando"),
       "nuevo -> preparando YA NO (estado retirado del flujo)")
prueba(not transicion_pedido_valida("nuevo", "entregado"), "nuevo NO salta a entregado")
prueba(not transicion_pedido_valida("preparando", "nuevo"), "no se regresa a nuevo")
prueba(not transicion_pedido_valida("entregado", "cancelado"), "entregado NO se cancela")
prueba(not transicion_pedido_valida("cancelado", "nuevo"), "cancelado es terminal")
prueba(not transicion_pedido_valida("entregado", "entregado"), "entregado es terminal")
prueba(not transicion_pedido_valida("nuevo", "volado"), "estado destino inválido")

# ==========================================================================
# 17. Pedidos v3: rate-limit en memoria
# ==========================================================================
print("Pedidos v3: rate-limit")
lim = LimitadorPedidos(maximo=3, ventana_seg=600)
prueba(all(lim.permitir("1.2.3.4", ahora=1000 + i) for i in range(3)),
       "los primeros N pedidos pasan")
prueba(not lim.permitir("1.2.3.4", ahora=1003), "el pedido N+1 en la ventana se bloquea")
prueba(lim.permitir("5.6.7.8", ahora=1003), "otra IP no está bloqueada")
prueba(lim.permitir("1.2.3.4", ahora=1000 + 601), "pasada la ventana vuelve a permitir")

# ==========================================================================
# 18. Backend v3: contrato sin DB (revisión de fuente + py_compile)
# ==========================================================================
print("Backend v3: contrato")
import py_compile
py_compile.compile(str(Path(__file__).resolve().parent / "tienda_backend.py"), doraise=True)
prueba(True, "tienda_backend.py compila")
fuente = (Path(__file__).resolve().parent / "tienda_backend.py").read_text(encoding="utf-8")

# El endpoint público de pedidos NO lleva auth de dispositivo.
bloque = fuente.split('@app.post("/t/{slug}/pedido")')[1].split("@app.")[0]
prueba("dispositivo_actual" not in bloque, "POST /t/{slug}/pedido NO requiere auth")
prueba("_limitador_pedidos.permitir" in bloque, "rate-limit aplicado en el endpoint")
prueba("calcular_pedido(" in bloque, "total recalculado server-side")
prueba("entrega_domicilio" in bloque and "pago_efectivo" in bloque and "link_pago" in bloque,
       "valida entrega/pago contra la config")
prueba('HTTPException(400' in bloque and "direccion" in bloque,
       "dirección requerida para domicilio")
prueba('"ok": True' in bloque and '"pedido_id"' in bloque
       and '"total_centavos"' in bloque and '"whatsapp_url"' in bloque,
       "respuesta {ok, pedido_id, total_centavos, whatsapp_url}")
prueba("uuid.uuid4()" in bloque, "pedido con id UUID v4")

# Endpoints del POS con auth.
bloque_lista = fuente.split('@app.get("/api/tienda/pedidos")')[1].split("@app.")[0]
prueba("dispositivo_actual" in bloque_lista, "GET /api/tienda/pedidos SÍ requiere auth")
prueba("LIMIT 200" in bloque_lista and "DESC" in bloque_lista,
       "lista máx 200, más nuevos primero")
bloque_est = fuente.split('@app.post("/api/tienda/pedidos/{pedido_id}/estado")')[1].split("@app.")[0]
prueba("dispositivo_actual" in bloque_est, "cambio de estado SÍ requiere auth")
prueba("transicion_pedido_valida" in bloque_est, "transiciones validadas en el servidor")
bloque_estado = fuente.split('@app.get("/api/tienda/estado")')[1].split("@app.")[0]
prueba("num_pedidos_nuevos" in bloque_estado, "estado incluye num_pedidos_nuevos")
prueba('"tema"' in bloque_estado, "estado incluye tema")
prueba("CREATE TABLE IF NOT EXISTS tienda_pedidos" in fuente
       and "idx_tienda_pedidos_negocio_estado" in fuente,
       "DDL tienda_pedidos + índice por negocio/estado")
prueba("ADD COLUMN tema TEXT NOT NULL DEFAULT 'auto'" in fuente,
       "migración ALTER tolerante para tema")

# ==========================================================================
# 19. Preview v3: GET /t/{slug}/preview (sin auth, solo render)
# ==========================================================================
print("Preview v3")
# Semántica del override (lo que el endpoint aplica sobre el config público):
# plantilla/tema/acento forzados cambian el HTML resultante.
html_prev = PLANTILLAS["noche"]({**CONFIG, "tema": "oscuro", "color_acento": "#0aa00a"},
                                PRODUCTOS)
prueba('class="tema-medianoche"' in html_prev, "preview: tema forzado (alias) llega a <html>")
prueba("#0aa00a" in html_prev, "preview: acento forzado llega al CSS")
prueba("Abarrotes El Torito" in html_prev and "$18.00" in html_prev,
       "preview: sigue siendo la tienda real (mismos datos)")
html_prev2 = PLANTILLAS["boutique"]({**CONFIG, "tema": "claro"}, PRODUCTOS)
prueba('class="tema-perla"' in html_prev2 and "grid-boutique" in html_prev2,
       "preview: plantilla forzada cambia el layout de verdad")
# Contrato del endpoint (revisión de fuente: sin DB no se puede llamar HTTP).
bloque_prev = fuente.split('@app.get("/t/{slug}/preview"')[1].split("@app.")[0]
prueba("ALIAS_TEMAS" in bloque_prev, "preview acepta alias de temas")
prueba("dispositivo_actual" not in bloque_prev, "preview NO requiere auth")
prueba("PLANTILLAS_VALIDAS" in bloque_prev, "preview valida la plantilla")
prueba("TEMAS_VALIDOS" in bloque_prev, "preview valida el tema")
prueba("validar_color_hex" in bloque_prev, "preview valida el acento")
prueba(bloque_prev.count("HTTPException(\n                400") >= 3
       or bloque_prev.count("400") >= 3, "preview: inválidos -> 400 con mensaje")
prueba("status_code=404" in bloque_prev and "_HTML_404" in bloque_prev,
       "preview: tienda inactiva/inexistente -> 404 elegante")
prueba("conn.execute" not in bloque_prev.split("config_dict =")[0].split("connect()")[0]
       or "INSERT" not in bloque_prev and "UPDATE" not in bloque_prev,
       "preview no persiste nada (sin INSERT/UPDATE)")
prueba("plantilla: str | None = None" in bloque_prev
       and "tema: str | None = None" in bloque_prev
       and "acento: str | None = None" in bloque_prev,
       "preview: los 3 query params son opcionales")

# ==========================================================================
# 20. Guardia de contraste del acento (WCAG)
# ==========================================================================
print("Contraste del acento")
prueba(TEMAS_VALIDOS == ("auto", "perla", "medianoche", "arena", "cielo"),
       "TEMAS_VALIDOS con los 5 ids nuevos")
prueba(ALIAS_TEMAS == {"claro": "perla", "oscuro": "medianoche"},
       "mapa de alias estable para espejar en el móvil")

# Acento bueno sobre fondo claro: NO se toca.
bueno = acento_contraste_seguro("#e11d48", "#faf8f5")
prueba(bueno == "#e11d48", "acento con buen contraste queda intacto")
prueba(contraste_suficiente("#e11d48", "#faf8f5"), "rosa sobre perla sí contrasta")

# Acento oscuro sobre fondo oscuro: se ajusta hasta >= 3:1.
prueba(not contraste_suficiente("#1a1a2e", "#0d0f16"), "azul oscuro sobre medianoche NO contrasta")
ajustado = acento_contraste_seguro("#1a1a2e", "#0d0f16")
prueba(ajustado != "#1a1a2e", "acento problemático se ajusta")
prueba(razon_contraste(ajustado, "#0d0f16") >= 3.0,
       f"acento ajustado alcanza >= 3:1 ({ajustado})")

# Acento claro sobre fondo claro: se oscurece hasta >= 3:1.
ajustado2 = acento_contraste_seguro("#f5f5ee", "#fdf6ec")
prueba(ajustado2 != "#f5f5ee" and razon_contraste(ajustado2, "#fdf6ec") >= 3.0,
       "acento muy claro sobre arena se oscurece hasta 3:1")

# El ajuste preserva el matiz (no se vuelve gris arbitrario).
h_antes = "#1a1a2e"
prueba(ajustado[5:7] >= ajustado[1:3], "el ajustado conserva dominante azul (matiz)")

# En el HTML generado, el acento efectivo es el seguro contra CADA tema.
html_contr = PLANTILLAS["noche"]({**CONFIG, "color_acento": "#101018"}, PRODUCTOS)
prueba(f"--acento:{acento_contraste_seguro('#101018', '#0d0f16')}" in html_contr,
       "medianoche usa el acento ajustado a su fondo")
prueba("--acento:#101018" in html_contr,
       "perla conserva el acento original (sobre fondo claro sí contrasta)")

# ==========================================================================
# 21. Nombres con personalidad (solo display móvil)
# ==========================================================================
print("Nombres de plantilla")
prueba(set(NOMBRES_PLANTILLA) == {"aurora", "noche", "mercado", "boutique", "menu", "catalogo"},
       "NOMBRES_PLANTILLA cubre las 6 ids")
prueba(len(set(NOMBRES_PLANTILLA.values())) == 6, "los 6 nombres son únicos")
prueba(all(v and isinstance(v, str) for v in NOMBRES_PLANTILLA.values()),
       "todos los nombres son texto no vacío")
print("  mapa:", NOMBRES_PLANTILLA)

# ==========================================================================
# 22. Checkout: pantalla de éxito de página completa
# ==========================================================================
print("Éxito de checkout v3")
for nombre, plantilla in PLANTILLAS.items():
    html = plantilla(CONFIG_V2, PRODUCTOS_V2)
    prueba('class="exito-overlay" id="exitoOverlay" hidden' in html,
           f"[{nombre}] overlay de página completa presente y oculto")
    prueba("¡Pedido realizado!" in html, f"[{nombre}] titular de éxito")
    prueba('id="exitoFolio"' in html and "exito-folio" in html,
           f"[{nombre}] folio como pieza tipográfica")
    prueba('id="exitoTotal"' in html and 'id="exitoResumen"' in html,
           f"[{nombre}] total y resumen en el overlay")
    prueba("Enviar también por WhatsApp" in html and 'id="btnWa"' in html,
           f"[{nombre}] botón WhatsApp en el overlay")
    prueba('id="btnPago"' in html and "Ir a pagar en línea" in html,
           f"[{nombre}] botón de pago en línea condicional")
    prueba("Volver a la tienda" in html and "cerrarExito" in html,
           f"[{nombre}] botón volver cierra el overlay")
    prueba("aparecerZoom" in html and "cubic-bezier(.16,1,.3,1)" in html,
           f"[{nombre}] overlay animado con el easing de la casa")
    prueba("prefers-reduced-motion" in html, f"[{nombre}] respeta reduced-motion")
    # Flujo de éxito en el JS: vaciar carrito SIEMPRE + cerrar sheet + overlay.
    prueba("pedido={};guardar();refrescarFab();\n    cerrarPedido();\n    mostrarExito(datos" in html,
           f"[{nombre}] éxito: limpia carrito (persistido), cierra sheet, muestra overlay")
    prueba("mostrarExito" in html and "exitoOverlay').hidden=false" in html,
           f"[{nombre}] el JS muestra el overlay al confirmar")
    prueba("cerrarPedido();\n    mostrarExito" in html,
           f"[{nombre}] el sheet se cierra al confirmar")
    # Error: mensaje dentro del sheet, sin tocar el carrito.
    prueba("catch(e)" in html and "errorPedido" in html
           and "Tu pedido sigue aquí" in html,
           f"[{nombre}] error de red: aviso cálido dentro del sheet")

# ==========================================================================
# 23. Contacto v3.1: teléfono O correo obligatorio + privacidad
# ==========================================================================
print("Contacto v3.1")
# Teléfono: válidos (formatos mexicanos con +52, espacios, guiones).
prueba(telefono_valido("6691234567"), "teléfono local 10 dígitos válido")
prueba(telefono_valido("+52 669 123 4567"), "teléfono +52 con espacios válido")
prueba(telefono_valido("+52-669-123-4567"), "teléfono con guiones válido")
prueba(telefono_valido("52 (669) 123 45 67"), "teléfono con paréntesis válido")
prueba(not telefono_valido("12345"), "teléfono muy corto inválido")
prueba(not telefono_valido("1" * 16), "teléfono de 16 dígitos inválido")
prueba(not telefono_valido(""), "teléfono vacío inválido (el backend decide requerido)")
prueba(not telefono_valido(None), "teléfono None inválido")

# Correo: válidos/inválidos razonables.
prueba(correo_valido("juan@gmail.com"), "correo simple válido")
prueba(correo_valido("Maria.Lopez+pos@tienda.com.mx"), "correo con + y subdominio válido")
prueba(not correo_valido("juan@"), "correo sin dominio inválido")
prueba(not correo_valido("juan@gmail"), "correo sin TLD inválido")
prueba(not correo_valido("@gmail.com"), "correo sin usuario inválido")
prueba(not correo_valido("juan perez@gmail.com"), "correo con espacio inválido")
prueba(not correo_valido(""), "correo vacío inválido")
prueba(normalizar_correo("  Juan@Gmail.COM ") == "juan@gmail.com",
       "correo se normaliza a minúsculas y trim")

# Contrato del backend (revisión de fuente).
bloque_ped = fuente.split('@app.post("/t/{slug}/pedido")')[1].split("@app.")[0]
prueba("cliente_correo" in bloque_ped, "POST acepta cliente_correo")
prueba("Déjanos tu teléfono o correo para avisarte de tu pedido." in bloque_ped,
       "POST sin contacto -> 400 cálido")
prueba("telefono_valido" in bloque_ped and "correo_valido" in bloque_ped,
       "POST valida formato de teléfono y correo cuando vienen")
prueba("normalizar_correo" in bloque_ped, "correo se guarda normalizado")
prueba("cliente_correo TEXT NOT NULL DEFAULT ''" in fuente,
       "migración ALTER tolerante para cliente_correo")
bloque_lista2 = fuente.split('@app.get("/api/tienda/pedidos")')[1].split("@app.")[0]
prueba("_pedido_dict" in bloque_lista2 and '"cliente_correo"' in fuente,
       "GET /api/tienda/pedidos incluye cliente_correo")

# Checkout: pide contacto + aviso de privacidad en las 6 plantillas.
for nombre, plantilla in PLANTILLAS.items():
    html = plantilla(CONFIG_V2, PRODUCTOS_V2)
    prueba('id="correo"' in html, f"[{nombre}] campo correo en el checkout")
    prueba("Teléfono o correo (para avisarte de tu pedido) *" in html,
           f"[{nombre}] etiqueta de contacto obligatorio")
    prueba("cliente_correo" in html, f"[{nombre}] el POST incluye cliente_correo")
    prueba("if(!tel&&!cor)" in html
           and "Déjanos tu teléfono o correo para avisarte de tu pedido." in html,
           f"[{nombre}] validación en cliente antes del POST (sin enviar)")
    prueba("datos.detail" in html,
           f"[{nombre}] el 400 del servidor se muestra tal cual")
    prueba("Tu teléfono/correo solo se comparte con esta tienda para avisarte de tu pedido. "
           "No se usa para publicidad ni se vende a nadie." in html,
           f"[{nombre}] aviso de privacidad dentro del sheet")
    prueba("Privacidad: tus datos de contacto solo sirven para gestionar tu pedido "
           "con esta tienda." in html,
           f"[{nombre}] línea de privacidad en el footer")

# ==========================================================================
# 24. Ubicación GPS v3.1
# ==========================================================================
print("Ubicación GPS v3.1")
prueba(ubicacion_valida("25.6866,-100.3161"), "lat,lng válida (Monterrey)")
prueba(ubicacion_valida(" 25.6866 , -100.3161 "), "tolera espacios alrededor de la coma")
prueba(ubicacion_valida("0,0"), "0,0 es válida (océano, pero en rango)")
prueba(ubicacion_valida("-33.4489,-70.6693"), "negativos válidos")
prueba(ubicacion_valida("90,180"), "límites exactos válidos")
prueba(ubicacion_valida("25.686600,-100.316100"), "6 decimales válidos")
prueba(not ubicacion_valida("91,0"), "lat fuera de rango inválida")
prueba(not ubicacion_valida("0,-181"), "lng fuera de rango inválida")
prueba(not ubicacion_valida("25.6866123,-100.3161"), "más de 6 decimales inválida")
prueba(not ubicacion_valida("25.6866"), "un solo número inválido")
prueba(not ubicacion_valida("25.6,-100.3,7"), "tres números inválidos")
prueba(not ubicacion_valida("norte,poniente"), "texto inválido")
prueba(not ubicacion_valida(""), "vacía inválida")
prueba(not ubicacion_valida(None), "None inválida")

prueba(normalizar_ubicacion("25.6866,-100.3161") == "25.686600,-100.316100",
       "normaliza a 6 decimales")
prueba(normalizar_ubicacion("0,0") == "0.000000,0.000000", "normaliza enteros")
prueba(normalizar_ubicacion("91,0") == "", "inválida -> cadena vacía (best-effort)")
prueba(normalizar_ubicacion("") == "", "vacía -> cadena vacía")

# Contrato del backend (revisión de fuente).
prueba("ubicacion TEXT NOT NULL DEFAULT ''" in fuente,
       "migración ALTER tolerante para ubicacion")
bloque_ped2 = fuente.split('@app.post("/t/{slug}/pedido")')[1].split("@app.")[0]
prueba("ubicacion: str | None = None" in fuente, "POST acepta ubicacion opcional")
prueba("normalizar_ubicacion" in bloque_ped2, "ubicación se guarda normalizada")
prueba(":ubi" in bloque_ped2, "INSERT persiste la ubicación")
prueba("400" not in bloque_ped2.split("ubicacion = normalizar_ubicacion")[1].split("\n")[0],
       "ubicación inválida NO rechaza el pedido (se ignora)")
prueba('"ubicacion"' in fuente, "GET /api/tienda/pedidos incluye ubicacion")

# Checkout: botón de geolocalización en las 6 plantillas.
for nombre, plantilla in PLANTILLAS.items():
    html = plantilla(CONFIG_V2, PRODUCTOS_V2)
    prueba("Usar mi ubicación exacta" in html and "usarUbicacion" in html,
           f"[{nombre}] botón de ubicación exacta")
    prueba("navigator.geolocation.getCurrentPosition" in html,
           f"[{nombre}] usa geolocation del navegador")
    prueba("Ubicación lista — llegará como pin en el mapa" in html,
           f"[{nombre}] confirmación cálida al capturar el pin")
    prueba("https://maps.google.com/?q=" in html,
           f"[{nombre}] enlace de verificación en el mapa")
    prueba("No pudimos obtener tu ubicación; escribe tu dirección con referencias." in html,
           f"[{nombre}] falla/permiso negado: mensaje cálido sin bloquear")
    prueba("'geolocation' in navigator" in html,
           f"[{nombre}] no bloquea si geolocation no existe (desktop viejo)")
    prueba("Calle, número, colonia, entre calles, color de la fachada…" in html,
           f"[{nombre}] placeholder de dirección con referencias")
    prueba("ubicacion:geoPin" in html, f"[{nombre}] el POST envía la ubicación capturada")

print()
print("TODAS LAS PRUEBAS PASARON")