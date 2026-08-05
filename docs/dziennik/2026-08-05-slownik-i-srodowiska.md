# Dzień, w którym słownik zmusił mnie do zbudowania środowiska testowego

**5 sierpnia 2026** · 6 commitów · 38 plików · +3389/−102 linii

---

Zaczęło się od drobiazgu. Założyłem nowego użytkownika z nową organizacją i zauważyłem lukę: aplikacja miała być wielotenantowa, a słownik terminologii ma stałą liczbę języków, niezależnie od tenanta. Osiem kolumn — angielski, litewski, łotewski, estoński, ukraiński, węgierski, czeski, słowacki. Bez możliwości konfiguracji.

To słabe, bo każdy klient tłumaczy na coś innego. Firma z Wrocławia potrzebuje czeskiego i słowackiego, ktoś inny hiszpańskiego. A dostają wszyscy to samo.

Skończyło się osiem godzin później zbudowaniem od zera środowiska testowego, procesu migracji bazy i naprawą dziury, przez którą moje pliki SQL leżały publicznie w internecie.

---

## Ograniczenie było w jednym miejscu

Pierwsze zaskoczenie: limit ośmiu języków nie miał nic wspólnego z bazą danych.

```js
const PRIMARY = LANGS.filter(l => l.primary);
```

Jedna linia w `js/03-languages.js`. Osiem języków oflagowanych `primary: true` w tablicy — i od tego zależało wszystko: kolumny tabeli, pola formularza, kolumny eksportu do Excela, pętla uzupełniania przez AI, pigułki języków w panelu zespołu.

Baza była całkowicie obojętna. Kolumna `translations` to JSONB — przyjmie dowolny klucz. Funkcje RPC też nie miały żadnej walidacji języków. Ograniczenie istniało **wyłącznie we frontendzie**, jako artefakt tego, że pisząc to pierwszy raz, miałem w głowie jednego klienta.

To dobra wiadomość: wystarczyło przenieść konfigurację do bazy. Dwie kolumny w tabeli `organizations` — lista języków i język bazowy — plus warstwa dostępu w JS zamiast czytania stałej.

## Wymaganie okazało się bogatsze

Zapytałem, jak swobodny ma być wybór źródła tłumaczenia. Odpowiedź zmieniła model:

> *„niekiedy będziemy chcieli tłumaczyć ze słownika polskiego na ukraiński, a w innym przypadku z angielskiego na czeski"*

To nie jest „lista języków". To **graf skierowany**. Każdy język docelowy może mieć własne źródło: ukraiński z polskiego, czeski z angielskiego, a angielski z polskiego.

Trzy niezmienniki, o których wcześniej nie musiałem myśleć:
- brak cykli (czeski z ukraińskiego + ukraiński z czeskiego zawiesiłoby uzupełnianie)
- brak samoodniesień
- każda ścieżka kończy się w języku bazowym

Mechanizm częściowo już istniał — kolumna `dict_source_map` mapowała cel na źródło, tylko wartości były zablokowane do pary polski/angielski. Wystarczyło odblokować zbiór wartości i dołożyć walidację grafu, i po stronie bazy, i w interfejsie.

Przy okazji trafiłem na pułapkę, której nie zauważyłbym bez testu. Uzupełnianie słownika przez AI iterowało po terminach, a wewnątrz po językach. Przy takim zagnieżdżeniu sortowanie topologiczne jest bezużyteczne: czeski tłumaczony z angielskiego startuje, zanim angielski dla tego samego terminu zostanie zapisany. Odwrócenie pętli — najpierw języki, potem terminy — naprawiło to.

## Warunek, który trzeba było zmierzyć

Postawiłem twardy wymóg: **nic nie może się zmienić przy tłumaczeniu kursów przez AI**. Słownik zasila prompty tłumaczeniowe i nie chciałem, żeby przebudowa po cichu zmieniła jakość tłumaczeń.

Zamiast zapewniać, że „nie zmieniłem tej funkcji", zrobiliśmy pomiar: wyciągnięcie funkcji budującej prompt z wersji sprzed zmian i z obecnej, uruchomienie obu na siedmiu scenariuszach i porównanie wyjścia znak po znaku.

```
identyczny  #1  Czech       170 znaków
identyczny  #2  Czech       132 znaki
identyczny  #3  English      90 znaków
identyczny  #4  Ukrainian     0 znaków
...
=== 7 identycznych, 0 różnic ===
```

Ten czwarty przypadek jest ciekawy — zero znaków, bo ukraiński termin miał status `ai`, a do promptów trafiają wyłącznie zaakceptowane. Dokładnie jak wcześniej.

To był mój ulubiony moment tego dnia. Nie „wydaje mi się, że nie zepsułem" tylko „zmierzyłem i jest bit w bit tak samo".

## I wtedy przycisk nie zadziałał

Kod gotowy, testuję lokalnie, klikam „Zapisz konfigurację":

```
Could not find the function public.save_org_dict_config(base_lang, langs, org_id, source_map)
in the schema cache
```

Frontend woła funkcję, której w bazie nie ma. Napisałem migrację SQL, ale **nigdy jej nie uruchomiłem**. Migracja leżała w pliku i czekała.

Pierwsza reakcja: wkleić SQL do edytora w Supabase i jechać dalej. Druga, po chwili: a dlaczego w ogóle mogło do tego dojść?

## Prawdziwy problem nie był w słowniku

Bo tak wyglądał wtedy mój proces:

- **Jedna baza** dla wszystkiego. Każdy eksperyment lokalny pisał do produkcji.
- **Migracje wklejane ręcznie** do SQL Editora. Zero śladu, co i kiedy zostało zastosowane.
- **Brak środowiska testowego.** „Test" to była produkcja otwarta na localhoście.

Przy takim układzie zapomniana migracja to nie wypadek, tylko kwestia czasu. I rzeczywiście — sprawdzenie pokazało później, że produkcyjna baza miała kolumnę `dict_langs`, ale nie miała `dict_base_lang` ani nowej funkcji. Ktoś (ja) kiedyś uruchomił fragment SQL ręcznie i zapomniał o reszcie.

Postanowiłem nie łatać objawu.

## Trzy środowiska

Supabase CLI i Docker były już zainstalowane — nie wiedziałem, że tyle z nich wyciągnę.

`supabase db pull` ściągnął schemat produkcji do repo. **Pełny schemat po raz pierwszy w historii projektu** — 14 tabel, 23 funkcje RPC, komplet reguł RLS. Wcześniej istniał wyłącznie w chmurze; w repo leżały trzy przypadkowe pliki SQL, które nie opisywały nawet połowy.

Potem drugi projekt Supabase (darmowy), gałąź `test` w gicie i subdomena `test.translatescorm.com`. Klient wybiera bazę po adresie strony:

```js
if (h === 'translatescorm.com') return ENVS.prod;
if (h === 'test.translatescorm.com') return ENVS.test;
return ENVS.local;
```

Dopasowanie dokładne, nie po sufiksie — pierwsza wersja używała wzorca `/\.translatescorm\.com$/` i **subdomena testowa wpadałaby w gałąź produkcyjną**. Nieznany adres trafia do bazy lokalnej: pomyłka w konfiguracji ma kierować w stronę bezpieczną.

## Co poszło nie tak po drodze

Byłoby nieuczciwe napisać, że to poszło gładko. Nie poszło.

**Dwa projekty Cloudflare z tego samego repo.** Jeden Pages, jeden Worker — pozostałość po jakiejś autokonfiguracji z kwietnia. Każdy push budował się dwa razy, w dwóch miejscach.

**Subdomena wskazywała na produkcję.** Kreator „Set up a custom domain" nigdy nie pyta o gałąź — zawsze proponuje CNAME na produkcję. Powiązanie subdomeny z gałęzią nie istnieje nigdzie w panelu; żyje wyłącznie w rekordzie DNS, jako nazwa gałęzi zaszyta w celu CNAME. Trzeba to podmienić ręcznie, po aktywacji domeny.

**Build gałęzi `test` wylądował jako produkcja.** A ponieważ alias `test.translate-tool.pages.dev` powstaje tylko dla deploymentów typu Preview, subdomena zwracała 522 — CNAME wskazywał cel, którego nie było.

**Pliki SQL leżały publicznie.** `wrangler.jsonc` miał `assets.directory: "."`, czyli publikował całe repo. Sprawdziłem — `translatescorm.com/sql/dict_approval_workflow.sql` zwracało HTTP 200 wraz z pełnymi definicjami funkcji i schematu. Do tego `CLAUDE.md` i sam `wrangler.jsonc`. Naprawa: przeniesienie zasobów do `public/` i wskazanie tego katalogu jako wyjściowego.

To ostatnie miało jeszcze drugie dno. Ustawienie „Build output directory" w panelu **było ignorowane**, bo `wrangler.jsonc` z repo ma pierwszeństwo, a jego `assets.directory` liczy się względem katalogu wyjściowego — oba ustawienia się wykluczały. Rozwiązanie: usunąć `assets` z pliku i zostawić sterowanie panelowi.

**Na koniec cache przeglądarki.** Panel konfiguracji był pusty mimo poprawnych danych. Symulacja z produkcyjnymi danymi generowała osiem wierszy tabeli, więc kod działał. Przeglądarka miała nowy HTML i stary JavaScript. `Ctrl+Shift+R` naprawił, a plik `public/_headers` naprawił u źródła — żeby użytkownicy nie musieli tego wiedzieć.

## Migracja bez utraty danych

Ostatni etap: wgranie migracji na produkcję, gdzie jest osiem organizacji z prawdziwymi słownikami.

Backfill był zaprojektowany zachowawczo. Lista języków wyliczana jako **suma** trzech zbiorów: klucze faktycznie występujące w tłumaczeniach, języki przypisane członkom zespołu i domyślna ósemka. Suma, nie przecięcie — dzięki temu nic nie mogło wypaść z widoku.

Do tego zapytanie kontrolne, które trzeba było uruchomić po migracji:

```
Success. No rows returned
```

Zero osieroconych tłumaczeń. Wszystkie osiem organizacji dostało `dict_base_lang: Polish` i te same osiem języków co wcześniej — czyli nikt nie zobaczy zmiany, dopóki sam nie przestawi konfiguracji.

## Czego się nauczyłem

**Najdroższa nie była funkcja, tylko brak środowiska do jej sprawdzenia.** Sam słownik multitenant to kilka godzin. Reszta dnia poszła na infrastrukturę, której brak wyszedł na jaw dopiero wtedy, gdy coś przestało działać.

**Weryfikuj pomiarem, nie założeniem.** Kilka razy tego dnia „oczywista" diagnoza okazała się fałszywa. Raz uznałem, że funkcja RPC nie istnieje — bo testowałem ją pustym `{}`, co daje komunikat brzmiący identycznie jak brak funkcji. Innym razem, że produkcja padła — a to ja straciłem łączność sieciową. Za każdym razem ratowało to samo: sprawdzić jeszcze raz, innym sposobem.

**Ograniczenia bywają płytsze, niż wyglądają.** Limit ośmiu języków wyglądał na decyzję architektoniczną, a był jedną linią filtra we frontendzie. Zanim zaplanujesz przebudowę, sprawdź, gdzie faktycznie leży problem.

**Migracje to nie SQL, tylko proces.** Plik z SQL-em, którego nikt nie uruchomił, jest wart tyle co pusty plik. Dopiero `supabase migration list` pokazujący zgodność wersji lokalnej ze zdalną coś znaczy.

---

Aplikacja jest dziś w lepszym stanie niż rano. Nie dlatego, że słownik ma konfigurowalne języki — choć ma. Dlatego, że następnym razem, gdy coś pójdzie nie tak, będę miał gdzie to sprawdzić przed wypuszczeniem na klientów.
