/**
 * What happened to the 3D background in this visit: the Diagnostics overlay reads the last issue,
 * the diagnostics report (Settings, Export) the whole list, so a fallback to Basic says why.
 */

/** Why the last WebGL attempt was turned down, read by the Diagnostics overlay (null = none yet). */
let latest: string | null = null;

export type WebglEventKind =
  'probe-failed' | 'init-failed' | 'started' | 'lost' | 'restored' | 'not-restored' | 'gave-up';

export interface WebglEvent {
  /** Epoch ms. */
  at: number;
  kind: WebglEventKind;
  reason?: string;
}

/** Enough for a few retries and losses; the oldest go first. */
export const MAX_WEBGL_EVENTS = 30;
let events: WebglEvent[] = [];

export function logWebglEvent(kind: WebglEventKind, reason?: string, at = Date.now()): void {
  events = [...events, reason === undefined ? { at, kind } : { at, kind, reason }].slice(
    -MAX_WEBGL_EVENTS,
  );
}

export const readWebglEvents = (): readonly WebglEvent[] => events;

const two = (n: number): string => String(n).padStart(2, '0');

/**
 * One line per event, the rider's local time first and UTC next to it
 * ("13:03:04 (12:03:04 UTC) probe-failed: getContext returned null"); empty when none.
 */
export function webglLogText(list: readonly WebglEvent[] = events): string {
  return list
    .map((e) => {
      const d = new Date(e.at);
      const local = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
      const utc = d.toISOString().slice(11, 19);
      return `${local} (${utc} UTC) ${e.kind}${e.reason ? `: ${e.reason}` : ''}`;
    })
    .join('\n');
}

export const publishWebglIssue = (reason: string): void => {
  latest = reason;
};
export const readWebglIssue = (): string | null => latest;
export const clearWebglIssue = (): void => {
  latest = null;
};

export function resetWebglLogForTests(): void {
  latest = null;
  events = [];
}
