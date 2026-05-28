# Arquitetura — Painel de Suporte + Assistente Técnico Claude

Versão draft 1 — 2026-05-28
Status: **aguardando aprovação antes de implementar**

## Visão geral

Sistema de gestão de tickets de suporte embarcado no DiáriaJá, com assistente técnico Claude integrado pra acelerar diagnóstico, redação de respostas, propostas de fix de código e correções de dado controladas.

```
┌─────────────────────────────────────────────────────────────────┐
│  USUÁRIO                                                        │
│  ├─ Form na tela Suporte (App.tsx)                             │
│  └─ Conversa com Jájá → escalação automática                   │
│       │                                                         │
│       ▼                                                         │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ Edge Function: suporte-criar-ticket                  │      │
│  │   → INSERT em suporte_tickets                        │      │
│  └──────────────────────────────────────────────────────┘      │
│       │                                                         │
│       ▼                                                         │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ Tabela: suporte_tickets + suporte_mensagens          │      │
│  └──────────────────────────────────────────────────────┘      │
│       │                                                         │
│       ▼                                                         │
│  ATENDENTE (is_admin=true)                                     │
│  ├─ Tela admin-suporte (App.tsx, gated por is_admin)          │
│  ├─ Lê ticket + thread                                         │
│  └─ 4 botões de assistência:                                   │
│       ┌─────────────────────────────────────────────┐          │
│       │ 🔍 Diagnosticar                              │          │
│       │ ✍️  Sugerir resposta                         │          │
│       │ 🛠️  Propor fix de código (cria PR)           │          │
│       │ 💾 Propor fix de dado (whitelist + aprovar)  │          │
│       └─────────────────────────────────────────────┘          │
│            │                                                    │
│            ▼                                                    │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ Edge Function: suporte-claude                        │      │
│  │   1. Sanitiza PII (reusa redigirPII da Jájá)        │      │
│  │   2. Monta prompt por ação                          │      │
│  │   3. Chama api.anthropic.com (Sonnet 4)             │      │
│  │   4. Resposta estruturada (JSON)                    │      │
│  │   5. Insere em suporte_auditoria (status=pendente)  │      │
│  └──────────────────────────────────────────────────────┘      │
│            │                                                    │
│            ▼                                                    │
│  ATENDENTE aprova/rejeita ação proposta                        │
│            │                                                    │
│       ┌────┴────┬────────────┬────────────┐                    │
│       ▼         ▼            ▼            ▼                    │
│  Responde   Executa     Chama GitHub  Atualiza ticket          │
│   user      fix dado    MCP (PR)      (status, atribuição)     │
└─────────────────────────────────────────────────────────────────┘
```

## Componentes

### 1. Schema do banco (3 tabelas novas)

```sql
-- ── 1) Tickets de suporte ────────────────────────────────────────────────────
CREATE TABLE suporte_tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email      text NOT NULL,
  user_tipo       text,                              -- 'diarista'|'empregador'|'visitante'
  origem          text NOT NULL,                     -- 'form_app'|'escalacao_jaja'|'email'|'wa'
  assunto         text,
  descricao       text NOT NULL,
  status          text NOT NULL DEFAULT 'aberto',    -- aberto|em_andamento|aguardando_user|resolvido|fechado
  prioridade      text NOT NULL DEFAULT 'normal',    -- baixa|normal|alta|urgente
  categoria       text,                              -- bug|duvida|financeiro|abuso|outro
  atribuido_a     uuid REFERENCES auth.users(id),
  resolvido_em    timestamptz,
  metadata        jsonb NOT NULL DEFAULT '{}',       -- url, user_agent, transcricao_jaja, etc.
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_tickets_status ON suporte_tickets(status, criado_em DESC);
CREATE INDEX ix_tickets_user ON suporte_tickets(user_id, criado_em DESC);
CREATE INDEX ix_tickets_atribuido ON suporte_tickets(atribuido_a, status);

-- ── 2) Mensagens dentro do ticket ────────────────────────────────────────────
CREATE TABLE suporte_mensagens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES suporte_tickets(id) ON DELETE CASCADE,
  autor_id        uuid REFERENCES auth.users(id),
  autor_tipo      text NOT NULL,                     -- user|atendente|sistema|claude
  conteudo        text NOT NULL,
  visivel_pro_user boolean NOT NULL DEFAULT true,    -- nota interna não vai pro user
  metadata        jsonb NOT NULL DEFAULT '{}',
  criado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_msgs_ticket ON suporte_mensagens(ticket_id, criado_em);

-- ── 3) Audit log das ações automatizadas (Claude propôs/atendente aprovou) ──
CREATE TABLE suporte_auditoria (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES suporte_tickets(id),
  atendente_id    uuid REFERENCES auth.users(id),
  acao            text NOT NULL,                     -- diagnostico|draft_resposta|fix_dado|criar_pr
  parametros      jsonb,                              -- input pro Claude / SQL params
  resultado       jsonb,                              -- output do Claude
  fix_codigo      text,                              -- nome canônico do fix se acao='fix_dado'
  status          text NOT NULL DEFAULT 'pendente',  -- pendente|aprovado|executado|falhou|rejeitado
  erro            text,                              -- mensagem de erro se falhou
  criado_em       timestamptz NOT NULL DEFAULT now(),
  aprovado_em     timestamptz,
  executado_em    timestamptz
);
CREATE INDEX ix_audit_ticket ON suporte_auditoria(ticket_id, criado_em DESC);
CREATE INDEX ix_audit_status ON suporte_auditoria(status) WHERE status = 'pendente';

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE suporte_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE suporte_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE suporte_auditoria ENABLE ROW LEVEL SECURITY;

-- User vê só seus tickets; admin vê tudo
CREATE POLICY tickets_self_or_admin ON suporte_tickets FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY tickets_user_insert ON suporte_tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY tickets_admin_update ON suporte_tickets FOR UPDATE
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true));

-- Análogo pra suporte_mensagens e suporte_auditoria (só admin pode acessar audit)
```

### 2. Tela admin-suporte (no App.tsx)

Nova `tela`: `admin-suporte`. Gated por `userProfile.is_admin === true`.

Layout sugerido (mobile-first como o resto do app):

```
┌─────────────────────────────────────┐
│ ← Suporte (admin)            🔄     │
├─────────────────────────────────────┤
│ Filtros: [Status v] [Prioridade v]  │
├─────────────────────────────────────┤
│ ┌───────────────────────────────┐   │
│ │ #1234 · 🟠 alto · em andamento│   │
│ │ "paguei R$1 e não desbloqueou"│   │
│ │ Maria S. · há 2h              │   │
│ └───────────────────────────────┘   │
│ ┌───────────────────────────────┐   │
│ │ #1235 · 🔴 urgente · aberto   │   │
│ │ "perfil falso reportado"      │   │
│ │ João P. · há 12min            │   │
│ └───────────────────────────────┘   │
└─────────────────────────────────────┘
```

Detalhe do ticket:

```
┌─────────────────────────────────────┐
│ ← #1234                              │
├─────────────────────────────────────┤
│ Maria Silva · diarista              │
│ maria.s@email.com                   │
│ Aberto há 2h · prioridade alta      │
├─────────────────────────────────────┤
│ ── Thread ──                         │
│ [user] paguei R$1 ontem e o contato │
│  ainda não foi liberado.            │
│                                      │
│ [sistema] Transcrição da Jájá:      │
│  > como resolver R$1 travado        │
│  > Jájá: ...escreva pra suporte@... │
├─────────────────────────────────────┤
│ ── Ações Claude ──                   │
│ [🔍 Diagnosticar]                    │
│ [✍️  Sugerir resposta]               │
│ [🛠️  Propor fix de código]           │
│ [💾 Propor fix de dado]              │
├─────────────────────────────────────┤
│ Sua resposta:                       │
│ ┌─────────────────────────────────┐ │
│ │ ...                             │ │
│ └─────────────────────────────────┘ │
│ [Enviar pro user] [Nota interna]    │
└─────────────────────────────────────┘
```

### 3. Edge Functions (3 novas)

**`suporte-criar-ticket`** — recebe do form do user, valida, INSERT, retorna `ticket_id`. Trivial.

**`suporte-claude`** — núcleo da integração. Recebe `{ticket_id, acao, params?}`:

```ts
// Pseudocódigo
1. Verifica que caller é admin (RLS + check explícito)
2. Carrega ticket + thread + metadata
3. Sanitiza PII de tudo que vai pro Claude:
   - reusa redigirPII() da Jájá (CPF/CNPJ/cartão/CVV)
   - + email: foo@bar.com → [EMAIL]
   - + telefone: redige BR phone patterns
   - + nome completo do user: substitui por [NOME_USER]
4. Monta prompt por ação:
   - diagnosticar: system prompt "você é técnico do diariaja, dado o ticket
                  abaixo + esquema do banco, diagnostique. Saída JSON
                  {provavel_causa, evidencias, fix_sugerido}"
   - draft_resposta: "redija resposta empática em pt-BR, máx 4 parágrafos,
                     tom da Jájá, sem prometer SLA"
   - fix_codigo: "leia o código relevante (App.tsx, edge functions),
                 proponha mudança mínima. Saída: arquivo + diff"
   - fix_dado: "dado o ticket, identifique se algum fix do whitelist
              FIXES_PERMITIDOS resolve. Retorne nome + params"
5. Chama api.anthropic.com com model=claude-sonnet-4
6. Insere em suporte_auditoria com status='pendente'
7. Retorna pro painel: {audit_id, resultado}
```

**`suporte-executar-fix`** — atendente aprova um audit pendente:

```ts
1. Verifica admin
2. Lê audit_id
3. Switch por acao:
   - fix_dado: lookup em FIXES_PERMITIDOS, executa SQL parametrizado
              em transação, log antes/depois, rollback se falhar
   - draft_resposta: insert em suporte_mensagens com autor_tipo=atendente
                    (atendente já editou antes de aprovar)
   - criar_pr: chama GitHub MCP via service token, abre PR draft
4. Atualiza audit com status='executado' + executado_em
```

### 4. Whitelist de fixes de dado (crítico — sem isso, é fogo)

Catálogo restrito. Claude NÃO escreve SQL livre. Só seleciona da lista:

```ts
// supabase/functions/_shared/fixes-permitidos.ts
export const FIXES_PERMITIDOS = {
  liberar_contato_preso: {
    descricao: "Webhook MP falhou — libera contato manualmente",
    sql: `UPDATE candidaturas
          SET contato_liberado = true,
              metadata = metadata || jsonb_build_object('fix_manual', $2)
          WHERE id = $1
          RETURNING id, anuncio_id`,
    params: ["candidatura_id (uuid)", "audit_id (uuid)"],
    risco: "baixo",
    revisao_obrigatoria: false,  // 1 admin aprova
  },
  desbloquear_user: {
    descricao: "Remove suspensão de conta (suspensão injusta)",
    sql: `UPDATE user_profiles
          SET status = 'ativo', suspenso_motivo = NULL
          WHERE id = $1
          RETURNING id, email`,
    params: ["user_id (uuid)"],
    risco: "medio",
    revisao_obrigatoria: false,
  },
  arquivar_anuncio_suspeito: {
    descricao: "Arquiva anúncio sob denúncia (não deleta)",
    sql: `UPDATE diarias SET status = 'arquivado_moderacao' WHERE id = $1`,
    params: ["diaria_id (uuid)"],
    risco: "baixo",
    revisao_obrigatoria: false,
  },
  reset_senha_admin: {
    descricao: "Gera link de reset de senha via Supabase Admin API",
    handler: "auth.admin.generateLink",  // não é SQL puro
    params: ["user_id (uuid)"],
    risco: "medio",
    revisao_obrigatoria: false,
  },
  cancelar_assinatura_falha: {
    descricao: "Cancela assinatura no banco quando MP confirma cancelamento mas hook não chegou",
    sql: `UPDATE assinaturas SET status = 'cancelado', cancelado_em = now() WHERE id = $1`,
    params: ["assinatura_id (uuid)"],
    risco: "medio",
    revisao_obrigatoria: true,  // exige 2ª aprovação
  },
};
```

**Regras invioláveis pro whitelist:**
- SQL sempre parametrizado, nunca string concat
- Sempre `WHERE id = $1` (nunca tabela inteira)
- Sempre `RETURNING` pra audit log
- Risco `alto` exige 2 aprovações
- Qualquer DELETE/DROP/ALTER fora do whitelist = PR de migration manual

### 5. Sanitização LGPD (reusa)

```ts
import { redigirPII } from "../ai-support/index.ts";  // já temos

function sanitizarTicketProClaude(ticket, mensagens) {
  return {
    ticket: {
      ...ticket,
      user_email: "[EMAIL]",
      descricao: redigirPII(redigirEmail(redigirTelefone(ticket.descricao))),
    },
    mensagens: mensagens.map(m => ({
      ...m,
      conteudo: redigirPII(redigirEmail(redigirTelefone(m.conteudo))),
    })),
  };
}
```

**Aviso obrigatório na Política de Privacidade v2:** "tickets de suporte podem ser analisados por assistente de IA (Anthropic Claude), com dados pessoais sanitizados antes do envio. Transferência internacional EUA, base legal: legítimo interesse (art. 7º IX LGPD)."

### 6. Custo estimado

- Claude Sonnet 4: $3/M input, $15/M output
- Ticket médio: 5k input + 2k output ≈ $0.045/ticket
- 50 tickets/dia → $2,25/dia → $68/mês
- 500 tickets/dia → $22/dia → $675/mês

Otimização futura: Haiku 4.5 ($1/$5) pra triagem inicial; Sonnet só pra casos complexos. Reduz ~70%.

### 7. Roadmap (4 sprints sugeridos)

**Sprint 1 — MVP painel manual (~1 semana)**
- Migration: 3 tabelas + RLS
- Tela `admin-suporte` com lista + detalhe + responder manual
- Form pra user abrir ticket na tela Suporte existente
- Edge function `suporte-criar-ticket`
- Sem Claude ainda — só painel humano

**Sprint 2 — Claude leitor (~1 semana)**
- Edge function `suporte-claude` com ações `diagnosticar` + `draft_resposta`
- Botões no painel chamando essa function
- Sanitização PII embutida
- Audit log básico

**Sprint 3 — Claude executor de dado (~1 semana)**
- `FIXES_PERMITIDOS` whitelist (5 fixes iniciais)
- Edge function `suporte-executar-fix`
- UI de aprovação dupla pra risco alto
- Rollback automático em falha

**Sprint 4 — Claude PR + escalação Jájá (~1 semana)**
- Edge function chama GitHub MCP pra abrir PR
- Escalação automática: quando Jájá responde 3x sem resolver, cria ticket
- Métricas no painel: tempo médio, satisfação, taxa de resolução

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Claude alucina SQL → corrupção de dado | Whitelist parametrizada, nunca SQL livre |
| Atendente clica "Aprovar" no automático | Confirmação dupla pra fixes risco-alto + diff visualizado |
| PII vaza pra Anthropic | `redigirPII()` + audit do que foi enviado |
| Custo escapa | Rate-limit por atendente (50 req/dia) + alerta de custo |
| Atendente junior aprova fix arriscado | RLS por `nivel_admin` (junior/senior/super) — fica pra Sprint 5 |
| Claude key vaza | Service-role-only secret no Supabase, nunca exposed no client |
| User abre 1000 tickets fake | Rate-limit por user (5 tickets/dia) |

## Decisões pendentes (quero teu input antes de codar)

1. **Modelo do Claude**: Sonnet 4 padrão? Ou começar com Haiku 4.5 pra economizar?
2. **Atribuição**: round-robin automático entre admins ou cada um pega o que quiser?
3. **Notificação**: push pro atendente quando ticket urgente cai? Email?
4. **Histórico**: quanto tempo guarda? LGPD favorece 2 anos após resolução; concorrentes guardam 5.
5. **GitHub MCP**: a edge function vai precisar de **GitHub App** instalada no repo (token com escopo restrito). Quem cria?
6. **Sanitização do nome**: como detectar nome próprio sem ML? Padrão "Nome Sobrenome" pega muitos falsos positivos. Talvez só substituir o `user.nome` conhecido do banco?
