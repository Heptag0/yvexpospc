// YvexPOS Móvil — Resolver coincidencias de catálogo al vincular.
//
// Se abre SOLO cuando detectarConflictosCatalogo() encuentra choques reales
// (mismo código de barras, o si no hay código, mismo nombre) entre el
// catálogo de este teléfono y el del negocio. Lo que NO choca con nada no
// pasa por aquí — se sube solo, sin interrumpir a nadie.
//
// PENDIENTES.md punto 32: antes esto era un Alert.alert() de sí/no que
// archivaba TODO el catálogo local sin comparar nada contra lo que el
// negocio ya tenía. Ahora se compara producto por producto, y solo lo que
// de verdad coincide pide una decisión.

import { useState } from "react";
import { View, Pressable } from "react-native";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, Hoja, Grupo, Txt, Monto } from "@/src/componentes/ui";
import { pesos } from "@/src/base/formato";
import {
  ConflictoProducto,
  DecisionConflicto,
  resolverConflictoProducto,
  resolverTodosLosConflictos,
} from "@/src/base/sync";

export default function ModalConflictosCatalogo({
  conflictos,
  onResuelto,
  onCerrar,
}: {
  conflictos: ConflictoProducto[];
  /** Se llama cuando YA NO quedan conflictos pendientes — el llamador debe
   *  refrescar y subir lo que sobrevivió sin conflicto (prepararTrasVincular). */
  onResuelto: () => void;
  onCerrar: () => void;
}) {
  const { tema: T } = useTema();
  const [pendientes, setPendientes] = useState(conflictos);
  const [resolviendo, setResolviendo] = useState<string | null>(null);
  const [confirmandoTodos, setConfirmandoTodos] = useState<DecisionConflicto | null>(null);
  const [error, setError] = useState("");

  async function resolverUno(c: ConflictoProducto, decision: DecisionConflicto) {
    setError("");
    setResolviendo(c.localId);
    try {
      await resolverConflictoProducto(c, decision);
      const restantes = pendientes.filter((x) => x.localId !== c.localId);
      setPendientes(restantes);
      if (restantes.length === 0) onResuelto();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setResolviendo(null);
    }
  }

  async function resolverTodos(decision: DecisionConflicto) {
    setConfirmandoTodos(null);
    setError("");
    setResolviendo("__todos__");
    try {
      await resolverTodosLosConflictos(pendientes, decision);
      setPendientes([]);
      onResuelto();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setResolviendo(null);
    }
  }

  return (
    <Hoja
      visible
      onCerrar={onCerrar}
      titulo={`${pendientes.length} coincidencia${pendientes.length === 1 ? "" : "s"}`}
      tipo="completa"
    >
      <Txt escala="pie" tono="suave" estilo={{ marginBottom: T.esps.lg }}>
        Estos productos parecen ser el mismo en tu teléfono y en el negocio — coinciden{" "}
        {pendientes.some((c) => c.coincidePor === "codigo_barras") ? "por código de barras o nombre" : "por nombre"}.
        Elige cuál versión se queda; la otra se archiva (nunca se borra). Todo lo demás de tu
        teléfono ya se está subiendo solo, sin necesitar nada de esto.
      </Txt>

      <Banner texto={error} tipo="error" />

      {pendientes.length > 1 && (
        <View style={{ flexDirection: "row", gap: T.esps.sm, marginBottom: T.esps.lg }}>
          <View style={{ flex: 1 }}>
            <Boton
              titulo="Todos del negocio"
              tipo="secundario"
              chico
              onPress={() => setConfirmandoTodos("remoto")}
              deshabilitado={!!resolviendo}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Boton
              titulo="Todos de este teléfono"
              tipo="secundario"
              chico
              onPress={() => setConfirmandoTodos("local")}
              deshabilitado={!!resolviendo}
            />
          </View>
        </View>
      )}

      <Grupo>
        {pendientes.map((c) => (
          <View
            key={c.localId}
            style={{
              padding: T.esps.lg,
              borderBottomWidth: 1,
              borderBottomColor: T.borde,
              opacity: resolviendo === c.localId ? 0.5 : 1,
            }}
          >
            <Txt escala="cuerpo" fuerte estilo={{ marginBottom: 2 }}>
              {c.remoto.nombre}
            </Txt>
            <Txt escala="micro" tono="tenue" estilo={{ marginBottom: T.esps.md }}>
              {c.coincidePor === "codigo_barras"
                ? `Mismo código de barras: ${c.local.codigo_barras}`
                : "Mismo nombre"}
            </Txt>

            <View style={{ flexDirection: "row", gap: T.esps.sm }}>
              <Pressable
                onPress={() => resolverUno(c, "remoto")}
                disabled={!!resolviendo}
                android_ripple={{ color: T.acentoBorde }}
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: T.borde,
                  borderRadius: T.radioChico,
                  padding: T.esps.md,
                }}
              >
                <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: 4 }}>
                  Del negocio
                </Txt>
                <Monto texto={pesos(c.remoto.precio_venta_centavos)} escala="pie" />
                <Txt escala="micro" tono="tenue">
                  Stock: {c.remoto.stock}
                </Txt>
              </Pressable>

              <Pressable
                onPress={() => resolverUno(c, "local")}
                disabled={!!resolviendo}
                android_ripple={{ color: T.acentoBorde }}
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: T.borde,
                  borderRadius: T.radioChico,
                  padding: T.esps.md,
                }}
              >
                <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: 4 }}>
                  De este teléfono
                </Txt>
                <Monto texto={pesos(c.local.precio_venta_centavos)} escala="pie" />
                <Txt escala="micro" tono="tenue">
                  Stock: {c.local.stock}
                </Txt>
              </Pressable>
            </View>
          </View>
        ))}
      </Grupo>

      {/* Confirmación del atajo "todos" — afecta a todo lo pendiente de una
          sola vez, merece un paso extra antes de aplicarse. */}
      <Hoja
        visible={!!confirmandoTodos}
        onCerrar={() => setConfirmandoTodos(null)}
        titulo="Aplicar a todos"
        pie={
          <View style={{ gap: T.esps.sm }}>
            <Boton
              titulo={`Sí, quedarme con ${confirmandoTodos === "remoto" ? "el negocio" : "este teléfono"} en los ${pendientes.length}`}
              onPress={() => confirmandoTodos && resolverTodos(confirmandoTodos)}
            />
            <Boton titulo="Cancelar" tipo="secundario" onPress={() => setConfirmandoTodos(null)} />
          </View>
        }
      >
        <Txt escala="pie" tono="suave">
          Vas a quedarte con la versión {confirmandoTodos === "remoto" ? "del negocio" : "de este teléfono"} en
          las {pendientes.length} coincidencias. La otra versión de cada una se archiva — puedes recuperarlas
          después desde Sincronización si te equivocas.
        </Txt>
      </Hoja>
    </Hoja>
  );
}
