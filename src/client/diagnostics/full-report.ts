import type { DevicesState, DeviceSlot } from '../devices/device-store';
import type { MessageKey } from '../i18n';
import type { DeviceInfo } from './device-info';
import { maskSensitive, safeSettingsSnapshot } from './mask';
import type { TestResult } from './recommendation';
import { buildReport } from './report';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export interface FullReportInput {
  version: string;
  date: Date;
  /** The route the report was taken on, e.g. "#/train". */
  screen: string;
  info: DeviceInfo;
  /** formatViewport() line. */
  viewport: string;
  results: readonly TestResult[];
  settings: unknown;
  devices: DevicesState | undefined;
  bleLog: string;
  musicLog: string;
  webglLog: string;
  errors: string;
  t: Translate;
}

const slot = (s: DeviceSlot): string =>
  `${s.status}${s.name ? ` (${s.name})` : ''}${s.error ? `: ${s.error}` : ''}`;

/**
 * The single exported diagnostics file: app and device, viewport, settings, Bluetooth, 3D
 * background, music and errors, one section each, with every secret masked (see mask.ts).
 */
export function buildFullReport(input: FullReportInput): string {
  const { t } = input;
  const head = (key: MessageKey): string => `== ${t(key)} ==`;
  const base = buildReport({
    version: input.version,
    date: input.date,
    info: input.info,
    results: input.results,
    musicLog: input.musicLog,
    webglLog: input.webglLog,
    t,
  }).trimEnd();
  const [title = '', ...rest] = base.split('\n');
  const lines = [
    title,
    t('diagnostics.report.masked'),
    `${t('diagnostics.report.screen')}: ${input.screen}`,
    ...rest,
    '',
    head('diagnostics.report.viewport'),
    input.viewport,
    '',
    head('diagnostics.report.settings'),
    JSON.stringify(safeSettingsSnapshot(input.settings), null, 2),
    '',
    head('diagnostics.report.bluetooth'),
  ];
  if (input.devices) {
    lines.push(
      `${t('diagnostics.report.btSupport')}: ${t(input.devices.supported ? 'diagnostics.device.yes' : 'diagnostics.device.no')}${input.devices.unsupportedReason ? ` (${input.devices.unsupportedReason})` : ''}`,
      `${t('diagnostics.report.trainer')}: ${slot(input.devices.trainer)}`,
      `${t('diagnostics.report.hr')}: ${slot(input.devices.hr)}`,
    );
  }
  lines.push(input.bleLog || t('diagnostics.report.noBle'), '');
  lines.push(head('diagnostics.report.errors'), input.errors || t('diagnostics.report.noErrors'));
  return maskSensitive(lines.join('\n')) + '\n';
}

const BROWSERS: readonly [RegExp, string][] = [
  [/Edg(?:A|iOS)?\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
  [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
  [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
  [/(?:Chrome|CriOS)\/(\d+)/, 'Chrome'],
  [/Version\/(\d+)[\d.]* .*Safari/, 'Safari'],
];

const SYSTEMS: readonly [RegExp, string][] = [
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

/** "Chrome 131 / Android": the browser and system in a few characters for the overlay. */
export function shortUserAgent(ua: string): string {
  const browser = BROWSERS.map(([re, name]) => {
    const m = re.exec(ua);
    return m ? `${name} ${m[1]}` : null;
  }).find((b) => b !== null);
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  if (!browser && !system) return ua.slice(0, 40);
  return [browser, system].filter(Boolean).join(' / ');
}
