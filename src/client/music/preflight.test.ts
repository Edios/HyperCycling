import { beforeEach, describe, expect, it } from 'vitest';
import type { TrackRef } from '../../domain/workout';
import {
  checkRecordings,
  deadRecordings,
  judgeRecording,
  liveCount,
  RESULT_TTL_MS,
  saveResults,
  slotHealth,
  songHealth,
  type RecordingResult,
} from './preflight';

const yt = (id: string, alternates?: TrackRef[]): TrackRef => ({
  provider: 'youtube',
  id,
  title: id,
  startAtSec: 0,
  ...(alternates ? { alternates } : {}),
});
const res = (id: string, status: RecordingResult['status']): [string, RecordingResult] => [
  `youtube:${id}`,
  { key: `youtube:${id}`, status },
];

beforeEach(() => localStorage.clear());

describe('judgeRecording', () => {
  it('blocked or missing in oEmbed is dead, a playing trial is ok', () => {
    expect(judgeRecording({ status: 'blocked' }, undefined)).toEqual({
      status: 'dead',
      reason: 'blocked',
    });
    expect(judgeRecording({ status: 'missing' }, undefined).status).toBe('dead');
    expect(judgeRecording({ status: 'ok' }, { kind: 'playing' })).toEqual({ status: 'ok' });
  });

  it('a player error in the trial (region, embedding) is dead with the code', () => {
    expect(judgeRecording({ status: 'ok' }, { kind: 'error', code: 150 })).toEqual({
      status: 'dead',
      reason: 'error:150',
    });
    expect(judgeRecording({ status: 'ok' }, { kind: 'error', code: 101 }).status).toBe('dead');
  });

  it('a trial that did not finish is unproven, not dead', () => {
    expect(judgeRecording({ status: 'ok' }, { kind: 'timeout' })).toEqual({
      status: 'unverified',
      reason: 'timeout',
    });
    expect(judgeRecording({ status: 'unknown' }, undefined).reason).toBe('offline');
  });
});

describe('checkRecordings', () => {
  it('checks each recording once, skips the trial for oEmbed rejects, and reports progress', async () => {
    const probed: string[] = [];
    const seen: number[] = [];
    const results = await checkRecordings(
      [yt('A', [yt('B'), yt('C')]), yt('B'), yt('D')].flatMap((t) => [t, ...(t.alternates ?? [])]),
      {
        oembed: async (id) => ({ status: id === 'B' ? 'blocked' : 'ok' }),
        probe: async (id) => {
          probed.push(id);
          return id === 'C' ? { kind: 'error', code: 101 } : { kind: 'playing' };
        },
      },
      (done) => seen.push(done),
    );
    expect([...results.keys()].sort()).toEqual([
      'youtube:A',
      'youtube:B',
      'youtube:C',
      'youtube:D',
    ]);
    expect(probed.sort()).toEqual(['A', 'C', 'D']);
    expect(results.get('youtube:A')?.status).toBe('ok');
    expect(results.get('youtube:B')?.reason).toBe('blocked');
    expect(results.get('youtube:C')?.reason).toBe('error:101');
    expect(seen.at(-1)).toBe(4);
  });

  it('a check that throws counts as unproven, never as a crash', async () => {
    const results = await checkRecordings([yt('A')], {
      oembed: () => Promise.reject(new Error('net')),
      probe: () => Promise.reject(new Error('api')),
    });
    expect(results.get('youtube:A')?.status).toBe('unverified');
  });
});

describe('health', () => {
  it('green when the main recording plays, yellow when only a backup does, red when none', () => {
    const song = yt('A', [yt('B'), yt('C')]);
    const chain = [song, ...(song.alternates ?? [])];
    expect(songHealth(chain, new Map([res('A', 'ok'), res('B', 'ok'), res('C', 'dead')]))).toBe(
      'green',
    );
    expect(songHealth(chain, new Map([res('A', 'dead'), res('B', 'ok'), res('C', 'dead')]))).toBe(
      'yellow',
    );
    expect(songHealth(chain, new Map([res('A', 'dead'), res('B', 'dead'), res('C', 'dead')]))).toBe(
      'red',
    );
  });

  it('a slot is as healthy as its worst song, and an empty slot is red', () => {
    const results = new Map([res('A', 'ok'), res('B', 'ok'), res('X', 'dead')]);
    expect(slotHealth([yt('A', [yt('B')])], results)).toBe('green');
    expect(slotHealth([yt('A'), yt('X')], results)).toBe('red');
    expect(slotHealth([], results)).toBe('red');
  });

  it('counts live recordings', () => {
    const results = new Map([res('A', 'ok'), res('B', 'dead'), res('C', 'unverified')]);
    expect(liveCount([yt('A'), yt('B'), yt('C')], results)).toBe(2);
  });
});

describe('kept results', () => {
  it('remember dead recordings for a week', () => {
    saveResults(new Map([res('A', 'dead'), res('B', 'ok')]), 1000);
    expect([...deadRecordings(2000)]).toEqual(['youtube:A']);
    expect(deadRecordings(1000 + RESULT_TTL_MS + 1).size).toBe(0);
  });

  it('survive broken storage', () => {
    localStorage.setItem('hypercycling.music.check', '{nope');
    expect(deadRecordings().size).toBe(0);
  });
});
