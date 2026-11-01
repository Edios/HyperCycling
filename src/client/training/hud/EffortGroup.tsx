import type { CSSProperties } from 'react';
import { DashLine, EffortRing } from '../../brand';
import { useT } from '../../i18n';
import type { Segment } from '../../../domain/segments';
import type { EffortLabelKey } from '../../../domain/effort';
import { translateContentText } from '../content-text';
import { formatClock } from '../format';
import hud from './hud.module.css';
import styles from './EffortGroup.module.css';

export interface EffortGroupProps {
  effort: number;
  ftpPct: number;
  labelKey: EffortLabelKey;
  next?: Segment;
  /**
   * Where NEXT sits: 'below' = under the ring behind a grey dash (corner, wing and tile panels),
   * 'aside' = a stack to the right of the ring (column section, Minimal strip, phone).
   */
  nextPlacement?: 'below' | 'aside';
  /** Glass material (a background behind): the unfilled ring segments get a lighter outline. */
  glass?: boolean;
  /** A section of a column instead of a panel of its own. */
  section?: boolean;
  /** Ring motion on an effort change (off for reduced motion / Effects off). */
  motion?: boolean;
  className?: string;
}

/** Group W: the effort ring with its name and % FTP, and the quiet NEXT beside or below it. */
export function EffortGroup({
  effort,
  ftpPct,
  labelKey,
  next,
  nextPlacement = 'below',
  glass = false,
  section = false,
  motion = false,
  className,
}: EffortGroupProps) {
  const t = useT();
  const label = t(`effort.${labelKey}`);
  const nextDesc = next
    ? [
        next.rpm !== undefined ? `${next.rpm} ${t('training.rpm')}` : '',
        next.label ? translateContentText(next.label, 'label') : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const outline = glass ? '#8a93a3' : '#4a556b';
  const rootStyle = { '--outline': outline } as CSSProperties;
  const classes = [
    section ? hud.sec : `${hud.panel} ${hud.zoned}`,
    styles.eff,
    nextPlacement === 'aside' ? styles.aside : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} data-g="W" data-testid="effort-group" style={rootStyle}>
      <div className={styles.main} data-testid="effort-value" data-variant="overlay">
        <div className={styles.ringBox}>
          <EffortRing
            effort={effort}
            size="var(--ring, calc(33 * var(--u)))"
            outline={outline}
            numColor="var(--zt)"
            numberTestId="effort-value-number"
            motion={motion}
          />
          <span className={`${hud.lbl} ${styles.inRing}`}>{t('training.effort')}</span>
        </div>
        <div className={`${hud.lbl} ${styles.name}`}>
          {label} · {t('training.ftpApprox', { pct: Math.round(ftpPct) })}
        </div>
      </div>
      <DashLine className={styles.dash} />
      <div
        className={styles.next}
        data-testid="next-block"
        data-effort={next?.effortStart}
        data-finish={next ? undefined : true}
      >
        <div className={`${hud.lbl} ${styles.nextLabel}`}>{t('training.next')}</div>
        {next ? (
          <>
            <EffortRing
              effort={next.effortStart}
              size="var(--nring, calc(11.7 * var(--u)))"
              quiet
              outline={glass ? '#56606f' : '#3a4456'}
              className={styles.nextRing}
            />
            <div className={`${hud.big} ${styles.nextTime}`}>{formatClock(next.durationSec)}</div>
            {nextDesc && <div className={`${hud.cap} ${styles.nextDesc}`}>{nextDesc}</div>}
          </>
        ) : (
          <div className={`${hud.big} ${styles.nextTime}`}>{t('training.finish')}</div>
        )}
      </div>
    </div>
  );
}
