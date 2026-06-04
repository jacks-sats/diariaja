-- ============================================================================
-- RPC: id_por_documento — login por CPF/CNPJ à prova de formato
-- ============================================================================
-- Mapeia um documento (só dígitos) → user_profiles.id, normalizando os DOIS
-- lados pra dígitos com regexp_replace. Assim casa independentemente de como o
-- cadastro salvou: com máscara ("24.626.142/0001-27"), só dígitos, ou com
-- espaços/sujeira. Resolve o "login por CNPJ não funciona".
--
-- Usada pela Edge Function `lookup-by-cpf` (que roda com service_role).
-- Idempotente. Aplicar no Supabase Dashboard → SQL Editor.
-- ============================================================================

create or replace function public.id_por_documento(p_digits text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select id
    from public.user_profiles
   where p_digits is not null
     and p_digits <> ''
     and (
       regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') = p_digits
       or regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = p_digits
     )
   limit 1;
$$;

-- Segurança: SÓ a Edge Function (service_role) chama isto. Não expor pra
-- anon/authenticated — senão vira endpoint de enumeração de quem está
-- cadastrado por documento.
revoke all on function public.id_por_documento(text) from public;
revoke all on function public.id_por_documento(text) from anon, authenticated;
grant execute on function public.id_por_documento(text) to service_role;

-- Verificação (deve voltar o id do dono do CNPJ, em qualquer formato salvo):
--   select public.id_por_documento('24626142000127');
