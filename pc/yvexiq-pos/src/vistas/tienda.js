// YvexPOS — vista Tienda en línea.
// Configura y publica el escaparate del negocio en {slug}.yvexiq.com usando la
// API de tiendas del VPS (tienda.yvexiq.com). La config vive en `config` local
// (claves tienda_*); al publicar se manda todo al servidor.
//
// Si la caja no está vinculada a la nube, muestra una pantalla amable que
// explica cómo vincularse (nunca un error feo).

import { invoke } from "@tauri-apps/api/core";
import { pesos, centavos, escapar } from "../util/formato.js";
import { icono } from "../util/iconos.js";
import { confirmar } from "../util/confirmar.js";
import { contraste, abrirUrl } from "../util/tienda.js";
import { lineaVida } from "../util/sidebar.js";

const PLANTILLAS = [
  { id: "aurora",   nombre: "Amanecer",  desc: "Cálida y luminosa" },
  { id: "noche",    nombre: "Nocturna",  desc: "Elegante y oscura" },
  { id: "mercado",  nombre: "Mercadito", desc: "Fresca y cercana" },
  { id: "boutique", nombre: "Vitrina",   desc: "Fino y con detalle" },
  { id: "menu",     nombre: "La Carta",  desc: "Para comida y bebida" },
  { id: "catalogo", nombre: "Surtido",   desc: "Mucho producto, bien ordenado" },
];

// Espejo de GIRO_A_PLANTILLA del backend (tienda_utils.py).
const GIRO_A_PLANTILLA = {
  ropa: "boutique", belleza: "boutique", mascotas: "boutique",
  cafeteria: "menu", restaurante: "menu",
  abarrotes: "catalogo", farmacia: "catalogo", ferreteria: "catalogo",
  electronica: "catalogo", otro: "catalogo",
};

const GIROS = [
  { id: "abarrotes",  nombre: "Abarrotes / tienda" },
  { id: "ropa",       nombre: "Ropa y accesorios" },
  { id: "belleza",    nombre: "Belleza y cuidado" },
  { id: "cafeteria",  nombre: "Cafetería" },
  { id: "restaurante", nombre: "Restaurante" },
  { id: "farmacia",   nombre: "Farmacia" },
  { id: "ferreteria", nombre: "Ferretería" },
  { id: "electronica", nombre: "Electrónica" },
  { id: "mascotas",   nombre: "Mascotas" },
  { id: "otro",       nombre: "Otro giro" },
];

const TEMAS = [
  { id: "perla",      nombre: "Perla",      fondo: "#f6f7fb", tinta: "#1c1e26" },
  { id: "medianoche", nombre: "Medianoche", fondo: "#0d0f16", tinta: "#f2f3f7" },
  { id: "arena",      nombre: "Arena",      fondo: "#f7f1e6", tinta: "#2b241a" },
  { id: "cielo",      nombre: "Cielo",      fondo: "#eef4f9", tinta: "#16222e" },
];

const ACENTOS = [
  { id: "#2563eb", nombre: "Azul" },
  { id: "#16a34a", nombre: "Verde" },
  { id: "#e11d48", nombre: "Rosa" },
  { id: "#d97706", nombre: "Ámbar" },
  { id: "#7c3aed", nombre: "Violeta" },
  { id: "#0d9488", nombre: "Jade" },
];

const MAX_BANNER_BYTES = 500 * 1024; // 500 KB

export function montarTienda(contenedor, sesion, volver) {
  contenedor.innerHTML = "";
  contenedor.style.alignItems = "stretch";
  contenedor.style.justifyContent = "flex-start";

  const wrap = document.createElement("div");
  wrap.className = "td";
  contenedor.appendChild(wrap);

  wrap.innerHTML = `
    <header class="td-head">
      <div>
        <h1 class="td-titulo">Tienda en línea</h1>
        <p class="td-sub">Publica tu catálogo en internet y recibe pedidos desde tu propia página.</p>
      </div>
      <button class="btn-sec" id="td-ver" hidden>Ver mi tienda</button>
    </header>
    <div id="td-cuerpo"><div class="estado">Cargando tu tienda…</div></div>
  `;

  const $ = (s) => wrap.querySelector(s);
  const cuerpo = $("#td-cuerpo");

  let cfg = {};        // config local (tienda_*)
  let estadoSrv = null; // respuesta de tienda_estado (puede ser null offline)
  let productos = [];  // catálogo local para publicar
  let bannerBase64 = null; // banner nuevo elegido en esta sesión

  iniciar();

  async function iniciar() {
    try {
      cfg = await invoke("tienda_config_local");
    } catch (e) {
      cfg = {};
    }
    try {
      estadoSrv = await invoke("tienda_estado");
    } catch (e) {
      const msg = String(e);
      if (msg.includes("vinculada")) return pantallaVinculacion();
      estadoSrv = null; // offline: se trabaja con la config local
      avisoOffline(msg);
    }
    try {
      productos = await invoke("tienda_productos_para_publicar", { ids: null });
    } catch (e) {
      productos = [];
    }
    pintar();
  }

  // --------------------------------------------------------- pantallas base

  function pantallaVinculacion() {
    cuerpo.innerHTML = `
      <div class="estado" style="max-width:560px">
        <h2 style="margin:0 0 10px">Primero vincula esta caja con la nube</h2>
        <p>Tu tienda en línea vive en internet, así que esta caja necesita estar
        vinculada a tu cuenta de YvexPOS. Es un paso de un minuto desde
        <strong>Configuración → Conexión con la nube</strong>.</p>
        <p style="margin-top:14px">Cuando esté vinculada, vuelve aquí y tu tienda estará lista para publicarse.</p>
      </div>`;
  }

  function avisoOffline(msg) {
    const div = document.createElement("div");
    div.className = "estado estado--error";
    div.style.marginBottom = "14px";
    div.textContent = "No pudimos hablar con el servidor de la tienda (" + msg +
      "). Puedes dejar todo listo y publicar cuando haya internet.";
    cuerpo.prepend(div);
  }

  // --------------------------------------------------------- vista principal

  function val(clave, defecto = "") {
    // La config del servidor pisa la local cuando existe (la nube es más nueva).
    return cfg[clave] ?? defecto;
  }
  function boolVal(clave, defecto) {
    const v = cfg[clave];
    if (v === undefined || v === "") return defecto;
    return v === "1" || v === "true";
  }

  function pintar() {
    const publicada = estadoSrv && estadoSrv.tiene_tienda && estadoSrv.activa;
    const slugSrv = estadoSrv && estadoSrv.slug ? estadoSrv.slug : "";
    const urlPublica = (publicada && estadoSrv.url_publica) || val("tienda_url_publica");
    const urlPath = (publicada && estadoSrv.url_path) || val("tienda_url_path");

    const giro = (estadoSrv && estadoSrv.giro) || val("tienda_giro");
    const ideal = GIRO_A_PLANTILLA[giro] || null;
    const plantillaSel = (estadoSrv && estadoSrv.plantilla) || val("tienda_plantilla", "aurora");
    const temaSel = (estadoSrv && estadoSrv.tema && estadoSrv.tema !== "auto")
      ? estadoSrv.tema : val("tienda_tema", "perla");
    const acentoSel = (estadoSrv && estadoSrv.color_acento) || val("tienda_acento", "#2563eb");

    let seleccion = [];
    try { seleccion = JSON.parse(val("tienda_productos_ids", "[]")); } catch (e) { seleccion = []; }
    if (!Array.isArray(seleccion) || seleccion.length === 0) {
      seleccion = productos.map((p) => p.producto_id); // default: todos activos
    }
    const selSet = new Set(seleccion);

    $("#td-ver").hidden = !urlPublica;
    $("#td-ver").onclick = () => abrirUrl(urlPublica);

    cuerpo.innerHTML = `
      ${estadoSrv && estadoSrv.tiene_tienda ? `
      <section class="td-seccion con-filo">
        <div class="td-estado ${publicada ? "td-estado--ok" : ""}">
          <div>
            <div class="td-estado-titulo">${publicada ? "Tu tienda está al aire" : "Tu tienda está en pausa"}</div>
            <div class="td-estado-sub">${publicada
              ? `${escapar(estadoSrv.num_productos ?? 0)} productos publicados · ${escapar(estadoSrv.num_pedidos_nuevos ?? 0)} pedidos nuevos`
              : "La página pública está apagada; tus datos siguen guardados."}</div>
          </div>
          <div class="td-estado-acciones">
            ${publicada ? `
              <button class="btn-sec" id="td-copiar">Copiar enlace</button>
              <button class="btn-sec" id="td-abrir">Abrir</button>
              <button class="btn-peligro" id="td-apagar">Desactivar</button>` : ""}
          </div>
        </div>
        ${publicada ? `<div class="td-enlace">${escapar(urlPublica)}</div>` : ""}
      </section>` : ""}

      <section class="td-seccion con-filo">
        <h2 class="td-h2">Tu enlace</h2>
        <p class="td-ayuda">Así se verá la dirección de tu tienda: <strong>{tu-enlace}.yvexiq.com</strong>.
        Solo minúsculas, números y guiones.</p>
        <div class="td-fila">
          <input class="td-input" id="td-slug" maxlength="40" placeholder="mi-negocio"
                 value="${escapar(slugSrv || val("tienda_slug"))}">
          <button class="btn-sec" id="td-verificar">Verificar</button>
        </div>
        <div class="td-msg" id="td-slug-msg"></div>
      </section>

      <section class="td-seccion con-filo">
        <h2 class="td-h2">Diseño</h2>
        <div class="td-label">Plantilla</div>
        <div class="td-plantillas">
          ${PLANTILLAS.map((p) => `
            <button class="td-plantilla ${p.id === plantillaSel ? "td-plantilla--on" : ""}" data-p="${p.id}">
              <b>${escapar(p.nombre)}</b>
              <small>${escapar(p.desc)}</small>
              ${p.id === ideal ? `<span class="td-ideal">Ideal para tu giro</span>` : ""}
            </button>`).join("")}
        </div>
        <div class="td-label">Tema de fondo</div>
        <div class="td-temas">
          ${TEMAS.map((t) => `
            <button class="td-tema ${t.id === temaSel ? "td-tema--on" : ""}" data-t="${t.id}">
              <span class="td-swatch" style="background:${t.fondo};border:1px solid var(--borde)"></span>
              ${escapar(t.nombre)}
            </button>`).join("")}
        </div>
        <div class="td-label">Color de acento</div>
        <div class="td-acentos">
          ${ACENTOS.map((a) => `
            <button class="td-acento ${a.id === acentoSel ? "td-acento--on" : ""}" data-a="${a.id}"
                    title="${escapar(a.nombre)}" style="background:${a.id}"></button>`).join("")}
        </div>
        <div class="td-msg" id="td-acento-msg"></div>
        <div class="td-label">Banner de la tienda (opcional)</div>
        <div class="td-fila td-banner-fila">
          <input type="file" id="td-banner" accept="image/jpeg,image/png,image/webp" hidden>
          <button class="btn-sec" id="td-banner-btn">Elegir imagen…</button>
          <span class="td-ayuda" id="td-banner-info">${estadoSrv && estadoSrv.banner_url
            ? "Ya tienes un banner publicado; elige otra imagen solo si quieres cambiarlo."
            : "JPG, PNG o WebP, máximo 500 KB."}</span>
        </div>
        <div id="td-banner-preview"></div>
      </section>

      <section class="td-seccion con-filo">
        <h2 class="td-h2">Pedidos y entregas</h2>
        <label class="td-check"><input type="checkbox" id="td-pickup" ${boolVal("tienda_entrega_pickup", estadoSrv ? estadoSrv.entrega_pickup !== false : true) ? "checked" : ""}>
          Recoger en tienda</label>
        <label class="td-check"><input type="checkbox" id="td-domicilio" ${boolVal("tienda_entrega_domicilio", estadoSrv ? !!estadoSrv.entrega_domicilio : false) ? "checked" : ""}>
          Entrega a domicilio</label>
        <div class="td-fila" id="td-envio-fila">
          <span class="td-label" style="margin:0">Costo de envío</span>
          <input class="td-input td-input--corto" id="td-envio" type="number" min="0" step="0.01"
                 value="${escapar(centavos(estadoSrv ? estadoSrv.costo_envio_centavos : Number(val("tienda_costo_envio_centavos", "0"))))}">
        </div>
        <label class="td-check"><input type="checkbox" id="td-pago-efectivo" ${boolVal("tienda_pago_efectivo", estadoSrv ? estadoSrv.pago_efectivo !== false : true) ? "checked" : ""}>
          Aceptar pago en efectivo</label>
        <div class="td-fila">
          <input class="td-input" id="td-link-pago" placeholder="Link de pago en línea (opcional)"
                 value="${escapar((estadoSrv && estadoSrv.link_pago) || val("tienda_link_pago"))}">
        </div>
        <label class="td-check"><input type="checkbox" id="td-ocultar" ${boolVal("tienda_ocultar_agotados", estadoSrv ? !!estadoSrv.ocultar_agotados : false) ? "checked" : ""}>
          Ocultar productos agotados</label>
        <label class="td-check"><input type="checkbox" id="td-mostrar-stock" ${boolVal("tienda_mostrar_stock", estadoSrv ? !!estadoSrv.mostrar_stock : false) ? "checked" : ""}>
          Mostrar el stock en la tienda</label>
      </section>

      <section class="td-seccion con-filo">
        <h2 class="td-h2">Datos del negocio</h2>
        <div class="td-fila">
          <select class="td-input" id="td-giro">
            <option value="">¿Cuál es tu giro?</option>
            ${GIROS.map((g) => `<option value="${g.id}" ${g.id === giro ? "selected" : ""}>${escapar(g.nombre)}</option>`).join("")}
          </select>
        </div>
        <div class="td-fila">
          <input class="td-input" id="td-whatsapp" placeholder="WhatsApp (10 dígitos)"
                 value="${escapar((estadoSrv && estadoSrv.whatsapp) || val("tienda_whatsapp"))}">
        </div>
        <div class="td-fila">
          <input class="td-input" id="td-mensaje" placeholder="Mensaje de bienvenida"
                 value="${escapar((estadoSrv && estadoSrv.mensaje_bienvenida) || val("tienda_mensaje_bienvenida"))}">
        </div>
        <div class="td-fila">
          <input class="td-input" id="td-domicilio-neg" placeholder="Domicilio del negocio"
                 value="${escapar((estadoSrv && estadoSrv.domicilio) || val("tienda_domicilio"))}">
        </div>
        <div class="td-fila">
          <input class="td-input" id="td-horarios" placeholder="Horarios (ej. Lun–Sáb 9 a 7)"
                 value="${escapar((estadoSrv && estadoSrv.horarios) || val("tienda_horarios"))}">
        </div>
        <div class="td-fila td-fila--3">
          <input class="td-input" id="td-instagram" placeholder="Instagram"
                 value="${escapar((estadoSrv && estadoSrv.instagram) || val("tienda_instagram"))}">
          <input class="td-input" id="td-facebook" placeholder="Facebook"
                 value="${escapar((estadoSrv && estadoSrv.facebook) || val("tienda_facebook"))}">
          <input class="td-input" id="td-tiktok" placeholder="TikTok"
                 value="${escapar((estadoSrv && estadoSrv.tiktok) || val("tienda_tiktok"))}">
        </div>
      </section>

      <section class="td-seccion con-filo">
        <h2 class="td-h2">Productos <span class="td-ayuda" id="td-prod-conteo"></span></h2>
        <div class="td-fila">
          <button class="btn-sec btn-mini" id="td-todos">Todos</button>
          <button class="btn-sec btn-mini" id="td-ninguno">Ninguno</button>
        </div>
        <div class="td-productos" id="td-productos">
          ${productos.map((p) => `
            <label class="td-prod">
              <input type="checkbox" data-prod="${escapar(p.producto_id)}" ${selSet.has(p.producto_id) ? "checked" : ""}>
              <span class="td-prod-nombre">${escapar(p.nombre)}</span>
              <span class="td-prod-precio num">${pesos(p.precio_centavos)}</span>
            </label>`).join("")}
        </div>
      </section>

      <div class="td-publicar">
        <div class="td-msg" id="td-publicar-msg"></div>
        <button class="btn-primario" id="td-publicar">${publicada ? "Actualizar tienda" : "Publicar tienda"}</button>
      </div>
    `;

    // ------- estado / enlace -------
    if ($("#td-copiar")) {
      $("#td-copiar").onclick = async () => {
        try {
          await navigator.clipboard.writeText(urlPublica);
          mensaje($("#td-publicar-msg"), "Enlace copiado. Compártelo con tus clientes.", true);
        } catch (e) {
          mensaje($("#td-publicar-msg"), "No se pudo copiar; el enlace está a la vista para copiarlo a mano.", false);
        }
      };
      $("#td-abrir").onclick = () => abrirUrl(urlPublica);
      $("#td-apagar").onclick = async () => {
        const ok = await confirmar(
          "Tu página dejará de estar en internet. Tus datos y productos se conservan para cuando la vuelvas a activar. ¿Desactivar la tienda?",
          { titulo: "Desactivar tienda", ok: "Desactivar", peligro: true }
        );
        if (!ok) return;
        try {
          await invoke("tienda_desactivar");
          estadoSrv = await invoke("tienda_estado").catch(() => estadoSrv);
          pintar();
        } catch (e) {
          mensaje($("#td-publicar-msg"), String(e), false);
        }
      };
    }

    // ------- slug -------
    $("#td-verificar").onclick = async () => {
      const slug = $("#td-slug").value.trim();
      const msg = $("#td-slug-msg");
      if (!slug) { mensaje(msg, "Escribe el enlace que quieres para tu tienda.", false); return; }
      msg.textContent = "Verificando…";
      msg.className = "td-msg";
      try {
        const r = await invoke("tienda_slug_disponible", { slug });
        if (r.disponible) {
          mensaje(msg, `¡Está libre! Tu tienda quedaría en ${r.sugerencia || slug}.yvexiq.com`, true);
        } else {
          mensaje(msg, `${r.motivo || "Ese enlace no está disponible."}${r.sugerencia ? ` ¿Qué te parece «${r.sugerencia}»?` : ""}`, false);
          if (r.sugerencia) $("#td-slug").value = r.sugerencia;
        }
      } catch (e) {
        mensaje(msg, String(e), false);
      }
    };

    // ------- diseño -------
    let plantilla = plantillaSel, tema = temaSel, acento = acentoSel;
    cuerpo.querySelectorAll(".td-plantilla").forEach((b) => (b.onclick = () => {
      plantilla = b.dataset.p;
      cuerpo.querySelectorAll(".td-plantilla").forEach((x) => x.classList.toggle("td-plantilla--on", x === b));
    }));
    cuerpo.querySelectorAll(".td-tema").forEach((b) => (b.onclick = () => {
      tema = b.dataset.t;
      cuerpo.querySelectorAll(".td-tema").forEach((x) => x.classList.toggle("td-tema--on", x === b));
      revisarContraste();
    }));
    cuerpo.querySelectorAll(".td-acento").forEach((b) => (b.onclick = () => {
      acento = b.dataset.a;
      cuerpo.querySelectorAll(".td-acento").forEach((x) => x.classList.toggle("td-acento--on", x === b));
      revisarContraste();
    }));

    function revisarContraste() {
      const fondo = (TEMAS.find((t) => t.id === tema) || TEMAS[0]).fondo;
      const r = contraste(acento, fondo);
      const msg = $("#td-acento-msg");
      if (r != null && r < 3) {
        mensaje(msg, "Ese acento se verá bajito sobre este tema. Prueba con otro color para que tus clientes lo lean sin esfuerzo.", false);
      } else {
        msg.textContent = "";
      }
    }
    revisarContraste();

    // ------- banner -------
    $("#td-banner-btn").onclick = () => $("#td-banner").click();
    $("#td-banner").onchange = () => {
      const f = $("#td-banner").files[0];
      bannerBase64 = null;
      $("#td-banner-preview").innerHTML = "";
      if (!f) return;
      if (f.size > MAX_BANNER_BYTES) {
        $("#td-banner-info").textContent = "Esa imagen pasa de 500 KB. Prueba con una más ligera.";
        $("#td-banner").value = "";
        return;
      }
      const lector = new FileReader();
      lector.onload = () => {
        const dataUrl = String(lector.result || "");
        bannerBase64 = dataUrl.split(",")[1] || null; // el backend quiere base64 crudo
        $("#td-banner-info").textContent = `${f.name} (${Math.round(f.size / 1024)} KB) — listo para publicarse.`;
        $("#td-banner-preview").innerHTML = `<img class="td-banner-img" src="${dataUrl}" alt="Vista previa del banner">`;
      };
      lector.readAsDataURL(f);
    };

    // ------- productos -------
    const actualizarConteo = () => {
      const n = cuerpo.querySelectorAll("#td-productos input:checked").length;
      $("#td-prod-conteo").textContent = `· ${n} de ${productos.length} seleccionados`;
    };
    cuerpo.querySelectorAll("#td-productos input").forEach((c) => (c.onchange = actualizarConteo));
    $("#td-todos").onclick = () => {
      cuerpo.querySelectorAll("#td-productos input").forEach((c) => (c.checked = true));
      actualizarConteo();
    };
    $("#td-ninguno").onclick = () => {
      cuerpo.querySelectorAll("#td-productos input").forEach((c) => (c.checked = false));
      actualizarConteo();
    };
    actualizarConteo();

    // ------- publicar -------
    $("#td-publicar").onclick = async () => {
      const btn = $("#td-publicar");
      const msg = $("#td-publicar-msg");
      btn.disabled = true;
      msg.textContent = "Publicando tu tienda…";
      msg.className = "td-msg";
      try {
        const ids = [...cuerpo.querySelectorAll("#td-productos input:checked")]
          .map((c) => c.dataset.prod);
        if (ids.length === 0) {
          throw new Error("Elige al menos un producto para que tu tienda no se vea vacía.");
        }
        const productosPayload = await invoke("tienda_productos_para_publicar", { ids });
        const payload = {
          plantilla,
          tema,
          color_acento: acento,
          whatsapp: $("#td-whatsapp").value.trim(),
          mensaje_bienvenida: $("#td-mensaje").value.trim(),
          mostrar_stock: $("#td-mostrar-stock").checked,
          slug_deseado: $("#td-slug").value.trim() || null,
          giro: $("#td-giro").value || null,
          domicilio: $("#td-domicilio-neg").value.trim(),
          horarios: $("#td-horarios").value.trim(),
          instagram: $("#td-instagram").value.trim(),
          facebook: $("#td-facebook").value.trim(),
          tiktok: $("#td-tiktok").value.trim(),
          entrega_pickup: $("#td-pickup").checked,
          entrega_domicilio: $("#td-domicilio").checked,
          costo_envio_centavos: Math.round((parseFloat($("#td-envio").value) || 0) * 100),
          pago_efectivo: $("#td-pago-efectivo").checked,
          link_pago: $("#td-link-pago").value.trim() || null,
          ocultar_agotados: $("#td-ocultar").checked,
          banner_base64: bannerBase64,
          productos: productosPayload,
        };
        const r = await invoke("tienda_publicar", { payload });
        if (!r.ok) throw new Error("El servidor no confirmó la publicación.");

        // Persistir la config local (incluye la selección de productos).
        const claves = {
          tienda_plantilla: plantilla,
          tienda_tema: tema,
          tienda_acento: acento,
          tienda_whatsapp: payload.whatsapp,
          tienda_mensaje_bienvenida: payload.mensaje_bienvenida,
          tienda_mostrar_stock: payload.mostrar_stock ? "1" : "0",
          tienda_slug: r.slug || payload.slug_deseado || "",
          tienda_giro: payload.giro || "",
          tienda_domicilio: payload.domicilio,
          tienda_horarios: payload.horarios,
          tienda_instagram: payload.instagram,
          tienda_facebook: payload.facebook,
          tienda_tiktok: payload.tiktok,
          tienda_entrega_pickup: payload.entrega_pickup ? "1" : "0",
          tienda_entrega_domicilio: payload.entrega_domicilio ? "1" : "0",
          tienda_costo_envio_centavos: String(payload.costo_envio_centavos),
          tienda_pago_efectivo: payload.pago_efectivo ? "1" : "0",
          tienda_link_pago: payload.link_pago || "",
          tienda_ocultar_agotados: payload.ocultar_agotados ? "1" : "0",
          tienda_url_publica: r.url_publica || "",
          tienda_url_path: r.url_path || "",
          tienda_productos_ids: JSON.stringify(ids),
        };
        await invoke("tienda_guardar_config_local", { claves, rol: sesion.rol });
        cfg = { ...cfg, ...claves };

        estadoSrv = await invoke("tienda_estado").catch(() => estadoSrv);
        lineaVida.exito();
        pintar();
        mensaje($("#td-publicar-msg"), `Tu tienda está al aire en ${r.url_publica}`, true);
      } catch (e) {
        mensaje(msg, String(e), false);
      } finally {
        btn.disabled = false;
      }
    };
  }

  function mensaje(el, texto, ok) {
    el.textContent = texto;
    el.className = "td-msg " + (ok ? "td-msg--ok" : "td-msg--error");
  }
}
