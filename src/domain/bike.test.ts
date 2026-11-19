import { describe, expect, it } from 'vitest';
import { bikeKindOf, bikePreset, BIKE_KINDS, hasKnob } from './bike';

describe('bike presets', () => {
  it('round-trips every kind through the settings it writes', () => {
    for (const kind of BIKE_KINDS) {
      const p = bikePreset(kind);
      expect(bikeKindOf(p.resistanceMode, { showsWatts: p.showsWatts })).toBe(kind);
    }
  });
  it('a knob bike is anything but a smart trainer', () => {
    expect(hasKnob('knob')).toBe(true);
    expect(hasKnob('knobPower')).toBe(true);
    expect(hasKnob('smart')).toBe(false);
  });
});
