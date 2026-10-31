import { describe, expect, it } from 'vitest';
import { resolveWorld, WORLD_CHOICES } from './world-options';

describe('world options', () => {
  it('falls back to the default for an id the registry does not know', () => {
    expect(resolveWorld('mars')).toBe('neon-tunnel');
    expect(resolveWorld('toString')).toBe('neon-tunnel');
    expect(resolveWorld('neon-tunnel')).toBe('neon-tunnel');
  });
  it('offers the neon tunnel first', () => {
    expect(WORLD_CHOICES[0]?.value).toBe('neon-tunnel');
  });
});
