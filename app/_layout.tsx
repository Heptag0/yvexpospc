// YvexPOS Móvil — Layout raíz.
// Envuelve la app con el proveedor de tema: al cambiar el tema en
// Configuración, toda la interfaz reacciona al instante.
//
// Puerta de arranque: antes de mostrar nada se resuelve (a) si las fuentes de
// marca ya cargaron y (b) si toca el onboarding (instalación nueva) o la app
// (ya configurada). El usuario nuevo no ve las pestañas hasta terminar; el
// existente nunca ve el asistente.
//
// ---------------------------------------------------------------------------
// FUENTES DE MARCA
// ---------------------------------------------------------------------------
// Dos familias con roles que NO se mezclan:
//   · Archivo       → toda la interfaz.
//   · IBM Plex Mono → EXCLUSIVO para cifras de dinero, con numeral tabular.
//
// Se cargan aquí, una sola vez, y se esperan antes de pintar: si se pintara
// antes, la app arrancaría con la fuente del sistema y saltaría de golpe al
// terminar la carga — el clásico destello que delata a una app sin terminar.
//
// Los pesos que se cargan son EXACTAMENTE los que usa el sistema de diseño
// (500 y 700, ver PESO en src/base/apariencia.ts). Cargar más pesos "por si
// acaso" solo engorda el arranque.
//
// Si algún día hay que revertir esto: poner FUENTES_CARGADAS = false en
// src/base/apariencia.ts y la app vuelve a la fuente del sistema sin tocar
// ninguna pantalla.

import { useEffect, useState } from "react";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import "react-native-reanimated";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useFonts } from "expo-font";
import { Archivo_500Medium, Archivo_700Bold } from "@expo-google-fonts/archivo";
import {
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
} from "@expo-google-fonts/ibm-plex-mono";
import { TemaProvider, useTema } from "@/src/componentes/TemaProvider";
import { resolverEstadoInicial } from "@/src/base/modoUso";

type EstadoInicial = "onboarding" | "app" | null;

function Contenido() {
  const { tema: T, listo } = useTema();
  const [estado, setEstado] = useState<EstadoInicial>(null);
  const [errorArranque, setErrorArranque] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  const [fuentesListas, errorFuentes] = useFonts({
    Archivo_500Medium,
    Archivo_700Bold,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });

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

  // Una fuente que no carga NO debe dejar la app en negro: es un problema
  // cosmético, no funcional. Se sigue adelante con la del sistema.
  const fuentesResueltas = fuentesListas || Boolean(errorFuentes);

  // Evita el destello del tema por defecto antes de leer las preferencias,
  // de cargar las fuentes y de decidir si toca onboarding o app.
  if (!listo || estado === null || !fuentesResueltas) {
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
//
// ---------------------------------------------------------------------------
// EL ORDEN DE ESTOS TRES PROVEEDORES NO ES ARBITRARIO
// ---------------------------------------------------------------------------
// 1. GestureHandlerRootView    — el más externo, requisito de la librería.
// 2. KeyboardProvider          — instala el observador nativo del teclado.
// 3. TemaProvider              — estado de React, puede ir dentro sin más.
//
// El KeyboardProvider va DENTRO del gesture root y FUERA de todo lo que
// dibuje pantallas, porque monta un observador a nivel de ventana: si
// estuviera por debajo del Stack solo vería el árbol de una pantalla y los
// componentes de teclado se comportarían como los de React Native — es decir,
// no pasaría nada y no habría ningún error que lo delatara.
//
// No lleva `statusBarTranslucent`/`navigationBarTranslucent`: con
// `edgeToEdgeEnabled: true` en app.json el modo ya es ese para toda la app, y
// repetirlo aquí solo añade una segunda fuente de verdad para lo mismo.
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <TemaProvider>
          <Contenido />
        </TemaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
