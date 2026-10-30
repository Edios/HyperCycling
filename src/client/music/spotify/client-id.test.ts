import { describe, expect, it } from 'vitest';
import { resolveClientId } from './client-id';

describe('resolveClientId', () => {
  it('prefers the value saved in settings over the build-time default', () => {
    expect(resolveClientId('from-settings', 'from-build')).toBe('from-settings');
  });
  it('falls back to the build-time default when settings are empty or blank', () => {
    expect(resolveClientId(undefined, 'from-build')).toBe('from-build');
    expect(resolveClientId('', 'from-build')).toBe('from-build');
    expect(resolveClientId('   ', ' from-build ')).toBe('from-build');
  });
  it('is empty when neither is set', () => {
    expect(resolveClientId(undefined, undefined)).toBe('');
    expect(resolveClientId('', '  ')).toBe('');
  });
  it('reads VITE_SPOTIFY_CLIENT_ID from the environment by default', () => {
    expect(resolveClientId('x')).toBe('x');
    expect(typeof resolveClientId()).toBe('string');
  });
});
