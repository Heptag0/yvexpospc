// YvexPOS — utilidades compartidas de la Tienda en línea.
// Folio corto, hora relativa, teléfono MX y contraste WCAG (espejo del
// cálculo del backend en tienda_utils.py).

/// Folio corto del pedido: primeros 8 caracteres del id, en mayúsculas.
/// Es el mismo que el cliente ve en la tienda ("Folio web").
export function folioCorto(id) {
  return String(id || "").slice(0, 8).toUpperCase();
}

/// Hora relativa cálida: "ahorita", "hace 5 min", "hace 2 h", "ayer", o fecha.
export function horaRelativa(iso) {
  if (!iso) return "";
  const t = new Date(iso);
  if (isNaN(t)) return "";
  const seg = Math.max(0, Math.floor((Date.now() - t.getTime()) / 1000));
  if (seg < 60) return "ahorita";
  const min = Math.floor(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  if (h < 48) return "ayer";
  return t.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

/// Normaliza un teléfono mexicano para wa.me:
/// solo dígitos; si son 10, antepone 52. Ya con código de país queda igual.
export function normalizarTelMx(tel) {
  const d = String(tel || "").replace(/\D/g, "");
  if (d.length === 10) return "52" + d;
  return d;
}

/// URL de WhatsApp con mensaje pre-redactado (vacía si no hay número).
export function urlWhatsApp(tel, mensaje) {
  const n = normalizarTelMx(tel);
  if (!n) return "";
  return `https://wa.me/${n}?text=${encodeURIComponent(mensaje)}`;
}

/// Abre una URL externa con el plugin opener de Tauri (navegador del sistema).
export async function abrirUrl(url) {
  if (!url) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("plugin:opener|open_url", { url });
}

// ---------------------------------------------------------------------------
// Contraste WCAG (luminancia relativa) — espejo del guardia del backend.
// ---------------------------------------------------------------------------

function canalLineal(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/// Luminancia relativa de un color #rrggbb (0 = negro, 1 = blanco).
export function luminancia(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = canalLineal(((n >> 16) & 255) / 255);
  const g = canalLineal(((n >> 8) & 255) / 255);
  const b = canalLineal((n & 255) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/// Razón de contraste entre dos colores #rrggbb (1..21). null si alguno es inválido.
export function contraste(hexA, hexB) {
  const la = luminancia(hexA);
  const lb = luminancia(hexB);
  if (la == null || lb == null) return null;
  const [clara, oscura] = la >= lb ? [la, lb] : [lb, la];
  return (clara + 0.05) / (oscura + 0.05);
}
