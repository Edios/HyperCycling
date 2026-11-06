import { useEffect, useRef } from 'react';
import type { WorldSettingId, SessionConfig } from '../../domain/settings';
import { useT, type MessageKey } from '../i18n';
import { layoutLabelKey } from '../setup/model';
import type { LayoutKind } from './overlay-layouts';
import { WORLD_CHOICES } from '../world/world-options';
import { Segmented } from '../ui/Segmented';
import { Toggle } from '../ui/Toggle';
import { useRestoreFocus } from '../ui/useRestoreFocus';
import styles from './QuickSettings.module.css';

type Background = SessionConfig['background'];

const BACKGROUND_KEY: Record<Background, MessageKey> = {
  basic: 'setup.backgroundBasic',
  hyperride: 'setup.backgroundWorld',
  youtube: 'setup.backgroundYoutube',
};

export interface QuickSettingsProps {
  background: Background;
  /** False when there is no link to play (none in the session, none recent). */
  youtubeAvailable: boolean;
  layout: LayoutKind;
  layoutChoices: readonly LayoutKind[];
  /** The "Show riders" switch: on / off, and whether it can be used (with the reason if not). */
  riders: boolean;
  ridersHint?: MessageKey | undefined;
  world: WorldSettingId;
  sounds: boolean;
  coach: boolean;
  onBackground(b: Background): void;
  onLayout(l: LayoutKind): void;
  onRiders(on: boolean): void;
  onWorld(w: WorldSettingId): void;
  onSounds(on: boolean): void;
  onCoach(on: boolean): void;
  onClose(): void;
}

/** Live settings during a ride. Nothing here touches the engine: time and state carry on. */
export function QuickSettings(p: QuickSettingsProps) {
  const t = useT();
  useRestoreFocus();
  const panelRef = useRef<HTMLElement>(null);
  // Start on the first control (the background choice), not on Close: Space and arrows work at once.
  useEffect(() => {
    const first =
      panelRef.current?.querySelector<HTMLElement>('input:checked:not(:disabled)') ??
      panelRef.current?.querySelector<HTMLElement>('input:not(:disabled)');
    first?.focus();
  }, []);
  const backgrounds: Background[] = ['basic', 'hyperride', 'youtube'];
  return (
    <section
      ref={panelRef}
      data-quick-settings=""
      className={styles.panel}
      role="region"
      aria-label={t('training.quickSettings')}
      data-testid="quick-settings"
    >
      <header className={styles.head}>
        <h2>{t('training.quickSettings')}</h2>
        <button
          type="button"
          className={styles.close}
          aria-label={t('training.quickClose')}
          onClick={p.onClose}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </header>
      <span className={styles.label} aria-hidden="true">
        {t('training.quickBackground')}
      </span>
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
      {!p.youtubeAvailable && p.background !== 'youtube' && (
        <p className={styles.hint} data-testid="quick-youtube-hint">
          {t('training.quickYoutubeNone')}
        </p>
      )}
      <span className={styles.label} aria-hidden="true">
        {t('training.quickLayout')}
      </span>
      <Segmented
        label={t('training.quickLayout')}
        value={p.layout}
        options={p.layoutChoices.map((l) => ({ value: l, label: t(layoutLabelKey(l)) }))}
        onChange={p.onLayout}
      />
      <Toggle
        label={t('setup.riders')}
        checked={p.riders}
        onChange={p.onRiders}
        disabled={p.ridersHint !== undefined}
      />
      {p.ridersHint && (
        <p className={styles.hint} data-testid="quick-riders-hint">
          {t(p.ridersHint)}
        </p>
      )}
      {p.background === 'hyperride' && (
        <>
          <span className={styles.label} aria-hidden="true">
            {t('training.quickWorld')}
          </span>
          <Segmented
            label={t('training.quickWorld')}
            value={p.world}
            options={WORLD_CHOICES.map((w) => ({ value: w.value, label: t(w.labelKey) }))}
            onChange={p.onWorld}
          />
        </>
      )}
      <Toggle label={t('training.quickSounds')} checked={p.sounds} onChange={p.onSounds} />
      <Toggle label={t('training.quickCoach')} checked={p.coach} onChange={p.onCoach} />
      <p className={styles.hint}>{t('training.quickRideOnly')}</p>
      <p className={styles.hint}>{t('training.shortcutHint')}</p>
    </section>
  );
}
