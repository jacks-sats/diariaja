# Auditoria DiáriaJá / Trampojá — Junho 2026

> **Método:** varredura do código real (`src/`, `supabase/`, `android/`, docs) +
> verificação arquivo-a-arquivo dos pontos contestados. **Leitura honesta:**
> várias coisas apontadas como "pendentes/críticas" em auditorias passadas **já
> foram corrigidas** — este doc reflete o estado **verificado** em 07/06/2026.

---

## 1. O público

Marketplace de **dois lados**, foco **Campo Grande/MS**:

| Lado | Quem | Planos (por papel — dual-track) |
|---|---|---|
| **Anunciantes** (demanda) | Empregadores PF + PJ/MEI | Grátis (R$1/contato) · Essencial R$24,90 · Plus R$49,90 |
| **Prestadores** (oferta) | Diaristas, motoboys, garçons, pedreiros, manicures, cuidadores… | Grátis (3 diárias) · Essencial R$9,90 · Plus R$19,90 |

- **11 categorias**, **45 profissões** com médias de CG (R$85–240/dia) — `constants.ts`.
- **Status atual:** teste fechado (modo beta) → **tração ainda não validada**.
- **Verificar o público real** (rodar no Supabase): ver `_VERIFICAR_PROD.sql` §B.

## 2. Pontos fortes (verificados)

- ✅ **Feature-complete:** cadastro PF/PJ, criar diária, candidatura, seleção, chat realtime, check-in (QR+GPS), avaliação mútua, multi-vagas (Fase 1).
- ✅ **Retenção:** push, comunidade, Academy gamificada (Bronze→Diamante), ranking, lembrete de perfil.
- ✅ **Segurança acima da média pro estágio** (ver §4).
- ✅ **CI já existe** (`.github/workflows/ci.yml` = tsc+testes+build) **+ E2E** (`e2e/` Playwright smoke) + deploy de functions + OTA Capgo.
- ✅ **OTA ativo** (Capgo) — atualizações de conteúdo sem Play Store (após o AAB v3).
- ✅ **262 testes** em `helpers.ts`/`constants.ts`.

## 3. ⚠️ Correção de auditorias anteriores

Os "5 críticos" da auditoria de pré-lançamento (29/mai) **foram fechados** — verificado no código:

| Item antigo | Realidade verificada |
|---|---|
| Paywall R$1 só no cliente | ✅ trigger server-side `enforce_limite_selecao_candidato` (`fix_c1_*`, `cobranca_r1_sempre_contato.sql`) |
| RLS `assinaturas` `WITH CHECK(true)` p/ todos | ✅ `fix_rls_assinaturas_service_role.sql` → restrito a `service_role` + `REVOKE` de `authenticated` |
| `mp-webhook` fail-open | ✅ fail-**closed** (`if(!SECRET) return false`) + timing-safe + idempotência (`webhook_eventos_processados`) |
| `send-push` sem JWT | ✅ exige JWT (401) + filtro de relação |
| `mp-oauth` state=user_id (CSRF) | ✅ nonce one-time em `oauth_states` (single-use) |

---

## 4. 🛡️ Segurança / LGPD / Jurídico (verificado)

**Forte:** RLS granular por tabela; trigger `protect_user_profile_privileged_columns`
(usuário não vira admin/pro/mexe em token MP); Edge Functions com JWT + rate-limit
(`_shared/rate-limit.ts`); webhook HMAC timing-safe + idempotente; `lookup-by-cpf`
timing-safe (450ms); LGPD avançado (`export-user-data`, `delete-user` em cascata,
`kyc_acessos_log`, `purgar_dados_antigos`, `purgar_antecedentes_expirados` agendada);
modelo jurídico sólido (não intermedia pagamento → fora do escopo BCB).

---

## 5. 📋 NECESSIDADES (lista priorizada, com DONO)

Legenda do dono: 🤖 = só código (Claude) · 🧑 = você (config/conta/decisão) · ⚖️ = externo (advogado/processo)

### 🔴 Maior risco REAL: drift de migrations
| # | Necessidade | Dono | Esforço |
|---|---|---|---|
| 1 | **Confirmar que as migrations estão aplicadas em produção** — 87 arquivos aplicados à mão; o código tem os fixes, mas é preciso garantir que rodaram. **Rodar `supabase/migrations/_VERIFICAR_PROD.sql` no SQL Editor** (read-only). | 🧑 (rodar) · 🤖 (escrevi) | 5 min |
| 2 | Habilitar extensão **`pg_cron`** no Supabase (Database → Extensions) — necessária p/ as purgas LGPD agendadas funcionarem. | 🧑 | 2 min |

### 🟠 Crescimento / negócio (o gargalo de verdade)
| # | Necessidade | Dono |
|---|---|---|
| 3 | **Resolver a liquidez** (ovo-e-galinha) em CG: semear oferta na unha + concierge dos 1ºs matches | 🧑 |
| 4 | **Medir o funil real** (cadastro→publica→candidata→seleciona→conclui) — queries em `_VERIFICAR_PROD.sql §B` | 🧑 |
| 5 | Revisar atrito do onboarding/KYC (KYC já é opcional — checar se afasta) | 🧑 |

### 🟡 Compliance / jurídico (antes de cobrar e escalar)
| # | Necessidade | Dono |
|---|---|---|
| 6 | **Nomear DPO** formal + `dpo@diariaja.com.br` | 🧑/⚖️ |
| 7 | **Revisão de Termos + Política de Privacidade** por advogado LGPD+trabalhista | ⚖️ |
| 8 | Avaliação trabalhista dos textos (Termo de Início, QR) + banner de habitualidade na 3ª contratação | ⚖️ |
| 9 | Decisão: **rename "empregador"→"contratante"** na UI (~257 lugares, refactor grande; mitiga risco CLT) | 🧑 decide · 🤖 executa |

### 🟢 Hardening / features pendentes (código)
| # | Necessidade | Dono | Esforço |
|---|---|---|---|
| 10 | **CAPTCHA** (hCaptcha) em signup/lookup — já tem rate-limit; falta camada anti-bot | 🧑 (criar conta+keys) · 🤖 (integro) | 4h |
| 11 | **Denúncia em chat + comunidade** (exigência das app stores) | 🤖 | 3h |
| 12 | **Lista negra de CPF banido** (hoje banido recadastra com outro nome) | 🤖 | 2h |
| 13 | **CSP: remover `'unsafe-inline'`** — exige repensar o script de auto-recuperação inline (não é "só apagar") | 🤖 (design) | 4h |
| 14 | **Multi-vagas Fase 2** (chat/check-in/avaliação por contratado) | 🤖 | maior |

### 🔵 Sustentabilidade técnica (não urgente)
| # | Necessidade | Dono |
|---|---|---|
| 15 | **Versionar migrations** (`supabase db push` + tabela de versões) — mata o drift de vez | 🤖 |
| 16 | **Quebrar `App.tsx`** (19k linhas) em telas com `React.lazy` — faseado | 🤖 |
| 17 | Code-split + subset de fontes Inter (~700 KB) + `minifyEnabled` no Android | 🤖 |
| 18 | Reduzir `as any` (73) e `console.log` de debug | 🤖 |

---

## 6. 🎯 Roadmap sugerido

- **Agora:** rodar `_VERIFICAR_PROD.sql` (drift) + habilitar `pg_cron` + atacar **liquidez** em CG.
- **30 dias:** revisão jurídica + DPO; hardenings rápidos (CAPTCHA, denúncia em chat).
- **90 dias:** versionar migrations + code-split do `App.tsx` + Multi-vagas Fase 2.

## 7. Veredito

> Base técnica e de segurança **sólida e bem acima do esperado pro estágio** — os
> críticos antigos já foram fechados. O trabalho real agora **não é apagar
> incêndio de código**: é **(1)** confirmar o que está aplicado em produção,
> **(2)** validar demanda (liquidez) e **(3)** fechar a parte jurídica/LGPD de
> processo antes de escalar.

---
*Auditoria gerada em 07/06/2026 a partir de leitura verificada do código. Itens 🤖 podem ser executados sob demanda.*
