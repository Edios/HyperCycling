<div align="center">

# HyperCycling

**Indoor cycling that rides with your music: effort-guided workouts, plans and an immersive visual mode, right in your browser.**

[![CI](https://github.com/Edios/HyperCycling/actions/workflows/ci.yml/badge.svg)](https://github.com/Edios/HyperCycling/actions/workflows/ci.yml)
[![Pages](https://github.com/Edios/HyperCycling/actions/workflows/pages.yml/badge.svg)](https://github.com/Edios/HyperCycling/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

### [Open the app](https://edios.github.io/HyperCycling/) &nbsp;|&nbsp; [User guide](docs/user-guide.md)

<img src="docs/images/intro.gif" alt="HyperCycling intro" width="720">

</div>

No account, no install, no power meter. Pick a workout, press play, and ride.

## Why HyperCycling

- **No watts needed.** Ride by a simple 1-10 effort scale. Add your FTP only if you want target watts.
- **Your music leads.** Blocks, beeps and on-screen cues are timed to your Spotify or YouTube tracks.
- **Plans that build.** A plan wizard sets length, difficulty and sessions per week; a 20-minute FTP test guide keeps targets honest.
- **Plenty to ride.** About 100 ready workouts, plus an editor and import of `.zwo`, `.erg` and `.mrc` files.
- **Immersive World mode.** A visual 3D ride to keep the minutes moving. Instructor-led classes are coming.

## A quick tour

|                                                                                                            |                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| ![Training screen](docs/images/training-basic.png)<br>Training HUD: current block, effort and what is next | ![Freestyle library](docs/images/freestyle.png)<br>Freestyle: search and filter about 100 workouts |
| ![Plan gallery](docs/images/plan-gallery.png)<br>Pick a plan, then tune it in the wizard                   | ![Plan view](docs/images/plan.png)<br>Next session and a week-by-week list                         |
| ![Editor](docs/images/editor.png)<br>Build your own workouts or import them                                | ![Settings](docs/images/settings.png)<br>Zones, FTP and players in Settings                        |

## Run it in 30 seconds

- **Browser:** open https://edios.github.io/HyperCycling/ and ride.
- **Locally** (Node 24+): `npm ci`, then `npm start`, then open http://127.0.0.1:5175 (use `127.0.0.1`, not `localhost`).

## Your data stays yours

Local-first: everything lives in your browser (IndexedDB) or in a file on your computer. No account, no tracking.

## Roadmap

- World v2: richer worlds and biomes
- Heart-rate zones
- Coach: instructor-led classes
- LED and room integration

## Docs

[User guide](docs/user-guide.md) | [Importing workouts](docs/importing-workouts.md) | [Spotify setup](docs/spotify-setup.md) | [Architecture](docs/architecture.md) | [Contributing](CONTRIBUTING.md)

## Licence

MIT, see [LICENSE](LICENSE).
