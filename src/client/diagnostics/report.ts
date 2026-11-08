import type { MessageKey } from '../i18n';
import type { DeviceInfo } from './device-info';
import type { TestResult } from './recommendation';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export interface ReportInput {
  version: string;
  date: Date;
  info: DeviceInfo;
  results: readonly TestResult[];
  /** Lines of the music log (which recording played or failed); empty = left out. */
  musicLog?: string;
  t: Translate;
}

const n1 = (v: number): string => v.toFixed(1);

/** Plain-text diagnostics report for pasting into a message or saving as a .txt file. */
export function buildReport({ version, date, info, results, musicLog, t }: ReportInput): string {
  const na = t('diagnostics.device.unavailable');
  const lines = [
    t('diagnostics.report.title'),
    `${t('diagnostics.report.version')}: ${version}`,
    `${t('diagnostics.report.date')}: ${date.toISOString()}`,
    '',
    `${t('diagnostics.report.device')}:`,
    `${t('diagnostics.device.userAgent')}: ${info.userAgent}`,
    `${t('diagnostics.device.platform')}: ${info.platform}`,
    `${t('diagnostics.device.screen')}: ${info.screen.width} x ${info.screen.height} @${info.screen.pixelRatio}x`,
    `${t('diagnostics.device.viewport')}: ${info.viewport.width} x ${info.viewport.height}`,
    `${t('diagnostics.device.cores')}: ${info.hardwareConcurrency ?? na}`,
    `${t('diagnostics.device.memory')}: ${info.deviceMemoryGb === undefined ? na : t('diagnostics.device.memoryValue', { gb: info.deviceMemoryGb })}`,
    `${t('diagnostics.device.webgl2')}: ${t(info.webgl2 ? 'diagnostics.device.yes' : 'diagnostics.device.no')}`,
    `${t('diagnostics.device.gpuVendor')}: ${info.gpuVendor === 'unavailable' ? na : info.gpuVendor}`,
    `${t('diagnostics.device.gpuRenderer')}: ${info.gpuRenderer === 'unavailable' ? na : info.gpuRenderer}`,
    `${t('diagnostics.device.maxTexture')}: ${info.maxTextureSize ?? na}`,
    `${t('diagnostics.device.reducedMotion')}: ${t(info.reducedMotion ? 'diagnostics.device.yes' : 'diagnostics.device.no')}`,
    '',
    `${t('diagnostics.report.results')}:`,
  ];
  if (results.length === 0) {
    lines.push(t('diagnostics.report.noResults'));
  } else {
    for (const r of results) {
      lines.push(
        t('diagnostics.report.resultLine', {
          world: r.world,
          quality: r.quality,
          avg: n1(r.avgFps),
          p5: n1(r.p5Fps),
          slow: `${n1(r.slowPct)}%`,
          size: `${r.width}x${r.height}`,
        }),
      );
    }
  }
  if (musicLog) lines.push('', `${t('diagnostics.music.title')}:`, musicLog);
  return lines.join('\n') + '\n';
}
