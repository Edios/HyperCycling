import { describe, expect, it } from 'vitest';
import type { Segment } from '../../domain/segments';
import { TUNNEL_LENGTH } from '../../domain/tunnel-path';
import { createPathModel, PRUNE_MARGIN, type PathFrameInput } from './path-model';

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

/** Builds consecutive segments from [durationSec, effort] pairs. */
function segments(...spec: [number, Segment['effortStart']][]): Segment[] {
  let start = 0;
  return spec.map(([durationSec, effort], index) => {
    const s = seg({ index, startSec: start, durationSec, effortStart: effort, effortEnd: effort });
    start += durationSec;
    return s;
  });
}

function seq(...values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length] ?? 0;
    i += 1;
    return v;
  };
}

const base = (
  input: Partial<PathFrameInput> & Pick<PathFrameInput, 'segments'>,
): PathFrameInput => ({
  dist: 0,
  speed: 20,
  workoutSec: 0,
  segmentIndex: 0,
  running: true,
  ...input,
});

describe('path-model curves', () => {
  it('without bends follows the gentle base wobble of the prototype', () => {
    const p = createPathModel({ rand: seq(0.5) });
    for (const z of [0, 100, 777]) {
      expect(p.curveX(z)).toBeCloseTo(Math.sin(z * 0.004) * 3, 10);
      expect(p.curveY(z)).toBeCloseTo(Math.sin(z * 0.005) * 1, 10);
    }
    expect(p.bends).toEqual([]);
  });

  it('applies a bend as a smoothstep offset from start to start + len', () => {
    const p = createPathModel({ rand: seq(0.5) });
    const b = p.onSegmentChange(seg({ effortEnd: 3 }), seg({ effortStart: 7 }), 5, 20, 100);
    expect(b).toMatchObject({ axis: 'y', dir: 1, start: 100 + 0.45 * TUNNEL_LENGTH });
    if (!b) throw new Error('expected a bend');
    const wobble = (z: number) => Math.sin(z * 0.005);
    expect(p.curveY(b.start) - wobble(b.start)).toBeCloseTo(0, 10);
    expect(p.curveY(b.start + b.len / 2) - wobble(b.start + b.len / 2)).toBeCloseTo(b.amp / 2, 10);
    expect(p.curveY(b.start + b.len) - wobble(b.start + b.len)).toBeCloseTo(b.amp, 10);
    expect(p.curveY(b.start + b.len + 500) - wobble(b.start + b.len + 500)).toBeCloseTo(b.amp, 10);
    // x untouched by a y bend
    expect(p.curveX(b.start + b.len)).toBeCloseTo(Math.sin((b.start + b.len) * 0.004) * 3, 10);
  });

  it('slopes are centred differences over one unit', () => {
    const p = createPathModel({ rand: seq(0.5) });
    p.onSegmentChange(seg(), seg({ effortStart: 8 }), 30, 10, 0);
    const z = 200;
    expect(p.slopeX(z)).toBeCloseTo(p.curveX(z + 0.5) - p.curveX(z - 0.5), 12);
    expect(p.slopeY(z)).toBeCloseTo(p.curveY(z + 0.5) - p.curveY(z - 0.5), 12);
  });
});

describe('onSegmentChange (transition bends)', () => {
  it('starts the bend exactly where the camera will be when the next section starts', () => {
    const p = createPathModel({ rand: seq(0.5) });
    const b = p.onSegmentChange(seg({ effortEnd: 2 }), seg({ effortStart: 8 }), 12, 20, 1000);
    expect(b?.start).toBe(1000 + 12 * 20);
  });

  it('never starts closer than 45 % of the tunnel so it stays visible from afar', () => {
    const p = createPathModel({ rand: seq(0.5) });
    const b = p.onSegmentChange(seg({ effortEnd: 2 }), seg({ effortStart: 8 }), 1, 20, 0);
    expect(b?.start).toBeCloseTo(0.45 * TUNNEL_LENGTH, 10);
  });

  it('falls with an easier section and uses the domain amplitude', () => {
    const p = createPathModel({ rand: seq(0.5) });
    const b = p.onSegmentChange(seg({ effortEnd: 9 }), seg({ effortStart: 3 }), 10, 20, 0);
    expect(b).toMatchObject({ axis: 'y', dir: -1, amp: 26, len: 130 });
  });

  it('small change: x bend in ~70 % of cases, otherwise none', () => {
    const yes = createPathModel({ rand: seq(0.1, 0.9), initialXDir: 1 });
    expect(yes.onSegmentChange(seg(), seg({ effortStart: 5 }), 10, 20, 0)).toMatchObject({
      axis: 'x',
      dir: 1,
      amp: 38,
      len: 150,
    });
    const no = createPathModel({ rand: seq(0.95) });
    expect(no.onSegmentChange(seg(), seg({ effortStart: 5 }), 10, 20, 0)).toBeNull();
    expect(no.bends).toEqual([]);
  });

  it('a new bend only after the previous one has ended', () => {
    const p = createPathModel({ rand: seq(0.5) });
    const first = p.onSegmentChange(seg({ effortEnd: 2 }), seg({ effortStart: 8 }), 10, 20, 0);
    if (!first) throw new Error('expected a bend');
    const overlapping = p.onSegmentChange(
      seg({ effortEnd: 8 }),
      seg({ effortStart: 2 }),
      10,
      20,
      10,
    );
    expect(overlapping).toBeNull();
    expect(p.bends).toHaveLength(1);
  });

  it('alternates x direction like the domain rule (flip with 65 %)', () => {
    const p = createPathModel({ rand: seq(0.1, 0.1), initialXDir: 1 });
    const a = p.onSegmentChange(seg(), seg(), 10, 20, 0);
    const b = p.onSegmentChange(seg(), seg(), 10, 20, 2000);
    expect(a?.dir).toBe(-1);
    expect(b?.dir).toBe(1);
  });
});

describe('onFrame scheduling', () => {
  it('plans the transition once the section end is within one tunnel length', () => {
    const segs = segments([120, 3], [60, 8]);
    const p = createPathModel({ rand: seq(0.5) });
    // 120 s left at 20 u/s = 2400 units away: too far
    p.onFrame(base({ segments: segs, workoutSec: 0 }));
    expect(p.bends.filter((b) => b.axis === 'y')).toHaveLength(0);
    // 10 s left at 20 u/s = 200 units away (< 288)
    p.onFrame(base({ segments: segs, workoutSec: 110, dist: 2200 }));
    const y = p.bends.filter((b) => b.axis === 'y');
    expect(y).toHaveLength(1);
    expect(y[0]?.start).toBeCloseTo(2200 + 200, 10);
    // only once per section
    p.onFrame(base({ segments: segs, workoutSec: 111, dist: 2220 }));
    expect(p.bends.filter((b) => b.axis === 'y')).toHaveLength(1);
  });

  it('does nothing while not running, on the last section, or when nearly stopped', () => {
    const segs = segments([30, 3], [30, 9]);
    const p = createPathModel({ rand: seq(0.5) });
    p.onFrame(base({ segments: segs, workoutSec: 25, running: false }));
    p.onFrame(base({ segments: segs, workoutSec: 25, speed: 0.5 }));
    p.onFrame(base({ segments: segs, workoutSec: 55, segmentIndex: 1 }));
    expect(p.bends).toEqual([]);
  });

  it('adds gentle side bends in long sections every 20-40 s, never right before a change', () => {
    const segs = segments([600, 4], [60, 4]);
    // rand: mid bend dir flip check (0.9 → keep), next interval (0 → 20 s)
    const p = createPathModel({ rand: seq(0.9, 0), initialXDir: 1, firstMidBendSec: 15 });
    p.onFrame(base({ segments: segs, workoutSec: 14, dist: 280 }));
    expect(p.bends).toHaveLength(0);
    p.onFrame(base({ segments: segs, workoutSec: 15, dist: 300 }));
    expect(p.bends).toEqual([
      { axis: 'x', dir: 1, amp: 30, len: 150, start: 300 + TUNNEL_LENGTH, source: 'mid' },
    ]);
    // next attempt not before 15 + 20 s
    p.onFrame(base({ segments: segs, workoutSec: 34, dist: 600 }));
    expect(p.bends).toHaveLength(1);
    p.onFrame(base({ segments: segs, workoutSec: 35, dist: 600 }));
    expect(p.bends).toHaveLength(2);
    // close to the section end (588 s): no mid bend
    const late = createPathModel({ rand: seq(0.9, 0), firstMidBendSec: 0 });
    late.onFrame(base({ segments: segs, workoutSec: 580, dist: 0 }));
    expect(late.bends.filter((b) => b.amp === 30)).toHaveLength(0);
  });

  it('re-plans the transition after a backward jump', () => {
    const segs = segments([120, 3], [60, 8]);
    const p = createPathModel({ rand: seq(0.5) });
    p.onFrame(base({ segments: segs, workoutSec: 110, dist: 2200 }));
    expect(p.bends.filter((b) => b.source === 'transition')).toHaveLength(1);
    // jump back to the start of the section, ride up to the change again
    p.onFrame(base({ segments: segs, workoutSec: 0, dist: 2300 }));
    p.onFrame(base({ segments: segs, workoutSec: 110, dist: 4500 }));
    expect(p.bends.filter((b) => b.source === 'transition').map((b) => b.start)).toContain(
      4500 + 200,
    );
  });

  /** A long section with one mid bend placed at 300 + 288 = 588 (ends at 738). */
  function withMidBend() {
    const segs = segments([600, 4], [60, 9]);
    const p = createPathModel({ rand: seq(0.9, 0), initialXDir: 1, firstMidBendSec: 15 });
    p.onFrame(base({ segments: segs, workoutSec: 15, dist: 300 }));
    expect(p.bends).toEqual([expect.objectContaining({ source: 'mid', start: 588, len: 150 })]);
    return { p, cur: segs[0] as Segment, next: segs[1] as Segment };
  }

  it('a pending mid bend is replaced by the transition bend', () => {
    const { p, cur, next } = withMidBend();
    const b = p.onSegmentChange(cur, next, 10, 20, 400);
    expect(b).toMatchObject({ axis: 'y', dir: 1, source: 'transition', start: 600 });
    expect(p.bends).toEqual([b]);
  });

  it('a mid bend already being ridden keeps going; the transition queues right after it', () => {
    const { p, cur, next } = withMidBend();
    const b = p.onSegmentChange(cur, next, 10, 10, 595);
    expect(b).toMatchObject({ axis: 'y', source: 'transition', start: 738 });
    expect(p.bends.map((x) => x.source)).toEqual(['mid', 'transition']);
  });

  it('no mid bends in short sections', () => {
    const segs = segments([45, 4], [45, 4], [45, 4]);
    const p = createPathModel({ rand: seq(0.99), firstMidBendSec: 0 });
    p.onFrame(base({ segments: segs, workoutSec: 1 }));
    expect(p.bends).toEqual([]);
  });

  it('is deterministic for the same rand sequence', () => {
    const segs = segments([90, 3], [30, 5], [30, 9], [120, 4], [40, 2]);
    const run = () => {
      const p = createPathModel({ rand: seq(0.3, 0.8, 0.1, 0.6), firstMidBendSec: 5 });
      for (let t = 0; t < 310; t += 0.5) {
        p.onFrame(
          base({ segments: segs, workoutSec: t, dist: t * 20, segmentIndex: idx(segs, t) }),
        );
      }
      return p.bends.map((b) => ({ ...b }));
    };
    expect(run()).toEqual(run());
  });
});

describe('pruning', () => {
  it('drops bends far behind the camera without moving the path', () => {
    const p = createPathModel({ rand: seq(0.5) });
    const b = p.onSegmentChange(seg({ effortEnd: 2 }), seg({ effortStart: 8 }), 10, 20, 0);
    if (!b) throw new Error('expected a bend');
    const z = b.start + b.len + PRUNE_MARGIN + 50;
    const before = [p.curveX(z), p.curveY(z), p.curveY(z + 400)];
    p.onFrame(base({ segments: segments([30, 4]), dist: z, running: false }));
    expect(p.bends).toEqual([]);
    expect([p.curveX(z), p.curveY(z), p.curveY(z + 400)]).toEqual(
      before.map((v) => expect.closeTo(v, 9)),
    );
  });

  it('keeps the list bounded over a long ride', () => {
    const segs: Segment[] = [];
    for (let i = 0, start = 0; i < 400; i++) {
      const effort = (i % 2 === 0 ? 3 : 8) as Segment['effortStart'];
      segs.push(
        seg({ index: i, startSec: start, durationSec: 30, effortStart: effort, effortEnd: effort }),
      );
      start += 30;
    }
    const p = createPathModel({ rand: seq(0.2, 0.7) });
    let max = 0;
    for (let t = 0; t < 400 * 30; t += 0.25) {
      p.onFrame(
        base({
          segments: segs,
          workoutSec: t,
          dist: t * 25,
          speed: 25,
          segmentIndex: idx(segs, t),
        }),
      );
      max = Math.max(max, p.bends.length);
    }
    expect(max).toBeLessThanOrEqual(6);
  });
});

function idx(segs: Segment[], t: number): number {
  let i = 0;
  for (let k = 0; k < segs.length; k++) if ((segs[k]?.startSec ?? Infinity) <= t) i = k;
  return i;
}
