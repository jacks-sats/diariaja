-- HOTFIX 2026-05-28: chat de convite (R$1 desbloqueio) não envia mensagem
--
-- Bug: mensagens.diaria_id tem FK pra diarias.id. Quando empregador
-- desbloqueia chat com R$1 num convite (não há diaria criada porque convite
-- só vira diaria após aceite + execução), o INSERT na mensagens falha por
-- violação de FK (silenciosamente, no client).
--
-- Sintoma: empregador paga R$1 → chat abre → manda mensagem → não aparece.
--
-- Fix imediato: solta a FK constraint. mensagens.diaria_id passa a ser
-- referência informativa (não estrita). Trade-off: pode ter linhas órfãs
-- se diaria/convite forem deletados sem CASCADE. Aceitável até arquitetura
-- de chat-via-convite ser revisada.
--
-- TODO arquitetural pendente: ou (a) criar diaria automaticamente quando
-- convite é aceito + R$1 pago, ou (b) adicionar coluna mensagens.convite_id
-- com FK separada e remover unique constraint na diaria_id.

DO $$
DECLARE
  cnst TEXT;
BEGIN
  -- Acha o nome real da constraint (pode variar entre instâncias)
  SELECT conname INTO cnst
    FROM pg_constraint
   WHERE conrelid = 'mensagens'::regclass
     AND contype = 'f'
     AND pg_get_constraintdef(oid) LIKE '%REFERENCES diarias%';

  IF cnst IS NOT NULL THEN
    EXECUTE 'ALTER TABLE mensagens DROP CONSTRAINT ' || quote_ident(cnst);
    RAISE NOTICE 'Constraint % removida de mensagens.', cnst;
  ELSE
    RAISE NOTICE 'Nenhuma FK pra diarias encontrada em mensagens (já removida ou nunca existiu).';
  END IF;
END $$;

-- Verificação
-- SELECT conname FROM pg_constraint
--  WHERE conrelid = 'mensagens'::regclass AND contype = 'f';
