// YvexPOS Móvil — Modal para LIGAR un cliente al ticket que estás cobrando.
//
// Tres caminos: buscar por nombre/teléfono, crear rápido, o ESCANEAR su QR
// (reutiliza EscanerCamara en modo "unico"; si el código no es de un cliente
// tuyo, avisa sin cerrar la venta).
//
// Muestra el saldo actual del cliente y cuántos puntos ganaría con esta
// compra, para que el canje se decida con información, no de memoria.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Modal,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, CabeceraModal, useEstiloInput } from "@/src/componentes/ui";
import { IconoUI } from "@/src/componentes/iconos";
import EscanerCamara from "@/src/componentes/EscanerCamara";
import {
  Cliente,
  buscarClientes,
  clientePorCodigo,
  crearCliente,
  leerReglas,
  correoValido,
} from "@/src/base/lealtad";
import { puntosPorCompra } from "@/src/base/lealtadReglas";

type Tema = ReturnType<typeof useTema>["tema"];

export default function ModalClienteVenta({
  totalCentavos,
  onElegir,
  onCerrar,
}: {
  /** Subtotal del ticket (para "ganaría ~X puntos"). */
  totalCentavos: number;
  onElegir: (c: Cliente) => void;
  onCerrar: () => void;
}) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const estiloInput = useEstiloInput();

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [aviso, setAviso] = useState("");
  const [escanerAbierto, setEscanerAbierto] = useState(false);
  const [altaNombre, setAltaNombre] = useState("");
  const [altaCorreo, setAltaCorreo] = useState("");
  const [creando, setCreando] = useState(false);
  const [pesosPorPunto, setPesosPorPunto] = useState(10);

  const cargar = useCallback(async () => {
    setClientes(await buscarClientes(busqueda));
  }, [busqueda]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    void leerReglas().then((r) => setPesosPorPunto(r.pesosPorPunto));
  }, []);

  /** El QR que enseña el cliente: "YV-XXXXXX". Si no es tuyo, aviso cálido
   *  y el modal sigue abierto para buscarlo a mano. */
  async function alEscanearQr(codigo: string) {
    const c = await clientePorCodigo(codigo);
    if (c) {
      onElegir(c);
    } else {
      setAviso("Ese código no es de un cliente tuyo. Búscalo por nombre o dalo de alta.");
    }
  }

  async function crearRapido() {
    setAviso("");
    setCreando(true);
    try {
      const correoRechazado = altaCorreo.trim() !== "" && !correoValido(altaCorreo);
      const c = await crearCliente(altaNombre, undefined, altaCorreo);
      if (correoRechazado) {
        // Nunca bloqueamos el alta por un correo raro: solo avisamos.
        setAviso("Cliente creado. El correo no parecía válido y no se guardó.");
      }
      onElegir(c);
    } catch (e: any) {
      setAviso(e?.message ?? String(e));
      setCreando(false);
    }
  }

  const ganaria = puntosPorCompra(totalCentavos, pesosPorPunto);

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={est.raiz}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <CabeceraModal titulo="Cliente del ticket" onIzquierda={onCerrar} />
          <View style={{ padding: T.esp, flex: 1 }}>
            <Banner texto={aviso} tipo="info" />

            {/* Escanear QR del cliente */}
            <Pressable
              style={({ pressed }) => [est.qrBtn, pressed && { opacity: 0.85 }]}
              onPress={() => setEscanerAbierto(true)}
            >
              <IconoUI id="qr" size={20} color={T.acento} />
              <Text style={est.qrBtnTxt}>Escanear QR del cliente</Text>
            </Pressable>

            {/* Buscador */}
            <TextInput
              style={[estiloInput, { marginBottom: 12 }]}
              placeholder="Busca por nombre, teléfono, correo o código…"
              placeholderTextColor={T.textoTenue}
              value={busqueda}
              onChangeText={setBusqueda}
            />

            <FlatList
              data={clientes}
              keyExtractor={(c) => c.id}
              style={{ flex: 1 }}
              ListEmptyComponent={
                <Text style={est.vacio}>
                  {busqueda
                    ? "Nadie coincide. Puedes darlo de alta aquí abajo."
                    : "Aún no tienes clientes registrados."}
                </Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [
                    est.filaCliente,
                    pressed && { backgroundColor: T.superficie3 },
                  ]}
                  onPress={() => onElegir(item)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={est.filaNombre} numberOfLines={1}>
                      {item.nombre}
                    </Text>
                    <Text style={est.filaMeta}>
                      Tiene {item.puntos} pts
                      {ganaria > 0 ? ` · con esta compra ganaría ~${ganaria} más` : ""}
                    </Text>
                  </View>
                  <Text style={est.filaFlecha}>→</Text>
                </Pressable>
              )}
            />

            {/* Alta rápida */}
            <View style={est.altaCaja}>
              <Text style={est.altaLbl}>¿Es nuevo? Regístralo al vuelo:</Text>
              <View style={{ flexDirection: "row", gap: 9 }}>
                <TextInput
                  style={[estiloInput, { flex: 1 }]}
                  placeholder="Nombre del cliente"
                  placeholderTextColor={T.textoTenue}
                  value={altaNombre}
                  onChangeText={setAltaNombre}
                  autoCapitalize="words"
                  onSubmitEditing={altaNombre.trim() ? crearRapido : undefined}
                />
                <Boton
                  titulo="Crear"
                  chico
                  onPress={crearRapido}
                  cargando={creando}
                  deshabilitado={altaNombre.trim() === ""}
                />
              </View>
              <TextInput
                style={[
                  estiloInput,
                  { marginTop: 9 },
                  altaCorreo.trim() !== "" && !correoValido(altaCorreo) && {
                    borderColor: T.peligro,
                  },
                ]}
                placeholder="Correo (opcional, para promociones)"
                placeholderTextColor={T.textoTenue}
                value={altaCorreo}
                onChangeText={setAltaCorreo}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {altaCorreo.trim() !== "" && !correoValido(altaCorreo) && (
                <Text style={est.correoAviso}>
                  Ese correo no parece válido; se creará sin correo y lo corriges después.
                </Text>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>

        {escanerAbierto && (
          <EscanerCamara
            modo="unico"
            onCodigo={(c) => void alEscanearQr(c)}
            onCerrar={() => setEscanerAbierto(false)}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

function crearEstilos(T: Tema) {
  return StyleSheet.create({
    raiz: { flex: 1, backgroundColor: T.fondo },
    qrBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
      backgroundColor: T.acentoSuave, borderWidth: 1.5, borderColor: T.acento,
      borderRadius: T.radio, paddingVertical: 14, marginBottom: 14,
    },
    qrBtnTxt: { color: T.acento, fontSize: 15, fontWeight: "800" },
    vacio: {
      color: T.textoTenue, fontSize: 14, textAlign: "center",
      marginTop: 40, paddingHorizontal: 30, lineHeight: 21,
    },
    filaCliente: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: T.superficie, borderWidth: 1, borderColor: T.borde,
      borderRadius: T.radio, padding: 13, marginBottom: 8,
    },
    filaNombre: { color: T.texto, fontSize: 15, fontWeight: "800" },
    filaMeta: { color: T.textoTenue, fontSize: 12, marginTop: 2 },
    filaFlecha: { color: T.turquesa, fontSize: 16, fontWeight: "800" },
    altaCaja: {
      borderTopWidth: 1, borderTopColor: T.borde,
      paddingTop: 14, paddingBottom: 6,
    },
    altaLbl: { color: T.textoSuave, fontSize: 12.5, fontWeight: "700", marginBottom: 9 },
    correoAviso: {
      color: T.peligro, fontSize: 12, marginTop: 5, lineHeight: 17,
    },
  });
}
