import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_PLAN_SETTINGS } from '../../domain/plan';
import { scaleForPlan } from '../../domain/scale';
import { flattenWorkout } from '../../domain/segments';
import { isActiveSessionFresh, type ActiveSession } from '../../domain/session-log';
import { builtinWorkouts } from '../data/builtin';
import { localizedText } from '../data/localized';
import { getRepositories } from '../data/repositories';
import { useSettings } from '../data/useSettings';
import { useLang, useT } from '../i18n';
import { formatClock } from '../training/format';
import { useSessionStore, type SessionRuntime } from '../training/session-store';
import { Button } from '../ui/Button';
import { ProfileChart } from '../ui/ProfileChart';
import { buildRuntime, pickPlayers, snapshotFits, totalSec } from './model';
import styles from './ResumePrompt.module.css';

interface Pending {
  runtime: SessionRuntime;
  active: ActiveSession;
  minutesAgo: number;
}

async function clearActive(): Promise<void> {
  try {
    const repos = await getRepositories();
    await repos.activeSession.clear();
  } catch (err) {
    console.warn('Clearing the interrupted session failed', err);
  }
}

/**
 * Once per app start: offers to continue a session that was interrupted at most two hours ago.
 * Stale records, or ones whose workout no longer exists, are removed without asking.
 */
export function ResumePrompt() {
  const t = useT();
  const [lang] = useLang();
  const navigate = useNavigate();
  const { settings, loaded } = useSettings();
  const effortTable = useRef(settings.effortTable);
  useEffect(() => {
    effortTable.current = settings.effortTable;
  });
  const [pending, setPending] = useState<Pending | undefined>();
  // Never replace a session that is already on screen.
  const sessionOpen = useSessionStore((s) => s.runtime !== undefined);

  // Once a session is on screen the offer is obsolete for good: drop it, so it cannot resurface
  // when that session is cleared again (e.g. Leave without saving).
  useEffect(() => {
    if (sessionOpen) setPending(undefined);
  }, [sessionOpen]);

  useEffect(() => {
    if (!loaded) return undefined;
    let live = true;
    void (async () => {
      try {
        const repos = await getRepositories();
        const active = await repos.activeSession.get();
        if (!active || !live) return;
        const now = new Date();
        const stored =
          builtinWorkouts.find((w) => w.id === active.workoutId) ??
          (await repos.workouts.get(active.workoutId));
        // The session carries its own workout copy, so a deleted original must not discard it.
        const workout = active.workout ?? stored;
        if (!workout || !isActiveSessionFresh(active, now.toISOString())) {
          await clearActive();
          return;
        }
        let ridden = active.workout ?? workout;
        if (!active.workout && stored && active.plan) {
          // Older records carry no workout: rebuild it from the plan's stored settings.
          const progress = await repos.planProgress.get(active.plan.planId);
          const ps = progress?.settings ?? DEFAULT_PLAN_SETTINGS;
          try {
            ridden = scaleForPlan(stored, ps);
          } catch (err) {
            console.warn('Rebuilding the interrupted workout failed', err);
            await clearActive();
            return;
          }
        }
        const segments = flattenWorkout(ridden, effortTable.current);
        if (!snapshotFits(segments, active.snapshot)) {
          await clearActive();
          return;
        }
        const players = pickPlayers(await repos.players.list(), active.config.playerIds);
        const playerIds = players.map((p) => p.id);
        const config = {
          ...active.config,
          playerIds,
          ...(playerIds.length === 0 && active.config.hud === 'players'
            ? { hud: 'solo' as const }
            : {}),
        };
        if (!live || useSessionStore.getState().runtime) return;
        setPending({
          runtime: buildRuntime(ridden, segments, config, players, active.plan),
          active,
          minutesAgo: Math.max(
            0,
            Math.round((now.getTime() - Date.parse(active.savedAt)) / 60_000),
          ),
        });
      } catch (err) {
        console.warn('Checking for an interrupted session failed', err);
      }
    })();
    return () => {
      live = false;
    };
  }, [loaded]);

  if (!pending || sessionOpen) return null;
  const { runtime, active, minutesAgo } = pending;
  const total = totalSec(runtime.segments);
  const snap = active.snapshot;

  const resume = (): void => {
    useSessionStore.getState().load(runtime, snap);
    setPending(undefined);
    navigate('/train');
  };
  const discard = (): void => {
    setPending(undefined);
    void clearActive();
  };

  return (
    <div className={styles.backdrop}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-title"
        data-testid="resume-prompt"
        className={styles.panel}
      >
        <h2 id="resume-title">{t('resume.title')}</h2>
        <p className={styles.mut}>
          {t('resume.body', {
            name: localizedText(runtime.workout, lang).name,
            minutes: minutesAgo,
          })}
        </p>
        <div className={styles.chart}>
          <ProfileChart
            segments={runtime.segments}
            height="5rem"
            thick
            pastSec={snap.workoutElapsedSec}
          />
        </div>
        <div className={`${styles.row} ${styles.mut}`}>
          <span data-testid="resume-progress">
            {t('resume.progress', {
              n: snap.segmentIndex + 1,
              total: runtime.segments.length,
              elapsed: formatClock(snap.workoutElapsedSec, { round: 'floor' }),
              duration: formatClock(total),
            })}
          </span>
          <span>{t('resume.paused')}</span>
        </div>
        <div className={styles.actions}>
          <Button onClick={discard}>{t('resume.discard')}</Button>
          <Button variant="primary" autoFocus onClick={resume}>
            {t('resume.resume')}
          </Button>
        </div>
      </div>
    </div>
  );
}
