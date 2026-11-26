/**
 * Console errors and warnings, uncaught exceptions and unhandled rejections, recorded only while
 * diagnostics mode is on (installErrorLog), so the app runs untouched when it is off.
 */

export type ErrorKind = 'console.error' | 'console.warn' | 'error' | 'rejection';

export interface ErrorEntry {
  /** Epoch ms. */
  at: number;
  kind: ErrorKind;
  text: string;
}

export const MAX_ERRORS = 50;
const MAX_TEXT = 500;

let entries: ErrorEntry[] = [];
let installs = 0;
let uninstall: (() => void) | null = null;

function describe(v: unknown): string {
  if (v instanceof Error) return v.message || v.name;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function add(kind: ErrorKind, parts: readonly unknown[], now: () => number): void {
  try {
    const text = parts.map(describe).join(' ').slice(0, MAX_TEXT);
    entries = [...entries, { at: now(), kind, text }].slice(-MAX_ERRORS);
  } catch {
    // the log must never break the app
  }
}

function hook(now: () => number): () => void {
  const { error, warn } = console;
  console.error = (...args: unknown[]) => {
    add('console.error', args, now);
    error.apply(console, args);
  };
  console.warn = (...args: unknown[]) => {
    add('console.warn', args, now);
    warn.apply(console, args);
  };
  const onError = (e: ErrorEvent): void => add('error', [e.error ?? e.message], now);
  const onRejection = (e: PromiseRejectionEvent): void => add('rejection', [e.reason], now);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    console.error = error;
    console.warn = warn;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

/**
 * Starts recording; returns the stop function. Nested installs share one set of hooks. Stopping
 * puts back the console methods from the moment recording started, so a wrapper another script
 * adds while the mode is on is dropped when it is turned off (no such script in the app).
 */
export function installErrorLog(now: () => number = Date.now): () => void {
  installs += 1;
  if (installs === 1) uninstall = hook(now);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    installs -= 1;
    if (installs === 0) {
      uninstall?.();
      uninstall = null;
    }
  };
}

export const readErrors = (): readonly ErrorEntry[] => entries;

const two = (n: number): string => String(n).padStart(2, '0');

/** One line per entry, local time first ("13:03:04 console.error: boom"); empty when none. */
export function errorLogText(list: readonly ErrorEntry[] = entries): string {
  return list
    .map((e) => {
      const d = new Date(e.at);
      return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())} ${e.kind}: ${e.text}`;
    })
    .join('\n');
}

export function resetErrorLogForTests(): void {
  uninstall?.();
  uninstall = null;
  installs = 0;
  entries = [];
}
