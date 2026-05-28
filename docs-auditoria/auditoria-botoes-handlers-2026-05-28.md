# Auditoria — Botões, Handlers e Feedback de UI
Data: 2026-05-28
Branch: `claude/project-review-restoration-XBkFf`
Arquivo focado: `/home/user/diariaja/src/App.tsx` (16 549 linhas)
Auditor: Claude Code (Opus 4.7)

---

## Sumário executivo

- **476 `onClick`** mapeados (grep `onClick` no monólito).
- **144 chamadas a `setToastError`/`setToastSuccess`** dispersas em todo o app.
- **34 telas** (branches `if (tela === ...)`) — somente **4 renderizam o toast**:
  - `home-empregador` (linha 8033)
  - `home-diarista` (linha 10633)
  - `admin-painel` (linha 15061, **adicionado no commit `9d98193` por causa do bug que motivou esta auditoria**)
  - `comunidade` (linha 16186)
- **30 telas ficam SEM toast render** — qualquer handler que chame `setToastError`/`setToastSuccess` enquanto o usuário estiver numa dessas telas falha silenciosamente (mesma classe do bug que estávamos investigando no admin).
- **78 handlers `async`** existem; **só 74 blocos `try/...catch`** no arquivo inteiro. Vários handlers críticos rodam `await supabase.…` sem `try/catch` — se a Promise rejeitar, o estado `loading` fica `true` para sempre (botão disabled stuck).
- **5 ações destrutivas** (`excluirDiaria`, `cancelarDiaria`, `bloquearUsuario`, `excluirChat`, `confirmDeleteConta`) têm modal de confirmação ✅, mas o feedback de sucesso/erro dessas ações está ligado a toast que **não renderiza** em várias telas.

> Conclusão: o bug do admin-painel é **sistêmico**, não isolado. A correção urgente é
> **promover os toasts ao topo do componente App** (renderizar uma única vez no final do
> return do componente, fora do branching de telas). Diff sugerido na última seção.

---

## 1. Telas SEM toast render (mesmo bug do admin-painel)

Mapa completo gerado por AWK contra o arquivo. As colunas `toastSuccess`/`toastError`
contam blocos JSX `{toastSuccess && …}` / `{toastError && …}` dentro do branch da tela:

| Tela | Linha | toastSuccess | toastError | Handlers afetados (silenciosos) |
|------|------:|:------------:|:----------:|---------------------------------|
| `splash` | 4723 | 0 | 0 | — |
| `login` | 4936 | 0 | 0 | `handleEmailLogin` (usa authError, OK) |
| `cadastro-tipo` | 5108 | 0 | 0 | — |
| `cadastro-auth` | 5183 | 0 | 0 | `handleEmailSignup` (usa authError) |
| `academy` | 5377 | 0 | 0 | — |
| `academy-curso` | 5472 | 0 | 0 | — |
| `academy-aula` | 5546 | 0 | 0 | **`setToastSuccess("✅ Aula concluída!")`** L5656 — invisível |
| `configuracoes` | 5667 | 0 | 0 | **L5818** `setToastSuccess("🔗 Link copiado…")` (Indicar amigos), **L5958** `setToastSuccess("Conta excluída. Até logo!")` — invisível em qualquer caso, e a tela vai sumir antes do toast desenhar |
| `alterar-senha` | 5992 | 0 | 0 | **L6064** `setToastSuccess("✅ Senha alterada com sucesso!")` — invisível (usa authError para erros, OK) |
| `verificar-telefone` | 6082 | 0 | 0 | **L6139** `setToastSuccess("📲 Código enviado por SMS")`, **L6189** `setToastSuccess("✅ Telefone verificado — Nível Básico desbloqueado!")` — invisíveis (erros via authError, OK) |
| `politica-privacidade` | 6206 | 0 | 0 | — |
| `suporte` | 6313 | 0 | 0 | Modal `modalNovoTicketJSX` → `criarTicketSuporte` chama `setToastError`/`setToastSuccess` (L2976-3004) — **invisível** |
| `cadastro-empresa` | 6477 | 0 | 0 | `submitCadastroEmpresa` (usa setAuthError? Verificar) |
| `cadastro-empregador` | 6932 | 0 | 0 | `submitEmpPF` (provavelmente authError) |
| `escolha-negocio` | 7250 | 0 | 0 | — |
| `cadastro-diarista` | 7294 | 0 | 0 | `submitDia` |
| `home-empregador` | 7916 | **1** | **1** | ✅ OK |
| `home-diarista` | 10505 | **1** | **1** | ✅ OK |
| `editar-perfil` | 13122 | 0 | 0 | **L2563** `salvarFotoUrl` toast erro, **L2581/2587/2605/2614/2627** `handleFotoUpload`, **L2548** `handleAtualizarLocalizacao`, **L3884/3888/3892/3899/3908/3910** `handlePortfolioUpload`, **L10163/12157** botão "Salvar Bio" — **TODOS invisíveis nesta tela** |
| `pedir-localizacao` | 13481 | 0 | 0 | `handleSalvarCEP`/`handleContinuar` |
| `perfil-empregador` (`&& empregadorAberto`) | 13571 | 0 | 0 | **L3729/3741/3746** `bloquearUsuario`, **L3761/3766** `desbloquearUsuario`, **L13756** botão favorito |
| `perfil-diarista-real` | 13738 | 0 | 0 | **L2502** `iniciarOAuthMP`, **L2841/2861/2869** `enviarConvite`, **L2876/2878** `responder convite`, **L2883/2886** `cancelar convite`, **L3729/3746/3761/3766** bloquear/desbloquear, **L13756** favoritar — **TODOS invisíveis** |
| `setup-diarista` | 14132 | 0 | 0 | — (usa authError) |
| `setup-empregador` | 14184 | 0 | 0 | — (usa authError) |
| `criar-diaria` | 14235 | 0 | 0 | `salvarDiaria` (L3991-4084) — usa authError para validação (OK) e `setToastSuccess` no final, mas troca de tela imediatamente → toast aparece em `home-empregador`. **OK** por sorte. |
| `editar-perfil-empregador` | 14688 | 0 | 0 | mesma lista de `editar-perfil` (handlers de bio, foto, portfólio, telefone) — **invisíveis** |
| `admin-painel` | 14988 | **1** | **1** | ✅ OK (fix recente) |
| `painel-suporte` | 15537 | 0 | 0 | botão "🔄 Atualizar" sem feedback; `abrirTicket` sem feedback |
| `verificar-documento` | 15630 | 0 | 0 | **L3166/3171/3185/3202** `enviarDocumentoKYC` → toast erros invisíveis. Sucesso (`L3208`) também invisível, mas há fallback visual via `setProfile(documento_status:"enviado")` que reflete na UI |
| `verificar-antecedentes` | 15762 | 0 | 0 | **L3223/3228/3242/3258** `enviarAntecedentes` → mesma situação |
| `meus-tickets` | 15876 | 0 | 0 | `modalNovoTicketJSX` (toast invisível); `abrirTicket` |
| `ticket-conversa` | 15951 | 0 | 0 | **L3015/3031** `enviarRespostaTicket`, **L3145/3147** `atualizarStatusTicket` ("✅ Marcar resolvido"/"🗄️ Fechar") — **INVISÍVEIS**; user/admin clica e nada acontece visualmente |
| `comunidade` | 16057 | **1** | **1** | ✅ OK |
| `planos` | 16310 | 0 | 0 | `iniciarAssinatura` usa authError pra erros (OK); `setToastSuccess("🏦 Abrindo Mercado Pago…")` antes do redirect — aparece por 400 ms então redireciona, marginalmente OK |

**Total: 4 telas com toast / 30 telas sem.**

---

## 2. Achados por severidade

### 🔴 Críticos — handler falha silenciosamente em ações reais

#### C1. `criarTicketSuporte` (L2972-3008) — invisível em `suporte` e `meus-tickets`
- Modal `modalNovoTicketJSX` aparece em **2 telas** (L6468 `suporte` + L15945 `meus-tickets`).
- Toda validação (`Preencha…`, `Assunto muito longo`, `Mensagem muito longa`) e toda falha de rede (`Não foi possível abrir o ticket`) dispara `setToastError` — **invisível** nas duas telas.
- O sucesso (`✅ Ticket aberto!`) também é invisível, mas o `abrirTicket(ticket)` chama `setTela("ticket-conversa")`, que também não tem toast. **O usuário não recebe NENHUM feedback de que o ticket foi criado** — só vê uma transição de tela.
- **Fix linha**: ver "Fix em lote" abaixo.

#### C2. `enviarRespostaTicket` (L3011-3046) — invisível em `ticket-conversa`
- `setToastError("Mensagem muito longa (máx 4000 caracteres).")` (L3015) e `setToastError("Falha ao enviar resposta. Tente de novo.")` (L3031) — **invisíveis**.
- O composer do ticket fica "travado" sem explicação se der erro de rede ou se ultrapassar 4000 chars (input já corta em 4000 via `slice(0, 4000)` na L16035, mas se vier de paste antes do slice, a validação cai aqui).

#### C3. `atualizarStatusTicket` (L3139-3149) — admin/suporte clica "✅ Marcar resolvido" e nada
- Botões em L15990 e L15993 dentro de `ticket-conversa`.
- Caso de erro → `setToastError("Falha ao atualizar status.")` invisível.
- Caso de sucesso → `setToastSuccess("✅ Ticket marcado como ...")` invisível.
- **O único feedback é o `setTicketAtivo({ ..., status })`** que recolore o badge no header. Pode ser confundido com "nada aconteceu" se o user piscar.

#### C4. `enviarDocumentoKYC` (L3162-3210) — invisível em `verificar-documento`
- Validações: `Arquivo muito grande`, `Tipo não permitido` (L3166/L3171) — invisíveis.
- Erro de upload (L3185), erro de update (L3202) — invisíveis.
- Sucesso (L3208) também invisível, mas existe feedback indireto: `setProfile({documento_status:"enviado"})` muda o card de status no topo da tela. Marginalmente OK.
- **Impacto real**: se o user escolhe um PDF > 5 MB, ele clica "Enviar documento" e nada acontece. Não sabe que o arquivo foi rejeitado por tamanho.

#### C5. `enviarAntecedentes` (L3220-3266) — invisível em `verificar-antecedentes`
- Espelha C4 — mesmos problemas (L3223/3228/3242/3258).

#### C6. `enviarConvite` (L2834-2870) — invisível em `perfil-diarista-real`
- Validação `Preencha CEP/endereço, data, horário e carga horária.` (L2841) e erro de rede `Erro ao enviar convite: ...` (L2861) — **invisíveis**.
- Sucesso (`📨 Convite enviado para X…`, L2869) — invisível na própria tela, mas o handler troca `setTabEmpregador("diarias")` e ao voltar pra `home-empregador` o toast pode ainda estar visível (próximo do dismiss).
- **Pior caso**: empregador preenche tudo, clica "Enviar convite", vê **nada**, clica de novo, manda duplicado.

#### C7. `iniciarOAuthMP` (L2498-2509) — invisível em `perfil-diarista-real`
- `setToastError("Não foi possível iniciar a conexão com o Mercado Pago...")` (L2502) — invisível.
- Diarista clica em "Conectar Mercado Pago", o RPC `criar_oauth_state` falha → user vê **nada** e fica preso sem MP.

#### C8. `handleFotoUpload` + `salvarFotoUrl` + `handlePortfolioUpload` — invisíveis em `editar-perfil` e `editar-perfil-empregador`
- Todos os erros de upload (foto, portfólio): `❌ Use uma imagem JPG/PNG/WEBP` (L2581/L3888), `❌ Foto muito grande` (L2587/L3892), `⚠️ Storage falhou` (L2605), `❌ Erro ao salvar foto` (L2563), `❌ Erro ao enviar foto` (L3899), `Foto subida, mas falhou ao sincronizar...` (L3908), `Máximo de 3 fotos no portfólio` (L3884) — **TODOS invisíveis**.
- O preview local funciona (mostra antes de subir), mas o user não sabe se o upload terminou ou falhou.

#### C9. `bloquearUsuario` / `desbloquearUsuario` — invisíveis em `perfil-empregador` e `perfil-diarista-real`
- L3729 (`Você não pode bloquear a si mesmo`), L3741 (`Não foi possível bloquear`), L3746 (`✅ Usuário bloqueado`), L3761/3766 — **invisíveis**. Ação destrutiva sem confirmação visual.

#### C10. `setToastSuccess("Conta excluída. Até logo!")` em `configuracoes` (L5958)
- Sequência: `signOut()` → setTela vai mudar pra splash via auth listener. Toast nem chega a renderizar (mas mesmo se chegasse, a tela `configuracoes` não renderiza toast).
- **Last words da conta** completamente invisíveis. UX horrível.

### 🟠 Altos — disabled stuck / loading não resetado em todos os ramos

#### A1. Handlers `async` sem `try/catch` que setam loading=true antes de await
Quando `await supabase.…` rejeita por rede caída (raríssimo, mas acontece em mobile),
o `set…(false)` nunca executa → botão fica disabled para sempre. Os principais:

| Handler | Linha decl | State | Reset garantido? |
|---------|-----------:|-------|------------------|
| `criarTicketSuporte` | 2972 | `criandoTicket` | ❌ Não há try/catch; se `supabase.from("suporte_tickets").insert` rejeitar, `setCriandoTicket(false)` nunca roda |
| `enviarRespostaTicket` | 3011 | `enviandoRespostaTicket` | ❌ idem |
| `criarTopico` | 3399 | `enviandoTopico` | ❌ idem |
| `criarComentario` | 3420 | `enviandoComentario` | ❌ idem |
| `enviarDocumentoKYC` | 3162 | `enviandoDoc` | ❌ se `supabase.storage.upload` rejeitar (sem error mas exception) — stuck |
| `enviarAntecedentes` | 3220 | `enviandoAntecedentes` | ❌ idem |
| `enviarConvite` | 2834 | `enviandoConvite` | ❌ idem |
| `salvarDiaria` | 3991 | `salvandoDiaria` | ❌ idem |
| `salvarEdicaoDiaria` | 3860 | `salvandoEdicao` | ❌ idem |
| `cancelarDiaria` | 2709 | `cancelando` | ❌ idem |
| `excluirDiaria` | 3464 | `excluindo` | ❌ idem |
| `desistirDiaria` | 2727 | `desistindo` | ❌ idem |
| `bloquearUsuario` | 3726 | `bloqueando` | ❌ idem |
| `enviarMensagemReal` | 3510 | `enviandoMsgReal` | ❌ idem (sem feedback de erro também) |
| `handleFotoUpload` | 2572 | `uploadingFoto` | ❌ idem |
| `handlePortfolioUpload` | 3882 | `uploadingPortfolio` | ❌ idem |

**Padrão a aplicar:**

```diff
- setX(true);
- const { error } = await supabase.…;
- if (error) { setToastError("..."); setX(false); return; }
- …
- setX(false);
+ setX(true);
+ try {
+   const { error } = await supabase.…;
+   if (error) { setToastError("..."); return; }
+   …
+ } catch (e) {
+   setToastError("❌ Erro de conexão. Tente novamente.");
+ } finally {
+   setX(false);
+ }
```

#### A2. `enviarMensagemReal` (L3510-3545) — falha silenciosamente
- Linha 3525-3543: se `error` for truthy, **nada acontece** — sem toast, sem reset, sem feedback. A mensagem do chat some do input só no caminho de sucesso (L3531: `setMsgInputReal("")` está dentro do `if (!error && novaMsg)`).
- Mas `setEnviandoMsgReal(false)` está fora do `if`, então o input volta. User digita de novo, manda de novo. **Pode causar mensagem duplicada** quando o erro foi transitório (a primeira chegou, a segunda chega de novo).
- **Fix**: adicionar `if (error) { setToastError("Falha ao enviar mensagem."); }` na L3543.

#### A3. `excluirDiaria` (L3464-3506) — bloco grande sem try/catch
- O handler faz **5 awaits sequenciais** sem proteção. Se qualquer um rejeitar, `setExcluindo(false)` nunca executa, `setModalExcluir(null)` já foi feito ainda no início (L3475). Botão "Excluir" no modal está fechado mas o estado `excluindo=true` pode contaminar outra abertura.
- A remoção otimista é feita **antes** dos awaits (L3473) — se algum await falhar, a tela mostra "diária sumida" mas o banco mantém. Inconsistência grave.

#### A4. `criandoAssinatura` é `string | false` mas `setCriandoAssinatura(false)` aparece em locais errados
Procurar L3941, L3983 — provavelmente OK, mas vale conferir se em caso de exception no `fetch` o estado reseta.

### 🟡 Médios — falta de feedback de sucesso (funciona, mas UX vazia)

#### M1. `cancelarDiaria` (L2709-2724) — sem feedback de sucesso
- Após cancelar uma diária, fecha modal e atualiza lista. **Sem toast**. User clica "Confirmar cancelamento" e a vaga só some.
- **Fix**: adicionar `setToastSuccess("Diária cancelada. Interessados foram notificados.")` ao final.

#### M2. `cancelando` reseta mas sem toast (L2717 erro / L2722 sucesso)
- Erro vai pra authError (que não renderiza no modal de cancelar) → erro invisível.

#### M3. Botão "🔄 Atualizar" em `painel-suporte` (L15619-15623)
- Apenas chama `carregarAdminTickets()` sem qualquer feedback. Se a lista voltar igual, o user não sabe se foi recarregada.

#### M4. Botões "📤 Compartilhar recibo" — fallback para `clipboard.writeText` sem catch
- L7901, L9359, L9425, L9459, L8184: pattern `navigator.clipboard?.writeText(...).then(() => setToastSuccess("..."))` — se `clipboard` for `undefined`, `?.` curto-circuita e a função vira `undefined`, e `.then` rejeita TypeError. O toast nunca aparece e ainda gera exception console.
- L9425 e L9459 usam `navigator.clipboard?.writeText(chavePix); setToastSuccess(...)` sequencialmente — assume sucesso mesmo se `clipboard` for undefined.

#### M5. `excluirChat` (L3830-3839) — ação destrutiva sem reset de loading
- Não tem state `excluindoChat`, então não há disabled. OK para esse caso, mas o user pode clicar várias vezes durante o await (`delete` é idempotente, sem dano, mas má UX).

#### M6. Botão "Salvar Bio" duplicado em 4 lugares (L10163, L10254, L12157, L12822)
- 4 handlers inline idênticos `async () => { const ok = await saveProfile({ bio: bioDraft }); if (ok) { setToastSuccess("✅ Bio salva!"); … } }`.
- Sem `await/try`, sem feedback de erro (`saveProfile` retorna false, mas a UI só não mostra success — não diz por quê falhou).
- L10163/L12157 estão em `home-diarista`/`home-empregador` (toast renderiza), L10254/L12822 estão dentro de modais → renderiza enquanto modal está aberto.

### 🟢 Baixos — observações

- **Modais de toast cobrem-se em z-index**: `home-empregador` usa `zIndex:999`, `admin-painel` e `comunidade` usam `zIndex:9999`. Não é bug, mas inconsistência (ex: se modal de overlay com z:1000 estiver aberto em `home-empregador`, esconde o toast).
- **Tela de fallback** (L16435-16447): se nenhum branch fechar `tela`, mostra "Algo deu errado". Não há toast, mas é um catch geral. ✅ OK.

---

## 3. Botões/onClick que abrem modais não renderizados em todas as telas

- `modalNovoTicketJSX` (L3049) é renderizado em `suporte` (L6468) e `meus-tickets` (L15945). **Não** é renderizado em `painel-suporte` ou `admin-painel`, embora teoricamente admin/suporte poderia abrir um ticket. (Não é caso real, pois admin nunca clica "+ Novo chamado" desses painéis — esses painéis só listam tickets de outros.) ✅ OK.
- Modais globais (`{modalConfirmLogout}`, `{mostrarTermos && …}`, `{modalReciboDiarista && …}`, `{modalQuemSomos && …}`) são renderizados onde necessários — verificar caso a caso se aparece em todas as telas que dão `setModal…(true)`. Não auditei a fundo, mas as 4 telas que renderizam toast também renderizam a maioria desses modais.

---

## 4. Botões que disparam navegação para tela inexistente

Mapeei TODOS os `setTela("…")`: 33 destinos únicos, **todos têm branch correspondente**. ✅ Sem navegação morta.

---

## 5. Confirmação ausente em ações destrutivas

| Ação | Confirmação | Localização |
|------|-------------|-------------|
| Cancelar diária | ✅ `modalCancelar` (L2709) | OK |
| Excluir diária | ✅ `modalExcluir` (L3464) | OK |
| Desistir de diária | ✅ `modalDesistir` (L2727) | OK |
| Excluir chat | ✅ `confirmExcluirChat` (L9980) | OK |
| Excluir diária já cancelada | ✅ `confirmExcluirDiariaCancelada` (L3850) | OK |
| Bloquear usuário | ✅ `modalBloquear` (L3745) | OK |
| Desbloquear usuário | ✅ `modalConfirmDesbloq` (L3765) | OK |
| Excluir conta (LGPD) | ✅ `confirmDeleteConta` (L5911) | OK |
| Logout | ✅ `confirmLogout` / `modalConfirmLogout` | OK |
| Excluir tópico (comunidade) | ⚠️ Verificar — `setToastSuccess("Tópico excluído.")` em L3444 mas não localizei confirm modal. | A revisar |

**Achado**: excluir tópico da comunidade pode estar **sem confirmação**. Recomendado adicionar.

---

## 6. Fix em lote sugerido — toast global

### Diagnóstico

Os 4 lugares onde o toast é renderizado são copy-paste do mesmo bloco JSX. Toda tela
nova que esquecer de adicionar esse bloco fica vulnerável ao bug. Já aconteceu uma vez
(admin-painel, commit `9d98193`). Vai acontecer de novo.

### Solução

Renderizar o toast **uma única vez** no fim do `App.tsx`, **fora** do branching de telas.
Como o componente `App` é o root e o `return` é apenas uma das ~34 cadeias `if (tela ===
…) return (…)`, o ideal é envolver o `return` final num fragmento que **sempre** inclui o
toast.

Opção mais simples: extrair um portal/overlay que se monta no `body`. Como o projeto não
usa portals, podemos colocar o toast no nível do `<ErrorBoundary>` em `main.tsx`. Mas
isso exige expor `toastSuccess`/`toastError` num contexto.

**Opção mais cirúrgica** (zero refactor): criar um helper que envolve o `return` de cada
tela.

```typescript
// Adicionar logo antes do primeiro `if (tela === ...)` (~linha 4720):
const comToast = (node: React.ReactNode) => (
  <>
    {node}
    {toastSuccess && (
      <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)",
        background:"#0f172a", color:"#fff", borderRadius:24, padding:"10px 22px",
        fontSize:14, fontWeight:700, zIndex:9999, whiteSpace:"nowrap",
        boxShadow:"0 4px 20px rgba(0,0,0,.25)" }}>
        {toastSuccess}
      </div>
    )}
    {toastError && (
      <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)",
        background:"#dc2626", color:"#fff", borderRadius:24, padding:"10px 22px",
        fontSize:14, fontWeight:700, zIndex:9999, whiteSpace:"nowrap",
        boxShadow:"0 4px 20px rgba(220,38,38,.4)", maxWidth:"90vw", textAlign:"center" }}>
        {toastError}
      </div>
    )}
  </>
);

// Depois, todas as telas mudam de:
//   if (tela === "configuracoes") { return (<div>...</div>); }
// para:
//   if (tela === "configuracoes") { return comToast(<div>...</div>); }
//
// E os 4 lugares (home-emp, home-dia, admin-painel, comunidade) podem REMOVER
// os blocos {toastSuccess && …}/{toastError && …} internos para evitar duplicata.
```

**Esforço**: ~10 minutos. Edição mecânica em 30 lugares. Diff revisável.

### Solução B (mais limpa, mais invasiva)

Mover o toast para `main.tsx` via Portal, criar `ToastContext` e expor
`useToast()`. Refatora chamadas de `setToastError(…)` para `toast.error(…)`.
Quebra menos a regra "não introduzir libs" e mantém JSX inline. Esforço: ~1 hora.

---

## 7. Próximos passos recomendados

1. **🔴 Urgente (15 min)**: aplicar `comToast(...)` ou equivalente, eliminando o bug
   sistêmico de toast invisível. Remover os 4 blocos internos duplicados.
2. **🟠 Curto prazo (1 h)**: envolver os 16 handlers da seção A1 em `try/catch/finally`
   para garantir reset de loading.
3. **🟡 Médio (30 min)**: adicionar feedback de sucesso em `cancelarDiaria` (M1),
   melhorar feedback de exclusão de tópico, conferir M4 (clipboard fallback).
4. **🟢 Backlog**: padronizar z-index dos toasts (todos para 9999); centralizar
   o estilo do toast num componente; considerar bug em `enviarMensagemReal` (A2)
   por causar dupla mensagem em flakes de rede.

---

## Anexo — Referências de linha

| Item | Arquivo | Linha |
|------|---------|------:|
| `toastSuccess` / `toastError` declaração | `src/App.tsx` | 269-270 |
| Toast render `home-empregador` | `src/App.tsx` | 8033-8042 |
| Toast render `home-diarista` | `src/App.tsx` | 10633-10642 |
| Toast render `admin-painel` (fix do bug original) | `src/App.tsx` | 15061-15062 |
| Toast render `comunidade` | `src/App.tsx` | 16186-16187 |
| Comentário "admin não tinha toast — motivo do bug" | `src/App.tsx` | 15060 |
| `criarTicketSuporte` | `src/App.tsx` | 2972-3008 |
| `enviarRespostaTicket` | `src/App.tsx` | 3011-3046 |
| `atualizarStatusTicket` | `src/App.tsx` | 3139-3149 |
| `enviarDocumentoKYC` | `src/App.tsx` | 3162-3210 |
| `enviarAntecedentes` | `src/App.tsx` | 3220-3266 |
| `enviarConvite` | `src/App.tsx` | 2834-2870 |
| `iniciarOAuthMP` | `src/App.tsx` | 2498-2509 |
| `handleFotoUpload` | `src/App.tsx` | 2572-2629 |
| `handlePortfolioUpload` | `src/App.tsx` | 3882-3911 |
| `bloquearUsuario` / `desbloquearUsuario` | `src/App.tsx` | 3726-3767 |
| `excluirDiaria` (sem try/catch, 5 awaits) | `src/App.tsx` | 3464-3506 |
| `enviarMensagemReal` (falha silenciosa) | `src/App.tsx` | 3510-3545 |
| `salvarDiaria` (usa authError + redireciona, OK) | `src/App.tsx` | 3991-4084 |
| `cancelarDiaria` (sem feedback success) | `src/App.tsx` | 2709-2724 |
| Botões "Salvar Bio" (4 cópias) | `src/App.tsx` | 10163, 10254, 12157, 12822 |
