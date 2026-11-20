import type { Segment } from './segments';
import { trackPlaySec, type MusicCue, type TrackRef } from './workout';

export interface ScheduledTrack {
  track: TrackRef;
  offsetSec: number;
  source: 'cue' | 'fallback';
  /** Stable id of "this exact playback"; equal for any t inside the same track run. */
  key: string;
}

export interface MusicScheduleInput {
  segments: Segment[];
  cues: MusicCue[];
  fallback: TrackRef[];
  tSec: number;
  /**
   * Tracks that really ended earlier than planned: key of the playback -> the song position
   * (seconds, in the planned track's terms) where it ended. That track is shortened there, the
   * rest of its run moves up, and the free time is filled like any other gap (fallback). Used by
   * the music director when a recording reports its end before the schedule expected it.
   */
  ended?: ReadonlyMap<string, number>;
}

/** Stable key of item `index` of the run of `cue` (0 = the cue's own track). */
export function cueItemKey(cue: Pick<MusicCue, 'blockId' | 'rep'>, index: number): string {
  return index === 0 ? `cue:${cue.blockId}:${cue.rep}` : `cue:${cue.blockId}:${cue.rep}:${index}`;
}

/**
 * Seconds a track plays from its start offset: its planned length, cut where it really ended
 * (`ended`, a song position) when that is earlier. `undefined` = unknown length.
 */
function playLength(
  track: TrackRef,
  key: string,
  ended: ReadonlyMap<string, number> | undefined,
): number | undefined {
  const planned = trackPlaySec(track);
  const endPos = ended?.get(key);
  if (endPos === undefined) return planned;
  const real = Math.max(0, endPos - track.startAtSec);
  return planned === undefined ? real : Math.min(planned, real);
}

interface Piece {
  startSec: number;
  endSec: number; // exclusive, already clipped
  track: TrackRef;
  offsetAtStart: number;
  source: 'cue' | 'fallback';
  key: string;
}

interface ResolvedCue {
  startSec: number;
  cue: MusicCue;
}

function totalSec(segments: Segment[]): number {
  return segments.reduce((max, s) => Math.max(max, s.startSec + s.durationSec), 0);
}

/** Cue start = start of the first matching segment; unmatched cues dropped; same start: later cue wins. */
function resolveCues(segments: Segment[], cues: MusicCue[]): ResolvedCue[] {
  const byStart = new Map<number, MusicCue>();
  for (const cue of cues) {
    const seg = segments.find((s) => s.blockId === cue.blockId && s.rep === cue.rep);
    if (seg) byStart.set(seg.startSec, cue);
  }
  return [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([startSec, cue]) => ({ startSec, cue }));
}

/** Sequential fallback tracks from `anchor` (each from 0) until `limit`. */
function fallbackPieces(
  fallback: TrackRef[],
  anchor: number,
  limit: number,
  ended?: ReadonlyMap<string, number>,
): Piece[] {
  const out: Piece[] = [];
  let time = anchor;
  for (let i = 0; i < fallback.length && time < limit; i++) {
    const track = fallback[i] as TrackRef;
    const key = `fb:${i}:${anchor}`;
    // A fallback track plays from its very start (offset 0), so its length is the whole track.
    const endPos = ended?.get(key);
    const dur =
      endPos === undefined
        ? track.durationSec
        : Math.min(track.durationSec ?? Infinity, Math.max(0, endPos));
    const end = dur === undefined ? Infinity : time + dur;
    if (end > time) {
      out.push({
        startSec: time,
        endSec: Math.min(end, limit),
        track,
        offsetAtStart: 0,
        source: 'fallback',
        key,
      });
    }
    if (dur === undefined) break;
    time = end;
  }
  return out;
}

/** One track of a cue's run, placed on the workout clock. */
export interface RunItem {
  track: TrackRef;
  /** 0 = the cue's own track, 1.. = its queue. */
  index: number;
  /** Stable key of this playback (see {@link cueItemKey}). */
  key: string;
  startSec: number;
  /** Exclusive; clipped to the run's limit (next cue or end of workout). */
  endSec: number;
  /** Where the track would end if nothing cut it (may lie past `endSec`). */
  fullEndSec: number;
  /** Its length is unknown: playback holds the slot to the limit; `fullEndSec` is an estimate. */
  open: boolean;
  /** Cut by the next cue or the end of the workout before it finished. */
  clipped: boolean;
}

/** A cue resolved on the workout clock with the tracks it plays back to back. */
export interface CueRun {
  cue: MusicCue;
  startSec: number;
  /** Start of the next cue, or the end of the workout. */
  limitSec: number;
  items: RunItem[];
  /** When the run's music stops (<= limit); a later gap is free (fallback or silence). */
  endSec: number;
}

export interface CueRunOptions {
  /**
   * Shown length of a track of unknown length (editor). Playback never guesses: such a track holds
   * its slot to the limit. The run still ends at the limit; only `fullEndSec` uses the estimate.
   */
  estimateSec?: number;
  /** Tracks that ended early (see {@link MusicScheduleInput.ended}). */
  ended?: ReadonlyMap<string, number>;
}

/**
 * Every cue on the clock with its run: the cue's track and queue play back to back from their
 * `startAtSec` to their end (trimmed end or length), the one running at the limit is cut there,
 * and a track of unknown length holds the slot to the limit.
 */
export function cueRuns(
  segments: Segment[],
  cues: MusicCue[],
  options: CueRunOptions = {},
): CueRun[] {
  const total = totalSec(segments);
  const resolved = resolveCues(segments, cues).filter((c) => c.startSec < total);
  return resolved.map((rc, n) => {
    const limit = resolved[n + 1]?.startSec ?? total;
    const run = [rc.cue.track, ...(rc.cue.queue ?? [])];
    const items: RunItem[] = [];
    let time = rc.startSec;
    let open = false;
    for (let i = 0; i < run.length && time < limit; i++) {
      const track = run[i] as TrackRef;
      const key = cueItemKey(rc.cue, i);
      const len = playLength(track, key, options.ended);
      if (len === undefined) {
        open = true;
        const guess = options.estimateSec;
        items.push({
          track,
          index: i,
          key,
          startSec: time,
          endSec: limit,
          fullEndSec: guess === undefined ? Infinity : time + guess,
          open: true,
          clipped: guess !== undefined && time + guess > limit,
        });
        break;
      }
      const end = time + len;
      if (end > time) {
        items.push({
          track,
          index: i,
          key,
          startSec: time,
          endSec: Math.min(end, limit),
          fullEndSec: end,
          open: false,
          clipped: end > limit,
        });
      }
      time = end;
    }
    return {
      cue: rc.cue,
      startSec: rc.startSec,
      limitSec: limit,
      items,
      endSec: open ? limit : Math.min(time, limit),
    };
  });
}

function buildPieces(input: Omit<MusicScheduleInput, 'tSec'>): Piece[] {
  const total = totalSec(input.segments);
  const ended = input.ended;
  const runs = cueRuns(input.segments, input.cues, ended ? { ended } : {});
  const pieces: Piece[] = [];
  const firstCueStart = runs[0]?.startSec ?? total;
  pieces.push(...fallbackPieces(input.fallback, 0, firstCueStart, ended));

  for (const run of runs) {
    for (const item of run.items) {
      if (item.endSec <= item.startSec) continue; // ended before it began: nothing to play
      pieces.push({
        startSec: item.startSec,
        endSec: item.endSec,
        track: item.track,
        offsetAtStart: item.track.startAtSec,
        source: 'cue',
        key: item.key,
      });
    }
    if (run.endSec < run.limitSec) {
      pieces.push(...fallbackPieces(input.fallback, run.endSec, run.limitSec, ended));
    }
  }
  return pieces;
}

function toScheduled(p: Piece, tSec: number): ScheduledTrack {
  return {
    track: p.track,
    offsetSec: tSec - p.startSec + p.offsetAtStart,
    source: p.source,
    key: p.key,
  };
}

function findAt(pieces: Piece[], tSec: number): Piece | undefined {
  return pieces.find((p) => p.startSec <= tSec && tSec < p.endSec);
}

export function musicAt(input: MusicScheduleInput): ScheduledTrack | null {
  const t = Math.max(0, input.tSec);
  if (t >= totalSec(input.segments)) return null;
  const piece = findAt(buildPieces(input), t);
  return piece ? toScheduled(piece, t) : null;
}

export function nextTrackChange(
  input: MusicScheduleInput,
): { atSec: number; track: ScheduledTrack | null } | null {
  const total = totalSec(input.segments);
  const t = Math.max(0, input.tSec);
  if (t >= total) return null;
  const pieces = buildPieces(input);
  const currentKey = findAt(pieces, t)?.key ?? null;
  const boundaries = new Set<number>([total]);
  for (const p of pieces) {
    boundaries.add(p.startSec);
    boundaries.add(p.endSec);
  }
  const sorted = [...boundaries].filter((b) => b > t && b <= total).sort((a, b) => a - b);
  for (const b of sorted) {
    const piece = b >= total ? undefined : findAt(pieces, b);
    if ((piece?.key ?? null) !== currentKey) {
      return { atSec: b, track: piece ? toScheduled(piece, b) : null };
    }
  }
  return null;
}
