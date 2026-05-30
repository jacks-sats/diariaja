-- ═══════════════════════════════════════════════════════════════════════════
-- B9 — usuarios_publicos com security_invoker (respeita RLS do chamador)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Por padrão, uma VIEW roda com os privilégios do DONO (postgres), o que pode
-- IGNORAR o RLS das tabelas-base. A view `usuarios_publicos` lê de user_profiles;
-- mesmo sem expor colunas sensíveis, é uma porta latente (qualquer um com acesso
-- à view veria linhas que o RLS bloquearia). `security_invoker = true` faz a view
-- rodar com os privilégios/RLS de QUEM consulta.
--
-- Requer Postgres 15+ (Supabase atual). Idempotente. A view hoje não é usada pelo
-- app, então o risco é nulo — é só hardening.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER VIEW IF EXISTS usuarios_publicos SET (security_invoker = true);

-- (Opcional) Se quiser endurecer também as demais views de leitura, descomente
-- as que o app realmente usa e teste depois — algumas podem precisar de GRANT
-- de colunas pós-REVOKE do C2:
--   ALTER VIEW IF EXISTS reputacao_empregadores SET (security_invoker = true);
--   ALTER VIEW IF EXISTS diarias_dislikes       SET (security_invoker = true);

-- Verificação:
--   SELECT relname, reloptions FROM pg_class
--    WHERE relname = 'usuarios_publicos';  -- deve mostrar {security_invoker=true}
