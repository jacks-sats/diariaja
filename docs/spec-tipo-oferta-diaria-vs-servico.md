# Spec — Diária vs Serviço (tipo_oferta)

Versão draft 1 — 2026-05-28
Status: **aguardando aprovação antes de implementar**

## Problema

Hoje o DiáriaJá trata todo anúncio como "diária": data, horário início, horário fim, jornada de 4h/6h/8h, valor diário. Esse modelo cobre faxina, eventos, obra, mas não cobre:

- **TI**: "preciso de alguém pra arrumar wifi" (30min, R$80, vem-resolve-vai)
- **Beleza pontual**: "manicure só pra mim, 1h" (não é dia inteiro)
- **Reparos rápidos**: "trocar uma torneira" (1h)
- **Pet**: "passear com cachorro 1x" (30min)

Esses são serviços pontuais, transacionais. Mercado significativo, dominado pelo GetNinjas (que trata tudo como serviço) e Triider (reformas pontuais).

Adicionalmente, "diária" tem proximidade conceitual com LC 150/2015 (lei do doméstico) e jurisprudência trabalhista olha pra habitualidade. "Serviço" é prestação pontual regida pelo Código Civil — categoria juridicamente mais defensável.

## Objetivo

Adicionar uma dimensão `tipo_oferta` aos anúncios com dois valores:

- **`diaria`**: jornada de várias horas (4h+), horário fim definido, valor diário, modelo atual.
- **`servico`**: tarefa pontual, tempo estimado, valor por escopo (fixo / a combinar / a partir de).

Permite cobrir os dois mercados com uma plataforma só + posicionamento jurídico mais limpo.

## Não-objetivos

- NÃO criar um terceiro tipo "por hora" agora (fica pra v2 se demanda surgir).
- NÃO mudar fluxo de pagamento (PIX direto entre partes, R$1 desbloqueio igual).
- NÃO mudar QR Code de chegada — funciona pros dois (anota timestamp de início).
- NÃO mudar candidaturas, avaliações, denúncias — mesmo schema.
- NÃO refatorar palavra "diária" no nome do produto (DiáriaJá fica) — só no domínio do anúncio.

## UX

### Form de criar anúncio

Toggle no topo do form (passo 1):

```
┌─────────────────────────────────────┐
│ O que você precisa?                  │
│                                      │
│  ┌─────────────┐  ┌─────────────┐   │
│  │   🌞        │  │   ⚡        │   │
│  │  DIÁRIA     │  │  SERVIÇO    │   │
│  │             │  │             │   │
│  │ Jornada de  │  │ Tarefa      │   │
│  │ várias hs   │  │ pontual     │   │
│  │ (4h+)       │  │ (vem, faz,  │   │
│  │             │  │  e vai)     │   │
│  └─────────────┘  └─────────────┘   │
│   (selecionada)                      │
└─────────────────────────────────────┘
```

**Se DIÁRIA** (modelo atual, sem mudança):
- Data
- Horário início + horário fim
- Jornada (4h/6h/8h — calculada automaticamente)
- Valor diário (R$)
- Descrição
- Categoria + Função

**Se SERVIÇO** (novo):
- Data preferencial (opcional — "quando preferir" é válido)
- Tempo estimado (15min / 30min / 1h / 2h / 3h / 4h / "a combinar")
- Tipo de preço:
  - 🏷️ **Fixo**: R$ ___
  - 💬 **A combinar**: sem valor exibido
  - 📈 **A partir de**: R$ ___ (mínimo, sujeito a escopo)
- Descrição (mais importante — o escopo é tudo aqui)
- Categoria + Função

Sugestão inteligente (não força, só recomenda):
- Categoria selecionada = TI / Beleza / Pet → default `servico`
- Categoria selecionada = Doméstico / Construção / Eventos → default `diaria`
- Delivery → default `servico` (cada entrega é pontual)
- Saúde & Cuidado → varia, deixar sem default

### Card do anúncio na Home

Badge visual no canto pra distinção rápida:

```
┌──────────────────────────────────────┐
│ [foto]  Manicure                ⚡   │
│         R$ 80 fixo               SVC │
│         1h estimado                  │
│         Bairro X · 2km                │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ [foto]  Diarista (Faxina)       🌞   │
│         R$ 150/dia               DIA │
│         8h · 8h às 17h                │
│         Bairro Y · 1km                │
└──────────────────────────────────────┘
```

Cor sugerida: serviço = azul claro (#3A86FF), diária = laranja (cor do app).

### Filtro na Home

Topbar de filtros ganha mais um:

```
[ Categoria v ] [ Distância v ] [ Diária + Serviço v ]
```

Default: mostrar **ambos**. Opções: "Só Diária" / "Só Serviço" / "Diária + Serviço".

### Detalhe do anúncio

Quando abrir um anúncio do tipo serviço:

```
⚡ Serviço pontual
🏷️ R$ 80 (fixo)
⏱️ Tempo estimado: 1h
📅 Quando? A combinar

[Descrição do escopo...]

[Demonstrar interesse]
```

Quando abrir um anúncio do tipo diária:

```
🌞 Diária
💰 R$ 150 por dia
🕗 Das 8h às 17h (jornada 8h)
📅 Sábado, 30/05

[Descrição...]

[Demonstrar interesse]
```

### Recibo digital

Texto adapta:
- Diária: "Recibo de prestação de diária"
- Serviço: "Recibo de prestação de serviço pontual"

O rodapé com aviso "não é NF, prestador deve emitir NFS-e/Carnê-Leão" continua igual.

## Modelo de dados

### Migration

```sql
-- migration: 20260528_tipo_oferta.sql

-- 1. Adiciona coluna tipo_oferta
ALTER TABLE diarias 
  ADD COLUMN IF NOT EXISTS tipo_oferta text 
  DEFAULT 'diaria' 
  CHECK (tipo_oferta IN ('diaria', 'servico'));

-- 2. Marca antigos como 'diaria' (default já cuida, mas explicito)
UPDATE diarias SET tipo_oferta = 'diaria' WHERE tipo_oferta IS NULL;

-- 3. NOT NULL após populate
ALTER TABLE diarias ALTER COLUMN tipo_oferta SET NOT NULL;

-- 4. Campos específicos de SERVIÇO (todos nullable — só populam se for servico)
ALTER TABLE diarias 
  ADD COLUMN IF NOT EXISTS tempo_estimado_min int;
ALTER TABLE diarias 
  ADD COLUMN IF NOT EXISTS tipo_preco text 
  CHECK (tipo_preco IS NULL OR tipo_preco IN ('fixo', 'a_combinar', 'a_partir_de'));

-- 5. Tornar campos de DIÁRIA opcionais (já podem ser nulos pra serviço)
--    horario_fim e jornada já são nullable hoje? Confirmar antes de rodar.
--    Se não forem: ALTER COLUMN ... DROP NOT NULL;

-- 6. Index pra filtro
CREATE INDEX IF NOT EXISTS ix_diarias_tipo_oferta 
  ON diarias(tipo_oferta, status, criado_em DESC);

-- 7. Constraint de coerência: se servico, exige tempo_estimado + tipo_preco
ALTER TABLE diarias ADD CONSTRAINT chk_servico_campos_obrigatorios
  CHECK (
    tipo_oferta = 'diaria' OR 
    (tipo_oferta = 'servico' AND tempo_estimado_min IS NOT NULL AND tipo_preco IS NOT NULL)
  );
```

### types.ts

```ts
export type TipoOferta = 'diaria' | 'servico';
export type TipoPreco = 'fixo' | 'a_combinar' | 'a_partir_de';

export interface Diaria {
  // ...campos existentes
  tipo_oferta: TipoOferta;
  
  // só serviço
  tempo_estimado_min?: number;
  tipo_preco?: TipoPreco;
}
```

### constants.ts

```ts
// Tempos estimados pra serviço (em minutos)
export const TEMPOS_ESTIMADOS_SERVICO = [
  { valor: 15,  label: '15 minutos' },
  { valor: 30,  label: '30 minutos' },
  { valor: 60,  label: '1 hora' },
  { valor: 120, label: '2 horas' },
  { valor: 180, label: '3 horas' },
  { valor: 240, label: '4 horas' },
  { valor: 0,   label: 'A combinar' },  // 0 = não definido
];

// Mapeamento sugerido (não força, só recomenda no form)
export const TIPO_OFERTA_PADRAO_POR_CATEGORIA: Record<string, TipoOferta> = {
  'Delivery': 'servico',
  'Supermercado / Varejo': 'diaria',
  'Gastronomia': 'diaria',
  'Doméstico': 'diaria',
  'Construção Civil': 'diaria',
  'Eventos & Festas': 'diaria',
  'Saúde & Cuidado': 'servico',
  'Logística & Armazém': 'diaria',
  'Pet & Animais': 'servico',
  'Beleza & Estética': 'servico',
};
```

### Médias de valor

Não vamos calibrar `MEDIAS_CAMPO_GRANDE` pra serviço agora (sem dados de campo). Estratégia:

- Pra serviço, o form **não exibe sugestão de valor** no início — usuário coloca o que quiser
- Coleta-se dados nos primeiros 50-100 serviços publicados
- v2: gera `MEDIAS_SERVICO_CAMPO_GRANDE` baseado em mediana real

Decisão alternativa: usar a média de diária como teto inicial. Ex: "serviço de manicure: 25-50% da diária da função". Mas sem evidência, melhor coletar primeiro.

## Atualização da Jájá

System prompt ganha nova seção:

```
## TIPOS DE OFERTA

A DiáriaJá tem dois tipos de anúncio:

🌞 **DIÁRIA**: jornada de várias horas (4h+) com horário início e fim definidos.
   Valor cobrado por dia (R$/dia). Exemplos: faxineira de 8h, garçom de evento,
   ajudante de obra dia inteiro.

⚡ **SERVIÇO**: tarefa pontual, "vem, faz e vai". Tempo estimado em minutos/horas.
   Valor pode ser fixo (R$X), a combinar, ou a partir de R$X.
   Exemplos: arrumar wifi, manicure, trocar torneira, passear com cachorro 1x.

Como o anunciante escolhe? No 1º passo do form de criar anúncio aparece um
toggle 🌞 Diária / ⚡ Serviço. A categoria selecionada sugere um default
mas é livre escolher.

Diferenças no fluxo:
- Diária: pede horário fim + jornada. Serviço pede tempo estimado.
- Diária: valor por dia. Serviço: valor fixo / a combinar / a partir de.
- Recibo no fim: ambos têm. Texto adapta ("diária" ou "serviço pontual").
- QR Code de chegada: ambos. Termo de início é o mesmo.
- Candidatura, avaliação, denúncia: idêntico nos dois.
```

E novas Q&As no FAQ EXPANDIDO:

```
Q: Qual a diferença entre Diária e Serviço?
R: Diária é jornada de várias horas (4h+) com horário fim definido,
   valor por dia. Serviço é tarefa pontual "vem-faz-vai", tempo estimado
   e valor por escopo (fixo ou a combinar). No 1º passo do form você escolhe.

Q: Como cobro um serviço de 30min de TI?
R: Crie como Serviço (não Diária). Tempo estimado: 30 minutos. Preço: fixo
   se você sabe o valor, ou "a combinar" se depende do escopo.

Q: Posso transformar uma diária em serviço depois?
R: Não, o tipo é definido no momento da publicação. Se errou, cancele e
   publique de novo no tipo certo.

Q: Sou diarista doméstica — devo usar diária ou serviço?
R: Diária. Faxina dura 4-8h, é jornada — não serviço pontual.

Q: Sou técnico de TI — devo usar diária ou serviço?
R: Quase sempre serviço (instalar wifi, arrumar PC, etc. duram 1-3h).
   Se você for passar o dia inteiro numa empresa (8h dando suporte), aí sim
   pode ser diária.
```

## Impacto nos Termos de Uso

Os Termos v2 (draft) usam o termo "Diária" como nome do serviço. Vai precisar:

1. **Definição**: ampliar definição na cláusula 2 (Definições) — incluir "Serviço" como subtipo do anúncio.
2. **Cláusula 4 (Natureza da Plataforma)**: reforçar que ambos os tipos são prestação de serviço autônoma, sem vínculo trabalhista.
3. **Cláusula 8 (Pagamentos)**: confirma que ambos têm pagamento direto entre partes.
4. **Sem impacto** nas demais cláusulas (avaliação, denúncia, encerramento).

Edição é pequena. Quando integrar os Termos v2 no app, aproveito pra incluir.

## Plano de migração de dados existentes

1. Todos os anúncios atuais são `tipo_oferta = 'diaria'` (default + migração explícita).
2. Sem comunicação ao user — é transparente pra ele.
3. Pra anúncios já publicados, NÃO permitir mudar tipo (cláusula que já está nos Termos da AUP: "ofertas publicadas não podem mudar de tipo após selecionar candidato").
4. Pra anúncios em rascunho (se existir esse status): permitir mudar.

## Casos de uso / edge cases

| Caso | Resolução |
|---|---|
| Anúncio "passar o dia ajudando em obra" | Diária (8h, valor diário) |
| Anúncio "consertar pia da cozinha" | Serviço (1h estimado, valor fixo) |
| Anúncio "cuidar de idoso 1 dia" | Diária (jornada 8-12h) |
| Anúncio "aplicar injeção em casa" | Serviço (15min, valor fixo) |
| Anúncio "corte de cabelo + barba" | Serviço (40min, valor fixo) |
| Anúncio "garçom pra festa 4h" | Diária (jornada 4h) |
| Anúncio "5 entregas no centro" | Serviço (3h estimado, a combinar) |
| Anúncio "delivery dia inteiro" | Diária (jornada 8h) |
| Anúncio "manicure pacote 8h em studio" | Diária (jornada 8h, valor diário) |
| Híbrido: "vou às 8h, saio quando terminar" | **DIÁRIA** (regra: tem horário início + estimativa de jornada = diária; serviço pressupõe duração curta predefinida) |

## Testes manuais (checklist)

- [ ] Criar diária — funciona idêntico ao hoje
- [ ] Criar serviço — campos certos aparecem (tempo, tipo_preco)
- [ ] Constraint de banco: tentar inserir serviço sem tempo → falha
- [ ] Card mostra badge diferenciado pros dois tipos
- [ ] Filtro Home: "Só Diária" mostra só diárias, idem pra serviço
- [ ] Candidatura: prestador demonstra interesse, anunciante recebe push (igual)
- [ ] Selecionar candidato: R$1 cobra igual (regra de seleção igual)
- [ ] QR Code de chegada funciona pros dois
- [ ] Recibo digital texto adapta
- [ ] Jájá responde corretamente "qual a diferença"
- [ ] Mudar categoria no form: default sugerido muda (TI → serviço, Doméstico → diária)

## Rollout

**Sprint 1 — Backend + Form** (~3-4h)
- Migration
- types.ts + constants.ts
- Form condicional
- Validação cliente + servidor

**Sprint 2 — UI restante** (~2-3h)
- Card com badge
- Filtro Home
- Detalhe do anúncio
- Recibo

**Sprint 3 — Jájá + Termos** (~1-2h)
- System prompt update
- FAQs novas
- Termos v2 ajuste

**Total estimado: 6-9h**, pode ser tudo em 1 PR ou divididos em 3 commits no mesmo PR.

## Decisões pendentes

1. **Anunciante pode publicar AMBOS tipos do mesmo "anúncio" (diária + serviço)?**
   Recomendação: NÃO — força escolha. Se quiser os dois, publica dois anúncios.

2. **Histórico de anúncios anteriores**: o prestador que prestou só "diárias" antes — vai aparecer como elegível pra serviços? Recomendação: SIM — perfil único, prestador atende ambos. Diferenciação é só no anúncio.

3. **Avaliação separada por tipo?** Ex: "nota 4.8 em diárias, 4.2 em serviços". Recomendação: NÃO no v1 — uma nota só. Se virar relevante, separar depois.

4. **Pagamento mínimo de serviço**: existe um valor mínimo pra criar serviço (ex: R$20)? Recomendação: NÃO — deixa livre. Anunciante pode publicar serviço de R$5 se quiser.

5. **Ícones** 🌞 e ⚡ — manter ou trocar? Recomendação: testar com usuários, mas começa com esses.
