# CLAUDE.md — TranslateScorm

## Opis aplikacji

TranslateScorm to wielotenantowa aplikacja SaaS do tłumaczenia materiałów e-learningowych. Obsługuje pliki XLIFF (Articulate Storyline), PPTX (PowerPoint) i napisy (SRT/VTT). Tłumaczenia wykonywane są przez Claude API (claude-sonnet-4-20250514) bezpośrednio z przeglądarki. Aplikacja zarządza organizacjami, zespołami tłumaczy, pamięcią tłumaczeń (TM) i słownikiem terminologii — dane synchronizowane przez Supabase. Rozliczenie oparte na kredytach: 1 kredyt = 1 000 znaków = 1 PLN.

---

## Struktura projektu

```
translate-tool/
├── index.html      ← cała aplikacja (CSS + HTML + JS, ~5200 linii)
├── logo.png        ← oryginalne logo (duże marginesy, nieużywane)
└── logoSmall.png   ← logo aplikacji (favicon + nav + auth + sidebar)
```

Projekt jest **single-file SPA** — jeden plik `index.html` zawiera wszystko. Nie ma node_modules, bundlera ani kompilacji.

---

## Stos technologiczny

| Warstwa | Technologia |
|---|---|
| Frontend | Vanilla HTML/CSS/JavaScript (bez frameworka) |
| Backend / DB | Supabase (PostgreSQL + Auth + Storage + RLS) |
| AI | Anthropic Claude `claude-sonnet-4-6` — przez backend-proxy `/api/translate` (Cloudflare Function); klucz `ANTHROPIC_API_KEY` w env po stronie serwera, nigdy w kliencie |
| PPTX | JSZip 3.10.1 (CDN) — rozpakowywanie i modyfikacja .pptx |
| Excel | SheetJS xlsx 0.18.5 (CDN) — import/eksport .xlsx |
| Formularz kontaktowy | Formspree (`https://formspree.io/f/meenlzod`) |
| Płatności | Stripe (klucz testowy `pk_test_...` — checkout niegotowy, admin ma ręczne doładowanie) |
| Hosting | Cloudflare Pages (https://translatescorm.com) |

**Backend (Cloudflare Pages Functions, katalog `functions/api/`):**
- `functions/api/translate.js` — proxy do Anthropic: weryfikuje token Supabase → woła `https://api.anthropic.com/v1/messages` z `env.ANTHROPIC_API_KEY`
- `functions/api/invite.js` — proxy do Resend (`https://api.resend.com/emails`), wołane z `js/09-team.js`
- Konfiguracja: `wrangler.jsonc` (`nodejs_compat`); sekrety lokalnie w `.dev.vars` (w `.gitignore`)

**Zewnętrzne biblioteki ładowane z CDN:**
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
  ~900 linii CSS (wszystkie style inline, prefix lp- dla landing page)
</head>
<body>
  #screen-landing        ← landing page (przed logowaniem)
    nav.lp-nav           ← Strona główna · Cennik · Kontakt + przyciski auth
    section.lp-hero      ← hero z CTA i mini-stats (80%/80+/3/AI)
    section.lp-benefits  ← 4 karty korzyści
    section#cennik        ← podstrona cennik (scroll anchor)
      pakiety kredytów → jak działa rozliczenie → co zawiera plan → FAQ → #kontakt
    footer.lp-footer

  Ekrany auth (login / register / reset / onboarding) ← split-screen layout

  App Shell (#app-shell):
    <header>    ← logo, kredyty, powiadomienia, menu użytkownika
    <div.tabs>  ← nawigacja zakładkowa

  Zawartość zakładek (poza app-shell, aktywowane przez .tab-content.active):
    tab-xliff, tab-pptx, tab-stats, tab-dict, tab-tm, tab-team, tab-shop
    tab-projects (domyślna) — lista projektów + edytor projektu

  Modals: new-proj-modal, edit-proj-modal
  <script> — cały JS (~4000 linii)
</body>
```

### Flow wyświetlania (BOOT)

```
Otwórz URL
  ├── sesja istnieje       → afterLogin() → App
  ├── ?invite=TOKEN        → showScreen('screen-login')  (omija landing)
  ├── #access_token w URL  → afterLogin()               (email confirmation)
  └── brak sesji           → showLanding()
                                 ↓
                           hideLanding() + showScreen('screen-login/register')
                                 ↓
                           afterLogin() → migrateTokensToCredits() → App
```

**Kluczowe funkcje nawigacji:**
- `showLanding()` — public; robi `history.pushState({view:'landing'})` + wywołuje `_showLanding()`
- `showScreen(id)` — public; robi `history.pushState({view:id})` + wywołuje `_showScreen(id)`
- `_showLanding()` — internal (bez pushState); pokazuje landing, ukrywa auth + app + `.tab-content.active`
- `_showScreen(id)` — internal (bez pushState); ukrywa landing, pokazuje dany ekran auth
- `hideLanding()` — ukrywa tylko landing (zachowana dla backward compat)
- `showApp()` — pokazuje app-shell + przywraca `tab-projects.active`
- `popstate` listener — obsługuje przycisk Wstecz przeglądarki: null/landing → `_showLanding()`, screen-* → `_showScreen()`

### Sekcje JavaScript (oznaczone banerami `// ══════...══════`)

| Sekcja | Opis |
|---|---|
| SUPABASE | Init klienta, `sbRest()`, helpery `dbGet/dbPost/dbPatch/dbDelete/dbUpsert` |
| STATE | Globalne zmienne stanu: `xliffSegs`, `pptxSegs`, `dictCache`, `tmCache`, `currentOrg`, `currentRole` itd. |
| LANGUAGES | Tablica `LANGS[]` (25 języków), `PRIMARY` (8 głównych), `langOptionsHTML()` |
| AUTH | `doLogin`, `doRegister`, `doReset`, `doLogout`, `afterLogin`, `acceptInvitation`; walidacja: `setFieldState`, `validateEmail`, `validatePass`, `validatePass2` |
| ONBOARDING | Tworzenie org via RPC (`create_org_record`, `add_org_admin`), 15 kredytów powitalnych |
| APP LOAD | `loadApp()`, `switchTab()`, helpery utils (`esc`, `download`, `readFile`, `sleep`, `fmtDate`) |
| TEAM MANAGEMENT | `loadTeam`, `renderTeamList`, limity kredytów na tłumacza, języki członka |
| TRANSLATION MEMORY | `lookupTMBatch` (RPC), `pushTMBatch` (upsert via `dbUpsert`), `applyTMToSegsAsync`, edycja wpisów TM |
| DICTIONARY | `dictCache[]`, CRUD, `buildDictPromptForChunk()`, `fillDictWithAI()`, stemming, przepływ akceptacji per język (status `ai`/`accepted`), tryb tłumacza (`renderDictTranslator`), mapa źródeł (`dictSourceLang`/`buildDictSourceMap`), masowe wklejanie (`addDictBulk`), zapis przez RPC (`saveDictTranslation`) |
| STATYSTYKI | `loadStats`, `renderStats` — finanse (saldo, wydatki), TM (liczba wpisów, języki), jakość AI (% poprawek per projekt) |
| COST | `renderCostBox()` — 3 kafelki: Znaków / Koszt (kredytów) / Saldo |
| API CALL | `apiCall(prompt, maxTokens=2000)` — POST do własnego endpointu `/api/translate` z tokenem sesji Supabase w `Authorization: Bearer`; faktyczne wywołanie Anthropic dopiero po stronie serwera w `functions/api/translate.js` |
| XLIFF | `loadXliff`, `runXliffBatch`, `exportXliff`, import/eksport Excel |
| PPTX | `loadPptx`, `runPptxBatch`, `exportPptx`, `applyPptxTranslations`, `applyRunText` |
| PROJECTS SYSTEM | `loadProjects`, `createProject`, `openProject`, `renderEditorTable`, `saveSegment` (autosave), `runAITranslation`, `exportProjectXliff`, `applyTMToProject` |
| SUBTITLES | `parseSRT`, `parseVTT`, `runSubtitleBatch`, `exportSubtitles` |
| CREDIT SYSTEM | `estimateCredits`, `deductCredits`, `checkTokenBalance`, `migrateTokensToCredits`, Stripe stub |
| DARK MODE | `localStorage['darkMode']`, `applyDarkMode`, `toggleDarkMode` |
| NOTIFICATIONS | `createNotification` (RPC `notify_admins`), `loadNotifications`, unread dot |
| DASHBOARD METRICS | `loadDashMetrics`, `setProjFilter`, translator credit limit bar |
| DICT VERIFICATION | `showVerifySummary`, `getMatchingTerms`, `getWordStem` (stemming PL/EN) |

### System kredytów

**Model:** 1 kredyt = 1 000 znaków źródłowych = 1 PLN. Kolumna w bazie: `tokens_balance` (nie migrujemy nazwy).

```js
function estimateCredits(chars) { return Math.max(1, Math.ceil(chars / 1000)); }
function estimateTokensForTranslation(chars) { return estimateCredits(chars); } // alias
async function deductCredits(chars, filename, lang) { /* RPC use_tokens */ }
async function deductTokens(...) { return deductCredits(...); } // backward compat alias
```

**Migracja jednorazowa** (`migrateTokensToCredits`): przy każdym `loadApp()` — jeśli `tokens_balance > 10000` i brak flagi `creditsConverted_${orgId}` w localStorage, przelicza saldo `/1000`. Idempotentna: re-fetchuje świeże saldo przed przeliczeniem.

**Pakiety:**
```js
const PACKAGES = {
  'price_1TRpL9FAZbQYcNSrcZCePhAO': { name:'Starter',  tokens:50,   price:50  },
  'price_1TRpLWFAZbQYcNSraskM5Xoq': { name:'Standard', tokens:250,  price:230 },
  'price_1TRpLnFAZbQYcNSrhHdwtHo5': { name:'Pro',      tokens:1000, price:850 },
};
```

Bonus powitalny: 15 kredytów (`add_tokens` w onboardingu).

### Supabase RPC (stored procedures)

| Funkcja | Cel |
|---|---|
| `create_org_record(org_name, org_slug)` | Tworzy org z pominięciem RLS |
| `add_org_admin(org_id)` | Dodaje zalogowanego usera jako admina |
| `add_tokens(org_id, amount, desc_text)` | Doładowanie kredytów (kolumna tokens_balance) |
| `use_tokens(org_id, amount, desc_text, meta)` | Odliczenie kredytów, zwraca `balance_after` |
| `save_segment_translation(seg_id, lang, new_text)` | Zapis tłumaczenia segmentu projektu |
| `lookup_tm_batch(org_id, source_keys, target_lang)` | Batch lookup w translation_memory |
| `get_tm_stats(org_id)` | Statystyki TM (total, langs, langs_list) |
| `notify_admins(org_id, notif_type, notif_title, notif_message, proj_id, lang)` | Powiadomienia dla adminów |
| `notify_translators(org_id, target_lang, notif_type, notif_title, notif_message)` | Powiadomienia dla tłumaczy z przypisanym `target_lang` (po AI-fill słownika) |
| `save_dict_translation(dict_id, lang, new_text, mark_accepted)` | Zapis 1 tłumaczenia słownika; waliduje rolę i przypisanie języka (translator tylko swój); ustawia `status[lang]` = `accepted`/`ai`; zapisuje tylko klucz `[lang]` |
| `delete_lang_assignment(assignment_id)` | Usuwa przypisanie języka z projektu (omija RLS); waliduje przynależność do org |

**Definicje SQL:** `sql/dict_approval_workflow.sql` (kolumny + RPC + backfill do jednorazowego uruchomienia w Supabase).

### Tabele Supabase

`organizations` (m.in. `dict_source_map` JSONB — mapa źródeł słownika per język docelowy), `organization_members` (m.in. `languages` **`text[]`** — przypisane języki słownika tłumacza; w RPC używaj `lang = ANY(languages)`, nie operatorów jsonb), `invitations`, `projects`, `project_segments`, `project_language_assignments`, `translation_memory`, `dictionary` (m.in. `translations` JSONB + `status` JSONB per język: `ai`/`accepted`), `translation_history`, `token_transactions`, `notifications`, `profiles`, widok `member_emails`

### Role i system uprawnień

- `admin` — pełny dostęp
- `translator` — tłumaczenie, edycja TM/słownika, widzi tylko swoje projekty
- `viewer` — tylko odczyt

Guard przez CSS: `[data-role=viewer] .hide-viewer { display:none }`. Ustawiany przez `app-shell.setAttribute('data-role', currentRole)`.

### Kluczowe stałe

```js
const PRICE_IN=3.0, PRICE_OUT=15.0  // $/1M tokenów API (używane wewnętrznie)
const PLN_USD=4.0                    // przelicznik USD → PLN
const CPT=4                          // chars per API token
const CHUNK=20                       // segmentów na wywołanie API (XLIFF/PPTX)
// w projektach i napisach CHUNK=15 (inlined w funkcjach)
// TOKENS_PER_PLN usunięty — zastąpiony przez estimateCredits(chars)
```

### Wzorzec tłumaczenia (batch + retry)

1. Segmenty dzielone na chunki po `CHUNK`
2. Każdy chunk = jedno wywołanie `apiCall()` z JSON prompt
3. Sprawdzane klucze odpowiedzi — brakujące idą do `failed[]`
4. Retry failed — jeden segment = jedno wywołanie
5. Po zakończeniu: `pushTMBatch` (zapis do TM) + `deductCredits(charsThisBatch, ...)`

### Ekrany auth — layout split-screen

Każdy ekran auth ma strukturę:
```html
<div class="auth-screen" id="screen-*">
  <div class="auth-split-left">   ← ciemny panel: logo, tagline, bullets
  <div class="auth-split-right">  ← jasny panel: przycisk Wróć + formularz (.auth-box)
```

**Klasy CSS lewego panelu:** `.auth-left-logo`, `.auth-left-tag` (kolor `#4CDE80`), `.auth-left-bullets`, `.auth-left-bullet` (z `::before` ✓)

**Klasy CSS prawego panelu:** `.auth-back-btn` (position:absolute, top-left), `.auth-box` (max-width:400px, transparent), `.auth-title`, `.auth-sub`

**Walidacja inline:** `.auth-field-msg` + `.show.error/.ok`; klasy na input: `.field-invalid` / `.field-valid`

**Loading state:** `.auth-btn.loading` — opacity + spinner `::after` + `pointer-events:none`

**Responsive:** `@media(max-width:700px)` — `.auth-split-left{display:none}`, `.auth-split-right{width:100%}`

Dark mode: `body.dark .auth-split-left{background:#111}`, `body.dark .auth-split-right{background:#0f0f0f}`, `body.dark .auth-btn{background:#4CDE80;color:#000}`

### Landing page (CSS prefix `lp-`)

Wszystkie style landing page używają prefixu `lp-` (unika kolizji z CSS aplikacji). Dark mode przez `body.dark .lp-*`. Płynne przewijanie: `html { scroll-behavior: smooth }`. Anchory: `#cennik`, `#kontakt`.

---

## Zasady przy edycji

### Czego nie ruszać

- **Supabase credentials** (`SB_URL`, `SB_KEY`) — anon key w kliencie jest normalny dla Supabase z RLS
- **Wywołanie Anthropic w Cloudflare Function** — musi zostać w `functions/api/translate.js` (backend-proxy). NIE przenosić do przeglądarki: klucz `env.ANTHROPIC_API_KEY` nigdy w kliencie, header `x-api-key` + `anthropic-version: 2023-06-01` ustawiane po stronie serwera. Frontend woła tylko `/api/translate` z tokenem Supabase
- **`XLIFF_NS`** — przestrzeń nazw XLIFF 1.2: `'urn:oasis:names:tc:xliff:document:1.2'`
- **`applyRunText`** — skomplikowana logika podziału tekstu między `<r>` runy w PPTX; zmiana psuje formatowanie
- **CSS reguły dark mode** — obszerne, często z `!important`; przy nowych elementach zawsze dodaj parę `body.dark .klasa`
- **`deductTokens`** — to alias do `deductCredits`, zachowany dla backward compat; nie usuwaj

### Na co uważać

- **Duplikat `buildDictPrompt`** — dwie deklaracje na końcu sekcji DICTIONARY (JS bierze ostatnią); nie dodawaj kolejnej
- **`tmCache[]`** — rolling cache (max 1000 wpisów), nie pełna kopia bazy; do lookup używaj `lookupTMBatch` (RPC)
- **Model AI** — `claude-sonnet-4-6`; przy zmianie upewnij się że model istnieje
- **Stripe checkout** — `startCheckout()` kończy się alertem; płatności niegotowe, admin ma ręczne doładowanie
- **`orgParam()`** — zawsze używaj w zapytaniach REST do filtrowania po `organization_id`
- **`PRIMARY` vs `LANGS`** — słownik i TM używają tylko `PRIMARY` (8 języków), dropdowny tłumaczeń mają pełne `LANGS` (25)
- **Słownik: status per język** — kolumna `dictionary.status` (JSONB) trzyma per język `ai`/`accepted`. Do tłumaczenia kursów/prezentacji (`buildDictPromptForChunk`) trafiają **tylko** terminy `accepted`. AI-fill oznacza wyniki jako `ai`; ręczne wpisy admina i importy = `accepted`
- **Słownik: tryb tłumacza** — `renderDict()` dla `currentRole==='translator'` deleguje do `renderDictTranslator()` (tylko przypisane języki z `organization_members.languages`, kolumna źródłowa wg `dict_source_map`, akceptacja). Zapis tłumacza **wyłącznie** przez RPC `save_dict_translation` (nie przez REST `dbPatch` — RLS + walidacja języka)
- **Słownik: mapa źródeł** — `dict_source_map` (per język docelowy: `Polish`/`English`); EN zawsze z PL. Fallback gdy brak wpisu: EN jeśli termin ma EN, inaczej PL. Edycja tylko admin (panel `admin-only` w tab-dict)
- **Zakładka Słownik dostępna dla tłumacza** — sidebar-item `data-tab="dict"` NIE ma `hide-translator` (usunięte); tłumacz potrzebuje słownika. `loadNotifications()` ładuje się też dla translatora
- **`tokens_balance`** — kolumna przechowuje teraz kredyty (nie tokeny API); nie zmieniać nazwy w bazie
- **Landing vs App tabs** — `showLanding()` czyści `tab-content.active`; `showApp()` przywraca `tab-projects.active`; nie pomijaj tych wywołań
- **`showLanding()` vs `_showLanding()`** — publiczna wersja robi pushState (dodaje wpis do historii przeglądarki); wewnętrzna `_showLanding()` tylko manipuluje DOM. Użyj `_showLanding()` gdy **nie chcesz** dodawać wpisu do historii (np. w popstate handlerze). Analogicznie `showScreen()` vs `_showScreen()`
- **`dbDelete` a RLS** — `dbDelete` (przez `sbRest`) zwraca HTTP 204 nawet gdy RLS zablokuje usunięcie (0 usuniętych wierszy, brak błędu). Do usuwania rekordów chronionych RLS używaj dedykowanej RPC z `SECURITY DEFINER` (przykład: `delete_lang_assignment`)

### Przy dodawaniu nowej zakładki w aplikacji

1. Dodaj `<div class="tab-content" id="tab-X">` w HTML
2. Dodaj `.tab` w `<div class="tabs">`
3. Dodaj `'X'` do tablicy `names` w `switchTab()`
4. Dodaj `if(name==='X')...` w ciele `switchTab()`
5. Dodaj reguły dark mode dla nowych elementów

### Przy dodawaniu elementów na landing page

1. Używaj prefixu CSS `lp-`
2. Dodaj wariant `body.dark .lp-nowa-klasa`
3. Dodaj responsive w istniejących `@media` blokach landing page
4. Nowe anchory scroll (`#nazwa`) dodaj do nav jako `<a class="lp-nav-link" href="#nazwa">`

---

## Zasady commitowania

- **Język commitów: polski**
- Styl: imperatyw, zwięźle, bez kropki na końcu

### Format

```
<co zrobiono>

opcjonalne szczegóły (jeśli nieoczywiste)
```

### Przykłady z historii projektu

```
dodanie landing page przed logowaniem
zmiana systemu tokenów na kredyty (1 kredyt = 1000 znaków = 1 PLN)
dodanie strony Cennik na landing page
poprawki landing page i cennika
zmiana logo z emoji na plik graficzny
```

---

## Środowisko i deployment

- Aplikacja uruchamiana przez otwarcie `index.html` w przeglądarce lub przez Cloudflare Pages
- Brak procesu build — edytuj `index.html` bezpośrednio
- Testy manualne w przeglądarce (brak testów automatycznych)
- Git branch: `main` (jedyna gałąź)
- Formularz kontaktowy: Formspree `meenlzod` → `zloty05@gmail.com`
