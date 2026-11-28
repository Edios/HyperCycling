import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { nextSession } from '../../domain/plan';
import { type Mode } from '../brand';
import { useT, type MessageKey } from '../i18n';
import { useActivePlan } from '../select/useActivePlan';
import { ModeIcon } from '../brand';
import { NewDot } from '../guide/NewDot';
import { HomeArt } from './HomeArt';
import styles from './Home.module.css';

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev';

type TileMode = Exclude<Mode, 'coach'>;

const TILES: readonly { id: 'plan' | 'free' | 'experience'; mode: TileMode; to: string }[] = [
  { id: 'plan', mode: 'plan', to: '/plan' },
  { id: 'free', mode: 'free', to: '/freestyle' },
  { id: 'experience', mode: 'world', to: '/experiences' },
];

/** Start page: a short introduction and three big, differently coloured ways to ride. */
export function Home() {
  const t = useT();
  const active = useActivePlan();
  const next = useMemo(
    () => (active.state === 'ready' ? nextSession(active.plan, active.progress) : null),
    [active],
  );
  const weeks = active.state === 'ready' ? active.plan.weeks.length : 0;

  return (
    <div className={styles.home} data-testid="home">
      <section className={styles.intro} data-testid="home-hero">
        <h1>{t('home.title')}</h1>
        <p>{t('home.intro')}</p>
      </section>
      <div className={styles.tiles} role="group" aria-label={t('home.dockLabel')}>
        {TILES.map(({ id, mode, to }) => (
          <Link key={id} to={to} className={styles.tile} data-tile={id} data-mode={mode}>
            <HomeArt mode={mode as Exclude<Mode, 'coach'>} />
            <span className={styles.inner}>
              <span className={styles.eyebrow}>
                {id === 'plan' && next
                  ? t('home.planNext', { week: next.week, weeks })
                  : t(`home.${id}Eyebrow` as MessageKey)}
              </span>
              <span className={styles.name}>
                <ModeIcon mode={mode} size={26} />
                <b>{t(`home.${id}` as MessageKey)}</b>
              </span>
              {id === 'experience' && (
                <span className={styles.tagline}>{t('experience.tagline')}</span>
              )}
              <span className={styles.body}>{t(`home.${id}Body` as MessageKey)}</span>
            </span>
          </Link>
        ))}
      </div>
      <footer className={styles.footer} data-testid="home-footer">
        <p className={styles.footerInfo}>{t('home.footerInfo')}</p>
        <nav className={styles.footerLinks} aria-label={t('home.footerInfo')}>
          <a href="https://github.com/Edios/HyperCycling" target="_blank" rel="noopener">
            {t('home.footerGithub')}
          </a>
          <Link to="/settings?section=about">{t('home.footerPrivacy')}</Link>
          <Link to="/settings?section=about">{t('home.footerAbout')}</Link>
          <span>
            <Link to="/whats-new" data-testid="footer-whats-new">
              {t('whatsNew.footer', { version: APP_VERSION })}
            </Link>
            <NewDot />
          </span>
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
