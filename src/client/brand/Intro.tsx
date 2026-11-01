import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../data/useSettings';
import { useT } from '../i18n';
import { logoSegments } from './geometry';
import { INTRO_TIMING, MARK_SIZE, introLayout, introState } from './intro-timeline';
import { introMode, type IntroMode } from './intro-policy';
import { NAME_BOLD, NAME_LIGHT } from './Wordmark';
import styles from './Intro.module.css';

/** Reduced motion: the finished logo for a moment, then the fade. */
const STATIC_HOLD_MS = 200;
const STATIC_FADE_MS = 400;

function envMode(effectsOff: boolean): IntroMode {
  return introMode({
    e2e: import.meta.env.VITE_E2E === '1' || import.meta.env.VITE_E2E === 'true',
    webdriver: typeof navigator !== 'undefined' && navigator.webdriver === true,
    reducedMotion:
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    effectsOff,
  });
}

/**
 * Brand intro, played on every load of the app shell (the app is rendered underneath, so it is
 * interactive at once): ten rectangular dashes on a dotted line lift into the logo's 270 degree
 * ring, then the name slides in and the finished logo is held. No digit. Any click, tap or key
 * skips it. Not played for e2e builds, automated browsers or "Effects: off"; reduced motion gets
 * a still logo for 0.6 s.
 */
export function Intro() {
  const t = useT();
  const { settings, loaded } = useSettings();
  const [phase, setPhase] = useState<'show' | 'fade' | 'done'>('show');
  const ticks = useRef<(SVGPathElement | null)[]>([]);
  const mark = useRef<SVGGElement>(null);
  const w1 = useRef<SVGTextElement>(null);
  const w2 = useRef<SVGTextElement>(null);
  // The settings are only known once loaded; until then nothing is shown.
  const mode: IntroMode = loaded ? envMode(settings.effectsIntensity <= 0) : 'none';
  const active = mode !== 'none' && phase !== 'done';
  const playing = active && phase === 'show';
  const fadeMs = mode === 'static' ? STATIC_FADE_MS : INTRO_TIMING.fade * 1000;

  const skip = (): void => setPhase((p) => (p === 'show' ? 'fade' : p));

  useEffect(() => {
    if (!playing) return undefined;
    window.addEventListener('keydown', skip);
    return () => window.removeEventListener('keydown', skip);
  }, [playing]);

  useEffect(() => {
    if (!active || phase !== 'fade') return undefined;
    const id = window.setTimeout(() => setPhase('done'), fadeMs);
    return () => window.clearTimeout(id);
  }, [active, phase, fadeMs]);

  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    let hold = 0;
    let cancelled = false;
    const run = (): void => {
      if (cancelled) return;
      const textLen = (el: SVGTextElement | null, fallback: number): number =>
        typeof el?.getComputedTextLength === 'function' ? el.getComputedTextLength() : fallback;
      const layout = introLayout(Math.max(textLen(w1.current, 330), textLen(w2.current, 380)));
      mark.current?.setAttribute(
        'transform',
        `translate(${layout.left} ${layout.top}) scale(${layout.scale})`,
      );
      w1.current?.setAttribute('y', String(layout.y1));
      w2.current?.setAttribute('y', String(layout.y2));

      const frame = (time: number): void => {
        const s = introState(time, layout);
        s.ticks.forEach((tick, i) => {
          ticks.current[i]?.setAttribute('transform', tick.transform);
          ticks.current[i]?.setAttribute('opacity', String(tick.opacity));
        });
        [w1.current, w2.current].forEach((el, i) => {
          const w = s.words[i];
          if (!el || !w) return;
          el.setAttribute('opacity', String(w.opacity));
          el.setAttribute('transform', `translate(${(layout.wx + w.dx).toFixed(2)} 0)`);
        });
      };

      if (mode === 'static') {
        frame(INTRO_TIMING.end);
        hold = window.setTimeout(skip, STATIC_HOLD_MS);
        return;
      }
      const t0 = performance.now();
      const step = (now: number): void => {
        const time = Math.min((now - t0) / 1000, INTRO_TIMING.end);
        frame(time);
        if (time < INTRO_TIMING.end) raf = requestAnimationFrame(step);
        else skip();
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
      window.clearTimeout(hold);
    };
  }, [playing, mode]);

  if (!active) return null;
  const segs = logoSegments(MARK_SIZE);
  return (
    <div
      className={`${styles.overlay} ${phase === 'fade' ? styles.fade : ''}`}
      style={{ transitionDuration: `${fadeMs}ms` }}
      data-testid="intro"
      aria-hidden="true"
      onPointerDown={skip}
      onClick={skip}
    >
      <svg viewBox="0 0 1280 720" className={styles.stage} focusable="false">
        <g ref={mark} data-testid="intro-mark">
          {segs.map((s, i) => (
            <path
              key={i}
              ref={(el) => {
                ticks.current[i] = el;
              }}
              d={s.d}
              fill={s.color}
              stroke={s.color}
              strokeWidth={s.strokeWidth}
              strokeLinejoin="round"
              opacity={0}
            />
          ))}
        </g>
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
