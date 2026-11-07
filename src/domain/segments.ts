import {
  DEFAULT_EFFORT_TABLE,
  effortToFtpPct,
  ftpPctToEffort,
  type EffortLevel,
  type EffortTable,
} from './effort';
import { EFFORT_OPTS, PCT_OPTS, quantizeRamp, quantizeRampExact, type RampStep } from './quantize';
import type { ResistanceMode } from './settings';
import type { Block, Intensity, Position, RampBlock, SteadyBlock, Workout } from './workout';

/** One steady stretch inside a stepped ramp segment (derived, never stored). */
export interface Step {
  offsetSec: number;
  durationSec: number;
  ftpPct: number;
  effort: EffortLevel;
}

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
  /** Always set by flattenWorkout (default 'seated'); optional only so older fixtures still type. */
  position?: Position;
  /** Present on ramp segments flattened for a stepped mode; absent = continuous. */
  steps?: Step[];
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

const clampEffort = (v: number): EffortLevel =>
  Math.min(10, Math.max(1, Math.round(v))) as EffortLevel;

/** Derives the steps of one ramp. `knob` quantises on the effort scale, `knobPower` on %FTP. */
function deriveSteps(
  b: RampBlock,
  ftpPctStart: number,
  ftpPctEnd: number,
  effortStart: EffortLevel,
  effortEnd: EffortLevel,
  mode: ResistanceMode,
  table: EffortTable,
): Step[] {
  const override = b.steps !== undefined && b.steps >= 1 ? b.steps : 0;
  if (mode === 'knobPower') {
    const raw: RampStep[] = override
      ? quantizeRampExact(ftpPctStart, ftpPctEnd, b.durationSec, override, PCT_OPTS)
      : quantizeRamp(ftpPctStart, ftpPctEnd, b.durationSec, PCT_OPTS);
    return raw.map((s) => ({
      offsetSec: s.offsetSec,
      durationSec: s.durationSec,
      ftpPct: s.value,
      effort: ftpPctToEffort(s.value, table),
    }));
  }
  const raw: RampStep[] = override
    ? quantizeRampExact(effortStart, effortEnd, b.durationSec, override, EFFORT_OPTS)
    : quantizeRamp(effortStart, effortEnd, b.durationSec, EFFORT_OPTS);
  return raw.map((s) => {
    const effort = clampEffort(s.value);
    return {
      offsetSec: s.offsetSec,
      durationSec: s.durationSec,
      ftpPct: effortToFtpPct(effort, table),
      effort,
    };
  });
}

export function positionOf(seg: Pick<Segment, 'position'>): Position {
  return seg.position ?? 'seated';
}

/**
 * `mode` defaults to 'smart' (continuous ramps, today's behaviour) so callers that only
 * display or measure are unchanged; the training path passes the rider's resistance mode.
 */
export function flattenWorkout(
  w: Workout,
  table: EffortTable = DEFAULT_EFFORT_TABLE,
  mode: ResistanceMode = 'smart',
): Segment[] {
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
    seg.position = b.position ?? 'seated';
    if (b.kind === 'ramp' && mode !== 'smart') {
      const steps = deriveSteps(
        b,
        ftpPctStart,
        ftpPctEnd,
        seg.effortStart,
        seg.effortEnd,
        mode,
        table,
      );
      if (steps.length > 0) seg.steps = steps;
    }
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

function stepIndexAt(steps: readonly Step[], t: number): number {
  let idx = 0;
  for (let i = 0; i < steps.length; i++) {
    if ((steps[i]?.offsetSec ?? 0) <= t) idx = i;
    else break;
  }
  return idx;
}

/** Which step of a segment is active, how many there are, and seconds until the next one. */
export function stepAt(
  seg: Segment,
  segElapsedSec: number,
): { index: number; count: number; nextInSec: number | null } {
  const steps = seg.steps;
  if (!steps || steps.length === 0) return { index: 0, count: 1, nextInSec: null };
  const t = Math.min(Math.max(segElapsedSec, 0), seg.durationSec);
  const index = stepIndexAt(steps, t);
  const next = steps[index + 1];
  return { index, count: steps.length, nextInSec: next ? next.offsetSec - t : null };
}

export function intensityAt(
  seg: Segment,
  segElapsedSec: number,
  table: EffortTable = DEFAULT_EFFORT_TABLE,
): { ftpPct: number; effort: EffortLevel } {
  const t = Math.min(Math.max(segElapsedSec, 0), seg.durationSec);
  if (seg.steps && seg.steps.length > 0) {
    const step = seg.steps[stepIndexAt(seg.steps, t)];
    if (step) return { ftpPct: step.ftpPct, effort: step.effort };
  }
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
