import { Link, NavLink } from 'react-router-dom';
import { useT } from '../i18n';
import styles from './AppBar.module.css';

/** Top bar of the select screens: logo, Plan | Freestyle tabs, Players and Settings links. */
export function AppBar() {
  const t = useT();
  const tab = ({ isActive }: { isActive: boolean }): string =>
    `${styles.tab} ${isActive ? styles.on : ''}`;
  return (
    <header className={styles.bar}>
      <Link to="/" className={styles.logo}>
        <i aria-hidden="true" />
        {t('app.title')}
      </Link>
      <nav className={styles.tabs}>
        <NavLink to="/" end className={tab}>
          {t('nav.plan')}
        </NavLink>
        <NavLink to="/freestyle" className={tab}>
          {t('nav.freestyle')}
        </NavLink>
      </nav>
      <div className={styles.sp} />
      <Link to="/players" className={styles.ico}>
        <span aria-hidden="true">👥</span> {t('nav.players')}
      </Link>
      <Link to="/settings" className={styles.ico}>
        <span aria-hidden="true">⚙</span> {t('nav.settings')}
      </Link>
    </header>
  );
}
