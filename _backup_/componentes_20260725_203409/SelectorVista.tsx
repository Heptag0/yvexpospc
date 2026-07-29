// YvexPOS Móvil — Selector de vista (lista / cuadrícula 2, 3 o 4).

import { View, Pressable, StyleSheet } from "react-native";
import { IconoUI, IdUI } from "@/src/componentes/iconos";
import { useTema } from "@/src/componentes/TemaProvider";

export type Vista = "lista" | "grid2" | "grid3" | "grid4";

export function columnasDe(v: Vista): number {
  if (v === "lista") return 1;
  if (v === "grid2") return 2;
  if (v === "grid4") return 4;
  return 3;
}

const OPCIONES: { id: Vista; icono: IdUI }[] = [
  { id: "lista", icono: "lista" },
  { id: "grid2", icono: "grid2" },
  { id: "grid3", icono: "grid3" },
  { id: "grid4", icono: "grid4" },
];

export default function SelectorVista({
  vista,
  onCambio,
}: {
  vista: Vista;
  onCambio: (v: Vista) => void;
}) {
  const { tema: T } = useTema();
  return (
    <View
      style={[
        est.caja,
        { backgroundColor: T.superficie2, borderColor: T.borde },
      ]}
    >
      {OPCIONES.map((o) => {
        const activo = vista === o.id;
        return (
          <Pressable
            key={o.id}
            onPress={() => onCambio(o.id)}
            style={[est.btn, activo && { backgroundColor: T.acento }]}
          >
            <IconoUI
              id={o.icono}
              size={15}
              color={activo ? T.acentoTexto : T.textoTenue}
              grosor={activo ? 2 : 1.7}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const est = StyleSheet.create({
  caja: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    padding: 3,
    gap: 2,
  },
  btn: {
    width: 32,
    height: 28,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
});
