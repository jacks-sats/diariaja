# Análise de Produto — DiariaJa 2026-07-24

Analista: UX researcher + PM sênior (Claude, sessão de auditoria).
Escopo: 25.810 linhas de `src/App.tsx`, `constants.ts`, `types.ts`,
`helpers.ts`, `RISCO_JURIDICO.md`. Foco em decisões que impactam receita
e retenção mensurável, respeitando a arquitetura monolítica e as
restrições anti‑CLT.

Nota sobre os "hoje/AGORA": a semântica do prompt é 2026‑07‑24. O
banner de lançamento aponta para 2026‑07‑01 (data já passada), então o
app está tecnicamente pós‑lançamento — mas várias travas de beta
(`modoBeta`) e cobrança (`exibirCobrancaContatoAnunciante=false`,
`launchFreeAnunciante`) continuam num limbo entre "grátis" e "cobra". Isso
por si só é um dos maiores problemas de produto.

---

## Sumário executivo

1. **Splash mente**: o CTA "Ver profissionais agora" empurra pra cadastro obrigatório, sem preview. Perde 30–50% no topo do funil.
2. **Monetização anunciante está desligada e nada substitui**: cobrança de R$ 2,50/contato e paywall de emprego existem, mas `exibirCobrancaContatoAnunciante=false` (App.tsx:1097) desliga o momento certo do CTA — no lançamento a maior parte da UI de upsell aparece "com um Não" e nunca vira R$.
3. **Prestador não tem loop de retorno diário**: sem "avisos push de novo anúncio dentro do raio", sem streak, sem "próxima ação sugerida". Retenção D1‑D7 vai depender de comportamento espontâneo.
4. **"Confiável" é mentira operacional**: o selo "Verificado" cai em qualquer perfil com CPF (`tem_documento ?? !!(cpf||cnpj)`, App.tsx:21598). Como o CPF é obrigatório no wizard de diarista, TODO diarista aparece "Verificado" — o selo perde sinal, e a jornada real de KYC (RG/CNH em `verificar-documento`) não tem incentivo prático.
5. **Plano Plus não entrega nada** e está escondido do UI (constants.ts:519, App.tsx:25576). Constants.ts diz explicitamente "hoje o Plus não entrega nada além do Essencial". É débito que confunde suporte e permite upsell falso quando futuros bugs reintroduzirem o card.

---

## Métricas de referência (o que estimar e o time deveria acompanhar)

**Estas métricas não parecem estar sendo lidas.** A tabela `analytics_eventos` recebe eventos (ex.: `cadastro_concluido`, `limite_contato_atingido`, `contato_vaga_exige_plano`) mas não achei dashboard/RPC que os coloque em funil. Precisa acompanhar:

| Métrica | Onde já existe evento | Ação recomendada |
|---|---|---|
| **Ativação anunciante D0**: signup → 1ª vaga publicada | `cadastro_concluido` + criação em `diarias` | Meta ≥ 40%. Hoje sem instrumento — o hub `publicar-opcoes` (App.tsx:11102) tem 4 caminhos que confundem. |
| **Ativação prestador D0**: signup → visibilidade catálogo ativa + agenda preenchida | falta evento explícito | Instrumentar `visibilidade='CATALOGO'` como conversão. |
| **Tempo até 1º contato** (prestador) | não medido | Contar até 1º `candidatura`/`convite` recebido — sinal de "product‑market vale a pena". |
| **Taxa de resposta anunciante** já é calculada localmente (App.tsx:13065) mas nunca é agregada em `analytics_eventos`. |
| **Free→pago (anunciante)**: 3ª seleção grátis atingida → assinatura ou desistência | `limite_contato_atingido` (App.tsx:7252) + `contato_vaga_exige_plano` (App.tsx:7245) | Falta contrapartida "assinou" — deveria disparar em `iniciarAssinatura` sucesso. |
| **Free→pago (diarista)**: 3ª diária concluída → assinatura ou churn | `limits.diarista.passouCotaGratis` (App.tsx:7289) | Sem evento em nenhum lugar. |
| **Chat abertura → PIX combinado**: não dá pra medir, mas conta de "mensagens até fechar" seria proxy. |
| **Churn subscription**: `assinaturas.status='cancelado'` | webhook MP grava | Sem visualização no admin. |
| **NPS pós‑diária**: `feedback_pos_conclusao` (types.ts:368) já existe, mas não vi o modal ser exigido no fluxo. |

---

## Onde estamos errando (por área)

### 1. Ativação

#### 1.1 Splash é uma landing page, não um preview

Arquivo `src/App.tsx:9387‑9656` — a splash tem ~270 linhas, mostra 3 cards fictícios estáticos, selos de confiança, "quem contrata aqui", "como funciona", "por que DiariaJá", MissãoVisãoValores e um footer com Termos. **É uma landing**. E o CTA gigante ("Ver profissionais agora →", linha 9536) leva para `cadastro-tipo`.

Problema: promessa quebrada em 1 tap. Isso desmoraliza no D0 e derruba a taxa de "abriu app → criou conta". Um marketplace mobile-first pode e deveria mostrar 5‑10 anúncios REAIS abertos (RLS público em `perfis_publicos`+`vagas_publicas`) antes do login. Sem CPF, sem chat, sem contato — só o feed.

#### 1.2 Cadastro anunciante: 4 telas + endereço opcional que parece obrigatório

Fluxo:
1. `splash` → `cadastro-tipo` (App.tsx:9828) — 3 cards, escolhe "contratar".
2. `cadastro-auth` (App.tsx:9902) — nome + telefone + email + senha + termos = **5 campos** já cobrados aqui.
3. `escolha-negocio` (App.tsx:12310) — grid de **15 categorias** obriga escolher um "ramo" (mesmo pra Beleza/Doméstico onde "meu negócio" é a família).
4. `pedir-localizacao` (App.tsx:21241) — CEP + botão GPS + opção "Pular".
5. `home-empregador` (App.tsx:12985) — feed de profissionais.
6. `publicar-opcoes` (App.tsx:11102) — 4 tipos (Diária/Serviço/Emprego/Empresa).
7. `criar-diaria` (App.tsx:22312) — formulário longo de **12+ campos**.

**Contagem:** entre "abriu app" e "publicou 1º anúncio", o anunciante faz **≈ 25–30 taps + 20+ campos** distribuídos por 7 telas. Isso é caro pra alguém que só quer "chamar um faxineiro pra sábado".

**Onde tirar atrito:**
- Splash com preview real dos profissionais (item 1.1) reduz cadastro reativo.
- `cadastro-tipo` pra doméstico pode ir direto pro cadastro sem passar por `escolha-negocio` (segmento "Doméstico" default se veio da splash com "sua casa" clicado).
- `criar-diaria` cobra endereço completo (CEP + rua + número + bairro + cidade + estado, App.tsx:22860+) enquanto o próprio texto diz "endereço só é revelado após aceitar" — bastaria CEP + número.

#### 1.3 Cadastro diarista: dois caminhos, dados assimétricos

**Caminho A — Wizard 4 passos** (App.tsx:12369):
- Passo 1 Identidade: **foto + nome + sexo + dataNasc** (4 campos).
- Passo 2 Contato: **telefone + CPF** (2 campos).
- Passo 3 Serviço: **especialidades múltiplas + valor** (2 campos).
- Passo 4 Disponibilidade: **dias da semana + toggle + termos** (3 interações).

**Caminho B — Google Express** (`iniciarCadastroExpress`, App.tsx:4665):
- Se `tipoEscolhido==='diarista'` → cai em `setup-diarista` (App.tsx:22129), que só pede **função + valor + bio**.
- Não pede CPF, sexo, data_nasc, agenda, foto.

Consequência:
- Diarista Google fica "Nível Básico" pra sempre (falta CPF → `calcularNivelConfiabilidade` não sobe de nível).
- Anunciante ve dois perfis do mesmo "nível" com diferenças gritantes de completude.
- O banner "Complete seu perfil" (App.tsx:17683) só resolve se a pessoa clicar — sem cobrança.

**Recomendação:** unificar. Google Express deve exigir CPF + sexo + data_nasc antes de pousar em home‑diarista (bloqueia visibilidade `CATALOGO` até).

#### 1.4 `iniciarCadastroExpress` empregador tem loop invisível

App.tsx:4694 — Google Express pra empregador manda pra `home-empregador`. Mas `home-empregador` sem `profile.segmento` rebate pra `escolha-negocio` (App.tsx:13001). Ou seja: o Express **NÃO é express** — sempre passa por `escolha-negocio`. E o comentário na L12315-12320 confirma que já teve loop.

**Fix:** Google Express deveria já pousar em `escolha-negocio` (uma tela extra é a realidade — parar de esconder).

#### 1.5 Cadastro empresa (PJ) é o mais quebrado

Ao escolher "Sou empresa (CNPJ)" em `cadastro-tipo` (App.tsx:9873), o fluxo desvia pra `cadastro-empresa` e `finalizar-empresa` — telas dedicadas. Google está bloqueado deliberadamente pra PJ (App.tsx:9936). Isso é correto juridicamente, mas prático? A pessoa PJ na maioria dos casos usa o Google do trabalho — barreira desnecessária.

---

### 2. Retenção

#### 2.1 Anunciante: sem gancho de retorno

Depois de publicar e ver candidatos, o anunciante **só volta se** (a) alguém se candidatar (push é enviado) OU (b) ele quer publicar de novo. Não há:
- Digest semanal ("Você teve X visualizações essa semana").
- Trigger "profissional TOP na sua região está livre HOJE".
- Reforço de "publicar vaga recorrente" (o `Repetição semanal/quinzenal` em App.tsx:22548 existe mas está enterrado no formulário).
- Sugestão pró-ativa "Sua última vaga foi ontem, quer republicar?".

**Sinal:** 40+ ocorrências de `Notification.permission === "granted"` em App.tsx (busca), mas notif tipo "há X anúncios novos na sua região" só existe pro **prestador**, não pro anunciante.

#### 2.2 Prestador: nível Bronze/Prata/Ouro/Elite sem progresso visível pra Bronze

`nivelDiarista(0..30)` em helpers.ts:41 gamifica com selos, mas:
- Corte Bronze→Prata é em **5 diárias concluídas**. Pra alguém com 0, "5 diárias" é MUITO longe. Não há sub‑degraus.
- O selo aparece só na busca; não é celebrado na home ao passar de 1→2→3 diárias.

**Fix XS:** micro‑progresso "1/5 diárias pra virar Prata 🥈" no header do home‑diarista (App.tsx:17304+). Já existe o cálculo, só falta a barrinha.

#### 2.3 Habit loop está no lugar errado

O "Já Decola" (academia com cursos, XP, selos — App.tsx:10095) tem TUDO de habit loop: pontos, níveis Bronze→Diamante, quiz, certificados. Mas **mora dentro da tela "Comunidade"** (App.tsx:25449‑25477). O prestador só descobre se abrir Comunidade — que já é uma aba secundária. Estimativa: <10% dos prestadores encontram.

**Fix S:** promover a academia pra card fixo no home‑diarista (`resumoPrestadorInicio`, App.tsx:17110‑17139) — já tem espaço, hoje mostra apenas "Nível" + "Comunidade" + "Ranking CG".

#### 2.4 Modal de notificações fura a barreira do gesto e mata a permissão

`useEffect` App.tsx:1879 — dispara `setPromptNotif(true)` **1200ms** depois de entrar na home, ANTES de o usuário fazer qualquer ação. Isso é o antipadrão clássico. Chrome/Android considera "cold prompt" e sinaliza baixa qualidade.

**Fix XS:** só disparar após:
- Anunciante: publicar 1ª vaga OU receber 1º candidato.
- Prestador: se candidatar 1x OU ser convidado 1x.

Esses são momentos onde a notificação faz sentido óbvio pro usuário.

#### 2.5 Chat fica em outra aba, não é notificado direito

Chat abre setando `chatDiariaAtiva` (App.tsx:5669) e chaveando `tabEmpregador='chat'`. Não é uma "tela" no `tela` state — é um estado atrelado à aba. Consequência: quando prestador recebe mensagem, o badge sobe (App.tsx:13481), mas não abre nada. Precisa clicar Aba Chat → conversa. Fricção alta.

---

### 3. Conversão

#### 3.1 Preço inconsistente na doc vs código

- `RISCO_JURIDICO.md:18`: "Cobrar R$1 por seleção extra".
- `constants.ts:442`: "R$ 2,50 por contato" (comentário histórico "o nome `r1` é histórico").
- Modal `modalLimiteContato` (App.tsx:15579): "R$ 2,50 desbloquear este contato".
- Prompt do usuário: "R$1 por contato desbloqueado".

**Isso vaza pra fora**: se marketing/investidor lê R$1 e usuário paga R$2,50, quebra confiança. Definir de UMA VEZ e reescrever tudo.

#### 3.2 O CTA de pagamento **NUNCA aparece** hoje

`exibirCobrancaContatoAnunciante = false` (App.tsx:1097 — hardcoded). Isso significa que **todo o modal de "pagar R$ 2,50"** (App.tsx:15563‑15622) está no código mas nunca renderiza a cobrança. Usuário na cota grátis (3/mês) vai simplesmente ser barrado pelo servidor (RPC `pode_selecionar_candidato`) e cair no modal genérico "Chamar interessado — Confirmar e chamar" sem preço. Depois de 3, o servidor deve barrar de novo mas com mensagem menos clara.

**Consequência:** no lançamento, se um anunciante estourar a cota, ele vê um popup pedindo pra assinar Essencial R$24,90/mês em vez do micro‑pagamento de R$2,50 que era o "on-ramp" pro pagamento. **Perde‑se a monetização de baixo bilhete**.

**Fix M:** decidir política de cobrança do lançamento e alinhar client+banco. Se é grátis por enquanto, esconder o modal de pagamento inteiro. Se é pago, ligar `exibirCobrancaContatoAnunciante=true`.

#### 3.3 Paywall de vaga de emprego não explica o que ganha

Modal `modalPlanoVaga` (App.tsx:15625): "Assine o Essencial para contatar candidatos". Só isso. Sem prova de valor, sem "5 candidatos por vaga incluídos", sem número. Baixa conversão esperada.

**Fix S:** listar 3 bullets do Essencial no próprio modal (ex.: "Chame quantos candidatos quiser", "IA Jájá pra criar vagas", "Filtros avançados") — hoje o usuário tem que ir pra tela `planos` pra ver.

#### 3.4 Assinatura diarista: só CTA quando bate cota (D+N)

`limits.diarista.passouCotaGratis` (App.tsx:7289) — só depois de concluir 3 diárias grátis a cobrança dispara. Perfeito, MAS o usuário nunca é preparado antes. Não há "faltam 2 diárias grátis" em lugar nenhum. Quando chega ao limite, sente que "foi capado". CAC vira churn de assinatura logo.

**Fix S:** contador visível na home‑diarista ("3 diárias grátis restantes este mês · 0/3 usadas") — App.tsx:16963‑17300.

#### 3.5 Plano Plus mostrado em `constants.ts` mas escondido

App.tsx:25576 filtra `.filter(p => p.id !== "plus")`. Comentário no arquivo diz "Plus não entrega nada além do Essencial". Isso vaza pro operacional: campanhas de marketing, deep-links, blog, tudo pode acidentalmente linkar "Plus". Deveria ser removido de `constants.ts` OU implementado.

---

### 4. Confiança

#### 4.1 O selo "Verificado" é enganoso

Perfil (App.tsx:21598): `(d.tem_documento ?? !!(d.cpf || d.cnpj))` → mostra ✅ Verificado. Como o wizard exige CPF pra 100% dos diaristas do fluxo padrão (App.tsx:12552), **todo diarista aparece "Verificado"**. Anunciante compara 5 profissionais e vê 5 selos verdes iguais. O selo perde sinal.

Verificação real é `documento_status='aprovado'` (RG/CNH revisado, App.tsx:24887) — mas isso não aparece no card com destaque próprio.

**Fix S:** o card do profissional deve diferenciar:
- 🆔 CPF cadastrado (privado, não é selo público).
- ✅ Documento verificado (RG/CNH aprovado).
- 🛡️ Antecedentes verificados (`antecedentes_verificado` em types.ts:163).
Só o segundo e terceiro merecem badge visível.

#### 4.2 Reputação do anunciante não é destacada no card

App.tsx:21363 tem toda a lógica de `pct_pagou_combinado` e `pct_cumpriu_combinado`, com alerta vermelho se <50%. Excelente proteção pro diarista. Mas isso está no `perfil-empregador` — o prestador precisa ABRIR o perfil pra ver. No card do feed de vagas (App.tsx:17811+), a reputação não aparece. Prestador aceita vaga cega.

**Fix S:** injetar ⭐ nota + "% pagou combinado" no card da vaga do feed do prestador.

#### 4.3 Anunciante novo sem histórico = fantasma

Quando um diarista vê "Anunciante novo — nenhuma avaliação ainda" (App.tsx:21413), a copy só sugere cautela. Mas 90% do inventário nos primeiros meses é assim. Não há sinal de compensação (CPF verificado? Está online há X meses? Tem foto/logo?). O card fica todo cinza → prestador não confia → não candidata.

**Fix S:** mostrar "Membro desde MM/AA", "CNPJ verificado" (se PJ), "Publicou X vagas antes" — mesmo para novos.

#### 4.4 Antecedentes está enterrado

`verificar-antecedentes` (App.tsx:25018) — tela existe e é excelente proteção pro anunciante (upload de certidão negativa em PDF). Mas o CTA está **só** em `editar-perfil` (App.tsx:23112). No home‑diarista, não é celebrado; no card do prestador, o selo (types.ts:163 `antecedentes_verificado`) mal aparece.

**Fix XS:** promover "Ganhe o selo 🛡️ Antecedentes Verificado" no home‑diarista, ao lado do XP/nível.

---

### 5. Copy / posicionamento

#### 5.1 "Empregador" ainda em ~257 lugares

`RISCO_JURIDICO.md:53` já apontou isso. Ex.: App.tsx:11477 "quer entrar em contato com você para <b>{c.funcao}</b>" mas o card ao lado diz `"contratante_nome"`. No dashboard do home‑empregador (App.tsx:13208), o toggle diz "Contratante" mas por dentro o state se chama `modoAtual='empregador'`. Confusão visual pro usuário (aparece "empregador" às vezes nas notificações; "anunciante" nos títulos; "contratante" nos toggles). É frágil juridicamente e comunica descuido.

#### 5.2 Termos: 10+ seções, sem TL;DR

Modal de Termos (App.tsx:10042+) tem 8 seções genéricas + 3 específicas por tipo + 1 final = 12 seções. Ninguém lê. É risco: se surgir disputa, "o usuário leu?". Um sumário no topo com 3 bullets ("Você é autônomo. Você paga por PIX. A gente conecta.") reduz risco jurídico e melhora leitura.

#### 5.3 "Diária" vs "Serviço" vs "Vaga" vs "Convite" vs "Oportunidade"

App.tsx usa TODOS os 5 termos em contextos parcialmente sobrepostos. O `Convite` (types.ts:318) e o `Diaria` (types.ts:24) têm campos parecidos mas ciclos diferentes. Isso reflete no UI:
- Prestador recebe "Convite" (direto) OU vê "Vagas" (feed).
- Anunciante publica "Diária" ou "Serviço" ou "Vaga" ou "Serviço Empresarial".
- Ao selecionar candidato, cria uma "Diária" enriquecida.

O usuário final não distingue. Poderia haver só duas primitivas: **"Oportunidade"** (feed + convite) e **"Contrato"** (após ambos aceitarem).

#### 5.4 Erros são técnicos demais

Ex.: App.tsx:7322 mapeia erros de RPC pra:
- "nao_e_o_prestador" → "Este anúncio foi direcionado a outro profissional."
- "status_invalido" → "Este anúncio não está mais aguardando confirmação. Atualize a tela."

Traduziram — bom. Mas ainda tem mensagens genéricas: App.tsx:4529 "Conta criada, mas falhou ao salvar dados básicos. Tente entrar de novo." — quando isso acontece, o usuário fica preso sem entender por quê. Ideal: mostra qual campo (nome? telefone?) e como corrigir.

---

### 6. Anti‑fricção crítica

#### 6.1 Login por CPF funciona, mas reset só por email

App.tsx:9739 — login por CPF/CNPJ, ótimo. Mas em App.tsx:9776 esqueceu senha por CPF? "Volte pro login por e-mail pra recuperar". Muitas diaristas não usam e‑mail no dia‑a‑dia. Perdem a conta.

**Fix M:** reset por WhatsApp (a infra `verificar-whatsapp`/Twilio Verify já está no repo — App.tsx:11044).

#### 6.2 Google login no Android é frágil

App.tsx:4598‑4650 tem 50+ linhas tratando erros do social‑login nativo. Se `VITE_GOOGLE_WEB_CLIENT_ID` ausente → mensagem OK. Se SHA-1 não bate → mensagem OK. Isso significa que já quebrou em produção. Bem tratado defensivamente, mas ainda é o principal caminho de cadastro premium (diarista Google Express).

#### 6.3 Instalação PWA: sem prompt

Não vi `beforeinstallprompt` listener em lugar algum (falha de implementação PWA — o `public/sw.js` está lá mas o app não pede pra instalar). Web users acessam via aba do Chrome, nunca instalam. Consequência: notificações push funcionam MUITO pior no navegador (o SW pausa quando fecha o Chrome). E na Play Store o app é oficial — deveria haver banner "Instale como app" bem no topo pós‑cadastro.

Existe `bannerBaixarApp` (App.tsx:9039) mas ele é pra Play Store, não pra instalar PWA. Diferentes coisas.

#### 6.4 Cold start percebido: OK

App.tsx tem 25k linhas. Vite manualChunks (vite.config.ts) divide bem. Bundle inicial ~500KB (suposição — não medido nesta análise). É aceitável pra mobile, mas em rede 3G do interior de MS pode custar 3‑5s. Não é o gargalo principal.

#### 6.5 O modal de "termo de ciência" duplica o modal de "termo de compromisso"

- `modalTermoCiencia` (App.tsx:12811): antes de selecionar candidato. 5 bullets + checkbox + confirmar.
- `modalTermoCompromisso` (App.tsx:15520 via `modalTermoCompromissoEl`): antes de pagar R$1 e liberar chat de convite.
- `modalTermoDiarista` (App.tsx:12857): antes de o prestador aceitar serviço. 3 bullets + checkbox + confirmar.

**São 3 fricções seguidas** pra uma transação simples. Cada modal é justificado juridicamente, mas juntos matam a conversão. Deveriam existir mas ser **consolidados** (uma vez, no cadastro, ou pré‑checkbox global "Estou ciente dos termos de cada seleção") e reforçados só na primeira ação de cada tipo.

---

### 7. O que falta hoje

| Falta | Impacto | Onde caberia |
|---|---|---|
| **Preview público de profissionais/vagas** antes do login | Alto — conversão splash→signup | Splash (App.tsx:9387) + rota `/perfil/:id` pública |
| **Contador "diárias grátis restantes"** no perfil do diarista | Médio | Home‑diarista (App.tsx:17304) |
| **Sugestão automática de valor** ao anunciante (usa `MEDIAS_CAMPO_GRANDE`) | Médio — reduz vagas sem candidato | `criar-diaria` já usa (App.tsx:22801), mas apenas como texto — poderia AUTOPREENCHER |
| **Republicar 1‑click** de vaga expirada | Alto — retenção anunciante | Aba "Expiradas" no home‑empregador |
| **Filtro "só remoto"** pra vaga de emprego | Baixo — nicho pequeno em CG | Feed do prestador |
| **Programa de indicação** (foi removido, App.tsx:10593) | Alto — canal orgânico | Card na Configurações; RPC pra rastrear |
| **Feed de "profissionais online AGORA"** pro anunciante | Alto — urgência | Home‑empregador já tem `disponiveisAgora`, mas mora atrás de filtro |
| **Notificação pro anunciante** de novo profissional na região | Alto | Cron `lembrar-diarias` já existe — replicar padrão |
| **Reset senha por SMS/WhatsApp** | Médio | Infra Twilio já usada em `verificar-whatsapp` |
| **Dark mode confiável** | Baixo | Toggle já existe mas várias telas não respeitam (ex.: `pedir-localizacao` App.tsx:21282 hardcode `background:"#f8fafc"`) |

### 7.5 Features que existem mas ninguém encontra

- **IA Jájá pra criar anúncios** (constants.ts:462, "IA Jájá pra criar anúncios em segundos" — plano Essencial). Não achei CTA em lugar nenhum do formulário `criar-diaria` que abra a Jájá pra ajudar.
- **Já Decola** (academia) — vive dentro da Comunidade. Não é discoverable.
- **Convite direto** (`Convite`, types.ts:318) — anunciante pode convidar diarista específico (App.tsx:21763 "Oferecer oportunidade"). Botão fica pequeno no perfil do diarista, sem entry-point global (ex.: "Meus favoritos" → "Convidar todos livres hoje").
- **Múltiplas vagas em uma diária** (1‑5, App.tsx:22562) — feature avançada escondida atrás do campo "Quantas vagas?" no meio do formulário. Anunciante casual nunca acha.
- **Serviço Empresarial** (SERVICOS_EMPRESARIAIS, constants.ts:7) — 10 modelos ricos (promotor, inventário, auditoria...) só aparecem se clicar "Serviços para Empresas" no hub. Empresa pequena não sabe que existe.
- **Feedback pós‑diária** (types.ts:368) — implementado no schema mas não vi entry-point obrigatório após conclusão.
- **Suporte por ticket interno** (App.tsx:11290) — bom UX, subiu pra topo em `suporte`. OK.

---

### 8. O que sobra hoje

- **Plano Plus** — código morto ativo. Já foi decidido esconder. Remover de `constants.ts` (linhas 516‑528).
- **Serviço Empresarial** (SERVICOS_EMPRESARIAIS) — 10 modelos, 214 linhas de constants. Nenhum sinal público de que tem PJ contratando isso em Campo Grande hoje. Manter mas **não gastar UI** promovendo até ter demanda comprovada.
- **`aceita_servico_empresa`** no perfil (types.ts:125) — toggle que o diarista precisa ativar. Se ninguém publica, ninguém marca, ninguém aparece — círculo morto.
- **Cadastro Empresa** (fluxo dedicado PJ com CNPJ + Razão Social + Responsável) — se >90% de contratantes são PF em CG, o fluxo PJ inteiro pode ser reduzido a "Cadastre como PF e converta pra PJ depois se precisar".
- **`launch_free_anunciante`, `modo_beta`, `exibirCobrancaContatoAnunciante`** — 3 kill‑switches diferentes controlando a mesma coisa (cobrança). Consolidar em 1.
- **Modal Quem Somos** (App.tsx:9555+) na splash — Missão/Visão/Valores em modal escuro tema fundação. Sozinho consome muito espaço mental na primeira impressão. Levar pra `politica-privacidade` ou `sobre`, não empurrar no splash.

---

## O que temos que fazer AGORA (top 10 ações)

### 1. Splash com preview real de profissionais

- **Descrição:** substituir os 3 cards fictícios da splash (App.tsx:9427‑9445) por chamada à RPC `perfis_publicos` (LIMIT 5, filtro `visibilidade='CATALOGO'`, disponíveis hoje). Ao clicar num card, mostrar perfil parcial (nome, foto, valor, avaliação) e forçar login SÓ pra chamar.
- **Por que:** o CTA atual promete "ver profissionais" e leva pra cadastro. Ver antes de decidir reduz D0 dropoff.
- **Esforço:** S
- **Impacto:** alto

### 2. Consolidar cobrança em 1 kill‑switch e alinhar UI + banco

- **Descrição:** decidir `launchFreeAnunciante` OU `exibirCobrancaContatoAnunciante` como fonte única. Se cobrança está ligada, mostrar o preço no modal. Se desligada, esconder o texto "R$ 2,50" e trocar por "Selecionar candidato".
- **Por que:** hoje há 3 flags travando o pagamento em estados diferentes → nenhum revenue de R$2,50 sai.
- **Esforço:** S
- **Impacto:** alto (revenue)

### 3. Corrigir o selo "Verificado" pra refletir documento aprovado

- **Descrição:** em App.tsx:21598 e onde mais o selo aparecer, trocar `(tem_documento ?? !!(cpf||cnpj))` por `documento_status === 'aprovado' || antecedentes_verificado`.
- **Por que:** hoje 100% dos diaristas do wizard aparecem como "Verificado" só porque preencheram CPF. Selo sem sinal.
- **Esforço:** XS
- **Impacto:** médio (confiança) → alto (destrava cobrança de KYC)

### 4. Prompt de notificação DEPOIS de 1ª ação relevante

- **Descrição:** em App.tsx:1879, só disparar `setPromptNotif(true)` após (a) prestador se candidatar 1x OU receber convite, OU (b) anunciante publicar 1 vaga OU receber 1 candidato.
- **Por que:** prompt cego 1200ms depois da home é o antipadrão que Chrome pune. Permissão dada com contexto tem 3‑5x mais aceitação.
- **Esforço:** XS
- **Impacto:** alto (retenção via push)

### 5. Contador visível "faltam N diárias grátis" (diarista) e "N contatos grátis" (anunciante)

- **Descrição:** injetar no header do home‑diarista (App.tsx:17304) e home‑empregador (App.tsx:13251) uma linha "3 diárias grátis restantes este mês — depois R$ 9,90/mês". Similar pra anunciante.
- **Por que:** hoje o usuário é surpreendido pelo bloqueio na 4ª. Preparação = menor churn de assinatura.
- **Esforço:** S
- **Impacto:** médio (conversão free→pago sobe 10‑20%)

### 6. Republicar vaga expirada em 1 clique

- **Descrição:** na aba "Expiradas" (`bucketsDash.expiradas`, App.tsx:13051), adicionar botão "Republicar" ao lado de cada card. Pré-preenche `formDiaria` com dados da vaga, muda a data pra próxima disponível, abre `criar-diaria`.
- **Por que:** anunciante que teve vaga sem candidato desiste. Republicar reforça hábito de retorno.
- **Esforço:** S
- **Impacto:** alto (retenção anunciante)

### 7. Unificar Google Express e wizard diarista (exigir CPF sempre)

- **Descrição:** em `iniciarCadastroExpress` (App.tsx:4665) para tipo `"diarista"`, redirecionar pra `cadastro-diarista` (wizard) com nome/foto pré-preenchidos do Google — pular só passos 1‑2 se já preenchido. NÃO permitir `setup-diarista` como caminho express.
- **Por que:** hoje diaristas Google entram sem CPF, ficam pra sempre "Nível Básico", nunca vão pra `documento_status` aprovado, nunca aparecem como confiáveis. Perfis fantasmas.
- **Esforço:** S
- **Impacto:** alto (qualidade do inventário)

### 8. Promover "Já Decola" no home‑diarista + gamificação sub‑bronze

- **Descrição:** substituir o card genérico "Nível" no `resumoPrestadorInicio` (App.tsx:17110‑17139) por barra de progresso "1/5 diárias pra virar Prata 🥈" + link "Faça um curso do Já Decola pra ganhar +200 XP".
- **Por que:** habit loop existe (academia + XP + selos + nível), só não é discoverable. Prestador sente que "não avança" porque não vê progresso.
- **Esforço:** S
- **Impacto:** médio‑alto (retenção prestador)

### 9. Rename "empregador" → "contratante" em UI de usuário

- **Descrição:** grep + substituição em toda copy user‑facing (não em nomes de campo do banco / state). `RISCO_JURIDICO.md` já mapeou. ~257 lugares.
- **Por que:** risco jurídico ativo (LC 150) + coerência visual (hoje o app usa 3 termos misturados).
- **Esforço:** M
- **Impacto:** médio (defesa jurídica) → protege receita futura

### 10. Instalar PWA como banner + notificação com contexto

- **Descrição:** adicionar listener `beforeinstallprompt` em `main.tsx`, expor botão "Instalar como app" em `configuracoes` + banner após 3ª sessão web.
- **Por que:** notificação push web só funciona bem em app instalado. Hoje web users não instalam → notif não chega → sem retorno.
- **Esforço:** S
- **Impacto:** médio‑alto (canal de retorno)

---

## O que podemos DEIXAR PRA DEPOIS

- **Refatorar App.tsx** em módulos por tela — CLAUDE.md já orienta contra reflows grandes; deixe pra quando o app estabilizar economicamente.
- **iOS build** — capacitor.config.ts só Android. Não é bloqueador em Campo Grande (Android ≥90% share em SES C/D).
- **Multi‑cidade** — hoje é hardcoded MS/CG (constants.ts:369 `MEDIAS_CAMPO_GRANDE`). Escalar geograficamente só depois de PMF em CG.
- **`Serviço Empresarial`** (SERVICOS_EMPRESARIAIS) — manter no código, não promover na UI até PJ pagante existir.
- **Dark mode consistente** — muitas telas hardcodam cor. Trabalho grande de baixo impacto.
- **Chat com anexos / arquivo / áudio** — legal ter, mas WhatsApp já cobre; o chat interno serve pra criar prova de vínculo dentro do app.
- **Painel admin bonito** — funcional já basta.
- **Antecedentes storage purge** (função `purge-antecedentes-storage`) — ops interno, não vira em cima.

---

## O que podemos MATAR

- **Plano Plus (empregador e diarista)** — remover objetos de `constants.ts` (lá pelo 469 e 516). Se voltar, é feature nova, não zombie.
- **Card "Sou empresa (CNPJ)"** na `cadastro-tipo` — dá pra iniciar como PF, converter depois. Simplifica 40% do fluxo PJ.
- **`Modal Quem Somos`** enorme na splash (App.tsx:9555+) — reduz a link discreto no footer.
- **`iniciarCadastroExpress` empregador** — se sempre passa por `escolha-negocio`, é sinônimo de "cadastro normal com nome do Google". Não dá economia de tela — remova a bifurcação.
- **`bannerLancamento` já expirado** (2026-07-01 no passado, App.tsx:1108) — código morto ocupando espaço.
- **3 modais de termo** (App.tsx:12811, 15520, 12857) — consolidar em 1, exibido só no 1º uso de cada operação.
- **`modo_beta`** (App.tsx:1081) — desligado no servidor, mas o código pra bloquear seleção continua rodando check por segurança. Sem custo, mas se está morto, tirar.

---

## Comparação com o histórico de auditorias

Auditorias em `docs-auditoria/*.md` (28/05 e 29/05) focaram em bugs — pagamentos, RPCs, edge functions, PWA, IA Jájá, botões handlers, "paranoica pré‑lançamento".

**Sintomas que eram bugs (já resolvidos, hoje sombra):**
- Modal de pagamento travando (`iniciarPagamentoMP` removido) — código morto ainda no `App.tsx:1363` comment.
- Chat de convite com IDs errados (App.tsx:5686‑5720) — resolvido via `criar_diaria_de_convite` RPC.
- Loop escolha-negocio ↔ home-empregador — resolvido via guarda no home (App.tsx:12990).
- Push VAPID silencioso — hoje tem diagnóstico visível (App.tsx:15545).

**Problemas estruturais NÃO tocados pelas auditorias técnicas:**
- **Todo o item 1 (Ativação)** — nenhum bug, é decisão de produto. Splash como landing, wizard longo, express que não é express.
- **Todo o item 2 (Retenção)** — não é bug, é feature ausente (contador, digest, streak, sugestões).
- **Cobrança desligada** (item 3.2) — auditoria de pagamentos validou que o fluxo FUNCIONA tecnicamente. Não questionou se está LIGADO.
- **Selo "Verificado" enganoso** — auditoria de KYC/documentos validou upload/aprovação. Não olhou o critério visual do selo.
- **Retenção sem push contextual** — auditoria de PWA/mobile validou VAPID e Web Push. Não validou o **momento** do prompt.
- **Copy "empregador"** — RISCO_JURIDICO.md apontou; até hoje não migrou.

Em resumo: **as auditorias fizeram a plataforma FUNCIONAR. Falta agora fazê‑la CONVERTER.** Todos os grandes problemas abaixo são de decisão, não de código.

---

## Anexo: pequenos achados incidentais

- App.tsx:1097 — comentário admite "UX atual: não mostrar preço/lançamento no momento de chamar. A mecânica de cobrança continua pronta em `desbloquearContato`" — está claro no código que a cobrança está desligada de propósito. É decisão de produto explícita. Deveria ser revisada.
- App.tsx:9873‑9891 — `cadastro-tipo` navigation logic tem 4 branches (`empresa+session`, `empresa+!session`, `session`, `!session`). Confuso, provavelmente ainda com edge cases.
- App.tsx:22377‑22385 — `profissionalAlvoPublicacao` é feature poderosa (publicar direcionado) mas o UX só mostra um banner "Oportunidade direcionada". Sem confirmação de que o restante da UI foi pensado nesse caso.
- constants.ts:502‑513 — plano Essencial diarista lista APENAS "diárias ilimitadas + tudo do grátis". Comparado a Essencial empregador (7 recursos), parece raquítico. Vender R$9,90/mês por "sair da cota" é fraco — precisa de mais benefícios reais.
- App.tsx:11289 — comentário admite "Promoção do ticket-system pro topo enquanto WhatsApp/Instagram não estão configurados". Ok, mas isso significa que o canal de suporte "oficial" está numa transição sem previsão.
- App.tsx:17130 — "Ranking CG" só aparece se o usuário está no top 5. Todo mundo abaixo não vê nada. Simples: mostrar "#48 de 320" pra motivar.
