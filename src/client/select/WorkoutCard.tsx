import { memo, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { flattenWorkout } from '../../domain/segments';
import type { Workout } from '../../domain/workout';
import { duplicateAndSave } from '../editor/duplicate';
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
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const name = localizedText(workout, lang).name;
  const duplicate = async (): Promise<void> => {
    setBusy(true);
    try {
      const copy = await duplicateAndSave(workout, lang, t('editor.copySuffix'));
      void navigate(`/editor/${encodeURIComponent(copy.id)}`);
    } catch (err) {
      console.warn('Duplicating failed', err);
      setBusy(false);
    }
  };
  const segments = useMemo(
    () => flattenWorkout(workout, settings.effortTable),
    [workout, settings.effortTable],
  );
  return (
    <div className={styles.wrap}>
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
        <h3 className={styles.name}>{name}</h3>
        <ProfileChart segments={segments} height="3.75rem" />
      </Link>
      {workout.source.kind === 'user' && (
        <Link
          to={`/editor/${encodeURIComponent(workout.id)}`}
          className={`${styles.dup} ${styles.edit}`}
          aria-label={`${t('editor.edit')}: ${name}`}
          title={t('editor.edit')}
        >
          ✎
        </Link>
      )}
      <button
        type="button"
        className={styles.dup}
        disabled={busy}
        aria-label={`${t('editor.duplicate')}: ${name}`}
        title={t('editor.duplicate')}
        onClick={() => void duplicate()}
      >
        ⧉
      </button>
    </div>
  );
});
