// YvexPOS Móvil — Acceso a Yaxo desde cualquier pantalla.
//
// ===========================================================================
// UN SOLO COMPONENTE PARA TODAS LAS PANTALLAS
// ===========================================================================
// Se pega en la cabecera de Inicio, Vender, Inventario, Reportes o Dinero, y
// cada una le pasa de dónde viene. Yaxo abre con las preguntas de ESA pantalla
// primero, sin esconder el resto.
//
//   <BotonYaxo desde="inventario" />
//
// POR QUÉ SIEMPRE EN EL MISMO SITIO
// Si el acceso salta de esquina según la pantalla, deja de ser un gesto y pasa
// a ser algo que hay que buscar. La memoria muscular es el activo más valioso
// en un aparato que se toca cientos de veces al día — el mismo motivo por el
// que las herramientas ancladas no se reordenan solas.
//
// ===========================================================================
// EL PUNTO: PUEDE AVISAR SIN INTERRUMPIR
// ===========================================================================
// Con `aviso`, Yaxo lleva un punto encima. Es la forma de que tenga algo que
// decir sin abrir nada ni tapar la pantalla: el usuario lo ve de reojo y entra
// cuando puede. Es lo que hace que "nunca interrumpe una venta" sea verdad y no
// una frase bonita.
//
// EL AVISO LO CALCULA ESTE COMPONENTE, NO QUIEN LO COLOCA
// Antes era una prop que cada pantalla tenía que decidir. Eso significaba que
// Inicio podía encenderlo e Inventario no, con el mismo negocio y el mismo
// día, y nadie lo notaría hasta ver las dos pantallas seguidas. Al calcularlo
// aquí, el punto dice lo mismo en toda la app por construcción.
//
// `hayAvisoYaxo()` (indicadores.ts) ya trae las reglas: solo alertas reales
// medidas con los umbrales que puso el dueño, y se apaga el resto del día en
// cuanto abre Yaxo. Aquí solo se pregunta.
//
// Se comprueba al RECUPERAR EL FOCO, no una vez al montar: las pantallas de
// pestañas quedan montadas, así que con un useEffect normal el punto se
// quedaría como estaba desde que se abrió la app.
//
// Si la comprobación falla (base ocupada, lo que sea), no hay punto. Un
// asistente que no puede leer no tiene nada que avisar, y reventar la cabecera
// de Vender por un badge sería absurdo.
//
// La prop `aviso` sigue existiendo como ANULACIÓN manual, para casos puntuales
// y para las pruebas. Sin ella, manda lo que diga la comprobación.

import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { hayAvisoYaxo } from "@/src/base/indicadores";
import { useTema } from "@/src/componentes/TemaProvider";
import Yaxo, { EstadoYaxo } from "@/src/componentes/Yaxo";
import type { OrigenYaxo } from "@/app/yaxo";

export default function BotonYaxo({
  desde,
  aviso,
  estado,
  size = 34,
  antesDeAbrir,
}: {
  desde: OrigenYaxo;
  /** Anulación manual del punto. Sin pasarla, se calcula solo. */
  aviso?: boolean;
  /** Cara en reposo. Sin pasarla, pone "alerta" cuando hay punto. */
  estado?: EstadoYaxo;
  size?: number;
  /** Se ejecuta justo ANTES de navegar a Yaxo.
   *
   *  Existe por el modal de Dinero. Un `<Modal>` de React Native se dibuja en
   *  una ventana nativa POR ENCIMA de toda la vista raíz, y `router.push`
   *  navega DENTRO de esa vista raíz: sin cerrar el modal primero, la pantalla
   *  de Yaxo se cargaría debajo y el usuario vería que no pasa nada, para
   *  encontrársela abierta al cerrar Dinero.
   *
   *  Quien lo use pasa aquí su `onCerrar`. */
  antesDeAbrir?: () => void;
}) {
  const { tema: T } = useTema();
  const [hayAviso, setHayAviso] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      hayAvisoYaxo()
        .then((v) => {
          if (vivo) setHayAviso(v);
        })
        .catch(() => {
          if (vivo) setHayAviso(false); // ante la duda, sin punto
        });
      return () => {
        vivo = false;
      };
    }, [])
  );

  const conAviso = aviso ?? hayAviso;
  // La cara acompaña al punto: si hay algo que revisar, Yaxo no está en
  // reposo. Es gratis y hace que el aviso se lea incluso sin fijarse en el
  // punto, que mide diez píxeles.
  const cara = estado ?? (conAviso ? "alerta" : "reposo");

  return (
    <Pressable
      onPress={() => {
        antesDeAbrir?.();
        router.push({ pathname: "/yaxo", params: { desde } });
      }}
      // hitSlop generoso: el dibujo es chico y esto se toca con el pulgar, de
      // pie, a veces con prisa.
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Preguntarle a Yaxo sobre tu negocio"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <View>
        <Yaxo estado={cara} size={size} />
        {conAviso ? (
          <View
            style={{
              position: "absolute",
              top: -1,
              right: -1,
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: T.acento,
              // Borde del color del fondo: separa el punto del dibujo sin
              // dibujar un aro. Sin esto se confunde con una branquia.
              borderWidth: 2,
              borderColor: T.fondo,
            }}
          />
        ) : null}
      </View>
    </Pressable>
  );
}
