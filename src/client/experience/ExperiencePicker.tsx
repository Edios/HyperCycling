import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { flattenWorkout } from '../../domain/segments';
import { experienceText, type Experience } from '../../domain/experience';
import { builtinExperiences } from '../data/builtin';
import { useLibrary } from '../data/useLibrary';
import { useSettings } from '../data/useSettings';
import { useLang, useT, type MessageKey } from '../i18n';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { Icon } from '../ui/Icon';
import { ProfileChart } from '../ui/ProfileChart';
import { Segmented } from '../ui/Segmented';
import { useMediaQuery } from '../training/useMediaQuery';
import {
  defaultVariant,
  effortRange,
  groupSeries,
  matchesLevel,
  scenarioRows,
  variantLabel,
  type ExperienceSeries,
  type LevelFilter,
} from './model';
import { useSongsLabel } from './useSongsLabel';
import styles from './ExperiencePicker.module.css';

const FILTERS: readonly LevelFilter[] = ['all', 'easy', 'medium', 'hard'];
/** From this width a card shows its scenario beside it. */
const WIDE = '(min-width: 64rem)';

export function experienceSetupUrl(e: Experience): string {
  return `/setup/${encodeURIComponent(e.workoutRef.id)}?exp=${encodeURIComponent(e.id)}`;
}

/** Experience catalogue: one card per world (its variants one tap apart), with a scenario preview. */
export function ExperiencePicker() {
  const t = useT();
  const [filter, setFilter] = useState<LevelFilter>('all');

  const visible = useMemo(
    () =>
      groupSeries(builtinExperiences).filter((s) =>
        s.variants.some((e) => matchesLevel(e, filter)),
      ),
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
      <p className={styles.intro}>{t('experience.intro')}</p>

      <div className={styles.grid}>
        {visible.map((s) => (
          <SeriesCard key={s.key} series={s} filter={filter} />
        ))}
      </div>
    </div>
  );
}

function SeriesCard({ series, filter }: { series: ExperienceSeries; filter: LevelFilter }) {
  const t = useT();
  const [lang] = useLang();
  const navigate = useNavigate();
  const songsLabel = useSongsLabel();
  const { workouts } = useLibrary();
  const { settings } = useSettings();
  const [pickedId, setPickedId] = useState<string | undefined>();
  const [expanded, setExpanded] = useState(false);
  // Wide screens: the card and its scenario side by side, the scenario always shown (like the
  // Freestyle preview); narrow screens keep the toggle.
  const wide = useMediaQuery(WIDE);
  const showScenario = wide || expanded;

  const e = series.variants.find((v) => v.id === pickedId) ?? defaultVariant(series, filter);
  const text = experienceText(e, lang);
  const seriesTitle = series.theme
    ? t(`experience.theme.${series.theme}` as MessageKey)
    : text.title;
  const workout = workouts.find((w) => w.id === e.workoutRef.id);
  const rows = workout ? scenarioRows(workout, e, settings.effortTable) : [];
  const range = workout ? effortRange(workout, settings.effortTable) : undefined;
  const segments = workout ? flattenWorkout(workout, settings.effortTable) : [];
  const heading = `${e.lengthMin} ${t('common.min')}${range ? ` · ${songsLabel(rows.length)} · ${t('experience.peak', { n: range.max })}` : ''}`;

  return (
    <Card
      className={`${styles.card} ${wide ? styles.wide : ''}`}
      data-testid="experience-card"
      data-experience={e.id}
    >
      <div className={styles.main}>
        <p className={styles.kicker}>
          {series.theme
            ? t('experience.seriesKicker', { title: seriesTitle })
            : t('experience.kicker')}
        </p>
        <h2>{seriesTitle}</h2>
        {series.variants.length > 1 && (
          <div className={styles.variants}>
            <Segmented
              label={t('experience.variantLabel')}
              value={e.id}
              options={series.variants.map((v) => ({
                value: v.id,
                label: variantLabel(experienceText(v, lang).title, seriesTitle, t('common.min')),
              }))}
              onChange={(id) => {
                setPickedId(id);
                setExpanded(false);
              }}
            />
          </div>
        )}
        <p className={styles.desc}>{text.description}</p>
        {segments.length > 0 && (
          <div className={styles.chart} aria-hidden="true">
            <ProfileChart segments={segments} height="3.25rem" />
          </div>
        )}
        <ul className={styles.facts}>
          <li>{t(`experience.level.${e.level}` as MessageKey)}</li>
          {range && <li>{t('experience.cardEffort', { ...range })}</li>}
          <li>{songsLabel(rows.length)}</li>
        </ul>
        <div className={styles.actions}>
          <Button
            variant="primary"
            data-testid="experience-start"
            onClick={() => navigate(experienceSetupUrl(e))}
            disabled={!workout}
          >
            <Icon name="play" size={18} />
            {t('experience.start')}
          </Button>
          {!wide && (
            <Button variant="text" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              {t(expanded ? 'experience.hideScenario' : 'experience.showScenario')}
            </Button>
          )}
        </div>
      </div>
      {showScenario && (
        <section className={styles.scenarioBox} aria-label={t('experience.scenarioTitle')}>
          <h3 className={styles.scenarioHead}>{t('experience.scenarioTitle')}</h3>
          <p className={styles.scenarioSum} data-testid="experience-scenario-summary">
            {heading}
          </p>
          <ol className={styles.scenario} data-testid="experience-scenario">
            {rows.map((r, i) => {
              const song = r.title ? (r.artist ? `${r.artist} – ${r.title}` : r.title) : undefined;
              const effort =
                r.minEffort === r.maxEffort ? String(r.maxEffort) : `${r.minEffort}–${r.maxEffort}`;
              return (
                <li key={r.id} className={styles.slot}>
                  <span className={styles.slotNum}>{i + 1}</span>
                  <span className={styles.slotMain}>
                    <span className={styles.slotTitle}>
                      {r.look
                        ? t(`experience.looks.${r.look}` as MessageKey)
                        : t('experience.slotUnnamed', { n: i + 1 })}
                    </span>
                    <span className={styles.slotSub}>
                      <Icon name="music" size={13} />
                      <span className={styles.slotSong} title={song}>
                        {song ?? t('experience.noSong')}
                      </span>
                    </span>
                  </span>
                  <span className={styles.slotBar} aria-hidden="true">
                    <span
                      style={{
                        width: `${Math.max(10, r.maxEffort * 10)}%`,
                        background: `var(--z${Math.min(10, Math.max(1, r.maxEffort))})`,
                      }}
                    />
                  </span>
                  <span className={styles.srOnly}>{t('experience.slotEffort', { effort })}</span>
                  <span className={styles.slotTime} data-testid="scenario-time">
                    {r.time}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </Card>
  );
}
