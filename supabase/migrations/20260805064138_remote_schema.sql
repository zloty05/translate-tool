


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."add_org_admin"("org_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  insert into organization_members (organization_id, user_id, role)
  values (org_id, auth.uid(), 'admin');
end;
$$;


ALTER FUNCTION "public"."add_org_admin"("org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_tokens"("org_id" "uuid", "amount" integer, "desc_text" "text", "session_id" "text" DEFAULT NULL::"text", "payment_intent" "text" DEFAULT NULL::"text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_balance integer;
  new_balance integer;
begin
  select tokens_balance into current_balance
  from organizations
  where id = org_id
  for update;

  new_balance := coalesce(current_balance, 0) + amount;

  update organizations set tokens_balance = new_balance where id = org_id;

  insert into token_transactions (organization_id, user_id, type, tokens, balance_after, description, stripe_session_id, stripe_payment_intent)
  values (org_id, auth.uid(), 'purchase', amount, new_balance, desc_text, session_id, payment_intent);

  return json_build_object('success', true, 'balance_after', new_balance);
end;
$$;


ALTER FUNCTION "public"."add_tokens"("org_id" "uuid", "amount" integer, "desc_text" "text", "session_id" "text", "payment_intent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_user"("target_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_org_id      uuid;
  v_admin_count int;
BEGIN
  -- Ta funkcja wywoływana jest z service_role przez Cloudflare Function,
  -- więc auth.uid() będzie NULL — nie walidujemy przez auth.uid()

  FOR v_org_id IN
    SELECT organization_id
    FROM organization_members
    WHERE user_id = target_user_id AND role = 'admin'
  LOOP
    SELECT COUNT(*) INTO v_admin_count
    FROM organization_members
    WHERE organization_id = v_org_id AND role = 'admin';

    IF v_admin_count = 1 THEN
      DELETE FROM organizations WHERE id = v_org_id;
    ELSE
      DELETE FROM organization_members
      WHERE organization_id = v_org_id AND user_id = target_user_id;
    END IF;
  END LOOP;

  DELETE FROM organization_members WHERE user_id = target_user_id;

  UPDATE invitations                  SET invited_by        = NULL WHERE invited_by        = target_user_id;
  UPDATE project_language_assignments SET approved_by       = NULL WHERE approved_by       = target_user_id;
  UPDATE project_language_assignments SET assigned_user_id  = NULL WHERE assigned_user_id  = target_user_id;
  UPDATE projects                     SET created_by        = NULL WHERE created_by        = target_user_id;
  UPDATE token_transactions           SET user_id           = NULL WHERE user_id           = target_user_id;
  UPDATE translation_history          SET user_id           = NULL WHERE user_id           = target_user_id;

  DELETE FROM profiles   WHERE id = target_user_id;
  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$;


ALTER FUNCTION "public"."admin_delete_user"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_org_record"("org_name" "text", "org_slug" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  new_id uuid;
begin
  if exists(select 1 from organizations where slug = org_slug) then
    raise exception 'Identyfikator "%" jest już zajęty.', org_slug;
  end if;
  insert into organizations (name, slug)
  values (org_name, org_slug)
  returning id into new_id;
  return new_id;
end;
$$;


ALTER FUNCTION "public"."create_org_record"("org_name" "text", "org_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_lang_assignment"("assignment_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT p.organization_id INTO v_org_id
  FROM project_language_assignments pla
  JOIN projects p ON p.id = pla.project_id
  WHERE pla.id = assignment_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = v_org_id
      AND user_id = auth.uid()
      AND role IN ('admin', 'translator')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  DELETE FROM project_language_assignments WHERE id = assignment_id;
END;
$$;


ALTER FUNCTION "public"."delete_lang_assignment"("assignment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_user"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid         uuid;
  v_org_id      uuid;
  v_admin_count int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Dla każdej org gdzie user jest adminem
  FOR v_org_id IN
    SELECT organization_id
    FROM organization_members
    WHERE user_id = v_uid AND role = 'admin'
  LOOP
    SELECT COUNT(*) INTO v_admin_count
    FROM organization_members
    WHERE organization_id = v_org_id AND role = 'admin';

    IF v_admin_count = 1 THEN
      -- Jedyny admin — kasuj całą org (CASCADE usuwa projekty, segmenty, TM, słownik itd.)
      DELETE FROM organizations WHERE id = v_org_id;
    ELSE
      -- Są inni adminowie — tylko wypisz usera z org
      DELETE FROM organization_members
      WHERE organization_id = v_org_id AND user_id = v_uid;
    END IF;
  END LOOP;

  -- Wypisz z org gdzie user był translator/viewer (nieskasowane przez CASCADE wyżej)
  DELETE FROM organization_members WHERE user_id = v_uid;

  -- Wyzeruj FK w tabelach z NO ACTION (żeby DELETE auth.users nie rzucił błędu)
  UPDATE invitations                 SET invited_by      = NULL WHERE invited_by      = v_uid;
  UPDATE project_language_assignments SET approved_by    = NULL WHERE approved_by    = v_uid;
  UPDATE project_language_assignments SET assigned_user_id = NULL WHERE assigned_user_id = v_uid;
  UPDATE projects                    SET created_by      = NULL WHERE created_by      = v_uid;
  UPDATE token_transactions          SET user_id         = NULL WHERE user_id         = v_uid;
  UPDATE translation_history         SET user_id         = NULL WHERE user_id         = v_uid;

  -- Profil i konto
  DELETE FROM profiles   WHERE id = v_uid;
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;


ALTER FUNCTION "public"."delete_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_org_id"() RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  select organization_id from organization_members
  where user_id = auth.uid()
  limit 1;
$$;


ALTER FUNCTION "public"."get_my_org_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_role"() RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  select role from organization_members
  where user_id = auth.uid()
  limit 1;
$$;


ALTER FUNCTION "public"."get_my_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tm_stats"("org_id" "uuid") RETURNS json
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select json_build_object(
    'total', count(*),
    'langs', count(distinct lang),
    'langs_list', array_agg(distinct lang order by lang)
  )
  from translation_memory
  where organization_id = org_id;
$$;


ALTER FUNCTION "public"."get_tm_stats"("org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_org_id"("uid" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select organization_id from organization_members
  where user_id = uid
  limit 1;
$$;


ALTER FUNCTION "public"."get_user_org_id"("uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_role_in_org"("uid" "uuid", "oid" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role from organization_members
  where user_id = uid and organization_id = oid
  limit 1;
$$;


ALTER FUNCTION "public"."get_user_role_in_org"("uid" "uuid", "oid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', '')
  )
  on conflict (id) do nothing;
  return new;
exception
  when others then
    -- Nie blokuj rejestracji nawet jeśli profil się nie zapisze
    return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_admin"("uid" "uuid", "oid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists(
    select 1 from organization_members
    where user_id = uid and organization_id = oid and role = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_org_admin"("uid" "uuid", "oid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_member"("uid" "uuid", "oid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists(
    select 1 from organization_members
    where user_id = uid and organization_id = oid
  );
$$;


ALTER FUNCTION "public"."is_org_member"("uid" "uuid", "oid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_tm_batch"("org_id" "uuid", "source_keys" "text"[], "target_lang" "text") RETURNS TABLE("key" "text", "target" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select tm.key, tm.target
  from translation_memory tm
  where tm.organization_id = org_id
    and tm.lang = target_lang
    and tm.key = any(source_keys);
$$;


ALTER FUNCTION "public"."lookup_tm_batch"("org_id" "uuid", "source_keys" "text"[], "target_lang" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_admins"("org_id" "uuid", "notif_type" "text", "notif_title" "text", "notif_message" "text", "proj_id" "uuid" DEFAULT NULL::"uuid", "lang" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into notifications (organization_id, user_id, type, title, message, link_project_id, link_lang)
  select org_id, om.user_id, notif_type, notif_title, notif_message, proj_id, lang
  from organization_members om
  where om.organization_id = org_id
    and om.role = 'admin';
end;
$$;


ALTER FUNCTION "public"."notify_admins"("org_id" "uuid", "notif_type" "text", "notif_title" "text", "notif_message" "text", "proj_id" "uuid", "lang" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_translators"("org_id" "uuid", "target_lang" "text", "notif_type" "text", "notif_title" "text", "notif_message" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."notify_translators"("org_id" "uuid", "target_lang" "text", "notif_type" "text", "notif_title" "text", "notif_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reset_monthly_tokens"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update organization_members
  set tokens_used_this_month = 0,
      tokens_reset_at = date_trunc('month', now()) + interval '1 month'
  where tokens_reset_at <= now();
end;
$$;


ALTER FUNCTION "public"."reset_monthly_tokens"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_dict_translation"("dict_id" "uuid", "lang" "text", "new_text" "text", "mark_accepted" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."save_dict_translation"("dict_id" "uuid", "lang" "text", "new_text" "text", "mark_accepted" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_segment_translation"("seg_id" "uuid", "lang" "text", "new_text" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  seg project_segments;
  old_text text;
  new_translations jsonb;
begin
  select * into seg from project_segments where id = seg_id;
  if not found then raise exception 'Segment nie istnieje.'; end if;

  -- Pobierz stary tekst
  old_text := seg.translations->lang->>'text';

  -- Zaktualizuj tłumaczenie
  new_translations := coalesce(seg.translations, '{}'::jsonb) || jsonb_build_object(
    lang, jsonb_build_object(
      'text', new_text,
      'status', case when new_text = '' then 'empty' else 'translated' end,
      'updated_by', auth.uid()::text,
      'updated_at', now()::text
    )
  );

  update project_segments
  set translations = new_translations, updated_at = now()
  where id = seg_id;

  -- Zapisz historię jeśli zmiana
  if old_text is distinct from new_text then
    insert into segment_history (segment_id, lang, old_text, new_text, changed_by)
    values (seg_id, lang, old_text, new_text, auth.uid());
  end if;

  return json_build_object('success', true, 'segment_id', seg_id, 'lang', lang);
end;
$$;


ALTER FUNCTION "public"."save_segment_translation"("seg_id" "uuid", "lang" "text", "new_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin new.updated_at = now(); return new; end;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."use_tokens"("org_id" "uuid", "amount" integer, "desc_text" "text", "meta" "jsonb" DEFAULT '{}'::"jsonb") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_balance integer;
  new_balance integer;
  tx token_transactions;
begin
  -- Lock row dla atomowości
  select tokens_balance into current_balance
  from organizations
  where id = org_id
  for update;

  if current_balance is null then
    raise exception 'Organizacja nie istnieje.';
  end if;

  if current_balance < amount then
    raise exception 'Niewystarczające saldo tokenów. Masz %, potrzebujesz %.', current_balance, amount;
  end if;

  new_balance := current_balance - amount;

  -- Zaktualizuj saldo
  update organizations set tokens_balance = new_balance where id = org_id;

  -- Zapisz transakcję
  insert into token_transactions (organization_id, user_id, type, tokens, balance_after, description, metadata)
  values (org_id, auth.uid(), 'usage', -amount, new_balance, desc_text, meta)
  returning * into tx;

  return json_build_object(
    'success', true,
    'balance_before', current_balance,
    'balance_after', new_balance,
    'tokens_used', amount
  );
end;
$$;


ALTER FUNCTION "public"."use_tokens"("org_id" "uuid", "amount" integer, "desc_text" "text", "meta" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."use_tokens_member"("org_id" "uuid", "amount" integer, "desc_text" "text", "meta" "jsonb" DEFAULT '{}'::"jsonb") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  member_row organization_members;
  org_balance integer;
  new_org_balance integer;
  new_used integer;
begin
  -- Reset miesięczny jeśli potrzeba
  perform reset_monthly_tokens();

  -- Pobierz dane członka
  select * into member_row
  from organization_members
  where user_id = auth.uid() and organization_id = org_id;

  if not found then
    raise exception 'Nie jesteś członkiem tej organizacji.';
  end if;

  -- Sprawdź limit miesięczny (jeśli ustawiony)
  if member_row.monthly_token_limit is not null then
    if member_row.tokens_used_this_month + amount > member_row.monthly_token_limit then
      raise exception 'Przekroczono miesięczny limit tokenów (% / %). Skontaktuj się z administratorem.',
        member_row.tokens_used_this_month, member_row.monthly_token_limit;
    end if;
  end if;

  -- Sprawdź saldo organizacji
  select tokens_balance into org_balance
  from organizations where id = org_id for update;

  if org_balance < amount then
    raise exception 'Niewystarczające saldo tokenów organizacji (% dostępnych, % wymaganych).',
      org_balance, amount;
  end if;

  -- Odejmij z salda org
  new_org_balance := org_balance - amount;
  update organizations set tokens_balance = new_org_balance where id = org_id;

  -- Zwiększ licznik tłumacza
  new_used := member_row.tokens_used_this_month + amount;
  update organization_members
  set tokens_used_this_month = new_used
  where user_id = auth.uid() and organization_id = org_id;

  -- Zapisz transakcję
  insert into token_transactions (organization_id, user_id, type, tokens, balance_after, description, metadata)
  values (org_id, auth.uid(), 'usage', -amount, new_org_balance, desc_text, meta);

  return json_build_object(
    'success', true,
    'balance_after', new_org_balance,
    'tokens_used', amount,
    'monthly_used', new_used,
    'monthly_limit', member_row.monthly_token_limit
  );
end;
$$;


ALTER FUNCTION "public"."use_tokens_member"("org_id" "uuid", "amount" integer, "desc_text" "text", "meta" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."dictionary" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "src" "text" NOT NULL,
    "note" "text" DEFAULT ''::"text",
    "translations" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "organization_id" "uuid",
    "status" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."dictionary" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" DEFAULT 'translator'::"text",
    "token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(32), 'hex'::"text") NOT NULL,
    "invited_by" "uuid",
    "accepted_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval),
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "invitations_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'translator'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'translator'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "languages" "text"[] DEFAULT '{}'::"text"[],
    "monthly_token_limit" integer,
    "tokens_used_this_month" integer DEFAULT 0,
    "tokens_reset_at" timestamp with time zone DEFAULT ("date_trunc"('month'::"text", "now"()) + '1 mon'::interval),
    CONSTRAINT "organization_members_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'translator'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."organization_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."member_emails" AS
 SELECT "om"."organization_id",
    "om"."user_id",
    COALESCE(NULLIF("p"."full_name", ''::"text"), NULLIF(("u"."raw_user_meta_data" ->> 'full_name'::"text"), ''::"text")) AS "display_name",
    ("u"."email")::"text" AS "email"
   FROM (("public"."organization_members" "om"
     LEFT JOIN "public"."profiles" "p" ON (("p"."id" = "om"."user_id")))
     LEFT JOIN "auth"."users" "u" ON (("u"."id" = "om"."user_id")))
  WHERE ("om"."organization_id" IN ( SELECT "organization_members"."organization_id"
           FROM "public"."organization_members"
          WHERE ("organization_members"."user_id" = "auth"."uid"())));


ALTER VIEW "public"."member_emails" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text",
    "link_project_id" "uuid",
    "link_lang" "text",
    "is_read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "notifications_type_check" CHECK (("type" = ANY (ARRAY['lang_ready'::"text", 'tokens_low'::"text", 'project_created'::"text", 'project_done'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "plan" "text" DEFAULT 'free'::"text",
    "tokens_balance" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "dict_source_map" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "organizations_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'pro'::"text", 'enterprise'::"text"])))
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_language_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "lang" "text" NOT NULL,
    "assigned_user_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text",
    "ai_translated_at" timestamp with time zone,
    "submitted_at" timestamp with time zone,
    "approved_at" timestamp with time zone,
    "approved_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "project_language_assignments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'ready'::"text", 'approved'::"text"])))
);


ALTER TABLE "public"."project_language_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_segments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "segment_key" "text" NOT NULL,
    "source_text" "text" NOT NULL,
    "translations" "jsonb" DEFAULT '{}'::"jsonb",
    "segment_order" integer DEFAULT 0,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "ai_translation" "text",
    "manually_edited" boolean DEFAULT false
);


ALTER TABLE "public"."project_segments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text",
    "source_lang" "text" DEFAULT 'English'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text",
    "file_type" "text",
    "original_filename" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "original_file_path" "text",
    CONSTRAINT "projects_file_type_check" CHECK (("file_type" = ANY (ARRAY['xliff'::"text", 'pptx'::"text"]))),
    CONSTRAINT "projects_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'completed'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."segment_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "segment_id" "uuid" NOT NULL,
    "lang" "text" NOT NULL,
    "old_text" "text",
    "new_text" "text",
    "changed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."segment_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."token_packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "stripe_price_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "tokens" integer NOT NULL,
    "price_pln" numeric(10,2) NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."token_packages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."token_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "type" "text" NOT NULL,
    "tokens" integer NOT NULL,
    "balance_after" integer NOT NULL,
    "description" "text",
    "stripe_session_id" "text",
    "stripe_payment_intent" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "token_transactions_type_check" CHECK (("type" = ANY (ARRAY['purchase'::"text", 'usage'::"text", 'bonus'::"text", 'refund'::"text"])))
);


ALTER TABLE "public"."token_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."translation_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "filename" "text" NOT NULL,
    "filetype" "text" NOT NULL,
    "lang" "text" NOT NULL,
    "segments_total" integer DEFAULT 0,
    "segments_done" integer DEFAULT 0,
    "segments_from_tm" integer DEFAULT 0,
    "cost_usd" numeric(10,6) DEFAULT 0,
    "cost_pln" numeric(10,4) DEFAULT 0,
    "status" "text" DEFAULT 'in_progress'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "organization_id" "uuid",
    "user_id" "uuid",
    CONSTRAINT "translation_history_filetype_check" CHECK (("filetype" = ANY (ARRAY['xliff'::"text", 'pptx'::"text"]))),
    CONSTRAINT "translation_history_status_check" CHECK (("status" = ANY (ARRAY['in_progress'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."translation_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."translation_memory" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "source" "text" NOT NULL,
    "target" "text" NOT NULL,
    "lang" "text" NOT NULL,
    "src" "text" DEFAULT 'xliff'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "organization_id" "uuid"
);


ALTER TABLE "public"."translation_memory" OWNER TO "postgres";


ALTER TABLE ONLY "public"."dictionary"
    ADD CONSTRAINT "dictionary_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_organization_id_user_id_key" UNIQUE ("organization_id", "user_id");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_language_assignments"
    ADD CONSTRAINT "project_language_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_language_assignments"
    ADD CONSTRAINT "project_language_assignments_project_id_lang_key" UNIQUE ("project_id", "lang");



ALTER TABLE ONLY "public"."project_segments"
    ADD CONSTRAINT "project_segments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_segments"
    ADD CONSTRAINT "project_segments_project_id_segment_key_key" UNIQUE ("project_id", "segment_key");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."segment_history"
    ADD CONSTRAINT "segment_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."token_packages"
    ADD CONSTRAINT "token_packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."token_packages"
    ADD CONSTRAINT "token_packages_stripe_price_id_key" UNIQUE ("stripe_price_id");



ALTER TABLE ONLY "public"."token_transactions"
    ADD CONSTRAINT "token_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."translation_history"
    ADD CONSTRAINT "translation_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."translation_memory"
    ADD CONSTRAINT "translation_memory_key_lang_org_key" UNIQUE ("key", "lang", "organization_id");



ALTER TABLE ONLY "public"."translation_memory"
    ADD CONSTRAINT "translation_memory_pkey" PRIMARY KEY ("id");



CREATE INDEX "assignments_project" ON "public"."project_language_assignments" USING "btree" ("project_id");



CREATE INDEX "assignments_user" ON "public"."project_language_assignments" USING "btree" ("assigned_user_id");



CREATE INDEX "dict_org" ON "public"."dictionary" USING "btree" ("organization_id");



CREATE INDEX "dict_src" ON "public"."dictionary" USING "btree" ("src");



CREATE INDEX "history_created" ON "public"."translation_history" USING "btree" ("created_at" DESC);



CREATE INDEX "history_org" ON "public"."translation_history" USING "btree" ("organization_id");



CREATE INDEX "history_segment" ON "public"."segment_history" USING "btree" ("segment_id");



CREATE INDEX "invitations_email" ON "public"."invitations" USING "btree" ("email");



CREATE INDEX "invitations_token" ON "public"."invitations" USING "btree" ("token");



CREATE INDEX "notif_org" ON "public"."notifications" USING "btree" ("organization_id");



CREATE INDEX "notif_user" ON "public"."notifications" USING "btree" ("user_id", "is_read", "created_at" DESC);



CREATE INDEX "org_members_org" ON "public"."organization_members" USING "btree" ("organization_id");



CREATE INDEX "org_members_user" ON "public"."organization_members" USING "btree" ("user_id");



CREATE INDEX "projects_org" ON "public"."projects" USING "btree" ("organization_id");



CREATE INDEX "projects_status" ON "public"."projects" USING "btree" ("status");



CREATE INDEX "segments_order" ON "public"."project_segments" USING "btree" ("project_id", "segment_order");



CREATE INDEX "segments_project" ON "public"."project_segments" USING "btree" ("project_id");



CREATE INDEX "tm_key_lang" ON "public"."translation_memory" USING "btree" ("key", "lang");



CREATE INDEX "tm_lang" ON "public"."translation_memory" USING "btree" ("lang");



CREATE INDEX "tm_org" ON "public"."translation_memory" USING "btree" ("organization_id");



CREATE INDEX "token_tx_created" ON "public"."token_transactions" USING "btree" ("created_at" DESC);



CREATE INDEX "token_tx_org" ON "public"."token_transactions" USING "btree" ("organization_id");



CREATE INDEX "token_tx_stripe" ON "public"."token_transactions" USING "btree" ("stripe_session_id");



CREATE OR REPLACE TRIGGER "assignments_updated_at" BEFORE UPDATE ON "public"."project_language_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "dict_updated_at" BEFORE UPDATE ON "public"."dictionary" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "history_updated_at" BEFORE UPDATE ON "public"."translation_history" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "orgs_updated_at" BEFORE UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "projects_updated_at" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "segments_updated_at" BEFORE UPDATE ON "public"."project_segments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



ALTER TABLE ONLY "public"."dictionary"
    ADD CONSTRAINT "dictionary_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_link_project_id_fkey" FOREIGN KEY ("link_project_id") REFERENCES "public"."projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_language_assignments"
    ADD CONSTRAINT "project_language_assignments_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."project_language_assignments"
    ADD CONSTRAINT "project_language_assignments_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."project_language_assignments"
    ADD CONSTRAINT "project_language_assignments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_segments"
    ADD CONSTRAINT "project_segments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."segment_history"
    ADD CONSTRAINT "segment_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."segment_history"
    ADD CONSTRAINT "segment_history_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "public"."project_segments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."token_transactions"
    ADD CONSTRAINT "token_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."token_transactions"
    ADD CONSTRAINT "token_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."translation_history"
    ADD CONSTRAINT "translation_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."translation_history"
    ADD CONSTRAINT "translation_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."translation_memory"
    ADD CONSTRAINT "translation_memory_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



CREATE POLICY "assignments_insert" ON "public"."project_language_assignments" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "project_language_assignments"."project_id") AND "public"."is_org_member"("auth"."uid"(), "p"."organization_id")))));



CREATE POLICY "assignments_select" ON "public"."project_language_assignments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "project_language_assignments"."project_id") AND "public"."is_org_member"("auth"."uid"(), "p"."organization_id")))));



CREATE POLICY "assignments_update" ON "public"."project_language_assignments" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "project_language_assignments"."project_id") AND "public"."is_org_member"("auth"."uid"(), "p"."organization_id")))));



CREATE POLICY "dict_delete" ON "public"."dictionary" FOR DELETE USING ("public"."is_org_admin"("auth"."uid"(), "organization_id"));



CREATE POLICY "dict_insert" ON "public"."dictionary" FOR INSERT WITH CHECK ("public"."is_org_member"("auth"."uid"(), "organization_id"));



CREATE POLICY "dict_select" ON "public"."dictionary" FOR SELECT USING ("public"."is_org_member"("auth"."uid"(), "organization_id"));



CREATE POLICY "dict_update" ON "public"."dictionary" FOR UPDATE USING ("public"."is_org_member"("auth"."uid"(), "organization_id"));



ALTER TABLE "public"."dictionary" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "history_insert" ON "public"."segment_history" FOR INSERT WITH CHECK (("changed_by" = "auth"."uid"()));



CREATE POLICY "history_insert" ON "public"."translation_history" FOR INSERT WITH CHECK ("public"."is_org_member"("auth"."uid"(), "organization_id"));



CREATE POLICY "history_select" ON "public"."segment_history" FOR SELECT USING ((("changed_by" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM ("public"."project_segments" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."id" = "segment_history"."segment_id") AND "public"."is_org_admin"("auth"."uid"(), "p"."organization_id"))))));



CREATE POLICY "history_select" ON "public"."translation_history" FOR SELECT USING ("public"."is_org_member"("auth"."uid"(), "organization_id"));



CREATE POLICY "history_update" ON "public"."translation_history" FOR UPDATE USING ("public"."is_org_member"("auth"."uid"(), "organization_id"));



ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invitations_delete" ON "public"."invitations" FOR DELETE USING ("public"."is_org_admin"("auth"."uid"(), "organization_id"));



CREATE POLICY "invitations_insert" ON "public"."invitations" FOR INSERT WITH CHECK ("public"."is_org_admin"("auth"."uid"(), "organization_id"));



CREATE POLICY "invitations_select" ON "public"."invitations" FOR SELECT USING (true);



CREATE POLICY "members_delete" ON "public"."organization_members" FOR DELETE USING (("public"."is_org_admin"("auth"."uid"(), "organization_id") AND ("user_id" <> "auth"."uid"())));



CREATE POLICY "members_insert" ON "public"."organization_members" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "members_select" ON "public"."organization_members" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_org_member"("auth"."uid"(), "organization_id")));



CREATE POLICY "members_update" ON "public"."organization_members" FOR UPDATE USING ("public"."is_org_admin"("auth"."uid"(), "organization_id"));



CREATE POLICY "notif_delete" ON "public"."notifications" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "notif_insert" ON "public"."notifications" FOR INSERT WITH CHECK ("public"."is_org_member"("auth"."uid"(), "organization_id"));



CREATE POLICY "notif_select" ON "public"."notifications" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "notif_update" ON "public"."notifications" FOR UPDATE USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orgs_admin_update" ON "public"."organizations" FOR UPDATE USING ("public"."is_org_admin"("auth"."uid"(), "id"));



CREATE POLICY "orgs_insert" ON "public"."organizations" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "orgs_member_select" ON "public"."organizations" FOR SELECT TO "authenticated" USING ("public"."is_org_member"("auth"."uid"(), "id"));



CREATE POLICY "packages_select" ON "public"."token_packages" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_insert_own" ON "public"."profiles" FOR INSERT WITH CHECK ((("auth"."uid"() = "id") OR ("auth"."uid"() IS NULL)));



CREATE POLICY "profiles_select_org" ON "public"."profiles" FOR SELECT USING ((("auth"."uid"() = "id") OR (EXISTS ( SELECT 1
   FROM ("public"."organization_members" "om1"
     JOIN "public"."organization_members" "om2" ON (("om1"."organization_id" = "om2"."organization_id")))
  WHERE (("om1"."user_id" = "auth"."uid"()) AND ("om2"."user_id" = "profiles"."id"))))));



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."project_language_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_segments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects_delete" ON "public"."projects" FOR DELETE USING ("public"."is_org_admin"("auth"."uid"(), "organization_id"));



CREATE POLICY "projects_insert" ON "public"."projects" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_org_member"("auth"."uid"(), "organization_id"));



CREATE POLICY "projects_select" ON "public"."projects" FOR SELECT USING ("public"."is_org_member"("auth"."uid"(), "organization_id"));



CREATE POLICY "projects_update" ON "public"."projects" FOR UPDATE USING ("public"."is_org_member"("auth"."uid"(), "organization_id"));



ALTER TABLE "public"."segment_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "segments_insert" ON "public"."project_segments" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "project_segments"."project_id") AND "public"."is_org_member"("auth"."uid"(), "p"."organization_id")))));



CREATE POLICY "segments_select" ON "public"."project_segments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "project_segments"."project_id") AND "public"."is_org_member"("auth"."uid"(), "p"."organization_id")))));



CREATE POLICY "segments_update" ON "public"."project_segments" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "project_segments"."project_id") AND "public"."is_org_member"("auth"."uid"(), "p"."organization_id")))));



CREATE POLICY "tm_delete" ON "public"."translation_memory" FOR DELETE USING ("public"."is_org_admin"("auth"."uid"(), "organization_id"));



CREATE POLICY "tm_insert" ON "public"."translation_memory" FOR INSERT WITH CHECK ("public"."is_org_member"("auth"."uid"(), "organization_id"));



CREATE POLICY "tm_select" ON "public"."translation_memory" FOR SELECT USING ("public"."is_org_member"("auth"."uid"(), "organization_id"));



CREATE POLICY "tm_update" ON "public"."translation_memory" FOR UPDATE USING ("public"."is_org_member"("auth"."uid"(), "organization_id"));



ALTER TABLE "public"."token_packages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."token_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."translation_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."translation_memory" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tx_org_insert" ON "public"."token_transactions" FOR INSERT WITH CHECK ("public"."is_org_member"("auth"."uid"(), "organization_id"));



CREATE POLICY "tx_org_select" ON "public"."token_transactions" FOR SELECT USING ("public"."is_org_member"("auth"."uid"(), "organization_id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."add_org_admin"("org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."add_org_admin"("org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_org_admin"("org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."add_tokens"("org_id" "uuid", "amount" integer, "desc_text" "text", "session_id" "text", "payment_intent" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."add_tokens"("org_id" "uuid", "amount" integer, "desc_text" "text", "session_id" "text", "payment_intent" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_tokens"("org_id" "uuid", "amount" integer, "desc_text" "text", "session_id" "text", "payment_intent" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_delete_user"("target_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_delete_user"("target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_delete_user"("target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_org_record"("org_name" "text", "org_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_org_record"("org_name" "text", "org_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_org_record"("org_name" "text", "org_slug" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_lang_assignment"("assignment_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_lang_assignment"("assignment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_lang_assignment"("assignment_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."delete_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_org_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_org_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_org_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_tm_stats"("org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_tm_stats"("org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tm_stats"("org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_org_id"("uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_org_id"("uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_org_id"("uid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_role_in_org"("uid" "uuid", "oid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_role_in_org"("uid" "uuid", "oid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_role_in_org"("uid" "uuid", "oid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_org_admin"("uid" "uuid", "oid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_org_admin"("uid" "uuid", "oid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_admin"("uid" "uuid", "oid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_org_member"("uid" "uuid", "oid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_org_member"("uid" "uuid", "oid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_member"("uid" "uuid", "oid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."lookup_tm_batch"("org_id" "uuid", "source_keys" "text"[], "target_lang" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_tm_batch"("org_id" "uuid", "source_keys" "text"[], "target_lang" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_tm_batch"("org_id" "uuid", "source_keys" "text"[], "target_lang" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_admins"("org_id" "uuid", "notif_type" "text", "notif_title" "text", "notif_message" "text", "proj_id" "uuid", "lang" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."notify_admins"("org_id" "uuid", "notif_type" "text", "notif_title" "text", "notif_message" "text", "proj_id" "uuid", "lang" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_admins"("org_id" "uuid", "notif_type" "text", "notif_title" "text", "notif_message" "text", "proj_id" "uuid", "lang" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_translators"("org_id" "uuid", "target_lang" "text", "notif_type" "text", "notif_title" "text", "notif_message" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."notify_translators"("org_id" "uuid", "target_lang" "text", "notif_type" "text", "notif_title" "text", "notif_message" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_translators"("org_id" "uuid", "target_lang" "text", "notif_type" "text", "notif_title" "text", "notif_message" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reset_monthly_tokens"() TO "anon";
GRANT ALL ON FUNCTION "public"."reset_monthly_tokens"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reset_monthly_tokens"() TO "service_role";



GRANT ALL ON FUNCTION "public"."save_dict_translation"("dict_id" "uuid", "lang" "text", "new_text" "text", "mark_accepted" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."save_dict_translation"("dict_id" "uuid", "lang" "text", "new_text" "text", "mark_accepted" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_dict_translation"("dict_id" "uuid", "lang" "text", "new_text" "text", "mark_accepted" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."save_segment_translation"("seg_id" "uuid", "lang" "text", "new_text" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."save_segment_translation"("seg_id" "uuid", "lang" "text", "new_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_segment_translation"("seg_id" "uuid", "lang" "text", "new_text" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."use_tokens"("org_id" "uuid", "amount" integer, "desc_text" "text", "meta" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."use_tokens"("org_id" "uuid", "amount" integer, "desc_text" "text", "meta" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."use_tokens"("org_id" "uuid", "amount" integer, "desc_text" "text", "meta" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."use_tokens_member"("org_id" "uuid", "amount" integer, "desc_text" "text", "meta" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."use_tokens_member"("org_id" "uuid", "amount" integer, "desc_text" "text", "meta" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."use_tokens_member"("org_id" "uuid", "amount" integer, "desc_text" "text", "meta" "jsonb") TO "service_role";


















GRANT ALL ON TABLE "public"."dictionary" TO "anon";
GRANT ALL ON TABLE "public"."dictionary" TO "authenticated";
GRANT ALL ON TABLE "public"."dictionary" TO "service_role";



GRANT ALL ON TABLE "public"."invitations" TO "anon";
GRANT ALL ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";



GRANT ALL ON TABLE "public"."organization_members" TO "anon";
GRANT ALL ON TABLE "public"."organization_members" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_members" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."member_emails" TO "anon";
GRANT ALL ON TABLE "public"."member_emails" TO "authenticated";
GRANT ALL ON TABLE "public"."member_emails" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."project_language_assignments" TO "anon";
GRANT ALL ON TABLE "public"."project_language_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."project_language_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."project_segments" TO "anon";
GRANT ALL ON TABLE "public"."project_segments" TO "authenticated";
GRANT ALL ON TABLE "public"."project_segments" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."segment_history" TO "anon";
GRANT ALL ON TABLE "public"."segment_history" TO "authenticated";
GRANT ALL ON TABLE "public"."segment_history" TO "service_role";



GRANT ALL ON TABLE "public"."token_packages" TO "anon";
GRANT ALL ON TABLE "public"."token_packages" TO "authenticated";
GRANT ALL ON TABLE "public"."token_packages" TO "service_role";



GRANT ALL ON TABLE "public"."token_transactions" TO "anon";
GRANT ALL ON TABLE "public"."token_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."token_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."translation_history" TO "anon";
GRANT ALL ON TABLE "public"."translation_history" TO "authenticated";
GRANT ALL ON TABLE "public"."translation_history" TO "service_role";



GRANT ALL ON TABLE "public"."translation_memory" TO "anon";
GRANT ALL ON TABLE "public"."translation_memory" TO "authenticated";
GRANT ALL ON TABLE "public"."translation_memory" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  create policy "project_files_delete"
  on "storage"."objects"
  as permissive
  for delete
  to public
using (((bucket_id = 'project-files'::text) AND (auth.uid() IS NOT NULL)));



  create policy "project_files_insert"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'project-files'::text) AND (auth.uid() IS NOT NULL)));



  create policy "project_files_select"
  on "storage"."objects"
  as permissive
  for select
  to public
using (((bucket_id = 'project-files'::text) AND (auth.uid() IS NOT NULL)));



