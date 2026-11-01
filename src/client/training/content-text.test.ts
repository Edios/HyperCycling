import { describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { translateContentText } from './content-text';

describe('translateContentText', () => {
  it('maps cue tokens to coach.*', () => {
    setLang('en');
    expect(translateContentText('@sprint', 'cue')).toBe('Sprint!');
    setLang('pl');
    expect(translateContentText('@goUntilFail', 'cue')).toBe('Jedź do odcięcia!');
    setLang('en');
  });
  it('maps label tokens to block.*', () => {
    expect(translateContentText('@warmup', 'label')).toBe('Warm-up');
  });
  it('returns the raw key for unknown tokens', () => {
    expect(translateContentText('@nope', 'cue')).toBe('nope');
    expect(translateContentText('@nope', 'label')).toBe('nope');
  });
  it('keeps plain text verbatim', () => {
    expect(translateContentText('Smile', 'cue')).toBe('Smile');
    expect(translateContentText('a@b', 'label')).toBe('a@b');
  });
});
