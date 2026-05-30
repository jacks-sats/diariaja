# Fluxos de Contratação — DiáriaJá

**Status:** verificado contra o código em 2026-05-30
**Modelo de pagamento:** a plataforma **NÃO intermedia o valor da diária** — ele
é combinado e pago **direto entre anunciante e diarista**. A receita da DiáriaJá
vem do **R$ 1 para liberar contato** (plano grátis, ao estourar a cota do mês) e
de **assinaturas**.

Este documento descreve os dois caminhos de contratação **como o código funciona
hoje**, com as lacunas explícitas em relação ao fluxo ideal.

---

## Fluxo 1 — Candidatura (o prestador demonstra interesse)

```
anunciante cria vaga (status: aberta)
        │
        ▼
prestador marca interesse  → candidaturas.status = 'pendente'   (App.tsx:3862)
        │                     push pro anunciante
        ▼
anunciante seleciona o candidato
        │   • RPC pode_selecionar_candidato:
        │       - dentro da cota grátis OU plano pago → segue
        │       - estourou a cota grátis → paga R$ 1 (create-contact-payment)
        │   • diária.status = 'pendente', diarista_aceite_id setado  (App.tsx:3916)
        │   • demais candidatos → 'rejeitado'
        ▼
prestador confirma presença → diária.status = 'aceita'          (App.tsx:4100)
        │                       candidatura.status = 'confirmado'
        ▼
   ✅ chat liberado  +  📍 endereço revelado   (ambos em 'aceita') (App.tsx:13142, 10713)
        │
        ▼
no dia: check-in (QR/GPS/código) → 'em_andamento' → check-out → 'concluida'
        (Fase A — RPC registrar_checkin / registrar_checkout)
```

**Importante:**
- O "paga" da seleção é o **R$ 1 de contato** (e só se estourou a cota grátis) —
  **não** é o valor da diária.
- Chat e endereço só abrem **depois** que o prestador confirma (status `aceita`).

**Lacunas vs. o fluxo ideal:**
- ❌ **Estorno do R$ 1** se o prestador não confirmar — **não existe**.
- ⚠️ **"Vaga volta a ficar disponível"** — só acontece se o prestador clicar em
  **desistir** (`desistirDiaria` → volta a `aberta`, App.tsx:2965). Se ele apenas
  some, a vaga fica presa em `pendente` e **expira** (vira `expirada`, não reabre
  para escolher outro candidato).

---

## Fluxo 2 — Convite (o anunciante chama o prestador)

```
anunciante escolhe um prestador na home → convites.insert status='pendente'  (App.tsx:3089)
        │   push + realtime pro prestador                                    (App.tsx:1682)
        ▼
prestador responde: tem interesse?  → responderConvite('aceito'|'recusado')  (App.tsx:3117)
        │   ✅ agora notifica o anunciante de volta (push)  ← corrigido nesta entrega
        ▼
anunciante libera o contato
        │   • desbloquearContato: paga R$ 1 se necessário (create-contact-payment) (App.tsx:3962)
        │   • contato entra em contatosLiberados → chat liberado
        ▼
combinam a diária no chat (pagamento da diária é direto entre eles)
```

**Importante:**
- No convite, **o "aceito" já é a confirmação** — não há um segundo passo de
  "confirmar presença" como na candidatura.
- O "paga e libera chat" é o **R$ 1 de contato**.

**Lacunas vs. o fluxo ideal:**
- ❌ **Estorno do R$ 1** se o prestador recusar — **não existe** (e, na prática, o
  R$ 1 é cobrado na liberação do contato, normalmente **após** o aceite).

---

## Política do R$ 1 quando não vira diária — DECIDIDO: crédito interno ✅

O fluxo ideal pede "estorno". Como há tensão direta com a receita
("preciso ganhar"), foi uma **decisão de negócio**. Opções avaliadas:

| Opção | Efeito na receita | Efeito na confiança | Complexidade |
| --- | --- | --- | --- |
| A. Não devolver (status quo) | 👍 máxima | 👎 anunciante paga e pode não fechar | nenhuma |
| **B. Crédito interno** ✅ **escolhido** | 😐 neutra (não perde dinheiro, só não cobra 2x) | 👍 boa | média |
| C. Estorno real do R$ 1 via Mercado Pago | 👎 perde a receita | 👍 máxima | alta |

**Decisão: opção B (crédito interno)** — preserva a receita e não pune o anunciante
por um prestador que sumiu.

### Como o crédito interno funciona (implementado)

A cota grátis do mês é contada por `diarias` com `diarista_aceite_id` setado no
mês (limite = 3 + desbloqueios R$ 1). O crédito acontece **devolvendo a cota**,
não dinheiro:

- **Desistência do prestador** (`desistirDiaria`): limpa `diarista_aceite_id` →
  a diária deixa de contar **automaticamente**. (Já era assim.)
- **No-show** (`migration credito_interno_no_show.sql`): a seleção que expira sem
  virar diária (`status = 'expirada'`) deixa de contar na cota — o anunciante
  recupera a vaga grátis daquele mês para escolher outro, **sem pagar de novo**.
- Os desbloqueios R$ 1 (`contatos_desbloqueios`) somam ao limite o mês inteiro,
  então um R$ 1 "perdido" num no-show vira crédito utilizável em outra seleção.

> Sobre "reabrir a vaga": no no-show o horário da diária **já passou**, então
> reabrir a mesma vaga não faz sentido — o que vale é devolver a **cota** (acima),
> e isso está feito. Para desistência antes da data, a vaga volta a `aberta`
> normalmente (`desistirDiaria`).

## Entregue
- ✅ Notificação ao anunciante quando o prestador responde ao convite (push).
- ✅ Correção do `CLAUDE.md` (modelo de pagamento estava desatualizado).
- ✅ Este documento de fluxos verificados.
- ✅ **Crédito interno**: no-show não consome a cota de seleção do mês.
- ℹ️ Feedback obrigatório de no-show já é coberto pela Fase A.5.
