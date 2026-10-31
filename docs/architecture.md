# Architecture

One React client, two interchangeable storage back ends chosen at build time.

```
src/domain/    pure TypeScript: schemas (zod), effort scale, segments, session engine, parsers
src/client/    React UI (screens, HUD layouts, Hyperride 3D, editor, music, i18n)
src/storage/   Repositories contract + implementations: http, indexeddb, sqlite
src/server/    Fastify API + static hosting (local build only)
src/content/   built-in plans and workouts (JSON, original content)
scripts/       start.ts (local launcher), docs-screenshots.ts
tests/e2e/     Playwright specs
```

## Two builds

|         | Local                                                              | GitHub Pages                                                                   |
| ------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Build   | `npm run build` (`VITE_STORAGE=http`)                              | `npm run build:pages` (`VITE_STORAGE=indexeddb`, `VITE_BASE=/Spinning-Tutor/`) |
| Storage | Fastify on `127.0.0.1:5175` + SQLite file `data/spinning-tutor.db` | IndexedDB in the browser                                                       |
| Backups | `data/backups/` before an import (newest 10)                       | none (use Settings, Data, Export)                                              |
| Router  | hash router, both builds (Pages has no SPA fallback)               | same                                                                           |

`src/client/data/repositories.ts` picks the implementation from `VITE_STORAGE` with dynamic imports, so each bundle contains only its own. Everything above that layer talks to the `Repositories` interface from `src/domain/repositories.ts` and does not know where data lives. The server binds to `127.0.0.1` only.

## Domain

- **Workout** (`workout.ts`): blocks are `steady`, `ramp` or `repeat` (2-50 times, containing steady/ramp blocks). Intensity is an effort level 1-10, an exact `ftpPct`, or both; `ftpPct` wins when both are set.
- **Effort table** (`effort.ts`): level to %FTP, label and colour; configurable in Settings. `%FTP -> level` picks the nearest, ties go up. Watts = `round(ftp x ftpPct / 100)`.
- **Segments** (`segments.ts`): a workout flattened into a timeline of segments; repeats are expanded.
- **Session engine** (`session-engine.ts`): a state machine driven by an injected monotonic clock. State is computed from elapsed time, not from ticks, so a hidden tab or a sleeping PC jumps straight to the correct block with one block-change event and no burst of beeps. There are no `setInterval` countdowns.
- **Plans** (`plan.ts`, `scale.ts`): a plan is weeks of Progres/Freestyle slots; `scale.ts` stretches a workout to a session length and applies the difficulty offset.
- **Parsers** (`parsers/`): `.zwo`, `.erg`, `.mrc` to a validated `Workout` plus warnings. See [Importing workouts](importing-workouts.md).
- **Export bundle** (`export-bundle.ts`): the JSON file of Settings, Data. Validated completely before anything is replaced.

Persisted shapes are zod schemas (workouts and the export bundle carry a `schemaVersion`); the same schemas validate server requests and imports.

## Client

- Screens are routes in `App.tsx` (select, setup, training, summary, players, plans, editor, settings). `/dev` exists only in dev builds, in builds opened with `?dev`.
- Training: `useSessionLoop` runs the engine on animation frames; `session-store` holds the runtime; `autosave` writes an active session every 5 s so it can be resumed. Layouts are in `training/layouts` (Basic) and `hyperride/` (three.js world with Immersive, Column, Cockpit and Time-in-the-tunnel overlays). YouTube is an iframe background.
- Music (`music/`): a `director` schedules provider calls from the workout's music cues; providers are Spotify (PKCE, Web API) and YouTube (iframe). Provider errors become one toast and never touch the engine.
- i18n: `i18n/en.ts` and `i18n/pl.ts`, same keys (a test checks it). No hard-coded UI text in components.

## Testing

Vitest: `client` (jsdom) and `node` projects; coverage of `src/domain` must stay at 90 % or more. Playwright: project `local` runs against the Fastify server with a throwaway database, project `pages` runs against the static build served by `vite preview`. CI (`ci.yml`) runs `npm run check` and the whole e2e suite; `pages.yml` builds and deploys the Pages build on push to `main`.
