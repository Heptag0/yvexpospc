// YvexPOS Móvil — Reporte de inventario (valorización por departamento).
//
// Cuánto vale tu inventario, departamento por departamento: productos,
// unidades, valor a costo, valor a precio de venta, y utilidad potencial.
//
// ---------------------------------------------------------------------------
// MIGRADO AL SISTEMA DE DISEÑO
// ---------------------------------------------------------------------------
// Esta pantalla montaba 130 líneas de StyleSheet propio: `fontWeight: "800"`
// a mano, tamaños sueltos (19, 14, 12, 11, 10), bordes de 1px, y T.turquesa
// — el acento fantasma que se retiró de toda la app en la Fase 1 y que aquí
// seguía pintando la utilidad. Al lado de Reportes o Inventario se veía de
// otra aplicación.
//
// Ahora usa las mismas primitivas que el resto: <Hoja>, <Lamina>, <Seccion>,
// <Grupo>, <Fila>, <Txt> y <Monto>. Cero StyleSheet propio, cero tamaños a
// mano, y todo el dinero en IBM Plex Mono como en cualquier otra pantalla.
//
// Y se aplica la dirección "Cinta" tal como quedó en Reportes:
//   · UNA sola <Lamina>, con la cifra protagonista y su conclusión debajo.
//   · Barras para comparar departamentos, no una rejilla de cifras sueltas:
//     la pregunta real es "¿dónde tengo metido el dinero?", y eso es una
//     proporción, no cuatro números que hay que restar mentalmente.
//   · Denso de la mitad para abajo, donde se escanea.
//
// El <Modal> propio también desaparece: <Hoja tipo="completa"> ya lo trae, y
// de paso hereda su KeyboardAvoidingView y su cabecera.

import { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { FilaReporte, reportePorDepartamento } from "@/src/base/inventario";
import { pesos } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import {
  Hoja,
  Lamina,
  Seccion,
  Grupo,
  Fila,
  Txt,
  Monto,
  Vacio,
} from "@/src/componentes/ui";

type Props = {
  onCerrar: () => void;
};

export default function ModalReporte({ onCerrar }: Props) {
  const { tema: T } = useTema();
  const [filas, setFilas] = useState<FilaReporte[] | null>(null);

  useEffect(() => {
    reportePorDepartamento().then(setFilas);
  }, []);

  const tot = (filas ?? []).reduce(
    (a, f) => ({
      productos: a.productos + f.productos,
      unidades: a.unidades + f.unidades,
      costo: a.costo + f.valor_costo_centavos,
      precio: a.precio + f.valor_precio_centavos,
    }),
    { productos: 0, unidades: 0, costo: 0, precio: 0 }
  );
  const utilidad = tot.precio - tot.costo;
  const margenPct = tot.precio > 0 ? (utilidad / tot.precio) * 100 : 0;
  const maxCosto = Math.max(1, ...(filas ?? []).map((f) => f.valor_costo_centavos));

  return (
    <Hoja visible onCerrar={onCerrar} titulo="Reporte de inventario" tipo="completa">
      {!filas ? (
        <View style={{ paddingVertical: T.esps.xxl, alignItems: "center" }}>
          <ActivityIndicator size="large" color={T.acento} />
        </View>
      ) : filas.length === 0 ? (
        <Vacio
          titulo="Nada que valorizar todavía"
          texto="Cuando tus productos tengan costo y stock, aquí verás cuánto vale tu inventario y en qué departamento está metido tu dinero."
        />
      ) : (
        <>
          {/* La cifra protagonista es lo que te COSTÓ, no lo que vale a precio
              de venta: es el dinero que de verdad tienes inmovilizado en el
              anaquel. El valor a precio es una expectativa, no un hecho, y no
              debería competir por el tamaño grande. */}
          <View style={{ marginBottom: T.esps.xl }}>
            <Lamina>
              <Txt escala="micro" tono="suave" fuerte mayus>
                Tienes invertido
              </Txt>
              <View style={{ marginTop: T.esps.xs }}>
                <Monto texto={pesos(tot.costo)} escala="protagonista" />
              </View>

              <View
                style={{
                  marginTop: T.esps.md,
                  paddingTop: T.esps.md,
                  borderTopWidth: 1,
                  borderTopColor: T.borde,
                }}
              >
                <Txt escala="cuerpo">
                  Si lo vendieras todo te quedarían {pesos(utilidad)}
                  {margenPct >= 1
                    ? `, el ${Math.round(margenPct)}% de lo que cobrarías.`
                    : "."}
                </Txt>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  marginTop: T.esps.lg,
                  paddingTop: T.esps.lg,
                  borderTopWidth: 1,
                  borderTopColor: T.borde,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Monto texto={pesos(tot.precio)} escala="titulo" />
                  <Txt escala="pie" tono="suave">
                    valor a precio
                  </Txt>
                </View>
                <View style={{ width: 1, backgroundColor: T.borde }} />
                <View style={{ flex: 1, paddingLeft: T.esps.lg }}>
                  <Monto texto={String(Math.round(tot.unidades))} escala="titulo" />
                  <Txt escala="pie" tono="suave">
                    unidades en {tot.productos}{" "}
                    {tot.productos === 1 ? "producto" : "productos"}
                  </Txt>
                </View>
              </View>
            </Lamina>
          </View>

          {/* Dónde está metido el dinero. La barra va sobre el valor a COSTO,
              que es la misma magnitud de la lámina: mezclar aquí el precio de
              venta pondría dos escalas distintas en la misma pantalla. */}
          <Seccion titulo="Dónde está tu dinero">
            <View
              style={{
                backgroundColor: T.superficie,
                borderRadius: T.radio,
                padding: T.esps.lg,
                gap: T.esps.lg,
              }}
            >
              {filas.map((f) => {
                const util = f.valor_precio_centavos - f.valor_costo_centavos;
                return (
                  <View key={f.categoria_id ?? "sin"}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: T.esps.sm,
                        marginBottom: T.esps.sm,
                      }}
                    >
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: f.color ?? T.textoTenue,
                        }}
                      />
                      <View style={{ flex: 1 }}>
                        <Txt escala="pie" lineas={1}>
                          {f.categoria}
                        </Txt>
                      </View>
                      <Monto texto={pesos(f.valor_costo_centavos)} escala="pie" />
                    </View>
                    <View
                      style={{
                        height: 6,
                        backgroundColor: T.superficie2,
                        borderRadius: 3,
                        overflow: "hidden",
                      }}
                    >
                      <View
                        style={{
                          height: "100%",
                          borderRadius: 3,
                          width: `${Math.max(3, (f.valor_costo_centavos / maxCosto) * 100)}%`,
                          backgroundColor: f.color ?? T.acento,
                        }}
                      />
                    </View>
                    <Txt escala="micro" tono="tenue" estilo={{ marginTop: 4 }}>
                      {f.productos} {f.productos === 1 ? "producto" : "productos"} ·{" "}
                      {Math.round(f.unidades)} u · deja {pesos(util)}
                    </Txt>
                  </View>
                );
              })}
            </View>
          </Seccion>

          {/* El detalle numérico, para quien quiera la cifra exacta. Denso:
              aquí se escanea, no se lee. */}
          <Seccion titulo="Detalle por departamento">
            <Grupo>
              {filas.map((f) => {
                const util = f.valor_precio_centavos - f.valor_costo_centavos;
                return (
                  <Fila
                    key={f.categoria_id ?? "sin"}
                    titulo={f.categoria}
                    flecha={false}
                    meta={`A precio ${pesos(f.valor_precio_centavos)} · a costo ${pesos(
                      f.valor_costo_centavos
                    )}`}
                    icono={
                      <View
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: 5,
                          backgroundColor: f.color ?? T.textoTenue,
                        }}
                      />
                    }
                    valor={
                      <Monto
                        texto={pesos(util)}
                        escala="cuerpo"
                        tono={util >= 0 ? "exito" : "peligro"}
                      />
                    }
                  />
                );
              })}
            </Grupo>
          </Seccion>

          <View style={{ height: T.esps.xxl }} />
        </>
      )}
    </Hoja>
  );
}
