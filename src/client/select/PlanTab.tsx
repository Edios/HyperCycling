import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  nextSession,
  weekStatus,
  type Plan,
  type PlanProgress,
  type PlanSlot,
} from '../../domain/plan';
import { flattenWorkout } from '../../domain/segments';
import { scaleForPlan } from '../../domain/scale';
import type { Workout } from '../../domain/workout';
import { localizedText } from '../data/localized';
import { useLibrary } from '../data/useLibrary';
import { useSettings } from '../data/useSettings';
import { useLang, useT } from '../i18n';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ProfileChart } from '../ui/ProfileChart';
import { effectiveSession } from '../plans/effective-session';
import { minutesOf } from './model';
import { SwapModal } from './SwapModal';
import { useActivePlan, useLastSession } from './useActivePlan';
import styles from './PlanTab.module.css';

const SLOTS: readonly PlanSlot[] = ['progres', 'freestyle'];
const MARK = { done: '✓', skipped: '–', open: '○' } as const;

function setupUrl(
  workoutId: string,
  planId: string,
  week: number,
  slot: PlanSlot,
  cycle: number,
): string {
  const cyclePart = cycle > 1 ? `&cycle=${cycle}` : '';
  return `/setup/${encodeURIComponent(workoutId)}?plan=${encodeURIComponent(planId)}&week=${week}&slot=${slot}${cyclePart}`;
}

/** Plan tab: active plan header, next session hero card and the weeks list. */
export function PlanTab() {
  const active = useActivePlan();
  if (active.state === 'loading') return <div className={styles.page} aria-busy="true" />;
  if (active.state === 'none') return <Welcome />;
  return <ActivePlanView plan={active.plan} progress={active.progress} />;
}

/** First-run screen: three ways to start instead of an empty plan. */
function Welcome() {
  const t = useT();
  return (
    <div className={styles.welcome} data-testid="plan-empty">
      <h1>{t('welcome.title')}</h1>
      <p className={styles.welcomeLead}>{t('welcome.lead')}</p>
      <div className={styles.paths}>
        <Link to="/plans/wizard" className={`${styles.path} ${styles.pathMain}`}>
          <b>{t('plan.build')}</b>
          <span>{t('welcome.buildBody')}</span>
        </Link>
        <Link to="/plans" className={styles.path}>
          <b>{t('welcome.browse')}</b>
          <span>{t('welcome.browseBody')}</span>
        </Link>
        <Link to="/freestyle" className={styles.path}>
          <b>{t('welcome.ride')}</b>
          <span>{t('welcome.rideBody')}</span>
        </Link>
        <div className={`${styles.path} ${styles.pathSoon}`} data-testid="welcome-experience">
          <b>{t('welcome.experience')}</b>
          <span>{t('welcome.experienceBody')}</span>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  const t = useT();
  return (
    <div className={styles.empty} data-testid="plan-complete">
      <h1>{t('plan.complete')}</h1>
      <p>{t('plan.completeBody')}</p>
      <Link to="/plans" className={styles.cta}>
        {t('plan.choose')}
      </Link>
    </div>
  );
}

function ActivePlanView({ plan, progress }: { plan: Plan; progress: PlanProgress }) {
  const t = useT();
  const [lang] = useLang();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { workouts, loaded: libraryLoaded } = useLibrary();
  const last = useLastSession();
  const [swapping, setSwapping] = useState(false);

  const byId = useMemo(() => new Map(workouts.map((w) => [w.id, w])), [workouts]);
  const equipment = settings.equipment;
  const next = useMemo(() => {
    const n = nextSession(plan, progress);
    if (!n) return n;
    const workoutId = effectiveSession(
      plan,
      n.week,
      n.slot,
      equipment,
      progress.settings.layout,
      progress.settings.skipFirstTest,
      n.cycle,
    );
    return { ...n, workoutId: workoutId ?? n.workoutId };
  }, [plan, progress, equipment]);
  const planText = localizedText(plan, lang);

  const counts = useMemo(() => {
    let done = 0;
    let total = 0;
    for (let week = 1; week <= plan.weeks.length; week++) {
      const st = weekStatus(plan, progress, week);
      for (const slot of SLOTS) {
        // Weeks without a session in this slot (or layout) are not sessions at all.
        const id = effectiveSession(
          plan,
          week,
          slot,
          equipment,
          progress.settings.layout,
          progress.settings.skipFirstTest,
          next?.cycle,
        );
        if (id === undefined) continue;
        total++;
        if (st[slot] !== 'open') done++;
      }
    }
    return { done, total };
  }, [plan, progress, equipment, next]);

  const perWeek = Math.max(...plan.weeks.map((w) => w.sessions.length));
  const minutes = progress.settings.sessionMinutes;
  const currentWeek = next?.week;

  const nextWorkout = next ? byId.get(next.workoutId) : undefined;
  const scaled = useMemo<Workout | undefined>(() => {
    if (!nextWorkout) return undefined;
    try {
      return scaleForPlan(nextWorkout, progress.settings);
    } catch (err) {
      console.warn('Scaling the next session failed, showing it unscaled', err);
      return nextWorkout;
    }
  }, [nextWorkout, progress.settings]);
  const segments = useMemo(
    () => (scaled ? flattenWorkout(scaled, settings.effortTable) : []),
    [scaled, settings.effortTable],
  );

  const lastWorkout = last ? byId.get(last.workoutId) : undefined;
  const lastDay = last
    ? new Intl.DateTimeFormat(lang, { weekday: 'long' }).format(new Date(last.endedAt))
    : '';

  const swapOptions = useMemo<Workout[]>(() => {
    if (!next) return [];
    if (next.slot === 'freestyle') {
      return workouts.filter((w) => w.category === 'freestyle' && w.id !== next.workoutId);
    }
    const alt = plan.weeks[next.week - 1]?.progresAlt;
    const altWorkout = alt !== undefined && alt !== next.workoutId ? byId.get(alt) : undefined;
    return altWorkout ? [altWorkout] : [];
  }, [next, plan, workouts, byId]);

  if (!libraryLoaded) return <div className={styles.page} aria-busy="true" />;

  const pct = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;

  return (
    <div className={styles.page}>
      <div className={styles.main}>
        <div className={styles.head}>
          <div>
            <h1>{planText.name}</h1>
            <div className={styles.mut}>
              {t('plan.summary', { weeks: plan.weeks.length, perWeek, minutes })}
            </div>
          </div>
          <div className={styles.progress}>
            <div data-testid="plan-done" className={styles.count}>
              <b>{counts.done}</b> <span>{t('plan.doneOf', { total: counts.total })}</span>
            </div>
            <div className={styles.bar} role="presentation">
              <div style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>

        {next === null ? (
          <EmptyState />
        ) : (
          <Card hero className={styles.next} data-testid="next-session">
            <div className={styles.mut}>{t('plan.next', { week: next.week })}</div>
            {nextWorkout && scaled ? (
              <>
                <div className={styles.titleRow}>
                  <div>
                    <span
                      className={`${styles.badge} ${next.slot === 'progres' ? styles.progres : styles.freestyle}`}
                    >
                      {t(next.slot === 'progres' ? 'tag.progres' : 'tag.freestyle')}
                    </span>
                    <h2>{localizedText(nextWorkout, lang).name}</h2>
                    <p className={styles.mut}>{localizedText(nextWorkout, lang).description}</p>
                  </div>
                  <div className={styles.big}>
                    {minutesOf(scaled)}
                    <small> {t('common.min')}</small>
                  </div>
                </div>
                <div className={styles.chart}>
                  <ProfileChart segments={segments} height="7.5rem" thick />
                </div>
              </>
            ) : (
              <p className={styles.mut}>{t('plan.missing')}</p>
            )}
            <div className={styles.foot}>
              <div className={styles.mut}>
                {last && lastWorkout
                  ? t('plan.last', {
                      kind: t(lastWorkout.category === 'progres' ? 'tag.progres' : 'tag.freestyle'),
                      name: localizedText(lastWorkout, lang).name,
                      day: lastDay,
                    })
                  : ''}
              </div>
              <div className={styles.buttons}>
                {swapOptions.length === 0 && (
                  <span className={styles.mut} data-testid="swap-hint">
                    {t('plan.swapNone')}
                  </span>
                )}
                <Button disabled={swapOptions.length === 0} onClick={() => setSwapping(true)}>
                  {t('plan.swap')}
                </Button>
                <Button
                  variant="primary"
                  size="big"
                  disabled={!nextWorkout}
                  onClick={() =>
                    navigate(setupUrl(next.workoutId, plan.id, next.week, next.slot, next.cycle))
                  }
                >
                  {t('plan.ride')}
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>

      <Card className={styles.weeks}>
        <div className={styles.weeksHead}>
          <h3>{t('plan.weeksTitle')}</h3>
          <Link to="/plans" className={styles.mutLink}>
            {t('plan.changePlan')}
          </Link>
        </div>
        <ol data-testid="weeks-list" className={styles.weekList}>
          {plan.weeks.map((_, i) => {
            const week = i + 1;
            const st = weekStatus(plan, progress, week);
            return (
              <li
                key={week}
                data-testid={`week-${week}`}
                aria-current={week === currentWeek ? 'step' : undefined}
                className={`${styles.week} ${week === currentWeek ? styles.current : ''}`}
              >
                <span className={styles.weekNo}>{t('plan.weekShort', { n: week })}</span>
                {SLOTS.map((slot) => {
                  const id = effectiveSession(
                    plan,
                    week,
                    slot,
                    equipment,
                    progress.settings.layout,
                    progress.settings.skipFirstTest,
                    next?.cycle,
                  );
                  const w = id === undefined ? undefined : byId.get(id);
                  return (
                    <span
                      key={slot}
                      data-testid={`week-${week}-${slot}`}
                      data-status={st[slot]}
                      title={w ? localizedText(w, lang).name : undefined}
                      className={`${styles.slot} ${styles[st[slot]] ?? ''}`}
                    >
                      <span aria-hidden="true" className={styles.mark}>
                        {MARK[st[slot]]}
                      </span>
                      {w ? localizedText(w, lang).name : ''}
                      <span className={styles.sr}>
                        {' '}
                        (
                        {t(
                          st[slot] === 'done'
                            ? 'plan.statusDone'
                            : st[slot] === 'skipped'
                              ? 'plan.statusSkipped'
                              : 'plan.statusOpen',
                        )}
                        )
                      </span>
                    </span>
                  );
                })}
              </li>
            );
          })}
        </ol>
      </Card>

      {swapping && next && (
        <SwapModal
          title={next.slot === 'freestyle' ? t('plan.swapTitle') : t('plan.swapProgres')}
          options={swapOptions}
          onClose={() => setSwapping(false)}
          onPick={(w) => navigate(setupUrl(w.id, plan.id, next.week, next.slot, next.cycle))}
        />
      )}
    </div>
  );
}
