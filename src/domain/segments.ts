import {
  DEFAULT_EFFORT_TABLE,
  effortToFtpPct,
  ftpPctToEffort,
  type EffortLevel,
  type EffortTable,
} from './effort';
import type { Block, Intensity, Position, RampBlock, SteadyBlock, Workout } from './workout';

export interface Segment {
  index: number;
  startSec: number;
  durationSec: number;
  kind: 'steady' | 'ramp';
  ftpPctStart: number;
  ftpPctEnd: number;
  effortStart: EffortLevel;
  effortEnd: EffortLevel;
  rpm?: number;
  position?: Position;
  cue?: string;
  label?: string;
  blockId: string;
  rep: number;
  reps: number;
}

/** Exact ftpPct wins over the effort table value. */
function resolveFtpPct(i: Intensity, table: EffortTable): number {
  if (i.ftpPct !== undefined) return i.ftpPct;
  if (i.effort !== undefined) return effortToFtpPct(i.effort, table);
  throw new Error('Intensity needs effort or ftpPct');
}

export function flattenWorkout(w: Workout, table: EffortTable = DEFAULT_EFFORT_TABLE): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  const push = (b: SteadyBlock | RampBlock, rep: number, reps: number): void => {
    const [from, to] = b.kind === 'steady' ? [b.intensity, b.intensity] : [b.from, b.to];
    const ftpPctStart = resolveFtpPct(from, table);
    const ftpPctEnd = resolveFtpPct(to, table);
    const seg: Segment = {
      index: segments.length,
      startSec: cursor,
      durationSec: b.durationSec,
      kind: b.kind,
      ftpPctStart,
      ftpPctEnd,
      effortStart: ftpPctToEffort(ftpPctStart, table),
      effortEnd: ftpPctToEffort(ftpPctEnd, table),
      blockId: b.id,
      rep,
      reps,
    };
    if (b.rpm !== undefined) seg.rpm = b.rpm;
    if (b.position !== undefined) seg.position = b.position;
    if (b.cue !== undefined) seg.cue = b.cue;
    if (b.label !== undefined) seg.label = b.label;
    segments.push(seg);
    cursor += b.durationSec;
  };

  const walk = (block: Block): void => {
    if (block.kind === 'repeat') {
      for (let rep = 1; rep <= block.times; rep++) {
        for (const child of block.blocks) push(child, rep, block.times);
      }
    } else {
      push(block, 1, 1);
    }
  };

  w.blocks.forEach(walk);
  return segments;
}

export function intensityAt(
  seg: Segment,
  segElapsedSec: number,
  table: EffortTable = DEFAULT_EFFORT_TABLE,
): { ftpPct: number; effort: EffortLevel } {
  const t = Math.min(Math.max(segElapsedSec, 0), seg.durationSec);
  const ftpPct =
    seg.kind === 'ramp'
      ? seg.ftpPctStart + ((seg.ftpPctEnd - seg.ftpPctStart) * t) / seg.durationSec
      : seg.ftpPctStart;
  return { ftpPct, effort: ftpPctToEffort(ftpPct, table) };
}

/** Index of the segment active at `tSec`. Boundaries belong to the next segment; empty list gives -1. */
export function segmentAt(segments: Segment[], tSec: number): number {
  if (segments.length === 0) return -1;
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const s = segments[mid];
    if (s && s.startSec <= tSec) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
