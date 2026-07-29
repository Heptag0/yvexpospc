# Despliegue — YvexPOS Tiendas (tienda.yvexiq.com)

Backend NUEVO y SEPARADO del escáner. Servicio systemd `yvexpos-tienda`, puerto
8100, subdominio tienda.yvexiq.com. NO toca el servicio `yvexpos` existente
(pos.yvexiq.com): solo LEE las tablas `dispositivos` y `negocios` de la misma
base y REUTILIZA su módulo `auth.py` para verificar tokens.

Archivos de esta carpeta (`entrega-pc/tienda/`):
- `tienda_backend.py` — el servicio FastAPI.
- `plantillas.py` — las 6 plantillas del escaparate (aurora, noche, mercado,
  boutique, menu, catalogo).
- `tienda_utils.py` — utilidades (slugs, fotos, precios, WhatsApp).
- `test_tienda.py` — pruebas locales (ya pasaron; no se sube al servidor).
- Las muestras `muestra_*.html/png` son solo evidencia visual; no se suben.

---

## ⚠️ PASO 0 — DNS (SOLO PUEDES HACERLO TÚ, ANTES QUE TODO)

En el panel de tu proveedor de dominio (donde compraste yvexiq.com), crea un
**registro tipo A**:

    tienda.yvexiq.com   →   195.26.253.246

Sin este registro, certbot NO puede emitir el certificado y el sitio no abrirá.
Verifica que ya propagó antes de seguir:

    nslookup tienda.yvexiq.com
    # debe responder 195.26.253.246 (puede tardar de minutos a unas horas)

---

## Paso 1 — Subir el código al VPS

Desde tu PC (Git Bash), en la carpeta del proyecto:

```
scp C:\Users\hepta\Desktop\Posmovil\yvexpos-movil\entrega-pc\tienda\tienda_backend.py root@195.26.253.246:/var/www/yvexpos/tienda/tienda_backend.py
scp C:\Users\hepta\Desktop\Posmovil\yvexpos-movil\entrega-pc\tienda\plantillas.py     root@195.26.253.246:/var/www/yvexpos/tienda/plantillas.py
scp C:\Users\hepta\Desktop\Posmovil\yvexpos-movil\entrega-pc\tienda\tienda_utils.py   root@195.26.253.246:/var/www/yvexpos/tienda/tienda_utils.py
```

(Si la carpeta no existe, créala primero: `ssh root@195.26.253.246 "mkdir -p /var/www/yvexpos/tienda/media"`.)

### 1.1 — Pon tu número de WhatsApp para el bloque "página web propia"

Edita en el servidor (o en tu copia y vuelve a subir) la constante al inicio de
`tienda_backend.py`:

```
CONTACTO_WEBMASTER = "521234567890"   # ← tu número: "52" + 10 dígitos
```

## Paso 2 — Revisar cómo corre el servicio existente

El servicio nuevo debe usar el MISMO usuario y el MISMO Python/entorno que el
que ya funciona. Míralo con:

```
systemctl cat yvexpos
```

Anota de ahí: `User=`, `Group=`, `WorkingDirectory=`, el `ExecStart=` completo
(qué python/uvicorn usa y de qué entorno), y cualquier `Environment=`
(¡sobre todo la cadena de conexión a PostgreSQL!). También verifica dónde vive
`auth.py` del backend actual (normalmente `/var/www/yvexpos/backend/auth.py`):

```
ls /var/www/yvexpos/backend/
```

## Paso 3 — Crear el servicio systemd

Crea `/etc/systemd/system/yvexpos-tienda.service` con este contenido,
AJUSTANDO usuario, python y DATABASE_URL a lo que viste en el paso 2:

```
[Unit]
Description=YvexPOS Tiendas (escaparate público)
After=network.target postgresql.service

[Service]
Type=simple
User=www-data                 # ← el MISMO usuario del servicio yvexpos
Group=www-data
WorkingDirectory=/var/www/yvexpos/tienda
Environment=DATABASE_URL=postgresql+psycopg2://USUARIO:CLAVE@127.0.0.1:5432/yvexpos_db
Environment=TIENDA_URL_PUBLICA=https://tienda.yvexiq.com
Environment=TIENDA_MEDIA_DIR=/var/www/yvexpos/tienda/media
Environment=TIENDA_BACKEND_DIR=/var/www/yvexpos/backend
ExecStart=/var/www/yvexpos/venv/bin/uvicorn tienda_backend:app --host 127.0.0.1 --port 8100
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Notas:
- `ExecStart`: usa el uvicorn/python del MISMO entorno del servicio yvexpos
  (cópialo del `systemctl cat yvexpos`). Así garantizas que fastapi, sqlalchemy
  y el driver de Postgres ya están instalados.
- `DATABASE_URL`: la misma cadena que usa el backend existente.
- `TIENDA_BACKEND_DIR`: carpeta donde está `auth.py` del backend actual. El
  servicio de tienda lo importa para verificar tokens EXACTAMENTE igual que el
  sync. Si ese import falla, el servicio cae a un respaldo SHA-256 (funciona si
  los token_hash son SHA-256 del token; si tus tokens no verifican, revisa que
  esta ruta sea correcta y que `auth.py` sea importable).

Activa y arranca:

```
systemctl daemon-reload
systemctl enable --now yvexpos-tienda
systemctl status yvexpos-tienda --no-pager
journalctl -u yvexpos-tienda -n 30 --no-pager
```

Debe quedar "active (running)" y sin tracebacks. Prueba local:

```
curl http://127.0.0.1:8100/salud
# {"ok":true,"servicio":"yvexpos-tienda"}
```

## Paso 4 — nginx para tienda.yvexiq.com

Crea `/etc/nginx/sites-available/tienda.yvexiq.com`:

```
server {
    listen 80;
    server_name tienda.yvexiq.com;

    client_max_body_size 20m;   # las fotos viajan en base64 dentro del JSON

    location / {
        proxy_pass http://127.0.0.1:8100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Decisión tomada: TODO pasa por FastAPI, incluidas las fotos (`/media/...` las
sirve el propio servicio con caché de 24 h y validación contra path traversal).
Es lo más simple y suficiente para el volumen de una tienda; no hace falta un
`alias` de nginx.

Activa y recarga:

```
ln -s /etc/nginx/sites-available/tienda.yvexiq.com /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

## Paso 5 — Certificado HTTPS

```
certbot --nginx -d tienda.yvexiq.com
```

(Recuerda: falla si el registro DNS del paso 0 aún no propaga.)

## Paso 6 — Verificación final

```
curl -I https://tienda.yvexiq.com/salud
curl https://tienda.yvexiq.com/t/prueba        # 404 elegante mientras nadie publica
journalctl -u yvexpos-tienda -f
```

Cuando la app publique una tienda, abre `https://tienda.yvexiq.com/t/{slug}`
en el celular: catálogo, buscador y pedido por WhatsApp.

---

## Subdominios wildcard (OPCIONAL) — {slug}.yvexiq.com

La v2 da a cada tienda su URL canónica `https://{slug}.yvexiq.com`
(ej. `modelorama.yvexiq.com`). **NO es obligatorio**: sin nada de esta sección,
la forma path `https://tienda.yvexiq.com/t/{slug}` sigue funcionando igual que
en v1 y es el fallback permanente. Hazlo solo cuando quieras las URLs bonitas.

Cómo funciona: el backend resuelve la tienda por el header `Host` — cualquier
host `*.yvexiq.com` cuyo primer label no sea reservado (pos, www, mail, api,
app, tienda, admin, smtp, imap, ftp, ns1, ns2, soporte, ayuda, blog, status)
se trata como slug de tienda. Los server blocks específicos de nginx
(pos.yvexiq.com, www, etc.) se evalúan ANTES que el wildcard, así que todos
conviven sin tocarse.

### 1. DNS wildcard

En el panel de tu dominio, registro **tipo A**:

    *.yvexiq.com   →   195.26.253.246

(Ojo: esto NO sustituye el registro de `tienda.yvexiq.com` del paso 0; déjalo.)

### 2. Certificado wildcard (Let's Encrypt)

Los certificados wildcard exigen el reto DNS (no sirve `--nginx` normal):

```
certbot certonly --manual --preferred-challenges dns \
    -d "*.yvexiq.com" -d yvexiq.com
```

Te pedirá crear un registro TXT `_acme-challenge.yvexiq.com` en tu DNS.
**Advertencia honesta**: con `--manual` la renovación es MANUAL cada ~90 días
(hay que repetir el comando y actualizar el TXT). Si tu proveedor de DNS tiene
plugin de certbot (Cloudflare, Route53, etc.), úsalo para renovación automática;
si no, apunta un recordatorio cada 80 días.

### 3. nginx para el wildcard

Crea `/etc/nginx/sites-available/wildcard.yvexiq.com`:

```
server {
    listen 443 ssl;
    server_name *.yvexiq.com;

    ssl_certificate     /etc/letsencrypt/live/yvexiq.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yvexiq.com/privkey.pem;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:8100;
        proxy_set_header Host $host;          # ¡crucial! el backend lee el slug del Host
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`proxy_set_header Host $host;` es la pieza clave: sin ella el backend no ve el
subdominio y no puede resolver la tienda. nginx atiende primero los
`server_name` exactos (pos.yvexiq.com y los que ya tengas) y solo lo demás cae
en este wildcard, así que tus servicios actuales no se ven afectados. Los slugs
reservados además están bloqueados en el backend por si acaso.

```
ln -s /etc/nginx/sites-available/wildcard.yvexiq.com /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 4. Verificación

```
curl -I https://modelorama.yvexiq.com/        # la tienda, si ese slug existe
curl https://cualquier-cosa.yvexiq.com/       # 404 elegante (slug libre = sin tienda)
```

---

## Contrato de la API (lo consume la app móvil)

Auth en los endpoints `/api/*`: headers `X-Dispositivo-Id` y
`X-Dispositivo-Token`, idéntico al sync y al escáner. El negocio se deriva del
dispositivo (NUNCA del body).

### POST /api/tienda/publicar
Body (los campos v2 son todos opcionales; omitirlos = comportamiento v1):
```json
{
  "plantilla": "aurora | noche | mercado | boutique | menu | catalogo  (opcional; si no se envía se decide por giro, fallback aurora)",
  "giro": "ropa | belleza | mascotas | cafeteria | restaurante | abarrotes | farmacia | ferreteria | electronica | otro",
  "color_acento": "#e11d48",
  "whatsapp": "526691234567",
  "mensaje_bienvenida": "Todo para tu despensa",
  "mostrar_stock": false,
  "slug_deseado": "el-torito",
  "domicilio": "Av. Siempre Viva 123",
  "horarios": "Lun a Vie 9:00–19:00\nSáb 9:00–14:00",
  "instagram": "@eltorito (o URL)",
  "facebook": "https://facebook.com/eltorito (o usuario)",
  "tiktok": "eltorito_mx (o URL)",
  "entrega_pickup": true,
  "entrega_domicilio": false,
  "costo_envio_centavos": 3000,
  "pago_efectivo": true,
  "link_pago": "https://mpago.link/eltorito",
  "ocultar_agotados": false,
  "banner_base64": "(opcional, jpeg/png/webp, máx. 2 MB; se guarda en media/{negocio}/banner.{ext})",
  "productos": [
    {"producto_id": "uuid-del-pos", "nombre": "Coca 600", "descripcion": "Fría",
     "precio_centavos": 1800, "departamento": "Bebidas",
     "foto_base64": "(opcional, jpeg/png/webp, máx. 2 MB decodificada)",
     "orden": 0,
     "stock": 5}
  ]
}
```
Respuesta:
```json
{"ok": true, "slug": "el-torito",
 "url_publica": "https://el-torito.yvexiq.com",
 "url_path": "https://tienda.yvexiq.com/t/el-torito"}
```
- `url_publica` es la canónica (subdominio); `url_path` es el fallback que
  funciona sin DNS wildcard. La app puede mostrar ambas.
- Upsert de config + REEMPLAZO transaccional de productos (máx. 500).
- Producto sin `foto_base64` conserva su foto anterior; sin `banner_base64`
  conserva el banner anterior.
- `stock` opcional por producto: null = sin dato (nunca limita); con
  `mostrar_stock=true` se muestra badge "Quedan N" / "Agotado"; con
  `ocultar_agotados=true` los de stock 0 desaparecen del escaparate.
- Slug ocupado por OTRO negocio → sufijo `-2`, `-3`, ... Slugs reservados
  (pos, www, mail, api, app, tienda, admin, smtp, imap, ftp, ns1, ns2,
  soporte, ayuda, blog, status) nunca se asignan.
- Republicar reactiva la tienda (activa=1).

### GET /api/tienda/slug-disponible?slug=el-torito
Respuesta:
```json
{"disponible": true, "motivo": null, "sugerencia": null}
```
Si está ocupado o es inválido/reservado:
```json
{"disponible": false, "motivo": "Ese slug ya está ocupado.", "sugerencia": "el-torito-2"}
```
- Validación estricta: minúsculas, 3-40, alfanumérico + guiones, sin guiones
  en los extremos ni dobles; reservados bloqueados (con sugerencia igualmente).
- Si el slug es del PROPIO negocio, cuenta como disponible.

### POST /api/tienda/desactivar
Sin body. Respuesta: `{"ok": true}`. La página pública pasa a 404.

### GET /api/tienda/estado
Respuesta sin tienda: `{"tiene_tienda": false}`.
Con tienda:
```json
{"tiene_tienda": true, "activa": true, "slug": "el-torito",
 "url_publica": "https://el-torito.yvexiq.com",
 "url_path": "https://tienda.yvexiq.com/t/el-torito",
 "plantilla": "catalogo", "color_acento": "#e11d48", "whatsapp": "526...",
 "mensaje_bienvenida": "...", "mostrar_stock": true, "num_productos": 42,
 "publicada_en": "ISO-8601", "actualizado_en": "ISO-8601",
 "giro": "abarrotes", "domicilio": "...", "horarios": "...",
 "instagram": "...", "facebook": "...", "tiktok": "...",
 "entrega_pickup": true, "entrega_domicilio": false,
 "costo_envio_centavos": 3000, "pago_efectivo": true,
 "link_pago": "https://...", "ocultar_agotados": false,
 "banner_url": "/media/{negocio}/banner.jpg"}
```

### Públicos (sin auth)
- `GET /` en host `{slug}.yvexiq.com` → HTML de la tienda (resolución por
  subdominio; requiere el wildcard de la sección opcional). En cualquier otro
  host → portada mínima del servicio.
- `GET /t/{slug}` → HTML de la tienda (forma path, 404 elegante si no existe
  o está apagada).
- `GET /t/{slug}/catalogo.json` → JSON público cacheable (60 s) con todos los
  campos públicos v2 (booleans de entrega/pago, costo_envio_centavos,
  link_pago, banner_url, domicilio, horarios, redes; `whatsapp` solo como
  boolean, NUNCA el número) y `productos` con `stock`.
- `GET /media/{negocio_id}/{archivo}` → fotos y banners (caché 24 h).
- `GET /salud` → health check.
