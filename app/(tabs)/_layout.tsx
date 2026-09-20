// YvexPOS Móvil — Pestañas (Inicio · Inventario · Vender · Reportes · Ajustes).
// Iconos vectoriales, colores del tema activo.
//
// En modo "monitor" la pestaña Vender se oculta (este dispositivo no cobra).
// El modo se recarga al recuperar el foco: cambiarlo en Ajustes se refleja
// al volver.
//
// ---------------------------------------------------------------------------
// Reportes se oculta para el CAJERO
// ---------------------------------------------------------------------------
// Reportes muestra ganancias y márgenes del negocio: información que un dueño
// de tiendita normalmente no comparte con su empleado. El PC ya restringe lo
// equivalente con `exigir_rol`; el móvil no tenía NINGUNA comprobación de rol
// en toda la interfaz (ver permisos.ts).
//
// Se OCULTA en vez de mostrarse bloqueada, por dos razones: una pestaña con
// candado no enseña nada y solo frustra, y la app ya usa exactamente este
// patrón (`href: null`) para Vender en modo monitor — es coherente en vez de
// introducir un concepto nuevo.
//
// Ocultar la pestaña es CORTESÍA, no seguridad: quien de verdad protege es
// `exigirPermiso()` en la capa de datos. Si alguien llegara a la ruta por
// otro camino, la pantalla se queda sin datos que mostrar.
//
// El permiso se recarga al enfocar, igual que el modo: cambiar de usuario en
// Ajustes se refleja al volver.
//
// Transición entre pestañas: "shift" (desplazamiento lateral suave, nativo de
// React Navigation v7). No afecta la cámara: el escáner es un modal DENTRO de
// Vender, no otra pestaña, y Vender conserva su estado (las pantallas de las
// pestañas quedan montadas).
//
// ---------------------------------------------------------------------------
// backBehavior="history"
// ---------------------------------------------------------------------------
// Sin esto, el botón/gesto Atrás de Android caía al comportamiento por
// defecto del navegador de pestañas, que no es "vuelve por donde viniste"
// sino saltar directo a la pestaña inicial — sin importar en cuál estuvieras.
// Con "history" el sistema recuerda el ORDEN en que se visitaron las
// pestañas y Atrás las deshace una por una, que es lo que cualquiera espera
// de un botón que dice "atrás".
//
// Esto es complementario al BackHandler local de pantallas como Vender: ahí
// se cierra primero lo que hay abierto DENTRO de la pestaña (un departamento,
// una búsqueda) antes de que el evento llegue hasta aquí y cambie de pestaña.
//
// ---------------------------------------------------------------------------
// tabBarBadge en Inicio — pedidos web nuevos
// ---------------------------------------------------------------------------
// React Navigation ya trae badges nativos en la barra de pestañas — no hace
// falta inventar una insignia propia. `tabBarBadge` acepta directamente el
// número a mostrar; con `undefined` no pinta nada. La consulta es la misma
// `estadoTienda()` que ya usa Inicio para su propio badge dentro del panel
// de Herramientas — aquí se repite intencionalmente (no se comparte estado
// entre archivos) porque es una consulta ligera y evita construir un store
// global solo para un número.

import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Tabs, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { IconoUI, IdUI } from "@/src/componentes/iconos";
import { useTema } from "@/src/componentes/TemaProvider";
import { leerModoUso, ModoUso } from "@/src/base/modoUso";
import { puede } from "@/src/base/permisos";
import { estadoTienda } from "@/src/base/tienda";

// Icono de pestaña.
//
// ---------------------------------------------------------------------------
// POR QUÉ CAMBIÓ EL INDICADOR
// ---------------------------------------------------------------------------
// Antes era una píldora de 3px bajo el icono. Funcionaba, pero era un
// elemento que no existe en ninguna otra parte de la app: un lenguaje visual
// propio solo para la barra, y de los más vistos en cualquier app de
// cualquiera.
//
// Ahora el icono activo se mete en un cuadrado redondeado tintado al acento
// (`acentoSuave` + `radioChico`) — EXACTAMENTE el mismo tratamiento que ya
// llevan los iconos de "Tus accesos" en Inicio y las filas del panel de
// Herramientas. La barra deja de ser una pieza aparte y pasa a hablar el
// idioma del producto.
//
// El hueco mide lo mismo esté activa o no, así que la etiqueta nunca salta.
function IconoTab({
  id,
  color,
  focused,
  acentoSuave,
  radio,
}: {
  id: IdUI;
  color: string;
  focused: boolean;
  acentoSuave: string;
  radio: number;
}) {
  const escala = useSharedValue(1);
  const tinte = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    escala.value = focused
      ? withSpring(1.1, { damping: 12, stiffness: 260, mass: 0.6 }, (fin) => {
          "worklet";
          if (fin) escala.value = withSpring(1, { damping: 14, stiffness: 220, mass: 0.6 });
        })
      : withTiming(1, { duration: 150 });
    tinte.value = withTiming(focused ? 1 : 0, { duration: 180 });
  }, [focused, escala, tinte]);

  const estiloIcono = useAnimatedStyle(() => ({
    transform: [{ scale: escala.value }],
  }));
  const estiloCapsula = useAnimatedStyle(() => ({
    opacity: tinte.value,
  }));

  return (
    <View
      style={{
        width: 46,
        height: 32,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* La cápsula se pinta detrás y solo se desvanece: animar la opacidad
          es mucho más barato que animar color de fondo, y en gama baja la
          diferencia se nota al cambiar de pestaña. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: radio + 2,
            backgroundColor: acentoSuave,
          },
          estiloCapsula,
        ]}
      />
      <Animated.View style={estiloIcono}>
        <IconoUI id={id} size={22} color={color} grosor={focused ? 2.1 : 1.7} />
      </Animated.View>
    </View>
  );
}

export default function TabLayout() {
  const { tema: T } = useTema();
  // LA BARRA DEL SISTEMA TAPABA LAS PESTAÑAS CON NAVEGACIÓN POR BOTONES
  // ---------------------------------------------------------------------------
  // `edgeToEdgeEnabled: true` en app.json hace que la app dibuje DEBAJO de la
  // barra de navegación de Android. La altura de esa barra depende de cómo
  // navegue cada quien:
  //
  //   - Con gestos (la barrita): unos 16 dp. La barra de pestañas se veía bien
  //     y por eso el problema no salió en pruebas.
  //   - Con los tres botones: unos 48 dp. Los botones del sistema quedaban
  //     encima de los iconos y las etiquetas, y en algunos teléfonos tapaban
  //     la pestaña entera.
  //
  // Con altura y padding FIJOS no hay forma de acertar: son valores distintos
  // por dispositivo y el usuario puede cambiar de modo en cualquier momento.
  // `useSafeAreaInsets` devuelve el alto real de ESTE teléfono AHORA, así que
  // la barra crece justo lo necesario y ni un pixel más.
  const insets = useSafeAreaInsets();
  const [modo, setModo] = useState<ModoUso>("ambos");
  const [pedidosNuevos, setPedidosNuevos] = useState(0);
  // Arranca en `false`: si el permiso tarda en resolverse, es preferible NO
  // mostrar la pestaña un instante a mostrarla y esconderla después.
  const [verReportes, setVerReportes] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      leerModoUso().then((m) => {
        if (vivo) setModo(m);
      });
      puede("verReportes")
        .then((ok) => {
          if (vivo) setVerReportes(ok);
        })
        .catch(() => {
          if (vivo) setVerReportes(false); // ante la duda, no mostrar
        });
      // Tolerante a offline / sin cuenta: si falla, el badge simplemente no
      // aparece — nunca debe romper la navegación por un pedido que no cargó.
      estadoTienda()
        .then((r) => {
          if (vivo) setPedidosNuevos(r?.num_pedidos_nuevos ?? 0);
        })
        .catch(() => {
          if (vivo) setPedidosNuevos(0);
        });
      return () => {
        vivo = false;
      };
    }, [])
  );

  const icono = (id: IdUI) => ({ color, focused }: { color: string; focused: boolean }) => (
    <IconoTab
      id={id}
      color={color}
      focused={focused}
      acentoSuave={T.acentoSuave}
      radio={T.radioChico}
    />
  );

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        animation: "shift",
        tabBarActiveTintColor: T.acento,
        tabBarInactiveTintColor: T.textoTenue,
        tabBarStyle: {
          backgroundColor: T.superficie,
          borderTopColor: T.borde,
          borderTopWidth: StyleSheet.hairlineWidth,
          // 68 es el alto de la barra en sí; el inset se SUMA para que el
          // contenido quede por encima de los botones del sistema en vez de
          // debajo. Con gestos el inset es casi cero y todo se ve igual que
          // antes; con botones la barra crece y deja de taparse.
          height: 68 + insets.bottom,
          paddingTop: 7,
          paddingBottom: 9 + insets.bottom,
        },
        // ⚠️ `fontFamily` FALTABA. Sin él, React Navigation cae a la fuente
        // del sistema (Roboto en Android) y la barra de pestañas era el ÚNICO
        // sitio de toda la app que no usaba Archivo. Cinco palabras en otra
        // tipografía, siempre a la vista, en el borde inferior de cada
        // pantalla: bastaba para que la barra se sintiera de otra aplicación
        // sin poder señalar por qué.
        //
        // Peso 500 en vez de 700: a 11px, la negrita cierra los contornos y
        // se lee emborronada. El estado activo ya lo comunican el color y la
        // cápsula — no hace falta que además grite.
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: T.fuente.ui,
          fontWeight: "500",
          letterSpacing: 0.1,
          marginTop: 3,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Inicio",
          tabBarIcon: icono("inicio"),
          tabBarBadge: pedidosNuevos > 0 ? pedidosNuevos : undefined,
          tabBarBadgeStyle: { backgroundColor: T.peligro },
        }}
      />
      {/* ORDEN DE LAS PESTAÑAS: Vender va en el CENTRO, no Inventario.
          Vender es lo que se toca cien veces al día; Inventario, tres o
          cuatro. El centro de la barra es donde cae el pulgar sin mover la
          mano, así que le corresponde a la acción que de verdad se repite. */}
      <Tabs.Screen name="inventario" options={{ title: "Inventario", tabBarIcon: icono("inventario") }} />
      <Tabs.Screen
        name="vender"
        options={{
          title: "Vender",
          tabBarIcon: icono("vender"),
          href: modo === "monitor" ? null : "/vender",
        }}
      />
      <Tabs.Screen
        name="reportes"
        options={{
          title: "Reportes",
          tabBarIcon: icono("reportes"),
          href: verReportes ? "/reportes" : null,
        }}
      />
      <Tabs.Screen name="ajustes" options={{ title: "Ajustes", tabBarIcon: icono("ajustes") }} />
    </Tabs>
  );
}
