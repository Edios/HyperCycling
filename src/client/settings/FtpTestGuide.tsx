import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { FTP_TEST_KINDS, ftpFromTest, type FtpTestKind } from '../../domain/ftp-test';
import { useT, type MessageKey } from '../i18n';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Segmented } from '../ui/Segmented';
import styles from './Settings.module.css';

interface TestCopy {
  name: MessageKey;
  summary: MessageKey;
  steps: readonly [MessageKey, MessageKey, MessageKey];
  measure: MessageKey;
  formula: MessageKey;
  input: MessageKey;
  /** Built-in workout that rides this test. */
  workoutId: string;
}

const COPY: Record<FtpTestKind, TestCopy> = {
  ramp: {
    name: 'settings.equipment.testRamp',
    summary: 'settings.equipment.ramp.summary',
    steps: [
      'settings.equipment.ramp.steps.warmup',
      'settings.equipment.ramp.steps.test',
      'settings.equipment.ramp.steps.stop',
    ],
    measure: 'settings.equipment.ramp.measure',
    formula: 'settings.equipment.ramp.formula',
    input: 'settings.equipment.ramp.input',
    workoutId: 'ramp-test',
  },
  twenty: {
    name: 'settings.equipment.testTwenty',
    summary: 'settings.equipment.twenty.summary',
    steps: [
      'settings.equipment.twenty.steps.warmup',
      'settings.equipment.twenty.steps.test',
      'settings.equipment.twenty.steps.stop',
    ],
    measure: 'settings.equipment.twenty.measure',
    formula: 'settings.equipment.twenty.formula',
    input: 'settings.equipment.twenty.input',
    workoutId: 'ftp-test-20',
  },
  twoByEight: {
    name: 'settings.equipment.testTwoByEight',
    summary: 'settings.equipment.twoByEight.summary',
    steps: [
      'settings.equipment.twoByEight.steps.warmup',
      'settings.equipment.twoByEight.steps.test',
      'settings.equipment.twoByEight.steps.stop',
    ],
    measure: 'settings.equipment.twoByEight.measure',
    formula: 'settings.equipment.twoByEight.formula',
    input: 'settings.equipment.twoByEight.input',
    workoutId: 'ftp-test-2x8',
  },
};

/** Expandable guide: how to ride each FTP test, what to note, and a calculator for the result. */
export function FtpTestGuide({
  canSave,
  onSave,
}: {
  canSave: boolean;
  onSave: (ftp: number) => Promise<boolean>;
}) {
  const t = useT();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FtpTestKind>('ramp');
  const [typed, setTyped] = useState<Record<FtpTestKind, string[]>>({
    ramp: [''],
    twenty: [''],
    twoByEight: ['', ''],
  });
  const [saved, setSaved] = useState<number | undefined>();
  const [saveFailed, setSaveFailed] = useState(false);
  const copy = COPY[kind];
  const values = typed[kind];
  const ftp = ftpFromTest(
    kind,
    values.map((v) => (v.trim() === '' ? Number.NaN : Number(v))),
  );

  const setValue = (i: number, v: string): void => {
    setSaved(undefined);
    setSaveFailed(false);
    setTyped((all) => ({ ...all, [kind]: all[kind].map((old, k) => (k === i ? v : old)) }));
  };

  return (
    <div className={styles.guide} data-testid="ftp-guide">
      <button
        type="button"
        className={styles.guideToggle}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{t('settings.equipment.testTitle')}</span>
        <span aria-hidden="true" className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}>
          ›
        </span>
      </button>
      <div id={panelId} hidden={!open} className={styles.guideBody}>
        <p className={styles.note}>{t('settings.equipment.testIntro')}</p>
        <Segmented
          label={t('settings.equipment.testPick')}
          value={kind}
          options={FTP_TEST_KINDS.map((value) => ({ value, label: t(COPY[value].name) }))}
          onChange={(k) => {
            setKind(k);
            setSaved(undefined);
          }}
        />
        <p className={styles.lead}>{t(copy.summary)}</p>
        <ol className={styles.steps}>
          {copy.steps.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ol>
        <dl className={styles.facts}>
          <dt>{t('settings.equipment.testMeasure')}</dt>
          <dd>{t(copy.measure)}</dd>
          <dt>{t('settings.equipment.testFormula')}</dt>
          <dd className={styles.formula}>{t(copy.formula)}</dd>
        </dl>
        <Link to={`/setup/${copy.workoutId}`} className={styles.link} data-testid="ftp-test-start">
          {kind === 'ramp'
            ? t('settings.equipment.testStartRamp')
            : t('settings.equipment.testStart')}
        </Link>

        <div className={styles.calc} role="group" aria-label={t('settings.equipment.calcTitle')}>
          <h4 className={styles.calcTitle}>{t('settings.equipment.calcTitle')}</h4>
          <div className={styles.calcInputs}>
            {values.map((v, i) => (
              <Field key={`${kind}-${i}`} label={t(copy.input, { n: i + 1 })}>
                {(id) => (
                  <input
                    id={id}
                    inputMode="numeric"
                    value={v}
                    onChange={(e) => setValue(i, e.target.value)}
                  />
                )}
              </Field>
            ))}
          </div>
          <p className={styles.result} role="status" data-testid="ftp-result">
            {ftp === undefined
              ? t('settings.equipment.calcEmpty')
              : t('settings.equipment.calcResult', { ftp })}
          </p>
          <div className={styles.calcActions}>
            <Button
              variant="primary"
              disabled={ftp === undefined || !canSave}
              onClick={() => {
                if (ftp === undefined) return;
                void onSave(ftp).then((ok) => {
                  setSaved(ok ? ftp : undefined);
                  setSaveFailed(!ok);
                });
              }}
            >
              {t('settings.equipment.calcSave')}
            </Button>
            {!canSave && <span className={styles.note}>{t('settings.equipment.calcNoMe')}</span>}
            {saveFailed && (
              <span role="alert" className={styles.note}>
                {t('settings.saveFailed')}
              </span>
            )}
            {saved !== undefined && (
              <span role="status" className={styles.note}>
                {t('settings.equipment.ftpSaved')}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
