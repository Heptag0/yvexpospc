// YvexPOS — arranque del frontend.
// Flujo: ¿configurado? → onboarding | login → ¿caja abierta? → abrir caja → SHELL → módulos.
// La sesión NO persiste: cada arranque pide login.
//
// ARQUITECTURA v2 (shell): tras abrir caja se monta UNA vez el shell
// (línea de vida + sidebar + contenedor). Las vistas se montan dentro de
// shell.contenido en lugar de #app — para ellas es transparente.
// Login / onboarding / abrir-caja siguen a pantalla completa (sin shell).

import { invoke } from "@tauri-apps/api/core";
import { montarOnboarding } from "./vistas/onboarding.js";
import { montarLogin } from "./vistas/login.js";
import { montarInventario } from "./vistas/inventario.js";
import { montarInventario as montarExistencias } from "./vistas/inventario_existencias.js";
import { montarAbrirCaja } from "./vistas/abrir_caja.js";
import { montarVenta } from "./vistas/venta.js";
import { montarClientes } from "./vistas/clientes.js";
import { montarCredito } from "./vistas/credito.js";
import { montarCaja } from "./vistas/caja.js";
import { montarDevoluciones } from "./vistas/devoluciones.js";
import { montarReportes } from "./vistas/reportes.js";
import { montarConfiguracion } from "./vistas/configuracion.js";
import { montarShell } from "./util/sidebar.js";
import { montarInicio } from "./vistas/inicio.js";
import { aplicarApariencia } from "./util/apariencia.js";
import { revisarVerificacion } from "./util/verificacion_banner.js";

const app = document.querySelector("#app");
let sesion = null;
let cajaSesion = null;
let shell = null;

async function arrancar() {
  // La apariencia del dueño aplica desde el primer pixel (incluye el login).
  // Si la config aún no existe (primer arranque), aplica el predeterminado.
  try {
    aplicarApariencia(await invoke("config_leer_todo"));
  } catch (e) {
    aplicarApariencia(null);
  }
  try {
    const configurado = await invoke("pos_configurado");
    if (!configurado) {
      montarOnboarding(app, irALogin);
    } else {
      irALogin();
    }
  } catch (e) {
    app.innerHTML = '<div class="estado estado--error">✗ Error al arrancar: ' + e + "</div>";
  }
}

function irALogin() {
  sesion = null;
  cajaSesion = null;
  shell = null;
  // Restaurar el centrado original de #app (el shell lo neutraliza).
  app.style.cssText = "";
  montarLogin(app, async (usuario) => {
    sesion = usuario;
    // Tras login: ¿hay caja abierta? Si no, pedir apertura antes del menú.
    try {
      const abierta = await invoke("caja_abierta");
      // Al entrar al turno se aterriza DIRECTO en Venta: es a lo que se viene.
      // El hub queda como "Inicio" en la sidebar (futuro dashboard del negocio).
      if (abierta) {
        cajaSesion = abierta;
        abrirModulo("venta");
      } else {
        montarAbrirCaja(app, sesion, (nuevaCaja) => {
          cajaSesion = nuevaCaja;
          abrirModulo("venta");
        });
      }
    } catch (e) {
      app.innerHTML = '<div class="estado estado--error">✗ Error con la caja: ' + e + "</div>";
    }
  });
}

// Garantiza que el shell exista (se monta una sola vez por sesión).
function asegurarShell() {
  if (shell) return shell;
  shell = montarShell(app, sesion, {
    alNavegar: (mod) => (mod === "inicio" ? irAMenu() : abrirModulo(mod)),
    alSalir: irALogin,
  });
  // Aviso suave de verificación de correo (no bloquea; solo si aplica).
  revisarVerificacion(app);
  return shell;
}

function irAMenu() {
  const s = asegurarShell();
  s.marcarActivo("inicio");
  // Inicio v2: dashboard del pulso del negocio (vistas/inicio.js).
  // El grid de navegación murió: esa función la cumple la sidebar.
  montarInicio(s.contenido, sesion, cajaSesion, abrirModulo);
}

function abrirModulo(mod) {
  const s = asegurarShell();
  s.marcarActivo(mod);
  const raiz = s.contenido;

  if (mod === "inventario") {
    montarInventario(raiz, sesion, irAMenu);
  } else if (mod === "existencias") {
    montarExistencias(raiz, sesion, irAMenu, () =>
      montarConfiguracion(raiz, sesion, irAMenu, "importar")
    );
  } else if (mod === "venta") {
    montarVenta(raiz, sesion, cajaSesion, irAMenu, () =>
      montarDevoluciones(raiz, sesion, cajaSesion, () => abrirModulo("venta")),
      () => montarInventario(raiz, sesion, irAMenu, "negativos")
    );
  } else if (mod === "clientes") {
    montarClientes(raiz, sesion, cajaSesion, irAMenu);
  } else if (mod === "credito") {
    montarCredito(raiz, sesion, cajaSesion, irAMenu);
  } else if (mod === "caja") {
    montarCaja(raiz, sesion, cajaSesion, irAMenu, irALogin);
  } else if (mod === "reportes") {
    montarReportes(raiz, sesion, irAMenu);
  } else if (mod === "configuracion") {
    montarConfiguracion(raiz, sesion, irAMenu);
  } else {
    raiz.innerHTML =
      '<div class="estado estado--ok" style="max-width:520px">' +
      "El módulo <strong>" + mod + "</strong> se construye próximamente." +
      '<br><button class="btn-sec" id="volver-menu" style="margin-top:16px">← Menú</button></div>';
    raiz.querySelector("#volver-menu").addEventListener("click", irAMenu);
  }
}

window.addEventListener("DOMContentLoaded", arrancar);
