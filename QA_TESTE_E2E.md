# ✅ Checklist de Teste E2E — DiáriaJá (pré-tráfego pago)

> Objetivo: validar o funil completo com **usuários reais** antes de gastar em Ads.
> Recomendação da auditoria: **20 contratantes + 30 prestadores** completando o fluxo
> **sem pedir ajuda**. Se conseguirem, libera Ads com orçamento pequeno (R$20-50/dia).
>
> Como usar: para cada item, marque ✅ Passou / ❌ Falhou / ⚠️ Confuso.
> Anote o **protocolo** do chat quando testar mensagens (aparece no topo da conversa).

---

## 0. Pré-requisitos (você confirma 1x antes de começar)

- [ ] **Banco sincronizado** — rodar `supabase/migrations/_AUDITORIA_PRONTIDAO.sql` → tudo ✅ (já feito: 20/20)
- [ ] **VAPID na Vercel** — ver seção "Notificações" abaixo
- [ ] **Confirmação de e-mail no Supabase** — decidir: ligada (mais seguro, mais atrito) ou desligada (entra na hora). Auth → Providers → Email → "Confirm email".

---

## 1. CADASTRO (contratante PF, prestador, empresa PJ)
- [ ] Splash → "Começar grátis" → escolher tipo → criar conta
- [ ] Cadastro com **e-mail** salva sem erro (sem "permission denied")
- [ ] Cadastro com **Google** funciona
- [ ] **Empresa (CNPJ)** completa o fluxo dedicado
- [ ] CPF **duplicado** é bloqueado ("Este CPF já possui cadastro")
- [ ] Após cadastrar, entra direto (ou recebe e-mail de confirmação claro)

## 2. LOGIN
- [ ] Login por **e-mail + senha**
- [ ] Login por **CPF/CNPJ + senha**
- [ ] Login por **Google**
- [ ] Senha errada → mensagem clara

## 3. RECUPERAR SENHA
- [ ] "Esqueci a senha" → e-mail chega
- [ ] Link abre a tela de redefinição (não cai no login)
- [ ] Redefine e entra com a senha nova

## 4. PERFIL
- [ ] Editar perfil **salva** (sem "permission denied")
- [ ] Salvar **por partes** (nome agora, CPF depois) funciona
- [ ] Foto sobe e persiste
- [ ] Recarregar a página → dados continuam (não pede tudo de novo)
- [ ] % de completude sobe ao preencher

## 5. CEP / LOCALIZAÇÃO
- [ ] Informar CEP no perfil salva
- [ ] Recarregar → **não** volta pra tela de CEP (loop resolvido)
- [ ] Consegue usar o app sem informar CEP (opcional)

## 6. PUBLICAR VAGA (contratante)
- [ ] Criar diária com data (digitar DD/MM/AAAA) + horário (lista) → publica
- [ ] Data inválida (ex.: ano errado) mostra aviso vermelho
- [ ] Vaga aparece no feed do prestador

## 7. CANDIDATURA (prestador → contratante)
- [ ] Prestador vê a vaga e clica "Tenho interesse"
- [ ] **Contratante vê o interessado** aparecer (na hora ou ao recarregar)
- [ ] Nome/foto do interessado aparecem (não "Prestador"/"?")

## 8. SELEÇÃO + R$1 (o fluxo de receita)
- [ ] Contratante seleciona candidato → **abre o modal de R$1** (não libera grátis)
- [ ] Paga R$1 (Mercado Pago) → volta pro app
- [ ] Prestador recebe "Você foi selecionado" → **botão Confirmar funciona**
- [ ] Após confirmar → chat libera pros dois

## 9. CHAT (o coração)
- [ ] Contratante manda mensagem → **prestador recebe** (testar msg NOVA)
- [ ] Prestador responde → **contratante recebe**
- [ ] Nome real aparece no header (não "Prestador")
- [ ] **Protocolo XXX XXX igual** nos dois aparelhos
- [ ] Recarregar dentro do chat → continua na conversa (não cai pra home)

## 10. CONVITE DIRETO (contratante → prestador específico)
- [ ] Enviar convite com data válida → prestador recebe
- [ ] Prestador aceita → contratante paga R$1 → prestador confirma → chat abre
- [ ] Aparece na Agenda do prestador

## 11. NOTIFICAÇÕES
- [ ] Banner "🔔 Ative as notificações" aparece após login
- [ ] Tocar "Ativar" → Android **pede a permissão** (se não pedir = VAPID faltando)
- [ ] Receber notificação real (peça pro outro lado mandar msg com o app fechado)

## 12. AVALIAÇÃO
- [ ] Após diária concluída, consegue avaliar
- [ ] Avaliação aparece no perfil

## 13. PERSISTÊNCIA / GERAL
- [ ] Fechar e reabrir o app → continua logado, dados intactos
- [ ] Trocar de perfil (anunciante ↔ prestador) no menu funciona
- [ ] App não trava / telas carregam em tempo aceitável no 4G

---

## 🔔 Como confirmar a chave VAPID (notificações)

A notificação push **só funciona** se `VITE_VAPID_PUBLIC_KEY` estiver nas env vars da Vercel.

**Teste rápido (1 min):**
1. Abra o app no celular → entre → toque "Ativar notificações"
2. **Se o Android mostrar o pop-up de permissão** → a chave está OK ✅
3. **Se nada acontecer / erro no console** → a chave está faltando ❌

**Se faltar**, me avise — eu gero o par de chaves (pública + privada). Você coloca:
- `VITE_VAPID_PUBLIC_KEY` → Vercel (Settings → Environment Variables) → redeploy
- `VAPID_PRIVATE_KEY` → Supabase (secrets) — pro `send-push` funcionar

---

## 🎯 Critério de liberação pra Ads

- **Todos os itens 1, 2, 4, 6, 7, 8, 9 ✅** (o núcleo do funil + receita)
- **Pelo menos 10 usuários reais** completaram cadastro→perfil→ação sem ajuda
- Se 8 e 9 (R$1 + chat) passarem com usuários reais → **pode ligar Ads R$20-50/dia**
