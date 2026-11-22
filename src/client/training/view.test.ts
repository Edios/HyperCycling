import { describe, expect, it } from 'vitest';
import { DEFAULT_EFFORT_TABLE } from '../../domain/effort';
import type { EngineState } from '../../domain/session-engine';
import type { Segment } from '../../domain/segments';
import { buildTrainingView } from './view';

function seg(i: number, startSec: number, durationSec: number, p?: 'seated' | 'standing'): Segment {
  return {
    index: i,
    kind: 'steady',
    startSec,
    durationSec,
    ftpPctStart: 70,
    ftpPctEnd: 70,
    effortStart: 4,
    effortEnd: 4,
    blockId: `b${i}`,
    rep: 1,
    reps: 1,
    ...(p ? { position: p } : {}),
  };
}

const state = (segmentIndex: number, remaining: number, durationSec: number): EngineState => ({
  status: 'running',
  segmentIndex,
  workoutElapsedSec: 0,
  segmentElapsedSec: durationSec - remaining,
  segmentRemainingSec: remaining,
});

describe('upcoming position change (R6)', () => {
  const segments = [seg(0, 0, 60), seg(1, 60, 30, 'standing'), seg(2, 90, 60, 'standing')];
  const view = (i: number, remaining: number) =>
    buildTrainingView(segments, state(i, remaining, segments[i]?.durationSec ?? 0), DEFAULT_EFFORT_TABLE);

  it('announces standing a few seconds before a seated block ends', () => {
    expect(view(0, 5)?.upcomingPosition).toBe('standing');
  });
  it('is silent while the change is still far away', () => {
    expect(view(0, 30)?.upcomingPosition).toBeUndefined();
  });
  it('is silent when the next block keeps the same position or there is none', () => {
    expect(view(1, 4)?.upcomingPosition).toBeUndefined();
    expect(view(2, 4)?.upcomingPosition).toBeUndefined();
  });
  it('announces going back to seated', () => {
    const s = [seg(0, 0, 30, 'standing'), seg(1, 30, 30)];
    const v = buildTrainingView(s, state(0, 3, 30), DEFAULT_EFFORT_TABLE);
    expect(v?.upcomingPosition).toBe('seated');
  });
});
