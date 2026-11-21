import { barLayout } from '../../../domain/execution';
import styles from './RangeBar.module.css';

export interface RangeBarProps {
  /** Live value; null = no marker (no signal). */
  value: number | null;
  low: number;
  high: number;
  testId?: string;
}

/**
 * The target range of a live value (owner decision D22): a band for the range that counts as on
 * target and a marker for the current value. Decorative for assistive tech (the numbers next to
 * it carry the meaning, and live values are not announced). The marker moves with a transform
 * transition, so a new reading glides instead of jumping.
 */
export function RangeBar({ value, low, high, testId }: RangeBarProps) {
  // No signal: nothing to place on the bar, and the "—" already says so; the space goes back
  // to the HUD (tight phone layouts).
  if (value === null) return null;
  const { from, to, marker } = barLayout(value, low, high);
  const inside = value !== null && value >= low && value <= high;
  return (
    <div
      className={styles.bar}
      aria-hidden="true"
      data-testid={testId}
      data-in={value === null ? undefined : inside}
    >
      <div
        className={styles.band}
        style={{ left: `${from * 100}%`, width: `${(to - from) * 100}%` }}
      />
      {marker !== null && (
        <div className={styles.track} style={{ transform: `translateX(${marker * 100}%)` }}>
          <div className={`${styles.marker} ${inside ? styles.markerIn : ''}`} />
        </div>
      )}
    </div>
  );
}
