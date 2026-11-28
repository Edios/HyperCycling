import { describe, expect, it, vi } from 'vitest';
import type { ControlPointResponse } from '../../domain/ble/ftms';
import { en } from '../i18n/en';
import type { MessageKey } from '../i18n';
import type { DeviceStore } from './device-store';
import {
  analyseReadings,
  analyseStep,
  READ_MS,
  reportText,
  runTrainerTest,
  verdict,
  type Sample,
  type TrainerTestResult,
} from './trainer-test';

const t = (key: MessageKey): string =>
  key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], en) as string;

const base: TrainerTestResult = {
  durationMs: 30_000,
  trainerName: 'Tacx Flux S',
  hrName: undefined,
  power: { count: 15, avg: 120, min: 100, max: 140 },
  cadence: { count: 15, avg: 88, min: 85, max: 92 },
  hr: null,
  maxGapMs: 1000,
  erg: { kind: 'done', step: { fromW: 100, toW: 150, reactionMs: 3000, deviationPct: 2 } },
};

describe('analyseReadings', () => {
  it('averages power, cadence and heart rate and finds the longest gap', () => {
    const s: Sample[] = [
      { atMs: 0, powerW: 100, cadenceRpm: 80 },
      { atMs: 1000, powerW: 120, cadenceRpm: 90 },
      { atMs: 1500, hrBpm: 140 },
      { atMs: 5000, powerW: 140 },
    ];
    const r = analyseReadings(s);
    expect(r.power).toEqual({ count: 3, avg: 120, min: 100, max: 140 });
    expect(r.cadence?.avg).toBe(85);
    expect(r.hr?.avg).toBe(140);
    expect(r.maxGapMs).toBe(4000);
  });
  it('reports nothing when nothing arrived', () => {
    expect(analyseReadings([])).toEqual({ power: null, cadence: null, hr: null, maxGapMs: null });
  });
});

describe('analyseStep', () => {
  it('reaction = first power within 10 % of the target; deviation over the hold after it', () => {
    const s: Sample[] = [
      { atMs: 900, powerW: 100 },
      { atMs: 2000, powerW: 120 },
      { atMs: 3000, powerW: 140 },
      { atMs: 4000, powerW: 150 },
      { atMs: 5000, powerW: 160 },
    ];
    const step = analyseStep(s, 1000, 100, 150);
    expect(step.reactionMs).toBe(2000); // 140 W is within 135..165
    expect(step.deviationPct).toBeCloseTo(4.4, 1); // |140-150|, 0, 10 → 6.67 W / 150
  });
  it('never reached: no reaction and no deviation', () => {
    expect(analyseStep([{ atMs: 2000, powerW: 100 }], 1000, 100, 150)).toMatchObject({
      reactionMs: null,
      deviationPct: null,
    });
  });
});

describe('verdict', () => {
  it('all good', () => {
    expect(verdict(base, false)).toEqual({ level: 'ok', notes: ['devices.test.note.ok'] });
  });
  it('no power is a problem; no cadence, gaps and a missing strap are warnings', () => {
    expect(verdict({ ...base, power: null }, false).level).toBe('fail');
    const v = verdict({ ...base, cadence: null, maxGapMs: 4000 }, true);
    expect(v.level).toBe('warn');
    expect(v.notes).toEqual([
      'devices.test.note.noCadence',
      'devices.test.note.gaps',
      'devices.test.note.noHr',
    ]);
  });
  it('ERG: refused or never reached is a problem; slow or off target is a warning', () => {
    expect(
      verdict({ ...base, erg: { kind: 'refused', result: 'controlNotPermitted' } }, false).level,
    ).toBe('fail');
    const never = {
      kind: 'done',
      step: { fromW: 100, toW: 150, reactionMs: null, deviationPct: null },
    } as const;
    expect(verdict({ ...base, erg: never }, false).notes).toContain('devices.test.note.ergNever');
    const slow = {
      kind: 'done',
      step: { fromW: 100, toW: 150, reactionMs: 12_000, deviationPct: 15 },
    } as const;
    expect(verdict({ ...base, erg: slow }, false)).toEqual({
      level: 'warn',
      notes: ['devices.test.note.ergSlow', 'devices.test.note.ergOff'],
    });
    expect(verdict({ ...base, erg: { kind: 'unsupported' } }, false).notes).toEqual([
      'devices.test.note.noErg',
    ]);
  });
});

describe('reportText', () => {
  it('one plain block with the numbers and the verdict in words', () => {
    const text = reportText(base, verdict(base, false), t, new Date('2026-11-29T10:00:00Z'));
    expect(text).toContain('trainer: Tacx Flux S');
    expect(text).toContain('power: avg 120 W');
    expect(text).toContain('ERG: step 100 -> 150 W: reaction 3.0 s, deviation 2 %');
    expect(text).toContain('result: OK · Readings arrive steadily');
  });
});

describe('runTrainerTest', () => {
  it('reads, steps ERG, measures, and always hands control back (Stop, Reset)', async () => {
    let clock = 0;
    let target = 0;
    const listeners: ((r: { packet: { powerW?: number; cadenceRpm?: number } }) => void)[] = [];
    const commands: number[] = [];
    const ok: ControlPointResponse = {
      requestOpcode: 0,
      result: 'success',
    } as ControlPointResponse;
    const trainer = {
      features: () => ({ supportsTargetPower: true }),
      onData: (l: (typeof listeners)[number]) => {
        listeners.push(l);
        return () => undefined;
      },
      command: vi.fn(async (bytes: Uint8Array) => {
        commands.push(bytes[0]!);
        if (bytes[0] === 0x05) target = bytes[1]! | (bytes[2]! << 8);
        return ok;
      }),
    };
    const store = {
      trainer: () => trainer,
      hr: () => null,
      getState: () => ({ trainer: { name: 'Fake Trainer' }, hr: {} }),
    } as unknown as DeviceStore;
    let power = 100;
    // Every waited second the fake trainer reports once; power follows the target in ~2 s.
    const wait = async (ms: number): Promise<void> => {
      for (let left = ms; left > 0; left -= 500) {
        clock += Math.min(500, left);
        if (target) power += (target - power) * 0.25;
        for (const l of listeners) l({ packet: { powerW: Math.round(power), cadenceRpm: 90 } });
      }
    };
    const phases: string[] = [];
    const result = await runTrainerTest({
      store,
      now: () => clock,
      wait,
      onPhase: (p) => phases.push(p),
    });
    expect(result.power?.count).toBe(READ_MS / 500);
    expect(result.cadence?.avg).toBe(90);
    expect(result.erg.kind).toBe('done');
    if (result.erg.kind === 'done') {
      expect(result.erg.step.reactionMs).toBeGreaterThan(0);
      expect(result.erg.step.reactionMs).toBeLessThan(5000);
      expect(result.erg.step.deviationPct).toBeLessThan(10);
    }
    // Request Control, Start, 100 W, 150 W, then Stop and Reset.
    expect(commands).toEqual([0x00, 0x07, 0x05, 0x05, 0x08, 0x01]);
    expect(phases).toEqual(['reading', 'ergSettle', 'ergStep', 'release', 'done']);
  });

  it('a cancelled test still hands the trainer back', async () => {
    const commands: number[] = [];
    let calls = 0;
    const trainer = {
      features: () => ({ supportsTargetPower: true }),
      onData: () => () => undefined,
      command: vi.fn(async (bytes: Uint8Array) => {
        commands.push(bytes[0]!);
        return { requestOpcode: 0, result: 'success' } as ControlPointResponse;
      }),
    };
    const store = {
      trainer: () => trainer,
      hr: () => null,
      getState: () => ({ trainer: {}, hr: {} }),
    } as unknown as DeviceStore;
    const wait = async (): Promise<void> => {
      calls += 1;
      if (calls === 2) throw new Error('cancelled');
    };
    await expect(runTrainerTest({ store, now: () => 0, wait })).rejects.toThrow('cancelled');
    expect(commands.slice(-2)).toEqual([0x08, 0x01]);
  });
});
