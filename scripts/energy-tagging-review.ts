// Spot check of the energy tagging (energy-matching spec, section 4): writes a Markdown table for
// the owner or a second model to review.
//
//   npx tsx scripts/energy-tagging-review.ts [--base <git ref>] [--seed <n>] [--per-level <n>] \
//     [--out <file>]
//
// Lists: a few random songs of every energy level (seeded, so a run can be repeated), every song
// whose energy changed by 2 or more against `--base` (default `origin/main`), and every Polish
// song. Default output: docs/superpowers/research/energy-tagging-review.md (git-ignored).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCatalog, type CatalogTrack } from '../src/domain/soundtrack-catalog';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalogFile = join('src', 'content', 'soundtrack', 'catalog.json');
const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? (args[i + 1] as string) : fallback;
};
const base = arg('--base', 'origin/main');
const seed = Number(arg('--seed', '1'));
const perLevel = Number(arg('--per-level', '6'));
const out = resolve(
  arg('--out', join(root, 'docs', 'superpowers', 'research', 'energy-tagging-review.md')),
);

/** Small seeded generator (mulberry32): the same seed picks the same songs. */
function random(s: number): () => number {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` songs of `pool`, picked without repeats. */
function sample<T>(pool: readonly T[], count: number, rnd: () => number): T[] {
  const left = [...pool];
  const picked: T[] = [];
  while (picked.length < count && left.length > 0) {
    picked.push(left.splice(Math.floor(rnd() * left.length), 1)[0] as T);
  }
  return picked;
}

const tracks = parseCatalog(JSON.parse(readFileSync(join(root, catalogFile), 'utf8'))).tracks;

/** Energy of every song at `base`, to show what the tagging changed (empty when unreadable). */
function baseEnergy(): Map<string, number> {
  try {
    const text = execFileSync('git', ['show', `${base}:${catalogFile.replaceAll('\\', '/')}`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const old = JSON.parse(text) as { tracks: { id: string; energy: number }[] };
    return new Map(old.tracks.map((t) => [t.id, t.energy]));
  } catch {
    console.warn(`Could not read the catalog at ${base}: no "changed" section.`);
    return new Map();
  }
}
const before = baseEnergy();

const cell = (s: string): string => s.replaceAll('|', '\\|');
const energyCell = (t: CatalogTrack): string => {
  const old = before.get(t.id);
  return old === undefined || old === t.energy ? String(t.energy) : `${old} → ${t.energy}`;
};
const row = (t: CatalogTrack): string =>
  `| ${t.id} | ${cell(`${t.artist} - ${t.title}`)} | ${t.bpm ?? '-'} | ${t.roles.join(', ')} | ` +
  `${energyCell(t)} | ${t.pl === true ? 'PL' : ''} | ${cell(t.energyNote ?? '')} |`;
const table = (rows: readonly CatalogTrack[]): string =>
  [
    '| id | song | BPM | roles | energy | | note |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(row),
  ].join('\n');

const rnd = random(seed);
const lines: string[] = [
  '# Energy tagging: spot check',
  '',
  `Catalog: ${tracks.length} songs. Compared with \`${base}\`. Seed ${seed}, ${perLevel} random songs per level.`,
  'Scale: 1 ambient or lo-fi · 2 light groove, ballad, slow pop · 3 mid-tempo, even pulse, singalong ·',
  '4 driving, "makes you want to ride" · 5 peak: aggressive, heavy, a drop, a sprint song.',
  'Judge how the song sounds, not its BPM or the cadence it is ridden at. Mark songs to change.',
  '',
  '## Spread',
  '',
  ...[1, 2, 3, 4, 5].map((e) => {
    const n = tracks.filter((t) => t.energy === e).length;
    return `- energy ${e}: ${n} (${((100 * n) / tracks.length).toFixed(1)}%)`;
  }),
];
for (const level of [1, 2, 3, 4, 5]) {
  const pool = tracks.filter((t) => t.energy === level);
  lines.push('', `## Energy ${level}: ${perLevel} random of ${pool.length}`, '');
  lines.push(table(sample(pool, perLevel, rnd)));
}
const changed = tracks.filter((t) => Math.abs(t.energy - (before.get(t.id) ?? t.energy)) >= 2);
lines.push('', `## Changed by 2 or more (${changed.length})`, '', table(changed));
const polish = tracks.filter((t) => t.pl === true);
lines.push('', `## Polish songs (${polish.length})`, '', table(polish));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`Wrote the review of ${tracks.length} songs to ${out}.`);
