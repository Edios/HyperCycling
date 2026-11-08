import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DashLine } from '../brand';
import { useSettings } from '../data/useSettings';
import { useT, type MessageKey } from '../i18n';
import { AppBar } from '../ui/AppBar';
import { AboutSection } from './AboutSection';
import { DataSection } from './DataSection';
import { DiagnosticsSection } from './DiagnosticsSection';
import { EquipmentSection } from './EquipmentSection';
import { GeneralSection } from './GeneralSection';
import { MusicSection } from './MusicSection';
import { SaveProvider } from './save';
import { pickActiveSection } from './scroll-spy';
import { TrainingSection } from './TrainingSection';
import { ZonesSection } from './ZonesSection';
import styles from './Settings.module.css';

/** One titled block of the settings screen. */
export function SettingsSection({
  id,
  titleKey,
  children,
}: {
  id: string;
  titleKey: MessageKey;
  children: ReactNode;
}) {
  const t = useT();
  const headingId = `settings-${id}-title`;
  return (
    <section
      id={`settings-section-${id}`}
      className={styles.section}
      aria-labelledby={headingId}
      data-testid={`settings-${id}`}
    >
      <h2 id={headingId} className={styles.sectionTitle}>
        {t(titleKey)}
      </h2>
      {children}
    </section>
  );
}

const SECTIONS: readonly {
  id: string;
  titleKey: MessageKey;
  navKey: MessageKey;
  body: ReactNode;
}[] = [
  {
    id: 'general',
    titleKey: 'settings.general.title',
    navKey: 'settings.nav.general',
    body: <GeneralSection />,
  },
  {
    id: 'equipment',
    titleKey: 'settings.equipment.title',
    navKey: 'settings.nav.equipment',
    body: <EquipmentSection />,
  },
  {
    id: 'training',
    titleKey: 'settings.training.title',
    navKey: 'settings.nav.training',
    body: <TrainingSection />,
  },
  {
    id: 'zones',
    titleKey: 'settings.zones.title',
    navKey: 'settings.nav.zones',
    body: <ZonesSection />,
  },
  {
    id: 'music',
    titleKey: 'settings.music.title',
    navKey: 'settings.nav.music',
    body: <MusicSection />,
  },
  {
    id: 'data',
    titleKey: 'settings.data.title',
    navKey: 'settings.nav.data',
    body: <DataSection />,
  },
  {
    id: 'diagnostics',
    titleKey: 'diagnostics.title',
    navKey: 'settings.nav.diagnostics',
    body: <DiagnosticsSection />,
  },
  {
    id: 'about',
    titleKey: 'settings.about.title',
    navKey: 'settings.nav.about',
    body: <AboutSection />,
  },
];

/** The section the reader is in, for the nav highlight (scroll position, see scroll-spy). */
function useActiveSection(ready: boolean): [string, (id: string) => void] {
  const [active, setActive] = useState(SECTIONS[0]?.id ?? 'general');
  const lockUntil = useRef(0);
  useEffect(() => {
    if (!ready) return undefined;
    const update = (): void => {
      // Right after a nav click the smooth scroll passes other sections: keep the clicked one.
      if (Date.now() < lockUntil.current) return;
      const tops = SECTIONS.flatMap((s) => {
        const el = document.getElementById(`settings-section-${s.id}`);
        return el ? [{ id: s.id, top: el.getBoundingClientRect().top }] : [];
      });
      const atBottom =
        window.scrollY > 0 &&
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      const id = pickActiveSection(tops, window.innerHeight, atBottom);
      if (id) setActive(id);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [ready]);
  const choose = useCallback((id: string) => {
    lockUntil.current = Date.now() + 800;
    setActive(id);
  }, []);
  return [active, choose];
}

/** Route /settings: a section list beside (or above) the sections; every control saves at once. */
export function SettingsScreen() {
  const t = useT();
  const { loaded } = useSettings();
  const [active, setActive] = useActiveSection(loaded);
  const [params] = useSearchParams();
  const wanted = params.get('section');
  useEffect(() => {
    if (!loaded || !wanted) return;
    document.getElementById(`settings-section-${wanted}`)?.scrollIntoView?.({ block: 'start' });
  }, [loaded, wanted]);
  const goTo = (id: string): void => {
    setActive(id);
    document.getElementById(`settings-section-${id}`)?.scrollIntoView?.({ block: 'start' });
  };
  return (
    <div data-testid="settings-screen">
      <AppBar />
      <main className={styles.main}>
        <h1 className={styles.title}>{t('settings.title')}</h1>
        <DashLine />
        <div className={styles.layout}>
          <nav className={styles.nav} aria-label={t('settings.sections')}>
            <ul>
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`${styles.navItem} ${active === s.id ? styles.navOn : ''}`}
                    aria-current={active === s.id ? 'true' : undefined}
                    onClick={() => goTo(s.id)}
                  >
                    {t(s.navKey)}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <SaveProvider>
            <div className={styles.sections}>
              {!loaded && (
                <p role="status" className={styles.note}>
                  {t('common.loading')}
                </p>
              )}
              {loaded &&
                SECTIONS.map((s) => (
                  <SettingsSection key={s.id} id={s.id} titleKey={s.titleKey}>
                    {s.body}
                  </SettingsSection>
                ))}
            </div>
          </SaveProvider>
        </div>
      </main>
    </div>
  );
}
