import { describe, expect, it } from 'vitest';
import { pickActiveSection } from './scroll-spy';

const tops = [
  { id: 'general', top: -900 },
  { id: 'music', top: -300 },
  { id: 'data', top: 500 },
];

describe('pickActiveSection', () => {
  it('picks the last section whose top has passed the activation line', () => {
    expect(pickActiveSection(tops, 1000, false)).toBe('music');
  });
  it('picks the first section when none has reached the line', () => {
    expect(pickActiveSection([{ id: 'general', top: 400 }], 1000, false)).toBe('general');
  });
  it('picks the last section at the bottom of the page, even if its top is lower', () => {
    expect(pickActiveSection(tops, 1000, true)).toBe('data');
  });
  it('returns undefined without sections', () => {
    expect(pickActiveSection([], 1000, false)).toBeUndefined();
  });
});
