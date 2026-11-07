import { useState } from 'react';
import {
  BIKE_KINDS,
  bikeKindOf,
  bikePreset,
  hasKnob,
  isValidKnobSteps,
  normalizeKnobSteps,
  type BikeKind,
} from '../../domain/bike';
import { isValidFtp } from '../../domain/ftp-test';
import { resolveResistanceMode } from '../../domain/settings';
import { updateSettings, useSettings } from '../data/useSettings';
import { useT, type MessageKey } from '../i18n';
import { useMePlayer } from '../settings/useMePlayer';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Modal } from '../ui/Modal';
import styles from './Bike.module.css';
import { KnobStepsFields } from './KnobStepsFields';
import { parseSteps } from './steps';

const KIND_KEYS: Record<BikeKind, { label: MessageKey; hint: MessageKey }> = {
  knob: { label: 'bike.kindKnob', hint: 'bike.kindKnobHint' },
  knobPower: { label: 'bike.kindKnobPower', hint: 'bike.kindKnobPowerHint' },
  smart: { label: 'bike.kindSmart', hint: 'bike.kindSmartHint' },
};

type StepId = 'kind' | 'ftp' | 'steps';

/** "Your bike": up to three short, skippable screens (bike type, FTP, knob steps S1..S5). */
export function BikeWizard({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { settings } = useSettings();
  const { me, saveFtp } = useMePlayer();
  const [kind, setKind] = useState<BikeKind>(
    bikeKindOf(resolveResistanceMode(settings), settings.equipment),
  );
  const [ftp, setFtp] = useState<string | undefined>();
  const [steps, setSteps] = useState<string[]>(() =>
    normalizeKnobSteps(settings.knobSteps).map(String),
  );
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<'ftp' | 'steps' | 'save' | undefined>();
  const [busy, setBusy] = useState(false);

  const order: StepId[] = hasKnob(kind) ? ['kind', 'ftp', 'steps'] : ['kind', 'ftp'];
  const pos = Math.min(index, order.length - 1);
  const current = order[pos] ?? 'kind';
  const last = pos === order.length - 1;
  const ftpText = ftp ?? (me ? String(me.ftp) : '');

  const skip = (): void => {
    void updateSettings({ bikeSetupDone: true }).catch(() => undefined);
    onClose();
  };

  const finish = async (ftpValue: string | undefined): Promise<void> => {
    setBusy(true);
    try {
      const preset = bikePreset(kind);
      await updateSettings({
        resistanceMode: preset.resistanceMode,
        equipment: { ...settings.equipment, showsWatts: preset.showsWatts },
        bikeSetupDone: true,
        ...(hasKnob(kind) ? { knobSteps: parseSteps(steps) } : {}),
      });
      if (me && ftpValue !== undefined && ftpValue.trim() !== '') await saveFtp(Number(ftpValue));
      onClose();
    } catch {
      setError('save');
    } finally {
      setBusy(false);
    }
  };

  const advance = (ftpValue: string | undefined): void => {
    if (last) void finish(ftpValue);
    else setIndex(pos + 1);
  };

  const next = (): void => {
    setError(undefined);
    if (
      current === 'ftp' &&
      me &&
      ftp !== undefined &&
      ftp.trim() !== '' &&
      !isValidFtp(Number(ftp))
    ) {
      setError('ftp');
      return;
    }
    if (current === 'steps' && !isValidKnobSteps(parseSteps(steps))) {
      setError('steps');
      return;
    }
    advance(ftp);
  };

  return (
    <Modal title={t('bike.title')} onClose={onClose}>
      <div className={styles.body} data-testid="bike-wizard">
        <p className={styles.progress}>{t('bike.stepOf', { n: pos + 1, total: order.length })}</p>

        {current === 'kind' && (
          <section className={styles.body}>
            <h3>{t('bike.kindTitle')}</h3>
            <div className={styles.kinds}>
              {BIKE_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={styles.kind}
                  aria-pressed={kind === k}
                  data-testid={`bike-kind-${k}`}
                  onClick={() => setKind(k)}
                >
                  <b>{t(KIND_KEYS[k].label)}</b>
                  <small>{t(KIND_KEYS[k].hint)}</small>
                </button>
              ))}
            </div>
            <p className={styles.note}>{t('bike.kindHint')}</p>
          </section>
        )}

        {current === 'ftp' && (
          <section className={styles.body}>
            <h3>{t('bike.ftpTitle')}</h3>
            <p className={styles.note}>{t('bike.ftpHint')}</p>
            {me ? (
              <Field
                label={t('settings.equipment.ftpValue')}
                {...(error === 'ftp' ? { error: t('bike.ftpInvalid') } : {})}
              >
                {(id) => (
                  <input
                    id={id}
                    inputMode="numeric"
                    value={ftpText}
                    aria-invalid={error === 'ftp'}
                    data-testid="bike-ftp"
                    onChange={(e) => setFtp(e.target.value)}
                  />
                )}
              </Field>
            ) : (
              <p className={styles.note}>{t('bike.ftpNoMe')}</p>
            )}
            <p className={styles.note}>{t('bike.ftpUnknownNote')}</p>
          </section>
        )}

        {current === 'steps' && (
          <section className={styles.body}>
            <h3>{t('bike.stepsTitle')}</h3>
            <p className={styles.note}>{t('bike.stepsHint')}</p>
            <KnobStepsFields values={steps} onChange={setSteps} invalid={error === 'steps'} />
          </section>
        )}

        {error === 'save' && (
          <p role="alert" className={styles.error}>
            {t('bike.saveFailed')}
          </p>
        )}

        <div className={styles.actions}>
          <div>
            {pos > 0 && <Button onClick={() => setIndex(pos - 1)}>{t('bike.back')}</Button>}
          </div>
          <div>
            {current === 'ftp' ? (
              <Button
                data-testid="bike-ftp-unknown"
                disabled={busy}
                onClick={() => {
                  setFtp(undefined);
                  setError(undefined);
                  advance(undefined);
                }}
              >
                {t('bike.ftpUnknown')}
              </Button>
            ) : (
              <Button data-testid="bike-skip" onClick={skip}>
                {t('bike.skip')}
              </Button>
            )}
            <Button variant="primary" data-testid="bike-next" disabled={busy} onClick={next}>
              {last ? t('bike.done') : t('bike.next')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
