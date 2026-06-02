# Auditoria Sênior — DiáriaJá

**Data:** 2026-06-02
**Escopo:** stack completo — frontend (React/TS), backend (Supabase: Postgres + Auth + Storage + 16 Edge Functions Deno), PWA/Service Worker, app Android (Capacitor), CI/CD, segurança, LGPD e jurídico.
**Método:** 4 varreduras paralelas linha-a-linha (frontend · edge functions · banco/RLS · qualidade/infra) + revisão da documentação existente e do histórico Git.
**Público:** investidores / due diligence técnica.
**Tom:** honesto e equilibrado — pontos fortes e fracos sem afago.

---

## 0. Veredito em uma página

**DiáriaJá** é um marketplace mobile-first que conecta **anunciantes** (empresas e pessoas) a **diaristas/prestadores** (limpeza, delivery, construção, beleza, eventos etc.) no Brasil, com foco inicial em Campo Grande/MS. Está **no ar** (PWA na Vercel + app Android via Capacitor) e é **funcionalmente completo para MVP**: cadastro, login, anúncios, candidaturas, convites, chat em tempo real, avaliações, comunidade, planos/assinaturas, monetização (R$1/contato + assinaturas), KYC (RG/CNH + antecedentes), academy (cursos), check-in por QR e push.

| Pilar | Nota | Resumo |
|---|---|---|
| Completude de produto (MVP) | **A** | Todos os fluxos núcleo implementados, sem telas-fantasma. |
| Segurança (app/banco/functions) | **B+ / A−** | Postura *defense-in-depth* madura; vários P0/P1 já corrigidos. Gaps pontuais. |
| Compliance LGPD / jurídico | **B+** | Export + exclusão de conta, trilhas de auditoria, política e risco trabalhista documentados. |
| Modelo de monetização | **B** | Receita clara (R$1/contato + assinaturas dual-track); sem intermediar a diária (mitiga vínculo). |
| Qualidade de engenharia | **C+** | Lógica pura muito bem testada (231 testes), mas o restante quase sem teste. |
| Arquitetura / manutenibilidade | **C** | Monolito de 18.7k linhas em 1 arquivo; alto custo para escalar time. |
| CI/CD / operações | **C−** | Sem checagem automática em PR; deploy de functions manual (recém começou a automatizar). |
| Banco de dados / migrations | **C+** | Schema rico e seguro, mas **87 migrations aplicadas à mão** (risco de drift). |

> **Nota geral de maturidade de engenharia: ~6/10.** Tradução: **MVP sólido e defensável, pronto para operar e captar (pré-seed/seed)**, mas com **dívida de testes/CI/arquitetura** a quitar antes de escalar time ou ir para uma Série A.

**As 3 coisas que mais impressionam:** (1) segurança levada a sério de verdade — webhook com HMAC, RLS abrangente, trilha de fixes P0/P1; (2) compliance LGPD e jurídico documentados (raro nesse estágio); (3) produto realmente completo ponta-a-ponta.

**Os 3 maiores riscos:** (1) **falta de testes** em UI/functions/RLS e **sem CI bloqueando PR**; (2) **monolito** de 18.7k linhas dificulta crescer o time; (3) **migrations manuais** sem versionamento/rollback.

---

## 1. Produto e estágio

- **URL:** https://diariaja.vercel.app · **Suporte:** suporte@diariaja.com.br · **App ID Android:** `com.diariaja.app`
- **Idioma:** 100% pt-BR (código, UI, comentários) — coerente com o público.
- **Histórico:** ~50 PRs de evolução (#74→#127), ritmo intenso de features + correções. Documentação de produto e segurança já existe no repo (ver §11).
- **Estágio:** MVP no ar, em fase de pré-lançamento/beta. Checklist de publicação na Play Store já existe e marca segurança/pagamentos/PII como liberados.

---

## 2. Arquitetura e stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript (strict) + Vite 5, **sem router** (navegação por estado `tela`), **sem CSS framework** (estilos inline no objeto `S`) |
| Backend | Supabase: Postgres + Auth + Storage + 16 Edge Functions (Deno) |
| Mapas | Leaflet + OpenStreetMap | QR | qrcode.react / html5-qrcode |
| Pagamentos | Mercado Pago (CheckoutPro + Preapproval) |
| Push | Web Push próprio (RFC 8291 AES-GCM + VAPID) — sem dependência `web-push` |
| IA | Groq (LLaMA 3.1) na function `ai-support` |
| Verificação telefone | Twilio Verify (WhatsApp) — function pronta, CTA no app desligado |
| Mobile | Capacitor 6 (Android; **zero plugins nativos** — usa Web APIs) |
| Hosting | Vercel (web) + Supabase (functions/DB) |
| Testes | Vitest (231 testes, só funções puras) |

**Pontos fortes da arquitetura:** stack enxuta e moderna; dependências mínimas e atuais; PWA com service worker robusto (network-first p/ HTML, cache-first p/ assets hash) que evita a "tela branca pós-deploy"; CSP apertada na Vercel (HSTS, X-Frame-Options DENY, sem trackers de terceiros); segredos sensíveis isolados nas Edge Functions (nenhuma service-role no cliente).

**Ponto fraco estrutural:** **`App.tsx` tem 18.711 linhas** concentrando ~36–40 telas, estado, lógica e ~1.000 linhas de estilos inline. Funciona, mas é o maior risco de manutenção.

---

## 3. O que está PRONTO e funciona

Inventário verificado contra o código (✅ = completo e funcional):

**Onboarding & conta**
- ✅ Cadastro Diarista (PF, wizard 4 passos), Anunciante PF (3 passos) e **Empresa PJ** (CNPJ + endereço; agora com cadastro via servidor que loga por CNPJ na hora).
- ✅ Login por **e-mail** e por **CPF/CNPJ** (lookup→e-mail), Google OAuth, recuperação de senha, aceite de termos versionado.

**Marketplace (núcleo)**
- ✅ Criar anúncio/diária (com tipo "diária" vs "serviço pontual", valor, horário, CEP/geolocalização) + checagens anti-fraude (contato externo, conteúdo proibido).
- ✅ Candidaturas (demonstrar interesse) e **convites diretos** anunciante→prestador.
- ✅ Seleção de candidato com **gate de pagamento** (R$1 no plano grátis após cota) — *enforcement no servidor* (trigger), não confiável só no cliente.
- ✅ **Chat em tempo real** (Supabase Realtime): "digitando…", recibos de leitura ✓✓, contagem de não-lidas, protocolo de contato, anti-mensagem-pra-si-mesmo.
- ✅ Avaliações mútuas 1–5★ (com CHECK no banco), reputação do anunciante.
- ✅ **Check-in por QR Code** (gera/escaneia) + fallback por código manual → confirma presença.
- ✅ Mapa/geolocalização (distância haversine, filtro por raio).

**Engajamento & confiança**
- ✅ **Níveis de confiabilidade** (1–4) calculados pelo preenchimento do perfil + KYC + cursos.
- ✅ **KYC**: upload e revisão admin de RG/CNH **e** antecedentes criminais (buckets privados + log de acesso LGPD).
- ✅ **Academy "Já Decola"**: cursos, módulos, aulas com **anti-fraude** (tempo mínimo de leitura, scroll, quiz com cooldown e respostas ocultas no servidor) e certificados.
- ✅ **Comunidade** (fórum por categorias) com checagem de conteúdo.
- ✅ **Push notifications** (criptografia RFC 8291 in-band) + fallback local.

**Monetização** (ver §7)
- ✅ R$1 por contato extra (CheckoutPro), assinaturas recorrentes (Preapproval) e avulso 30 dias (Pix), com **webhook idempotente e validado por HMAC**.

**Admin & suporte**
- ✅ Painel admin: métricas (usuários, online, diárias, financeiro/receita por plano), séries temporais, drill-down, gestão de equipe de suporte, fila de tickets, revisão de KYC/antecedentes, bloqueios/denúncias.
- ✅ Painel de suporte com escopo próprio (flag `is_suporte`).

---

## 4. O que NÃO funciona, está incompleto ou desativado

| Item | Situação | Severidade | Observação |
|---|---|---|---|
| **Ordenação da lista de prestadores** | 🐛 Hotfix incompleto | **Alta** | `App.tsx:~1181`: removeram `.order("created_at")` porque a coluna não existe em produção → lista de prestadores sai **sem ordenação**. Precisa adicionar `created_at`/coluna estável e restaurar a ordenação. |
| **Verificação de telefone (WhatsApp/Twilio)** | ⚠️ Backend pronto, CTA desligado | Média | A function `verificar-whatsapp` (Twilio Verify) existe e é robusta, mas o flag `MOSTRAR_VERIFICAR_TELEFONE_CTA=false` esconde o botão (faltam secrets/decisão de ativar). |
| **Paginação** | ⚠️ Limites rígidos | Média | `prestadores_publicos()` limita a **200**; chat carrega todas as mensagens; feed sem cache. Escala bem até ~1k usuários/região, depois precisa paginar. |
| **Mercado Pago OAuth do prestador** | ⚠️ Conecta mas não usa | Média | Fluxo de conectar conta MP existe, mas como o app **não intermedia** a diária, o token fica sem uso prático hoje (decidir: usar ou remover). |
| **Export/retenção de dados** | ⚠️ Parcial | Média | `export-user-data` funciona mas sem paginação/limite; **não há política de retenção** (diárias/mensagens/analytics ficam indefinidamente). |
| Código legado removido por design | ✅ Intencional | Baixa | `iniciarPagamentoMP`, botões "Pagar/Recebimento via PIX", perfil mock — removidos porque o app não intermedia valores. Sem zumbis. |

Nenhum desses bloqueia o uso atual, mas o **#1 (ordenação)** afeta descoberta de prestadores na home do anunciante e deveria ser priorizado.

---

## 5. Segurança — **ponto forte do projeto**

A postura é de *defense-in-depth* madura, com evidência de auditorias anteriores e correção de vulnerabilidades reais.

**Destaques (o que está bem feito):**
- **RLS habilitado em todas as ~40 tabelas**; PII (CPF/CNPJ/telefone/PIX/token MP) protegida por **REVOKE em nível de coluna** + acesso só via RPCs `SECURITY DEFINER` (`meu_perfil`, `perfis_publicos`).
- **Webhook do Mercado Pago** com **HMAC-SHA256**, janela de replay ±5min, comparação *constant-time* e **idempotência** (tabela de eventos processados) — protege contra cobrança dupla e notificação forjada.
- **OAuth do MP** com *nonce* single-use (corrigiu vetor de account-takeover).
- **JWT + checagem de identidade** em todas as functions sensíveis; **rate-limiting** consistente (`_shared/rate-limit.ts`, fail-open deliberado).
- **Anti-fraude de negócio no servidor**: trigger bloqueia seleção acima da cota (paywall não burlável), trigger impede menor de 18 se candidatar, REVOKE de UPDATE em `convites` (impedia fraude de alterar valor R$100→R$10k), allowlist de MIME em uploads (anti-XSS via SVG).
- **PII redigida** antes de ir pra IA (Groq) e *pseudonimização* de IDs em logs.

**Vulnerabilidades já encontradas e corrigidas (sinal de maturidade):** 4 P0 (escalonamento de privilégio, account-takeover OAuth, replay de webhook/cobrança dupla, cadastro de menor) e 10+ P1 (injeção, bypass de paywall, vazamento de PII, forja de timestamp) — todas com fix versionado.

**Gaps de segurança a tratar:**
| Gap | Severidade | Recomendação |
|---|---|---|
| `mp_access_token`/CPF/CNPJ **em texto puro** no banco (protegidos por REVOKE, não por cripto) | Média | Criptografia em coluna / Supabase Vault para o token MP. |
| **Sem CAPTCHA** em endpoints públicos (`lookup-by-cpf`, `signup-empresa`) | Média | Adicionar hCaptcha/reCAPTCHA (rate-limit por IP é fraco contra botnet). |
| Sem rate-limit em `delete-user` e `export-user-data` | Baixa-Média | Adicionar (DoS de baixa probabilidade, mas barato cobrir). |
| `verificar-whatsapp` aceita código de 4–8 dígitos (Twilio envia 6) | Baixa | Exigir exatamente 6. |
| Sem testes automatizados de RLS | Média | Suíte pgTAP no CI (hoje a RLS é validada só por revisão manual). |

---

## 6. LGPD, jurídico e compliance

- **LGPD implementada:** exclusão de conta (`delete-user`, cascata + anonimização de conteúdo de comunidade), exportação de dados (`export-user-data`), aceite de termos com prova server-side (`termos_aceitos_em`), tela de política de privacidade, logs de acesso a KYC (Art. 37), trilha genérica de auditoria, **purga automática de antecedentes em ~90 dias** (cron).
- **Jurídico (vínculo trabalhista):** documento `RISCO_JURIDICO.md` posiciona a plataforma como **conector/marketplace, não empregador**, e o modelo de **não intermediar o valor da diária** (pago direto entre as partes) é uma mitigação deliberada de presunção de vínculo (CLT/LC 150).
- **Moderação e incidentes:** políticas escritas (`MODERACAO.md`, `INCIDENT_RESPONSE.md`), denúncia com **auto-suspensão** por limiar e bloqueio entre usuários (requisito de app store para UGC).

**Pendências LGPD:** nomear DPO formalmente (já sinalizado no checklist), política de **retenção** de diárias/mensagens/analytics, e opt-out de analytics. Confirmar agendamento explícito do cron de purga (depende de `pg_cron`).

---

## 7. Monetização

A plataforma **não fica com o dinheiro da diária** (pago direto entre as partes via PIX combinado). Receita vem de:

1. **R$1 por contato extra** — no plano grátis, ao estourar a cota mensal de seleções, o anunciante paga R$1 para liberar aquele contato. *Gate no servidor*, com ledger em `contatos_desbloqueios`.
2. **Assinaturas dual-track** (assinatura separada por papel; quem é "ambos" pode ter as duas):
   - **Anunciante:** Grátis · Essencial **R$24,90** · Plus **R$49,90**
   - **Diarista:** Grátis (3 primeiras diárias concluídas) · Essencial **R$9,90** · Plus **R$19,90**
   - Recorrente (Preapproval) ou avulso 30 dias (Pix), reconciliado pelo webhook.

**Leitura para investidor:** receita transacional de baixo atrito (R$1) + recorrência (SaaS) é um modelo saudável e já **implementado e cobrável**. Falta sobretudo *tração/unit economics* (dado de negócio, não de engenharia) e talvez explicitar a projeção por coorte.

---

## 8. Qualidade de engenharia, testes e CI/CD

**Testes**
- ✅ **231 testes** cobrindo `helpers.ts` (validações CPF/CNPJ, máscaras, haversine, máquinas de estado de diária, regras de cota/crédito) e fluxo de negócio — **excelente** na superfície de funções puras.
- ❌ **0 testes** em `App.tsx` (18.7k linhas de UI), nas 16 Edge Functions e na RLS. **0 E2E** (sem Cypress/Playwright). Cobertura realista de caminhos de runtime: ~5–10%.

**CI/CD**
- ✅ Vercel faz deploy do web automaticamente no push.
- ✅ Acabamos de adicionar `deploy-functions.yml` (deploy automático da `signup-empresa`).
- ❌ **Não há CI bloqueando PR** (nada roda `tsc`+testes+build antes do merge) → erro de TS ou teste apagado pode chegar à `main`.
- ⚠️ As outras 15 Edge Functions ainda sobem **manualmente**, sem versionamento/rollback/health-check — incluindo a `mp-webhook` (crítica de pagamento).

**Código**
- `tsconfig` **strict**; sem ESLint/Prettier (decisão deliberada — TS + revisão como rede de segurança; arriscado ao crescer o time).
- `helpers.ts`/`types.ts`/`constants.ts` bem organizados; `App.tsx` é o ponto frágil (120+ `useState`, 63 `useEffect`, pouquíssimos `useCallback/useMemo`).

---

## 9. Banco de dados e migrations

- Schema **rico e bem modelado**: ~40 tabelas, 50+ RPCs, 20+ triggers, índices de performance (`perf_indexes_escala_v1`), crons (rate-limit cleanup, expirar vagas, lembrar diárias, purga de antecedentes).
- **Risco operacional central:** as **87 migrations são aplicadas à mão** no SQL Editor do Supabase — sem runner, sem `schema_versions`, sem rollback. São idempotentes (`IF NOT EXISTS`), o que ajuda, mas há **risco real de drift** entre ambientes e de esquecer uma migration (já há sinais: hotfixes recentes e colunas ausentes em produção, como o caso da ordenação no §4).
- **Recomendação prioritária:** adotar `supabase db push`/migration runner versionado e uma tabela de versão de schema.

---

## 10. Mobile (Android)

- Capacitor 6, `appId com.diariaja.app`, **zero plugins nativos** (câmera/QR/push/geo via Web APIs) — base limpa e de baixa manutenção.
- Release com `minifyEnabled`/`shrinkResources`.
- **Sem iOS** configurado (decisão de escopo; entrar em iOS exigirá trabalho adicional, ainda que o grosso seja web).
- Atualização do app nativo depende da Play Store (web atualiza via service worker).

---

## 11. Documentação existente (sinal de maturidade)

O repositório já inclui: `AUDITORIA.md` (auditoria sênior anterior), `SECURITY.md`, `RISCO_JURIDICO.md`, `PRIVACY_CHECKLIST.md` (LGPD), `MODERACAO.md`, `INCIDENT_RESPONSE.md`, `RECUPERACAO.md`, `CHECKLIST_PUBLICACAO_PLAYSTORE.md`, `FLUXOS_CONTRATACAO.md`, `RFC_PRESENCA_DIARIA.md`, `QA_TESTE_E2E.md`, `CLAUDE.md`. Para um produto nesse estágio, esse nível de documentação de segurança/jurídico/operação é **acima da média** e reduz risco de due diligence.

---

## 12. Top riscos priorizados

| # | Risco | Prob. | Impacto | Ação |
|---|---|---|---|---|
| 1 | Sem testes em UI/functions/RLS + **sem CI em PR** → regressão silenciosa em pagamento/auth | Alta | Crítico | CI de PR (`verify:quick`+build) + E2E nos caminhos críticos |
| 2 | **Migrations manuais** sem versionamento/rollback → drift | Alta | Alto | Migration runner versionado + `schema_versions` |
| 3 | **Monolito** de 18.7k linhas → custo de onboarding e merge | Alta | Alto | Extrair telas em componentes/hooks (faseado) |
| 4 | `mp-webhook` (pagamento) deploya manual e sem teste | Média | Crítico | Smoke test + incluir no deploy automático |
| 5 | Ordenação de prestadores quebrada (§4) | Média | Alto | Adicionar coluna estável + restaurar `.order()` |
| 6 | PII/token MP em texto puro | Média | Médio | Cripto de coluna / Vault |
| 7 | Endpoints públicos sem CAPTCHA | Média | Médio | hCaptcha em `lookup-by-cpf`/`signup-empresa` |
| 8 | Sem paginação (cap 200) / sem política de retenção | Média | Médio | Paginar listas + cron de retenção |

---

## 13. Roadmap recomendado (90 dias)

**Fase 1 — Reduzir risco já (1–2 semanas):**
1. **CI em PR** (GitHub Actions: `tsc` + Vitest + build) + proteger a `main`. ~meio dia, payoff enorme.
2. Estender o deploy automático para **todas** as Edge Functions + `deno check`.
3. **Smoke test do `mp-webhook`** (payload mockado → verifica gravação).
4. Corrigir a **ordenação de prestadores** (§4).

**Fase 2 — Testes E2E (3–6 semanas):** Cypress/Playwright nos caminhos críticos (cadastro, criar anúncio, candidatura, chat, check-in, pagamento) + harness de OAuth.

**Fase 3 — Arquitetura & banco (7–8 semanas):** extrair telas do `App.tsx` em componentes; migrar para migration runner versionado; `.env.example`.

**Fase 4 — Compliance & observabilidade (9–10 semanas):** política de retenção + opt-out de analytics; dashboard de métricas/alertas (falha de webhook, erro de API); cripto do token MP; CAPTCHA; paginação.

---

## 14. Conclusão para o investidor

| Pergunta | Resposta |
|---|---|
| Dá pra operar em produção hoje? | **Sim** — está no ar e funcional. |
| Modelo de receita está implementado? | **Sim** — R$1/contato + assinaturas, cobráveis. |
| Escala para ~10k usuários? | **Sim** — Supabase + Vercel auto-escalam (com paginação). |
| Escala para um time de devs? | **Ainda não** — monolito + ausência de testes/CI exigem a Fase 1–3. |
| Maior risco técnico? | **Falta de testes automatizados + CI** em áreas críticas. |
| Tempo para destravar o maior risco? | **~4–6 semanas** (CI + E2E). |
| Pronto para due diligence de Série A? | **Após ~3 meses** quitando a dívida de testes/CI/arquitetura. |

**Resumo:** execução de MVP forte, com **segurança e compliance acima da média** para o estágio, modelo de receita real e produto completo. O que separa o "MVP impressionante" do "pronto para escalar" é **disciplina de engenharia** (testes, CI, modularização, migrations versionadas) — tudo endereçável em ~90 dias e sem reescrita. **Adequado para captação pré-seed/seed agora**; Série A após a Fase 1–3.

---
*Documento gerado por auditoria automatizada assistida (4 varreduras paralelas do código-fonte). Não substitui parecer jurídico nem pentest formal de terceiros.*
