-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: vagas expiradas/inativas "voltavam" depois de excluídas.
-- ═══════════════════════════════════════════════════════════════════════════
-- Sintoma: o anunciante exclui uma vaga expirada/cancelada e ela reaparece
--   ("excluí várias vezes e volta"), às vezes com "Não foi possível excluir".
--
-- Causa: algumas tabelas-filhas referenciam diarias(id) com a regra de exclusão
--   NO ACTION/RESTRICT (o padrão). Quando a vaga tem chat (mensagens), avaliação
--   ou denúncia, o DELETE da diária esbarra na FK e falha. O app faz rollback
--   (recarrega a linha) → a vaga volta pra tela.
--   O front só apagava `candidaturas` antes do delete; as demais filhas barravam.
--
-- Correção definitiva (no banco): toda FK que APONTA pra diarias e hoje BLOQUEIA
--   o delete (NO ACTION 'a' ou RESTRICT 'r') passa a ser ON DELETE CASCADE. Assim
--   apagar a vaga leva junto chat, avaliações, denúncias, feedbacks etc. — que
--   pertencem à vaga e não fazem sentido sem ela.
--   FKs com SET NULL/SET DEFAULT (histórico proposital) NÃO são tocadas.
--
-- Genérico: descobre as constraints por catálogo (pg_constraint), sem depender
--   de nomes. Idempotente — re-rodar não encontra mais nenhuma bloqueante.
-- Aplicar: Supabase Dashboard → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r        RECORD;
  v_cols   TEXT;
  v_refcols TEXT;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS filho, c.conkey, c.confkey
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.diarias'::regclass
       AND c.confdeltype IN ('a', 'r')   -- só as que BLOQUEIAM (NO ACTION/RESTRICT)
  LOOP
    -- colunas da filha (na ordem da constraint)
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY x.ord)
      INTO v_cols
      FROM unnest(r.conkey) WITH ORDINALITY AS x(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = r.filho AND a.attnum = x.attnum;

    -- colunas referenciadas em diarias (na mesma ordem)
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY x.ord)
      INTO v_refcols
      FROM unnest(r.confkey) WITH ORDINALITY AS x(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = 'public.diarias'::regclass AND a.attnum = x.attnum;

    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.filho, r.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES public.diarias(%s) ON DELETE CASCADE',
      r.filho, r.conname, v_cols, v_refcols);

    RAISE NOTICE 'FK % em % → ON DELETE CASCADE', r.conname, r.filho;
  END LOOP;
END $$;

-- Verificação: deve retornar 0 linhas (nenhuma FK bloqueante sobrou).
SELECT c.conrelid::regclass AS tabela_filha, c.conname AS constraint_ainda_bloqueante
  FROM pg_constraint c
 WHERE c.contype = 'f'
   AND c.confrelid = 'public.diarias'::regclass
   AND c.confdeltype IN ('a', 'r');
