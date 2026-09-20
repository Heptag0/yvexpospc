// YvexPOS Móvil — Pantalla de Yaxo, en formato de chat.
//
// ===========================================================================
// POR QUÉ CAMBIÓ DE TARJETA ÚNICA A HISTORIAL DE BURBUJAS
// ===========================================================================
// La versión anterior mostraba una sola respuesta a la vez, con la pregunta
// tocada desapareciendo y una lista de "puedes seguir con" debajo. Con
// testers reales, eso se leía como una pantalla de FAQ, no como estar
// hablando con alguien: no había continuidad, y la pregunta que se tocó no
// dejaba rastro.
//
// Ahora cada pregunta tocada se AÑADE como burbuja del usuario, y cada
// respuesta como burbuja de Yaxo con su avatar. El historial se puede
// recorrer hacia arriba, que es lo que hace que se sienta continuo.
//
// ===========================================================================
// EL HISTORIAL ES EFÍMERO A PROPÓSITO
// ===========================================================================
// Se pierde al salir de esta pantalla. No es un descuido: recordar
// conversaciones entre sesiones es la función de memoria del plan premium
// (ver el comentario de PersonalidadYaxo en yaxoVoz.ts sobre los puntos de
// extensión). Si el local recordara ya, no habría nada nuevo que vender ahí.
// El día que exista, la salida natural es un archivo con límite —como el
// "archivado" de un chat— y no historial infinito.
//
// ===========================================================================
// SIGUE SIN HABER CAMPO DE TEXTO, Y ES A PROPÓSITO
// ===========================================================================
// Que ahora se vea como chat no significa que acepte cualquier pregunta: los
// chips son la única entrada. Meter un campo de texto que no hace nada
// (porque no hay modelo detrás) regalaría la promesa del plan premium antes
// de que exista función real que la respalde. Ver la nota completa sobre esto
// en la versión anterior de este archivo / en yaxoFrases.ts.
//
// ===========================================================================
// EL AVATAR DE CADA BURBUJA CONGELA SU PROPIO ESTADO
// ===========================================================================
// Si preguntaste "qué tengo parado" y salió pensativo, esa burbuja se queda
// pensativa aunque la siguiente pregunta ponga a Yaxo feliz. Es gratis en
// código —cada mensaje ya lleva su `estado`— y es lo que hace que parezca que
// reaccionó a CADA cosa en su momento, en vez de un icono fijo pegado al lado
// de un texto que cambia.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useTema } from "@/src/componentes/TemaProvider";
import { Txt } from "@/src/componentes/ui";
import { IconoUI } from "@/src/componentes/iconos";
import Yaxo, { EstadoYaxo } from "@/src/componentes/Yaxo";
import { pesos } from "@/src/base/formato";
import { reunirHechos } from "@/src/base/yaxoHechos";
import {
  ritmoYCobertura,
  inventarioParado,
  margenContraDepartamento,
  volumenSinMargen,
  sinCostoCapturado,
  leerUmbrales,
  guardarUmbral,
  marcarAvisoVisto,
  Umbrales,
} from "@/src/base/indicadores";
import { mejorDiaRango, productosPorGanancia } from "@/src/base/reportes";
import { turnoActivo, corteTurno } from "@/src/base/venta";
import { resumen as resumenFinanzas, hoyYmd } from "@/src/base/finanzas";
import { totalPorCobrar, listarDeudores } from "@/src/base/credito";
import {
  RespuestaYaxo,
  comoVoy,
  queResurtir,
  queTengoParado,
  estoyCobrandoBien,
  ModoResurtir,
  OpcionYaxo,
  mejorDiaSemana,
  productoQueMasDeja,
  vendoMuchoDejaPoco,
  faltaCosto,
  efectivoEnCajon,
  gastosDelMes,
  alcanzaParaFijos,
  cuantoMeDeben,
  explicarUmbral,
  umbralCambiado,
  PREGUNTA_UMBRAL,
} from "@/src/base/yaxoFrases";
import { variar } from "@/src/base/yaxoVoz";
import { TEMAS, PREGUNTAS_DATOS, PREGUNTAS_TEXTO } from "@/src/base/yaxoGuia";

export type OrigenYaxo = "inicio" | "vender" | "inventario" | "reportes" | "dinero";

// ===========================================================================
// DE DÓNDE SALEN LAS PREGUNTAS AHORA
// ===========================================================================
// Los TEXTOS, los temas y las respuestas escritas viven en yaxoGuia.ts, que es
// copia literal del mismo archivo en el PC. Aquí solo queda lo que NO se puede
// compartir: cómo se resuelve cada pregunta de datos, que en el móvil es
// llamar a reportes.ts/indicadores.ts y en el PC invocar comandos de Rust.
//
// El mapa de abajo asocia el id de la pregunta con su resolución. Si un id de
// PREGUNTAS_DATOS no está aquí, esa pregunta NO se ofrece: es preferible que
// falte un chip a que exista uno que truena.

type Pregunta = {
  id: string;
  tema: string;
  texto: string;
  pantallas?: string[];
};

// Cada función recibe un argumento OPCIONAL: es lo que viene después de los
// dos puntos en el id de una opción ("resurtir:urgente" → "urgente"). Las que
// no repreguntan simplemente lo ignoran.
const RESOLVER: Record<string, (arg?: string) => Promise<RespuestaYaxo>> = {
  hoy: async () => comoVoy(await reunirHechos("hoy"), pesos),
  semana: async () => comoVoy(await reunirHechos("7d"), pesos),
  // La única que hoy repregunta. Sin argumento, queResurtir decide si vale la
  // pena preguntar (solo si hay diferencia real entre lo urgente y lo del mes)
  // o contestar directamente.
  resurtir: async (arg) => {
    // Los umbrales se leen aquí y se pasan a la frase. Sin esto, indicadores
    // calcularía con los del dueño y el texto hablaría de los de fábrica.
    const [ritmo, u] = await Promise.all([ritmoYCobertura(), leerUmbrales()]);
    return queResurtir(ritmo, pesos, arg as ModoResurtir | undefined, u);
  },
  parado: async () => queTengoParado(await inventarioParado(), pesos),
  precios: async () => estoyCobrandoBien(await margenContraDepartamento(), pesos),
  // "Qué día vendo más" no necesitó SQL nuevo en el móvil: mejorDiaRango() ya
  // existía en reportes.ts. Se usa el rango de 30 días porque con 7 no hay ni
  // dos sábados que comparar, y un solo sábado no es un día fuerte.
  //
  // La media de los otros días NO la da mejorDiaRango(), así que aquí no
  // viaja: la frase lo detecta y dice el total sin comparar, en vez de
  // inventarse una referencia. El PC sí la calcula (mejor_dia la devuelve), y
  // esa diferencia está anotada en yaxoFrases.ts.
  mejordia: async () => mejorDiaSemana(await mejorDiaRango("30d"), pesos),
  ganancia: async () => productoQueMasDeja(await productosPorGanancia("30d", 5), pesos),
  volumen: async () => vendoMuchoDejaPoco(await volumenSinMargen(), pesos),
  sincosto: async () => faltaCosto(await sinCostoCapturado(), pesos),

  // Tema Dinero y caja. Ninguna necesitó SQL nuevo en el móvil: corteTurno(),
  // resumen() de finanzas.ts y credito.ts ya daban todo. Se llaman desde aquí
  // igual que reportes.ts — misma regla, no se reescribe lo que ya existe.
  cajon: async () => {
    // Sin turno abierto no hay cajón que cuadrar. La frase lo dice; aquí solo
    // se evita llamar a corteTurno con null.
    const t = await turnoActivo();
    return efectivoEnCajon(t ? await corteTurno(t) : null, pesos);
  },
  gastos: async () => gastosDelMes(await resumenFinanzas("negocio", hoyYmd()), pesos),
  fijos: async () => alcanzaParaFijos(await resumenFinanzas("negocio", hoyYmd()), pesos),
  ...umbralesAlResolver(),

  deben: async () => {
    // El móvil no tiene el equivalente de resumen_deuda() del PC, así que se
    // arma aquí con las dos funciones que sí existen en credito.ts. El
    // resultado tiene la MISMA forma que el struct de Rust para que la frase
    // sea una sola en las dos plataformas.
    const [total, deudores] = await Promise.all([totalPorCobrar(), listarDeudores()]);
    return cuantoMeDeben(
      {
        total_centavos: total,
        num_clientes: deudores.length,
        sobre_limite: deudores.filter(
          (c) => c.limite_credito_centavos > 0 && c.saldo_centavos > c.limite_credito_centavos
        ).length,
        clientes: deudores.slice(0, 5).map((c) => ({
          nombre: c.nombre,
          saldo_centavos: c.saldo_centavos,
        })),
      },
      pesos
    );
  },
};

/** Las cinco preguntas de umbral se resuelven igual, así que se generan en vez
 *  de escribirse cinco veces. Sin argumento explican; con argumento guardan.
 *
 *  Guardar devuelve los umbrales RELEÍDOS, no los que se pidieron: si el valor
 *  se salió de rango y se recortó, el dueño tiene que ver el que quedó. */
function umbralesAlResolver(): Record<string, (arg?: string) => Promise<RespuestaYaxo>> {
  const out: Record<string, (arg?: string) => Promise<RespuestaYaxo>> = {};
  for (const k of Object.keys(PREGUNTA_UMBRAL) as (keyof Umbrales)[]) {
    out[PREGUNTA_UMBRAL[k]] = async (arg?: string) => {
      if (arg === undefined) return explicarUmbral(k, await leerUmbrales(), pesos);
      await guardarUmbral(k, Number(arg));
      return umbralCambiado(k, await leerUmbrales(), pesos);
    };
  }
  return out;
}

// Solo las que este lado sabe resolver.
const DATOS: Pregunta[] = PREGUNTAS_DATOS.filter((p) => !!RESOLVER[p.id]);

// A qué ruta lleva el atajo "abrir" de una respuesta escrita. El archivo de
// datos guarda un id NEUTRO de módulo a propósito: una ruta del móvil no
// significa nada en la caja, y al revés. La traducción es de cada plataforma.
//
// Lo que no esté en este mapa simplemente no ofrece atajo; la explicación se
// muestra igual. Varias herramientas del PC viven en el móvil dentro de
// modales de otra pantalla, y llevar ahí desde aquí exigiría una navegación
// que hoy no existe — mejor sin atajo que con uno que deja al usuario en un
// sitio que no esperaba.
const RUTA_MODULO: Record<string, string> = {
  inventario: "/inventario",
  existencias: "/inventario",
  caja: "/reportes",
};

// El aviso de beta es el PRIMER mensaje de Yaxo, no una tarjeta aparte al
// final. En un chat, lo que Yaxo dice al empezar es parte de la conversación,
// no un pie de página legal.
const SALUDO =
  "Hola, soy Yaxo. Pregúntame por tu negocio y te explico de dónde salen los números. " +
  "Todavía estoy en pruebas: si algo no te cuadra con lo que ves en tu tienda, " +
  "escríbele a Arturo a contacto@yvexiq.com y lo corregimos.";

type Mensaje =
  | {
      id: string;
      de: "yaxo";
      estado: EstadoYaxo;
      titulo?: string;
      parrafos: string[];
      /** Ruta a la que puede llevar esta respuesta (explicaciones de herramientas). */
      abrir?: string;
      abrirTexto?: string;
    }
  | { id: string; de: "usuario"; texto: string };

let _idMensaje = 0;
const nuevoId = () => String(++_idMensaje);

export default function PantallaYaxo() {
  const { tema: T } = useTema();
  const params = useLocalSearchParams<{ desde?: string }>();
  const origen = (params.desde ?? "inicio") as OrigenYaxo;

  const [mensajes, setMensajes] = useState<Mensaje[]>([
    { id: nuevoId(), de: "yaxo", estado: "reposo", parrafos: [SALUDO] },
  ]);
  const [cargando, setCargando] = useState(false);
  // Sugeridas tras la última respuesta: se ponen delante, nunca esconden nada.
  const [sugeridas, setSugeridas] = useState<string[]>([]);
  // Tema abierto. null = la barra muestra los TEMAS; con un tema, muestra sus
  // preguntas más un chip para volver.
  //
  // POR QUÉ HAY DOS NIVELES Y NO UNA LISTA PLANA
  // Con cinco preguntas una fila de chips bastaba. Con veinticinco ya no
  // caben: hay que deslizar mucho, y lo que no se ve no existe. El nivel de
  // temas no es decoración, es lo que hace que el repertorio sea encontrable.
  const [tema, setTema] = useState<string | null>(null);
  // Repregunta en curso. Se pone cuando una respuesta trae `opciones` y se
  // limpia en cuanto se contesta o se cambia de tema: una repregunta vieja
  // colgando de la barra sería un chip que ya no viene a cuento.
  const [opciones, setOpciones] = useState<OpcionYaxo[]>([]);

  const scrollRef = useRef<ScrollView>(null);

  // Chips visibles ahora mismo.
  const chips = useMemo(() => {
    if (tema === null) {
      // Nivel de temas. Se ordenan poniendo delante el que tiene preguntas
      // relevantes para la pantalla de origen: entrando desde Inventario, el
      // tema Inventario va primero.
      const relevante = (t: { id: string }) =>
        DATOS.some((p) => p.tema === t.id && p.pantallas?.includes(origen)) ? 0 : 1;
      return [...TEMAS].sort((a, b) => relevante(a) - relevante(b));
    }
    const delTema: Pregunta[] = [
      ...DATOS.filter((p) => p.tema === tema),
      ...PREGUNTAS_TEXTO.filter((p) => p.tema === tema),
    ];
    // Dentro del tema: primero lo que Yaxo acaba de sugerir, luego lo propio
    // de la pantalla de origen, luego el resto. Mismo criterio de tres
    // niveles que ya existía, ahora acotado al tema abierto.
    const rango = (p: Pregunta) => {
      if (sugeridas.includes(p.id)) return 0;
      if (p.pantallas?.includes(origen)) return 1;
      return 2;
    };
    return delTema.sort((a, b) => rango(a) - rango(b));
  }, [tema, sugeridas, origen]);

  useEffect(() => {
    // Abrir la pantalla apaga el punto hasta mañana. Va AQUÍ y no en el botón
    // a propósito: si alguien lo toca sin querer y sale, el aviso sigue. Si
    // falla, no pasa nada — el punto seguirá encendido, que es el lado seguro
    // del error.
    void marcarAvisoVisto().catch(() => {});
  }, []);

  useEffect(() => {
    // Al fondo cada vez que se añade algo: es lo que un chat hace siempre.
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [mensajes, cargando]);

  // Abrir un tema NO es solo cambiar los chips en silencio: Yaxo contesta.
  // Esa burbuja es la diferencia entre una conversación y un menú telefónico.
  const abrirTema = useCallback((t: (typeof TEMAS)[number]) => {
    setTema(t.id);
    setSugeridas([]);
    setOpciones([]);
    setMensajes((m) => [
      ...m,
      { id: nuevoId(), de: "usuario", texto: t.nombre },
      {
        id: nuevoId(),
        de: "yaxo",
        estado: "reposo",
        parrafos: variar("tema-" + t.id, t.intro.map((v) => v.join(" "))).split("\n"),
      },
    ]);
  }, []);

  const preguntar = useCallback(async (p: Pregunta) => {
    setMensajes((m) => [...m, { id: nuevoId(), de: "usuario", texto: p.texto }]);
    // La repregunta anterior deja de aplicar en cuanto se toca cualquier cosa.
    setOpciones([]);

    // "resurtir:urgente" → base "resurtir", argumento "urgente".
    const [base, arg] = p.id.split(":");

    // Respuestas ESCRITAS: no tocan la base, así que no hay espera ni puede
    // fallar nada. Se resuelven aquí mismo, sin pasar por el estado de carga
    // — un "déjame ver…" para leer un texto que ya está en memoria sería
    // teatro, y el teatro se nota.
    const escrita = PREGUNTAS_TEXTO.find((x) => x.id === base);
    if (escrita) {
      const cual = variar(
        "txt-" + escrita.id,
        escrita.variantes.map((v) => v.join("\u0000"))
      ).split("\u0000");
      const ruta = escrita.abrir ? RUTA_MODULO[escrita.abrir] : undefined;
      setMensajes((m) => [
        ...m,
        {
          id: nuevoId(),
          de: "yaxo",
          estado: escrita.estado as EstadoYaxo,
          parrafos: cual,
          abrir: ruta,
          abrirTexto: ruta ? "Abrir " + escrita.texto.toLowerCase() : undefined,
        },
      ]);
      return;
    }

    const resolver = RESOLVER[base];
    if (!resolver) return;
    setCargando(true);
    try {
      const r = await resolver(arg);
      setMensajes((m) => [
        ...m,
        { id: nuevoId(), de: "yaxo", estado: r.estado, titulo: r.titulo, parrafos: r.parrafos },
      ]);
      setSugeridas(r.siguientes ?? []);
      setOpciones(r.opciones ?? []);
    } catch (e: any) {
      // Los errores de permiso vienen de exigirPermiso() en reportes.ts y ya
      // traen texto legible. Se muestran como un mensaje más de Yaxo, no como
      // un cartel de error aparte: en un chat, hasta un fallo se dice hablando.
      setMensajes((m) => [
        ...m,
        {
          id: nuevoId(),
          de: "yaxo",
          estado: "preocupado",
          parrafos: [e?.message ?? String(e)],
        },
      ]);
    } finally {
      setCargando(false);
    }
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.fondo }} edges={["top", "bottom"]}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: T.esps.md,
          paddingHorizontal: T.esp,
          paddingVertical: T.esps.md,
          borderBottomWidth: 1,
          borderBottomColor: T.borde,
        }}
      >
        <Yaxo estado={cargando ? "trabajando" : "reposo"} size={34} />
        <Txt escala="titulo" fuerte>
          Yaxo
        </Txt>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: T.esp, gap: T.esps.md }}
        keyboardShouldPersistTaps="handled"
      >
        {mensajes.map((m) =>
          m.de === "usuario" ? (
            <BurbujaUsuario key={m.id} texto={m.texto} T={T} />
          ) : (
            <BurbujaYaxo
              key={m.id}
              estado={m.estado}
              titulo={m.titulo}
              parrafos={m.parrafos}
              abrir={m.abrir}
              abrirTexto={m.abrirTexto}
              T={T}
            />
          )
        )}
        {cargando && <BurbujaCargando T={T} />}
      </ScrollView>

      {/* Los chips son la barra de entrada, no una sección de la pantalla:
          van pegados abajo, como el sitio donde en cualquier chat viven los
          controles de responder. */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: T.borde,
          paddingVertical: T.esps.md,
        }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: T.esp, gap: T.esps.sm }}
        >
          {/* Chip de volver, solo dentro de un tema. Va PRIMERO porque es
              donde el pulgar llega sin mover la mano, y porque lo que se
              busca al terminar con un tema es salir de él. */}
          {tema !== null && (
            <Chip
              texto="← Temas"
              tenue
              onPress={() => {
                setTema(null);
                setSugeridas([]);
                setOpciones([]);
              }}
              disabled={cargando}
              T={T}
            />
          )}
          {/* La repregunta manda: si Yaxo acaba de preguntar algo, sus
              opciones van primero y con el color de acento. Si estuvieran
              mezcladas con el resto de chips, la pregunta quedaría sin
              respuesta visible y parecería que Yaxo habla solo. */}
          {opciones.map((o) => (
            <Chip
              key={o.id}
              texto={o.texto}
              acento
              onPress={() => void preguntar({ id: o.id, tema: tema ?? "", texto: o.texto })}
              disabled={cargando}
              T={T}
            />
          ))}
          {tema === null
            ? (chips as typeof TEMAS).map((t) => (
                <Chip key={t.id} texto={t.nombre} onPress={() => abrirTema(t)} disabled={cargando} T={T} />
              ))
            : (chips as Pregunta[]).map((p) => (
                <Chip
                  key={p.id}
                  texto={p.texto}
                  onPress={() => void preguntar(p)}
                  disabled={cargando}
                  T={T}
                />
              ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Burbujas
// ---------------------------------------------------------------------------

// Chip de la barra de entrada. Estaba escrito a mano dos veces en el JSX;
// ahora que hay dos niveles (temas y preguntas) habrían sido tres copias del
// mismo bloque de estilos.
function Chip({
  texto,
  onPress,
  disabled,
  tenue,
  acento,
  T,
}: {
  texto: string;
  onPress: () => void;
  disabled?: boolean;
  tenue?: boolean;
  /** Para las opciones de una repregunta: son la respuesta a algo que Yaxo
   *  acaba de preguntar, no una pregunta más del repertorio. */
  acento?: boolean;
  T: ReturnType<typeof useTema>["tema"];
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 999,
        backgroundColor: acento ? T.acentoRelleno : tenue ? "transparent" : T.superficie,
        borderWidth: 1,
        borderColor: acento ? T.acentoRelleno : T.borde,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <Txt
        escala="pie"
        fuerte={acento}
        tono={tenue ? "tenue" : undefined}
        estilo={acento ? { color: T.acentoTexto } : undefined}
      >
        {texto}
      </Txt>
    </Pressable>
  );
}

function BurbujaYaxo({
  estado,
  titulo,
  parrafos,
  abrir,
  abrirTexto,
  T,
}: {
  estado: EstadoYaxo;
  titulo?: string;
  parrafos: string[];
  abrir?: string;
  abrirTexto?: string;
  T: ReturnType<typeof useTema>["tema"];
}) {
  return (
    <View style={{ flexDirection: "row", gap: T.esps.sm, maxWidth: "92%" }}>
      {/* El avatar queda fijo con el estado que tenía ESTA respuesta al
          generarse. No se re-renderiza con el estado global de la pantalla:
          por eso vive dentro del mensaje y no en la cabecera. */}
      <Yaxo estado={estado} size={30} />
      <View
        style={{
          flex: 1,
          backgroundColor: T.superficie,
          borderRadius: T.radio,
          borderTopLeftRadius: 4,
          padding: T.esps.md,
        }}
      >
        {titulo ? (
          <Txt escala="cuerpo" fuerte estilo={{ marginBottom: T.esps.sm }}>
            {titulo}
          </Txt>
        ) : null}
        {parrafos.map((p, i) => (
          <Txt
            key={i}
            escala="pie"
            tono="suave"
            estilo={{
              lineHeight: 21,
              marginBottom: i === parrafos.length - 1 ? 0 : T.esps.sm,
            }}
          >
            {p}
          </Txt>
        ))}
        {/* Atajo a la herramienta explicada. Explicar algo y dejar que el
            usuario lo busque por su cuenta es media ayuda: si Yaxo sabe de
            qué habla, sabe dónde está. */}
        {abrir ? (
          <Pressable
            onPress={() => router.push(abrir as any)}
            style={({ pressed }) => ({
              marginTop: T.esps.md,
              alignSelf: "flex-start",
              paddingVertical: 8,
              paddingHorizontal: 14,
              borderRadius: 999,
              backgroundColor: T.acentoRelleno,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Txt escala="pie" fuerte estilo={{ color: T.acentoTexto }}>
              {abrirTexto ?? "Abrir"}
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function BurbujaUsuario({ texto, T }: { texto: string; T: ReturnType<typeof useTema>["tema"] }) {
  return (
    <View style={{ alignItems: "flex-end" }}>
      <View
        style={{
          maxWidth: "80%",
          backgroundColor: T.acentoRelleno,
          borderRadius: T.radio,
          borderTopRightRadius: 4,
          paddingVertical: 10,
          paddingHorizontal: 14,
        }}
      >
        <Txt escala="pie" estilo={{ color: T.acentoTexto }}>
          {texto}
        </Txt>
      </View>
    </View>
  );
}

function BurbujaCargando({ T }: { T: ReturnType<typeof useTema>["tema"] }) {
  return (
    <View style={{ flexDirection: "row", gap: T.esps.sm }}>
      <Yaxo estado="trabajando" size={30} />
      <View
        style={{
          backgroundColor: T.superficie,
          borderRadius: T.radio,
          borderTopLeftRadius: 4,
          paddingVertical: 12,
          paddingHorizontal: T.esps.md,
        }}
      >
        <Txt escala="pie" tono="tenue">
          Déjame ver…
        </Txt>
      </View>
    </View>
  );
}
