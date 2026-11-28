import { describe, expect, it } from 'vitest';
import { builtinExperiences, getWorkout } from '../client/data/builtin';
import { slotCadences } from '../client/experience/musicMatch';
import { cadenceFit } from '../domain/bpm-match';
import { hintQueue, type MusicHint } from '../domain/experience';
import { songKey } from '../domain/slot-plan';
import { songDurationSec } from '../domain/workout';

/**
 * Data checks of the Neon Grid music after the audit (experience-music-audit.md, P2, P4, P5, P7,
 * P3): every song of a queue can play, no song twice in a ride, every song has its length, and
 * the tempo of each song fits what the rider pedals.
 */
const IDS = ['neon-grid-30', 'neon-grid-45', 'neon-grid-45-light'] as const;
const scenario = (id: string) => {
  const e = builtinExperiences.find((x) => x.id === id)!;
  return { e, w: getWorkout(e.workoutRef.id)!, hints: e.musicHints ?? [] };
};

/** Share of the slot's seconds in which the slot's songs (in queue order) fit the cadence. */
function fitShare(id: string, hint: MusicHint, onBeatOnly = false): number {
  const { w } = scenario(id);
  const cadences = slotCadences(w, hint.slot);
  const queue = hintQueue(hint);
  let t = 0;
  let fits = 0;
  let total = 0;
  for (const c of cadences) {
    for (let s = 0; s < c.sec; s++, t++) {
      let at = 0;
      let song = queue[0]!;
      for (const q of queue) {
        song = q;
        if (t < at + (q.durationSec ?? 0)) break;
        at += q.durationSec ?? 0;
      }
      const f = cadenceFit(song.bpm, c.rpm);
      total++;
      if (f && f.verdict !== 'miss' && !(onBeatOnly && f.close)) fits++;
    }
  }
  return total === 0 ? 1 : fits / total;
}

describe.each(IDS)('%s music data', (id) => {
  const { w, hints } = scenario(id);

  it('P2: every song of a queue starts before its slot ends (nothing queued that never plays)', () => {
    const never: string[] = [];
    for (const h of hints) {
      const slotSec = songDurationSec(w, w.songs![h.slot]!);
      let at = 0;
      for (const item of hintQueue(h)) {
        if (at >= slotSec) never.push(`slot ${h.slot}: ${item.title}`);
        at += item.durationSec ?? 0;
      }
    }
    expect(never).toEqual([]);
  });

  it('P4: no song twice in the ride', () => {
    const keys = hints.flatMap((h) => hintQueue(h).map((q) => songKey(q)));
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  it('P7: every song with a beat has its length', () => {
    const missing = hints.flatMap((h) =>
      hintQueue(h)
        .filter((q) => !(h.noBeat ?? false) && q.durationSec === undefined)
        .map((q) => `slot ${h.slot}: ${q.title}`),
    );
    expect(missing).toEqual([]);
  });
});

describe('P3 and P5: the tempo of the songs fits the cadence of their slots', () => {
  const { hints: h45 } = scenario('neon-grid-45');
  const { hints: light } = scenario('neon-grid-45-light');

  it('Light: the rest slot after the sprints is no longer a song that is 71% out of the window', () => {
    const slot = light.find((h) => h.slot === 8)!;
    expect(slot.title).not.toBe('Starboy');
    expect(fitShare('neon-grid-45-light', slot)).toBeGreaterThanOrEqual(0.9);
  });

  it('45: the second rest slot is not Nightcall again and fits its cadence', () => {
    const slot = h45.find((h) => h.slot === 7)!;
    expect(slot.title).not.toBe('Nightcall');
    expect(fitShare('neon-grid-45', slot)).toBeGreaterThanOrEqual(0.9);
  });

  it('keeps the share of the ride time in the tempo window at or above what it was', () => {
    const share = (id: string): number => {
      const { w, hints } = scenario(id);
      let fit = 0;
      let all = 0;
      for (const h of hints.filter((x) => !x.noBeat)) {
        const secs = slotCadences(w, h.slot).reduce((n, c) => n + c.sec, 0);
        fit += fitShare(id, h) * secs;
        all += secs;
      }
      return fit / all;
    };
    // 0.79 before the sprint slot took a song on the sprint cadence (owner decision 2026-11-26):
    // the sprints are on the beat now, the recoveries between them are not.
    expect(share('neon-grid-30')).toBeGreaterThanOrEqual(0.74);
    expect(share('neon-grid-45')).toBeGreaterThanOrEqual(0.8);
    expect(share('neon-grid-45-light')).toBeGreaterThanOrEqual(0.82);
  });
});
