# Próximos passos — DiáriaJá (handoff)

> Arquivo de continuidade. Atualizado em 2026-06-01. Branch de trabalho:
> `claude/paranoid-app-audit-5Gelu` · PR aberto: **#124** (draft).

## ✅ O que já foi feito (no PR #124, tudo com tsc + 231 testes + build verdes)

Recursos vendidos nos planos que estavam "fake" e agora são **reais**:

| Recurso | Plano | Onde |
|---|---|---|
| Ranking real nas buscas (prioridade/topo) | Essencial/Plus | feed de prestadores |
| Selos (Profissional / Alta Confiança / Contratante Verificado) | Essencial/Plus | feed e perfis |
| IA monta anúncio | Essencial+ (anunciante) | tela criar diária |
| IA escreve bio | Essencial+ (prestador) | perfil |
| Relatórios | Plus (anunciante) | Configurações → Plataforma |
| Histórico de contratações | Essencial (anunciante) | Configurações → Plataforma |
| CTA de upgrade do prestador | — | banner na home (sem bloqueio) |
| Filtros avançados (nível/valor/distância) | Essencial (anunciante) | feed de prestadores |

## 💻 PARA FAZER NO PC (na ordem)

### 1. Publicar a função de IA + o diagnóstico
```bash
cd caminho/ate/diariaja
git checkout claude/paranoid-app-audit-5Gelu
git pull origin claude/paranoid-app-audit-5Gelu

npx supabase login
npx supabase link --project-ref rpszebrrrasoijfdvner

npx supabase functions deploy ai-gerar         # liga os botões de IA
npx supabase functions deploy mp-health-check  # diagnóstico de pagamentos
```

### 2. Rodar o diagnóstico do webhook
```bash
npx supabase secrets set HEALTH_CHECK_SECRET="escolha_um_texto_secreto"
curl -s -X POST \
  "https://rpszebrrrasoijfdvner.supabase.co/functions/v1/mp-health-check" \
  -H "x-health-check-secret: escolha_um_texto_secreto" | cat
```
Procure a linha `"veredito":` no resultado — ela diz em português se está tudo OK
ou o que falta (ex.: token TEST em vez de PROD).

> Obs.: o webhook já mostrou eventos `payment.updated` com **"200 - Entregue"**
> no painel do Mercado Pago (app "DiariaJa", nº 5314462664390109), o que indica
> que o segredo já está certo. O diagnóstico só confirma.

### 3. Verificar os 7 recursos no app
- Abrir o **preview do PR #124** (Vercel) OU `npm run dev`.
- Entrar com conta de **anunciante** e de **prestador**.
- Pra ver os recursos pagos, forçar o plano via SQL no Supabase:
  ```sql
  update user_profiles set plano_ativo = 'plus' where id = '<id_do_usuario_teste>';
  ```
- Conferir: selos no feed, ranking, botões de IA, Relatórios, Histórico,
  filtros avançados, banner de upgrade do prestador.

### 4. Mergear o PR #124 quando estiver satisfeito.

## ⏳ Pendências (precisam de DECISÃO de produto — conversar antes de implementar)

- **Boost de visibilidade** / **anúncios impulsionados**: definir o que "boost"
  faz na prática (re-subir no feed? por quanto tempo?).
- **Multi-endereço**: muda o banco (tabela de endereços + UI). Plus.
- **Favoritos / convites ilimitados**: hoje são **grátis pra todos**. Vendidos
  como pagos. Decidir se viram pagos (tirar do grátis) ou se a cópia muda.

## ⚠️ Lembretes
- Plano grátis do prestador **não bloqueia** trabalho (decisão tomada) — só incentiva.
- "Diárias ilimitadas" na cópia do prestador é exagero técnico (grátis também é
  ilimitado) — mantido por escolha sua.
