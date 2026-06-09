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
      // Fixa o canal que o app escuta. Sem isto, o app só recebe OTA se o
      // aparelho estiver no canal "default" do painel Capgo — e os uploads do
      // CI vão pro canal "production" (.github/workflows/ota-capgo.yml). Se os
      // dois não batem, o OTA NUNCA chega e o app fica preso no bundle do AAB.
      // (Só passa a valer num AAB novo — é config nativa.)
      defaultChannel: "production",
      resetWhenUpdate: true,
      directUpdate: false,
    },
  },
};

export default config;
