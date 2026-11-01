import type { CSSProperties } from 'react';
import { effortRow } from '../../../domain/effort';
import type { Segment } from '../../../domain/segments';
import { useT } from '../../i18n';
import { formatClock } from '../format';
import { slopePolygons } from '../../ui/ProfileChart';
import styles from './Timeline.module.css';

export interface TimelineProps {
  segments: readonly Segment[];
  elapsedSec: number;
}

const MAX_EFFORT = 10;
type BarState = 'past' | 'current' | 'future';

export function Timeline({ segments, elapsedSec }: TimelineProps) {
  const t = useT();
  const total = segments.reduce((sum, s) => sum + s.durationSec, 0);
  const safeElapsed = Number.isFinite(elapsedSec) ? elapsedSec : 0;
  const clamped = Math.min(Math.max(safeElapsed, 0), total);
  const cursorPct = total > 0 ? (clamped / total) * 100 : 0;

  return (
    <div data-testid="timeline" className={styles.root}>
      <div className={styles.track}>
        <div className={styles.bars}>
          {segments.map((s) => {
            const end = s.startSec + s.durationSec;
            const state: BarState =
              end <= safeElapsed ? 'past' : s.startSec <= safeElapsed ? 'current' : 'future';
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
