import type { CSSProperties } from 'react';
import { loadColor, loadHeightPct } from './model';
import styles from './LoadBars.module.css';

export interface LoadBarsProps {
  load: readonly number[];
  light: readonly boolean[];
  height: string;
  /** Optional label under each bar (the detail screen). */
  labels?: readonly string[];
  testId?: string;
}

/** One glowing bar per week; height follows hard minutes, color follows relative load. */
export function LoadBars({ load, light, height, labels, testId }: LoadBarsProps) {
  const max = Math.max(0, ...load);
  return (
    <div className={styles.wrap} data-testid={testId}>
      <div className={styles.bars} style={{ height }} aria-hidden="true">
        {load.map((l, i) => (
          <div
            key={i}
            data-testid="load-bar"
            className={styles.bar}
            style={
              {
                height: `${loadHeightPct(l, max)}%`,
                '--c': loadColor(l, max, light[i] ?? false),
              } as CSSProperties
            }
          />
        ))}
      </div>
      {labels && (
        <div className={styles.labels}>
          {labels.map((text, i) => (
            <span key={i} data-testid="load-label">
              {text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
