import type { CSSProperties } from 'react';
import { useT } from '../../i18n';
import { fitStyle } from './fit';
import hud from './hud.module.css';
import styles from './MeasuresGroup.module.css';

export interface MeasuresGroupProps {
  rpm?: number;
  /** True when the bike does not measure cadence: the number is the plan's target. */
  isTarget: boolean;
  /** Fit the value to the width of a Classic tile. */
  fit?: boolean;
  /** A section of a column instead of a panel of its own. */
  section?: boolean;
  /** One row per line with the label on the left (column section) instead of label over value. */
  line?: boolean;
  /** Hide the small description under the value (Minimal strip, phone). */
  bare?: boolean;
  className?: string;
}

/**
 * Group M: cadence. Power and heart rate join it as rows when the app reads those sensors
 * (order: power, cadence, HR); a row without data does not exist, and with no rows the group is
 * not drawn at all.
 */
export function MeasuresGroup({
  rpm,
  isTarget,
  fit = false,
  section = false,
  line = false,
  bare = false,
  className,
}: MeasuresGroupProps) {
  const t = useT();
  const value = rpm === undefined ? '—' : String(Math.round(rpm));
  const notes: string[] = [];
  if (isTarget && rpm !== undefined) notes.push(t('training.targetFromPlan'));
  const valueStyle: CSSProperties | undefined = fit ? fitStyle(value.length) : undefined;
  const classes = [
    section ? hud.sec : hud.panel,
    styles.measures,
    fit ? styles.fit : '',
    line ? styles.line : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} data-g="M" data-testid="rpm-value">
      <div className={styles.row}>
        <div className={styles.head}>
          <div className={hud.lbl}>{t('training.cadence')}</div>
          {!bare && notes.length > 0 && <div className={hud.cap}>{notes.join(' · ')}</div>}
        </div>
        <div className={styles.vv}>
          <span
            data-testid="rpm-value-number"
            className={`${hud.big} ${styles.value}`}
            style={valueStyle}
          >
            {value}
          </span>
          <span className={hud.unit}>{t('training.rpm')}</span>
        </div>
      </div>
    </div>
  );
}
