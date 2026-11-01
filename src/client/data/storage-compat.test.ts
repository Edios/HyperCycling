import { beforeEach, describe, expect, it } from 'vitest';
import { legacyKey, readCompat, removeCompat } from './storage-compat';

describe('storage-compat', () => {
  beforeEach(() => sessionStorage.clear());

  it('maps new keys to their legacy names', () => {
    expect(legacyKey('hypercycling.lastResult')).toBe('spinning-tutor.lastResult');
    expect(legacyKey('other')).toBe('other');
  });

  it('prefers the new key', () => {
    sessionStorage.setItem('hypercycling.x', 'new');
    sessionStorage.setItem('spinning-tutor.x', 'old');
    expect(readCompat(sessionStorage, 'hypercycling.x')).toBe('new');
  });

  it('copies a legacy value to the new key and leaves the legacy entry intact', () => {
    sessionStorage.setItem('spinning-tutor.x', 'old');
    expect(readCompat(sessionStorage, 'hypercycling.x')).toBe('old');
    expect(sessionStorage.getItem('hypercycling.x')).toBe('old');
    expect(sessionStorage.getItem('spinning-tutor.x')).toBe('old');
  });

  it('returns null when neither exists', () => {
    expect(readCompat(sessionStorage, 'hypercycling.x')).toBeNull();
  });

  it('removes both names so a cleared value cannot come back', () => {
    sessionStorage.setItem('spinning-tutor.x', 'old');
    readCompat(sessionStorage, 'hypercycling.x');
    removeCompat(sessionStorage, 'hypercycling.x');
    expect(readCompat(sessionStorage, 'hypercycling.x')).toBeNull();
  });
});
