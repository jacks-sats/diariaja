-- ═══════════════════════════════════════════════════════════════════════════
-- FIX C1 — Enforce server-side do limite de seleção de candidato
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Bug (auditoria 2026-05-29): a seleção de candidato é feita por um UPDATE
-- direto em `diarias` (App.tsx executarSelecaoCandidato:
--   update diarias set diarista_aceite_id = ... ).
-- A RPC `pode_selecionar_candidato` é só CONSULTIVA (o client decide se abre o
-- modal de R$1). Não havia NADA no servidor impedindo o anunciante grátis de
-- selecionar além das 3 cotas sem pagar — bastava chamar a API direto
-- (DevTools / supabase-js). Bypass total do paywall de R$1 e do valor dos
-- planos pagos.
--
-- Fix: trigger BEFORE UPDATE que, quando `diarista_aceite_id` é DEFINIDO pela
-- primeira vez (NULL -> valor) por um usuário comum, revalida o limite — a
-- mesma regra de `pode_selecionar_candidato`. Se estourou a cota e não há plano
-- nem desbloqueio pago, levanta exceção e a seleção não acontece.
--
-- Por que trigger (e não REVOKE de coluna): REVOKE exigiria GRANT explícito de
-- todas as OUTRAS colunas que o anunciante edita legitimamente (funcao, valor,
-- data, status, cancelamento...), e o schema de `diarias` não está versionado.
-- O trigger não precisa conhecer as colunas e não muda o cliente.
--
-- Dependências (já existentes): função `plano_ativo_role(uuid,text)` e tabela
-- `contatos_desbloqueios`. ADITIVO/idempotente. service_role faz bypass.
--
-- OBS: aplicar DEPOIS de fix_c3_plano_avulso_no_gate.sql, para que quem pagou
-- plano avulso (Pix 30d) seja reconhecido como pago aqui também.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION enforce_limite_selecao_candidato()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plano    TEXT;
  v_selecoes INTEGER;
  v_extras   INTEGER;
  v_limite   INTEGER;
BEGIN
  -- service_role (webhook, RPCs SECURITY DEFINER) bypassa.
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Só enforça quando diarista_aceite_id é DEFINIDO pela 1ª vez (NULL -> valor).
  -- Re-seleção (troca de prestador já selecionado) e UPDATEs que não mexem nesse
  -- campo (confirmar presença, cancelar, editar vaga, auto-expirar) passam direto.
  IF NEW.diarista_aceite_id IS NULL
     OR OLD.diarista_aceite_id IS NOT NULL
     OR NEW.diarista_aceite_id IS NOT DISTINCT FROM OLD.diarista_aceite_id THEN
    RETURN NEW;
  END IF;

  -- Plano pago (essencial/plus, por assinatura OU plano avulso 30d) = ilimitado.
  v_plano := plano_ativo_role(NEW.empregador_id, 'empregador');
  IF v_plano IN ('essencial', 'plus') THEN
    RETURN NEW;
  END IF;

  -- Seleções confirmadas neste mês (mesma contagem da RPC consultiva).
  SELECT COUNT(*) INTO v_selecoes
    FROM diarias
   WHERE empregador_id      = NEW.empregador_id
     AND diarista_aceite_id IS NOT NULL
     AND created_at >= date_trunc('month', NOW());

  -- Desbloqueios R$1 pagos neste mês (cada um soma 1 ao limite).
  SELECT COUNT(*) INTO v_extras
    FROM contatos_desbloqueios
   WHERE empregador_id = NEW.empregador_id
     AND created_at >= date_trunc('month', NOW());

  v_limite := 3 + COALESCE(v_extras, 0);

  IF v_selecoes >= v_limite THEN
    RAISE EXCEPTION 'Limite de seleções do mês atingido. Pague o desbloqueio (R$1) ou assine um plano para selecionar mais.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_limite_selecao ON diarias;
CREATE TRIGGER trg_enforce_limite_selecao
  BEFORE UPDATE ON diarias
  FOR EACH ROW
  EXECUTE FUNCTION enforce_limite_selecao_candidato();

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificação (rodar manualmente após aplicar):
--   -- Como anunciante grátis que já fez 3 seleções no mês, tentar via API:
--   --   UPDATE diarias SET diarista_aceite_id = '<id>' WHERE id = '<diaria>';
--   -- deve falhar com 'Limite de seleções do mês atingido.'
--   -- Dentro da cota (≤3) ou com plano/desbloqueio pago, deve passar.
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'diarias'::regclass
--      AND tgname = 'trg_enforce_limite_selecao';  -- deve existir
-- ─────────────────────────────────────────────────────────────────────────────
