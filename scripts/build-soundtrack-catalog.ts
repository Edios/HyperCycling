// Builds the shipped soundtrack catalog (src/content/soundtrack/catalog.json) from the research
// proposal and the owner-approved selection of song ids (soundtrack spec §5.2, §12).
//
//   npx tsx scripts/build-soundtrack-catalog.ts
//   npx tsx scripts/build-soundtrack-catalog.ts --proposal <catalog-proposal-v2.json> \
//     --selection <catalog-selection-150.json> [--out <catalog.json>] [--check]
//
// Defaults read docs/superpowers/research/ (git-ignored; the research lives outside the repo
// history). `--check` writes nothing and exits 1 when the file on disk differs from the build.
//
// What it does to each selected entry:
// - keeps only the fields of the production schema (drops `_proposal` and any helper field);
// - turns the proposal's role letters into names (s steady, i intervals, w warm-up, c climb,
//   d cool-down) and applies the owner's rule: a song ridden at 105 rpm or faster is for
//   intervals only (`ROLE_SPRINT_RPM`, `catalogRpm`);
// - files dance-house ridden at half tempo (Kygo, Alan Walker...) under Pop/Electronic, not House;
// - keeps the tempo notes in English, drops research-only notes and re-uploaders' channel names;
// - applies the upload fixes found since the proposal (`UPLOAD_FIXES`);
// - refuses songs the owner vetoed, then validates everything with `parseCatalog`.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import {
  catalogRpm,
  parseCatalog,
  ROLE_SPRINT_RPM,
  TRACK_ROLES,
  type CatalogTrack,
  type SoundtrackCatalog,
  type TrackRole,
} from '../src/domain/soundtrack-catalog';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const research = join(root, 'docs', 'superpowers', 'research');
const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v !== undefined ? resolve(v) : fallback;
};
const proposalPath = arg('--proposal', join(research, 'catalog-proposal-v2.json'));
const selectionPath = arg('--selection', join(research, 'catalog-selection-150.json'));
const outPath = arg('--out', join(root, 'src', 'content', 'soundtrack', 'catalog.json'));
const checkOnly = args.includes('--check');

/** Songs the owner vetoed; the build fails if the selection lists one. */
const VETOED = new Set(['wham-last-christmas']);

/**
 * Upload fixes found after the proposal was written: dead ids to drop and checked uploads to add
 * (oEmbed 200, playable in embeds, available in PL), with the day they were checked.
 */
const UPLOAD_FIXES: Record<
  string,
  { drop: string[]; add: { id: string; label: string; durationSec: number }[]; verified: string }
> = {
  // XoHI6Zus2UI: embedding disabled (oEmbed 401) on 2026-11-21.
  'college-a-real-hero': {
    drop: ['XoHI6Zus2UI'],
    add: [
      { id: '-DSVDcw6iW8', label: 'official/topic (Valerie Records)', durationSec: 268 },
      { id: 'BHgYtKkSEDA', label: 'official/topic (Electric Youth)', durationSec: 268 },
    ],
    verified: '2026-11-21',
  },
};

const ROLE_LETTERS: Record<string, TrackRole> = {
  s: 'steady',
  i: 'intervals',
  w: 'warmup',
  c: 'climb',
  d: 'cooldown',
};

/** Shape of a proposal entry (only what the build reads). */
interface ProposalTrack {
  id: string;
  artist: string;
  title: string;
  bpm: number | null;
  durationSec: number;
  youtube: { id: string; label?: string; durationSec?: number; offsetSec?: number }[];
  categories: string[];
  energy: number;
  beat: 'steady' | 'none';
  clean: boolean;
  traits?: string[];
  bpmNote?: string;
  gem?: boolean;
  verified: string;
  _proposal: { version: string; roles: string[]; pl: boolean };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function roles(t: ProposalTrack): TrackRole[] {
  if (t.bpm !== null && catalogRpm(t.bpm) >= ROLE_SPRINT_RPM) return ['intervals'];
  const named = t._proposal.roles.map((r) => ROLE_LETTERS[r] ?? fail(`${t.id}: role "${r}"?`));
  return TRACK_ROLES.filter((r) => named.includes(r));
}

/** Dance-house at half tempo is Pop/Electronic for the rider, not House (owner, 2026-11-21). */
function categories(t: ProposalTrack): string[] {
  const halfTempoDance = (t.bpmNote ?? '').includes('dance-house');
  const cats = halfTempoDance ? t.categories.filter((c) => c !== 'house') : t.categories;
  return [...new Set(cats)];
}

/** Tempo notes in English; research-only notes ("from the v1 reserve", genre remarks) dropped. */
function bpmNote(t: ProposalTrack): string | undefined {
  const notes: string[] = [];
  for (const part of (t.bpmNote ?? '').split(';').map((s) => s.trim())) {
    const octave = /^źródła podają (\d+) \(oktawa\)$/.exec(part);
    if (octave) notes.push(`sources say ${octave[1]} (octave)`);
    else if (part === 'źródła na żywo się nie zgadzają') notes.push('live sources disagree');
  }
  return notes.length > 0 ? notes.join('; ') : undefined;
}

/**
 * Upload note: the official channel's name stays (it tells the music check whose upload it is);
 * a re-upload keeps only the kind, so private uploaders' names do not ship with the app.
 */
function uploadLabel(label: string | undefined): string | undefined {
  if (!label) return undefined;
  return label.startsWith('re-upload') ? 're-upload' : label;
}

function toCatalog(t: ProposalTrack): CatalogTrack {
  if (t.bpm === null) fail(`${t.id}: no BPM`);
  const out: Record<string, unknown> = {
    id: t.id,
    artist: t.artist,
    title: t.title,
    bpm: t.bpm,
    durationSec: t.durationSec,
  };
  if (t._proposal.version !== 'album') out.version = t._proposal.version;
  out.categories = categories(t);
  out.roles = roles(t);
  out.energy = t.energy;
  out.beat = t.beat;
  out.clean = t.clean;
  if (t.traits && t.traits.length > 0) out.traits = t.traits;
  const note = bpmNote(t);
  if (note !== undefined) out.bpmNote = note;
  if (t.gem === true) out.gem = true;
  if (t._proposal.pl) out.pl = true;
  const fix = UPLOAD_FIXES[t.id];
  out.verified = fix?.verified ?? t.verified;
  const uploads: ProposalTrack['youtube'] = [
    ...t.youtube.filter((y) => !(fix?.drop ?? []).includes(y.id)),
    ...(fix?.add ?? []),
  ];
  out.youtube = uploads.map((y) => {
    const u: Record<string, unknown> = { id: y.id };
    const label = uploadLabel(y.label);
    if (label !== undefined) u.label = label;
    if (y.offsetSec !== undefined) u.offsetSec = y.offsetSec;
    u.durationSec = y.durationSec;
    return u;
  });
  return out as unknown as CatalogTrack;
}

const proposal = JSON.parse(readFileSync(proposalPath, 'utf8')) as { tracks: ProposalTrack[] };
const selection = JSON.parse(readFileSync(selectionPath, 'utf8')) as string[];
const byId = new Map(proposal.tracks.map((t) => [t.id, t]));
const vetoed = selection.filter((id) => VETOED.has(id));
if (vetoed.length > 0) fail(`Vetoed songs in the selection: ${vetoed.join(', ')}`);
const missing = selection.filter((id) => !byId.has(id));
if (missing.length > 0) fail(`Selected ids missing from the proposal: ${missing.join(', ')}`);

const catalog: SoundtrackCatalog = {
  v: 1,
  tracks: selection.map((id) => toCatalog(byId.get(id) as ProposalTrack)),
};
parseCatalog(catalog); // throws with every problem listed

const text = await format(JSON.stringify(catalog), {
  ...(await resolveConfig(outPath)),
  filepath: outPath,
});
if (checkOnly) {
  let current = '';
  try {
    // A Windows checkout may have turned LF into CRLF; that is not a content change.
    current = readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    // missing file = out of date
  }
  if (current !== text) fail(`${outPath} is out of date; run the build without --check.`);
  console.log(`${outPath} is up to date (${catalog.tracks.length} songs).`);
} else {
  writeFileSync(outPath, text);
  console.log(`Wrote ${catalog.tracks.length} songs, ${text.length} bytes, to ${outPath}.`);
}
