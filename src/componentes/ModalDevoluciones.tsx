// YvexPOS Móvil — Devoluciones y cancelaciones.
//
// Puerto de la pantalla de devoluciones del PC. La lógica real (buscar,
// validar, reembolsar) vive en src/base/devoluciones.ts — este archivo solo
// pinta y recoge la confirmación del usuario, igual que el resto de la app.
//
// Tres pasos en una sola Hoja, sin navegación aparte:
//   1. Buscar la venta (folio o id).
//   2. Elegir qué se devuelve (cantidad por línea) y cómo se reembolsa.
//   3. Confirmar. La pantalla de éxito reutiliza <Vacio>, sin inventar un
//      componente nuevo para un caso que ya cubre uno existente.

import { useState, useEffect, useCallback } from "react";
import { View, Switch, ActivityIndicator } from "react-native";
import { useTema } from "@/src/componentes/TemaProvider";
import {
  Hoja,
  Seccion,
  Grupo,
  Fila,
  Txt,
  Monto,
  Boton,
  Vacio,
} from "@/src/componentes/ui";
import { Pressable } from "react-native";
import { pesos } from "@/src/base/formato";
import { turnoActivo } from "@/src/base/venta";
import { asegurarUsuario } from "@/src/base/usuarios";
import {
  buscarVenta,
  devolver,
  listarVentasRecientes,
  repartoReembolso,
  VentaDetalle,
  VentaResumen,
  MetodoReembolso,
} from "@/src/base/devoluciones";

const ETIQUETA_METODO: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  credito: "Crédito",
};

const ETIQUETA_ESTADO: Record<string, string> = {
  completada: "Completada",
  devuelta_parcial: "Con devolución",
  devuelta_total: "Devuelta",
  cancelada: "Cancelada",
};

/** Hora corta (14:32) para la lista — la fecha completa no aporta cuando
 *  casi todo lo que se devuelve es del mismo día. */
function horaCorta(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

export default function ModalDevoluciones({
  onCerrar,
  onCambio,
}: {
  onCerrar: () => void;
  /** Se llama tras una devolución exitosa, para que quien abrió el modal
   *  recargue lo que dependa de ventas/stock (Inicio, Inventario…). */
  onCambio?: () => void;
}) {
  const { tema: T } = useTema();

  const [lista, setLista] = useState<VentaResumen[]>([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);
  const [venta, setVenta] = useState<VentaDetalle | null>(null);

  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [cancelacionTotal, setCancelacionTotal] = useState(false);

  const [procesando, setProcesando] = useState(false);
  const [errorConfirmar, setErrorConfirmar] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ total: number; cancelo: boolean } | null>(null);

  const cargarLista = useCallback(async () => {
    setCargandoLista(true);
    setErrorLista(null);
    try {
      setLista(await listarVentasRecientes());
    } catch (e: any) {
      setErrorLista(e?.message ?? "No se pudieron cargar las ventas.");
    } finally {
      setCargandoLista(false);
    }
  }, []);

  useEffect(() => {
    cargarLista();
  }, [cargarLista]);

  function volverALista() {
    setVenta(null);
    setCantidades({});
    setCancelacionTotal(false);
    setErrorConfirmar(null);
    setResultado(null);
    cargarLista();
  }

  /** Abre una venta concreta POR ID — nunca por folio. El folio se repite
   *  entre cajas (ver listarVentasRecientes en devoluciones.ts); el id no. */
  async function abrirVenta(v: VentaResumen) {
    if (!v.devolvible) return;
    setAbriendo(v.id);
    setErrorLista(null);
    try {
      const detalle = await buscarVenta(v.id);
      if (!detalle) {
        setErrorLista("No se pudo abrir esa venta.");
      } else if (detalle.lineas.every((l) => l.cantidad_disponible <= 0)) {
        setErrorLista("Esta venta ya fue devuelta o cancelada por completo.");
      } else {
        // Preseleccionar el método con el que SE PAGÓ. Antes se quedaba
        // siempre en "efectivo", así que devolver una venta a crédito
        // reembolsaba efectivo del cajón y el cliente SEGUÍA DEBIENDO: el
        // dinero salía dos veces del negocio. Se elige el método de mayor
        // importe de la venta, que para el caso normal (un solo método) es
        // sencillamente el que se usó.
        setVenta(detalle);
      }
    } catch (e: any) {
      setErrorLista(e?.message ?? "No se pudo abrir esa venta.");
    } finally {
      setAbriendo(null);
    }
  }

  function cambiarCantidad(lineaId: string, disponible: number, delta: number) {
    setCancelacionTotal(false);
    setCantidades((s) => {
      const actual = s[lineaId] ?? 0;
      const nueva = Math.max(0, Math.min(disponible, actual + delta));
      return { ...s, [lineaId]: nueva };
    });
  }

  function alternarCancelacionTotal(activar: boolean) {
    setCancelacionTotal(activar);
    if (!venta) return;
    if (activar) {
      const todas: Record<string, number> = {};
      for (const l of venta.lineas) {
        if (l.cantidad_disponible > 0) todas[l.venta_linea_id] = l.cantidad_disponible;
      }
      setCantidades(todas);
    } else {
      setCantidades({});
    }
  }

  const lineasSeleccionadas = venta
    ? venta.lineas.filter((l) => (cantidades[l.venta_linea_id] ?? 0) > 0)
    : [];
  // Factor de "lo que de verdad se cobró" frente al precio de lista de las
  // líneas. El canje de puntos es un descuento GLOBAL de la venta: no está
  // repartido en las líneas, así que sin este ajuste el botón prometía el
  // precio de lista (p. ej. "Devolver $100") mientras la devolución real
  // aplicaba $61. El importe se aplicaba bien, pero la pantalla mentía —
  // y el reparto por método que se mostraba encima salía calculado sobre
  // ese importe equivocado.
  //
  // MISMA fórmula que devolver() en devoluciones.ts. Si las dos dejan de
  // coincidir, la pantalla vuelve a mentir: cualquier cambio va en las dos.
  const sumaLineasVenta = venta
    ? venta.lineas.reduce((s, l) => s + l.total_linea_centavos, 0)
    : 0;
  const factorCobrado =
    venta && sumaLineasVenta > 0 ? venta.total_centavos / sumaLineasVenta : 1;

  const totalADevolver = lineasSeleccionadas.reduce((suma, l) => {
    const cant = cantidades[l.venta_linea_id] ?? 0;
    const proporcion = l.cantidad_vendida > 0 ? cant / l.cantidad_vendida : 0;
    return suma + Math.round(l.total_linea_centavos * proporcion * factorCobrado);
  }, 0);

  // El reembolso NO lo elige el cajero: vuelve por donde entró, en la
  // misma proporción del cobro. Se calcula aquí solo para MOSTRARLO antes de
  // confirmar; la cuenta buena la vuelve a hacer devolver() al aplicarla.
  const repartoPrevio = venta
    ? repartoReembolso(totalADevolver, venta.metodos_pago)
    : [];

  async function confirmar() {
    if (!venta || lineasSeleccionadas.length === 0) return;
    setErrorConfirmar(null);
    setProcesando(true);
    try {
      const [turno, usuario] = await Promise.all([turnoActivo(), asegurarUsuario()]);
      if (!turno) throw new Error("No hay un turno de caja abierto.");
      const r = await devolver({
        venta_id: venta.id,
        caja_sesion_id: turno.id,
        usuario_pos_id: usuario.id,
        motivo: cancelacionTotal ? "Cancelación" : null,
        lineas: lineasSeleccionadas.map((l) => ({
          venta_linea_id: l.venta_linea_id,
          cantidad: cantidades[l.venta_linea_id],
        })),
      });
      setResultado({ total: r.total_devuelto_centavos, cancelo: r.estado_venta === "cancelada" });
      onCambio?.();
    } catch (e: any) {
      setErrorConfirmar(e?.message ?? "No se pudo procesar la devolución.");
    } finally {
      setProcesando(false);
    }
  }

  return (
    <Hoja
      visible
      onCerrar={onCerrar}
      titulo="Devolver o cancelar"
      tipo="completa"
      pie={
        resultado ? undefined : venta ? (
          <Boton
            titulo={
              lineasSeleccionadas.length === 0
                ? "Elige qué devolver"
                : `Devolver ${pesos(totalADevolver)}`
            }
            onPress={confirmar}
            deshabilitado={lineasSeleccionadas.length === 0}
            cargando={procesando}
            tipo={cancelacionTotal ? "peligro" : "primario"}
          />
        ) : undefined
      }
    >
      {resultado ? (
        <Vacio
          titulo={resultado.cancelo ? "Venta cancelada" : "Devolución registrada"}
          texto={`Se devolvieron ${pesos(resultado.total)}.`}
          accion={{ texto: "Devolver otra venta", onPress: volverALista }}
        />
      ) : !venta ? (
        <>
          <Txt escala="pie" tono="suave" estilo={{ marginBottom: T.esps.md }}>
            Toca una venta para devolver productos o cancelarla.
          </Txt>

          {errorLista ? (
            <Txt escala="pie" tono="peligro" estilo={{ marginBottom: T.esps.md }}>
              {errorLista}
            </Txt>
          ) : null}

          {cargandoLista ? (
            <View style={{ paddingVertical: T.esps.xl, alignItems: "center" }}>
              <ActivityIndicator color={T.acento} />
            </View>
          ) : lista.length === 0 ? (
            <Vacio
              titulo="Todavía no hay ventas"
              texto="Cuando cobres tu primera venta, aparecerá aquí para poder devolverla."
            />
          ) : (
            <Grupo>
              {lista.map((v) => (
                <Pressable
                  key={v.id}
                  onPress={() => abrirVenta(v)}
                  disabled={!v.devolvible || abriendo !== null}
                  android_ripple={v.devolvible ? { color: T.acentoBorde } : undefined}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    minHeight: T.filaAlto,
                    paddingHorizontal: T.esps.lg,
                    paddingVertical: T.esps.md,
                    gap: T.esps.md,
                    opacity: v.devolvible ? 1 : 0.5,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: T.esps.sm }}>
                      <Txt escala="cuerpo" fuerte>{v.folio_etiqueta}</Txt>
                      <Txt escala="pie" tono="tenue">{horaCorta(v.creado_en)}</Txt>
                    </View>
                    <Txt escala="pie" tono="suave" estilo={{ marginTop: 2 }}>
                      {v.articulos} artículo{v.articulos === 1 ? "" : "s"}
                      {v.estado !== "completada"
                        ? ` · ${ETIQUETA_ESTADO[v.estado] ?? v.estado}`
                        : ""}
                    </Txt>
                  </View>
                  {abriendo === v.id ? (
                    <ActivityIndicator color={T.acento} />
                  ) : (
                    <Monto texto={pesos(v.total_centavos)} escala="cuerpo" />
                  )}
                </Pressable>
              ))}
            </Grupo>
          )}
        </>
      ) : (
        <>
          <View style={{ marginBottom: T.esps.md }}>
            <Boton
              titulo="← Elegir otra venta"
              tipo="secundario"
              chico
              onPress={volverALista}
            />
          </View>
          <>
            <>
              <View style={{ marginBottom: T.esps.lg }}>
                <Grupo>
                  <Fila
                    titulo={`Venta #${venta.folio}`}
                    meta={venta.estado === "devuelta_parcial" ? "Ya tiene una devolución parcial" : undefined}
                    valor={<Monto texto={pesos(venta.total_centavos)} escala="cuerpo" />}
                    flecha={false}
                  />
                </Grupo>
              </View>

              <Seccion titulo="¿Qué se devuelve?">
                <Grupo>
                  {venta.lineas.map((l, i) => {
                    const cant = cantidades[l.venta_linea_id] ?? 0;
                    const agotada = l.cantidad_disponible <= 0;
                    return (
                      <View
                        key={l.venta_linea_id}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          minHeight: T.filaAlto,
                          paddingHorizontal: T.esps.lg,
                          paddingVertical: T.esps.md,
                          gap: T.esps.md,
                          opacity: agotada ? 0.5 : 1,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Txt escala="cuerpo" fuerte lineas={1}>
                            {l.nombre}
                          </Txt>
                          <Txt escala="pie" tono="suave" estilo={{ marginTop: 2 }}>
                            {agotada
                              ? "Ya devuelta por completo"
                              : `${pesos(l.precio_unitario_centavos)} c/u · disponible: ${l.cantidad_disponible}`}
                          </Txt>
                        </View>
                        {!agotada && (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: T.esps.sm }}>
                            <Pressable
                              onPress={() => cambiarCantidad(l.venta_linea_id, l.cantidad_disponible, -1)}
                              disabled={cant <= 0}
                              android_ripple={{ color: T.acentoBorde }}
                              style={{
                                width: 32, height: 32, borderRadius: T.radioChico,
                                backgroundColor: T.superficie2, alignItems: "center", justifyContent: "center",
                                opacity: cant <= 0 ? 0.4 : 1,
                              }}
                            >
                              <Txt escala="cuerpo" fuerte>−</Txt>
                            </Pressable>
                            <Monto texto={String(cant)} escala="cuerpo" estilo={{ minWidth: 22, textAlign: "center" }} />
                            <Pressable
                              onPress={() => cambiarCantidad(l.venta_linea_id, l.cantidad_disponible, 1)}
                              disabled={cant >= l.cantidad_disponible}
                              android_ripple={{ color: T.acentoBorde }}
                              style={{
                                width: 32, height: 32, borderRadius: T.radioChico,
                                backgroundColor: T.superficie2, alignItems: "center", justifyContent: "center",
                                opacity: cant >= l.cantidad_disponible ? 0.4 : 1,
                              }}
                            >
                              <Txt escala="cuerpo" fuerte>+</Txt>
                            </Pressable>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </Grupo>
              </Seccion>

              <View style={{ marginTop: T.esps.md, marginBottom: T.esps.lg }}>
                <Grupo>
                  <Fila
                    titulo="Cancelar la venta completa"
                    meta="Marca todo lo disponible para devolver de una vez."
                    flecha={false}
                    valor={
                      <Switch
                        value={cancelacionTotal}
                        onValueChange={alternarCancelacionTotal}
                        trackColor={{ false: T.superficie3, true: T.peligroSuave }}
                        thumbColor={cancelacionTotal ? T.peligro : T.textoTenue}
                      />
                    }
                  />
                </Grupo>
              </View>

              <Seccion titulo="¿Cómo se reembolsa?">
                {/* El cajero ya no elige método: el dinero vuelve por donde
                    entró, en la misma proporción del cobro. Elegirlo a mano
                    permitía devolver en efectivo una venta pagada con tarjeta
                    —el cajón quedaba corto sin explicación— o devolver
                    efectivo por una venta a crédito, dejando además al
                    cliente debiendo. Aquí solo se muestra el reparto para que
                    no haya sorpresas al confirmar. */}
                {repartoPrevio.length === 0 ? (
                  <Txt escala="pie" tono="suave">
                    Elige qué devolver para ver cómo se reembolsa.
                  </Txt>
                ) : (
                  <>
                    <Grupo>
                      {repartoPrevio.map((r) => (
                        <Fila
                          key={r.metodo}
                          titulo={ETIQUETA_METODO[r.metodo] ?? r.metodo}
                          valor={<Monto texto={pesos(r.monto_centavos)} escala="cuerpo" />}
                          flecha={false}
                        />
                      ))}
                    </Grupo>
                    <Txt escala="micro" tono="tenue" estilo={{ marginTop: T.esps.sm }}>
                      {repartoPrevio.length === 1
                        ? "El dinero vuelve por donde se pagó."
                        : "Esta venta se pagó con varios métodos, así que el reembolso se reparte igual que el cobro."}
                      {repartoPrevio.some((r) => r.metodo === "credito")
                        ? " La parte a crédito se abona a la cuenta del cliente."
                        : ""}
                    </Txt>
                  </>
                )}
              </Seccion>

              {errorConfirmar ? (
                <Txt escala="pie" tono="peligro" estilo={{ marginTop: T.esps.md }}>
                  {errorConfirmar}
                </Txt>
              ) : null}
            </>
          </>
        </>
      )}
    </Hoja>
  );
}
