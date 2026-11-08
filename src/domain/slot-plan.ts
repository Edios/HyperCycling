/**
 * Slot planner: from the candidates of one song slot, builds the queue of tracks that should fill
 * the slot's time. Pure logic; the workout clock rules, so music never moves blocks or cues.
 *
 * 1. Longer version: several results of the same song (artist + title) -> the album/extended
 *    version rather than the radio edit; never live/remix/karaoke unless the hint asks for it.
 * 2. Reserve: while the queue is shorter than the slot, add the next alternatives, ranked by how
 *    well their tempo suits the slot (2 BPM = 1 RPM, half/double time count).
 * 3. Still short: a warning (with the tempo to look for); only rest/cooldown slots may stay silent.
 */
import { rankTracks } from './bpm-match';
import type { TrackRef } from './workout';

/** A slot may be this much shorter than its queue before the plan counts as short. */
export const SLOT_TOLERANCE_SEC = 10;

export interface PlanCandidate {
  track: TrackRef;
  /** 'main' = the first suggestion; 'alt' = an alternative (a/b/c), in order of preference. */
  origin: 'main' | 'alt';
  album?: string;
  /** False = not playable in the rider's market; undefined = not verified. */
  playable?: boolean | undefined;
  explicit?: boolean;
  /** Tempo known from elsewhere (a hint, the library); used to rank alternatives. */
  bpm?: number;
}

export interface PlanPreferences {
  /** Slot kind: only rest/cooldown slots may end in silence. */
  kind?: 'work' | 'rest';
  /** Ids already used by other slots (no duplicates between slots). */
  usedIds?: ReadonlySet<string>;
  /** The hint asks for a remix / live version. */
  wantRemix?: boolean;
  toleranceSec?: number;
}

export interface SlotPlan {
  queue: PlanCandidate[];
  totalSec: number;
  /** Slot length minus queue length: positive = music is missing, negative = the last track is cut. */
  gapSec: number;
  /** Set when the queue is shorter than the slot (beyond the tolerance). */
  shortBySec?: number;
  /** Tempo to look for to fill the missing time. */
  suggestBpm?: number;
  /** Silence to the end of the slot is acceptable (rest/cooldown only). */
  silenceOk: boolean;
  /** Cut off with the closing fade (queue longer than the slot beyond the tolerance). */
  overBySec?: number;
}

const norm = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Key of "the same song": base title (no feat./remaster/version suffix) + artist. */
export function songKey(t: { title: string; artist?: string }): string {
  const base = t.title
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s-\s.*$/, ' ')
    .replace(/\bfeat\.?.*$/i, ' ');
  return `${norm(base)}|${norm(t.artist ?? '')}`;
}

const BAD = new Set(['live', 'karaoke', 'cover', 'tribute', 'sped', 'slowed', 'reverb', 'demo']);
const OPT_OUT = new Set(['remix', 'acoustic', 'instrumental']);
const SHORT = new Set(['radio', 'edit', 'single']);

function words(c: PlanCandidate): Set<string> {
  return new Set(norm(`${c.track.title} ${c.album ?? ''}`).split(' '));
}

/** Version quality: lower is better. Radio edits lose to album/extended versions. */
function versionRank(c: PlanCandidate, wantRemix: boolean): number {
  const w = words(c);
  let r = 0;
  for (const x of w) {
    if (BAD.has(x)) r += 100;
    else if (OPT_OUT.has(x)) r += wantRemix ? 0 : 50;
    else if (SHORT.has(x)) r += 5;
  }
  return r;
}

const dur = (c: PlanCandidate): number => c.track.durationSec ?? Infinity;

/**
 * The best version among results of the same song: not live/remix/etc., then the one that covers
 * the slot with the least overshoot, else the longest (radio edits lose).
 */
export function pickVersion(
  versions: readonly PlanCandidate[],
  slotSec: number,
  wantRemix = false,
  toleranceSec = SLOT_TOLERANCE_SEC,
): PlanCandidate | undefined {
  const ok = versions.filter((v) => v.playable !== false);
  if (ok.length === 0) return undefined;
  const best = Math.min(...ok.map((v) => versionRank(v, wantRemix)));
  const pool = ok.filter((v) => versionRank(v, wantRemix) === best);
  const known = pool.filter((v) => v.track.durationSec !== undefined);
  if (known.length === 0) return pool[0];
  const covering = known.filter((v) => dur(v) >= slotSec - toleranceSec);
  const pick =
    covering.length > 0
      ? covering.reduce((a, b) => (dur(b) < dur(a) ? b : a))
      : known.reduce((a, b) => (dur(b) > dur(a) ? b : a));
  return pick;
}

function groupBySong(cands: readonly PlanCandidate[]): PlanCandidate[][] {
  const map = new Map<string, PlanCandidate[]>();
  for (const c of cands) {
    const k = songKey(c.track);
    const g = map.get(k);
    if (g) g.push(c);
    else map.set(k, [c]);
  }
  return [...map.values()];
}

/** Alternatives ordered by tempo fit (with BPM first, best first), unknown tempo after, stable. */
function orderAlternatives(alts: PlanCandidate[], targetBpm: number | undefined): PlanCandidate[] {
  if (targetBpm === undefined) return alts;
  const tempo = (c: PlanCandidate): number | undefined => c.track.bpm ?? c.bpm;
  const ranked = rankTracks(
    alts.map((c) => {
      const bpm = tempo(c);
      return bpm === undefined ? { c } : { c, bpm };
    }),
    targetBpm / 2,
  ).map((r) => r.track.c);
  const rest = alts.filter((a) => !ranked.includes(a));
  return [...ranked, ...rest.filter((a) => tempo(a) === undefined)];
}

export function planSlot(
  slotSec: number,
  candidates: readonly PlanCandidate[],
  targetBpm: number | undefined,
  prefs: PlanPreferences = {},
): SlotPlan {
  const tol = prefs.toleranceSec ?? SLOT_TOLERANCE_SEC;
  const used = new Set(prefs.usedIds ?? []);
  const usable = candidates.filter((c) => c.playable !== false && !used.has(c.track.id));
  const groups = groupBySong(usable);

  const mainGroups = groups.filter((g) => g.some((c) => c.origin === 'main'));
  const altGroups = groups.filter((g) => !g.some((c) => c.origin === 'main'));
  const queue: PlanCandidate[] = [];
  const seenSongs = new Set<string>();
  let total = 0;
  const add = (g: PlanCandidate[]): void => {
    const v = pickVersion(g, Math.max(0, slotSec - total), prefs.wantRemix, tol);
    if (!v) return;
    queue.push(v);
    seenSongs.add(songKey(v.track));
    total += v.track.durationSec ?? Math.max(0, slotSec - total);
  };

  for (const g of mainGroups) add(g);
  const altBest = altGroups
    .map((g) => pickVersion(g, slotSec, prefs.wantRemix, tol))
    .filter((v): v is PlanCandidate => v !== undefined);
  for (const a of orderAlternatives(altBest, targetBpm)) {
    if (total >= slotSec - tol) break;
    if (seenSongs.has(songKey(a.track))) continue;
    const g = altGroups.find((x) => x.includes(a));
    if (g) add(g);
  }

  const gapSec = Math.round(slotSec - total);
  const plan: SlotPlan = {
    queue,
    totalSec: Math.round(total),
    gapSec,
    silenceOk: prefs.kind === 'rest',
  };
  if (gapSec > tol) {
    plan.shortBySec = gapSec;
    if (targetBpm !== undefined) plan.suggestBpm = Math.round(targetBpm);
  } else if (-gapSec > tol) {
    plan.overBySec = -gapSec;
  }
  return plan;
}

/** Plans slots in order; a track used by one slot is not offered to the next. */
export function planSlots(
  slots: readonly {
    sec: number;
    candidates: readonly PlanCandidate[];
    targetBpm?: number;
    kind?: 'work' | 'rest';
    wantRemix?: boolean;
  }[],
): SlotPlan[] {
  const used = new Set<string>();
  return slots.map((s) => {
    const plan = planSlot(s.sec, s.candidates, s.targetBpm, {
      usedIds: used,
      ...(s.kind ? { kind: s.kind } : {}),
      ...(s.wantRemix ? { wantRemix: true } : {}),
    });
    for (const c of plan.queue) used.add(c.track.id);
    return plan;
  });
}

/** Sum of known durations (minus start offsets) of a queue. Unknown duration counts as 0. */
export function queueSec(tracks: readonly TrackRef[]): number {
  return tracks.reduce((s, t) => s + Math.max(0, (t.durationSec ?? 0) - t.startAtSec), 0);
}

/** "1:10" */
export function formatGap(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The best version (per song) of every candidate that is not queued yet, in the planner's order:
 * what "add from reserve" offers.
 */
export function reserveList(
  candidates: readonly PlanCandidate[],
  queued: readonly { id: string; title: string; artist?: string }[],
  slotSec: number,
  targetBpm: number | undefined,
  usedIds: ReadonlySet<string> = new Set(),
): PlanCandidate[] {
  const have = new Set(queued.map(songKey));
  const free = candidates.filter(
    (c) => c.playable !== false && !usedIds.has(c.track.id) && !have.has(songKey(c.track)),
  );
  const best = groupBySong(free)
    .map((g) => pickVersion(g, slotSec))
    .filter((v): v is PlanCandidate => v !== undefined);
  const ordered = orderAlternatives(best, targetBpm);
  return [...ordered, ...best.filter((c) => !ordered.includes(c))];
}

/** Another version of the same song as `track`, longer than it (album/extended over radio edit). */
export function longerVersion(
  track: TrackRef,
  candidates: readonly PlanCandidate[],
): PlanCandidate | undefined {
  const key = songKey(track);
  const cur = track.durationSec ?? 0;
  const longer = candidates.filter(
    (c) =>
      c.playable !== false &&
      c.track.id !== track.id &&
      songKey(c.track) === key &&
      (c.track.durationSec ?? 0) > cur &&
      versionRank(c, false) < 100,
  );
  if (longer.length === 0) return undefined;
  return longer.reduce((a, b) => ((b.track.durationSec ?? 0) < (a.track.durationSec ?? 0) ? b : a));
}
