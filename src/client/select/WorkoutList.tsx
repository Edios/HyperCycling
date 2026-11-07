import { resolveResistanceMode } from '../../domain/settings';
import { memo, useMemo, type KeyboardEvent } from 'react';
import { flattenWorkout } from '../../domain/segments';
import type { Workout } from '../../domain/workout';
import { localizedText } from '../data/localized';
import { useSettings } from '../data/useSettings';
import { useLang, useT } from '../i18n';
import { ProfileChart } from '../ui/ProfileChart';
import { difficultyOf, minutesOf, primaryTag, tagKey } from './model';
import styles from './WorkoutList.module.css';

/** Ten ticks, the first `value` lit. */
export function DifficultyTicks({ value }: { value: number }) {
  const t = useT();
  return (
    <span className={styles.ticks} role="img" aria-label={t('free.difficulty', { n: value })}>
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < value ? styles.tickOn : undefined} />
      ))}
    </span>
  );
}

export const WorkoutRow = memo(function WorkoutRow({
  workout,
  selected,
  onSelect,
}: {
  workout: Workout;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const [lang] = useLang();
  const { settings } = useSettings();
  const name = localizedText(workout, lang).name;
  const segments = useMemo(
    () => flattenWorkout(workout, settings.effortTable, resolveResistanceMode(settings)),
    [workout, settings],
  );
  const difficulty = useMemo(() => difficultyOf(segments), [segments]);
  return (
    <div
      role="option"
      id={`wk-${workout.id}`}
      aria-selected={selected}
      data-testid="workout-card"
      data-selected={selected}
      className={`${styles.row} ${selected ? styles.sel : ''}`}
      onClick={() => onSelect(workout.id)}
    >
      <div className={styles.head}>
        <span className={styles.name}>
          {name}
          {workout.source.kind === 'user' && (
            <span className={styles.badge} data-testid="mine-badge">
              {t('free.mineBadge')}
            </span>
          )}
        </span>
        <span className={styles.cat}>{t(tagKey(primaryTag(workout)))}</span>
      </div>
      <div className={styles.strip}>
        <ProfileChart segments={segments} height="1.5rem" />
      </div>
      <DifficultyTicks value={difficulty} />
      <span className={styles.dur}>
        {minutesOf(workout)} {t('common.min')}
      </span>
    </div>
  );
});

/** Hairline-separated list of workouts; focus stays on the listbox and the active row follows. */
export function WorkoutList({
  workouts,
  activeId,
  onSelect,
  onKeyDown,
}: {
  workouts: readonly Workout[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const t = useT();
  return (
    <div
      role="listbox"
      tabIndex={0}
      aria-label={t('free.listLabel')}
      aria-activedescendant={activeId === null ? undefined : `wk-${activeId}`}
      className={styles.list}
      onKeyDown={onKeyDown}
    >
      {workouts.map((w) => (
        <WorkoutRow key={w.id} workout={w} selected={w.id === activeId} onSelect={onSelect} />
      ))}
    </div>
  );
}
