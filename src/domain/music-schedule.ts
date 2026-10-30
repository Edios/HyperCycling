import type { Segment } from './segments';
import type { MusicCue, TrackRef } from './workout';

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
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([startSec, cue]) => ({ startSec, cue }));
}

/** Sequential fallback tracks from `anchor` (each from 0) until `limit`. */
function fallbackPieces(fallback: TrackRef[], anchor: number, limit: number): Piece[] {
  const out: Piece[] = [];
  let time = anchor;
  for (let i = 0; i < fallback.length && time < limit; i++) {
    const track = fallback[i] as TrackRef;
    const dur = track.durationSec;
    const end = dur === undefined ? Infinity : time + dur;
    if (end > time) {
      out.push({
        startSec: time,
        endSec: Math.min(end, limit),
        track,
        offsetAtStart: 0,
        source: 'fallback',
        key: `fb:${i}:${anchor}`,
      });
    }
    if (dur === undefined) break;
    time = end;
  }
  return out;
}

function buildPieces(input: Omit<MusicScheduleInput, 'tSec'>): Piece[] {
  const total = totalSec(input.segments);
  const cues = resolveCues(input.segments, input.cues).filter((c) => c.startSec < total);
  const pieces: Piece[] = [];
  const firstCueStart = cues[0]?.startSec ?? total;
  pieces.push(...fallbackPieces(input.fallback, 0, firstCueStart));

  cues.forEach((rc, n) => {
    const limit = cues[n + 1]?.startSec ?? total;
    const { track } = rc.cue;
    const dur = track.durationSec;
    const end = dur === undefined ? Infinity : rc.startSec + Math.max(0, dur - track.startAtSec);
    if (end > rc.startSec) {
      pieces.push({
        startSec: rc.startSec,
        endSec: Math.min(end, limit),
        track,
        offsetAtStart: track.startAtSec,
        source: 'cue',
        key: `cue:${rc.cue.blockId}:${rc.cue.rep}`,
      });
    }
    if (end < limit) pieces.push(...fallbackPieces(input.fallback, end, limit));
  });
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
