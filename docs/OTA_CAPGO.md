# Live Updates (OTA) com Capgo — DiáriaJá

Atualiza o **conteúdo web** (JS/HTML/CSS) do app Android **pela internet**, sem
gerar novo AAB nem esperar a revisão do Google. Você muda na web → o app baixa a
atualização sozinho na próxima abertura.

> ⚠️ **Vale só pra mudanças de conteúdo web.** Mudança **nativa** (nova permissão,
> novo plugin, troca de ícone, versionCode) **ainda exige um novo AAB**.

---

## Como funciona

1. O plugin `@capgo/capacitor-updater` vem embarcado no app (no AAB).
2. Ao abrir, o app pergunta ao Capgo se existe um bundle mais novo no canal
   `production`. Se existir, baixa e aplica (delta — só os arquivos mudados).
3. O app chama `CapacitorUpdater.notifyAppReady()` (em `src/main.tsx`) avisando
   que subiu OK. Sem isso o Capgo faz **rollback** pro bundle anterior.
4. Config em `capacitor.config.ts` → `plugins.CapacitorUpdater`
   (`autoUpdate: true`, `resetWhenUpdate: true`).

Pipeline automático: **push na `main`** → Vercel publica a web **e** o workflow
`.github/workflows/ota-capgo.yml` sobe o bundle OTA pro Capgo.

---

## Setup (uma vez só)

### 1. Criar conta e app no Capgo
```bash
# na sua máquina, na raiz do projeto
npx @capgo/cli@7 login        # abre o navegador / pede o token da sua conta Capgo
npx @capgo/cli@7 init         # registra o app (appId com.diariaja.app) e o canal
```
Crie a conta em https://capgo.app (tem plano gratuito pra começar).

### 2. Guardar o token no GitHub (liga o automático)
No Capgo: **Account → API Keys** → copie uma key do tipo *all* (ou *upload*).
No GitHub: **Settings → Secrets and variables → Actions → New repository secret**
- Nome: `CAPGO_TOKEN`
- Valor: a key do Capgo

A partir daí, todo push na `main` que mexa em conteúdo web sobe um OTA sozinho.
(Enquanto o secret não existir, o workflow roda e **pula** o upload — fica verde.)

### 3. Gerar UM novo AAB com o plugin embarcado
O plugin precisa entrar no app uma vez. Depois disso, as próximas mudanças web
não precisam de AAB.
```bash
npm install
npm run build
npx cap sync android
export DIARIAJA_VERSION_CODE=2      # bumpar! (próximo > o já enviado)
export DIARIAJA_VERSION_NAME=1.0.1
npx cap open android                # Android Studio → Generate Signed Bundle → release
```
Suba esse AAB na Play Console (faixa de teste fechado).

### 4. Validar no aparelho ⚠️
Depois que os testadores instalarem esse AAB novo:
1. Faça uma mudança web pequena, dê push na `main`.
2. Confirme no painel do Capgo que o bundle subiu.
3. Feche e reabra o app no celular → a mudança deve aparecer **sem** atualizar
   pela Play.

---

## Upload manual (sem CI)
```bash
npm run capgo:upload          # build + sobe pro canal production
```

---

## Pontos de atenção (validar no 1º teste real)

- **Service Worker:** o app tem `public/sw.js` (cache de `/assets/`). Em teoria o
  Capgo serve o bundle novo, mas há risco de o SW servir asset velho do cache.
  Se uma atualização OTA não "pegar", a causa provável é cache do SW — a solução
  é o SW limpar cache quando detecta bundle novo (o `index.html` já tem
  auto-recuperação que desregistra o SW se um script falhar). Validar em campo.
- **`notifyAppReady`:** se sumir do `main.tsx`, toda atualização sofre rollback.
- **Canal:** o app escuta `production`. Dá pra criar canal `beta` pra testar OTA
  só em aparelhos marcados antes de soltar pra todos.
- **Mudança nativa ≠ OTA:** plugin novo / permissão / versionCode = AAB novo.
