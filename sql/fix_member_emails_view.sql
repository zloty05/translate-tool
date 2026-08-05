-- ══════════════════════════════════════════════════════════════════
-- ARCHIWUM — migracja sprzed wprowadzenia Supabase CLI.
-- Została już zastosowana na produkcji, a jej efekt jest zawarty
-- w zrzucie schematu supabase/migrations/*_remote_schema.sql.
-- NIE uruchamiaj ponownie. Nowe migracje: supabase migration new <nazwa>
-- ══════════════════════════════════════════════════════════════════
--
-- Naprawa widoku member_emails — nazwy członków zespołu
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
--
-- UWAGA — security_invoker NIE działa tutaj:
--   auth.users jest niedostępna dla roli `authenticated`, więc widok
--   z security_invoker zwraca NULL w email i display_name dla WSZYSTKICH
--   (regresja: nawet konta, które wcześniej miały nazwy z profiles).
--   Dlatego widok jest SECURITY DEFINER (domyślne dla widoków w PG),
--   a izolację między organizacjami wymusza filtr WHERE poniżej —
--   ten sam wzorzec co RPC w dict_approval_workflow.sql.
-- ══════════════════════════════════════════════════════════════════

-- DROP jest konieczny: CREATE OR REPLACE VIEW nie zmienia opcji
-- security_invoker ustawionej przy poprzednim uruchomieniu.
DROP VIEW IF EXISTS public.member_emails;

CREATE VIEW public.member_emails AS
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
LEFT JOIN auth.users u      ON u.id = om.user_id
-- Izolacja tenantów: widać wyłącznie członków własnych organizacji.
WHERE om.organization_id IN (
  SELECT organization_id
  FROM public.organization_members
  WHERE user_id = auth.uid()
);

GRANT SELECT ON public.member_emails TO authenticated;

-- ── Weryfikacja ────────────────────────────────────────────────────
-- Uruchom jako zalogowany użytkownik aplikacji (nie w SQL Editorze —
-- tam auth.uid() jest NULL, więc wynik będzie pusty; to poprawne).
--
-- W SQL Editorze sprawdź same dane źródłowe:
--   SELECT om.organization_id, u.email,
--          u.raw_user_meta_data->>'full_name' AS meta_name,
--          p.full_name AS profile_name
--   FROM organization_members om
--   LEFT JOIN auth.users u ON u.id = om.user_id
--   LEFT JOIN profiles p   ON p.id = om.user_id;
--
-- W aplikacji: zakładka Zespół pokazuje e-mail (lub imię, jeśli ustawione).
