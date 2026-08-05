# Jak wprowadzać zmiany w TranslateScorm

Instrukcja operacyjna: co wpisać, co kliknąć, na co uważać. Opis architektury jest w [CLAUDE.md](CLAUDE.md).

**Zasada nadrzędna:** zmiany idą przez gałąź `test`, weryfikujesz je na `test.translatescorm.com`, dopiero potem merge do `main`. Kod i migracja bazy **zawsze razem** — ich rozjazd to najczęstsza przyczyna awarii.

---

## Ściąga

| | Produkcja | Test | Lokalne |
|---|---|---|---|
| Adres | translatescorm.com | test.translatescorm.com | localhost:8788 |
| Gałąź | `main` | `test` | — |
| Supabase ref | `lzklxvdzyslpwugjvvtj` | `ejtorsngzodkxrbvmybc` | `127.0.0.1:54321` |
| Studio | supabase.com | supabase.com | 127.0.0.1:54323 |
| Maile | Resend (realne) | Resend (realne) | Mailpit :54324 |

**Cloudflare:** Workers & Pages → `translate-tool` (ikona ⚡). Ustawienia mają przełącznik **Choose Environment: Production / Preview** u góry — Preview dotyczy gałęzi `test`.

---

## A. Zwykła zmiana w kodzie

Bez zmian w bazie — CSS, HTML, logika JS.

```bash
git checkout test
git pull

# ... edytujesz pliki w public/ ...

node --check public/js/<zmieniony>.js      # szybka kontrola składni
git add -A && git commit -m "opis zmiany"
git push origin test
```

Poczekaj na build (Deployments → wpis `test` z etykietą **Preview**), potem sprawdź na `https://test.translatescorm.com`:

- [ ] widoczny pomarańczowy znacznik **ŚRODOWISKO TEST** (prawy dolny róg)
- [ ] zmiana działa
- [ ] konsola przeglądarki (F12) bez czerwonych błędów

Gdy jest dobrze:

```bash
git checkout main
git merge test
git push origin main
```

Po ~2 min sprawdź `translatescorm.com` — **bez** znacznika środowiska.

---

## B. Zmiana wymagająca migracji bazy

Tu kolejność ma znaczenie. Migracja idzie **przed** kodem, bo kod bez niej się wywali; baza z migracją, ale bez nowego kodu, działa normalnie.

### 1. Nowa migracja

```bash
supabase migration new nazwa_zmiany     # tworzy plik z prefiksem czasowym
```

Pisz w niej wyłącznie zmiany przyrostowe (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`). Nazwy plików sortują się leksykalnie — prefiks decyduje o kolejności wykonania.

**Uwaga na nadpisywanie:** jeśli migracja robi `CREATE OR REPLACE` na funkcji z wcześniejszej migracji, musi mieć **późniejszy** prefiks. Odwrotna kolejność po cichu cofnie zmianę.

### 2. Test lokalny — tu wolno psuć

```bash
supabase start          # jeśli nie działa
supabase db reset       # odtwarza bazę od zera z wszystkich migracji
```

`db reset` przechodzące bez błędu to dowód, że komplet migracji jest spójny. Jeśli tu się wywali — popraw, zanim pójdziesz dalej.

### 3. Migracja na bazę testową

```bash
supabase link --project-ref ejtorsngzodkxrbvmybc
supabase db push
supabase link --project-ref lzklxvdzyslpwugjvvtj   # WRÓĆ na prod od razu
```

Ostatnia linia jest ważna — zapomniana oznacza, że kolejne `db push` trafi w bazę testową (albo odwrotnie). Sprawdź czym jesteś podlinkowany: `cat supabase/.temp/project-ref`.

### 4. Kod na gałąź test

Jak w scenariuszu A: commit, push, weryfikacja na `test.translatescorm.com`.

### 5. Produkcja

```bash
supabase link --project-ref lzklxvdzyslpwugjvvtj
supabase db push          # najpierw baza
git checkout main && git merge test && git push origin main   # potem kod
```

Weryfikacja: `supabase migration list` — kolumny Local i Remote muszą się zgadzać.

---

## C. Uruchomienie lokalne

```bash
supabase start                                # Postgres + Auth + Storage w Dockerze
npx wrangler pages dev public --port 8788     # statyki + Pages Functions
```

Przed pierwszym razem: `cp .dev.vars.example .dev.vars` i uzupełnij `ANTHROPIC_API_KEY` — jedyny sekret bez lokalnego zamiennika.

**Nie zadziała:** otwarcie `public/index.html` przez `file://` (Auth odrzuca origin `null`, a `/api/*` to ścieżka absolutna) ani zwykły serwer HTTP (nie wykona Pages Functions → 404 na `/api/translate`).

Potwierdzenia email są lokalnie wyłączone — rejestracja od razu daje sesję. Maile lądują w Mailpit (`127.0.0.1:54324`).

Gdy skończysz: `supabase stop`.

---

## D. Przed wdrożeniem na produkcję

Dla zmian dotykających danych (migracje, słownik, struktura):

- [ ] Eksport słownika z produkcji (Słownik → ↓ Excel i ↓ JSON) — punkt powrotu niezależny od bazy
- [ ] `supabase db reset` lokalnie przechodzi bez błędu
- [ ] Zmiana zweryfikowana na `test.translatescorm.com`
- [ ] Jeśli migracja ma zapytania kontrolne — uruchomione, wynik zgodny z oczekiwaniem

Po wdrożeniu:

- [ ] `translatescorm.com` ładuje się, brak znacznika środowiska
- [ ] Dotychczasowe dane widoczne (słownik, projekty)
- [ ] `supabase migration list` — Local = Remote
- [ ] Konsola przeglądarki bez błędów

---

## E. Wycofywanie zmian

**Kod** — Cloudflare → Deployments → poprzedni udany build → **Rollback**. Natychmiastowe, bez czekania na build. Potem uporządkuj repo:

```bash
git revert <hash>
git push origin main
```

**Baza** — migracje **nie mają automatycznego rollbacku**. Trzeba napisać migrację odwrotną. Dlatego pisz je przyrostowo i unikaj `DROP COLUMN` — dodanie kolumny jest odwracalne, usunięcie danych nie.

Migracje w tym projekcie są celowo zachowawcze: backfill liczy wartości z realnych danych, a RPC `save_org_dict_config` odrzuca operacje, które osierociłyby tłumaczenia.

---

## F. Znane pułapki

| Objaw | Przyczyna | Co zrobić |
|---|---|---|
| Zmiana niewidoczna po wdrożeniu | Cache przeglądarki | `Ctrl+Shift+R`. Powinno być rzadkie — [public/_headers](public/_headers) wyłącza cache dla `js/` i `css/` |
| `test.translatescorm.com` → **522** | Brak aliasu gałęzi (gałąź zbudowana jako Production) | Settings → Build → Branch control: Production branch = `main`. Alias powstaje tylko dla Preview |
| Subdomena pokazuje produkcję | CNAME wskazuje `translate-tool.pages.dev` | W DNS zmień cel na `test.translate-tool.pages.dev`, proxy włączone |
| Pusta strona po udanym buildzie | Build output directory ≠ `public` | Settings → Build → Build output directory = `public`, osobno dla Production i Preview |
| `/api/translate` → **401**, reszta działa | Zmienne Preview wskazują produkcyjną bazę | Settings → Variables → Preview: `SUPABASE_URL`/`SUPABASE_ANON_KEY` na projekt testowy, potem Redeploy |
| `Could not find the function ...` | Migracja niewgrana **albo** niepełne argumenty w teście | `supabase migration list`; przy `curl` wysyłaj komplet parametrów |
| Pliki SQL dostępne publicznie | Coś poza `public/` trafiło do publikacji | Sprawdź `assets` w `wrangler.jsonc` (nie powinno być) i Build output |
| `wrangler pages dev` nie startuje | Zbłąkane procesy blokują port | Znajdź korzeń: `Get-CimInstance Win32_Process \| Where-Object { $_.CommandLine -match 'wrangler' }`, potem `taskkill /F /T /PID <korzeń>` |

---

## G. Czego nie robić

- **Nie wklejaj SQL do Supabase SQL Editor** przy zmianach schematu — użyj `supabase migration new`. Ręczne zmiany nie zostawiają śladu i rozjeżdżają bazę z repo. To była przyczyna awarii z 2026-08-05.
- **Nie dodawaj sekcji `assets` do `wrangler.jsonc`** — katalog publikacji ustawia panel. Plik z repo ma pierwszeństwo i wtedy oba ustawienia się wykluczają.
- **Nie zaszywaj domeny w kodzie** — używaj `location.origin`. Inaczej rejestracja z testu przekieruje na produkcję.
- **Nie umieszczaj plików poza `public/`, jeśli mają być dostępne w przeglądarce** — i odwrotnie: nie wkładaj do `public/` niczego, co ma zostać prywatne.
- **Nie testuj na produkcji.** Środowisko testowe ma własną bazę i kosztuje 0 zł.
