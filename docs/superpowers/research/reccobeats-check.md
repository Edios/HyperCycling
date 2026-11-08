# ReccoBeats jako źródło BPM — sprawdzenie (2026-11-08)

Tylko badanie, bez implementacji. Sprawdzone: dokumentacja i warunki na reccobeats.com oraz kilka rzeczywistych zapytań (curl) do `api.reccobeats.com`.

## Werdykt

**Technicznie działa z przeglądarki, prawnie jest szara strefa.** Rekomendacja: **nie dodawać teraz** jako domyślnego źródła; rozważyć później jako trzeciego dostawcę **za flagą w Ustawieniach → Muzyka** (tak jak Deezer), dopiero po potwierdzeniu u autorów (mail), że lokalne cache'owanie tempa jest w porządku.

## Fakty

| Pytanie | Ustalenie |
|---|---|
| Klucz / logowanie | Brak. „No API access key or authentication required” (intro i Terms of Service). |
| CORS | **Tak.** `access-control-allow-origin` odbija dowolny `Origin` (sprawdzone dla `https://hypercycling.app` i `https://example.org`), preflight `OPTIONS` zwraca 200 z `allow-methods: HEAD,GET,POST,PUT,DELETE,PATCH`. Zwykłe `fetch` GET z SPA działa bez proxy i bez JSONP. |
| Endpoint istotny dla nas | `GET https://api.reccobeats.com/v1/audio-features?ids=<spotifyId,...>` — przyjmuje **Spotify ID** (i ReccoBeats UUID), zwraca m.in. `tempo` (np. 148.114), `href` na open.spotify.com, `isrc`. Działa też `GET /v1/track?ids=`. |
| Rozmiar paczki | Maks. **40 id na zapytanie** (powyżej: HTTP 400 „size must be between 1 and 40”). To ogromna zaleta dla masowego tagowania: playlista 200 utworów = 5 zapytań zamiast 200–400 (Deezer). |
| Pokrycie | Niepełne: z 3 testowych id jedno nie zwróciło danych (pusta pozycja). Wymaga ścieżki „brak danych” → Deezer/GetSongBPM. Brak informacji o dokładności tempa (te same problemy połowa/podwójne co u innych). |
| Limity | Nieopublikowane. Dokumentacja: limity ustawione wewnętrznie, po przekroczeniu 429 + `Retry-After`; „unikaj serii zapytań w krótkim czasie”, zalecają cache. ToS: prawo do blokowania **adresu IP** bez uprzedzenia przy nadmiernym ruchu. |
| Koszt / komercja | ToS (aktualizacja 2026-05-25): „entirely free to use for both personal and commercial projects”. To **zaprzecza** wcześniejszej wzmiance o płatnym B2B z research-g-bpm-apis.md (możliwe, że dotyczyło starszej wersji lub innych funkcji). |
| Atrybucja | Niewymagana (ToS). |
| Cache'owanie / przechowywanie | ToS **milczy**. Ani zgody, ani zakazu. |
| Pochodzenie danych | Metadane (tytuły, artyści, albumy) pochodzą ze Spotify; użytkownik API odpowiada za zgodność z warunkami stron trzecich. Analiza audio (tempo itd.) opisana jako własna ReccoBeats, ale ToS nie wymienia tempa wprost. |
| Gwarancje | „As is”, bez gwarancji dokładności; mogą zmienić lub wyłączyć API w dowolnej chwili bez uprzedzenia. |

## Ryzyka

1. **Niejasne prawa do danych (średnie).** Skoro tempo jest „audio feature” zbliżonym do zamkniętego dla nas Spotify audio-features, a metadane są ze Spotify, kierunek Spotify → ReccoBeats → nasz cache jest dla Spotify wrażliwy. Dla projektu nie jest to blokada techniczna, ale to samo ryzyko redystrybucji, które panel ryzyka wskazał dla seedu: dane tylko na żądanie, lokalnie, bez wbudowanej bazy.
2. **Blokada IP użytkownika (niskie–średnie).** Żądania idą z przeglądarki użytkownika, więc ewentualna blokada uderza w jego IP, nie w nasz serwer. Mitygacja: małe paczki, własny limit tempa, stop na 429.
3. **Trwałość (średnie).** Brak umowy i SLA; API może zniknąć bez uprzedzenia. Aplikacja musi działać bez niego (jest tak: Deezer/GetSongBPM/ręcznie).
4. **Prywatność (niskie).** Do ReccoBeats wychodzą wyłącznie ID utworów Spotify (nie tytuły, nie nazwa użytkownika, nie tokeny). Dla playlist ze Spotify to lista ID użytkownika trafiająca do trzeciego dostawcy, więc wymaga to osobnej zgody w Ustawieniach i wpisu w docs/privacy.md.
5. **CSP.** Dodałoby `https://api.reccobeats.com` do `connect-src` (zmiana w `src/shared/csp.ts` + `csp.test`).

## Ocena jako źródło do masowego tagowania

Plus: bez klucza, bez JSONP/iframe, 40 id na zapytanie, klucz po Spotify ID (idealnie pasuje do importu playlist Spotify, nie wymaga dopasowania tekstowego, więc mniej błędnych trafień niż Deezer/GetSongBPM). Minus: tylko utwory Spotify (YouTube nie), nieopublikowane limity, niejasne warunki cache'owania.

## Rekomendacja i kroki

1. Teraz: **nie implementować**. Import playlist (M19b) używa Deezer (opt-in) i GetSongBPM (klucz użytkownika).
2. Napisać do ReccoBeats (adres kontaktowy w ich dokumentacji) z pytaniem: (a) czy aplikacja kliencka może lokalnie cache'ować `tempo` 30 dni, (b) jakie są limity na IP, (c) czy tempo pochodzi z własnej analizy. Bez odpowiedzi — nie włączać.
3. Jeśli odpowiedź jest zgodna: dodać jako **trzeciego dostawcę za flagą** („ReccoBeats, wysyła ID utworów Spotify”), wyłącznie dla utworów Spotify, paczki ≤ 40, własny limit np. 1 zapytanie/s i 300/h, stop na 429 (z `Retry-After`) i 403, źródło `reccobeats` widoczne obok wartości, ręczna korekta zawsze możliwa. Miejsce w kodzie: `BpmSource` w `src/domain/workout.ts`, nowy klient obok `deezer/client.ts`, interfejs kolejki z M19b już przyjmuje dostawców jako wtyczki.
4. Nie używać endpointu analizy z uploadem pliku (5 MB / 30 s): wymaga wysyłania audio, wbrew zasadzie „bez audio”.
