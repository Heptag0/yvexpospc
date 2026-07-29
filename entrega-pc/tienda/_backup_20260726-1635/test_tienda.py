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
    construir_texto_pedido,
    construir_url_whatsapp,
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

print()
print("TODAS LAS PRUEBAS PASARON")
