import { Link, NavLink } from 'react-router-dom';
import { LogoMark, ModeIcon, Wordmark, type Mode } from '../brand';
import { useT } from '../i18n';
import styles from './AppBar.module.css';

/** Top bar of the select screens: logo, Plan | Freestyle tabs, Players and Settings links. */
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
      </nav>
      <div className={styles.sp} />
      <Link to="/editor/new" className={styles.ico}>
        <span aria-hidden="true">✎</span> {t('nav.editor')}
      </Link>
      <Link to="/players" className={styles.ico}>
        <span aria-hidden="true">👥</span> {t('nav.players')}
      </Link>
      <Link to="/settings" className={styles.ico}>
        <span aria-hidden="true">⚙</span> {t('nav.settings')}
      </Link>
    </header>
  );
}
