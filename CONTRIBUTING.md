# Contributing

## Setup

Node 24 or newer.

```
npm ci
npm run dev        # Fastify API (5175) + Vite dev server with hot reload
npm start          # build if needed and open http://127.0.0.1:5175
```

`better-sqlite3` is a native module. If `npm ci` cannot download or build it, install your platform's build tools (on Windows: Visual Studio Build Tools) and retry. The Pages build and the client tests do not need it.

## Before every commit

```
npm run check      # typecheck + eslint + vitest (with coverage)
npm run test:e2e   # Playwright; builds both variants, starts its own servers
```

First time: `npx playwright install chromium`. The e2e `local` project uses a throwaway database in the system temp folder, never `data/`.

## Rules

- TypeScript `strict` and `noUncheckedIndexedAccess`; no `any` without a comment saying why.
- Exact versions in `package.json` (no `^` or `~`).
- Tests first: red, green, refactor. Coverage of `src/domain` stays at 90 % or more.
- UI text only through the dictionaries `src/client/i18n/en.ts` and `pl.ts`; both need the same keys.
- Code, comments, commits and docs are in English.
- Session time comes from the injected clock; do not add `setInterval` countdowns.
- Music and YouTube failures must never pause or change the workout.
- Built-in workouts and plans are original content. Do not copy content or parsers from services with restrictive terms.
- The local server binds to `127.0.0.1` and the app is opened on `127.0.0.1`, never `localhost` (Spotify rule).
- Router is a hash router; the Pages build needs `VITE_BASE=/HyperCycling/`.

## Workflow

One branch per feature or milestone (`feat/...`) from up-to-date `main`, one pull request into `main`, CI green before merge. Never commit to `main` directly. Commit messages are conventional (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).

## Docs and screenshots

Docs are Markdown in `docs/`; the small page `public/docs/index.html` links to them and is shipped with the app at `/docs/`. Regenerate the screenshots in `docs/images/` (1280x720, demo riders, fixed clock) after a UI change:

```
npm run docs:screenshots
```

It builds the static variant, serves it on port 5177 and drives it with Playwright. Keep each PNG small.

## Releasing to GitHub Pages

`.github/workflows/pages.yml` builds `npm run build:pages` and deploys on every push to `main`. One-time repository setting: Settings, Pages, Source = GitHub Actions. The app is then at `https://<owner>.github.io/HyperCycling/` and the help page at `.../HyperCycling/docs/`.
