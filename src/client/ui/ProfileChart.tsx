import type { CSSProperties } from 'react';
import { effortRow } from '../../domain/effort';
import type { Segment } from '../../domain/segments';
import styles from './ProfileChart.module.css';

export interface ProfileChartProps {
  segments: readonly Segment[];
  /** Height in px, or any CSS length. */
  height: number | string;
  /** Seconds already ridden; bars that end before it are dimmed. */
  pastSec?: number;
  /** Thicker top edge, used on the large hero charts. */
  thick?: boolean;
}

const MAX_EFFORT = 10;

/** Clip a bar (full height = its taller end) to the slope from `from` to `to` (efforts 1..10). */
export function slopePolygons(
  from: number,
  to: number,
  edge = '3px',
): { fill: string; edge: string } {
  const top = Math.max(from, to);
  const yFrom = (1 - from / top) * 100;
  const yTo = (1 - to / top) * 100;
  return {
    fill: `polygon(0 ${yFrom}%, 100% ${yTo}%, 100% 100%, 0 100%)`,
    edge: `polygon(0 ${yFrom}%, 100% ${yTo}%, 100% calc(${yTo}% + ${edge}), 0 calc(${yFrom}% + ${edge}))`,
  };
}

/** Contour profile of a workout: one glowing bar per segment, colored by its top effort. */
export function ProfileChart({ segments, height, pastSec = 0, thick = false }: ProfileChartProps) {
  const edgeSize = thick ? '3px' : '2px';
  return (
    <div
      data-testid="profile-chart"
      role="img"
      aria-hidden="true"
      className={styles.chart}
      style={{ height: typeof height === 'number' ? `${height}px` : height }}
    >
      {segments.map((s) => {
        const topLevel = s.effortStart >= s.effortEnd ? s.effortStart : s.effortEnd;
        const poly = slopePolygons(s.effortStart, s.effortEnd, edgeSize);
        const past = s.startSec + s.durationSec <= pastSec;
        const style: CSSProperties & Record<'--c', string> = {
          '--c': effortRow(topLevel).color,
          flexGrow: s.durationSec,
          height: `${(topLevel / MAX_EFFORT) * 100}%`,
        };
        return (
          <div
            key={s.index}
            data-bar
            data-past={past}
            className={`${styles.bar} ${past ? styles.past : ''}`}
            style={style}
          >
            <b className={styles.fill} style={{ clipPath: poly.fill }} />
            <b className={styles.edge} style={{ clipPath: poly.edge }} />
          </div>
        );
      })}
    </div>
  );
}
