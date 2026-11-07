import { describe, expect, it } from 'vitest';
import {
  bikeKindOf,
  bikePreset,
  BIKE_KINDS,
  DEFAULT_KNOB_STEPS,
  hasKnob,
  isValidKnobSteps,
  normalizeKnobSteps,
} from './bike';

describe('bike presets', () => {
  it('round-trips every kind through the settings it writes', () => {
    for (const kind of BIKE_KINDS) {
      const p = bikePreset(kind);
      expect(bikeKindOf(p.resistanceMode, { showsWatts: p.showsWatts })).toBe(kind);
    }
  });
  it('only bikes with a knob need calibration', () => {
    expect(hasKnob('knob')).toBe(true);
    expect(hasKnob('knobPower')).toBe(true);
    expect(hasKnob('smart')).toBe(false);
  });
});

describe('knob steps', () => {
  it('accepts five ascending whole positions', () => {
    expect(isValidKnobSteps([2, 4, 6, 8, 10])).toBe(true);
    expect(isValidKnobSteps(DEFAULT_KNOB_STEPS)).toBe(true);
  });
  it.each([
    [[1, 2, 3, 4]],
    [[1, 2, 2, 4, 5]],
    [[0, 1, 2, 3, 4]],
    [[1, 2, 3, 4, 100]],
    [[1, 2, 3, 4, 5.5]],
  ])('rejects %j', (steps) => {
    expect(isValidKnobSteps(steps)).toBe(false);
  });
  it('falls back to defaults when missing or invalid', () => {
    expect(normalizeKnobSteps(undefined)).toBe(DEFAULT_KNOB_STEPS);
    expect(normalizeKnobSteps([5, 4, 3, 2, 1])).toBe(DEFAULT_KNOB_STEPS);
    expect(normalizeKnobSteps([2, 4, 6, 8, 10])).toEqual([2, 4, 6, 8, 10]);
  });
});
