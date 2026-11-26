import { describe, expect, it } from 'vitest';
import { createTapCounter, diagParam, isDiagShortcut } from './toggle';

describe('diagParam', () => {
  it('reads ?diag from the search part or the hash route', () => {
    expect(diagParam('?diag', '')).toBe(true);
    expect(diagParam('?diag=1', '')).toBe(true);
    expect(diagParam('?diag=0', '')).toBe(false);
    expect(diagParam('?diag=off', '')).toBe(false);
    expect(diagParam('', '#/train?diag')).toBe(true);
    expect(diagParam('?x=1', '#/')).toBeUndefined();
  });
});

describe('isDiagShortcut', () => {
  const k = (o: Partial<KeyboardEvent>): KeyboardEvent =>
    ({
      code: 'KeyD',
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...o,
    }) as KeyboardEvent;

  it('is Ctrl+Shift+D (Cmd on a Mac) only', () => {
    expect(isDiagShortcut(k({ ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isDiagShortcut(k({ metaKey: true, shiftKey: true }))).toBe(true);
    expect(isDiagShortcut(k({ ctrlKey: true }))).toBe(false);
    expect(isDiagShortcut(k({ ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false);
    expect(isDiagShortcut(k({ ctrlKey: true, shiftKey: true, code: 'KeyE' }))).toBe(false);
  });
});

describe('createTapCounter', () => {
  it('fires on the fifth tap within the window and starts over', () => {
    const tap = createTapCounter(5, 2000);
    expect([0, 100, 200, 300].map((t) => tap(t))).toEqual([false, false, false, false]);
    expect(tap(400)).toBe(true);
    expect(tap(500)).toBe(false);
  });

  it('forgets taps older than the window', () => {
    const tap = createTapCounter(5, 2000);
    for (const t of [0, 100, 200, 300]) tap(t);
    expect(tap(2500)).toBe(false);
  });
});
