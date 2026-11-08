#!/usr/bin/env node
// Checks every YouTube video id used by the Experience scenarios against YouTube's oEmbed
// endpoint (401/403 = embedding disabled, 404 = removed or private) and reports the dead ones
// and the songs that have fewer than two working uploads.
//
//   node scripts/check-experience-music.mjs            # report, exit 1 when something is dead
//   node scripts/check-experience-music.mjs --soft     # report only, always exit 0
//   node scripts/check-experience-music.mjs --min 2    # working uploads required per song
//
// No network (or YouTube unreachable) is NOT a failure: the script says so and exits 0, so CI
// without internet never goes red because of it. It only reads files in src/content/music-hints.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hintsDir = join(root, 'src', 'content', 'music-hints');
const args = process.argv.slice(2);
const soft = args.includes('--soft');
const minIdx = args.indexOf('--min');
const MIN_WORKING = minIdx >= 0 ? Number(args[minIdx + 1]) : 2;
const TIMEOUT_MS = 8000;

/** Every song (hint or queue item) with its YouTube ids, from all scenario files. */
function loadSongs() {
  const songs = [];
  for (const file of readdirSync(hintsDir).filter((f) => f.endsWith('.json'))) {
    const data = JSON.parse(readFileSync(join(hintsDir, file), 'utf8'));
    for (const [experience, hints] of Object.entries(data)) {
      for (const hint of hints) {
        for (const item of [hint, ...(hint.queue ?? [])]) {
          songs.push({
            where: `${experience} slot ${hint.slot + 1}`,
            name: `${item.artist} - ${item.title}`,
            ids: (item.youtube ?? []).map((c) => c.id),
          });
        }
      }
    }
  }
  return songs;
}

/** 'ok' | 'dead:<status>' | 'unreachable' */
async function check(id) {
  const target = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: abort.signal });
    if ([401, 403, 404].includes(res.status)) return `dead:${res.status}`;
    if (!res.ok) return 'unreachable';
    await res.json();
    return 'ok';
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}

const songs = loadSongs();
const unique = [...new Set(songs.flatMap((s) => s.ids))];
console.log(`Checking ${unique.length} YouTube videos of ${songs.length} songs…`);

const status = new Map();
let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < unique.length) {
      const id = unique[next++];
      status.set(id, await check(id));
    }
  }),
);

const unreachable = [...status.values()].filter((s) => s === 'unreachable').length;
if (unreachable === unique.length) {
  console.log('YouTube could not be reached (no network?). Nothing was checked; not a failure.');
  process.exit(0);
}

let problems = 0;
for (const song of songs) {
  const results = song.ids.map((id) => [id, status.get(id)]);
  const dead = results.filter(([, s]) => s.startsWith('dead'));
  // An id we could not reach is given the benefit of the doubt (it may be the network).
  const working = results.length - dead.length;
  for (const [id, s] of dead) {
    problems++;
    console.log(`DEAD  ${id}  ${s}  ${song.name} (${song.where})`);
  }
  if (working < MIN_WORKING) {
    problems++;
    console.log(`FEW   ${song.name} (${song.where}): ${working} working, ${MIN_WORKING} wanted`);
  }
}
if (unreachable > 0) console.log(`${unreachable} video(s) could not be reached and were not judged.`);
console.log(problems === 0 ? 'All uploads answer.' : `${problems} problem(s).`);
process.exit(problems > 0 && !soft ? 1 : 0);
