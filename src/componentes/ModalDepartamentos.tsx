// YvexPOS Móvil — Gestión de departamentos.
//
// Crear, editar y eliminar departamentos con su color e icono. Confirmación
// antes de eliminar, y errores siempre legibles.
//
// ---------------------------------------------------------------------------
// QUÉ CAMBIÓ
// ---------------------------------------------------------------------------
// 1. Alert.alert -> confirmación EN LA APP. El diálogo nativo de Android es
//    el mismo problema que ya resolvimos en el corte de turno: en el
//    instante de confirmar un borrado, la app dejaba de ser tu app. Ahora es
//    una <Hoja> chica con el nombre del departamento y un botón peligro,
//    igual que el resto de confirmaciones del sistema.
// 2. T.turquesa (el link "Editar") -> T.acento. El morado fantasma que
//    venimos limpiando en toda la app desde la Fase 1.
// 3. La lista de departamentos pasa a <Grupo>/<Fila>, igual que cualquier
//    otra lista de la app — antes tenía su propio estilo de fila suelto.

import { useState, useEffect, useCallback, useMemo } from "react";
import { View, TextInput, Pressable, ScrollView } from "react-native";
import {
  Categoria,
  listarCategorias,
  crearCategoria,
  editarCategoria,
  eliminarCategoria,
} from "@/src/base/inventario";
import { useTema } from "@/src/componentes/TemaProvider";
import { ICONOS, CATEGORIAS_ICONOS, Icono } from "@/src/componentes/iconos";
import {
  Boton,
  Banner,
  Hoja,
  Grupo,
  Fila,
  Txt,
  Vacio,
  useEstiloInput,
} from "@/src/componentes/ui";

// Paleta curada para departamentos (buen contraste sobre oscuro y claro).
// No depende del tema: son los colores elegibles para los departamentos.
const COLORES_DEPTO = [
  "#8b5cf6", "#2dd4bf", "#60a5fa", "#34d399",
  "#fbbf24", "#fb7185", "#e879f9", "#a7a9c4",
] as const;

export default function ModalDepartamentos({
  onCerrar,
  onCambio,
}: {
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const { tema: T } = useTema();
  const estiloInput = useEstiloInput();
  const [cats, setCats] = useState<Categoria[]>([]);
  const [editando, setEditando] = useState<Categoria | null>(null);
  const [nombre, setNombre] = useState("");
  const [color, setColor] = useState<string>(COLORES_DEPTO[0]);
  const [icono, setIcono] = useState<string>("caja");
  // FILTRO QUE ORDENA, NO QUE LIMITA
  // -------------------------------------------------------------------------
  // Arranca SIEMPRE en null ("Todos") y nunca se preselecciona con el giro
  // guardado del negocio. Una abarrotera que ademas hace comida tiene que
  // poder elegir el icono de tacos sin sentir que la app le dice de que es su
  // negocio. El filtro esta para que 49 iconos se puedan recorrer, no para
  // decidir cuales le tocan a quien.
  const [catIcono, setCatIcono] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  // Confirmación de borrado en dos pasos, sin Alert nativo: null = nada que
  // confirmar; si trae un departamento, la hoja de confirmación está abierta.
  const [porBorrar, setPorBorrar] = useState<Categoria | null>(null);
  const [borrando, setBorrando] = useState(false);

  const iconosVisibles = useMemo(() => {
    if (!catIcono) return ICONOS;
    const enCategoria = ICONOS.filter((i) => i.categoria === catIcono);
    // El icono YA ELEGIDO se muestra aunque sea de otra categoria. Sin esto,
    // al cambiar de filtro desaparecia de la cuadricula y no habia forma de
    // ver cual estaba puesto — parecia que se habia perdido la seleccion.
    if (enCategoria.some((i) => i.id === icono)) return enCategoria;
    const elegido = ICONOS.find((i) => i.id === icono);
    return elegido ? [elegido, ...enCategoria] : enCategoria;
  }, [catIcono, icono]);

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

  async function confirmarBorrado() {
    if (!porBorrar) return;
    setBorrando(true);
    try {
      await eliminarCategoria(porBorrar.id);
      await cargar();
      onCambio();
      if (editando?.id === porBorrar.id) limpiarForm();
      setPorBorrar(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPorBorrar(null);
    } finally {
      setBorrando(false);
    }
  }

  return (
    <Hoja visible onCerrar={onCerrar} titulo="Departamentos" tipo="completa">
      {/* Formulario */}
      <View
        style={{
          backgroundColor: T.superficie,
          borderRadius: T.radio,
          borderWidth: 1,
          borderColor: T.bordeFuerte,
          padding: T.esps.lg,
          marginBottom: T.esps.xl,
        }}
      >
        <Txt escala="cuerpo" fuerte estilo={{ marginBottom: T.esps.md }}>
          {editando ? `Editando: ${editando.nombre}` : "Nuevo departamento"}
        </Txt>
        <Banner texto={error} tipo="error" />
        <TextInput
          style={estiloInput}
          value={nombre}
          onChangeText={setNombre}
          placeholder="Nombre (ej. Bebidas)"
          placeholderTextColor={T.textoTenue}
        />

        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: T.esps.md,
            marginVertical: T.esps.lg,
          }}
        >
          {COLORES_DEPTO.map((col) => (
            <Pressable
              key={col}
              onPress={() => setColor(col)}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: col,
                borderWidth: color === col ? 3 : 0,
                borderColor: T.texto,
              }}
            />
          ))}
        </View>

        <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.sm }}>
          Icono · lo heredan sus productos
        </Txt>
        {/* Filtro por giro. Scroller horizontal: las categorias caben de
            sobra en una tira y nunca se parten en dos filas desiguales.
            "Todos" va primero y es el estado inicial. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: T.esps.sm, paddingBottom: T.esps.md }}
          style={{ marginHorizontal: -T.esps.lg, paddingHorizontal: T.esps.lg }}
        >
          {[{ id: null as string | null, nombre: "Todos" }, ...CATEGORIAS_ICONOS].map((c) => {
            const activo = catIcono === c.id;
            return (
              <Pressable
                key={c.id ?? "todos"}
                onPress={() => setCatIcono(c.id)}
                style={{
                  paddingHorizontal: T.esps.md,
                  paddingVertical: T.esps.sm,
                  borderRadius: 999,
                  backgroundColor: activo ? color + "26" : T.superficie2,
                  borderWidth: 1,
                  borderColor: activo ? color : T.borde,
                }}
              >
                <Txt escala="micro" fuerte tono={activo ? "principal" : "suave"}>
                  {c.nombre}
                </Txt>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: T.esps.sm, marginBottom: T.esps.lg }}>
          {iconosVisibles.map((ic) => {
            const activo = icono === ic.id;
            return (
              <Pressable
                key={ic.id}
                onPress={() => setIcono(ic.id)}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: T.radioChico,
                  backgroundColor: activo ? color + "26" : T.superficie2,
                  borderWidth: 1,
                  borderColor: activo ? color : T.borde,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icono id={ic.id} size={22} color={activo ? color : T.textoSuave} />
              </Pressable>
            );
          })}
        </View>

        <View style={{ flexDirection: "row", gap: T.esps.sm }}>
          {editando ? (
            <View style={{ flex: 1 }}>
              <Boton titulo="Cancelar" tipo="secundario" onPress={limpiarForm} />
            </View>
          ) : null}
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
      <Txt escala="micro" tono="suave" fuerte mayus estilo={{ marginBottom: T.esps.md }}>
        Tus departamentos
      </Txt>
      {cats.length === 0 ? (
        <Vacio
          titulo="Aún no tienes departamentos"
          texto="Créalos arriba: cada uno con su color e icono, que heredan los productos que le asignes."
        />
      ) : (
        <Grupo>
          {cats.map((c) => (
            <Fila
              key={c.id}
              titulo={c.nombre}
              icono={
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: T.radioChico,
                    backgroundColor: (c.color ?? T.acento) + "22",
                    borderWidth: 1,
                    borderColor: (c.color ?? T.acento) + "55",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icono id={c.icono ?? "caja"} size={18} color={c.color ?? T.acento} />
                </View>
              }
              flecha={false}
              valor={
                <View style={{ flexDirection: "row", alignItems: "center", gap: T.esps.lg }}>
                  <Pressable onPress={() => editarForm(c)} hitSlop={10}>
                    <Txt escala="pie" tono="acento" fuerte>
                      Editar
                    </Txt>
                  </Pressable>
                  <Pressable onPress={() => setPorBorrar(c)} hitSlop={10}>
                    <Txt escala="cuerpo" tono="peligro" fuerte>
                      ✕
                    </Txt>
                  </Pressable>
                </View>
              }
            />
          ))}
        </Grupo>
      )}

      {/* Confirmación de borrado: hoja chica, sin Alert nativo. */}
      <Hoja
        visible={porBorrar !== null}
        onCerrar={() => setPorBorrar(null)}
        titulo="Eliminar departamento"
        pie={
          <View style={{ gap: T.esps.sm }}>
            <Boton
              titulo="Eliminar"
              tipo="peligro"
              onPress={confirmarBorrado}
              cargando={borrando}
            />
            <Boton titulo="Cancelar" tipo="secundario" onPress={() => setPorBorrar(null)} />
          </View>
        }
      >
        <Txt escala="pie" tono="suave">
          {porBorrar
            ? `¿Eliminar "${porBorrar.nombre}"? Sus productos quedarán sin departamento — no se borran.`
            : ""}
        </Txt>
      </Hoja>
    </Hoja>
  );
}
