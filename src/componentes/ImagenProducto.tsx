// YvexPOS Móvil — Visual del producto.
//
// Jerarquía: foto propia → icono vectorial del departamento → medallón neutro.
// El PACK elegido en Configuración decide el estilo del icono de departamento
// (trazo, sólido) o si se salta directo al medallón.
//
// ---------------------------------------------------------------------------
// LA FORMA ES SEMÁNTICA
// ---------------------------------------------------------------------------
// Cuadrado redondeado = el producto tiene identidad real: una foto o un
// departamento con su color e icono.
// Círculo = todavía no tiene ninguna de las dos. Es un placeholder, no un
// error — la forma sola ya lo dice, sin necesitar texto ni color de alarma.
//
// ---------------------------------------------------------------------------
// POR QUÉ EL MEDALLÓN YA NO ES UNA LETRA GIGANTE EN COLOR DE ACENTO
// ---------------------------------------------------------------------------
// Nueve productos sin departamento ("Ballena", "Ballenon", "Bote"...)
// generaban nueve tiles con una "B" enorme en rosa saturado: un muro que se
// leía como error, no como catálogo. Intentar diferenciarlos con un color
// distinto por producto (hash del nombre) tampoco es la respuesta — con 40
// productos sin depto. eso es una ensalada de colores al azar, que se ve
// barato, no premium.
//
// La solución es la contraria: CALMA. El medallón usa tinta apagada
// (textoSuave) sobre superficie neutra, igual en todos. Dejan de competir
// por atención entre sí, y el nombre del producto —justo debajo— vuelve a
// ser lo que el ojo lee primero, que es como debería ser.
//
// ---------------------------------------------------------------------------
// FOTO CON RESPALDO
// ---------------------------------------------------------------------------
// Si la uri guardada ya no carga (archivo movido, corrupto, sin permiso),
// antes se rompía en silencio. Ahora cae automáticamente al siguiente nivel
// de la jerarquía en vez de mostrar un ícono de imagen rota.

import { memo, useState } from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { Icono } from "@/src/componentes/iconos";
import { useTema } from "@/src/componentes/TemaProvider";

function ImagenProductoBase({
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
  const [fotoFallo, setFotoFallo] = useState(false);

  // 1. Foto propia — gana siempre que cargue.
  if (uri && !fotoFallo) {
    return (
      <Image
        source={{ uri }}
        onError={() => setFotoFallo(true)}
        style={{
          width: size,
          height: size,
          borderRadius: radio,
          backgroundColor: T.superficie2,
        }}
      />
    );
  }

  // 2. Icono vectorial del departamento (según el pack elegido).
  if (icono && color && prefs.pack !== "inicial") {
    return (
      <View
        style={[
          est.caja,
          {
            width: size,
            height: size,
            borderRadius: radio,
            backgroundColor: color + "1e",
            borderColor: color + "4d",
          },
        ]}
      >
        <Icono id={icono} size={size * 0.52} color={color} relleno={prefs.pack === "solido"} />
      </View>
    );
  }

  // 3. Medallón neutro — placeholder deliberado, no error. Círculo, tinta
  //    apagada, igual para todos: no compite con el nombre por debajo.
  return (
    <View
      style={[
        est.caja,
        est.medallon,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: T.superficie2,
          borderColor: T.borde,
        },
      ]}
    >
      <Text style={[est.inicial, { color: T.textoSuave, fontSize: size * 0.36 }]}>
        {(nombre.trim()[0] ?? "?").toUpperCase()}
      </Text>
    </View>
  );
}

// Memoizado a propósito: se usa dentro de cuadrículas de decenas de
// productos. Sin esto, cada re-render de la lista (por ejemplo al cambiar
// una cantidad en el ticket) vuelve a montar todas las imágenes visibles.
const ImagenProducto = memo(ImagenProductoBase);
export default ImagenProducto;

const est = StyleSheet.create({
  caja: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  // Un pelín más discreto que el icono de departamento: es un placeholder,
  // no debe pesar tanto como algo que sí tiene identidad.
  medallon: { opacity: 0.9 },
  inicial: { fontWeight: "700" },
});