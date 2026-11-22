import type { CSSProperties } from 'react';
import { effortRow, type EffortLevel } from '../../../domain/effort';
import type { Segment } from '../../../domain/segments';
import { useT } from '../../i18n';
import { formatClock } from '../format';
import { slopePolygons, stairPolygons } from '../../ui/ProfileChart';
import hud from './hud.module.css';
import styles from './Timeline.module.css';

export interface TimelineProps {
  segments: readonly Segment[];
  elapsedSec: number;
  /** Zero-based index of the current block, for the "block n of m" caption. */
  blockIndex?: number;
  /** Workout name, first in the caption. */
  title?: string;
  /** Thin floor (Minimal): the caption keeps only the block and the time left. */
  mini?: boolean;
  className?: string;
}

const MAX_EFFORT = 10;
/** Gap between bars, the same as `.bars` in Timeline.module.css. */
const BAR_GAP_PX = 2;
type BarState = 'past' | 'current' | 'future';

/** Group P, the floor: workout name, block n of m, elapsed and remaining, and the whole timeline. */
export function Timeline({
  segments,
  elapsedSec,
  blockIndex,
  title,
  mini = false,
  className,
}: TimelineProps) {
  const t = useT();
  const total = segments.reduce((sum, s) => sum + s.durationSec, 0);
  const safeElapsed = Number.isFinite(elapsedSec) ? elapsedSec : 0;
  const clamped = Math.min(Math.max(safeElapsed, 0), total);
  // The bars are separated by gaps and share only the width left after them, so the playhead
  // follows the same layout (the gaps before its bar plus its share of the rest). A plain
  // percentage of the whole width drifts off the bars, worse with many short blocks.
  const frac = total > 0 ? clamped / total : 0;
  const barIdx = Math.max(
    0,
    segments.findLastIndex((s) => s.startSec <= clamped),
  );
  const cursorLeft = `calc(${barIdx * BAR_GAP_PX}px + ${frac} * (100% - ${Math.max(0, segments.length - 1) * BAR_GAP_PX}px))`;
  const blockText =
    blockIndex === undefined
      ? undefined
      : t('training.blockOf', { n: blockIndex + 1, total: segments.length });
  const sep = <span className={styles.sep} aria-hidden="true" />;

  return (
    <div
      data-testid="timeline"
      data-g="P"
      data-mini={mini || undefined}
      className={`${hud.sec} ${styles.root}${className ? ` ${className}` : ''}`}
    >
      <div className={styles.meta}>
        {!mini && title ? <b className={styles.title}>{title}</b> : <span />}
        <span className={styles.facts}>
          {blockText !== undefined && (
            <>
              <span data-testid="block-counter">{blockText}</span>
              {sep}
            </>
          )}
          {!mini && (
            <>
              <span>
                {t('training.elapsedOf', {
                  elapsed: formatClock(Math.floor(clamped)),
                  total: formatClock(total),
                })}
              </span>
              {sep}
            </>
          )}
          <span>{t('training.remaining', { time: formatClock(total - clamped) })}</span>
        </span>
      </div>
      <div className={styles.track}>
        <div className={styles.bars}>
          {segments.map((s) => {
            const end = s.startSec + s.durationSec;
            const state: BarState =
              end <= safeElapsed ? 'past' : s.startSec <= safeElapsed ? 'current' : 'future';
            const stepped = s.steps && s.steps.length > 1 ? s.steps : undefined;
            const topLevel = stepped
              ? Math.max(...stepped.map((x) => x.effort))
              : s.effortStart >= s.effortEnd
                ? s.effortStart
                : s.effortEnd;
            const poly = stepped
              ? stairPolygons(stepped, s.durationSec, topLevel)
              : slopePolygons(s.effortStart, s.effortEnd);
            const zone = effortRow(topLevel as EffortLevel).color;
            const style: CSSProperties & Record<'--c', string> = {
              '--c': zone,
              flexGrow: s.durationSec,
              height: `${(topLevel / MAX_EFFORT) * 100}%`,
            };
            return (
              <div
                key={s.index}
                data-state={state}
                className={`${styles.bar} ${state === 'future' ? '' : styles[state]}`}
                style={style}
              >
                <b data-fill className={styles.fill} style={{ clipPath: poly.fill }} />
                <b className={styles.edge} style={{ clipPath: poly.edge }} />
              </div>
            );
          })}
        </div>
        <div data-cursor className={styles.cursor} style={{ left: cursorLeft }} />
      </div>
    </div>
  );
}
