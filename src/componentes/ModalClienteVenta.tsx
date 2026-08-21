// YvexPOS Móvil — Modal para LIGAR un cliente al ticket que estás cobrando.
//
// Tres caminos: buscar por nombre/teléfono, crear rápido, o ESCANEAR su QR
// (reutiliza EscanerCamara en modo "unico"; si el código no es de un cliente
// tuyo, avisa sin cerrar la venta).
//
// Muestra el saldo actual del cliente y cuántos puntos ganaría con esta
// compra, para que el canje se decida con información, no de memoria.
//
// Migrado a <Hoja>: antes construía su propio Modal + SafeAreaView +
// KeyboardAvoidingView + CabeceraModal a mano. <Hoja tipo="completa"> ya
// resuelve exactamente eso. La lista de clientes pasa de un estilo de fila
// propio a <Fila>, y T.turquesa (la flecha "→") se convierte en T.acento.

import { useCallback, useEffect, useState } from "react";
import { View, TextInput, Pressable } from "react-native";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, Hoja, Grupo, Fila, Txt, Vacio, useEstiloInput } from "@/src/componentes/ui";
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
  const correoInvalido = altaCorreo.trim() !== "" && !correoValido(altaCorreo);

  return (
    <Hoja visible onCerrar={onCerrar} titulo="Cliente del ticket" tipo="completa">
      <Banner texto={aviso} tipo="info" />

      {/* Escanear QR del cliente */}
      <Pressable
        onPress={() => setEscanerAbierto(true)}
        android_ripple={{ color: T.acentoBorde }}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: T.esps.sm,
          backgroundColor: T.acentoSuave,
          borderWidth: 1.5,
          borderColor: T.acento,
          borderRadius: T.radio,
          minHeight: 52,
          marginBottom: T.esps.lg,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <IconoUI id="qr" size={20} color={T.acento} />
        <Txt escala="cuerpo" tono="acento" fuerte>
          Escanear QR del cliente
        </Txt>
      </Pressable>

      {/* Buscador */}
      <TextInput
        style={[estiloInput, { marginBottom: T.esps.md }]}
        placeholder="Busca por nombre, teléfono, correo o código…"
        placeholderTextColor={T.textoTenue}
        value={busqueda}
        onChangeText={setBusqueda}
      />

      {clientes.length === 0 ? (
        <Vacio
          titulo={busqueda ? "Nadie coincide" : "Aún no tienes clientes"}
          texto={
            busqueda
              ? "Puedes darlo de alta aquí abajo."
              : "Se registran solos la primera vez que ligas uno a una venta."
          }
        />
      ) : (
        <Grupo>
          {clientes.map((c) => (
            <Fila
              key={c.id}
              titulo={c.nombre}
              meta={`Tiene ${c.puntos} pts${ganaria > 0 ? ` · con esta compra ganaría ~${ganaria} más` : ""}`}
              onPress={() => onElegir(c)}
            />
          ))}
        </Grupo>
      )}

      {/* Alta rápida */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: T.borde,
          paddingTop: T.esps.lg,
          marginTop: T.esps.lg,
        }}
      >
        <Txt escala="pie" tono="suave" fuerte estilo={{ marginBottom: T.esps.md }}>
          ¿Es nuevo? Regístralo al vuelo:
        </Txt>
        <View style={{ flexDirection: "row", gap: T.esps.sm }}>
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
            { marginTop: T.esps.sm },
            correoInvalido && { borderColor: T.peligro },
          ]}
          placeholder="Correo (opcional, para promociones)"
          placeholderTextColor={T.textoTenue}
          value={altaCorreo}
          onChangeText={setAltaCorreo}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {correoInvalido ? (
          <Txt escala="pie" tono="peligro" estilo={{ marginTop: T.esps.xs }}>
            Ese correo no parece válido; se creará sin correo y lo corriges después.
          </Txt>
        ) : null}
      </View>

      {escanerAbierto && (
        <EscanerCamara
          modo="unico"
          onCodigo={(c) => void alEscanearQr(c)}
          onCerrar={() => setEscanerAbierto(false)}
        />
      )}
    </Hoja>
  );
}
