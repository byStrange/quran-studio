import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Tauri expects a fixed port and surfaces Rust errors on its own, so we keep
// Vite quiet and non-negotiable about where it listens.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // The Rust crate has its own rebuild loop.
      ignored: ["**/src-tauri/**"],
    },
  },
  // Only VITE_-prefixed vars reach the client. Service-role and AI keys are
  // deliberately unprefixed so they can never be inlined here.
  envPrefix: ["VITE_"],
  build: {
    target: "esnext",
    sourcemap: false,
  },
});
