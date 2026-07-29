// Iconos SVG de línea (estilo Lucide/Feather), trazo consistente 1.75px.
// Heredan currentColor, así toman el color del contexto (tenue/acento).
// Reutilizables en el hub, el sidebar y donde haga falta.
// Uso: icono("venta") devuelve el string SVG.

const TRAZO = 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

const ICONOS = {
  // Casa / inicio (hub)
  inicio: `<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9"/><path d="M9.5 21v-6.5h5V21"/>`,
  // Carrito de compra
  venta: `<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.5 3h2l2.7 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21.5 7H6"/>`,
  // Paquete / producto
  inventario: `<path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z"/><path d="M3 7l9 5 9-5"/><path d="M12 12v10"/>`,
  // Clipboard / existencias
  existencias: `<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 11h6"/><path d="M9 15h4"/>`,
  // Personas / clientes
  clientes: `<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 6a3 3 0 0 1 0 5.5"/><path d="M18 14.2a5.5 5.5 0 0 1 2.5 4.6"/>`,
  // Recibo / crédito
  credito: `<path d="M6 2h12v20l-3-1.6L12 22l-3-1.6L6 22Z"/><path d="M9.5 8h5"/><path d="M9.5 12h5"/>`,
  // Billetes / corte de caja
  caja: `<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4"/><path d="M18 10v4"/>`,
  // Gráfica / reportes
  reportes: `<path d="M4 4v16h16"/><path d="M8 15l3-4 3 2 4-6"/>`,
  // Engrane / configuración
  configuracion: `<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>`,
  // Lupa / buscar
  buscar: `<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>`,
  // Más / agregar
  mas: `<path d="M12 5v14M5 12h14"/>`,
  // Salir / cerrar sesión (puerta con flecha)
  salir: `<path d="M14 4h-7a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h7"/><path d="M10 12h11"/><path d="m17.5 8.5 3.5 3.5-3.5 3.5"/>`,
  // Asa de arrastre (grip de 6 puntos)
  asa: `<circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none"/>`,
};

export function icono(nombre) {
  const cuerpo = ICONOS[nombre] || "";
  return `<svg viewBox="0 0 24 24" ${TRAZO} width="24" height="24" aria-hidden="true">${cuerpo}</svg>`;
}
