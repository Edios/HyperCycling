import { describe, expect, it } from 'vitest';
import { resolveShowHrZones } from './useShowHrZones';

describe('resolveShowHrZones', () => {
  it('defaults to on when the me player has an HRmax', () => {
    expect(resolveShowHrZones(undefined, 183)).toBe(true);
    expect(resolveShowHrZones(undefined, undefined)).toBe(false);
  });
  it('the stored value wins', () => {
    expect(resolveShowHrZones(false, 183)).toBe(false);
    expect(resolveShowHrZones(true, undefined)).toBe(true);
  });
});
