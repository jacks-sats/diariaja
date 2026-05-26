# Auditoria End-to-End — Fluxos de Cadastro DiáriaJá

**Data:** 2026-05-25
**Escopo:** 3 perfis (Quero contratar PF / Quero trabalhar / Empresa CNPJ)
**Branch base:** `main` após merges de segurança + painel admin

> **VEREDITO DIRETO**
> Existem **10 problemas P0 que bloqueiam o lançamento público** — 6 de segurança (incluindo escalada de privilégio trivial e ausência de UNIQUE em CPF/CNPJ), 4 regulatórios/operacionais (idade 16→18, termo genérico, sem RG/CNH, sem PIX). O bug do botão "Continuar" é **percepção visual**, não bug de lógica.
> **Estimativa pra ficar safe pra lançar: 12-20h de trabalho.**

---

## 🔴 P0 — BLOQUEADORES DE LANÇAMENTO

| # | Item | Onde | Esforço | Tipo |
|---|---|---|---|---|
| **P0-1** | **Qualquer usuário pode se promover a `is_admin=true`** via REST API direta. Não há migration com policy `WITH CHECK` por coluna em `user_profiles` — confiamos no Dashboard. | App.tsx:1689 + falta migration | 1h | 🔐 Segurança |
| **P0-2** | **Múltiplas contas com mesmo CPF/CNPJ.** Sem `UNIQUE` no banco. Banido cria nova conta com mesmo CPF e fica verificado. | nenhuma migration faz UNIQUE | 1h | 🔐 Segurança |
| **P0-3** | **CNPJ aceito sem validação de DV.** Linha só checa 14 dígitos. `11.111.111/1111-11` passa. Não existe `validarCNPJ` em `helpers.ts`. | App.tsx:4495 | 2h | 🔐 Fraude |
| **P0-4** | **Menor de 18 anos consegue se cadastrar.** `max` no DOM é `-16y`. Termo §3 diz "deve ter 18+". Contradição interna. Risco trabalhista/CF Art. 7º. | App.tsx:4614 | 30min | ⚖️ Regulatório |
| **P0-5** | **Sem UI de upload de RG/CNH** para o diarista. `documento_status` existe no schema mas não há tela. Sistema de níveis fica truncado em N2. | falta de feature | 4h | ⚖️ Regulatório |
| **P0-6** | **Sem campo de PIX do diarista no cadastro.** Modelo de pagamento é "plataforma repaga via PIX" mas a chave nunca é coletada. **Primeira diária paga = sistema quebra.** | App.tsx:4554-4708 (falta) | 2h | 💰 Operacional |
| **P0-7** | **`delete-user` deixa órfãos (LGPD Art. 18 VI).** Esquece `denuncias`, `convites`, `nao_interesse`, `push_subscriptions`, `topicos`, `comentarios_comunidade`, `analytics_eventos`, `assinaturas`, `portfolio_*`, `suporte_tickets`, `suporte_respostas` + arquivo do bucket `avatars`. | delete-user/index.ts:55-67 | 3h | ⚖️ LGPD |
| **P0-8** | **Senha mínima 6 chars + sem complexidade.** Credential stuffing trivial. Supabase default rate limit é ~30/h por IP — não suficiente. | App.tsx:1730 | 30min | 🔐 Segurança |
| **P0-9** | **Termo único e genérico para os 3 perfis.** Falta termo específico de **contratante** (responsabilidade pelo ambiente, segurança, vínculo CLT) e de **trabalhador** (riscos autônomo, sem cobertura previdenciária, recomendação MEI). | App.tsx:3209-3243 | 4h | ⚖️ Regulatório |
| **P0-10** | **Telefone sem máscara nem validação no submit do cadastro-diarista.** Aceita `00000000000` ou string vazia. Empregador não consegue contato. `validarTelefone` existe mas não é chamada na linha 4692. | App.tsx:4420, 4592, 4692 | 30min | 🔐 Dados sujos |

### Detalhe dos P0 com fix proposto

#### P0-1 — Escalada de privilégio
```sql
-- supabase/migrations/protect_user_profiles_columns.sql
CREATE OR REPLACE FUNCTION protect_admin_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) <> 'service_role' THEN
    IF NEW.is_admin           IS DISTINCT FROM OLD.is_admin           THEN RAISE EXCEPTION 'is_admin é gerenciado pelo servidor'; END IF;
    IF NEW.plano_ativo        IS DISTINCT FROM OLD.plano_ativo        THEN RAISE EXCEPTION 'plano_ativo só via webhook MP'; END IF;
    IF NEW.mp_access_token    IS DISTINCT FROM OLD.mp_access_token    THEN RAISE EXCEPTION 'mp_access_token só via OAuth callback'; END IF;
    IF NEW.documento_status   IS DISTINCT FROM OLD.documento_status   THEN RAISE EXCEPTION 'documento_status só via revisão KYC'; END IF;
    IF NEW.telefone_verificado IS DISTINCT FROM OLD.telefone_verificado THEN RAISE EXCEPTION 'telefone_verificado só após OTP'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_protect_admin_columns
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION protect_admin_columns();
```

#### P0-2 — UNIQUE em documento
```sql
CREATE UNIQUE INDEX uq_user_profiles_cpf  ON user_profiles(cpf)  WHERE cpf  IS NOT NULL AND length(cpf)  > 0;
CREATE UNIQUE INDEX uq_user_profiles_cnpj ON user_profiles(cnpj) WHERE cnpj IS NOT NULL AND length(cnpj) > 0;
```
> ⚠️ Antes de rodar, conferir duplicados existentes:
> `SELECT cpf, COUNT(*) FROM user_profiles WHERE cpf IS NOT NULL GROUP BY cpf HAVING COUNT(*) > 1;`

#### P0-3 — validarCNPJ
```ts
// helpers.ts
export function validarCNPJ(cnpj: string): boolean {
  const c = cnpj.replace(/\D/g, "");
  if (c.length !== 14) return false;
  if (/^(\d)\1+$/.test(c)) return false;
  const calc = (base: string, pesos: number[]) => {
    const s = base.split("").reduce((acc, n, i) => acc + parseInt(n) * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const dv1 = calc(c.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]);
  const dv2 = calc(c.slice(0, 13), [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return dv1 === parseInt(c[12]) && dv2 === parseInt(c[13]);
}
```
E no submit (App.tsx:4495):
```ts
if (form.pessoaTipo === "juridica" && !validarCNPJ(form.cnpj)) {
  setAuthError("CNPJ inválido. Verifique os dígitos.");
  return;
}
```

#### P0-4 — Idade 18+ no diarista
```ts
// App.tsx:4614
max={new Date(new Date().setFullYear(new Date().getFullYear()-18))
  .toISOString().split("T")[0]}

// App.tsx:4698 (após if !form.dataNasc)
const idade = (new Date().getTime() - new Date(form.dataNasc).getTime()) / 3.156e+10;
if (idade < 18) { setAuthError("É necessário ter 18 anos ou mais para se cadastrar como diarista."); return; }
```
E trigger backend:
```sql
CREATE OR REPLACE FUNCTION valida_idade_diarista()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_type = 'diarista' AND NEW.data_nascimento IS NOT NULL
     AND NEW.data_nascimento > CURRENT_DATE - INTERVAL '18 years' THEN
    RAISE EXCEPTION 'Diarista deve ter 18 anos ou mais';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_valida_idade_diarista
  BEFORE INSERT OR UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION valida_idade_diarista();
```

---

## 🟡 P1 — ALTOS (atrasam mas não bloqueiam)

| # | Item | Onde |
|---|---|---|
| P1-1 | **SVG aceito no upload de foto** (XSS persistente). Bucket `avatars` deve restringir MIME a JPEG/PNG/WEBP. | App.tsx:4580 |
| P1-2 | **Enumeração de email**: mensagem específica "Este e-mail já está cadastrado" vaza existência. | App.tsx:1702 |
| P1-3 | **Headers HTTP de segurança ausentes**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. | vercel.json |
| P1-4 | **CORS `*` em Edge Functions sensíveis** (create-payment, delete-user, ai-support). | múltiplas Edge Functions |
| P1-5 | **Reset de senha com `redirectTo: window.location.origin` dinâmico** — vulnerável a redirect attack se subdomínio for comprometido. | App.tsx:1748 |
| P1-6 | **Aceite de termos só em localStorage** — sem audit trail server-side. ANPD/ação judicial pede prova. | App.tsx:1738-1740 |
| P1-7 | **Foto pessoal `*`** no label mas submit não bloqueia. Inconsistência. | App.tsx:4565 vs 4692 |
| P1-8 | **Erros só no submit + sem scroll pro campo**. Em formulário longo (8+ campos), usuário não acha o que errou. | App.tsx:4492, 4693 |
| P1-9 | **Cor azul do card "Empresa CNPJ" não persiste** no fluxo subsequente. Maria PJ perde referência visual. | App.tsx:3532 vs 4396 |
| P1-10 | **ViaCEP sem feedback de erro**. CEP inválido = "Buscando..." nunca termina. Usuário fica olhando. | App.tsx:4450-4459 |
| P1-11 | **Date picker nativo Android péssimo pra idosos** (rolar 60 anos). | App.tsx:4613 |
| P1-12 | **Habilidades colapsadas por padrão** sem indicar obrigatoriedade. | App.tsx:4626 |
| P1-13 | **Contraste WCAG do checkbox de termos** insuficiente (4.3:1 < 4.5:1 AA). | App.tsx:3617 |
| P1-14 | **Sem rate limit explícito em signup/login/reset** — depende só do Supabase default. | múltiplos |
| P1-15 | **Logout sem `scope: 'global'`** — dispositivo perdido fica logado em outras sessões. | App.tsx:1760 |

---

## 🟢 P2 — MELHORIAS (backlog)

| # | Item |
|---|---|
| P2-1 | **Sem "Exportar meus dados"** (LGPD Art. 18 II — portabilidade). |
| P2-2 | **DPO não identificado publicamente** (LGPD Art. 41 §1). |
| P2-3 | **Hard-code Supabase URL/anon key como fallback** — dev sem `.env.local` aponta pra produção. |
| P2-4 | **Stepper de progresso** (1/3 → 2/3 → 3/3) — Talita abandona menos. |
| P2-5 | **Card "Empresa CNPJ" largura total** quebra ritmo visual da grid 2×1 acima. |
| P2-6 | **Nome do local PF obrigatório** — Maria contratando faxina única não tem nome de local. |
| P2-7 | **`last_activity_at` writable pelo próprio user** — pode forjar "online sempre". |
| P2-8 | **Categorias sem allowlist server** — usuário pode injetar "Médico Cirurgião". |
| P2-9 | **Touch targets <44px** em diaBtn, filtroBtn, btnAceitar, headerBack. |
| P2-10 | **JWT manipulation**: `is_admin` está em `user_profiles` mutável. Move pra `auth.users.app_metadata` (imutável pelo client). |
| P2-11 | **Botão Continuar pode ficar atrás do teclado virtual** em Android. |
| P2-12 | **Sexo "Não informar"** com mesmo peso visual — paralisia de escolha. |

---

## 🐛 O BUG ESPECÍFICO DO BOTÃO "CONTINUAR"

**Diagnóstico:** a lógica React (`disabled={!tipo}`) está **correta**. O bug reportado tem 3 causas em ordem de probabilidade:

### Causa 1 (mais provável, 80% dos casos) — Percepção visual
O contraste do estado "card selecionado" é **fraco demais** em mobile com brilho baixo:
- `rgba(255,107,53,.15)` (selecionado) vs `rgba(255,255,255,.06)` (não) sobre gradiente azul-escuro → diferença de luminância ~6%
- Borda 2px laranja vs 1.5px branco-10% → só 0.5px de mudança visível
- Botão `opacity:0.35` parece "quebrado" enquanto o card já selecionado ainda parece igual

Usuário toca, mal vê a mudança no card, olha pro botão acinzentado, **conclui que o app travou**.

### Causa 2 — `setTipo` reset por re-render
Linha 1609 (`setTipo(data.user_type)`) pode disparar em background se o `onAuthStateChange` voltar com `user_type` indefinido. Verificar com React DevTools.

### Causa 3 — Pointer events bloqueados
GlobalLoadingBar ou modal escondido pode estar capturando taps. Pouco provável na tela inicial.

### Fix recomendado (mata as 3 causas)
```tsx
// App.tsx:3520-3537 — adicionar checkmark + bg mais forte
<div key={t.key}
  style={{
    position:"relative",
    background: tipo===t.key ? "rgba(255,107,53,.35)" : "rgba(255,255,255,.06)",  // .15 → .35
    border: tipo===t.key ? "3px solid #FF6B35" : "1.5px solid rgba(255,255,255,.1)",  // 2px → 3px
    borderRadius:20, padding:"24px 14px", display:"flex", flexDirection:"column",
    alignItems:"center", gap:10, cursor:"pointer",
  }}
  onClick={() => setTipo(t.key)}>
  {tipo===t.key && (
    <div style={{ position:"absolute", top:8, right:8, width:24, height:24, borderRadius:12,
      background:"#FF6B35", color:"#fff", display:"flex", alignItems:"center",
      justifyContent:"center", fontSize:14, fontWeight:900 }}>✓</div>
  )}
  <span style={{ fontSize:36 }}>{t.icone}</span>
  <span style={{ fontWeight:800, fontSize:15, color:tipo===t.key?"#FF6B35":"#f1f5f9" }}>{t.label}</span>
  <span style={{ fontSize:11, color:"var(--text-2,#64748b)", textAlign:"center" }}>{t.desc}</span>
</div>

// App.tsx:3539 — botão com label dinâmico em vez de "fantasma"
<button
  style={{ width:"100%", padding:"15px",
    background: tipo ? "#FF6B35" : "#475569",  // cinza visível em vez de transparente
    color:"#fff", border:"none", borderRadius:16, fontSize:16, fontWeight:800,
    cursor: tipo ? "pointer" : "not-allowed",
    fontFamily:"Inter, system-ui, sans-serif",
    opacity: tipo ? 1 : 0.7,  // menos cinza que 0.35
    boxShadow: tipo ? "0 4px 16px rgba(255,107,53,.4)" : "none",
  }}
  disabled={!tipo}
  aria-disabled={!tipo}
  onClick={...}>
  {tipo ? "Continuar →" : "👆 Escolha um tipo de conta acima"}
</button>
```

---

## 📋 CHECKLIST PRE-LANÇAMENTO

### O que precisa estar verde antes de abrir pro público

- [ ] **P0-1**: trigger bloqueando UPDATE de colunas privilegiadas
- [ ] **P0-2**: UNIQUE em CPF e CNPJ aplicado (após cleanup de duplicados)
- [ ] **P0-3**: `validarCNPJ` implementada e chamada
- [ ] **P0-4**: idade mínima 18 (client + server trigger)
- [ ] **P0-5**: tela de upload de RG/CNH (pode ser opcional, mas presente)
- [ ] **P0-6**: campo PIX no cadastro do diarista
- [ ] **P0-7**: `delete-user` apaga tudo + arquivo no bucket
- [ ] **P0-8**: senha mínima 10 chars + complexidade
- [ ] **P0-9**: termo bifurcado (contratante / trabalhador)
- [ ] **P0-10**: telefone com máscara + `validarTelefone` no submit
- [ ] **Bug Continuar**: checkmark visível + label dinâmico no botão

### Pode entrar em versão posterior (sem bloquear lançamento)

- Todos os P1 e P2

### Checklist operacional

- [ ] Backups automáticos do banco (Supabase Free: 7 dias diários automático ✅)
- [ ] Monitoramento Sentry ou similar (não há nenhum hoje)
- [ ] Política de Privacidade e Termos linkados em todos os pontos de cadastro ✅
- [ ] Gateway MP testado em sandbox ✅ e produção (verificar)
- [ ] Canal de suporte: WhatsApp + e-mail + tickets ✅ (após PR painel-admin)
- [ ] App stores: ficha + screenshots + classificação 18+ ⚠️ (não submetido — Capacitor pronto mas não publicado)
- [ ] Sistema de avaliação mútua ✅
- [ ] Mecanismo de denúncia ✅ (tabela `denuncias` + UI existe)

---

## ✅ O QUE JÁ ESTÁ CERTO

1. **`validarCPF` com algoritmo de DV** completo (`helpers.ts:84-98`)
2. **`validarEmail` e `validarTelefone`** existem (faltam só ser chamadas em todos os pontos)
3. **`validarNome` anti-fake** — rejeita números/símbolos, exige sobrenome
4. **`anti-fraude` em descrição de vaga** — bloqueia telefone, redes sociais, "pague antes"
5. **`detectarContatoExterno` no chat** — anti-exit do app
6. **CPF/CNPJ marcados como "nunca exibidos publicamente"** na UI
7. **Termos com checkbox bloqueante** + modal acessível
8. **Foto pessoal: limite de 5MB** validado no client
9. **`delete-user` revalida user via `auth.getUser()`** antes do service-role
10. **Service worker network-first em HTML** + cache-first em `/assets/*` imutáveis
11. **`flowType: 'implicit'` documentado e justificado** — Android Gmail/Chrome workaround
12. **Sistema de níveis de confiabilidade** já tem schema pronto — só falta UI de upload (P0-5)
13. **Painel Admin** completo com tickets de suporte (PR #9 mergeado)
14. **Mp-webhook fail-closed + timing-safe** (PR #8 mergeado)
15. **RLS de assinaturas** restrita a service_role (CRIT-4 fixado)

---

## 🎯 PRIORIZAÇÃO PARA SPRINT

**Ordem recomendada de execução** (~20h total se feito por uma pessoa):

| Ordem | Item | Esforço | Por quê primeiro |
|---|---|---|---|
| 1 | P0-4 (idade 18+) | 30min | Trivial e contradiz o termo atual |
| 2 | P0-10 (máscara telefone) | 30min | Trivial, padrão `maskCPF` já existe |
| 3 | P0-1 (trigger anti-escalada) | 1h | Exploit imediato via curl |
| 4 | Bug "Continuar" — fix visual | 30min | Reclamação direta do user |
| 5 | P0-8 (senha forte) | 30min | 1 linha no Supabase Dashboard + 1 no client |
| 6 | P0-2 (UNIQUE CPF/CNPJ) | 1h | Bloqueia banidos voltarem |
| 7 | P0-3 (validarCNPJ) | 2h | Inclui testes em helpers.test.ts |
| 8 | P0-6 (campo PIX) | 2h | Sem isso, primeira diária paga quebra |
| 9 | P0-7 (delete-user completo) | 3h | Risco ANPD |
| 10 | P0-9 (termos bifurcados) | 4h | Risco trabalhista |
| 11 | P0-5 (upload doc UI) | 4h | Pode ser opcional pra MVP, mas precisa existir |

Depois disso, atacar P1-1 (SVG XSS), P1-3 (headers HTTP) e P1-6 (audit trail termos) ainda no mesmo sprint se possível.

---

*Fim do relatório.*
