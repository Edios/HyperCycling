import { useEffect, useRef, useState } from 'react';
import { maskSensitive } from '../diagnostics/mask';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { DevicesPanel } from './DevicesPanel';
import styles from './TrainerTest.module.css';
import {
  READ_MS,
  reportText,
  runTrainerTest,
  STEP_FROM_W,
  STEP_TO_W,
  verdict,
  type Phase,
  type Sample,
  type TrainerTestResult,
  type Verdict,
} from './trainer-test';
import { useDeviceStore, useDevicesState } from './useDevices';

class Cancelled extends Error {}

type View =
  | { kind: 'ready' }
  | { kind: 'running'; phase: Phase; startedAt: number }
  | { kind: 'done'; result: TrainerTestResult; verdict: Verdict; report: string };

/** "Test the trainer": connect, read for 15 s, one ERG step, a verdict in words and a report. */
export function TrainerTest({ onClose }: { onClose: () => void }) {
  const t = useT();
  const store = useDeviceStore();
  const state = useDevicesState(store);
  const [view, setView] = useState<View>({ kind: 'ready' });
  const [last, setLast] = useState<Sample>({ atMs: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const trainerOn = state.trainer.status === 'connected';
  const hrWanted = state.hr.status === 'connected';

  // Closing the window cancels a running test (the runner then hands the trainer back).
  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    if (view.kind !== 'running') return undefined;
    const id = window.setInterval(() => setElapsed(Date.now() - view.startedAt), 500);
    return () => window.clearInterval(id);
  }, [view]);

  const start = async (): Promise<void> => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    const startedAt = Date.now();
    setCopied(false);
    setElapsed(0);
    setView({ kind: 'running', phase: 'reading', startedAt });
    const wait = (ms: number): Promise<void> =>
      new Promise((resolve, reject) => {
        if (ctrl.signal.aborted) return reject(new Cancelled());
        const id = window.setTimeout(resolve, ms);
        ctrl.signal.addEventListener('abort', () => {
          window.clearTimeout(id);
          reject(new Cancelled());
        });
      });
    try {
      const result = await runTrainerTest({
        store,
        now: () => Date.now(),
        wait,
        onPhase: (phase) => {
          if (!ctrl.signal.aborted && phase !== 'done')
            setView({ kind: 'running', phase, startedAt });
        },
        onSample: (s) => setLast((prev) => ({ ...prev, ...s })),
      });
      const v = verdict(result, hrWanted);
      const report = maskSensitive(reportText(result, v, t, new Date()));
      // The result also lands in the Bluetooth log, so the diagnostics report carries it.
      store.log.add('app', 'state', report.split('\n').slice(1).join(' | '));
      setView({ kind: 'done', result, verdict: v, report });
    } catch (error) {
      if (error instanceof Cancelled) return;
      store.log.add('app', 'error', `Trainer test: ${(error as Error).message}`);
      setView({ kind: 'ready' });
    }
  };

  const copy = async (report: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal title={t('devices.test.title')} onClose={onClose}>
      <div className={styles.body} data-testid="trainer-test" data-view={view.kind}>
        {view.kind === 'ready' && (
          <>
            <p className={styles.lead}>
              {t('devices.test.intro', { from: STEP_FROM_W, to: STEP_TO_W })}
            </p>
            <DevicesPanel variant="compact" showTrainer showWatts />
            <Button
              variant="primary"
              disabled={!trainerOn}
              onClick={() => void start()}
              data-testid="trainer-test-start"
            >
              {t('devices.test.start')}
            </Button>
            {!trainerOn && <p className={styles.note}>{t('devices.test.needTrainer')}</p>}
          </>
        )}
        {view.kind === 'running' && (
          <>
            <p className={styles.phase} role="status" data-testid="trainer-test-phase">
              {t(`devices.test.phase.${view.phase === 'done' ? 'release' : view.phase}`, {
                from: STEP_FROM_W,
                to: STEP_TO_W,
                s: Math.max(0, Math.ceil((READ_MS - elapsed) / 1000)),
              })}
            </p>
            <dl className={styles.live}>
              <dt>{t('devices.test.power')}</dt>
              <dd>{`${last.powerW ?? '—'} ${t('training.watts')}`}</dd>
              <dt>{t('devices.test.cadence')}</dt>
              <dd>{last.cadenceRpm ?? '—'}</dd>
              <dt>{t('devices.test.hr')}</dt>
              <dd>{last.hrBpm ?? '—'}</dd>
            </dl>
            <p className={styles.note}>{t('devices.test.keepPedalling')}</p>
            <Button
              onClick={() => {
                abort.current?.abort();
                setView({ kind: 'ready' });
              }}
            >
              {t('devices.test.cancel')}
            </Button>
          </>
        )}
        {view.kind === 'done' && (
          <>
            <p
              className={styles.verdict}
              data-level={view.verdict.level}
              data-testid="trainer-test-verdict"
            >
              {t(`devices.test.level.${view.verdict.level}`)}
            </p>
            <ul className={styles.notes} data-testid="trainer-test-notes">
              {view.verdict.notes.map((k) => (
                <li key={k}>{t(k)}</li>
              ))}
            </ul>
            <dl className={styles.live}>
              <dt>{t('devices.test.power')}</dt>
              <dd>{view.result.power ? `${view.result.power.avg} W` : '—'}</dd>
              <dt>{t('devices.test.cadence')}</dt>
              <dd>{view.result.cadence ? view.result.cadence.avg : '—'}</dd>
              <dt>{t('devices.test.hr')}</dt>
              <dd>{view.result.hr ? view.result.hr.avg : '—'}</dd>
              <dt>{t('devices.test.reaction')}</dt>
              <dd data-testid="trainer-test-reaction">
                {view.result.erg.kind === 'done' && view.result.erg.step.reactionMs !== null
                  ? `${(view.result.erg.step.reactionMs / 1000).toFixed(1)} s`
                  : '—'}
              </dd>
              <dt>{t('devices.test.deviation')}</dt>
              <dd>
                {view.result.erg.kind === 'done' && view.result.erg.step.deviationPct !== null
                  ? `${view.result.erg.step.deviationPct} %`
                  : '—'}
              </dd>
            </dl>
            <div className={styles.actions}>
              <Button onClick={() => void copy(view.report)} data-testid="trainer-test-copy">
                {copied ? t('devices.test.copied') : t('devices.test.copy')}
              </Button>
              <Button onClick={() => setView({ kind: 'ready' })}>{t('devices.test.again')}</Button>
            </div>
            <p className={styles.note}>{t('devices.test.reportNote')}</p>
          </>
        )}
      </div>
    </Modal>
  );
}
