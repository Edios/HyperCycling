import { resolveResistanceMode } from '../../domain/settings';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { flattenWorkout } from '../../domain/segments';
import type { Workout } from '../../domain/workout';
import { localizedText } from '../data/localized';
import { useSettings } from '../data/useSettings';
import { duplicateAndSave } from '../editor/duplicate';
import { useLang, useT } from '../i18n';
import { ClassCard } from '../class/ClassCard';
import { Modal } from '../ui/Modal';
import { ProfileChart } from '../ui/ProfileChart';
import { difficultyOf, minutesOf, musicHintsOf, primaryTag, tagKey } from './model';
import { DifficultyTicks } from './WorkoutList';
import styles from './WorkoutPreview.module.css';

const ICON = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Preview of the selected workout: big profile, description, music hints and the actions. */
export function WorkoutPreview({
  workout,
  onClose,
}: {
  workout: Workout;
  /** Set when shown as a bottom sheet; adds a grip and a close button. */
  onClose?: () => void;
}) {
  const t = useT();
  const [lang] = useLang();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState(false);
  const { name, description } = localizedText(workout, lang);
  const segments = useMemo(
    () => flattenWorkout(workout, settings.effortTable, resolveResistanceMode(settings)),
    [workout, settings],
  );
  const minutes = minutesOf(workout);
  const hints = musicHintsOf(workout);
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
  return (
    <div className={styles.pv} data-testid="workout-preview">
      {onClose && <div className={styles.grip} aria-hidden="true" />}
      <div className={styles.titleRow}>
        <h2 className={styles.nm}>{name}</h2>
        {onClose && (
          <button
            type="button"
            className={styles.close}
            aria-label={t('free.closePreview')}
            onClick={onClose}
          >
            ×
          </button>
        )}
      </div>
      <div className={styles.meta}>
        <span>
          {minutes} {t('common.min')}
        </span>
        <span>{t(tagKey(primaryTag(workout)))}</span>
        <DifficultyTicks value={difficultyOf(segments)} />
      </div>
      <div className={styles.big}>
        <ProfileChart segments={segments} height="100%" thick />
      </div>
      <div className={styles.axis} aria-hidden="true">
        <span>0</span>
        <span>
          {Math.round(minutes / 2)} {t('common.min')}
        </span>
        <span>{minutes}</span>
      </div>
      {description.trim() !== '' && <p className={styles.desc}>{description}</p>}
      {hints.length > 0 && (
        <p className={styles.music}>
          <span>{t('free.musicHint')}</span> {hints.join(', ')}
        </p>
      )}
      {(workout.songs?.length ?? 0) > 0 && (
        <button
          type="button"
          className={styles.cardBtn}
          data-testid="open-class-card"
          onClick={() => setCard(true)}
        >
          {t('card.open')}
        </button>
      )}
      {card && (
        <Modal title={t('card.title')} onClose={() => setCard(false)}>
          <ClassCard workout={workout} lang={lang} table={settings.effortTable} name={name} />
          <button type="button" className={styles.cardBtn} onClick={() => window.print()}>
            {t('card.print')}
          </button>
        </Modal>
      )}
      <div className={styles.actions}>
        <Link
          to={`/setup/${encodeURIComponent(workout.id)}`}
          className={styles.ride}
          data-testid="workout-ride"
        >
          {t('free.ride')}
        </Link>
        {workout.source.kind === 'user' && (
          <Link
            to={`/editor/${encodeURIComponent(workout.id)}`}
            className={styles.ib}
            aria-label={`${t('editor.edit')}: ${name}`}
            title={t('editor.edit')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...ICON}>
              <path d="M4 20l1-4L16 5l3 3L8 19z" />
            </svg>
          </Link>
        )}
        <button
          type="button"
          className={styles.ib}
          disabled={busy}
          aria-label={`${t('editor.duplicateAndEdit')}: ${name}`}
          title={t('editor.duplicateAndEdit')}
          onClick={() => void duplicate()}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...ICON}>
            <rect x="8" y="8" width="12" height="12" rx="2" />
            <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
