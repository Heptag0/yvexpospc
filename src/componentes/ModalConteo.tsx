// YvexPOS Móvil — Conteo físico de inventario.
//
// Flujo real de tienda: eliges un departamento (o todo), recorres los
// productos anotando cuántos hay físicamente, y al final ves las DIFERENCIAS
// (sistema vs contado) antes de aplicar. Al aplicar, cada corrección queda con
// rastro (motivo 'conteo'). Lo que no cuentes, no se toca.
//
// ---------------------------------------------------------------------------
// MIGRADO AL SISTEMA DE DISEÑO
// ---------------------------------------------------------------------------
// Traía 100 líneas de StyleSheet propio, tres <Modal> montados a mano, y
// T.turquesa (el acento fantasma) pintando las flechas y las diferencias
// positivas. Los pasos eran tres returns con su propio Modal cada uno: al
// avanzar, el modal se desmontaba y se montaba otro, con su animación de
// entrada completa — se veía como si la app te sacara y te volviera a meter.
//
// Ahora es UNA sola <Hoja tipo="completa"> cuyo contenido cambia según el
// paso. Un solo modal, sin remontajes, y el título de la cabecera es lo que
// comunica dónde estás. De paso hereda el KeyboardAvoidingView de <Hoja>:
// antes tenía uno propio pero iOS-only, así que en Android el teclado tapaba
// justo las filas que estabas contando.
//
// Alert.alert al aplicar sustituido por el paso "listo" dentro de la misma
// hoja: el Alert nativo es la única pieza de la app que no se puede tematizar.
//
// La lista de conteo mantiene FlatList (puede haber cientos de productos y
// virtualizar importa), pero cada fila usa <Txt> y el input pasa por
// useEstiloInput en vez de un estilo local.

import { useEffect, useMemo, useState } from "react";
import { View, TextInput, FlatList, ActivityIndicator } from "react-native";
import {
  Categoria,
  ProductoConteo,
  Diferencia,
  listarCategorias,
  productosParaConteo,
  aplicarConteo,
} from "@/src/base/inventario";
import { aNumero, fmtStock } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import {
  Boton,
  Banner,
  Hoja,
  Grupo,
  Fila,
  Lamina,
  Txt,
  Monto,
  Vacio,
  useEstiloInput,
} from "@/src/componentes/ui";

type Props = {
  onCerrar: () => void;
  onAplicado: () => void;
};

type Paso = "elegir" | "contar" | "revisar" | "listo";

const TITULOS: Record<Paso, string> = {
  elegir: "Conteo físico",
  contar: "Contando",
  revisar: "Diferencias",
  listo: "Conteo aplicado",
};

export default function ModalConteo({ onCerrar, onAplicado }: Props) {
  const { tema: T } = useTema();
  const estiloInput = useEstiloInput();

  const [paso, setPaso] = useState<Paso>("elegir");
  const [cats, setCats] = useState<Categoria[]>([]);
  const [productos, setProductos] = useState<ProductoConteo[] | null>(null);
  const [conteos, setConteos] = useState<Record<string, string>>({});
  const [tituloDepto, setTituloDepto] = useState("Todo el inventario");
  const [error, setError] = useState("");
  const [aplicando, setAplicando] = useState(false);
  const [corregidos, setCorregidos] = useState(0);

  useEffect(() => {
    listarCategorias().then(setCats);
  }, []);

  async function empezar(categoriaId: string | null, titulo: string) {
    setTituloDepto(titulo);
    setProductos(null);
    setConteos({});
    setPaso("contar");
    setProductos(await productosParaConteo(categoriaId));
  }

  const contados = Object.values(conteos).filter((v) => String(v).trim() !== "").length;

  const diferencias: Diferencia[] = useMemo(() => {
    if (!productos) return [];
    return productos
      .filter((p) => (conteos[p.id] ?? "").trim() !== "")
      .map((p) => {
        const contado = aNumero(conteos[p.id]);
        return {
          id: p.id,
          nombre: p.nombre,
          sistema: p.stock,
          contado,
          diferencia: contado - p.stock,
        };
      });
  }, [productos, conteos]);

  const conDiferencia = diferencias.filter((d) => d.diferencia !== 0);

  async function aplicar() {
    setError("");
    setAplicando(true);
    try {
      const n = await aplicarConteo(diferencias);
      setCorregidos(n);
      setPaso("listo");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setAplicando(false);
    }
  }

  /** Atrás dentro de la hoja: retrocede un paso y solo cierra desde el
   *  primero. Antes cada paso era un Modal distinto y esto lo resolvía la
   *  CabeceraModal de cada uno por su cuenta. */
  function atras() {
    if (paso === "contar") setPaso("elegir");
    else if (paso === "revisar") setPaso("contar");
    else if (paso === "listo") onAplicado();
    else onCerrar();
  }

  // El pie cambia con el paso: es la acción principal de cada momento, y
  // vive fijo abajo, en la zona del pulgar.
  const pie =
    paso === "contar" && contados > 0 ? (
      <Boton titulo={`Revisar ${contados} contados`} onPress={() => setPaso("revisar")} />
    ) : paso === "revisar" ? (
      <Boton
        titulo={
          conDiferencia.length === 0
            ? "Confirmar: todo cuadra"
            : `Aplicar ${conDiferencia.length} corrección${conDiferencia.length === 1 ? "" : "es"}`
        }
        onPress={aplicar}
        cargando={aplicando}
      />
    ) : paso === "listo" ? (
      <Boton titulo="Listo" onPress={onAplicado} />
    ) : undefined;

  return (
    <Hoja visible onCerrar={atras} titulo={TITULOS[paso]} tipo="completa" pie={pie}>
      <Banner texto={error} tipo="error" />

      {/* ---------------------- PASO 1: elegir alcance ---------------------- */}
      {paso === "elegir" && (
        <>
          <Txt escala="pie" tono="suave" estilo={{ marginBottom: T.esps.lg }}>
            Elige qué contar. Recorre la tienda anotando lo que hay físicamente;
            al final verás las diferencias antes de aplicar.
          </Txt>

          <Grupo>
            <Fila
              titulo="Todo el inventario"
              meta="Todos los productos que controlan stock"
              onPress={() => empezar(null, "Todo el inventario")}
            />
          </Grupo>

          {cats.length > 0 && (
            <>
              <Txt
                escala="micro"
                tono="suave"
                fuerte
                mayus
                estilo={{ marginTop: T.esps.xl, marginBottom: T.esps.sm }}
              >
                O por departamento
              </Txt>
              <Grupo>
                {cats.map((c) => (
                  <Fila
                    key={c.id}
                    titulo={c.nombre}
                    onPress={() => empezar(c.id, c.nombre)}
                    icono={
                      <View
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: 5,
                          backgroundColor: c.color ?? T.textoTenue,
                        }}
                      />
                    }
                  />
                ))}
              </Grupo>
            </>
          )}
        </>
      )}

      {/* ------------------------- PASO 2: contar ------------------------- */}
      {paso === "contar" &&
        (!productos ? (
          <View style={{ paddingVertical: T.esps.xxl, alignItems: "center" }}>
            <ActivityIndicator size="large" color={T.acento} />
          </View>
        ) : productos.length === 0 ? (
          <Vacio
            titulo="No hay productos contables aquí"
            texto="Solo aparecen los productos que controlan stock. Elige otro departamento."
          />
        ) : (
          <>
            <Txt escala="pie" tono="tenue" estilo={{ marginBottom: T.esps.md }}>
              {tituloDepto} · anota solo lo que cuentes. Lo que dejes vacío no se
              toca.
            </Txt>
            {/* FlatList y no un map: aquí puede haber cientos de productos y
                virtualizar deja de ser un lujo. Va dentro del scroll de la
                <Hoja>, así que se le quita el suyo (scrollEnabled={false}) —
                dos superficies con scroll anidadas se pelean por el gesto. */}
            <FlatList
              data={productos}
              scrollEnabled={false}
              keyExtractor={(p) => p.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: T.esps.sm }}
              renderItem={({ item }) => (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: T.esps.md,
                    backgroundColor: T.superficie,
                    borderRadius: T.radio,
                    paddingHorizontal: T.esps.lg,
                    paddingVertical: T.esps.md,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Txt escala="cuerpo" lineas={1}>
                      {item.nombre}
                    </Txt>
                    <Txt escala="pie" tono="tenue" estilo={{ marginTop: 2 }}>
                      Sistema: {fmtStock(item.stock, item.unidad)}
                    </Txt>
                  </View>
                  <TextInput
                    style={[
                      estiloInput,
                      { width: 88, textAlign: "center", paddingVertical: T.esps.md },
                    ]}
                    value={conteos[item.id] ?? ""}
                    onChangeText={(t) =>
                      setConteos((prev) => ({ ...prev, [item.id]: t }))
                    }
                    keyboardType="decimal-pad"
                    placeholder="—"
                    placeholderTextColor={T.textoTenue}
                    accessibilityLabel={`Cuántos hay de ${item.nombre}`}
                  />
                </View>
              )}
            />
          </>
        ))}

      {/* -------------------- PASO 3: revisar diferencias -------------------- */}
      {paso === "revisar" && (
        <>
          <View style={{ marginBottom: T.esps.xl }}>
            <Lamina>
              <Txt escala="micro" tono="suave" fuerte mayus>
                Con diferencia
              </Txt>
              <View style={{ marginTop: T.esps.xs }}>
                <Monto
                  texto={String(conDiferencia.length)}
                  escala="protagonista"
                  tono={conDiferencia.length > 0 ? "alerta" : "exito"}
                />
              </View>
              <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.xs }}>
                {conDiferencia.length === 0
                  ? `Contaste ${diferencias.length} productos y todo cuadra.`
                  : `De los ${diferencias.length} que contaste. El resto cuadra.`}
              </Txt>
            </Lamina>
          </View>

          {diferencias.length === 0 ? (
            <Vacio
              titulo="No contaste nada todavía"
              texto="Vuelve atrás y anota al menos un producto."
            />
          ) : (
            <Grupo>
              {diferencias.map((d) => (
                <Fila
                  key={d.id}
                  titulo={d.nombre}
                  meta={`Sistema ${d.sistema} · contaste ${d.contado}`}
                  flecha={false}
                  valor={
                    <Monto
                      texto={
                        d.diferencia === 0
                          ? "cuadra"
                          : d.diferencia > 0
                          ? `+${d.diferencia}`
                          : String(d.diferencia)
                      }
                      escala="cuerpo"
                      tono={
                        d.diferencia === 0
                          ? "suave"
                          : d.diferencia > 0
                          ? "exito"
                          : "peligro"
                      }
                    />
                  }
                />
              ))}
            </Grupo>
          )}
        </>
      )}

      {/* ------------------------- PASO 4: aplicado ------------------------- */}
      {paso === "listo" && (
        <Vacio
          titulo={
            corregidos === 0 ? "Todo cuadraba" : `Se corrigieron ${corregidos} productos`
          }
          texto={
            corregidos === 0
              ? "No hubo nada que corregir: tu inventario ya coincidía con lo que hay en la tienda."
              : "Cada corrección quedó registrada con motivo «conteo físico», así que puedes ver el rastro en el historial de cada producto."
          }
        />
      )}

      <View style={{ height: T.esps.xxl }} />
    </Hoja>
  );
}
