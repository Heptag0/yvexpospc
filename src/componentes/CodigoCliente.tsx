// YvexPOS Móvil — QR + código del cliente de lealtad.
//
// El QR se dibuja con react-native-svg (un Rect por módulo oscuro, quiet
// zone incluida) a partir de qrcodegen (Nayuki, MIT — src/base/qrcodegen.ts).
// Contenido: el código corto "YV-XXXXXX" del cliente; el cajero lo escanea
// con el mismo EscanerCamara de la app al cobrar.
//
// COLOR: los módulos van en el color de texto del tema SOBRE SUPERFICIE
// BLANCA FIJA (#FFFFFF), aunque el tema sea oscuro. Es la excepción
// justificada a "todo sale del tema": un QR debe ESCANEARSE, y los lectores
// fallan con fondos oscuros o contraste invertido. La tarjeta que lo rodea
// sí respeta el tema.

import { useMemo } from "react";
import { View, Text } from "react-native";
import Svg, { Rect } from "react-native-svg";
import qrcodegen from "@/src/base/qrcodegen";
import { useTema } from "@/src/componentes/TemaProvider";

// Quiet zone estándar: 4 módulos de margen en blanco alrededor del código.
const QUIET = 4;

export default function CodigoCliente({
  codigo,
  size = 210,
}: {
  codigo: string;
  size?: number;
}) {
  const { tema: T } = useTema();

  const modulos = useMemo(() => {
    const qr = qrcodegen.QrCode.encodeText(
      codigo,
      qrcodegen.QrCode.Ecc.MEDIUM
    );
    const n = qr.size;
    const rects: { x: number; y: number }[] = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (qr.getModule(x, y)) rects.push({ x: x + QUIET, y: y + QUIET });
      }
    }
    return { rects, total: n + QUIET * 2 };
  }, [codigo]);

  const celda = size / modulos.total;

  return (
    <View style={{ alignItems: "center" }}>
      {/* Superficie blanca fija: el QR debe escanearse en cualquier tema. */}
      <View
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 14,
          padding: 12,
          borderWidth: 1,
          borderColor: T.borde,
        }}
      >
        <Svg width={size} height={size}>
          {modulos.rects.map((r, i) => (
            <Rect
              key={i}
              x={r.x * celda}
              y={r.y * celda}
              width={celda + 0.3}
              height={celda + 0.3}
              fill="#111111"
            />
          ))}
        </Svg>
      </View>
      <Text
        style={{
          color: T.texto,
          fontSize: 22,
          fontWeight: "900",
          letterSpacing: 2,
          fontFamily: "monospace",
          marginTop: 12,
          fontVariant: ["tabular-nums"],
        }}
      >
        {codigo}
      </Text>
      <Text
        style={{
          color: T.textoTenue,
          fontSize: 12,
          marginTop: 4,
          textAlign: "center",
        }}
      >
        Que el cliente lo enseñe y tú lo escaneas al cobrar
      </Text>
    </View>
  );
}
