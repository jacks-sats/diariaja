import { useEffect } from "react";

// BUG-C2 fix: QRScanner definido fora do App para não ser recriado a cada render
export function QRScannerComponent({ onResult, onError, onClose }: {
  onResult: (diariaId: string) => void;
  onError: (msg: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    let html5QrCode: any;
    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        html5QrCode = new Html5Qrcode("qr-reader");
        await html5QrCode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (result: string) => {
            html5QrCode.stop().catch(() => {});
            if (result.startsWith("DIARIAJA:")) {
              onResult(result.replace("DIARIAJA:", ""));
            } else {
              onError("QR Code inválido. Use o código gerado pelo prestador.");
            }
            onClose();
          },
          () => {}
        );
      } catch (e: any) {
        // PR-C: diferencia a causa em vez de uma mensagem genérica pra tudo.
        const nome = String(e?.name || e?.message || "");
        let msg = "Não foi possível abrir a câmera. Use o código de 4 dígitos abaixo.";
        if (/NotAllowedError|Permission/i.test(nome)) msg = "Permissão de câmera negada. Libere a câmera nas configurações do app, ou use o código de 4 dígitos.";
        else if (/NotFoundError|Devices/i.test(nome)) msg = "Nenhuma câmera encontrada. Use o código de 4 dígitos abaixo.";
        else if (/NotReadableError|TrackStart|in use/i.test(nome)) msg = "A câmera está em uso por outro app. Feche-o e tente, ou use o código de 4 dígitos.";
        onError(msg);
        onClose();
      }
    })();
    return () => { html5QrCode?.stop().catch(() => {}); };
  }, []);
  return <div id="qr-reader" style={{ width:"100%", borderRadius:12, overflow:"hidden" }} />;
}
