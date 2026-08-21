// YvexPOS Móvil — Entrada / salida de efectivo del cajón (fuera de ventas).
//
// Dinero que se mueve del cajón sin ser una venta: pagarle a un proveedor en
// efectivo, un retiro del dueño, meter cambio. NO duplica lógica: reusa
// registrarMovimientoCaja() de venta.ts, la misma función que ya usa Dinero
// cuando un gasto en efectivo genera su salida automática. corteTurno() ya
// suma/resta estos movimientos (entradas_centavos / salidas_centavos), así
// que en cuanto se registra uno el corte queda correcto de inmediato.
//
// ---------------------------------------------------------------------------
// MIGRACIÓN A <Hoja>
// ---------------------------------------------------------------------------
// La versión anterior ya tenía la forma correcta (hoja inferior compacta,
// no pantalla completa) pero la construía a mano: Modal + overlay +
// Pressable de fondo + KeyboardAvoidingView + SafeAreaView + agarradera,
// todo repetido de cero. <Hoja tipo="hoja"> ya resuelve exactamente eso —
// es el mismo componente que usa el ticket en Vender y el corte de turno en
// Inicio. Migrar aquí no es solo estética: es una implementación menos de
// "cómo se ve un bottom sheet" que puede desviarse del resto de la app.

import { useState } from "react";
import { View, TextInput, Pressable } from "react-native";
import { Turno, TipoMovimiento, registrarMovimientoCaja } from "@/src/base/venta";
import { aCentavos } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, Campo, Txt, Hoja, useEstiloInput } from "@/src/componentes/ui";

export default function ModalMovimientoCaja({
  turno,
  onCerrar,
  onGuardado,
}: {
  turno: Turno;
  onCerrar: () => void;
  /** Se llama tras guardar con éxito, para refrescar Inicio (resumen/corte). */
  onGuardado: () => void;
}) {
  const { tema: T } = useTema();
  const estiloInput = useEstiloInput();

  const [tipo, setTipo] = useState<TipoMovimiento>("salida");
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setError("");
    const centavos = aCentavos(monto);
    if (centavos <= 0) {
      setError("Ingresa un monto válido.");
      return;
    }
    setGuardando(true);
    try {
      await registrarMovimientoCaja({
        cajaSesionId: turno.id,
        tipo,
        motivo: motivo.trim() || null,
        montoCentavos: centavos,
      });
      onGuardado();
      onCerrar();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setGuardando(false);
    }
  }

  return (
    <Hoja
      visible
      onCerrar={guardando ? () => {} : onCerrar}
      titulo="Entrada / salida de efectivo"
      pie={
        <View style={{ gap: T.esps.sm }}>
          <Boton titulo="Registrar" onPress={guardar} cargando={guardando} />
          <Boton
            titulo="Cancelar"
            tipo="secundario"
            onPress={onCerrar}
            deshabilitado={guardando}
          />
        </View>
      }
    >
      <Txt escala="pie" tono="suave" estilo={{ marginBottom: T.esps.lg }}>
        Registra dinero que entra o sale del cajón fuera de las ventas. El corte
        de hoy lo cuenta automáticamente.
      </Txt>

      {/* Segmentado — el mismo patrón que ya usan Reportes, Inventario y
          Ajustes: dos opciones, una pastilla que se desliza. */}
      <View
        style={{
          flexDirection: "row",
          backgroundColor: T.superficie2,
          borderRadius: T.radio,
          padding: 3,
          marginBottom: T.esps.lg,
        }}
      >
        {(
          [
            { id: "salida" as const, label: "− Salida" },
            { id: "entrada" as const, label: "+ Entrada" },
          ]
        ).map((o) => {
          const activo = tipo === o.id;
          return (
            <Pressable
              key={o.id}
              onPress={() => setTipo(o.id)}
              style={{
                flex: 1,
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: T.radioChico,
                backgroundColor: activo ? T.acentoRelleno : "transparent",
              }}
            >
              <Txt
                escala="cuerpo"
                fuerte={activo}
                tono="suave"
                estilo={activo ? { color: T.acentoTexto } : undefined}
              >
                {o.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      <Banner texto={error} tipo="error" />

      <Campo label="Monto">
        <TextInput
          style={estiloInput}
          value={monto}
          onChangeText={setMonto}
          placeholder="0.00"
          placeholderTextColor={T.textoTenue}
          keyboardType="decimal-pad"
          autoFocus
        />
      </Campo>

      <Campo label="Motivo (opcional)">
        <TextInput
          style={estiloInput}
          value={motivo}
          onChangeText={setMotivo}
          placeholder="Pago a proveedor, retiro, depósito…"
          placeholderTextColor={T.textoTenue}
          returnKeyType="done"
          onSubmitEditing={guardar}
        />
      </Campo>
    </Hoja>
  );
}
