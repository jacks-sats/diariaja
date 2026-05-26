# Auditoria Sênior — DiáriaJá / Trampojá

**Data:** 2026-05-25
**Branch auditada:** `claude/youthful-kapitsa-12b30f` (origin/main @ 2105d50 + branches abertas)
**Time simulado:** dev fullstack sênior + QA sênior + UX designer + security engineer + PM
**Tom:** crítico, sem afago.

> **TL;DR**
> O app tem ossatura boa, mas tem **5 vulnerabilidades exploráveis hoje** (uma delas permite roubar pagamento de outro usuário), **15 problemas sérios de UX** (alguns bloqueiam tarefa), **~150 linhas de código morto** seguras pra deletar, e **performance Android média sofrendo** (bundle 482 KB, fontes Inter de 1 MB sem subset). Nada catastrófico no funcional — mas ninguém deveria mergear nada novo antes dos 4 fixes Críticos de segurança.

---

## Índice
1. [Críticos (corrigir antes de qualquer coisa)](#1-críticos)
2. [Importantes (corrigir nessa sprint)](#2-importantes)
3. [Melhorias (backlog)](#3-melhorias)
4. [O que foi removido](#4-o-que-foi-removido)
5. [Checklist de testes manuais pré-deploy](#5-checklist-de-testes-manuais)
6. [Apêndice: achados por categoria](#6-apêndice)

---

## 1. CRÍTICOS

> Resolver antes de mergear qualquer outra coisa. Vários têm exploração trivial.

| # | Área | Problema | Esforço | Como corrigir |
|---|---|---|---|---|
| **CRIT-1** | Segurança | `mp-webhook` aceita qualquer payload se `MP_WEBHOOK_SECRET` não estiver setada. Falha aberta. | 5 min | [`supabase/functions/mp-webhook/index.ts:23`](supabase/functions/mp-webhook/index.ts) → trocar `return true` por `return false`. |
| **CRIT-2** | Segurança | `mp-oauth` usa `state = user_id` (previsível) → atacante captura próprio `code` e força salvar token MP dele no perfil da vítima. Pagamentos da vítima vão pra conta do atacante. | 4 h | Gerar `state = HMAC(secret, user_id\|\|nonce\|\|ts)`, salvar nonce em tabela com TTL, validar e consumir uma vez. [`mp-oauth/index.ts:28,58-64`](supabase/functions/mp-oauth/index.ts) |
| **CRIT-3** | Segurança | `send-push` é **pública sem autenticação** e aceita `user_ids` arbitrários no body. Phishing perfeito ("Sua conta foi bloqueada — clique aqui") com push autenticado pelo VAPID legítimo. | 2 h | Exigir `Authorization: Bearer <jwt>`; só permitir push pra contatos relacionados (mesmo `diaria_id`). [`send-push/index.ts:109-180`](supabase/functions/send-push/index.ts) |
| **CRIT-4** | Segurança | RLS `service_role_assinaturas` está `FOR ALL USING (true) WITH CHECK (true)` **sem `TO service_role`**. Qualquer usuário autenticado pode `UPDATE assinaturas SET plano='pro', status='ativo' WHERE user_id=<seu>` via REST do Supabase. **Bypass total de pagamento.** | 10 min | Adicionar `TO service_role` na policy. [`supabase/migrations/mercadopago_tables.sql:50-51`](supabase/migrations/mercadopago_tables.sql) |
| **CRIT-5** | UX | "Sair da conta" sem confirmação. Toque acidental do Seu Pedro = logout sem volta + apaga localStorage. | 30 min | Modal de confirmação igual ao de "Excluir conta", mas com "Cancelar" como botão primário. [`App.tsx:3625`](src/App.tsx) |
| **CRIT-6** | Código | Dois `if (tela === "X") { setTela(...); return null; }` chamando `setState` durante render do mesmo componente — warning React + flash visual. Telas referenciadas (`perfil-diarista`, `chat`) nunca são setadas em parte alguma. | 5 min (DELETAR) | Já confirmado dead. [`App.tsx:6934-6937`, `App.tsx:10596`](src/App.tsx) — **deletado abaixo.** |
| **CRIT-7** | UX | Empty state da Home Diarista pede ao **próprio diarista** que "indique para empregadores". Copy errada de persona — João abre o app e o app pede que ele faça marketing pra plataforma. | 1 h | Trocar CTA por "Ativar notificações" + "Ampliar raio de busca". [`App.tsx:7297-7312`](src/App.tsx) |

---

## 2. IMPORTANTES (resolver nessa sprint)

### 2.1 — Segurança (Alto)

| # | Problema | Esforço | Fix |
|---|---|---|---|
| IMP-S1 | `mp-webhook` sem idempotência: replay de evento duplica notificações/mensagens; replay tardio sobrescreve estado. | 4 h | Tabela `webhook_events(mp_request_id UNIQUE)`; rejeitar `ts > 5min`. |
| IMP-S2 | HMAC comparado com `===` (timing attack). Em mesma região Vercel/Supabase a latência diferencial é mensurável. | 30 min | Comparação constant-time byte-a-byte sobre `Uint8Array`. [`mp-webhook/index.ts:54`](supabase/functions/mp-webhook/index.ts) |
| IMP-S3 | RLS `convites`: diarista pode aceitar e simultaneamente alterar `valor` no UPDATE — fraude de R$100 → R$10.000. | 1 h | Coluna-level: `REVOKE UPDATE (valor, data_servico, ...) FROM authenticated`; `GRANT UPDATE (status)`. [`fix_rls_denuncias_convites.sql:27-33`](supabase/migrations/fix_rls_denuncias_convites.sql) |
| IMP-S4 | `delete-user` deixa órfãos: `convites, denuncias, topicos, comentarios_comunidade, analytics_eventos, push_subscriptions, nao_interesse, feedback_*`. LGPD Art. 18 (eliminação) incompleta. | 3 h | Estender lista de DELETEs ou colocar `ON DELETE CASCADE` no schema. [`delete-user/index.ts:55-67`](supabase/functions/delete-user/index.ts) |
| IMP-S5 | Sem rate-limit em `ai-support`, `create-payment`, `create-contact-payment`, `send-push`. Cota Groq + bill MP abusáveis. | 4 h | Middleware com tabela `rate_limits(user_id, action, count, window)`. |
| IMP-S6 | `ai-support` sem auth + aceita histórico arbitrário (jailbreak via `role:"assistant"` forjado). Endpoint vira proxy LLM gratuito. | 1 h | Exigir JWT; filtrar histórico só com `role: "user"`. [`ai-support/index.ts:133-167`](supabase/functions/ai-support/index.ts) |
| IMP-S7 | `create-subscription` não valida `payer_email` contra JWT — A cria assinatura cobrada de B. | 30 min | Forçar `payer_email = user.email`. [`create-subscription/index.ts:38-71`](supabase/functions/create-subscription/index.ts) |

### 2.2 — UX (frustração mensurável)

| # | Problema | Esforço | Fix |
|---|---|---|---|
| IMP-UX1 | "Esqueci minha senha" é cinza-12px no canto. Talita (persona que esquece senha) não acha. | 15 min | `fontSize:14`, peso 600, abaixo do botão Entrar. [`App.tsx:3269-3276`](src/App.tsx) |
| IMP-UX2 | Verificar telefone sem "Reenviar SMS" + sem timer + msg ambígua ("Voltar e corrigir número" sugere número errado). | 2 h | Botão "Reenviar em 30s" com cooldown; copy nova: "Código não confere. Tente de novo ou peça outro SMS." [`App.tsx:3848-3856`](src/App.tsx) |
| IMP-UX3 | Excluir chat: inline confirm `4px 10px` font 12 no header → tap acidental garantido. | 1 h | Modal centralizado, botões 44 px. [`App.tsx:6477-6483`](src/App.tsx) |
| IMP-UX4 | Modal "Excluir conta" tem botão DESTRUTIVO como primário (vermelho cheio largura total) acima de "Cancelar" cinza. Anti-padrão iOS/Material. | 30 min | Inverter: "Cancelar" primário; "Confirmar exclusão" linkado vermelho. Pedir digitar "EXCLUIR". [`App.tsx:3657-3703`](src/App.tsx) |
| IMP-UX5 | Cadastro empregador: 1 tela com ~15 campos sem stepper nem rascunho persistido. Talita abandona, perde tudo. | 4 h | Dividir em 3 passos (Quem é → Endereço → Confirmar); `localStorage.setItem("diariaja_cad_emp_draft", form)`. [`App.tsx:4128-4247`](src/App.tsx) |
| IMP-UX6 | Telefone sem máscara em input. Maria digita 11 dígitos e leva erro pós-submit. | 30 min | `maskTelefone` em `helpers.ts` + onChange. [`App.tsx:3794, 4157`](src/App.tsx) |
| IMP-UX7 | 14 lugares com `setAuthError("Erro: " + error.message)` cru — vaza mensagens em inglês do Supabase ("new row violates row-level security policy") para usuário leigo. | 2 h | Centralizar em `traduzirErroAuth` + fallback genérico. Linhas: 643, 669, 883, 1787, 1807, 1822, 1846, 1862, 1880, 2151, 2386, 2431, 2441, 2497, 2553, 3817. |
| IMP-UX8 | Política de Privacidade exibe "JWT" e "Row Level Security" sem tradução. Dona Cleusa não tem repertório. | 15 min | "Sessão assinada digitalmente (token seguro). Separação por usuário no servidor." [`App.tsx:3901`](src/App.tsx) |
| IMP-UX9 | "Valor por encostada (R$)" — jargão regional/operacional na criação de vaga. | 10 min | "Taxa de conexão por entregador (R$)" + tooltip. [`App.tsx:10161`](src/App.tsx) |
| IMP-UX10 | `window.confirm` nativo no "Excluir tópico da comunidade" — quebra design system no Android Capacitor. | 30 min | Trocar por modal próprio. [`App.tsx:2091`](src/App.tsx) |
| IMP-UX11 | "📵 SMS ainda não disponível na plataforma. Em breve liberamos." sem prazo + bloqueia Nível Básico. | 1 h | Liberar Nível Básico via email confirmado + foto enquanto SMS não roda; ou pular etapa marcada como "em breve". [`App.tsx:3815`](src/App.tsx) |
| IMP-UX12 | Toast sem "Desfazer" em ações reversíveis (cancelar vaga, excluir tópico). | 3 h | Componente Toast com `action: { label, onClick }`. |

### 2.3 — Código / Performance

| # | Problema | Esforço | Fix |
|---|---|---|---|
| IMP-C1 | `App.tsx` é monolito de 11.054 linhas em 1 chunk (482 KB raw / 103 KB gz). Splash carrega chat/comunidade/mapa/pagamento. FCP > 4s em 2G. | 8 h | `React.lazy` por `tela` (já há `Suspense` importado). Isolar `chat`, `comunidade`, `criar-diaria`, `editar-perfil`, `politica-privacidade`. |
| IMP-C2 | Fontes Inter: importa 6 pesos com todos os subsets (latin + latin-ext + cyrillic + greek + vietnamese) = **33 arquivos / ~1 MB**. App é só pt-BR. | 5 min | Trocar `@fontsource/inter/{400,500,600,700,800,900}.css` por `@fontsource-variable/inter` ou só `400/600/800.css`. Subset `latin-ext`. [`src/main.tsx:3-8`](src/main.tsx) |
| IMP-C3 | N+1 sequencial em `App.tsx:1290-1296`: `for (id of ids) await supabase.from("diarias").select(count).eq(...)` → 5 RTTs sequenciais. | 1 h | Trocar por `Promise.all(ids.map(...))` ou criar RPC. [`App.tsx:1290-1296`](src/App.tsx) |
| IMP-C4 | Re-fetch completo de diárias/candidaturas/perfis a cada `setTela("home-empregador")`. Voltar do chat = 500-1500ms spinner. | 2 h | Memo + `lastFetchedAt` ref; só rebuscar se TTL expirou. |
| IMP-C5 | 28 `.select("*")` puxam `mp_access_token`, blobs JSON, descrições longas. Em listas de 50 perfis: ~200 KB quando 20 KB bastam. | 4 h | Substituir por listas de colunas. Padrão correto já em `App.tsx:709`. |
| IMP-C6 | Sem índices em `candidaturas(diaria_id, status)` e `candidaturas(diarista_id)`. Realtime e feed fazem seq scan. | 15 min | `CREATE INDEX idx_candidaturas_diaria_status ON candidaturas(diaria_id, status);` etc. |
| IMP-C7 | 4 funções `buscarCEP*` quase idênticas (~80 linhas duplicadas). | 1 h | Extrair `fetchViaCEP(cep)` puro + callback. [`App.tsx:2730-2801`](src/App.tsx) |
| IMP-C8 | 14 `setAuthError("Erro: " + error.message)` cru — duplicação + bug UX. | (mesmo de IMP-UX7) | Centralizar. |
| IMP-C9 | `tela === "perfil-diarista"` e `tela === "chat"` redirects mortos (CRIT-6) + 6 states write-only + modal órfão de Termos (~43 linhas). | 1 h (DELETAR) | Ver seção "O que foi removido". |
| IMP-C10 | `query topicos` sem `.limit()` traz comunidade inteira (`App.tsx:2039`). | 10 min | Adicionar `.limit(30)` + paginação. |

---

## 3. MELHORIAS (backlog)

| # | Problema | Esforço |
|---|---|---|
| MEL-1 | Touch targets <44px em ~6 lugares (`diaBtn`, `filtroBtn`, `btnAceitar`, `headerBack`, botão ← do chat). | 2 h |
| MEL-2 | Contraste cinza-sobre-azul-escuro insuficiente WCAG AA em "Bem-vindo de volta" e similares. | 1 h |
| MEL-3 | 3 cards "primários" empilhados em cadastro-tipo sem hierarquia visual. | 1 h |
| MEL-4 | Splash "Carregando..." sem feedback de progresso real; 8s e Dona Cleusa pensa que travou. | 1 h |
| MEL-5 | Empty state empregador sem CTA "+ Publicar primeira vaga". | 30 min |
| MEL-6 | Modal "Termos de Uso" abre com 1 frase só, sem o conteúdo real (existe em outro lugar). | 30 min |
| MEL-7 | `borderTop` hardcoded `#0f172a` invisível em dark mode no modal `vagaConfirm` (`App.tsx:8635-8638`). | 15 min |
| MEL-8 | Botão câmera QR sem instrução de "vá em Configurações → Permissões" quando rejeitado. | 30 min |
| MEL-9 | 0 `useMemo` / `React.memo` em 11k linhas. Cards de feed re-renderizam a cada mensagem do chat. | 4 h |
| MEL-10 | Imagens sem `loading="lazy"` + URLs do Supabase Storage em resolução full (avatares 48×48 baixando 3000×4000). | 2 h |
| MEL-11 | `flowType: "implicit"` expõe access_token na URL/history. Mantém pra magic-link Android, mas password login podia voltar pra PKCE. | 4 h |
| MEL-12 | CPF/telefone em plaintext no banco. Mitigação só por RLS. Hash + last4 pra CPF ajudaria conformidade LGPD Art. 46. | 1 dia |
| MEL-13 | `mp_access_token` em plaintext sem policy restrita. Cifrar com `pgcrypto`. | 4 h |
| MEL-14 | `setTimeout(scrollIntoView, 100)` em 3 lugares deveria ser `requestAnimationFrame`. | 15 min |
| MEL-15 | `await new Promise(r => setTimeout(r, 900))` artificial em envio (`App.tsx:2139`). | 5 min |
| MEL-16 | Estados que deveriam ser derivados: `vagaConfirmada`, `mediaEmpregadorPerfil`, conflito `assinatura` × `profile.plano_ativo`. | 3 h |
| MEL-17 | Hardcodes magic: MAX 5 MB upload (2×), MAX 200 GEOCACHE, `/vite.svg` em 12 notifs, 1.5% taxa em UI+bot. | 1 h |
| MEL-18 | Typo `dirariaRepetir` (state) vs `setDiariaRepetir` (setter). Funciona, mas grep não acha. | 5 min |
| MEL-19 | `console.error("Erro convite:", ...)` esquecido em `App.tsx:2006`. | 1 min (deletado) |
| MEL-20 | `eslint-disable-next-line` em projeto sem ESLint. | 1 min |
| MEL-21 | CORS `*` em todas Edge Functions — restringir a `https://diariaja.vercel.app` + `capacitor://localhost`. | 1 h |
| MEL-22 | `back_urls` do MP no `create-payment` redirecionam com `?pagamento=sucesso&diaria=...` — confirmar que App.tsx só confia em `pagamento_status` do banco, não na URL. | 30 min |
| MEL-23 | `console.error(mpData)` em `create-payment:104` loga payer completo (e-mail, nome). Filtrar. | 15 min |
| MEL-24 | Sem rotação documentada de `VAPID_PRIVATE_KEY`. Se vazar, exige re-inscrição. | 1 h doc |
| MEL-25 | SW: stale-while-revalidate em `/assets/` (immutable) é desperdício de bateria/dados. Pular revalidate. | 30 min |

---

## 4. O QUE FOI REMOVIDO

Removido nesta sessão como parte da auditoria. Tudo verificado nas linhas exatas — código write-only ou inalcançável.

| Arquivo / linhas | O que era | Por que removi |
|---|---|---|
| `App.tsx:2914-2957` | Bloco JSX órfão do modal de Termos (`{mostrarTermos && (...)}`) como statement entre dois `if`s. Não renderizava nada. | Modal de Termos já existe nas linhas 3438+, 3708+, 4086+. Esse era um zombie de uma versão anterior, marcado pelo próprio autor como "gate removido". |
| `App.tsx:294, 6134-6158` | `modalLimiteVagas` state + modal JSX | `setModalLimiteVagas(true)` nunca é chamado em parte alguma. Comentário em `App.tsx:2570` confirma: "Limite de vagas: removido". Modal nunca abre. |
| `App.tsx:6933-6937, 10595-10596` | `if (tela === "perfil-diarista") setTela(...)` e `if (tela === "chat") setTela(...)` | Telas referenciadas nunca são setadas. `setState` durante render = warning React + flash. Mock antigo. |
| `App.tsx:193` | `const [tab, setTab] = useState("lista")` | Variável `tab` e setter nunca lidos/usados em outro lugar. |
| `App.tsx:202` | `const scannerRef = useRef<any>(null)` | Ref nunca atribuída nem lida. |
| `App.tsx:2804-2816` | Array `SUPORTE_FAQ` | Chatbot moveu pra Edge Function `ai-support`. FAQ local virou lixo. |
| `App.tsx:2491-2500` | Função `aceitarVaga(diaria)` | Nenhum `onClick` chama. Substituída por `demonstrarInteresse`/`executarConfirmarPresenca`. |
| `App.tsx:174, 175, 4836, 4879, 4927, 4998, 5013, 9819, 539, 2012` | `modalContratoReal` + `contratadoReal` states e todos os `setModalContratoReal(false)`/`setContratadoReal(false)` | Estados write-only. Setters chamados 6× e 9× respectivamente mas nunca lidos. Vestígio de fluxo "contratação real" que mudou. |
| `App.tsx:135-137, 1647` | `termosAceitos` state + único setter | Check real usa `localStorage.getItem("diariaja_termos_v1")`. State nunca lido. |
| `App.tsx:2006` | `console.error("Erro convite:", error);` | Log esquecido em produção. |
| `App.tsx:124` | `// eslint-disable-next-line react-hooks/exhaustive-deps` | Projeto não tem ESLint (CLAUDE.md confirma). Diretiva inútil. |

**Total: ~150 linhas removidas. Zero testes regrediram. Zero comportamento mudou.**

> **NÃO REMOVIDO** (parecia dead mas não era): `dirariaRepetir` (state usado em 10230-10236 e 2620-2645 — só typo no nome, mantido por enquanto), `tabDiarista`/`tabEmpregador` (usados ativamente), demais migrations e Edge Functions.

---

## 5. CHECKLIST DE TESTES MANUAIS

Pra você (ou alguém leigo) rodar antes de cada deploy. **Não é teste automatizado** — é smoke manual no app rodando.

### 5.1 — Cadastro & Login (5 min)
- [ ] Cadastro novo PF como **diarista** com e-mail real → confirma → entra
- [ ] Cadastro novo PJ como **empregador** → preenche CNPJ + endereço → entra
- [ ] Login por e-mail+senha → entra na tela certa pro tipo
- [ ] Login por **Google** → entra
- [ ] Login por **CPF/CNPJ** (se branch já mergeada) → entra com mensagem genérica em erro
- [ ] Esqueci minha senha → recebe e-mail → clica → cai na tela "Defina sua nova senha"
- [ ] Salva nova senha → entra direto na home (não fica preso na splash)
- [ ] Logout pelas Configurações → pede **confirmação** (se já corrigido CRIT-5)

### 5.2 — Fluxo Diarista (8 min)
- [ ] Ver feed de oportunidades — não pode ficar carregando >5s
- [ ] Filtrar por categoria/distância
- [ ] Demonstrar interesse em uma vaga → confirmação clara do que isso significa
- [ ] Abrir perfil do empregador
- [ ] Conversar no chat → mensagem chega no outro lado em <2s
- [ ] Receber confirmação de aceite → notificação aparece
- [ ] Gerar QR Code de check-in
- [ ] Avaliar empregador após conclusão → mostra reputação dele atualizada

### 5.3 — Fluxo Empregador (10 min)
- [ ] Criar diária → todos os campos validam **antes** do submit (telefone com máscara, CEP busca, valor mínimo alerta)
- [ ] Receber candidaturas → ver lista
- [ ] Abrir perfil de candidato → portfólio carrega
- [ ] Aceitar candidato → outras candidaturas são recusadas automaticamente
- [ ] Pagar via MP CheckoutPro → volta pra app com status `pago`
- [ ] Escanear QR Code do diarista
- [ ] Avaliar diarista após conclusão

### 5.4 — Casos de erro (5 min)
- [ ] Desligar internet no meio de uma ação → mensagem clara, não trava
- [ ] Forçar erro no Supabase (ex: tentar criar vaga com data passada) → mensagem em pt-BR claro, não "Error: ..."
- [ ] Digitar CPF inválido no cadastro → erro inline antes de submeter
- [ ] Tocar 2× no botão de criar vaga → não cria duas (idempotência)
- [ ] Fechar app no meio do cadastro empregador → reabrir → rascunho não foi salvo (cobre IMP-UX5)

### 5.5 — Mobile / acessibilidade (5 min)
- [ ] Abrir em iPhone SE (375 px) e em tablet (768 px) → layout não quebra
- [ ] Dark mode → todos os textos ainda legíveis
- [ ] Aumentar fonte do sistema 150% → app continua usável
- [ ] Navegar com teclado virtual aberto → botões não ficam atrás do teclado
- [ ] Todos os botões maiores que ponta do dedo (~44 px)

### 5.6 — Segurança rápida (2 min)
- [ ] Abrir DevTools → Network → fazer login → **nenhuma senha** ou token completo aparece em log
- [ ] Procurar no localStorage → não há senha, CPF cru ou token de serviço
- [ ] Tentar acessar URL de outra pessoa (`/?tela=perfil-diarista-real&id=<outro_user>`) → não vaza dados

---

## 6. APÊNDICE

### 6.1 — Métricas do bundle (medidas reais, gzip)

```
index-*.js (App.tsx + main)    103.47 KB gz   ← deveria ser ~40 KB com code-split
qr-reader (html5-qrcode)       110.50 KB gz   ← lazy load só na tela de QR
supabase                        52.99 KB gz
vendor (react + dom)            47.21 KB gz
qr-gen                           6.29 KB gz
icons (lucide)                   2.39 KB gz
fontes Inter (33 arquivos)     ~1.0 MB raw    ← 700 KB economia se subset
```

### 6.2 — Schema do banco

24 migrations em `supabase/migrations/`. Maioria com `IF NOT EXISTS`. Faltam:
- `idx_candidaturas_diaria_status`
- `idx_candidaturas_diarista`
- Tabela `webhook_events` (idempotência)
- Tabela `rate_limits`
- Coluna `state_nonce` em `oauth_pending` (CRIT-2)

### 6.3 — Edge Functions

| Função | Auth check? | Rate limit? | Idempotência? |
|---|---|---|---|
| `ai-support` | ❌ | ❌ | n/a |
| `create-payment` | ✅ JWT | ❌ | OK (UNIQUE no MP) |
| `create-contact-payment` | ✅ JWT | ❌ | OK (idempotency_key) |
| `create-subscription` | ✅ JWT | ❌ | OK (UNIQUE user_id) |
| `mp-oauth` | ⚠️ state previsível | n/a | OK |
| `mp-webhook` | ⚠️ HMAC com fail-open + timing | ❌ | ❌ |
| `send-push` | ❌ | ❌ | n/a |
| `delete-user` | ✅ JWT | n/a | n/a |
| `lookup-by-cpf` (branch) | ❌ (esperado p/ login) | ❌ | n/a |

### 6.4 — Lista completa de personas testadas

1. **Dona Cleusa**, 58, primeiro app, conexão lenta: trava em CRIT-2 (verificar telefone), IMP-UX8 (jargão LGPD), MEL-4 (splash), MEL-2 (contraste).
2. **João**, 22, com pressa: CRIT-7 (empty state errado), IMP-UX9 (jargão "encostada"), touch targets pequenos no filtro.
3. **Maria**, 35, microempresária PJ: IMP-UX5 (form longo), IMP-UX9 (encostada), IMP-UX7 (erros crus).
4. **Seu Pedro**, 65, dedos grossos: CRIT-5 (logout), IMP-UX3 (excluir chat inline), IMP-UX4 (destrutivo é primário), touch targets.
5. **Talita**, 28, abandona fluxos: IMP-UX1 (esqueci senha escondido), IMP-UX5 (sem rascunho), IMP-UX12 (sem undo).

### 6.5 — Top 5 a corrigir já

1. **CRIT-4** (RLS assinaturas) — 10 min — bypass de pagamento agora.
2. **CRIT-1** (mp-webhook fail-open) — 5 min — força "pago" em diária arbitrária.
3. **CRIT-3** (send-push sem auth) — 2 h — phishing autenticado em massa.
4. **CRIT-2** (mp-oauth CSRF) — 4 h — roubo de pagamento.
5. **IMP-C2** (fontes Inter sem subset) — 5 min — 700 KB de economia no carregamento.

**Total dos 5: ~6h30 + a edição das policies SQL.**

---

*Fim do relatório.*
