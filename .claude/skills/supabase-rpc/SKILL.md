---
name: supabase-rpc
description: Tworzy nową Supabase RPC stored procedure zgodnie z konwencjami projektu TranslateScorm (RLS, security definer, helpery JS)
---

Przy tworzeniu nowej RPC w projekcie TranslateScorm stosuj te zasady:

## Konwencje SQL

1. Używaj `SECURITY DEFINER` gdy RPC musi omijać RLS (np. operacje admina)
2. Waliduj wywołującego przez `auth.uid()` na początku funkcji
3. Zwracaj sensowny typ — `void`, `jsonb`, `boolean` lub własny typ
4. Dodaj `SET search_path = public` przy SECURITY DEFINER

## Szablon funkcji

```sql
CREATE OR REPLACE FUNCTION public.nazwa_funkcji(
  param1 uuid,
  param2 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  -- walidacja wywołującego
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- logika funkcji
  RETURN jsonb_build_object('success', true);
END;
$$;
```

## Helper JS (frontend)

Po dodaniu RPC w Supabase, wywołuj ją przez:
```js
const result = await sbRest('rpc/nazwa_funkcji', { param1: val1, param2: val2 });
```

## Checklist po dodaniu RPC

- [ ] Dodaj wpis do tabeli "Supabase RPC" w CLAUDE.md
- [ ] Sprawdź czy RLS na powiązanych tabelach nie blokuje funkcji
- [ ] Przetestuj wywołanie przez `sbRest()` w konsoli przeglądarki
