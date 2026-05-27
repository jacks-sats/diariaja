# 🚨 Resposta a Incidentes — DiáriaJá

**Última revisão:** 2026-05-27
**Princípio:** **Conter primeiro, investigar depois.** Cada minuto de exposição amplia o dano. A integridade dos backups e a confiança do usuário valem mais que rastreabilidade perfeita.

---

## 1. Tipos de incidente cobertos

| Tipo | Exemplo | Severidade típica |
|---|---|---|
| **Vazamento de dados** | RLS quebrada expondo CPF/foto/RG; dump público de tabela | 🔴 Crítica |
| **Comprometimento de admin** | Conta com `is_admin=true` sequestrada | 🔴 Crítica |
| **Indisponibilidade prolongada** | App fora >1h em horário de pico | 🟠 Alta |
| **Vulnerabilidade explorável reportada** | XSS, IDOR, escalada de privilégio | 🟠 Alta |
| **Fraude financeira ativa** | Atacante manipula contador R$1 ou cria assinatura forjada | 🟠 Alta |
| **Push abusivo** | Edge Function `send-push` enviando spam | 🟡 Média |
| **Spam em chat / comunidade** | Bot postando massivamente | 🟡 Média |
| **Performance degradada** | Lentidão > 5s | 🟢 Baixa |

---

## 2. Severidade e SLA de resposta

| Severidade | Tempo pra primeira ação | Quem aciona |
|---|---|---|
| 🔴 Crítica | **15 min** | Owner direto |
| 🟠 Alta | **1h** | Owner |
| 🟡 Média | **4h** úteis | Owner |
| 🟢 Baixa | **24h** úteis | Owner |

---

## 3. Playbook geral

### 3.1 Conter (T+0)

1. **Não tenta entender ainda.** Cortar a hemorragia primeiro.
2. **Vazamento de dados**: Supabase Dashboard → Authentication → Sessions → "Sign Out All Users" se for sessão comprometida. Database → desligar políticas RLS suspeitas se houver query maliciosa em curso.
3. **Comprometimento de admin**: `UPDATE user_profiles SET is_admin = FALSE WHERE id = '<id_comprometido>';` direto no SQL Editor (service_role bypassa o trigger).
4. **Fraude financeira**: Edge Function comprometida → Supabase Dashboard → Edge Functions → desabilitar.
5. **Push abusivo**: revogar VAPID keys + redeploy `send-push` com nova chave.

### 3.2 Avaliar (T+15min)

Coletar:
- Quantos usuários afetados?
- Que tipo de dado vazou ou foi tocado?
- Há evidência de exploração ativa?
- Há perda de dados recuperável via backup?

Anotar tudo num doc privado (Google Doc / Notion / Obsidian) — vira a base do RCA e da comunicação à ANPD.

### 3.3 Comunicar (T+1h se grave)

| Quem | Quando | Canal |
|---|---|---|
| Owner (Jackson) | Sempre, primeira coisa | Direto |
| Usuários afetados | Se houver risco relevante a eles | Push + e-mail |
| **ANPD** | Vazamento de dados pessoais com risco relevante | Formulário gov.br/anpd em **até 72h úteis** após conhecer o incidente (Art. 48 LGPD) |
| Imprensa / redes | Se já houver vazamento público | Comunicado curto, sem detalhes técnicos exploráveis |
| Autoridades policiais | Se houver crime (fraude, invasão) | Boletim de Ocorrência |

### 3.4 Restaurar (T+1h a T+24h)

Ordem de restauração:
1. **Banco**: Supabase Dashboard → Database → Backups → escolher snapshot anterior ao incidente → "Restore".
2. **Código**: `git reset --hard v1.0-recuperacao-2026-05-27` (ou tag mais recente) se commit malicioso foi pushed.
3. **Edge Functions**: redeploy a partir do repo.
4. **Vercel**: Promote previous deployment (até 30 dias de histórico).

Detalhes completos em [`RECUPERACAO.md`](./RECUPERACAO.md).

### 3.5 Investigar (T+24h a T+7d)

Root cause analysis (RCA):
- **O que** aconteceu (linha do tempo)
- **Como** aconteceu (vetor explorado)
- **Por que** chegou até aqui (controles que falharam)
- **O que muda** pra não acontecer de novo (action items com prazo)

Resultado vira commit no repo (`docs/incidentes/AAAA-MM-DD-resumo.md`) com PII redigida.

---

## 4. Playbooks específicos

### 4.1 RLS quebrada (vazamento via API)

1. **Conter**: `ALTER TABLE <tabela> FORCE ROW LEVEL SECURITY;` + drop policies suspeitas + criar policy provisória `FOR SELECT USING (false)` (todo mundo perde acesso menos service_role).
2. **Avaliar**: queries de auditoria no banco — `SELECT count(*), user_id FROM postgrest_logs WHERE accessed_at > '<inicio>' GROUP BY user_id ORDER BY count DESC` (se tivermos logs do Supabase, plano Free não tem detalhado).
3. **Restaurar**: recriar policy correta após auditoria.
4. **Comunicar**: ANPD em 72h se houve acesso a dados pessoais.

### 4.2 Conta de admin comprometida

1. **Conter**: revogar `is_admin`, invalidar sessões.
2. **Avaliar**: olhar `analytics_eventos` + `denuncias` + `kyc_acessos_log` (quando existir) buscando ações suspeitas do admin no período.
3. **Restaurar**: reverter ações maliciosas (UPDATEs no banco com base no audit trail).
4. **Hardening**: 2FA obrigatório pra admin (Supabase Auth permite).

### 4.3 Fraude no contador R$1

Já corrigido em 2026-05-27 (commit `73b4224`). Contador moveu de localStorage pra tabela `contatos_desbloqueios` com webhook MP. Caso volte a aparecer abuso:
1. **Conter**: rate-limit no `create-contact-payment` (1 chamada por user a cada 30s).
2. **Avaliar**: `SELECT empregador_id, COUNT(*) FROM contatos_desbloqueios WHERE created_at > '<inicio>' GROUP BY 1 ORDER BY 2 DESC` — quem usou demais.
3. **Restaurar**: cancelar manualmente unlocks suspeitos via SQL (delete + reembolsar via MP).

### 4.4 Bucket privado virou público

1. **Conter**: Dashboard → Storage → toggle "Public" off + verificar policies.
2. **Avaliar**: amostragem dos arquivos — quais documentos KYC ficaram acessíveis?
3. **Restaurar**: rodar `antecedentes_criminais.sql` + `kyc_documentos.sql` (recriam policies se quebradas).
4. **Comunicar**: ANPD + usuários cujos docs foram expostos.

---

## 5. Backups e recuperação

Camadas redundantes documentadas em [`RECUPERACAO.md`](./RECUPERACAO.md):
1. Tag git `v1.0-recuperacao-*` (GitHub)
2. Branch `backup/snapshot-*` (GitHub)
3. Bundle local (.bundle)
4. Bundle externo (disco físico)
5. Vercel rollback (30 dias)
6. Supabase backup automático (7 dias no Free)

---

## 6. Contatos críticos

| Quem | Contato | Para quê |
|---|---|---|
| Owner | Jackson dos Santos | Decisões executivas |
| Supabase Support | dashboard → Support | Problemas de infra do banco/auth/storage |
| Vercel Support | vercel.com/help | Problemas de deploy/hosting |
| Mercado Pago | suporte vendedor | Problemas com webhook / pagamento |
| ANPD | gov.br/anpd | Notificação de vazamento |
| Polícia | 197 (Polícia Civil MS) ou 190 | Crime grave |

---

## 7. Após o incidente — postmortem

Cada incidente vira um documento em `docs/incidentes/AAAA-MM-DD-<slug>.md`:
- Linha do tempo (T+0 a T+resolução)
- Causa raiz
- Impacto (qtd usuários, qtd dados, tempo fora)
- Decisões tomadas (com justificativa)
- Action items com dono e prazo
- O que deu certo no playbook
- O que deu errado no playbook (melhorar)

Postmortem é **livre de culpa individual** — foco em sistema. Ninguém é culpado por incidente; sistema falhou em prevenir.

---

## 8. Treino

A cada 3 meses (quando o app escalar):
- Simular vazamento de credencial de admin → executar playbook completo.
- Validar tempo de restauração via backup.
- Atualizar este documento com aprendizados.

Por ora, com 1 owner e ~100 usuários, treino formal não é prioridade — manter os playbooks legíveis é o suficiente.
