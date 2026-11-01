import { useEffect, useState, type ReactNode } from 'react';
import { useSettings } from '../data/useSettings';
import { useT, type MessageKey } from '../i18n';
import { AppBar } from '../ui/AppBar';
import { DataSection } from './DataSection';
import { EquipmentSection } from './EquipmentSection';
import { GeneralSection } from './GeneralSection';
import { MusicSection } from './MusicSection';
import { SaveProvider } from './save';
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
];

/** The section nearest the top of the viewport, for the nav highlight. */
function useActiveSection(ready: boolean): [string, (id: string) => void] {
  const [active, setActive] = useState(SECTIONS[0]?.id ?? 'general');
  useEffect(() => {
    if (!ready || typeof IntersectionObserver === 'undefined') return undefined;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = e.target.id.replace('settings-section-', '');
          if (e.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        const first = SECTIONS.find((s) => visible.has(s.id));
        if (first) setActive(first.id);
      },
      { rootMargin: '-10% 0px -70% 0px' },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(`settings-section-${s.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ready]);
  return [active, setActive];
}

/** Route /settings: a section list beside (or above) the sections; every control saves at once. */
export function SettingsScreen() {
  const t = useT();
  const { loaded } = useSettings();
  const [active, setActive] = useActiveSection(loaded);
  const goTo = (id: string): void => {
    setActive(id);
    document.getElementById(`settings-section-${id}`)?.scrollIntoView?.({ block: 'start' });
  };
  return (
    <div data-testid="settings-screen">
      <AppBar />
      <main className={styles.main}>
        <h1 className={styles.title}>{t('settings.title')}</h1>
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
