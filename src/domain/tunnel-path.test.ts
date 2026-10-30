import { describe, expect, it } from 'vitest';
import {
  BEND_LENGTH,
  TUNNEL_LENGTH,
  bendScale,
  planMidSectionBend,
  planTransitionBend,
} from './tunnel-path';
import type { Segment } from './segments';

function seg(over: Partial<Segment> = {}): Segment {
  return {
    index: 0,
    startSec: 0,
    durationSec: 120,
    kind: 'steady',
    ftpPctStart: 70,
    ftpPctEnd: 70,
    effortStart: 4,
    effortEnd: 4,
    blockId: 'b',
    rep: 1,
    reps: 1,
    ...over,
  };
}

function seq(...values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i] ?? values[values.length - 1] ?? 0;
    i += 1;
    return v;
  };
}

describe('bendScale', () => {
  it('scales by shorter duration / 45, clamped to [0.3, 1]', () => {
    expect(bendScale(seg({ durationSec: 120 }), seg({ durationSec: 120 }))).toBe(1);
    expect(bendScale(seg({ durationSec: 4.5 }), seg({ durationSec: 120 }))).toBe(0.3);
    expect(bendScale(seg({ durationSec: 120 }), seg({ durationSec: 22.5 }))).toBeCloseTo(0.5);
  });
});

describe('planTransitionBend', () => {
  it('y-bend upward for a positive effort jump', () => {
    const b = planTransitionBend(seg({ effortEnd: 4 }), seg({ effortStart: 6 }), seq(0.5), 1);
    expect(b).toEqual({ axis: 'y', dir: 1, amp: 13, len: 130 });
  });

  it('y-bend downward and amplitude capped at 26', () => {
    const b = planTransitionBend(seg({ effortEnd: 10 }), seg({ effortStart: 1 }), seq(0.5), 1);
    expect(b).toEqual({ axis: 'y', dir: -1, amp: 26, len: 130 });
  });

  it('y-bend uses scale factor', () => {
    const b = planTransitionBend(
      seg({ effortEnd: 4, durationSec: 22.5 }),
      seg({ effortStart: 6 }),
      seq(0.5),
      1,
    );
    expect(b?.amp).toBeCloseTo(6.5);
    expect(b?.len).toBeCloseTo(65);
  });

  it('x-bend that flips direction (rand < 0.65)', () => {
    const b = planTransitionBend(seg(), seg(), seq(0.5, 0.3), 1);
    expect(b).toEqual({ axis: 'x', dir: -1, amp: 38, len: 150 });
  });

  it('x-bend that keeps direction (rand >= 0.65)', () => {
    const b = planTransitionBend(seg(), seg(), seq(0.5, 0.9), -1);
    expect(b).toEqual({ axis: 'x', dir: -1, amp: 38, len: 150 });
  });

  it('no bend when probability roll fails', () => {
    expect(planTransitionBend(seg(), seg(), seq(0.7), 1)).toBeNull();
    expect(planTransitionBend(seg(), seg(), seq(0.95), 1)).toBeNull();
  });

  it('single effort step is not a y-bend', () => {
    const b = planTransitionBend(seg({ effortEnd: 4 }), seg({ effortStart: 5 }), seq(0.99), 1);
    expect(b).toBeNull();
  });
});

describe('planMidSectionBend', () => {
  // bendSeconds = secondsToArrive * (150 / 288)
  const toArrive = 28.8; // bendSeconds = 15

  it('exposes tunnel constants', () => {
    expect(TUNNEL_LENGTH).toBe(288);
    expect(BEND_LENGTH).toBe(150);
  });

  it('returns an x-bend when the section is long and time remains', () => {
    const b = planMidSectionBend(seg({ durationSec: 60 }), 50, toArrive, seq(0.3), 1);
    expect(b).toEqual({ axis: 'x', dir: -1, amp: 30, len: 150 });
  });

  it('keeps direction when rand >= 0.65', () => {
    const b = planMidSectionBend(seg({ durationSec: 60 }), 50, toArrive, seq(0.9), 1);
    expect(b?.dir).toBe(1);
  });

  it('null for short sections', () => {
    expect(planMidSectionBend(seg({ durationSec: 59 }), 50, toArrive, seq(0.3), 1)).toBeNull();
  });

  it('null when not enough time left (boundary exclusive)', () => {
    // needs secondsLeft > 28.8 + 15 + 4 = 47.8
    expect(planMidSectionBend(seg(), 47.8, toArrive, seq(0.3), 1)).toBeNull();
    expect(planMidSectionBend(seg(), 47.9, toArrive, seq(0.3), 1)).not.toBeNull();
  });
});
