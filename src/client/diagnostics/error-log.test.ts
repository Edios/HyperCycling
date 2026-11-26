import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  errorLogText,
  installErrorLog,
  MAX_ERRORS,
  readErrors,
  resetErrorLogForTests,
} from './error-log';

afterEach(() => resetErrorLogForTests());

describe('error log', () => {
  it('records console errors and warnings while installed, and passes them on', () => {
    const original = console.error;
    const spy = vi.fn();
    console.error = spy;
    const stop = installErrorLog(() => 1000);
    console.error('boom', new Error('bad thing'));
    console.warn('careful');
    stop();
    console.error('after');
    console.error = original;
    expect(spy).toHaveBeenCalledWith('boom', expect.any(Error));
    expect(readErrors().map((e) => [e.kind, e.text])).toEqual([
      ['console.error', 'boom bad thing'],
      ['console.warn', 'careful'],
    ]);
  });

  it('records uncaught errors and unhandled rejections', () => {
    const stop = installErrorLog();
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'x is undefined', error: new Error('x is undefined') }),
    );
    const rejection = new Event('unhandledrejection') as Event & { reason: unknown };
    rejection.reason = new Error('fetch failed');
    window.dispatchEvent(rejection);
    stop();
    expect(readErrors().map((e) => e.kind)).toEqual(['error', 'rejection']);
    expect(errorLogText()).toContain('fetch failed');
  });

  it('keeps only the newest entries', () => {
    const original = console.warn;
    console.warn = () => {};
    const stop = installErrorLog();
    for (let i = 0; i < MAX_ERRORS + 5; i++) console.warn(`w${i}`);
    stop();
    console.warn = original;
    expect(readErrors()).toHaveLength(MAX_ERRORS);
    expect(readErrors()[0]?.text).toBe('w5');
  });

  it('a second install does not double the hooks, and restores console when the last stops', () => {
    const original = console.warn;
    const a = installErrorLog();
    const b = installErrorLog();
    console.warn('once');
    b();
    expect(console.warn).not.toBe(original);
    a();
    expect(console.warn).toBe(original);
    expect(readErrors()).toHaveLength(1);
  });
});
