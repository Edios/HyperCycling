import { describe, expect, it } from 'vitest';
import type { SessionConfig } from '../../domain/settings';
import { withLiveChoice, youtubeUrlFor } from './quick-settings';
import {
  layoutChoices,
  layoutKindOf,
  nextLayout,
  storedHud,
  supportsRiders,
} from './overlay-layouts';

const base: SessionConfig = { background: 'basic', hud: 'solo', playerIds: ['p1'], music: true };

describe('layoutChoices', () => {
  it('every background offers every corner / column / cockpit / minimal / focus layout', () => {
    const overlays = ['immersive', 'column', 'cockpit', 'tunnelTime', 'focus'];
    expect(layoutChoices('hyperride')).toEqual(overlays);
    expect(layoutChoices('youtube')).toEqual(overlays);
    expect(layoutChoices('basic')).toEqual(['classic', ...overlays]);
  });
});

describe('layoutKindOf / storedHud', () => {
  it('maps stored ids to layouts; solo / players are Classic on Basic only', () => {
    expect(layoutKindOf('solo', 'basic')).toBe('classic');
    expect(layoutKindOf('players', 'basic')).toBe('classic');
    expect(layoutKindOf('solo', 'hyperride')).toBe('immersive');
    expect(layoutKindOf('focus', 'basic')).toBe('focus');
    expect(layoutKindOf('cockpit', 'youtube')).toBe('cockpit');
  });
  it('stores Classic as solo / players and the others under their own id', () => {
    expect(storedHud('classic', true)).toBe('players');
    expect(storedHud('classic', false)).toBe('solo');
    expect(storedHud('focus', true)).toBe('focus');
  });
  it('only Cockpit and Minimal have no room for riders', () => {
    expect(supportsRiders('cockpit')).toBe(false);
    expect(supportsRiders('tunnelTime')).toBe(false);
    expect(supportsRiders('focus')).toBe(true);
    expect(supportsRiders('classic')).toBe(true);
  });
});

describe('nextLayout (the H shortcut)', () => {
  it('cycles through every layout including Focus, then wraps', () => {
    expect(nextLayout('immersive', 'hyperride')).toBe('column');
    expect(nextLayout('tunnelTime', 'youtube')).toBe('focus');
    expect(nextLayout('focus', 'hyperride')).toBe('immersive');
  });
  it('Classic is part of the cycle on Basic only', () => {
    expect(nextLayout('focus', 'basic')).toBe('classic');
    expect(nextLayout('classic', 'basic')).toBe('immersive');
    expect(nextLayout('classic', 'hyperride')).toBe('immersive');
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
