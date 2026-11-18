import { Link, NavLink } from 'react-router-dom';
import { LogoMark, ModeIcon, Wordmark, type Mode } from '../brand';
import { useT } from '../i18n';
import styles from './AppBar.module.css';

/** Star glyph for the Experience tab (the world glyph reads as a warning triangle in a nav). */
const STAR = 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z';

/** Top bar of the select screens: logo, Plan | Freestyle | Experience tabs, Players and Settings links. */
export function AppBar() {
  const t = useT();
  const tab =
    (mode: Mode) =>
    ({ isActive }: { isActive: boolean }): string =>
      `${styles.tab} ${styles[mode]} ${isActive ? styles.on : ''}`;
  return (
    <header className={styles.bar}>
      <Link to="/" className={styles.logo} title={t('nav.mainMenu')}>
        <LogoMark size={30} />
        <Wordmark />
      </Link>
      <nav className={styles.tabs}>
        <NavLink to="/plan" className={tab('plan')}>
          <ModeIcon mode="plan" />
          {t('nav.plan')}
        </NavLink>
        <NavLink to="/freestyle" className={tab('free')}>
          <ModeIcon mode="free" />
          {t('nav.freestyle')}
        </NavLink>
        <NavLink to="/experiences" className={tab('world')} data-testid="nav-experience">
          <ModeIcon mode="world" glyph={STAR} />
          {t('nav.experience')}
        </NavLink>
      </nav>
      <div className={styles.sp} />
      <Link to="/editor/new" className={styles.ico}>
        <span aria-hidden="true">✎</span> <span className={styles.lbl}>{t('nav.editor')}</span>
      </Link>
      <Link to="/players" className={styles.ico}>
        <span aria-hidden="true">👥</span> <span className={styles.lbl}>{t('nav.players')}</span>
      </Link>
      <Link to="/settings" className={styles.ico}>
        <span aria-hidden="true">⚙</span> <span className={styles.lbl}>{t('nav.settings')}</span>
      </Link>
    </header>
  );
}
