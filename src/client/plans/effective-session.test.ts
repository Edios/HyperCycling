import { describe, expect, it } from 'vitest';
import type { Plan } from '../../domain/plan';
import { DEFAULT_SETTINGS } from '../../domain/settings';
import { effectiveSession, FALLBACK_PROGRES_ID, RAMP_TEST_ID } from './effective-session';

const plan: Plan = {
  id: 'p',
  name: 'P',
  description: '',
  level: 'any',
  loop: false,
  weeks: [
    {
      light: false,
      sessions: [
        { slot: 'progres', workoutId: RAMP_TEST_ID },
        { slot: 'freestyle', workoutId: 'fun' },
      ],
      progresAlt: 'alt-1',
    },
    {
      light: false,
      sessions: [
        { slot: 'progres', workoutId: RAMP_TEST_ID },
        { slot: 'freestyle', workoutId: 'fun' },
      ],
    },
    {
      light: false,
      sessions: [
        { slot: 'progres', workoutId: 'sweet' },
        { slot: 'freestyle', workoutId: 'fun' },
      ],
      progresAlt: 'alt-3',
    },
  ],
};
const watts = DEFAULT_SETTINGS.equipment;
const noWatts = { ...watts, showsWatts: false };

describe('effectiveSession', () => {
  it('keeps the ramp test when the bike shows watts', () => {
    expect(effectiveSession(plan, 1, 'progres', watts)).toBe(RAMP_TEST_ID);
  });

  it('replaces the ramp test with the week alternative without watts', () => {
    expect(effectiveSession(plan, 1, 'progres', noWatts)).toBe('alt-1');
  });

  it('falls back to sweet spot 2 x 10 when the week has no alternative', () => {
    expect(effectiveSession(plan, 2, 'progres', noWatts)).toBe(FALLBACK_PROGRES_ID);
    expect(FALLBACK_PROGRES_ID).toBe('sweet-spot-2x10');
  });

  it('leaves other sessions alone', () => {
    expect(effectiveSession(plan, 3, 'progres', noWatts)).toBe('sweet');
    expect(effectiveSession(plan, 1, 'freestyle', noWatts)).toBe('fun');
  });

  it('serves the alternative in the second slot of doubleProgres', () => {
    expect(effectiveSession(plan, 3, 'freestyle', watts, 'doubleProgres')).toBe('alt-3');
  });

  it('replaces a ramp test reached through doubleProgres fallback', () => {
    expect(effectiveSession(plan, 2, 'freestyle', noWatts, 'doubleProgres')).toBe(
      FALLBACK_PROGRES_ID,
    );
  });

  it('is undefined for a week that does not exist', () => {
    expect(effectiveSession(plan, 9, 'progres', watts)).toBeUndefined();
  });
});
