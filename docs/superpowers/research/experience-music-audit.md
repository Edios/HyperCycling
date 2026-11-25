# Audyt muzyki w Experience (Neon Grid 30 / 45 / 45 Light)

Data: 2026-11-25, stan `main` po #144. Tylko odczyt kodu i danych; żadnej zmiany w kodzie produkcyjnym.
Metoda: przeliczenie prawdziwym kodem aplikacji (`sectionsOf`, `energyOf`, `matchBpm`, `withUserMusic`, `musicAt`
z `music-schedule.ts`), tryb YouTube-only (bez Spotify), oraz `npm run check:music`. Żadnej oceny „na słuch": to,
czego z danych nie da się ocenić, jest zebrane w sekcji 7 (do odsłuchu właściciela).

## 1. Jak muzyka jest dobierana dziś

- `musicPins` we wszystkich trzech Experience jest puste. Utwory biorą się wyłącznie z podpowiedzi
  `src/content/music-hints/neon-grid.json` (11 slotów w 45 i Light, 7 w 30; każdy slot to utwór + opcjonalna `queue`,
  `alternatives` i do 4 wgrań YouTube na utwór).
- `withUserMusic` → `chainChoices` składa kolejkę slotu z wgrań YouTube (kolejność wg źródła muzyki), potem
  `fillGaps` zamyka ciszę na końcu za krótkiego slotu regułami R1 dłuższe wgranie → R2 utwór rezerwowy w tym samym
  tempie → R3 pętla końcówki (tylko `loopable`) → R4 `musicFallback`.
- `musicFallback` (Brian Eno, „1/1" 1042 s + zapasowe „Discreet Music") jest ustawiony we wszystkich trzech
  scenariuszach (nie tylko w 45). Gra tylko tam, gdzie żaden utwór nie zakrywa czasu.
- Zegar treningu rządzi: utwór startuje zawsze od `startAtSec` (u wszystkich = 0) na początku slotu i jest
  **ucinany na granicy slotu** (fade), niezależnie od budowy utworu.
- `musicMatch.annotate` sprawdza tempo względem **zakresu BPM slotu**, nie względem faktycznej kadencji bloków
  (patrz problem P5).

## 2. Czy wgrania YouTube istnieją

`npm run check:music -- --soft` (oEmbed, 2026-11-25): **705 wgrań, 270 utworów, wszystkie odpowiadają**, żaden
martwy. Każdy z 14 utworów Experience ma 3–4 wgrania (tabela 3). To stan na dziś; oEmbed nie wykrywa blokad
regionalnych ani zmian wgrania w przyszłości.

## 3. Tabela: scenariusz × część × utwór (rola, kadencja, długość)

Kolumny: slot (część), czas, wysiłek sekcji i energia z `energyOf` (1–5), kadencja bloków (rpm), utwór (BPM wg
autora), zgodność BPM z kadencją wg `matchBpm` (okno 6 %, 2 BPM = 1 RPM, połowa/podwójne też liczone;
udział czasu slotu), czas utworu vs. slot.

### Neon Grid 30 (1800 s, ostatnie 60 s ciszy)

| Slot | Czas | Rola / wysiłek (energia) | rpm bloków | Utwór (BPM) | Zgodność BPM↔kadencja | Utwór vs. slot |
|---|---|---|---|---|---|---|
| s1 | 0–300 | warmup, 3–4 (E2) | 85–100 | Kavinsky – Nightcall (91) | 40 % half on-beat, **60 % brak** | 257 s z 300 s; **43 s Eno** (fallback) |
| s2 | 300–570 | tempo, 6–7 (E3) | 82–87 | Foo Fighters – The Pretender (173) | 100 % exact (44 % on-beat) | 269/270 s, ok |
| s3 | 570–750 | steady, 3–4 (E1) | 85–90 | Alan Walker – Faded (90) | 100 % half (33 % on-beat) | 213 s w 180 s: **ucięty 33 s przed końcem** |
| s4 | 750–1050 | hard, 6–9 (E4) | 62–66, 80 | Eric Prydz – Pjanoo (126) + Guetta – Titanium (126) | 85 % exact, 15 % brak (zjazd 80 rpm) | Pjanoo 451 s w 300 s: **ucięty po 2/3**; Titanium w kolejce **nigdy nie zagra** |
| s5 | 1050–1320 | steady, 3–6 (E2) | 85–90 | Tycho – Awake (88) | 100 % half (33 % on-beat) | 283 s w 270 s, ucięty 13 s przed końcem |
| s6 | 1320–1560 | tempo, 6–7 (E3), sprinty 15 s | 80–105 | Sub Focus – Tidal Wave (174) | 63 % exact on-beat, **38 % brak** (sprinty 105 rpm) | 232 s w 240 s; 8 s Eno |
| s7 | 1560–1800 | steady, 3–4 (E1) | 65–80 | Brian Eno – An Ending (Ascent) | beatless | 265 s w 240 s |

### Neon Grid 45 (2700 s)

| Slot | Czas | Rola / wysiłek (energia) | rpm | Utwór (BPM) | Zgodność BPM↔kadencja | Utwór vs. slot |
|---|---|---|---|---|---|---|
| s1 | 0–300 | warmup 3–4 (E2) | 85–100 | Nightcall (91) | 40 % half, **60 % brak** | 257 s; gra rezerwowy Tycho Awake 257–300 s (wchodzi od intra, ucięty po 43 s) |
| s2 | 300–540 | tempo 6–7 (E3) | 64–66 | Daft Punk – Technologic (128) | 100 % exact (25 % on-beat) | 284 s w 240 s, ucięty 44 s przed końcem |
| s3 | 540–810 | tempo 6–7 (E3) | 82–87 | The Pretender (173) | 100 % exact | ok |
| s4 | 810–960 | steady 3–4 (E1) | 85–90 | Faded (90) | 100 % half | 213 s w 150 s, ucięty 63 s przed końcem |
| s5 | 960–1320 | hard 6–7 (E4) | 64–66, **stoi 135 s** | Swedish House Mafia – Don't You Worry Child (129) + Zedd – Clarity (128) | 100 % exact on-beat | 404 s w 360 s; Clarity **nigdy nie zagra** |
| s6 | 1320–1470 | steady 3–4 (E1) | 85–90 | Chase & Status – Blind Faith (Loadstar Remix) (87) | 100 % half | brak `durationSec` w podpowiedzi (długość znana dopiero z wgrania) |
| s7 | 1470–1770 | tempo 6–7 (E3) | 82–87 | Pendulum – Witchcraft (174) | 47 % exact, **53 % brak** | 252 s w 300 s (wgranie 236 s); po 236 s wchodzi Propane Nightmares (rezerwa R2) |
| s8 | 1770–1920 | steady 3–4 (E1) | 85–90 | Nightcall drugi raz (91) | 40 % half, 60 % brak | **powtórka utworu ze slotu 1**, ucięty 109 s przed końcem |
| s9 | 1920–2220 | hard 6–9 (E4) | 62–66, 80; **stoi 75 s** | Pjanoo + Titanium (126) | 85 % exact | jak w 30: Pjanoo ucięty, Titanium nie zagra |
| s10 | 2220–2460 | tempo 4–7 (E3) | 80–105 (sprinty) | Sub Focus – Tidal Wave (174) | 63 % on-beat, 38 % brak | 232 s w 240 s; 8 s Eno |
| s11 | 2460–2700 | steady 3–4 (E1) | 65–80 | Eno – An Ending | beatless | 265 s w 240 s |

### Neon Grid 45 Light

Jak 45, z różnicami: s4 trwa 180 s (Faded ucięty 33 s przed końcem), s5 360 s, s6 180 s, s8 = Tycho – Awake (88,
100 % half, 283 s w 180 s: ucięty 103 s przed końcem), s9 = The Weeknd – Starboy (93; **71 % czasu poza oknem 6 %**,
229 s w 210 s). W s1 po Nightcallu 43 s gra Eno (fallback), bo Awake jest użyty później (R2 nie powtarza utworów).

### Wgrania i dane utworów

| Utwór | Wgrań YT (żyją) | W katalogu Soundtrack (`catalog.json`) | Energia/groove/mood w danych |
|---|---|---|---|
| Kavinsky – Nightcall | 4 | tak | E3, groove 3, dark |
| Alan Walker – Faded | 4 | tak | E2, groove 3, mellow |
| Tycho – Awake | 4 | tak | E1, groove 2, mellow |
| The Weeknd – Starboy | 4 | tak | E3, groove 3, dark |
| Brian Eno – An Ending (Ascent) | 4 | tak (bez BPM) | E–, mellow, rola cooldown |
| Foo Fighters – The Pretender, Daft Punk – Technologic, SHM – Don't You Worry Child, Zedd – Clarity, Chase & Status – Blind Faith, Pendulum – Witchcraft / Propane Nightmares, Prydz – Pjanoo, Guetta – Titanium, Sub Focus – Tidal Wave | 3–4 | **nie** | **brak** — energię trzeba wziąć z BPM i z opisu, nie z danych |

## 4. Gdzie utwory nie pasują do wysiłku (z danych)

Energia `energyOf` dla sekcji vs. energia utworu z katalogu (tylko 4 utwory mają dane):

| Utwór | Gdzie | Energia sekcji | Energia utworu | Wniosek |
|---|---|---|---|---|
| Nightcall (E3) | rozgrzewka s1 | E2 | 3 | o stopień wyżej niż wysiłek; w 45 powtórka w s8 (E1): **o dwa stopnie wyżej** |
| Faded (E2) | odpoczynek s3/s4 | E1 | 2 | o stopień wyżej, akceptowalne |
| Awake (E1) | odpoczynek s5 (30) / s8 (Light) | E2 | 1 | o stopień niżej, akceptowalne (odpoczynek) |
| Starboy (E3) | odpoczynek s9 (Light) | E2 (sekcja 3–4) | 3 | o stopień wyżej + 71 % poza oknem BPM |

Pozostałych 10 utworów nie ma energii w danych: **nie da się ich ocenić bez katalogu lub odsłuchu**.

## 5. Luki ciszy

Test `neon-grid-music-gaps.test.ts` przechodzi (żadna sekunda poza zamykającą minutą nie jest cicha, także gdy
każdy utwór kończy się na najkrótszym wgraniu). **Luk ciszy > 30 s nie ma.** Zamiast ciszy gra jednak:

| Scenariusz | Okno | Co gra | Uwagi |
|---|---|---|---|
| 30 i Light | 257–300 s | Eno „1/1" (43 s) | koniec rozgrzewki (wysiłek 3–4); jedyny długi (>30 s) „zapychacz" |
| 45 | 257–300 s | Tycho – Awake od intra (rezerwa) | 43 s, po czym ucięcie do Technologic |
| wszystkie | ok. 1552–1560 / 2452–2460 s | Eno „1/1" (8 s) | **koniec bloku sprintów** (ng10-z, 25 s zjazdu); 8 s ambientu między Tidal Wave a Eno-cooldown |

## 6. Czy fallback Eno ma sens dla jazdy 45 min z interwałami i sprintami

- Fallback jest wywoływany tylko w 3 miejscach powyżej: 43 s na końcu rozgrzewki i 8 s po sprintach. **Ani razu pod
  interwałem lub sprintem**, więc jako zapychacz jest bezpieczny: gra w wysiłku 3–4 i w zjeździe.
- Zasada „długi spokojny utwór" jest jednak słuszna tylko dopóki fallback to *ostatnia* reguła. Gdyby wszystkie
  wgrania utworu odpadły (np. region) w slocie z interwałami, jedynym zapasem byłby 17-minutowy ambient bez beatu i
  bez dynamiki; to niezgodne z „kręć w rytm" i z choreografią. Dla choreografii fallback musi być traktowany jako
  „brak choreografii w tym slocie" (tryb ręczny, spec sekcja 8).
- 8-sekundowy kawałek Eno między Tidal Wave a „An Ending" to zbędny szwy (≈ 8 s ciszy-ambientu); lepiej wydłużyć
  start cooldownu lub dobrać sprintowy utwór o długości ≥ slot (≥ 240 s).

## 7. Rozjazdy i problemy (z danych)

| # | Problem | Skala |
|---|---|---|
| P1 | **Utwory ucinane na granicy slotu, od 0 s, bez związku ze strukturą**: 6 z 11 slotów w 45 (s2, s4, s5, s8, s9, s11) ma utwór lub kolejkę dłuższą od slotu (Pjanoo ucięty 151 s, Nightcall (s8) o 109 s, Awake o 103 s). Refren/drop wypada przypadkowo. | systemowy, blokuje choreografię |
| P2 | Utwory w kolejce, które **nigdy nie zagrają** (Titanium w s4/s9, Clarity w s5): zasłonięte przez dłuższy pierwszy utwór. Zajmują tylko miejsce w danych, ale wprowadzają w błąd (`fillGaps` liczy je jako użyte). | 3 wpisy |
| P3 | Kadencja a BPM: Nightcall 91 BPM wg `matchBpm` pasuje do 90 rpm (half), ale warmup ma bloki 85 i 100 rpm → 60 % czasu poza oknem 6 %. Starboy (93) w Light: 71 % poza oknem. Tidal Wave: sprinty 105 rpm vs 87 rpm z BPM (38 % poza). Witchcraft/Pretender: 53 % poza przy 82 vs 87 rpm (173 BPM celuje w 86,5 rpm). | 5 slotów |
| P4 | Powtórka Nightcalla w 45 (s1 i s8, ten sam utwór w jednej jeździe); w Light zamiast niej Tycho. Rezerwa R2 nie powtarza utworów, więc w 45 końcówka s1 dostaje Tycho (Awake), a w 30/Light zostaje Eno. | 1 powtórka |
| P5 | `musicMatch.annotate` liczy kadencję z zakresu BPM slotu: `rpm = (min+max)/4`. Dla s1 (86–92 BPM) daje fikcyjne 44,5 rpm i zawsze „on-beat", niezależnie od faktycznych bloków 85–100 rpm. Etykieta „on-beat" w UI jest więc **tautologią**, nie sprawdzeniem względem treningu. | błąd logiki w UI muzyki |
| P6 | 10 z 14 utworów nie ma energii/groove/mood (poza katalogiem); `energyOf` nie może ich użyć. Neon Grid jest „obok" Soundtrack Match zamiast na nim. | dane |
| P7 | Brak `durationSec` w podpowiedzi „Blind Faith (Loadstar Remix)"; długość znana dopiero z wgrania. | 1 wpis |
| P8 | Wszystkie `startAtSec` = 0: nawet utwory z długim intro (Pjanoo, Tidal Wave) zaczynają od intra, więc początek bloku nie pada na „wejście" utworu. | wszystkie |

## 8. Co wymaga odsłuchu właściciela (nie do oceny z danych)

1. Czy Pjanoo (451 s, ucinany po 300 s) ma sensowne 300 pierwszych sekund na podjazd, czy lepsza jest wersja ze startem w środku (`startOffsetSec`).
2. Czy brzmienie 10 utworów bez energii w danych pasuje do wysiłku slotu (zwłaszcza Technologic w tempo 6–7 i Witchcraft/Tidal Wave w sprinty).
3. Czy Nightcall w s8 (E1) nie jest zbyt „ciężki" na odpoczynek, i czy powtórka w jednej jeździe przeszkadza.
4. Czy 8 s Eno po sprintach i 43 s Eno po rozgrzewce brzmią jak szew czy jak świadomy oddech.
5. Czy wgrania „official audio" kończą/zaczynają się ciszą lub intrem inaczej niż albumowe (długości 257/261 s dla Nightcalla).
6. Czy blokady regionalne YouTube nie dotyczą kraju właściciela (oEmbed działa globalnie, odtwarzanie może nie).

## 9. Wnioski

- Dane i kod trzymają „bez ciszy" (test zielony, 705/705 wgrań żyje); problem nie jest techniczny, tylko **brak wiedzy o
  strukturze utworu**: utwór startuje od 0 i jest ucinany. Spec choreografii (`../specs/experience-choreography.md`)
  odpowiada właśnie na to.
- Tanie poprawki bez choreografii (kandydaci na osobny PR danych): usunąć nieosiągalne pozycje kolejki (P2),
  dobrać sprintowy utwór ≥ 240 s, dodać `startOffsetSec` tam, gdzie intro przekracza 20 s, poprawić `annotate` (P5),
  dopisać brakujące 10 utworów do katalogu Soundtrack z energią.
