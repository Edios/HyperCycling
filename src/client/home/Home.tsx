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
import { experienceText } from '../../domain/experience';
import { builtinExperiences } from '../data/builtin';
import { experienceSetupUrl } from '../experience/ExperiencePicker';
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
    () =>
      chooseHero({
        tab,
        next,
        lastWorkoutId: last?.workoutId,
        workouts,
        experiences: builtinExperiences,
      }),
    [tab, next, last, workouts],
  );
  const workoutId = hero.kind === 'plan' ? hero.next.workoutId : hero.workoutId;
  const expHero = hero.kind === 'experience' ? hero.experience : undefined;
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
  const workoutText = workout ? localizedText(workout, lang) : undefined;
  const text = expHero
    ? {
        name: experienceText(expHero, lang).title,
        description: experienceText(expHero, lang).description,
      }
    : workoutText && { name: workoutText.name, description: workoutText.description };
  // The accent follows the tile.
  const accentMode = hero.kind === 'free' ? 'free' : hero.kind === 'experience' ? 'coach' : 'plan';

  const kicker =
    hero.kind === 'plan'
      ? t('home.planKicker', { week: hero.next.week, weeks: hero.next.weeks })
      : hero.kind === 'experience'
        ? t('experience.kicker')
        : hero.kind === 'starter'
          ? t('home.starterKicker')
          : t(hero.source === 'last' ? 'home.lastKicker' : 'home.recommendedKicker');
  const minutes = workout ? Math.round(totalDurationSec(workout) / 60) : 0;

  return (
    <div className={styles.home} data-testid="home" data-mode={accentMode}>
      <section className={styles.hero} data-testid="home-hero">
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
                  navigate(
                    expHero
                      ? experienceSetupUrl(expHero)
                      : setupUrl(workout.id, hero.kind === 'plan' ? hero.next : undefined),
                  )
                }
              >
                {t('home.ride')}
              </button>
              {hero.kind === 'experience' ? (
                <Link to="/experiences" className={styles.secondary} data-testid="home-secondary">
                  {t('experience.seeScenario')}
                </Link>
              ) : hero.kind === 'starter' ? (
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
        ) : ready ? (
          <div className={styles.cap} data-testid="home-empty">
            <h1>{t('home.emptyTitle')}</h1>
            <div className={styles.actions}>
              <Link to="/freestyle" className={styles.primary}>
                {t('home.otherWorkout')}
              </Link>
            </div>
          </div>
        ) : (
          <div className={styles.cap} aria-busy="true">
            <p className={styles.kicker}>{t('home.loading')}</p>
          </div>
        )}
      </section>

      <div className={styles.dock} role="group" aria-label={t('home.dockLabel')}>
        {TILES.map(({ id, icon, body }) => {
          const on = tab === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              data-tile={id}
              data-mode={icon}
              className={`${styles.tile} ${on ? styles.on : ''}`}
              onClick={() => setTab(id)}
            >
              <span className={styles.tileHead}>
                <ModeIcon mode={icon} size={20} />
                <b>{t(`home.${id}` as MessageKey)}</b>
              </span>
              <span className={styles.tileBody}>{t(body)}</span>
            </button>
          );
        })}
      </div>
      <footer className={styles.footer} data-testid="home-footer">
        <p className={styles.footerInfo}>{t('home.footerInfo')}</p>
        <nav className={styles.footerLinks} aria-label={t('home.footerInfo')}>
          <a href="https://github.com/Edios/HyperCycling" target="_blank" rel="noopener">
            {t('home.footerGithub')}
          </a>
          <Link to="/settings?section=about">{t('home.footerPrivacy')}</Link>
          <Link to="/settings?section=about">{t('home.footerAbout')}</Link>
        </nav>
        <p className={styles.footerCredit}>
          {t('home.bpmCredit')}{' '}
          <a href="https://getsongbpm.com" target="_blank" rel="noopener">
            {t('home.bpmSource')}
          </a>
          {' · '}
          <a href="https://www.deezer.com" target="_blank" rel="noopener">
            {t('home.bpmSourceDeezer')}
          </a>
        </p>
      </footer>
    </div>
  );
}
