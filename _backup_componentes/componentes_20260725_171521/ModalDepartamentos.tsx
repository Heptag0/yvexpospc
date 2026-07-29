// YvexPOS Móvil — Gestión de departamentos (rediseñado).
//
// Crear, editar y eliminar departamentos con su color. Confirmación antes de
// eliminar, y errores siempre legibles.

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Categoria,
  listarCategorias,
  crearCategoria,
  editarCategoria,
  eliminarCategoria,
} from "@/src/base/inventario";
import { useTema } from "@/src/componentes/TemaProvider";
import { ICONOS, Icono } from "@/src/componentes/iconos";
import { Boton, Banner, CabeceraModal, useEstiloInput } from "@/src/componentes/ui";

// Paleta curada para departamentos (buen contraste sobre oscuro).
// No depende del tema: son los colores elegibles para los departamentos.
const COLORES_DEPTO = [
  "#8b5cf6", "#2dd4bf", "#60a5fa", "#34d399",
  "#fbbf24", "#fb7185", "#e879f9", "#a7a9c4",
] as const;

type Tema = ReturnType<typeof useTema>["tema"];

type Props = {
  onCerrar: () => void;
  onCambio: () => void;
};

export default function ModalDepartamentos({ onCerrar, onCambio }: Props) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const estiloInput = useEstiloInput();
  const [cats, setCats] = useState<Categoria[]>([]);
  const [editando, setEditando] = useState<Categoria | null>(null);
  const [nombre, setNombre] = useState("");
  const [color, setColor] = useState<string>(COLORES_DEPTO[0]);
  const [icono, setIcono] = useState<string>("caja");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCats(await listarCategorias());
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function limpiarForm() {
    setEditando(null);
    setNombre("");
    setColor(COLORES_DEPTO[0]);
    setIcono("caja");
    setError("");
  }

  function editarForm(c: Categoria) {
    setEditando(c);
    setNombre(c.nombre);
    setColor(c.color ?? COLORES_DEPTO[0]);
    setIcono(c.icono ?? "caja");
    setError("");
  }

  async function guardar() {
    setError("");
    setGuardando(true);
    try {
      if (editando) await editarCategoria(editando.id, nombre, color, icono);
      else await crearCategoria(nombre, color, icono);
      await cargar();
      onCambio();
      limpiarForm();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setGuardando(false);
    }
  }

  function confirmarBorrado(c: Categoria) {
    Alert.alert(
      "Eliminar departamento",
      `¿Eliminar "${c.nombre}"? Sus productos quedarán sin departamento (no se borran).`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              await eliminarCategoria(c.id);
              await cargar();
              onCambio();
              if (editando?.id === c.id) limpiarForm();
            } catch (e: any) {
              setError(e?.message ?? String(e));
            }
          },
        },
      ]
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={est.raiz}>
        <CabeceraModal titulo="Departamentos" onIzquierda={onCerrar} izquierda="Listo" />
        <ScrollView contentContainerStyle={est.cuerpo} keyboardShouldPersistTaps="handled">
          {/* Formulario */}
          <View style={est.form}>
            <Text style={est.formTitulo}>
              {editando ? `Editando: ${editando.nombre}` : "Nuevo departamento"}
            </Text>
            <Banner texto={error} tipo="error" />
            <TextInput
              style={estiloInput}
              value={nombre}
              onChangeText={setNombre}
              placeholder="Nombre (ej. Bebidas)"
              placeholderTextColor={T.textoTenue}
            />
            <View style={est.colores}>
              {COLORES_DEPTO.map((col) => (
                <Pressable
                  key={col}
                  onPress={() => setColor(col)}
                  style={[
                    est.colorPunto,
                    { backgroundColor: col },
                    color === col && est.colorActivo,
                  ]}
                />
              ))}
            </View>

            <Text style={est.subLbl}>ICONO · lo heredan sus productos</Text>
            <View style={est.iconos}>
              {ICONOS.map((ic) => (
                <Pressable
                  key={ic.id}
                  onPress={() => setIcono(ic.id)}
                  style={[
                    est.iconoCaja,
                    icono === ic.id && { borderColor: color, backgroundColor: color + "26" },
                  ]}
                >
                  <Icono id={ic.id} size={22} color={icono === ic.id ? color : T.textoSuave} />
                </Pressable>
              ))}
            </View>
            <View style={est.formBotones}>
              {editando && (
                <View style={{ flex: 1 }}>
                  <Boton titulo="Cancelar" tipo="secundario" onPress={limpiarForm} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Boton
                  titulo={editando ? "Guardar cambios" : "Crear departamento"}
                  onPress={guardar}
                  cargando={guardando}
                />
              </View>
            </View>
          </View>

          {/* Lista */}
          <Text style={est.listaTitulo}>Tus departamentos</Text>
          {cats.length === 0 ? (
            <Text style={est.vacio}>Aún no tienes departamentos.</Text>
          ) : (
            cats.map((c) => (
              <View key={c.id} style={est.fila}>
                <View
                  style={[
                    est.filaIcono,
                    { backgroundColor: (c.color ?? T.acento) + "22", borderColor: (c.color ?? T.acento) + "55" },
                  ]}
                >
                  <Icono id={c.icono} size={18} color={c.color ?? T.acento} />
                </View>
                <Text style={est.filaNombre} numberOfLines={1}>{c.nombre}</Text>
                <Pressable onPress={() => editarForm(c)} hitSlop={10} style={est.filaAccion}>
                  <Text style={est.filaEditar}>Editar</Text>
                </Pressable>
                <Pressable onPress={() => confirmarBorrado(c)} hitSlop={10} style={est.filaAccion}>
                  <Text style={est.filaBorrar}>✕</Text>
                </Pressable>
              </View>
            ))
          )}
          <View style={{ height: 30 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function crearEstilos(T: Tema) {
  return StyleSheet.create({
  raiz: { flex: 1, backgroundColor: T.fondo },
  cuerpo: { padding: T.esp },
  form: {
    backgroundColor: T.superficie,
    borderRadius: T.radio,
    borderWidth: 1,
    borderColor: T.bordeFuerte,
    padding: 16,
    marginBottom: 24,
  },
  formTitulo: { color: T.texto, fontSize: 15, fontWeight: "800", marginBottom: 12 },
  colores: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginVertical: 16 },
  colorPunto: { width: 36, height: 36, borderRadius: 18 },
  colorActivo: { borderWidth: 3, borderColor: "#ffffff" },
  formBotones: { flexDirection: "row", gap: 10 },
  listaTitulo: {
    color: T.textoSuave,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  vacio: { color: T.textoTenue, textAlign: "center", marginTop: 20 },
  fila: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.superficie,
    borderRadius: T.radioChico + 2,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: T.borde,
  },
  filaPunto: { width: 14, height: 14, borderRadius: 7, marginRight: 12 },
  filaIcono: {
    width: 34, height: 34, borderRadius: 9, borderWidth: 1,
    alignItems: "center", justifyContent: "center", marginRight: 11,
  },
  subLbl: {
    color: T.textoSuave, fontSize: 11, fontWeight: "800",
    letterSpacing: 0.7, marginBottom: 9,
  },
  iconos: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  iconoCaja: {
    width: 44, height: 44, borderRadius: 11,
    backgroundColor: T.superficie2, borderWidth: 1, borderColor: T.borde,
    alignItems: "center", justifyContent: "center",
  },
  filaNombre: { flex: 1, color: T.texto, fontSize: 15, fontWeight: "600" },
  filaAccion: { paddingHorizontal: 8 },
  filaEditar: { color: T.turquesa, fontSize: 14, fontWeight: "700" },
  filaBorrar: { color: T.peligro, fontSize: 16, fontWeight: "800" },
  });
}
