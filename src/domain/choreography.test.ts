import { describe, expect, it } from 'vitest';
import {
  anchorStart,
  blockStartSec,
  choreoFrame,
  cueSheetSchema,
  findCueSheet,
  recordingChoreo,
  type CueSheet,
} from './choreography';
import type { Segment } from './segments';
import type { TrackChoreo, Workout } from './workout';

const sheet: CueSheet = {
  schemaVersion: 1,
  artist: 'Test Artist',
  title: 'Test Song',
  bpm: 120,
  beatsPerBar: 4,
  downbeatSec: 0.5,
  recordings: [
    { id: 'AAAAAAAAAAA', durationSec: 300 },
    { id: 'BBBBBBBBBBB', durationSec: 302, shiftSec: 1.25 },
  ],
  sections: [
    { t: 0, kind: 'intro' },
    { t: 32.5, kind: 'verse' },
    { t: 64.5, kind: 'chorus', id: 'chorus-1' },
    { t: 96.5, kind: 'break' },
    { t: 128.5, kind: 'drop', id: 'drop-1' },
  ],
};

function seg(over: Partial<Segment>): Segment {
  return {
    index: 0,
    startSec: 0,
    durationSec: 30,
    kind: 'steady',
    ftpPctStart: 60,
    ftpPctEnd: 60,
    effortStart: 5,
    effortEnd: 5,
    rpm: 60,
    position: 'seated',
    blockId: 'b',
    rep: 1,
    reps: 1,
    ...over,
  };
}

const workout = (): Workout =>
  ({
    blocks: [
      { kind: 'steady', id: 'a', durationSec: 100, intensity: { effort: 3 } },
      {
        kind: 'repeat',
        id: 'r',
        times: 2,
        blocks: [
          { kind: 'steady', id: 'on', durationSec: 20, intensity: { effort: 7 } },
          { kind: 'steady', id: 'off', durationSec: 10, intensity: { effort: 4 } },
        ],
      },
      { kind: 'steady', id: 'climb', durationSec: 60, intensity: { effort: 7 } },
      {
        kind: 'steady',
        id: 'stand',
        durationSec: 45,
        intensity: { effort: 7 },
        position: 'standing',
      },
    ],
  }) as unknown as Workout;

describe('cue sheet', () => {
  it('accepts a valid sheet and refuses parts out of order or past the end', () => {
    expect(cueSheetSchema.safeParse(sheet).success).toBe(true);
    const unordered = { ...sheet, sections: [...sheet.sections].reverse() };
    expect(cueSheetSchema.safeParse(unordered).success).toBe(false);
    const late = { ...sheet, sections: [{ t: 400, kind: 'chorus' }] };
    expect(cueSheetSchema.safeParse(late).success).toBe(false);
  });

  it('is found by artist and title, whatever the spelling of extras', () => {
    expect(
      findCueSheet([sheet], { artist: 'Test Artist', title: 'Test Song (Official Video)' }),
    ).toBe(sheet);
    expect(findCueSheet([sheet], { artist: 'Other', title: 'Test Song' })).toBeUndefined();
    expect(findCueSheet(undefined, { title: 'Test Song' })).toBeUndefined();
  });

  it('gives each listed upload its own grid, shifted; an unlisted upload has none', () => {
    expect(recordingChoreo(sheet, 'AAAAAAAAAAA')?.downbeatSec).toBe(0.5);
    const b = recordingChoreo(sheet, 'BBBBBBBBBBB');
    expect(b?.downbeatSec).toBe(1.75);
    expect(b?.marks.find((m) => m.kind === 'chorus')?.t).toBe(65.75);
    expect(recordingChoreo(sheet, 'CCCCCCCCCCC')).toBeUndefined();
  });

  it('keeps the first bar line inside an upload that starts earlier', () => {
    const early = {
      ...sheet,
      recordings: [...sheet.recordings, { id: 'DDDDDDDDDDD', durationSec: 299, shiftSec: -1 }],
    };
    const d = recordingChoreo(early, 'DDDDDDDDDDD');
    // 0.5 - 1 = -0.5, plus one bar (2 s at 120 BPM)
    expect(d?.downbeatSec).toBe(1.5);
    expect(d?.marks[0]).toEqual({ t: 31.5, kind: 'verse' }); // the intro mark fell before 0
  });
});

describe('anchor: the song moves, the plan does not', () => {
  it('finds block starts, also inside the first round of a repeat', () => {
    const w = workout();
    expect(blockStartSec(w, 'a')).toBe(0);
    expect(blockStartSec(w, 'on')).toBe(100);
    expect(blockStartSec(w, 'off')).toBe(120);
    expect(blockStartSec(w, 'climb')).toBe(160);
    expect(blockStartSec(w, 'stand')).toBe(220);
    expect(blockStartSec(w, 'nope')).toBeUndefined();
  });

  it('starts the song so that the section falls on the block', () => {
    // slot from 160 s: the stand block starts 60 s in; the drop is at 128.5 s of the song
    expect(anchorStart(160, workout(), { blockId: 'stand', section: 'drop-1' }, sheet)).toEqual({
      startSec: 68.5,
      lateBySec: 0,
    });
  });

  it('reports a section that cannot come early enough', () => {
    // chorus at 64.5 s, the block 100 s into its slot: it would need a start before 0
    expect(anchorStart(120, workout(), { blockId: 'stand', section: 'chorus-1' }, sheet)).toEqual({
      startSec: 0,
      lateBySec: 35.5,
    });
  });

  it('refuses an unknown section, an unknown block or a block before the slot', () => {
    const w = workout();
    expect(anchorStart(160, w, { blockId: 'stand', section: 'chorus-9' }, sheet)).toBeUndefined();
    expect(anchorStart(160, w, { blockId: 'gone', section: 'drop-1' }, sheet)).toBeUndefined();
    expect(anchorStart(160, w, { blockId: 'a', section: 'drop-1' }, sheet)).toBeUndefined();
  });
});

describe('choreoFrame', () => {
  const c: TrackChoreo = recordingChoreo(sheet, 'AAAAAAAAAAA')!;
  const climb = seg({ rpm: 60, position: 'seated' });
  const stand = seg({ rpm: 60, position: 'standing' });

  it('counts the beat from the first bar line', () => {
    const f = choreoFrame(c, 0.5 + 0.5 * 5 + 0.1, climb, undefined, 20);
    expect(f.beat).toBe(5);
    expect(f.beatInBar).toBe(1);
    expect(f.phase).toBeCloseTo(0.2, 5);
    expect(f.countSec).toBe(0.5);
    expect(f.section).toBe('intro');
  });

  it('shows the beat only while the cadence goes with the tempo', () => {
    expect(choreoFrame(c, 10, climb, undefined, 20).onBeat).toBe(true); // 120 BPM ~ 60 rpm
    expect(choreoFrame(c, 10, seg({ rpm: 95 }), undefined, 20).onBeat).toBe(false);
    expect(choreoFrame(c, 10, seg({ rpm: undefined }), undefined, 20).onBeat).toBe(false);
  });

  it('counts 4..1 on the beat before standing up on the chorus', () => {
    // the chorus is at 64.5 s; the block ends then
    const counts = [2.3, 1.6, 1.1, 0.6, 0.1].map(
      (left) => choreoFrame(c, 64.5 - left, climb, stand, left).call,
    );
    expect(counts[0]).toBeUndefined(); // more than 4 beats (2 s) ahead
    expect(counts.slice(1).map((x) => x?.count)).toEqual([4, 3, 2, 1]);
    expect(counts[1]).toEqual({ move: 'stand', count: 4, on: 'chorus' });
  });

  it('says nothing about the chorus when none starts with the block', () => {
    expect(choreoFrame(c, 49, climb, stand, 1)?.call).toEqual({ move: 'stand', count: 2 });
  });

  it('calls sitting down and sprints; a change it does not choreograph stays quiet', () => {
    expect(choreoFrame(c, 49, stand, climb, 1).call?.move).toBe('sit');
    const sprint = seg({ label: '@sprint', rpm: 105 });
    expect(choreoFrame(c, 128, climb, sprint, 0.5).call).toEqual({
      move: 'sprint',
      count: 1,
      on: 'drop',
    });
    expect(choreoFrame(c, 49, climb, seg({ effortStart: 8 }), 1).call).toBeUndefined();
    expect(choreoFrame(c, 49, climb, undefined, 1).call).toBeUndefined();
  });

  it('counts a fast song in pairs of beats', () => {
    const fast: TrackChoreo = { ...c, bpm: 174 };
    const f = choreoFrame(fast, 30, climb, stand, 1.3);
    expect(f.countSec).toBeCloseTo((60 / 174) * 2, 6);
    expect(f.call?.count).toBe(2);
  });
});
