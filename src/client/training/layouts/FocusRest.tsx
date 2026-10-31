import { useT } from '../../i18n';
import { formatClock } from '../format';
import type { TrainingView } from '../view';
import styles from './FocusRest.module.css';

export interface FocusRestProps {
  view: TrainingView;
  /** True while the Focus HUD is hidden: this calm screen is what the rider sees. */
  active: boolean;
  reducedMotion: boolean;
}

/**
 * Focus on the plain background: while the HUD is away the whole screen takes the effort colour
 * and shows only the big effort number. No motion, nothing to read but the number.
 */
export function FocusRest({ view, active, reducedMotion }: FocusRestProps) {
  const t = useT();
  return (
    <div
      className={`${styles.root} ${active ? styles.on : ''} ${reducedMotion ? styles.instant : ''}`}
      data-testid="focus-rest"
      data-active={active}
      aria-hidden={!active}
    >
      <div className={styles.value} data-testid="focus-rest-effort">
        {Math.round(view.effort)}
      </div>
      <div className={styles.label}>{t(`effort.${view.labelKey}`)}</div>
      <div className={styles.time}>{formatClock(view.remainingSec)}</div>
    </div>
  );
}
