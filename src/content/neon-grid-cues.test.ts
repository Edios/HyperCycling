import { describe, expect, it } from 'vitest';
import { en } from '../client/i18n/en';
import { pl } from '../client/i18n/pl';
import { builtinWorkouts } from '../client/data/builtin';
import { resistanceCommand, type ResistanceCommand } from '../domain/coach';
import { flattenWorkout } from '../domain/segments';
import { RESISTANCE_MODES } from '../domain/settings';

/** What each authored cue tells the rider to do with the resistance. */
const SAID: Record<string, ResistanceCommand> = {
  ngAddRpm90: 'add',
  ngMakeHill: 'add',
  ngOneMore: 'add',
  ngOnAddStep: 'add',
  ngBackToRhythm: 'add',
  ngAddSeated: 'add',
  ngLongest: 'add',
  ngSummitClose: 'add',
  ngSummit: 'add',
  ngAddChorus: 'add',
  ngReady: 'add',
  ngOneOff: 'ease',
  ngOffStep: 'ease',
  ngTakeTwoOff: 'ease',
  ngTakeItOff: 'ease',
  ngEaseOff: 'ease',
  ngBreathe2: 'ease',
  ngWindDown: 'ease',
  ngPickup: 'hold',
  ngFlatSame: 'hold',
  ngSitKeep: 'hold',
};

const SPEAKS_OF_RESISTANCE =
  /op[óo]r|odpu[śs]|zdejmij|odejmij|resistance|turn (it )?up|ease off|take .*off|right off|same gear|keep the gear/i;

const coach = (dict: unknown, key: string): string =>
  (dict as { coach: Record<string, string> }).coach[key] ?? '';

const NEON = builtinWorkouts.filter((w) => w.id.startsWith('class-neon-grid'));

describe('Neon Grid: the HUD command and the coach cue say the same', () => {
  it('knows the direction of every cue that speaks of resistance', () => {
    const keys = new Set(
      NEON.flatMap((w) => flattenWorkout(w))
        .map((s) => s.cue)
        .filter((c): c is string => c?.startsWith('@') === true)
        .map((c) => c.slice(1)),
    );
    expect(keys.size).toBeGreaterThan(0);
    for (const key of keys) {
      if (SPEAKS_OF_RESISTANCE.test(coach(pl, key)) || SPEAKS_OF_RESISTANCE.test(coach(en, key))) {
        expect(SAID, key).toHaveProperty(key);
      }
    }
  });

  it.each(NEON.flatMap((w) => RESISTANCE_MODES.map((mode) => [w.id, mode] as const)))(
    '%s on %s',
    (id, mode) => {
      const workout = NEON.find((w) => w.id === id)!;
      const segs = flattenWorkout(workout, undefined, mode);
      segs.forEach((seg, i) => {
        const said = seg.cue ? SAID[seg.cue.slice(1)] : undefined;
        const prev = segs[i - 1];
        if (said && prev) {
          expect(resistanceCommand(prev, seg, 0), `${seg.blockId} ${seg.cue}`).toBe(said);
        }
      });
    },
  );
});
