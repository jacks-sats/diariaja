# E2E (Playwright)

Testes end-to-end do DiáriaJá. **Isolado** do app (tem seu próprio
`package.json`) pra não interferir no `npm ci` do CI principal.

## Rodar localmente

```bash
# 1) na RAIZ do repo, gere o build (os testes rodam contra o dist/):
npm run build

# 2) aqui em e2e/, instale e rode:
cd e2e
npm install
npx playwright install --with-deps chromium
npm test            # roda os smoke tests (desktop + mobile)
npm run report      # abre o relatório HTML
```

O `playwright.config.ts` sobe o `vite preview` (porta 4173) automaticamente
servindo o `dist/` já buildado.

## O que tem hoje

`tests/smoke.spec.ts` — saúde do boot (anônimo, sem backend):
- carrega sem "tela branca" e mostra a marca;
- nenhuma exceção fatal no boot.

## Próximos passos (fase 2)

Fluxos críticos (cadastro, login, anúncio→candidatura→chat, check-in) precisam
de um **Supabase de teste com dados semeados** (ou mocks de rede) pra não tocar
produção. Ver os TODOs em `tests/smoke.spec.ts`.

## CI

`.github/workflows/e2e.yml` roda os smoke em cada PR (não-bloqueante por ora).
Vira gate obrigatório quando a suíte amadurecer.
