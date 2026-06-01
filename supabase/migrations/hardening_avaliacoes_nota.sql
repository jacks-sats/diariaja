-- ═══════════════════════════════════════════════════════════════════════════
-- Hardening de avaliações: garante nota entre 1 e 5 no SERVIDOR (defesa extra)
-- ═══════════════════════════════════════════════════════════════════════════
-- A UI já só deixa dar nota de 1 a 5 (clique em estrelas) e valida nota !== 0.
-- Este CHECK é defesa em profundidade: bloqueia nota fora de faixa se alguém
-- enviar request manual (DevTools / SDK direto). Não muda nada pro usuário normal.
--
-- Idempotente: IF NOT EXISTS no nome da constraint. Se a coluna 'nota' não
-- existir numa tabela, o bloco apenas pula (não falha).
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- avaliacoes_diarista
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='avaliacoes_diarista' AND column_name='nota')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='avaliacoes_diarista_nota_check') THEN
    ALTER TABLE avaliacoes_diarista
      ADD CONSTRAINT avaliacoes_diarista_nota_check CHECK (nota BETWEEN 1 AND 5);
    RAISE NOTICE 'CHECK de nota adicionado em avaliacoes_diarista.';
  END IF;

  -- avaliacoes_empregador
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='avaliacoes_empregador' AND column_name='nota')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='avaliacoes_empregador_nota_check') THEN
    ALTER TABLE avaliacoes_empregador
      ADD CONSTRAINT avaliacoes_empregador_nota_check CHECK (nota BETWEEN 1 AND 5);
    RAISE NOTICE 'CHECK de nota adicionado em avaliacoes_empregador.';
  END IF;
END $$;

SELECT 'Hardening de avaliações: nota 1-5 garantida no servidor.' AS resultado;
