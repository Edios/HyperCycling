import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { nextSession } from '../../domain/plan';
import { scaleForPlan } from '../../domain/scale';
import { flattenWorkout } from '../../domain/segments';
import { resolveResistanceMode } from '../../domain/settings';
import { totalDurationSec, type Workout } from '../../domain/workout';
import { ModeIcon } from '../brand';
import { localizedText } from '../data/localized';
import { useLibrary } from '../data/useLibrary';
import { useSettings } from '../data/useSettings';
import { useLang, useT, type MessageKey } from '../i18n';
import { effectiveSession } from '../plans/effective-session';
import { useActivePlan, useLastSession } from '../select/useActivePlan';
import { chooseHero, ringZones, type HomeTab, type PlanNext } from './model';
import { Tunnel } from './Tunnel';
import styles from './Home.module.css';

const TILES: readonly { id: HomeTab; icon: 'plan' | 'free' | 'coach'; body: MessageKey }[] = [
  { id: 'plan', icon: 'plan', body: 'home.planBody' },
  { id: 'free', icon: 'free', body: 'home.freeBody' },
  { id: 'experience', icon: 'coach', body: 'home.experienceBody' },
];

function setupUrl(workoutId: string, next?: PlanNext): string {
  const base = `/setup/${encodeURIComponent(workoutId)}`;
  if (!next) return base;
  const cycle = next.cycle > 1 ? `&cycle=${next.cycle}` : '';
  return `${base}?plan=${encodeURIComponent(next.planId)}&week=${next.week}&slot=${next.slot}${cycle}`;
}

/** Start page: a full-width hero (what to ride now) above a dock of the three ways to ride. */
export function Home() {
  const t = useT();
  const [lang] = useLang();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { workouts, loaded } = useLibrary();
  const active = useActivePlan();
  const last = useLastSession();
  const [tab, setTab] = useState<HomeTab>('plan');

  const next = useMemo<PlanNext | null>(() => {
    if (active.state !== 'ready') return null;
    const { plan, progress } = active;
    const n = nextSession(plan, progress);
    if (!n) return null;
    const workoutId =
      effectiveSession(
        plan,
        n.week,
        n.slot,
        settings.equipment,
        progress.settings.layout,
        progress.settings.skipFirstTest,
        n.cycle,
      ) ?? n.workoutId;
    return {
      planId: plan.id,
      week: n.week,
      weeks: plan.weeks.length,
      slot: n.slot,
      cycle: n.cycle,
      workoutId,
    };
  }, [active, settings.equipment]);

  const hero = useMemo(
    () => chooseHero({ tab, next, lastWorkoutId: last?.workoutId, workouts }),
    [tab, next, last, workouts],
  );
  const workoutId = hero.kind === 'plan' ? hero.next.workoutId : hero.workoutId;
  const workout: Workout | undefined = workouts.find((w) => w.id === workoutId);

  const zones = useMemo(() => {
    if (!workout) return [];
    let shown = workout;
    if (hero.kind === 'plan' && active.state === 'ready') {
      try {
        shown = scaleForPlan(workout, active.progress.settings);
      } catch {
        shown = workout;
      }
    }
    return ringZones(flattenWorkout(shown, settings.effortTable, resolveResistanceMode(settings)));
  }, [workout, hero.kind, active, settings]);

  const ready = loaded && active.state !== 'loading';
  const text = workout ? localizedText(workout, lang) : undefined;
  // The accent follows the tile; Experience has no hero of its own, so it shows the Plan one.
  const accentMode = hero.kind === 'free' ? 'free' : 'plan';

  const kicker =
    hero.kind === 'plan'
      ? t('home.planKicker', { week: hero.next.week, weeks: hero.next.weeks })
      : hero.kind === 'starter'
        ? t('home.starterKicker')
        : t(hero.source === 'last' ? 'home.lastKicker' : 'home.recommendedKicker');
  const minutes = workout ? Math.round(totalDurationSec(workout) / 60) : 0;

  return (
    <div className={styles.home} data-testid="home" data-mode={accentMode}>
      <section className={styles.hero} aria-live="polite" data-testid="home-hero">
        <Tunnel zones={zones} />
        {ready && workout && text ? (
          <div className={styles.cap} data-kind={hero.kind}>
            <p className={styles.kicker} data-testid="home-kicker">
              {kicker}
            </p>
            <h1>{text.name}</h1>
            <p className={styles.lead}>
              {text.description} {t('home.minutes', { minutes })}
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                data-testid="home-ride"
                onClick={() =>
                  navigate(setupUrl(workout.id, hero.kind === 'plan' ? hero.next : undefined))
                }
              >
                {t('home.ride')}
              </button>
              {hero.kind === 'starter' ? (
                <Link to="/plans/wizard" className={styles.secondary} data-testid="home-secondary">
                  {t('home.buildPlan')}
                </Link>
              ) : (
                <Link
                  to={hero.kind === 'plan' ? '/plan' : '/freestyle'}
                  className={styles.secondary}
                  data-testid="home-secondary"
                >
                  {t(hero.kind === 'plan' ? 'home.changeWorkout' : 'home.otherWorkout')}
                </Link>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.cap} aria-busy="true">
            <p className={styles.kicker}>{t('home.loading')}</p>
          </div>
        )}
      </section>

      <div className={styles.dock} role="tablist" aria-label={t('home.dockLabel')}>
        {TILES.map(({ id, icon, body }) => {
          const soon = id === 'experience';
          const on = !soon && tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              disabled={soon}
              data-tile={id}
              data-mode={icon}
              className={`${styles.tile} ${on ? styles.on : ''}`}
              onClick={() => setTab(id)}
            >
              <span className={styles.tileHead}>
                <ModeIcon mode={icon} size={20} />
                <b>{t(`home.${id}` as MessageKey)}</b>
                {soon && <span className={styles.soon}>{t('home.soon')}</span>}
              </span>
              <span className={styles.tileBody}>{t(body)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
