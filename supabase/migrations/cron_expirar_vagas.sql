-- Migração: Função SQL para expirar vagas (opcionalmente via pg_cron)
-- A expiração já roda no client quando o empregador abre o app. Mas se um
-- empregador nunca abrir, a vaga fica 'aberta' no banco indefinidamente.
-- Esta função pode ser chamada manualmente OU agendada com pg_cron.
--
-- Rodar em: Supabase Dashboard → SQL Editor → New Query.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Função: marca como 'expirada' toda vaga 'aberta'/'pendente' cujo
--    horário_fim já passou
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expirar_vagas_vencidas()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  qtd INTEGER;
BEGIN
  UPDATE diarias
     SET status = 'expirada'
   WHERE status IN ('aberta', 'pendente')
     AND (data || ' ' || horario_fim)::timestamp < now();
  GET DIAGNOSTICS qtd = ROW_COUNT;
  RETURN qtd;
END;
$$;

-- Execução manual:
--   SELECT public.expirar_vagas_vencidas();
-- Retorna o número de vagas expiradas nessa rodada.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. (OPCIONAL) Agendamento via pg_cron — Supabase Pro ou self-hosted
-- ─────────────────────────────────────────────────────────────────────────────
-- Descomentar se o pg_cron estiver disponível no seu projeto:
--
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--   SELECT cron.schedule(
--     'expirar-vagas-15min',
--     '*/15 * * * *',
--     $$ SELECT public.expirar_vagas_vencidas(); $$
--   );
--
-- Para desfazer:
--   SELECT cron.unschedule('expirar-vagas-15min');

SELECT 'Função expirar_vagas_vencidas instalada.' AS resultado;
