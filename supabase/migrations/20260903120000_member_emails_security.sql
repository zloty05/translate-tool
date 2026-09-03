-- ══════════════════════════════════════════════════════════════════
-- Wycofanie widoku member_emails na rzecz RPC get_member_emails
-- ══════════════════════════════════════════════════════════════════
--
-- PROBLEM (linter Supabase, 2 błędy na tym samym obiekcie):
--
--   1. auth_users_exposed (CRITICAL)
--      Widok czyta auth.users i miał GRANT ALL ... TO anon, więc był
--      wystawiony przez PostgREST także dla roli anonimowej.
--
--   2. security_definer_view (ERROR)
--      Widok wykonywał się z uprawnieniami właściciela (postgres), a
--      jedyną barierą był filtr WHERE ... auth.uid(). Dla anon auth.uid()
--      jest NULL, więc podzapytanie było puste i realnego wycieku raczej
--      nie było — ale izolacja tenantów wisiała na jednym WHERE.
--
-- DLACZEGO NIE security_invoker:
--   Rola `authenticated` nie ma prawa do auth.users. Widok z
--   security_invoker = true zwróciłby NULL w email i display_name dla
--   WSZYSTKICH użytkowników — zakładka Zespół zaczęłaby pokazywać
--   skrócone UUID-y. To jest pułapka w standardowym remediation
--   z dokumentacji Supabase; szczegóły w sql/fix_member_emails_view.sql.
--
-- ROZWIĄZANIE:
--   Funkcja SECURITY DEFINER z jawną bramką na członkostwo — ten sam
--   wzorzec co delete_lang_assignment i save_dict_translation. Znika
--   obiekt, na który wskazują oba linty, a walidacja jest jawna
--   zamiast ukryta w WHERE widoku.
-- ══════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.member_emails;

CREATE OR REPLACE FUNCTION public.get_member_emails(org_id uuid)
RETURNS TABLE (
  organization_id uuid,
  user_id         uuid,
  display_name    text,
  email           text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Bramka: wołający musi należeć do organizacji, o którą pyta.
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE public.organization_members.organization_id = org_id
      AND public.organization_members.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    om.organization_id,
    om.user_id,
    COALESCE(
      NULLIF(p.full_name, ''::text),
      NULLIF(u.raw_user_meta_data->>'full_name', ''::text)
    )::text AS display_name,
    u.email::text AS email
  FROM public.organization_members om
  LEFT JOIN public.profiles p ON p.id = om.user_id
  LEFT JOIN auth.users u      ON u.id = om.user_id
  WHERE om.organization_id = org_id;
END;
$$;

ALTER FUNCTION public.get_member_emails(uuid) OWNER TO postgres;

-- SECURITY DEFINER + domyślny GRANT EXECUTE TO PUBLIC oznaczałby, że anon
-- może wołać funkcję. Bramka i tak by go odrzuciła (auth.uid() IS NULL),
-- ale nie zostawiamy tego na łasce jednego IF-a.
REVOKE ALL ON FUNCTION public.get_member_emails(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_emails(uuid) TO authenticated;
