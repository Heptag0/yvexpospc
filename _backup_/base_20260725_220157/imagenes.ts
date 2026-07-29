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
