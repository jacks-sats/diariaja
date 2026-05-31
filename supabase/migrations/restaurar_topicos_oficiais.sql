-- ═══════════════════════════════════════════════════════════════════════════
-- RESTAURAR — 3 tópicos oficiais da Comunidade ("Equipe DiáriaJá")
-- ═══════════════════════════════════════════════════════════════════════════
-- Os tópicos oficiais foram apagados quando uma conta (o admin que era autor)
-- foi excluída — a antiga `delete-user` fazia DELETE dos tópicos pelo autor_id.
-- (Já corrigido: agora a função ANONIMIZA o autor em vez de apagar o conteúdo.)
--
-- Este script recria os 3 fixados. Idempotente: só insere se o título não
-- existir. Usa um admin como autor se houver; senão deixa autor_id = NULL
-- (a coluna é nullable e o app exibe "Equipe DiáriaJá" pelo autor_nome).
--
-- Rodar em: Supabase Dashboard → SQL Editor → New Query → Run.
-- ═══════════════════════════════════════════════════════════════════════════

DO $seed$
DECLARE v_admin UUID;
BEGIN
  SELECT id INTO v_admin FROM user_profiles WHERE is_admin = true LIMIT 1;

  -- ── Tópico 1 — Fim da escala 6x1 ──────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM topicos WHERE titulo = 'Fim da escala 6×1: e quem trabalha por conta, sai ganhando? 🗣️') THEN
    INSERT INTO topicos (autor_id, autor_nome, autor_tipo, titulo, conteudo, categoria, pinned) VALUES (
      v_admin, 'Equipe DiáriaJá', 'ambos',
      'Fim da escala 6×1: e quem trabalha por conta, sai ganhando? 🗣️',
      E'O Brasil tá discutindo o fim da escala 6×1. Enquanto isso, quem é autônomo aqui no DiáriaJá já escolhe **quais dias e horários** quer trabalhar. 🤔\n\nVocê largaria um emprego 6×1 pra ter essa liberdade? Quem já vive de diária, **como é ter controle da própria agenda?**\n\nConta aqui embaixo 👇',
      'geral', true);
  END IF;

  -- ── Tópico 2 — Vale a pena virar MEI? ─────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM topicos WHERE titulo = 'Vale a pena virar MEI? CNPJ, aposentadoria e nota fiscal na real 💼') THEN
    INSERT INTO topicos (autor_id, autor_nome, autor_tipo, titulo, conteudo, categoria, pinned) VALUES (
      v_admin, 'Equipe DiáriaJá', 'ambos',
      'Vale a pena virar MEI? CNPJ, aposentadoria e nota fiscal na real 💼',
      E'Virar MEI dá direito a **CNPJ, aposentadoria, auxílio-doença e poder emitir nota** — por uma taxa mensal baixinha. Mas será que compensa pra todo mundo? 🧐\n\nQuem já é MEI: **mudou algo pra você?** Quem tá na dúvida: qual o maior medo ou a maior dúvida?\n\nBora trocar experiência 👇 (e quem quiser saber como virar MEI, tem o atalho aqui na Comunidade 💼)',
      'duvidas', true);
  END IF;

  -- ── Tópico 3 — Quanto cobrar pela diária? ─────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM topicos WHERE titulo = 'Quanto você cobra pela diária? Bora parar de se desvalorizar 💰') THEN
    INSERT INTO topicos (autor_id, autor_nome, autor_tipo, titulo, conteudo, categoria, pinned) VALUES (
      v_admin, 'Equipe DiáriaJá', 'ambos',
      'Quanto você cobra pela diária? Bora parar de se desvalorizar 💰',
      E'Cobrar barato demais cansa e não sobra nada; cobrar o justo é respeito pelo seu trabalho. 💪\n\n**Como você calcula seu preço** — por hora, por serviço, por tamanho do local? Inclui material e transporte na conta?\n\nCompartilha sua lógica (sem medo!) pra ajudar quem tá começando 👇',
      'dicas', true);
  END IF;
END $seed$;

-- Verificação:
SELECT titulo, categoria, pinned FROM topicos WHERE autor_nome = 'Equipe DiáriaJá' ORDER BY created_at;
