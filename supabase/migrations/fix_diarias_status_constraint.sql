-- Migração: Corrige constraint de status da tabela diarias
-- Problema: constraint original só permitia 4 status, mas o app usa 6
-- Rodar em: Supabase Dashboard → SQL Editor → New Query

ALTER TABLE diarias DROP CONSTRAINT IF EXISTS diarias_status_check;

ALTER TABLE diarias ADD CONSTRAINT diarias_status_check
  CHECK (status = ANY (ARRAY[
    'aberta',       -- vaga aberta para candidaturas
    'pendente',     -- empregador selecionou, aguardando diarista confirmar
    'aceita',       -- diarista confirmou presença
    'em_andamento', -- serviço em execução (check-in feito)
    'concluida',    -- serviço finalizado
    'cancelada'     -- cancelada por qualquer parte
  ]));

SELECT 'Constraint diarias_status_check atualizado com sucesso!' AS resultado;
