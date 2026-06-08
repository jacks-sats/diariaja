# Login Google NATIVO no app Android

O Google **bloqueia** login OAuth dentro de WebView (política dele). Por isso o
botão "Entrar com Google" no app abria o navegador. A solução é login **nativo**
(Credential Manager do Android) via `@capgo/capacitor-social-login`, que devolve
um `idToken` trocado por sessão no Supabase (`signInWithIdToken`).

> Já está tudo no código (`src/App.tsx` → `handleGoogleLogin`). Fica **inerte**
> (cai no fluxo web atual) até a env `VITE_GOOGLE_WEB_CLIENT_ID` existir e o app
> rodar em plataforma nativa. **Nada muda hoje** até concluir os passos abaixo.

## Visão geral (ordem)

1. Google Cloud: ter um **Web Client ID** (provável já existir, do login web).
2. Google Cloud: criar um **Android OAuth Client** com o **package** + **SHA-1**.
3. Supabase: autorizar o Web Client ID no provider Google.
4. Definir a env **`VITE_GOOGLE_WEB_CLIENT_ID`** (Vercel + `.env.local`).
5. Gerar **novo AAB** (junto com o do OTA — um build só).

## 1. Web Client ID (sem keystore)

Google Cloud Console → **APIs e Serviços → Credenciais**. Procure um
**OAuth 2.0 Client ID** do tipo **Aplicativo da Web** (criado quando você ligou o
login Google na web). Copie o **Client ID** (termina em `...apps.googleusercontent.com`).
Se não existir, crie um novo do tipo "Aplicativo da Web".

## 2. Android OAuth Client (PRECISA do SHA-1 — em casa)

Google Cloud → Credenciais → **Criar credenciais → ID do cliente OAuth →
Android**. Preencha:
- **Nome do pacote:** `com.diariaja.app`
- **SHA-1:** o do app instalado. ⚠️ Como você usa **Play App Signing**, registre
  os DOIS:
  - SHA-1 do **Play App Signing** (Play Console → **Integridade do app** →
    "Certificado de assinatura do app" → copie o SHA-1) — vale na Play.
  - SHA-1 do **upload key** (do seu keystore):
    ```bash
    keytool -list -v -keystore CAMINHO_DO_SEU.jks -alias SEU_ALIAS
    ```
    (vale pros testes do build local)

Pode ter mais de um Android client (um por SHA-1) no mesmo projeto.

## 3. Supabase

Dashboard → **Authentication → Providers → Google** → no campo
**"Authorized Client IDs"** (ou similar), adicione o **Web Client ID** do passo 1.
Isso faz o Supabase aceitar o `idToken` que o app envia.

## 4. Env var

- **Vercel:** Project → Settings → Environment Variables → `VITE_GOOGLE_WEB_CLIENT_ID` = o Web Client ID.
- **Local (`.env.local`):** `VITE_GOOGLE_WEB_CLIENT_ID=...apps.googleusercontent.com`

## 5. Novo AAB

Gere o AAB normalmente (junto com o do OTA — um build só leva tudo):
```bash
npm install
npm run build
npx cap sync android
# bumpar versionCode, gerar AAB assinado no Android Studio, subir na Play
```

## Como testar

No app (com o AAB novo instalado) → "Entrar com Google" deve abrir o seletor de
conta **nativo** do Android (não o navegador) e entrar direto.

## Erros comuns

- **"auth 10" / resposta em branco:** SHA-1 não bate. Confirme o SHA-1 do build
  exato instalado (Play App Signing para builds da Play).
- **Supabase rejeita o token:** Web Client ID não está autorizado no provider
  Google do Supabase (passo 3), ou a env tem um client id diferente.
- **Abre o navegador mesmo assim:** `VITE_GOOGLE_WEB_CLIENT_ID` não chegou no
  build (rebuild após setar a env).
- **Falha sempre com o erro genérico ("Não foi possível entrar com o Google no
  app...")**: não passe `scopes` em `SocialLogin.login`. Na versão 6.0.1 do
  plugin, qualquer `scopes` exige a `ModifiedMainActivityForSocialLoginPlugin`;
  com a `MainActivity` padrão o plugin **rejeita** o login. Os escopos
  email/profile/openid já entram por padrão (suficiente pro `signInWithIdToken`).
