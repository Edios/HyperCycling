/**
 * Closing the silence at the end of a song slot whose queue is shorter than the slot (pure logic).
 *
 * The rules are tried in this order (soundtrack spec §7.4, research A6 §3), cheapest first:
 *
 * - R1 `longer`: another recording of a queued song that is longer (album/extended over a video
 *   edit), as long as the queue then ends in the slot or is cut by at most `MAX_CUT_SEC`.
 * - R2 `reserve`: the next reserve song (the author's alternatives) in the slot's tempo, not used
 *   anywhere else in the session, long enough to close the gap. Only for gaps of at least
 *   `MIN_RESERVE_SEC`: a few seconds of another song is worse than a quiet bed.
 * - R3 `loop`: the ending of the last song again (`startAtSec = length - gap`), only for a song
 *   marked loopable (instrumental) and a gap of at most `MAX_LOOP_SEC`.
 * - R4 `fallback`: the workout's fallback track (a long, calm piece) plays in what is left. The
 *   schedule does that by itself for every gap; this only reports that it will.
 * - R5: when none of the above can cover the gap, the report says how much silence is left.
 */
import { songKey } from './slot-plan';
import { trackPlaySec, type TrackRef } from './workout';

/** A gap up to this long is a normal seam between songs, not something to fill. */
export const GAP_TOLERANCE_SEC = 1;
/** R1 may make the queue overshoot the slot by this much (the cut fades on the boundary). */
export const MAX_CUT_SEC = 45;
/** R2 only for gaps at least this long. */
export const MIN_RESERVE_SEC = 20;
/** R3 only for gaps up to this long. */
export const MAX_LOOP_SEC = 45;
/** R2: the reserve song's tempo (or its half/double) within this share of the slot's tempo. */
export const RESERVE_TEMPO_TOLERANCE = 0.1;

export type GapRule = 'longer' | 'reserve' | 'loop' | 'fallback';

export interface GapFillOptions {
  /** `songKey`s already played somewhere in the session; R2 never repeats them. */
  used?: ReadonlySet<string>;
  /** Tempo of the slot (the first song's BPM); R2 skips songs far from it. Unknown = any tempo. */
  bpm?: number;
  /** `songKey`s of instrumental songs whose ending may be repeated (R3). */
  loopable?: ReadonlySet<string>;
  /** Total length of the workout's fallback tracks (R4); 0 or absent = no fallback. */
  fallbackSec?: number;
}

export interface GapFill {
  /** The queue to play: the input with R1-R3 applied (the input is not changed). */
  queue: TrackRef[];
  /** Gap before any rule, seconds (0 when the queue already covers the slot). */
  gapBeforeSec: number;
  /** Gap left after R1-R3, seconds; the fallback (R4) plays there when there is one. */
  gapSec: number;
  /** Rules that were applied, in order. */
  rules: GapRule[];
  /** Silence left after all rules (R5): `gapSec` when the fallback cannot cover it, else 0. */
  silenceSec: number;
  /** `songKey`s this fill added to the session (R2), for the caller's `used` set. */
  added: string[];
}

const len = (t: TrackRef): number => trackPlaySec(t) ?? 0;
const lenOf = (queue: readonly TrackRef[]): number => queue.reduce((s, t) => s + len(t), 0);

/** Every recording of a queue entry: the main one first, then its backups. */
const recordings = (t: TrackRef): TrackRef[] => {
  const { alternates, ...main } = t;
  return [main, ...(alternates ?? [])];
};

/** The entry with `pick` as its main recording and the others (main first) as its backups. */
function promote(entry: TrackRef, pick: TrackRef): TrackRef {
  const rest = recordings(entry).filter(
    (r) => r !== pick && !(r.id === pick.id && r.provider === pick.provider),
  );
  const { alternates: _drop, ...plain } = pick;
  void _drop;
  return rest.length > 0 ? { ...plain, alternates: rest } : plain;
}

/** True when `bpm` (or its half/double) is within the tolerance of `target`. */
export function tempoFits(bpm: number | undefined, target: number | undefined): boolean {
  if (bpm === undefined || target === undefined) return true;
  return [bpm, bpm * 2, bpm / 2].some(
    (b) => Math.abs(b - target) / target <= RESERVE_TEMPO_TOLERANCE,
  );
}

/** R1: the longer recording that makes the queue fit best, if any. */
function longer(queue: TrackRef[], slotSec: number, gap: number): TrackRef[] | undefined {
  let best: { queue: TrackRef[]; over: number } | undefined;
  queue.forEach((entry, i) => {
    const main = recordings(entry)[0] as TrackRef;
    for (const rec of recordings(entry).slice(1)) {
      if (rec.durationSec === undefined || rec.notEmbeddable) continue;
      const extra = len(rec) - len(main);
      if (extra < gap / 2) continue; // not worth swapping for a few seconds
      const total = lenOf(queue) + extra;
      const over = total - slotSec;
      if (over > MAX_CUT_SEC) continue; // a much longer upload is likely another cut or a mix
      // Prefer the one that leaves the smallest gap, then the smallest cut.
      const score = Math.max(0, -over) * 1000 + Math.max(0, over);
      if (!best || score < best.over) {
        const next = [...queue];
        next[i] = promote(entry, rec);
        best = { queue: next, over: score };
      }
    }
  });
  return best?.queue;
}

/**
 * Makes the queue of one slot reach the end of the slot (see the rules above). `reserve` is the
 * slot's reserve, best first, each entry with its backup recordings.
 */
export function fillSlotGap(
  queue: readonly TrackRef[],
  slotSec: number,
  reserve: readonly TrackRef[],
  options: GapFillOptions = {},
): GapFill {
  let current = [...queue];
  const gapBeforeSec = Math.max(0, slotSec - lenOf(current));
  const rules: GapRule[] = [];
  const added: string[] = [];
  const gapNow = (): number => Math.max(0, slotSec - lenOf(current));
  // A track of unknown length holds the slot to its end: nothing to fill.
  const open = current.some((t) => trackPlaySec(t) === undefined);

  if (!open && current.length > 0 && gapNow() > GAP_TOLERANCE_SEC) {
    const r1 = longer(current, slotSec, gapNow());
    if (r1) {
      current = r1;
      rules.push('longer');
    }
  }

  if (!open && current.length > 0 && gapNow() >= MIN_RESERVE_SEC) {
    const queued = new Set(current.map(songKey));
    const gap = gapNow();
    const pick = reserve.find((r) => {
      const key = songKey(r);
      return (
        !queued.has(key) &&
        !(options.used?.has(key) ?? false) &&
        tempoFits(r.bpm, options.bpm) &&
        r.durationSec !== undefined &&
        len(r) >= gap - GAP_TOLERANCE_SEC
      );
    });
    if (pick) {
      current = [...current, pick];
      added.push(songKey(pick));
      rules.push('reserve');
    }
  }

  const last = current[current.length - 1];
  const gapForLoop = gapNow();
  if (
    !open &&
    last &&
    gapForLoop > GAP_TOLERANCE_SEC &&
    gapForLoop <= MAX_LOOP_SEC &&
    last.durationSec !== undefined &&
    (options.loopable?.has(songKey(last)) ?? false)
  ) {
    const { alternates: _a, endAtSec: _e, ...plain } = last;
    void _a;
    void _e;
    const startAtSec = Math.max(
      last.startAtSec,
      Math.floor(last.durationSec - Math.ceil(gapForLoop)),
    );
    current = [...current, { ...plain, startAtSec }];
    rules.push('loop');
  }

  const gapSec = open ? 0 : gapNow();
  const fallbackSec = options.fallbackSec ?? 0;
  const covered = gapSec <= GAP_TOLERANCE_SEC || fallbackSec >= gapSec;
  if (gapSec > GAP_TOLERANCE_SEC && covered) rules.push('fallback');
  return {
    queue: current,
    gapBeforeSec,
    gapSec,
    rules,
    silenceSec: covered ? 0 : gapSec,
    added,
  };
}
