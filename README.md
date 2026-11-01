# Spinning Tutor

A workout screen for your indoor bike. Pick a plan or a single workout, and Spinning Tutor shows the effort (1 to 10), cadence, time left and the next block, with beeps, on-screen cues, a 3D tunnel or YouTube video behind the numbers, and Spotify or YouTube music timed to the blocks. No sensors needed; add your FTP and riders get target watts.

![Training screen](docs/images/training-basic.png)

## Try it

- **In the browser**: https://edios.github.io/HyperCycling/ (data stays in your browser).
- **On your computer** (Node 24 or newer):

  ```
  npm ci
  npm start
  ```

  This builds the app and opens http://127.0.0.1:5175 (use `127.0.0.1`, not `localhost`). Data is kept in `data/spinning-tutor.db`. On Windows you can also double-click `start.bat`.

## Features

- Guided plans (Progres + Freestyle sessions) and about 100 built-in workouts.
- Backgrounds: Basic, Hyperride (3D), YouTube video; several screen layouts; up to 10 riders with their own FTP.
- Workout editor, and import of `.zwo`, `.erg`, `.mrc` files.
- Configurable effort zones, FTP test guide, data export and import.
- Polish and English.

## Documentation

- [User guide](docs/user-guide.md)
- [Importing workouts](docs/importing-workouts.md)
- [Spotify setup](docs/spotify-setup.md)
- [Architecture](docs/architecture.md)
- [Contributing](CONTRIBUTING.md)

The same pages are linked from the app: Settings, General, Help.

## Po polsku

Spinning Tutor to ekran treningowy do roweru stacjonarnego: pokazuje poziom wysiłku 1-10, kadencję, czas do końca bloku i następny blok, z sygnałami dźwiękowymi, tunelem 3D lub filmem z YouTube w tle i muzyką ze Spotify lub YouTube. Działa bez czujników; po podaniu FTP pokazuje docelowe waty. Aplikacja ma polski i angielski interfejs; domyślny język to język przeglądarki. Dokumentacja jest po angielsku. Uruchomienie lokalne: `npm ci`, potem `npm start` i adres http://127.0.0.1:5175.

## Licence

MIT, see [LICENSE](LICENSE).
