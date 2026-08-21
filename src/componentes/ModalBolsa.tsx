// YvexPOS Móvil — Bolsa de sobrante/faltante.
//
// Cuando el conteo a ciegas está activo (Ajustes → Sistema), cada corte de
// turno que no cuadra puede registrarse aquí — una sola bolsa del negocio,
// no una por cajero. Esta pantalla es donde el dueño ve el resultado: el
// saldo acumulado, quién ha aportado qué, y el historial completo.
//
// El resumen por usuario está ordenado del que MÁS FALTA acumula al que
// más sobra — es lo que responde directamente "¿quién me está fallando?"
// sin que el dueño tenga que sumar el historial a mano.

import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useTema } from "@/src/componentes/TemaProvider";
import { Hoja, Grupo, Fila, Lamina, Txt, Monto, Vacio } from "@/src/componentes/ui";
import { pesos, fmtFecha } from "@/src/base/formato";
import {
  saldoBolsa,
  historialBolsa,
  resumenBolsaPorUsuario,
  type MovimientoBolsa,
  type ResumenUsuarioBolsa,
} from "@/src/base/venta";

export default function ModalBolsa({ onCerrar }: { onCerrar: () => void }) {
  const { tema: T } = useTema();
  const [saldo, setSaldo] = useState(0);
  const [porUsuario, setPorUsuario] = useState<ResumenUsuarioBolsa[]>([]);
  const [historial, setHistorial] = useState<MovimientoBolsa[]>([]);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(() => {
    setCargando(true);
    Promise.all([saldoBolsa(), resumenBolsaPorUsuario(), historialBolsa()]).then(
      ([s, r, h]) => {
        setSaldo(s);
        setPorUsuario(r);
        setHistorial(h);
        setCargando(false);
      }
    );
  }, []);

  useFocusEffect(cargar);

  const hayDatos = historial.length > 0;
  const saldoAFavor = saldo >= 0;

  return (
    <Hoja visible onCerrar={onCerrar} titulo="Bolsa de caja" tipo="completa">
      {cargando ? null : !hayDatos ? (
        <Vacio
          titulo="Aún no hay nada en la bolsa"
          texto="Se llena sola cuando el conteo a ciegas está activo y un corte de turno no cuadra exacto. Actívalo en Ajustes → Sistema si quieres usarlo."
        />
      ) : (
        <>
          {/* Saldo — la cifra protagonista de esta pantalla. */}
          <View style={{ marginBottom: T.esps.xl }}>
            <Lamina>
              <Txt escala="micro" tono="suave" fuerte mayus>
                Saldo de la bolsa
              </Txt>
              <View style={{ marginTop: T.esps.xs }}>
                <Monto
                  texto={`${saldoAFavor ? "" : "−"}${pesos(Math.abs(saldo))}`}
                  escala="protagonista"
                  tono={saldoAFavor ? "exito" : "peligro"}
                />
              </View>
              <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.xs }}>
                {saldoAFavor
                  ? "A favor del negocio: los sobrantes pesan más que los faltantes."
                  : "En contra del negocio: los faltantes pesan más que los sobrantes."}
              </Txt>
            </Lamina>
          </View>

          {/* Resumen por usuario: el que más falta primero. */}
          <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.sm }}>
            Por usuario
          </Txt>
          <Grupo>
            {porUsuario.map((u) => {
              const aFavor = u.totalCentavos >= 0;
              return (
                <Fila
                  key={u.usuarioPosId ?? "sin-usuario"}
                  titulo={u.usuarioNombre}
                  meta={`${u.eventos} corte${u.eventos === 1 ? "" : "s"} con diferencia`}
                  flecha={false}
                  valor={
                    <Monto
                      texto={`${aFavor ? "+" : "−"}${pesos(Math.abs(u.totalCentavos))}`}
                      escala="pie"
                      tono={aFavor ? "exito" : "peligro"}
                    />
                  }
                />
              );
            })}
          </Grupo>

          {/* Historial completo, más reciente primero. */}
          <Txt
            escala="micro"
            tono="suave"
            fuerte
            mayus
            estilo={{ marginTop: T.esps.xl, marginBottom: T.esps.sm }}
          >
            Historial
          </Txt>
          <Grupo>
            {historial.map((m) => {
              const aFavor = m.diferenciaCentavos >= 0;
              return (
                <Fila
                  key={m.id}
                  titulo={m.usuarioNombre}
                  meta={fmtFecha(m.creadoEn)}
                  flecha={false}
                  valor={
                    <Monto
                      texto={`${aFavor ? "+" : "−"}${pesos(Math.abs(m.diferenciaCentavos))}`}
                      escala="pie"
                      tono={aFavor ? "exito" : "peligro"}
                    />
                  }
                />
              );
            })}
          </Grupo>
          <View style={{ height: T.esps.xxl }} />
        </>
      )}
    </Hoja>
  );
}
