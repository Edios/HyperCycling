import type { CSSProperties } from 'react';
import type { Segment } from '../../../domain/segments';
import { useT } from '../../i18n';
import { translateContentText } from '../content-text';
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
            <span className={styles.effort} style={{ '--c': effortColor } as CSSProperties}>
              {next.effortStart}
            </span>
            {next.rpm !== undefined && ` · ${next.rpm} ${t('training.rpm')}`}
            {` · ${formatClock(next.durationSec)}`}
          </span>
          {next.label && (
            <span className={styles.label}>{translateContentText(next.label, 'label')}</span>
          )}
        </>
      ) : (
        <span className={styles.facts}>{t('training.finish')}</span>
      )}
    </div>
  );
}
