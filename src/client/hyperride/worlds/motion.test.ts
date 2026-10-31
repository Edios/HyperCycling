import { describe, expect, it } from 'vitest';
import { motionDt } from './motion';

describe('motionDt', () => {
  it('passes the frame time through normally', () => {
    expect(motionDt(0.016, false)).toBe(0.016);
  });
  it('freezes motion under reduced motion', () => {
    expect(motionDt(0.016, true)).toBe(0);
  });
});
