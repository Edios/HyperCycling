import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../domain/settings';
import { Intro } from './Intro';
import { shouldShowIntro, type IntroEnv } from './intro-policy';

const mocks = vi.hoisted(() => ({ intensity: 1, loaded: true }));
vi.mock('../data/useSettings', () => ({
  useSettings: () => ({
    settings: { ...DEFAULT_SETTINGS, effectsIntensity: mocks.intensity },
    loaded: mocks.loaded,
  }),
}));

const base: IntroEnv = {
  e2e: false,
  webdriver: false,
  reducedMotion: false,
  effectsOff: false,
  atStart: true,
  alreadySeen: false,
};

describe('shouldShowIntro', () => {
  it('plays on a first visit to the start page', () => {
    expect(shouldShowIntro(base)).toBe(true);
  });
  it.each([
    ['e2e builds', { e2e: true }],
    ['automated browsers', { webdriver: true }],
    ['reduced motion', { reducedMotion: true }],
    ['effects off', { effectsOff: true }],
    ['deep links', { atStart: false }],
    ['a second load in the session', { alreadySeen: true }],
  ] as const)('is skipped for %s', (_name, patch) => {
    expect(shouldShowIntro({ ...base, ...patch })).toBe(false);
  });
});

describe('Intro', () => {
  beforeEach(() => {
    sessionStorage.clear();
    location.hash = '';
    mocks.intensity = 1;
    mocks.loaded = true;
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });

  it('shows once per session and Esc skips it', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<Intro />);
    expect(screen.getByTestId('intro')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByTestId('intro')).toBeNull();
    unmount();
    render(<Intro />);
    expect(screen.queryByTestId('intro')).toBeNull();
    vi.useRealTimers();
  });

  it('a click skips it', () => {
    vi.useFakeTimers();
    render(<Intro />);
    act(() => {
      screen.getByTestId('intro').click();
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByTestId('intro')).toBeNull();
    vi.useRealTimers();
  });

  it('does not play when effects are off', () => {
    mocks.intensity = 0;
    render(<Intro />);
    expect(screen.queryByTestId('intro')).toBeNull();
  });

  it('waits for the settings to load', () => {
    mocks.loaded = false;
    render(<Intro />);
    expect(screen.queryByTestId('intro')).toBeNull();
  });
});
