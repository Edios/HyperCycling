import { describe, expect, it } from 'vitest';
import { builtinExperiences, getWorkout } from '../client/data/builtin';
import { sceneChangeAllowed } from '../client/world/worlds/scenes-schedule';
import { THEMES } from '../client/world/worlds/scenes-themes';
import {
  duplicateHintSlots,
  experienceProblems,
  resolveChapters,
  songStartsSec,
  validateHintQueues,
} from '../domain/experience';
import { flattenWorkout } from '../domain/segments';
import { totalDurationSec } from '../domain/workout';

const exp = builtinExperiences.find((e) => e.id === 'neon-grid-45');
const workout = getWorkout('class-neon-grid-45');

/** The five resistance steps of the scenario (S1..S5) as effort levels. */
const STEP_EFFORTS = [3, 4, 6, 7, 9];

describe('Neon Grid 45 scenario', () => {
  it('is loaded with its workout and has no problems', () => {
    expect(exp).toBeDefined();
    expect(workout).toBeDefined();
    expect(experienceProblems(exp!, workout!)).toEqual([]);
    expect(exp!.stepCount).toBe(5);
  });

  it('is 45 minutes in 11 songs with the warm-up and cool-down of the design', () => {
    expect(totalDurationSec(workout!)).toBe(45 * 60);
    expect(workout!.songs).toHaveLength(11);
    const starts = songStartsSec(workout!);
    expect(starts.map((s) => s / 60)).toEqual([0, 5, 9, 13.5, 16, 22, 24.5, 29.5, 32, 37, 41]);
    const segs = flattenWorkout(workout!);
    expect(segs[0]?.label).toBe('@warmup');
    expect(totalDurationSec(workout!) - (starts[10] ?? 0)).toBe(4 * 60);
  });

  it('keeps the chapters of the design on the song boundaries', () => {
    const chapters = resolveChapters(exp!, workout!);
    expect(chapters.map((c) => c.startSec / 60)).toEqual([0, 9, 16, 24.5, 32, 37, 41]);
    expect(chapters.map((c) => c.look)).toEqual([
      'grid-wake',
      'light-lanes',
      'arches',
      'surge',
      'summit-scan',
      'overdrive',
      'afterglow',
    ]);
    const starts = new Set(songStartsSec(workout!));
    for (const c of chapters) expect(starts.has(c.startSec), String(c.startSec)).toBe(true);
  });

  it('never changes the scene in the middle of an effort: every chapter starts on a block boundary', () => {
    const segs = flattenWorkout(workout!);
    const starts = new Set(segs.map((s) => Math.round(s.startSec)));
    for (const c of resolveChapters(exp!, workout!)) {
      expect(sceneChangeAllowed(segs, c.startSec), `chapter at ${c.startSec}s`).toBe(true);
      expect(starts.has(Math.round(c.startSec)), `block boundary at ${c.startSec}s`).toBe(true);
    }
  });

  it('defines every look the chapters ask for', () => {
    const theme = THEMES[exp!.worldTheme.theme];
    expect(theme).toBeDefined();
    for (const c of exp!.worldTheme.chapters ?? []) {
      expect(Object.keys(theme!.looks)).toContain(c.look);
    }
  });

  it('uses exactly the five resistance steps and only small, announced changes', () => {
    const segs = flattenWorkout(workout!);
    for (const s of segs) expect(STEP_EFFORTS, s.blockId).toContain(s.effortStart);
    const rank = (e: number): number => STEP_EFFORTS.indexOf(e);
    for (let i = 1; i < segs.length; i++) {
      const prev = segs[i - 1]!;
      const cur = segs[i]!;
      const jump = rank(cur.effortStart) - rank(prev.effortEnd);
      expect(Math.abs(jump), `${prev.blockId} to ${cur.blockId}`).toBeLessThanOrEqual(2);
      // every resistance change is announced by a cue (repeat reps after the first stay silent)
      if (jump !== 0 && cur.rep === 1) expect(cur.cue, cur.blockId).toBeDefined();
    }
  });

  it('keeps a resistance step for at least 20 s', () => {
    const segs = flattenWorkout(workout!);
    let run = 0;
    let effort = -1;
    for (const s of segs) {
      if (s.effortStart === effort) run += s.durationSec;
      else {
        if (effort !== -1) expect(run).toBeGreaterThanOrEqual(20);
        effort = s.effortStart;
        run = s.durationSec;
      }
    }
  });

  it('limits standing: blocks up to 60 s, 30 s on the top step, at most 7 minutes', () => {
    let standing = 0;
    for (const s of flattenWorkout(workout!)) {
      if (s.position !== 'standing') continue;
      standing += s.durationSec;
      expect(s.durationSec, s.blockId).toBeLessThanOrEqual(60);
      if (s.effortStart >= 9) expect(s.durationSec, s.blockId).toBeLessThanOrEqual(30);
      expect(s.rpm ?? 0, s.blockId).toBeLessThanOrEqual(75);
    }
    expect(standing).toBeLessThanOrEqual(7 * 60);
  });

  it('keeps the top step short and sprints at 15 s', () => {
    const segs = flattenWorkout(workout!);
    const hardSec = segs.filter((s) => s.effortStart >= 9).reduce((a, s) => a + s.durationSec, 0);
    expect(hardSec).toBeLessThanOrEqual(90);
    for (const s of segs.filter((x) => (x.rpm ?? 0) >= 105)) {
      expect(s.durationSec, s.blockId).toBeLessThanOrEqual(15);
    }
  });
});

describe('Neon Grid music suggestions', () => {
  const PAIRS = [
    ['neon-grid-45', 'class-neon-grid-45', 11],
    ['neon-grid-45-light', 'class-neon-grid-45-light', 11],
    ['neon-grid-30', 'class-neon-grid-30', 7],
  ] as const;
  it.each(PAIRS)('%s has one suggestion per slot and ships no Spotify ids', (id, wid, slots) => {
    const e = builtinExperiences.find((x) => x.id === id)!;
    const w = getWorkout(wid)!;
    expect(experienceProblems(e, w)).toEqual([]);
    expect(e.musicPins).toEqual([]);
    expect(e.musicHints?.map((h) => h.slot)).toEqual(Array.from({ length: slots }, (_, i) => i));
    expect(JSON.stringify(e.musicHints)).not.toMatch(/spotify:|open\.spotify|"id"/);
    for (const h of e.musicHints ?? []) {
      const slot = w.songs![h.slot]!;
      if (h.bpm && slot.bpm) {
        const mid = (slot.bpm[0] + slot.bpm[1]) / 2;
        // the suggested tempo suits the slot at normal, half or double time
        expect([h.bpm, h.bpm * 2, h.bpm / 2].some((v) => Math.abs(v - mid) / mid < 0.1)).toBe(true);
      }
    }
  });
});

describe('Neon Grid owner picks', () => {
  const hints = (id: string) => builtinExperiences.find((e) => e.id === id)!.musicHints!;
  const title = (id: string, slot: number) => {
    const h = hints(id).find((x) => x.slot === slot)!;
    return `${h.artist} - ${h.title}`;
  };

  it('Neon Grid 45 follows the owner picks, slot by slot', () => {
    expect(hints('neon-grid-45').map((h) => `${h.artist} - ${h.title}`)).toEqual([
      'Kavinsky - Nightcall',
      'Daft Punk - Technologic',
      'Foo Fighters - The Pretender',
      'Alan Walker - Faded',
      "Swedish House Mafia - Don't You Worry Child",
      'Chase & Status - Blind Faith (Loadstar Remix)',
      'Pendulum - Witchcraft',
      'Kavinsky - Nightcall',
      'Eric Prydz - Pjanoo',
      'Green Day - Basket Case',
      'Brian Eno - An Ending (Ascent) (Remastered 2019)',
    ]);
  });

  it('flags the same song in slots 1 and 8 of Neon Grid 45 only', () => {
    const e = (id: string) => builtinExperiences.find((x) => x.id === id)!;
    expect(duplicateHintSlots(e('neon-grid-45'))).toEqual([[0, 7]]);
    expect(duplicateHintSlots(e('neon-grid-45-light'))).toEqual([]);
    expect(duplicateHintSlots(e('neon-grid-30'))).toEqual([]);
  });

  it('gives the duplicate slot 8 the alternatives Awake and Starboy', () => {
    const h = hints('neon-grid-45').find((x) => x.slot === 7)!;
    expect(h.alternatives?.map((a) => a.title)).toEqual(['Awake', 'Starboy']);
  });

  it('keeps alternatives per slot and the shorter variants on the same picks', () => {
    for (const id of ['neon-grid-45', 'neon-grid-45-light', 'neon-grid-30']) {
      for (const h of hints(id)) expect(h.alternatives?.length).toBeGreaterThanOrEqual(2);
    }
    expect(title('neon-grid-30', 1)).toBe(title('neon-grid-45', 2));
    expect(title('neon-grid-45-light', 9)).toBe(title('neon-grid-45', 9));
  });
});

describe('Neon Grid authored music queues', () => {
  const hints = (id: string) => builtinExperiences.find((e) => e.id === id)!.musicHints!;
  const slotOf = (id: string, title: string): number =>
    hints(id).find((h) => h.title === title)!.slot;

  it('queues the two songs for the slots with short songs, offsets and versions valid', () => {
    for (const id of ['neon-grid-45', 'neon-grid-45-light']) {
      const dywc = hints(id).find((h) => h.title === "Don't You Worry Child")!;
      expect(dywc.version).toBe('extended');
      expect(dywc.queue?.map((q) => q.title)).toEqual(['Clarity']);
    }
    for (const id of ['neon-grid-45', 'neon-grid-45-light', 'neon-grid-30']) {
      const bc = hints(id).find((h) => h.title === 'Basket Case')!;
      expect(bc.queue?.map((q) => q.title)).toEqual(['Tidal Wave']);
    }
    for (const id of ['neon-grid-45', 'neon-grid-30']) {
      const pj = hints(id).find((h) => h.title === 'Pjanoo')!;
      expect(pj.queue?.map((q) => q.title)).toEqual(['Titanium']);
    }
    expect(slotOf('neon-grid-45', 'Pjanoo')).toBe(8);
  });

  it('the author validator finds no short queue in the reworked slots and no repeat across slots of one scenario beyond the known ones', () => {
    for (const e of builtinExperiences.filter((x) => x.id.startsWith('neon-grid'))) {
      const w = getWorkout(e.workoutRef.id)!;
      const fixed = new Set(
        (e.musicHints ?? [])
          .filter((h) => ["Don't You Worry Child", 'Pjanoo', 'Basket Case'].includes(h.title))
          .map((h) => h.slot),
      );
      const warns = validateHintQueues(e, w);
      expect(warns.filter((x) => x.kind === 'short' && fixed.has(x.slot))).toEqual([]);
      expect(warns.filter((x) => x.kind === 'duplicate' && fixed.has(x.slot))).toEqual([]);
    }
  });
});
