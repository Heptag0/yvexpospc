// YvexPOS Móvil — Conteo físico de inventario.
//
// Flujo real de tienda: eliges un departamento (o todo), recorres los
// productos anotando cuántos hay físicamente, y al final ves las DIFERENCIAS
// (sistema vs contado) antes de aplicar. Al aplicar, cada corrección queda con
// rastro (motivo 'conteo'). Lo que no cuentes, no se toca.

import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
import { Boton, Banner, CabeceraModal } from "@/src/componentes/ui";

type Props = {
  onCerrar: () => void;
  onAplicado: () => void;
};

type Paso = "elegir" | "contar" | "revisar";

type Tema = ReturnType<typeof useTema>["tema"];

export default function ModalConteo({ onCerrar, onAplicado }: Props) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const [paso, setPaso] = useState<Paso>("elegir");
  const [cats, setCats] = useState<Categoria[]>([]);
  const [productos, setProductos] = useState<ProductoConteo[] | null>(null);
  const [conteos, setConteos] = useState<Record<string, string>>({});
  const [tituloDepto, setTituloDepto] = useState("Todo el inventario");
  const [error, setError] = useState("");
  const [aplicando, setAplicando] = useState(false);

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
      Alert.alert(
        "Conteo aplicado",
        n === 0
          ? "Todo cuadraba: no hubo nada que corregir."
          : `Se corrigieron ${n} producto${n === 1 ? "" : "s"}.`,
        [{ text: "Listo", onPress: onAplicado }]
      );
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setAplicando(false);
    }
  }

  // ------------------------- PASO 1: elegir alcance -------------------------
  if (paso === "elegir") {
    return (
      <Modal visible animationType="slide" onRequestClose={onCerrar}>
        <SafeAreaView style={est.raiz}>
          <CabeceraModal titulo="Conteo físico" onIzquierda={onCerrar} izquierda="Cerrar" />
          <View style={est.cuerpo}>
            <Text style={est.intro}>
              Elige qué contar. Recorre la tienda anotando lo que hay
              físicamente; al final verás las diferencias antes de aplicar.
            </Text>
            <Pressable style={est.opcion} onPress={() => empezar(null, "Todo el inventario")}>
              <Text style={est.opcionTxt}>Todo el inventario</Text>
              <Text style={est.opcionFlecha}>→</Text>
            </Pressable>
            <Text style={est.oDeptos}>O POR DEPARTAMENTO</Text>
            {cats.map((c) => (
              <Pressable key={c.id} style={est.opcion} onPress={() => empezar(c.id, c.nombre)}>
                <View style={[est.punto, { backgroundColor: c.color ?? T.textoTenue }]} />
                <Text style={est.opcionTxt}>{c.nombre}</Text>
                <Text style={est.opcionFlecha}>→</Text>
              </Pressable>
            ))}
          </View>
        </SafeAreaView>
      </Modal>
    );
  }

  // ------------------------- PASO 2: contar -------------------------
  if (paso === "contar") {
    return (
      <Modal visible animationType="slide" onRequestClose={onCerrar}>
        <SafeAreaView style={est.raiz}>
          <CabeceraModal
            titulo={tituloDepto}
            izquierda="← Atrás"
            onIzquierda={() => setPaso("elegir")}
            derecha={contados > 0 ? `Revisar (${contados})` : undefined}
            onDerecha={contados > 0 ? () => setPaso("revisar") : undefined}
          />
          {!productos ? (
            <View style={est.centro}>
              <ActivityIndicator size="large" color={T.acento} />
            </View>
          ) : (
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
              <FlatList
                data={productos}
                keyExtractor={(p) => p.id}
                contentContainerStyle={est.lista}
                keyboardShouldPersistTaps="handled"
                ListHeaderComponent={
                  <Text style={est.contarAyuda}>
                    Anota solo lo que cuentes. Lo vacío no se toca.
                  </Text>
                }
                ListEmptyComponent={
                  <Text style={est.vacio}>No hay productos contables aquí.</Text>
                }
                renderItem={({ item }) => (
                  <View style={est.contarFila}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={est.contarNombre} numberOfLines={1}>{item.nombre}</Text>
                      <Text style={est.contarMeta}>
                        Sistema: {fmtStock(item.stock, item.unidad)}
                      </Text>
                    </View>
                    <TextInput
                      style={est.contarInput}
                      value={conteos[item.id] ?? ""}
                      onChangeText={(t) =>
                        setConteos((prev) => ({ ...prev, [item.id]: t }))
                      }
                      keyboardType="decimal-pad"
                      placeholder="—"
                      placeholderTextColor={T.textoTenue}
                    />
                  </View>
                )}
              />
            </KeyboardAvoidingView>
          )}
        </SafeAreaView>
      </Modal>
    );
  }

  // ------------------------- PASO 3: revisar y aplicar -------------------------
  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={est.raiz}>
        <CabeceraModal
          titulo="Diferencias"
          izquierda="← Seguir contando"
          onIzquierda={() => setPaso("contar")}
        />
        <FlatList
          data={diferencias}
          keyExtractor={(d) => d.id}
          contentContainerStyle={est.lista}
          ListHeaderComponent={
            <>
              <Banner texto={error} tipo="error" />
              <View style={est.revResumen}>
                <Text style={est.revTxt}>
                  Contaste <Text style={est.revNum}>{diferencias.length}</Text> productos ·{" "}
                  <Text style={[est.revNum, { color: conDiferencia.length ? T.alerta : T.exito }]}>
                    {conDiferencia.length}
                  </Text>{" "}
                  con diferencia
                </Text>
              </View>
            </>
          }
          renderItem={({ item }) => {
            const dif = item.diferencia;
            return (
              <View style={est.revFila}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={est.contarNombre} numberOfLines={1}>{item.nombre}</Text>
                  <Text style={est.contarMeta}>
                    {item.sistema} → {item.contado}
                  </Text>
                </View>
                <Text
                  style={[
                    est.revDif,
                    dif === 0 && { color: T.exito },
                    dif > 0 && { color: T.turquesa },
                    dif < 0 && { color: T.peligro },
                  ]}
                >
                  {dif === 0 ? "✓" : dif > 0 ? `+${dif}` : String(dif)}
                </Text>
              </View>
            );
          }}
          ListFooterComponent={
            <View style={{ marginTop: 16 }}>
              <Boton
                titulo={
                  conDiferencia.length === 0
                    ? "Confirmar (todo cuadra)"
                    : `Aplicar ${conDiferencia.length} corrección${conDiferencia.length === 1 ? "" : "es"}`
                }
                onPress={aplicar}
                cargando={aplicando}
              />
              <View style={{ height: 30 }} />
            </View>
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

function crearEstilos(T: Tema) {
  return StyleSheet.create({
  raiz: { flex: 1, backgroundColor: T.fondo },
  centro: { flex: 1, alignItems: "center", justifyContent: "center" },
  cuerpo: { padding: T.esp },
  intro: { color: T.textoSuave, fontSize: 14, lineHeight: 21, marginBottom: 18 },
  opcion: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.superficie,
    borderRadius: T.radio,
    borderWidth: 1,
    borderColor: T.borde,
    padding: 16,
    marginBottom: 9,
  },
  opcionTxt: { color: T.texto, fontSize: 15, fontWeight: "700", flex: 1 },
  opcionFlecha: { color: T.turquesa, fontSize: 16, fontWeight: "800" },
  oDeptos: {
    color: T.textoTenue,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 9,
  },
  punto: { width: 12, height: 12, borderRadius: 6, marginRight: 10 },
  lista: { padding: T.esp, paddingBottom: 60 },
  contarAyuda: { color: T.textoTenue, fontSize: 13, marginBottom: 12 },
  vacio: { color: T.textoTenue, textAlign: "center", marginTop: 30 },
  contarFila: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.superficie,
    borderRadius: T.radioChico + 2,
    borderWidth: 1,
    borderColor: T.borde,
    padding: 12,
    marginBottom: 8,
  },
  contarNombre: { color: T.texto, fontSize: 14, fontWeight: "600" },
  contarMeta: { color: T.textoTenue, fontSize: 12, marginTop: 2 },
  contarInput: {
    backgroundColor: T.superficie2,
    borderRadius: T.radioChico,
    borderWidth: 1,
    borderColor: T.bordeFuerte,
    color: T.texto,
    width: 84,
    textAlign: "center",
    paddingVertical: 10,
    fontSize: 17,
    fontWeight: "700",
  },
  revResumen: {
    backgroundColor: T.superficie,
    borderRadius: T.radio,
    borderWidth: 1,
    borderColor: T.borde,
    padding: 14,
    marginBottom: 12,
  },
  revTxt: { color: T.textoSuave, fontSize: 14 },
  revNum: { color: T.texto, fontWeight: "800" },
  revFila: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.superficie,
    borderRadius: T.radioChico + 2,
    borderWidth: 1,
    borderColor: T.borde,
    padding: 12,
    marginBottom: 7,
  },
  revDif: { fontSize: 17, fontWeight: "800", minWidth: 46, textAlign: "right" },
  });
}
