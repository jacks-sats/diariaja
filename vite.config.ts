import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Separa vendor libs pesadas do bundle principal
        manualChunks(id) {
          if (id.includes("node_modules")) {
            // Supabase em chunk separado (~120 KB)
            if (id.includes("@supabase")) return "supabase";
            // Leaflet (mapa) em chunk separado (~150 KB)
            if (id.includes("leaflet") || id.includes("react-leaflet")) return "leaflet";
            // QR Code em chunk separado
            if (id.includes("qrcode")) return "qrcode";
            // Restante de node_modules
            return "vendor";
          }
        },
      },
    },
    // Avisa quando chunks ficam grandes (>500 KB)
    chunkSizeWarningLimit: 500,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/helpers.ts", "src/constants.ts"],
    },
  },
});
