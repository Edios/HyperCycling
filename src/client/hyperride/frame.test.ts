import { describe, expect, it } from 'vitest';
import { DEFAULT_EFFORT_TABLE } from '../../domain/effort';
import type { Segment } from '../../domain/segments';
import type { EngineState } from '../../domain/session-engine';
import { DEFAULT_RPM, buildWorldFrame, glowStrength, speedTarget } from './frame';
import type { FrameInput, PathModel } from './world';

const path: PathModel = { curveX: () => 0, curveY: () => 0, slopeX: () => 0, slopeY: () => 0 };

let nextStart = 0;
function seg(
  index: number,
  durationSec: number,
  effort: Segment['effortStart'],
  over: Partial<Segment> = {},
): Segment {
  const pct = DEFAULT_EFFORT_TABLE[effort - 1]?.ftpPct ?? 70;
  const s: Segment = {
    index,
    startSec: index === 0 ? 0 : nextStart,
    durationSec,
    kind: 'steady',
    ftpPctStart: pct,
    ftpPctEnd: pct,
    effortStart: effort,
    effortEnd: effort,
    rpm: 85,
    blockId: `b${index}`,
    rep: 1,
    reps: 1,
    ...over,
  };
  nextStart = s.startSec + durationSec;
  return s;
}

function workout(): Segment[] {
  nextStart = 0;
  return [
    seg(0, 60, 3), // 0..60 blue
    seg(1, 20, 9, { rpm: 110 }), // 60..80 red sprint
    seg(2, 60, 8, { rpm: 65 }), // 80..140 orange climb
    seg(3, 30, 5), // 140..170 green
  ];
}

function state(over: Partial<EngineState> = {}): EngineState {
  return {
    status: 'running',
    segmentIndex: 0,
    workoutElapsedSec: 10,
    segmentElapsedSec: 10,
    segmentRemainingSec: 50,
    ...over,
  };
}

const input = (s: Partial<EngineState> = {}, segments = workout()): FrameInput => ({
  segments,
  state: state(s),
  table: DEFAULT_EFFORT_TABLE,
});

const build = (s: Partial<EngineState> = {}, speed = 20, segments = workout()) =>
  buildWorldFrame(input(s, segments), { dtSec: 0.016, speed, path });

describe('speedTarget', () => {
  it('is (6 + rpm·0.16 + effort·1.4), ×1.35 from 105 rpm', () => {
    expect(speedTarget(85, 3)).toBeCloseTo(6 + 85 * 0.16 + 3 * 1.4, 10);
    expect(speedTarget(104, 9)).toBeCloseTo(6 + 104 * 0.16 + 9 * 1.4, 10);
    expect(speedTarget(110, 9)).toBeCloseTo((6 + 110 * 0.16 + 9 * 1.4) * 1.35, 10);
  });
});

describe('glowStrength', () => {
  it('maps effortGlow 0..1 onto bloom strength 0.25 + 0.075·effort', () => {
    expect(glowStrength(0.3)).toBeCloseTo(0.25 + 0.075 * 3, 10);
    expect(glowStrength(1)).toBeCloseTo(1, 10);
  });
});

describe('buildWorldFrame', () => {
  it('passes dt and the path through', () => {
    const f = build();
    expect(f.dtSec).toBe(0.016);
    expect(f.path).toBe(path);
  });

  it('passes the workout time and the segments through (scene schedule of the road)', () => {
    const segments = workout();
    const f = build({ workoutElapsedSec: 42 }, 20, segments);
    expect(f.workoutSec).toBe(42);
    expect(f.segments).toBe(segments);
    const empty = build({ workoutElapsedSec: 3 }, 20, []);
    expect(empty.workoutSec).toBe(3);
    expect(empty.segments).toEqual([]);
  });

  it('easy block: speed from rpm and effort, normal fov, flat road, blue', () => {
    const f = build();
    expect(f.speedTarget).toBeCloseTo(speedTarget(85, 3), 10);
    expect(f.fovTarget).toBe(70);
    expect(f.slopeTarget).toBe(0);
    expect(f.effortGlow).toBeCloseTo(0.3, 10);
    expect(f.effortColor).toBe('#2f6bff');
  });

  it('sprint (rpm ≥105 and effort ≥8) widens the field of view', () => {
    const f = build({ segmentIndex: 1, workoutElapsedSec: 65, segmentElapsedSec: 5 });
    expect(f.fovTarget).toBe(84);
    expect(f.speedTarget).toBeCloseTo(speedTarget(110, 9), 10);
    expect(f.effortColor).toBe('#ff4d4d');
  });

  it('fast but easy is no sprint', () => {
    nextStart = 0;
    const segs = [seg(0, 60, 5, { rpm: 115 })];
    expect(build({}, 20, segs).fovTarget).toBe(70);
  });

  it('climb (rpm <75 and effort ≥6) lifts the road by 0.09 + effort·0.006', () => {
    const f = build({ segmentIndex: 2, workoutElapsedSec: 90, segmentElapsedSec: 10 });
    expect(f.slopeTarget).toBeCloseTo(0.09 + 8 * 0.006, 10);
    nextStart = 0;
    const lowEffort = [seg(0, 60, 5, { rpm: 60 })];
    expect(build({}, 20, lowEffort).slopeTarget).toBe(0);
  });

  it('not running: stops, but still shows the current block', () => {
    for (const status of ['idle', 'countdown', 'paused', 'finished'] as const) {
      const f = build({ status });
      expect(f.speedTarget).toBe(0);
      expect(f.effortColor).toBe('#2f6bff');
    }
  });

  it('missing rpm falls back to the default cadence', () => {
    nextStart = 0;
    const { rpm: _drop, ...noRpm } = seg(0, 60, 3);
    void _drop;
    const f = build({}, 20, [noRpm]);
    expect(f.speedTarget).toBeCloseTo(speedTarget(DEFAULT_RPM, 3), 10);
  });

  it('ramps use the effort at the current second', () => {
    nextStart = 0;
    const ramp = seg(0, 100, 2, {
      kind: 'ramp',
      ftpPctStart: 45,
      ftpPctEnd: 130,
      effortStart: 1,
      effortEnd: 10,
    });
    const early = build({ segmentElapsedSec: 0, workoutElapsedSec: 0 }, 20, [ramp]);
    const late = build({ segmentElapsedSec: 100, workoutElapsedSec: 100 }, 20, [ramp]);
    expect(early.effortGlow).toBeCloseTo(0.1, 10);
    expect(late.effortGlow).toBeCloseTo(1, 10);
  });

  describe('colorAtDepth', () => {
    it('is the zone color of the block active when the camera gets there', () => {
      // t = 10, speed 20: depth 0 → t 10 (blue); depth 1000 → t 60 (sprint red);
      // depth 1600 → t 90 (climb orange); far beyond the end → last block (green)
      const f = build({}, 20);
      expect(f.colorAtDepth(0)).toBe('#2f6bff');
      expect(f.colorAtDepth(999)).toBe('#2f6bff');
      expect(f.colorAtDepth(1000)).toBe('#ff4d4d');
      expect(f.colorAtDepth(1600)).toBe('#ff8c2a');
      expect(f.colorAtDepth(100000)).toBe('#35d07f');
    });

    it('when (nearly) stopped every ring shows the current block', () => {
      const f = build({}, 0.4);
      expect(f.colorAtDepth(280)).toBe('#2f6bff');
    });

    it('a ramp ahead is colored by its effort at arrival', () => {
      nextStart = 0;
      const segs = [
        seg(0, 10, 3),
        seg(1, 100, 1, {
          kind: 'ramp',
          ftpPctStart: 45,
          ftpPctEnd: 130,
          effortStart: 1,
          effortEnd: 10,
        }),
      ];
      const f = build({ workoutElapsedSec: 0, segmentElapsedSec: 0 }, 10, segs);
      expect(f.colorAtDepth(200)).toBe('#8fdcff'); // t 20 → 10 s into the ramp, ~53 %
      expect(f.colorAtDepth(1080)).toBe('#ff4d4d'); // t 108 → near the top
    });
  });

  describe('nextBlockInSec', () => {
    it('is the time left in the current block when another block follows', () => {
      expect(build({ workoutElapsedSec: 10, segmentElapsedSec: 10 }).nextBlockInSec).toBe(50);
    });

    it('exactly at a boundary it counts down to the block after the new one', () => {
      // t = 60: the sprint (60..80) is current, the climb starts in 20 s
      const f = build({ segmentIndex: 1, workoutElapsedSec: 60, segmentElapsedSec: 0 });
      expect(f.nextBlockInSec).toBe(20);
      expect(f.colorAtDepth(0)).toBe('#ff4d4d');
    });

    it('is null in the last block', () => {
      const f = build({ segmentIndex: 3, workoutElapsedSec: 150, segmentElapsedSec: 10 });
      expect(f.nextBlockInSec).toBeNull();
    });

    it('never goes negative', () => {
      expect(build({ workoutElapsedSec: 61, segmentElapsedSec: 61 }).nextBlockInSec).toBe(0);
    });
  });

  it('empty workout yields a neutral frame', () => {
    const f = buildWorldFrame(
      { segments: [], state: state(), table: DEFAULT_EFFORT_TABLE },
      { dtSec: 0.016, speed: 10, path },
    );
    expect(f.speedTarget).toBe(0);
    expect(f.colorAtDepth(10)).toBe(f.effortColor);
    expect(f.nextBlockInSec).toBeNull();
  });
});
