# Análise Competitiva — Freela (vs DiariaJá)

*Data: 2026-07-24 · Escopo: apps brasileiros que se apresentam sob a marca "Freela" e disputam o mesmo espaço de marketplace de serviços pontuais.*

## Sumário executivo

- **Existem pelo menos 3 "Freelas" ativos no Brasil.** O mais análogo ao DiariaJá é o **Freela Já** (`br.com.freelaja.app`) — mesmo sufixo "Já", mesmo formato de chamados geolocalizados. O segundo é o **Freela Serviços** (`freelaservicos.com.br` / `com.freela.freelancers`). "Freela Brasil" é golpe (curso de marketing digital travestido de plataforma — Reclame Aqui) e foi descartado.
- **O Freela Já entrega duas coisas que o DiariaJá não tem hoje:** (1) **check-in / check-out por código no local**, transformando o "compareceu?" em prova operacional; (2) programa de **indicação com bonificação** ("Freela+") que dá chamados sem comissão como recompensa por trazer usuários. Ambos são de alto impacto e esforço médio.
- **Ambos os "Freelas" apostam em intermediar o pagamento pelo app** (PIX via plataforma). É o oposto da decisão consciente do DiariaJá (PIX direto entre partes). O Reclame Aqui do Freela Serviços mostra o *downside*: saque via PIX falhando, dinheiro preso, suporte que não responde. Confirma que a escolha do DiariaJá de não intermediar reduz superfície de suporte — mas custa a mensagem "sua diária é garantida".
- **Ambos os "Freelas" são hiper-verticais em eventos/gastronomia** (garçom, bartender, cozinheiro, DJ, recepcionista, músico). Não competem diretamente no núcleo do DiariaJá (faxina, delivery, jardinagem, beleza, construção, TI). Sobreposição real ~ garçom/festas particulares.
- **Nenhum dos dois tem penetração relevante em Campo Grande/MS** nas fontes públicas — Freela Serviços se diz "presente em todo o Brasil" mas admite "disponibilidade varia por região"; Freela Já não expõe cidades. Janela local do DiariaJá segue aberta.

---

## Identificação

Dado que a marca "Freela" é ambígua, mapeei o cenário antes de decidir o foco:

| App / URL | Pacote / Domínio | Vertical | Relevância p/ DiariaJá |
|---|---|---|---|
| **Freela Já** | `br.com.freelaja.app` | Eventos, gastronomia, bares, entretenimento, serviços gerais | **ALTA** — mesmo padrão de naming ("Já"), mesmo formato de chamado geolocalizado, mesmo público de trabalhador pontual |
| **Freela Serviços** | `com.freela.freelancers` / `freelaservicos.com.br` | Garçom, cozinheiro, churrasqueiro, recepcionista, músico, DJ, bartender | **MÉDIA** — mesmo formato de marketplace de serviços presenciais, mas 100% verticalizado em eventos/hospitalidade |
| eFreela | `com.lextar.efreelaapp` | Eventos, segurança, hotelaria, produção, motorista | Baixa — mais próximo de B2B / staffing temporário (GO, MG, SP, RJ, MA, AL). Cita 100k+ serviços realizados. |
| Freela Brasil / Freela.co / freelaapp.com | vários | Marketing digital / curso disfarçado / conceito | **DESCARTADO** — Reclame Aqui indica golpe (venda de curso via PIX travestida de plataforma) |
| GetFreela | `www.getfreela.com` | (Domínio não resolve — `ENOTFOUND`) | **DESCARTADO** — inexistente ou fora do ar |
| 99Freelas | `99freelas.com.br` | Design, dev, marketing (remoto) | **DESCARTADO** — freela remoto de conhecimento, público e formato totalmente diferentes |

**Foco do relatório: Freela Já (primário) + Freela Serviços (secundário).** Onde relevante cito eFreela e GetNinjas (modelo de "moedas" que é primo do R$1 do DiariaJá).

---

## Modelo de negócio (comparativo lado a lado)

| Dimensão | **DiariaJá** | **Freela Já** | **Freela Serviços** | GetNinjas (referência) |
|---|---|---|---|---|
| Quem paga a plataforma | Anunciante (empregador) | **Freelancer** paga comissão por chamado; anunciante gratuito | Ambos "grátis" — comissão embutida no valor intermediado | **Freelancer** compra "moedas" pra desbloquear cada lead |
| Preço | R$1 por desbloqueio de contato acima de 3 grátis/mês + assinaturas Essencial R$9,90-24,90 e Plus R$19,90-49,90 | Não divulgado publicamente. "Freela+" (assinatura/programa) dá "chamados sem comissão" ao atingir metas de indicação | Não divulgado publicamente. Se diz "sem taxa adicional ao contratante" — comissão fica implícita no fluxo de PIX intermediado | Moedas com preço variável por lead (categoria + região + concorrência) — valor por contato imprevisível, reclamação recorrente |
| Pagamento do serviço | **PIX direto entre partes** — plataforma NÃO intermedia (decisão explícita) | **PIX intermediado pelo app** com escrow | **PIX intermediado pelo app** | Não intermedia — negociação direta |
| Estorno | Não existe — só via MP no lado plataforma | Implícito no escrow — mas sem transparência pública | Reclamações públicas de saque travado e PIX que não valida | N/A |
| Superfície de suporte | Baixa (não gerencia dinheiro do serviço) | Alta (é responsável pela custódia) | Alta — e visivelmente sobrecarregado no Reclame Aqui | Média |

**Leitura crítica:** o Freela Já tem um modelo de monetização mais suave que o DiariaJá para o lado da demanda (empregador não paga nada), mas transfere o custo pro prestador — que é justamente o lado mais sensível a preço em serviços de baixo ticket. O DiariaJá acerta em cobrar do lado que tem intenção de compra confirmada (anunciante que já postou vaga e quer contato). GetNinjas comprova que o modelo "prestador paga pra ver" (leads sem retorno) gera revolta persistente há uma década.

---

## UX / Fluxo por persona

### Anunciante (contratante)

| Passo | **DiariaJá** | **Freela Já** | **Freela Serviços** |
|---|---|---|---|
| 1. Cadastro | Tipo → auth → perfil empregador → escolha categoria de negócio → setup | Cadastro por e-mail/senha (Firebase) | Cadastro por formulário (dados pessoais + do estabelecimento) |
| 2. Publicar vaga | Tela `criar-diaria`: categoria, endereço, data, valor, descrição | "Criar chamado" com região, tipo, data | "Informar tipo de profissional, data e local" |
| 3. Receber candidatos | Lista de candidaturas + convites diretos | Freelancers da região aplicam | Profissionais avaliados se candidatam |
| 4. Selecionar | 3 seleções grátis/mês; excedente = **R$1 por desbloqueio de contato** | Sem custo aparente (comissão está do outro lado) | Sem custo aparente |
| 5. Conversar | **Chat interno** por `diaria_id` | Mensagens rápidas no app + notificações | Não claro; provavelmente chat interno |
| 6. Pagar | **PIX direto (fora do app)** — plataforma não vê o dinheiro | PIX **pelo app** — plataforma faz escrow | PIX **pelo app** — plataforma faz escrow |
| 7. Confirmar execução | Feedback obrigatório pós-conclusão (`feedback_pos_conclusao`) | **Check-in + check-out por código** no local, validado no app | Não claro — provavelmente avaliação simples |
| 8. Avaliar | Estrelas + comentário (`avaliacoes_diarista`) | Estrelas + histórico | Estrelas + histórico |

### Prestador (freelancer / diarista)

| Passo | **DiariaJá** | **Freela Já** | **Freela Serviços** |
|---|---|---|---|
| 1. Cadastro | Auth → cadastro diarista → verificar telefone (Twilio Verify WhatsApp) → localização → KYC (documento, selfie, antecedentes opcional) | E-mail/senha + perfil | Formulário com dados pessoais e **documento de identidade** analisado antes de liberar |
| 2. Ver oportunidades | Home diarista com feed de diárias por proximidade + convites | **Filtro por raio de até 10km** + tempo real | Feed regional |
| 3. Candidatar-se | Botão "candidatar-se" na diária | "Aplicar" ao chamado | "Aplicar" ao chamado |
| 4. Contato | Espera anunciante desbloquear e mandar msg | Se selecionado, recebe notificação e conversa no app | Similar |
| 5. Executar | Compareceu, executou, avaliou | **Check-in por código no local + check-out por código** = prova de execução | Padrão (avaliação após) |
| 6. Receber | **PIX direto do anunciante (fora do app)** | **PIX intermediado — libera após check-out** | **PIX intermediado** |
| 7. Comissão | Zero pro diarista (não paga nada) | **Paga comissão por chamado, exceto se atingir metas do Freela+** | Sem taxa adicional (implícita) |

**Insights de UX:**

1. **Check-in/check-out por código no local** (Freela Já) é o mecanismo mais notável. Resolve a ambiguidade "compareceu ou não?" que hoje no DiariaJá depende do feedback verbal do anunciante. Alto valor operacional — reduz disputas, dá material factual para moderação, alimenta rating de confiança.
2. **Filtro por raio (10km)** — o DiariaJá já tem `haversineKm` em `helpers.ts` e geocoding em `user_profiles.lat/lng`. A distância aparece implícita no feed, mas expor um filtro "vagas até X km" seguindo o padrão do Freela Já daria controle explícito ao diarista, especialmente em cidade grande como Campo Grande.
3. **KYC leve vs KYC pesado.** Freela Já parece só e-mail/Firebase (leve). Freela Serviços exige documento e análise prévia. DiariaJá tem KYC completo com antecedentes criminais opcionais — está mais próximo do Freela Serviços, mas com política mais rica. Isso é diferencial defensivo.

---

## Categorias & foco geográfico

| | **DiariaJá** | **Freela Já** | **Freela Serviços** |
|---|---|---|---|
| Categorias | Faxina, delivery, jardinagem, beleza, TI, construção, cozinha, cuidados, pet, e mais (`CATEGORIAS_NEGOCIO`) | Eventos, gastronomia, bares, entretenimento, "serviços gerais" | Garçom, cozinheiro, churrasqueiro, recepcionista, músico, DJ, bartender |
| Horizontal vs vertical | **Horizontal amplo** | Vertical em eventos/gastronomia + "serviços gerais" (vago) | **Vertical duro** em hospitalidade / eventos |
| Foco geográfico | **Campo Grande/MS** com potencial de expansão | "Todo o Brasil" — sem cidades destacadas | "Todo o Brasil, disponibilidade varia" |
| Densidade local | Concentrada (bom pra liquidez) | Diluída | Diluída |

**Leitura:** os dois "Freelas" competem com o DiariaJá basicamente na categoria "festas particulares / eventos", que é fatia menor do escopo. O DiariaJá **não tem concorrente direto forte no seu núcleo** (faxina + serviços gerais residenciais em Campo Grande) sob a marca Freela. Parafuzo, Workfly e GetNinjas são os concorrentes reais nesse núcleo — não os Freelas.

---

## Verificação, confiança, chat

| | **DiariaJá** | **Freela Já** | **Freela Serviços** |
|---|---|---|---|
| Verificação de identidade | KYC completo: `kyc_documentos`, foto documento, selfie, antecedentes criminais opcional (PDF), verificação de telefone via Twilio WhatsApp OTP | E-mail/senha (Firebase). Nenhuma indicação pública de KYC forte | Documento de identidade **exigido e analisado antes de liberar cadastro**; validação de dados pessoais |
| Prova de execução | Feedback obrigatório do anunciante | **Check-in e check-out por código no local** = prova operacional | Avaliação após execução (sem check-in físico documentado) |
| Rating | Duplo (`avaliacoes_diarista`, `avaliacoes_empregador`) | Bidirecional | Bidirecional |
| Chat | Interno, por `diaria_id` (tabela `mensagens`) | Interno + notificações + "mensagens rápidas" | Não documentado publicamente — provavelmente interno |
| Bloqueio | `usuarios_bloqueados` (moderação chat) | Não documentado | Não documentado |
| Denúncia | `denuncias` | Não documentado | Reclamações públicas mostram suporte ausente |
| LGPD | Portabilidade (`export-user-data`), exclusão (`delete-user`), auditoria (`auditoria_acoes`) | Auto-declara aderência à LGPD | Auto-declara aderência |

O DiariaJá tem a maior superfície de confiança/moderação **em código**. Freela Já ganha em **prova operacional de comparecimento** (código de check-in/out); Freela Serviços não tem quase nada disso mas tenta compensar com barreira de entrada (documento na análise).

---

## Recepção do público (reviews, ratings, complaints)

Fontes fecharam com 403 (Reclame Aqui, Play Store) ao tentar WebFetch direto. Consolidado via WebSearch de fontes indexadas:

- **Freela Serviços — Reclame Aqui: reputação não definida** (menos de 10 reclamações avaliadas), **empresa não verificada, sem selo de confiança, 0% de resposta**. Reclamações amostradas mencionam: (a) sem vagas visíveis após cadastro, (b) impossibilidade de sacar dinheiro por "falha na validação da chave PIX", (c) chat de suporte não abre, (d) tentativa de cancelamento sem sucesso.
- **Freela Já (freelaja) — sem presença detectável no Reclame Aqui.** App recém-atualizado (última versão 23/jul/2026 conforme resultado indexado do Play Store). Volume público de reviews não recuperável nesta sessão (Play Store bloqueia WebFetch).
- **Freela Brasil (não confundir) — golpe conhecido:** "paga PIX por licença de plataforma de avaliação de mídia, entra e só tem vídeo ensinando outros sites". Muitas reclamações no Reclame Aqui via PerfectPay. É o esqueleto no armário da marca "Freela" — vale o DiariaJá se afastar visualmente disso na comunicação.

**Conclusão sobre reputação:** o Freela Já é jovem e ainda não acumulou casos, o Freela Serviços está apanhando cedo em pontos previsíveis (custódia de dinheiro + suporte lento). O nome "Freela" sozinho carrega ruído reputacional do golpe "Freela Brasil".

---

## O que copiar / adaptar pra DiariaJá (por prioridade)

### 1. Alto impacto, baixo esforço

- **Filtro explícito por raio na home do diarista.** Já existe `haversineKm` em `src/helpers.ts` e `lat/lng` em `user_profiles`. Adicionar um select "até 2/5/10/25 km" na `home-diarista` é ~1 dia. Copia direto o Freela Já e resolve queixa clássica de "não quero ir do outro lado da cidade por R$ 80".
- **Chamada visual de "compareceu?" mais dura no feedback pós-conclusão.** Freela Já dispensa perguntar porque tem o check-in code. Sem gastar em check-in, dá pra pelo menos: destacar a pergunta "o(a) diarista compareceu?" com dois botões grandes vermelho/verde na queue de `feedback_pos_conclusao` — hoje é passo enterrado no fluxo genérico de avaliação.
- **Antivírus reputacional de marca.** Freela Brasil (golpe) polui buscas por "Freela + app". Aproveitar em SEO/ASO: em texto do Play/App Store e no marketing, deixar claro "**DiariaJá — Campo Grande/MS · pagamento PIX direto entre partes, plataforma não segura seu dinheiro**". Diferenciar do saco "Freela" é ganho de imagem sem custo de engenharia.

### 2. Alto impacto, alto esforço

- **Check-in / check-out por código no local (padrão Freela Já).** É a única funcionalidade dos concorrentes que muda o jogo operacional. Implementação sugerida:
  - Ao criar diária, gerar um `codigo_checkin` (6 dígitos) e `codigo_checkout` (6 dígitos) armazenados em `diarias`.
  - Anunciante vê os códigos no card da diária no dia (com botão "copiar").
  - Diarista tem botão "check-in" que abre input e envia pro backend; RPC valida `codigo_checkin`, grava `checkin_at` e emite push pro anunciante.
  - Idem para check-out (destrava fluxo de avaliação e — potencialmente — de estorno do R$ 2,50 se houver disputa comprovada por falta de check-in).
  - Alimenta um badge de "prestador comprova presença" no perfil, complementando o rating.
- **Programa de indicação com recompensa (padrão Freela+).** Freela Já dá "chamados sem comissão" por meta de indicações. DiariaJá pode dar **desbloqueios grátis de contato** (moeda de troca do modelo R$1) por meta de indicação, ou meses grátis de Essencial. Precisa: código de indicação por usuário, tabela `indicacoes`, tracking, aplicação automática de crédito na `pode_selecionar_candidato`. Alavanca virais que hoje o app não tem — nada em `helpers.ts` ou nas RPCs sugere sistema de referral.

### 3. Baixo impacto (descartar ou postergar)

- **Intermediar o pagamento do serviço (PIX escrow).** Freela Já e Freela Serviços fazem — Freela Serviços está apanhando por isso no Reclame Aqui. Decisão original do DiariaJá (não intermediar) segue defensável. **Não copiar.** O que faz sentido é comunicar melhor a decisão ("por que não seguramos seu dinheiro").
- **Verticalização em eventos/gastronomia.** Os dois Freelas fazem — é diferente do posicionamento horizontal do DiariaJá. Manter a categoria "eventos" no `CATEGORIAS_NEGOCIO` sem investir em features específicas de garçonaria/bartender. O sinal de mercado dos Freelas é que **existe demanda organizada** de eventos, mas o custo de entrar num vertical dominado por marcas específicas do setor é alto — postergar até depois de consolidar Campo Grande.
- **Modelo de "moedas" tipo GetNinjas.** Já testado no mercado brasileiro há 10 anos com fricção reputacional altíssima ("comprei moedas e ninguém respondeu"). O R$1 fixo do DiariaJá é superior porque é ancorado num evento com intenção (o anunciante já quer aquele contato específico). **Manter.**

---

## O que EVITAR (bugs / decisões ruins observadas)

- **Custódia de PIX sem operação de suporte à altura.** Freela Serviços tem reclamações públicas de "PIX não valida no saque" e "não consegui abrir chat de suporte". Sempre que a plataforma segura dinheiro, uma janela de reclamação abre com previsibilidade. O DiariaJá evitou isso deliberadamente — reforçar essa decisão no roadmap.
- **KYC ausente enquanto o app promete profissionalismo.** Freela Já parece só ter cadastro por e-mail/Firebase. Isso pode virar problema quando escalar (falsos perfis, no-shows sem responsabilização). DiariaJá está mais protegido, não sacrificar isso na busca por "fricção zero".
- **Comissionar o lado ofertado (prestador).** Freela Já faz. Prestador de baixo ticket é o lado mais sensível a preço; comissão vira churn silencioso. DiariaJá cobra do lado com intenção confirmada (anunciante desbloqueando contato) — correto.
- **Reputação de marca borrada por golpe homônimo.** O termo "Freela" foi contaminado por "Freela Brasil". Evitar copiar linguagem/visual associada a esses golpes ("ganhe em dólar", "renda extra sem sair de casa", capas amareladas). DiariaJá tem uma identidade limpa, manter.
- **"Presente em todo o Brasil" sem densidade local.** Freela Serviços diz o clichê e admite na sequência que "varia por região". Marketplace de serviços pontuais é jogo de liquidez local — mensagem certa é hiper-local ("300+ diaristas ativos em Campo Grande" quando tiver o número), não "presente no Brasil todo". Já é o que o DiariaJá faz — manter.
- **Filtro sem regionalização quando o app funciona em várias cidades.** Freela Já tem raio de 10km, mas sem escolha de cidade — em cidade grande dá falso positivo. Se o DiariaJá expandir além de Campo Grande, o filtro precisa ser cidade+raio, não só raio.

---

## Fontes consultadas

Todas as tentativas de WebFetch direto (Google Play, Reclame Aqui, freela.com.br, freelaservicos.com.br, codificar.com.br, guiadofreela.com.br) retornaram 403. `www.getfreela.com` retorna `ENOTFOUND` (domínio não resolve). As informações abaixo foram obtidas por WebSearch (Google) e reconstruídas a partir dos snippets indexados de cada fonte:

- Freela Já — Google Play Store: `https://play.google.com/store/apps/details?id=br.com.freelaja.app`
- Freela Serviços — website: `https://www.freelaservicos.com.br/homepage`
- Freela Serviços — Google Play Store: `https://play.google.com/store/apps/details?id=com.freela.freelancers&hl=pt_BR`
- eFreela — Google Play Store: `https://play.google.com/store/apps/details?id=com.lextar.efreelaapp`
- Reclame Aqui — detector de site confiável (freelaservicos.com.br)
- Reclame Aqui — lista de reclamações "Freela" e "Freela Web"
- Reclame Aqui — casos "Freela Brasil / Perfect Pay" (contexto de golpe homônimo)
- Guia do Freela — "4 aplicativos para freelancer de serviços gerais"
- Guia do Freela — "Freela Brasil é confiável?"
- Codificar — "Aplicativos para trabalhar de diarista"
- 99Freelas Zendesk / blog — modelo de assinatura (Free 20%, Pro R$49,90/15%, Premium R$89,90/10%) — usado como benchmark
- Mobills / DMT em Debate / TechDrop — modelo de moedas GetNinjas (referência)

**Assunções e limitações declaradas:**

- Preços exatos do Freela Já e Freela Serviços não são divulgados publicamente e não foram acessíveis por WebFetch nesta sessão. Onde o relatório diz "não divulgado", isso é o estado real observado, não omissão.
- Métricas de download / rating / MAU dos apps competidores não puderam ser recuperadas — Play Store bloqueia WebFetch, e o campo não aparece indexado em snippets.
- Descrição da mecânica de check-in/check-out e do "Freela+" veio de descrições próprias dos apps no Play Store — não houve teste hands-on. Detalhes de UI podem variar.
- O julgamento sobre GetNinjas e Parafuzo se apoia em fontes indexadas + conhecimento prévio do mercado brasileiro; não houve inspeção nova nesta rodada.
