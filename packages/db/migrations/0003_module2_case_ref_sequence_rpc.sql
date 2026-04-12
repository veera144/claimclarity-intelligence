-- Migration: expose case_ref_seq consumption for Module 2 case creation.
-- Supabase REST routes cannot call nextval directly, so this helper keeps the
-- sequence as the source of truth while allowing the API route to format case_ref.

CREATE OR REPLACE FUNCTION public.next_case_ref_seq()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT nextval('public.case_ref_seq')
$$;

REVOKE ALL ON FUNCTION public.next_case_ref_seq() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_case_ref_seq() TO service_role;
