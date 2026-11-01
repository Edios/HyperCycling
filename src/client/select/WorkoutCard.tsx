import { memo, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { flattenWorkout } from '../../domain/segments';
import type { Workout } from '../../domain/workout';
import { localizedText } from '../data/localized';
import { useSettings } from '../data/useSettings';
import { useLang, useT } from '../i18n';
import { ProfileChart } from '../ui/ProfileChart';
import { minutesOf, primaryTag, tagKey } from './model';
import styles from './WorkoutCard.module.css';

/** Freestyle grid card: tag, minutes, name and contour profile; the whole card opens setup. */
export const WorkoutCard = memo(function WorkoutCard({ workout }: { workout: Workout }) {
  const t = useT();
  const [lang] = useLang();
  const { settings } = useSettings();
  const segments = useMemo(
    () => flattenWorkout(workout, settings.effortTable),
    [workout, settings.effortTable],
  );
  return (
    <Link
      to={`/setup/${encodeURIComponent(workout.id)}`}
      className={styles.card}
      data-testid="workout-card"
    >
      <div className={styles.top}>
        <span className={styles.tag}>{t(tagKey(primaryTag(workout)))}</span>
        <span className={styles.min}>
          {minutesOf(workout)}
          <small> {t('common.min')}</small>
        </span>
      </div>
      <h3 className={styles.name}>{localizedText(workout, lang).name}</h3>
      <ProfileChart segments={segments} height="3.75rem" />
    </Link>
  );
});
