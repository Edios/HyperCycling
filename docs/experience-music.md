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
- `durationSec`: oczekiwana długość; utwór krótszy od slotu o ponad 20 s dostaje ostrzeżenie
  („dołóż drugi utwór z takim samym BPM").
- `noBeat`: `true` dla utworu bez rytmu (cooldown), tempo nie jest sprawdzane.
- `explicit`: `true`, jeśli wersja z wulgaryzmami jest w porządku (domyślnie preferowana jest wersja clean).
- `alternatives`: do 5 zamienników w kolejności preferencji (`artist`, `title`, opcjonalnie `bpm`).

Wartości w pliku to propozycje oznaczone ★ w `neon-grid-45-music.md` (alternatywy a/b/c); Neon Grid 30
i Lekki 45 używają tych samych utworów w odpowiednich slotach. **Zmiana wyboru = edycja tego jednego
pliku**, bez zmian w kodzie. Nie wpisuj identyfikatorów Spotify ani linków.
