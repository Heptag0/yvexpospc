// YvexPOS Móvil — Visual del producto.
//
// Jerarquía: foto propia → icono vectorial del departamento → inicial.
// El PACK elegido en Configuración decide el estilo del icono (trazo, sólido)
// o si se muestra solo la inicial.

import { View, Text, Image, StyleSheet } from "react-native";
import { Icono } from "@/src/componentes/iconos";
import { useTema } from "@/src/componentes/TemaProvider";

export default function ImagenProducto({
  uri,
  nombre,
  color,
  icono,
  size = 46,
  radio = 12,
}: {
  uri: string | null;
  nombre: string;
  color?: string | null;
  icono?: string | null;
  size?: number;
  radio?: number;
}) {
  const { prefs, tema: T } = useTema();

  // 1. Foto propia — siempre gana.
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{
          width: size,
          height: size,
          borderRadius: radio,
          backgroundColor: T.superficie2,
        }}
      />
    );
  }

  const c = color ?? T.acento;
  const base = {
    width: size,
    height: size,
    borderRadius: radio,
    backgroundColor: c + "1e",
    borderColor: c + "4d",
  };

  // 2. Icono vectorial del departamento (según el pack).
  if (icono && prefs.pack !== "inicial") {
    return (
      <View style={[est.caja, base]}>
        <Icono
          id={icono}
          size={size * 0.52}
          color={c}
          relleno={prefs.pack === "solido"}
        />
      </View>
    );
  }

  // 3. Inicial.
  return (
    <View style={[est.caja, base]}>
      <Text style={[est.inicial, { color: c, fontSize: size * 0.4 }]}>
        {(nombre.trim()[0] ?? "?").toUpperCase()}
      </Text>
    </View>
  );
}

const est = StyleSheet.create({
  caja: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  inicial: { fontWeight: "800" },
});
