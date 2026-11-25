# Choreografia w Experience: wstawanie na refreny, kręcenie w rytm, zmiany pozycji z muzyką

Status: propozycja do decyzji właściciela (2026-11-25). Dokument tylko projektowy, bez zmian w kodzie.
Podstawa: [audyt muzyki](../research/experience-music-audit.md) (stan `main` po #144).

## 1. Cel

Experience ma być **choreografią**, nie „treningiem z muzyką w tle": wstajemy na refren, kręcimy w rytm
(kadencja = BPM/2 lub BPM), siadamy w przerwie, a sygnał na ekranie i w dźwięku pada na takt, nie na sekundę z planu.

Dziś (audyt): utwór startuje od 0 s na początku slotu i jest ucinany na granicy slotu, więc refren pada
przypadkowo (P1, P8); tempo bywa poza oknem kadencji (P3); sygnały HUD są liczone z zegara treningu, bez wiedzy o
utworze.

## 2. Zdarzenia choreografii

| Zdarzenie | Znaczenie | Źródło dziś | Potrzebne |
|---|---|---|---|
| `stand` / `sit` | zmiana pozycji | pole `position` bloku + cue coacha `standUp`/`sitDown` | czas względem refrenu |
| `attack` | mocny start, drop | skok wysiłku ≥ próg (`attack`) | czas względem dropu |
| `onBeat` | kręć w rytm (kadencja ≈ BPM/2 lub BPM) | `rpm` bloku, `matchBpm` | siatka bitu utworu |
| `recover` | wyciszenie w przerwie/zwrotce | blok o niskim wysiłku | czas przerwy w utworze |
| `lead` | zapowiedź „za 4 takty: stań" | cue `pre` ze stałym `inSec` | odliczanie w taktach |

Zasada nadrzędna: **choreografia nie zmienia wysiłku, kadencji bloku ani łącznego czasu stania**; trening (tabela
effort, `rpm`, pozycje) pozostaje źródłem prawdy. Choreografia decyduje tylko *kiedy dokładnie* w obrębie planu.

## 3. Skąd brać strukturę utworu: opcje

Fakty: oficjalne źródła struktury (Spotify audio-analysis) są zamknięte dla nowych aplikacji; AcousticBrainz (CC0)
jest zamrożony i nie ma refrenów; osadzony odtwarzacz YouTube to cross-origin iframe, więc **aplikacja nie ma dostępu
do audio ani do jego widma** (Web Audio API nie podłączy się do iframe). Analiza w przeglądarce jest niemożliwa.

| Opcja | Opis | Koszt | Dokładność | Prawo | Uwagi |
|---|---|---|---|---|---|
| A. Ręczny cue-sheet per utwór | autor zapisuje czasy refrenów/dropów/przerw na wgraniu YT | ok. 5–10 min na utwór | wysoka (słuchowo) | czasy to fakty, bez audio: OK | skaluje się liniowo, ale 14 utworów Neon Grid to 1–2 h |
| B. Siatka bitu z BPM + offset | `beatOffsetSec` + stałe BPM → pozycja każdego uderzenia | 1 minuta (tap tempo) | dobra dla muzyki elektronicznej o stałym tempie (Neon Grid), zła dla rocka/live | OK | daje „w rytm" i takty bez wiedzy o refrenach |
| C. Lista curated utworów z cue | tylko utwory z gotowym cue-sheetem są „choreograficzne"; reszta = tryb ręczny | 0 (to polityka, nie kod) | zależy od A/B | OK | Experience wybiera spośród curated; wymóg w testach contentu |
| D. Jednokrotna analiza offline | Essentia (AGPL-3.0, zgodna z licencją projektu) lub librosa na własnej legalnej kopii audio; wynik (czasy) wpisany do cue-sheetu | dev: godziny na narzędzie; potem ~2 min na utwór | beat dobry, sekcje wymagają ręcznej weryfikacji | **nie pobieramy audio z YouTube (ToS)**; kopia z własnej płyty/zakupu; w repo trafiają tylko czasy | pomocnik autora, nie runtime |
| E. Wykrywanie w przeglądarce | analiza dźwięku z embedu | n/d | n/d | n/d | niemożliwe (cross-origin) |
| F. „Tap" użytkownika | jeździec stuka w refren/takt przy pierwszym przejeździe, zapis lokalnie | średni (UI) | niska, ale prywatna | OK | opcja późniejsza, tryb „moje cue" |

**Rekomendacja: A + B jako rdzeń (C jako polityka), D jako pomoc autora, F odłożone.** Cue-sheet = lekki plik JSON
z czasami; autor zaczyna od siatki bitu (B, szybko, daje „w rytm" i takty) i dopisuje sekcje (A) tylko dla utworów
używanych w scenariuszach. D przyspiesza strojenie siatki; nie jest warunkiem startu.

## 4. Format danych: cue-sheet

Jeden plik na utwór: `src/content/cue-sheets/<songKey>.json` (`songKey` = klucz z `slot-plan`, `artist-title`),
osobne wpisy dla każdego **wgrania** (`recordings`), bo YouTube ma różne wersje (intro, długość).

```json
{
  "schemaVersion": 1,
  "song": { "artist": "Kavinsky", "title": "Nightcall" },
  "bpm": 91,
  "beatsPerBar": 4,
  "recordings": [
    { "id": "MV_3Dpw-BRY", "durationSec": 257, "beatOffsetSec": 4.12 },
    { "id": "46qo_V1zcOM", "durationSec": 261, "beatOffsetSec": 6.12 }
  ],
  "sections": [
    { "t": 0,   "kind": "intro" },
    { "t": 33,  "kind": "verse" },
    { "t": 90,  "kind": "chorus" },
    { "t": 150, "kind": "break" },
    { "t": 180, "kind": "chorus" },
    { "t": 240, "kind": "outro" }
  ],
  "cues": [
    { "t": 90,  "action": "stand", "lengthBars": 16, "label": "refren 1" },
    { "t": 150, "action": "sit" },
    { "t": 180, "action": "stand", "lengthBars": 16 }
  ]
}
```

- Czasy `t` są w czasie **pierwszego wgrania**; `recordings[].beatOffsetSec` przesuwa siatkę dla innych wgrań
  (a `sectionShiftSec`, opcjonalnie, całą oś). Wgranie spoza listy = choreografia wyłączona (sekcja 6).
- `sections` opisuje strukturę (do wyboru okna na stanie); `cues` to gotowe akcje autora (`stand`, `sit`, `attack`,
  `recover`, `onBeat` z `fromBars`/`toBars`). Brak `cues` = silnik wyprowadza je ze `sections` według reguł
  scenariusza (refren → `stand`, zwrotka → `sit`).
- Walidacja zod + test contentu: czasy rosnące, `t < durationSec`, każde `recordings[].id` występuje w
  `music-hints` lub katalogu, BPM z hintu = BPM cue-sheetu ±1.
- Rozmiar: ok. 0,6 KB na utwór; 14 utworów ≈ 9 KB.

## 5. Integracja z blokami treningu i tabelą effort

Dwa uzupełniające się mechanizmy (MVP: tylko pierwszy):

1. **Wyrównanie utworu do bloków (`anchor`)**. Zamiast przesuwać blok pod muzykę, przesuwamy utwór: dla slotu autor
   wskazuje, który moment utworu ma wypaść na start bloku (np. refren 1 → początek bloku `ng9-c`, stanie).
   `startAtSec` istnieje już (`TrackRef.startAtSec`), więc wystarczy policzyć
   `startAtSec = tChorus − (blockStart − slotStart)`. Jeśli wynik < 0, utwór startuje od 0, a engine raportuje
   „refren o X s za późno" w „Sprawdź muzykę". Rozwiązuje też P1/P8: zamiast ucinania na przypadkowym fragmencie
   dobieramy okno utworu.
2. **Okna w obrębie slotu**: blok stania (np. 45 s) ląduje na refrenie z cue-sheetu, jeśli sloty są dłuższe niż
   utwór/refren. Tylko jako sugestia dla autora scenariusza (narzędzie pokazuje rozjazd), nie automatyczna zmiana planu.

Tabela effort: choreografia jej nie zmienia. Dodatkowe testy contentu (analogiczne do `neon-grid-music-gaps.test.ts`):
- „kadencja bloków ↔ BPM": ≥ 90 % czasu utworu choreograficznego w oknie `matchBpm` (dziś: 5 slotów poniżej, audyt P3);
- „stanie na refrenie": każdy blok `standing` w slocie z cue-sheetem zaczyna się w oknie ±1 takt od `stand`;
- „sprint": jeśli blok sprintowy ma rpm spoza okna BPM utworu, autor wybiera: zmiana rpm bloku (np. 105 → ~87 + opór)
  albo utwór ~210 BPM; choreografia nie udaje, że pasuje.

„W rytm" liczone jest tak jak dziś (2 BPM = 1 RPM, połowa/podwójne dozwolone), ale na **rpm bloku**, a nie na zakresie
BPM slotu (naprawa błędu P5 jest warunkiem wstępnym).

## 6. Zegar utworu, synchronizacja i rozjazd

Tu tkwi główne ryzyko techniczne. Dziś dyrektor muzyki ładuje utwór `loadVideoById({startSeconds})` i liczy pozycję
z zegara treningu, bez odczytu pozycji z odtwarzacza.

**Rozwiązanie: zegar utworu (`song clock`)**: wrapper YouTube wystawia `getCurrentTime()`, `getDuration()` i stan
odtwarzacza (IFrame API je ma; obecny wrapper `youtube-provider.ts` ich nie eksponuje). Zdarzenia choreografii są
wyzwalane z **pozycji utworu**, odpytywanej co ok. 250 ms i interpolowanej `performance.now()` między odczytami;
nie z planu.

| Zagrożenie | Reakcja |
|---|---|
| Inne wgranie (inna długość/intro) | porównanie `getDuration()` z `recordings[].durationSec` (±1,5 s) → dopasowanie lub wyłączenie choreografii w slocie |
| Reklama przed/w trakcie | stan ≠ PLAYING, zmiana `getVideoData().video_id` lub skok długości → pauza choreografii, tryb ręczny do powrotu |
| Pauza / seek / buforowanie | zegar utworu śledzi odtwarzacz, nie plan; po seeku zdarzenia przeliczane od nowej pozycji |
| Opóźnienie audio (Bluetooth 150–300 ms) | globalna kalibracja audio (tap-test, jeden suwak ms), stosowana do siatki bitu i `lead` |
| Dryf siatki przy BPM niecałkowitym | `beatOffsetSec` mierzony przy 2 odległych taktach; siatka na całym utworze weryfikowana przy dodawaniu (test `endBeat − expected < 80 ms`) |
| Inna wersja (remix, live) | cue-sheet po `recordings[].id`, nie po tytule; nieznane = tryb ręczny |
| Wyłączony dźwięk / sam HUD | zdarzenia nadal z zegara utworu; gdy utwór nie gra, plan treningu |

## 7. Sygnały w HUD i w dźwięku

- **Odliczanie w taktach**: „STAŃ za 4… 3… 2… 1" na kolejnych uderzeniach (`lead`, domyślnie 1 takt = 4 uderzenia),
  zastępuje stały `inSec` cue `pre` tylko w slocie z cue-sheetem.
- **Puls rytmu**: pierścień przy kadencji pulsuje na uderzeniu siatki; pokazywany wyłącznie gdy siatka jest
  zweryfikowana (zegar utworu OK) i okno `matchBpm` dla bloku jest „on-beat/close". Bez tego nie pokazujemy, żeby
  nie obiecywać rytmu, którego nie ma.
- **Pozycja**: pasek „STAŃ / SIĄDŹ" w kolorze bloku, zsynchronizowany z refrenem; istniejące cue coacha
  `standUp`/`sitDown`/`attack` odpalane z zegara utworu.
- **Audio**: istniejące piknięcia (opcja) i głos coacha; opcjonalnie krótki akcent na takcie przed refrenem. Bez
  nakładania dźwięku na utwór poza dotychczasowymi piknięciami.
- Źródło sygnałów: nowy typ wpisu planu cue (`musicSync`), wstawiany do `buildCuePlan` z czasem w zegarze utworu;
  istniejące cue czasu treningu zostają jako rezerwa (tryb ręczny).

## 8. Tryb ręczny (brak danych)

Gdy utwór nie ma cue-sheetu, jest nieznane wgranie, trwa reklama albo zegar utworu jest niedostępny:
- trening działa jak dziś (cue z czasu planu, `pre` ze stałym `inSec`);
- „w rytm" i puls rytmu są ukryte w tym slocie;
- przed jazdą „Sprawdź muzykę" pokazuje: „Choreografia: 5 z 7 utworów" i które sloty są ręczne;
- ręczny nie jest błędem: jest pełnoprawnym trybem (większość biblioteki Soundtrack Match nie będzie miała cue).

## 9. Prawo i licencje

Cue-sheet to czasy i etykiety (fakty o strukturze), bez audio i bez tekstu utworu. Nie pobieramy dźwięku z
YouTube; analiza offline tylko z legalnej kopii autora. Spotify: tylko ścieżka YouTube w MVP (polityka Spotify
zabrania łączenia z innym serwisem i synchronizowania z wideo, patrz badanie C). Essentia/librosa jako narzędzie
autora: Essentia AGPL-3.0 jest zgodna z licencją projektu.

## 10. MVP: Neon Grid 30, 5–8 utworów z ręcznymi cue

Zakres: tylko ścieżka YouTube, tylko `neon-grid-30`, utwory z hintów: Kavinsky – Nightcall (s1), Foo Fighters –
The Pretender (s2), Alan Walker – Faded (s3), Eric Prydz – Pjanoo (s4, podjazd ze staniem), Guetta – Titanium
(alternatywa dla s4: ma wyraźniejszy refren), Tycho – Awake (s5, tylko siatka bitu, bez refrenów),
Sub Focus – Tidal Wave (s6, sprinty). **7 utworów**; Eno (s7) bez cue z założenia (cooldown).

Co działa po MVP: refren/drop startuje blok stania w s4 i blok sprintów w s6 (przez `anchor`); odliczanie w
taktach przed staniem; puls rytmu tam, gdzie kadencja mieści się w oknie; wszystkie sloty bez cue w trybie ręcznym.
Co nie: pełne 45, Spotify, kalibracja Bluetooth (stały domyślny offset), edytor w UI.

Do rozstrzygnięcia w MVP z audytu: P5 (poprawa `annotate`), P2 (nieosiągalne pozycje kolejki), sprinty 105 rpm vs 87.

## 11. Kolejność PR-ów i szacunek

| PR | Zakres | Rozmiar | Zależności |
|---|---|---|---|
| 1 | schema cue-sheetu (zod), loader, testy contentu, pierwszy plik testowy | S (≈ 250 linii) | brak |
| 2 | poprawka `annotate` (kadencja z bloków), kolejka bez nieosiągalnych pozycji, test „kadencja ↔ BPM" | S (≈ 150) | brak (można przed 1) |
| 3 | `song clock` w wrapperze YouTube: `getCurrentTime`/`getDuration`/stan, wykrywanie rozjazdu i reklam, testy z fake providerem | M (≈ 400) | brak |
| 4 | `anchor`: wyrównanie utworu do bloków (`startAtSec`), raport w „Sprawdź muzykę" | M (≈ 350) | 1 |
| 5 | sygnały: `musicSync` w `buildCuePlan`, odliczanie w taktach, pasek stania w HUD | M (≈ 450) | 1, 3 |
| 6 | narzędzie autora (dev-only strona): odtwórz wgranie, [Takt 1]/[Refren]/[Drop], tap tempo, eksport JSON | M (≈ 400) | 1, 3 |
| 7 | dane MVP: cue-sheety 7 utworów Neon Grid 30 (praca właściciela przy odsłuchu) | S (dane) | 6 |
| 8 | puls rytmu + kalibracja audio | M (≈ 350) | 3, 5 |
| później | Neon Grid 45/Light, Soundtrack Match (kolumna „ma cue"), tap użytkownika (F) | | |

Łącznie ≈ 2 400 linii kodu + dane; ścieżka krytyczna: 1 → 3 → 4/5 → 7. PR 2 i 3 można wykonać równolegle.

## 12. Pytania do właściciela

1. Czy rdzeniem ma być ręczne cue-sheet (A) z siatką bitu (B), czy wolisz analizę offline (D) jako główną drogę? (Rekomendacja: A + B, D pomocniczo.)
2. Czy zgadzasz się, że utwory bez cue (większość biblioteki) jeżdżą w trybie ręcznym, a „choreografia" to cecha wyselekcjonowanych utworów?
3. Czy wolisz **przesuwać utwór** do bloków (`anchor`, rekomendacja) czy **przesuwać plan** do muzyki (ryzyko: zmienia czas jazdy)?
4. Sprinty w Tidal Wave: zmienić kadencję sprintu ze 105 na ok. 87 rpm (z oporem), czy zamienić utwór na ok. 210 BPM?
5. Czy akceptujesz, że część wgrań YouTube (reklama, inne wgranie) wyłączy choreografię w slocie z komunikatem?
6. Ile czasu możesz poświęcić na odsłuch i oznaczenie 7 utworów (ok. 10 minut na utwór)? Czy narzędzie do oznaczania (PR 6) ma być priorytetem?
7. Czy dźwięk z głośnika Bluetooth zwykle opóźnia się u Ciebie zauważalnie? (wpływa na priorytet kalibracji, PR 8)
8. Czy powtórka Nightcalla w jednej jeździe 45 (s1 i s8) ma zostać, czy zamienić na inny utwór?
