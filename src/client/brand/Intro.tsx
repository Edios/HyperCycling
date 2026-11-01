import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../data/useSettings';
import { useT } from '../i18n';
import { introSeen, markIntroSeen, shouldShowIntro } from './intro-policy';
import { ZONE_COLORS } from './palette';
import { NAME_BOLD, NAME_LIGHT } from './Wordmark';
import styles from './Intro.module.css';

/** Animation length in seconds (the whole intro, fade included, stays under 3 s). */
const T = 2.6;
const FADE_MS = 280;
const DIM = '#28313d';
const EFFORT = 7;
const HOLD = 0.3;
const STAG = 0.065;
const DUR = 0.75;
const COUNT0 = 1.2;
const COUNT1 = 1.9;
const WM0 = 1.65;
const WM1 = 2.3;

const clamp = (x: number, a = 0, b = 1): number => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const outCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const outBack = (t: number, s = 1.5): number => {
  const u = clamp(t) - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};
const hex = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number): string => {
  const A = hex(a);
  const B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i] ?? v, t))).join(',')})`;
};

function atStartPage(): boolean {
  return location.hash === '' || location.hash === '#' || location.hash === '#/';
}

function canPlay(): boolean {
  return (
    shouldShowIntro({
      e2e: import.meta.env.VITE_E2E === '1' || import.meta.env.VITE_E2E === 'true',
      webdriver: typeof navigator !== 'undefined' && navigator.webdriver === true,
      reducedMotion:
        typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
      effectsOff: false,
      atStart: atStartPage(),
      alreadySeen: introSeen(),
    }) && typeof requestAnimationFrame === 'function'
  );
}

/**
 * Brand intro: ten dashes lift into the effort arc, the effort counts up and the name slides in.
 * Plays once per session, on the start page, and is skipped by a click or Esc. Skipped entirely
 * for e2e builds, automated browsers, reduced motion and "Effects: off" (intensity 0).
 */
export function Intro() {
  const t = useT();
  const { settings, loaded } = useSettings();
  // Whether this load may play the intro at all is fixed at mount; the effects setting is only
  // known once the settings have loaded.
  const [playable] = useState(canPlay);
  const [phase, setPhase] = useState<'show' | 'fade' | 'done'>('show');
  const ticks = useRef<(SVGPathElement | null)[]>([]);
  const num = useRef<SVGTextElement>(null);
  const w1 = useRef<SVGTextElement>(null);
  const w2 = useRef<SVGTextElement>(null);
  const active =
    playable && loaded && settings.effectsIntensity > 0 && atStartPage() && phase !== 'done';

  useEffect(() => {
    if (active) markIntroSeen();
  }, [active]);

  const skip = (): void => setPhase((p) => (p === 'show' ? 'fade' : p));
  const playing = active && phase === 'show';

  useEffect(() => {
    if (!playing) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPhase('fade');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing]);

  useEffect(() => {
    if (!active || phase !== 'fade') return undefined;
    const id = window.setTimeout(() => setPhase('done'), FADE_MS);
    return () => window.clearTimeout(id);
  }, [active, phase]);

  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    let cancelled = false;
    const run = (): void => {
      if (cancelled) return;
      const textLen = (el: SVGTextElement | null, fallback: number): number =>
        typeof el?.getComputedTextLength === 'function' ? el.getComputedTextLength() : fallback;
      const D = 360;
      const stroke = 26;
      const gap = 64;
      const wmW = Math.max(textLen(w1.current, 330), textLen(w2.current, 380));
      const left = (1280 - (D + gap + wmW)) / 2;
      const cx = left + D / 2;
      const cy = 335;
      const r = D / 2 - stroke / 2;
      const wx = left + D + gap;
      const lh = 124;
      const cap = 105;
      const y1 = cy - (lh + cap) / 2 + cap;
      const y2 = y1 + lh;
      const x0 = wx + stroke / 2;
      const x1 = wx + wmW - stroke / 2;
      const yLine = y2 + 66;
      w1.current?.setAttribute('x', String(wx));
      w1.current?.setAttribute('y', String(y1));
      w2.current?.setAttribute('x', String(wx));
      w2.current?.setAttribute('y', String(y2));
      num.current?.setAttribute('x', String(cx));
      num.current?.setAttribute('y', String(cy + 52));

      const SEG = 27;
      const point = (i: number, u: number, p: number): [number, number] => {
        const g = (Math.atan(stroke / r) * 180) / Math.PI + 3.5;
        const a = ((135 + i * SEG + g / 2 + u * (SEG - g)) * Math.PI) / 180;
        const ax = cx + r * Math.cos(a);
        const ay = cy + r * Math.sin(a);
        const sx = lerp(x0, x1, i / 9) + (u - 0.5) * 6;
        return [lerp(sx, ax, p), lerp(yLine, ay, p) - Math.sin(Math.PI * clamp(p)) * 70];
      };

      const frame = (time: number): void => {
        const c = lerp(1, EFFORT, outCubic(clamp((time - COUNT0) / (COUNT1 - COUNT0))));
        const blend = clamp((time - COUNT0 + 0.12) / 0.12);
        for (let i = 0; i < 10; i++) {
          const el = ticks.current[i];
          if (!el) continue;
          const p = outBack((time - HOLD - i * STAG) / DUR);
          let d = '';
          for (let k = 0; k <= 8; k++) {
            const [x, y] = point(i, k / 8, p);
            d += `${k ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
          }
          const zone = ZONE_COLORS[i] ?? DIM;
          const lit = time < COUNT0 - 0.12 ? 1 : lerp(1, clamp(c - i + 0.0001), blend);
          el.setAttribute('d', d);
          el.setAttribute('stroke', lit >= 1 ? zone : mix(DIM, zone, lit));
        }
        if (num.current) {
          num.current.textContent = String(Math.round(c));
          num.current.setAttribute('opacity', String(clamp((time - (COUNT0 - 0.15)) / 0.15)));
        }
        const words: [SVGTextElement | null, number][] = [
          [w1.current, 0],
          [w2.current, 0.1],
        ];
        for (const [el, delay] of words) {
          if (!el) continue;
          const u = outCubic(clamp((time - WM0 - delay) / (WM1 - WM0 - 0.1)));
          el.setAttribute('opacity', String(u));
          el.setAttribute('transform', `translate(${((1 - u) * -70).toFixed(2)} 0)`);
        }
      };

      const t0 = performance.now();
      const step = (now: number): void => {
        const time = clamp((now - t0) / 1000, 0, T);
        frame(time);
        if (time < T) raf = requestAnimationFrame(step);
        else setPhase((p) => (p === 'show' ? 'fade' : p));
      };
      raf = requestAnimationFrame(step);
    };
    // The wordmark is measured with the real font, so wait for it (never longer than 600 ms).
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (fonts?.load) {
      void Promise.race([
        Promise.all([
          fonts.load('800 100px "Barlow Condensed"'),
          fonts.load('600 100px "Barlow Condensed"'),
        ]),
        new Promise((resolve) => setTimeout(resolve, 600)),
      ]).then(run, run);
    } else {
      run();
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [playing]);

  if (!active) return null;
  return (
    <div
      className={`${styles.overlay} ${phase === 'fade' ? styles.fade : ''}`}
      data-testid="intro"
      role="presentation"
      onClick={skip}
    >
      <svg viewBox="0 0 1280 720" className={styles.stage} role="img" aria-label={t('app.title')}>
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {ZONE_COLORS.map((color, i) => (
            <path
              key={i}
              ref={(el) => {
                ticks.current[i] = el;
              }}
              stroke={color}
              strokeWidth={26}
            />
          ))}
        </g>
        <text ref={num} textAnchor="middle" className={styles.num} opacity={0}>
          1
        </text>
        <text ref={w1} className={styles.hyper} opacity={0}>
          {NAME_LIGHT}
        </text>
        <text ref={w2} className={styles.cycling} opacity={0}>
          {NAME_BOLD}
        </text>
      </svg>
      <span className={styles.hint}>{t('intro.skip')}</span>
    </div>
  );
}
