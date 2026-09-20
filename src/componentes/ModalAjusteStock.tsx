// YvexPOS Móvil — Ajuste de stock (resurtir / ajustar).
//
// Dos modos, como en la vida real de la tienda:
//   RESURTIR: "llegaron 24 más" -> suma al stock actual.
//   AJUSTAR:  "en realidad hay 18" -> fija el valor exacto.
// Muestra vista previa del resultado antes de aplicar, y el historial de
// movimientos recientes (rastro de ajustes_inventario).
//
// ---------------------------------------------------------------------------
// MIGRADO AL SISTEMA DE DISEÑO
// ---------------------------------------------------------------------------
// Traía 90 líneas de StyleSheet propio con su Modal, su SafeAreaView y su
// CabeceraModal montados a mano, más un segmentado con bordes de 1px que no
// se parecía al de ninguna otra pantalla. Y pintaba la vista previa con
// T.turquesa: el acento fantasma retirado en la Fase 1.
//
// Ahora es <Hoja tipo="completa"> con <Campo>, <Grupo>, <Fila>, <Txt> y
// <Monto>. De paso hereda el KeyboardAvoidingView de <Hoja>, que es justo lo
// que le faltaba: con `edgeToEdgeEnabled` el teclado tapaba el botón Aplicar
// en cuanto se tocaba el campo (que además abre con autoFocus).
//
// El segmentado pasa al mismo patrón de Reportes y ModalMovimientoCaja:
// pastilla rellena de acento sobre superficie2, sin bordes.
//
// La vista previa era una caja con filo izquierdo y el texto "18 → 42". Ahora
// las cifras van en <Monto> (Plex Mono, igual que todo número de la app) y el
// resultado se destaca con el tono, no con un borde de color.

import { useEffect, useState } from "react";
import { View, TextInput, Pressable } from "react-native";
import { Producto, ajustarStock, historialAjustes } from "@/src/base/inventario";
import { aNumero, fmtStock, fmtFecha } from "@/src/base/formato";
import { useTema } from "@/src/componentes/TemaProvider";
import {
  Boton,
  Banner,
  Campo,
  Hoja,
  Grupo,
  Fila,
  Lamina,
  Txt,
  Monto,
  useEstiloInput,
} from "@/src/componentes/ui";

type Props = {
  producto: Producto;
  onCerrar: () => void;
  onAjustado: () => void;
};

type Movimiento = {
  stock_antes: number;
  stock_despues: number;
  motivo: string;
  creado_en: string;
};

const MOTIVOS: Record<string, string> = {
  ajuste: "Ajuste manual",
  resurtido: "Resurtido",
  conteo: "Conteo físico",
};

const MODOS = [
  { id: "resurtir" as const, label: "Resurtir (+)" },
  { id: "ajustar" as const, label: "Fijar valor" },
];

export default function ModalAjusteStock({ producto, onCerrar, onAjustado }: Props) {
  const { tema: T } = useTema();
  const estiloInput = useEstiloInput();
  const [modo, setModo] = useState<"resurtir" | "ajustar">("resurtir");
  const [cantidad, setCantidad] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [historial, setHistorial] = useState<Movimiento[]>([]);

  useEffect(() => {
    historialAjustes(producto.id, 8).then(setHistorial);
  }, [producto.id]);

  const n = aNumero(cantidad);
  const resultado = modo === "resurtir" ? producto.stock + n : n;
  const hayEntrada = cantidad.trim() !== "";

  async function aplicar() {
    setError("");
    if (!hayEntrada) {
      setError("Escribe una cantidad.");
      return;
    }
    if (resultado < 0) {
      setError("El stock no puede quedar negativo con este ajuste.");
      return;
    }
    setGuardando(true);
    try {
      await ajustarStock(producto.id, resultado, modo === "resurtir" ? "resurtido" : "ajuste");
      onAjustado();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setGuardando(false);
    }
  }

  return (
    <Hoja
      visible
      onCerrar={guardando ? () => {} : onCerrar}
      titulo="Ajustar stock"
      tipo="completa"
      pie={<Boton titulo="Aplicar" onPress={aplicar} cargando={guardando} />}
    >
      {/* El stock actual es la cifra protagonista: es contra lo que el
          tendero compara mentalmente antes de escribir nada. */}
      <View style={{ marginBottom: T.esps.xl }}>
        <Lamina>
          <Txt escala="micro" tono="suave" fuerte mayus>
            Stock actual
          </Txt>
          <View style={{ marginTop: T.esps.xs }}>
            <Monto
              texto={fmtStock(producto.stock, producto.unidad)}
              escala="protagonista"
            />
          </View>
          <Txt escala="pie" tono="suave" estilo={{ marginTop: T.esps.xs }} lineas={2}>
            {producto.nombre}
          </Txt>
        </Lamina>
      </View>

      <Banner texto={error} tipo="error" />

      {/* Segmentado: mismo patrón que Reportes y ModalMovimientoCaja —
          pastilla rellena sobre superficie2, sin bordes. */}
      <View
        style={{
          flexDirection: "row",
          backgroundColor: T.superficie2,
          borderRadius: T.radio,
          padding: 3,
          marginBottom: T.esps.md,
        }}
      >
        {MODOS.map((o) => {
          const activo = modo === o.id;
          return (
            <Pressable
              key={o.id}
              onPress={() => setModo(o.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: activo }}
              style={{
                flex: 1,
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: T.radioChico,
                backgroundColor: activo ? T.acentoRelleno : "transparent",
              }}
            >
              <Txt
                escala="cuerpo"
                fuerte={activo}
                tono="suave"
                estilo={activo ? { color: T.acentoTexto } : undefined}
              >
                {o.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      <Txt escala="pie" tono="tenue" estilo={{ marginBottom: T.esps.lg }}>
        {modo === "resurtir"
          ? "¿Cuántas unidades llegaron? Se suman al stock actual."
          : "¿Cuánto hay en realidad? El stock quedará en ese valor exacto."}
      </Txt>

      <Campo label={modo === "resurtir" ? "Unidades que llegaron" : "Cuántas hay en realidad"}>
        <TextInput
          // Sin `fontFamily: T.fuente.num`: esa familia está declarada en
          // apariencia.ts como "SOLO para montos de dinero", y esto es una
          // cantidad de piezas. El tamaño grande y el centrado ya hacen el
          // trabajo de que se lea de un vistazo.
          style={[estiloInput, { fontSize: 26, textAlign: "center", paddingVertical: 16 }]}
          value={cantidad}
          onChangeText={setCantidad}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={T.textoTenue}
          autoFocus
        />
      </Campo>

      {/* Vista previa. Antes era una caja con filo de color y las cifras en
          texto normal; ahora los números van en <Monto> como en el resto de
          la app, y el resultado se distingue por TONO (peligro si queda
          negativo, éxito si no), no por un borde de otro color. */}
      {hayEntrada ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: T.esps.sm,
            backgroundColor: T.superficie,
            borderRadius: T.radio,
            paddingVertical: T.esps.lg,
            marginBottom: T.esps.xl,
          }}
        >
          <Monto
            texto={fmtStock(producto.stock, producto.unidad)}
            escala="cuerpo"
            tono="suave"
          />
          <Txt escala="cuerpo" tono="tenue">
            →
          </Txt>
          <Monto
            texto={fmtStock(resultado, producto.unidad)}
            escala="titulo"
            tono={resultado < 0 ? "peligro" : "exito"}
          />
        </View>
      ) : null}

      {historial.length > 0 ? (
        <>
          <Txt
            escala="micro"
            tono="suave"
            fuerte
            mayus
            estilo={{ marginBottom: T.esps.sm }}
          >
            Movimientos recientes
          </Txt>
          <Grupo>
            {historial.map((m, i) => (
              <Fila
                key={i}
                titulo={MOTIVOS[m.motivo] ?? m.motivo}
                meta={fmtFecha(m.creado_en)}
                flecha={false}
                valor={
                  <Monto
                    texto={`${fmtStock(m.stock_antes, "")} → ${fmtStock(m.stock_despues, "")}`}
                    escala="pie"
                    tono="suave"
                  />
                }
              />
            ))}
          </Grupo>
        </>
      ) : null}

      <View style={{ height: T.esps.xxl }} />
    </Hoja>
  );
}
