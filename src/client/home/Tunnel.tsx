import { useEffect, useState } from 'react';
import styles from './Tunnel.module.css';

const CX = 320;
const CY = 220;
const RADIUS = 300;

/** Octagon points at radius r around the tunnel centre (slightly squashed, like the mockup). */
function octagon(r: number): string {
  return Array.from({ length: 8 }, (_, k) => {
    const a = ((22.5 + 45 * k) * Math.PI) / 180;
    return `${(CX + Math.cos(a) * r).toFixed(1)},${(CY + Math.sin(a) * r * 0.92).toFixed(1)}`;
  }).join(' ');
}

/** True while the tab is visible; the drift pauses in a hidden tab. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(
    typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  useEffect(() => {
    const on = (): void => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/**
 * Neon tunnel behind the hero: one ring per workout block in its zone colour, drifting slowly
 * towards the viewer. Plain SVG + CSS (no canvas, no WebGL); static with reduced motion.
 */
export function Tunnel({ zones }: { zones: readonly number[] }) {
  const visible = usePageVisible();
  const n = zones.length;
  return (
    <svg
      className={`${styles.tunnel} ${visible ? '' : styles.paused}`}
      viewBox="0 0 640 440"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      data-testid="home-tunnel"
    >
      {Array.from({ length: 8 }, (_, k) => {
        const a = ((22.5 + 45 * k) * Math.PI) / 180;
        return (
          <line
            key={k}
            x1={CX + Math.cos(a) * 10}
            y1={CY + Math.sin(a) * 10}
            x2={CX + Math.cos(a) * 520}
            y2={CY + Math.sin(a) * 520 * 0.92}
            className={styles.spoke}
          />
        );
      })}
      {zones.map((z, i) => {
        // First block nearest; each ring sits at its own phase of the same drift loop.
        const phase = n > 0 ? (n - 1 - i) / n : 0;
        return (
          <g
            key={i}
            className={styles.ring}
            style={{ ['--phase' as string]: phase, ['--c' as string]: `var(--z${z})` }}
          >
            <polygon points={octagon(RADIUS)} />
          </g>
        );
      })}
    </svg>
  );
}
