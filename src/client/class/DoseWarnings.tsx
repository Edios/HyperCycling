import { useState } from 'react';
import { doseWarnings, type DoseLevel } from '../../domain/dose-rules';
import type { EffortTable } from '../../domain/effort';
import type { Workout } from '../../domain/workout';
import { useT, type MessageKey } from '../i18n';
import { formatClock } from '../training/format';
import styles from './DoseWarnings.module.css';

/**
 * Quiet list of dosing advice for a workout (cadence, standing, sprints, rest, warm-up, cool-down).
 * Collapsed by default, never blocks anything; renders nothing when the workout is clean.
 */
export function DoseWarnings({
  workout,
  table,
  onPick,
}: {
  workout: Workout;
  table: EffortTable;
  /** When given, an entry becomes a button that selects its block. */
  onPick?: (blockId: string) => void;
}) {
  const t = useT();
  const [gentle, setGentle] = useState(false);
  const level: DoseLevel = gentle ? 'gentle' : 'standard';
  const items = doseWarnings(workout, { level, table });
  if (items.length === 0 && !gentle) return null;
  return (
    <details className={styles.box} data-testid="dose-warnings">
      <summary className={styles.summary}>
        <span>{t('dose.title')}</span>
        <span className={styles.count} data-testid="dose-count">
          {t('dose.count', { n: items.length })}
        </span>
      </summary>
      <p className={styles.hint}>{t('dose.hint')}</p>
      <label className={styles.gentle}>
        <input type="checkbox" checked={gentle} onChange={(e) => setGentle(e.target.checked)} />{' '}
        {t('dose.gentle')}
      </label>
      <ul className={styles.list}>
        {items.map((x) => {
          const blockId = x.blockId;
          const text = (
            <>
              <span className={styles.badge} data-level={x.level}>
                {t(x.level === 'warn' ? 'dose.warn' : 'dose.info')}
              </span>{' '}
              {t(`dose.${x.code}` as MessageKey, x.params)}{' '}
              <span className={styles.at}>({t('dose.at', { time: formatClock(x.fromSec) })})</span>
            </>
          );
          return (
            <li key={`${x.code}-${blockId ?? ''}`} data-testid="dose-item" data-code={x.code}>
              {onPick && blockId ? (
                <button type="button" className={styles.pick} onClick={() => onPick(blockId)}>
                  {text}
                </button>
              ) : (
                text
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
