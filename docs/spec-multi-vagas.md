# Spec — Múltiplas vagas por diária (selecionar vários contratados)

> **Objetivo (pedido do dono):** o anunciante define **quantas vagas** a diária
> oferece ao publicar e pode **selecionar mais de um** candidato, até preencher
> todas as vagas. Ex.: precisa de 3 diaristas pra mesma data → publica com 3
> vagas e seleciona 3 pessoas.
>
> **Decisão de cobrança (confirmada):** _cada vaga conta_ — cada contratado
> selecionado é um contato (conta na cota mensal e, estourando, R$1 por contato
> no plano grátis). Plano pago = ilimitado. Mantém a monetização atual.

## Por que é uma reforma do núcleo

Hoje o app é **1 contratado por diária**:

- `diarias.diarista_aceite_id` é coluna **única** (um diarista só).
- Ao selecionar um candidato (`executarSelecaoCandidato`, `App.tsx`), o código
  marca a candidatura dele como `selecionado` e **rejeita todas as outras**.
- **Chat** (`enviarMensagemReal`), **check-in** (`registrar_checkin`), **recibo**
  e **avaliação** leem o único `diarista_aceite_id`.
- A **cobrança** (`pode_selecionar_candidato` / `enforce_limite_selecao_candidato`)
  conta diárias do mês com `diarista_aceite_id IS NOT NULL`.

Multi-vaga troca "um diarista por diária" por "N contratações por diária", então
mexe em todos esses pontos.

## Modelo de dados (já no schema — `multi_vagas_schema.sql`)

- `diarias.vagas` INT default 1 — quantas posições a diária oferece.
- `diarias.vagas_preenchidas` INT default 0 — contador denormalizado.
- `diaria_contratacoes(id, diaria_id, diarista_id, empregador_id, status, created_at)`
  — **uma linha por contratação**. `status ∈ {selecionado, confirmado,
  cancelada, concluida}`. `UNIQUE(diaria_id, diarista_id)`.
- `diarias.diarista_aceite_id` é mantido como **contratado principal** (o 1º/mais
  recente) para compatibilidade — com `vagas=1` nada muda.

> Enquanto `vagas=1` (default de toda diária existente), o comportamento é
> idêntico ao de hoje. A feature só "liga" quando `vagas > 1`.

## Mudanças de banco (aplicar JUNTO com o frontend)

A contagem da cobrança passa a contar **contratações do mês**, não diárias.
Substituir as duas contagens em `cobranca_r1_sempre_contato.sql`:

```sql
-- ANTES (conta diárias com diarista selecionado):
SELECT COUNT(*) INTO v_selecoes_mes
  FROM diarias
 WHERE empregador_id = v_uid
   AND diarista_aceite_id IS NOT NULL
   AND status <> 'expirada'
   AND created_at >= date_trunc('month', NOW());

-- DEPOIS (conta contratações, cada vaga = 1 contato):
SELECT COUNT(*) INTO v_selecoes_mes
  FROM diaria_contratacoes
 WHERE empregador_id = v_uid
   AND status <> 'cancelada'
   AND created_at >= date_trunc('month', NOW());
```

- `pode_selecionar_candidato`: trocar a contagem como acima.
- `enforce_limite_selecao_candidato`: hoje é trigger em `diarias` no
  `diarista_aceite_id NULL→valor`. Passa a valer **por contratação** — virar
  trigger `BEFORE INSERT ON diaria_contratacoes` aplicando a mesma regra (cota
  grátis 0 + extras R$1; pago = ilimitado), contando como acima.
- Trigger para manter `diarias.vagas_preenchidas` e fechar a vaga:
  `AFTER INSERT/UPDATE/DELETE ON diaria_contratacoes` → recalcula
  `vagas_preenchidas = COUNT(status IN ('selecionado','confirmado','concluida'))`;
  quando `vagas_preenchidas >= vagas`, marcar `diarias.status` como fechada para
  novas seleções (ex.: `'preenchida'`) e rejeitar candidaturas restantes.

## Mudanças de frontend (`src/App.tsx`)

1. **Criar diária** (tela `criar-diaria`): stepper "Quantas vagas?" (1–N, default
   1). Incluir `vagas` no `insert` de `diarias`. Esconder/forçar 1 para
   `tipo_oferta` que não faça sentido (avaliar emprego/serviço).
2. **Tipo** `Diaria` (`src/types.ts`): adicionar `vagas?: number` e
   `vagas_preenchidas?: number`. Incluir as colunas no `select` da listagem
   (linha ~1470).
3. **Card da diária**: badge "N vagas"; para o empregador, "X de N preenchidas".
4. **`selecionarCandidato` / `executarSelecaoCandidato`**:
   - Bloquear se `vagas_preenchidas >= vagas` ("Todas as vagas preenchidas").
   - Cobrança R$1 por contratação (a RPC já passa a contar contratações).
   - Em vez de gravar `diarista_aceite_id` + rejeitar todos, **inserir** em
     `diaria_contratacoes(status='selecionado')`. Só rejeitar as demais
     candidaturas quando a **última** vaga for preenchida. Setar
     `diarista_aceite_id` = 1º contratado (compat).
5. **Diarista confirma** (`executarConfirmarPresenca`): atualizar a linha de
   `diaria_contratacoes` para `confirmado` (além de `candidaturas`).
6. **Chat** (`enviarMensagemReal`, abrir chat): quando `vagas>1`, o empregador
   escolhe **com qual contratado** conversar (lista de contratados). O
   destinatário sai da contratação selecionada, não do `diarista_aceite_id`
   único. (`mensagens` continua por `diaria_id`; considerar coluna de par
   `diarista_id` p/ separar as threads — ver "Pendências".)
7. **Check-in / recibo / avaliação**: iterar por `diaria_contratacoes` em vez do
   único `diarista_aceite_id`. `registrar_checkin` passa a validar contra a
   contratação do diarista chamador.
8. **Cancelamentos**: cancelar uma contratação → `status='cancelada'` (libera a
   vaga, decrementa `vagas_preenchidas`); excluir diária já cascateia (FK
   `ON DELETE CASCADE`).
9. **Realtime**: as inscrições que filtram por `diarista_aceite_id` precisam
   passar a observar `diaria_contratacoes` para notificar os N contratados.

## Casos de borda

- `vagas=1` → idêntico ao fluxo atual (regressão zero é o critério de aceite).
- Anunciante não pode selecionar o mesmo diarista 2× (UNIQUE garante no banco).
- Reduzir `vagas` depois de publicado: não permitir abaixo de `vagas_preenchidas`.
- No-show de uma contratação não conta na cota (status `cancelada`/crédito
  interno — manter a regra de `credito_interno_no_show.sql`).
- Push: notificar cada contratado individualmente (já é por lista de ids).

## Ordem de implementação sugerida (PR próprio, testar no device)

- [ ] Aplicar `multi_vagas_schema.sql` no Supabase (seguro, aditivo).
- [ ] Banco: atualizar RPC/trigger de cobrança p/ contar contratações + trigger
      de `vagas_preenchidas`/fechamento.
- [ ] Tipos + `select` da listagem (`types.ts`, `App.tsx`).
- [ ] Criar-diária: campo "vagas".
- [ ] Card: badge de vagas / preenchidas.
- [ ] Seleção múltipla (`selecionarCandidato`/`executarSelecaoCandidato`).
- [ ] Aceite do diarista grava em `diaria_contratacoes`.
- [ ] Chat/check-in/recibo/avaliação por contratado.
- [ ] Realtime por contratação.
- [ ] `npm run verify` + teste no device (vagas=1 e vagas>1).

## Pendências a decidir antes de implementar

- **Chat com N contratados:** thread única por diária (mistura) **vs** thread por
  par (recomendado — exige `mensagens.diarista_id` ou filtrar por par). Definir.
- **Limite de vagas** por diária (ex.: máx. 10?) e se algum `tipo_oferta`
  (emprego/serviço) deve ficar fixo em 1.
- **Status de fechamento** da diária quando lota (`'preenchida'`?) e se ela some
  das buscas dos diaristas.
