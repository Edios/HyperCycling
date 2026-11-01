import type { ReactNode } from 'react';
import { useT, type MessageKey } from '../i18n';
import { AppBar } from '../ui/AppBar';
import { MusicSection } from './MusicSection';
import styles from './Settings.module.css';

/** One titled block of the settings screen. Later milestones add their sections beside Music. */
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
    <section className={styles.section} aria-labelledby={headingId} data-testid={`settings-${id}`}>
      <h2 id={headingId} className={styles.sectionTitle}>
        {t(titleKey)}
      </h2>
      {children}
    </section>
  );
}

/** Route /settings. For now it holds the Music section only. */
export function SettingsScreen() {
  const t = useT();
  return (
    <div data-testid="settings-screen">
      <AppBar />
      <main className={styles.main}>
        <h1 className={styles.title}>{t('settings.title')}</h1>
        <SettingsSection id="music" titleKey="settings.music.title">
          <MusicSection />
        </SettingsSection>
      </main>
    </div>
  );
}
