import { useId, useState } from 'react';
import { DEFAULT_EFFORT_TABLE } from '../../domain/effort';
import { HR_ZONES, zoneForEffort } from '../../domain/hr-zones';
import { useSettings } from '../data/useSettings';
import { useT, type MessageKey } from '../i18n';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Toggle } from '../ui/Toggle';
import { useShowHrZones } from './useShowHrZones';
import { useSave } from './save';
import styles from './Settings.module.css';
import { applyZoneValues, zoneErrors, type ZoneError } from './zones';

const ERROR_KEY: Record<ZoneError, MessageKey> = {
  range: 'settings.zones.errRange',
  increasing: 'settings.zones.errIncreasing',
};

const SCALE_MAX = 200;

function hrCell(level: number): string {
  const zone = zoneForEffort(level);
  const def = HR_ZONES[zone - 1];
  return def ? `Z${zone} · ${def.minPct}–${def.maxPct} %` : '';
}

export function ZonesSection() {
  const t = useT();
  const save = useSave();
  const idBase = useId();
  const { settings } = useSettings();
  const showHr = useShowHrZones();
  const table = settings.effortTable;
  const [typed, setTyped] = useState<string[] | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);

  const values = typed ?? table.map((r) => String(r.ftpPct));
  const errors = zoneErrors(values);

  const edit = (i: number, raw: string): void => {
    const next = values.map((v, k) => (k === i ? raw : v));
    setTyped(next);
    const valid = applyZoneValues(table, next);
    // Invalid input is shown but never saved.
    setSaved(false);
    if (valid) void save({ effortTable: valid }).then(setSaved);
  };

  const restore = (): void => {
    setConfirming(false);
    setTyped(undefined);
    void save({ effortTable: DEFAULT_EFFORT_TABLE }).then(setSaved);
  };

  return (
    <div className={styles.stack}>
      <p className={styles.lead}>{t('settings.zones.intro')}</p>
      <Toggle
        label={t('settings.zones.showHr')}
        checked={showHr}
        onChange={(showHrZones) => void save({ showHrZones })}
      />
      <p className={styles.lead}>{t('settings.zones.showHrHint')}</p>
      <table className={styles.zones} data-testid="zones-table">
        <thead>
          <tr>
            <th scope="col">{t('settings.zones.level')}</th>
            <th scope="col">{t('settings.zones.label')}</th>
            <th scope="col">{t('settings.zones.pct')}</th>
            <th scope="col">{t('settings.zones.hrCol')}</th>
            <th scope="col">{t('settings.zones.color')}</th>
          </tr>
        </thead>
        <tbody>
          {table.map((row, i) => {
            const err = errors[i];
            const inputId = `${idBase}-${row.level}`;
            const shown = Number(values[i]);
            const width = Math.min(100, Math.max(0, (shown / SCALE_MAX) * 100));
            return (
              <tr key={row.level} data-testid="zone-row">
                <td className={styles.zoneLevel}>{row.level}</td>
                <td>{t(`effort.${row.labelKey}`)}</td>
                <td>
                  <input
                    id={inputId}
                    className={`${styles.zoneInput} ${err ? styles.zoneInvalid : ''}`}
                    inputMode="numeric"
                    aria-label={t('settings.zones.pctFor', { level: row.level })}
                    aria-invalid={Boolean(err)}
                    aria-describedby={err ? `${inputId}-err` : undefined}
                    value={values[i]}
                    onChange={(e) => edit(i, e.target.value)}
                  />
                  {err && (
                    <small id={`${inputId}-err`} role="alert" className={styles.zoneError}>
                      {t(ERROR_KEY[err])}
                    </small>
                  )}
                </td>
                <td data-testid="zone-hr">{hrCell(row.level)}</td>
                <td>
                  <span className={styles.swatchTrack} aria-hidden="true">
                    <span
                      className={styles.swatchBar}
                      style={{ width: `${width}%`, background: row.color }}
                    />
                  </span>
                  <span className={styles.srOnly}>{row.color}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={styles.zonesFoot}>
        <Button onClick={() => setConfirming(true)}>{t('settings.zones.restore')}</Button>
        <span role="status" className={styles.zonesSaved}>
          {saved ? t('settings.zones.saved') : ''}
        </span>
      </div>
      {confirming && (
        <Modal title={t('settings.zones.restoreTitle')} onClose={() => setConfirming(false)}>
          <p>{t('settings.zones.restoreBody')}</p>
          <div className={styles.dialogActions}>
            <Button onClick={() => setConfirming(false)}>{t('settings.zones.cancel')}</Button>
            <Button variant="primary" onClick={restore}>
              {t('settings.zones.restoreYes')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
