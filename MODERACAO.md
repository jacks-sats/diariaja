# 👮 Política de Moderação — DiáriaJá

**Última revisão:** 2026-05-27
**Princípio:** mínimo intervencionismo + máxima segurança dos usuários. Removemos o que viola a lei ou nossos Termos; não censuramos opinião.

---

## 1. O que pode ser denunciado

| Categoria | Exemplos | Ação padrão |
|---|---|---|
| **Conteúdo ilegal** | Drogas, armas, pornografia, ameaça | Remoção imediata + banimento + comunicação às autoridades quando aplicável |
| **Assédio / discriminação** | Mensagens com discurso de ódio, racismo, machismo, homofobia, capacitismo | Aviso + remoção; reincidência = banimento |
| **Golpe / fraude** | Pedido de adiantamento, link suspeito, identidade falsa | Remoção + banimento + nota pública nas avaliações |
| **Conteúdo enganoso** | Foto/identidade de terceiros, dados falsos em KYC | Reversão de selo + suspensão até reverificação |
| **Spam comercial** | Anúncio de outros apps, marketing não solicitado | Remoção + aviso; reincidência = suspensão |
| **Vaga abusiva** | Valor muito abaixo da média, condições degradantes | Remoção da vaga + aviso ao contratante |
| **Trabalho infantil** | Vaga ou perfil sugerindo menor de 18 | Banimento imediato + alerta ao Conselho Tutelar quando aplicável |

---

## 2. Fluxo da denúncia

```
Usuário toca "🚩 Denunciar"
   ↓
Modal de denúncia (motivo + descrição)
   ↓
INSERT em tabela `denuncias` (timestamp, denunciante_id, alvo, motivo, status='aberta')
   ↓
Push notificação pro admin (futuro)
   ↓
Admin revisa no painel admin
   ↓
Decide: arquivar | advertir | suspender | banir
   ↓
UPDATE status + notifica denunciante e (quando cabível) alvo
```

**Tempo de resposta esperado:** até 48h úteis. Casos críticos (ameaça física, menor de idade) em até 4h úteis.

---

## 3. Onde é possível denunciar hoje

| Local | Disponível? |
|---|---|
| Perfil de diarista | ✅ |
| Perfil de contratante | ✅ |
| Card de vaga | ✅ |
| **Chat 1-a-1** | ❌ **Pendente** — exigido pelas app stores |
| **Tópicos da comunidade** | ❌ **Pendente** |
| **Comentários da comunidade** | ❌ **Pendente** |

---

## 4. Sanções

Escala de gravidade (decisão do admin):

| Nível | Sanção | Reversível? |
|---|---|---|
| 1 | Advertência por push + nota interna | Sim |
| 2 | Remoção do conteúdo denunciado | Sim |
| 3 | Suspensão temporária (7 dias) | Sim |
| 4 | Perda de selo (Verificado / Confiável) | Sim, após reverificação |
| 5 | Banimento permanente da conta | Não (CPF marcado, não pode recadastrar) |

⚠️ **Pendente técnica:** lista negra de CPF banido. Hoje, banir conta apenas a impede de logar — recadastro com mesmo CPF falha pelo UNIQUE, mas o user pode tentar com outro nome num CPF de laranja.

---

## 5. Bloqueio entre usuários (NÃO denúncia)

⚠️ **Pendente:** Sistema de bloqueio direto (usuário A bloqueia B → não se veem nem podem contatar). É exigência das app stores. Próxima sessão:
- Tabela `usuarios_bloqueados(user_id, alvo_id, criado_em)`
- Filtros em feed, listagem de candidatos, chat, busca de diaristas.

---

## 6. Conteúdo que NÃO removemos por decisão arbitrária

- Avaliações negativas honestas (mesmo que duras).
- Opiniões controversas mas dentro da lei.
- Críticas à plataforma (inclusive em tópicos da comunidade).

**Princípio:** removemos por violação clara dos Termos ou da lei, não por insatisfação.

---

## 7. Trilha de auditoria

Toda ação de moderação deve gerar registro com:
- `admin_id` (quem decidiu)
- `target_user_id` ou `target_content_id`
- `acao` (arquivada, advertência, suspensão, banimento)
- `motivo`
- `timestamp`

⚠️ **Pendente:** tabela dedicada `moderacao_acoes`. Hoje o registro vive em `denuncias.status` + atualizações de `user_profiles` sem log.

---

## 8. Comunicação com o usuário

| Evento | Canal | Quem comunica |
|---|---|---|
| Denúncia recebida | Push (em breve) | Sistema |
| Conta suspensa | Push + e-mail (em breve) | Admin |
| Conta banida | Push + e-mail | Admin |
| Denúncia arquivada (sem ação) | Push opcional | Sistema |

---

## 9. Apelação

Usuário sancionado pode mandar e-mail para `suporte@diariaja.com.br` com:
- ID da conta
- Motivo da apelação
- Evidências

Admin reavalia em até 5 dias úteis. Decisão final: aceitar apelação (reverter sanção) OU manter (com justificativa).

---

## 10. Casos especiais

### 10.1 Menor de idade detectado

- Suspensão imediata da conta.
- Não permitir recadastro pelo mesmo CPF (UNIQUE).
- Se o user é o próprio menor (não foi conta laranja), avaliar comunicação aos responsáveis.

### 10.2 Crime detectado

- Cooperação com autoridades mediante ofício/intimação judicial.
- Não entregamos dados sem ordem judicial (princípio de proteção do usuário).

### 10.3 Violação de Termos sem dano a terceiros

- Aviso pedagógico antes de sanção (1ª ocorrência).
