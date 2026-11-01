import { ringSegments } from './geometry';
import { QUIET_TEXT, UNFILLED } from './palette';
import styles from './brand.module.css';

export interface EffortRingProps {
  /** Effort 0..10; fractions are rounded, out-of-range values clamped. */
  effort: number;
  /** Rendered width and height in px. */
  size?: number;
  /** The NEXT ring: 50% opacity and a grey number so it never competes with the main ring. */
  quiet?: boolean;
  /** Outline colour of the unfilled segments. */
  outline?: string;
  /** Accessible name for the whole ring; the visible number is hidden from assistive tech then. */
  label?: string;
  className?: string;
}

/** Effort ring: 10 rectangular segments over 270 degrees, filled up to the effort in zone colours. */
export function EffortRing({
  effort,
  size = 200,
  quiet = false,
  outline = UNFILLED,
  label,
  className,
}: EffortRingProps) {
  const value = Math.min(10, Math.max(0, Math.round(Number.isFinite(effort) ? effort : 0)));
  const segs = ringSegments({ effort: value });
  return (
    <div
      className={`${styles.ring}${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
      data-testid="effort-ring"
      data-effort={value}
      data-quiet={quiet ? 'true' : undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
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
        className={styles.num}
        style={{ fontSize: size * (quiet ? 0.44 : 0.4), color: quiet ? QUIET_TEXT : undefined }}
        aria-hidden={label ? true : undefined}
      >
        {String(value).padStart(2, '0')}
      </span>
    </div>
  );
}
