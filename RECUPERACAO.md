# 🛟 PROTOCOLO DE RECUPERAÇÃO — DiáriaJá

**Data do snapshot:** 2026-05-27
**Estado capturado:** commit `ea5f168` (produção ativa em https://diariaja.vercel.app)

---

## 🎯 Resumo executivo

Se você precisar reverter, recuperar arquivo perdido ou reconstruir tudo, este documento te dá **6 caminhos** independentes. Mesmo que perca **5 deles**, ainda consegue restaurar.

| # | Camada | Onde fica | Inalcançável se |
|---|---|---|---|
| 1 | **Tag `v1.0-recuperacao-2026-05-27`** | GitHub (origin) + local | Excluir GitHub repo |
| 2 | **Branch `backup/snapshot-2026-05-27`** | GitHub (origin) + local | Excluir GitHub repo |
| 3 | **Bundle git** | `backups/diariaja-completo-2026-05-27.bundle` (26 MB) | Perder o PC |
| 4 | **Bundle externo** | `C:\Users\santo\Trampojá\diariaja-bundle-2026-05-27.bundle` | Perder o PC |
| 5 | **Snapshot arquivos** | `backups/src-snapshot-2026-05-27/` | Perder o PC |
| 6 | **Vercel rollback** | https://vercel.com/jacks-sats-projects/diariaja | Vercel apagar deploy |

**Plus:** Supabase tem backups automáticos diários (7 dias no plano Free). Veja seção [Banco](#-banco-de-dados-supabase) abaixo.

---

## 📋 Inventário no momento do snapshot

### Repositório GitHub
- **URL:** https://github.com/jacks-sats/diariaja
- **Branch principal:** `main`
- **Commit HEAD:** `ea5f168` ("fix(logout): modal global + atalho no menu ⋮")
- **Total commits:** 111

### Tag de recuperação
- **Nome:** `v1.0-recuperacao-2026-05-27`
- **Aponta pra:** `ea5f168`
- **Anotada** (mensagem com inventário completo). Use `git show v1.0-recuperacao-2026-05-27` pra ler.

### Branches preservadas no GitHub
| Branch | Propósito | NÃO deletar |
|---|---|---|
| `main` | Produção | ✅ |
| `backup/snapshot-2026-05-27` | Cópia mutável do snapshot | ✅ |
| `restaurar-cadastro-pj` | Salvaguarda antiga (briefing original) | ✅ |

### Branches feature antigas (podem deletar se quiser limpar)
- `claude/auditoria-fixes-26-05`, `claude/cadastro-revamp-26-05`, `claude/ja-decola-26-05`, etc. — já mergeadas, redundantes.

### Vercel
- **Projeto:** `diariaja` (team `jacks-sats-projects`)
- **Deploy ativo:** commit `ea5f168`
- **URL pública:** https://diariaja.vercel.app
- **Deployments anteriores:** rollback disponível por 30 dias

### Supabase
- **Project URL:** https://rpszebrrrasoijfdvner.supabase.co
- **Anon key:** pública por design — está no `supabaseClient.ts` como fallback
- **Migrations aplicadas no banco** (lista completa abaixo)
- **Backups automáticos:** Supabase Free retém 7 dias diários (Dashboard → Database → Backups)

---

## ✅ Migrations já aplicadas no Supabase (em ordem cronológica)

Confira no SQL Editor: `SELECT proname FROM pg_proc WHERE proname LIKE 'admin_%' OR proname LIKE 'academy_%';`

| Arquivo | Status | O que faz |
|---|---|---|
| `analytics_eventos.sql` | ✅ aplicada | Eventos de analytics |
| `cadastro_p0_fixes.sql` | ✅ aplicada | Triggers anti-escalada + UNIQUE CPF/CNPJ + idade 18+ |
| `kyc_documentos.sql` | ✅ aplicada | 6 colunas KYC + RPC revisar_documento |
| `auditoria_final_fixes.sql` | ✅ aplicada | OTP RPC + termos + score_events |
| `painel_admin.sql` | ✅ aplicada | admin_stats RPC |
| `_PENDENTES_SUPABASE.sql` | ✅ aplicada | Consolidado: webhook idempotência + oauth_states + índices + CHECKs + Já Decola + buckets MIME + 4 colunas PJ |
| `hotfix_triggers_cast.sql` | ✅ aplicada | Triggers com cast defensivo |
| `admin_metricas_avancadas.sql` | ⏳ **PENDENTE** | Drill-down + gráficos + métricas extras |

### Migration pendente
**`supabase/migrations/admin_metricas_avancadas.sql`** ainda precisa rodar pra liberar drill-down e gráficos no painel admin. Link raw:
https://raw.githubusercontent.com/jacks-sats/diariaja/main/supabase/migrations/admin_metricas_avancadas.sql

---

## 🔧 Como restaurar — 6 cenários

### Cenário A: Perdi um arquivo específico no PC, GitHub ok

```bash
# Restaurar só o App.tsx da última versão de produção:
git checkout v1.0-recuperacao-2026-05-27 -- src/App.tsx

# Ou de qualquer commit específico:
git log --oneline    # achar o commit
git checkout <SHA> -- src/App.tsx
```

### Cenário B: Quebrei main e quero voltar pro snapshot, GitHub ok

```bash
# Reset local + force push (DESTRUTIVO — só use se tiver certeza):
git checkout main
git reset --hard v1.0-recuperacao-2026-05-27
git push --force origin main
```

⚠️ Force push em main é destrutivo — confirme que NÃO há commits posteriores que valem a pena.

### Cenário C: Perdi o GitHub inteiro, tenho o PC

```bash
# Restaurar a partir do bundle local:
cd ~/algumpasta/
git clone Trampojá/blissful-hawking-017557/backups/diariaja-completo-2026-05-27.bundle diariaja-restaurado
cd diariaja-restaurado

# Configurar novo remote no GitHub (crie repo novo lá):
git remote add origin https://github.com/SEU_USUARIO/diariaja-novo.git
git push origin main --tags
```

### Cenário D: Perdi tudo localmente, tenho o GitHub

```bash
git clone https://github.com/jacks-sats/diariaja.git
cd diariaja
git checkout v1.0-recuperacao-2026-05-27
npm install
# Pronto, app de volta funcional.
```

### Cenário E: Perdi GitHub E PC, tenho cópia do bundle externo

```bash
# O bundle em C:\Users\santo\Trampojá\diariaja-bundle-2026-05-27.bundle
# pode ser carregado em qualquer máquina com git:
git clone C:\Users\santo\Trampojá\diariaja-bundle-2026-05-27.bundle diariaja-restaurado
cd diariaja-restaurado
npm install
```

### Cenário F: Quero apenas voltar produção pra versão anterior (Vercel)

1. https://vercel.com/jacks-sats-projects/diariaja
2. Aba **Deployments**
3. Encontra um deploy READY anterior
4. Clica nos 3 pontinhos `⋮` → **Promote to Production**
5. Em ~30 segundos a produção volta pra versão escolhida (banco NÃO muda)

---

## 🗄️ Banco de dados Supabase

### Backup automático (Supabase Free)
- **Retenção:** 7 dias de snapshots diários
- **Onde ver:** https://supabase.com/dashboard/project/rpszebrrrasoijfdvner → **Database → Backups**
- **Restore:** botão "Restore" ao lado do snapshot escolhido

### Backup manual (recomendado fazer 1x por semana)

**Via Supabase Dashboard (sem CLI):**
1. Dashboard → **Database → Backups** → tem botão "Download" se já tiver snapshot
2. Ou Dashboard → **Database → Backups** → **"Schedule manual backup"**

**Via Supabase CLI (mais robusto):**
```bash
npx supabase login                    # entra com sua conta
npx supabase link --project-ref rpszebrrrasoijfdvner

# Dump schema-only (estrutura, sem dados):
npx supabase db dump --schema-only > backups/supabase-schema-2026-05-27.sql

# Dump com dados (snapshot completo — pode ser grande):
npx supabase db dump > backups/supabase-completo-2026-05-27.sql
```

⚠️ **Faça isso assim que puder** — não tenho como rodar do meu lado (preciso do seu access token). Recomendo agendar mensal.

### Lista de migrations que precisam rodar em ordem (caso restaurar banco do zero)

Ordem de aplicação (todas idempotentes):
```
1. comunidade.sql
2. denuncias.sql
3. analytics_eventos.sql
4. push_subscriptions.sql
5. mercadopago_tables.sql + planos.sql + pagamento_mp.sql
6. niveis_confiabilidade.sql
7. reputacao_empregador.sql
8. convites.sql + nao_interesse.sql
9. portfolio_no_banco.sql
10. fix_rls_assinaturas_service_role.sql
11. fix_rls_denuncias_convites.sql
12. fix_rls_diarista_confirmar.sql
13. fix_assinaturas_status_constraint.sql
14. fix_diarias_status_constraint.sql
15. feed_oportunidades.sql
16. chat_v2_read_receipts.sql
17. anti_exit_mensagens_trigger.sql
18. vagas_expiradas_feedback.sql
19. cron_expirar_vagas.sql (OPCIONAL — usa pg_cron)
20. painel_admin.sql
21. cadastro_p0_fixes.sql
22. kyc_documentos.sql
23. auditoria_final_fixes.sql
24. _PENDENTES_SUPABASE.sql (consolidado: auditoria + Já Decola + PJ + buckets)
25. hotfix_triggers_cast.sql
26. admin_metricas_avancadas.sql ⏳ AINDA PENDENTE
```

Migrations destrutivas (NÃO RODAR em produção):
- `reset_diarias_candidaturas.sql` — apaga dados de diárias

---

## 🔑 Variáveis de ambiente e secrets

### Vercel (Production env vars)
- `VITE_SUPABASE_URL` (já tem fallback hardcoded em `supabaseClient.ts`)
- `VITE_SUPABASE_ANON_KEY` (já tem fallback hardcoded)
- `VITE_VAPID_PUBLIC_KEY` (Web Push — sem fallback)
- `VITE_MP_CLIENT_ID` (OAuth Mercado Pago)

### Supabase Edge Functions secrets
Em **Supabase → Edge Functions → Secrets**:
- `MP_ACCESS_TOKEN` (Mercado Pago)
- `MP_WEBHOOK_SECRET` (HMAC verification)
- `MP_CLIENT_ID` (OAuth)
- `MP_CLIENT_SECRET` (OAuth)
- `GROQ_API_KEY` (ai-support)
- `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` (Web Push)
- `APP_URL` (`https://diariaja.vercel.app`)
- `SUPABASE_SERVICE_ROLE_KEY` (auto-injetada)

⚠️ **Anote esses valores em um gerenciador de senhas seguro** (1Password, Bitwarden, etc.) — se perder o Supabase, vai ser doloroso reconfigurar.

---

## 📦 Conteúdo do diretório `backups/`

```
backups/
├── diariaja-completo-2026-05-27.bundle   (26 MB — git bundle com TUDO)
├── src-snapshot-2026-05-27/
│   ├── App.tsx.bak                       (931 KB — arquivo principal)
│   ├── types.ts.bak
│   ├── helpers.ts.bak
│   ├── constants.ts.bak
│   ├── vercel.json.bak
│   ├── index.html.bak
│   ├── package.json.bak
│   └── migrations/                        (34 arquivos SQL)
└── (este arquivo: RECUPERACAO.md)
```

E cópia EXTERNA:
- `C:\Users\santo\Trampojá\diariaja-bundle-2026-05-27.bundle` (fora do worktree)

---

## 🚨 Checklist mensal de recuperação (recomendado)

Marque na agenda 1× por mês:

- [ ] Rodar `git tag -a v1.0-mes-X-2026 -m "..."` no commit atual
- [ ] `git bundle create backups/diariaja-MES.bundle --all`
- [ ] `git push origin --tags` (envia tag pro GitHub)
- [ ] **Supabase**: download manual de backup pelo Dashboard
- [ ] Copiar o bundle pra **disco externo** ou **Google Drive / Dropbox / iCloud**
- [ ] Conferir que produção (`https://diariaja.vercel.app`) responde 200

---

## 🆘 Em caso de pânico

1. **Respira.** Nada do que está em `main` no GitHub se perdeu agora.
2. Confere se ainda consegue acessar https://github.com/jacks-sats/diariaja. Se sim, está tudo bem.
3. Se não conseguir GitHub:
   - O bundle local `backups/diariaja-completo-2026-05-27.bundle` (26 MB) tem TUDO
   - A cópia em `C:\Users\santo\Trampojá\diariaja-bundle-2026-05-27.bundle` é redundância
4. Se perdeu PC + GitHub:
   - Supabase ainda tem o banco (7 dias de backup automático)
   - Vercel ainda tem deploys anteriores (rollback 30 dias)
   - Reinstalar a partir do que sobrar
5. Em último caso: `suporte@diariaja.com.br` (você mesmo, mas registrado nos termos)

---

## 🔁 Atualizando este protocolo

Depois de mudanças significativas, rodar:

```bash
# 1. Nova tag (incrementa data)
git tag -a v1.X-recuperacao-AAAA-MM-DD <commit> -m "..."
git push origin --tags

# 2. Novo bundle
git bundle create backups/diariaja-completo-AAAA-MM-DD.bundle --all
cp backups/diariaja-completo-AAAA-MM-DD.bundle "/c/Users/santo/Trampojá/"

# 3. Snapshot dos arquivos críticos
mkdir -p backups/src-snapshot-AAAA-MM-DD
cp src/App.tsx src/types.ts src/helpers.ts src/constants.ts vercel.json index.html package.json backups/src-snapshot-AAAA-MM-DD/

# 4. Atualizar este RECUPERACAO.md com a data nova
```

---

**Última atualização:** 2026-05-27 · commit `ea5f168`
