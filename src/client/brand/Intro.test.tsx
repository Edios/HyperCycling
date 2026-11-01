import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../domain/settings';
import { Intro } from './Intro';
import { logoSegments } from './geometry';
import { introMode, type IntroEnv } from './intro-policy';
import { INTRO_TIMING, MARK_SIZE, introLayout, introState } from './intro-timeline';

const mocks = vi.hoisted(() => ({ intensity: 1, loaded: true }));
vi.mock('../data/useSettings', () => ({
  useSettings: () => ({
    settings: { ...DEFAULT_SETTINGS, effectsIntensity: mocks.intensity },
    loaded: mocks.loaded,
  }),
}));

const base: IntroEnv = { e2e: false, webdriver: false, reducedMotion: false, effectsOff: false };

describe('introMode', () => {
  it('plays the full animation by default', () => {
    expect(introMode(base)).toBe('full');
  });
  it('shows a still logo under reduced motion', () => {
    expect(introMode({ ...base, reducedMotion: true })).toBe('static');
  });
  it.each([
    ['e2e builds', { e2e: true }],
    ['automated browsers', { webdriver: true }],
    ['effects off', { effectsOff: true }],
  ] as const)('is skipped for %s', (_name, patch) => {
    expect(introMode({ ...base, ...patch })).toBe('none');
  });
});

describe('introState', () => {
  const layout = introLayout(400);
  it('lasts 3.2 s including the fade', () => {
    expect(INTRO_TIMING.end + INTRO_TIMING.fade).toBeCloseTo(3.2);
  });
  it('rests exactly on the logo geometry (identity transform, name visible)', () => {
    const s = introState(INTRO_TIMING.end, layout);
    expect(s.ticks).toHaveLength(logoSegments(MARK_SIZE).length);
    for (const tick of s.ticks) {
      expect(tick.opacity).toBe(1);
      const m =
        /translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\) scale\(([\d.]+)\) translate\(([-\d.]+) ([-\d.]+)\)/.exec(
          tick.transform,
        );
      expect(m).not.toBeNull();
      const [, x, y, rot, scale, nx, ny] = (m ?? []).map(Number);
      expect(Math.abs((x ?? 0) + (nx ?? 0))).toBeLessThan(0.01);
      expect(Math.abs((y ?? 0) + (ny ?? 0))).toBeLessThan(0.01);
      expect(rot).toBeCloseTo(0);
      expect(scale).toBeCloseTo(1);
    }
    expect(s.words.every((w) => w.opacity === 1 && w.dx === 0)).toBe(true);
  });
  it('starts as small flat dashes on a line with no name', () => {
    const s = introState(0.2, layout);
    expect(s.words.every((w) => w.opacity === 0)).toBe(true);
    expect(s.ticks[0]?.transform).toContain('scale(0.4000)');
  });
});

describe('Intro', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    location.hash = '';
    mocks.intensity = 1;
    mocks.loaded = true;
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
  });

  it('shows the logo only, hidden from assistive tech, with no digit', () => {
    render(<Intro />);
    const root = screen.getByTestId('intro');
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.textContent).toContain('Hyper');
    expect(root.textContent).toContain('Cycling');
    expect(root.querySelectorAll('path')).toHaveLength(10);
    expect(root.textContent).not.toMatch(/\d/);
  });

  it('is shown on every mount, not once per session', () => {
    sessionStorage.setItem('hypercycling.intro', '1');
    const first = render(<Intro />);
    expect(screen.getByTestId('intro')).toBeInTheDocument();
    first.unmount();
    render(<Intro />);
    expect(screen.getByTestId('intro')).toBeInTheDocument();
  });

  it('Esc skips it', () => {
    render(<Intro />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByTestId('intro')).toBeNull();
  });

  it('any key skips it', () => {
    render(<Intro />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByTestId('intro')).toBeNull();
  });

  it('a click skips it', () => {
    render(<Intro />);
    act(() => {
      screen.getByTestId('intro').click();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByTestId('intro')).toBeNull();
  });

  it('reduced motion shows a still logo for about 0.6 s', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(<Intro />);
    expect(screen.getByTestId('intro')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(screen.queryByTestId('intro')).toBeNull();
  });

  it('is skipped under webdriver', () => {
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    render(<Intro />);
    expect(screen.queryByTestId('intro')).toBeNull();
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
