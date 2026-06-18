# Fase 2 (pós-lançamento) — Contrato de prestação de serviço

> **Status:** plano oficial aprovado. **Não implementar até o lançamento.**
> Documento de planejamento — nenhum código foi escrito.

Objetivo: atender empresas que contratam serviço por CNPJ/contrato (promotores,
repositores, açougueiros, etc.). Além do recibo que já existe, gerar um
**contrato de prestação de serviço em PDF**, adaptável a PF (autônomo) e
PJ/MEI (entre CNPJs). A plataforma **não emite nota fiscal**.

---

## Decisões de produto (aprovadas)

1. **Quando gerar:** sob demanda (botão "gerar contrato").
2. **PF e PJ:** liberar os dois — não exigir CNPJ de ambos. O contrato se adapta:
   PF = prestação de serviço autônomo; PJ/MEI = entre CNPJs.
3. **Aceite:** documento **informativo** + registro do aceite in-app
   ("li e aceito" grava data/hora) como **assinatura eletrônica simples**.
   Sem e-signature de verdade no MVP.
4. **Texto jurídico:** o template vem de **advogado** (o dono providencia). A
   implementação só **preenche** o template — **não inventa cláusulas**.
5. **CNPJ externo:** usar **BrasilAPI** — auto-preencher razão social/endereço e
   **bloquear CNPJ inativo/inapto**.
6. **CNPJ do prestador:** **opcional**, no `editar-perfil`, puxado pelo banner
   MEI. **Nunca obrigatório no cadastro.**
7. **Lib de PDF:** ok adicionar **pdf-lib** numa **Edge Function** (server-side),
   salvando no **Storage**.

---

## Diagnóstico (estado atual do código)

### CNPJ e dados das partes
- Já existe fluxo **`cadastro-empresa`** (`App.tsx`) + Edge Function
  **`signup-empresa`**: captura `cnpj`, `razão social`, `nome fantasia`,
  e-mail, telefone, endereço. PJ entra como `pessoa_tipo: "juridica"`.
- Validação atual: `validarCNPJ` (dígitos) + dup-check via RPC
  `cnpj_ja_cadastrado`. **Não há consulta externa** (razão social é digitada;
  não se confere se o CNPJ está ativo).
- O **prestador** pode ter CNPJ (MEI) — campo no `editar-perfil` + `bannerMEI`.
- **Dados disponíveis para o contrato:**
  - Contratante: razão social/nome, cnpj (ou cpf), endereço, pessoa_tipo.
  - Prestador: nome, cpf/cnpj (MEI opcional), função, valor/dia.
  - Serviço: função/descrição, data, horário, local, valor.
- **Gap:** `cpf`/`cnpj` são privados (RLS — `prestadores_publicos` remove esses
  campos). Gerar contrato exige ler o documento das **duas partes** → só via
  **RPC SECURITY DEFINER** (como `meu_perfil`). Pode faltar razão social do
  prestador MEI e endereço completo de ambos.

### Recibo e PDF
- O "recibo" atual **não é PDF** — é um **modal HTML** (`modalRecibo` /
  `modalReciboDiarista`) e o "compartilhar" manda só **texto**.
- **Não há lib de PDF** no projeto → nada a reaproveitar na geração; o template
  do recibo serve só de inspiração visual.
- ✅ A favor: **Supabase Storage já é usado** e o app **já exibe PDFs**
  (antecedentes) → guardar/baixar contrato em PDF no Storage é viável.

---

## Pré-requisitos antes de executar
- **Template do contrato (texto do advogado)** — bloqueia PR5/PR6. Precisa de 2
  variantes: **PF** (autônomo) e **PJ/MEI** (entre CNPJs), com placeholders
  (`{{contratante}}`, `{{prestador}}`, `{{cnpj}}`, `{{servico}}`, `{{valor}}`,
  `{{data}}`, `{{local}}`, …) + cláusula "**plataforma não emite NF**".
- Definir nome do bucket (`contratos`) e retenção.

---

## Quebra em PRs pequenos

### Lado CNPJ/PJ (não dependem do advogado — começar por aqui)

**PR1 — Edge Function `consultar-cnpj` (BrasilAPI) + `cadastro-empresa`** · ~1 dia · independente
- Função Deno: CNPJ → BrasilAPI → `{razao_social, nome_fantasia, situacao, endereco}`;
  trata timeout/erro; sinaliza inativo/inapto.
- No `cadastro-empresa`: CNPJ válido → auto-preenche razão social/endereço e
  **bloqueia** se situação ≠ ATIVA. Mantém o dup-check atual.

**PR2 — CNPJ do prestador (MEI) no `editar-perfil`** · ~0,5 dia · depende de PR1
- Reusa `consultar-cnpj`; prestador informa CNPJ (via banner MEI, opcional,
  nunca no cadastro) → valida + auto-preenche + bloqueia inativo.

**PR3 — Selo "🏢 PJ" + filtro no anunciante** · ~1 dia · independente
- Migration: expor `pessoa_tipo`/`tem_cnpj` em `prestadores_publicos` (sem vazar
  o CNPJ).
- Front: selo PJ no `perfil-diarista-real` + cards; chip "Só CNPJ/PJ" no filtro
  do anunciante.

**PR8 — Disclaimer NF + gancho "como emitir sua NF"** · ~0,5 dia · independente
- Garante o disclaimer no template + seção/help **placeholder** "Como emitir sua
  NF" (link/guia pro MEI), sem integração fiscal.

### Trilha do contrato (entra com o template do advogado em mãos)

**PR4 — Infra do contrato (migrations)** · ~1 dia · sem UI
- Tabela **`contratos`** (vínculo à diária/convite, contratante_id,
  prestador_id, tipo PF/PJ, pdf_url, `gerado_em`, `aceite_contratante_em`,
  `aceite_prestador_em`) + **RLS** (só as 2 partes leem).
- Bucket Storage **`contratos`** + policy restrita às partes.
- RPC SECURITY DEFINER **`dados_contrato(...)`** → dados das 2 partes (incl.
  CPF/CNPJ privados) só pras partes.

**PR5 — Edge Function `gerar-contrato` (pdf-lib + Storage)** · ~2–3 dias · depende de PR4 + template
- Lê `dados_contrato`, escolhe template **PF ou PJ**, preenche, gera **PDF com
  pdf-lib**, salva no bucket, grava linha em `contratos`, devolve URL. Sem
  inventar cláusula — só preenche o do advogado.

**PR6 — UI "📄 Gerar contrato" (sob demanda)** · ~1 dia · depende de PR5
- Botão na diária/convite (sob demanda) → chama `gerar-contrato` → abre/baixa o
  PDF (reusa o viewer de PDF dos antecedentes).

**PR7 — Aceite in-app (assinatura eletrônica simples)** · ~1 dia · depende de PR4/PR6
- "Li e aceito" pros dois lados → grava `aceite_*_em` (data/hora + user) em
  `contratos`. Mostra o status de aceite no documento/tela. Evidência de
  consentimento (sem e-signature de verdade).

---

## Ordem de execução e dependências

```
Liberação do dono
  ├─ PR1 → PR2            (CNPJ lookup)
  ├─ PR3                  (selo/filtro)
  └─ PR8                  (disclaimer NF)        ← esses 4 não dependem do advogado

Template do advogado em mãos
  └─ PR4 → PR5 → PR6 → PR7 (trilha do contrato)  ← PR5 bloqueado pelo template
```

**Esforço total estimado: ~1–1,5 semana**, assumindo o template pronto.

---

## Observações
- PR1, PR2, PR3 e PR8 já dão pra executar sem o advogado.
- A trilha do contrato (PR4–PR7) espera o template jurídico.
- Tudo Fase 2 — só executar após o lançamento, com o "ok" do dono.
