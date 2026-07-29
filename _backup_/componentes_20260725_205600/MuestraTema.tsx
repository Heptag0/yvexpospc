// YvexPOS Móvil — Muestra de tema (mini-mock de la app).
//
// Dibuja una versión en miniatura de la interfaz con la paleta de cada tema:
// fondo, barra superior, una tarjeta interior y una píldora con el color de
// acento. Se usa en el onboarding y en Ajustes > Apariencia para que elegir
// tema sea ver la app, no adivinar tres círculos.

import { View } from "react-native";
import { Paleta } from "@/src/base/apariencia";

export default function MuestraTema({
  paleta,
  acentoColor,
  esClaro,
}: {
  paleta: Paleta;
  acentoColor: string;
  esClaro: boolean;
}) {
  return (
    <View
      style={{
        width: 96,
        height: 64,
        borderRadius: 12,
        overflow: "hidden",
        borderWidth: 1,
        // En temas claros el borde de la paleta casi no se ve sobre la
        // tarjeta contenedora; se refuerza un punto.
        borderColor: esClaro ? paleta.bordeFuerte : paleta.borde,
        backgroundColor: paleta.fondo,
      }}
    >
      {/* Barra superior */}
      <View
        style={{
          height: 13,
          backgroundColor: paleta.superficie,
          borderBottomWidth: 1,
          borderBottomColor: paleta.borde,
        }}
      />
      {/* Cuerpo con tarjeta interior */}
      <View style={{ flex: 1, padding: 6 }}>
        <View
          style={{
            flex: 1,
            borderRadius: 6,
            backgroundColor: paleta.superficie2,
            borderWidth: 1,
            borderColor: paleta.borde,
            padding: 5,
            justifyContent: "flex-end",
          }}
        >
          {/* Píldora de acento (el CTA de la mini-app) */}
          <View
            style={{
              height: 7,
              width: 30,
              borderRadius: 4,
              backgroundColor: acentoColor,
            }}
          />
        </View>
      </View>
    </View>
  );
}
