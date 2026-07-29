// YvexPOS Móvil — Componentes de interfaz compartidos.
//
// Piezas reutilizables con la identidad YvexPOS. Aquí vive el estilo de los
// botones, banners de error (SIEMPRE legibles), insignias y cabeceras de
// modal, para que toda la app se vea y se sienta igual.
//
// Todos los colores salen del tema ACTIVO (useTema): cada componente lo lee
// internamente, así cambiar de tema en Ajustes se refleja al instante.

import { ReactNode, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useTema } from "@/src/componentes/TemaProvider";

type Tema = ReturnType<typeof useTema>["tema"];

// ---------------------------------------------------------------------------
// Botón primario (acento de marca), secundario y peligro.
// ---------------------------------------------------------------------------
export function Boton({
  titulo,
  onPress,
  tipo = "primario",
  cargando = false,
  deshabilitado = false,
  chico = false,
}: {
  titulo: string;
  onPress: () => void;
  tipo?: "primario" | "secundario" | "peligro" | "fantasma";
  cargando?: boolean;
  deshabilitado?: boolean;
  chico?: boolean;
}) {
  const { tema: T } = useTema();
  const eb = useMemo(() => crearEstilosBoton(T), [T]);
  const off = deshabilitado || cargando;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        eb.base,
        chico && eb.chico,
        tipo === "primario" && eb.primario,
        tipo === "secundario" && eb.secundario,
        tipo === "peligro" && eb.peligro,
        tipo === "fantasma" && eb.fantasma,
        pressed && !off && { opacity: 0.82, transform: [{ scale: 0.99 }] },
        off && { opacity: 0.45 },
      ]}
    >
      {cargando ? (
        <ActivityIndicator color={T.acentoTexto} size="small" />
      ) : (
        <Text
          style={[
            eb.txt,
            chico && eb.txtChico,
            tipo === "secundario" && { color: T.textoSuave },
            tipo === "peligro" && { color: T.peligro },
            tipo === "fantasma" && { color: T.turquesa },
          ]}
        >
          {titulo}
        </Text>
      )}
    </Pressable>
  );
}

function crearEstilosBoton(T: Tema) {
  return StyleSheet.create({
    base: {
      borderRadius: T.radio,
      paddingVertical: 14,
      paddingHorizontal: 18,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 52,
    },
    chico: {
      paddingVertical: 9,
      minHeight: 38,
      paddingHorizontal: 14,
      borderRadius: T.radioChico + 2,
    },
    primario: {
      backgroundColor: T.acento,
      // Brillo sutil de marca: el primario es el CTA, merece levantarse.
      shadowColor: T.acento,
      shadowOpacity: 0.28,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    secundario: {
      backgroundColor: T.superficie2,
      borderWidth: 1,
      borderColor: T.bordeFuerte,
    },
    peligro: {
      backgroundColor: T.peligroSuave,
      borderWidth: 1,
      borderColor: T.peligro,
    },
    fantasma: { backgroundColor: "transparent" },
    // Texto sobre el botón de acento: sale del acento activo (Perla usa oscuro).
    txt: { color: T.acentoTexto, fontSize: 16, fontWeight: "800", letterSpacing: 0.2 },
    txtChico: { fontSize: 14, fontWeight: "700" },
  });
}

// ---------------------------------------------------------------------------
// Banner de error / éxito — SIEMPRE legible (bug de errores invisibles: fuera).
// ---------------------------------------------------------------------------
export function Banner({
  texto,
  tipo = "error",
}: {
  texto: string;
  tipo?: "error" | "exito" | "info";
}) {
  const { tema: T } = useTema();
  const ebn = useMemo(() => crearEstilosBanner(T), [T]);
  if (!texto) return null;
  return (
    <View
      style={[
        ebn.base,
        tipo === "error" && { backgroundColor: T.peligroSuave, borderColor: T.peligro },
        tipo === "exito" && { backgroundColor: T.exitoSuave, borderColor: T.exito },
        tipo === "info" && { backgroundColor: T.acentoSuave, borderColor: T.acento },
      ]}
    >
      <Text
        style={[
          ebn.txt,
          tipo === "error" && { color: T.peligroTexto },
          // Texto sobre fondo suave: del tema (legible también en temas claros).
          tipo === "exito" && { color: T.exitoTexto },
          tipo === "info" && { color: T.esClaro ? T.texto : "#e4dbff" },
        ]}
      >
        {texto}
      </Text>
    </View>
  );
}

function crearEstilosBanner(T: Tema) {
  return StyleSheet.create({
    base: {
      borderRadius: T.radioChico + 2,
      borderWidth: 1,
      paddingVertical: 12,
      paddingHorizontal: 16,
      marginBottom: 14,
    },
    txt: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  });
}

// ---------------------------------------------------------------------------
// Insignia (badge) — para "KIT", "sin control", contadores.
// ---------------------------------------------------------------------------
export function Insignia({
  texto,
  color,
}: {
  texto: string;
  color?: string;
}) {
  const { tema: T } = useTema();
  const c = color ?? T.acento;
  return (
    <View style={[ei.base, { borderColor: c }]}>
      <Text style={[ei.txt, { color: c }]}>{texto}</Text>
    </View>
  );
}

const ei = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  txt: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
});

// ---------------------------------------------------------------------------
// Cabecera de modal estándar: Cancelar · Título · Acción.
// ---------------------------------------------------------------------------
export function CabeceraModal({
  titulo,
  izquierda = "Cancelar",
  derecha,
  onIzquierda,
  onDerecha,
  derechaCargando = false,
}: {
  titulo: string;
  izquierda?: string;
  derecha?: string;
  onIzquierda: () => void;
  onDerecha?: () => void;
  derechaCargando?: boolean;
}) {
  const { tema: T } = useTema();
  const ec = useMemo(() => crearEstilosCabecera(T), [T]);
  return (
    <View style={ec.base}>
      <Pressable onPress={onIzquierda} hitSlop={12} style={ec.lado}>
        <Text style={ec.izq}>{izquierda}</Text>
      </Pressable>
      <Text style={ec.titulo} numberOfLines={1}>
        {titulo}
      </Text>
      <Pressable
        onPress={onDerecha}
        disabled={!onDerecha || derechaCargando}
        hitSlop={12}
        style={[ec.lado, { alignItems: "flex-end" }]}
      >
        {derechaCargando ? (
          <ActivityIndicator color={T.turquesa} size="small" />
        ) : derecha ? (
          <Text style={ec.der}>{derecha}</Text>
        ) : null}
      </Pressable>
    </View>
  );
}

function crearEstilosCabecera(T: Tema) {
  return StyleSheet.create({
    base: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 13,
      borderBottomWidth: 1,
      borderBottomColor: T.borde,
      backgroundColor: T.fondo,
    },
    lado: { width: 82 },
    izq: { color: T.textoSuave, fontSize: 15 },
    der: { color: T.turquesa, fontSize: 15, fontWeight: "800" },
    titulo: {
      flex: 1,
      textAlign: "center",
      color: T.texto,
      fontSize: 17,
      fontWeight: "800",
      letterSpacing: -0.3,
    },
  });
}

// ---------------------------------------------------------------------------
// Campo con etiqueta (envoltorio estándar de formularios).
// ---------------------------------------------------------------------------
export function Campo({
  label,
  children,
  flex,
  ayuda,
}: {
  label: string;
  children: ReactNode;
  flex?: boolean;
  ayuda?: string;
}) {
  const { tema: T } = useTema();
  const ecp = useMemo(() => crearEstilosCampo(T), [T]);
  return (
    <View style={[ecp.campo, flex && { flex: 1 }]}>
      <Text style={ecp.label}>{label}</Text>
      {children}
      {ayuda ? <Text style={ecp.ayuda}>{ayuda}</Text> : null}
    </View>
  );
}

function crearEstilosCampo(T: Tema) {
  return StyleSheet.create({
    campo: { marginBottom: 18 },
    label: {
      color: T.textoSuave,
      fontSize: 13,
      fontWeight: "700",
      marginBottom: 7,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    ayuda: { color: T.textoTenue, fontSize: 12, marginTop: 5 },
  });
}

// Estilo compartido de input (lo usan las pantallas directamente).
// Hook: el estilo se construye con el tema ACTIVO.
export function useEstiloInput() {
  const { tema: T } = useTema();
  return useMemo(
    () => ({
      backgroundColor: T.superficie2,
      borderRadius: T.radioChico + 2,
      paddingHorizontal: 14,
      paddingVertical: 13,
      fontSize: 16,
      color: T.texto,
      borderWidth: 1,
      borderColor: T.borde,
    }),
    [T]
  );
}
