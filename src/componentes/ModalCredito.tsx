// YvexPOS Móvil — Crédito (cobranza).
//
// Enfocado en la deuda: quién debe, cuánto se debe en total, y abonar
// rápido. Puerto de credito.js del PC.
//
// El límite AVISA, no bloquea — la decisión de vender a crédito ya se toma
// en ModalCobro (vender.tsx); aquí solo se cobra lo que ya se debe.

import { useCallback, useEffect, useState } from "react";
import { View, TextInput, Pressable, ScrollView, ActivityIndicator, BackHandler } from "react-native";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, Campo, Hoja, Grupo, Fila, Lamina, Txt, Monto, Vacio, useEstiloInput } from "@/src/componentes/ui";
import { pesos, aCentavos, fmtFecha } from "@/src/base/formato";
import { type Cliente } from "@/src/base/lealtad";
import {
  type MovimientoCuenta, type MetodoAbono,
  listarDeudores, totalPorCobrar, estadoCuenta, registrarAbono,
} from "@/src/base/credito";

type Vista = "lista" | "estado" | "abono";

const METODOS: { id: MetodoAbono; nombre: string }[] = [
  { id: "efectivo", nombre: "Efectivo" },
  { id: "tarjeta", nombre: "Tarjeta" },
  { id: "transferencia", nombre: "Transferencia" },
];

export default function ModalCredito({ onCerrar }: { onCerrar: () => void }) {
  const { tema: T } = useTema();
  const estiloInput = useEstiloInput();

  const [vista, setVista] = useState<Vista>("lista");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const [deudores, setDeudores] = useState<Cliente[]>([]);
  const [totalCalle, setTotalCalle] = useState(0);
  const [busqueda, setBusqueda] = useState("");

  const [clienteActivo, setClienteActivo] = useState<Cliente | null>(null);
  const [movimientos, setMovimientos] = useState<MovimientoCuenta[]>([]);

  const [montoAbono, setMontoAbono] = useState("");
  const [metodoAbono, setMetodoAbono] = useState<MetodoAbono>("efectivo");
  const [motivoAbono, setMotivoAbono] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargarLista = useCallback(async () => {
    setCargando(true);
    try {
      const [d, t] = await Promise.all([listarDeudores(), totalPorCobrar()]);
      setDeudores(d);
      setTotalCalle(t);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargarLista();
  }, [cargarLista]);

  useEffect(() => {
    const alPresionarAtras = () => {
      if (vista === "abono") {
        setVista("estado");
        return true;
      }
      if (vista === "estado") {
        setVista("lista");
        void cargarLista();
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", alPresionarAtras);
    return () => sub.remove();
  }, [vista, cargarLista]);

  async function abrirEstado(c: Cliente) {
    setError("");
    setClienteActivo(c);
    setVista("estado");
    try {
      setMovimientos(await estadoCuenta(c.id));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  function abrirAbono() {
    setMontoAbono("");
    setMetodoAbono("efectivo");
    setMotivoAbono("");
    setError("");
    setVista("abono");
  }

  async function confirmarAbono() {
    if (!clienteActivo) return;
    setError("");
    const monto = Math.round(aCentavos(montoAbono));
    if (monto <= 0) {
      setError("Escribe un monto mayor a cero.");
      return;
    }
    setGuardando(true);
    try {
      await registrarAbono({
        clienteId: clienteActivo.id,
        montoCentavos: monto,
        metodo: metodoAbono,
        motivo: motivoAbono.trim() || null,
      });
      const fresco = await estadoCuenta(clienteActivo.id);
      setMovimientos(fresco);
      setClienteActivo((c) => (c ? { ...c, saldo_centavos: fresco[0]?.saldo_resultante_centavos ?? 0 } : c));
      setVista("estado");
      void cargarLista();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setGuardando(false);
    }
  }

  const deudoresFiltrados = deudores.filter((c) => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return c.nombre.toLowerCase().includes(q) || (c.telefono ?? "").includes(busqueda.trim());
  });

  const cab = (() => {
    switch (vista) {
      case "estado":
        return { titulo: clienteActivo?.nombre ?? "Cliente" };
      case "abono":
        return { titulo: "Registrar abono" };
      default:
        return { titulo: "Crédito" };
    }
  })();

  return (
    <Hoja visible onCerrar={onCerrar} titulo={cab.titulo} tipo="completa">
      {vista === "lista" && (
        <ScrollView contentContainerStyle={{ padding: T.esp }}>
          <Banner texto={error} tipo="error" />

          {/* Dinero en la calle: la cifra protagonista de esta pantalla. */}
          <View style={{ marginBottom: T.esps.lg }}>
            <Lamina>
              <Txt escala="micro" tono="suave" fuerte mayus>
                Dinero en la calle
              </Txt>
              <View style={{ marginTop: T.esps.xs }}>
                <Monto texto={pesos(totalCalle)} escala="protagonista" />
              </View>
              <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.xs }}>
                {deudores.length} cliente{deudores.length === 1 ? "" : "s"} con deuda
              </Txt>
            </Lamina>
          </View>

          <TextInput
            style={[estiloInput, { marginBottom: T.esps.lg }]}
            value={busqueda}
            onChangeText={setBusqueda}
            placeholder="Buscar deudor…"
            placeholderTextColor={T.textoTenue}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {cargando ? (
            <ActivityIndicator color={T.acento} style={{ marginTop: T.esps.xl }} />
          ) : deudoresFiltrados.length === 0 ? (
            <Vacio
              titulo={busqueda ? "Nadie coincide con esa búsqueda" : "Nadie debe nada"}
              texto={busqueda ? undefined : "Todo cobrado. 👍"}
            />
          ) : (
            <Grupo>
              {deudoresFiltrados.map((c) => {
                const sobreLimite = c.limite_credito_centavos > 0 && c.saldo_centavos > c.limite_credito_centavos;
                return (
                  <Fila
                    key={c.id}
                    titulo={c.nombre}
                    meta={c.telefono ?? "Sin teléfono"}
                    onPress={() => abrirEstado(c)}
                    valor={
                      <View style={{ flexDirection: "row", alignItems: "center", gap: T.esps.xs }}>
                        {sobreLimite && (
                          <Txt escala="pie" tono="peligro" fuerte>
                            !
                          </Txt>
                        )}
                        <Monto texto={pesos(c.saldo_centavos)} escala="pie" tono={sobreLimite ? "peligro" : "principal"} />
                      </View>
                    }
                  />
                );
              })}
            </Grupo>
          )}
          <View style={{ height: T.esps.xl }} />
        </ScrollView>
      )}

      {vista === "estado" && clienteActivo && (
        <ScrollView contentContainerStyle={{ padding: T.esp }}>
          <Banner texto={error} tipo="error" />

          <View style={{ marginBottom: T.esps.lg }}>
            <Lamina>
              <Txt escala="micro" tono="suave" fuerte mayus>
                Debe
              </Txt>
              <View style={{ marginTop: T.esps.xs }}>
                <Monto texto={pesos(clienteActivo.saldo_centavos)} escala="protagonista" />
              </View>
              <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.xs }}>
                Límite: {clienteActivo.limite_credito_centavos > 0 ? pesos(clienteActivo.limite_credito_centavos) : "sin límite definido"}
              </Txt>
            </Lamina>
          </View>

          <Boton titulo="Registrar abono" onPress={abrirAbono} />
          <View style={{ height: T.esps.lg }} />

          <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.sm }}>
            Movimientos
          </Txt>
          {movimientos.length === 0 ? (
            <Vacio titulo="Sin movimientos todavía" />
          ) : (
            <Grupo>
              {movimientos.map((m) => (
                <Fila
                  key={m.id}
                  titulo={m.tipo === "cargo" ? "Venta a crédito" : `Abono${m.metodo ? ` · ${m.metodo}` : ""}`}
                  meta={`${fmtFecha(m.creado_en)}${m.motivo ? ` · ${m.motivo}` : ""}`}
                  flecha={false}
                  valor={
                    <Monto
                      texto={`${m.tipo === "cargo" ? "+" : "−"}${pesos(m.monto_centavos)}`}
                      escala="pie"
                      tono={m.tipo === "cargo" ? "peligro" : "exito"}
                    />
                  }
                />
              ))}
            </Grupo>
          )}
          <View style={{ height: T.esps.xl }} />
        </ScrollView>
      )}

      {vista === "abono" && clienteActivo && (
        <ScrollView contentContainerStyle={{ padding: T.esp }} keyboardShouldPersistTaps="handled">
          <Banner texto={error} tipo="error" />
          <Txt escala="pie" tono="suave" estilo={{ marginBottom: T.esps.lg }}>
            {clienteActivo.nombre} debe {pesos(clienteActivo.saldo_centavos)}.
          </Txt>

          <Campo label="Monto del abono">
            <TextInput
              style={estiloInput}
              value={montoAbono}
              onChangeText={setMontoAbono}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={T.textoTenue}
              autoFocus
            />
          </Campo>

          <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.sm }}>
            Método
          </Txt>
          <View style={{ flexDirection: "row", gap: T.esps.sm, marginBottom: T.esps.lg }}>
            {METODOS.map((m) => {
              const activo = metodoAbono === m.id;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => setMetodoAbono(m.id)}
                  style={{
                    flex: 1, height: 44, borderRadius: T.radioChico, alignItems: "center", justifyContent: "center",
                    backgroundColor: activo ? T.acentoRelleno : T.superficie2,
                    borderWidth: 1, borderColor: activo ? T.acentoRelleno : T.borde,
                  }}
                >
                  <Txt escala="pie" fuerte={activo} tono={activo ? "principal" : "suave"} estilo={activo ? { color: T.acentoTexto } : undefined}>
                    {m.nombre}
                  </Txt>
                </Pressable>
              );
            })}
          </View>

          <Campo label="Motivo (opcional)">
            <TextInput
              style={estiloInput}
              value={motivoAbono}
              onChangeText={setMotivoAbono}
              placeholder="Ej. Pago de la quincena"
              placeholderTextColor={T.textoTenue}
            />
          </Campo>

          <Boton titulo="Guardar abono" onPress={confirmarAbono} cargando={guardando} />
        </ScrollView>
      )}
    </Hoja>
  );
}
