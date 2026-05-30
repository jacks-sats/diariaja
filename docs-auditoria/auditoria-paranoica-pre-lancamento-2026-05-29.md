# Auditoria Total — Modo Paranoico / Pré-Lançamento (2026-05-29)

> Auditoria estática rigorosa de código + migrations + Edge Functions. **Não foi
> executado o app em navegador nem aplicadas correções** nesta fase. Onde a verdade
> depende de algo que **não está versionado no repositório** (RLS de base aplicada à
> mão no Dashboard Supabase), o item é **sinalizado como suspeito** em vez de assumido
> como correto.

Autor: auditoria assistida por IA. Escopo: `src/`, `supabase/functions/`,
`supabase/migrations/`.

---

## 📌 Progresso das correções (atualizado)

- **C2 (vazamento de PII) — PARCIAL (passo A feito):** o feed de prestadores e os
  perfis de candidatos não baixam mais `telefone`/`pix_chave`/`mp_access_token`
  (allowlist `COLUNAS_PERFIL_PUBLICO`). Falta o **passo B** (RPC de perfil público
  + RPC de contato ciente de pagamento + `REVOKE` de coluna) para fechar o valor de
  CPF/CNPJ, as leituras do prestador selecionado e o vetor anon-key. **Risco do B: alto.**
- **C3 (plano avulso não liberava) — CLIENTE feito, SQL pendente de aplicação:**
  `usePlan` agora honra `user_profiles.plano_ativo`+`plano_expira_em`.
  **AÇÃO MANUAL OBRIGATÓRIA:** aplicar `supabase/migrations/fix_c3_plano_avulso_no_gate.sql`
  no SQL Editor do Supabase — sem isso o anunciante que pagou via Pix continua sendo
  cobrado R$1 (o gate server-side não enxerga o plano).
- **C1 (bypass do paywall de seleção) — SQL pendente de aplicação:** trigger
  server-side `enforce_limite_selecao_candidato` revalida o limite no próprio
  `UPDATE diarias` (bloqueia a 4ª seleção sem pagar, mesmo via API/DevTools).
  Não exige mudança de cliente. **AÇÃO MANUAL OBRIGATÓRIA:** aplicar
  `supabase/migrations/fix_c1_enforce_selecao_candidato.sql` (depois do SQL do C3).
- **A4 (loading trava o app) — FEITO (completo):** os 14 handlers de loading agora
  em `try/finally` (saveProfile, revisarDocumento, enviarConvite, enviarDenuncia,
  criarTopico, criarComentario, enviarRespostaTicket, abrirPerfilCandidato,
  enviarFeedbackVagaExpirada, enviarFeedbackPosConclusao, enviarAvaliacaoEmpObrigatoria,
  carregarAdminStats, abrirDrillAdmin, useEffect perfil-empregador).
- **A3 (cancelamento derruba plano do outro papel) — feito (precisa redeploy do webhook):**
  o webhook só reverte `plano_ativo` para 'gratis' se não houver outra assinatura ativa
  nem plano avulso vigente.
- **M1 (logs de segredo/HMAC no webhook) — feito (precisa redeploy do webhook):**
  removidos os logs de DEBUG que expunham trechos do secret e o HMAC.
- **A5 (falso sucesso na exclusão LGPD) — feito:** só mostra "Conta excluída" se a
  Edge Function `delete-user` confirmar; senão orienta contato com o suporte.
- **A6 ("indicar amigos" fake) — feito:** virou "Compartilhar o app", sem promessa de
  recompensa inexistente.
- **B1 (log DEBUG em revisarDocumento) — feito** (removido junto do A4).
- **A1 (escalada a admin via INSERT) — CONFIRMADO no Dashboard; SQL pronto:** a
  policy de INSERT de `user_profiles` não trava `is_admin` e o trigger anti-escalada
  só pega UPDATE. Fix: `fix_a1_force_safe_defaults_insert.sql`. **APLICAR no Supabase.**
- **A2 (UPDATE amplo em `diarias`) — CONFIRMADO no Dashboard; SQL pronto:** policy
  `diarias_aceitar` deixa qualquer autenticado editar vaga aberta alheia. Fix:
  `fix_a2_remove_diarias_update_amplo.sql`. **APLICAR no Supabase.**
- Médios/baixos restantes — pendentes.

---

## ETAPA 1 — Mapeamento

**Stack:** React 18 + TS strict + Vite 5 (SPA, sem router — navegação por string
`tela`). Backend Supabase (Postgres + Auth `flowType: implicit` + Storage + 16 Edge
Functions Deno). Pagamentos Mercado Pago (CheckoutPro + Preapproval + Pix avulso).
Push Web Push/VAPID. IA Groq. Mobile Capacitor (Android). Hospedagem Vercel.

**Superfície de risco financeiro:** `create-payment`, `create-contact-payment`,
`create-subscription`, `create-plano-payment`, `mp-webhook`, `mp-oauth`.

**Estado:** monólito `App.tsx` de **17.162 linhas**, ~199 funções, 8+ canais Realtime
por usuário, ~73 `any`.

**⚠️ Achado estrutural transversal:** o **schema base** (`diarias`, `candidaturas`,
`user_profiles`) e suas **policies RLS de SELECT/UPDATE/INSERT NÃO estão em nenhuma
migration do repositório**. Foram criados manualmente no Dashboard. A fronteira de
segurança real do produto não é auditável nem versionada — o repo só tem fixes
incrementais que *comentam* as policies pré-existentes
(ex.: `fix_rls_diarista_confirmar.sql:14-16`).

---

## 🟥 CRÍTICOS

### C1 — Bypass total da monetização: seleção de candidato é gated só no cliente
- **Severidade:** crítico · **Categoria:** financeiro / pagamento / segurança
- **Arquivo/linha:** `src/App.tsx:3770-3774` (mutação real) vs `src/App.tsx:3911-3945`
  (gate); RPC `pode_selecionar_candidato` em `supabase/migrations/monetizacao_dual_track.sql:200-280`
- **Fluxo:** empregador seleciona diarista → libera chat/contato → cobrança R$1 / planos pagos
- **Descrição:** `pode_selecionar_candidato` é um **oráculo consultivo**. Quem executa
  a seleção é `executarSelecaoCandidato` via `UPDATE` direto em `diarias`. A policy
  `diarias_empregador (ALL)` permite escrita livre na própria diária; **não há trigger**
  verificando o limite, e **não há REVOKE de coluna** em `diarista_aceite_id`.
- **Reprodução:** empregador grátis que já usou as 3 seleções → DevTools →
  `supabase.from('diarias').update({status:'pendente',diarista_aceite_id:'<id>'}).eq('id','<minha_diaria>')`.
  A seleção passa, o chat abre, sem pagar R$1 nem ter plano.
- **Impacto:** monetização principal contornável por DevTools.
- **Correção:** RPC `SECURITY DEFINER` `selecionar_candidato(diaria_id, diarista_id)`
  que valida o gate na transação antes do UPDATE; **revogar UPDATE de `diarista_aceite_id`**
  do role `authenticated`.

### C2 — Telefone/WhatsApp/CPF de TODA a base vaza para o cliente sem pagamento
- **Severidade:** crítico · **Categoria:** segurança / jurídico (LGPD) / financeiro
- **Arquivo/linha:** `src/App.tsx:949-954` (`select("*")` em até 200 diaristas), também
  `:1016, :1545, :1570, :1828, :1851, :8802, :8822-8824`; REVOKE desativado em
  `supabase/migrations/_PENDENTES_SUPABASE.sql:218-235`
- **Descrição:** O app baixa perfis com `select("*")` trazendo `telefone`, `cpf`, `cnpj`
  em texto puro. A UI não renderiza, mas o dado já trafegou e está no state. O
  `REVOKE SELECT (...)` está comentado. Não há policy de SELECT por coluna versionada.
- **Reprodução:** logar como empregador → home → aba Network → resposta de
  `user_profiles` contém telefone/cpf/cnpj de todos os diaristas.
- **Impacto:** vazamento de dado pessoal de toda a base; o paywall é cosmético. Se a
  policy de SELECT do Dashboard for ampla, `mp_access_token` (bearer token financeiro)
  também é legível por qualquer conta autenticada.
- **Correção:** RPC `SECURITY DEFINER` que devolve só colunas públicas; telefone só via
  RPC que confirme linha paga em `contatos_desbloqueios`; **ativar o REVOKE de coluna**.

### C3 — Plano de 30 dias (Pix) confirma pagamento mas NÃO libera as features
- **Severidade:** crítico · **Categoria:** financeiro / pagamento / lógica
- **Arquivo/linha:** `src/App.tsx:433-435` (`plans = usePlan(assinaturas)`) vs
  `supabase/functions/mp-webhook/index.ts` (ramo `plano::` grava `user_profiles.plano_ativo`,
  **não** em `assinaturas`); gate `plano_ativo_role` lê só `assinaturas`
  (`monetizacao_dual_track.sql:120-145`)
- **Descrição:** Duas fontes de verdade desconectadas. `usePlan/usePermissions/useLimits`
  e `pode_selecionar_candidato` derivam só de `assinaturas`. O plano 30 dias grava em
  `user_profiles.plano_ativo` e nunca insere em `assinaturas`. Quem paga via Pix vê o
  selo "ativo" mas continua tratado como grátis (cobrado R$1, IA bloqueada, etc.).
- **Impacto:** pagamento aprovado sem liberar acesso → reembolso, chargeback, reclamação.
- **Correção:** unificar fonte da verdade (webhook do plano 30d faz upsert em `assinaturas`
  com `expira_em`, OU `usePlan`/`plano_ativo_role` consideram `plano_ativo`+`plano_expira_em`).

---

## 🟧 ALTOS

### A1 — Proteção anti-escalada de privilégio é só `BEFORE UPDATE`; INSERT não coberto
- `supabase/migrations/hotfix_protect_trigger_columns.sql:82-84`; upsert em
  `src/App.tsx:2080-2086` e `:2228`. O primeiro perfil é criado por INSERT, que o trigger
  não intercepta. A policy de INSERT de `user_profiles` (única defesa) não está no repo.
  Possível auto-grant de `is_admin` no primeiro login.
- **Correção:** trigger `BEFORE INSERT OR UPDATE` + versionar a policy de INSERT.

### A2 — Policy `diarias_aceitar (UPDATE) → qualquer autenticado atualiza vagas abertas`
- Descrita em `fix_rls_diarista_confirmar.sql:16` — definição não está no repo. Se o
  `WITH CHECK` não restringir, qualquer autenticado pode alterar diárias de terceiros.
  **A confirmar no Dashboard.**

### A3 — Cancelamento de assinatura derruba `plano_ativo` mesmo com outra ativa
- `supabase/functions/mp-webhook/index.ts` (ramo preapproval, `cancelado` →
  `plano_ativo='gratis'` incondicional). No dual-track derruba o outro papel ativo.

### A4 — `saveProfile` e `revisarDocumento` travam o app se a Promise rejeitar
- `src/App.tsx:2228→2229` (loading global), `:3427→3433`, +12 handlers. Padrão
  `setLoading(true)` → `await` → `setLoading(false)` sem `try/finally`.
- **Correção:** `try { } finally { setLoading(false); }`.

### A5 — Exclusão de conta mostra "sucesso" mesmo quando falha (LGPD)
- `src/App.tsx:6258-6262` (catch silencioso) → `:6272`. Falso sucesso em operação legal.

### A6 — "Indicar amigos" promete recompensa inexistente
- `src/App.tsx:6123-6131`. Publicidade enganosa (CDC). Remover ou rotular como "em breve".

---

## 🟨 MÉDIOS

- **M1** — `mp-webhook` loga segredo parcial + HMAC em produção
  (`mp-webhook/index.ts:72-84, 129-130`). Remover logs de DEBUG.
- **M2** — Expiração de plano 30d só aplicada quando o cliente carrega o perfil
  (`src/App.tsx:2123-2126`); sem cron server-side.
- **M3** — Gate admin/suporte chama `setTela()` em render + restore via localStorage
  (`:15554, :16151-16153, :2163-2164`). Flash de UI privilegiada; sem vazamento de dados.
- **M4** — Recuperação de senha com 3 caminhos paralelos + timer 1,5s
  (`:1984-1994, 2041-2046, 6311-6314`).
- **M5** — Toggles otimistas disponibilidade/agenda sem revert (`:4683-4687, 4690-4696`).
- **M6** — Realtime: 8+ canais por usuário (`:1380-1922`); validar limites a 500 online.
- **M7** — `signUp` + Confirm email deixa usuário meio-criado sem termos no banco
  (`:2520-2533`).
- **M8** — `any` em dados de negócio e fluxo PIX (`:287, 975-1226, 1849, 9831, 11195`).

---

## 🟦 BAIXOS

- **B1** — `console.warn` de DEBUG em `revisarDocumento` (`:3408`) + logs de pagamento.
- **B2** — Código morto: `handleAtualizarLocalizacao` (`:2640`), `localizandoDiaria` (`:191`).
- **B3** — Favoritar grava só em localStorage com toast de sucesso (`:14273-14279`).
- **B4** — OAuth Google usa `window.location.origin` (`:2585`) vs reset com URL fixa (`:2562`).
- **B5** — `TOKEN_REFRESHED` ignorado sem re-sync de `session` (`:2038`).
- **B6** — Sem broadcast de logout entre abas.
- **B7** — Idempotência e rate-limit do webhook são fail-open.
- **B8** — `delete-user` não apaga `contatos_desbloqueios`, `kyc_documentos`, `oauth_states`,
  `webhook_eventos_processados`.
- **B9** — View `usuarios_publicos` sem `security_invoker=true`
  (`rebrand_juridico_fase1_views.sql:103`) — porta latente (hoje não usada).

---

## ✅ Verificado como CORRETO

- Webhook valida HMAC-SHA256 (timing-safe + janela ±5min), idempotência dupla.
- `contatos_desbloqueios` server-side (RLS, só service_role insere); bypass via
  URL/localStorage fechado.
- `create-payment` com guard anti-cobrança-dupla e validação de identidade.
- `create-subscription`/`create-plano-payment` decidem preço no servidor.
- `mp-oauth` com nonce one-time (corrigiu account-takeover).
- `lookup-by-cpf` com timing oracle fechado, rate-limit, erro genérico.
- Trigger `protect_user_profile_privileged_columns` bloqueia escalada via UPDATE.
- RPCs de admin revalidam `is_admin` server-side.
- Trigger anti-saída de chat espelha o filtro no servidor.
- `verificar-whatsapp` valida OTP no servidor.
- Listeners e canais Realtime com cleanup correto.

---

## Ranking (mais → menos perigoso)

1. C3 · 2. C2 · 3. C1 · 4. A2 · 5. A1 · 6. A3 · 7. A5 · 8. A4 · 9. A6 · 10. M1

## Veredito

Não pronto para divulgação, tráfego pago, dinheiro real ou escala. Bloqueadores:
C1, C2, C3. Confirmar A1/A2 no Dashboard. Versionar o schema base + RLS.

## Notas (0–10)

| Dimensão | Nota |
|---|---|
| Segurança | 4 |
| Arquitetura | 4 |
| UX | 6 |
| Confiabilidade | 4 |
| Monetização | 2 |
| Estabilidade | 5 |
| Escalabilidade | 4 |
| Maturidade profissional | 6 |

**Média ponderada: ~4,2/10 — protótipo avançado, não pronto para receita confiável.**

---

## Apêndice — Handlers com loading sem `try/finally` (A4)

| Linha (true→false) | Handler | Severidade |
|---|---|---|
| 3427→3433 | `revisarDocumento` | alto |
| 2198→2229 | `saveProfile` (loading global) | alto |
| 2958→2973 | `enviarConvite` | médio |
| 3522→3531 | `criarTopico` | médio |
| 3543→3551 | `criarComentario` | médio |
| 3680→3687 | `abrirPerfilCandidato` | médio |
| 1208→1241 | useEffect perfil-empregador | médio |
| 3133→3146 | `enviandoRespostaTicket` | médio |
| 2884→2892 | `enviandoDenuncia` | médio |
| 1034→1041 | `enviarFeedbackExp` | médio |
| 1058→1067 | `enviarFeedbackPos` | médio |
| 1278→1288 | `enviandoAvalEmpOb` | médio |
| 3008→3023 | stats admin | baixo |
| 3033→3036 | drill admin | baixo |
</content>
</invoke>
