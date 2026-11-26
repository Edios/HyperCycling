import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { resolveResistanceMode } from '../../domain/settings';
import { flattenWorkout } from '../../domain/segments';
import { MUSIC_CATEGORIES, sectionsOf } from '../../domain/soundtrack';
import type { CatalogTrack } from '../../domain/soundtrack-catalog';
import { youtubeTrack } from '../../domain/music-chain';
import type { PlanPick, SoundtrackPlan, SoundtrackPrefs } from '../../domain/soundtrack-plan';
import {
  categoryChips,
  makePlan,
  MIN_WIZARD_SEC,
  planSummary,
  replaceSong,
  shufflePlan,
  toggleCategory,
  wizardPlanKey,
} from '../../domain/soundtrack-wizard';
import { totalDurationSec, type Workout } from '../../domain/workout';
import { localizedText } from '../data/localized';
import { useLibrary } from '../data/useLibrary';
import { useSettings } from '../data/useSettings';
import { useLang, useT } from '../i18n';
import { MusicPlayerDock } from '../music/MusicPlayerDock';
import { useMusicPlayerShown } from '../music/useMusicPlayerShown';
import { formatClock } from '../training/format';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { ProfileChart } from '../ui/ProfileChart';
import { Segmented } from '../ui/Segmented';
import { OwnTracksPanel } from './OwnTracksPanel';
import { useOwnTracks } from './own-tracks';
import { PartCard } from './PartCard';
import { freshSeed, historyIds, loadSoundtrackHistory } from './history';
import { loadSoundtrackPrefs, saveSoundtrackPrefs } from './prefs';
import { confirmPlan, useSoundtrackSession } from './session';
import { useSoundtrackCatalog } from './useCatalog';
import { usePreview } from './usePreview';
import styles from './SoundtrackWizard.module.css';

type Step = 1 | 2 | 3;

/** Route `/soundtrack/:workoutId` (query `from=setup|select`): the "Match music" wizard. */
export function SoundtrackWizard() {
  const { workoutId = '' } = useParams();
  const [params] = useSearchParams();
  const { workouts, loaded } = useLibrary();
  const { loaded: settingsLoaded } = useSettings();
  const scaled = useSoundtrackSession((s) => s.workouts[workoutId]);
  const workout = scaled ?? workouts.find((w) => w.id === workoutId);
  if (!workout && loaded) return <Navigate to="/" replace />;
  if (!workout || !settingsLoaded) return <div className={styles.page} aria-busy="true" />;
  return <Wizard key={workout.id} workout={workout} from={params.get('from')} />;
}

function Wizard({ workout, from }: { workout: Workout; from: string | null }) {
  const t = useT();
  const [lang] = useLang();
  const navigate = useNavigate();
  const { settings, updateSettings } = useSettings();
  const catalogState = useSoundtrackCatalog();
  const preview = usePreview();
  const playerShown = useMusicPlayerShown();

  const totalSec = totalDurationSec(workout);
  const tooShort = totalSec < MIN_WIZARD_SEC;
  const sections = useMemo(() => sectionsOf(workout), [workout]);
  const segments = useMemo(
    () => flattenWorkout(workout, settings.effortTable, resolveResistanceMode(settings)),
    [workout, settings],
  );
  const catalog = catalogState.catalog;
  const ready = catalogState.status === 'ready';
  const byId = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);
  const sectionById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);

  const [step, setStep] = useState<Step>(1);
  // A new opening draws a new seed (spec §3b); a workout with a saved plan keeps that plan's seed,
  // so the same choices give the same songs again.
  const savedSeed = useSoundtrackSession((s) => s.plans[workout.id]?.prefs.seed);
  const [prefs, setPrefs] = useState<SoundtrackPrefs>(() => ({
    ...loadSoundtrackPrefs(),
    seed: savedSeed ?? freshSeed(),
  }));
  // The songs of the last confirmed rides (newest first): they step back in the new plans.
  const history = useMemo(() => historyIds(loadSoundtrackHistory()), []);
  const [plan, setPlan] = useState<SoundtrackPlan | undefined>();
  const [locked, setLocked] = useState<ReadonlySet<string>>(() => new Set());
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  // What the plan on screen was made for: another choice in step 1 plans again.
  const plannedFor = useRef('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const partsRef = useRef<HTMLDivElement>(null);

  const { chips, best } = useMemo(() => categoryChips(sections, catalog), [sections, catalog]);
  const summary = useMemo(() => (plan ? planSummary(plan) : undefined), [plan]);
  const { name } = localizedText(workout, lang);

  // The heading of a new step takes the focus (screen readers announce where they are).
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const leave = useCallback((): void => {
    preview.stop();
    if (from === 'setup') navigate(`/setup/${encodeURIComponent(workout.id)}`);
    else if (from === 'select') navigate(-1);
    else navigate('/');
  }, [from, navigate, preview, workout.id]);

  // Escape leaves (nothing is lost: the plan is only taken over by "Done"); the arrows walk the
  // stretches of the ride in step 2.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [role="dialog"]')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        leave();
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && step === 2) {
        const cards = [...(partsRef.current?.querySelectorAll<HTMLElement>('article') ?? [])];
        if (cards.length === 0) return;
        const at = cards.findIndex((c) => c.contains(document.activeElement));
        const next =
          e.key === 'ArrowDown' ? Math.min(cards.length - 1, at + 1) : Math.max(0, at - 1);
        if (target?.closest('button') && at >= 0 && at === next) return;
        e.preventDefault();
        cards[next < 0 ? 0 : next]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [leave, step]);

  const changePrefs = (patch: Partial<SoundtrackPrefs>): void => {
    setPrefs((p) => ({ ...p, ...patch }));
  };

  const ownTracks = useOwnTracks((s) => s.tracks);
  const planKey = (p: SoundtrackPrefs): string => wizardPlanKey(p, ownTracks);

  const goPlan = (): void => {
    saveSoundtrackPrefs(prefs);
    const key = planKey(prefs);
    if (!plan || plannedFor.current !== key) {
      const fresh = new Set<string>();
      setLocked(fresh);
      setExcluded(fresh);
      setPlan(
        makePlan(
          workout,
          catalog,
          prefs,
          { locked: fresh, excluded: fresh },
          undefined,
          sections,
          history,
        ),
      );
      plannedFor.current = key;
    }
    setStep(2);
  };

  const shuffle = (): void => {
    if (!plan) return;
    preview.stop();
    const out = shufflePlan(workout, catalog, prefs, { locked, excluded }, plan, sections, history);
    setPrefs(out.prefs);
    saveSoundtrackPrefs(out.prefs);
    setPlan(out.plan);
  };

  const replace = (sectionId: string, songId: string): void => {
    if (!plan) return;
    preview.stop();
    const out = replaceSong(
      workout,
      catalog,
      prefs,
      { locked, excluded },
      plan,
      sectionId,
      songId,
      sections,
      history,
    );
    setExcluded(out.excluded);
    setPlan(out.plan);
  };

  const toggleLock = (sectionId: string): void => {
    setLocked((cur) => {
      const next = new Set(cur);
      if (!next.delete(sectionId)) next.add(sectionId);
      return next;
    });
  };

  const playPreview = (key: string, pick: PlanPick, track: CatalogTrack): void => {
    const upload = track.youtube.find((u) => u.id === pick.upload) ?? track.youtube[0];
    if (!upload) return;
    preview.play(key, { ...youtubeTrack(track, upload), startAtSec: pick.startAtSec });
  };

  const finish = (): void => {
    if (!plan) return;
    preview.stop();
    // Taken over at once and written to the device meanwhile; the ride setup says if the write
    // failed (a slow or blocked storage never holds the button).
    void confirmPlan(plan);
    navigate(`/setup/${encodeURIComponent(workout.id)}`);
  };

  const back = (): void => {
    preview.stop();
    if (step === 1) leave();
    else setStep((s) => (s - 1) as Step);
  };

  const stepTitle =
    step === 1
      ? t('soundtrack.chooseTitle')
      : step === 2
        ? t('soundtrack.planTitle')
        : t('soundtrack.doneTitle');
  const bestList = best.map((c) => t(`soundtrack.category.${c}`)).join(', ');
  const previewKeyBySection = (sectionId: string): string | null =>
    preview.now && preview.now.key.startsWith(`${sectionId}:`) ? preview.now.key : null;

  let body: ReactNode;
  if (tooShort) {
    body = <p className={styles.notice}>{t('soundtrack.tooShort')}</p>;
  } else if (catalogState.status === 'error') {
    body = (
      <div className={styles.notice} role="alert">
        <p>{t('soundtrack.loadError')}</p>
        <Button onClick={catalogState.retry}>{t('soundtrack.retry')}</Button>
      </div>
    );
  } else if (!ready) {
    body = (
      <p className={styles.notice} role="status" aria-busy="true">
        {t('soundtrack.loading')}
      </p>
    );
  } else if (step === 1) {
    body = (
      <>
        <div role="group" aria-label={t('soundtrack.categoriesLabel')} className={styles.chips}>
          {MUSIC_CATEGORIES.map((c) => {
            const chip = chips.find((x) => x.category === c);
            const dimmed = chip?.dimmed === true;
            return (
              <Chip
                key={c}
                on={prefs.categories.includes(c)}
                className={`${styles.chip} ${dimmed ? styles.dim : ''}`}
                data-testid={`soundtrack-chip-${c}`}
                data-dimmed={dimmed}
                title={dimmed ? t('soundtrack.categoryDim') : undefined}
                onClick={() => changePrefs({ categories: toggleCategory(prefs.categories, c) })}
              >
                {t(`soundtrack.category.${c}`)}
              </Chip>
            );
          })}
          <Chip
            on={prefs.polish === true}
            className={styles.chip}
            data-testid="soundtrack-chip-polish"
            title={t('soundtrack.polishHint')}
            onClick={() => changePrefs({ polish: prefs.polish !== true })}
          >
            {t('soundtrack.polish')}
          </Chip>
        </div>
        <p className={styles.hint} data-testid="soundtrack-hint">
          {best.length > 0
            ? t('soundtrack.bestHint', { list: bestList })
            : t('soundtrack.noBestHint')}
        </p>
        <div className={styles.continuity}>
          <Segmented
            label={t('soundtrack.continuityLabel')}
            value={prefs.continuity}
            options={[
              { value: 'seamless', label: t('soundtrack.seamless') },
              { value: 'gapsOk', label: t('soundtrack.gapsOk') },
            ]}
            onChange={(continuity) => changePrefs({ continuity })}
          />
          <p className={styles.help}>
            {t(
              prefs.continuity === 'seamless' ? 'soundtrack.seamlessHelp' : 'soundtrack.gapsOkHelp',
            )}
          </p>
        </div>
        <OwnTracksPanel
          use={prefs.includeLibrary}
          onUseChange={(includeLibrary) => changePrefs({ includeLibrary })}
        />
      </>
    );
  } else if (step === 2 && plan && summary) {
    const problems = summary.gapParts + summary.emptyParts;
    body = (
      <>
        {problems > 0 && (
          <p className={styles.banner} role="status" data-testid="soundtrack-warnings">
            {t('soundtrack.warnBanner', { n: problems })}
          </p>
        )}
        <div ref={partsRef} className={styles.parts}>
          {plan.sections.map((planned) => {
            const section = sectionById.get(planned.sectionId);
            if (!section || planned.locked) return null;
            return (
              <PartCard
                key={planned.sectionId}
                planned={planned}
                section={section}
                catalog={byId}
                locked={locked.has(planned.sectionId)}
                previewKey={previewKeyBySection(planned.sectionId)}
                onLock={() => toggleLock(planned.sectionId)}
                onReplace={(songId) => replace(planned.sectionId, songId)}
                onPreview={(pick, track) => {
                  const i = planned.picks.indexOf(pick);
                  playPreview(`${planned.sectionId}:${i}`, pick, track);
                }}
                onStopPreview={preview.stop}
              />
            );
          })}
        </div>
        <p className={styles.help}>{t('soundtrack.previewNote')}</p>
        {history.length > 0 && (
          <p className={styles.help} data-testid="soundtrack-rotation">
            {t('soundtrack.rotation', { n: history.length })}
          </p>
        )}
        {preview.failed && (
          <p className={`${styles.note} ${styles.warn}`} role="status">
            {t('soundtrack.previewFailed')}
          </p>
        )}
      </>
    );
  } else if (step === 3 && plan && summary) {
    body = (
      <div className={styles.done} data-testid="soundtrack-done">
        <p className={styles.summary}>
          {t('soundtrack.doneSummary', {
            songs: summary.songs,
            time: formatClock(summary.durationSec),
          })}
        </p>
        <p className={summary.silenceSec > 0 ? styles.warn : styles.help}>
          {summary.silenceSec > 0
            ? t('soundtrack.doneSilence', { time: formatClock(summary.silenceSec) })
            : t('soundtrack.doneNoGaps')}
        </p>
        {summary.stretchedParts > 0 && (
          <p className={styles.help}>{t('soundtrack.doneStretched')}</p>
        )}
        {summary.offTempoParts > 0 && <p className={styles.warn}>{t('soundtrack.doneOffTempo')}</p>}
        <p className={styles.help}>{t('soundtrack.doneKept')}</p>
      </div>
    );
  }

  const canNext =
    ready &&
    !tooShort &&
    (step !== 2 || (summary?.songs ?? 0) > 0 || prefs.continuity === 'gapsOk');
  const primary =
    step === 1 ? t('soundtrack.next') : step === 2 ? t('soundtrack.next') : t('soundtrack.toRide');
  const onPrimary = step === 1 ? goPlan : step === 2 ? () => setStep(3) : finish;

  return (
    <div className={styles.page} data-testid="soundtrack-wizard" data-step={step} data-mode="free">
      <header className={styles.top}>
        <button
          type="button"
          className={styles.close}
          aria-label={t('soundtrack.close')}
          data-testid="soundtrack-close"
          onClick={leave}
        >
          ←
        </button>
        <h1 className={styles.title}>{t('soundtrack.title')}</h1>
        <span className={styles.stepNo} aria-label={t('soundtrack.stepLabel', { n: step })}>
          {t('soundtrack.stepOf', { n: step })}
        </span>
      </header>
      <div className={styles.layout}>
        <aside className={styles.side} aria-label={name}>
          <p className={styles.workoutName}>{name}</p>
          <div className={styles.profile}>
            <ProfileChart segments={segments} height="100%" />
          </div>
          {step === 2 && plan && (
            <nav className={styles.strip} aria-hidden="true">
              {plan.sections.map((s) => (
                <span
                  key={s.sectionId}
                  className={styles.stripPart}
                  data-role={s.role}
                  style={{ flexGrow: s.durationSec }}
                />
              ))}
            </nav>
          )}
        </aside>
        <main className={styles.main}>
          <h2 ref={headingRef} tabIndex={-1} className={styles.stepTitle}>
            {stepTitle}
          </h2>
          {body}
        </main>
      </div>
      <div className={styles.dock}>
        <MusicPlayerDock
          variant="inline"
          track={preview.now?.track ?? null}
          shown={playerShown}
          slotRef={preview.slotRef}
          onHide={() => void updateSettings({ showMusicPlayer: false })}
        />
      </div>
      <footer className={styles.bar}>
        <Button onClick={back} data-testid="soundtrack-back">
          {t('soundtrack.back')}
        </Button>
        {step === 2 && (
          <Button onClick={shuffle} data-testid="soundtrack-shuffle" disabled={!ready}>
            {t('soundtrack.shuffle')}
          </Button>
        )}
        <Button
          variant="primary"
          onClick={onPrimary}
          disabled={!canNext}
          data-testid="soundtrack-next"
        >
          {primary}
        </Button>
      </footer>
    </div>
  );
}
