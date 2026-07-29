// YvexPOS Móvil — Usuarios (cajeros).
//
// Dos modos en un solo modal:
//   - "cambiar": elegir quién está vendiendo ahora (con PIN si está activado).
//   - "gestionar": crear, editar y eliminar usuarios (solo dueño/gerente).
//
// Pensado para el caso real de una tablet compartida: cada empleado entra con
// su PIN y sus ventas quedan a su nombre. Si el negocio es de una persona,
// esto no estorba: hay un usuario, se selecciona solo, y no se pide PIN.

import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  StyleSheet,
  Switch,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  UsuarioPOS,
  Rol,
  ROLES,
  listarUsuarios,
  crearUsuario,
  editarUsuario,
  eliminarUsuario,
  verificarPin,
  activarUsuario,
  usuarioActivoId,
  pideePin,
  setPedirPin,
} from "@/src/base/usuarios";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, Banner, CabeceraModal } from "@/src/componentes/ui";

type Vista = "lista" | "pin" | "form";

export default function ModalUsuarios({
  modo,
  onCerrar,
  onCambio,
}: {
  modo: "cambiar" | "gestionar";
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const { tema: T } = useTema();
  const [vista, setVista] = useState<Vista>("lista");
  const [usuarios, setUsuarios] = useState<UsuarioPOS[]>([]);
  const [activoId, setActivoId] = useState<string | null>(null);
  const [conPin, setConPin] = useState(true);

  // PIN
  const [candidato, setCandidato] = useState<UsuarioPOS | null>(null);
  const [pin, setPin] = useState("");

  // Formulario
  const [editando, setEditando] = useState<UsuarioPOS | null>(null);
  const [nombre, setNombre] = useState("");
  const [pinNuevo, setPinNuevo] = useState("");
  const [rol, setRol] = useState<Rol>("cajero");

  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const [us, act, pp] = await Promise.all([
      listarUsuarios(),
      usuarioActivoId(),
      pideePin(),
    ]);
    setUsuarios(us);
    setActivoId(act);
    setConPin(pp);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // --- Cambiar de usuario ---
  async function elegir(u: UsuarioPOS) {
    setError("");
    if (!conPin) {
      await activarUsuario(u.id);
      onCambio();
      onCerrar();
      return;
    }
    setCandidato(u);
    setPin("");
    setVista("pin");
  }

  async function confirmarPin() {
    if (!candidato) return;
    setError("");
    setGuardando(true);
    try {
      const ok = await verificarPin(candidato.id, pin);
      if (!ok) {
        setError("PIN incorrecto.");
        setPin("");
        return;
      }
      await activarUsuario(candidato.id);
      onCambio();
      onCerrar();
    } finally {
      setGuardando(false);
    }
  }

  // --- Gestionar ---
  function nuevoForm() {
    setEditando(null);
    setNombre("");
    setPinNuevo("");
    setRol("cajero");
    setError("");
    setVista("form");
  }

  function editarForm(u: UsuarioPOS) {
    setEditando(u);
    setNombre(u.nombre);
    setPinNuevo("");
    setRol(u.rol);
    setError("");
    setVista("form");
  }

  async function guardar() {
    setError("");
    setGuardando(true);
    try {
      if (editando) {
        await editarUsuario(editando.id, nombre, rol, pinNuevo || undefined);
      } else {
        if (!pinNuevo) throw new Error("Escribe un PIN de 4 dígitos.");
        await crearUsuario(nombre, pinNuevo, rol);
      }
      await cargar();
      onCambio();
      setVista("lista");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setGuardando(false);
    }
  }

  function confirmarBorrado(u: UsuarioPOS) {
    Alert.alert(
      "Eliminar usuario",
      `¿Eliminar a "${u.nombre}"? Sus ventas anteriores se conservan.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              await eliminarUsuario(u.id);
              await cargar();
              onCambio();
            } catch (e: any) {
              setError(e?.message ?? String(e));
            }
          },
        },
      ]
    );
  }

  const inp = {
    backgroundColor: T.superficie2,
    borderRadius: T.radioChico,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: T.texto,
    borderWidth: 1,
    borderColor: T.borde,
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={[e.raiz, { backgroundColor: T.fondo }]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <CabeceraModal
            titulo={
              vista === "pin"
                ? candidato?.nombre ?? "PIN"
                : vista === "form"
                ? editando
                  ? "Editar usuario"
                  : "Nuevo usuario"
                : modo === "cambiar"
                ? "¿Quién vende?"
                : "Usuarios"
            }
            izquierda={vista === "lista" ? "Cerrar" : "← Atrás"}
            onIzquierda={() => {
              if (vista === "lista") onCerrar();
              else {
                setVista("lista");
                setError("");
              }
            }}
            derecha={vista === "lista" && modo === "gestionar" ? "+ Nuevo" : undefined}
            onDerecha={vista === "lista" && modo === "gestionar" ? nuevoForm : undefined}
          />

          <ScrollView
            contentContainerStyle={{ padding: T.esp, paddingBottom: 50 }}
            keyboardShouldPersistTaps="handled"
          >
            <Banner texto={error} tipo="error" />

            {/* ---------------- LISTA ---------------- */}
            {vista === "lista" && (
              <>
                {modo === "cambiar" && (
                  <Text style={[e.ayuda, { color: T.textoSuave }]}>
                    Cada venta queda registrada a nombre de quien la hace.
                  </Text>
                )}

                {usuarios.map((u) => {
                  const esActivo = u.id === activoId;
                  return (
                    <Pressable
                      key={u.id}
                      onPress={() => (modo === "cambiar" ? elegir(u) : editarForm(u))}
                      style={({ pressed }) => [
                        e.fila,
                        {
                          backgroundColor: esActivo ? T.acentoSuave : T.superficie,
                          borderColor: esActivo ? T.acento : T.borde,
                        },
                        pressed && { backgroundColor: T.superficie3 },
                      ]}
                    >
                      <View
                        style={[
                          e.avatar,
                          { backgroundColor: T.acento + "22", borderColor: T.acento + "55" },
                        ]}
                      >
                        <Text style={[e.avatarTxt, { color: T.acento }]}>
                          {u.nombre.trim()[0]?.toUpperCase() ?? "?"}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[e.nombre, { color: T.texto }]}>{u.nombre}</Text>
                        <Text style={[e.rol, { color: T.textoTenue }]}>
                          {ROLES.find((r) => r.id === u.rol)?.nombre ?? u.rol}
                          {esActivo ? "  ·  activo ahora" : ""}
                        </Text>
                      </View>
                      {modo === "gestionar" && usuarios.length > 1 && (
                        <Pressable onPress={() => confirmarBorrado(u)} hitSlop={10}>
                          <Text style={{ color: T.peligro, fontSize: 16, fontWeight: "800" }}>
                            ✕
                          </Text>
                        </Pressable>
                      )}
                      {modo === "cambiar" && esActivo && (
                        <Text style={{ color: T.acento, fontSize: 15, fontWeight: "800" }}>✓</Text>
                      )}
                    </Pressable>
                  );
                })}

                {modo === "gestionar" && (
                  <>
                    <View
                      style={[
                        e.switchFila,
                        { backgroundColor: T.superficie, borderColor: T.borde },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[e.nombre, { color: T.texto }]}>Pedir PIN al cambiar</Text>
                        <Text style={[e.rol, { color: T.textoTenue }]}>
                          Apágalo si eres la única persona que usa el POS.
                        </Text>
                      </View>
                      <Switch
                        value={conPin}
                        onValueChange={async (v) => {
                          setConPin(v);
                          await setPedirPin(v);
                        }}
                        trackColor={{ true: T.acento, false: T.borde }}
                        thumbColor="#fff"
                      />
                    </View>

                    <Text style={[e.nota, { color: T.textoTenue }]}>
                      El PIN por defecto del primer usuario es 0000. Cámbialo si
                      varias personas usan este dispositivo.
                    </Text>
                  </>
                )}
              </>
            )}

            {/* ---------------- PIN ---------------- */}
            {vista === "pin" && candidato && (
              <>
                <Text style={[e.ayuda, { color: T.textoSuave, textAlign: "center" }]}>
                  Escribe el PIN de {candidato.nombre}
                </Text>
                <TextInput
                  style={[
                    inp,
                    {
                      fontSize: 32,
                      textAlign: "center",
                      letterSpacing: 14,
                      paddingVertical: 18,
                      fontWeight: "800",
                    },
                  ]}
                  value={pin}
                  onChangeText={(t) => {
                    setPin(t.replace(/\D/g, "").slice(0, 4));
                    setError("");
                  }}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={4}
                  autoFocus
                  onSubmitEditing={confirmarPin}
                />
                <View style={{ marginTop: 18 }}>
                  <Boton
                    titulo="Entrar"
                    onPress={confirmarPin}
                    cargando={guardando}
                    deshabilitado={pin.length < 4}
                  />
                </View>
              </>
            )}

            {/* ---------------- FORMULARIO ---------------- */}
            {vista === "form" && (
              <>
                <Etiqueta T={T}>Nombre</Etiqueta>
                <TextInput
                  style={inp}
                  value={nombre}
                  onChangeText={setNombre}
                  placeholder="Ej. Lupita"
                  placeholderTextColor={T.textoTenue}
                />

                <Etiqueta T={T}>
                  {editando ? "PIN nuevo · déjalo vacío para no cambiarlo" : "PIN de 4 dígitos"}
                </Etiqueta>
                <TextInput
                  style={[inp, { textAlign: "center", letterSpacing: 10, fontWeight: "800" }]}
                  value={pinNuevo}
                  onChangeText={(t) => setPinNuevo(t.replace(/\D/g, "").slice(0, 4))}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={4}
                  placeholder="0000"
                  placeholderTextColor={T.textoTenue}
                />

                <Etiqueta T={T}>Rol</Etiqueta>
                <View style={{ gap: 8 }}>
                  {ROLES.map((r) => {
                    const activo = rol === r.id;
                    return (
                      <Pressable
                        key={r.id}
                        onPress={() => setRol(r.id)}
                        style={[
                          e.rolCaja,
                          {
                            backgroundColor: activo ? T.acentoSuave : T.superficie,
                            borderColor: activo ? T.acento : T.borde,
                          },
                        ]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[e.nombre, { color: T.texto }]}>{r.nombre}</Text>
                          <Text style={[e.rol, { color: T.textoTenue }]}>{r.desc}</Text>
                        </View>
                        {activo && (
                          <Text style={{ color: T.acento, fontSize: 15, fontWeight: "800" }}>✓</Text>
                        )}
                      </Pressable>
                    );
                  })}
                </View>

                <View style={{ marginTop: 20 }}>
                  <Boton
                    titulo={editando ? "Guardar cambios" : "Crear usuario"}
                    onPress={guardar}
                    cargando={guardando}
                  />
                </View>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function Etiqueta({ children, T }: { children: string; T: any }) {
  return (
    <Text
      style={{
        color: T.textoSuave,
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        marginBottom: 7,
        marginTop: 16,
      }}
    >
      {children}
    </Text>
  );
}

const e = StyleSheet.create({
  raiz: { flex: 1 },
  ayuda: { fontSize: 13.5, lineHeight: 20, marginBottom: 14 },
  nota: { fontSize: 12.5, lineHeight: 19, marginTop: 14 },
  fila: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarTxt: { fontSize: 17, fontWeight: "800" },
  nombre: { fontSize: 15, fontWeight: "800" },
  rol: { fontSize: 12, marginTop: 2 },
  switchFila: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginTop: 14,
  },
  rolCaja: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    padding: 13,
  },
});
