# ⚖️ Risco Jurídico — DiáriaJá

**Última revisão:** 2026-05-27
**Foco:** mitigar risco de vínculo trabalhista (CLT/LC 150) e responsabilidade civil sobre operações entre usuários.

> Este documento NÃO substitui parecer de advogado. É um inventário interno de riscos identificados e mitigações já implementadas, pra acelerar a conversa com o jurídico.

---

## 1. Posicionamento estratégico da plataforma

O DiáriaJá é uma **plataforma de conexão** (marketplace de match), NÃO um empregador. Nosso modelo:

| O que FAZEMOS | O que NÃO fazemos |
|---|---|
| Apresentar contratantes e diaristas autônomos | Empregar diaristas (sem CLT, sem registro) |
| Liberar contato após match qualificado | Controlar jornada / horário de trabalho |
| Cobrar R$1 por seleção extra (cota grátis) | Definir salário/remuneração obrigatória |
| Oferecer planos opcionais para destaque | Intermediar o pagamento da diária |
| Hospedar avaliações e denúncias | Custodiar dinheiro (sem carteira interna) |
| Verificar identidade (KYC opcional) | Fazer split de pagamento |
| Permitir QR Code de chegada (prova bilateral) | Administrar PIX entre partes |

O **valor da diária é negociado e pago diretamente entre as partes**, fora da plataforma, via PIX. Isso é arquitetural — não é só copy.

---

## 2. Risco trabalhista — CLT e LC 150/2015

### 2.1 Análise do risco

A Justiça do Trabalho pode reconhecer vínculo de emprego (CLT) ou doméstico (LC 150) se houver os 4 elementos do art. 3º da CLT:
1. **Pessoalidade** — sempre o mesmo profissional
2. **Onerosidade** — remuneração regular
3. **Habitualidade** — repetição constante
4. **Subordinação** — comando, controle, jornada

Como mitigamos cada um:

| Elemento | Mitigação técnica/contratual |
|---|---|
| Pessoalidade | Plataforma incentiva escolha entre múltiplos diaristas (até 5 candidatos por vaga) |
| Onerosidade | Valor por diária pontual, sem mensalidade. Pagamento fora da plataforma |
| Habitualidade | Termos alertam o contratante (cláusula 9) sobre risco de habitualidade configurar vínculo doméstico |
| Subordinação | App NÃO tem registro de ponto, NÃO controla jornada, NÃO mede produtividade, NÃO atribui tarefas |

### 2.2 Pontos de atenção identificados (auditoria 27/05)

| Item | Onde | Status |
|---|---|---|
| Termo de Presença | App.tsx | ⚠️ **Renomear** para "Termo de Confirmação de Início" — "presença" remete a controle CLT |
| QR Code de chegada | App.tsx | ✅ Mantido — é prova **bilateral** (ambos confirmam), não controle unilateral. Reforçar em copy |
| Palavra "empregador" usada em ~257 lugares | App.tsx, constants.ts, types.ts | ⚠️ **Pendente**: rename pra "contratante". Mitigado parcialmente nos Termos (cláusula 9) que já estabelece autonomia |
| AI Jájá usava "empregador" | `supabase/functions/ai-support/index.ts` | ✅ **Corrigido nesta revisão** — prompt reescrito com regra explícita anti-CLT |
| "(CLT/LC 150)" como justificativa de 18+ | App.tsx:7165 | ✅ **Corrigido** → "(art. 7º, XXXIII, CF/88)" |
| Termo nos Termos de Uso declarando ausência de vínculo | App.tsx:5050, cláusula 9 | ✅ Mantido — protetivo |

### 2.3 Recomendações pendentes

1. **Rename "empregador" → "contratante" em toda a UI** (mantém `empregador_id` no banco por retrocompat). É refator grande (~257 ocorrências) e merece sessão dedicada com testes manuais — não fazer em rush.
2. **Renomear "Termo de Presença" → "Termo de Confirmação de Início da Prestação"** nos modais.
3. **Banner explícito** após 3 diárias com o mesmo profissional: "⚠️ Atenção: contratações habituais com o mesmo profissional podem configurar vínculo doméstico (LC 150/2015). Avalie obrigações legais."
4. **Avaliação jurídica formal** dos textos atuais com advogado trabalhista.

---

## 3. Risco de intermediação financeira (Banco Central / IF)

### 3.1 Análise

Plataformas que custodiam dinheiro, fazem split ou movimentam recursos podem ser enquadradas como instituição de pagamento (Lei 12.865/2013, regulamentações BCB).

Como evitamos:

| Atividade | Status |
|---|---|
| Custódia de saldo | ❌ Não fazemos |
| Carteira interna | ❌ Não fazemos |
| Split automático | ❌ Não fazemos |
| Intermediação do PIX da diária | ❌ Não fazemos |
| Cobrança de transação financeira | ✅ Apenas R$1 unlock + assinaturas, via Mercado Pago (que é a instituição de pagamento regulamentada) |
| Recibo fiscal próprio | ❌ Não fazemos — recibo digital é prova bilateral, não fiscal |

**Conclusão:** o modelo está fora do escopo regulatório do BCB. Manter assim é prioridade estratégica.

---

## 4. Risco UGC (conteúdo gerado por usuário)

### 4.1 Análise

Marco Civil da Internet (Lei 12.965/2014):
- Art. 19: provedor não responde por conteúdo de terceiro a menos que **descumpra ordem judicial específica** de remoção.
- Art. 21: responsabiliza se não remove conteúdo de "nudez ou ato sexual de caráter privado" após notificação extrajudicial.

Para se manter no porto seguro:

| Controle | Status |
|---|---|
| Sistema de denúncia em **perfis** | ✅ |
| Sistema de denúncia em **vagas** | ✅ |
| Sistema de denúncia em **chat** | ❌ **Pendente** — exigência das app stores |
| Sistema de denúncia em **tópicos/comentários** da comunidade | ❌ **Pendente** |
| Sistema de **bloqueio** de usuário | ❌ **Pendente** — exigência das app stores |
| Painel admin de moderação | ✅ (KYC + antecedentes; falta UGC) |
| Termos de Uso com vedações claras (assédio, golpe, ilegal) | ✅ |
| Logs de denúncias com timestamp | ✅ (tabela `denuncias`) |

### 4.2 Recomendações

- Implementar denúncia em chat + comunidade (sessão futura).
- Implementar bloqueio de usuário (tabela `usuarios_bloqueados` + filtros em feed/chat).
- Política de moderação documentada em [`MODERACAO.md`](./MODERACAO.md).

---

## 5. Riscos por usuário — golpe, assédio, fraude

### 5.1 Vetores conhecidos

| Risco | Mitigação atual |
|---|---|
| Fake account pra aplicar golpe | KYC opcional (RG/CNH); CPF UNIQUE no banco; selo Verificado/Confiável |
| Golpe de PIX (cliente paga e diarista não aparece) | Chat só após R$1 (custo do golpista) + nível de confiança + avaliações |
| Assédio em chat | Denúncia em perfil; chat só após match (custo de entrada) |
| Spam/bot | ⚠️ Sem captcha, sem rate-limit em endpoints públicos. Pendente. |
| Conta múltipla com CPF reutilizado | ✅ Constraint UNIQUE em CPF/CNPJ |
| Antecedentes criminais ocultos | ✅ Upload opcional + revisão admin (`antecedentes_criminais.sql`) |

### 5.2 Recomendações

- Rate-limit em endpoints públicos (`lookup-by-cpf`, `ai-support`, cadastro).
- Detecção básica de palavras-bloqueio em chat (auto-flag pra revisão).
- Termos com cláusula clara: "DiáriaJá não garante execução do serviço nem o pagamento — é responsabilidade exclusiva das partes."

---

## 6. Resumo executivo — pra advogado

🔴 **Crítico (não pode esperar):**
- Política de Privacidade e Termos revisados por advogado especializado em LGPD + tech.
- Nomeação formal de Encarregado (DPO).
- Aviso de transferência internacional de dados (Supabase, Groq, Vercel nos EUA).

🟠 **Importante (próximas semanas):**
- Avaliação trabalhista dos textos atuais (Termo de Início, Termo de Ciência, QR Code).
- Banner de habitualidade na 3ª contratação do mesmo diarista.
- DPA (Data Processing Agreement) com Supabase.

🟡 **Backlog (validar antes de escalar):**
- Rename "empregador" → "contratante" em todo o app.
- Aviso pré-contratação sobre obrigações trabalhistas (LC 150) pra contratante doméstico.
- Avaliação se a plataforma deve ter CNPJ próprio (não pessoa física) antes do crescimento.
