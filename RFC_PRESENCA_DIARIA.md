# RFC — Sistema de Presença e Ciclo de Vida da Diária

**Status:** Proposta para decisão
**Autor:** Engenharia (assistida por IA)
**Data:** 2026-05-30
**Decisores:** Produto · Engenharia · Operações · Jurídico (LGPD)
**Escopo:** `diarias` (ciclo de vida), check-in/check-out, expiração, lembretes push, anti-fraude.

> Objetivo deste documento: alinhar a equipe em **uma** arquitetura coesa para
> monitorar a presença do prestador na diária, corrigir os furos atuais e
> permitir uma decisão segura (e reversível por fases) antes de escrever código.

---

## 1. Contexto e problema

Hoje a diária tem um fluxo funcional, mas o **monitoramento de chegada é frágil**
e há um bug de ciclo de vida que gera confusão real para os anunciantes.

### 1.1 Sintoma relatado
> "Vejo diárias que já venceram e ainda pedindo o QR Code."

### 1.2 Causa raiz (confirmada no código)
A função de expiração (`helpers.ts → vagaExpirou`) **só expira `aberta` e `pendente`**:

```ts
if (!["aberta", "pendente"].includes(diaria.status)) return false;
```

Logo, uma diária **`aceita`** (diarista confirmou) ou **`em_andamento`** (check-in
feito) **nunca expira sozinha**. Como o botão "Mostrar QR" aparece para
`aceita`/`em_andamento`, ele continua aparecendo **indefinidamente** mesmo depois
do horário — é o "expirada ainda pedindo QR".

### 1.3 Furos estruturais
1. **Expiração é client-side** (`App.tsx:1023`): só roda quando o **anunciante abre
   o app**. Se ele não abrir, a vaga fica viva para sempre. Existe um cron pronto
   (`cron_expirar_vagas.sql`) mas **desativado**.
2. **Check-in não grava horário.** O scan do QR só faz `status → em_andamento`
   (`App.tsx:2860`). Não há `checkin_em`, nem localização, nem check-out.
   → **Impossível auditar** "quando chegou" / "quanto durou" → disputas insolúveis.
3. **Check-in é frouxo no servidor.** O cliente seta o status direto; o scanner do
   anunciante fica **sempre visível** (`App.tsx:8967`), sem filtro de status/janela.
   → QR de diária morta ainda "funciona".
4. **Sem lembrete.** Todos os pushes são event-driven (candidatura, mensagem…).
   **Não existe** "sua diária começa em 30 min" → o QR é simplesmente esquecido.
5. **Sem reembolso automático** no cancelamento (fora do escopo deste RFC, mas
   registrado).

---

## 2. Objetivos e não-objetivos

### Objetivos
- **O-1.** Toda diária chega a um estado terminal correto sem depender de alguém
  abrir o app (expiração/encerramento confiável no servidor).
- **O-2.** Registrar **quando** e **onde** o prestador fez check-in e check-out
  (trilha de auditoria para disputas).
- **O-3.** Tornar o check-in **autoritativo no servidor** (rejeitar diária fora de
  status/janela), eliminando o "QR de diária morta".
- **O-4.** Lembrar **ambas as partes** minutos antes da diária, reforçando a
  confirmação de presença.
- **O-5.** Oferecer um check-in **mais forte e com menos fricção** que o QR
  (geolocalização), mantendo QR/código como fallback.

### Não-objetivos (agora)
- Reembolso/estorno automático no cancelamento (Mercado Pago).
- Rastreamento contínuo de localização (só capturamos no check-in/out pontual).
- Geofencing em tempo real / cerca virtual com alertas.

---

## 3. Estado atual (resumo técnico)

| Aspecto | Hoje |
|---|---|
| Status | `aberta · pendente · aceita · em_andamento · concluida · cancelada · expirada` (CHECK constraint no banco) |
| Expiração | Client-side, só `aberta`/`pendente`; cron existe mas desativado |
| Check-in | QR `DIARIAJA:{id}` → anunciante escaneia → `em_andamento` (sem timestamp) |
| Fallback | Código de 4 dígitos (`codigoPresenca`) |
| Check-out | **Não existe** (anunciante marca `concluida` manualmente) |
| Timestamps | **Nenhum** de chegada/saída |
| Lembretes | **Nenhum** agendado |
| Cron infra | `pg_cron` disponível; usado p/ limpeza de rate-limit e purga LGPD |

---

## 4. Decisão de design (arquitetura proposta)

Princípio-guia: **o servidor é a fonte da verdade** do ciclo de vida e do
check-in. O cliente apenas dispara intenções; o banco valida e decide.

### 4.1 Máquina de estados revisada

Mantemos os **7 status** (sem mudar a CHECK constraint — menos risco). A novidade
é **transições por tempo** e a semântica de "no-show" derivada de colunas, não de
um status novo.

```
aberta ──(anunciante escolhe)──▶ pendente ──(diarista confirma)──▶ aceita
   │                                  │                               │
   │ (passou horario_fim)             │ (passou horario_fim)          │ check-in (QR/GPS/código)
   ▼                                  ▼                               ▼
expirada  ◀───────────────────────────┘                        em_andamento
   ▲                                                                  │
   └── aceita + passou da janela + SEM checkin_em ────────────────────┤ check-out
       (= "não compareceu": expirada com diarista_aceite_id e         ▼
        checkin_em IS NULL)                                        concluida

cancelada: alcançável de qualquer estado não-terminal (com motivo).
```

**Definições derivadas (sem novo status):**
- **No-show** = `status='expirada' AND diarista_aceite_id IS NOT NULL AND checkin_em IS NULL`.
- **Concluída sem check-in** (legado/manual) = `status='concluida' AND checkin_em IS NULL`.

**Regra de janela de check-in:** check-in válido somente em
`[horario_inicio − 30min, horario_fim + 2h]` (tolerância de chegada e de atraso).
Fora disso, o RPC recusa.

### 4.2 Modelo de dados — novas colunas em `diarias`

```sql
ALTER TABLE diarias
  ADD COLUMN IF NOT EXISTS checkin_em         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checkin_metodo     TEXT,          -- 'qr' | 'gps' | 'codigo'
  ADD COLUMN IF NOT EXISTS checkin_lat        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS checkin_lng        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS checkin_distancia_m INTEGER,      -- distância do endereço no check-in
  ADD COLUMN IF NOT EXISTS checkout_em        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lembrete_enviado_em TIMESTAMPTZ;  -- dedup do push de lembrete
```

Nenhuma coluna é obrigatória → migração aditiva e segura (re-rodável com `IF NOT EXISTS`).

### 4.3 Check-in unificado (3 métodos, 1 porta de entrada)

Toda confirmação passa por **um RPC `SECURITY DEFINER`** — o cliente nunca seta o
status diretamente:

```sql
registrar_checkin(p_diaria_id uuid, p_metodo text, p_lat float, p_lng float)
```
Regras dentro do RPC:
1. Diária existe e `status = 'aceita'`.
2. Agora ∈ janela de check-in (senão erro `fora_da_janela`).
3. Quem chama é parte da diária (anunciante OU o `diarista_aceite_id`).
4. Se `p_metodo='gps'`: calcula distância (haversine) do `lat/lng` da diária;
   exige `≤ RAIO` (ex.: 300 m). Acima disso → erro `muito_longe` (com a distância).
5. Grava: `status='em_andamento'`, `checkin_em=now()`, método, lat/lng, distância.
6. Idempotente: se já tem `checkin_em`, não sobrescreve.

**Efeito colateral que corrige o bug:** como o RPC só aceita `status='aceita'`
dentro da janela, um QR de diária expirada/cancelada/fora de hora é **recusado**.

**Quem faz o check-in por método:**
- **QR / código:** o **anunciante** confirma (escaneia/digita) — prova "os dois juntos".
- **GPS:** o **diarista** toca "📍 Cheguei" — prova presença no local, sem precisar
  do anunciante junto. (Mais forte para serviços onde o anunciante não está presente.)

### 4.4 Check-out

Botão **"Encerrar diária"** (anunciante e/ou diarista) → RPC `registrar_checkout`
seta `checkout_em=now()` e `status='concluida'`. GPS opcional no check-out.
Duração real = `checkout_em − checkin_em`.

### 4.5 Expiração e encerramento no servidor (cron)

Substituir a dependência do client. Função única, idempotente, agendada via
`pg_cron` (a cada 15 min):

```sql
expirar_e_encerrar_diarias():
  -- aberta/pendente vencidas  → expirada
  -- aceita vencida + janela passou + checkin_em IS NULL → expirada (no-show)
  -- em_andamento vencida há > 6h sem checkout → concluida (auto-encerra travadas)
```

Mantém o client-side como reforço (UX imediata), mas o servidor garante o estado
final mesmo se ninguém abrir o app.

### 4.6 Lembrete push antes da diária

Novo job agendado (`pg_cron` a cada 10 min) → Edge Function `lembrar-diarias`:
1. Seleciona diárias `status='aceita'` que começam em `[agora, agora+30min]` e com
   `lembrete_enviado_em IS NULL`.
2. Para cada uma, dispara **1 push para os dois** (anunciante + diarista):
   *"⏰ Sua diária começa às HH:MM. Na chegada, confirmem a presença pelo app."*
3. Marca `lembrete_enviado_em=now()` (dedup — nunca manda 2x).

Mecanismo: `cron.schedule` chama a Edge Function via `net.http_post` (pg_net), ou
Supabase Scheduled Function. Reusa o `send-push` já existente (RFC 8291/VAPID).

### 4.7 Portão de pendências — responsabilização antes de nova diária

Mecanismo de *accountability*: uma diária que termina de forma **anormal** vira uma
**pendência** que o criador precisa **explicar** antes de publicar outra. Só é
possível porque a Fase A passa a gravar `checkin_em` e a expirar no servidor.

**Quando uma diária vira pendência (precisa de desfecho):**
- `status='expirada'` **e** `checkin_em IS NULL` **e** `resolucao_motivo IS NULL`
  (ninguém pegou **ou** diarista aceitou e não compareceu).

**Novas colunas em `diarias`:**
```sql
ALTER TABLE diarias
  ADD COLUMN IF NOT EXISTS resolucao_motivo TEXT,        -- por que não aconteceu
  ADD COLUMN IF NOT EXISTS resolvida_em     TIMESTAMPTZ;
```

**Regras:**
1. **Cancelar exige motivo** — `motivo_cancelamento` passa a ser obrigatório no fluxo
   de cancelamento (já previsto na máquina de estados, hoje opcional).
2. **Nudge na criação (decisão do time: aviso insistente, NÃO impede)** — ao tocar
   "Criar diária", se o empregador tiver pendência nos **últimos 30 dias**, abre um
   modal/banner forte: *"Conte o que aconteceu na sua diária anterior."* com opções
   rápidas (1 toque): `diarista não compareceu` · `resolvi por fora` ·
   `não precisei mais` · `cancelei` · `prefiro não informar`. Responder grava
   `resolucao_motivo` + `resolvida_em`. **Pode prosseguir mesmo sem responder** — é
   reforço/coleta de dado, não bloqueio. (A mesma estrutura permite virar bloqueio
   total no futuro só trocando a flag — sem reescrever nada.)
3. **Reforço server-side (não nesta fase):** um trigger `BEFORE INSERT` poderia
   recusar criação com pendência — fica reservado para quando/se virar bloqueio duro.

**Escopo inicial (recomendação aceita): só o empregador.** O **no-show do diarista
já é capturado** desde a Fase A (`checkin_em IS NULL`); o portão do lado diarista
(bloquear candidaturas) fica como evolução guiada por dado, sem retrabalho.

**Anti-trap (regras de ouro):** sempre resolvível pelo próprio usuário; sempre há
opção neutra ("prefiro não informar"); só conta pendências recentes; nunca um beco
sem saída. O objetivo é **dado + responsabilização**, não punição.

**Simetria (decisão à parte):** o mesmo conceito vale para o **diarista** que dá
no-show — bloquear novas **candidaturas** até justificar. Alimenta reputação/confiança
e é mais valioso para o lado da oferta, mas é escopo separado deste portão.

**Valor:** reduz ghosting, gera dados operacionais ("por que diárias falham") e
melhora a confiança mútua do marketplace.

---

## 5. Linha do tempo de uma diária (visão integrada)

```
T−24h   diarista confirma → status 'aceita'
T−30m   [cron] push pros dois: "começa às HH:MM, confirmem presença"
T−5m    diarista chega → toca "📍 Cheguei" (GPS, dist 40m ✅)
         RPC: status 'em_andamento', checkin_em=now, metodo='gps', dist=40
         push pro anunciante: "Prestador fez check-in ✅"
T+3h    serviço acaba → "Encerrar diária" → checkout_em=now, status 'concluida'
         duração real = 3h05  (auditável)

— Cenário no-show —
T+2h    [cron] aceita vencida + sem checkin_em → status 'expirada' (no-show)
         (QR some; histórico marca não comparecimento)
```

---

## 6. Casos de borda e falhas

| Caso | Tratamento |
|---|---|
| Diarista nega permissão de GPS | Cai no fallback **QR/código** (anunciante confirma). Nunca bloqueia. |
| GPS impreciso / dentro de prédio | Raio tolerante (300 m) + permite QR como alternativa. |
| Chegou adiantado/atrasado | Janela `[início−30m, fim+2h]`; fora disso, recusa com mensagem clara. |
| Anunciante não marca check-out | Cron auto-conclui `em_andamento` vencida há >6h. |
| Relógio do celular errado | Tempo é sempre `now()` do servidor (no RPC), nunca do cliente. |
| Diária cancelada após check-in | `cancelada` é terminal; relatório mantém `checkin_em` para auditoria. |
| Push desativado | Lembrete é "best-effort"; a confirmação por GPS/QR não depende dele. |
| Re-scan / replay do QR | RPC idempotente + checagem de status/janela → recusa. |

---

## 7. Anti-fraude e segurança

- **GPS spoofing:** capturamos `accuracy` e distância; armazenamos para auditoria.
  Para diárias de maior valor, exigir **2 sinais** (GPS do diarista **+** QR do
  anunciante). Distância anômala → flag, não bloqueio cego.
- **QR replay / código vazado:** mitigado pela validação server-side de status +
  janela. O código de 4 dígitos é derivado do `id` (já existe) — suficiente como
  fallback de baixa frequência.
- **Autoridade:** todo estado muda só via RPC `SECURITY DEFINER` com checagem de
  que o chamador é parte da diária (RLS-aware).
- **Rate limit:** check-in/out e push já cobertos pela infra de rate-limit existente.

---

## 8. Privacidade / LGPD

- Localização é capturada **só nos eventos pontuais** de check-in/out — **não há
  rastreamento contínuo**.
- Finalidade: comprovação de presença e resolução de disputa. Declarar nos Termos.
- Retenção: lat/lng de check-in seguem o ciclo da diária; purga junto com a diária
  ou após N dias (alinhar com a política de retenção já existente — há cron de
  purga LGPD no projeto que serve de modelo).
- Minimização: guardamos coordenada do evento + distância, não trajeto.

---

## 9. Plano de rollout (em fases, reversível)

> Mesmo processo das fases anteriores: cada fase com SQL para aplicar no Supabase
> (quando houver) + PR. Fases independentes, cada uma entrega valor sozinha.

### Fase A — Fundação + correção do bug *(maior valor, urgente)*
- **SQL:** novas colunas; RPC `registrar_checkin` / `registrar_checkout`;
  função `expirar_e_encerrar_diarias`; **ativar** o cron de expiração.
- **Client:** QR/código passam a chamar `registrar_checkin` (grava timestamp);
  esconder QR fora da janela; mostrar duração quando houver check-out.
- **Entrega:** corrige "expirada ainda pede QR", cria trilha de auditoria, expira no servidor.

### Fase A.5 — Portão de pendências *(accountability)*
- **SQL:** colunas `resolucao_motivo`/`resolvida_em`; (opcional) trigger `BEFORE INSERT`.
- **Client:** cancelamento exige motivo; modal bloqueante de desfecho ao criar diária.
- **Entrega:** sem ghosting impune; dados de "por que a diária não aconteceu".
- **Depende da Fase A** (precisa de `checkin_em` + no-show server-side).

### Fase B — Check-in por GPS
- **Client:** botão "📍 Cheguei" no card do diarista → `registrar_checkin(metodo='gps')`.
- **Entrega:** presença com hora+local, menos fricção, pode dispensar o QR.

### Fase C — Lembrete push antes da diária
- **SQL/infra:** cron `*/10` + Edge Function `lembrar-diarias` + `lembrete_enviado_em`.
- **Entrega:** a ideia original — push pros dois X min antes.

### Fase D — Refinos
- Métricas no painel admin (% check-in, % no-show, atraso médio).
- Política de retenção de geodados (purga).
- (Futuro) reembolso automático no cancelamento.

---

## 10. Métricas de sucesso

- **% de diárias com check-in registrado** (meta: subir de ~0 mensurável → 70%+).
- **% de no-show** identificado automaticamente (hoje: invisível).
- **Atraso médio** (checkin_em − horario_inicio).
- **Disputas resolvidas com trilha** (qualitativo).
- **Diárias "presas"** em `aceita`/`em_andamento` (meta: → 0 via cron).

---

## 11. Riscos e mitigação

| Risco | Sev | Mitigação |
|---|---|---|
| `pg_cron` indisponível no plano Supabase | Média | Fallback: invocar a função por webhook/edge agendado externamente; expiração client-side continua como reforço. |
| Falsos "muito longe" por GPS ruim | Média | Raio tolerante + fallback QR; nunca bloquear pagamento por causa de check-in. |
| Push pouco adotado (opt-in) | Média | Lembrete é reforço; presença não depende dele. Incentivar opt-in. |
| Mudança em `App.tsx` (monólito) | Baixa | Alterações localizadas no card da diária + RPC; sem refactor amplo. |
| LGPD (geodados) | Média | Captura pontual, finalidade declarada, retenção/purga definidas. |

---

## 12. Decisão recomendada

**Aprovar a arquitetura "servidor como fonte da verdade"** e executar **Fase A
imediatamente** (corrige o bug relatado + cria a base de auditoria), seguida de
**B (GPS)** e **C (lembrete)**. O QR permanece como **fallback**, não como
mecanismo único.

> Resultado esperado: fim do "QR de diária morta", presença comprovável com
> hora/local, e os dois lados avisados antes de começar — sem depender de ninguém
> abrir o app.

---

### Anexo — Referências de código (estado atual)
- `helpers.ts:589` `vagaExpirou` (só `aberta`/`pendente`).
- `App.tsx:1023` expiração client-side.
- `App.tsx:2856` `confirmarInicio` (scan → `em_andamento`, sem timestamp).
- `App.tsx:8967` scanner do anunciante sempre visível.
- `App.tsx:12136` `mostrarQR` (`aceita`/`em_andamento`).
- `cron_expirar_vagas.sql` função de expiração server-side (desativada).
- `send-push` Edge Function (Web Push VAPID).
