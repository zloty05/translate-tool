# CLAUDE.md — TranslateScorm

## Opis aplikacji

TranslateScorm to wielotenantowa aplikacja SaaS do tłumaczenia materiałów e-learningowych. Obsługuje pliki XLIFF (Articulate Storyline), PPTX (PowerPoint) i napisy (SRT/VTT). Tłumaczenia wykonywane są przez Claude API (`claude-sonnet-4-6`) — przeglądarka woła wyłącznie backend-proxy `/api/translate`, klucz API nigdy nie trafia do klienta. Aplikacja zarządza organizacjami, zespołami tłumaczy, pamięcią tłumaczeń (TM) i słownikiem terminologii — dane synchronizowane przez Supabase. Rozliczenie oparte na kredytach: 1 kredyt = 1 000 znaków = 1 PLN.

---

## Struktura projektu

```
translate-tool/
├── public/                 ← WSZYSTKO, co trafia do internetu (i tylko to)
│   ├── index.html          ← markup (landing, ekrany auth, app-shell, zakładki, modale)
│   ├── css/app.css         ← wszystkie style (w tym dark mode)
│   ├── js/01-24*.js        ← kod aplikacji, ładowany po kolei jako skrypty globalne
│   ├── _headers            ← nagłówki HTTP (wyłączenie cache dla js/css)
│   └── logoSmall.png       ← logo (favicon + nav + auth + sidebar)
├── functions/api/          ← Cloudflare Pages Functions (translate.js, invite.js)
├── supabase/               ← config.toml + migrations/ (Supabase CLI)
├── sql/                    ← archiwum migracji sprzed CLI (nie dodawaj tu nowych)
├── .dev.vars.example       ← wzorzec zmiennych dla lokalnych Functions
├── CLAUDE.md               ← ten plik
└── DEPLOYMENT.md           ← instrukcja wprowadzania zmian i wdrożeń
```

**Podział `public/` vs reszta jest granicą bezpieczeństwa**, nie tylko porządkiem. Publikowany jest wyłącznie `public/` — nowy plik statyczny umieszczaj tam, a wszystko inne (migracje, dokumentacja, konfiguracja) zostaw poza nim. Szczegóły w sekcji „Co jest publikowane".

**Numeracja `js/*.js` jest znacząca** — pliki ładują się w kolejności z `index.html`, wszystko trafia do globalnego scope (brak modułów ES, brak bundlera). Stałe i funkcje muszą być zdefiniowane w pliku o niższym numerze niż ten, który ich używa.

Nie ma node_modules ani kompilacji — edytujesz plik i odświeżasz przeglądarkę.

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
| LANGUAGES | Tablica `LANGS[]` (30 języków), `PRIMARY_FALLBACK` (8 domyślnych dla słownika), `langOptionsHTML()`; konfiguracja słownika per org: `dictLangs()`, `dictBaseLang()`, `dictLangOrder()` |
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
| `save_org_dict_config(org_id, langs, base_lang, source_map)` | Atomowy zapis konfiguracji słownika org; tylko admin. Odrzuca: usunięcie języka z tłumaczeniami, bazę w zbiorze celów, mapę spoza `langs ∪ {base_lang}`, samoodniesienia i cykle |

**Definicje SQL:**
- `sql/dict_approval_workflow.sql` — status per język + `save_dict_translation` + `notify_translators`
- `sql/dict_multitenant.sql` — konfiguracja słownika per org: kolumny, backfill z realnych danych, materializacja mapy źródeł, `save_org_dict_config`, rozszerzona `save_dict_translation`, zapytania kontrolne (sekcja 7 — po migracji 7a i 7b muszą zwrócić 0 wierszy)

Oba pliki uruchamia się jednorazowo w Supabase → SQL Editor.

### Tabele Supabase

`organizations` (m.in. `dict_langs` **`text[]`** — języki słownika tenanta; `dict_base_lang` `text` — język terminu w `dictionary.src`; `dict_source_map` JSONB — mapa źródeł per język docelowy), `organization_members` (m.in. `languages` **`text[]`** — przypisane języki słownika tłumacza; w RPC używaj `lang = ANY(languages)`, nie operatorów jsonb), `invitations`, `projects`, `project_segments`, `project_language_assignments`, `translation_memory`, `dictionary` (m.in. `translations` JSONB + `status` JSONB per język: `ai`/`accepted`), `translation_history`, `token_transactions`, `notifications`, `profiles`, widok `member_emails`

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

### Scalanie segmentów z indeksem górnym (®, mm²) — [15-xliff.js](public/js/15-xliff.js)

Storyline rozbija zdanie na osobne `<g ctype="x-text">` przy **każdej** zmianie stylu, więc
`WINSTA®` to trzy fragmenty: `"…systemie WINSTA"`, `"®"`, `". "`. Tłumaczone osobno tracą
kontekst — model przestawia szyk, a ® zostaje przyklejone do **pozycji**, nie do słowa
(`"training®"` zamiast `"WINSTA®"`).

Dlatego segment zawierający fragment `Superscript` idzie do modelu **jako całe zdanie**,
jednym itemem, a odpowiedź rozcinamy w kodzie. Kluczowe funkcje:

| Funkcja | Rola |
|---|---|
| `isSupNode(g)` | Czy `<g>` jest w indeksie górnym — czyta `Elevation="Superscript"` z **poprzedzającego** `<bpt ctype="x-style">` (styl jest rodzeństwem, nie rodzicem) |
| `findAnchor(prevText)` | Kotwica = ogon fragmentu przed symbolem: nazwa handlowa (`WINSTA`, `CAGE CLAMP`, `Linect`) albo jednostka (`4 mm`) — tekst niezmienny językowo |
| `splitRunByNewlines()` | Rozdziela tekst między fragmenty **bez** kotwicy (przed pierwszym i po ostatnim symbolu) |
| `splitByAnchors()` | Główna funkcja rozcinania; zwraca `null` → wołający robi fallback |
| `isUntranslatable(text)` | Fragment bez litery i cyfry (`'.'`, `'®'`) — nie wysyłamy do modelu ani do TM |

**Zasady, których nie wolno naruszyć:**

- **Model nigdy nie decyduje o pozycji symbolu.** ® przepisujemy dosłownie z oryginału.
  Odrzucone (świadomie): znaczniki granic w tekście, cięcie proporcjonalne do długości,
  pytanie modelu o `parts` — wszystkie oddają podział modelowi i są niedeterministyczne.
- **`splitByAnchors` zwraca `null` zamiast zgadywać.** Fallback daje wynik jak przed
  naprawą — ® może wylądować nie tam, ale **żaden wiersz nie jest pusty i nic nie jest
  zlepione**. Utrata treści jest gorsza niż źle postawiony symbol.
- **Bramka końcowa liczy fragmenty z treścią po obu stronach.** Sprawdzanie „czy pusty"
  osobno dla każdego przepuszczało zlepki: fragment `'
'` wypadał z kontroli, a jego
  treść lądowała w sąsiedzie.
- **Głowa i ogon używają tego samego helpera.** Przy pierwszej naprawie zduplikowałem tę
  logikę i poprawiłem tylko ogon — ten sam błąd wrócił po drugiej stronie symbolu.

**Kolejność w projektach ma znaczenie** ([17-projects.js](public/js/17-projects.js)):
`buildAIWorkItems` wymaga, by grupa pokrywała **wszystkie** niepuste `<g>` jednostki
(`segs.length===need`). Odsianie `isUntranslatable` **przed** grupowaniem zostawia grupę
niekompletną, warunek zawodzi i scalanie w ogóle się nie uruchamia. Grupuj najpierw,
filtruj potem.

**Podgląd pełnego zdania** — `needsCtxPreview` / `ctxSentenceHTML` renderują w edytorze
zwinięty `<details>` z całym zdaniem i wyróżnionym fragmentem. Po rozcięciu granice nie
pokrywają się z granicami w źródle, więc pojedynczy wiersz potrafi wyglądać jak błąd.
Dane biorą się z `metadata.allTextNodes`; **stare projekty nie mają tam `isSup`/`blockIdx`
i idą dotychczasową ścieżką** — to zamierzone, brak regresji.

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
- **`splitByAnchors` i spółka** — rozcinanie segmentów z ®/²; szczegóły w sekcji „Scalanie segmentów z indeksem górnym". Zwrot `null` to **poprawna** odpowiedź (fallback), nie błąd do naprawienia
- **Style w `<bpt>` nigdy nie są odtwarzane** — eksport klonuje `<source>` i podmienia wyłącznie `textContent` każdego `<g>` ([15-xliff.js](public/js/15-xliff.js), [17-projects.js](public/js/17-projects.js)). Formatowanie pochodzi z pliku klienta i nigdy go nie opuszcza; nie ma kodu, który „decyduje", co pogrubić
- **CSS reguły dark mode** — obszerne, często z `!important`; przy nowych elementach zawsze dodaj parę `body.dark .klasa`
- **`deductTokens`** — to alias do `deductCredits`, zachowany dla backward compat; nie usuwaj

### Na co uważać

- **`buildDictPrompt`** — cienki wrapper na `buildDictPromptForChunk` (bez chunku, źródłem język bazowy org). Nie ma dziś wywołań; wszystkie 4 ścieżki AI wołają `buildDictPromptForChunk` bezpośrednio. Wcześniejszy duplikat deklaracji został usunięty — nie dodawaj kolejnej
- **`tmCache[]`** — rolling cache (max 1000 wpisów), nie pełna kopia bazy; do lookup używaj `lookupTMBatch` (RPC)
- **`pushTMBatch` filtruje `isUntranslatable`** ([10-tm.js](public/js/10-tm.js)) — fragmenty typu `'®'`, `'.'`, `'?'` nie są jednostkami tłumaczeniowymi i tylko zaśmiecają TM (z jednego kursu ponad 100 par `'®' => '®'`). Filtr siedzi w **jednym wspólnym wejściu** dla wszystkich czterech miejsc zapisu — nie duplikuj go u wołających
- **Model AI** — `claude-sonnet-4-6`; przy zmianie upewnij się że model istnieje
- **Stripe checkout** — `startCheckout()` kończy się alertem; płatności niegotowe, admin ma ręczne doładowanie
- **`orgParam()`** — zawsze używaj w zapytaniach REST do filtrowania po `organization_id`
- **`dictLangs()` vs `LANGS`** — słownik używa `dictLangs()` (konfiguracja per org, patrz niżej); dropdowny tłumaczeń i TM mają pełne `LANGS` (30). TM jest całkowicie language-agnostyczny — filtr języków buduje z danych (RPC `get_tm_stats`), nie ze stałej listy
- **Słownik: języki per tenant** — zestaw języków słownika trzyma `organizations.dict_langs` (`text[]`), a język terminu źródłowego (kolumna `dictionary.src`) — `organizations.dict_base_lang`. W kodzie **nigdy nie iteruj po `PRIMARY`** w kontekście słownika — używaj `dictLangs()`. `PRIMARY_FALLBACK` (8 języków) służy wyłącznie jako domyślna lista, gdy org nie ma jeszcze konfiguracji
- **Słownik: graf źródeł** — `dict_source_map` mapuje cel → źródło i dopuszcza **dowolny** język tenanta (nie tylko PL/EN). Pozwala mieć np. `Ukrainian z Polish` obok `Czech z English` w jednej org. Trzy niezmienniki pilnowane przez RPC `save_org_dict_config` i UI: brak cykli, brak samoodniesień, każda ścieżka kończy się w języku bazowym. Brak wpisu = źródłem język bazowy
- **AI-fill kolejność** — `fillDictWithAI()` iteruje `dictLangOrder()` (sort topologiczny wg grafu źródeł) **po językach z zewnątrz**, dopiero wewnątrz po terminach. Odwrotne zagnieżdżenie zepsułoby zależności: tłumaczenie z EN startowałoby, zanim EN zostanie zapisane. Tekst źródłowy rozwiązywany jest tuż przed wysłaniem chunka (`resolveSrc`), bo źródło mogło powstać we wcześniejszym chunku tego samego przebiegu
- **Słownik: status per język** — kolumna `dictionary.status` (JSONB) trzyma per język `ai`/`accepted`. Do tłumaczenia kursów/prezentacji (`buildDictPromptForChunk`) trafiają **tylko** terminy `accepted`. AI-fill oznacza wyniki jako `ai`; ręczne wpisy admina i importy = `accepted`
- **Słownik: tryb tłumacza** — `renderDict()` dla `currentRole==='translator'` deleguje do `renderDictTranslator()` (tylko przypisane języki z `organization_members.languages`, kolumna źródłowa wg `dict_source_map`, akceptacja). Zapis tłumacza **wyłącznie** przez RPC `save_dict_translation` (nie przez REST `dbPatch` — RLS + walidacja języka)
- **Słownik: mapa źródeł** — `dict_source_map` (per język docelowy → dowolny język tenanta lub bazowy). Fallback gdy brak wpisu: język bazowy org. Edycja tylko admin, w panelu `#dict-srcmap-panel` (`admin-only`) w tab-dict, razem z językami i językiem bazowym. Zmiany trzymane są w stanie roboczym `_dictCfg` i zapisywane jednym RPC `save_org_dict_config` — nie zapisuj przez `dbPatch` na `organizations`
- **Zakładka Słownik dostępna dla tłumacza** — sidebar-item `data-tab="dict"` NIE ma `hide-translator` (usunięte); tłumacz potrzebuje słownika. `loadNotifications()` ładuje się też dla translatora
- **`tokens_balance`** — kolumna przechowuje teraz kredyty (nie tokeny API); nie zmieniać nazwy w bazie
- **Landing vs App tabs** — `showLanding()` czyści `tab-content.active`; `showApp()` przywraca `tab-projects.active`; nie pomijaj tych wywołań
- **`showLanding()` vs `_showLanding()`** — publiczna wersja robi pushState (dodaje wpis do historii przeglądarki); wewnętrzna `_showLanding()` tylko manipuluje DOM. Użyj `_showLanding()` gdy **nie chcesz** dodawać wpisu do historii (np. w popstate handlerze). Analogicznie `showScreen()` vs `_showScreen()`
- **`dbDelete` a RLS** — `dbDelete` (przez `sbRest`) zwraca HTTP 204 nawet gdy RLS zablokuje usunięcie (0 usuniętych wierszy, brak błędu). Do usuwania rekordów chronionych RLS używaj dedykowanej RPC z `SECURITY DEFINER` (przykład: `delete_lang_assignment`)

### Pułapki diagnostyczne

Rzeczy, które w tej sesji doprowadziły do błędnych wniosków — warto znać, zanim się na nie natknie ponownie:

- **Test RPC przez `curl` wymaga kompletu argumentów.** Wysłanie pustego `{}` daje `Could not find the function public.<nazwa>(...)` — komunikat brzmi jak brak funkcji, a w rzeczywistości oznacza niedopasowanie sygnatury. Na tej podstawie postawiłem raz błędną diagnozę „RPC nie istnieje", choć istniała. Wysyłaj wszystkie parametry; funkcja obecna odpowie `Unauthorized` (P0001), nie `PGRST202`.
- **HTTP 200 na dowolnej ścieżce to często fallback SPA, nie realny plik.** `/public/js/cokolwiek` zwracało 200, bo Cloudflare serwuje `index.html` przy nieznanym adresie. Rozstrzyga dopiero porównanie treści: plik SQL zaczyna się od `--`, fallback od `<!DOCTYPE html>`.
- **`wrangler pages dev` zostawia drzewa procesów** bash→node→cmd→node→workerd. Samo `taskkill //F //IM workerd.exe` nie wystarcza — potomkowie odradzają się z żywego rodzica, a port zostaje zajęty (połączenia wiszą w CLOSE_WAIT). Znajdź korzeń przez `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'wrangler' }` i zabij z `/T /PID <korzeń>`.
- **Watcher wranglera potrafi wpaść w pętlę reloadów**, jeśli katalogiem zasobów jest root repo — widzi wtedy własne zapisy w `.wrangler/tmp/`. Po przejściu na `public/` problem zniknął.
- **Po wdrożeniu weryfikuj build, nie domenę.** Domena bywa opóźniona o cache CDN; adres konkretnego deploymentu (`<hash>.translate-tool.pages.dev`) pokazuje prawdę od razu.

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

### Trzy środowiska

| | Produkcja | Test | Lokalne |
|---|---|---|---|
| Adres | translatescorm.com | test.translatescorm.com | localhost:8788 |
| Gałąź git | `main` | `test` | — |
| Supabase | `lzklxvdzyslpwugjvvtj` | `ejtorsngzodkxrbvmybc` | `127.0.0.1:54321` (Docker) |
| Studio | panel supabase.com | panel supabase.com | http://127.0.0.1:54323 |
| Maile | Resend → realna skrzynka | Resend → realna skrzynka | Mailpit :54324 |

Wybór jest **automatyczny**, po `location.hostname` — funkcja `pickEnv()` w [public/js/01-supabase.js](public/js/01-supabase.js). Dopasowanie jest **dokładne, nie po sufiksie**: gdyby użyć wzorca `/\.translatescorm\.com$/`, subdomena testowa wpadłaby w gałąź produkcyjną i pisała do bazy produkcyjnej.

Nieznany host → **local**, nigdy prod: pomyłka w konfiguracji kieruje do bazy lokalnej. Gdy środowisko nie ma skonfigurowanego URL-a, kod loguje błąd i schodzi na local zamiast po cichu użyć produkcji.

W środowisku nieprodukcyjnym w rogu ekranu widnieje pomarańczowy znacznik `#env-badge` z nazwą środowiska i adresem bazy.

**Nie zaszywaj domeny w kodzie** — używaj `location.origin` (rejestracja, linki zaproszeń). Inaczej testy przekierują użytkownika na produkcję.

### Model pracy z gałęziami

```
zmiana → gałąź test → weryfikacja na test.translatescorm.com → merge do main → produkcja
```

Jedno repo, dwie gałęzie. Cloudflare Pages buduje każdą osobno; środowiska rozdziela konfiguracja (baza, adres, zmienne), a nie osobne repozytoria — dzięki temu wdrażasz dokładnie ten commit, który przetestowałeś.

**Zmienne środowiskowe w Cloudflare Pages są osobne dla Production i Preview.** Przełącznik „Choose Environment" jest u góry ekranu Settings. W Preview `SUPABASE_URL`/`SUPABASE_ANON_KEY` muszą wskazywać projekt testowy. Przeglądarka wybiera bazę po hostname, ale [functions/api/translate.js](functions/api/translate.js#L8-L9) czyta `env.*` — rozjazd między nimi daje **ciche 401** z `/api/translate` przy pozornie działającej aplikacji.

### Jak subdomena jest związana z gałęzią

To powiązanie **nie istnieje nigdzie w panelu Cloudflare** — żyje wyłącznie w rekordzie DNS:

```
CNAME  test  →  test.translate-tool.pages.dev
                ^^^^ nazwa gałęzi
```

Pages nadaje każdej gałęzi **nieprodukcyjnej** alias `<gałąź>.<projekt>.pages.dev`. Nazwa gałęzi jest zaszyta w celu CNAME i to jest całe wiązanie. Trzy konsekwencje:

- **Kreator „Set up a custom domain" nigdy nie pyta o gałąź** — zawsze proponuje CNAME na produkcję (`translate-tool.pages.dev`). Trzeba go kliknąć (rejestruje domenę w projekcie), a potem **ręcznie podmienić cel w DNS** na alias gałęzi. Tak działa [oficjalna procedura Cloudflare](https://developers.cloudflare.com/pages/how-to/custom-branch-aliases/).
- **Proxy musi być włączone** (pomarańczowa chmurka). Przy wyłączonym Cloudflare i tak przekieruje na produkcję.
- **Alias powstaje tylko dla deploymentów typu Preview.** Jeśli gałąź zostanie ustawiona jako Production branch, aliasu nie ma i subdomena zwraca **522**. Wtedy sprawdź Settings → Build → Branch control: Production branch musi być `main`.

### Uruchomienie lokalne

```bash
supabase start                 # Postgres+Auth+Storage w Dockerze
npx wrangler pages dev public --port 8788   # katalog jawnie, bo brak assets w wrangler.jsonc
```

Oba są potrzebne. **Otwarcie `index.html` przez `file://` nie zadziała** — `/api/translate` to ścieżka absolutna, a Supabase Auth odrzuca origin `null`. Zwykły serwer HTTP też nie wystarczy: nie wykona Pages Functions, więc `/api/*` zwróci 404.

Przed pierwszym uruchomieniem: `cp .dev.vars.example .dev.vars` i uzupełnij `ANTHROPIC_API_KEY` (jedyny sekret bez lokalnego zamiennika). Potwierdzenia email są lokalnie wyłączone (`enable_confirmations = false`), więc rejestracja od razu daje sesję.

### Migracje bazy

Katalog `supabase/migrations/` — pliki stosowane **w kolejności leksykalnej nazw**, więc prefiks czasowy `YYYYMMDDHHMMSS_` jest obowiązkowy.

```bash
supabase migration new nazwa_zmiany   # nowy plik z prefiksem
supabase db reset                     # odtworzenie bazy lokalnej od zera
supabase db push                      # wdrożenie na produkcję (świadoma decyzja!)
```

Kolejność ma znaczenie merytoryczne: `dict_multitenant` nadpisuje `save_dict_translation` z `dict_approval_workflow`, dokładając walidację `dict_langs`. Odwrotna kolejność cofnęłaby tę zmianę.

Katalog `sql/` to **archiwum** migracji wklejanych ręcznie do SQL Editora przed wprowadzeniem CLI. Nowych plików tam nie dodawaj.

### Co jest publikowane

**Publikowany jest wyłącznie katalog `public/`.** Wszystko poza nim (`sql/`, `supabase/`, `CLAUDE.md`, źródła `functions/`) zostaje prywatne. Nowe pliki statyczne umieszczaj w `public/`.

Sterowanie jest **w panelu Cloudflare**: Settings → Build → **Build output directory = `public`**, ustawione osobno dla Production i Preview. W `wrangler.jsonc` **nie ma** sekcji `assets` — i nie dodawaj jej: przy deployu z gita Cloudflare wchodzi najpierw do katalogu wyjściowego, więc `assets.directory` liczyłoby się względem niego i rozjeżdżało ścieżki.

[public/_headers](public/_headers) wyłącza cache dla `index.html`, `js/*` i `css/*` (`Cache-Control: no-cache` = „sprawdź u serwera przed użyciem", nie „nie cache'uj"). Bez tego po wdrożeniu przeglądarka serwuje stary JavaScript z nowym HTML-em — objawia się to np. pustym panelem konfiguracji przy poprawnych danych. Pliki nie mają wersjonowania w nazwie, więc długiego cache'owania użyć się nie da.

Historia: pierwotnie było `assets.directory: "."`, przez co całe repo trafiało do internetu — `translatescorm.com/sql/*.sql` zwracało HTTP 200 z pełnymi definicjami RPC i schematu.

### Pozostałe

- Brak procesu build — edytuj pliki bezpośrednio (`public/index.html`, `public/js/*.js`, `public/css/app.css`)
- Testy manualne w przeglądarce (brak testów automatycznych)
- Gałęzie: `main` (produkcja) i `test` (środowisko testowe)
- Formularz kontaktowy: Formspree `meenlzod` → `zloty05@gmail.com`
