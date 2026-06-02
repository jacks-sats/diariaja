import { test, expect } from "@playwright/test";

// Smoke de saúde do boot. Pega a classe de bug "tela branca pós-deploy"
// (bundle quebrado / erro no mount) — que o service worker tenta mitigar.
// Roda anônimo (sem login), então não depende de backend/fixtures.

test.describe("Boot / saúde da aplicação", () => {
  test("carrega sem tela branca e mostra a marca", async ({ page }) => {
    await page.goto("/");
    // O #root precisa ter conteúdo renderizado (regressão de tela branca).
    await expect(page.locator("#root")).not.toBeEmpty();
    // A marca aparece em algum lugar (splash / landing / login).
    await expect(page.locator("body")).toContainText(/Diária/i, { timeout: 15_000 });
  });

  test("sem exceção fatal no boot", async ({ page }) => {
    const benignos = [/ResizeObserver/i, /AbortError/i, /NetworkError/i, /Load failed/i, /Failed to fetch/i];
    const erros: string[] = [];
    page.on("pageerror", (e) => {
      if (!benignos.some((r) => r.test(e.message))) erros.push(e.message);
    });
    await page.goto("/");
    await page.waitForTimeout(1_500);
    expect(erros, `Exceções não tratadas no boot: ${erros.join(" | ")}`).toHaveLength(0);
  });
});

// ── TODO: fluxos críticos (fase 2 do E2E) ───────────────────────────────────
// Precisam de um Supabase de teste com dados semeados (ou mocks de rede), pra
// não tocar produção. Quando tiver, marcar como testes reais:
//   • cadastro diarista (wizard 4 passos) e cadastro empresa (CNPJ)
//   • login por e-mail e por CPF/CNPJ
//   • criar anúncio → candidatura → chat liberado (R$1 / convite)
//   • check-in por QR + avaliação obrigatória
// test.fixme(true, "requer Supabase de teste com fixtures");
