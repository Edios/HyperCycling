# Licensing

This page records facts about the licences in this repository. It is not legal advice.

## HyperCycling itself

- The code is licensed under the **GNU Affero General Public License, version 3 only** (SPDX: `AGPL-3.0-only`). The full text is in [LICENSE](../LICENSE), copied from https://www.gnu.org/licenses/agpl-3.0.txt.
- The licence changed from MIT to AGPL-3.0-only on 2026-11-19, decided by the project owner, who was the only author at that time.
- AGPL section 13: if you run a modified version and let other people interact with it over a network, you must offer those users the source of your version. The app links to the official source from the Home footer and from Settings, About.
- The name and logo "HyperCycling" are not covered by the licence.

## Dependencies (npm)

Checked on 2026-11-19 with `npx license-checker-rseidelsohn --summary` (lockfile of that day).

**Runtime (production) packages, about 110**

| Licence | Packages |
| --- | --- |
| MIT | 93 |
| BlueOak-1.0.0 | 6 (`glob`, `minimatch`, `lru-cache`, `minipass`, `path-scurry`, `@isaacs/nonrecursive-glob-match`; all server side) |
| ISC | 6 |
| BSD-3-Clause | 4 |
| 0BSD | 1 (`tslib`) |

**Build and test only (`devDependencies`, not shipped)**: the rest of the tree is MIT, Apache-2.0, ISC, BSD-2/3-Clause, MIT-0, CC0-1.0, plus the entries below.

| Package | Licence | Note |
| --- | --- | --- |
| `axe-core`, `@axe-core/playwright` | MPL-2.0 | Accessibility tests only. MPL-2.0 allows combining with AGPL-3.0 (its section 3.3), and nothing from it ships. |
| `lightningcss` (and its platform binary) | MPL-2.0 | Used by Vite at build time. Same note. |
| `caniuse-lite` | CC-BY-4.0 | Browser data for build tooling, not shipped. Attribution licence; to be confirmed by a lawyer if it ever ships. |
| `argparse` | Python-2.0 | Permissive; dev tooling only. |
| `mdn-data` | CC0-1.0 | Dev tooling only. |

No dependency is under a licence that is known to conflict with AGPL-3.0 (GPL-2.0-only, SSPL, proprietary, "no commercial use"). No package has an unknown licence; the single `UNLICENSED` row the tool prints is the project's own root package, which it reports that way because `package.json` has `"private": true` (its `license` field is `AGPL-3.0-only`).

`better-sqlite3` (MIT) embeds SQLite, which is in the public domain. It is used by the local server only, not by the Pages build.

Re-run the check after dependency changes:

```
npx license-checker-rseidelsohn --production --summary
```

## Fonts, icons, images

- **Barlow and Barlow Condensed**: SIL Open Font License 1.1, copyright The Barlow Project Authors. The licence text is shipped as `public/fonts/OFL.txt`. The OFL allows bundling the fonts with software under another licence, as long as the fonts are not sold on their own.
- **Logo, icons, brand assets, Open Graph image**: created for this project (see `scripts/brand-assets.ts`), covered by the project's rights; the logo and name are excluded from the AGPL grant as above. The app uses no icon library.
- **Screenshots in `docs/images/`**: taken from the app with demo riders.

## Content and services

- Built-in workouts, plans and Experience scenarios are original content. They list track titles and artists as data only; the app distributes no music.
- Music plays through Spotify or YouTube, and tempo comes from Deezer or GetSongBPM, each under their own terms. These are network services, not code that is linked into the app.

## Open questions for the owner and a lawyer

- Dual-licensing (an AGPL release plus a closed commercial variant for Coach) needs the right to relicense every contribution. Until a contribution policy is chosen, outside contributions would be AGPL-only. See the proposal in [CONTRIBUTING.md](../CONTRIBUTING.md).
- Contributions made before this change, including automated dependency updates, were made while the project was MIT. Whether that matters for relicensing the combined work is a question for a lawyer.
- Name and trademark: whether to register "HyperCycling", and how to word the policy for derived products.
