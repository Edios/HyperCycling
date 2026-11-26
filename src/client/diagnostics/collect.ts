import { getSettingsSnapshot } from '../data/useSettings';
import { sharedDeviceStore } from '../devices/device-store';
import type { MessageKey } from '../i18n';
import { formatMusicLog, getMusicLog } from '../music/play-log';
import { webglLogText } from '../world/webgl-log';
import { browserDeviceEnv, collectDeviceInfo } from './device-info';
import { errorLogText } from './error-log';
import { buildFullReport } from './full-report';
import type { TestResult } from './recommendation';
import { useTestResults } from './results-store';
import { browserViewportEnv, formatViewport, readViewport } from './viewport-info';

export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The full diagnostics file for this browser right now (read only when exported). */
export function collectFullReport(
  t: Translate,
  results: readonly TestResult[] = useTestResults.getState().results,
  now: Date = new Date(),
): string {
  const store = sharedDeviceStore();
  return buildFullReport({
    version: APP_VERSION,
    date: now,
    screen: location.hash || '#/',
    info: collectDeviceInfo(browserDeviceEnv()),
    viewport: formatViewport(readViewport(browserViewportEnv())),
    results,
    settings: getSettingsSnapshot(),
    devices: store.getState(),
    bleLog: store.log.toText(),
    musicLog: formatMusicLog(getMusicLog().slice(-30)),
    webglLog: webglLogText(),
    errors: errorLogText(),
    t,
  });
}

export const reportFileName = (now: Date = new Date()): string =>
  `hypercycling-diagnostics-${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
