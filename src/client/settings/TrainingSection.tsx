import { useRef, useState } from 'react';
import type { SessionConfig } from '../../domain/settings';
import { useSettings } from '../data/useSettings';
import { useT, type MessageKey } from '../i18n';
import { WORLD_CHOICES } from '../hyperride/world-options';
import { Segmented } from '../ui/Segmented';
import { Toggle } from '../ui/Toggle';
import { effectiveHud, layoutOptions, type Background } from '../setup/model';
import { useSave } from './save';
import styles from './Settings.module.css';

const FALLBACK_SESSION: SessionConfig = {
  background: 'basic',
  hud: 'solo',
  playerIds: [],
  music: false,
};

const BACKGROUNDS: readonly { value: Background; labelKey: MessageKey }[] = [
  { value: 'basic', labelKey: 'setup.backgroundBasic' },
  { value: 'hyperride', labelKey: 'setup.backgroundHyperride' },
  { value: 'youtube', labelKey: 'setup.backgroundYoutube' },
];

export function TrainingSection() {
  const t = useT();
  const save = useSave();
  const { settings } = useSettings();
  const last = settings.lastSession ?? FALLBACK_SESSION;
  const hasPlayers = last.playerIds.length > 0;

  // The slider moves smoothly on a local value; writes are queued so the last one always wins.
  const [draft, setDraft] = useState<number | undefined>();
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pct = Math.round((draft ?? settings.effectsIntensity) * 100);
  const setEffects = (value: number): void => {
    setDraft(value);
    queue.current = queue.current
      .then(() => save({ effectsIntensity: value / 100 }))
      .then(() => setDraft((d) => (d === value ? undefined : d)));
  };

  const setBackground = (background: Background): void => {
    const hud = effectiveHud(background, last.hud, hasPlayers);
    void save({ lastSession: { ...last, background, hud } });
  };

  return (
    <div className={styles.stack}>
      <div className={styles.toggles}>
        <Toggle
          label={t('settings.training.sounds')}
          checked={settings.sounds}
          onChange={(sounds) => void save({ sounds })}
        />
        <Toggle
          label={t('settings.training.coach')}
          checked={settings.coach}
          onChange={(coach) => void save({ coach })}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="effects-intensity" className={styles.fieldLabel}>
          {t('settings.training.effects')}
        </label>
        <div className={styles.sliderRow}>
          <input
            id="effects-intensity"
            type="range"
            min={0}
            max={100}
            step={5}
            value={pct}
            aria-valuetext={t('settings.training.effectsValue', { pct })}
            onChange={(e) => setEffects(Number(e.target.value))}
            className={styles.slider}
            style={{ '--fill': `${pct}%` } as React.CSSProperties}
          />
          <output htmlFor="effects-intensity" className={styles.sliderValue}>
            {t('settings.training.effectsValue', { pct })}
          </output>
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>{t('settings.training.quality')}</span>
        <Segmented
          label={t('settings.training.quality')}
          value={settings.hyperrideQuality}
          options={[
            { value: 'high', label: t('settings.training.qualityHigh') },
            { value: 'low', label: t('settings.training.qualityLow') },
          ]}
          onChange={(hyperrideQuality) => void save({ hyperrideQuality })}
        />
        <span className={styles.note}>{t('settings.training.qualityHint')}</span>
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>{t('settings.training.hyperrideWorld')}</span>
        <Segmented
          label={t('settings.training.hyperrideWorld')}
          value={settings.hyperrideWorld}
          options={WORLD_CHOICES.map((w) => ({ value: w.value, label: t(w.labelKey) }))}
          onChange={(hyperrideWorld) => void save({ hyperrideWorld })}
        />
      </div>

      <div className={styles.defaults}>
        <h3 className={styles.subTitle}>{t('settings.training.defaultsTitle')}</h3>
        <p className={styles.note}>{t('settings.training.defaultsHint')}</p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('settings.training.background')}</span>
          <Segmented
            label={t('settings.training.background')}
            value={last.background}
            options={BACKGROUNDS.map((b) => ({ value: b.value, label: t(b.labelKey) }))}
            onChange={setBackground}
          />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('settings.training.hud')}</span>
          <Segmented
            label={t('settings.training.hud')}
            value={effectiveHud(last.background, last.hud, hasPlayers)}
            options={layoutOptions(last.background, hasPlayers).map((o) => ({
              value: o.value,
              label: t(o.labelKey),
              disabled: o.disabled ?? false,
            }))}
            onChange={(hud) => void save({ lastSession: { ...last, hud } })}
          />
        </div>
        <div className={styles.field}>
          <Toggle
            label={t('settings.training.music')}
            checked={last.music}
            onChange={(music) => void save({ lastSession: { ...last, music } })}
          />
          <span className={styles.note}>{t('settings.training.musicHint')}</span>
        </div>
      </div>
    </div>
  );
}
