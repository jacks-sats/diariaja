-- ============================================================================
-- Auto-suspensão por volume de denúncias — DiáriaJá
-- ----------------------------------------------------------------------------
-- Quando um alvo (vaga ou usuário) acumula denúncias de denunciantes DISTINTOS
-- acima de um limiar, ele é OCULTADO automaticamente dos feeds (oculto = true).
-- Não é exclusão: é uma suspensão reversível, para o admin revisar. Reverter:
--   UPDATE diarias        SET oculto = false WHERE id = '...';
--   UPDATE user_profiles  SET oculto = false WHERE id = '...';
--
-- Limiares (denunciantes DISTINTOS — brigada de 1 pessoa não conta várias vezes):
--   • Motivo grave (ilegal/assédio/ameaça/fraude/abuso): 3  (fast-track)
--   • Vaga (anúncio efêmero):                            5
--   • Usuário conta nova (<7 dias) ou sem KYC aprovado:  5
--   • Usuário "normal":                                  8
--   • Usuário consagrado (KYC aprovado + >30 dias):     15
--
-- Aplicar manualmente no SQL editor do Supabase. Idempotente (pode re-rodar).
-- ============================================================================

-- 1) Colunas de ocultação + auditoria (idempotentes)
ALTER TABLE diarias        ADD COLUMN IF NOT EXISTS oculto        boolean NOT NULL DEFAULT false;
ALTER TABLE diarias        ADD COLUMN IF NOT EXISTS oculto_em     timestamptz;
ALTER TABLE diarias        ADD COLUMN IF NOT EXISTS oculto_motivo text;
ALTER TABLE user_profiles  ADD COLUMN IF NOT EXISTS oculto        boolean NOT NULL DEFAULT false;
ALTER TABLE user_profiles  ADD COLUMN IF NOT EXISTS oculto_em     timestamptz;
ALTER TABLE user_profiles  ADD COLUMN IF NOT EXISTS oculto_motivo text;

-- 2) Função de processamento (roda como owner — bypassa RLS para ocultar o alvo)
CREATE OR REPLACE FUNCTION processar_denuncia_auto_suspensao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_distintas int;
  v_limiar    int;
  v_grave     boolean;
  v_created   timestamptz;
  v_doc       text;
BEGIN
  -- Conta denunciantes DISTINTOS deste alvo (anti-brigada).
  SELECT count(DISTINCT denunciante_id) INTO v_distintas
  FROM denuncias
  WHERE tipo = NEW.tipo AND alvo_id = NEW.alvo_id;

  -- Motivos graves entram em fast-track (limiar menor).
  v_grave := COALESCE(NEW.motivo, '') ILIKE ANY (ARRAY[
    '%ilegal%', '%assédio%', '%assedio%', '%ameaça%', '%ameaca%',
    '%fraude%', '%abuso%', '%suspeita%'
  ]);

  IF NEW.tipo = 'vaga' THEN
    v_limiar := CASE WHEN v_grave THEN 3 ELSE 5 END;
    IF v_distintas >= v_limiar THEN
      UPDATE diarias
        SET oculto = true,
            oculto_em = now(),
            oculto_motivo = format('Auto-ocultada: %s denúncias distintas (limiar %s)', v_distintas, v_limiar)
      WHERE id = NEW.alvo_id::uuid AND oculto = false;
    END IF;

  ELSIF NEW.tipo = 'usuario' THEN
    SELECT created_at, documento_status INTO v_created, v_doc
    FROM user_profiles WHERE id = NEW.alvo_id::uuid;

    v_limiar := CASE
      WHEN v_grave THEN 3
      WHEN v_doc = 'aprovado' AND v_created <= now() - interval '30 days' THEN 15  -- consagrado
      WHEN v_created > now() - interval '7 days'
        OR v_doc IS DISTINCT FROM 'aprovado'                              THEN 5   -- novo / sem KYC
      ELSE 8                                                                       -- normal
    END;

    IF v_distintas >= v_limiar THEN
      UPDATE user_profiles
        SET oculto = true,
            oculto_em = now(),
            oculto_motivo = format('Auto-ocultado: %s denúncias distintas (limiar %s)', v_distintas, v_limiar)
      WHERE id = NEW.alvo_id::uuid AND oculto = false;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Trigger AFTER INSERT em denuncias
DROP TRIGGER IF EXISTS trg_denuncia_auto_suspensao ON denuncias;
CREATE TRIGGER trg_denuncia_auto_suspensao
  AFTER INSERT ON denuncias
  FOR EACH ROW EXECUTE FUNCTION processar_denuncia_auto_suspensao();

-- 4) Índice para a contagem distinta ficar rápida
CREATE INDEX IF NOT EXISTS idx_denuncias_tipo_alvo ON denuncias (tipo, alvo_id);
