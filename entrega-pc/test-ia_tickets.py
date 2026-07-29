"""Pruebas LOCALES del endpoint /ia/ticket (backend-ia_tickets.py).

El VPS no es accesible desde aquí y los módulos reales `auth`, `database` y
`models` solo existen en el servidor, así que este script:
  1. Inyecta módulos FALSOS en sys.modules ANTES de importar el archivo.
  2. Monta una app FastAPI mínima solo con este router y sobreescribe la
     dependencia `dispositivo_actual` (dependency_overrides).
  3. Corre las pruebas con TestClient, sin levantar servidor ni tocar red
     (las llamadas HTTP a la IA se simulan con monkeypatch sobre _post_json).

Ejecutar:  python entrega-pc/test-ia_tickets.py
"""
import importlib.util
import json
import os
import sys
import types
from pathlib import Path

# --------------------------------------------------------------------------
# 1. Módulos falsos: el archivo bajo prueba hace `import auth`,
#    `from database import get_db` y `from models import Dispositivo`.
# --------------------------------------------------------------------------
auth_falso = types.ModuleType("auth")
auth_falso.verificar_token = lambda token, token_hash: True
sys.modules["auth"] = auth_falso

database_falso = types.ModuleType("database")


def _get_db_falso():
    """Generador que simula la sesión; las pruebas nunca llegan a usarla."""
    yield None


database_falso.get_db = _get_db_falso
sys.modules["database"] = database_falso

models_falso = types.ModuleType("models")


class _DispositivoFalso:
    """Clase dummy para que el import y las anotaciones funcionen."""

    id = "disp-prueba"
    negocio_id = "neg-prueba"
    activo = True
    token_hash = "hash"


models_falso.Dispositivo = _DispositivoFalso
sys.modules["models"] = models_falso

# --------------------------------------------------------------------------
# 2. Importar el archivo bajo prueba (su nombre tiene guiones: importlib).
# --------------------------------------------------------------------------
RUTA = Path(__file__).resolve().parent / "backend-ia_tickets.py"
spec = importlib.util.spec_from_file_location("ia_tickets", RUTA)
ia_tickets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ia_tickets)

from fastapi import Depends, FastAPI, Header, HTTPException  # noqa: E402,F401
from fastapi.testclient import TestClient  # noqa: E402

# --------------------------------------------------------------------------
# 3. App de prueba: solo este router, con la dependencia sobreescrita.
#    El override conserva el CONTRATO de headers: sin credenciales → 401,
#    igual que haría la dependencia real contra la base de datos.
# --------------------------------------------------------------------------
app = FastAPI()
app.include_router(ia_tickets.router)


def _dispositivo_prueba(
    x_dispositivo_id: str = Header(None),
    x_dispositivo_token: str = Header(None),
):
    if not x_dispositivo_id or not x_dispositivo_token:
        raise HTTPException(401, "Faltan credenciales del dispositivo.")
    return _DispositivoFalso()


app.dependency_overrides[ia_tickets.dispositivo_actual] = _dispositivo_prueba
cliente = TestClient(app)

HEADERS = {"X-Dispositivo-Id": "disp-prueba", "X-Dispositivo-Token": "token-prueba"}
# base64 mínimo válido de relleno (en mock la IA nunca ve la imagen)
IMAGEN = "aGVsbG8gd29ybGQ=" * 10

_resultados = []


def prueba(nombre):
    def decorador(fn):
        try:
            fn()
            _resultados.append((nombre, True, ""))
            print(f"  PASS  {nombre}")
        except AssertionError as e:
            _resultados.append((nombre, False, str(e)))
            print(f"  FAIL  {nombre}: {e}")
        except Exception as e:  # cualquier otro error también cuenta como FAIL
            _resultados.append((nombre, False, f"excepción inesperada: {e}"))
            print(f"  FAIL  {nombre}: excepción inesperada: {e}")
        finally:
            _limpiar_env()
    return decorador


def _limpiar_env():
    for clave in ("IA_PROVEEDOR", "IA_API_KEY", "IA_API_KEYS", "IA_MODELO", "IA_MODELOS"):
        os.environ.pop(clave, None)
    # el cache de "último combo bueno" es global: se resetea entre pruebas
    ia_tickets._ultimo_combo_bueno = None


# --------------------------------------------------------------------------
# (a) Sin headers de dispositivo → 401
# --------------------------------------------------------------------------
@prueba("(a) sin headers de dispositivo -> 401")
def _():
    _limpiar_env()
    r = cliente.post("/ia/ticket", json={"imagen_b64": IMAGEN})
    assert r.status_code == 401, f"esperaba 401, llegó {r.status_code}: {r.text}"


# --------------------------------------------------------------------------
# (b) Con headers y IA_PROVEEDOR=mock → 200 con la forma del contrato
# --------------------------------------------------------------------------
@prueba("(b) mock -> 200 con contrato completo y mock=true")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "mock"
    r = cliente.post("/ia/ticket", json={"imagen_b64": IMAGEN}, headers=HEADERS)
    assert r.status_code == 200, f"esperaba 200, llegó {r.status_code}: {r.text}"
    d = r.json()
    assert d.get("mock") is True, "la respuesta debe traer mock=true"
    assert d.get("modelo_usado") == "mock", "en modo mock, modelo_usado debe ser 'mock'"
    for clave in ("proveedor", "proveedor_id", "fecha", "folio", "es_preventa",
                  "lineas", "total_ticket_centavos", "avisos"):
        assert clave in d, f"falta la clave del contrato: {clave}"
    assert isinstance(d["lineas"], list) and len(d["lineas"]) > 0, "lineas vacías"
    linea = d["lineas"][0]
    for clave in ("nombre_crudo", "nombre_sugerido", "codigo_barras", "cantidad",
                  "unidad_ticket", "piezas_por_empaque", "costo_unitario_centavos",
                  "importe_centavos", "tipo", "confianza", "nota"):
        assert clave in linea, f"falta la clave de línea: {clave}"
    # dinero en centavos enteros SIEMPRE
    for l in d["lineas"]:
        assert isinstance(l["costo_unitario_centavos"], int), "costo no entero"
        if l["importe_centavos"] is not None:
            assert isinstance(l["importe_centavos"], int), "importe no entero"
    assert isinstance(d["total_ticket_centavos"], int), "total no entero"
    assert any(l["tipo"] == "cambio" for l in d["lineas"]), "el mock debe tener cambios"
    # el mock es internamente coherente: el sanity check NO debe ensuciarlo
    assert not any(ia_tickets.NOTA_NO_CUADRA in (l["nota"] or "") for l in d["lineas"]), \
        "el mock no debió disparar el chequeo de sanidad"


# --------------------------------------------------------------------------
# (c) IA_PROVEEDOR=gemini sin API key → 503 con detalle claro
# --------------------------------------------------------------------------
@prueba("(c) gemini sin IA_API_KEY -> 503")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "gemini"
    os.environ["IA_API_KEY"] = ""
    r = cliente.post("/ia/ticket", json={"imagen_b64": IMAGEN}, headers=HEADERS)
    assert r.status_code == 503, f"esperaba 503, llegó {r.status_code}: {r.text}"
    assert "IA_API_KEY" in r.json().get("detail", ""), "el detalle debe mencionar IA_API_KEY"


# --------------------------------------------------------------------------
# (d) normalizar_ticket con basura: no truena y sanea
# --------------------------------------------------------------------------
@prueba("(d) normalización con basura -> sanea sin tronar")
def _():
    # líneas que no son lista
    d = ia_tickets.normalizar_ticket({"lineas": "esto no es lista"})
    assert d["lineas"] == [], "líneas no-lista deben quedar vacías"

    # entrada que ni siquiera es dict
    d = ia_tickets.normalizar_ticket([1, 2, 3])
    assert d["lineas"] == [] and d["proveedor"] is None, "entrada no-dict mal saneada"

    # 500 líneas con tipos raros -> máximo 100 y todo saneado
    lineas_locas = []
    for i in range(500):
        lineas_locas.append({
            "nombre_crudo": "x" * 500,               # string larguísimo
            "cantidad": "12.5",                       # número como texto
            "tipo": "truenique",                      # tipo inválido
            "confianza": {"rara": True},              # confianza inválida
            "costo_unitario_centavos": "no soy número",
            "importe_centavos": 123.6,                # flotante -> entero
            "unidad_ticket": "bulto",                 # unidad fuera del set
            "nota": None,
        })
    lineas_locas.append("una línea que ni objeto es")
    d = ia_tickets.normalizar_ticket({
        "proveedor": 12345,
        "lineas": lineas_locas,
        "total_ticket_centavos": "26242.4",
        "es_preventa": "si",
        "avisos": "tampoco es lista",
    })
    assert len(d["lineas"]) == 100, f"debió recortar a 100 líneas, hay {len(d['lineas'])}"
    for l in d["lineas"]:
        assert l["tipo"] == "venta", "tipo inválido debió quedar 'venta'"
        assert l["confianza"] == "media", "confianza inválida debió quedar 'media'"
        assert len(l["nombre_crudo"]) <= 120, "nombre_crudo no se recortó"
        assert l["costo_unitario_centavos"] == 0, "centavos no numéricos deben quedar 0/None"
        assert l["importe_centavos"] == 124, "flotante debió redondear a entero"
        assert l["cantidad"] == 12.5, "cantidad en texto debió parsearse"
        assert l["unidad_ticket"] is None, "unidad fuera del set debió quedar null"
    assert d["proveedor"] == "12345", "proveedor numérico debió pasar a texto"
    assert d["total_ticket_centavos"] == 26242, "total en texto debió parsearse a entero"
    assert d["es_preventa"] is True, "'si' debió interpretarse como True"
    assert d["avisos"] == [], "avisos no-lista deben quedar vacíos"


# --------------------------------------------------------------------------
# (e) Chequeo de sanidad: el caso real de los Fritos
#     Ticket real: "FRITOS SAL MB GD 60GRX36X1   5   15.85   79.25"
#     La IA se equivocó y reportó cantidad=180 (5×36). El importe impreso
#     (79.25) es la prueba de verdad: 180×15.85=2853.00 NO cuadra con 79.25.
# --------------------------------------------------------------------------
@prueba("(e) sanity check: línea inflada (180 vs importe 79.25) -> confianza baja")
def _():
    d = ia_tickets.normalizar_ticket({
        "proveedor": "Sabritas",
        "lineas": [{
            "nombre_crudo": "FRITOS SAL MB GD 60GRX36X1",
            "nombre_sugerido": "Fritos Sal 60g",
            "cantidad": 180,
            "unidad_ticket": "pieza",
            "piezas_por_empaque": 36,
            "costo_unitario_centavos": 1585,
            "importe_centavos": 7925,
            "tipo": "venta",
            "confianza": "alta",
            "nota": None,
        }],
        "avisos": [],
    })
    l = d["lineas"][0]
    assert l["confianza"] == "baja", f"debió bajar la confianza, quedó {l['confianza']}"
    assert ia_tickets.NOTA_NO_CUADRA in (l["nota"] or ""), "falta la nota de 'no cuadra'"
    assert any(ia_tickets.NOTA_NO_CUADRA in a for a in d["avisos"]), \
        "falta el aviso global de 'no cuadra'"
    # NO se corrige en silencio: los números quedan como los mandó la IA
    assert l["cantidad"] == 180, "el servidor no debe corregir la cantidad en silencio"
    assert l["costo_unitario_centavos"] == 1585, "el servidor no debe tocar el costo"

    # Y el caso BIEN leído (cantidad=5, pieza): 5×1585=7925 cuadra -> intacta
    d2 = ia_tickets.normalizar_ticket({
        "lineas": [{
            "nombre_crudo": "FRITOS SAL MB GD 60GRX36X1",
            "cantidad": 5, "unidad_ticket": "pieza", "piezas_por_empaque": None,
            "costo_unitario_centavos": 1585, "importe_centavos": 7925,
            "tipo": "venta", "confianza": "alta", "nota": None,
        }],
    })
    l2 = d2["lineas"][0]
    assert l2["confianza"] == "alta", "una línea que cuadra no debe tocarse"
    assert l2["nota"] is None and d2["avisos"] == [], "no debió generar avisos"

    # Caso caja de cerveza BIEN leído: 13 cajas × $320 = $4,160 cuadra -> intacta
    d3 = ia_tickets.normalizar_ticket({
        "lineas": [{
            "nombre_crudo": "BOTE 6 PK H C 24 355 ML",
            "cantidad": 13, "unidad_ticket": "caja", "piezas_por_empaque": 24,
            "costo_unitario_centavos": 32000, "importe_centavos": 416000,
            "tipo": "venta", "confianza": "alta", "nota": None,
        }],
    })
    l3 = d3["lineas"][0]
    assert l3["confianza"] == "alta" and d3["avisos"] == [], \
        "la caja de 24 que cuadra no debe tocarse"


# --------------------------------------------------------------------------
# Simulador de Gemini: intercepta _post_json. La URL lleva el modelo
# (.../models/{modelo}:generateContent) y la key (?key={api_key}).
# --------------------------------------------------------------------------
def _respuesta_gemini_falsa(texto_json: str) -> dict:
    """Arma la envoltura que devuelve Gemini alrededor del JSON de texto."""
    return {"candidates": [{"content": {"parts": [{"text": texto_json}]}}]}


def _simular_gemini(comportamiento):
    """Instala un _post_json falso. `comportamiento(key, modelo)` devuelve la
    respuesta o lanza ErrorProveedor. Devuelve (lista_llamados, restaurar)."""
    llamados = []
    post_json_real = ia_tickets._post_json

    def _post_json_simulado(url, cuerpo, cabeceras=None):
        modelo = url.split("/models/")[1].split(":")[0]
        key = url.split("?key=")[1] if "?key=" in url else ""
        llamados.append((key, modelo))
        return comportamiento(key, modelo)

    ia_tickets._post_json = _post_json_simulado

    def _restaurar():
        ia_tickets._post_json = post_json_real

    return llamados, _restaurar


def _json_ticket_minimo() -> str:
    """Ticket LIMPIO y coherente (no dudoso): así los tests de fallback no
    disparan la segunda lectura del Verificador."""
    return json.dumps({
        "proveedor": "Prueba", "avisos": [], "total_ticket_centavos": 1000,
        "lineas": [{
            "nombre_crudo": "PRODUCTO DE PRUEBA", "nombre_sugerido": "Producto de prueba",
            "cantidad": 1, "unidad_ticket": "pieza", "piezas_por_empaque": None,
            "costo_unitario_centavos": 1000, "importe_centavos": 1000,
            "tipo": "venta", "confianza": "alta", "nota": None,
        }],
    })


# --------------------------------------------------------------------------
# (f) Cadena de respaldo de modelos: el primero da 429 -> usa el segundo
# --------------------------------------------------------------------------
@prueba("(f) fallback: primer modelo 429 -> usa el segundo y reporta modelo_usado")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "gemini"
    os.environ["IA_API_KEY"] = "llave-falsa-de-prueba"
    os.environ["IA_MODELOS"] = "modelo-a,modelo-b,modelo-c"

    def _comportamiento(key, modelo):
        if modelo == "modelo-a":
            raise ia_tickets.ErrorProveedor(
                "el proveedor respondió HTTP 429: saturado",
                status=429, reintentable=True)
        return _respuesta_gemini_falsa(_json_ticket_minimo())

    llamados, restaurar = _simular_gemini(_comportamiento)
    try:
        r = cliente.post("/ia/ticket", json={"imagen_b64": IMAGEN}, headers=HEADERS)
    finally:
        restaurar()
    assert r.status_code == 200, f"esperaba 200, llegó {r.status_code}: {r.text}"
    d = r.json()
    assert d.get("modelo_usado") == "modelo-b", f"debió usar modelo-b, usó {d.get('modelo_usado')}"
    assert d.get("mock") is False, "una respuesta real debe traer mock=false"
    keys_y_modelos = [m for _, m in llamados]
    assert keys_y_modelos == ["modelo-a", "modelo-b"], f"orden de intentos inesperado: {llamados}"
    # el cache debió quedar apuntando al combo que funcionó (key 0, modelo-b)
    assert ia_tickets._ultimo_combo_bueno == (0, "modelo-b"), \
        f"debió recordar el combo bueno: {ia_tickets._ultimo_combo_bueno}"


@prueba("(f2) fallback: TODOS los modelos saturados -> HTTP 429 amable")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "gemini"
    os.environ["IA_API_KEY"] = "llave-falsa-de-prueba"
    os.environ["IA_MODELOS"] = "modelo-a,modelo-b"

    def _comportamiento(key, modelo):
        raise ia_tickets.ErrorProveedor(
            "el proveedor respondió HTTP 429: saturado",
            status=429, reintentable=True)

    llamados, restaurar = _simular_gemini(_comportamiento)
    try:
        r = cliente.post("/ia/ticket", json={"imagen_b64": IMAGEN}, headers=HEADERS)
    finally:
        restaurar()
    assert r.status_code == 429, f"esperaba 429, llegó {r.status_code}: {r.text}"
    assert "saturada" in r.json().get("detail", ""), "el detalle debe ser amable y claro"
    keys_y_modelos = [m for _, m in llamados]
    assert keys_y_modelos == ["modelo-a", "modelo-b"], f"debió intentar los 2: {llamados}"


@prueba("(f3) IA_MODELO singular fija la cadena a un solo modelo")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "gemini"
    os.environ["IA_API_KEY"] = "x"
    os.environ["IA_MODELO"] = "gemini-2.0-flash"
    os.environ["IA_MODELOS"] = "otro-a,otro-b"  # el singular debe ganar
    _, _, modelos = ia_tickets._config_ia()
    assert modelos == ["gemini-2.0-flash"], f"IA_MODELO debió ganar: {modelos}"


@prueba("(f4) default de IA_MODELOS: Flash completo primero, lite de respaldo")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "gemini"
    os.environ["IA_API_KEY"] = "x"  # sin IA_MODELO ni IA_MODELOS: cadena default
    _, _, modelos = ia_tickets._config_ia()
    assert modelos[0] == "gemini-flash-latest", \
        f"el Flash COMPLETO debe ir primero (los lite son débiles para OCR): {modelos}"
    assert "gemini-flash-lite-latest" in modelos, \
        f"el lite debe quedar como respaldo de cuota: {modelos}"
    assert modelos == ["gemini-flash-latest", "gemini-flash-lite-latest",
                       "gemini-3.1-flash-lite"], f"cadena default inesperada: {modelos}"
    # y el endpoint la usa tal cual cuando no hay variables de modelo
    llamados, restaurar = _simular_gemini(
        lambda key, modelo: _respuesta_gemini_falsa(_json_ticket_minimo()))
    try:
        r = cliente.post("/ia/ticket", json={"imagen_b64": IMAGEN}, headers=HEADERS)
    finally:
        restaurar()
    assert r.status_code == 200, f"esperaba 200, llegó {r.status_code}: {r.text}"
    assert llamados[0][1] == "gemini-flash-latest", \
        f"el primer intento debió ser el Flash completo: {llamados}"
    assert r.json().get("modelo_usado") == "gemini-flash-latest"


# --------------------------------------------------------------------------
# (g) Múltiples keys: la key 1 da 429 -> el MISMO modelo se salva con la key 2
# --------------------------------------------------------------------------
@prueba("(g) 2 keys: key1 429 -> modelo bueno se salva con key2 (modelo-major)")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "gemini"
    os.environ["IA_API_KEY"] = "key-ignorada"  # IA_API_KEYS gana sobre esta
    os.environ["IA_API_KEYS"] = " key-uno , , key-dos "  # espacios y vacías
    os.environ["IA_MODELOS"] = "modelo-a,modelo-b"

    # IA_API_KEYS se recorta e ignora vacías; gana sobre IA_API_KEY
    _, keys, _ = ia_tickets._config_ia()
    assert keys == ["key-uno", "key-dos"], f"keys mal parseadas: {keys}"

    def _comportamiento(key, modelo):
        if key == "key-uno":
            raise ia_tickets.ErrorProveedor(
                "el proveedor respondió HTTP 429: sin cuota",
                status=429, reintentable=True)
        return _respuesta_gemini_falsa(_json_ticket_minimo())

    llamados, restaurar = _simular_gemini(_comportamiento)
    try:
        r = cliente.post("/ia/ticket", json={"imagen_b64": IMAGEN}, headers=HEADERS)
    finally:
        restaurar()
    assert r.status_code == 200, f"esperaba 200, llegó {r.status_code}: {r.text}"
    d = r.json()
    assert d.get("modelo_usado") == "modelo-a", f"debió usar modelo-a: {d.get('modelo_usado')}"
    # MODELO-MAJOR: tras el 429 de key-uno en modelo-a, se intenta el MISMO
    # modelo con key-dos ANTES de degradar a modelo-b
    assert llamados == [("key-uno", "modelo-a"), ("key-dos", "modelo-a")], \
        f"orden inesperado (debió salvar modelo-a con la 2ª key): {llamados}"
    # el combo ganador se recuerda: key índice 1 + modelo-a
    assert ia_tickets._ultimo_combo_bueno == (1, "modelo-a"), \
        f"combo recordado incorrecto: {ia_tickets._ultimo_combo_bueno}"
    # SEGURIDAD: la respuesta no debe exponer la key ni su índice
    assert "key_indice" not in d and "key-uno" not in r.text and "key-dos" not in r.text, \
        "la respuesta no debe exponer la key usada"


# --------------------------------------------------------------------------
# (g2) Orden EXACTO modelo-major: m1/k1, m1/k2, m2/k1, m2/k2
# --------------------------------------------------------------------------
@prueba("(g2) orden exacto: se agota el mejor modelo en TODAS las keys primero")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "gemini"
    os.environ["IA_API_KEYS"] = "key-uno,key-dos"
    os.environ["IA_MODELOS"] = "m1,m2"

    def _comportamiento(key, modelo):
        raise ia_tickets.ErrorProveedor(
            "el proveedor respondió HTTP 429: sin cuota",
            status=429, reintentable=True)

    llamados, restaurar = _simular_gemini(_comportamiento)
    try:
        r = cliente.post("/ia/ticket", json={"imagen_b64": IMAGEN}, headers=HEADERS)
    finally:
        restaurar()
    assert r.status_code == 429, f"esperaba 429, llegó {r.status_code}: {r.text}"
    # el orden exacto: mejor modelo en todas las keys, LUEGO el modelo peor
    assert llamados == [("key-uno", "m1"), ("key-dos", "m1"),
                        ("key-uno", "m2"), ("key-dos", "m2")], \
        f"orden modelo-major incorrecto: {llamados}"


# --------------------------------------------------------------------------
# (h) Una key da 401 -> salta a la SIGUIENTE KEY (sin gastar más modelos)
# --------------------------------------------------------------------------
@prueba("(h) key con 401 -> siguiente key, sin reintentar modelos con la muerta")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "gemini"
    os.environ["IA_API_KEYS"] = "key-mala,key-buena"
    os.environ["IA_MODELOS"] = "modelo-a,modelo-b"

    def _comportamiento(key, modelo):
        if key == "key-mala":
            raise ia_tickets.ErrorProveedor(
                "el proveedor respondió HTTP 401: API key not valid",
                status=401, reintentable=False)
        return _respuesta_gemini_falsa(_json_ticket_minimo())

    llamados, restaurar = _simular_gemini(_comportamiento)
    try:
        r = cliente.post("/ia/ticket", json={"imagen_b64": IMAGEN}, headers=HEADERS)
    finally:
        restaurar()
    assert r.status_code == 200, f"esperaba 200, llegó {r.status_code}: {r.text}"
    d = r.json()
    assert d.get("modelo_usado") == "modelo-a", f"debió usar modelo-a: {d.get('modelo_usado')}"
    # con la key muerta se intentó UNA sola vez; no se gastó modelo-b con ella
    assert llamados == [("key-mala", "modelo-a"), ("key-buena", "modelo-a")], \
        f"no debió reintentar modelos con la key muerta: {llamados}"
    # el detalle de respuesta JAMÁS incluye la key
    assert "key-buena" not in r.text and "key-mala" not in r.text, \
        "la respuesta no debe contener las keys"


# --------------------------------------------------------------------------
# (i) TODAS las keys dan 429 -> HTTP 429 amable
# --------------------------------------------------------------------------
@prueba("(i) todas las keys 429 -> HTTP 429 amable")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "gemini"
    os.environ["IA_API_KEYS"] = "key-uno,key-dos"
    os.environ["IA_MODELOS"] = "modelo-a,modelo-b"

    def _comportamiento(key, modelo):
        raise ia_tickets.ErrorProveedor(
            "el proveedor respondió HTTP 429: sin cuota",
            status=429, reintentable=True)

    llamados, restaurar = _simular_gemini(_comportamiento)
    try:
        r = cliente.post("/ia/ticket", json={"imagen_b64": IMAGEN}, headers=HEADERS)
    finally:
        restaurar()
    assert r.status_code == 429, f"esperaba 429, llegó {r.status_code}: {r.text}"
    assert "saturada" in r.json().get("detail", ""), "el detalle debe ser amable y claro"
    # intentó los 4 combos (2 keys × 2 modelos) antes de rendirse
    assert len(llamados) == 4, f"debió intentar los 4 combos: {llamados}"
    # y el mensaje de error no filtra ninguna key
    assert "key-uno" not in r.text and "key-dos" not in r.text, \
        "el error no debe contener las keys"


# --------------------------------------------------------------------------
# (j) Sanity de empaque: pieza con nombre de empaque y precio implausible
# --------------------------------------------------------------------------
@prueba("(j) sanity empaque: 'AGUA PURA 1 LT K6' pieza $164 -> confianza media con nota")
def _():
    d = ia_tickets.normalizar_ticket({
        "lineas": [{
            "nombre_crudo": "AGUA PURA 1 LT K6",
            "nombre_sugerido": "Agua pura 1 lt K6",
            "cantidad": 1, "unidad_ticket": "pieza", "piezas_por_empaque": None,
            "costo_unitario_centavos": 16400, "importe_centavos": 16400,
            "tipo": "venta", "confianza": "alta", "nota": None,
        }],
        "avisos": [],
    })
    l = d["lineas"][0]
    assert l["confianza"] == "media", f"debió bajar a media, quedó {l['confianza']}"
    assert ia_tickets.NOTA_SOSPECHA_EMPAQUE in (l["nota"] or ""), \
        "falta la nota de empaque sospechoso"
    # NO se cambian los números: solo se señala
    assert l["cantidad"] == 1 and l["costo_unitario_centavos"] == 16400, \
        "el servidor no debe tocar cantidad ni costo"
    assert l["unidad_ticket"] == "pieza" and l["piezas_por_empaque"] is None, \
        "el servidor no debe convertir la unidad en silencio"


# --------------------------------------------------------------------------
# (k) Sin falso positivo: pieza barata aunque el nombre diga PACK
# --------------------------------------------------------------------------
@prueba("(k) sanity empaque: pieza barata ($13) NO se toca aunque diga PACK")
def _():
    d = ia_tickets.normalizar_ticket({
        "lineas": [
            {   # caso del enunciado: costo bajo, sin empaque en el nombre
                "nombre_crudo": "BEBIDA LATA 355ML",
                "cantidad": 1, "unidad_ticket": "pieza", "piezas_por_empaque": None,
                "costo_unitario_centavos": 1300, "importe_centavos": 1300,
                "tipo": "venta", "confianza": "alta", "nota": None,
            },
            {   # nombre CON empaque pero precio plausible de pieza: tampoco se toca
                "nombre_crudo": "BOTANA GRANDE 4 PACK",
                "cantidad": 1, "unidad_ticket": "pieza", "piezas_por_empaque": None,
                "costo_unitario_centavos": 1500, "importe_centavos": 1500,
                "tipo": "venta", "confianza": "alta", "nota": None,
            },
        ],
        "avisos": [],
    })
    for l in d["lineas"]:
        assert l["confianza"] == "alta", f"'{l['nombre_crudo']}' no debió tocarse"
        assert l["nota"] is None, f"'{l['nombre_crudo']}' no debió generar nota"
    assert d["avisos"] == [], "no debió generar avisos"


# --------------------------------------------------------------------------
# (l) generationConfig determinista: temperature 0 va en el payload a Gemini
# --------------------------------------------------------------------------
@prueba("(l) payload a Gemini incluye generationConfig con temperature 0")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "gemini"
    os.environ["IA_API_KEY"] = "llave-falsa"
    os.environ["IA_MODELO"] = "modelo-unico"
    capturado = {}
    post_json_real = ia_tickets._post_json

    def _post_json_simulado(url, cuerpo, cabeceras=None):
        capturado["cuerpo"] = cuerpo
        return {"candidates": [{"content": {"parts": [{"text": _json_ticket_minimo()}]}}]}

    ia_tickets._post_json = _post_json_simulado
    try:
        r = cliente.post("/ia/ticket", json={"imagen_b64": IMAGEN}, headers=HEADERS)
    finally:
        ia_tickets._post_json = post_json_real
    assert r.status_code == 200, f"esperaba 200, llegó {r.status_code}: {r.text}"
    cuerpo = capturado.get("cuerpo", {})
    gc = cuerpo.get("generationConfig")
    assert gc is not None, "el payload no lleva generationConfig"
    assert gc.get("temperature") == 0, f"temperature debe ser 0 (determinista), es {gc.get('temperature')}"
    assert gc.get("responseMimeType") == "application/json", \
        f"responseMimeType incorrecto: {gc.get('responseMimeType')}"


# --------------------------------------------------------------------------
# (m) El catálogo del negocio se inyecta en el prompt y catalogo_idx vuelve
# --------------------------------------------------------------------------
@prueba("(m) catálogo en el prompt + catalogo_idx normalizado en la respuesta")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "gemini"
    os.environ["IA_API_KEY"] = "llave-falsa"
    os.environ["IA_MODELO"] = "modelo-unico"
    capturados = []
    post_json_real = ia_tickets._post_json

    def _post_json_simulado(url, cuerpo, cabeceras=None):
        capturados.append(cuerpo)
        return _respuesta_gemini_falsa(json.dumps({
            "proveedor": "Prueba", "avisos": [], "total_ticket_centavos": 2800,
            "lineas": [
                {"nombre_crudo": "TCHAM600MLNR1", "cantidad": 1,
                 "unidad_ticket": "pieza", "costo_unitario_centavos": 1500,
                 "importe_centavos": 1500, "tipo": "venta", "confianza": "alta",
                 "nota": None, "catalogo_idx": 0},
                {"nombre_crudo": "PRODUCTO SUELTO", "cantidad": 1,
                 "unidad_ticket": "pieza", "costo_unitario_centavos": 1300,
                 "importe_centavos": 1300, "tipo": "venta", "confianza": "alta",
                 "nota": None, "catalogo_idx": 5},
            ],
        }))

    ia_tickets._post_json = _post_json_simulado
    catalogo = [{"nombre": "Coca-Cola 600", "alias": ["TCHAM600MLNR1", "Coca 600"],
                 "presentacion": "600 ml", "empaque_piezas": None,
                 "ultimo_costo_centavos": 1500}]
    try:
        r = cliente.post("/ia/ticket", headers=HEADERS, json={
            "imagen_b64": IMAGEN, "catalogo": catalogo})
        r2 = cliente.post("/ia/ticket", headers=HEADERS,
                          json={"imagen_b64": IMAGEN})  # sin catálogo
    finally:
        ia_tickets._post_json = post_json_real

    assert r.status_code == 200, f"esperaba 200, llegó {r.status_code}: {r.text}"
    prompt_con = capturados[0]["contents"][0]["parts"][0]["text"]
    assert "CATÁLOGO DEL NEGOCIO" in prompt_con, "falta la sección de catálogo en el prompt"
    assert "Coca-Cola 600" in prompt_con, "falta el nombre del producto"
    assert "TCHAM600MLNR1" in prompt_con, "faltan los alias en el prompt"
    assert "600 ml" in prompt_con, "falta la presentación"
    assert "0. Coca-Cola 600" in prompt_con, "la numeración 0-based debe estar"
    prompt_sin = capturados[1]["contents"][0]["parts"][0]["text"]
    assert "CATÁLOGO DEL NEGOCIO" not in prompt_sin, \
        "sin catálogo la sección debe omitirse (comportamiento anterior)"

    d = r.json()
    l0, l1 = d["lineas"][0], d["lineas"][1]
    assert l0["catalogo_idx"] == 0, f"índice válido debió conservarse: {l0['catalogo_idx']}"
    assert l1["catalogo_idx"] is None, \
        f"índice 5 fuera de rango (catálogo de 1) debió quedar null: {l1['catalogo_idx']}"
    # ticket limpio: una sola llamada por petición, verificación no aplicada
    assert d["verificacion"]["aplicada"] is False


# --------------------------------------------------------------------------
# (n) catalogo_idx: validación de rango/tipo en normalizar_ticket
# --------------------------------------------------------------------------
@prueba("(n) catalogo_idx: válido / fuera de rango / no-entero")
def _():
    def _linea(idx):
        return {"nombre_crudo": "X", "cantidad": 1, "unidad_ticket": "pieza",
                "costo_unitario_centavos": 100, "importe_centavos": 100,
                "tipo": "venta", "confianza": "alta", "nota": None,
                "catalogo_idx": idx}

    d = ia_tickets.normalizar_ticket(
        {"lineas": [_linea(2), _linea(3), _linea("uno"), _linea(1.7), _linea(None),
                    _linea(True)]},
        num_catalogo=3)
    idxs = [l["catalogo_idx"] for l in d["lineas"]]
    assert idxs == [2, None, None, None, None, None], f"mal saneado: {idxs}"
    # sin catálogo (num_catalogo=0) todo queda null
    d2 = ia_tickets.normalizar_ticket({"lineas": [_linea(0)]})
    assert d2["lineas"][0]["catalogo_idx"] is None, "sin catálogo no hay índices válidos"


# --------------------------------------------------------------------------
# (o) es_dudoso: los cuatro disparadores + caso limpio
# --------------------------------------------------------------------------
@prueba("(o) es_dudoso: (a) baja, (b) no cuadra, (c) suma vs total, (d) 0 líneas")
def _():
    def _ticket(lineas, total=None):
        return ia_tickets.normalizar_ticket(
            {"lineas": lineas, "total_ticket_centavos": total})

    limpia = {"nombre_crudo": "AGUA MINERAL", "cantidad": 1, "unidad_ticket": "pieza",
              "costo_unitario_centavos": 1500, "importe_centavos": 1500,
              "tipo": "venta", "confianza": "alta", "nota": None}

    # (a) confianza baja en una venta
    assert ia_tickets.es_dudoso(_ticket([{**limpia, "confianza": "baja"}])) is True
    # (b) línea que no cuadra con su importe (el sanity le pone la nota)
    t_b = _ticket([{**limpia, "cantidad": 5}])  # 5×1500 ≠ 1500
    assert ia_tickets.es_dudoso(t_b) is True
    assert ia_tickets.NOTA_NO_CUADRA in (t_b["lineas"][0]["nota"] or "")
    # (c) total no cuadra con la suma de líneas venta (5000 vs 10000)
    t_c = _ticket([limpia, {**limpia}], total=10000)   # suma 3000 ≠ 10000
    assert ia_tickets.es_dudoso(t_c) is True
    t_c_ok = _ticket([limpia], total=1500)             # suma 1500 = total
    assert ia_tickets.es_dudoso(t_c_ok) is False
    # (d) cero líneas
    assert ia_tickets.es_dudoso(_ticket([])) is True
    # limpio completo
    assert ia_tickets.es_dudoso(_ticket([limpia])) is False


# --------------------------------------------------------------------------
# (p) Verificación APLICADA: ticket dudoso, segunda lectura con otro modelo
# --------------------------------------------------------------------------
@prueba("(p) dudoso -> doble lectura: verificada / discrepante / sin pareja")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "gemini"
    os.environ["IA_API_KEY"] = "llave-k"
    os.environ["IA_MODELOS"] = "m1,m2"

    primera = json.dumps({
        "proveedor": "X", "avisos": [], "total_ticket_centavos": None,
        "lineas": [
            {"nombre_crudo": "AGUA MINERAL 600ML", "cantidad": 2, "unidad_ticket": "pieza",
             "costo_unitario_centavos": 1500, "importe_centavos": 3000,
             "tipo": "venta", "confianza": "baja", "nota": None},      # dudoso (a)
            {"nombre_crudo": "REFRESCO COLA 355", "cantidad": 1, "unidad_ticket": "pieza",
             "costo_unitario_centavos": 1200, "importe_centavos": 1200,
             "tipo": "venta", "confianza": "media", "nota": None},
            {"nombre_crudo": "GALLETAS SALADAS 100G", "cantidad": 1, "unidad_ticket": "pieza",
             "costo_unitario_centavos": 900, "importe_centavos": 900,
             "tipo": "venta", "confianza": "alta", "nota": None},
        ]})
    segunda = json.dumps({
        "proveedor": "X", "avisos": [], "total_ticket_centavos": None,
        "lineas": [
            {"nombre_crudo": "AGUA MINERAL 600 ML", "cantidad": 2, "unidad_ticket": "pieza",
             "costo_unitario_centavos": 1500, "importe_centavos": 3000,
             "tipo": "venta", "confianza": "alta", "nota": None},      # coincide: verificada
            {"nombre_crudo": "REFRESCO COLA 355ML", "cantidad": 1, "unidad_ticket": "pieza",
             "costo_unitario_centavos": 1500, "importe_centavos": 1500,
             "tipo": "venta", "confianza": "alta", "nota": None},      # discrepa en costo
        ]})                                                            # GALLETAS no sale

    def _comportamiento(key, modelo):
        if modelo == "m1":
            return _respuesta_gemini_falsa(primera)
        return _respuesta_gemini_falsa(segunda)

    llamados, restaurar = _simular_gemini(_comportamiento)
    try:
        r = cliente.post("/ia/ticket", json={"imagen_b64": IMAGEN}, headers=HEADERS)
    finally:
        restaurar()
    assert r.status_code == 200, f"esperaba 200, llegó {r.status_code}: {r.text}"
    d = r.json()
    # hubo exactamente 2 llamados: m1 (análisis) y m2 (verificación)
    assert [m for _, m in llamados] == ["m1", "m2"], f"llamados inesperados: {llamados}"
    assert d["modelo_usado"] == "m1", "la respuesta es la PRIMERA lectura"
    v = d["verificacion"]
    assert v == {"aplicada": True, "lineas_verificadas": 1,
                 "lineas_discrepantes": 1, "lineas_sin_pareja": 1}, f"conteo mal: {v}"
    l1, l2, l3 = d["lineas"]
    assert l1["confianza"] == "alta" and l1["nota"] == ia_tickets.NOTA_VERIFICADO, \
        f"l1 debió quedar verificada: {l1['confianza']} / {l1['nota']}"
    assert l2["confianza"] == "baja" and l2["nota"] == ia_tickets.NOTA_DISCREPAN, \
        f"l2 debió quedar discrepante: {l2['confianza']} / {l2['nota']}"
    assert l3["confianza"] == "baja" and l3["nota"] == ia_tickets.NOTA_SOLO_UNA_LECTURA, \
        f"l3 debió quedar sin pareja: {l3['confianza']} / {l3['nota']}"
    # la 2ª lectura NUNCA sustituye números: l2 conserva SU costo de la 1ª (1200)
    assert l2["costo_unitario_centavos"] == 1200, "los números son de la primera lectura"
    # el cache recuerda el modelo BUENO (m1), no el verificador
    assert ia_tickets._ultimo_combo_bueno == (0, "m1")


# --------------------------------------------------------------------------
# (q) Verificación NO aplicada cuando el ticket sale limpio (1 sola llamada)
# --------------------------------------------------------------------------
@prueba("(q) limpio -> NO hay segunda lectura (ahorra cuota)")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "gemini"
    os.environ["IA_API_KEY"] = "llave-k"
    os.environ["IA_MODELOS"] = "m1,m2"
    llamados, restaurar = _simular_gemini(
        lambda key, modelo: _respuesta_gemini_falsa(_json_ticket_minimo()))
    try:
        r = cliente.post("/ia/ticket", json={"imagen_b64": IMAGEN}, headers=HEADERS)
    finally:
        restaurar()
    assert r.status_code == 200, f"esperaba 200, llegó {r.status_code}: {r.text}"
    assert len(llamados) == 1, f"ticket limpio debió hacer 1 sola llamada: {llamados}"
    v = r.json()["verificacion"]
    assert v == {"aplicada": False, "lineas_verificadas": 0,
                 "lineas_discrepantes": 0, "lineas_sin_pareja": 0}, f"debió ser vacía: {v}"


# --------------------------------------------------------------------------
# (r) Si la segunda lectura FALLA, el endpoint NO falla (aplicada=false)
# --------------------------------------------------------------------------
@prueba("(r) segunda lectura falla -> 200 con la 1ª lectura, aplicada=false")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "gemini"
    os.environ["IA_API_KEY"] = "llave-k"
    os.environ["IA_MODELOS"] = "m1,m2"

    dudosa = json.dumps({
        "proveedor": "X", "avisos": [], "total_ticket_centavos": None,
        "lineas": [{
            "nombre_crudo": "AGUA MINERAL 600ML", "cantidad": 2, "unidad_ticket": "pieza",
            "costo_unitario_centavos": 1500, "importe_centavos": 3000,
            "tipo": "venta", "confianza": "baja", "nota": None}],
    })

    def _comportamiento(key, modelo):
        if modelo == "m1":
            return _respuesta_gemini_falsa(dudosa)
        raise ia_tickets.ErrorProveedor(
            "el proveedor respondió HTTP 429: saturado", status=429, reintentable=True)

    llamados, restaurar = _simular_gemini(_comportamiento)
    try:
        r = cliente.post("/ia/ticket", json={"imagen_b64": IMAGEN}, headers=HEADERS)
    finally:
        restaurar()
    assert r.status_code == 200, f"la verificación NO debe tumbar el endpoint: {r.status_code}"
    d = r.json()
    assert d["modelo_usado"] == "m1"
    assert d["verificacion"]["aplicada"] is False, "debió quedar no aplicada"
    # la primera lectura se devuelve TAL CUAL (línea sigue en baja)
    assert d["lineas"][0]["confianza"] == "baja"
    assert d["lineas"][0]["nota"] is None
    assert [m for _, m in llamados] == ["m1", "m2"], f"intentó la verificación: {llamados}"


# --------------------------------------------------------------------------
# (s) El prompt contiene la regla de sección CAMBIO FISICO y la regla DD/MM
# --------------------------------------------------------------------------
@prueba("(s) prompt: regla CAMBIO FISICO (sección manda) y fechas DD/MM")
def _():
    for nombre_prompt, prompt in (("PROMPT_IMAGEN", ia_tickets.PROMPT_IMAGEN),
                                  ("PROMPT_TEXTO", ia_tickets.PROMPT_TEXTO)):
        assert "CAMBIO FISICO" in prompt, f"{nombre_prompt}: falta CAMBIO FISICO"
        assert "la sección manda sobre el producto" in prompt, \
            f"{nombre_prompt}: falta 'la sección manda sobre el producto'"
        assert "DD/MM" in prompt, f"{nombre_prompt}: falta la regla DD/MM"
        assert "AAAA-MM-DD" in prompt, f"{nombre_prompt}: falta el formato de salida"
    # el ejemplo explícito vive en PROMPT_IMAGEN: encabezado + 2 líneas debajo
    assert "CAMBIO FISICO\", aparece" in ia_tickets.PROMPT_IMAGEN or \
           "bajo el encabezado \"CAMBIO FISICO\"" in ia_tickets.PROMPT_IMAGEN, \
        "PROMPT_IMAGEN: falta el ejemplo con encabezado CAMBIO FISICO"
    assert 'tipo="cambio"' in ia_tickets.PROMPT_IMAGEN, \
        "PROMPT_IMAGEN: el ejemplo debe mostrar el tipo cambio"


# --------------------------------------------------------------------------
# (t) Respuesta con VENTA + CAMBIO del mismo producto: se conserva el tipo
# --------------------------------------------------------------------------
@prueba("(t) líneas venta+cambio del mismo producto: tipo cambio se conserva")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "gemini"
    os.environ["IA_API_KEY"] = "llave-k"
    os.environ["IA_MODELO"] = "m1"  # un solo modelo: no hay 2ª lectura posible

    ticket_con_cambio = json.dumps({
        "proveedor": "Distribuidor X", "avisos": [], "total_ticket_centavos": None,
        "lineas": [
            {"nombre_crudo": "SNACK SAL X 60G", "cantidad": 5, "unidad_ticket": "pieza",
             "costo_unitario_centavos": 1585, "importe_centavos": 7925,
             "tipo": "venta", "confianza": "alta", "nota": None},
            {"nombre_crudo": "SNACK SAL X 60G", "cantidad": 2, "unidad_ticket": "pieza",
             "costo_unitario_centavos": 1585, "importe_centavos": 3170,
             "tipo": "cambio", "confianza": "alta", "nota": None},
            # cambio que NO cuadra: el sanity también verifica las de cambio
            {"nombre_crudo": "GALLETA DULCE 90G", "cantidad": 2, "unidad_ticket": "pieza",
             "costo_unitario_centavos": 1585, "importe_centavos": 5000,
             "tipo": "cambio", "confianza": "alta", "nota": None},
        ]})

    llamados, restaurar = _simular_gemini(
        lambda key, modelo: _respuesta_gemini_falsa(ticket_con_cambio))
    try:
        r = cliente.post("/ia/ticket", json={"imagen_b64": IMAGEN}, headers=HEADERS)
    finally:
        restaurar()
    assert r.status_code == 200, f"esperaba 200, llegó {r.status_code}: {r.text}"
    d = r.json()
    venta, cambio_ok, cambio_mal = d["lineas"]
    # el tipo "cambio" se conserva tal cual vino del modelo
    assert venta["tipo"] == "venta" and cambio_ok["tipo"] == "cambio" \
        and cambio_mal["tipo"] == "cambio", \
        f"tipos mal conservados: {[l['tipo'] for l in d['lineas']]}"
    # cambio que cuadra (2×1585=3170): el sanity NO la toca
    assert cambio_ok["confianza"] == "alta" and cambio_ok["nota"] is None, \
        "un cambio coherente no debe ensuciarse"
    # cambio que NO cuadra (2×1585≠5000): la misma verificación aplica a cambios
    assert cambio_mal["confianza"] == "baja"
    assert ia_tickets.NOTA_NO_CUADRA in (cambio_mal["nota"] or "")
    assert any(ia_tickets.NOTA_NO_CUADRA in a for a in d["avisos"])
    # una sola llamada (modelo único: sin verificación posible)
    assert len(llamados) == 1, f"debió ser 1 llamada: {llamados}"


# --------------------------------------------------------------------------
# (u) El prompt contiene las reglas de los 7 formatos de ticket mexicanos
# --------------------------------------------------------------------------
@prueba("(u) prompt: ENTREGADO, shortage, MOVIMIENTO DE ENVASE, EAN 13, kg")
def _():
    for nombre_prompt, prompt in (("PROMPT_IMAGEN", ia_tickets.PROMPT_IMAGEN),
                                  ("PROMPT_TEXTO", ia_tickets.PROMPT_TEXTO)):
        assert "ENTREGADO" in prompt, f"{nombre_prompt}: falta la regla ENTREGADO sobre pedido"
        assert "SHORTAGE" in prompt, f"{nombre_prompt}: falta la exclusión de shortage"
        assert "MOVIMIENTO DE ENVASE" in prompt, \
            f"{nombre_prompt}: falta la regla de envase retornable"
        assert "13 dígitos" in prompt, f"{nombre_prompt}: falta la regla EAN de 13 dígitos"
        assert "se vende por kg" in prompt, f"{nombre_prompt}: falta la regla de granel en kg"


# --------------------------------------------------------------------------
# (v) Simulación estilo ticket moderno: shortage ya excluido + kg + EAN 13
# --------------------------------------------------------------------------
@prueba("(v) normalización: sin líneas fantasma, kg con decimal y EAN 13 intactos")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "gemini"
    os.environ["IA_API_KEY"] = "llave-k"
    os.environ["IA_MODELO"] = "m1"

    ticket_moderno = json.dumps({
        "proveedor": "Cervecería X", "total_ticket_centavos": None,
        "avisos": ["no entregaron CERVEZA LATA 355 (fila shortage)"],
        "lineas": [
            # el modelo YA excluyó la fila ENT=0 (shortage): no debe aparecer
            {"nombre_crudo": "CERVEZA LATA 355", "codigo_barras": None,
             "cantidad": 10, "unidad_ticket": "caja", "piezas_por_empaque": 24,
             "costo_unitario_centavos": 40000, "importe_centavos": 400000,
             "tipo": "venta", "confianza": "alta", "nota": None},
            # granel: 4.500 KG a $89.00 (decimal de 3 posiciones, válido)
            {"nombre_crudo": "JAMON GRANEL", "codigo_barras": None,
             "cantidad": 4.5, "unidad_ticket": "pieza", "piezas_por_empaque": None,
             "costo_unitario_centavos": 8900, "importe_centavos": 40050,
             "tipo": "venta", "confianza": "alta", "nota": "se vende por kg"},
            # cigarros: EAN de 13 dígitos en columna EAN/SKU
            {"nombre_crudo": "CIGARRO ROJO BOX", "codigo_barras": "7501234567890",
             "cantidad": 1, "unidad_ticket": "pieza", "piezas_por_empaque": None,
             "costo_unitario_centavos": 7500, "importe_centavos": 7500,
             "tipo": "venta", "confianza": "alta", "nota": None},
        ]})

    llamados, restaurar = _simular_gemini(
        lambda key, modelo: _respuesta_gemini_falsa(ticket_moderno))
    try:
        r = cliente.post("/ia/ticket", json={"imagen_b64": IMAGEN}, headers=HEADERS)
    finally:
        restaurar()
    assert r.status_code == 200, f"esperaba 200, llegó {r.status_code}: {r.text}"
    d = r.json()
    # (a) sin líneas fantasma: solo las 3 entregadas, ninguna con cantidad 0
    assert len(d["lineas"]) == 3, f"aparecieron líneas de más: {len(d['lineas'])}"
    assert all(l["cantidad"] > 0 for l in d["lineas"]), "hay una línea con cantidad 0"
    assert any("no entregaron" in a for a in d["avisos"]), \
        "el aviso de shortage debe conservarse"
    # (b) la cantidad en kg se conserva CON su decimal y su nota
    granel = d["lineas"][1]
    assert granel["cantidad"] == 4.5, f"el decimal de kg se perdió: {granel['cantidad']}"
    assert granel["nota"] == "se vende por kg", f"nota granel: {granel['nota']}"
    assert granel["confianza"] == "alta", "4.5×8900=40050 cuadra: no debió tocarse"
    # (c) el EAN de 13 dígitos se conserva como codigo_barras
    cigarro = d["lineas"][2]
    assert cigarro["codigo_barras"] == "7501234567890", \
        f"EAN perdido: {cigarro['codigo_barras']}"
    # ticket limpio: una sola llamada, sanity sin ensuciar nada
    assert all(l["confianza"] == "alta" for l in d["lineas"])
    assert not any(ia_tickets.NOTA_NO_CUADRA in (l["nota"] or "") for l in d["lineas"])
    assert len(llamados) == 1, f"debió ser 1 llamada: {llamados}"


# --------------------------------------------------------------------------
# Extra: límites del endpoint (400 sin imagen, 413 con foto gigante)
# --------------------------------------------------------------------------
@prueba("(extra) sin imagen_b64 -> 400")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "mock"
    r = cliente.post("/ia/ticket", json={}, headers=HEADERS)
    assert r.status_code == 400, f"esperaba 400, llegó {r.status_code}: {r.text}"


@prueba("(extra) imagen > 8 MB en base64 -> 413")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "mock"
    gigante = "A" * (8 * 1024 * 1024 + 10)
    r = cliente.post("/ia/ticket", json={"imagen_b64": gigante}, headers=HEADERS)
    assert r.status_code == 413, f"esperaba 413, llegó {r.status_code}: {r.text}"


@prueba("(extra) proveedor inválido -> 503")
def _():
    _limpiar_env()
    os.environ["IA_PROVEEDOR"] = "otro-proveedor"
    r = cliente.post("/ia/ticket", json={"imagen_b64": IMAGEN}, headers=HEADERS)
    assert r.status_code == 503, f"esperaba 503, llegó {r.status_code}: {r.text}"


_limpiar_env()

# --------------------------------------------------------------------------
# Resumen
# --------------------------------------------------------------------------
pasaron = sum(1 for _, ok, _ in _resultados if ok)
total = len(_resultados)
print(f"\n{pasaron}/{total} pruebas pasaron.")
if pasaron != total:
    sys.exit(1)
print("TODAS LAS PRUEBAS PASARON.")
