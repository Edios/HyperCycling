# Architecture

One React client, two interchangeable storage back ends chosen at build time.

```
src/domain/    pure TypeScript: schemas (zod), effort scale, segments, session engine, parsers
src/client/    React UI: screens, HUD layouts, editor, i18n, and
               world/ (three.js scenes), experience/ + class/ (Experience picker, class card),
               music/ (director, Spotify, YouTube, Deezer, GetSongBPM), settings/, setup/, summary/
src/shared/    CSP definition used by both builds
src/storage/   Repositories contract + implementations: http, indexeddb, sqlite
src/server/    Fastify API + static hosting (local build only)
src/content/   built-in plans and workouts (JSON, original content)
scripts/       start.ts (local launcher), docs-screenshots.ts
tests/e2e/     Playwright specs
```

## Two builds

|         | Local                                                                                                                        | Web (hypercycling.app)                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Build   | `npm run build` (`VITE_STORAGE=http`)                                                                                        | `npm run build:pages` (`VITE_STORAGE=indexeddb`, `VITE_BASE=/`) |
| Storage | Fastify on `127.0.0.1:5175` + SQLite file `data/spinning-tutor.db`                                                           | IndexedDB in the browser                                        |
| Backups | `data/backups/` before an import (newest 10)                                                                                 | none (use Settings, Data, Export)                               |
| Router  | hash router, both builds (Pages has no SPA fallback); the live site is served from the root `/` of https://hypercycling.app/ | same                                                            |

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

- Screens are routes in `App.tsx` (select, setup, training, summary, players, plans, editor, settings). The `/dev` route exists only in dev builds, or in any build opened with `?dev`.
- Training: `useSessionLoop` runs the engine on animation frames; `session-store` holds the runtime; `autosave` writes an active session every 5 s so it can be resumed. Layouts are in `training/layouts` (Basic) and `world/` (three.js worlds, shown as World). The corner (stored id `immersive`), Column, Cockpit, Minimal (`tunnelTime`) and Focus overlays work on every background; the Focus visibility rule is the pure `training/focus-visibility.ts`. YouTube is an iframe background.
- Music (`music/`): a `director` schedules provider calls from the workout's music cues; providers are Spotify (PKCE, Web API) and YouTube (iframe). Provider errors become one toast and never touch the engine.
- Experience (`domain/experience.ts`, `content/experiences/`, `client/experience/`): a class-style ride is a workout plus chapters, songs with a tempo and an idea (the user pins the actual track), a resistance-step knob and scene looks. Neon Grid 45 is the first. Scenes (`world/worlds/scenes*.ts`) change only at song boundaries, never into a sprint.
- Cues (`domain/coach.ts`): on-screen coach texts come from engine segment transitions, not from render frames. Tokens `coach.*` live in both dictionaries.
- Heart rate (`domain/hr-zones.ts`): zones from a max heart rate you enter; nothing is sent anywhere.
- Song finder (`music/bpmLookup.ts`, `music/deezer`, `music/getsongbpm`, `domain/bpm-match.ts`): optional BPM lookup by artist and title; manual BPM always works. Deezer has no CORS, so it is read via JSONP from that one host.
- i18n: `i18n/en.ts` and `i18n/pl.ts`, same keys (a test checks it). No hard-coded UI text in components.

## Security (CSP)

`src/shared/csp.ts` is the single source: the web build embeds it as a `<meta>` tag, the local server sends it as a header. Each third-party host is listed there with its reason (YouTube, Spotify, Deezer, GetSongBPM); `csp.test.ts` guards the list. Styles are external files only.

## Testing

Vitest: `client` (jsdom) and `node` projects; coverage of `src/domain` must stay at 90 % or more. Playwright: project `local` runs against the Fastify server with a throwaway database, project `pages` runs against the static build served by `vite preview`. CI (`ci.yml`) runs `npm run check` and the whole e2e suite; `pages.yml` builds and deploys the web build to https://hypercycling.app/ on every push to `main`. Unit tests sit next to the code (`*.test.ts`); `i18n/hardcoded-strings.test.ts` fails on UI text outside the dictionaries.

## Resuming the project without AI agents

1. **Run it.** Node 24+. `npm ci`, then `npm start` and open http://127.0.0.1:5175 (not `localhost`). For hot reload: `npm run dev`. The web (IndexedDB) build: `npm run build:pages`, then `npx vite preview --outDir dist/pages`.
2. **Test it.** `npm run check` = typecheck + lint + unit tests (domain coverage at least 90 %). `npm run test:e2e` runs Playwright (projects `local` and `pages`; `local` needs `better-sqlite3` built for your Node). CI also runs `npm run format:check`.
3. **Ship it.** Branch, pull request, green CI, merge to `main`. `pages.yml` deploys by itself; the custom domain is set in the repository's Pages settings. There is no other server.
4. **Where decisions live.** `docs/superpowers/` (specs, plans, research, `CHECKLIST.md` with dated decisions) and `docs/design/` are not in this repository; they are kept locally and backed up in a separate private repository. Code history: `git log` and merged pull requests. Product rules (effort scale, class dosing, music legality) are in those specs; start with the Experience design spec and the strategy plan.
5. **Rules of thumb.** No hard-coded UI text (PL and EN together). The GetSongBPM backlink stays in `index.html` and the Home footer. A new third-party host needs a CSP line with a reason. Never log or send heart rate, FTP or tokens.
