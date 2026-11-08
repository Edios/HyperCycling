import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DashLine, EffortRing } from '../../brand';
import { useKnobHint } from '../../bike/useKnobHint';
import { useT } from '../../i18n';
import { positionOf, type Segment } from '../../../domain/segments';
import type { Position } from '../../../domain/workout';
import type { EffortLabelKey } from '../../../domain/effort';
import { translateContentText } from '../content-text';
import { formatClock } from '../format';
import hud from './hud.module.css';
import { PositionBadge } from './PositionBadge';
import styles from './EffortGroup.module.css';

/** The word 'Effort' goes inside the ring only from this ring size (px); below, a caption. */
export const RING_WORD_MIN_PX = 230;

export interface EffortGroupProps {
  effort: number;
  ftpPct: number;
  labelKey: EffortLabelKey;
  next?: Segment;
  /** Position of the current block; the badge is drawn whenever the group is. */
  position?: Position;
  /** Step inside a stepped ramp; the line is drawn only when count > 1. */
  step?: { index: number; count: number };
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
  /** Optional heart-rate target chip under the effort name. */
  hr?: ReactNode;
  className?: string;
}

/** Group W: the effort ring with its name and % FTP, and the quiet NEXT beside or below it. */
export function EffortGroup({
  effort,
  ftpPct,
  labelKey,
  next,
  position,
  step,
  nextPlacement = 'below',
  glass = false,
  section = false,
  motion = false,
  hr,
  className,
}: EffortGroupProps) {
  const t = useT();
  const ringBoxRef = useRef<HTMLDivElement>(null);
  const [wordInside, setWordInside] = useState(false);
  useLayoutEffect(() => {
    const el = ringBoxRef.current;
    if (!el) return;
    const measure = () => setWordInside(el.getBoundingClientRect().width >= RING_WORD_MIN_PX);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const label = t(`effort.${labelKey}`);
  const knobHint = useKnobHint()(effort);
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
        <div className={styles.ringBox} ref={ringBoxRef} data-testid="effort-ring-box">
          <EffortRing
            effort={effort}
            size="var(--ring, calc(33 * var(--u)))"
            outline={outline}
            numColor="var(--zt)"
            numberTestId="effort-value-number"
            motion={motion}
          />
          {wordInside && (
            <span className={`${hud.lbl} ${styles.inRing}`} data-testid="effort-ring-word">
              {t('training.effort')}
            </span>
          )}
        </div>
        {!wordInside && (
          <div className={`${hud.lbl} ${styles.caption}`} data-testid="effort-caption">
            {t('training.effort')}
          </div>
        )}
        <div
          data-testid="effort-name"
          title={t('training.ftpHint')}
          className={`${hud.lbl} ${styles.name}${wordInside ? ` ${styles.nameLow}` : ''}`}
        >
          {label} · {t('training.ftpApprox', { pct: Math.round(ftpPct) })}
        </div>
        {hr && <div className={styles.hr}>{hr}</div>}
        <div className={styles.posRow}>
          <PositionBadge position={position} />
          {knobHint && (
            <div className={`${hud.lbl} ${styles.step}`} data-testid="knob-line">
              {t('training.knob', { step: knobHint.step, pos: knobHint.position })}
            </div>
          )}
          {step && step.count > 1 && (
            <div className={`${hud.lbl} ${styles.step}`} data-testid="step-line">
              {t('training.step', { n: step.index + 1, total: step.count })}
            </div>
          )}
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
            <div className={`${hud.cap} ${styles.nextPos}`}>
              {t(positionOf(next) === 'standing' ? 'training.standing' : 'training.seated')}
            </div>
            {nextDesc && <div className={`${hud.cap} ${styles.nextDesc}`}>{nextDesc}</div>}
          </>
        ) : (
          <div className={`${hud.big} ${styles.nextTime}`}>{t('training.finish')}</div>
        )}
      </div>
    </div>
  );
}
