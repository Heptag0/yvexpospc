// YvexPOS Móvil — Imágenes de producto (cámara / galería).
//
// El picker devuelve una uri TEMPORAL; hay que copiarla a la carpeta
// persistente de la app o se pierde. Aquí vive ese ciclo completo:
// elegir -> persistir -> (reemplazar/borrar).

import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { uuid } from "./db";

const CARPETA = FileSystem.documentDirectory + "productos/";

async function asegurarCarpeta(): Promise<void> {
  await FileSystem.makeDirectoryAsync(CARPETA, { intermediates: true }).catch(
    () => {}
  );
}

/** Abre cámara o galería. Ya NO recorta aquí (antes usaba allowsEditing +
 *  aspect [1,1], que es un recorte DESTRUCTIVO del picker nativo — el
 *  sistema operativo lo aplica antes de que la app vea la foto, y lo que
 *  queda fuera del recuadro se pierde para siempre). Ahora se pide la foto
 *  completa y el encuadre a cuadro se hace después, en RecortadorFoto.tsx,
 *  donde el tendero puede mover y acercar/alejar con libertad. Devuelve
 *  uri temporal o null. */
export async function elegirImagen(
  desde: "camara" | "galeria"
): Promise<string | null> {
  const opciones: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    quality: 0.8,
  };
  let res: ImagePicker.ImagePickerResult;
  if (desde === "camara") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error("Sin permiso de cámara. Actívalo en ajustes del teléfono.");
    res = await ImagePicker.launchCameraAsync(opciones);
  } else {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new Error("Sin permiso de galería. Actívalo en ajustes del teléfono.");
    res = await ImagePicker.launchImageLibraryAsync(opciones);
  }
  if (res.canceled || !res.assets?.length) return null;
  return res.assets[0].uri;
}

/** Copia la imagen temporal a la carpeta persistente. Devuelve la uri final. */
export async function persistirImagen(uriTemporal: string): Promise<string> {
  await asegurarCarpeta();
  const destino = CARPETA + uuid() + ".jpg";
  await FileSystem.copyAsync({ from: uriTemporal, to: destino });
  return destino;
}

// --- Foto original + su recorte -------------------------------------------
// En `productos.imagen_uri` solo cabe UNA ruta, pero para poder RE-AJUSTAR
// el encuadre después hace falta conservar la foto completa (si solo se
// guarda el recorte, lo que quedó fuera se perdió y "Ajustar" solo puede
// moverse dentro del recorte — que era justo el bug). Solución sin tocar la
// base de datos: la original vive junto al recorte con el sufijo "-orig".
//   recorte:  .../productos/abc123.jpg
//   original: .../productos/abc123-orig.jpg

function rutaOriginalDe(uriRecorte: string): string {
  return uriRecorte.replace(/\.jpg$/i, "-orig.jpg").replace(/\.png$/i, "-orig.jpg");
}

/** Persiste el recorte Y la foto completa de la que salió, emparejados.
 *  Devuelve la uri del RECORTE (la que se guarda en el producto). */
export async function persistirRecorteConOriginal(
  uriRecorteTemporal: string,
  uriOriginalTemporal: string
): Promise<string> {
  await asegurarCarpeta();
  const destino = CARPETA + uuid() + ".jpg";
  await FileSystem.copyAsync({ from: uriRecorteTemporal, to: destino });
  // La original es un extra: si falla, el producto igual se queda con su
  // foto; solo se pierde la posibilidad de reajustar sin volver a tomarla.
  await FileSystem.copyAsync({
    from: uriOriginalTemporal,
    to: rutaOriginalDe(destino),
  }).catch(() => {});
  return destino;
}

/** La foto completa de la que salió este recorte, si se conserva. Devuelve
 *  null para fotos viejas (guardadas antes de que existiera el reajuste) o
 *  si el archivo ya no está. */
export async function originalDe(uriRecorte: string | null): Promise<string | null> {
  if (!uriRecorte || !uriRecorte.startsWith(CARPETA)) return null;
  const ruta = rutaOriginalDe(uriRecorte);
  try {
    const info = await FileSystem.getInfoAsync(ruta);
    return info.exists ? ruta : null;
  } catch {
    return null;
  }
}

/** Borra una imagen persistida (solo si es nuestra) Y su original
 *  emparejada, si existe. Nunca lanza. */
export async function borrarImagen(uri: string | null): Promise<void> {
  if (!uri || !uri.startsWith(CARPETA)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  await FileSystem.deleteAsync(rutaOriginalDe(uri), { idempotent: true }).catch(
    () => {}
  );
}

import { estadoCuenta } from "./nube";

// Mismo servidor que usa el resto de la app (nube.ts, sync.ts).
const BASE = "https://pos.yvexiq.com";

/** Descarga una imagen de internet a la carpeta persistente de la app.
 *  Devuelve la uri local, lista para guardarse en `imagen_uri`. */
export async function descargarImagen(url: string): Promise<string> {
  await asegurarCarpeta();
  const destino = CARPETA + uuid() + ".jpg";
  const r = await FileSystem.downloadAsync(url, destino);
  if (r.status !== 200) throw new Error("No se pudo descargar la imagen.");
  return r.uri;
}

// ---------------------------------------------------------------------------
// Quitar el fondo (en el servidor)
// ---------------------------------------------------------------------------
// Corre en TU servidor, no en el teléfono: mejor calidad que un modelo
// recortado para caber en un celular, sin costo por imagen, la app no engorda
// y sirve igual para el PC. A cambio, esta acción sí necesita internet — lo
// cual es aceptable porque se hace al dar de alta un producto, no al cobrar.

export type ResultadoRecorte =
  | { ok: true; uri: string }
  | { ok: false; motivo: string };

/** ¿Está disponible el recorte? Se consulta ANTES de mostrar el botón, para
 *  no ofrecer algo que va a fallar. */
export async function recorteDisponible(): Promise<boolean> {
  try {
    const cuenta = await estadoCuenta();
    if (!cuenta.vinculado || !cuenta.dispositivoToken) return false;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`${BASE}/fotos/estado`, {
      headers: {
        "X-Dispositivo-Id": cuenta.dispositivoId ?? "",
        "X-Dispositivo-Token": cuenta.dispositivoToken ?? "",
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return false;
    const j = await r.json();
    return !!j?.disponible;
  } catch {
    return false;
  }
}

/** Manda la foto al servidor y guarda el PNG recortado como archivo NUEVO.
 *  No borra el original: si al usuario no le gusta el recorte, puede volver. */
export async function quitarFondo(uriLocal: string): Promise<ResultadoRecorte> {
  const cuenta = await estadoCuenta();
  if (!cuenta.vinculado || !cuenta.dispositivoToken) {
    return { ok: false, motivo: "Necesitas tu cuenta vinculada para quitar el fondo." };
  }
  try {
    await asegurarCarpeta();
    const destino = CARPETA + uuid() + ".png";

    // Se pide en base64 a propósito: uploadAsync entrega la respuesta como
    // texto, y un PNG binario leído como texto se corrompe.
    const resp = await FileSystem.uploadAsync(
      `${BASE}/fotos/quitar-fondo?formato=base64`,
      uriLocal,
      {
        httpMethod: "POST",
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: "archivo",
        mimeType: "image/jpeg",
        headers: {
          "X-Dispositivo-Id": cuenta.dispositivoId ?? "",
          "X-Dispositivo-Token": cuenta.dispositivoToken ?? "",
        },
      }
    );

    if (resp.status === 503) {
      return { ok: false, motivo: "El recorte no está instalado en tu servidor todavía." };
    }
    if (resp.status !== 200) {
      return { ok: false, motivo: "No se pudo quitar el fondo. Intenta de nuevo." };
    }

    await FileSystem.writeAsStringAsync(destino, resp.body, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { ok: true, uri: destino };
  } catch {
    return { ok: false, motivo: "No se pudo conectar. Revisa tu internet." };
  }
}