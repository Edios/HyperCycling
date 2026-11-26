import { useMemo, useState } from 'react';
import { triggerDownload, type DownloadFn } from '../data/import-export';
import { updateSettings } from '../data/useSettings';
import { sharedDeviceStore } from '../devices/device-store';
import { useT } from '../i18n';
import { getMusicLog } from '../music/play-log';
import { Toast } from '../ui/Toast';
import { readRenderStats } from '../world/render-stats';
import { readWebglIssue } from '../world/webgl-log';
import { APP_VERSION, collectFullReport, reportFileName } from './collect';
import { readErrors } from './error-log';
import { shortUserAgent } from './full-report';
import { readDiagScene } from './scene';
import { useFrameMeter } from './useFrameMeter';
import { browserViewportEnv, formatViewport, readViewport } from './viewport-info';
import styles from './DiagnosticsOverlay.module.css';

const CANVAS = '[data-testid="world-canvas"]';
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type Notice = 'copied' | 'copyFailed' | 'saved';

export interface DiagnosticsOverlayProps {
  /** Test seam. */
  download?: DownloadFn;
}

/**
 * Live readout over any screen (top-left, monospace) while diagnostics mode is on, with a small
 * menu to copy or save the full report. Mounted by GlobalDiagnostics only when the mode is on.
 */
export function DiagnosticsOverlay({ download = triggerDownload }: DiagnosticsOverlayProps) {
  const t = useT();
  // Re-renders once a second; every value below is re-read then.
  const stats = useFrameMeter();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<{ kind: Notice; id: number } | null>(null);
  const browser = useMemo(() => shortUserAgent(navigator.userAgent), []);
  const say = (kind: Notice): void => setNotice({ kind, id: Date.now() });

  const dash = '-';
  const scene = readDiagScene();
  const canvas = document.querySelector<HTMLCanvasElement>(CANVAS);
  const size = canvas ? `${canvas.width}x${canvas.height}` : undefined;
  const rs = readRenderStats();
  const webglIssue = readWebglIssue();
  const devices = sharedDeviceStore().getState();
  const errors = readErrors();
  const lastError = errors.at(-1);
  const lastSong = getMusicLog().at(-1);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(collectFullReport(t));
      say('copied');
    } catch {
      say('copyFailed');
    }
  };
  const save = async (): Promise<void> => {
    const blob = new Blob([collectFullReport(t)], { type: 'text/plain;charset=utf-8' });
    await download(blob, reportFileName());
    say('saved');
  };

  return (
    <div className={styles.root} data-testid="diagnostics">
      <div className={styles.overlay} data-testid="diagnostics-overlay" aria-hidden="true">
        <div>
          {t('diagnostics.overlay.fps')} {Math.round(stats.avgFps)} |{' '}
          {t('diagnostics.overlay.frame')} {stats.avgFrameMs.toFixed(1)}/
          {stats.p95FrameMs.toFixed(1)}
        </div>
        <div>
          {size ?? dash} | {scene?.quality ?? dash} | {scene?.scene ?? (location.hash || '#/')}
        </div>
        <div data-testid="diagnostics-viewport">
          {formatViewport(readViewport(browserViewportEnv()))}
        </div>
        <div>{`v${APP_VERSION} | ${browser}`}</div>
        <div data-testid="diagnostics-bt">
          {t('diagnostics.overlay.bt', {
            trainer: devices.trainer.status,
            hr: devices.hr.status,
          })}
        </div>
        <div data-testid="diagnostics-errors">
          {t('diagnostics.overlay.errors', { n: errors.length })}
          {lastError &&
            ` | ${t('diagnostics.overlay.lastError', { text: cut(lastError.text, 48) })}`}
        </div>
        {lastSong && (
          <div>
            {t('diagnostics.overlay.music', {
              line: cut(`${lastSong.outcome} #${lastSong.index} ${lastSong.title}`, 48),
            })}
          </div>
        )}
        {webglIssue && (
          <div data-testid="diagnostics-webgl">
            {t('diagnostics.overlay.webgl', { reason: webglIssue })}
          </div>
        )}
        {rs && (
          <div data-testid="diagnostics-gpu">
            {t('diagnostics.overlay.gpu', {
              ms: rs.gpuMs === null ? dash : rs.gpuMs.toFixed(1),
              calls: rs.drawCalls,
              tris: Math.round(rs.triangles / 1000),
              mpx: rs.mpx.toFixed(2),
            })}
          </div>
        )}
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.more}
          aria-expanded={open}
          aria-label={t('diagnostics.overlay.actions')}
          title={t('diagnostics.overlay.actions')}
          data-testid="diagnostics-menu"
          onClick={() => setOpen((o) => !o)}
        >
          ⋯
        </button>
        {open && (
          <div className={styles.menu} role="group" aria-label={t('diagnostics.title')}>
            <button
              type="button"
              className={styles.item}
              data-testid="diagnostics-copy"
              onClick={() => void copy()}
            >
              {t('diagnostics.copy')}
            </button>
            <button
              type="button"
              className={styles.item}
              data-testid="diagnostics-save"
              onClick={() => void save()}
            >
              {t('diagnostics.save')}
            </button>
            <button
              type="button"
              className={styles.item}
              data-testid="diagnostics-off"
              onClick={() => void updateSettings({ diagnostics: false }).catch(() => undefined)}
            >
              {t('diagnostics.overlay.off')}
            </button>
          </div>
        )}
      </div>
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
