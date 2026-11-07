import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashLine } from '../brand';
import { experienceText, type Experience } from '../../domain/experience';
import { builtinExperiences } from '../data/builtin';
import { useLibrary } from '../data/useLibrary';
import { useLang, useT, type MessageKey } from '../i18n';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { matchesLevel, scenarioRows, type LevelFilter } from './model';
import styles from './ExperiencePicker.module.css';

const FILTERS: readonly LevelFilter[] = ['all', 'easy', 'medium', 'hard'];

export function experienceSetupUrl(e: Experience): string {
  return `/setup/${encodeURIComponent(e.workoutRef.id)}?exp=${encodeURIComponent(e.id)}`;
}

/** Experience catalogue: one card per ready-made ride with a scenario preview and Start. */
export function ExperiencePicker() {
  const t = useT();
  const [lang] = useLang();
  const navigate = useNavigate();
  const { workouts } = useLibrary();
  const [filter, setFilter] = useState<LevelFilter>('all');
  const [open, setOpen] = useState<string | undefined>();

  const visible = useMemo(
    () => builtinExperiences.filter((e) => matchesLevel(e, filter)),
    [filter],
  );

  return (
    <div className={styles.page} data-testid="experience-picker">
      <div className={styles.head}>
        <h1>{t('experience.title')}</h1>
        <div role="group" aria-label={t('experience.filterLabel')} className={styles.chips}>
          {FILTERS.map((f) => (
            <Chip key={f} on={f === filter} onClick={() => setFilter(f)}>
              {t(`experience.filters.${f}` as MessageKey)}
            </Chip>
          ))}
        </div>
      </div>
      <DashLine className={styles.dash} />
      <p className={styles.intro}>{t('experience.intro')}</p>

      <div className={styles.grid}>
        {visible.map((e) => {
          const text = experienceText(e, lang);
          const workout = workouts.find((w) => w.id === e.workoutRef.id);
          const rows = workout ? scenarioRows(workout) : [];
          const expanded = open === e.id;
          return (
            <Card
              key={e.id}
              className={styles.card}
              data-testid="experience-card"
              data-experience={e.id}
            >
              <div className={styles.level}>
                <span>{t(`experience.theme.${e.worldTheme.theme}` as MessageKey)}</span>
                <span>{t(`experience.level.${e.level}` as MessageKey)}</span>
              </div>
              <h2>{text.title}</h2>
              <div className={styles.meta}>
                {t('experience.cardMeta', {
                  minutes: e.lengthMin,
                  steps: e.stepCount,
                  songs: rows.length,
                })}
              </div>
              <p className={styles.desc}>{text.description}</p>
              <ul className={styles.tags}>
                {e.tags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
              {expanded && (
                <ol className={styles.scenario} data-testid="experience-scenario">
                  {rows.map((r, i) => (
                    <li key={r.id}>{t('experience.songRow', { n: i + 1, minutes: r.minutes })}</li>
                  ))}
                </ol>
              )}
              <div className={styles.actions}>
                <Button
                  variant="primary"
                  data-testid="experience-start"
                  onClick={() => navigate(experienceSetupUrl(e))}
                  disabled={!workout}
                >
                  {t('experience.start')}
                </Button>
                <Button
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? undefined : e.id)}
                >
                  {t(expanded ? 'experience.hideScenario' : 'experience.showScenario')}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
