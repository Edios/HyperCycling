import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSettings } from '../data/useSettings';
import { triggerDownload, type DownloadFn } from '../data/import-export';
import { browserDeviceEnv, collectDeviceInfo, UNAVAILABLE } from '../diagnostics/device-info';
import { PerformanceTestModal, testDurationMs } from '../diagnostics/PerformanceTestModal';
import { recommendQuality, type TestResult } from '../diagnostics/recommendation';
import { buildReport } from '../diagnostics/report';
import { useTestResults } from '../diagnostics/results-store';
import { WORLD_CHOICES } from '../hyperride/world-options';
import { useT, type MessageKey } from '../i18n';
import { Button } from '../ui/Button';
import { Toast } from '../ui/Toast';
import { Toggle } from '../ui/Toggle';
import { useSave } from './save';
import styles from './Diagnostics.module.css';
import settingsStyles from './Settings.module.css';

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev';
const ALLOW_OVERRIDE = import.meta.env.DEV || import.meta.env.VITE_E2E === '1';

const REC_KEY = {
  high: 'diagnostics.rec.high',
  low: 'diagnostics.rec.low',
  basic: 'diagnostics.rec.basic',
} as const satisfies Record<string, MessageKey>;

type Health = 'good' | 'warn' | 'bad';
const fpsHealth = (fps: number): Health => (fps >= 50 ? 'good' : fps >= 40 ? 'warn' : 'bad');
const slowHealth = (pct: number): Health => (pct <= 5 ? 'good' : pct <= 10 ? 'warn' : 'bad');

interface DiagnosticsSectionProps {
  /** Test seam. */
  download?: DownloadFn;
}

type Notice = 'copied' | 'copyFailed' | 'saved';

export function DiagnosticsSection({ download = triggerDownload }: DiagnosticsSectionProps) {
  const t = useT();
  const save = useSave();
  const { settings } = useSettings();
  const [params] = useSearchParams();
  const results = useTestResults((s) => s.results);
  const setResults = useTestResults((s) => s.setResults);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<{ kind: Notice; id: number } | null>(null);
  const on = settings.diagnostics === true;
  const info = useMemo(() => (on ? collectDeviceInfo(browserDeviceEnv()) : undefined), [on]);

  const say = (kind: Notice): void => setNotice({ kind, id: Date.now() });
  const report = (): string =>
    buildReport({
      version: APP_VERSION,
      date: new Date(),
      info: info ?? collectDeviceInfo(browserDeviceEnv()),
      results,
      t,
    });

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(report());
      say('copied');
    } catch {
      say('copyFailed');
    }
  };
  const saveFile = async (): Promise<void> => {
    const blob = new Blob([report()], { type: 'text/plain;charset=utf-8' });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    await download(blob, `hypercycling-diagnostics-${stamp}.txt`);
    say('saved');
  };

  const finish = (r: TestResult[]): void => {
    setResults([...r]);
    setRunning(false);
  };

  const na = t('diagnostics.device.unavailable');
  const yesNo = (v: boolean): string => t(v ? 'diagnostics.device.yes' : 'diagnostics.device.no');
  const rows: readonly [MessageKey, string][] = info
    ? [
        ['diagnostics.device.userAgent', info.userAgent],
        ['diagnostics.device.platform', info.platform === UNAVAILABLE ? na : info.platform],
        [
          'diagnostics.device.screen',
          `${info.screen.width} × ${info.screen.height} @${info.screen.pixelRatio}x`,
        ],
        ['diagnostics.device.viewport', `${info.viewport.width} × ${info.viewport.height}`],
        ['diagnostics.device.cores', String(info.hardwareConcurrency ?? na)],
        [
          'diagnostics.device.memory',
          info.deviceMemoryGb === undefined
            ? na
            : t('diagnostics.device.memoryValue', { gb: info.deviceMemoryGb }),
        ],
        ['diagnostics.device.webgl2', yesNo(info.webgl2)],
        ['diagnostics.device.gpuVendor', info.gpuVendor === UNAVAILABLE ? na : info.gpuVendor],
        [
          'diagnostics.device.gpuRenderer',
          info.gpuRenderer === UNAVAILABLE ? na : info.gpuRenderer,
        ],
        ['diagnostics.device.maxTexture', String(info.maxTextureSize ?? na)],
        ['diagnostics.device.reducedMotion', yesNo(info.reducedMotion)],
      ]
    : [];

  const worldLabel = (id: string): string => {
    const w = WORLD_CHOICES.find((c) => c.value === id);
    return w ? t(w.labelKey) : id;
  };
  const recommendation = recommendQuality(results);

  return (
    <div className={settingsStyles.stack}>
      <div>
        <Toggle
          label={t('diagnostics.enable')}
          checked={on}
          onChange={(diagnostics) => void save({ diagnostics })}
        />
        <p className={settingsStyles.note}>{t('diagnostics.enableHint')}</p>
      </div>

      {on && (
        <>
          <section className={styles.block} aria-labelledby="diag-device">
            <h3 id="diag-device" className={settingsStyles.subTitle}>
              {t('diagnostics.device.title')}
            </h3>
            <dl className={styles.facts} data-testid="device-card">
              {rows.map(([key, value]) => (
                <div key={key} className={styles.fact}>
                  <dt>{t(key)}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className={styles.block} aria-labelledby="diag-test">
            <h3 id="diag-test" className={settingsStyles.subTitle}>
              {t('diagnostics.test.title')}
            </h3>
            <p className={settingsStyles.note}>{t('diagnostics.test.hint')}</p>
            <div>
              <Button variant="primary" onClick={() => setRunning(true)}>
                {t('diagnostics.test.start')}
              </Button>
            </div>

            {results.length === 0 ? (
              <p className={settingsStyles.note}>{t('diagnostics.results.empty')}</p>
            ) : (
              <>
                <div className={styles.tableWrap}>
                  <table className={styles.table} data-testid="results-table">
                    <caption className={styles.srOnly}>{t('diagnostics.results.title')}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t('diagnostics.results.world')}</th>
                        <th scope="col">{t('diagnostics.results.avgFps')}</th>
                        <th scope="col">{t('diagnostics.results.p5Fps')}</th>
                        <th scope="col">{t('diagnostics.results.slow')}</th>
                        <th scope="col">{t('diagnostics.results.resolution')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r) => (
                        <tr key={`${r.world}:${r.quality}`}>
                          <th scope="row">
                            {worldLabel(r.world)}
                            <span className={styles.sub}>
                              {t(`diagnostics.quality.${r.quality}`)}
                            </span>
                          </th>
                          <td className={styles[fpsHealth(r.avgFps)]}>{r.avgFps.toFixed(1)}</td>
                          <td className={styles[fpsHealth(r.p5Fps)]}>{r.p5Fps.toFixed(1)}</td>
                          <td className={styles[slowHealth(r.slowPct)]}>
                            {t('diagnostics.results.slowValue', { pct: r.slowPct.toFixed(1) })}
                          </td>
                          <td>{`${r.width}x${r.height}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {recommendation && (
                  <p className={styles.recommendation} role="status">
                    {t(REC_KEY[recommendation])}
                  </p>
                )}
              </>
            )}
          </section>

          <div className={styles.actions}>
            <Button onClick={() => void copy()}>{t('diagnostics.copy')}</Button>
            <Button onClick={() => void saveFile()}>{t('diagnostics.save')}</Button>
          </div>
        </>
      )}

      {running && (
        <PerformanceTestModal
          durationMs={testDurationMs(params, ALLOW_OVERRIDE)}
          onDone={finish}
          onCancel={() => setRunning(false)}
        />
      )}
      {notice && (
        <Toast
          key={notice.id}
          message={t(`diagnostics.${notice.kind}`)}
          onClose={() => setNotice(null)}
        />
      )}
    </div>
  );
}
