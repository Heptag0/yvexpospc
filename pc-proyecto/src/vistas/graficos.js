// YvexPOS — gráficos SVG propios (sin librerías, offline-first).
// Dona, barras y línea, con tooltips al pasar el cursor y animación de entrada.
// Identidad YvexPOS: acento del tema activo, números tabulares, multi-tema.

import { pesos } from "../util/formato.js";

// Paleta categórica CONSTANTE entre temas: las categorías conservan su color
// en Nocturno/Amanecer/Brisa para que el dueño las reconozca de memoria.
const PALETA = [
  "#8b5cf6", "#3b82f6", "#14b8a6", "#f59e0b", "#ec4899",
  "#22c55e", "#ef4444", "#a855f7", "#06b6d4", "#eab308",
];

// Tooltip compartido (uno solo para todos los gráficos).
let tooltipEl = null;
function tooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "graf-tooltip";
    tooltipEl.style.display = "none";
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}
function mostrarTooltip(html, x, y) {
  const t = tooltip();
  t.innerHTML = html;
  t.style.display = "block";
  t.style.left = x + 14 + "px";
  t.style.top = y + 14 + "px";
}
function ocultarTooltip() {
  if (tooltipEl) tooltipEl.style.display = "none";
}

/// Gráfico de dona. datos: [{label, valor, color?}]. Devuelve un elemento.
export function donaSVG(datos, { tamano = 220, titulo = "" } = {}) {
  const cont = document.createElement("div");
  cont.className = "graf graf-dona";
  const total = datos.reduce((s, d) => s + d.valor, 0);
  if (total === 0) {
    cont.innerHTML = '<div class="graf-vacio">Sin datos en este periodo.</div>';
    return cont;
  }

  const r = tamano / 2;
  const grosor = tamano * 0.22;
  const rInt = r - grosor;
  const cx = r, cy = r;
  let angulo = -Math.PI / 2; // empezar arriba

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${tamano} ${tamano}`);
  svg.setAttribute("class", "graf-svg");
  svg.style.maxWidth = tamano + "px";

  datos.forEach((d, i) => {
    const frac = d.valor / total;
    const a0 = angulo;
    const a1 = angulo + frac * Math.PI * 2;
    angulo = a1;
    const color = d.color || PALETA[i % PALETA.length];
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", arcoAnillo(cx, cy, r - 2, rInt, a0, a1));
    path.setAttribute("fill", color);
    path.setAttribute("class", "graf-segmento");
    path.style.transformOrigin = `${cx}px ${cy}px`;
    path.style.animation = `grafCrecer 0.5s cubic-bezier(0.16,1,0.3,1) ${i * 70}ms both`;
    path.addEventListener("mousemove", (e) => {
      path.style.filter = "brightness(1.15)";
      mostrarTooltip(
        `<strong>${d.label}</strong><br>${pesos(d.valor)} · ${(frac * 100).toFixed(1)}%`,
        e.pageX, e.pageY
      );
    });
    path.addEventListener("mouseleave", () => {
      path.style.filter = "";
      ocultarTooltip();
    });
    svg.appendChild(path);
  });

  // Total al centro.
  const txt = document.createElementNS(ns, "text");
  txt.setAttribute("x", cx);
  txt.setAttribute("y", cy - 4);
  txt.setAttribute("text-anchor", "middle");
  txt.setAttribute("class", "graf-dona-total");
  txt.textContent = pesos(0);
  svg.appendChild(txt);
  // El total del centro cuenta hacia arriba junto al crecimiento de la dona.
  {
    const t0 = performance.now(), dur = 650;
    const paso = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      txt.textContent = pesos(Math.round(total * e));
      if (p < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }
  const sub = document.createElementNS(ns, "text");
  sub.setAttribute("x", cx);
  sub.setAttribute("y", cy + 16);
  sub.setAttribute("text-anchor", "middle");
  sub.setAttribute("class", "graf-dona-sub");
  sub.textContent = titulo;
  svg.appendChild(sub);

  const wrap = document.createElement("div");
  wrap.className = "graf-dona-wrap";
  wrap.appendChild(svg);

  // Leyenda.
  const leyenda = document.createElement("div");
  leyenda.className = "graf-leyenda";
  datos.forEach((d, i) => {
    const color = d.color || PALETA[i % PALETA.length];
    const item = document.createElement("div");
    item.className = "graf-leyenda-item";
    item.innerHTML = `<span class="graf-punto" style="background:${color}"></span>
      <span class="graf-leyenda-label">${d.label}</span>
      <span class="graf-leyenda-valor num">${pesos(d.valor)}</span>`;
    leyenda.appendChild(item);
  });
  wrap.appendChild(leyenda);
  cont.appendChild(wrap);
  return cont;
}

/// Barras horizontales. datos: [{label, valor, valor2?, sub?}].
export function barrasSVG(datos, { formato = pesos, etiquetaValor2 = "" } = {}) {
  const cont = document.createElement("div");
  cont.className = "graf graf-barras";
  if (datos.length === 0) {
    cont.innerHTML = '<div class="graf-vacio">Sin datos en este periodo.</div>';
    return cont;
  }
  const max = Math.max(...datos.map((d) => d.valor), 1);
  datos.forEach((d, i) => {
    const pct = (d.valor / max) * 100;
    const fila = document.createElement("div");
    fila.className = "graf-barra-fila";
    fila.innerHTML = `
      <div class="graf-barra-label">${d.label}</div>
      <div class="graf-barra-track">
        <div class="graf-barra-fill" style="width:0%;background:${PALETA[i % PALETA.length]};animation-delay:${i * 60}ms"></div>
      </div>
      <div class="graf-barra-valor num">${formato(d.valor)}</div>`;
    cont.appendChild(fila);
    // Animar al siguiente frame.
    requestAnimationFrame(() => {
      const fill = fila.querySelector(".graf-barra-fill");
      fill.style.width = pct + "%";
    });
    const fill = fila.querySelector(".graf-barra-fill");
    fila.addEventListener("mousemove", (e) => {
      let html = `<strong>${d.label}</strong><br>${formato(d.valor)}`;
      if (d.valor2 !== undefined) html += `<br>${etiquetaValor2}: ${formato(d.valor2)}`;
      if (d.sub) html += `<br>${d.sub}`;
      mostrarTooltip(html, e.pageX, e.pageY);
    });
    fila.addEventListener("mouseleave", ocultarTooltip);
  });
  return cont;
}

/// Gráfico de línea/área. puntos: [{etiqueta, valor}]. Suaviza y rellena.
export function lineaSVG(puntos, { alto = 200, formato = pesos } = {}) {
  const cont = document.createElement("div");
  cont.className = "graf graf-linea";
  if (puntos.length === 0) {
    cont.innerHTML = '<div class="graf-vacio">Sin datos en este periodo.</div>';
    return cont;
  }
  if (puntos.length === 1) {
    // Un solo punto: mostrar como dato grande.
    cont.innerHTML = `<div class="graf-unico"><span>${puntos[0].etiqueta}</span><strong class="num">${formato(puntos[0].valor)}</strong></div>`;
    return cont;
  }

  const ancho = 700;
  const padL = 8, padR = 8, padT = 16, padB = 28;
  const w = ancho - padL - padR;
  const h = alto - padT - padB;
  const max = Math.max(...puntos.map((p) => p.valor), 1);
  const n = puntos.length;
  const x = (i) => padL + (i / (n - 1)) * w;
  const y = (v) => padT + h - (v / max) * h;

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${ancho} ${alto}`);
  svg.setAttribute("class", "graf-svg graf-linea-svg");
  svg.setAttribute("preserveAspectRatio", "none");

  // Gradiente de relleno.
  const defs = document.createElementNS(ns, "defs");
  defs.innerHTML = `<linearGradient id="gradLinea" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" style="stop-color:var(--acento)" stop-opacity="0.35"/>
    <stop offset="100%" style="stop-color:var(--acento)" stop-opacity="0"/>
  </linearGradient>`;
  svg.appendChild(defs);

  // Path de la línea (suavizado simple con curvas).
  let dLinea = `M ${x(0)} ${y(puntos[0].valor)}`;
  for (let i = 1; i < n; i++) {
    const xm = (x(i - 1) + x(i)) / 2;
    dLinea += ` C ${xm} ${y(puntos[i - 1].valor)}, ${xm} ${y(puntos[i].valor)}, ${x(i)} ${y(puntos[i].valor)}`;
  }
  const dArea = dLinea + ` L ${x(n - 1)} ${padT + h} L ${x(0)} ${padT + h} Z`;

  const area = document.createElementNS(ns, "path");
  area.setAttribute("d", dArea);
  area.setAttribute("fill", "url(#gradLinea)");
  svg.appendChild(area);

  const linea = document.createElementNS(ns, "path");
  linea.setAttribute("d", dLinea);
  linea.setAttribute("fill", "none");
  linea.setAttribute("style", "stroke: var(--acento)");
  linea.setAttribute("stroke-width", "2.5");
  linea.setAttribute("class", "graf-linea-path");
  // Se dibuja de izquierda a derecha al entrar (pathLength normaliza el trazo).
  linea.setAttribute("pathLength", "1");
  linea.classList.add("graf-linea-dibuja");
  svg.appendChild(linea);

  // Puntos interactivos.
  puntos.forEach((p, i) => {
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", x(i));
    c.setAttribute("cy", y(p.valor));
    c.setAttribute("r", "4");
    c.setAttribute("style", "fill: var(--superficie-1); stroke: var(--acento)");
    c.setAttribute("stroke-width", "2");
    c.setAttribute("class", "graf-linea-punto");
    c.addEventListener("mousemove", (e) => {
      c.setAttribute("r", "6");
      mostrarTooltip(`<strong>${p.etiqueta}</strong><br>${formato(p.valor)}`, e.pageX, e.pageY);
    });
    c.addEventListener("mouseleave", () => {
      c.setAttribute("r", "4");
      ocultarTooltip();
    });
    svg.appendChild(c);
  });

  const wrap = document.createElement("div");
  wrap.className = "graf-linea-wrap";
  wrap.appendChild(svg);
  // Etiquetas del eje X (primera, media, última para no saturar).
  const ejeX = document.createElement("div");
  ejeX.className = "graf-eje-x";
  const idxs = n <= 7 ? puntos.map((_, i) => i) : [0, Math.floor(n / 2), n - 1];
  ejeX.innerHTML = idxs.map((i) => `<span>${puntos[i].etiqueta}</span>`).join("");
  wrap.appendChild(ejeX);
  cont.appendChild(wrap);
  return cont;
}

// Helper: path de un arco de anillo (para la dona).
function arcoAnillo(cx, cy, rExt, rInt, a0, a1) {
  const x0e = cx + rExt * Math.cos(a0), y0e = cy + rExt * Math.sin(a0);
  const x1e = cx + rExt * Math.cos(a1), y1e = cy + rExt * Math.sin(a1);
  const x0i = cx + rInt * Math.cos(a1), y0i = cy + rInt * Math.sin(a1);
  const x1i = cx + rInt * Math.cos(a0), y1i = cy + rInt * Math.sin(a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0e} ${y0e} A ${rExt} ${rExt} 0 ${large} 1 ${x1e} ${y1e} L ${x0i} ${y0i} A ${rInt} ${rInt} 0 ${large} 0 ${x1i} ${y1i} Z`;
}

export { PALETA };
