# Checklist de Publicação — DiáriaJá (Google Play Store)

> Gerado a partir da auditoria de pré-lançamento (2026-05-31). Marque conforme for fazendo.

## 🩺 Resumo da auditoria

| Frente | Veredito |
|---|---|
| Segurança / RLS / PII | ✅ Liberado |
| Vazamento de contato (modelo R$1) | ✅ Protegido (gate server-side) |
| Pagamentos (Mercado Pago) | ✅ Após fix de refund (feito) |
| Requisitos técnicos Play Store | ✅ Pronto |

---

## 1. Correções de código (feitas neste ciclo)

- [x] **Refund revoga acesso** (crítico): estorno/chargeback do R$1 remove o desbloqueio; estorno do plano avulso volta pra grátis. (`mp-webhook`)
- [x] **Endereço não trafega no feed** de vagas abertas (defesa em profundidade).
- [x] **`create-payment` removido** (código morto da intermediação antiga).

### ⚠️ Deploy necessário no Supabase (você)
- [ ] Redeploy do webhook com o fix de refund:
  ```
  npx supabase@latest functions deploy mp-webhook
  ```
- [ ] (Recomendado) Testar refund no **MP Sandbox**: pagar R$1 → estornar → confirmar que o contato volta a exigir pagamento e o plano cai pra grátis.

---

## 2. Pendência pós-lançamento (não bloqueia, mas faça)

- [ ] **Blindar `endereco` no banco (column-level)**: hoje a regra de esconder o endereço completo é no app + o feed não traz a coluna. Para blindar 100% contra leitura via API direta, migrar leituras de `diarias` para uma RPC que omita `endereco` enquanto a vaga está `aberta`/`pendente` (mesmo padrão do `meu_perfil` para PII). Risco atual: BAIXO. Exige teste dedicado — não fazer às pressas.

---

## 3. Secrets no Supabase (conferir que estão setados)

- [ ] `SUPABASE_SERVICE_ROLE_KEY` (auto)
- [ ] `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`
- [ ] `MP_SUBSCRIPTION_TOKEN` (se usar assinatura recorrente)
- [ ] `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- [ ] `INTERNAL_PUSH_SECRET` (lembrete de diárias)
- [ ] `GROQ_API_KEY` (chatbot de suporte)
- [ ] `APP_URL`

Conferir: `npx supabase@latest secrets list`

---

## 4. Build Android (release)

- [ ] Gerar keystore (uma vez) e **guardar com segurança** (NÃO commitar):
  ```
  keytool -genkey -v -keystore diariaja-release.keystore -keyalg RSA -keysize 2048 -validity 10000 -alias diariaja
  ```
- [ ] Definir `versionCode` (inteiro crescente) e `versionName` (ex.: `1.0.0`).
- [ ] Build:
  ```
  npm run build
  npx cap sync android
  # abrir android/ no Android Studio → Build → Generate Signed Bundle (AAB)
  ```
- [ ] Testar o APK/AAB num aparelho real: login Google, permissões (câmera/localização), push, envio de documento.

---

## 5. Google Play Console

- [ ] **Política de privacidade** (URL): `https://diariaja.vercel.app/politica-privacidade.html`
- [ ] **Exclusão de conta** (URL): `https://diariaja.vercel.app/excluir-conta.html`
- [ ] **Suporte**: `suporte@diariaja.com.br`
- [ ] **Ícone** 512×512 + **feature graphic** 1024×500
- [ ] **Screenshots** (mín. 2 — telefone)
- [ ] **Descrição** curta (≤80) + completa
- [ ] **Categoria**: Negócios
- [ ] **Content rating**: questionário IARC (provável 18+ por exigir CPF/CNPJ)
- [ ] **Data Safety** — declarar:
  - Coleta: nome, e-mail, **CPF/CNPJ**, telefone, **localização (aproximada)**, **fotos/documento (RG/CNH)**, mensagens, histórico de uso.
  - Uso: autenticação, conexão entre usuários, pagamentos.
  - Compartilhamento: Supabase (infra) e Mercado Pago (pagamentos).
  - Segurança: criptografia em trânsito (HTTPS); usuário pode excluir a conta.
  - **Documento (KYC) é opcional** — só para selo de confiança.

---

## 6. Sanidade final antes de enviar

- [ ] `npm run verify` (tsc + testes + build) passando.
- [ ] Os 3 SQLs de presença + crédito interno já aplicados (✅ feito).
- [ ] Cron de lembrete ativo (✅ feito).
- [ ] Smoke test em produção: cadastro Google → criar diária → candidatar → confirmar → check-in → encerrar.
