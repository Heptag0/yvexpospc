"""Plantillas HTML de YvexPOS Tiendas — el escaparate público.

Funciones PURAS: reciben (config: dict, productos: list[dict]) y devuelven
HTML completo como str. Sin base de datos, sin red, sin dependencias externas
(solo librería estándar): el CSS va inline en <style>, fuentes del sistema y
vanilla JS para el pedido. Móvil primero.

config: {
    nombre_negocio: str, mensaje_bienvenida: str, color_acento: "#rrggbb",
    whatsapp: str (solo dígitos, "" si no hay), slug: str,
    contacto_webmaster: str (solo dígitos),
    # --- v2 (todas opcionales; ausentes = comportamiento v1) ---
    domicilio: str, horarios: str (multilínea),
    instagram: str, facebook: str, tiktok: str (URLs o @usuario),
    entrega_pickup: bool (defecto True), entrega_domicilio: bool (defecto False),
    costo_envio_centavos: int (defecto 0),
    pago_efectivo: bool (defecto True), link_pago: str (URL de pago en línea),
    ocultar_agotados: bool (defecto False), banner_url: str,
    mostrar_stock: bool (defecto False), giro: str,
}
productos: [{
    producto_id, nombre, descripcion, precio_centavos, departamento, foto_url,
    stock: int | None  (None = sin dato de stock; nunca limita)
}]

El formato del texto del pedido de WhatsApp en el JS replica EXACTAMENTE
tienda_utils.construir_texto_pedido — si cambias uno, cambia ambos.
"""
import html
import json
from urllib.parse import quote

from tienda_utils import formato_precio, normalizar_whatsapp, validar_color_hex


def _esc(v) -> str:
    return html.escape(str(v or ""), quote=True)


def _si(config: dict, clave: str, defecto: bool) -> bool:
    """Booleano de config tolerante a None/0/1 (ausente -> defecto)."""
    v = config.get(clave)
    return defecto if v is None else bool(v)


def _config_normalizada(config: dict) -> dict:
    """Aplica todos los defaults v2 sobre el dict crudo (v1 sigue igual)."""
    c = dict(config or {})
    c["nombre_negocio"] = (str(c.get("nombre_negocio") or "Mi tienda").strip() or "Mi tienda")
    c["mensaje_bienvenida"] = str(c.get("mensaje_bienvenida") or "").strip()
    c["color_acento"] = validar_color_hex(c.get("color_acento"))
    c["whatsapp"] = normalizar_whatsapp(c.get("whatsapp"))
    c["slug"] = str(c.get("slug") or "tienda")
    c["contacto_webmaster"] = normalizar_whatsapp(c.get("contacto_webmaster"))
    c["domicilio"] = str(c.get("domicilio") or "").strip()
    c["horarios"] = str(c.get("horarios") or "").strip()
    for red in ("instagram", "facebook", "tiktok"):
        c[red] = str(c.get(red) or "").strip()
    c["entrega_pickup"] = _si(config or {}, "entrega_pickup", True)
    c["entrega_domicilio"] = _si(config or {}, "entrega_domicilio", False)
    try:
        c["costo_envio_centavos"] = max(0, int(c.get("costo_envio_centavos") or 0))
    except (TypeError, ValueError):
        c["costo_envio_centavos"] = 0
    c["pago_efectivo"] = _si(config or {}, "pago_efectivo", True)
    c["link_pago"] = str(c.get("link_pago") or "").strip()
    c["ocultar_agotados"] = _si(config or {}, "ocultar_agotados", False)
    c["mostrar_stock"] = _si(config or {}, "mostrar_stock", False)
    c["banner_url"] = str(c.get("banner_url") or "").strip()
    return c


def _stock_de(p: dict):
    """Stock como int o None (sin dato)."""
    try:
        s = p.get("stock")
        return None if s is None else int(s)
    except (TypeError, ValueError):
        return None


def _productos_visibles(cfg: dict, productos: list) -> list:
    """Aplica ocultar_agotados: stock<=0 (con dato) desaparece del escaparate."""
    if not cfg["ocultar_agotados"]:
        return list(productos or [])
    return [p for p in (productos or []) if not (_stock_de(p) is not None and _stock_de(p) <= 0)]


def _badge_stock_html(p: dict, cfg: dict) -> str:
    """Badge "quedan N" / "agotado" cuando mostrar_stock=1 y hay dato."""
    if not cfg["mostrar_stock"]:
        return ""
    stock = _stock_de(p)
    if stock is None:
        return ""
    if stock <= 0:
        return '<span class="badge-stock agotado">Agotado</span>'
    return f'<span class="badge-stock">Quedan {stock}</span>'


def _agotado(p: dict, cfg: dict) -> bool:
    """True si el producto no se puede agregar (sin stock y con dato visible)."""
    stock = _stock_de(p)
    return cfg["mostrar_stock"] and stock is not None and stock <= 0


# ==========================================================================
# Bloques compartidos v2 (banner, Visítanos, sociales, pie)
# ==========================================================================
def _banner_html(cfg: dict) -> str:
    if not cfg["banner_url"]:
        return ""
    return (f'<div class="banner-hero"><img src="{_esc(cfg["banner_url"])}" '
            f'alt="{_esc(cfg["nombre_negocio"])}" loading="eager"></div>')


def _visitanos_html(cfg: dict) -> str:
    """Bloque "Visítanos": domicilio + horarios (texto multilínea)."""
    if not cfg["domicilio"] and not cfg["horarios"]:
        return ""
    partes = []
    if cfg["domicilio"]:
        partes.append(f'<p class="visita-linea"><strong>Dirección</strong><br>{_esc(cfg["domicilio"])}</p>')
    if cfg["horarios"]:
        lineas = "<br>".join(_esc(l) for l in cfg["horarios"].splitlines() if l.strip())
        partes.append(f'<p class="visita-linea"><strong>Horario</strong><br>{lineas}</p>')
    return ('<section class="visitanos"><h2 class="visitanos-titulo">Visítanos</h2>'
            + "".join(partes) + "</section>")


def _url_social(red: str, valor: str) -> str:
    """Acepta URL completa o @usuario y devuelve URL https segura."""
    v = valor.strip()
    if v.startswith("http://") or v.startswith("https://"):
        return v
    usuario = v.lstrip("@").strip("/")
    if not usuario:
        return ""
    base = {"instagram": "https://instagram.com/",
            "facebook": "https://facebook.com/",
            "tiktok": "https://tiktok.com/@"}[red]
    return base + usuario


_SVG_SOCIALES = {
    "instagram": ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">'
                  '<rect x="3" y="3" width="18" height="18" rx="5"/>'
                  '<circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/></svg>'),
    "facebook": ('<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
                 '<path d="M13.5 21v-7h2.4l.4-3h-2.8V9.1c0-.9.3-1.5 1.6-1.5h1.3V4.9c-.6-.1-1.4-.2-2.2-.2-2.2 0-3.7 1.3-3.7 3.8V11H8v3h2.5v7h3z"/></svg>'),
    "tiktok": ('<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
               '<path d="M16.5 3c.4 2 1.7 3.3 3.8 3.5v2.7c-1.4 0-2.7-.4-3.8-1.1v6.2c0 3.3-2.4 5.7-5.6 5.7-3 0-5.4-2.3-5.4-5.3 0-3.1 2.6-5.4 5.8-5.2v2.8c-1.7-.2-3 .9-3 2.4 0 1.4 1.1 2.5 2.5 2.5 1.6 0 2.8-1.2 2.8-3V3h2.9z"/></svg>'),
}


def _sociales_html(cfg: dict) -> str:
    """Iconos SVG inline con enlace a las redes configuradas."""
    enlaces = []
    for red in ("instagram", "facebook", "tiktok"):
        url = _url_social(red, cfg[red]) if cfg[red] else ""
        if url:
            enlaces.append(
                f'<a class="social" href="{_esc(url)}" target="_blank" rel="noopener" '
                f'aria-label="{red}" title="{red.capitalize()}">{_SVG_SOCIALES[red]}</a>')
    if not enlaces:
        return ""
    return '<div class="sociales">' + "".join(enlaces) + "</div>"


def _footer_html(cfg: dict) -> str:
    webmaster_html = ""
    if cfg["contacto_webmaster"]:
        msg_wm = ("Hola, vi una tienda hecha con YvexPOS y me interesa una página web "
                  "propia con mi dominio. ¿Me das información?")
        url_wm = f"https://wa.me/{cfg['contacto_webmaster']}?text={quote(msg_wm, safe='')}"
        webmaster_html = f"""
  <div class="webmaster">
    <p>¿Quieres una página web propia con tu dominio? Contáctanos.</p>
    <a href="{url_wm}" target="_blank" rel="noopener">Quiero mi página web</a>
  </div>"""
    return f"""<footer>
  <div class="contenedor">{webmaster_html}
    <p class="marca">Hecho con YvexPOS</p>
  </div>
</footer>"""


# ==========================================================================
# Pedido: sheet + JS compartidos por TODAS las plantillas (v1 y v2)
# ==========================================================================
def _opciones_entrega(cfg: dict) -> list:
    ops = []
    if cfg["entrega_pickup"]:
        ops.append(["pickup", "Recoger en tienda"])
    if cfg["entrega_domicilio"]:
        ops.append(["domicilio", "A domicilio"])
    return ops


def _opciones_pago(cfg: dict) -> list:
    ops = []
    if cfg["pago_efectivo"]:
        ops.append(["efectivo", "Efectivo al recibir"])
    if cfg["link_pago"]:
        ops.append(["linea", "Pagar en línea"])
    return ops


def _sheet_html(cfg: dict) -> str:
    """Sheet del pedido: líneas, entrega (con envío), pago, total, cliente."""
    ops_entrega = _opciones_entrega(cfg)
    ops_pago = _opciones_pago(cfg)

    if len(ops_entrega) > 1:
        radios = "".join(
            f'<label class="opcion"><input type="radio" name="entrega" value="{v}"'
            f'{" checked" if i == 0 else ""} onchange="dibujarSheet()">'
            f'<span>{_esc(et)}{_sufijo_envio(cfg, v)}</span></label>'
            for i, (v, et) in enumerate(ops_entrega))
        entrega_html = f'<div class="bloque-opciones"><h3>Entrega</h3>{radios}</div>'
    elif ops_entrega:
        entrega_html = (f'<p class="opcion-fija">Entrega: {_esc(ops_entrega[0][1])}'
                        f'{_sufijo_envio(cfg, ops_entrega[0][0])}</p>')
    else:
        entrega_html = ""

    if len(ops_pago) > 1:
        radios = "".join(
            f'<label class="opcion"><input type="radio" name="pago" value="{v}"'
            f'{" checked" if i == 0 else ""}>'
            f'<span>{_esc(et)}</span></label>'
            for i, (v, et) in enumerate(ops_pago))
        pago_html = f'<div class="bloque-opciones"><h3>Método de pago</h3>{radios}</div>'
    elif ops_pago:
        pago_html = f'<p class="opcion-fija">Pago: {_esc(ops_pago[0][1])}</p>'
    else:
        pago_html = ""

    return f"""
<div class="velo" id="velo" hidden onclick="if(event.target===this)cerrarPedido()">
  <div class="sheet" role="dialog" aria-label="Tu pedido">
    <h2>Tu pedido</h2>
    <div id="lineas"></div>
    {entrega_html}
    {pago_html}
    <div class="total"><span>Total</span><span class="monto" id="total">$0.00</span></div>
    <input id="nombreCliente" type="text" maxlength="60" placeholder="Tu nombre (opcional)">
    <textarea id="notas" maxlength="300" placeholder="Notas para tu pedido (opcional)"></textarea>
    <button class="btn-enviar" onclick="enviarPedido()">Enviar pedido por WhatsApp</button>
    <button class="btn-cerrar" onclick="cerrarPedido()">Seguir viendo la tienda</button>
  </div>
</div>"""


def _sufijo_envio(cfg: dict, valor: str) -> str:
    if valor == "domicilio" and cfg["costo_envio_centavos"] > 0:
        return f" (+{formato_precio(cfg['costo_envio_centavos'])} de envío)"
    return ""


def _js_tienda(cfg: dict, productos_js: list) -> str:
    """Todo el <script> de la tienda (catálogo, filtros, pedido WhatsApp).

    El formato del texto del pedido replica EXACTAMENTE
    tienda_utils.construir_texto_pedido: líneas, Entrega (+envío), Pago,
    Total (con envío sumado), Nombre, Notas."""
    datos_js = json.dumps(productos_js, ensure_ascii=False).replace("</", "<\\/")
    ops_entrega = _opciones_entrega(cfg)
    ops_pago = _opciones_pago(cfg)
    cfg_js = json.dumps({
        "envio": cfg["costo_envio_centavos"],
        "entrega": ops_entrega,
        "pago": [[v, et if v != "linea" else f"Pago en línea: {cfg['link_pago']}"]
                 for v, et in ops_pago],
        "linkPago": cfg["link_pago"],
    }, ensure_ascii=False)
    return f"""<script>
const CATALOGO={datos_js};
const NEGOCIO={json.dumps(cfg["nombre_negocio"], ensure_ascii=False)};
const WA={json.dumps(cfg["whatsapp"])};
const CLAVE={json.dumps("pedido_" + cfg["slug"])};
const CFG={cfg_js};
let pedido={{}};
try{{pedido=JSON.parse(localStorage.getItem(CLAVE))||{{}};}}catch(e){{pedido={{}};}}
let deptoFiltro='';
function fmt(c){{return '$'+(c/100).toLocaleString('es-MX',{{minimumFractionDigits:2,maximumFractionDigits:2}});}}
function escapeHtml(s){{const d=document.createElement('div');d.textContent=s;return d.innerHTML;}}
function filtrarChip(d){{
  deptoFiltro=(deptoFiltro===d)?'':d;
  document.querySelectorAll('.chip-filtro').forEach(c=>c.classList.toggle('activo',c.dataset.depto===deptoFiltro));
  filtrar();
}}
function filtrar(){{
  const q=((document.getElementById('busqueda')||{{}}).value||'').trim().toLowerCase();
  let visibles=0;
  document.querySelectorAll('.item-busqueda').forEach(t=>{{
    const ok=(!q||t.dataset.nombre.includes(q)||t.dataset.depto.includes(q))
      &&(!deptoFiltro||t.dataset.depto===deptoFiltro);
    t.style.display=ok?'':'none';if(ok)visibles++;
  }});
  document.querySelectorAll('.seccion-depto').forEach(s=>{{
    let alguna=false;
    s.querySelectorAll('.item-busqueda').forEach(t=>{{if(t.style.display!=='none')alguna=true;}});
    s.style.display=alguna?'':'none';
  }});
  const vacio=document.getElementById('vacio');
  if(vacio)vacio.hidden=visibles>0;
}}
const fab=document.getElementById('fab'),contador=document.getElementById('contador');
function guardar(){{localStorage.setItem(CLAVE,JSON.stringify(pedido));}}
function cantidadTotal(){{return Object.values(pedido).reduce((a,b)=>a+b,0);}}
function refrescarFab(){{const n=cantidadTotal();fab.hidden=n===0;contador.textContent=n;}}
function stockDe(id){{const p=CATALOGO.find(x=>x.id===id);return (p&&p.stock!==null&&p.stock!==undefined)?p.stock:null;}}
function agregar(id){{
  const st=stockDe(id);
  if(st!==null&&(pedido[id]||0)>=st)return;
  pedido[id]=(pedido[id]||0)+1;guardar();refrescarFab();
  fab.animate([{{transform:'scale(1)'}},{{transform:'scale(1.06)'}},{{transform:'scale(1)'}}],{{duration:180}});
}}
function cambiar(id,delta){{
  const st=stockDe(id);
  if(delta>0&&st!==null&&(pedido[id]||0)>=st)return;
  pedido[id]=(pedido[id]||0)+delta;
  if(pedido[id]<=0)delete pedido[id];
  guardar();refrescarFab();dibujarSheet();
}}
function entregaSel(){{
  const r=document.querySelector('input[name="entrega"]:checked');
  if(r)return r.value;
  return CFG.entrega.length?CFG.entrega[0][0]:'';
}}
function pagoSel(){{
  const r=document.querySelector('input[name="pago"]:checked');
  if(r)return r.value;
  return CFG.pago.length?CFG.pago[0][0]:'';
}}
function totalCentavos(){{
  let s=Object.entries(pedido).reduce((a,[id,c])=>{{
    const p=CATALOGO.find(x=>x.id===id);return p?a+c*p.precio_centavos:a;}},0);
  if(entregaSel()==='domicilio')s+=CFG.envio;
  return s;
}}
function dibujarSheet(){{
  const cont=document.getElementById('lineas');
  const ids=Object.keys(pedido);
  if(!ids.length){{cont.innerHTML='<p class="vacio">Tu pedido está vacío.</p>';}}
  else{{
    cont.innerHTML=ids.map(id=>{{
      const p=CATALOGO.find(x=>x.id===id);if(!p)return '';
      const c=pedido[id];
      return `<div class="linea"><div class="nom">${{escapeHtml(p.nombre)}}`+
        `<div class="sub">${{fmt(p.precio_centavos)}} c/u</div></div>`+
        `<div class="qty"><button onclick="cambiar('${{id}}',-1)">−</button><span>${{c}}</span>`+
        `<button onclick="cambiar('${{id}}',1)">＋</button></div>`+
        `<div class="sub">${{fmt(c*p.precio_centavos)}}</div></div>`;
    }}).join('');
    if(entregaSel()==='domicilio'&&CFG.envio>0){{
      cont.innerHTML+=`<div class="linea"><div class="nom">Envío a domicilio</div>`+
        `<div class="sub">${{fmt(CFG.envio)}}</div></div>`;
    }}
  }}
  document.getElementById('total').textContent=fmt(totalCentavos());
}}
function abrirPedido(){{dibujarSheet();document.getElementById('velo').hidden=false;document.body.style.overflow='hidden';}}
function cerrarPedido(){{document.getElementById('velo').hidden=true;document.body.style.overflow='';}}
function enviarPedido(){{
  const ids=Object.keys(pedido);if(!ids.length)return;
  // Formato EXACTO espejo de tienda_utils.construir_texto_pedido.
  const lineas=ids.map(id=>{{
    const p=CATALOGO.find(x=>x.id===id);const c=pedido[id];
    return `• ${{c}} × ${{p.nombre}} — ${{fmt(c*p.precio_centavos)}}`;}});
  let txt=`Hola ${{NEGOCIO}}, quiero hacer un pedido:\\n\\n`+lineas.join('\\n');
  const ev=entregaSel(),pv=pagoSel();
  const eet=CFG.entrega.find(o=>o[0]===ev),pet=CFG.pago.find(o=>o[0]===pv);
  const envioAplica=(ev==='domicilio'&&CFG.envio>0);
  if(eet){{
    txt+=`\\n\\nEntrega: ${{eet[1]}}`+(envioAplica?` (+${{fmt(CFG.envio)}} de envío)`:'');
    if(pet)txt+=`\\nPago: ${{pet[1]}}`;
  }}else if(pet){{
    txt+=`\\n\\nPago: ${{pet[1]}}`;
  }}
  txt+=`\\n\\nTotal: ${{fmt(totalCentavos())}}`;
  const nom=document.getElementById('nombreCliente').value.trim();
  const notas=document.getElementById('notas').value.trim();
  if(nom)txt+=`\\n\\nNombre: ${{nom}}`;
  if(notas)txt+=`\\nNotas: ${{notas}}`;
  window.open(`https://wa.me/${{WA}}?text=${{encodeURIComponent(txt)}}`,'_blank');
  if(pv==='linea'&&CFG.linkPago)window.open(CFG.linkPago,'_blank');
}}
document.querySelectorAll('.item-busqueda').forEach(t=>{{
  t.addEventListener('click',()=>{{ if(WA&&!t.dataset.agotado) agregar(t.dataset.id); }});
}});
if(WA){{refrescarFab();}}
</script>"""


def _productos_para_js(cfg: dict, productos: list) -> list:
    salida = []
    for p in productos:
        salida.append({
            "id": str(p.get("producto_id") or ""),
            "nombre": str(p.get("nombre") or "Producto"),
            "precio_centavos": int(p.get("precio_centavos") or 0),
            "departamento": str(p.get("departamento") or "").strip(),
            "stock": _stock_de(p),
        })
    return salida


def _fab_html() -> str:
    return ('<button class="fab" id="fab" hidden onclick="abrirPedido()">'
            "Pedir por WhatsApp "
            '<span class="contador" id="contador">0</span></button>')


def _acento_rgba(acento: str):
    r = int(acento[1:3], 16)
    g = int(acento[3:5], 16)
    b = int(acento[5:7], 16)
    return f"rgba({r},{g},{b},.16)", f"rgba({r},{g},{b},.45)"


def _css_acento(cfg: dict) -> str:
    suave, sombra = _acento_rgba(cfg["color_acento"])
    return (f"\n:root{{--acento:{cfg['color_acento']};--acento-suave:{suave};"
            f"--acento-sombra:{sombra}}}\n")


# ==========================================================================
# CSS base compartido (componentes comunes: sheet, FAB, banner, Visítanos,
# sociales, badges, footer) — los temas añaden sus variables y su layout.
# ==========================================================================
_CSS_COMPONENTES = """
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;background:var(--fondo);color:var(--texto);min-height:100vh;padding-bottom:110px}
.contenedor{max-width:960px;margin:0 auto;padding:0 16px}
.banner-hero{width:100%;max-height:340px;overflow:hidden}
.banner-hero img{width:100%;height:100%;max-height:340px;object-fit:cover;display:block}
.badge-stock{font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:var(--chip-fondo);color:var(--chip-texto);padding:3px 8px;border-radius:999px;white-space:nowrap}
.badge-stock.agotado{background:#fee2e2;color:#b91c1c}
.item-busqueda.agotada{opacity:.55;cursor:not-allowed}
.fab{position:fixed;left:16px;right:16px;bottom:16px;max-width:560px;margin:0 auto;display:flex;align-items:center;justify-content:center;gap:10px;background:var(--acento);color:var(--acento-texto);border:none;border-radius:999px;padding:16px 24px;font-size:1rem;font-weight:800;box-shadow:0 8px 24px var(--acento-sombra);cursor:pointer;z-index:40}
.fab .contador{background:rgba(255,255,255,.28);border-radius:999px;padding:2px 10px;font-size:.85rem;font-weight:800}
.fab[hidden]{display:none}
.velo{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:50;display:flex;align-items:flex-end;justify-content:center}
.velo[hidden]{display:none}
.sheet{background:var(--tarjeta);width:100%;max-width:560px;max-height:86vh;border-radius:22px 22px 0 0;padding:20px 20px 26px;overflow-y:auto;display:flex;flex-direction:column;gap:14px}
.sheet h2{font-size:1.15rem;font-weight:800;color:var(--titulo)}
.linea{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--borde)}
.linea .nom{flex:1;font-weight:600;font-size:.92rem;color:var(--titulo)}
.linea .sub{font-size:.85rem;color:var(--texto-suave)}
.qty{display:flex;align-items:center;gap:10px}
.qty button{width:34px;height:34px;border-radius:50%;border:1px solid var(--borde);background:var(--campo);color:var(--texto);font-size:1.1rem;font-weight:800;cursor:pointer}
.qty span{min-width:22px;text-align:center;font-weight:800}
.bloque-opciones h3{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--texto-suave);margin-bottom:8px}
.opcion{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--borde);border-radius:var(--radio);margin-bottom:8px;cursor:pointer;font-size:.92rem;font-weight:600;color:var(--titulo)}
.opcion input{accent-color:var(--acento);width:18px;height:18px}
.opcion-fija{font-size:.9rem;color:var(--texto-suave)}
.total{display:flex;justify-content:space-between;align-items:center;font-size:1.15rem;font-weight:800;padding-top:6px;color:var(--titulo)}
.total .monto{color:var(--acento)}
.sheet input[type=text],.sheet textarea{width:100%;padding:12px 14px;font-size:.95rem;border-radius:var(--radio);border:1px solid var(--borde);background:var(--campo);color:var(--texto);outline:none;font-family:inherit}
.sheet textarea{resize:vertical;min-height:64px}
.btn-enviar{background:var(--acento);color:var(--acento-texto);border:none;border-radius:999px;padding:15px;font-size:1rem;font-weight:800;cursor:pointer}
.btn-cerrar{background:none;border:none;color:var(--texto-suave);font-size:.9rem;font-weight:600;cursor:pointer;padding:6px}
.vacio{text-align:center;color:var(--texto-suave);padding:14px 0;font-size:.92rem}
.visitanos{margin-top:36px;background:var(--tarjeta);border:1px solid var(--borde);border-radius:var(--radio);padding:20px;box-shadow:var(--sombra)}
.visitanos-titulo{font-size:1.05rem;font-weight:800;color:var(--titulo);margin-bottom:10px}
.visita-linea{font-size:.9rem;color:var(--texto-suave);line-height:1.55;margin-bottom:8px}
.visita-linea strong{color:var(--titulo)}
.sociales{display:flex;gap:14px;justify-content:center;margin-top:22px}
.social{width:42px;height:42px;display:flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid var(--borde);background:var(--tarjeta);color:var(--acento);transition:transform .15s ease}
.social:active{transform:scale(.92)}
.social svg{width:22px;height:22px}
footer{margin-top:44px;border-top:1px solid var(--borde);padding:26px 0 10px;text-align:center;color:var(--texto-suave);font-size:.82rem}
.webmaster{margin:14px auto 0;max-width:420px;background:var(--tarjeta);border:1px solid var(--borde);border-radius:var(--radio);padding:16px;box-shadow:var(--sombra)}
.webmaster p{font-size:.88rem;color:var(--titulo);font-weight:600;margin-bottom:10px;line-height:1.4}
.webmaster a{display:inline-block;background:var(--acento);color:var(--acento-texto);text-decoration:none;font-weight:700;font-size:.85rem;padding:10px 18px;border-radius:999px}
.marca{margin-top:16px;opacity:.75}
"""

# ==========================================================================
# Plantillas CLÁSICAS (aurora / noche / mercado) — layout de rejilla v1.
# El tema solo cambia variables; la estructura es la de siempre.
# ==========================================================================
_CSS_CLASICO = """
header{background:var(--cabecera);border-bottom:1px solid var(--borde);padding:28px 0 22px}
header .contenedor{display:flex;flex-direction:column;gap:6px}
h1{font-size:1.7rem;font-weight:800;letter-spacing:-.02em;color:var(--titulo)}
.bienvenida{color:var(--texto-suave);font-size:.98rem;line-height:1.45}
.buscador{margin-top:14px}
.buscador input{width:100%;padding:13px 16px;font-size:1rem;border-radius:var(--radio);border:1px solid var(--borde);background:var(--campo);color:var(--texto);outline:none}
.buscador input:focus{border-color:var(--acento);box-shadow:0 0 0 3px var(--acento-suave)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;margin-top:22px}
.tarjeta{background:var(--tarjeta);border:1px solid var(--borde);border-radius:var(--radio);overflow:hidden;box-shadow:var(--sombra);transition:transform .15s ease,box-shadow .15s ease;display:flex;flex-direction:column}
.tarjeta:active{transform:scale(.975)}
.foto{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;background:var(--foto-fondo)}
.foto-vacia{width:100%;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;background:var(--foto-fondo);color:var(--acento);font-size:2.6rem;font-weight:800}
.cuerpo{padding:12px 12px 14px;display:flex;flex-direction:column;gap:6px;flex:1}
.nombre{font-weight:700;font-size:.95rem;line-height:1.3;color:var(--titulo)}
.descripcion{font-size:.8rem;color:var(--texto-suave);line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pie-tarjeta{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:4px}
.precio{font-weight:800;font-size:1.02rem;color:var(--acento)}
.chip{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;background:var(--chip-fondo);color:var(--chip-texto);padding:4px 9px;border-radius:999px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:55%}
.agregar{font-size:.78rem;font-weight:700;color:var(--acento)}
.sin-resultados{grid-column:1/-1;text-align:center;color:var(--texto-suave);padding:40px 0;font-size:.95rem}
@media(min-width:700px){.grid{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}}
"""

_TEMAS_CLASICOS = {
    # Clara, aireada, tarjetas con sombra suave.
    "aurora": """
:root{--fondo:#f6f7fb;--cabecera:#ffffff;--tarjeta:#ffffff;--campo:#f2f3f7;
--texto:#1c2030;--titulo:#141828;--texto-suave:#6b7280;--borde:#e8eaf1;
--chip-fondo:#eef1f7;--chip-texto:#55607a;--foto-fondo:#eceef4;
--sombra:0 2px 10px rgba(28,32,48,.06);--radio:16px;--acento-texto:#ffffff}
""",
    # Oscura premium, alto contraste, acento brillante.
    "noche": """
:root{--fondo:#0d0f16;--cabecera:#12141d;--tarjeta:#171a26;--campo:#1e2233;
--texto:#e8eaf2;--titulo:#ffffff;--texto-suave:#9aa0b4;--borde:#262b3d;
--chip-fondo:#232840;--chip-texto:#aeb6d4;--foto-fondo:#1d2130;
--sombra:0 4px 18px rgba(0,0,0,.45);--radio:14px;--acento-texto:#0d0f16}
""",
    # Cálida tipo mercado/tiendita, bordes redondeados generosos.
    "mercado": """
:root{--fondo:#fdf6ec;--cabecera:#fffaf2;--tarjeta:#fffdf8;--campo:#faf1e2;
--texto:#3f2f23;--titulo:#2e2118;--texto-suave:#8a7360;--borde:#f0e2cf;
--chip-fondo:#f7e8d4;--chip-texto:#8a5a2e;--foto-fondo:#f6ead8;
--sombra:0 3px 12px rgba(94,64,32,.10);--radio:22px;--acento-texto:#ffffff}
""",
}

_NOMBRES_PLANTILLA = {
    "aurora": "Aurora",
    "noche": "Noche",
    "mercado": "Mercado",
    "boutique": "Boutique",
    "menu": "Menú",
    "catalogo": "Catálogo",
}


def _head_html(cfg: dict) -> str:
    bienvenida = cfg["mensaje_bienvenida"]
    return f"""<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{_esc(cfg["nombre_negocio"])} — pedidos en línea</title>
<meta name="description" content="Catálogo y pedidos de {_esc(cfg["nombre_negocio"])}. {_esc(bienvenida[:120])}">
"""


def _render_clasico(config: dict, productos: list, plantilla: str) -> str:
    """HTML completo de la tienda (rejilla v1). Función pura."""
    cfg = _config_normalizada(config)
    visibles = _productos_visibles(cfg, productos)

    tarjetas = []
    for p in visibles:
        pid = str(p.get("producto_id") or "")
        pnombre = str(p.get("nombre") or "Producto")
        desc = str(p.get("descripcion") or "").strip()
        precio = int(p.get("precio_centavos") or 0)
        depto = str(p.get("departamento") or "").strip()
        foto = str(p.get("foto_url") or "").strip()
        agotado = _agotado(p, cfg)
        if foto:
            img = f'<img class="foto" src="{_esc(foto)}" alt="{_esc(pnombre)}" loading="lazy">'
        else:
            inicial = _esc((pnombre.strip() or "?")[0].upper())
            img = f'<div class="foto-vacia" aria-hidden="true">{inicial}</div>'
        chip = f'<span class="chip">{_esc(depto)}</span>' if depto else ""
        desc_html = f'<p class="descripcion">{_esc(desc)}</p>' if desc else ""
        badge = _badge_stock_html(p, cfg)
        agregar = '<span class="agregar">＋ Agregar</span>' if cfg["whatsapp"] and not agotado else ""
        tarjetas.append(
            f'<article class="tarjeta item-busqueda{" agotada" if agotado else ""}" data-id="{_esc(pid)}" '
            f'data-nombre="{_esc(pnombre.lower())}" data-depto="{_esc(depto.lower())}"'
            f'{" data-agotado=1" if agotado else ""}>'
            f"{img}<div class=\"cuerpo\">"
            f'<h3 class="nombre">{_esc(pnombre)}</h3>{desc_html}{badge}'
            f'<div class="pie-tarjeta"><span class="precio">{formato_precio(precio)}</span>'
            f"{chip}</div>{agregar}</div></article>"
        )

    bienvenida_html = (f'<p class="bienvenida">{_esc(cfg["mensaje_bienvenida"])}</p>'
                       if cfg["mensaje_bienvenida"] else "")
    fab_html = _fab_html() if cfg["whatsapp"] else ""
    sheet_html = _sheet_html(cfg) if cfg["whatsapp"] else ""

    css = (_TEMAS_CLASICOS[plantilla] + _CSS_COMPONENTES + _CSS_CLASICO + _css_acento(cfg))

    return f"""<!DOCTYPE html>
<html lang="es">
{_head_html(cfg)}
<style>{css}</style>
</head>
<body>
{_banner_html(cfg)}
<header>
  <div class="contenedor">
    <h1>{_esc(cfg["nombre_negocio"])}</h1>
    {bienvenida_html}
    <div class="buscador">
      <input id="busqueda" type="search" placeholder="Buscar producto…" oninput="filtrar()">
    </div>
  </div>
</header>
<main class="contenedor">
  <section class="grid" id="grid">
    {''.join(tarjetas) if tarjetas else '<p class="sin-resultados">Esta tienda aún no tiene productos publicados.</p>'}
    <p class="sin-resultados" id="vacio" hidden>No encontramos productos con esa búsqueda.</p>
  </section>
  {_visitanos_html(cfg)}
  {_sociales_html(cfg)}
</main>
{fab_html}
{sheet_html}
{_footer_html(cfg)}
{_js_tienda(cfg, _productos_para_js(cfg, visibles))}
</body>
</html>"""


def plantilla_aurora(config: dict, productos: list) -> str:
    return _render_clasico(config, productos, "aurora")


def plantilla_noche(config: dict, productos: list) -> str:
    return _render_clasico(config, productos, "noche")


def plantilla_mercado(config: dict, productos: list) -> str:
    return _render_clasico(config, productos, "mercado")


# ==========================================================================
# Plantilla BOUTIQUE (ropa, belleza, mascotas) — editorial, foto protagonista:
# encabezado centrado elegante, tarjetas grandes a 2 columnas, poco texto,
# zoom sutil al pasar/pulsar.
# ==========================================================================
_CSS_BOUTIQUE = """
:root{--fondo:#faf8f5;--cabecera:#faf8f5;--tarjeta:#ffffff;--campo:#f4f1ec;
--texto:#2a2622;--titulo:#1d1a17;--texto-suave:#8d857c;--borde:#eae4dc;
--chip-fondo:#f1ece5;--chip-texto:#7a6f63;--foto-fondo:#efeae3;
--sombra:0 2px 14px rgba(60,50,40,.07);--radio:4px;--acento-texto:#ffffff}
body{padding-bottom:110px}
header.boutique{background:var(--cabecera);border-bottom:none;padding:44px 0 10px;text-align:center}
header.boutique .contenedor{display:flex;flex-direction:column;align-items:center;gap:8px}
header.boutique h1{font-family:Georgia,'Times New Roman',serif;font-size:2.1rem;font-weight:400;letter-spacing:.14em;text-transform:uppercase;color:var(--titulo)}
header.boutique .bienvenida{font-family:Georgia,serif;font-style:italic;color:var(--texto-suave);font-size:1rem;max-width:520px;line-height:1.6}
header.boutique .buscador{margin-top:18px;width:100%;max-width:420px}
.buscador input{width:100%;padding:12px 16px;font-size:.95rem;border-radius:999px;border:1px solid var(--borde);background:var(--campo);color:var(--texto);outline:none;text-align:center}
.buscador input:focus{border-color:var(--acento);box-shadow:0 0 0 3px var(--acento-suave)}
.grid-boutique{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-top:28px}
@media(min-width:760px){.grid-boutique{gap:24px}}
.tarjeta-b{display:flex;flex-direction:column;cursor:pointer}
.marco-foto{overflow:hidden;border-radius:var(--radio);background:var(--foto-fondo)}
.tarjeta-b .foto{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;transition:transform .45s ease}
.tarjeta-b .foto-vacia{width:100%;aspect-ratio:3/4;display:flex;align-items:center;justify-content:center;color:var(--acento);font-family:Georgia,serif;font-size:3rem}
@media(hover:hover){.tarjeta-b:hover .foto{transform:scale(1.05)}}
.tarjeta-b:active .foto{transform:scale(1.03)}
.cuerpo-b{padding:10px 2px 0;text-align:center}
.nombre-b{font-family:Georgia,serif;font-weight:400;font-size:.95rem;color:var(--titulo);line-height:1.35}
.precio-b{margin-top:4px;font-size:.9rem;font-weight:700;color:var(--acento);letter-spacing:.02em}
.tarjeta-b .badge-stock{margin-top:6px;display:inline-block}
.sin-resultados{grid-column:1/-1;text-align:center;color:var(--texto-suave);padding:40px 0;font-size:.95rem}
.visitanos{border-radius:var(--radio)}
"""


def plantilla_boutique(config: dict, productos: list) -> str:
    """Editorial: foto protagonista a 2 columnas, encabezado centrado."""
    cfg = _config_normalizada(config)
    visibles = _productos_visibles(cfg, productos)

    tarjetas = []
    for p in visibles:
        pid = str(p.get("producto_id") or "")
        pnombre = str(p.get("nombre") or "Producto")
        precio = int(p.get("precio_centavos") or 0)
        depto = str(p.get("departamento") or "").strip()
        foto = str(p.get("foto_url") or "").strip()
        agotado = _agotado(p, cfg)
        if foto:
            img = f'<img class="foto" src="{_esc(foto)}" alt="{_esc(pnombre)}" loading="lazy">'
        else:
            inicial = _esc((pnombre.strip() or "?")[0].upper())
            img = f'<div class="foto-vacia" aria-hidden="true">{inicial}</div>'
        badge = _badge_stock_html(p, cfg)
        tarjetas.append(
            f'<article class="tarjeta-b item-busqueda{" agotada" if agotado else ""}" '
            f'data-id="{_esc(pid)}" data-nombre="{_esc(pnombre.lower())}" '
            f'data-depto="{_esc(depto.lower())}"{" data-agotado=1" if agotado else ""}>'
            f'<div class="marco-foto">{img}</div>'
            f'<div class="cuerpo-b"><h3 class="nombre-b">{_esc(pnombre)}</h3>'
            f'<p class="precio-b">{formato_precio(precio)}</p>{badge}</div></article>'
        )

    bienvenida_html = (f'<p class="bienvenida">{_esc(cfg["mensaje_bienvenida"])}</p>'
                       if cfg["mensaje_bienvenida"] else "")
    fab_html = _fab_html() if cfg["whatsapp"] else ""
    sheet_html = _sheet_html(cfg) if cfg["whatsapp"] else ""

    return f"""<!DOCTYPE html>
<html lang="es">
{_head_html(cfg)}
<style>{_CSS_COMPONENTES + _CSS_BOUTIQUE + _css_acento(cfg)}</style>
</head>
<body>
{_banner_html(cfg)}
<header class="boutique">
  <div class="contenedor">
    <h1>{_esc(cfg["nombre_negocio"])}</h1>
    {bienvenida_html}
    <div class="buscador">
      <input id="busqueda" type="search" placeholder="Buscar en la colección…" oninput="filtrar()">
    </div>
  </div>
</header>
<main class="contenedor">
  <section class="grid-boutique" id="grid">
    {''.join(tarjetas) if tarjetas else '<p class="sin-resultados">Esta tienda aún no tiene productos publicados.</p>'}
    <p class="sin-resultados" id="vacio" hidden>No encontramos productos con esa búsqueda.</p>
  </section>
  {_visitanos_html(cfg)}
  {_sociales_html(cfg)}
</main>
{fab_html}
{sheet_html}
{_footer_html(cfg)}
{_js_tienda(cfg, _productos_para_js(cfg, visibles))}
</body>
</html>"""


# ==========================================================================
# Plantilla MENÚ (cafetería, restaurante) — carta por SECCIONES de
# departamento: encabezados de sección y filas nombre····precio, con foto
# chica opcional a la izquierda.
# ==========================================================================
_CSS_MENU = """
:root{--fondo:#fbf7f1;--cabecera:#fbf7f1;--tarjeta:#ffffff;--campo:#f6f0e7;
--texto:#33302b;--titulo:#221f1a;--texto-suave:#8a8175;--borde:#ece4d6;
--chip-fondo:#f3ebdd;--chip-texto:#8a6d3f;--foto-fondo:#f1e9dc;
--sombra:0 2px 10px rgba(90,70,40,.07);--radio:12px;--acento-texto:#ffffff}
header.menu{background:var(--cabecera);border-bottom:1px solid var(--borde);padding:30px 0 18px;text-align:center}
header.menu h1{font-family:Georgia,'Times New Roman',serif;font-size:1.9rem;font-weight:700;letter-spacing:.02em;color:var(--titulo)}
header.menu .bienvenida{color:var(--texto-suave);font-size:.95rem;margin-top:6px;font-style:italic}
header.menu .buscador{margin:16px auto 0;max-width:440px}
.buscador input{width:100%;padding:12px 16px;font-size:.95rem;border-radius:999px;border:1px solid var(--borde);background:var(--campo);color:var(--texto);outline:none;text-align:center}
.buscador input:focus{border-color:var(--acento);box-shadow:0 0 0 3px var(--acento-suave)}
.carta{max-width:640px;margin:0 auto}
.seccion-depto{margin-top:30px}
.titulo-seccion{font-family:Georgia,serif;font-size:1.25rem;font-weight:700;color:var(--titulo);text-align:center;letter-spacing:.06em;text-transform:uppercase}
.regla-seccion{width:56px;height:2px;background:var(--acento);margin:8px auto 14px;border-radius:2px}
.fila-menu{display:flex;align-items:center;gap:12px;padding:10px 4px;cursor:pointer;border-radius:8px}
.fila-menu:active{background:var(--campo)}
.foto-menu{width:56px;height:56px;flex:none;border-radius:10px;object-fit:cover;background:var(--foto-fondo)}
.foto-menu-vacia{width:56px;height:56px;flex:none;border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--foto-fondo);color:var(--acento);font-family:Georgia,serif;font-size:1.4rem}
.cuerpo-menu{flex:1;min-width:0}
.linea-precio{display:flex;align-items:baseline;gap:8px}
.nombre-menu{font-weight:700;font-size:.98rem;color:var(--titulo);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.puntos{flex:1;border-bottom:2px dotted var(--borde);transform:translateY(-3px)}
.precio-menu{font-weight:800;font-size:.98rem;color:var(--acento);white-space:nowrap}
.descripcion-menu{font-size:.8rem;color:var(--texto-suave);line-height:1.4;margin-top:2px}
.fila-menu .badge-stock{margin-left:8px}
.sin-resultados{text-align:center;color:var(--texto-suave);padding:40px 0;font-size:.95rem}
"""


def plantilla_menu(config: dict, productos: list) -> str:
    """Carta: filas nombre····precio agrupadas por sección de departamento."""
    cfg = _config_normalizada(config)
    visibles = _productos_visibles(cfg, productos)

    # Agrupar por departamento conservando el orden de aparición.
    secciones: dict[str, list] = {}
    for p in visibles:
        depto = str(p.get("departamento") or "").strip() or "Menú"
        secciones.setdefault(depto, []).append(p)

    bloques = []
    for depto, items in secciones.items():
        filas = []
        for p in items:
            pid = str(p.get("producto_id") or "")
            pnombre = str(p.get("nombre") or "Producto")
            desc = str(p.get("descripcion") or "").strip()
            precio = int(p.get("precio_centavos") or 0)
            foto = str(p.get("foto_url") or "").strip()
            agotado = _agotado(p, cfg)
            if foto:
                img = f'<img class="foto-menu" src="{_esc(foto)}" alt="{_esc(pnombre)}" loading="lazy">'
            else:
                inicial = _esc((pnombre.strip() or "?")[0].upper())
                img = f'<div class="foto-menu-vacia" aria-hidden="true">{inicial}</div>'
            desc_html = f'<p class="descripcion-menu">{_esc(desc)}</p>' if desc else ""
            badge = _badge_stock_html(p, cfg)
            filas.append(
                f'<div class="fila-menu item-busqueda{" agotada" if agotado else ""}" '
                f'data-id="{_esc(pid)}" data-nombre="{_esc(pnombre.lower())}" '
                f'data-depto="{_esc(depto.lower())}"{" data-agotado=1" if agotado else ""}>'
                f"{img}"
                f'<div class="cuerpo-menu"><div class="linea-precio">'
                f'<span class="nombre-menu">{_esc(pnombre)}</span>'
                f'<span class="puntos"></span>'
                f'<span class="precio-menu">{formato_precio(precio)}</span></div>'
                f"{desc_html}{badge}</div></div>"
            )
        bloques.append(
            f'<section class="seccion-depto"><h2 class="titulo-seccion">{_esc(depto)}</h2>'
            f'<div class="regla-seccion"></div>{"".join(filas)}</section>'
        )

    bienvenida_html = (f'<p class="bienvenida">{_esc(cfg["mensaje_bienvenida"])}</p>'
                       if cfg["mensaje_bienvenida"] else "")
    fab_html = _fab_html() if cfg["whatsapp"] else ""
    sheet_html = _sheet_html(cfg) if cfg["whatsapp"] else ""

    return f"""<!DOCTYPE html>
<html lang="es">
{_head_html(cfg)}
<style>{_CSS_COMPONENTES + _CSS_MENU + _css_acento(cfg)}</style>
</head>
<body>
{_banner_html(cfg)}
<header class="menu">
  <div class="contenedor">
    <h1>{_esc(cfg["nombre_negocio"])}</h1>
    {bienvenida_html}
    <div class="buscador">
      <input id="busqueda" type="search" placeholder="Buscar en el menú…" oninput="filtrar()">
    </div>
  </div>
</header>
<main class="contenedor">
  <div class="carta" id="grid">
    {''.join(bloques) if bloques else '<p class="sin-resultados">Esta tienda aún no tiene productos publicados.</p>'}
    <p class="sin-resultados" id="vacio" hidden>No encontramos productos con esa búsqueda.</p>
  </div>
  {_visitanos_html(cfg)}
  {_sociales_html(cfg)}
</main>
{fab_html}
{sheet_html}
{_footer_html(cfg)}
{_js_tienda(cfg, _productos_para_js(cfg, visibles))}
</body>
</html>"""


# ==========================================================================
# Plantilla CATÁLOGO (abarrotes, farmacia, ferretería, electrónica, otro) —
# grid denso 3-4 columnas en pantallas anchas, buscador prominente y chips
# de departamento como filtros, con badge de stock.
# ==========================================================================
_CSS_CATALOGO = """
:root{--fondo:#f3f5f8;--cabecera:#ffffff;--tarjeta:#ffffff;--campo:#eef1f5;
--texto:#1f2733;--titulo:#131a24;--texto-suave:#68758a;--borde:#e3e8ef;
--chip-fondo:#e9eef5;--chip-texto:#4b5b73;--foto-fondo:#e9edf3;
--sombra:0 1px 6px rgba(25,35,55,.07);--radio:10px;--acento-texto:#ffffff}
header.catalogo{background:var(--cabecera);border-bottom:1px solid var(--borde);padding:22px 0 16px;position:sticky;top:0;z-index:30}
header.catalogo .contenedor{display:flex;flex-direction:column;gap:10px}
header.catalogo h1{font-size:1.35rem;font-weight:800;color:var(--titulo)}
header.catalogo .bienvenida{color:var(--texto-suave);font-size:.88rem}
.buscador input{width:100%;padding:14px 18px;font-size:1.05rem;border-radius:999px;border:2px solid var(--borde);background:var(--campo);color:var(--texto);outline:none}
.buscador input:focus{border-color:var(--acento);box-shadow:0 0 0 3px var(--acento-suave)}
.chips-filtros{display:flex;gap:8px;overflow-x:auto;padding:4px 0 2px;-webkit-overflow-scrolling:touch}
.chip-filtro{flex:none;border:1px solid var(--borde);background:var(--chip-fondo);color:var(--chip-texto);font-size:.78rem;font-weight:700;padding:7px 14px;border-radius:999px;cursor:pointer;white-space:nowrap}
.chip-filtro.activo{background:var(--acento);border-color:var(--acento);color:var(--acento-texto)}
.grid-c{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:16px}
@media(min-width:560px){.grid-c{grid-template-columns:repeat(3,1fr)}}
@media(min-width:860px){.grid-c{grid-template-columns:repeat(4,1fr);gap:14px}}
.tarjeta-c{background:var(--tarjeta);border:1px solid var(--borde);border-radius:var(--radio);overflow:hidden;box-shadow:var(--sombra);display:flex;flex-direction:column;cursor:pointer;transition:transform .12s ease}
.tarjeta-c:active{transform:scale(.97)}
.tarjeta-c .foto{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;background:var(--foto-fondo)}
.tarjeta-c .foto-vacia{width:100%;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;background:var(--foto-fondo);color:var(--acento);font-size:2rem;font-weight:800}
.cuerpo-c{padding:8px 10px 10px;display:flex;flex-direction:column;gap:4px;flex:1}
.nombre-c{font-weight:700;font-size:.82rem;line-height:1.25;color:var(--titulo)}
.precio-c{margin-top:auto;font-weight:800;font-size:.92rem;color:var(--acento)}
.sin-resultados{grid-column:1/-1;text-align:center;color:var(--texto-suave);padding:40px 0;font-size:.95rem}
"""


def plantilla_catalogo(config: dict, productos: list) -> str:
    """Grid denso con buscador prominente y chips de departamento."""
    cfg = _config_normalizada(config)
    visibles = _productos_visibles(cfg, productos)

    departamentos = []
    for p in visibles:
        depto = str(p.get("departamento") or "").strip()
        if depto and depto not in departamentos:
            departamentos.append(depto)
    chips_html = ""
    if departamentos:
        chips = "".join(
            f'<button class="chip-filtro" data-depto="{_esc(d.lower())}" '
            f'onclick="filtrarChip(\'{_esc(d.lower())}\')">{_esc(d)}</button>'
            for d in departamentos)
        chips_html = f'<div class="chips-filtros">{chips}</div>'

    tarjetas = []
    for p in visibles:
        pid = str(p.get("producto_id") or "")
        pnombre = str(p.get("nombre") or "Producto")
        precio = int(p.get("precio_centavos") or 0)
        depto = str(p.get("departamento") or "").strip()
        foto = str(p.get("foto_url") or "").strip()
        agotado = _agotado(p, cfg)
        if foto:
            img = f'<img class="foto" src="{_esc(foto)}" alt="{_esc(pnombre)}" loading="lazy">'
        else:
            inicial = _esc((pnombre.strip() or "?")[0].upper())
            img = f'<div class="foto-vacia" aria-hidden="true">{inicial}</div>'
        badge = _badge_stock_html(p, cfg)
        tarjetas.append(
            f'<article class="tarjeta-c item-busqueda{" agotada" if agotado else ""}" '
            f'data-id="{_esc(pid)}" data-nombre="{_esc(pnombre.lower())}" '
            f'data-depto="{_esc(depto.lower())}"{" data-agotado=1" if agotado else ""}>'
            f"{img}"
            f'<div class="cuerpo-c"><h3 class="nombre-c">{_esc(pnombre)}</h3>'
            f'<span class="precio-c">{formato_precio(precio)}</span>{badge}</div></article>'
        )

    bienvenida_html = (f'<p class="bienvenida">{_esc(cfg["mensaje_bienvenida"])}</p>'
                       if cfg["mensaje_bienvenida"] else "")
    fab_html = _fab_html() if cfg["whatsapp"] else ""
    sheet_html = _sheet_html(cfg) if cfg["whatsapp"] else ""

    return f"""<!DOCTYPE html>
<html lang="es">
{_head_html(cfg)}
<style>{_CSS_COMPONENTES + _CSS_CATALOGO + _css_acento(cfg)}</style>
</head>
<body>
{_banner_html(cfg)}
<header class="catalogo">
  <div class="contenedor">
    <h1>{_esc(cfg["nombre_negocio"])}</h1>
    {bienvenida_html}
    <div class="buscador">
      <input id="busqueda" type="search" placeholder="Buscar en el catálogo…" oninput="filtrar()">
    </div>
    {chips_html}
  </div>
</header>
<main class="contenedor">
  <section class="grid-c" id="grid">
    {''.join(tarjetas) if tarjetas else '<p class="sin-resultados">Esta tienda aún no tiene productos publicados.</p>'}
    <p class="sin-resultados" id="vacio" hidden>No encontramos productos con esa búsqueda.</p>
  </section>
  {_visitanos_html(cfg)}
  {_sociales_html(cfg)}
</main>
{fab_html}
{sheet_html}
{_footer_html(cfg)}
{_js_tienda(cfg, _productos_para_js(cfg, visibles))}
</body>
</html>"""


PLANTILLAS = {
    "aurora": plantilla_aurora,
    "noche": plantilla_noche,
    "mercado": plantilla_mercado,
    "boutique": plantilla_boutique,
    "menu": plantilla_menu,
    "catalogo": plantilla_catalogo,
}
