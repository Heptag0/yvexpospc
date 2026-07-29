"""Escáner de tickets de proveedor con IA — el "extractor".

Recibe la FOTO de un ticket de compra/resurtido (Bimbo, Sabritas, Coca-Cola,
cervecerías, abarrotes...) en base64, la manda a un proveedor de IA con visión
y devuelve el análisis estructurado (proveedor, líneas, cantidades, costos)
para que la app lo convierta en entrada de inventario.

Principios de diseño:
  - Este endpoint NO toca la base de datos. Solo recibe la foto, llama a la IA
    y devuelve el análisis. Toda la persistencia sigue viviendo en el POS/PC.
  - La autenticación es la MISMA que el sync: dispositivo + token por headers
    (X-Dispositivo-Id / X-Dispositivo-Token). Una caja no registrada no puede
    gastar la cuota de IA del negocio.
  - DETERMINISMO: la llamada a Gemini usa temperature=0 (modo robótico, lo
    correcto para OCR/extracción). Con la temperatura por defecto (1.0) la
    MISMA foto daba resultados distintos en cada intento.
  - El proveedor de IA se configura por VARIABLES DE ENTORNO, sin tocar código:
      IA_PROVEEDOR = "mock" | "gemini" | "kimi"   (default: "mock")
      IA_API_KEY   = una llave del proveedor      (default: vacía)
      IA_API_KEYS  = varias llaves separadas por comas (gana sobre IA_API_KEY;
                     cada key de Gemini es un proyecto con cuota propia, así
                     se multiplica el techo de respaldo)
      IA_MODELO    = un solo modelo (si se pone, manda sobre IA_MODELOS)
      IA_MODELOS   = cadena de modelos Gemini separada por comas
  - CADENA DE RESPALDO doble (modelos × keys, orden MODELO-MAJOR): el orden de
    intentos es, para cada modelo de la cadena, cada key en orden — se agota el
    MEJOR modelo en TODAS las keys antes de degradar a un modelo peor;
    429/5xx/timeout/red pasa al siguiente candidato; 401/403 (key inválida)
    salta a la SIGUIENTE KEY sin gastar más modelos con ella. El servidor
    recuerda el último combo ganador (_ultimo_combo_bueno = (indice_key,
    modelo)) y lo intenta primero. La respuesta incluye "modelo_usado"; NUNCA
    expone qué key se usó, y ningún error incluye la key (ni parcial).
  - MODO MOCK: con IA_PROVEEDOR=mock no se llama a nadie y se devuelve una
    respuesta realista de prueba. Permite probar TODO el flujo de la app sin
    tener API key todavía.
  - PIPELINE: imagen → [Gemini visión] → JSON (temperature=0). Es el que mejor
    lee tickets térmicos reales: maneja rotación, columnas y baja calidad.
    Existe un pipeline alternativo con OCR local (EasyOCR → Gemini texto) pero
    quedó DESACTIVADO tras fallar en producción (texto sin columnas, errores
    con fotos rotadas); solo se activa con IA_OCR=1 para experimentar.
  - Robustez ante la IA: la respuesta del proveedor se NORMALIZA en el servidor
    (defaults defensivos, tipos válidos, centavos enteros, máx. 100 líneas) y
    pasa un CHEQUEO DE SANIDAD determinista (cantidad × costo vs. importe;
    nombre que sugiere empaque múltiple con precio implausible de pieza).
    Si el JSON es parseable aunque venga incompleto, se devuelve 200 igual.
  - ANCLA DE CATÁLOGO: la app puede mandar el catálogo del negocio en la
    petición ("catalogo": [{nombre, alias, presentacion, empaque_piezas,
    ultimo_costo_centavos}]; máx. 300, textos truncados). Se inyecta como
    sección en el prompt y la IA etiqueta las líneas que coinciden CLARAMENTE
    con "catalogo_idx" (validado en rango server-side; dudoso → null, nunca
    forzado). Con catálogo vacío la sección se omite (comportamiento anterior).
  - VERIFICACIÓN ADAPTATIVA CRUZADA: si el análisis sale DUDOSO (línea con
    confianza baja, nota de "no cuadra", suma de líneas vs. total no cuadra, o
    0 líneas), se hace una SEGUNDA lectura con OTRO modelo de la cadena y se
    cruzan ambas línea a línea (empareje por similitud de nombre). La respuesta
    es la PRIMERA lectura anotada: líneas confirmadas → confianza "alta" +
    "verificado con doble lectura"; discrepantes o sin pareja → "baja" con su
    nota. NUNCA se sustituyen números de la primera lectura y NUNCA falla el
    endpoint por fallar la verificación. Si el ticket sale limpio, no se gasta
    la cuota de la segunda lectura. El campo "verificacion" reporta el resultado.
  - Dinero SIEMPRE en centavos enteros (pesos × 100). Nunca flotantes de pesos.
"""
import base64
import json
import os
import re
import socket
import unicodedata
import urllib.error
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy.orm import Session

import auth
from database import get_db
from models import Dispositivo

router = APIRouter()


# ==========================================================================
# Autenticación del dispositivo (idéntica a la del sync)
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
# Configuración del proveedor de IA (por variables de entorno)
# ==========================================================================
MODELOS_GEMINI_DEFAULT = [
    "gemini-flash-latest",       # Flash completo primero: el que mejor lee tickets
    "gemini-flash-lite-latest",  # respaldo de cuota
    "gemini-3.1-flash-lite",     # último respaldo
]
MODELO_KIMI_DEFAULT = "kimi-k2.6"

TIMEOUT_SEGUNDOS = 60
MAX_B64_CARACTERES = 8 * 1024 * 1024
MAX_LINEAS = 100
MAX_TEXTO = 120
MAX_DETALLE_ERROR = 300

# Catálogo del negocio en la petición (Ancla 1): tope defensivo.
MAX_CATALOGO = 300          # solo los primeros N productos entran al prompt
MAX_TEXTO_CATALOGO = 60     # truncado de nombres/alias dentro del prompt

TIPOS_VALIDOS = {"venta", "cambio", "envase", "otro"}
CONFIANZAS_VALIDAS = {"alta", "media", "baja"}

TOLERANCIA_PCT = 0.02
TOLERANCIA_MIN_CENTAVOS = 50

REGEX_EMPAQUE = re.compile(
    r"(?i)(\b\d{1,2}\s?pack\b|\bpack\b|\b\d{1,2}\s?pk\b|\bpk\b"
    r"|\bk\s?\d{1,2}\b|\bx\s?\d{1,2}\b|\bcharola\b|\bdisplay\b)")
UMBRAL_PRECIO_PIEZA_CENTAVOS = 8000


def _config_ia() -> tuple[str, list[str], list[str]]:
    proveedor = (os.environ.get("IA_PROVEEDOR") or "mock").strip().lower()

    cruda_keys = (os.environ.get("IA_API_KEYS") or "")
    api_keys = [k.strip() for k in cruda_keys.split(",") if k.strip()]
    if not api_keys:
        singular_key = (os.environ.get("IA_API_KEY") or "").strip()
        api_keys = [singular_key] if singular_key else []

    singular = (os.environ.get("IA_MODELO") or "").strip()
    if singular:
        modelos = [singular]
    else:
        cruda = (os.environ.get("IA_MODELOS") or "").strip()
        if cruda:
            modelos = [m.strip() for m in cruda.split(",") if m.strip()]
        elif proveedor == "kimi":
            modelos = [MODELO_KIMI_DEFAULT]
        else:
            modelos = list(MODELOS_GEMINI_DEFAULT)
    return proveedor, api_keys, modelos


# ==========================================================================
# OCR determinista con EasyOCR (opcional, carga lazy)
# ==========================================================================
_reader_ocr = None

def _get_ocr_reader():
    global _reader_ocr
    if _reader_ocr is None:
        import easyocr
        _reader_ocr = easyocr.Reader(["es", "en"], gpu=False)
    return _reader_ocr


def extraer_texto_ocr(imagen_b64: str) -> str:
    """Extrae texto plano de la imagen con EasyOCR.

    Lanza excepción si EasyOCR no está instalado o falla.
    El texto plano se pasa luego a Gemini como prompt de texto (no imagen),
    lo que elimina la variabilidad de visión y reduce costos.
    """
    import io
    from PIL import Image

    datos = base64.b64decode(imagen_b64)
    img = Image.open(io.BytesIO(datos))
    reader = _get_ocr_reader()
    resultados = reader.readtext(img, detail=0, paragraph=True)
    return "\n".join(resultados)


# ==========================================================================
# Prompts de extracción
# ==========================================================================
PROMPT_TEXTO = """Eres un extractor de datos de tickets de COMPRA/RESURTIDO de tiendas mexicanas (abarrotes, bebidas, botanas, pan, cerveza, lácteos, etc.).

Recibes el TEXTO PLANO extraído por OCR de un ticket de proveedor. Tu tarea es devolver UN SOLO objeto JSON válido (sin markdown ni texto extra).

REGLAS:
1. Devuelve ÚNICAMENTE un objeto JSON válido con esta forma exacta:
{"proveedor": "<nombre del proveedor o null>", "proveedor_id": "bimbo"|"sabritas"|"cocacola"|"cerveceria"|"otro", "fecha": "AAAA-MM-DD"|null, "folio": string|null, "es_preventa": bool, "lineas": [{"nombre_crudo": string, "nombre_sugerido": string, "codigo_barras": string|null, "cantidad": number, "unidad_ticket": "pieza"|"caja"|"pack"|null, "piezas_por_empaque": number|null, "costo_unitario_centavos": int, "importe_centavos": int|null, "tipo": "venta"|"cambio"|"envase"|"otro", "confianza": "alta"|"media"|"baja", "nota": string|null}], "total_ticket_centavos": int|null, "avisos": [string]}

2. tipo de línea:
   - "venta": producto que entra al inventario.
   - "cambio": líneas bajo secciones como "CAMBIO FISICO"/"remplazo"/"devolución": producto dañado o caducado que se intercambia; NO entra al inventario.
   - "envase": envases retornables, "PRESTAMO DE ENVASE", "CAJPLAG", depósitos de envase.
   - "otro": líneas de producto no vendible.

3. NO son líneas: totales, subtotales, impuestos (IVA/IEPS), descuentos globales, pagos, "usted gana/ahorra", puntos de lealtad, textos legales.

4. nombre_crudo: TEXTO EXACTO del ticket, letra por letra; NUNCA inventes, completes ni "mejores" un nombre que no se lee. nombre_sugerido: legible en español; expande abreviaturas si se puede inferir; si no, repite el crudo.

5. codigo_barras: si junto a la línea hay un código EAN/UPC (8-14 dígitos), extráelo; si no, null.

6. cantidad: número tal como vende el ticket (puede ser decimal). unidad_ticket según se venda. piezas_por_empaque: si la presentación indica piezas por caja/pack, ese número; si no se indica, null.

7. Dinero en CENTAVOS enteros (pesos × 100, redondeado). costo_unitario_centavos: precio unitario; si hay descuento por línea, el unitario NETO (importe ÷ cantidad). importe_centavos: total de la línea si aparece.

8. confianza: "alta" si se lee claro; "media" con dudas; "baja" si es manuscrito, manchado o cortado.

9. NUNCA inventes líneas ni números. Si una zona es ilegible, incluye lo legible con confianza baja y añade un aviso global.

10. es_preventa: true si el ticket es de preventa o indica entrega futura.

11. total_ticket_centavos: TOTAL final a pagar impreso; null si no se lee.

12. avisos: lista corta de observaciones útiles.

13. CANTIDAD: usa SIEMPRE la columna de cantidad del ticket (CANT, CANTIDAD), tal cual. Los números dentro del nombre describen presentación o empaque del fabricante; NUNCA los uses como cantidad vendida.

14. VERIFICACIÓN OBLIGATORIA por línea: multiplica cantidad × costo_unitario y compara con el importe impreso de esa línea (±2% por redondeos). Si cuadra con unidad "pieza", usa "pieza". Si NO cuadra y el precio unitario es claramente de empaque/caja (típicamente >80 pesos), usa unidad "caja" y pon en piezas_por_empaque las piezas que indica el propio nombre.

15. DETECCIÓN DE EMPAQUE: si el nombre indica empaque múltiple (PACK, PK, K<dígito>, X<dígito>, <dígito>PK, DISPLAY, CHAROLA, CAJA) y el precio unitario resulta implausible para UNA pieza suelta, la línea es un empaque.

16. Cantidades decimales (ej. 7.6) solo son válidas para producto a granel (kg, lt); en productos empaquetados una cantidad decimal es casi seguro un error de lectura.

17. PROVEEDOR: el campo proveedor se lee SOLO del encabezado/pie del ticket donde aparece la razón social o logotipo del emisor. NUNCA deduzcas el proveedor a partir de las marcas de los productos.

18. NOMBRE_SUGERIDO: se deriva SOLO de nombre_crudo; NUNCA añadas palabras, marcas o variantes que no estén en el texto del ticket.

19. CAMBIO FISICO: las líneas bajo un encabezado CAMBIO FISICO/CAMBIO/DEVOLUCION son tipo "cambio" AUNQUE el producto también aparezca como venta en el mismo ticket; la sección manda sobre el producto. Son intercambios de producto dañado o caducado: NO entran al inventario.

20. FECHAS: en tickets mexicanos el formato es casi siempre DD/MM/AAAA o DD-MM-AAAA (día primero). Ante la duda entre DD/MM y MM/DD, elige DD/MM. Devuelve siempre AAAA-MM-DD.

21. COLUMNAS DOBLES DE CANTIDAD: algunos tickets traen dos columnas de cantidad (pedido vs entregado: "S.P|E.F", "PED.|ENT.", orden vs surtido). Usa SIEMPRE la columna ENTREGADO/SURTIDO (E.F, ENT, la segunda). Si una fila tiene entregado=0, la cantidad es 0 (ver la regla siguiente).

22. PRODUCTO NO ENTREGADO (SHORTAGE/RECHAZO): filas con entregado=0 e importe $0.00, a veces con una leyenda "SHORTAGE" o "RECHAZO" debajo, son producto que NO se entregó: NO las incluyas como líneas; añade un aviso global ("no entregaron X"). Las leyendas tipo "** SHORTAGE ... **" NUNCA son líneas.

23. ENVASE RETORNABLE: secciones "MOVIMIENTO DE ENVASE" o tablas de cajas/tarimas retornables (con columnas tipo ANT|ENT|REC|ACT) son envase, NUNCA líneas de producto.

24. EAN/SKU: si el ticket trae columna EAN/SKU por línea, el código EAN de 13 dígitos es el codigo_barras (identificador exacto del producto): extráelo. Un SKU corto interno (3-6 dígitos) NO es código de barras.

25. GRANEL (KG): en tickets de producto a granel (embutidos, lácteos), la cantidad puede tener 3 decimales y representa kilogramos: es VÁLIDA; respeta el decimal tal cual, unidad_ticket="pieza" y añade nota "se vende por kg".

26. IMPUESTOS POR TASA: desgloses de impuestos ("BASE TASA 00%", "IVA 8%", "IVA 16%", "CUOTA FIJA IEPS", bases por tasa) NUNCA son líneas.

TEXTO EXTRAÍDO DEL TICKET:
---
__TEXTO_OCR__
---

Devuelve ÚNICAMENTE el objeto JSON."""


PROMPT_IMAGEN = """Eres un extractor de datos de tickets de COMPRA/RESURTIDO de tiendas mexicanas (abarrotes, bebidas, botanas, pan, cerveza, lácteos, etc.). Analizas la foto de un ticket de proveedor y devuelves JSON estricto.

REGLAS:
1. La foto puede estar rotada o al revés: ignóralo.
2. Devuelve ÚNICAMENTE un objeto JSON válido (sin markdown ni texto extra) con esta forma:
{"proveedor": "<nombre del proveedor o null>", "proveedor_id": "bimbo"|"sabritas"|"cocacola"|"cerveceria"|"otro", "fecha": "AAAA-MM-DD"|null, "folio": string|null, "es_preventa": bool, "lineas": [{"nombre_crudo": string, "nombre_sugerido": string, "codigo_barras": string|null, "cantidad": number, "unidad_ticket": "pieza"|"caja"|"pack"|null, "piezas_por_empaque": number|null, "costo_unitario_centavos": int, "importe_centavos": int|null, "tipo": "venta"|"cambio"|"envase"|"otro", "confianza": "alta"|"media"|"baja", "nota": string|null}], "total_ticket_centavos": int|null, "avisos": [string]}
3. tipo de línea:
   - "venta": producto que entra al inventario.
   - "cambio": líneas bajo secciones como "CAMBIO FISICO"/"remplazo"/"devolución": producto dañado o caducado que se intercambia; NO entra al inventario.
   - "envase": envases retornables, "PRESTAMO DE ENVASE", "CAJPLAG", depósitos de envase.
   - "otro": líneas de producto no vendible.
4. NO son líneas: totales, subtotales, impuestos (IVA/IEPS), descuentos globales, pagos, "usted gana/ahorra", puntos de lealtad, textos legales ("NO VALIDA PARA VENTA").
5. nombre_crudo: se copia TEXTO EXACTO del ticket, letra por letra; NUNCA inventes, completes ni "mejores" un nombre que no se lee — si no se lee bien, pon lo que alcances y marca confianza="baja". nombre_sugerido: legible en español; expande abreviaturas si se puede inferir; si no, repite el crudo.
6. codigo_barras: si junto a la línea hay un código EAN/UPC (8-14 dígitos), extráelo; si no, null.
7. cantidad: número tal como vende el ticket (puede ser decimal). unidad_ticket según se venda. piezas_por_empaque: si la presentación indica piezas por caja/pack, ese número ("6 PK H C 24 355 ML"→24; "45GRX50X1"→50; "12 PK"→12); si no se indica, null.
8. Dinero en CENTAVOS enteros (pesos × 100, redondeado). costo_unitario_centavos: precio unitario; si hay descuento por línea, el unitario NETO (importe ÷ cantidad). importe_centavos: total de la línea si aparece.
9. confianza: "alta" si se lee claro; "media" con dudas; "baja" si es manuscrito, manchado o cortado — con nota explicando ("zona con tinta corrida").
10. NUNCA inventes líneas ni números. Si una zona es ilegible, incluye lo legible con confianza baja y añade un aviso global.
11. es_preventa: true si el ticket es de preventa o indica entrega futura.
12. total_ticket_centavos: TOTAL final a pagar impreso; null si no se lee.
13. avisos: lista corta de observaciones útiles ("parte superior ilegible", "cantidades manuscritas", "ticket de preventa con entrega 2026-07-04").
14. CANTIDAD: usa SIEMPRE la columna de cantidad del ticket (CANT, CANTIDAD), tal cual. Los números dentro del nombre (ej. "60GRX36X1", "24 355 ML", "4 X 4 LTS", "12 940ML") describen presentación o empaque del fabricante; NUNCA los uses como cantidad vendida.
15. VERIFICACIÓN OBLIGATORIA por línea: multiplica cantidad × costo_unitario y compara con el importe impreso de esa línea (±2% por redondeos). Si cuadra con unidad "pieza", usa "pieza" y piezas_por_empaque=null. Si NO cuadra y el precio unitario es claramente de empaque/caja (típicamente >80 pesos en cerveza/refresco), usa unidad "caja" y pon en piezas_por_empaque las piezas que indica el propio nombre (ej. "24 355 ML" → 24, "6PK" → 6, "12 940ML" → 12). Si el nombre no indica piezas, piezas_por_empaque=null.
16. Para líneas de tipo "cambio" la misma regla de verificación aplica con su importe si lo trae.
17. DETECCIÓN DE EMPAQUE: si el nombre indica empaque múltiple (PACK, PK, K<dígito>, X<dígito>, <dígito>PK, DISPLAY, CHAROLA, CAJA) y el precio unitario resulta implausible para UNA pieza suelta de ese tipo de producto según precios típicos de México (ej. refresco/agua/cerveza individual rara vez supera $80; botana individual rara vez supera $60), y la aritmética cantidad × costo = importe cuadra con ese precio, entonces la línea es un empaque: unidad="caja" o "pack" y piezas_por_empaque = el número que indica el nombre. Una pieza suelta con precio implausible es casi siempre un empaque mal leído.
18. Cantidades decimales (ej. 7.6) solo son válidas para producto a granel (kg, lt); en productos empaquetados una cantidad decimal es casi seguro un error de lectura: revisa o marca confianza="baja".
19. PROVEEDOR: el campo proveedor se lee SOLO del encabezado/pie del ticket donde aparece la razón social o logotipo del emisor. NUNCA deduzcas el proveedor a partir de las marcas de los productos vendidos (una tienda puede comprar productos de muchas marcas a un solo distribuidor). Si no hay razón social legible, proveedor=null.
20. NOMBRE_SUGERIDO: nombre_sugerido se deriva SOLO de nombre_crudo: puedes expandir abreviaturas evidentes (LG→Light, ADOB→Adobada) y quitar códigos internos, pero NUNCA añadas palabras, marcas o variantes que no estén en el texto del ticket, ni sustituyas por sinónimos (no conviertas "Lager" en "Ligera" ni nada parecido). Ante la duda, nombre_sugerido = nombre_crudo limpio.
21. CAMBIO FISICO: las líneas bajo un encabezado CAMBIO FISICO/CAMBIO/DEVOLUCION son tipo "cambio" AUNQUE el producto también aparezca como venta en el mismo ticket; la sección manda sobre el producto. Son intercambios de producto dañado o caducado: NO entran al inventario.
22. FECHAS: en tickets mexicanos el formato es casi siempre DD/MM/AAAA o DD-MM-AAAA (día primero). Ante la duda entre DD/MM y MM/DD, elige DD/MM. Devuelve siempre AAAA-MM-DD.
23. COLUMNAS DOBLES DE CANTIDAD: algunos tickets traen dos columnas de cantidad (pedido vs entregado: "S.P|E.F", "PED.|ENT.", orden vs surtido). Usa SIEMPRE la columna ENTREGADO/SURTIDO (E.F, ENT, la segunda). Si una fila tiene entregado=0, la cantidad es 0 (ver la regla siguiente).
24. PRODUCTO NO ENTREGADO (SHORTAGE/RECHAZO): filas con entregado=0 e importe $0.00, a veces con una leyenda "SHORTAGE" o "RECHAZO" debajo, son producto que NO se entregó: NO las incluyas como líneas; añade un aviso global ("no entregaron X"). Las leyendas tipo "** SHORTAGE ... **" NUNCA son líneas.
25. ENVASE RETORNABLE: secciones "MOVIMIENTO DE ENVASE" o tablas de cajas/tarimas retornables (con columnas tipo ANT|ENT|REC|ACT) son envase, NUNCA líneas de producto.
26. EAN/SKU: si el ticket trae columna EAN/SKU por línea, el código EAN de 13 dígitos es el codigo_barras (identificador exacto del producto): extráelo. Un SKU corto interno (3-6 dígitos) NO es código de barras.
27. GRANEL (KG): en tickets de producto a granel (embutidos, lácteos), la cantidad puede tener 3 decimales y representa kilogramos: es VÁLIDA; respeta el decimal tal cual, unidad_ticket="pieza" y añade nota "se vende por kg".
28. IMPUESTOS POR TASA: desgloses de impuestos ("BASE TASA 00%", "IVA 8%", "IVA 16%", "CUOTA FIJA IEPS", bases por tasa) NUNCA son líneas.

EJEMPLOS (productos genéricos; el patrón es lo que importa):
- "SNACK SAL X 60GRX36X1 | CANT 5 | P.UNIT 15.85 | IMP 79.25" → cantidad=5, unidad_ticket="pieza", piezas_por_empaque=null, costo_unitario_centavos=1585, importe_centavos=7925. (5×15.85=79.25 cuadra; los números del nombre son presentación, NO la cantidad.)
- "BEBIDA LATA 6PK 24 355ML | CANT 13 | P.UNIT 320.00 | IMP 4,160.00" → cantidad=13, unidad_ticket="caja", piezas_por_empaque=24, costo_unitario_centavos=32000, importe_centavos=416000. (13×320.00=4,160.00 cuadra por CAJA de 24.)
- "AGUA PURIF 4 X 4 LTS | CANT 4 | P.UNIT 73.23 | IMP 292.95" → cantidad=4, unidad_ticket="pieza", piezas_por_empaque=null, costo_unitario_centavos=7323, importe_centavos=29295. ("4 X 4 LTS" es presentación del producto, no empaque: 4×73.23=292.95 cuadra por pieza.)
- "REFRESCO 600ML NR 4 PACK | CANT 3 | P.UNIT 73.49 | IMP 220.47" → cantidad=3, unidad_ticket="pack", piezas_por_empaque=4, costo_unitario_centavos=7349, importe_centavos=22047. (3×73.49=220.47 cuadra; $73.49 es implausible para UNA botella de 600 ml: es un pack de 4.)
- Sección del ticket: bajo "VENTA" aparece "SNACK SAL X 60G | CANT 5 | 15.85 | 79.25" y más abajo, bajo el encabezado "CAMBIO FISICO", aparece "SNACK SAL X 60G | CANT 2 | 15.85 | 31.70" → la primera línea tipo="venta"; la segunda tipo="cambio" (mismo producto y precio, pero está bajo CAMBIO FISICO: es un intercambio por producto dañado/caducado y NO entra al inventario; la sección manda sobre el producto).
- Fila con doble columna y shortage: "CERVEZA LATA 355 | PED. 12 | ENT. 0 | IMP 0.00" con leyenda "** SHORTAGE **" debajo → NO es línea (no se entregó); solo añade el aviso "no entregaron CERVEZA LATA 355". En cambio "CERVEZA LATA 355 | PED. 12 | ENT. 10 | IMP 1,500.00" SÍ es línea con cantidad=10 (la columna ENTREGADO, no el pedido).
- Granel: "JAMON GRANEL | 4.500 KG | P.UNIT 89.00 | IMP 400.50" → cantidad=4.5 (kilogramos, decimal válido), unidad_ticket="pieza", costo_unitario_centavos=8900, importe_centavos=40050, nota="se vende por kg"."""


# ==========================================================================
# Catálogo del negocio → sección del prompt (Ancla 1)
# La app manda su catálogo en la petición; si una línea del ticket coincide
# claramente con una entrada, la IA la etiqueta con "catalogo_idx". Si el
# catálogo viene vacío, la sección se OMITE (comportamiento de siempre).
# ==========================================================================
def _trunc_catalogo(s, maximo: int = MAX_TEXTO_CATALOGO) -> str:
    return (str(s) if s is not None else "").strip()[:maximo]


def _renderizar_catalogo(catalogo: list) -> str:
    """Renderiza la sección CATÁLOGO DEL NEGOCIO; "" si no hay entradas."""
    entradas = (catalogo or [])[:MAX_CATALOGO]
    if not entradas:
        return ""
    filas = []
    for i, e in enumerate(entradas):
        partes = [f"{i}. {_trunc_catalogo(getattr(e, 'nombre', ''))}"]
        alias = [_trunc_catalogo(a) for a in (getattr(e, "alias", None) or [])
                 if a and str(a).strip()][:5]
        if alias:
            partes.append("alias: " + ", ".join(alias))
        presentacion = _trunc_catalogo(getattr(e, "presentacion", None))
        if presentacion:
            partes.append(f"presentación: {presentacion}")
        empaque = getattr(e, "empaque_piezas", None)
        if empaque:
            partes.append(f"empaque de {empaque} piezas")
        ultimo = getattr(e, "ultimo_costo_centavos", None)
        if ultimo is not None:
            partes.append(f"último costo ${ultimo / 100:.2f}")
        filas.append(" | ".join(partes))
    return (
        "\n\nCATÁLOGO DEL NEGOCIO (productos que la tienda maneja; las líneas "
        "del ticket probablemente corresponden a entradas de esta lista):\n"
        + "\n".join(filas)
        + "\nINSTRUCCIONES DE CATÁLOGO: si una línea del ticket coincide "
          "CLARAMENTE con una entrada (por nombre, alias o presentación), "
          "incluye en esa línea el campo \"catalogo_idx\" con el índice entero "
          "de la entrada; si no hay correspondencia clara, pon null. NUNCA "
          "fuerces una correspondencia dudosa: un empareje equivocado es peor "
          "que ninguno. El catálogo también te ayuda a resolver abreviaturas "
          "en nombre_sugerido, pero nombre_crudo sigue siendo el texto exacto "
          "del ticket."
    )


# ==========================================================================
# Respuesta MOCK (modo de prueba, sin API key)
# ==========================================================================
RESPUESTA_MOCK = {
    "proveedor": "Bimbo",
    "proveedor_id": "bimbo",
    "fecha": "2026-07-14",
    "folio": None,
    "es_preventa": False,
    "lineas": [
        {"nombre_crudo": "Nitolp62gMB", "nombre_sugerido": "Nito 1p 62g", "codigo_barras": "7501000112784",
         "cantidad": 10, "unidad_ticket": "pieza", "piezas_por_empaque": None,
         "costo_unitario_centavos": 1306, "importe_centavos": 13060,
         "tipo": "venta", "confianza": "alta", "nota": None},
        {"nombre_crudo": "Rebanada 2p", "nombre_sugerido": "Rebanada 2p", "codigo_barras": "7501000112845",
         "cantidad": 4, "unidad_ticket": "pieza", "piezas_por_empaque": None,
         "costo_unitario_centavos": 615, "importe_centavos": 2460,
         "tipo": "venta", "confianza": "alta", "nota": None},
        {"nombre_crudo": "ChocRole80g", "nombre_sugerido": "Choc Role 80g", "codigo_barras": "75002275",
         "cantidad": 2, "unidad_ticket": "pieza", "piezas_por_empaque": None,
         "costo_unitario_centavos": 1691, "importe_centavos": 3382,
         "tipo": "venta", "confianza": "alta", "nota": None},
        {"nombre_crudo": "RolGlas205gM", "nombre_sugerido": "Rol Glaseado 205g", "codigo_barras": "7503030374002",
         "cantidad": 1, "unidad_ticket": "pieza", "piezas_por_empaque": None,
         "costo_unitario_centavos": 1921, "importe_centavos": 1921,
         "tipo": "venta", "confianza": "baja", "nota": "zona con tinta corrida"},
        {"nombre_crudo": "Rebanada 2p", "nombre_sugerido": "Rebanada 2p", "codigo_barras": "7501000112845",
         "cantidad": 4, "unidad_ticket": "pieza", "piezas_por_empaque": None,
         "costo_unitario_centavos": 615, "importe_centavos": 2460,
         "tipo": "cambio", "confianza": "alta", "nota": None},
        {"nombre_crudo": "ChocRole80g", "nombre_sugerido": "Choc Role 80g", "codigo_barras": "75002275",
         "cantidad": 2, "unidad_ticket": "pieza", "piezas_por_empaque": None,
         "costo_unitario_centavos": 1691, "importe_centavos": 3382,
         "tipo": "cambio", "confianza": "alta", "nota": None},
    ],
    "total_ticket_centavos": 26242,
    "avisos": ["mancha de tinta en la primera línea"],
}


# ==========================================================================
# Normalización server-side
# ==========================================================================
def _a_texto(v, maximo: int = MAX_TEXTO):
    if v is None:
        return None
    if not isinstance(v, str):
        v = str(v)
    v = v.strip()
    return v[:maximo] if v else None


def _a_numero(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        try:
            return float(v)
        except ValueError:
            return None
    return None


def _a_centavos(v):
    n = _a_numero(v)
    return int(round(n)) if n is not None else None


def _a_bool(v) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    if isinstance(v, str):
        return v.strip().lower() in ("true", "1", "si", "sí", "yes")
    return False


def _a_catalogo_idx(v, num_catalogo: int):
    """Índice de catálogo válido (0..num_catalogo-1); si no, None."""
    if num_catalogo <= 0:
        return None
    n = _a_numero(v)
    if n is None or int(n) != n:
        return None
    idx = int(n)
    return idx if 0 <= idx < num_catalogo else None


def _normalizar_linea(linea, num_catalogo: int = 0) -> dict | None:
    if not isinstance(linea, dict):
        return None
    nombre_crudo = _a_texto(linea.get("nombre_crudo")) or ""
    nombre_sugerido = _a_texto(linea.get("nombre_sugerido")) or nombre_crudo
    tipo = linea.get("tipo")
    if not isinstance(tipo, str) or tipo not in TIPOS_VALIDOS:
        tipo = "venta"
    confianza = linea.get("confianza")
    if not isinstance(confianza, str) or confianza not in CONFIANZAS_VALIDAS:
        confianza = "media"
    unidad = linea.get("unidad_ticket")
    if not isinstance(unidad, str) or unidad not in ("pieza", "caja", "pack"):
        unidad = None
    return {
        "nombre_crudo": nombre_crudo,
        "nombre_sugerido": nombre_sugerido,
        "codigo_barras": _a_texto(linea.get("codigo_barras"), 20),
        "cantidad": _a_numero(linea.get("cantidad")) or 0,
        "unidad_ticket": unidad,
        "piezas_por_empaque": _a_centavos(linea.get("piezas_por_empaque")),
        "costo_unitario_centavos": _a_centavos(linea.get("costo_unitario_centavos")) or 0,
        "importe_centavos": _a_centavos(linea.get("importe_centavos")),
        "tipo": tipo,
        "confianza": confianza,
        "nota": _a_texto(linea.get("nota")),
        "catalogo_idx": _a_catalogo_idx(linea.get("catalogo_idx"), num_catalogo),
    }


NOTA_NO_CUADRA = "La línea no cuadra con su importe; revisa cantidad y costo."
NOTA_SOSPECHA_EMPAQUE = ("El nombre sugiere empaque múltiple; si es caja o "
                         "pack, ajústalo en la app con '¿viene en caja o pack?'.")


def _agregar_nota(linea: dict, nota: str) -> None:
    if linea["nota"]:
        if nota not in linea["nota"]:
            linea["nota"] = f"{linea['nota']}; {nota}"[:MAX_TEXTO]
    else:
        linea["nota"] = nota


def _chequeo_sanidad(lineas: list, avisos: list) -> None:
    for linea in lineas:
        if linea["tipo"] not in ("venta", "cambio"):
            continue

        cantidad = linea["cantidad"]
        costo = linea["costo_unitario_centavos"]
        importe = linea["importe_centavos"]
        if cantidad and costo and importe and cantidad > 0 and costo > 0 and importe > 0:
            diferencia = abs(cantidad * costo - importe)
            tolerancia = max(TOLERANCIA_PCT * importe, TOLERANCIA_MIN_CENTAVOS)
            if diferencia > tolerancia:
                linea["confianza"] = "baja"
                _agregar_nota(linea, NOTA_NO_CUADRA)
                nombre = linea["nombre_sugerido"] or linea["nombre_crudo"] or "sin nombre"
                avisos.append(f"'{nombre[:60]}': {NOTA_NO_CUADRA}")

        if (linea["unidad_ticket"] in (None, "pieza")
                and linea["piezas_por_empaque"] is None
                and costo > UMBRAL_PRECIO_PIEZA_CENTAVOS
                and (REGEX_EMPAQUE.search(linea["nombre_crudo"] or "")
                     or REGEX_EMPAQUE.search(linea["nombre_sugerido"] or ""))
                and linea["confianza"] == "alta"):
            linea["confianza"] = "media"
            _agregar_nota(linea, NOTA_SOSPECHA_EMPAQUE)


def normalizar_ticket(dato, num_catalogo: int = 0) -> dict:
    if not isinstance(dato, dict):
        dato = {}

    lineas_crudas = dato.get("lineas")
    if not isinstance(lineas_crudas, list):
        lineas_crudas = []
    lineas = []
    for linea in lineas_crudas[:MAX_LINEAS]:
        saneada = _normalizar_linea(linea, num_catalogo)
        if saneada is not None:
            lineas.append(saneada)

    avisos_crudos = dato.get("avisos")
    if not isinstance(avisos_crudos, list):
        avisos_crudos = []
    avisos = [a for a in (_a_texto(x) for x in avisos_crudos[:20]) if a]

    _chequeo_sanidad(lineas, avisos)

    return {
        "proveedor": _a_texto(dato.get("proveedor")),
        "proveedor_id": _a_texto(dato.get("proveedor_id"), 30) or "otro",
        "fecha": _a_texto(dato.get("fecha"), 10),
        "folio": _a_texto(dato.get("folio"), 40),
        "es_preventa": _a_bool(dato.get("es_preventa")),
        "lineas": lineas,
        "total_ticket_centavos": _a_centavos(dato.get("total_ticket_centavos")),
        "avisos": avisos[:30],
    }


# ==========================================================================
# Verificación adaptativa cruzada (Verificador)
# Si el ticket sale DUDOSO de la primera lectura, se hace una SEGUNDA lectura
# con OTRO modelo y se cruzan ambas línea a línea. La respuesta final es la
# PRIMERA lectura anotada (nunca se sustituyen números); si la segunda falla,
# la verificación simplemente queda "no aplicada" y el endpoint NO falla.
# ==========================================================================
NOTA_VERIFICADO = "verificado con doble lectura"
NOTA_DISCREPAN = "dos lecturas discrepan: revisa cantidad y costo"
NOTA_SOLO_UNA_LECTURA = "solo apareció en una de dos lecturas"
UMBRAL_SIMILITUD = 0.6       # similitud mínima de nombre para emparejar líneas

_UNIDADES_NOMBRE = {"ml", "lt", "l", "gr", "g", "kg", "pz", "pzs", "pk",
                    "pack", "nr", "ret", "mb", "gd", "ch", "h", "c", "x"}


def es_dudoso(ticket: dict) -> bool:
    """Decide si el análisis amerita una segunda lectura con otro modelo.

    Función pura. True si:
      (a) alguna línea venta/cambio quedó con confianza "baja",
      (b) alguna línea trae la nota de "no cuadra" del sanity check,
      (c) el ticket trae total y la suma de importes de líneas venta no cuadra
          (tolerancia: el mayor entre 2 centavos y el 1% del total),
      (d) salieron 0 líneas.
    """
    lineas = ticket.get("lineas") or []
    if not lineas:
        return True
    for l in lineas:
        if l.get("tipo") in ("venta", "cambio"):
            if l.get("confianza") == "baja":
                return True
            if NOTA_NO_CUADRA in (l.get("nota") or ""):
                return True
    total = ticket.get("total_ticket_centavos")
    if isinstance(total, int) and total > 0:
        suma = sum(l.get("importe_centavos") or 0
                   for l in lineas if l.get("tipo") == "venta")
        if suma > 0 and abs(suma - total) > max(2, 0.01 * total):
            return True
    return False


def _norm_nombre(s) -> str:
    """Normaliza un nombre para compararlo: minúsculas, sin acentos, sin
    números ni unidades sueltas, solo letras y espacios."""
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"\d+([.,]\d+)?", " ", s)
    s = re.sub(r"[^a-z ]", " ", s)
    tokens = [t for t in s.split() if t not in _UNIDADES_NOMBRE]
    return " ".join(tokens)


def _similitud(a: str, b: str) -> float:
    """Similitud de Jaccard sobre tokens normalizados (0.0 a 1.0)."""
    ta, tb = set(a.split()), set(b.split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def cruzar_lecturas(a: dict, b: dict) -> dict:
    """Cruza la PRIMERA lectura `a` contra la segunda `b`, línea a línea.

    Anota `a` EN EL LUGAR (confianza y notas); NUNCA cambia sus números ni
    sustituye líneas. Devuelve los contadores para el campo "verificacion".
    Empareja por similitud de nombre (umbral 0.6); a igualdad, el nombre más
    parecido gana. Líneas de `b` sin pareja se ignoran (la respuesta es `a`).
    """
    lineas_a = a.get("lineas") or []
    lineas_b = b.get("lineas") or []

    # Todos los pares candidatos por similitud, de mayor a menor; asignación
    # codiciosa 1-a-1 (el nombre idéntico, similitud 1.0, siempre gana).
    candidatos = []
    for i, x in enumerate(lineas_a):
        na = _norm_nombre(x.get("nombre_crudo") or x.get("nombre_sugerido"))
        for j, y in enumerate(lineas_b):
            nb = _norm_nombre(y.get("nombre_crudo") or y.get("nombre_sugerido"))
            s = _similitud(na, nb)
            if s >= UMBRAL_SIMILITUD:
                candidatos.append((s, i, j))
    candidatos.sort(key=lambda p: -p[0])
    pareja_de_a: dict[int, int] = {}
    usados_b: set[int] = set()
    for s, i, j in candidatos:
        if i in pareja_de_a or j in usados_b:
            continue
        pareja_de_a[i] = j
        usados_b.add(j)

    verificadas = 0
    discrepantes = 0
    for i, j in pareja_de_a.items():
        x, y = lineas_a[i], lineas_b[j]
        costo_a = x.get("costo_unitario_centavos") or 0
        costo_b = y.get("costo_unitario_centavos") or 0
        misma_cantidad = x.get("cantidad") == y.get("cantidad")
        costo_parecido = abs(costo_a - costo_b) <= 0.02 * max(costo_a, costo_b)
        if misma_cantidad and costo_parecido:
            x["confianza"] = "alta"
            x["nota"] = NOTA_VERIFICADO
            verificadas += 1
        else:
            x["confianza"] = "baja"
            x["nota"] = NOTA_DISCREPAN
            discrepantes += 1

    sin_pareja = 0
    for i, x in enumerate(lineas_a):
        if i not in pareja_de_a:
            x["confianza"] = "baja"
            x["nota"] = NOTA_SOLO_UNA_LECTURA
            sin_pareja += 1

    return {"lineas_verificadas": verificadas,
            "lineas_discrepantes": discrepantes,
            "lineas_sin_pareja": sin_pareja}


def _verificacion_vacia() -> dict:
    """El campo "verificacion" cuando NO se aplicó la doble lectura."""
    return {"aplicada": False, "lineas_verificadas": 0,
            "lineas_discrepantes": 0, "lineas_sin_pareja": 0}


# ==========================================================================
# Llamada HTTP a los proveedores
# ==========================================================================
class ErrorProveedor(Exception):
    def __init__(self, detalle: str, status: int | None = None, reintentable: bool = False):
        super().__init__(detalle)
        self.detalle = detalle
        self.status = status
        self.reintentable = reintentable


def _post_json(url: str, cuerpo: dict, cabeceras: dict | None = None) -> dict:
    datos = json.dumps(cuerpo).encode("utf-8")
    req = urllib.request.Request(url, data=datos, method="POST")
    req.add_header("Content-Type", "application/json")
    for clave, valor in (cabeceras or {}).items():
        req.add_header(clave, valor)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SEGUNDOS) as resp:
            crudo = resp.read(4 * 1024 * 1024)
    except urllib.error.HTTPError as e:
        detalle = ""
        try:
            detalle = e.read(4096).decode("utf-8", "replace")
        except Exception:
            pass
        raise ErrorProveedor(
            f"el proveedor respondió HTTP {e.code}: {detalle[:MAX_DETALLE_ERROR]}",
            status=e.code,
            reintentable=(e.code == 429 or e.code >= 500),
        )
    except (urllib.error.URLError, TimeoutError, socket.timeout, OSError) as e:
        raise ErrorProveedor(f"sin respuesta del proveedor (timeout o red): {e}",
                             status=None, reintentable=True)
    try:
        return json.loads(crudo.decode("utf-8", "replace"))
    except (ValueError, UnicodeDecodeError):
        raise ErrorProveedor("el proveedor no devolvió JSON válido")


def _parsear_json_de_texto(texto: str) -> dict:
    t = (texto or "").strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else ""
        if t.rstrip().endswith("```"):
            t = t.rstrip()[:-3]
    try:
        return json.loads(t)
    except ValueError:
        raise ErrorProveedor("la IA no devolvió JSON parseable")


# ==========================================================================
# Gemini: pipeline TEXTO primero, fallback a IMAGEN
# ==========================================================================
_ultimo_combo_bueno: tuple[int, str] | None = None


def _ordenar_combos(api_keys: list[str], modelos: list[str]) -> list[tuple[int, str]]:
    combos = [(ki, m) for m in modelos for ki in range(len(api_keys))]
    if _ultimo_combo_bueno in combos:
        combos.remove(_ultimo_combo_bueno)
        combos.insert(0, _ultimo_combo_bueno)
    return combos


def _llamar_gemini_texto(texto_ocr: str, api_key: str, modelo: str,
                         prompt_texto: str | None = None) -> dict:
    """Gemini con prompt de TEXTO (no imagen). Más barato y estable."""
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{modelo}:generateContent?key={api_key}")
    cuerpo = {
        "contents": [{"parts": [{"text": (prompt_texto or PROMPT_TEXTO).replace("__TEXTO_OCR__", texto_ocr)}]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
    }
    resp = _post_json(url, cuerpo)
    try:
        texto = resp["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        raise ErrorProveedor("Gemini respondió sin contenido usable")
    return _parsear_json_de_texto(texto)


def _llamar_gemini_imagen(imagen_b64: str, mime: str, api_key: str, modelo: str,
                          prompt: str | None = None) -> dict:
    """Gemini con IMAGEN (fallback si OCR falla o no está instalado)."""
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{modelo}:generateContent?key={api_key}")
    cuerpo = {
        "contents": [{
            "parts": [
                {"text": prompt or PROMPT_IMAGEN},
                {"inline_data": {"mime_type": mime, "data": imagen_b64}},
            ],
        }],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
    }
    resp = _post_json(url, cuerpo)
    try:
        texto = resp["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        raise ErrorProveedor("Gemini respondió sin contenido usable")
    return _parsear_json_de_texto(texto)


def _llamar_gemini(
    imagen_b64: str,
    mime: str,
    api_keys: list[str],
    modelos: list[str],
    texto_ocr: str | None = None,
    prompt_imagen: str | None = None,
    prompt_texto: str | None = None,
) -> tuple[dict, str]:
    """Intenta primero con TEXTO (si OCR funcionó), luego fallback a IMAGEN.

    El orden de intentos es MODELO-MAJOR: para cada modelo, intenta con TEXTO
    primero; si falla, intenta con IMAGEN; luego pasa al siguiente modelo.
    """
    global _ultimo_combo_bueno
    ultimo_error: ErrorProveedor | None = None
    keys_muertas: set[int] = set()

    for ki, modelo in _ordenar_combos(api_keys, modelos):
        if ki in keys_muertas:
            continue

        # --- Intento 1: TEXTO (si hay OCR) ---
        if texto_ocr:
            try:
                datos = _llamar_gemini_texto(texto_ocr, api_keys[ki], modelo, prompt_texto)
                _ultimo_combo_bueno = (ki, modelo)
                return datos, modelo
            except ErrorProveedor as e:
                ultimo_error = e
                if e.status in (401, 403):
                    keys_muertas.add(ki)
                    continue  # key inválida: salta a siguiente key
                elif not e.reintentable:
                    # Error no reintentable con texto: intentar imagen con MISMA key/modelo
                    pass
                # reintentable: también intentar imagen

        # --- Intento 2: IMAGEN (fallback) ---
        if ki in keys_muertas:
            continue
        try:
            datos = _llamar_gemini_imagen(imagen_b64, mime, api_keys[ki], modelo,
                                          prompt_imagen)
            _ultimo_combo_bueno = (ki, modelo)
            return datos, modelo
        except ErrorProveedor as e:
            ultimo_error = e
            if e.status in (401, 403):
                keys_muertas.add(ki)
            elif not e.reintentable:
                raise
    raise ultimo_error or ErrorProveedor("no hay credenciales configuradas")


def _llamar_kimi(imagen_b64: str, mime: str, api_key: str, modelo: str,
                 prompt: str | None = None) -> dict:
    """Kimi: API compatible OpenAI, imagen como data URL (no tiene OCR propio)."""
    url = "https://api.moonshot.ai/v1/chat/completions"
    cuerpo = {
        "model": modelo,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt or PROMPT_IMAGEN},
                {"type": "image_url",
                 "image_url": {"url": f"data:{mime};base64,{imagen_b64}"}},
            ],
        }],
    }
    resp = _post_json(url, cuerpo, {"Authorization": f"Bearer {api_key}"})
    try:
        texto = resp["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise ErrorProveedor("Kimi respondió sin contenido usable")
    return _parsear_json_de_texto(texto)


# ==========================================================================
# Endpoint
# ==========================================================================
class EntradaCatalogo(BaseModel):
    """Un producto del catálogo del negocio (lo manda la app en la petición)."""
    nombre: str
    alias: list[str] = []            # nombres de ticket aprendidos del producto
    presentacion: str | None = None  # ej. "355 ml", "pack de 6"
    empaque_piezas: int | None = None
    ultimo_costo_centavos: int | None = None


class PeticionTicket(BaseModel):
    imagen_b64: str | None = None
    mime: str = "image/jpeg"
    catalogo: list[EntradaCatalogo] = []   # el catálogo del negocio (opcional)


@router.post("/ia/ticket")
def analizar_ticket(
    peticion: PeticionTicket,
    disp: Dispositivo = Depends(dispositivo_actual),
):
    """Analiza la foto de un ticket de proveedor y devuelve sus datos.

    Pipeline: imagen → [Gemini visión] → JSON. Con IA_OCR=1 se activa el
    pipeline experimental OCR local → Gemini texto (desactivado por defecto:
    falló en producción con tickets reales). Si el resultado es DUDOSO, se
    hace una segunda lectura de verificación con otro modelo (Verificador).
    """
    global _ultimo_combo_bueno  # el Verificador lo restaura tras la 2ª lectura
    if not peticion.imagen_b64:
        raise HTTPException(400, "Falta la imagen del ticket (imagen_b64).")
    if len(peticion.imagen_b64) > MAX_B64_CARACTERES:
        raise HTTPException(
            413, "La foto es demasiado grande (máx. ~8 MB en base64). "
                 "Tómala de nuevo más de cerca o con menor resolución.")
    mime = (peticion.mime or "image/jpeg").strip()[:50]

    proveedor, api_keys, modelos = _config_ia()

    if proveedor == "mock":
        salida = normalizar_ticket(RESPUESTA_MOCK)
        salida["mock"] = True
        salida["modelo_usado"] = "mock"
        salida["ocr_usado"] = False
        salida["verificacion"] = _verificacion_vacia()
        return salida

    if proveedor not in ("gemini", "kimi"):
        raise HTTPException(
            503, f"IA no configurada: IA_PROVEEDOR='{proveedor}' no es válido "
                 "(use mock, gemini o kimi).")
    if not api_keys:
        raise HTTPException(503, "IA no configurada: falta IA_API_KEY.")

    # Catálogo del negocio (Ancla 1): se inyecta en AMBOS prompts (imagen y
    # texto) para que la IA etiquete líneas con "catalogo_idx".
    catalogo = (peticion.catalogo or [])[:MAX_CATALOGO]
    num_catalogo = len(catalogo)
    seccion_catalogo = _renderizar_catalogo(catalogo)
    prompt_imagen = PROMPT_IMAGEN + seccion_catalogo
    prompt_texto = PROMPT_TEXTO + seccion_catalogo

    # OCR local (EasyOCR): DESACTIVADO por defecto. En producción real falló:
    # destruye las columnas del ticket (CANT/P.UNIT/IMPORTE quedan como texto
    # suelto desordenado) y no maneja fotos rotadas ni impresión térmica de
    # baja calidad — Gemini con visión lee estos tickets mucho mejor. Queda
    # disponible solo para experimentar: IA_OCR=1 en el entorno.
    texto_ocr: str | None = None
    if (os.environ.get("IA_OCR") or "").strip() == "1":
        try:
            texto_ocr = extraer_texto_ocr(peticion.imagen_b64)
        except Exception:
            texto_ocr = None

    try:
        if proveedor == "gemini":
            crudo, modelo_usado = _llamar_gemini(
                peticion.imagen_b64, mime, api_keys, modelos, texto_ocr,
                prompt_imagen, prompt_texto)
        else:
            crudo = _llamar_kimi(peticion.imagen_b64, mime, api_keys[0],
                                 modelos[0], prompt_imagen)
            modelo_usado = modelos[0]
    except ErrorProveedor as e:
        if e.status == 429:
            raise HTTPException(
                429, "La IA está saturada o sin cuota por ahora. "
                     "Inténtalo de nuevo en unos minutos.")
        raise HTTPException(502, f"No se pudo analizar el ticket: {e.detalle}")

    salida = normalizar_ticket(crudo, num_catalogo)
    salida["mock"] = False
    salida["modelo_usado"] = modelo_usado
    salida["ocr_usado"] = texto_ocr is not None

    # VERIFICACIÓN ADAPTATIVA CRUZADA (Verificador): si el ticket salió DUDOSO
    # se hace una segunda lectura con OTRO modelo (el siguiente de la cadena,
    # respetando la rotación de keys y la muerte por 401/403) y se cruzan las
    # dos. La respuesta final es la PRIMERA lectura anotada. Si la segunda
    # lectura falla, la verificación queda no aplicada: NUNCA se tumba el
    # endpoint por fallar la verificación. Si el ticket salió limpio, se
    # responde directo y se ahorra la cuota de la segunda lectura.
    salida["verificacion"] = _verificacion_vacia()
    if proveedor == "gemini" and es_dudoso(salida):
        otros_modelos = [m for m in modelos if m != modelo_usado]
        if otros_modelos:
            combo_ganador = _ultimo_combo_bueno
            try:
                crudo2, _modelo_verificador = _llamar_gemini(
                    peticion.imagen_b64, mime, api_keys, otros_modelos,
                    texto_ocr, prompt_imagen, prompt_texto)
                segunda = normalizar_ticket(crudo2, num_catalogo)
                conteos = cruzar_lecturas(salida, segunda)
                salida["verificacion"] = {"aplicada": True, **conteos}
            except ErrorProveedor:
                pass  # verificación no aplicada; se responde la 1ª lectura
            finally:
                # se recuerda el combo de la PRIMERA lectura (el modelo bueno),
                # no el del verificador
                _ultimo_combo_bueno = combo_ganador

    return salida
