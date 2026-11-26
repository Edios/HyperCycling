import { describe, expect, it } from 'vitest';
import { staleReason } from './useSoundtrackOverlay';

describe('staleReason', () => {
  it('says why a saved plan may not play', () => {
    expect(staleReason({ stale: false, missing: [] })).toBeUndefined();
    // A catalog song gone from the catalog is not the rider's doing: it is skipped quietly.
    expect(staleReason({ stale: false, missing: ['old-catalog-song'] })).toBeUndefined();
    expect(staleReason({ stale: false, missing: ['own-abcdefghijk'] })).toBe('ownSongGone');
    // A changed ride is said first.
    expect(staleReason({ stale: true, missing: ['own-abcdefghijk'] })).toBe('ride');
  });
});
