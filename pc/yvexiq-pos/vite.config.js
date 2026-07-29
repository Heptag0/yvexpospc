import { defineConfig } from "vite";

// Configuración de Vite para Tauri.
// Docs: https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  // Vite sirve desde la raíz del proyecto; index.html vive en la raíz.
  clearScreen: false, // no borrar los logs de Rust al recargar
  server: {
    port: 1420,
    strictPort: true, // si 1420 está ocupado, falla en vez de cambiar de puerto
    watch: {
      // No vigilar la carpeta de Rust; Cargo se encarga de ella.
      ignored: ["**/src-tauri/**"],
    },
  },
  // Salida del build de producción.
  build: {
    // Tauri usa Chromium/WebView2 en Windows; un target moderno está bien.
    target: "es2021",
    minify: process.env.TAURI_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_DEBUG,
    outDir: "dist",
  },
});
