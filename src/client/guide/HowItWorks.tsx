import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ModeIcon, type Mode } from '../brand';
import { useT } from '../i18n';
import { AppBar } from '../ui/AppBar';
import { Icon } from '../ui/Icon';
import { GuideIcon } from './GuideIcons';
import { InstallApp } from '../pwa/InstallApp';
import { NewDot } from './NewDot';
import styles from './HowItWorks.module.css';

const REPO_URL = 'https://github.com/Edios/HyperCycling';

type ModeId = 'plan' | 'free' | 'experience';
const MODES: readonly { id: ModeId; mode: Exclude<Mode, 'coach'> }[] = [
  { id: 'plan', mode: 'plan' },
  { id: 'free', mode: 'free' },
  { id: 'experience', mode: 'world' },
];

type FeatureId = 'coach' | 'editor' | 'music' | 'bike' | 'local' | 'open';
const ICONS: Record<FeatureId, ReactNode> = {
  coach: <ModeIcon mode="coach" size={24} />,
  editor: <Icon name="edit" size={24} />,
  music: <Icon name="music" size={24} />,
  bike: <GuideIcon name="bike" size={24} />,
  local: <GuideIcon name="lock" size={24} />,
  open: <GuideIcon name="code" size={24} />,
};
const FEATURES: readonly FeatureId[] = ['coach', 'editor', 'music', 'bike', 'local', 'open'];

/** The "How it works" page: why the app exists, what it is for and what is inside. */
export function HowItWorks() {
  const t = useT();
  return (
    <div data-testid="how-it-works">
      <AppBar />
      <main className={styles.main}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>{t('guide.eyebrow')}</p>
          <h1>{t('guide.title')}</h1>
          <p className={styles.lead}>{t('guide.lead')}</p>
          <p className={styles.news}>
            <Link to="/whats-new" data-testid="guide-whats-new">
              {t('whatsNew.link')}
            </Link>
            <NewDot />
          </p>
        </header>

        <section className={styles.why}>
          <div>
            <h2>{t('guide.whyTitle')}</h2>
            <p>{t('guide.why')}</p>
          </div>
          <div>
            <h2>{t('guide.goalTitle')}</h2>
            <p>{t('guide.goal')}</p>
          </div>
        </section>

        <section aria-labelledby="guide-modes">
          <h2 id="guide-modes" className={styles.sectionTitle}>
            {t('guide.modesTitle')}
          </h2>
          <ul className={styles.modes}>
            {MODES.map(({ id, mode }) => (
              <li key={id} className={styles.mode} data-mode={mode}>
                <span className={styles.modeHead}>
                  <ModeIcon mode={mode} size={26} />
                  <h3>{t(`guide.${id}.title`)}</h3>
                </span>
                <p>{t(`guide.${id}.body`)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="guide-more">
          <h2 id="guide-more" className={styles.sectionTitle}>
            {t('guide.moreTitle')}
          </h2>
          <ul className={styles.features}>
            {FEATURES.map((id) => (
              <li key={id} className={styles.feature} data-feature={id}>
                <span className={styles.icon}>{ICONS[id]}</span>
                <h3>{t(`guide.${id}.title`)}</h3>
                <p>{t(`guide.${id}.body`)}</p>
                {id === 'open' && (
                  <a href={REPO_URL} target="_blank" rel="noopener" className={styles.link}>
                    {t('guide.open.link')}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="guide-install">
          <h2 id="guide-install" className={styles.sectionTitle}>
            {t('pwa.title')}
          </h2>
          <p>{t('pwa.body')}</p>
          <InstallApp />
        </section>

        <section className={styles.cta}>
          <div>
            <h2>{t('guide.ctaTitle')}</h2>
            <p>{t('guide.ctaBody')}</p>
          </div>
          <Link to="/" className={styles.ctaButton}>
            {t('guide.ctaButton')}
          </Link>
        </section>
      </main>
    </div>
  );
}
