import { describe, expect, it } from 'vitest';
import type { SessionConfig } from '../../domain/settings';
import { activeHud, hudChoices, withLiveChoice, youtubeUrlFor } from './quick-settings';

const base: SessionConfig = { background: 'basic', hud: 'solo', playerIds: ['p1'], music: true };

describe('hudChoices', () => {
  it('basic offers solo, plus players when riders are selected', () => {
    expect(hudChoices('basic', false, false)).toEqual(['solo']);
    expect(hudChoices('basic', true, false)).toEqual(['solo', 'players']);
  });
  it('overlay backgrounds offer the overlay layouts; riders on screen limit them', () => {
    expect(hudChoices('hyperride', false, false)).toEqual([
      'immersive',
      'column',
      'cockpit',
      'tunnelTime',
    ]);
    expect(hudChoices('youtube', true, true)).toEqual(['immersive', 'column']);
    expect(hudChoices('youtube', true, false)).toHaveLength(4);
  });
});

describe('activeHud', () => {
  it('maps the screen state to a stored layout', () => {
    expect(activeHud('basic', true, 'column')).toBe('players');
    expect(activeHud('basic', false, 'column')).toBe('solo');
    expect(activeHud('hyperride', true, 'column')).toBe('column');
  });
});

describe('youtubeUrlFor', () => {
  it('prefers the session link, then the latest recent one', () => {
    expect(youtubeUrlFor('a', ['b'])).toBe('a');
    expect(youtubeUrlFor(undefined, ['b', 'c'])).toBe('b');
    expect(youtubeUrlFor(undefined, [])).toBeUndefined();
  });
});

describe('withLiveChoice', () => {
  it('keeps riders and music, swaps background and layout', () => {
    expect(withLiveChoice(base, 'hyperride', 'cockpit', undefined)).toEqual({
      ...base,
      background: 'hyperride',
      hud: 'cockpit',
    });
  });
  it('carries the link only for YouTube', () => {
    const yt = withLiveChoice(base, 'youtube', 'immersive', 'https://youtu.be/x');
    expect(yt.youtubeUrl).toBe('https://youtu.be/x');
    expect(withLiveChoice(yt, 'basic', 'solo', 'https://youtu.be/x')).not.toHaveProperty(
      'youtubeUrl',
    );
  });
});
