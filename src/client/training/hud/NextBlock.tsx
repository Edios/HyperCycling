import type { Segment } from '../../../domain/segments';
import { useT } from '../../i18n';
import { formatClock } from '../format';
import styles from './NextBlock.module.css';

export interface NextBlockProps {
  next?: Segment;
  effortColor: string;
}

export function NextBlock({ next, effortColor }: NextBlockProps) {
  const t = useT();
  return (
    <div data-testid="next-block" className={styles.card}>
      <span className={styles.caption}>{t('training.next')}</span>
      {next ? (
        <>
          <span className={styles.facts}>
            <span className={styles.effort} style={{ color: effortColor }}>
              {next.effortStart}
            </span>
            {next.rpm !== undefined && ` · ${next.rpm} ${t('training.rpm')}`}
            {` · ${formatClock(next.durationSec)}`}
          </span>
          {next.label && <span className={styles.label}>{next.label}</span>}
        </>
      ) : (
        <span className={styles.facts}>{t('training.finish')}</span>
      )}
    </div>
  );
}
