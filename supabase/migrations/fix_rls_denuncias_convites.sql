-- Migração: Endurecimento de RLS — denuncias e convites
-- Rodar em: Supabase Dashboard → SQL Editor → New Query
-- Pode ser re-executada (drop + create).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. denuncias: impede forjar denunciante_id
-- ─────────────────────────────────────────────────────────────────────────────
-- A policy original só checava auth.uid() IS NOT NULL, permitindo que qualquer
-- autenticado inserisse uma denúncia atribuída a outro usuário.
DROP POLICY IF EXISTS "qualquer_auth_pode_denunciar" ON denuncias;

CREATE POLICY "denunciante_proprio" ON denuncias
  FOR INSERT WITH CHECK (auth.uid() = denunciante_id);

-- Permite ao próprio denunciante consultar suas denúncias (status, follow-up)
DROP POLICY IF EXISTS "denunciante_le_proprias" ON denuncias;
CREATE POLICY "denunciante_le_proprias" ON denuncias
  FOR SELECT USING (auth.uid() = denunciante_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. convites: diarista só pode mudar 'status' (não valor, data, local etc.)
-- ─────────────────────────────────────────────────────────────────────────────
-- A policy original tinha apenas USING sem WITH CHECK, então o diarista podia
-- reescrever qualquer coluna no UPDATE.
DROP POLICY IF EXISTS "diarista_pode_responder" ON convites;

CREATE POLICY "diarista_responde_status" ON convites
  FOR UPDATE
  USING (auth.uid() = diarista_id)
  WITH CHECK (
    auth.uid() = diarista_id
    AND status IN ('aceito', 'recusado')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Confirmação
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Policies de denuncias e convites endurecidas.' AS resultado;
