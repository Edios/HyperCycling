# Security audit (T5, 2026-11-07)

Scope: HyperCycling SPA on GitHub Pages (no backend) and the optional local build (Fastify + SQLite
on 127.0.0.1). Method: code review of tokens, keys, logs, exports, CSP and `npm audit`. The risk
panel notes (P3 #4 and #9) and the reviews of PR #62 and #65 fed the list.

Severity: **High** = fix now, **Medium** = fix now if cheap, otherwise next, **Low** = accepted or
documented.

## 1. Where secrets live

| Item | Where | Lifetime | Leaves the device? | Cleared by |
| --- | --- | --- | --- | --- |
| Spotify PKCE verifier + state | `sessionStorage` (`hypercycling.spotify.login`) | until the redirect returns (tab lifetime at most) | no | removed in `auth.ts` as soon as the callback reads it, also on failure |
| Spotify access token (1 h) | settings (`spotify.accessToken`), IndexedDB on Pages / SQLite in the local build | until expiry; refreshed on demand | only to `api.spotify.com` | Disconnect, or a dead refresh grant (`dropTokens`) |
| Spotify refresh token | settings (`spotify.refreshToken`) | until Disconnect or revoked at spotify.com | only to `accounts.spotify.com` | Disconnect (`dropTokens` removes access, refresh and expiry) |
| GetSongBPM key | settings (`getSongBpmKey`) | until the rider empties the field | only to `api.getsong.co` as `api_key` in the query (their API design); `referrerPolicy: no-referrer` | emptying the field |
| Deezer | no key | cache of tempos in `localStorage` (300 entries, 30 d) | no | not secret |

Export, import and `/api/export` pass through `stripSecrets`: tokens and the key never reach a
shared file. Import keeps the key already stored on the device.

## 2. Findings

| # | Finding | Severity | Fix |
| --- | --- | --- | --- |
| 1 | CSP `script-src` allowed `api.deezer.com` (JSONP): a script from a foreign host ran in our origin, next to the Spotify tokens and the GetSongBPM key in storage (P3 #4/#9, PR #62 review). | **High** | **Fixed.** Deezer is off by default (Settings, Music). When on, JSONP runs in a hidden `sandbox="allow-scripts"` iframe (`public/deezer-bridge.html`, opaque origin, no storage, tokens or DOM) under its own CSP; the page policy no longer lists `api.deezer.com` in `script-src` or `connect-src` and only gained `'self'` in `frame-src`. Answers are re-validated by the page. The local server sends the bridge its own policy and `X-Frame-Options: SAMEORIGIN`. Test: `csp.test.ts`, `security.test.ts`. |
| 2 | Deezer search could return a same-title song of another artist even when an artist was typed (PR #62 review). | Medium | **Fixed.** With an artist, only exact artist matches count. |
| 3 | One failed `/track` call dropped all hits already found in the song search (PR #65 note 1). | Low | **Fixed.** The failed track is skipped; a spent quota still stops the search. |
| 4 | The song finder printed "Data from:" with no source when nothing was found (PR #65 note 2). | Low | **Fixed.** Shown only with hits. |
| 5 | Unbounded `title` and `artist` from Deezer reached the cache and the UI (PR #62 nit). | Low | **Fixed.** Clipped to 200 characters on write and rejected on read from the cache. |
| 6 | A late JSONP answer after a timeout ended in a `ReferenceError` in the console (PR #62 nit). | Low | **Fixed.** The bridge leaves a no-op callback behind. |
| 7 | No test covered the JSONP loader (PR #62 nit). | Low | **Fixed.** `bridgeJsonp` tests (frame attributes, origin check, errors, close). |
| 8 | Disconnect only deletes tokens locally. Spotify has no revoke endpoint, so the refresh token stays valid until the user removes the app at spotify.com/account/apps. | Low | Documented here and kept. Nothing sensitive stays on the device after Disconnect. |
| 9 | The local build stores tokens and the key in the SQLite file, and `backups/*.db` copies them. | Low | Accepted: loopback only, files on the owner's disk, exports are stripped. Do not share `data/` or `backups/`. |
| 10 | `script-src` lists whole hosts `www.youtube.com` and `s.ytimg.com` (IFrame API, player scripts). A path allow-list would break on YouTube's script paths. | Low | Accepted; the hosts are required and have no JSONP-style endpoints used here. Revisit if YouTube changes its loader. |
| 11 | `frame-ancestors` cannot be set in a `<meta>` CSP, so the Pages build can be framed by another site. | Low | Accepted: no state-changing action without a user gesture inside the app; GitHub Pages cannot send headers. The local server sends `frame-ancestors 'none'`. |
| 12 | The YouTube iframe is created by the IFrame API and cannot carry `sandbox` without breaking playback. | Low | Accepted. |
| 13 | `connect-src` also allowed `api.deezer.com`, which fetch cannot read without CORS (PR #62 review). | Low | **Fixed** with #1. |
| 14 | Logs and Diagnostics: `console.warn` calls print error objects only; no token, key or URL with a key is logged. The diagnostics report and overlay hold device info and FPS only. | none | Checked, no change. |
| 15 | `npm audit`: 14 findings in the full tree (12 moderate, 2 critical), 3 moderate in production dependencies. | see below | Left to the dependency PR (T8). |

## 3. CSP review (`src/shared/csp.ts`)

- `default-src 'self'`, no `unsafe-inline`, no `unsafe-eval`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`: tight.
- `script-src`: `'self'`, `www.youtube.com`, `s.ytimg.com`. Nothing else after this change.
- `frame-src`: `'self'` (only for the opt-in bridge page), YouTube and youtube-nocookie.
- `connect-src`: Spotify API and accounts, YouTube oEmbed, Spotify oEmbed, `api.getsong.co`.
  Each host is used by code; `csp.test.ts` fails when code uses a host that is not listed.
- `img-src 'self' data:`, `style-src 'self'`, `font-src 'self'`: no external images or fonts.

Static CSP and a runtime opt-in: a meta CSP can only be tightened after load, never widened, so a
flag cannot add `api.deezer.com` to the page policy. The sandboxed bridge solves this without a
build-time switch: the page policy never lists Deezer, and the flag only decides whether the frame
exists. Residual risk when the flag is on: a compromised `api.deezer.com` can run script inside an
empty sandbox and send forged answers; the page validates every answer (types, tempo range, link
prefix `https://www.deezer.com/`) before use.

## 4. Dependencies (`npm audit`, 2026-11-07)

Production (reachable only in the local build, `@fastify/static` is not part of the Pages bundle):

| Package | Severity | Note | Fix |
| --- | --- | --- | --- |
| `@fastify/static` 10.1.8 (via `glob`, `minimatch`) | moderate | path-handling DoS and traversal classes in glob/minimatch | `@fastify/static` 10.1.10 (non-major) |

Development only (test runner, lint): `vitest` and `tinypool` (critical, path traversal and
prototype pollution in worker options; need untrusted test input or a reachable dev server),
`@vitest/mocker`, `@vitest/coverage-v8`, `typescript-eslint` chain (moderate, `minimatch`).
Fixes need major bumps (vitest, typescript-eslint) and belong to the dependency PR (T8). No secret
or user data passes through these tools.

## 5. What was not checked

- Live Spotify and Deezer behaviour (no network calls from the tests).
- Production headers of GitHub Pages and the `hypercycling.app` redirect.
- Third-party terms (see the risk panel notes).
