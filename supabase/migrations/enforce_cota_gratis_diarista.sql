-- ═══════════════════════════════════════════════════════════════════════════
-- Trava da cota grátis do DIARISTA: 3 diárias concluídas grátis (P0-2)
-- ═══════════════════════════════════════════════════════════════════════════
-- A promessa "primeiras 3 diárias concluídas grátis → depois assina (R$9,90)"
-- NÃO tinha enforcement nenhum (nem client, nem servidor): o diarista grátis
-- aceitava diárias pra sempre. Este trigger fecha o furo no SERVIDOR (autoridade),
-- espelhando o padrão de fix_c1_enforce_selecao_candidato.sql (lado empregador).
--
-- Regra: ao TRANSICIONAR uma diária para status 'aceita' (o diarista assume o
-- serviço — ver executarConfirmarPresenca no App), se o diarista do registro
-- está no plano grátis E já tem >= 3 diárias CONCLUÍDAS (vitalício), bloqueia.
-- Plano pago (essencial/plus) = ilimitado.
--
-- Observação (decisão de produto): a contagem é de diárias CONCLUÍDAS
-- (contar_diarias_concluidas_diarista). Logo um diarista grátis pode ter
-- várias diárias 'aceita' simultâneas antes de concluir 3 — a trava morde a
-- partir da 4ª aceitação DEPOIS de já ter 3 concluídas. Se o dono quiser
-- contar aceita+concluída, trocar a função de contagem.
--
-- Aplicar: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION enforce_cota_gratis_diarista()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plano      TEXT;
  v_concluidas INTEGER;
BEGIN
  -- service_role (Edge Functions/admin) não é barrado.
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Só enforça na transição PARA 'aceita' (aceitação do serviço pelo diarista).
  IF NEW.status IS DISTINCT FROM 'aceita'
     OR OLD.status IS NOT DISTINCT FROM NEW.status
     OR NEW.diarista_aceite_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_plano := plano_ativo_role(NEW.diarista_aceite_id, 'diarista');
  IF v_plano IN ('essencial', 'plus') THEN
    RETURN NEW;  -- plano pago = diárias ilimitadas
  END IF;

  v_concluidas := contar_diarias_concluidas_diarista(NEW.diarista_aceite_id);
  IF v_concluidas >= 3 THEN
    RAISE EXCEPTION 'Você já concluiu suas 3 diárias grátis. Assine um plano para aceitar novas diárias.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_cota_gratis_diarista ON diarias;
CREATE TRIGGER trg_enforce_cota_gratis_diarista
  BEFORE UPDATE ON diarias
  FOR EACH ROW
  EXECUTE FUNCTION enforce_cota_gratis_diarista();

SELECT 'Trava da cota grátis do diarista (3 concluídas) instalada.' AS resultado;
