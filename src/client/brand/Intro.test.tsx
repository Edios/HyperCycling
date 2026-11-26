import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../domain/settings';
import { Intro } from './Intro';
import {
  INTRO_INTERVAL_MS,
  INTRO_KEYS,
  introMode,
  readIntroPref,
  writeIntroPref,
  type IntroEnv,
} from './intro-policy';
import { fillIntroTicks } from './intro-markup';
import { INTRO_TIMING, tickStart, tickVarsCss } from './intro-timeline';

const mocks = vi.hoisted(() => ({ intensity: 1, loaded: true }));
vi.mock('../data/useSettings', () => ({
  useSettings: () => ({
    settings: { ...DEFAULT_SETTINGS, effectsIntensity: mocks.intensity },
    loaded: mocks.loaded,
  }),
}));

const root = path.resolve(__dirname, '..', '..', '..');
const NOW = 1_800_000_000_000;
const base: IntroEnv = {
  e2e: false,
  webdriver: false,
  reducedMotion: false,
  effectsOff: false,
  pref: 'rare',
  lastShownAt: null,
  now: NOW,
};

describe('introMode', () => {
  it('plays the full animation on the first visit', () => {
    expect(introMode(base)).toBe('full');
  });
  it('shows a still logo under reduced motion', () => {
    expect(introMode({ ...base, reducedMotion: true })).toBe('static');
  });
  it.each([
    ['e2e builds', { e2e: true }],
    ['automated browsers', { webdriver: true }],
    ['effects off', { effectsOff: true }],
    ['the never choice', { pref: 'never' }],
    ['always in e2e', { pref: 'always', e2e: true }],
  ] as const)('is skipped for %s', (_name, patch) => {
    expect(introMode({ ...base, ...patch })).toBe('none');
  });
  it('rare: skipped within 7 days, plays again after', () => {
    expect(introMode({ ...base, lastShownAt: NOW - 1000 })).toBe('none');
    expect(introMode({ ...base, lastShownAt: NOW - INTRO_INTERVAL_MS + 1 })).toBe('none');
    expect(introMode({ ...base, lastShownAt: NOW - INTRO_INTERVAL_MS })).toBe('full');
  });
  it('rare: a timestamp from the future does not suppress the intro', () => {
    expect(introMode({ ...base, lastShownAt: NOW + 5000 })).toBe('full');
  });
  it('always: plays even right after the last time', () => {
    expect(introMode({ ...base, pref: 'always', lastShownAt: NOW - 1000 })).toBe('full');
  });
});

describe('intro preference storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });
  it('defaults to rare, round-trips and ignores junk', () => {
    expect(readIntroPref()).toBe('rare');
    writeIntroPref('never');
    expect(readIntroPref()).toBe('never');
    localStorage.setItem(INTRO_KEYS.pref, 'sometimes');
    expect(readIntroPref()).toBe('rare');
  });
  it('survives unavailable storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readIntroPref()).toBe('rare');
    expect(() => writeIntroPref('always')).not.toThrow();
  });
});

/** public/intro-boot.js is a classic script (CSP: no inline); it must agree with introMode. */
describe('intro-boot.js', () => {
  const code = readFileSync(path.join(root, 'public', 'intro-boot.js'), 'utf8');
  const run = (): string | null => {
    document.documentElement.removeAttribute('data-intro');
    new Function(code)();
    return document.documentElement.getAttribute('data-intro');
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    localStorage.clear();
    Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
    Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
    document.documentElement.removeAttribute('data-intro');
  });

  const cases: [string, Partial<IntroEnv>][] = [
    ['first visit', {}],
    ['reduced motion', { reducedMotion: true }],
    ['webdriver', { webdriver: true }],
    ['effects off', { effectsOff: true }],
    ['never', { pref: 'never' }],
    ['always, just shown', { pref: 'always', lastShownAt: NOW - 1000 }],
    ['rare, just shown', { lastShownAt: NOW - 1000 }],
    ['rare, 7 days ago', { lastShownAt: NOW - INTRO_INTERVAL_MS }],
    ['rare, future stamp', { lastShownAt: NOW + 9000 }],
  ];
  it.each(cases)('agrees with introMode: %s', (_n, patch) => {
    const env = { ...base, ...patch };
    localStorage.setItem(INTRO_KEYS.pref, env.pref);
    if (env.lastShownAt !== null) localStorage.setItem(INTRO_KEYS.last, String(env.lastShownAt));
    if (env.effectsOff) localStorage.setItem(INTRO_KEYS.effectsOff, '1');
    Object.defineProperty(navigator, 'webdriver', { value: env.webdriver, configurable: true });
    vi.stubGlobal('matchMedia', () => ({ matches: env.reducedMotion }));
    expect(run() ?? 'none').toBe(introMode(env));
  });

  it('records the time, so the next load within a week is skipped', () => {
    expect(run()).toBe('full');
    expect(localStorage.getItem(INTRO_KEYS.last)).toBe(String(NOW));
    expect(run()).toBeNull();
  });
  it('marks a running script on <html> in every case, so the static logo replaces the SEO text', () => {
    for (const [, patch] of cases) {
      const env = { ...base, ...patch };
      localStorage.clear();
      localStorage.setItem(INTRO_KEYS.pref, env.pref);
      if (env.lastShownAt !== null) localStorage.setItem(INTRO_KEYS.last, String(env.lastShownAt));
      if (env.effectsOff) localStorage.setItem(INTRO_KEYS.effectsOff, '1');
      Object.defineProperty(navigator, 'webdriver', { value: env.webdriver, configurable: true });
      document.documentElement.removeAttribute('data-boot');
      run();
      expect(document.documentElement.hasAttribute('data-boot'), _nameOf(patch)).toBe(true);
    }
    document.documentElement.removeAttribute('data-boot');
  });
  it('shows the intro when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(run()).toBe('full');
  });
});

function _nameOf(patch: Partial<IntroEnv>): string {
  return JSON.stringify(patch);
}

/**
 * Before React starts, a visit without the intro used to show the fallback text of #root (heading,
 * paragraphs, links) on the dark page, like a footer. With the script running it shows the still
 * logo instead; crawlers and visitors without JavaScript keep the text (owner, 2026-11-26).
 */
describe('the page before React starts', () => {
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = readFileSync(path.join(root, 'src/client/brand/intro-boot.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const rootHtml = html.slice(
    html.indexOf('<div id="root">'),
    html.indexOf('<script type="module"'),
  );
  /** The declarations of the first rule whose selector list has `selector`. */
  const rule = (selector: string): string => {
    const at = css.split('}').find((block) => {
      const head = block.slice(0, block.indexOf('{'));
      return head.split(',').some((x) => x.trim() === selector);
    });
    return at ? at.slice(at.indexOf('{') + 1) : '';
  };

  it('keeps the SEO text in #root, and a still logo next to it for React to replace', () => {
    expect(rootHtml).toContain('<div class="boot-seo">');
    expect(rootHtml).toContain('<h1>HyperCycling</h1>');
    expect(rootHtml).toContain('<a href="https://getsongbpm.com"');
    expect(rootHtml).toContain('<a href="https://github.com/Edios/HyperCycling"');
    expect(rootHtml).toMatch(/<div id="boot-logo" aria-hidden="true">/);
    expect(rootHtml).toContain('<!--INTRO_TICKS-->');
  });

  it('shows the logo and hides the text only while the script runs, with no animation', () => {
    expect(rule('#boot-logo')).toMatch(/display:\s*none/);
    expect(rule('html[data-boot] #boot-logo')).toMatch(/display:\s*grid/);
    expect(rule('html[data-boot] #root > .boot-seo')).toMatch(/display:\s*none/);
    // Still: no animation on the logo (the full intro keeps its own).
    for (const block of css.split('}')) {
      if (block.includes('#boot-logo')) expect(block).not.toMatch(/animation/);
    }
  });

  it('fills every logo placeholder with the ticks (intro and still logo)', () => {
    const out = fillIntroTicks(html);
    expect(out).not.toContain('<!--INTRO_TICKS-->');
    expect(out.match(/<path class="t0"/g)).toHaveLength(2);
  });
});

describe('intro-boot.css', () => {
  const css = readFileSync(path.join(root, 'src/client/brand/intro-boot.css'), 'utf8');
  it('lasts 1.5 s including the fade', () => {
    expect(INTRO_TIMING.end + INTRO_TIMING.fade).toBeCloseTo(1.5);
    expect(css).toContain(`intro-out ${INTRO_TIMING.fade}s ease-out ${INTRO_TIMING.end}s`);
  });
  it('contains the generated per-tick start states', () => {
    const block = css.slice(css.indexOf('tick-vars:start'), css.indexOf('/* tick-vars:end'));
    // Prettier reformats the CSS, so compare without whitespace and trailing zeros.
    const norm = (x: string): string =>
      x.replace(/\s+/g, '').replace(/-?\d+\.\d+/g, (m) => String(parseFloat(m)));
    expect(norm(block)).toContain(norm(tickVarsCss()));
  });
  it('lays the ticks out as flat dashes on a line', () => {
    expect(tickStart(0).y).toBeCloseTo(tickStart(9).y);
    expect(tickStart(9).x).toBeGreaterThan(tickStart(0).x);
  });
  it('is pure CSS animation that finishes without any script', () => {
    expect(css).not.toMatch(/requestAnimationFrame/);
    expect(css).toContain('forwards');
  });
});

describe('Intro (controller)', () => {
  const mount = (attr: string | null): HTMLElement => {
    document.body.innerHTML = '<div id="boot-intro"><span class="hint"></span></div>';
    if (attr) document.documentElement.setAttribute('data-intro', attr);
    else document.documentElement.removeAttribute('data-intro');
    return document.getElementById('boot-intro') as HTMLElement;
  };
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.intensity = 1;
    mocks.loaded = true;
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-intro');
    localStorage.clear();
  });

  it('fills the skip hint and leaves the intro in place while it plays', () => {
    const el = mount('full');
    render(<Intro />);
    expect(el.querySelector('.hint')?.textContent).toBeTruthy();
    expect(document.getElementById('boot-intro')).not.toBeNull();
  });
  it('removes the element when the CSS animation ends', () => {
    const el = mount('full');
    render(<Intro />);
    act(() => {
      el.dispatchEvent(new Event('animationend'));
    });
    expect(document.getElementById('boot-intro')).toBeNull();
    expect(document.documentElement.hasAttribute('data-intro')).toBe(false);
  });
  it('removes it by itself even if no animation event arrives', () => {
    mount('full');
    render(<Intro />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(document.getElementById('boot-intro')).toBeNull();
  });
  it.each([
    ['a tap', (el: HTMLElement) => el.dispatchEvent(new Event('pointerdown'))],
    ['a key', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))],
    ['Esc', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
  ])('%s skips it', (_n, fire) => {
    const el = mount('full');
    render(<Intro />);
    act(() => {
      fire(el);
    });
    expect(el.classList.contains('skip')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(document.getElementById('boot-intro')).toBeNull();
  });
  it('removes the markup when the boot script did not enable the intro', () => {
    mount(null);
    render(<Intro />);
    expect(document.getElementById('boot-intro')).toBeNull();
  });
  it('drops it when effects are off and remembers that for the next load', () => {
    mocks.intensity = 0;
    mount('full');
    render(<Intro />);
    expect(document.getElementById('boot-intro')).toBeNull();
    expect(localStorage.getItem(INTRO_KEYS.effectsOff)).toBe('1');
  });
});
