import { describe, expect, it } from 'vitest';
import {
  bikeKindOf,
  bikePreset,
  BIKE_KINDS,
  DEFAULT_KNOB_STEPS,
  hasKnob,
  isValidKnobSteps,
  knobHint,
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

describe('knobHint', () => {
  const steps = [2, 4, 6, 8, 10];
  it('stretches E1..E10 over S1..S5 and returns the saved position', () => {
    expect(knobHint('knob', steps, 1)).toEqual({ step: 1, position: 2 });
    expect(knobHint('knob', steps, 5)).toEqual({ step: 3, position: 6 });
    expect(knobHint('knobPower', steps, 10)).toEqual({ step: 5, position: 10 });
  });
  it('clamps efforts outside 1..10', () => {
    expect(knobHint('knob', steps, 0)).toEqual({ step: 1, position: 2 });
    expect(knobHint('knob', steps, 99)).toEqual({ step: 5, position: 10 });
  });
  it('gives no hint without a knob, without calibration, or with corrupt data', () => {
    expect(knobHint('smart', steps, 5)).toBeUndefined();
    expect(knobHint('knob', undefined, 5)).toBeUndefined();
    expect(knobHint('knob', [5, 4, 3, 2, 1], 5)).toBeUndefined();
    expect(knobHint('knob', [1, 2, 3], 5)).toBeUndefined();
    expect(knobHint('knob', steps, Number.NaN)).toBeUndefined();
  });
});
