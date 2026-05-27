# 🛡️ Política de Segurança — DiáriaJá

**Última revisão:** 2026-05-27
**Responsável:** Jackson dos Santos da Silva
**Contato segurança:** suporte@diariaja.com.br
**Escopo:** todo o stack — web (Vercel), banco (Supabase), Edge Functions (Deno), app Android (Capacitor).

---

## 1. Visão geral da postura de segurança

O DiáriaJá adota **defense in depth**: as camadas se validam mutuamente, e a falha de uma não compromete o sistema todo.

- **Frontend** valida UX (não confia no usuário).
- **Edge Functions** validam autenticação e autorização (JWT obrigatório nas funções privadas).
- **Postgres + RLS** é a fonte da verdade de autorização. Funções `SECURITY DEFINER` para operações que precisam de elevação controlada.
- **Triggers** protegem colunas privilegiadas (`is_admin`, `plano_ativo`, `mp_*`, `telefone_verificado`, `documento_status`, `antecedentes_status`) contra alteração via REST.

---

## 2. Autenticação

- Provedor: Supabase Auth.
- Métodos: e-mail+senha, CPF/CNPJ+senha, Google OAuth.
- Sessão: JWT com refresh via cookies do Supabase (`flowType: "implicit"` — deliberado, NÃO trocar para PKCE — quebra confirmação de e-mail no Android).
- Verificação de telefone: SMS OTP via RPC `confirmar_telefone_verificado` (SECURITY DEFINER).
- Senha: mínimo 10 caracteres com letras e números (`validarSenha` em `helpers.ts:378`). Bcrypt server-side.

---

## 3. Autorização (RLS)

Todas as tabelas de usuário têm Row-Level Security habilitada. Padrão:

| Tabela | Leitura | Escrita |
|---|---|---|
| `user_profiles` | dono OU `is_admin` | dono (colunas restritas via trigger) |
| `diarias` | público | dono (empregador) |
| `candidaturas` | empregador da diária OU diarista da candidatura | diarista (insere própria); empregador (atualiza status) |
| `convites` | partes envolvidas | empregador (cria); diarista (atualiza status — ⚠️ ver IMP-S3) |
| `mensagens` | partes da `diaria_id` | autor (insere própria) |
| `denuncias` | denunciante OU admin | denunciante (insere) |
| `contatos_desbloqueios` | dono | só `service_role` (via webhook MP) |
| `kyc_documentos` (no campo `documento_*` em user_profiles) | dono OU admin | dono (envia); admin via RPC |
| `antecedentes_*` (em user_profiles) | dono OU admin | dono (envia); admin via RPC |
| `assinaturas` | dono | só `service_role` (webhook MP) |

---

## 4. Pagamentos

- **Diária em si**: **NÃO transita pela plataforma**. PIX direto entre contratante e diarista. Recibo digital é prova bilateral, não fiscal.
- **R$1 unlock de seleção**: via Mercado Pago Checkout Pro. Webhook MP (`mp-webhook`) valida HMAC SHA-256 (`MP_WEBHOOK_SECRET`), tem janela de timestamp (±5min), idempotência via `webhook_eventos_processados.mp_request_id UNIQUE`.
- **Assinaturas**: Mercado Pago Preapproval. Mudança de plano só via webhook, nunca pelo cliente (trigger `protect_user_profile_privileged_columns` bloqueia).

---

## 5. Headers HTTP de segurança (vercel.json)

| Header | Valor | Status |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | ✅ |
| `X-Content-Type-Options` | `nosniff` | ✅ |
| `X-Frame-Options` | `DENY` | ✅ |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | ✅ |
| `Permissions-Policy` | `camera=(self), geolocation=(self), microphone=(), payment=(self)` | ✅ |
| `Content-Security-Policy` | restrito por origem | ⚠️ usa `'unsafe-inline'` em script-src (3 scripts inline em `index.html`). Fechar exige extrair pra arquivos externos — pendente. |

---

## 6. Storage (Supabase Buckets)

| Bucket | Público? | MIME allowlist | Tamanho | RLS |
|---|---|---|---|---|
| `avatars` | leitura pública (URL direta) | imagens | 5MB | dono escreve no próprio prefixo |
| `documentos` (RG/CNH) | privado | imagens + PDF | 5MB | dono escreve; dono/admin lê via signed URL 5min |
| `antecedentes` (certidão) | privado | PDF + imagens | 5MB | mesma do `documentos` |

---

## 7. Logs / observabilidade

- Eventos de uso: tabela `analytics_eventos`. Falhas são silenciadas (nunca devem quebrar UX).
- Erros de Edge Function: `console.error` aparece nos logs do Supabase (retenção ~7 dias no plano Free).
- ⚠️ **Pendente**: vários `console.error` logam `userId` e `mp_payment_id` brutos. Pseudonimizar antes de scaling.
- Sem Sentry, sem terceiros de monitoring (escolha deliberada — privacidade).

---

## 8. Hardening pendente (priorizado)

| # | Item | Esforço | Risco se não resolver |
|---|---|---|---|
| 1 | Remover `'unsafe-inline'` de CSP script-src | 2h | XSS persistente via comentários |
| 2 | Rate-limit em `ai-support`, `create-payment`, `create-contact-payment`, `send-push`, `lookup-by-cpf` | 4h | Abuso de cota Groq + MP, enumeração CPF |
| 3 | IMP-S3: `REVOKE UPDATE (valor, data_servico...) FROM authenticated ON convites` | 1h | Fraude de valor R$100→R$10k |
| 4 | Timing oracle em `lookup-by-cpf` | 1h | Enumeração de CPF cadastrado |
| 5 | Pseudonimizar IDs em logs de Edge Functions | 1h | Vazamento via dump de logs |
| 6 | Bloqueio de usuário (tabela `usuarios_bloqueados` + filtros) | 4h | Risco UGC nas app stores |
| 7 | Denúncia em chat + comunidade | 3h | Risco UGC nas app stores |

---

## 9. Reportar vulnerabilidade

Encontrou problema? **NÃO abra issue público**. Mande pra `suporte@diariaja.com.br` com:
- Descrição
- Passos pra reproduzir
- Impacto estimado
- (Opcional) sugestão de fix

Sem programa de bug bounty formal por ora. Crédito público com autorização.

---

## 10. Atualizando este documento

Após mudança relevante de stack/política:
1. Atualizar a tabela de RLS / headers / buckets.
2. Atualizar a seção "Hardening pendente" (mover concluídos pra histórico).
3. Bumpar a data no topo.
