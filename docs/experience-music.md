# Muzyka w Experience: podpowiedzi utworów

Experience (np. Neon Grid) **nie zawiera identyfikatorów utworów**. Zamiast nich ma listę
podpowiedzi: wykonawca, tytuł, tempo, długość i alternatywy. Na ekranie startu jazdy przycisk
„Dopasuj utwory ze Spotify" zamienia podpowiedzi na utwory z konta użytkownika (jego własny Client ID
i token PKCE), pokazuje listę do zatwierdzenia i zapisuje wybór **tylko w przeglądarce**
(`localStorage`, klucz `hypercycling.experience.music`). Z aplikacji nic nie wychodzi poza
wyszukiwanie w `api.spotify.com`.

## Plik do edycji

[`src/content/music-hints/neon-grid.json`](../src/content/music-hints/neon-grid.json): klucz to id
Experience, wartość to lista slotów (po jednym wpisie na utwór scenariusza, `slot` liczone od 0).

```json
{
  "neon-grid-45": [
    {
      "slot": 0,
      "artist": "Kavinsky",
      "title": "Nightcall",
      "bpm": 91,
      "durationSec": 259,
      "alternatives": [{ "artist": "Tycho", "title": "Awake", "bpm": 88 }]
    }
  ]
}
```

Pola wpisu:

- `slot`: numer slotu utworu w scenariuszu (0 = pierwszy), każdy slot najwyżej raz.
- `artist`, `title`: tak, jak na Spotify. Wersja w tytule (np. `(Loadstar Remix)`) jest wymagana w wyniku;
  bez niej aplikacja woli wersję studyjną i odrzuca live, karaoke, cover i wersje remaster.
- `bpm`: tempo wg autora (liczba); porównywane z zakresem BPM slotu (2 BPM = 1 RPM). Tempo z biblioteki
  użytkownika (po tagowaniu BPM) ma pierwszeństwo.
- `version`: `album` | `extended` | `radio`, preferowana wersja (aplikacja wybiera ją z wyników wyszukiwania).
- `startOffsetSec`: ręczne przesunięcie początku (pominięcie intra), ustawia autor.
- `queue`: lista kolejnych utworów slotu (`artist`, `title`, `bpm`, `durationSec`, `startOffsetSec`, `version`); kolejka slotu to utwór wpisu + `queue`, w tej kolejności.
- `alternatives`: rezerwa w ustalonej kolejności. NIE jest dokładana do kolejki: zastępuje tylko utwór niedostępny w regionie lub nieznaleziony (zamiennik o najbliższym BPM, oznaczony w UI).
- `durationSec`: oczekiwana długość; utwór krótszy od slotu o ponad 20 s dostaje ostrzeżenie
  („dołóż drugi utwór z takim samym BPM").
- `noBeat`: `true` dla utworu bez rytmu (cooldown), tempo nie jest sprawdzane.
- `explicit`: `true`, jeśli wersja z wulgaryzmami jest w porządku (domyślnie preferowana jest wersja clean).
- `alternatives`: do 5 zamienników w kolejności preferencji (`artist`, `title`, opcjonalnie `bpm`).

Wartości w pliku to propozycje oznaczone ★ w `neon-grid-45-music.md` (alternatywy a/b/c); Neon Grid 30
i Lekki 45 używają tych samych utworów w odpowiednich slotach. **Zmiana wyboru = edycja tego jednego
pliku**, bez zmian w kodzie. Nie wpisuj identyfikatorów Spotify ani linków.

## Kolejka utworów w slocie

Utwór krótszy od części treningu nie przesuwa niczego: zegar treningu rządzi, muzyka tylko za nim
podąża. Dlatego slot ma **kolejkę** utworów (`SongSlot.tracks`; pojedynczy `track` z wcześniejszych
zapisów czyta się jak kolejkę jednoelementową, a kolejka jednoelementowa nadal zapisuje się jako
`track`). Wejście w blok startuje pierwszy utwór, koniec utworu startuje następny (harmonogram
`musicAt` + wybudzenie dyrektora w chwili zmiany, bez czekania na odpytywanie), a na końcu slotu
ostatni utwór jest ucinany istniejącym wyciszeniem. Przeskok bloku wraca do początku kolejki slotu.
`TrackRef.startAtSec` to ręczne przesunięcie początku (pominięcie intra), bez analizy audio.

Propozycję układa czysta funkcja `planSlot` ([`src/domain/slot-plan.ts`](../src/domain/slot-plan.ts)):
najpierw dłuższa wersja tego samego utworu (album/extended zamiast radio edit; nie live, nie remix),
potem rezerwa z alternatyw rankowanych tempem (2 BPM = 1 RPM) bez duplikatów między slotami; gdy
dalej brakuje czasu (tolerancja 10 s) pokazuje „brakuje m:ss, dodaj utwór ok. N BPM" (w odpoczynku
cisza jest dozwolona). Wszystko jest propozycją: nic się nie zapisuje, dopóki użytkownik nie
zatwierdzi listy.

### Experience: muzyka autorowana

Scenariusz ustala kolejkę utworów slotu; planer **nie** dobiera w Experience niczego dodatkowo.
„Dopasuj ze Spotify" pokazuje wynik dopasowania (znaleziono / wybrana dłuższa wersja / zamiennik
z rezerwy / brak) do zatwierdzenia jednym kliknięciem; ręczna zmiana jest w sekcji „Zaawansowane".
Ten sam scenariusz i ten sam katalog dają tę samą kolejkę. Walidator dla autora
(`validateHintQueues`, sprawdzany w `src/content/neon-grid.test.ts`): suma czasów kolejki >= czas slotu
minus 10 s oraz brak powtórzeń utworu między slotami. W zwykłych treningach (edytor) planer jest
tylko pomocnikiem: licznik brakującego czasu, bez cichych zmian.
