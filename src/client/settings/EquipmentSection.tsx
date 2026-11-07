import { useState } from 'react';
import {
  KNOB_STEP_COUNT,
  hasKnob,
  bikeKindOf,
  isValidKnobSteps,
  normalizeKnobSteps,
} from '../../domain/bike';
import { BikeWizard } from '../bike/BikeWizard';
import { KnobStepsFields } from '../bike/KnobStepsFields';
import { parseSteps } from '../bike/steps';
import { Button } from '../ui/Button';
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
  const [wizard, setWizard] = useState(false);
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
      {hasKnob(bikeKindOf(resolveResistanceMode(settings), eq)) && <KnobStepsPanel />}
      <FtpPanel mePlayer={mePlayer} />
      <div>
        <Button data-testid="bike-redo" onClick={() => setWizard(true)}>
          {t('bike.settingsRedo')}
        </Button>
      </div>
      {wizard && <BikeWizard onClose={() => setWizard(false)} />}
    </div>
  );
}

/** Edit the knob positions for S1..S5 in place (the same fields as the bike step). */
function KnobStepsPanel() {
  const t = useT();
  const save = useSave();
  const { settings } = useSettings();
  const [draft, setDraft] = useState<string[] | undefined>();
  const [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false);
  const values = draft ?? normalizeKnobSteps(settings.knobSteps).map(String);
  const submit = async (): Promise<void> => {
    const steps = parseSteps(values);
    if (steps.length !== KNOB_STEP_COUNT || !isValidKnobSteps(steps)) {
      setInvalid(true);
      setSaved(false);
      return;
    }
    setInvalid(false);
    const ok = await save({ knobSteps: steps });
    setSaved(ok);
    if (ok) setDraft(undefined);
  };
  return (
    <div className={styles.stack} data-testid="knob-steps-panel">
      <h3 className={styles.subTitle}>{t('bike.settingsTitle')}</h3>
      <span className={styles.note}>{t('bike.stepsHint')}</span>
      <KnobStepsFields
        values={values}
        invalid={invalid}
        onChange={(next) => {
          setDraft(next);
          setSaved(false);
          setInvalid(false);
        }}
      />
      <div>
        <Button data-testid="knob-steps-save" onClick={() => void submit()}>
          {t('settings.equipment.ftpSave')}
        </Button>{' '}
        <span role="status" className={styles.note}>
          {saved && t('bike.settingsSaved')}
        </span>
      </div>
    </div>
  );
}
