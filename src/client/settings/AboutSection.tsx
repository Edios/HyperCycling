import { LogoMark, Wordmark } from '../brand';
import { useT } from '../i18n';
import styles from './Settings.module.css';

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev';

/** Settings → About: the full mark, the name, the version and the font licence. */
export function AboutSection() {
  const t = useT();
  return (
    <div className={styles.about}>
      <LogoMark size={96} />
      <div className={styles.aboutText}>
        <Wordmark className={styles.aboutName} />
        <span className="sr-only">{t('settings.about.name')}</span>
        <p className={styles.lead}>{t('settings.about.tagline')}</p>
        <p className={styles.note} data-testid="about-version">
          {t('settings.about.version', { version: APP_VERSION })}
        </p>
        <p className={styles.note}>{t('settings.about.fonts')}</p>
      </div>
    </div>
  );
}
