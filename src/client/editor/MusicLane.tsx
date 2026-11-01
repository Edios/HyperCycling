import { useMemo } from 'react';
import type { EffortTable } from '../../domain/effort';
import { flattenWorkout } from '../../domain/segments';
import type { Workout } from '../../domain/workout';
import { useT } from '../i18n';
import { formatClock } from '../training/format';
import { findBlock } from './model';
import styles from './MusicLane.module.css';

export interface MusicLaneProps {
  workout: Workout;
  selectedId: string | undefined;
  table: EffortTable;
  readOnly: boolean;
  /** A pill or the "pin" placeholder was clicked: select the block and open its track field. */
  onPick: (blockId: string) => void;
}

interface Pill {
  key: string;
  blockId: string;
  left: number;
  width: number;
  label: string;
  pinned: boolean;
}

/** Row of music cues above the timeline; each pill spans from its cue to the next one. */
export function MusicLane({ workout, selectedId, table, readOnly, onPick }: MusicLaneProps) {
  const t = useT();
  const pills = useMemo<Pill[]>(() => {
    const segments = flattenWorkout(workout, table);
    const total = segments.reduce((s, x) => s + x.durationSec, 0);
    if (total === 0) return [];
    const starts = workout.musicCues
      .map((cue) => {
        const seg = segments.find((s) => s.blockId === cue.blockId && s.rep === cue.rep);
        return seg ? { cue, start: seg.startSec } : undefined;
      })
      .filter((x): x is NonNullable<typeof x> => x !== undefined)
      .sort((a, b) => a.start - b.start);
    const out: Pill[] = starts.map(({ cue, start }, i) => {
      const end = starts[i + 1]?.start ?? total;
      const provider = cue.track.provider === 'spotify' ? 'Spotify' : 'YouTube';
      return {
        key: `${cue.blockId}:${cue.rep}`,
        blockId: cue.blockId,
        left: (start / total) * 100,
        width: ((end - start) / total) * 100,
        label: `${cue.track.notEmbeddable ? '⚠' : '♫'} ${cue.track.title ? `${cue.track.title} · ` : ''}${provider} · ${t('editor.pillFrom', { time: formatClock(cue.track.startAtSec) })}`,
        pinned: true,
      };
    });
    const sel = findBlock(workout, selectedId);
    if (!readOnly && sel) {
      const firstId = sel.kind === 'repeat' ? sel.blocks[0]?.id : sel.id;
      const seg = segments.find((s) => s.blockId === firstId && s.rep === 1);
      const taken = workout.musicCues.some((c) => c.blockId === firstId && c.rep === 1);
      if (seg && firstId && !taken) {
        const next = starts.find((s) => s.start > seg.startSec)?.start ?? total;
        out.push({
          key: `pin:${firstId}`,
          blockId: firstId,
          left: (seg.startSec / total) * 100,
          width: Math.max(((next - seg.startSec) / total) * 100, 12),
          label: t('editor.pinTrack'),
          pinned: false,
        });
      }
    }
    return out;
  }, [workout, selectedId, table, readOnly, t]);

  return (
    <div className={styles.lane} data-testid="music-lane">
      {pills.map((p) => (
        <button
          key={p.key}
          type="button"
          data-testid={p.pinned ? 'music-pill' : 'music-pin'}
          className={`${styles.pill} ${p.pinned ? '' : styles.ghost}`}
          style={{ left: `${p.left}%`, width: `calc(${Math.min(p.width, 100 - p.left)}% - 4px)` }}
          disabled={readOnly && !p.pinned}
          onClick={() => onPick(p.blockId)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
