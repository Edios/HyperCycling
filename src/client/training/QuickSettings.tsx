import { useEffect, useRef } from 'react';
import type { SessionConfig } from '../../domain/settings';
import { useT, type MessageKey } from '../i18n';
import { Segmented } from '../ui/Segmented';
import { Toggle } from '../ui/Toggle';
import styles from './QuickSettings.module.css';

type Background = SessionConfig['background'];
type Hud = SessionConfig['hud'];

const BACKGROUND_KEY: Record<Background, MessageKey> = {
  basic: 'setup.backgroundBasic',
  hyperride: 'setup.backgroundHyperride',
  youtube: 'setup.backgroundYoutube',
};

const HUD_KEY: Record<Hud, MessageKey> = {
  solo: 'setup.layoutSolo',
  players: 'setup.layoutPlayers',
  immersive: 'setup.layoutImmersive',
  column: 'setup.layoutColumn',
  cockpit: 'setup.layoutCockpit',
  tunnelTime: 'setup.layoutTunnel',
};

export interface QuickSettingsProps {
  background: Background;
  /** False when there is no link to play (none in the session, none recent). */
  youtubeAvailable: boolean;
  hud: Hud;
  hudChoices: readonly Hud[];
  sounds: boolean;
  coach: boolean;
  onBackground(b: Background): void;
  onHud(h: Hud): void;
  onSounds(on: boolean): void;
  onCoach(on: boolean): void;
  onClose(): void;
}

/** Live settings during a ride. Nothing here touches the engine: time and state carry on. */
export function QuickSettings(p: QuickSettingsProps) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  const backgrounds: Background[] = ['basic', 'hyperride', 'youtube'];
  return (
    <section
      className={styles.panel}
      role="region"
      aria-label={t('training.quickSettings')}
      data-testid="quick-settings"
    >
      <header className={styles.head}>
        <h2>{t('training.quickSettings')}</h2>
        <button
          ref={closeRef}
          type="button"
          className={styles.close}
          aria-label={t('training.quickClose')}
          onClick={p.onClose}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </header>
      <Segmented
        label={t('training.quickBackground')}
        value={p.background}
        options={backgrounds.map((b) => ({
          value: b,
          label: t(BACKGROUND_KEY[b]),
          disabled: b === 'youtube' && !p.youtubeAvailable && p.background !== 'youtube',
          ...(b === 'youtube' && !p.youtubeAvailable
            ? { title: t('training.quickYoutubeNone') }
            : {}),
        }))}
        onChange={p.onBackground}
      />
      <Segmented
        label={t('training.quickLayout')}
        value={p.hud}
        options={p.hudChoices.map((h) => ({ value: h, label: t(HUD_KEY[h]) }))}
        onChange={p.onHud}
      />
      <Toggle label={t('training.quickSounds')} checked={p.sounds} onChange={p.onSounds} />
      <Toggle label={t('training.quickCoach')} checked={p.coach} onChange={p.onCoach} />
    </section>
  );
}
