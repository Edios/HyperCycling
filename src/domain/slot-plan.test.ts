import { describe, expect, it } from 'vitest';
import {
  formatGap,
  pickVersion,
  planSlot,
  planSlots,
  queueSec,
  type PlanCandidate,
} from './slot-plan';

function c(
  id: string,
  title: string,
  artist: string,
  durationSec: number | undefined,
  extra: Partial<PlanCandidate> & { bpm?: number } = {},
): PlanCandidate {
  const { bpm, ...rest } = extra;
  return {
    origin: 'main',
    ...rest,
    track: {
      provider: 'spotify',
      id,
      title,
      artist,
      ...(durationSec !== undefined ? { durationSec } : {}),
      startAtSec: 0,
      ...(bpm !== undefined ? { bpm } : {}),
    },
  };
}

describe('pickVersion', () => {
  it('prefers the album version over the radio edit that is too short', () => {
    const radio = c('r', "Don't You Worry Child - Radio Edit", 'SHM', 213);
    const album = c('a', "Don't You Worry Child", 'SHM', 212 + 150, { album: 'Until Now' });
    expect(pickVersion([radio, album], 360)?.track.id).toBe('a');
  });

  it('skips live and remix versions even when longer, unless a remix is wanted', () => {
    const live = c('l', 'Song - Live', 'X', 500);
    const remix = c('m', 'Song - Remix', 'X', 480);
    const studio = c('s', 'Song', 'X', 240);
    expect(pickVersion([live, remix, studio], 300)?.track.id).toBe('s');
    expect(pickVersion([live, remix], 300, true)?.track.id).toBe('m');
  });

  it('takes the shortest version that still covers the slot, else the longest', () => {
    const a = c('a', 'Pjanoo', 'Eric', 157);
    const b = c('b', 'Pjanoo - Club Mix', 'Eric', 426);
    const d = c('d', 'Pjanoo - Extended', 'Eric', 330);
    expect(pickVersion([a, b, d], 300)?.track.id).toBe('d');
    expect(pickVersion([a, b, d], 600)?.track.id).toBe('b');
  });

  it('ignores versions not playable in the region', () => {
    const a = c('a', 'Song', 'X', 300, { playable: false });
    expect(pickVersion([a], 300)).toBeUndefined();
  });
});

describe('planSlot', () => {
  it('uses the longer version and needs no reserve when it covers the slot', () => {
    const plan = planSlot(
      360,
      [c('r', 'Dont Stop - Radio Edit', 'Q', 213), c('a', 'Dont Stop', 'Q', 355)],
      174,
    );
    expect(plan.queue.map((x) => x.track.id)).toEqual(['a']);
    expect(plan.shortBySec).toBeUndefined();
  });

  it('adds alternatives as reserve, best tempo first, until the slot is full', () => {
    const plan = planSlot(
      360,
      [
        c('m', 'Main', 'A', 180),
        c('a1', 'Alt far', 'B', 150, { origin: 'alt', bpm: 100 }),
        c('a2', 'Alt on beat', 'C', 200, { origin: 'alt', bpm: 174 }),
      ],
      174,
    );
    expect(plan.queue.map((x) => x.track.id)).toEqual(['m', 'a2']);
    expect(plan.gapSec).toBe(-20);
    expect(plan.shortBySec).toBeUndefined();
    expect(plan.overBySec).toBe(20);
  });

  it('warns with the missing time and tempo when the reserve is not enough', () => {
    const plan = planSlot(
      360,
      [c('m', 'Main', 'A', 200), c('a', 'Alt', 'B', 90, { origin: 'alt', bpm: 174 })],
      174,
    );
    expect(plan.shortBySec).toBe(70);
    expect(formatGap(plan.shortBySec ?? 0)).toBe('1:10');
    expect(plan.suggestBpm).toBe(174);
    expect(plan.silenceOk).toBe(false);
  });

  it('allows silence only for rest slots', () => {
    const plan = planSlot(300, [c('m', 'Calm', 'A', 120)], undefined, { kind: 'rest' });
    expect(plan.shortBySec).toBe(180);
    expect(plan.silenceOk).toBe(true);
  });

  it('tolerates a gap within 10 s', () => {
    const plan = planSlot(300, [c('m', 'Song', 'A', 292)], 140);
    expect(plan.shortBySec).toBeUndefined();
  });

  it('does not repeat a song and does not reuse tracks of other slots', () => {
    const cands = [
      c('m', 'Main', 'A', 100),
      c('m2', 'Main - Radio Edit', 'A', 90, { origin: 'alt', bpm: 120 }),
      c('x', 'Used elsewhere', 'B', 300, { origin: 'alt', bpm: 120 }),
    ];
    const plan = planSlot(300, cands, 120, { usedIds: new Set(['x']) });
    expect(plan.queue.map((q) => q.track.id)).toEqual(['m']);
    expect(plan.shortBySec).toBe(200);
  });

  it('plans several slots without duplicates between them', () => {
    const shared = c('s', 'Shared', 'Z', 300, { origin: 'alt', bpm: 120 });
    const plans = planSlots([
      { sec: 300, candidates: [shared] },
      {
        sec: 300,
        candidates: [shared, c('o', 'Own', 'Y', 300, { origin: 'alt', bpm: 120 })],
        targetBpm: 120,
      },
    ]);
    expect(plans[0]?.queue.map((q) => q.track.id)).toEqual(['s']);
    expect(plans[1]?.queue.map((q) => q.track.id)).toEqual(['o']);
  });

  it('handles no candidates', () => {
    const plan = planSlot(240, [], 150);
    expect(plan.queue).toEqual([]);
    expect(plan.shortBySec).toBe(240);
    expect(plan.suggestBpm).toBe(150);
  });
});

describe('queueSec', () => {
  it('subtracts the start offset', () => {
    expect(
      queueSec([
        { provider: 'spotify', id: 'a', title: 'a', durationSec: 200, startAtSec: 20 },
        { provider: 'spotify', id: 'b', title: 'b', durationSec: 100, startAtSec: 0 },
      ]),
    ).toBe(280);
  });
});
