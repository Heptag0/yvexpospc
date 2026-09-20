// YvexPOS — Yaxo: temas y respuestas escritas.
//
// ===========================================================================
// ESTE ARCHIVO ES UNA COPIA LITERAL ENTRE MÓVIL Y PC
// ===========================================================================
// Existe dos veces, con el MISMO contenido byte por byte:
//
//   móvil → src/base/yaxoGuia.ts
//   PC    → src/util/yaxoGuia.js
//
// Solo cambia la extensión. No lleva ni una anotación de tipo ni un import,
// así que el mismo texto es TypeScript válido y JavaScript válido.
//
// POR QUÉ ASÍ, SI SE DECIDIÓ NO COMPARTIR CÓDIGO ENTRE TS Y JS
// Porque esto no es código: son datos. La decisión de no compartir código
// sigue en pie —cada plataforma llama a su capa de reportes y a su base de
// datos como puede— pero las PALABRAS de Yaxo no pueden divergir. El día que
// el PC diga una cosa y el teléfono otra sobre el mismo negocio, Yaxo deja de
// ser una sola criatura y pasa a ser dos que se contradicen.
//
// Antes esto se resolvía con una advertencia ("si cambias una frase, cámbiala
// en los dos sitios"). Con cinco respuestas era sostenible. Con cuarenta
// preguntas y sus variantes, una advertencia no basta: hay que poder
// COMPROBARLO. Al ser copia literal, un `diff` de los dos archivos responde en
// un segundo, y un archivo idéntico es una condición que se verifica, no una
// que se recuerda.
//
// AL EDITAR: cambia uno, copia el archivo entero al otro proyecto. No edites
// los dos a mano "en paralelo" — así es exactamente como divergen.
//
// ===========================================================================
// LAS VARIANTES DICEN LO MISMO CON OTRAS PALABRAS. SIEMPRE.
// ===========================================================================
// Cada respuesta trae varias redacciones y `variar()` las rota. La regla, la
// misma que ya está escrita en yaxoVoz.ts y que aquí importa más porque hay
// mucho más texto: TODAS las variantes de una respuesta tienen que ser
// intercambiables sin que el usuario entienda algo distinto.
//
// Es facilísimo equivocarse: escribir una versión "más animada" de una mala
// noticia, o una que promete un poco más que la anterior. Eso no es variar la
// forma, es cambiar el contenido. Si dos variantes no se pueden intercambiar
// sin alterar lo que el dueño entiende, una de las dos sobra.
//
// ===========================================================================
// LAS EXPLICACIONES SE ESCRIBEN POR PROPÓSITO, NUNCA POR PASOS
// ===========================================================================
// "Sirve para saber cuánto te cuesta lo que preparas" envejece bien.
// "Toca el botón azul de arriba a la derecha" envejece en la próxima versión,
// y entonces Yaxo explica con total seguridad algo que el usuario tiene
// delante y no coincide. Un asistente que se equivoca describiendo lo que se
// ve en pantalla pierde credibilidad para todo lo demás, incluidos los
// números — que es lo único que de verdad no se puede permitir.
//
// Por eso ninguna respuesta de este archivo nombra un botón, un color ni una
// posición. Dicen para qué sirve algo y qué problema resuelve.

// ---------------------------------------------------------------------------
// TEMAS
// ---------------------------------------------------------------------------
// El menú de primer nivel. Con cinco preguntas una fila de chips bastaba; con
// cuarenta ya no cabe y lo que no se ve no existe. Los temas no son una
// categorización teórica: salieron de agrupar las preguntas que un dueño hace
// de verdad, no al revés.
//
// `intro` es lo que Yaxo dice al entrar al tema. Es lo que convierte el menú
// en conversación: en vez de que los chips cambien en silencio, Yaxo responde
// y ofrece. Sin esto se siente como un menú telefónico.

export const TEMAS = [
  {
    id: "ventas",
    nombre: "Ventas",
    intro: [
      ["¿Qué quieres saber de tus ventas?"],
      ["Dime qué te interesa de lo que has vendido."],
      ["Va. ¿Qué parte de tus ventas quieres ver?"],
    ],
  },
  {
    id: "inventario",
    nombre: "Inventario",
    intro: [
      ["¿Qué quieres revisar de tu mercancía?"],
      ["Dime qué te interesa del inventario."],
      ["¿Qué miramos de lo que tienes en la tienda?"],
    ],
  },
  {
    id: "ganancia",
    nombre: "Precios y ganancia",
    intro: [
      ["¿Qué quieres saber de tus precios o de lo que te queda?"],
      ["Dime qué te interesa de márgenes y ganancia."],
      ["Aquí hablamos de lo que de verdad te queda. ¿Por dónde?"],
    ],
  },
  {
    id: "dinero",
    nombre: "Dinero y caja",
    intro: [
      ["¿Qué quieres saber del dinero que entra y sale?"],
      ["Dime qué te interesa de caja, gastos o cobros."],
      ["Hablemos de dinero. ¿Qué parte?"],
    ],
  },
  {
    id: "herramientas",
    nombre: "Herramientas",
    intro: [
      [
        "El punto de venta trae varias herramientas y no todas se ven a primera vista. ¿Cuál te explico?",
      ],
      [
        "Te explico cualquiera de las herramientas: para qué sirve y cuándo conviene usarla. ¿Cuál te interesa?",
      ],
      [
        "Dime qué herramienta quieres conocer y te cuento qué resuelve.",
      ],
    ],
  },
  {
    id: "comohago",
    nombre: "Cómo hago…",
    intro: [
      ["¿Qué necesitas hacer?"],
      ["Dime qué quieres lograr y te explico cómo se plantea."],
      ["¿Con qué te echo la mano?"],
    ],
  },
  {
    id: "yaxo",
    nombre: "Sobre mí",
    intro: [
      ["Pregúntame lo que quieras sobre cómo trabajo."],
      ["¿Qué quieres saber de mí?"],
      ["Aquí te cuento cómo funciono y de dónde saco lo que digo."],
    ],
  },
];

// ---------------------------------------------------------------------------
// PREGUNTAS DE DATOS
// ---------------------------------------------------------------------------
// Las que se contestan consultando la base. AQUÍ SOLO VIVE SU IDENTIDAD: id,
// tema, texto y en qué pantallas se ofrecen primero. La consulta NO está aquí
// a propósito — el móvil llama a reportes.ts/indicadores.ts y el PC invoca
// comandos de Rust, y ese código no se puede compartir ni tiene por qué.
//
// Cada plataforma resuelve el `id` con lo suyo. Si un id de esta lista no está
// resuelto en una plataforma, esa plataforma simplemente no lo ofrece: es
// preferible que falte una pregunta en la caja a que exista un chip que
// truena.

export const PREGUNTAS_DATOS = [
  { id: "hoy", tema: "ventas", texto: "¿Cómo voy hoy?", pantallas: ["inicio", "vender", "reportes", "dinero"] },
  { id: "semana", tema: "ventas", texto: "¿Cómo va la semana?", pantallas: ["inicio", "reportes", "dinero"] },
  { id: "resurtir", tema: "inventario", texto: "¿Qué debo resurtir?", pantallas: ["inicio", "inventario", "vender"] },
  { id: "parado", tema: "inventario", texto: "¿Qué tengo parado?", pantallas: ["inicio", "inventario"] },
  { id: "precios", tema: "ganancia", texto: "¿Estoy cobrando bien?", pantallas: ["inicio", "inventario", "reportes"] },
  { id: "mejordia", tema: "ventas", texto: "¿Qué día vendo más?", pantallas: ["inicio", "reportes"] },
  { id: "ganancia", tema: "ganancia", texto: "¿Qué producto me deja más?", pantallas: ["inicio", "reportes", "inventario"] },
  { id: "volumen", tema: "ganancia", texto: "¿Qué vendo mucho y me deja poco?", pantallas: ["inicio", "reportes", "inventario"] },
  { id: "sincosto", tema: "inventario", texto: "¿Qué costos me faltan?", pantallas: ["inicio", "inventario", "reportes"] },
  { id: "cajon", tema: "dinero", texto: "¿Cuánto debe haber en el cajón?", pantallas: ["inicio", "vender", "dinero"] },
  { id: "gastos", tema: "dinero", texto: "¿Cuánto llevo gastado?", pantallas: ["inicio", "dinero", "reportes"] },
  { id: "fijos", tema: "dinero", texto: "¿Me alcanza para mis gastos fijos?", pantallas: ["inicio", "dinero"] },
  { id: "deben", tema: "dinero", texto: "¿Cuánto me deben?", pantallas: ["inicio", "dinero", "vender"] },

  // Los cinco umbrales con los que Yaxo razona. Van en "Sobre mí" y no en una
  // pantalla de ajustes a propósito: un formulario con cinco campos numéricos
  // no lo abre nadie, y quien lo abriera no sabría qué poner ("días de
  // cobertura de alerta" no significa nada para un tendero). Dicho en
  // conversación, con el valor actual y un ejemplo de por qué puede no
  // servirle, sí se entiende y sí se toca.
  //
  // El texto del chip es la PREGUNTA que haría el dueño, no el nombre del
  // ajuste: nadie pregunta "configurar umbral de inventario parado".
  { id: "umbral-parado", tema: "yaxo", texto: "¿Cuándo dices que algo está parado?", pantallas: ["inventario"] },
  { id: "umbral-alerta", tema: "yaxo", texto: "¿Cuándo avisas que algo se acaba?", pantallas: ["inventario", "vender"] },
  { id: "umbral-ritmo", tema: "yaxo", texto: "¿Cuánto tiempo miras para el ritmo?", pantallas: ["inventario"] },
  { id: "umbral-minimo", tema: "yaxo", texto: "¿Por qué no mencionas los productos baratos?", pantallas: ["inventario"] },
  { id: "umbral-ventas", tema: "yaxo", texto: "¿Por qué a veces no calculas el ritmo?", pantallas: ["inventario"] },
];

// ---------------------------------------------------------------------------
// PREGUNTAS ESCRITAS
// ---------------------------------------------------------------------------
// No tocan la base de datos: la respuesta está escrita aquí. Por eso son las
// más baratas de todo el asistente y, para alguien que acaba de instalar el
// programa, probablemente las más útiles: el POS tiene muchas herramientas y
// nadie lee documentación.
//
// `abrir` es el id neutro del módulo al que Yaxo puede llevar. Cada plataforma
// lo traduce a lo suyo (el PC a abrirModulo, el móvil a su ruta o a su modal);
// si una plataforma no sabe abrirlo, no ofrece el atajo y la explicación se
// muestra igual. Por eso el id es neutro y no una ruta: una ruta del móvil no
// significa nada en la caja.
//
// `variantes` es una lista de REDACCIONES COMPLETAS, y cada redacción es una
// lista de párrafos. No se mezclan entre sí: se elige una entera y se muestra.
// Mezclar párrafos de variantes distintas produce texto que se repite o se
// contradice a media respuesta.

export const PREGUNTAS_TEXTO = [
  // ===== HERRAMIENTAS =====
  {
    id: "h-existencias",
    tema: "herramientas",
    texto: "Existencias",
    estado: "contable",
    abrir: "existencias",
    variantes: [
      [
        "Existencias es donde entra la mercancía que compras. Registras lo que llegó y el stock sube solo.",
        "Sirve para dos cosas que se confunden: dar de alta lo que compraste, y corregir lo que no cuadra cuando cuentas el estante y no coincide con lo que dice el sistema.",
        "Si nunca registras entradas, el stock se va quedando corto y yo empiezo a decirte que resurtas cosas que sí tienes.",
      ],
      [
        "Es la puerta por donde entra la mercancía al sistema. Compras una caja, la registras, y las existencias suben.",
        "También es donde se ajusta lo que no cuadra: si contaste doce y el sistema dice quince, ahí lo corriges.",
        "Vale la pena usarlo desde el principio, porque todo lo que yo te diga de resurtir sale de ese número.",
      ],
      [
        "Existencias lleva el control de cuánto tienes de cada cosa: lo que entra por compras y lo que se corrige al contar.",
        "Su valor no es el registro en sí, es que el stock refleje la realidad. Un inventario que miente convierte cualquier consejo mío en adivinanza.",
      ],
    ],
  },
  {
    id: "h-recetas",
    tema: "herramientas",
    texto: "Recetas",
    estado: "contable",
    abrir: "recetas",
    variantes: [
      [
        "Recetas es para lo que preparas tú: si vendes tortas, la torta no la compras hecha, la armas con pan, jamón y lo demás.",
        "Le dices de qué está hecha y el sistema calcula cuánto te cuesta de verdad, y descuenta los ingredientes del inventario cuando la vendes.",
        "Sin esto, un producto preparado no tiene costo, y sin costo yo no puedo decirte cuánto ganas con él.",
      ],
      [
        "Sirve para los productos que armas en tu negocio en vez de comprarlos hechos: comida preparada, bolsas surtidas, paquetes.",
        "Registras los ingredientes una vez y a partir de ahí cada venta descuenta lo que consumió y sabe cuánto costó.",
        "Es la única forma de que yo pueda hablarte del margen de lo que preparas.",
      ],
      [
        "Una receta describe con qué se hace un producto tuyo. El sistema saca su costo de la suma de sus partes y descuenta esas partes al vender.",
        "Lo importante no es el papeleo: es que deja de haber productos sin costo, que son los que me obligan a decirte que no puedo afirmar tu ganancia.",
      ],
    ],
  },
  {
    id: "h-kits",
    tema: "herramientas",
    texto: "Kits",
    estado: "contable",
    variantes: [
      [
        "Un kit es un paquete de cosas que ya tienes por separado: tres refrescos y unas botanas vendidos juntos a un precio.",
        "No tiene existencia propia. Cuando vendes el kit, el sistema descuenta cada producto que lo forma.",
        "La diferencia con una receta: la receta TRANSFORMA los ingredientes en algo nuevo; el kit solo AGRUPA cosas que siguen siendo ellas mismas.",
      ],
      [
        "Los kits agrupan productos que ya existen para venderlos como uno solo. Útil para promociones y paquetes.",
        "Su stock no se lleva aparte: sale del de sus componentes, así que nunca vas a ver un número de existencia del kit en sí.",
        "Si lo que haces es transformar ingredientes en un producto distinto, eso es una receta, no un kit.",
      ],
      [
        "Un kit vende varias cosas juntas sin dejar de ser cada una lo que era: se descuentan de su propio inventario al cobrar.",
        "Receta o kit: si el resultado es algo nuevo que no existía, receta. Si es lo mismo pero junto, kit.",
      ],
    ],
  },
  {
    id: "h-etiquetas",
    tema: "herramientas",
    texto: "Etiquetas",
    estado: "contable",
    abrir: "etiquetas",
    variantes: [
      [
        "Etiquetas imprime los códigos de barras y los precios de tus productos.",
        "Sirve sobre todo para lo que no viene con código de fábrica: lo que empacas tú, lo que vendes a granel, lo que traes de un proveedor que no etiqueta.",
        "Con etiqueta propia, esos productos se cobran escaneando en vez de buscándolos a mano, que es donde se va el tiempo en una fila.",
      ],
      [
        "Es para generar etiquetas con código de barras y precio de los productos que no traen uno.",
        "El beneficio real está en la caja: escanear es más rápido y se equivoca menos que teclear un nombre con gente esperando.",
      ],
      [
        "Etiquetas te deja imprimir códigos propios para la mercancía que no los trae.",
        "Vale la pena para lo que vendes mucho y no tiene código: cada segundo que ahorras se multiplica por las veces que lo cobras al día.",
      ],
    ],
  },
  {
    id: "h-cotizaciones",
    tema: "herramientas",
    texto: "Cotizaciones",
    estado: "contable",
    abrir: "cotizaciones",
    variantes: [
      [
        "Cotizaciones arma un presupuesto sin que eso sea todavía una venta.",
        "Sirve cuando alguien pregunta cuánto le saldría algo y se lo va a pensar: guardas los precios, se los entregas, y si vuelve lo conviertes en venta sin capturar otra vez.",
        "Nada de esto descuenta inventario ni cuenta como ingreso hasta que se cobra de verdad.",
      ],
      [
        "Es para dar precios por adelantado a un cliente que todavía no compra.",
        "Queda guardada, se la puedes entregar, y si acepta se vuelve una venta sin volver a teclear nada.",
        "Mientras tanto no afecta tu inventario ni tus números: una cotización no es una venta.",
      ],
      [
        "Sirve para responder un '¿cuánto me costaría?' de forma formal y quedarte con el registro.",
        "Es especialmente útil si vendes a otros negocios o por volumen, donde casi nunca se compra en el primer contacto.",
      ],
    ],
  },
  {
    id: "h-proveedores",
    tema: "herramientas",
    texto: "Proveedores",
    estado: "contable",
    abrir: "proveedores",
    variantes: [
      [
        "Proveedores guarda a quién le compras cada cosa y en cuánto.",
        "Lo útil no es la lista de contactos: es que cuando te diga que algo se va a acabar, sepas de inmediato a quién llamarle y qué te costó la última vez.",
      ],
      [
        "Es tu directorio de a quién le compras, ligado a los productos que te surte.",
        "Sirve para no tener que acordarte de dónde salió cada cosa ni de cuánto pagaste, que es justo lo que se olvida cuando toca resurtir.",
      ],
      [
        "Aquí registras a quienes te surten y qué te surte cada uno.",
        "Es el complemento natural de cuando te aviso que algo se está acabando: saber qué resurtir sirve de poco si no sabes a quién pedírselo.",
      ],
    ],
  },
  {
    id: "h-lealtad",
    tema: "herramientas",
    texto: "Lealtad",
    estado: "contable",
    abrir: "lealtad",
    variantes: [
      [
        "Lealtad es el programa de puntos para tus clientes frecuentes: acumulan al comprar y lo cambian por descuento.",
        "Funciona mejor en negocios donde la gente vuelve seguido y hay competencia cerca. Si vendes algo que se compra una vez al año, aporta poco.",
      ],
      [
        "Sirve para premiar al que vuelve: cada compra suma puntos y esos puntos valen dinero en la siguiente.",
        "Conviene si tienes clientes habituales y alguien más vendiendo lo mismo a la vuelta. Si no, es mantenimiento sin recompensa.",
      ],
      [
        "Es el sistema de puntos: el cliente acumula comprando y los usa como descuento después.",
        "Su valor depende de que la gente vuelva. Piénsalo menos como un descuento y más como una razón para no cruzar la calle.",
      ],
    ],
  },
  {
    id: "h-credito",
    tema: "herramientas",
    texto: "Crédito (fiado)",
    estado: "contable",
    abrir: "credito",
    variantes: [
      [
        "Crédito es el fiado de toda la vida, pero anotado en serio.",
        "Registras a quién le fiaste y cuánto, y llevas el control de lo que te van abonando sin depender de un cuaderno.",
        "La ventaja no es la libreta digital: es que la venta fiada sí cuenta como venta, pero el dinero todavía no está en tu cajón — y esas dos cosas dejan de confundirse.",
      ],
      [
        "Sirve para llevar el fiado con nombre, monto y abonos.",
        "Lo importante es que el sistema distingue entre lo que vendiste y lo que ya cobraste. En un negocio que fía, confundir esas dos cifras es la forma más común de creer que te va mejor de lo que te va.",
      ],
      [
        "Aquí llevas a quién le debes fiar y cuánto te deben, con sus abonos.",
        "Te evita el cuaderno y, sobre todo, te evita contar como dinero disponible algo que todavía está en la calle.",
      ],
    ],
  },
  {
    id: "h-tienda",
    tema: "herramientas",
    texto: "Tienda en línea",
    estado: "contable",
    abrir: "tienda",
    variantes: [
      [
        "La tienda en línea publica tu catálogo en una página propia para que tus clientes vean y pidan.",
        "Los pedidos te llegan al punto de venta, así que no hay que capturarlos otra vez ni llevar dos inventarios.",
      ],
      [
        "Es tu catálogo publicado en internet, con los mismos productos y precios que ya tienes cargados.",
        "Lo que pidan entra directo al sistema, no a un chat que después hay que transcribir a mano.",
      ],
      [
        "Sirve para vender sin que el cliente tenga que estar en el mostrador: ve tu catálogo y hace el pedido.",
        "Como sale de tu mismo inventario, no acabas con dos listas de productos que se contradicen.",
      ],
    ],
  },
  {
    id: "h-corte",
    tema: "herramientas",
    texto: "Corte de caja",
    estado: "contable",
    abrir: "caja",
    variantes: [
      [
        "El corte cierra el turno: compara el efectivo que debería haber según lo vendido contra el que de verdad está en el cajón.",
        "La diferencia entre esos dos números es toda la información que da. Si sobra o falta seguido, ahí hay algo que revisar.",
      ],
      [
        "Sirve para cerrar el día o el turno y cuadrar el cajón.",
        "El sistema sabe cuánto debería haber en efectivo; tú cuentas lo que hay; la diferencia queda registrada.",
        "Hacerlo por turno y no solo al final del día es lo que permite saber en qué momento apareció un faltante.",
      ],
      [
        "Es el cierre de caja: lo esperado contra lo contado.",
        "Su utilidad está en la constancia. Un corte suelto no dice nada; hacerlo siempre convierte cualquier descuadre en una señal en lugar de una sospecha.",
      ],
    ],
  },
  {
    id: "h-dinero",
    tema: "herramientas",
    texto: "Dinero",
    estado: "contable",
    abrir: "dinero",
    variantes: [
      [
        "Dinero lleva lo que gastas y lo que te llevas, no lo que vendes.",
        "Tiene dos libros: el del negocio (renta, luz, mercancía, sueldos) y el personal. Un retiro para ti sale del negocio y entra en tu libro personal.",
        "Por eso puede contestarte algo que las ventas solas no contestan: cuánto te dejó de verdad el negocio a ti.",
      ],
      [
        "Es donde se registran gastos y retiros, separando lo del negocio de lo tuyo.",
        "Vender mucho y que no te quede nada es la historia más común en un negocio chico, y sin registrar gastos no hay forma de ver por dónde se fue.",
      ],
      [
        "Aquí anotas lo que sale: gastos fijos, compras, lo que te retiras.",
        "Cruzado con tus ventas, es lo que convierte 'vendí $80,000 este mes' en 'me quedaron $9,400'. Esa segunda cifra es la que importa.",
      ],
    ],
  },
  {
    id: "h-nube",
    tema: "herramientas",
    texto: "La nube",
    estado: "contable",
    variantes: [
      [
        "La nube guarda una copia de tu información fuera de este aparato y la mantiene igual en todos los que uses.",
        "Sirve para dos cosas: que si se pierde o se rompe el equipo no pierdas tu negocio con él, y que el teléfono y la computadora vean lo mismo.",
        "El punto de venta funciona completo sin nube. Esto es respaldo y sincronización, no permiso para operar.",
      ],
      [
        "Es el respaldo y la sincronización entre tus dispositivos.",
        "Sin ella todo sigue funcionando, pero tu información vive solo en este aparato — y los aparatos se pierden, se mojan y se caen.",
      ],
      [
        "Mantiene tu catálogo, tus ventas y tus clientes respaldados y en sintonía entre la computadora y el teléfono.",
        "No la necesitas para vender. La necesitas el día que algo le pase al equipo.",
      ],
    ],
  },

  // ===== CÓMO HAGO… =====
  {
    id: "c-iva",
    tema: "comohago",
    texto: "Mis precios ya traen IVA",
    estado: "contable",
    variantes: [
      [
        "Así está pensado. El precio que capturas es el que el cliente paga: el impuesto va incluido dentro, no se suma aparte al cobrar.",
        "Si pones $25, el ticket dice $25. El sistema calcula por dentro qué parte de esos $25 es impuesto.",
        "Es como funciona el mostrador en México, y evita el error clásico de capturar precios sin IVA y cobrar de menos todo el día sin notarlo.",
      ],
      [
        "El precio que escribes es el precio final. El impuesto ya está considerado dentro de esa cifra, no se agrega encima.",
        "Tú capturas lo que quieres cobrar y eso es exactamente lo que se cobra.",
      ],
      [
        "Los precios se manejan con el impuesto incluido: lo que capturas es lo que paga el cliente.",
        "Internamente se separa la parte que corresponde al impuesto, pero eso no cambia ni el precio de la etiqueta ni el del ticket.",
      ],
    ],
  },
  {
    id: "c-importar",
    tema: "comohago",
    texto: "Traer mi catálogo de otro programa",
    estado: "contable",
    abrir: "existencias",
    variantes: [
      [
        "Se puede traer el catálogo desde otro punto de venta o desde un archivo, para no capturar cientos de productos a mano.",
        "Lo que conviene revisar después de importar son los costos: son los que más se pierden en el camino, y sin costo no hay margen que yo pueda calcularte.",
      ],
      [
        "Hay forma de importar tus productos en vez de capturarlos uno por uno.",
        "Después de traerlos, dale una revisada a los costos. Es lo que más suele llegar incompleto, y es justo el dato del que depende todo lo que te diga de ganancia.",
      ],
      [
        "El catálogo se puede migrar desde otro sistema para no empezar de cero.",
        "Mi consejo después de importar: revisa costos y códigos de barras. Los precios casi siempre llegan bien; esos dos, no siempre.",
      ],
    ],
  },
  {
    id: "c-sininternet",
    tema: "comohago",
    texto: "¿Y si me quedo sin internet?",
    estado: "reposo",
    variantes: [
      [
        "No pasa nada: el punto de venta funciona completo sin internet. Cobras, imprimes tickets y consultas tu inventario igual.",
        "Lo único que espera es la sincronización con la nube, que se pone al día sola cuando vuelve la conexión.",
        "Yo también sigo funcionando sin internet: todo lo que te digo sale de la información que está en este aparato.",
      ],
      [
        "El programa está hecho para trabajar sin conexión. Vender no depende de internet en ningún momento.",
        "Lo que se queda esperando es el respaldo en la nube, y se pone al corriente solo cuando vuelve la señal.",
      ],
      [
        "Puedes seguir vendiendo con normalidad. La conexión hace falta para respaldar y sincronizar, no para cobrar.",
        "Cuando vuelve, se sube lo que quedó pendiente sin que tengas que hacer nada.",
      ],
    ],
  },
  {
    id: "c-empleado",
    tema: "comohago",
    texto: "Que mi empleado no vea mis ganancias",
    estado: "contable",
    variantes: [
      [
        "Se resuelve con el rol del usuario. Un cajero puede vender, cobrar y consultar productos, pero no ve reportes, márgenes ni ganancias.",
        "No es que se le escondan de la vista: el sistema no le entrega esos datos aunque llegue por otro camino.",
        "A mí tampoco me puede preguntar por márgenes: yo consulto lo mismo que Reportes y heredo los mismos permisos.",
      ],
      [
        "Cada usuario tiene un rol, y el de cajero no incluye ver ganancias ni reportes.",
        "La restricción está en el fondo, no solo en lo que se muestra, así que no hay forma de rodearla desde la interfaz.",
      ],
      [
        "Dándole a tu empleado un usuario de cajero. Vende y cobra con normalidad, pero los números de ganancia no son parte de lo que puede consultar.",
        "Eso incluye preguntarme a mí: si no tiene permiso de reportes, yo tampoco se los doy.",
      ],
    ],
  },

  // ===== SOBRE YAXO =====
  {
    id: "y-quepuedes",
    tema: "yaxo",
    texto: "¿Qué puedes hacer?",
    estado: "feliz",
    variantes: [
      [
        "Te ayudo a entender tu negocio con los datos que ya tiene el punto de venta.",
        "Puedo decirte cómo van tus ventas, qué conviene resurtir y por qué, qué mercancía llevas tiempo sin mover, y si tus precios van acordes al resto de tu departamento.",
        "También te explico para qué sirve cada herramienta del programa, que es de lo que menos se entera la gente.",
        "Lo que no hago es adivinar: si los datos no alcanzan para afirmar algo, te lo digo en vez de inventarlo.",
      ],
      [
        "Leo lo que ya está en tu punto de venta y te lo explico en palabras.",
        "Ventas por periodo, qué resurtir con el número detrás, inventario parado, comparación de márgenes dentro de cada departamento, y explicaciones de las herramientas del programa.",
        "Siempre te digo de dónde sale cada cifra. Un consejo sin el dato que lo sostiene no sirve de nada.",
      ],
      [
        "Contesto preguntas sobre tu negocio usando tus propios números.",
        "Cómo vas, qué se te va a acabar, qué está dormido en el estante, si estás cobrando parecido a lo que cobras en productos similares, y cómo funciona cada parte del programa.",
        "Y cuando no puedo responder con certeza, prefiero decírtelo a darte un número bonito que no sostiene nada.",
      ],
    ],
  },
  {
    id: "y-dedonde",
    tema: "yaxo",
    texto: "¿De dónde sacas los números?",
    estado: "contable",
    variantes: [
      [
        "De tus propias ventas y tu inventario, guardados en este aparato. No los inventa nadie ni salen de internet.",
        "Uso exactamente el mismo cálculo que la pantalla de Reportes. Está hecho a propósito: si yo calculara por mi cuenta acabarías con dos cifras distintas del mismo día y ninguna de las dos sería confiable.",
        "Por eso, si algo no te cuadra conmigo, tampoco cuadrará en Reportes — y eso es una pista útil, no una casualidad.",
      ],
      [
        "Todo sale de lo que el punto de venta ya registró: tus ventas, tus devoluciones, tu inventario.",
        "Las cifras las pido a la misma parte del programa que alimenta Reportes, no las calculo aparte. Una sola forma de contar para todo el sistema.",
      ],
      [
        "De tu información, la que está en este equipo. Nada viene de fuera.",
        "Y no hago mis propias cuentas de ventas: le pregunto al mismo lugar que responde en Reportes, para que nunca te diga una cosa una pantalla y otra cosa yo.",
      ],
    ],
  },
  {
    id: "y-nomargen",
    tema: "yaxo",
    texto: "¿Por qué a veces no me dices mi ganancia?",
    estado: "pensativo",
    variantes: [
      [
        "Porque para saber lo que ganaste hace falta saber lo que te costó, y no todos tus productos tienen costo capturado.",
        "Lo que falta no es cero: es desconocido, y son cosas muy distintas. Si tratara como gratis lo que no tiene costo, tu ganancia saldría más alta de lo que es y tomarías decisiones con un número inflado.",
        "Se arregla capturando el costo de lo que más vendes. No hace falta todo el catálogo para que la cifra empiece a ser confiable.",
      ],
      [
        "Porque falta el costo de parte de lo que vendiste, y sin costo no hay ganancia que calcular.",
        "Prefiero decirte que no lo sé a darte una cifra que parece buena porque le faltan gastos.",
        "Con capturar el costo de tus productos más vendidos, la mayor parte del problema se resuelve.",
      ],
      [
        "Me falta el costo de algunos productos. Y un margen calculado a medias no es un margen aproximado: es un número equivocado con apariencia de exacto.",
        "Empieza por los que más salen. Esos pesan casi todo en el cálculo.",
      ],
    ],
  },
  {
    id: "y-teequivocas",
    tema: "yaxo",
    texto: "¿Te equivocas alguna vez?",
    estado: "pensativo",
    variantes: [
      [
        "Sí. Sobre todo cuando llevas pocos días usando el programa o cuando falta información.",
        "Con tres días de ventas no hay tendencia que valga: un martes flojo y un sábado bueno dan un porcentaje enorme que no describe nada. Por eso en esos casos prefiero no hablar de subidas ni bajadas.",
        "Si algo no te cuadra con lo que ves en tu tienda, hazme caso a ti y no a mí. Y avísale a Arturo, que para eso está la beta.",
      ],
      [
        "Claro que sí. Mis consejos dependen de que tu información esté completa y de que haya suficiente historia para comparar.",
        "Cuando sé que los datos no alcanzan, te lo digo en vez de rellenar el hueco. Pero puedo equivocarme sin darme cuenta si el inventario no refleja la realidad.",
        "Tú conoces tu negocio mejor que yo. Si algo suena raro, probablemente lo sea.",
      ],
      [
        "Sí, y las dos causas habituales son pocas ventas registradas todavía, o un inventario que no coincide con el estante.",
        "Yo solo veo lo que está capturado. Si lo capturado no es la realidad, mis conclusiones tampoco lo serán.",
        "Por eso te doy siempre el número de dónde salgo: para que puedas comprobarlo tú en vez de creerme.",
      ],
    ],
  },
];

// NOTA: aquí había un export `TODAS` que juntaba las dos listas con concat().
// Se quitó porque TypeScript infiere tipos distintos para cada una (las de
// datos llevan `pantallas`, las escritas llevan `variantes`) y rechaza la
// unión sin una anotación. Y una anotación rompería lo único que hace valioso
// a este archivo: que el mismo texto sea TypeScript y JavaScript válido a la
// vez, para poder copiarlo literal entre los dos proyectos.
//
// Ninguna plataforma lo necesitaba: las dos listas se resuelven distinto (una
// consulta la base, la otra lee texto de aquí), así que recorrerlas juntas no
// servía de nada. Si algún día hace falta, se hace en cada plataforma con su
// propio tipo, no aquí.
