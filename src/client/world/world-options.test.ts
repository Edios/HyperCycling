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
  it('offers the road and the scenes world, each with its own label', () => {
    expect(WORLD_CHOICES.map((c) => [c.value, c.labelKey])).toEqual([
      ['neon-tunnel', 'world.neonTunnel'],
      ['road', 'world.road'],
      ['scenes', 'world.scenes'],
    ]);
    expect(resolveWorld('scenes')).toBe('scenes');
    expect(resolveWorld('road')).toBe('road');
  });
});
