// YvexPOS Móvil — Layout raíz.
// Envuelve la app con el proveedor de tema: al cambiar el tema en
// Configuración, toda la interfaz reacciona al instante.
//
// Puerta de arranque: antes de mostrar nada se resuelve si toca el
// onboarding (instalación nueva) o la app (ya configurada). El usuario
// nuevo no ve las pestañas hasta terminar; el existente nunca ve el
// asistente.

import { useEffect, useState } from "react";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import "react-native-reanimated";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { TemaProvider, useTema } from "@/src/componentes/TemaProvider";
import { resolverEstadoInicial } from "@/src/base/modoUso";


type EstadoInicial = "onboarding" | "app" | null;

function Contenido() {
  const { tema: T, listo } = useTema();
  const [estado, setEstado] = useState<EstadoInicial>(null);
  const [errorArranque, setErrorArranque] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true;
    resolverEstadoInicial()
      .then((e) => {
        if (vivo) {
          setEstado(e);
          setErrorArranque(null);
        }
      })
      .catch((e) => {
        // Sin catch, una base que aún no responde (p. ej. justo tras borrar
        // los datos de la app) dejaba la pantalla en blanco PARA SIEMPRE.
        // Reintenta solo un par de veces; si persiste, muestra el error con
        // botón de reintento en vez de congelarse.
        if (!vivo) return;
        if (intento < 2) {
          setTimeout(() => {
            if (vivo) setIntento((i) => i + 1);
          }, 800);
        } else {
          setErrorArranque(e?.message ?? String(e));
        }
      });
    return () => {
      vivo = false;
    };
  }, [intento]);

  // Con temas claros la navegación parte de DefaultTheme (fondos/textos
  // claros) y la barra de estado usa texto oscuro; con oscuros, como siempre.
  const navBase = T.esClaro ? DefaultTheme : DarkTheme;
  const navTema = {
    ...navBase,
    colors: {
      ...navBase.colors,
      background: T.fondo,
      card: T.superficie,
      border: T.borde,
      text: T.texto,
      primary: T.acento,
    },
  };

  // Evita el destello del tema por defecto antes de leer las preferencias
  // y de decidir si toca onboarding o app.
  if (!listo || estado === null) {
    if (errorArranque) {
      return (
        <View
          style={{
            flex: 1,
            backgroundColor: T.fondo,
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
          }}
        >
          <Text style={{ color: T.texto, fontSize: 17, fontWeight: "700", textAlign: "center" }}>
            No se pudo abrir la base de datos
          </Text>
          <Text style={{ color: T.textoTenue, fontSize: 13, textAlign: "center", marginTop: 10 }}>
            {errorArranque}
          </Text>
          <Text
            onPress={() => {
              setErrorArranque(null);
              setIntento(0);
            }}
            style={{ color: T.acento, fontSize: 15, fontWeight: "700", marginTop: 24 }}
          >
            Reintentar
          </Text>
        </View>
      );
    }
    return <View style={{ flex: 1, backgroundColor: T.fondo }} />;
  }

  return (
    <ThemeProvider value={navTema}>
      <Stack
        initialRouteName={estado === "onboarding" ? "onboarding" : "(tabs)"}
        screenOptions={{ contentStyle: { backgroundColor: T.fondo } }}
      >
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style={T.esClaro ? "dark" : "light"} />
    </ThemeProvider>
  );
}

// El GestureHandlerRootView envuelve TODA la app: es requisito de
// react-native-gesture-handler para que los gestos (pellizcar/arrastrar del
// recortador de fotos, entre otros) funcionen en cualquier pantalla.
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <TemaProvider>
        <Contenido />
      </TemaProvider>
    </GestureHandlerRootView>
  );
}