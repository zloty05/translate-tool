-- ══════════════════════════════════════════════════════════════════
-- Naprawa widoku member_emails — nazwy członków zespołu
-- Uruchom JEDNORAZOWO w Supabase → SQL Editor.
-- ══════════════════════════════════════════════════════════════════
--
-- PROBLEM (stara definicja):
--   COALESCE(NULLIF(p.full_name, ''), om.user_id::text) AS display_name
--   NULL::text AS email
--
--   1. Kolumna email zawsze NULL — widok nie sięgał do auth.users,
--      więc frontend nie miał żadnego sensownego fallbacku.
--   2. display_name podstawiał UUID gdy profiles.full_name było puste.
--      Nic w aplikacji nie zapisuje do profiles (imię trafia do
--      auth.users.raw_user_meta_data przez saveAccountName/onboarding),
--      więc dla nowych kont zawsze wychodził UUID.
--
--   Efekt w UI: zakładka Zespół pokazywała "0927587c..." zamiast nazwy.
--
-- ROZWIĄZANIE:
--   - email bierzemy z auth.users
--   - display_name: profiles.full_name → user_metadata.full_name → NULL
--     (NULL zamiast UUID — pozwala getMemberName() zejść na email)
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.member_emails
WITH (security_invoker = true) AS
SELECT
  om.organization_id,
  om.user_id,
  COALESCE(
    NULLIF(p.full_name, ''::text),
    NULLIF(u.raw_user_meta_data->>'full_name', ''::text)
  ) AS display_name,
  u.email::text AS email
FROM public.organization_members om
LEFT JOIN public.profiles p ON p.id = om.user_id
LEFT JOIN auth.users u      ON u.id = om.user_id;

-- Uprawnienia dla zalogowanych użytkowników aplikacji.
GRANT SELECT ON public.member_emails TO authenticated;

-- ── Weryfikacja ────────────────────────────────────────────────────
-- Powinno zwrócić prawdziwe adresy e-mail w kolumnie email
-- oraz display_name = NULL (a nie UUID) dla kont bez imienia.
--
-- SELECT * FROM member_emails ORDER BY organization_id;
