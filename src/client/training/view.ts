import { effortRow, type EffortLabelKey, type EffortTable } from '../../domain/effort';
import type { Segment } from '../../domain/segments';
import { intensityAt, positionOf, stepAt } from '../../domain/segments';
import type { Position } from '../../domain/workout';
import type { EngineState } from '../../domain/session-engine';

/** Everything the Basic layouts display, derived from the engine state. */
export interface TrainingView {
  segment: Segment;
  next?: Segment;
  /** Zone color of the next block's starting effort. */
  nextColor: string;
  /** Zero-based. */
  index: number;
  total: number;
  effort: number;
  ftpPct: number;
  labelKey: EffortLabelKey;
  /** Zone color of the current effort. */
  color: string;
  remainingSec: number;
  durationSec: number;
  elapsedSec: number;
  /** Resolved position of the current block (seated unless the block says otherwise). */
  position: Position;
  /** Zero-based step inside a stepped ramp; stepCount 1 = not stepped. */
  stepIndex: number;
  stepCount: number;
  /** Seconds until the next step, null on the last step or outside a stepped ramp. */
  nextStepInSec: number | null;
  /** Last seconds of a running block. */
  pulse: boolean;
}

const PULSE_SEC = 3;

export function buildTrainingView(
  segments: readonly Segment[],
  state: EngineState,
  table: EffortTable,
): TrainingView | undefined {
  const segment = segments[state.segmentIndex];
  if (!segment) return undefined;
  const { effort, ftpPct } = intensityAt(segment, state.segmentElapsedSec, table);
  const row = effortRow(effort, table);
  const fresh = state.status === 'idle' && state.segmentRemainingSec <= 0;
  const remainingSec = fresh ? segment.durationSec : Math.max(0, state.segmentRemainingSec);
  const next = segments[state.segmentIndex + 1];
  const step = stepAt(segment, state.segmentElapsedSec);
  const view: TrainingView = {
    nextColor: next ? effortRow(next.effortStart, table).color : row.color,
    segment,
    index: segment.index,
    total: segments.length,
    effort,
    ftpPct,
    labelKey: row.labelKey,
    color: row.color,
    position: positionOf(segment),
    stepIndex: step.index,
    stepCount: step.count,
    nextStepInSec: step.nextInSec,
    remainingSec,
    durationSec: segment.durationSec,
    elapsedSec: state.workoutElapsedSec,
    pulse: state.status === 'running' && remainingSec > 0 && remainingSec <= PULSE_SEC,
  };
  if (next) view.next = next;
  return view;
}
