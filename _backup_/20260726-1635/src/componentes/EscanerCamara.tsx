// YvexPOS Móvil — EscanerCamara: modal reutilizable de códigos de barras.
//
// Cámara viva (expo-camera) con marco guía, linterna y aviso del último
// código leído. ES NUEVO y separado del escáner de tickets con IA.
//
// Modos:
//   - "unico":    cierra al primer código válido (onCodigo(c) + onCerrar()).
//                 Se usa en el formulario de producto, para rellenar el campo.
//   - "continuo": NO cierra; emite onCodigo(c) por cada código DISTINTO y
//                 muestra un aviso breve. Se usa en Vender (escanear varios
//                 productos seguidos al carrito).
//
// Solo se monta cuando está visible (el padre lo renderiza condicionalmente),
// así nunca hay dos CameraView activas a la vez: al cerrar se desmonta todo.

import { useEffect, useRef, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useTema } from "./TemaProvider";
import { IconoUI } from "./iconos";
import { normalizarCodigo, esCodigoValido } from "../base/codigos";

// Tipos que entiende bien la cámara para productos de tienda.
const TIPOS = ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "qr"];

// Tiempo que el MISMO código queda "enfriado" para no disparar duplicados.
const COOLDOWN_MS = 1500;

export type ModoEscaner = "unico" | "continuo";

type Props = {
  modo: ModoEscaner;
  onCodigo: (codigo: string) => void;
  onCerrar: () => void;
  /** Aviso externo (modo continuo): el padre muestra qué pasó con el código
   *  ("Agregado: Coca", "Sin stock"…). Si viene, sustituye al aviso interno. */
  aviso?: string | null;
};

export default function EscanerCamara({ modo, onCodigo, onCerrar, aviso }: Props) {
  const { tema: T } = useTema();
  const [permiso, pedirPermiso] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [ultimo, setUltimo] = useState<string | null>(null);

  // Candado anti-duplicados: código -> instante de la última aceptación.
  // Ref (no estado): las lecturas llegan muy seguido y no queremos re-render.
  const aceptados = useRef(new Map<string, number>());
  const cerrado = useRef(false);
  const avisoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      cerrado.current = true;
      if (avisoTimer.current) clearTimeout(avisoTimer.current);
    };
  }, []);

  function alEscanear({ data }: { data: string }) {
    if (cerrado.current) return;
    const codigo = normalizarCodigo(data);
    if (!esCodigoValido(codigo)) return;

    const ahora = Date.now();
    const ultimaVez = aceptados.current.get(codigo) ?? 0;
    if (ahora - ultimaVez < COOLDOWN_MS) return; // misma lectura repetida
    aceptados.current.set(codigo, ahora);

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onCodigo(codigo);

    if (modo === "unico") {
      cerrado.current = true;
      onCerrar();
    } else {
      setUltimo(codigo);
      if (avisoTimer.current) clearTimeout(avisoTimer.current);
      avisoTimer.current = setTimeout(() => setUltimo(null), 2500);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }} edges={["top", "bottom"]}>
        {/* Cabecera propia del visor */}
        <View style={est.cabecera}>
          <Pressable style={est.cabBtn} onPress={onCerrar} hitSlop={10}>
            <IconoUI id="cerrar" size={20} color="#fff" grosor={2} />
          </Pressable>
          <Text style={est.cabTitulo}>
            {modo === "continuo" ? "Escanear al ticket" : "Escanear código"}
          </Text>
          <Pressable
            style={[est.cabBtn, torch && { backgroundColor: T.acento, borderColor: T.acento }]}
            onPress={() => setTorch((v) => !v)}
            hitSlop={10}
          >
            <IconoUI id="linterna" size={19} color={torch ? T.acentoTexto : "#fff"} grosor={1.8} />
          </Pressable>
        </View>

        {/* Cuerpo: cámara o estados de permiso */}
        {!permiso ? (
          <View style={est.centro}>
            <Text style={est.estadoTxt}>Preparando la cámara…</Text>
          </View>
        ) : !permiso.granted ? (
          <View style={[est.centro, { paddingHorizontal: 34 }]}>
            <IconoUI id="camara" size={44} color={T.acento} />
            <Text style={est.estadoTitulo}>Necesitamos tu cámara</Text>
            <Text style={est.estadoTxt}>
              {permiso.canAskAgain
                ? "La usamos solo para leer códigos de barras cuando tú tocas el botón de escanear. No grabamos nada."
                : "El permiso de cámara está apagado. Actívalo en la Configuración de tu teléfono (Aplicaciones → YvexPOS → Permisos) y vuelve a intentar."}
            </Text>
            {permiso.canAskAgain && (
              <Pressable
                style={[est.btnPermiso, { backgroundColor: T.acento }]}
                onPress={() => void pedirPermiso()}
              >
                <Text style={[est.btnPermisoTxt, { color: T.acentoTexto }]}>Permitir cámara</Text>
              </Pressable>
            )}
            <Pressable onPress={onCerrar} hitSlop={10} style={{ marginTop: 18 }}>
              <Text style={est.cancelarTxt}>Ahora no</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: TIPOS }}
              onBarcodeScanned={alEscanear}
            />

            {/* Marco guía centrado (esquinas tipo viewfinder) */}
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <View style={est.marcoZona}>
                <View style={est.marco}>
                  <View style={[est.esq, est.esqSI, { borderColor: T.acento }]} />
                  <View style={[est.esq, est.esqSD, { borderColor: T.acento }]} />
                  <View style={[est.esq, est.esqII, { borderColor: T.acento }]} />
                  <View style={[est.esq, est.esqID, { borderColor: T.acento }]} />
                </View>
                <Text style={est.guia}>Apunta al código de barras</Text>
                {modo === "continuo" && (
                  <Text style={est.guiaSub}>Puedes escanear varios, uno tras otro</Text>
                )}
              </View>
            </View>

            {/* Aviso del último código leído (modo continuo) */}
            {modo === "continuo" && (aviso || ultimo) && (
              <View style={[est.ultimoCaja, { backgroundColor: T.turquesaSuave, borderColor: T.turquesa }]}>
                <Text style={[est.ultimoTxt, { color: T.turquesa }]} numberOfLines={2}>
                  {aviso ?? `Código leído: ${ultimo}`}
                </Text>
              </View>
            )}
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const LADO = 34;
const GROSOR = 4;

const est = StyleSheet.create({
  cabecera: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 12,
    backgroundColor: "#000",
  },
  cabBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  cabTitulo: {
    flex: 1,
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.2,
  },
  centro: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  estadoTitulo: { color: "#fff", fontSize: 19, fontWeight: "800", marginTop: 6 },
  estadoTxt: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  btnPermiso: {
    marginTop: 10,
    borderRadius: 12,
    paddingHorizontal: 26,
    paddingVertical: 13,
  },
  btnPermisoTxt: { fontSize: 15, fontWeight: "800" },
  cancelarTxt: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: "700" },

  marcoZona: { flex: 1, alignItems: "center", justifyContent: "center" },
  marco: { width: 250, height: 150 },
  esq: { position: "absolute", width: LADO, height: LADO },
  esqSI: { top: 0, left: 0, borderTopWidth: GROSOR, borderLeftWidth: GROSOR, borderTopLeftRadius: 10 },
  esqSD: { top: 0, right: 0, borderTopWidth: GROSOR, borderRightWidth: GROSOR, borderTopRightRadius: 10 },
  esqII: { bottom: 0, left: 0, borderBottomWidth: GROSOR, borderLeftWidth: GROSOR, borderBottomLeftRadius: 10 },
  esqID: { bottom: 0, right: 0, borderBottomWidth: GROSOR, borderRightWidth: GROSOR, borderBottomRightRadius: 10 },
  guia: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
    marginTop: 22,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowRadius: 6,
  },
  guiaSub: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 12.5,
    marginTop: 5,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowRadius: 6,
  },

  ultimoCaja: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 26,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  ultimoTxt: { fontSize: 14, fontWeight: "800", fontVariant: ["tabular-nums"] },
});
