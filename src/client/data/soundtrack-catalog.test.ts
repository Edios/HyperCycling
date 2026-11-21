import { describe, expect, it } from 'vitest';
import { loadSoundtrackCatalog } from './soundtrack-catalog';

describe('loadSoundtrackCatalog', () => {
  it('loads the validated catalog once and shares it', async () => {
    const first = loadSoundtrackCatalog();
    expect(loadSoundtrackCatalog()).toBe(first);
    const tracks = await first;
    expect(tracks.length).toBeGreaterThanOrEqual(150);
    expect(tracks.every((t) => t.youtube.length >= 2)).toBe(true);
  });
});
