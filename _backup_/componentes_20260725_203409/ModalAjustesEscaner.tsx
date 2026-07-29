// YvexPOS Móvil — Ajustes del escáner de tickets.
//
// Umbrales de aviso de costo, margen por defecto y redondeo del precio
// sugerido. Todo se guarda AL MOMENTO (sin botón guardar) vía escanerConfig;
// los clamps de coherencia (alerta ≥ aviso+1, irreal ≥ alerta+1) se aplican
// en la capa pura (sanarConfigEscaner) y la UI muestra el resultado.
//
// REGLA INQUEBRANTABLE: el nivel "irreal" siempre conserva el costo por
// defecto y el usuario decide línea por línea; estos ajustes solo cambian
// CUÁNDO se avisa.

import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ConfigEscaner,
  DEFAULT_CONFIG_ESCANER,
  RANGOS_CONFIG_ESCANER,
  RedondeoEscaner,
} from "@/src/base/escaner";
import {
  guardarConfigEscaner,
  obtenerConfigEscaner,
  restablecerConfigEscaner,
} from "@/src/base/escanerConfig";
import { useTema } from "@/src/componentes/TemaProvider";
import { Boton, CabeceraModal } from "@/src/componentes/ui";

type Tema = ReturnType<typeof useTema>["tema"];

type Props = {
  onCerrar: () => void;
};

const OPCIONES_REDONDEO_ESCANER: { id: RedondeoEscaner; nombre: string }[] = [
  { id: "50", nombre: "A $0.50" },
  { id: "100", nombre: "A $1.00" },
  { id: "ninguno", nombre: "Exacto" },
];

export default function ModalAjustesEscaner({ onCerrar }: Props) {
  const { tema: T } = useTema();
  const est = useMemo(() => crearEstilos(T), [T]);
  const [cfg, setCfg] = useState<ConfigEscaner>(DEFAULT_CONFIG_ESCANER);
  const [cargado, setCargado] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    obtenerConfigEscaner().then((c) => {
      setCfg(c);
      setCargado(true);
    });
  }, []);

  /** Aplica un cambio parcial: guarda y muestra los clamps resultantes. */
  async function aplicar(parcial: Partial<ConfigEscaner>) {
    setConfirmReset(false);
    const sana = await guardarConfigEscaner(parcial);
    setCfg(sana);
  }

  async function restablecer() {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    setCfg(await restablecerConfigEscaner());
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <SafeAreaView style={est.raiz}>
        <CabeceraModal
          titulo="Escáner de tickets"
          onIzquierda={onCerrar}
          izquierda="Listo"
        />
        <ScrollView contentContainerStyle={est.cuerpo} keyboardShouldPersistTaps="handled">
          {/* Aviso honesto: la IA puede equivocarse y mover los umbrales
              tiene efectos reales (falsos positivos / negativos). */}
          <View style={est.avisoCaja}>
            <Text style={est.avisoTxt}>
              El análisis usa IA y puede equivocarse: revisa siempre las líneas
              antes de aplicar. Estos umbrales controlan cuándo se te avisa de
              cambios de costo. Moverlos puede generar falsos positivos (avisos
              de más) o falsos negativos (avisos de menos); los valores por
              defecto están calibrados para proveedores típicos en México.
            </Text>
          </View>

          {/* ---------------- Umbrales de aviso ---------------- */}
          <Text style={est.seccion}>UMBRALES DE AVISO DE COSTO</Text>
          <ControlPct
            T={T}
            est={est}
            titulo="Aviso suave"
            valor={cfg.avisoPct}
            rango={RANGOS_CONFIG_ESCANER.avisoPct}
            esDefault={cfg.avisoPct === DEFAULT_CONFIG_ESCANER.avisoPct}
            ayuda="Variación mínima para mostrar aviso suave. Si lo bajas, ajustes de centavos del proveedor generarán avisos que quizá no te importen."
            onCambiar={(v) => aplicar({ avisoPct: v })}
            deshabilitado={!cargado}
          />
          <ControlPct
            T={T}
            est={est}
            titulo="Alerta roja"
            valor={cfg.alertaPct}
            rango={RANGOS_CONFIG_ESCANER.alertaPct}
            esDefault={cfg.alertaPct === DEFAULT_CONFIG_ESCANER.alertaPct}
            ayuda="A partir de aquí la línea se marca en rojo y debes atenderla. Si lo bajas mucho, promociones que terminan aparecerán como alerta."
            onCambiar={(v) => aplicar({ alertaPct: v })}
            deshabilitado={!cargado}
          />
          <ControlPct
            T={T}
            est={est}
            titulo="Lectura dudosa"
            valor={cfg.irrealPct}
            rango={RANGOS_CONFIG_ESCANER.irrealPct}
            esDefault={cfg.irrealPct === DEFAULT_CONFIG_ESCANER.irrealPct}
            ayuda="Por encima de esto se asume que la IA leyó mal el número y el costo se conserva automáticamente (puedes usarlo a mano si confirmas que es real). No recomendamos bajarlo de 30%: casi ningún proveedor sube así de un ticket a otro."
            onCambiar={(v) => aplicar({ irrealPct: v })}
            deshabilitado={!cargado}
          />

          {/* ---------------- Precio sugerido ---------------- */}
          <Text style={est.seccion}>PRECIO SUGERIDO</Text>
          <ControlPct
            T={T}
            est={est}
            titulo="Margen por defecto"
            valor={cfg.margenDefaultPct}
            rango={RANGOS_CONFIG_ESCANER.margenDefaultPct}
            esDefault={cfg.margenDefaultPct === DEFAULT_CONFIG_ESCANER.margenDefaultPct}
            ayuda="Se usa para calcular el precio de venta sugerido de productos nuevos."
            onCambiar={(v) => aplicar({ margenDefaultPct: v })}
            deshabilitado={!cargado}
          />

          <View style={est.tarjeta}>
            <Text style={est.titulo}>Redondeo del precio sugerido</Text>
            <View style={est.chips}>
              {OPCIONES_REDONDEO_ESCANER.map((o) => {
                const activo = cfg.redondeo === o.id;
                return (
                  <Pressable
                    key={o.id}
                    disabled={!cargado}
                    onPress={() => aplicar({ redondeo: o.id })}
                    style={[
                      est.chip,
                      {
                        borderColor: activo ? T.acento : T.borde,
                        backgroundColor: activo ? T.acento + "1e" : T.superficie,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        est.chipTxt,
                        { color: activo ? T.acento : T.textoSuave },
                      ]}
                    >
                      {o.nombre}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={est.ayuda}>Los precios sugeridos se redondean para caja.</Text>
          </View>

          {/* ---------------- Restablecer ---------------- */}
          <View style={{ marginTop: 26 }}>
            <Boton
              titulo={
                confirmReset
                  ? "¿Seguro? Toca otra vez para restablecer"
                  : "Restablecer valores por defecto"
              }
              tipo="secundario"
              onPress={restablecer}
            />
            {confirmReset && (
              <Text style={est.resetNota}>
                Volverán a 5% · 15% · 50% · margen 30% · redondeo a $0.50.
              </Text>
            )}
          </View>

          <View style={{ height: 30 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Control numérico ±1 punto con el valor en grande
// ---------------------------------------------------------------------------
function ControlPct({
  T,
  est,
  titulo,
  valor,
  rango,
  esDefault,
  ayuda,
  onCambiar,
  deshabilitado,
}: {
  T: Tema;
  est: ReturnType<typeof crearEstilos>;
  titulo: string;
  valor: number;
  rango: { min: number; max: number };
  esDefault: boolean;
  ayuda: string;
  onCambiar: (v: number) => void;
  deshabilitado: boolean;
}) {
  const enMin = valor <= rango.min;
  const enMax = valor >= rango.max;
  return (
    <View style={est.tarjeta}>
      <View style={est.filaTitulo}>
        <Text style={est.titulo}>{titulo}</Text>
        {esDefault && <Text style={est.defaultTag}>por defecto</Text>}
      </View>
      <View style={est.filaControl}>
        <Pressable
          hitSlop={8}
          disabled={deshabilitado || enMin}
          onPress={() => onCambiar(valor - 1)}
          style={[est.btnPaso, { borderColor: T.borde, opacity: enMin ? 0.35 : 1 }]}
        >
          <Text style={[est.btnPasoTxt, { color: T.texto }]}>−</Text>
        </Pressable>
        <Text style={[est.valorGrande, { color: T.texto }]}>{valor}%</Text>
        <Pressable
          hitSlop={8}
          disabled={deshabilitado || enMax}
          onPress={() => onCambiar(valor + 1)}
          style={[est.btnPaso, { borderColor: T.borde, opacity: enMax ? 0.35 : 1 }]}
        >
          <Text style={[est.btnPasoTxt, { color: T.texto }]}>＋</Text>
        </Pressable>
      </View>
      <Text style={est.ayuda}>{ayuda}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Estilos (todo del tema dinámico)
// ---------------------------------------------------------------------------
function crearEstilos(T: Tema) {
  return StyleSheet.create({
    raiz: { flex: 1, backgroundColor: T.fondo },
    cuerpo: { padding: T.esp },
    avisoCaja: {
      borderWidth: 1,
      borderColor: T.alerta,
      backgroundColor: T.alertaSuave,
      borderRadius: T.radioChico,
      paddingHorizontal: 13,
      paddingVertical: 11,
      marginBottom: 22,
    },
    avisoTxt: { color: T.alertaTexto, fontSize: 12.5, lineHeight: 18 },
    seccion: {
      color: T.textoSuave,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 1,
      marginBottom: 8,
      marginLeft: 4,
      marginTop: 4,
    },
    tarjeta: {
      backgroundColor: T.superficie,
      borderWidth: 1,
      borderColor: T.borde,
      borderRadius: T.radio,
      padding: 14,
      marginBottom: 10,
    },
    filaTitulo: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    titulo: { color: T.texto, fontSize: 15, fontWeight: "800" },
    defaultTag: { color: T.textoTenue, fontSize: 11, fontStyle: "italic" },
    filaControl: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 22,
      marginTop: 10,
    },
    btnPaso: {
      width: 46,
      height: 46,
      borderRadius: 23,
      borderWidth: 1.5,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: T.superficie2,
    },
    btnPasoTxt: { fontSize: 22, fontWeight: "700", marginTop: -2 },
    valorGrande: {
      fontSize: 30,
      fontWeight: "800",
      minWidth: 96,
      textAlign: "center",
    },
    ayuda: { color: T.textoTenue, fontSize: 12, lineHeight: 17, marginTop: 10 },
    chips: { flexDirection: "row", gap: 9, marginTop: 12 },
    chip: {
      flex: 1,
      borderWidth: 1.5,
      borderRadius: T.radioChico,
      paddingVertical: 11,
      alignItems: "center",
    },
    chipTxt: { fontSize: 13.5, fontWeight: "800" },
    resetNota: {
      color: T.textoTenue,
      fontSize: 12,
      textAlign: "center",
      marginTop: 9,
    },
  });
}
