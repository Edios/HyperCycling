import { resolveResistanceMode, type ResistanceMode } from '../../domain/settings';
import { useSettings } from '../data/useSettings';
import { useT } from '../i18n';
import { Segmented } from '../ui/Segmented';
import { Toggle } from '../ui/Toggle';
import { FtpPanel } from './FtpPanel';
import { useSave } from './save';
import styles from './Settings.module.css';
import { useMePlayer } from './useMePlayer';

export function EquipmentSection() {
  const t = useT();
  const save = useSave();
  const { settings } = useSettings();
  const mePlayer = useMePlayer();
  const eq = settings.equipment;
  const set = (patch: Partial<typeof eq>): void => void save({ equipment: { ...eq, ...patch } });
  return (
    <div className={styles.stack}>
      <p className={styles.lead}>{t('settings.equipment.intro')}</p>
      <div className={styles.toggles}>
        <Toggle
          label={t('settings.equipment.showsWatts')}
          checked={eq.showsWatts}
          onChange={(showsWatts) => set({ showsWatts })}
        />
        <Toggle
          label={t('settings.equipment.showsCadence')}
          checked={eq.showsCadence}
          onChange={(showsCadence) => set({ showsCadence })}
        />
        <Toggle
          label={t('settings.equipment.hideRpmTile')}
          checked={eq.hideRpmTile}
          onChange={(hideRpmTile) => set({ hideRpmTile })}
        />
      </div>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>{t('settings.equipment.ramps')}</span>
        <Segmented<ResistanceMode>
          label={t('settings.equipment.ramps')}
          value={resolveResistanceMode(settings)}
          options={[
            { value: 'knob', label: t('settings.equipment.rampsKnob') },
            { value: 'knobPower', label: t('settings.equipment.rampsKnobPower') },
            { value: 'smart', label: t('settings.equipment.rampsSmart') },
          ]}
          onChange={(resistanceMode) => void save({ resistanceMode })}
        />
        <span className={styles.note}>{t('settings.equipment.rampsHint')}</span>
      </div>
      <FtpPanel mePlayer={mePlayer} />
    </div>
  );
}
