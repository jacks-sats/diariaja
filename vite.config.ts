import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// Versão do app (usada como `release` no Sentry) — lida do package.json em build time.
const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    rollupOptions: {
      output: {
        // Separa vendor libs pesadas do bundle principal
        manualChunks(id) {
          if (id.includes("node_modules")) {
            // Supabase em chunk separado (~120 KB)
            if (id.includes("@supabase")) return "supabase";
            // QR Codes: separa o leitor (html5-qrcode, pesado) do gerador
            // (qrcode.react, leve) — ambos já são lazy-loaded no app
            if (id.includes("html5-qrcode")) return "qr-reader";
            if (id.includes("qrcode")) return "qr-gen";
            // Ícones Lucide em chunk próprio (tree-shaken)
            if (id.includes("lucide-react")) return "icons";
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
