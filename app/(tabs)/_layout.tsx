// YvexPOS Móvil — Pestañas (Inicio · Vender · Inventario · Reportes · Ajustes).
// Iconos vectoriales, colores del tema activo.
//
// En modo "monitor" la pestaña Vender se oculta (este dispositivo no cobra).
// El modo se recarga al recuperar el foco: cambiarlo en Ajustes se refleja
// al volver.
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
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { IconoUI, IdUI } from "@/src/componentes/iconos";
import { useTema } from "@/src/componentes/TemaProvider";
import { leerModoUso, ModoUso } from "@/src/base/modoUso";
import { estadoTienda } from "@/src/base/tienda";

// Icono con indicador activo: una píldora pequeña bajo el icono. Ocupa el
// mismo alto esté o no activa -> el label nunca salta. Al activarse, el
// icono hace un pequeño resorte de escala (sutil, ~200 ms).
function IconoTab({
  id,
  color,
  focused,
  acento,
}: {
  id: IdUI;
  color: string;
  focused: boolean;
  acento: string;
}) {
  const escala = useSharedValue(1);
  const anchoPildora = useSharedValue(focused ? 14 : 0);

  useEffect(() => {
    escala.value = focused
      ? withSpring(1.14, { damping: 12, stiffness: 260, mass: 0.6 }, (fin) => {
          "worklet";
          if (fin) escala.value = withSpring(1, { damping: 14, stiffness: 220, mass: 0.6 });
        })
      : withTiming(1, { duration: 150 });
    anchoPildora.value = withTiming(focused ? 14 : 0, { duration: 180 });
  }, [focused, escala, anchoPildora]);

  const estiloIcono = useAnimatedStyle(() => ({
    transform: [{ scale: escala.value }],
  }));
  const estiloPildora = useAnimatedStyle(() => ({
    width: anchoPildora.value,
    opacity: anchoPildora.value / 14,
  }));

  return (
    <View style={{ alignItems: "center" }}>
      <Animated.View style={estiloIcono}>
        <IconoUI id={id} size={22} color={color} grosor={focused ? 2.1 : 1.7} />
      </Animated.View>
      <Animated.View
        style={[
          {
            width: 14,
            height: 3,
            borderRadius: 2,
            marginTop: 3,
            backgroundColor: acento,
          },
          estiloPildora,
        ]}
      />
    </View>
  );
}

export default function TabLayout() {
  const { tema: T } = useTema();
  const [modo, setModo] = useState<ModoUso>("ambos");
  const [pedidosNuevos, setPedidosNuevos] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      leerModoUso().then((m) => {
        if (vivo) setModo(m);
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
    <IconoTab id={id} color={color} focused={focused} acento={T.acento} />
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
          height: 66,
          paddingTop: 8,
          paddingBottom: 9,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "700", marginTop: 2 },
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
      <Tabs.Screen
        name="vender"
        options={{
          title: "Vender",
          tabBarIcon: icono("vender"),
          href: modo === "monitor" ? null : "/vender",
        }}
      />
      <Tabs.Screen name="inventario" options={{ title: "Inventario", tabBarIcon: icono("inventario") }} />
      <Tabs.Screen name="reportes" options={{ title: "Reportes", tabBarIcon: icono("reportes") }} />
      <Tabs.Screen name="ajustes" options={{ title: "Ajustes", tabBarIcon: icono("ajustes") }} />
    </Tabs>
  );
}
