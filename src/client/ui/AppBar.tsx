import { useRef } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { LogoMark, ModeIcon, Wordmark, type Mode } from '../brand';
import { toggleDiagnostics } from '../diagnostics/GlobalDiagnostics';
import { createTapCounter } from '../diagnostics/toggle';
import { GuideIcon } from '../guide/GuideIcons';
import { useT } from '../i18n';
import styles from './AppBar.module.css';
import { Icon } from './Icon';

/** Top bar of the select screens: logo, Plan | Freestyle | Experience tabs, Players and Settings links. */
export function AppBar() {
  const t = useT();
  // Five quick taps on the logo switch diagnostics mode (the phone way to reach it anywhere).
  const tap = useRef(createTapCounter());
  const tab =
    (mode: Mode) =>
    ({ isActive }: { isActive: boolean }): string =>
      `${styles.tab} ${styles[mode]} ${isActive ? styles.on : ''}`;
  return (
    <header className={styles.bar}>
      <Link
        to="/"
        className={styles.logo}
        title={t('nav.mainMenu')}
        data-testid="app-logo"
        onClick={() => {
          if (tap.current(performance.now())) toggleDiagnostics();
        }}
      >
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
          <ModeIcon mode="world" />
          {t('nav.experience')}
        </NavLink>
      </nav>
      <div className={styles.sp} />
      <Link to="/editor/new" className={styles.ico}>
        <Icon name="edit" /> <span className={styles.lbl}>{t('nav.editor')}</span>
      </Link>
      <Link to="/players" className={styles.ico}>
        <Icon name="players" /> <span className={styles.lbl}>{t('nav.players')}</span>
      </Link>
      <Link to="/settings" className={styles.ico}>
        <Icon name="settings" /> <span className={styles.lbl}>{t('nav.settings')}</span>
      </Link>
      <NavLink to="/how-it-works" className={styles.ico} data-testid="nav-how-it-works">
        <GuideIcon name="help" /> <span className={styles.lbl}>{t('guide.menu')}</span>
      </NavLink>
    </header>
  );
}
