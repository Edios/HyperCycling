import { describe, expect, it } from 'vitest';
import { doseWarnings, type DoseCode, type DoseLevel } from './dose-rules';
import type { Block, Workout } from './workout';

const steady = (
  id: string,
  durationSec: number,
  effort: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
  extra: Partial<Block> = {},
): Block => ({ kind: 'steady', id, durationSec, intensity: { effort }, ...extra }) as Block;

function make(blocks: Block[], tags: string[] = []): Workout {
  return {
    id: 'w',
    name: 'W',
    description: '',
    category: 'freestyle',
    tags,
    source: { kind: 'user' },
    blocks,
    musicCues: [],
    fallbackPlaylist: [],
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const wu = (): Block => steady('wu', 600, 3);
const cd = (): Block => steady('cd', 300, 2);
const codes = (w: Workout, level?: DoseLevel): DoseCode[] =>
  doseWarnings(w, level ? { level } : {}).map((x) => x.code);

describe('doseWarnings', () => {
  it('is silent for a clean workout', () => {
    expect(doseWarnings(make([wu(), steady('m', 600, 6, { rpm: 90 }), cd()]))).toEqual([]);
  });

  it('flags cadence below 60 and above 115 or above 110 for too long', () => {
    expect(codes(make([wu(), steady('a', 120, 5, { rpm: 55 }), cd()]))).toEqual(['rpm-low']);
    expect(codes(make([wu(), steady('a', 20, 5, { rpm: 120 }), cd()]))).toEqual(['rpm-high']);
    expect(codes(make([wu(), steady('a', 60, 5, { rpm: 112 }), cd()]))).toEqual(['rpm-high']);
    expect(codes(make([wu(), steady('a', 20, 5, { rpm: 112 }), cd()]))).toEqual([]);
  });

  it('flags standing: cadence, no load, long bout, too much in total', () => {
    const stand = (id: string, sec: number, effort: 1 | 5, rpm = 65): Block =>
      steady(id, sec, effort, { rpm, position: 'standing' });
    expect(codes(make([wu(), stand('s', 30, 5, 85), cd()]))).toEqual(['standing-rpm']);
    expect(codes(make([wu(), stand('s', 30, 1), cd()]))).toEqual(['standing-light']);
    expect(codes(make([wu(), stand('s', 90, 5), cd()]))).toEqual(['standing-bout']);
    const many = Array.from({ length: 9 }, (_, i) => stand(`s${i}`, 50, 5));
    expect(codes(make([wu(), ...many, cd()]))).toContain('standing-total');
  });

  it('allows a faster cadence when standing in a short, hard sprint', () => {
    const sprint = (sec: number, ftpPct: number, rpm: number): Block =>
      ({
        kind: 'steady',
        id: 'p',
        durationSec: sec,
        intensity: { ftpPct },
        rpm,
        position: 'standing',
      }) as Block;
    const rest = steady('r', 300, 2);
    // >= 120 % FTP and <= 30 s: up to 105 rpm.
    expect(codes(make([wu(), sprint(15, 150, 100), rest, cd()]))).toEqual([]);
    expect(codes(make([wu(), sprint(30, 120, 105), rest, cd()]))).toEqual([]);
    expect(codes(make([wu(), sprint(15, 150, 110), rest, cd()]))).toEqual(['standing-rpm']);
    // Too long or too easy for a sprint: the climb ceiling (75 rpm) applies.
    expect(codes(make([wu(), sprint(40, 150, 90), rest, cd()]))).toContain('standing-rpm');
    expect(codes(make([wu(), sprint(15, 110, 90), rest, cd()]))).toEqual(['standing-rpm']);
    expect(codes(make([wu(), sprint(15, 110, 75), rest, cd()]))).toEqual([]);
    // The gentle level: up to 15 s and 100 rpm.
    expect(codes(make([wu(), sprint(15, 150, 100), rest, cd()]), 'gentle')).toEqual([]);
    expect(codes(make([wu(), sprint(20, 150, 95), rest, cd()]), 'gentle')).toContain(
      'standing-rpm',
    );
    const found = doseWarnings(make([wu(), sprint(15, 150, 110), rest, cd()])).find(
      (x) => x.code === 'standing-rpm',
    );
    expect(found?.params).toEqual({
      rpm: 110,
      max: 75,
      sprintMax: 105,
      sprintPct: 120,
      sprintSec: 30,
    });
  });

  it('flags sprints over 30 s, except in a test', () => {
    const hard = { kind: 'steady', id: 'p', durationSec: 40, intensity: { ftpPct: 150 } } as Block;
    expect(codes(make([wu(), hard, steady('r', 300, 2), cd()]))).toEqual(['sprint-long']);
    expect(codes(make([wu(), hard, steady('r', 300, 2), cd()], ['test']))).toEqual([]);
  });

  it('flags a rest shorter than the work, as a rule for sprints and as advice otherwise', () => {
    const sprint = (sec: number): Block =>
      ({ kind: 'steady', id: 'p', durationSec: sec, intensity: { ftpPct: 150 } }) as Block;
    const w = make([wu(), sprint(20), steady('r', 10, 2), steady('m', 300, 7), cd()]);
    const found = doseWarnings(w).find((x) => x.code === 'rest-short');
    expect(found?.level).toBe('warn');
    expect(found?.params).toEqual({ work: 20, rest: 10 });
    const hiit = make([wu(), sprint(20), steady('r', 10, 2), steady('m', 300, 7), cd()], ['hiit']);
    expect(doseWarnings(hiit).find((x) => x.code === 'rest-short')?.level).toBe('info');
    const vo2 = make([wu(), steady('v', 180, 9), steady('r', 90, 2), steady('m', 300, 7), cd()]);
    expect(doseWarnings(vo2).find((x) => x.code === 'rest-short')?.level).toBe('info');
    const ok = make([wu(), sprint(20), steady('r', 40, 2), steady('m', 300, 7), cd()]);
    expect(codes(ok)).toEqual([]);
  });

  it('flags a hard effort before the warm-up minimum', () => {
    const w = make([steady('wu', 120, 3), steady('h', 120, 9), steady('r', 300, 2), cd()]);
    const f = doseWarnings(w).find((x) => x.code === 'warmup-short');
    expect(f).toMatchObject({ level: 'warn', blockId: 'h', params: { have: 2, min: 5 } });
  });

  it('flags a short cool-down only when there was real work', () => {
    const shortCd = steady('cd', 120, 2);
    expect(codes(make([wu(), steady('m', 600, 7), shortCd]))).toEqual(['cooldown-short']);
    expect(codes(make([wu(), steady('m', 600, 3), shortCd]))).toEqual([]);
  });

  it('points at the block and the time range', () => {
    const w = make([wu(), steady('m', 120, 5, { rpm: 50 }), cd()]);
    expect(doseWarnings(w)[0]).toMatchObject({ blockId: 'm', fromSec: 600, toSec: 720 });
  });

  it('reports a repeated block once', () => {
    const w = make([
      wu(),
      {
        kind: 'repeat',
        id: 'r',
        times: 4,
        blocks: [{ kind: 'steady', id: 'r1', durationSec: 60, intensity: { effort: 5 }, rpm: 50 }],
      },
      cd(),
    ]);
    expect(codes(w)).toEqual(['rpm-low']);
  });

  it('the gentle level has tighter limits', () => {
    const w = make([
      wu(),
      steady('s', 40, 5, { rpm: 65, position: 'standing' }),
      steady('f', 25, 5, { rpm: 108 }),
      cd(),
    ]);
    expect(codes(w, 'standard')).toEqual([]);
    expect(codes(w, 'gentle')).toEqual(['standing-bout', 'rpm-high']);
    const short = make([steady('wu', 360, 3), steady('m', 300, 9), steady('r', 600, 2), cd()]);
    expect(codes(short, 'standard')).toEqual([]);
    expect(codes(short, 'gentle')).toEqual(['warmup-short']);
  });
});
