import { useSettings } from '../data/useSettings';
import { useT } from '../i18n';
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
      <FtpPanel mePlayer={mePlayer} />
    </div>
  );
}
