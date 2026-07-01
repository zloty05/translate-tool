-- ══════════════════════════════════════════════════════════════════
-- Słownik: przepływ akceptacji per język (admin ↔ translator)
-- Uruchom JEDNORAZOWO w Supabase → SQL Editor.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Kolumna status (JSONB) w dictionary ─────────────────────────
-- Klucz = kod języka (np. "English"), wartość = 'ai' | 'accepted'.
ALTER TABLE public.dictionary
  ADD COLUMN IF NOT EXISTS status jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Backfill: istniejące, niepuste tłumaczenia = 'accepted'
-- (pochodzą z dotychczasowego, ręcznie zweryfikowanego słownika).
UPDATE public.dictionary d
SET status = sub.st
FROM (
  SELECT id, jsonb_object_agg(key, 'accepted') AS st
  FROM public.dictionary, jsonb_each_text(translations)
  WHERE translations <> '{}'::jsonb
  GROUP BY id
) sub
WHERE d.id = sub.id
  AND d.status = '{}'::jsonb;

-- ── 2. Mapa źródeł per język docelowy (config org) ─────────────────
-- Np. { "Lithuanian":"Polish", "Latvian":"English", ... }
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS dict_source_map jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ══════════════════════════════════════════════════════════════════
-- 3. RPC: save_dict_translation
-- Zapis pojedynczego tłumaczenia słownika z walidacją uprawnień.
-- Translator może zapisać tylko język przypisany w organization_members.languages.
-- Admin może zapisać dowolny język swojej org.
-- Zapisuje TYLKO klucz [lang] (merge), nie nadpisuje całego JSONB.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.save_dict_translation(
  dict_id       uuid,
  lang          text,
  new_text      text,
  mark_accepted boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id     uuid;
  v_role       text;
  v_langs      text[];
  v_new_status text;
  v_row        public.dictionary%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- org danego wpisu słownika
  SELECT organization_id INTO v_org_id
  FROM public.dictionary WHERE id = dict_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Dictionary entry not found';
  END IF;

  -- rola + przypisane języki wywołującego w tej org
  -- (organization_members.languages jest typu text[])
  SELECT role, COALESCE(languages, '{}'::text[])
    INTO v_role, v_langs
  FROM public.organization_members
  WHERE organization_id = v_org_id AND user_id = auth.uid();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Not a member of this organization';
  END IF;

  IF v_role = 'viewer' THEN
    RAISE EXCEPTION 'Viewer cannot edit dictionary';
  END IF;

  -- translator: tylko przypisany język
  IF v_role = 'translator' AND NOT (lang = ANY(v_langs)) THEN
    RAISE EXCEPTION 'Language % not assigned to this translator', lang;
  END IF;

  -- nowy status dla tego języka
  IF mark_accepted THEN
    v_new_status := 'accepted';
  ELSE
    -- edycja bez akceptacji: 'ai' jeśli nie było, w innym wypadku zostaw
    SELECT COALESCE(status ->> lang, 'ai') INTO v_new_status
    FROM public.dictionary WHERE id = dict_id;
  END IF;

  UPDATE public.dictionary
  SET translations = translations || jsonb_build_object(lang, new_text),
      status       = status       || jsonb_build_object(lang, v_new_status)
  WHERE id = dict_id
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

-- ══════════════════════════════════════════════════════════════════
-- 4. RPC: notify_translators
-- Powiadomienie dla członków org, którzy mają dany język w languages.
-- Wzorowane na notify_admins.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.notify_translators(
  org_id        uuid,
  target_lang   text,
  notif_type    text,
  notif_title   text,
  notif_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message)
  SELECT m.user_id, notif_type, notif_title, notif_message
  FROM public.organization_members m
  WHERE m.organization_id = org_id
    AND m.role = 'translator'
    AND target_lang = ANY(COALESCE(m.languages, '{}'::text[]));
END;
$$;
