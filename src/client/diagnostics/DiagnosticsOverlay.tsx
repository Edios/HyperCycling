import { useT } from '../i18n';
import { readRenderStats } from '../world/render-stats';
import { useFrameMeter } from './useFrameMeter';
import styles from './DiagnosticsOverlay.module.css';

export interface DiagnosticsOverlayProps {
  /** What is drawn behind the HUD, e.g. "World / road" or "Basic". */
  scene: string;
  /** Effective World quality; omitted when no canvas is running. */
  quality?: string | undefined;
}

const CANVAS = '[data-testid="world-canvas"]';

/** Small live readout (top-left, monospace) for judging how the app runs on this hardware. */
export function DiagnosticsOverlay({ scene, quality }: DiagnosticsOverlayProps) {
  const t = useT();
  const stats = useFrameMeter();
  // The meter re-renders this once a second, which is when the canvas size is re-read.
  const canvas = document.querySelector<HTMLCanvasElement>(CANVAS);
  const size = canvas ? `${canvas.width}x${canvas.height}` : undefined;
  const dash = '-';
  const rs = readRenderStats();
  return (
    <div className={styles.overlay} data-testid="diagnostics-overlay" aria-hidden="true">
      <div>
        {t('diagnostics.overlay.fps')} {Math.round(stats.avgFps)} | {t('diagnostics.overlay.frame')}{' '}
        {stats.avgFrameMs.toFixed(1)}/{stats.p95FrameMs.toFixed(1)}
      </div>
      <div>
        {size ?? dash} | {quality ?? dash} | {scene}
      </div>
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
  );
}
