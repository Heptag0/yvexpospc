// YvexPOS Móvil — Usuarios (cajeros).
//
// Dos modos en un solo modal:
//   - "cambiar": elegir quién está vendiendo ahora (con PIN si está activado).
//   - "gestionar": crear, editar y eliminar usuarios (solo dueño/gerente).
//
// Pensado para el caso real de una tablet compartida: cada empleado entra con
// su PIN y sus ventas quedan a su nombre. Si el negocio es de una persona,
// esto no estorba: hay un usuario, se selecciona solo, y no se pide PIN.
//
// ---------------------------------------------------------------------------
// MIGRADO AL SISTEMA DE DISEÑO
// ---------------------------------------------------------------------------
// Es la pantalla que MÁS se ve de todas las que quedaban sin migrar: aparece
// en el onboarding y en cada cambio de turno. Y era la que más se desviaba:
// 60 líneas de StyleSheet propio, `fontWeight: "800"` por todas partes,
// tamaños a mano (17, 15, 13.5, 12.5, 12), bordes de 1px en cada tarjeta, un
// estilo de input local (`inp`) que ignoraba `useEstiloInput`, y checks y
// cruces escritos como caracteres de texto ("✓", "✕") en vez de iconos.
//
// Ahora:
//   · <Hoja tipo="completa"> en vez de Modal + SafeAreaView + CabeceraModal
//     montados a mano. De paso hereda su KeyboardAvoidingView, que aquí era
//     iOS-only y en Android dejaba el campo del PIN debajo del teclado.
//   · <Grupo> + <Fila> para la lista, igual que Inventario y Herramientas.
//   · <Campo> + useEstiloInput para el formulario.
//   · IconoUI en vez de "✓" y "✕".
//   · Alert.alert nativo sustituido por una <Hoja> chica de confirmación,
//     que es el patrón que ya usa ModalProveedores para eliminar. El Alert
//     del sistema es la única pieza de interfaz de toda la app que no se
//     puede tematizar: aparecía en gris de Android sobre el tema Papel.
//
// El avatar con la inicial se queda, pero pasa a cuadrado redondeado con
// acentoSuave: el mismo tratamiento que los iconos de "Tus accesos" en Inicio
// y las filas del panel de Herramientas.

import { useCallback, useEffect, useState } from "react";
import { View, TextInput, Pressable, Switch } from "react-native";
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
import { IconoUI } from "@/src/componentes/iconos";
import {
  Boton,
  Banner,
  Campo,
  Hoja,
  Grupo,
  Fila,
  Txt,
  useEstiloInput,
} from "@/src/componentes/ui";

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
  const estiloInput = useEstiloInput();

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

  const [borrando, setBorrando] = useState<UsuarioPOS | null>(null);
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

  async function confirmarEliminar() {
    if (!borrando) return;
    try {
      await eliminarUsuario(borrando.id);
      await cargar();
      onCambio();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBorrando(null);
    }
  }

  const titulo =
    vista === "pin"
      ? candidato?.nombre ?? "PIN"
      : vista === "form"
      ? editando
        ? "Editar usuario"
        : "Nuevo usuario"
      : modo === "cambiar"
      ? "¿Quién vende?"
      : "Usuarios";

  /** Atrás dentro del modal: de una sub-vista se vuelve a la lista, y solo
   *  desde la lista se cierra. Antes esto vivía en la CabeceraModal a mano. */
  function cerrarOVolver() {
    if (vista === "lista") {
      onCerrar();
    } else {
      setVista("lista");
      setError("");
    }
  }

  return (
    <Hoja visible onCerrar={cerrarOVolver} titulo={titulo} tipo="completa">
      <Banner texto={error} tipo="error" />

      {/* ------------------------------ LISTA ------------------------------ */}
      {vista === "lista" && (
        <>
          {modo === "cambiar" && (
            <Txt escala="pie" tono="suave" estilo={{ marginBottom: T.esps.lg }}>
              Cada venta queda registrada a nombre de quien la hace.
            </Txt>
          )}

          <Grupo>
            {usuarios.map((u) => {
              const esActivo = u.id === activoId;
              return (
                <Fila
                  key={u.id}
                  titulo={u.nombre}
                  meta={
                    (ROLES.find((r) => r.id === u.rol)?.nombre ?? u.rol) +
                    (esActivo ? " · vendiendo ahora" : "")
                  }
                  destacado={esActivo}
                  flecha={modo === "gestionar"}
                  onPress={() => (modo === "cambiar" ? elegir(u) : editarForm(u))}
                  icono={
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: T.radioChico,
                        backgroundColor: T.acentoSuave,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Txt escala="cuerpo" tono="acento" fuerte>
                        {u.nombre.trim()[0]?.toUpperCase() ?? "?"}
                      </Txt>
                    </View>
                  }
                  valor={
                    modo === "gestionar" && usuarios.length > 1 ? (
                      <Pressable
                        onPress={() => setBorrando(u)}
                        hitSlop={12}
                        accessibilityRole="button"
                        accessibilityLabel={`Eliminar a ${u.nombre}`}
                        style={{ padding: T.esps.xs }}
                      >
                        <IconoUI id="basura" size={17} color={T.textoTenue} />
                      </Pressable>
                    ) : esActivo && modo === "cambiar" ? (
                      <IconoUI id="persona" size={17} color={T.acento} />
                    ) : undefined
                  }
                />
              );
            })}
          </Grupo>

          {modo === "gestionar" && (
            <>
              <View style={{ marginTop: T.esps.lg }}>
                <Boton titulo="Nuevo usuario" tipo="secundario" onPress={nuevoForm} />
              </View>

              <View style={{ marginTop: T.esps.xl }}>
                <Grupo>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: T.esps.md,
                      minHeight: T.filaAlto,
                      paddingHorizontal: T.esps.lg,
                      paddingVertical: T.esps.md,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Txt escala="cuerpo" fuerte>
                        Pedir PIN al cambiar
                      </Txt>
                      <Txt escala="pie" tono="tenue" estilo={{ marginTop: 2 }}>
                        Apágalo si eres la única persona que usa el POS.
                      </Txt>
                    </View>
                    <Switch
                      value={conPin}
                      onValueChange={async (v) => {
                        setConPin(v);
                        await setPedirPin(v);
                      }}
                      trackColor={{ false: T.superficie3, true: T.acentoRelleno }}
                      thumbColor={T.superficie}
                      accessibilityLabel="Pedir PIN al cambiar de usuario"
                    />
                  </View>
                </Grupo>
              </View>

              <Txt escala="pie" tono="tenue" estilo={{ marginTop: T.esps.lg }}>
                El PIN por defecto del primer usuario es 0000. Cámbialo si varias
                personas usan este dispositivo.
              </Txt>
            </>
          )}
        </>
      )}

      {/* ------------------------------- PIN ------------------------------- */}
      {vista === "pin" && candidato && (
        <>
          <Txt
            escala="pie"
            tono="suave"
            estilo={{ textAlign: "center", marginBottom: T.esps.lg }}
          >
            Escribe el PIN de {candidato.nombre}
          </Txt>
          <TextInput
            style={[
              estiloInput,
              {
                fontSize: 30,
                textAlign: "center",
                letterSpacing: 14,
                paddingVertical: 18,
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
          <View style={{ marginTop: T.esps.xl }}>
            <Boton
              titulo="Entrar"
              onPress={confirmarPin}
              cargando={guardando}
              deshabilitado={pin.length < 4}
            />
          </View>
        </>
      )}

      {/* --------------------------- FORMULARIO --------------------------- */}
      {vista === "form" && (
        <>
          <Campo label="Nombre">
            <TextInput
              style={estiloInput}
              value={nombre}
              onChangeText={setNombre}
              placeholder="Ej. Lupita"
              placeholderTextColor={T.textoTenue}
              autoCapitalize="words"
            />
          </Campo>

          <Campo
            label={editando ? "PIN nuevo" : "PIN de 4 dígitos"}
            ayuda={editando ? "Déjalo vacío para no cambiarlo." : undefined}
          >
            <TextInput
              style={[estiloInput, { textAlign: "center", letterSpacing: 10 }]}
              value={pinNuevo}
              onChangeText={(t) => setPinNuevo(t.replace(/\D/g, "").slice(0, 4))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              placeholder="0000"
              placeholderTextColor={T.textoTenue}
            />
          </Campo>

          <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.sm }}>
            Rol
          </Txt>
          <Grupo>
            {ROLES.map((r) => {
              const activo = rol === r.id;
              return (
                <Fila
                  key={r.id}
                  titulo={r.nombre}
                  meta={r.desc}
                  destacado={activo}
                  flecha={false}
                  onPress={() => setRol(r.id)}
                  valor={
                    activo ? <IconoUI id="persona" size={16} color={T.acento} /> : undefined
                  }
                />
              );
            })}
          </Grupo>

          <View style={{ marginTop: T.esps.xl }}>
            <Boton
              titulo={editando ? "Guardar cambios" : "Crear usuario"}
              onPress={guardar}
              cargando={guardando}
            />
          </View>
        </>
      )}

      <View style={{ height: T.esps.xxl }} />

      {/* Confirmación de borrado: hoja chica, no Alert nativo.
          El Alert del sistema es la única pieza de interfaz de la app que no
          se puede tematizar — salía en gris de Android encima del tema Papel.
          Mismo patrón que ya usa ModalProveedores. */}
      <Hoja
        visible={borrando !== null}
        onCerrar={() => setBorrando(null)}
        titulo="Eliminar usuario"
        pie={
          <View style={{ gap: T.esps.sm }}>
            <Boton titulo="Eliminar" tipo="peligro" onPress={confirmarEliminar} />
            <Boton
              titulo="Cancelar"
              tipo="secundario"
              onPress={() => setBorrando(null)}
            />
          </View>
        }
      >
        <Txt escala="pie" tono="suave">
          {borrando
            ? `¿Eliminar a "${borrando.nombre}"? Sus ventas anteriores se conservan a su nombre.`
            : ""}
        </Txt>
      </Hoja>
    </Hoja>
  );
}
