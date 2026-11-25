import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DashLine, EffortRing } from '../../brand';
import { useT, type MessageKey } from '../../i18n';
import { positionOf, type Segment } from '../../../domain/segments';
import type { ResistanceCommand } from '../../../domain/coach';
import type { Position } from '../../../domain/workout';
import type { EffortLabelKey } from '../../../domain/effort';
import { translateContentText } from '../content-text';
import { formatClock } from '../format';
import hud from './hud.module.css';
import { ErgControls, type TrainerHud } from './ErgControls';
import { PositionBadge } from './PositionBadge';
import { RangeBar } from './RangeBar';
import { targetBand } from '../../../domain/execution';
import styles from './EffortGroup.module.css';

const COMMAND_KEYS: Record<ResistanceCommand, MessageKey> = {
  add: 'training.resistanceAdd',
  ease: 'training.resistanceEase',
  hold: 'training.resistanceHold',
};

/** The word 'Effort' goes inside the ring only from this ring size (px); below, a caption. */
export const RING_WORD_MIN_PX = 230;

export interface EffortGroupProps {
  effort: number;
  ftpPct: number;
  labelKey: EffortLabelKey;
  next?: Segment;
  /** Position of the current block; the badge is drawn whenever the group is. */
  position?: Position;
  /** Position the next block switches to, set in the last seconds before the change. */
  upcomingPosition?: Position | undefined;
  /** Seconds until that change, for the badge countdown. */
  upcomingInSec?: number | undefined;
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
  /** Knob bikes: what to do with the knob now (relative, never a position). */
  resistanceCommand?: ResistanceCommand;
  /** Show the '~N% FTP' part of the name; off for bikes that do not measure watts. */
  showFtp?: boolean;
  /** Optional heart-rate target chip under the effort name. */
  hr?: ReactNode;
  /**
   * Smart trainer mode: the ring shows the live power (watts in the middle, segments filled to
   * its zone, the block's target outlined) and the ERG chip sits under the name.
   */
  trainer?: TrainerHud;
  className?: string;
}

/** Group W: the effort ring with its name and % FTP, and the quiet NEXT beside or below it. */
export function EffortGroup({
  effort,
  ftpPct,
  labelKey,
  next,
  position,
  upcomingPosition,
  upcomingInSec,
  step,
  nextPlacement = 'below',
  glass = false,
  section = false,
  motion = false,
  resistanceCommand,
  showFtp = true,
  hr,
  trainer,
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
  const word = trainer ? t('training.erg.power') : t('training.effort');
  const name = trainer
    ? [
        t('training.erg.effortShort', { label, effort: Math.round(effort) }),
        trainer.targetW !== null ? t('training.erg.target', { watts: trainer.targetW }) : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : showFtp
      ? `${label} · ${t('training.ftpApprox', { pct: Math.round(ftpPct) })}`
      : label;
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
    <div
      className={classes}
      data-g="W"
      data-testid="effort-group"
      data-trainer={trainer ? 'true' : undefined}
      style={rootStyle}
    >
      <div className={styles.main} data-testid="effort-value" data-variant="overlay">
        <div className={styles.ringBox} ref={ringBoxRef} data-testid="effort-ring-box">
          <EffortRing
            effort={trainer ? trainer.level : effort}
            size="var(--ring, calc(33 * var(--u)))"
            outline={outline}
            numColor="var(--zt)"
            numberTestId={trainer ? 'trainer-power' : 'effort-value-number'}
            motion={motion}
            {...(trainer
              ? {
                  text: trainer.watts === null ? '—' : String(trainer.watts),
                  ...(trainer.targetLevel > 0 ? { marker: trainer.targetLevel } : {}),
                }
              : {})}
          />
          {wordInside && (
            <span className={`${hud.lbl} ${styles.inRing}`} data-testid="effort-ring-word">
              {word}
            </span>
          )}
        </div>
        {!wordInside && (
          <div className={`${hud.lbl} ${styles.caption}`} data-testid="effort-caption">
            {word}
          </div>
        )}
        <div
          data-testid="effort-name"
          title={showFtp && !trainer ? t('training.ftpHint') : undefined}
          className={`${hud.lbl} ${styles.name}${wordInside ? ` ${styles.nameLow}` : ''}`}
        >
          {name}
        </div>
        {trainer && trainer.targetW !== null && trainer.watts !== null && (
          <div className={styles.powerBar}>
            <RangeBar value={trainer.watts} {...targetBand(trainer.targetW)} testId="power-bar" />
            {trainer.blockScore != null && trainer.watts !== null && (
              <div className={`${hud.cap} ${styles.blockScore}`} data-testid="block-score">
                {t('training.exec.live', { score: trainer.blockScore })}
              </div>
            )}
          </div>
        )}
        {hr && <div className={styles.hr}>{hr}</div>}
        <div className={styles.posRow}>
          <PositionBadge position={position} upcoming={upcomingPosition}
            inSec={upcomingInSec}
            reducedMotion={!motion} />
          {trainer && <ErgControls hud={trainer} />}
          {resistanceCommand && (
            <div
              className={`${hud.lbl} ${styles.step}`}
              data-testid="resistance-command"
              data-command={resistanceCommand}
            >
              {t(COMMAND_KEYS[resistanceCommand])}
            </div>
          )}
          {/* ERG rides a stepped ramp smoothly: no step line in trainer mode. */}
          {!trainer && step && step.count > 1 && (
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
