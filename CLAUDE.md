# CLAUDE.md — TranslateTool

## Opis aplikacji

TranslateTool to wielotenantowa aplikacja SaaS do tłumaczenia materiałów e-learningowych. Obsługuje pliki XLIFF (Articulate Storyline), PPTX (PowerPoint) i napisy (SRT/VTT). Tłumaczenia wykonywane są przez Claude API (claude-sonnet-4-20250514) bezpośrednio z przeglądarki. Aplikacja zarządza organizacjami, zespołami tłumaczy, pamięcią tłumaczeń (TM) i słownikiem terminologii — dane synchronizowane przez Supabase.

---

## Struktura projektu

```
translate-tool/
└── index.html   ← cała aplikacja (CSS + HTML + JS, ~4500 linii)
```

Projekt jest **single-file SPA** — jeden plik `index.html` zawiera wszystko. Nie ma node_modules, bundlera ani kompilacji.

---

## Stos technologiczny

| Warstwa | Technologia |
|---|---|
| Frontend | Vanilla HTML/CSS/JavaScript (bez frameworka) |
| Backend / DB | Supabase (PostgreSQL + Auth + Storage + RLS) |
| AI | Anthropic Claude `claude-sonnet-4-20250514` — bezpośrednie wywołania z przeglądarki |
| PPTX | JSZip 3.10.1 (CDN) — rozpakowywanie i modyfikacja .pptx |
| Excel | SheetJS xlsx 0.18.5 (CDN) — import/eksport .xlsx |
| Płatności | Stripe (klucz testowy `pk_test_...` — integracja checkout jeszcze niegotowa) |
| Hosting | Cloudflare Pages (https://translate-tool.pages.dev) |

**Zewnętrzne biblioteki ładowane z CDN (linie 16–18):**
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
```

---

## Architektura kodu

### Układ pliku

```
<head>
  ciemny motyw (inline, przed DOMContentLoaded)
  3 skrypty CDN
  ~570 linii CSS (wszystkie style inline)
</head>
<body>
  Ekrany auth (login / register / reset / onboarding)
  App Shell:
    <header> — logo, tokeny, powiadomienia, menu użytkownika
    <div.tabs> — nawigacja zakładkowa
  Zawartość zakładek (tab-content):
    tab-xliff, tab-pptx, tab-history, tab-dict, tab-tm, tab-team, tab-shop
    tab-projects (domyślna) — lista projektów + edytor projektu
  Modals: new-proj-modal, edit-proj-modal
  <script> — cały JS (~3800 linii)
</body>
```

### Sekcje JavaScript (oznaczone banerami `// ══════...══════`)

| Sekcja | Opis |
|---|---|
| SUPABASE | Init klienta, `sbRest()`, helpery `dbGet/dbPost/dbPatch/dbDelete` |
| STATE | Globalne zmienne stanu: `xliffSegs`, `pptxSegs`, `dictCache`, `tmCache`, `currentOrg`, `currentRole` itd. |
| LANGUAGES | Tablica `LANGS[]` (25 języków), `PRIMARY` (8 głównych), `langOptionsHTML()` |
| AUTH | `doLogin`, `doRegister`, `doReset`, `doLogout`, `afterLogin`, `acceptInvitation` |
| ONBOARDING | Tworzenie org via RPC (`create_org_record`, `add_org_admin`), zaproszenia |
| APP LOAD | `loadApp()`, `switchTab()`, helpery utils (`esc`, `download`, `readFile`, `sleep`, `fmtDate`) |
| TEAM MANAGEMENT | `loadTeam`, `renderTeamList`, limity tokenów na tłumacza, języki członka |
| TRANSLATION MEMORY | `lookupTMBatch` (RPC), `pushTMBatch`, `applyTMToSegsAsync`, edycja wpisów TM |
| DICTIONARY | `dictCache[]`, CRUD, `buildDictPromptForChunk()`, `fillDictWithAI()`, stemming |
| HISTORIA | `histCache[]`, `createHistoryEntry`, `updateHistoryEntry` |
| COST | `estimateCost()`, `renderCostBox()`, `estimateTokensForTranslation()` |
| API CALL | `apiCall(apiKey, prompt, maxTokens)` — POST do `https://api.anthropic.com/v1/messages` |
| XLIFF | `loadXliff`, `runXliffBatch`, `exportXliff`, import/eksport Excel |
| PPTX | `loadPptx`, `runPptxBatch`, `exportPptx`, `applyPptxTranslations`, `applyRunText` |
| PROJECTS SYSTEM | `loadProjects`, `createProject`, `openProject`, `renderEditorTable`, `saveSegment` (autosave), `runAITranslation`, `exportProjectXliff`, `applyTMToProject` |
| SUBTITLES | `parseSRT`, `parseVTT`, `runSubtitleBatch`, `exportSubtitles` |
| TOKEN SYSTEM | `deductTokens` (RPC `use_tokens`), `checkTokenBalance`, `adminAddTokens`, Stripe checkout (stub) |
| DARK MODE | `localStorage['darkMode']`, `applyDarkMode`, `toggleDarkMode` |
| NOTIFICATIONS | `createNotification` (RPC `notify_admins`), `loadNotifications`, unread dot |
| DASHBOARD METRICS | `loadDashMetrics`, `setProjFilter`, translator token limit bar |
| DICT VERIFICATION | `showVerifySummary`, `getMatchingTerms`, `getWordStem` (stemming PL/EN) |

### Supabase RPC (stored procedures)

| Funkcja | Cel |
|---|---|
| `create_org_record(org_name, org_slug)` | Tworzy org z pominięciem RLS |
| `add_org_admin(org_id)` | Dodaje zalogowanego usera jako admina |
| `add_tokens(org_id, amount, desc_text)` | Doładowanie tokenów |
| `use_tokens(org_id, amount, desc_text, meta)` | Odliczenie tokenów, zwraca `balance_after` |
| `save_segment_translation(seg_id, lang, new_text)` | Zapis tłumaczenia segmentu projektu |
| `lookup_tm_batch(org_id, source_keys, target_lang)` | Batch lookup w translation_memory |
| `get_tm_stats(org_id)` | Statystyki TM (total, langs, langs_list) |
| `notify_admins(org_id, notif_type, notif_title, notif_message, proj_id, lang)` | Powiadomienia dla adminów |

### Tabele Supabase (inferred z kodu)

`organizations`, `organization_members`, `invitations`, `projects`, `project_segments`, `project_language_assignments`, `translation_memory`, `dictionary`, `translation_history`, `token_transactions`, `notifications`, `profiles`, widok `member_emails`

### Role i system uprawnień

- `admin` — pełny dostęp
- `translator` — tłumaczenie, edycja TM/słownika, widzi tylko swoje projekty
- `viewer` — tylko odczyt

Guard realizowany przez CSS: `[data-role=viewer] .hide-viewer { display:none }`.
Ustawiany przez `document.getElementById('app-shell').setAttribute('data-role', currentRole)`.

### Kluczowe stałe (linia ~1381)

```js
const PRICE_IN=3.0, PRICE_OUT=15.0  // $/1M tokenów API
const PLN_USD=4.0                    // przelicznik
const CPT=4                          // chars per token
const CHUNK=20                       // segmentów na jedno wywołanie API (XLIFF/PPTX)
// w projektach i napisach CHUNK=15 (inlined w funkcjach)
const TOKENS_PER_PLN=9000            // nasz token = ~1/9000 PLN
```

### Wzorzec tłumaczenia (batch + retry)

1. Segmenty dzielone na chunki po `CHUNK`
2. Każdy chunk = jedno wywołanie `apiCall()` z JSON prompt
3. Sprawdzane klucze odpowiedzi — brakujące segmenty idą do tablicy `failed[]`
4. Retry failed — jeden segment = jedno wywołanie
5. Po zakończeniu: `pushTMBatch` (zapis do TM) + `deductTokens`

### Autosave w edytorze projektu

`onSegInput` → `clearTimeout` + `setTimeout(saveSegment, 1500)` — zapis do Supabase przez RPC `save_segment_translation`.

---

## Zasady przy edycji

### Czego nie ruszać

- **Supabase credentials** (linia 1354–1355): `SB_URL` i `SB_KEY` — anon key, widoczny w kliencie (to normalne dla Supabase z RLS)
- **`anthropic-dangerous-direct-browser-access: true`** (linia 2377) — wymagany header przy wywołaniach Anthropic API z przeglądarki, bez niego CORS blokuje
- **`XLIFF_NS`** (linia 1380) — przestrzeń nazw XLIFF 1.2, musi być dokładnie `'urn:oasis:names:tc:xliff:document:1.2'`
- **`applyRunText`** (linia 2614) — skomplikowana logika proporcjonalnego podziału tekstu między `<r>` runy w PPTX, zmiana psuje formatowanie
- **CSS reguły dark mode** — bardzo obszerne (~200 linii), selektory są celowo nadpisane `!important` w wielu miejscach; przy dodawaniu nowych elementów zawsze dodaj parę `.dark`

### Na co uważać

- **Duplikat funkcji `buildDictPrompt`** (linie 2149–2150): dwie identyczne deklaracje na końcu sekcji DICTIONARY — to nie błąd krytyczny (JS bierze ostatnią), ale nie dodawaj kolejnej
- **`tmCache[]`** to rolling cache (max 1000 wpisów), nie jest pełną kopią bazy — do pełnego lookup używaj `lookupTMBatch` (RPC)
- **Model AI** (linia 2377): `claude-sonnet-4-20250514` — zmiana modelu wpływa na koszty i jakość, upewnij się że nowy model istnieje
- **Stripe checkout** (linia 4036): `startCheckout()` kończy się alertem ("wymagana konfiguracja") — płatności nie są zaimplementowane, panel admina ma ręczne doładowanie
- **`orgParam()`** (linia 1703) — zawsze używaj tego helpera w zapytaniach REST żeby filtrować po `organization_id`, inaczej możesz czytać dane innych org
- **`PRIMARY` vs `LANGS`**: słownik i TM pokazują tylko `PRIMARY` (8 języków), pełna lista `LANGS` (25) jest w dropdownach tłumaczeń

### Przy dodawaniu nowej zakładki

1. Dodaj `<div class="tab-content" id="tab-X">` w HTML
2. Dodaj `.tab` w `<div class="tabs">`
3. Dodaj `'X'` do tablicy `names` w `switchTab()` (linia 1676)
4. Dodaj `if(name==='X')...` w ciele `switchTab()`
5. Dodaj reguły dark mode dla nowych elementów

---

## Zasady commitowania

- **Język commitów: polski**
- Styl: imperatyw, zwięźle, bez kropki na końcu

### Format

```
<typ>: <co zrobiono>

opcjonalne szczegóły (jeśli nieoczywiste)
```

**Typy:**
- `dodanie:` — nowa funkcja
- `poprawka:` — naprawa błędu
- `zmiana:` — modyfikacja istniejącej funkcji
- `refaktor:` — zmiana bez zmiany zachowania
- `styl:` — CSS/wygląd

### Przykłady z historii projektu

```
dodanie edycji TM
poprawiony bug z projektem na dole
powrót do poprzedniej wersji
slownik source lang a nie PL
```

---

## Środowisko i deployment

- Aplikacja uruchamiana przez otwarcie `index.html` w przeglądarce lub przez Cloudflare Pages
- Brak procesu build — edytuj `index.html` bezpośrednio
- Testy manualne w przeglądarce (brak testów automatycznych)
- Git branch: `main` (jedyna gałąź)
