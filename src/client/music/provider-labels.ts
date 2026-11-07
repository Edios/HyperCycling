import type { BpmSource } from '../../domain/workout';
import type { MessageKey } from '../i18n';
import { DEEZER_SITE } from './deezer/client';
import { GETSONGBPM_SITE, GetSongBpmError, type GetSongBpmErrorKind } from './getsongbpm/client';

export type ErrorInfo = { kind: GetSongBpmErrorKind; provider: BpmSource };

const ERROR_KEY = {
  'no-key': 'editor.bpm.err.noKey',
  forbidden: 'editor.bpm.err.forbidden',
  unauthorized: 'editor.bpm.err.unauthorized',
  'rate-limited': 'editor.bpm.err.rateLimited',
  blocked: 'editor.bpm.err.blocked',
  network: 'editor.bpm.err.network',
  'bad-response': 'editor.bpm.err.badResponse',
} as const;

export const BRAND: Record<BpmSource, string> = { getsongbpm: 'GetSongBPM', deezer: 'Deezer' };
export const SITE: Record<BpmSource, string> = { getsongbpm: GETSONGBPM_SITE, deezer: DEEZER_SITE };

/** Deezer-specific wording for the two errors a keyless rider can meet; the rest is generic. */
export function errorText(t: (key: MessageKey) => string, e: ErrorInfo): string {
  if (e.provider === 'deezer') {
    if (e.kind === 'network') return t('editor.bpm.err.deezerNetwork');
    if (e.kind === 'bad-response') return t('editor.bpm.err.deezerBadResponse');
    if (e.kind === 'rate-limited') return t('editor.bpm.err.deezerRateLimited');
  }
  return t(ERROR_KEY[e.kind]);
}

export function errorInfo(err: unknown): ErrorInfo {
  return err instanceof GetSongBpmError
    ? { kind: err.kind, provider: err.provider }
    : { kind: 'network', provider: 'getsongbpm' };
}
