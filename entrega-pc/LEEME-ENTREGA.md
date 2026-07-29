# Entrega PC — Etiquetas de origen, cajeros, fix reimprimir, devoluciones cruzadas y modo offline limpio

Fecha: 2026-07-23

## Qué incluye esta entrega

1. **Fix "No se encontró la venta #33"**: tickets y devoluciones ahora localizan la venta
   por su ID único global (el folio solo es único por caja). Ver, reimprimir, devolver y
   cancelar ventas del móvil desde el PC ya funciona.
2. **Devoluciones cruzadas con sync completa**: al devolver/cancelar en el PC una venta
   del móvil, el stock reingresa y sube a la nube, el estado de la venta viaja de vuelta
   al móvil, y las líneas de devolución también se encolan (antes solo subía la cabecera).
3. **Etiquetas de origen y cajero**: cada venta muestra quién la cobró. Si bajó de otra
   caja por sync, se marca "Otra caja · nombre" (violeta). Aparece en: Inicio (actividad
   reciente), lista de tickets del día, y aviso bajo las métricas del Inicio.
4. **Corte explicado**: el corte sigue siendo solo de tu caja (el efectivo es físico),
   pero ahora muestra una nota: "Otras cajas hoy: $X en N ventas (no entran a este arqueo)".
5. **Modo offline limpio** (lo que pediste): si el dispositivo NO tiene cuenta vinculada,
   ya no se encola NADA en cola_sync. Antes la cola crecía para siempre aunque nunca se
   enviara. OJO: lo vendido antes de vincular una cuenta no sube retroactivamente.
6. **Usuarios/cajeros sincronizados**: los nombres reales de los cajeros viajan entre
   cajas (el PIN NUNCA viaja). El backend ahora acepta "usuarios_pos" y devuelve
   "usuarios" en la bajada.

## Validación hecha antes de entregar

- `cargo check`: limpio (solo los 4 warnings conocidos de siempre).
- `node --check`: OK en los 5 JS tocados.
- `python -m py_compile`: OK en los 2 archivos del backend.
- `tsc` del móvil: limpio.

## Paso 1 — Subir el backend al VPS (PRIMERO, antes que todo)

```
scp C:\Users\hepta\Desktop\Posmovil\yvexpos-movil\entrega-pc\backend-sync.py root@195.26.253.246:/var/www/yvexpos/backend/sync.py
scp C:\Users\hepta\Desktop\Posmovil\yvexpos-movil\entrega-pc\backend-sync_bajar.py root@195.26.253.246:/var/www/yvexpos/backend/sync_bajar.py
ssh root@195.26.253.246 "systemctl restart yvexpos && journalctl -u yvexpos -n 30 --no-pager"
```

Verifica que el servicio quede "active (running)" y sin tracebacks en los logs.

## Paso 2 — Actualizar el PC

Con la app del PC CERRADA, copia estos archivos sobre `C:\Users\hepta\Desktop\yvexiq-pos\`
(la estructura de carpetas de entrega-pc es espejo: cada archivo va en la misma ruta
relativa dentro del proyecto):

```
entrega-pc\src-tauri\src\db\caja.rs           -> src-tauri\src\db\caja.rs
entrega-pc\src-tauri\src\db\comun.rs          -> src-tauri\src\db\comun.rs
entrega-pc\src-tauri\src\db\devoluciones.rs   -> src-tauri\src\db\devoluciones.rs
entrega-pc\src-tauri\src\db\sync_pull.rs      -> src-tauri\src\db\sync_pull.rs
entrega-pc\src-tauri\src\db\ticket.rs         -> src-tauri\src\db\ticket.rs
entrega-pc\src-tauri\src\commands\mod.rs      -> src-tauri\src\commands\mod.rs
entrega-pc\src\vistas\caja.js                 -> src\vistas\caja.js
entrega-pc\src\vistas\devoluciones.js         -> src\vistas\devoluciones.js
entrega-pc\src\vistas\inicio.js               -> src\vistas\inicio.js
entrega-pc\src\vistas\ticket.js               -> src\vistas\ticket.js
entrega-pc\src\vistas\venta.js                -> src\vistas\venta.js
entrega-pc\src\styles.css                     -> src\styles.css
```

Luego arranca como siempre (`npm run tauri dev`).

## Paso 3 — Avisarme para el backfill de usuarios

Cuando el backend esté desplegado y el PC actualizado, AVÍSAME y yo ejecuto
directamente sobre tu base local del PC:
- re-encolar al usuario "Arturo" para que su nombre suba a la nube;
- resetear la marca de bajada (sync_desde) para que el PC vuelva a bajar todo,
  incluidos los usuarios del móvil.

## Paso 4 — Móvil

Solo recargar la app (Expo recarga solo). Luego, para que el nombre del cajero
del móvil suba a la nube: Ajustes → Usuarios → edita "Dueño" y guarda (sin
cambiar nada basta). Después, Sincronizar.

## Qué verificar al final

1. En el PC, la venta #33 del móvil: se ve, se reimprime y se puede devolver.
2. En Inicio y en tickets del día, las ventas del móvil salen con
   "Otra caja · Dueño" (tras el paso 4; antes dirá solo "Otra caja").
3. El Corte muestra la nota de otras cajas cuando hay ventas del móvil ese día.
4. Una devolución hecha en el PC sobre una venta del móvil se refleja en el
   móvil tras sincronizar (estado + stock).
