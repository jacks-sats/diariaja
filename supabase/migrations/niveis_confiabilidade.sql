-- Migração: Sistema de níveis de confiabilidade do usuário
-- Nível 1 (Básico)     — telefone verificado por SMS
-- Nível 2 (Verificado) — + CPF/CNPJ + email confirmado
-- Nível 3 (Confiável)  — + documento com foto aprovado por KYC
-- Nível 4 (Premium)    — + 2FA ativado
--
-- O nível é CALCULADO no client a partir dos campos preenchidos —
-- esta migration só adiciona as colunas faltantes.
--
-- Rodar em: Supabase Dashboard → SQL Editor → New Query. Re-executável.

ALTER TABLE user_profiles
  -- Telefone confirmado via OTP (SMS). Hoje todo profile já tem telefone
  -- escrito mas sem verificação. Default false pra forçar quem quer N1 a
  -- passar pelo OTP quando o SMS provider estiver ligado.
  ADD COLUMN IF NOT EXISTS telefone_verificado BOOLEAN NOT NULL DEFAULT FALSE,

  -- Status do documento de identidade (Nível 3)
  -- 'nao_enviado' → padrão; 'enviado' → aguardando análise; 'aprovado'
  -- → KYC validou; 'rejeitado' → tem que reenviar
  ADD COLUMN IF NOT EXISTS documento_status TEXT NOT NULL DEFAULT 'nao_enviado'
    CHECK (documento_status IN ('nao_enviado', 'enviado', 'aprovado', 'rejeitado')),

  -- URL do documento no Storage (privado, só admin lê)
  ADD COLUMN IF NOT EXISTS documento_url TEXT,
  ADD COLUMN IF NOT EXISTS documento_enviado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS documento_revisado_em TIMESTAMPTZ;

-- Índice pra admin filtrar quem está aguardando análise
CREATE INDEX IF NOT EXISTS idx_user_profiles_documento_status
  ON user_profiles (documento_status)
  WHERE documento_status = 'enviado';

SELECT 'Campos de níveis de confiabilidade instalados.' AS resultado;
