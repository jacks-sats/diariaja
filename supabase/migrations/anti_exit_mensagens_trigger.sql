-- Migração: Trigger anti-saída no chat (defesa em servidor)
-- Espelha a regex de helpers.ts:detectarContatoExterno para que tentativas de
-- pular o filtro do cliente (DevTools, supabase-js direto) também sejam bloqueadas.
-- Rodar em: Supabase Dashboard → SQL Editor → New Query.
-- Pode ser re-executada (CREATE OR REPLACE / DROP IF EXISTS).

CREATE OR REPLACE FUNCTION public.bloqueia_contato_externo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  conteudo_lower text := lower(coalesce(NEW.conteudo, ''));
BEGIN
  -- Número de 8 a 11 dígitos consecutivos (telefone)
  IF conteudo_lower ~ '\m\d{8,11}\M' THEN
    RAISE EXCEPTION 'Mensagem bloqueada: número de contato externo detectado.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Redes sociais e palavras que indicam saída do app
  IF conteudo_lower ~ '(whatsapp|wpp|zap|telegram|meu.n[uú]mero|me.liga|me.chama|fora.do.app)' THEN
    RAISE EXCEPTION 'Mensagem bloqueada: tentativa de contato fora do app.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bloqueia_contato_externo ON mensagens;

CREATE TRIGGER trg_bloqueia_contato_externo
  BEFORE INSERT ON mensagens
  FOR EACH ROW
  EXECUTE FUNCTION public.bloqueia_contato_externo();

SELECT 'Trigger anti-saída do chat instalado.' AS resultado;
