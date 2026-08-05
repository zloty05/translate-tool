-- ══════════════════════════════════════════════════════════════════
-- Słownik w multitenancie: konfigurowalne języki per organizacja
-- Uruchom JEDNORAZOWO w Supabase → SQL Editor.
--
-- Do tej pory zestaw języków słownika był zaszyty we frontendzie
-- (PRIMARY w js/03-languages.js), a język źródłowy ograniczony do
-- pary PL/EN. Ta migracja przenosi konfigurację do bazy, per org.
--
-- WAŻNE: skrypt jest idempotentny i nie usuwa żadnych danych.
-- Backfill liczy języki z FAKTYCZNEJ zawartości bazy, żeby żadne
-- istniejące tłumaczenie nie zniknęło z widoku.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Nowe kolumny konfiguracyjne w organizations ─────────────────
-- dict_langs     — języki docelowe słownika (kody = LANGS[].code, np. 'Lithuanian')
-- dict_base_lang — język, w którym zapisany jest termin w dictionary.src
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS dict_langs text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS dict_base_lang text NOT NULL DEFAULT 'Polish';

-- ── 2. Normalizacja języka bazowego ────────────────────────────────
-- Musi wykonać się PRZED backfillem — backfill wyklucza język bazowy
-- ze zbioru języków docelowych (jego termin mieszka w dictionary.src).
UPDATE public.organizations
SET dict_base_lang = 'Polish'
WHERE dict_base_lang IS NULL OR dict_base_lang = '';

-- ── 3. Backfill dict_langs — suma zbiorów z realnych danych ─────────
-- Suma (nie przecięcie): klucze z dictionary.translations
--                      ∪ organization_members.languages
--                      ∪ dotychczasowa ósemka PRIMARY (fallback).
-- Kolejność: najpierw ósemka PRIMARY (stabilny układ kolumn w tabeli),
-- potem języki dodatkowe znalezione w danych — alfabetycznie.
WITH primary_langs AS (
  SELECT * FROM unnest(ARRAY[
    'English','Lithuanian','Latvian','Estonian',
    'Ukrainian','Hungarian','Czech','Slovak'
  ]) WITH ORDINALITY AS t(lang, ord)
),
-- języki faktycznie występujące w słowniku danej org
dict_used AS (
  SELECT DISTINCT d.organization_id, k.key AS lang
  FROM public.dictionary d
  CROSS JOIN LATERAL jsonb_object_keys(d.translations) AS k(key)
  WHERE d.translations <> '{}'::jsonb
),
-- języki przypisane członkom danej org
member_used AS (
  SELECT DISTINCT m.organization_id, l AS lang
  FROM public.organization_members m
  CROSS JOIN LATERAL unnest(COALESCE(m.languages, '{}'::text[])) AS l
),
-- suma per org: wszystkie języki z danych + cała ósemka fallbacku
all_langs AS (
  SELECT o.id AS organization_id, u.lang
  FROM public.organizations o
  CROSS JOIN LATERAL (
    SELECT lang FROM primary_langs
    UNION
    SELECT lang FROM dict_used   WHERE organization_id = o.id
    UNION
    SELECT lang FROM member_used WHERE organization_id = o.id
  ) u
  WHERE o.dict_langs = '{}'::text[]
),
ordered AS (
  SELECT a.organization_id,
         a.lang,
         COALESCE(p.ord, 1000) AS ord   -- ósemka PRIMARY zachowuje kolejność, reszta na koniec
  FROM all_langs a
  JOIN public.organizations o2 ON o2.id = a.organization_id
  LEFT JOIN primary_langs p ON p.lang = a.lang
  WHERE a.lang <> o2.dict_base_lang     -- język bazowy nie jest kolumną docelową
)
UPDATE public.organizations o
SET dict_langs = sub.langs
FROM (
  SELECT organization_id,
         array_agg(lang ORDER BY ord, lang) AS langs
  FROM ordered
  GROUP BY organization_id
) sub
WHERE o.id = sub.organization_id
  AND o.dict_langs = '{}'::text[];

-- ── 4. Materializacja dict_source_map ──────────────────────────────
-- Dotychczas frontend liczył źródło fallbackiem (js/11-dict.js:18-22):
--   English            → zawsze z Polish
--   pozostałe          → English jeśli termin ma EN, inaczej Polish
-- Po zmianie fallbackiem jest język bazowy, więc dotychczasowe
-- zachowanie trzeba ZAPISAĆ JAWNIE, inaczej istniejącym organizacjom
-- po cichu przestawiłyby się źródła tłumaczeń.
-- Wpisy już obecne w mapie pozostają nietknięte.
-- Dotyczy wyłącznie organizacji z bazą 'Polish' (czyli wszystkich sprzed
-- tej migracji) — tylko tam obowiązywał fallback PL/EN. Nowe organizacje
-- z inną bazą startują z pustą mapą, czyli „wszystko z języka bazowego".
WITH org_has_en AS (
  SELECT o.id AS organization_id,
         EXISTS (
           SELECT 1 FROM public.dictionary d
           WHERE d.organization_id = o.id
             AND d.translations ? 'English'
         ) AS has_en
  FROM public.organizations o
),
new_entries AS (
  SELECT o.id AS organization_id,
         jsonb_object_agg(
           l.lang,
           CASE
             WHEN l.lang = 'English' THEN 'Polish'      -- twarda reguła sprzed migracji
             WHEN h.has_en           THEN 'English'     -- fallback "EN jeśli dostępne"
             ELSE o.dict_base_lang
           END
         ) AS entries
  FROM public.organizations o
  JOIN org_has_en h ON h.organization_id = o.id
  CROSS JOIN LATERAL unnest(o.dict_langs) AS l(lang)
  WHERE o.dict_base_lang = 'Polish'
    AND l.lang <> o.dict_base_lang                                -- brak samoodniesień
    AND NOT (COALESCE(o.dict_source_map, '{}'::jsonb) ? l.lang)   -- tylko brakujące
  GROUP BY o.id, o.dict_base_lang
)
UPDATE public.organizations o
SET dict_source_map = COALESCE(o.dict_source_map, '{}'::jsonb) || n.entries
FROM new_entries n
WHERE o.id = n.organization_id;

-- Bezpiecznik: usuń z mapy wpisy wskazujące na język spoza konfiguracji
-- (np. pozostałości po ręcznych zmianach) oraz samoodniesienia.
UPDATE public.organizations o
SET dict_source_map = (
  SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
  FROM jsonb_each_text(o.dict_source_map) AS e(key, value)
  WHERE e.key = ANY(o.dict_langs)
    AND e.key <> e.value
    AND (e.value = o.dict_base_lang OR e.value = ANY(o.dict_langs))
)
WHERE o.dict_source_map <> '{}'::jsonb;

-- ══════════════════════════════════════════════════════════════════
-- 5. RPC: save_org_dict_config
-- Atomowy zapis całej konfiguracji słownika organizacji.
-- Przez REST/dbPatch się nie da — RLS na organizations potrafi po cichu
-- nie zapisać nic (HTTP 204 bez błędu). Stąd SECURITY DEFINER.
--
-- Waliduje komplet niezmienników, bo jest wołana wprost z frontendu:
--   • wywołujący to admin tej org
--   • nie można usunąć języka, w którym istnieją tłumaczenia
--   • język bazowy nie jest jednocześnie docelowym
--   • mapa źródeł mieści się w zbiorze langs ∪ {base_lang}
--   • brak samoodniesień i brak cykli w grafie źródeł
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.save_org_dict_config(
  org_id     uuid,
  langs      text[],
  base_lang  text,
  source_map jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role      text;
  v_orphaned  text[];
  v_bad       text[];
  v_lang      text;
  v_cur       text;
  v_steps     int;
  v_max       int;
  v_row       public.organizations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT role INTO v_role
  FROM public.organization_members
  WHERE organization_id = org_id AND user_id = auth.uid();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Not a member of this organization';
  END IF;
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'Only an admin can change dictionary configuration';
  END IF;

  IF base_lang IS NULL OR base_lang = '' THEN
    RAISE EXCEPTION 'Base language is required';
  END IF;
  IF langs IS NULL OR array_length(langs, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one target language is required';
  END IF;
  IF base_lang = ANY(langs) THEN
    RAISE EXCEPTION 'Base language % cannot also be a target language', base_lang;
  END IF;

  -- ── Ochrona danych: język z tłumaczeniami nie może zniknąć ───────
  -- Wyjątek: nowy język bazowy. Jego tłumaczenia zostają w translations
  -- (nic nie tracimy), a kolumną źródłową staje się dictionary.src.
  -- Frontend ostrzega o tym osobnym confirm-em przed zapisem.
  SELECT array_agg(DISTINCT k.key ORDER BY k.key) INTO v_orphaned
  FROM public.dictionary d
  CROSS JOIN LATERAL jsonb_object_keys(d.translations) AS k(key)
  WHERE d.organization_id = org_id
    AND NOT (k.key = ANY(langs))
    AND k.key <> base_lang
    AND NULLIF(TRIM(d.translations ->> k.key), '') IS NOT NULL;  -- puste wpisy nie blokują

  IF v_orphaned IS NOT NULL AND array_length(v_orphaned, 1) > 0 THEN
    RAISE EXCEPTION 'Cannot remove languages with existing translations: %',
      array_to_string(v_orphaned, ', ');
  END IF;

  -- ── Spójność mapy źródeł ─────────────────────────────────────────
  SELECT array_agg(e.key ORDER BY e.key) INTO v_bad
  FROM jsonb_each_text(COALESCE(source_map, '{}'::jsonb)) AS e(key, value)
  WHERE NOT (e.key = ANY(langs))
     OR NOT (e.value = base_lang OR e.value = ANY(langs));

  IF v_bad IS NOT NULL AND array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION 'Source map references unknown languages: %',
      array_to_string(v_bad, ', ');
  END IF;

  SELECT array_agg(e.key ORDER BY e.key) INTO v_bad
  FROM jsonb_each_text(COALESCE(source_map, '{}'::jsonb)) AS e(key, value)
  WHERE e.key = e.value;

  IF v_bad IS NOT NULL AND array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION 'Language cannot be its own source: %',
      array_to_string(v_bad, ', ');
  END IF;

  -- ── Brak cykli: każda ścieżka musi dojść do języka bazowego ──────
  -- Idziemy po krawędziach od każdego celu; więcej kroków niż języków
  -- oznacza, że kręcimy się w kółko.
  v_max := array_length(langs, 1) + 1;
  FOREACH v_lang IN ARRAY langs LOOP
    v_cur   := v_lang;
    v_steps := 0;
    LOOP
      v_cur := COALESCE(source_map ->> v_cur, base_lang);
      EXIT WHEN v_cur = base_lang;
      v_steps := v_steps + 1;
      IF v_steps > v_max THEN
        RAISE EXCEPTION 'Cycle detected in dictionary source map (starting at %)', v_lang;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.organizations
  SET dict_langs      = langs,
      dict_base_lang  = base_lang,
      dict_source_map = COALESCE(source_map, '{}'::jsonb)
  WHERE id = org_id
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

-- ══════════════════════════════════════════════════════════════════
-- 6. save_dict_translation — dołożona walidacja zbioru języków
-- Reszta logiki bez zmian względem sql/dict_approval_workflow.sql:
-- merge translations || jsonb_build_object(...) nie rusza sąsiadów.
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
  v_dict_langs text[];
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

  -- język musi należeć do konfiguracji słownika tej org
  SELECT dict_langs INTO v_dict_langs
  FROM public.organizations WHERE id = v_org_id;

  IF v_dict_langs IS NOT NULL
     AND array_length(v_dict_langs, 1) IS NOT NULL
     AND NOT (lang = ANY(v_dict_langs)) THEN
    RAISE EXCEPTION 'Language % is not configured for this organization', lang;
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
-- 7. ZAPYTANIA KONTROLNE — uruchom po migracji.
-- OBA (7a i 7b) MUSZĄ ZWRÓCIĆ 0 WIERSZY.
-- ══════════════════════════════════════════════════════════════════

-- 7a. Czy jakieś istniejące tłumaczenie wypadło poza konfigurację?
--     (test ochrony danych — 0 wierszy = nic nie zniknęło z widoku)
--
-- SELECT o.name, k.key AS orphaned_lang, count(*) AS entries
-- FROM public.dictionary d
-- JOIN public.organizations o ON o.id = d.organization_id
-- CROSS JOIN LATERAL jsonb_object_keys(d.translations) AS k(key)
-- WHERE NOT (k.key = ANY(o.dict_langs))
--   AND k.key <> o.dict_base_lang
--   AND NULLIF(TRIM(d.translations ->> k.key), '') IS NOT NULL
-- GROUP BY o.name, k.key
-- ORDER BY o.name, k.key;

-- 7b. Czy mapa źródeł jest spójna z konfiguracją języków?
--
-- SELECT o.name, e.key AS target_lang, e.value AS source_lang
-- FROM public.organizations o
-- CROSS JOIN LATERAL jsonb_each_text(o.dict_source_map) AS e(key, value)
-- WHERE NOT (e.key = ANY(o.dict_langs))
--    OR NOT (e.value = o.dict_base_lang OR e.value = ANY(o.dict_langs))
--    OR e.key = e.value;

-- 7c. Podgląd wynikowej konfiguracji (informacyjnie):
--
-- SELECT name, dict_base_lang, dict_langs, dict_source_map
-- FROM public.organizations ORDER BY name;

-- 7d. Języki obecne w danych, ale spoza ósemki PRIMARY — informacyjnie,
--     pokazuje co backfill dociągnął z realnej zawartości bazy:
--
-- SELECT o.name, k.key AS lang, count(*) AS entries
-- FROM public.dictionary d
-- JOIN public.organizations o ON o.id = d.organization_id
-- CROSS JOIN LATERAL jsonb_object_keys(d.translations) AS k(key)
-- WHERE NOT (k.key = ANY(ARRAY['English','Lithuanian','Latvian','Estonian',
--                              'Ukrainian','Hungarian','Czech','Slovak']))
-- GROUP BY o.name, k.key ORDER BY o.name, k.key;
