import { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.diariaja.app",
  appName: "DiáriaJá",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  plugins: {
    // Capgo — Live Updates (OTA). Atualiza o conteúdo web (JS/HTML/CSS) pela
    // internet sem novo AAB nem revisão do Google. autoUpdate baixa e aplica o
    // bundle mais novo na abertura; resetWhenUpdate volta ao bundle embarcado se
    // o app for atualizado pela Play (evita servir OTA antigo sobre versão nova).
    // O app DEVE chamar CapacitorUpdater.notifyAppReady() ao iniciar (ver
    // src/main.tsx) — sem isso o Capgo faz rollback achando que o bundle quebrou.
    CapacitorUpdater: {
      autoUpdate: true,
      resetWhenUpdate: true,
      directUpdate: false,
    },
  },
};

export default config;
