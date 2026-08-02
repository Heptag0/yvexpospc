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

/** Abre cámara o galería (cuadrada, comprimida). Devuelve uri temporal o null. */
export async function elegirImagen(
  desde: "camara" | "galeria"
): Promise<string | null> {
  const opciones: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.6,
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

/** Borra una imagen persistida (solo si es nuestra). Nunca lanza. */
export async function borrarImagen(uri: string | null): Promise<void> {
  if (!uri || !uri.startsWith(CARPETA)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
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