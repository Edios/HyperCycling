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
//   d cool-down) and applies the owner's rules: a song ridden at 105 rpm or faster is for
//   intervals only (`ROLE_SPRINT_RPM`, `catalogRpm`); an explicit song is never a cool-down;
// - marks synthwave and drum and bass as `supplement` (an add-on style, owner's rule);
// - files dance-house ridden at half tempo (Kygo, Alan Walker...) under Pop/Electronic, not House;
// - keeps the tempo notes in English, drops research-only notes and re-uploaders' channel names;
// - appends the songs added after the selection (`ADDED`) and marks the fallback ones;
// - applies the upload fixes found since the proposal (`UPLOAD_FIXES`);
// - refuses songs the owner vetoed, then validates everything with `parseCatalog`.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import {
  catalogRpm,
  ENERGY_NOTE_MAX,
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

/** Styles the owner wants as an add-on, never the backbone of a ride (2026-11-19). */
const SUPPLEMENT_STYLES = new Set(['synthwave', 'dnb']);

/** Songs the owner vetoed; the build fails if the selection lists one. */
const VETOED = new Set(['wham-last-christmas']);

/**
 * Songs added to the approved selection, from the same proposal (verified data, owner's decision of
 * 2026-11-22): beatless and calm songs for the cool-down, the long fallbacks, and songs for the
 * category tempo gaps (hip-hop 80-90 rpm, lo-fi 75-90, electronic at 80, Latino at 105).
 */
const ADDED = [
  // No clear beat (cool-down), spec §12 wants 8-10.
  'brian-eno-an-ending',
  'ludovico-einaudi-nuvole-bianche',
  'olafur-arnalds-near-light',
  'stars-of-the-lid-requiem-for-dying-mothers-pt-2',
  'sigur-ros-hoppipolla',
  'cigarettes-after-sex-apocalypse',
  'enrique-iglesias-hero',
  'perfect-niewiele-ci-moge-dac',
  // Calm cool-down songs on the beat (also electronic at 80 rpm and lo-fi at 75-85).
  'massive-attack-teardrop',
  'chet-faker-no-diggity',
  // Long instrumental fallback on the beat.
  'tycho-dive',
  // Tempo gaps.
  'goldie-inner-city-life',
  'celia-cruz-la-vida-es-un-carnaval',
  'shakira-whenever-wherever',
  'glass-animals-heat-waves',
  'bonobo-kong',
  'coolio-gangsta-s-paradise',
  'gorillaz-clint-eastwood',
  'eminem-lose-yourself',
  'katy-perry-dark-horse',
];

/** Day every upload of the added songs was checked again (oEmbed, embeddable, PL, not live). */
const ADDED_VERIFIED = '2026-11-22';

/** Long, calm instrumentals the ride may play wherever the songs leave silence (rule R4). */
const FALLBACK = new Set(['stars-of-the-lid-requiem-for-dying-mothers-pt-2', 'tycho-dive']);

interface Upload {
  id: string;
  label?: string;
  durationSec?: number;
  offsetSec?: number;
}

/**
 * Upload fixes found after the proposal was written: ids to drop (dead, live, another version),
 * checked uploads to put first or last (oEmbed 200, playable in embeds, available in PL, not live),
 * the song's length when the main upload changes, and the day they were checked.
 */
const UPLOAD_FIXES: Record<
  string,
  { drop?: string[]; first?: Upload[]; add?: Upload[]; durationSec?: number; verified: string }
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
  // hu6s_t92LiA is the symphonic concert version, Yno1cBseRcc a concert, X9L4j55tdCY another
  // arrangement; the studio recording replaces them.
  'perfect-niewiele-ci-moge-dac': {
    drop: ['hu6s_t92LiA', 'Yno1cBseRcc', 'X9L4j55tdCY'],
    first: [
      { id: 'j6IWnPHWWL8', label: 'official/topic (Perfect - Topic)', durationSec: 223 },
      { id: 'Qj8Ins5mDaE', label: 're-upload', durationSec: 226 },
    ],
    durationSec: 223,
    verified: '2026-11-22',
  },
  // a-Bd5PjpeDc is the Spanish version ("Héroe"); the official English video goes first.
  'enrique-iglesias-hero': {
    drop: ['a-Bd5PjpeDc'],
    first: [{ id: 'koJlIGDImiU', label: 'official/topic (EnriqueIglesiasVEVO)', durationSec: 263 }],
    verified: '2026-11-22',
  },
  // GjjUcuVbpwo is an unofficial "ft. Tee" upload; the official video replaces it.
  'katy-perry-dark-horse': {
    drop: ['GjjUcuVbpwo'],
    add: [{ id: '0KSOMA3QBU0', label: 'official/topic (KatyPerryVEVO)', durationSec: 225 }],
    verified: '2026-11-22',
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
  youtube: Upload[];
  categories: string[];
  energy: number;
  beat: 'steady' | 'none';
  clean: boolean;
  traits?: string[];
  bpmNote?: string;
  gem?: boolean;
  verified: string;
  _proposal: { version: string; roles: string[]; pl: boolean; sub?: string };
}

/**
 * The second energy tagging (energy-matching spec, section 4): `energy` heard by ear, independent
 * of BPM, and a one-sentence note where there is a doubt or a conflict with the role. The tags
 * live next to this script (`soundtrack-energy-tags.json`); a song without a tag keeps the
 * proposal's rough energy and has no `tagged`.
 */
const ENERGY_TAGS = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'soundtrack-energy-tags.json'),
    'utf8',
  ),
) as Record<string, { energy: number; note?: string }>;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function roles(t: ProposalTrack): TrackRole[] {
  if (t.bpm !== null && catalogRpm(t.bpm) >= ROLE_SPRINT_RPM) return ['intervals'];
  const named = t._proposal.roles.map((r) => ROLE_LETTERS[r] ?? fail(`${t.id}: role "${r}"?`));
  // No explicit lyrics in the cool-down (owner, 2026-11-22): such a calm song warms up instead.
  const kept = t.clean ? named : named.filter((r) => r !== 'cooldown');
  if (kept.length === 0) kept.push('warmup');
  return TRACK_ROLES.filter((r) => kept.includes(r));
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
    // "bez wyraźnego beatu" (no clear beat) is what `beat: 'none'` already says.
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
  if (t.bpm === null && t.beat !== 'none') fail(`${t.id}: no BPM`);
  const fix = UPLOAD_FIXES[t.id];
  const out: Record<string, unknown> = { id: t.id, artist: t.artist, title: t.title };
  if (t.bpm !== null) out.bpm = t.bpm;
  out.durationSec = fix?.durationSec ?? t.durationSec;
  if (t._proposal.version !== 'album') out.version = t._proposal.version;
  out.categories = categories(t);
  out.roles = roles(t);
  const tag = ENERGY_TAGS[t.id];
  out.energy = tag?.energy ?? t.energy;
  if (tag !== undefined) {
    out.tagged = 2;
    if (tag.note !== undefined) out.energyNote = tag.note;
  }
  out.beat = t.beat;
  out.clean = t.clean;
  const traits = [...(t.traits ?? []), ...(FALLBACK.has(t.id) ? ['fallback'] : [])];
  if (traits.length > 0) out.traits = traits;
  const note = bpmNote(t);
  if (note !== undefined) out.bpmNote = note;
  if (t.gem === true) out.gem = true;
  if (SUPPLEMENT_STYLES.has(t._proposal.sub ?? '')) out.supplement = true;
  if (t._proposal.pl) out.pl = true;
  out.verified = fix?.verified ?? (ADDED.includes(t.id) ? ADDED_VERIFIED : t.verified);
  const uploads: Upload[] = [
    ...(fix?.first ?? []),
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
const approved = JSON.parse(readFileSync(selectionPath, 'utf8')) as string[];
const twice = ADDED.filter((id) => approved.includes(id));
if (twice.length > 0) fail(`Added songs already in the selection: ${twice.join(', ')}`);
const selection = [...approved, ...ADDED];
const byId = new Map(proposal.tracks.map((t) => [t.id, t]));
const vetoed = selection.filter((id) => VETOED.has(id));
if (vetoed.length > 0) fail(`Vetoed songs in the selection: ${vetoed.join(', ')}`);
const unknownTags = Object.keys(ENERGY_TAGS).filter((id) => !selection.includes(id));
if (unknownTags.length > 0)
  fail(`Energy tags for songs not in the catalog: ${unknownTags.join(', ')}`);
const longNotes = Object.entries(ENERGY_TAGS).filter(
  ([, t]) => (t.note ?? '').length > ENERGY_NOTE_MAX,
);
if (longNotes.length > 0)
  fail(
    `Energy notes over ${ENERGY_NOTE_MAX} characters: ${longNotes.map(([id]) => id).join(', ')}`,
  );
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
