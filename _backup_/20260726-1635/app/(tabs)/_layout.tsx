// YvexPOS Móvil — Pestañas (Inicio · Vender · Inventario · Reportes · Ajustes).
// Iconos vectoriales, colores del tema activo.
//
// En modo "monitor" la pestaña Vender se oculta (este dispositivo no cobra).
// El modo se recarga al recuperar el foco: cambiarlo en Ajustes se refleja
// al volver.

import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Tabs, useFocusEffect } from "expo-router";
import { IconoUI, IdUI } from "@/src/componentes/iconos";
import { useTema } from "@/src/componentes/TemaProvider";
import { leerModoUso, ModoUso } from "@/src/base/modoUso";

export default function TabLayout() {
  const { tema: T } = useTema();
  const [modo, setModo] = useState<ModoUso>("ambos");

  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      leerModoUso().then((m) => {
        if (vivo) setModo(m);
      });
      return () => {
        vivo = false;
      };
    }, [])
  );

  // Icono con indicador activo: una píldora pequeña bajo el icono. Ocupa el
  // mismo alto esté o no activa -> el label nunca salta.
  const icono = (id: IdUI) => ({ color, focused }: { color: string; focused: boolean }) => (
    <View style={{ alignItems: "center" }}>
      <IconoUI id={id} size={22} color={color} grosor={focused ? 2.1 : 1.7} />
      <View
        style={{
          width: 14,
          height: 3,
          borderRadius: 2,
          marginTop: 3,
          backgroundColor: focused ? T.acento : "transparent",
        }}
      />
    </View>
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
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
      <Tabs.Screen name="index" options={{ title: "Inicio", tabBarIcon: icono("inicio") }} />
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
