import type { CSSProperties } from 'react';
import { effortRow } from '../../../domain/effort';
import type { Segment } from '../../../domain/segments';
import { useT } from '../../i18n';
import { formatClock } from '../format';
import styles from './Timeline.module.css';

export interface TimelineProps {
  segments: readonly Segment[];
  elapsedSec: number;
}

const MAX_EFFORT = 10;
const EDGE = '3px';

/** Clip a bar (full height = its taller end) to the slope from `from` to `to` (efforts 1..10). */
function slopePolygons(from: number, to: number): { fill: string; edge: string } {
  const top = Math.max(from, to);
  const yFrom = (1 - from / top) * 100;
  const yTo = (1 - to / top) * 100;
  return {
    fill: `polygon(0 ${yFrom}%, 100% ${yTo}%, 100% 100%, 0 100%)`,
    edge: `polygon(0 ${yFrom}%, 100% ${yTo}%, 100% calc(${yTo}% + ${EDGE}), 0 calc(${yFrom}% + ${EDGE}))`,
  };
}

type BarState = 'past' | 'current' | 'future';

export function Timeline({ segments, elapsedSec }: TimelineProps) {
  const t = useT();
  const total = segments.reduce((sum, s) => sum + s.durationSec, 0);
  const clamped = Math.min(Math.max(elapsedSec, 0), total);
  const cursorPct = total > 0 ? (clamped / total) * 100 : 0;

  return (
    <div data-testid="timeline" className={styles.root}>
      <div className={styles.track}>
        <div className={styles.bars}>
          {segments.map((s) => {
            const end = s.startSec + s.durationSec;
            const state: BarState =
              end <= elapsedSec ? 'past' : s.startSec <= elapsedSec ? 'current' : 'future';
            const topLevel = s.effortStart >= s.effortEnd ? s.effortStart : s.effortEnd;
            const poly = slopePolygons(s.effortStart, s.effortEnd);
            const style: CSSProperties & Record<'--c', string> = {
              '--c': effortRow(topLevel).color,
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
        <div data-cursor className={styles.cursor} style={{ left: `${cursorPct}%` }} />
      </div>
      <div className={styles.meta}>
        <span>
          {t('training.elapsedOf', {
            elapsed: formatClock(Math.floor(clamped)),
            total: formatClock(total),
          })}
        </span>
        <span>{t('training.remaining', { time: formatClock(total - clamped) })}</span>
      </div>
    </div>
  );
}
