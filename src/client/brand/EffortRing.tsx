import { useLayoutEffect, useRef } from 'react';
import { ringSegments } from './geometry';
import { QUIET_TEXT, UNFILLED } from './palette';
import styles from './brand.module.css';

export interface EffortRingProps {
  /** Effort 0..10; fractions are rounded, out-of-range values clamped. */
  effort: number;
  /** Rendered width and height: px as a number, or any CSS length (clamp(), vh...). */
  size?: number | string;
  /** The NEXT ring: 50% opacity and a grey number so it never competes with the main ring. */
  quiet?: boolean;
  /** Outline colour of the unfilled segments. */
  outline?: string;
  /** Colour of the number (a CSS colour); the quiet ring always uses the grey. */
  numColor?: string;
  /** Accessible name for the whole ring; the visible number is hidden from assistive tech then. */
  label?: string;
  /** Test id of the number element (the ring box keeps `effort-ring`). */
  numberTestId?: string;
  /**
   * Motion on an effort change (transform and opacity only): the segments in between fill (or
   * empty) one after the other, 35 ms apart, and the number rolls. Off by default.
   */
  motion?: boolean;
  className?: string;
}

const SEGMENT_MS = 260;
const STAGGER_MS = 35;
const ROLL_MS = 420;

/** Effort ring: 10 rectangular segments over 270 degrees, filled up to the effort in zone colours. */
export function EffortRing({
  effort,
  size = 200,
  quiet = false,
  outline = UNFILLED,
  numColor,
  label,
  numberTestId,
  motion = false,
  className,
}: EffortRingProps) {
  const value = Math.min(10, Math.max(0, Math.round(Number.isFinite(effort) ? effort : 0)));
  const segs = ringSegments({ effort: value });
  const box = typeof size === 'number' ? `${size}px` : size;
  const svgRef = useRef<SVGSVGElement>(null);
  const numRef = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);

  useLayoutEffect(() => {
    const from = shown.current;
    shown.current = value;
    const svg = svgRef.current;
    if (!motion || from === value || !svg || typeof svg.animate !== 'function') return;
    const up = value > from;
    const paths = svg.querySelectorAll('path');
    const changed: number[] = [];
    for (let i = Math.min(from, value); i < Math.max(from, value); i++) changed.push(i);
    if (!up) changed.reverse(); // going down, the highest segment goes first
    changed.forEach((seg, k) => {
      paths[seg]?.animate(
        [
          { opacity: 0, transform: 'scale(0.6)' },
          { opacity: 1, transform: 'scale(1)' },
        ],
        { duration: SEGMENT_MS, delay: k * STAGGER_MS, easing: 'ease-out', fill: 'backwards' },
      );
    });
    numRef.current?.animate(
      [
        { opacity: 0, transform: `translateY(${up ? '38%' : '-38%'})` },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: ROLL_MS, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
    );
  }, [value, motion]);

  return (
    <div
      className={`${styles.ring}${className ? ` ${className}` : ''}`}
      style={{ width: box, height: box }}
      data-testid="effort-ring"
      data-effort={value}
      data-quiet={quiet ? 'true' : undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <svg ref={svgRef} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        {segs.map((s, i) =>
          s.filled ? (
            <path
              key={i}
              d={s.d}
              fill={s.color}
              stroke={s.color}
              strokeWidth={s.strokeWidth}
              strokeLinejoin="round"
              opacity={quiet ? 0.5 : undefined}
            />
          ) : (
            <path
              key={i}
              d={s.d}
              fill="none"
              stroke={outline}
              strokeWidth={s.strokeWidth}
              strokeLinejoin="round"
            />
          ),
        )}
      </svg>
      <span
        ref={numRef}
        className={styles.num}
        data-testid={numberTestId}
        style={{
          fontSize:
            typeof size === 'number'
              ? size * (quiet ? 0.44 : 0.4)
              : `calc(${box} * ${quiet ? 0.44 : 'var(--num-k, 0.4)'})`,
          color: quiet ? QUIET_TEXT : numColor,
        }}
        aria-hidden={label ? true : undefined}
      >
        {String(value).padStart(2, '0')}
      </span>
    </div>
  );
}
