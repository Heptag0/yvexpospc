# LEEME — Escáner de tickets de proveedor con IA (endpoint `/ia/ticket`)

Instrucciones para subir el NUEVO endpoint al servidor. No necesitas saber
programar: solo copia y pega los comandos tal cual. Tiempo estimado: 15 minutos.

> **Nota honesta:** este endpoint se probó **en local** (en la PC de desarrollo)
> con el modo de prueba `mock`: las 19 pruebas automáticas pasaron
> (`test-ia_tickets.py`). **Todavía no se ha probado en el servidor real**; por
> eso el paso 6 es una verificación en vivo. El endpoint **NO toca la base de
> datos**: solo recibe la foto, llama a la IA y devuelve el análisis. Si algo
> falla, no se daña nada de lo que ya funciona.

---

## Qué se va a instalar

Un archivo nuevo: `ia_tickets.py` (en esta carpeta viene como
`backend-ia_tickets.py`). Agrega el endpoint `POST /ia/ticket`: la app manda la
foto de un ticket de proveedor y el servidor devuelve el análisis (proveedor,
productos, cantidades, costos en centavos) listo para capturar la entrada de
inventario.

**NUEVO — Pipeline v2 determinista:**
- `imagen → [EasyOCR] → texto plano → [Gemini texto] → JSON`
- Fallback v1 (si OCR falla o no está instalado):
  `imagen → [Gemini visión] → JSON`

El pipeline de texto elimina la variabilidad de visión: la misma foto siempre
produce el mismo texto OCR, y Gemini con `temperature=0` siempre produce la
misma respuesta para el mismo texto. Esto hace que el escáner sea **determinista**
y mucho más barato (Gemini cobra ~10× menos por texto que por imagen).

---

## Paso 0 — Instalar EasyOCR en el VPS (IMPORTANTE)

EasyOCR es la librería de OCR gratuita que extrae el texto plano de la foto
antes de mandarlo a Gemini. Con 8 GB de RAM es suficiente (usa ~2 GB al cargar).

Conéctate al servidor y ejecuta:

```bash
ssh root@195.26.253.246

# Crear un entorno virtual para no ensuciar el sistema
python3 -m venv /opt/yvexpos/venv-ocr
source /opt/yvexpos/venv-ocr/bin/activate

# Instalar EasyOCR y dependencias
pip install easyocr pillow numpy torch

# Verificar que cargó bien (tarda ~30-60s la primera vez, descarga modelos)
python3 -c "import easyocr; r = easyocr.Reader(['es','en'], gpu=False); print('OK')"
```

Si el VPS no tiene `python3-venv`:
```bash
apt update && apt install -y python3-venv
```

**Nota:** EasyOCR es 100% gratuito y corre localmente en el VPS. No hay cuotas
ni pagos. Los modelos se descargan automáticamente la primera vez (~100 MB).

---

## Paso 1 — Subir el archivo al servidor (desde tu PC con Windows)

Abre **PowerShell** (tecla Windows → escribe "powershell" → Enter) y pega:

```powershell
scp C:\Users\hepta\Desktop\Posmovil\yvexpos-movil\entrega-pc\backend-ia_tickets.py root@195.26.253.246:/var/www/yvexpos/backend/ia_tickets.py
```

(Ojo: el archivo se sube con el nombre **`ia_tickets.py`**, sin el prefijo
"backend-".) Te pedirá la contraseña del servidor.

Después entra al servidor:

```powershell
ssh root@195.26.253.246
```

Todo lo que sigue se hace **dentro del servidor**.

---

## Paso 2 — Registrar el endpoint en main.py (2 líneas)

Abre el archivo principal:

```bash
nano /var/www/yvexpos/backend/main.py
```

1. **Busca la línea que dice `import sync_bajar`** (o `import sync`). Junto a
   esos imports, agrega una línea nueva:

   ```python
   import ia_tickets
   ```

2. **Busca la línea que dice `app.include_router(sync_bajar.router)`** (o la de
   sync). Junto a esa línea, agrega:

   ```python
   app.include_router(ia_tickets.router)
   ```

Guarda y sal: `Ctrl+O`, Enter, `Ctrl+X`.

---

## Paso 3 — Configurar las variables de entorno

El endpoint se configura con variables de entorno del servicio. Edita el servicio:

```bash
sudo systemctl edit yvexpos
```

Se abre un editor. Escribe exactamente esto:

```ini
[Service]
Environment="IA_PROVEEDOR=gemini"
Environment="IA_API_KEYS=TU_LLAVE_1,TU_LLAVE_2"
```

**Si aún no tienes API key**, prueba primero en modo mock:
```ini
[Service]
Environment="IA_PROVEEDOR=mock"
Environment="IA_API_KEY="
```

Con `IA_PROVEEDOR=mock` el endpoint **funciona de inmediato en modo prueba**:
no llama a ninguna IA y devuelve un análisis de ejemplo. La respuesta trae
`"mock": true` para que la app pueda mostrar "modo prueba".

**Cuando tengas tu API key de Google AI Studio** (gratis en
https://aistudio.google.com/apikey), vuelves a `sudo systemctl edit yvexpos`
y cambias a:
```ini
Environment="IA_PROVEEDOR=gemini"
Environment="IA_API_KEYS=PEGA_TU_LLAVE_AQUI"
```

**OPCIONAL — Varias API keys para más cuota gratis** (`IA_API_KEYS`):
las cuotas gratuitas de Gemini son **por modelo Y por proyecto** (cada key
es un proyecto con contadores propios). Si configuras varias keys separadas
por comas, multiplicas el techo de respaldo:
```ini
Environment="IA_API_KEYS=LLAVE_UNO,LLAVE_DOS,LLAVE_TRES"
```

La cadena de modelos ya está configurada en el código:
`gemini-2.5-flash-preview-05-20, gemini-2.5-flash, gemini-2.0-flash, gemini-1.5-flash`.
Se intenta el mejor primero en TODAS las llaves antes de bajar a uno peor.

**OPCIONAL — Variables de modelo** (casi nunca hace falta tocarlas):
- `IA_MODELOS="modelo1,modelo2"` — tu propia cadena de respaldo.
- `IA_MODELO="gemini-2.0-flash"` — fija UN solo modelo (manda sobre IA_MODELOS).

La respuesta incluye `"modelo_usado"` y `"ocr_usado": true/false` para saber
qué pipeline se usó.

---

## Paso 4 — IMPORTANTE: permitir fotos grandes en nginx

Las fotos viajan en base64 (hasta ~8 MB). nginx por defecto rechaza peticiones
grandes con un error 413, así que hay que ampliar el límite.

Busca el archivo de configuración de tu sitio:

```bash
ls /etc/nginx/sites-enabled/
```

Abre el que corresponda a **pos.yvexiq.com**, por ejemplo:

```bash
sudo nano /etc/nginx/sites-enabled/pos.yvexiq.com
```

Dentro del bloque `server { ... }` agrega esta línea (por ejemplo, junto a los
`proxy_pass` o debajo de `server_name`):

```nginx
client_max_body_size 12m;
```

Guarda y sal. Luego verifica que la configuración no tenga errores y recarga:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Debe decir `syntax is ok` y `test is successful`.

---

## Paso 5 — Reiniciar el backend

```bash
sudo systemctl restart yvexpos
```

---

## Paso 6 — Verificar que quedó funcionando

**6.1. Revisa los logs** (no debe haber errores en rojo):

```bash
journalctl -u yvexpos -n 50 --no-pager
```

**6.2. Prueba el endpoint en vivo** (modo mock, desde el mismo servidor).
Necesitas el ID y token de un dispositivo registrado (los mismos que usa la
app para sincronizar). Sustituye `ID_DE_TU_DISPOSITIVO` y `TOKEN_DE_TU_DISPOSITIVO`:

```bash
curl -s -X POST https://pos.yvexiq.com/ia/ticket \
  -H "Content-Type: application/json" \
  -H "X-Dispositivo-Id: ID_DE_TU_DISPOSITIVO" \
  -H "X-Dispositivo-Token: TOKEN_DE_TU_DISPOSITIVO" \
  -d '{"imagen_b64": "aGVsbG8=", "mime": "image/jpeg"}'
```

**Lo esperado:** un JSON con `"mock": true`, `"proveedor": "Bimbo"` y una
lista de `lineas` con productos de ejemplo (Nito, Rebanada, Choc Role...).

Si responde `401`: el ID o token del dispositivo están mal (el endpoint usa la
misma seguridad que el sync).
Si responde `502`: el modo activo es `gemini`/`kimi` y la IA falló; revisa la
llave.
Si responde `503`: falta configurar `IA_API_KEY` (paso 3).

---

## Resumen de códigos de respuesta del endpoint

| Código | Significado |
|--------|-------------|
| 200 | Análisis listo (incluye `ocr_usado: true/false` y `modelo_usado`). |
| 400 | La app no mandó la imagen. |
| 401 | Dispositivo no registrado o token inválido. |
| 413 | La foto pesa más de ~8 MB en base64 (tómala más de cerca o con menor resolución). |
| 429 | TODAS las combinaciones de llaves y modelos están saturadas o sin cuota. Reintenta en unos minutos. |
| 502 | La IA falló (sin internet, llave inválida, respuesta rara). El detalle viene en español y recortado. |
| 503 | Falta configuración: sin `IA_API_KEY` o proveedor inválido. |

---

## Archivos de esta entrega

| Archivo | Para qué |
|---------|----------|
| `backend-ia_tickets.py` | El endpoint con pipeline v2 (OCR → texto → Gemini). Se sube al VPS como `ia_tickets.py`. |
| `test-ia_tickets.py` | Pruebas automáticas locales (19/19 pasan en la PC de desarrollo). No se sube al servidor. |
| `LEEME-IA-TICKETS.md` | Este instructivo. |
