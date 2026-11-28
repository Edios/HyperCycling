import { describe, expect, it } from 'vitest';
import type { Block, RampBlock, RepeatBlock, SteadyBlock } from '../workout';
import { ride, type Piece } from './__fixtures__/synthetic';
import { segmentRide, shortenSeries, type SegmentResult } from './segment';

const FTP = { ftpW: 250 };

function ok(r: SegmentResult) {
  if (!r.ok) throw new Error(`expected blocks, need ${r.need}`);
  return r;
}

/** Blocks without their random ids: same ride, same settings -> equal. */
const shape = (blocks: Block[]): unknown =>
  JSON.parse(JSON.stringify(blocks, (k, v: unknown) => (k === 'id' ? undefined : v)));

const total = (blocks: Block[]) =>
  blocks.reduce(
    (s, b) =>
      s +
      (b.kind === 'repeat'
        ? b.times * b.blocks.reduce((t, c) => t + c.durationSec, 0)
        : b.durationSec),
    0,
  );

// Scenario 1 (spec §6.2): warm-up 45->75 %, 3 x (8 min 95 % / 4 min 55 %), cool-down 70->45 %.
const classic: Piece[] = [
  { sec: 600, from: 45, to: 75, cadence: 85 },
  ...[1, 2, 3].flatMap(() => [
    { sec: 480, from: 95, cadence: 92 },
    { sec: 240, from: 55, cadence: 84 },
  ]),
  { sec: 600, from: 70, to: 45, cadence: 80 },
];

describe('segmentRide on rides with a known answer', () => {
  it('finds the warm-up ramp, the 3 x interval repeat and the cool-down ramp', () => {
    const r = ok(segmentRide(ride(classic), FTP));
    const [warm, rep, cool, ...rest] = r.blocks;
    expect(rest).toEqual([]);
    expect(warm).toMatchObject({ kind: 'ramp' });
    expect((warm as RampBlock).durationSec).toBeGreaterThanOrEqual(570);
    expect((warm as RampBlock).durationSec).toBeLessThanOrEqual(630);
    expect((warm as RampBlock).from.effort).toBeLessThanOrEqual(2);
    expect((warm as RampBlock).to.effort).toBeGreaterThanOrEqual(4);
    expect((warm as RampBlock).rpm).toBe(85); // the file has cadence: its median, to 5 rpm
    const repeat = rep as RepeatBlock;
    expect(repeat).toMatchObject({ kind: 'repeat', times: 3 });
    const [work, easy] = repeat.blocks as [SteadyBlock, SteadyBlock];
    expect(Math.abs(work.durationSec - 480)).toBeLessThanOrEqual(15);
    expect(Math.abs(easy.durationSec - 240)).toBeLessThanOrEqual(15);
    expect(work.intensity.effort).toBe(7); // 95 % is nearest to 92 % (hard)
    expect(Math.abs((work.intensity.ftpPct ?? 0) - 95)).toBeLessThanOrEqual(3);
    expect(easy.intensity.effort).toBe(2);
    expect(work.rpm).toBe(90);
    expect(cool).toMatchObject({ kind: 'ramp' });
    expect(r.tags).toEqual([]);
    expect(r.diagnostics.source).toBe('power');
    expect(r.diagnostics.rmsePct).toBeLessThan(8);
    expect(r.diagnostics.fitPct).toBeGreaterThan(85);
    const { workKjRide = 0, workKjBlocks = 0 } = r.diagnostics;
    expect(Math.abs(workKjBlocks - workKjRide) / workKjRide).toBeLessThan(0.03);
    // The ride's length is kept, give or take the rounding of the repeat.
    expect(Math.abs(total(r.blocks) - 3360)).toBeLessThanOrEqual(30);
  });

  it('is deterministic: the same ride and settings give the same blocks', () => {
    const a = ok(segmentRide(ride(classic), FTP));
    const b = ok(segmentRide(ride(classic), FTP));
    expect(shape(a.blocks)).toEqual(shape(b.blocks));
  });

  // Scenario 2: 8 x (30 s 150 % / 30 s 50 %) with ±8 % noise, between easy riding.
  const sprints: Piece[] = [
    { sec: 600, from: 60 },
    ...Array.from({ length: 8 }, () => [
      { sec: 30, from: 150 },
      { sec: 30, from: 50 },
    ]).flat(),
    { sec: 600, from: 60 },
  ];

  it('on "detailed" folds 30/30 sprints into one repeat, tagged hiit', () => {
    const r = ok(
      segmentRide(ride(sprints, { noise: 0.08 }), FTP, { detail: 5, rampWarmCool: false }),
    );
    const rep = r.blocks.find((b): b is RepeatBlock => b.kind === 'repeat');
    expect(rep?.times).toBeGreaterThanOrEqual(7);
    const [work, easy] = rep?.blocks as [SteadyBlock, SteadyBlock];
    expect(work.durationSec).toBe(30);
    expect(work.intensity.effort).toBe(10);
    expect(easy.intensity.effort).toBeLessThanOrEqual(2);
    expect(work.rpm).toBe(95); // no cadence in the file: the interval defaults
    expect(easy.rpm).toBe(85);
    expect(r.tags).toEqual(['hiit']);
  });

  it('on "general" makes the same sprints one uneven block, and says peaks were averaged', () => {
    const r = ok(
      segmentRide(ride(sprints, { noise: 0.08 }), FTP, { detail: 1, rampWarmCool: false }),
    );
    expect(r.blocks.length).toBeLessThanOrEqual(3);
    expect(r.blocks.some((b) => b.kind === 'repeat')).toBe(false);
    expect(r.diagnostics.variableBlocks).toBeGreaterThanOrEqual(1);
  });

  it('flags sprints averaged into a short block', () => {
    const spiky: Piece[] = [
      { sec: 300, from: 60 },
      { sec: 10, from: 250 },
      { sec: 50, from: 90 },
      { sec: 300, from: 60 },
    ];
    const r = ok(segmentRide(ride(spiky, { noise: 0 }), FTP, { detail: 5, rampWarmCool: false }));
    expect(r.warnings).toContain('sprintsAveraged');
  });

  // Scenario 3: no power, heart rate only, lagging the effort.
  it('builds from heart rate (read 20 s late) with effort only, and takes HR max from the ride', () => {
    const steps: Piece[] = [
      { sec: 600, from: 55 },
      { sec: 900, from: 100 },
      { sec: 600, from: 55 },
    ];
    const series = ride(steps, { power: false, hrMax: 190, hrTauSec: 25 });
    const r = ok(segmentRide(series, {}, { rampWarmCool: false }));
    expect(r.diagnostics.source).toBe('heartRate');
    expect(r.warnings).toContain('hrMaxFromRide');
    const steady = r.blocks.filter((b): b is SteadyBlock => b.kind === 'steady');
    expect(steady.every((b) => b.intensity.ftpPct === undefined)).toBe(true);
    const hard = steady.find((b) => (b.intensity.effort ?? 0) >= 7);
    expect(hard).toBeDefined();
    // The hard block starts within ~40 s of the real change (heart rate lags behind).
    let at = 0;
    for (const b of r.blocks) {
      if (b === hard) break;
      at += b.kind === 'repeat' ? 0 : b.durationSec;
    }
    expect(Math.abs(at - 600)).toBeLessThanOrEqual(60);
    // With an HR max set, no warning.
    const set = ok(segmentRide(series, { hrMaxBpm: 190 }, { rampWarmCool: false }));
    expect(set.warnings).not.toContain('hrMaxFromRide');
    expect(set.diagnostics.hrMaxBpm).toBe(190);
  });

  // Scenario 4: outdoors, no power or HR, a 6 % climb and a descent.
  it('estimates from speed and grade, labels the climb and the descent', () => {
    const route: Piece[] = [
      { sec: 600, from: 0, grade: 0 },
      { sec: 720, from: 0, grade: 6 },
      { sec: 300, from: 0, grade: -6 },
      { sec: 600, from: 0, grade: 0 },
    ];
    const series = ride(route, { power: false, speed: 9 });
    const r = ok(
      segmentRide(series, { ftpW: 250, riderKg: 75 }, { lang: 'pl', rampWarmCool: false }),
    );
    expect(r.diagnostics.source).toBe('speed');
    expect(r.warnings).toContain('estimatedFromSpeed');
    const labels = r.blocks.map((b) => (b.kind === 'repeat' ? undefined : b.label));
    expect(labels.some((l) => l?.startsWith('Podjazd'))).toBe(true);
    expect(labels).toContain('Zjazd / luz');
    expect(r.tags).toContain('climb');
    const climb = r.blocks.find(
      (b): b is SteadyBlock => b.kind === 'steady' && !!b.label?.startsWith('Podjazd'),
    );
    expect(climb?.rpm).toBe(75); // seated climb default
    expect(climb?.intensity.ftpPct).toBeUndefined();
  });

  it('marks standing on a hard, slow-cadence block indoors', () => {
    const r = ok(
      segmentRide(
        ride([
          { sec: 600, from: 60, cadence: 90 },
          { sec: 120, from: 110, cadence: 58 },
          { sec: 600, from: 60, cadence: 90 },
        ]),
        FTP,
        { detail: 4, rampWarmCool: false },
      ),
    );
    const stand = r.blocks.find(
      (b): b is SteadyBlock => b.kind === 'steady' && b.position === 'standing',
    );
    expect(stand?.rpm).toBe(60);
  });
});

describe('segmentRide settings', () => {
  it('keeps to the block limit by raising the penalty', () => {
    const choppy: Piece[] = Array.from({ length: 60 }, (_, i) => ({
      sec: 90,
      from: i % 3 === 0 ? 60 : i % 3 === 1 ? 90 : 120,
    }));
    const r = ok(segmentRide(ride(choppy), FTP, { detail: 5, maxBlocks: 10, mergeRepeats: false }));
    expect(r.blocks.length).toBeLessThanOrEqual(10);
    const tight = ok(
      segmentRide(ride(choppy), FTP, {
        detail: 5,
        maxBlocks: 1,
        mergeRepeats: false,
        method: 'zones',
      }),
    );
    expect(tight.blocks.length).toBe(1);
  });

  it('"shorten to" squeezes a 3 hour ride into 60 minutes, in proportion', () => {
    const long: Piece[] = [
      { sec: 3600, from: 60 },
      { sec: 3600, from: 85 },
      { sec: 3600, from: 60 },
    ];
    const r = ok(segmentRide(ride(long), FTP, { targetSec: 3600, rampWarmCool: false }));
    expect(total(r.blocks)).toBe(3600);
    const [a, b, c] = r.blocks as SteadyBlock[];
    expect(r.blocks).toHaveLength(3);
    expect(a?.durationSec).toBeCloseTo(1200, -2);
    expect(b?.intensity.effort).toBe(6);
    expect(c?.intensity.effort).toBe(3);
    // Longer than the ride: nothing to shorten.
    expect(total(ok(segmentRide(ride(long), FTP, { targetSec: 99_999 })).blocks)).toBe(10_800);
  });

  it('splits a block over 4 hours and warns about a long ride', () => {
    const r = ok(segmentRide(ride([{ sec: 16_000, from: 65 }]), FTP));
    expect(r.blocks.map((b) => (b.kind === 'repeat' ? 0 : b.durationSec))).toEqual([14_400, 1600]);
    expect(r.warnings).toContain('longRide');
  });

  it('clamps an intensity over 200 % FTP, with a warning', () => {
    const r = ok(segmentRide(ride([{ sec: 300, from: 260 }], { ftp: 250 }), FTP));
    expect((r.blocks[0] as SteadyBlock).intensity.ftpPct).toBe(200);
    expect(r.warnings).toContain('intensityClamped');
  });

  it('asks for an FTP (with a suggestion), or says there is nothing to build from', () => {
    const series = ride([{ sec: 1500, from: 80 }]);
    expect(segmentRide(series, {})).toEqual({ ok: false, need: 'ftp', suggestedFtpW: 190 });
    const hinted = { ...series, hints: { ftpW: 260 } };
    expect(segmentRide(hinted, {})).toEqual({ ok: false, need: 'ftp', suggestedFtpW: 260 });
    const short = ride([{ sec: 600, from: 80 }]);
    expect(segmentRide(short, {})).toEqual({ ok: false, need: 'ftp' });
    const bare = ride([{ sec: 600, from: 80 }], { power: false });
    expect(segmentRide(bare, FTP)).toEqual({ ok: false, need: 'signal' });
  });

  it('the zone fallback finds the same intervals', () => {
    const r = ok(segmentRide(ride(classic), FTP, { method: 'zones' }));
    expect(r.blocks.find((b) => b.kind === 'repeat')).toMatchObject({ times: 3 });
  });

  it('without cadence in the file: no rpm on warm-up and cool-down, 90 on a steady block', () => {
    const bare = classic.map((p) => ({ ...p, cadence: undefined }));
    const r = ok(segmentRide(ride(bare), FTP));
    const first = r.blocks[0] as RampBlock;
    const last = r.blocks[r.blocks.length - 1] as RampBlock;
    expect(first.kind).toBe('ramp');
    expect(first.rpm).toBeUndefined();
    expect(last.rpm).toBeUndefined();
    const plain = ok(segmentRide(ride([{ sec: 900, from: 75 }]), FTP));
    expect((plain.blocks[0] as SteadyBlock).rpm).toBe(90);
  });
});

describe('shortenSeries', () => {
  it('squeezes every column, the pauses and the laps; a longer target changes nothing', () => {
    const series = ride([{ sec: 600, from: 70 }]);
    series.pauses = [{ atSec: 300, durationSec: 40 }];
    series.laps = [{ startSec: 0, endSec: 600 }];
    const short = shortenSeries(series, 300);
    expect(short.durationSec).toBe(300);
    expect(short.power).toHaveLength(300);
    expect(short.pauses).toEqual([{ atSec: 150, durationSec: 40 }]);
    expect(short.laps).toEqual([{ startSec: 0, endSec: 300 }]);
    expect(Number.isNaN(short.speed[0])).toBe(true);
    expect(shortenSeries(series, 600)).toBe(series);
  });
});
