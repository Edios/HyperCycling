import { describe, expect, it } from 'vitest';
import { sessionConfigSchema, type SessionConfig } from './settings';
import {
  activeSessionSchema,
  isActiveSessionFresh,
  sessionLogSchema,
  type ActiveSession,
} from './session-log';

const config: SessionConfig = { background: 'basic', hud: 'solo', playerIds: ['p1'], music: false };
const active = (savedAt: string): ActiveSession => ({
  workoutId: 'w1',
  config,
  snapshot: { segmentIndex: 1, workoutElapsedSec: 30, status: 'paused' },
  savedAt,
});

describe('isActiveSessionFresh', () => {
  const now = '2026-01-01T12:00:00.000Z';
  it('is fresh within 2 h', () => {
    expect(isActiveSessionFresh(active('2026-01-01T10:30:00.000Z'), now)).toBe(true);
  });
  it('is fresh at exactly 2 h', () => {
    expect(isActiveSessionFresh(active('2026-01-01T10:00:00.000Z'), now)).toBe(true);
  });
  it('is stale after 2 h', () => {
    expect(isActiveSessionFresh(active('2026-01-01T09:59:59.000Z'), now)).toBe(false);
  });
  it('honours a custom max age', () => {
    expect(isActiveSessionFresh(active('2026-01-01T11:50:00.000Z'), now, 60_000)).toBe(false);
  });
  it('treats unparsable dates as stale', () => {
    expect(isActiveSessionFresh(active('garbage'), now)).toBe(false);
    expect(isActiveSessionFresh(active(now), 'garbage')).toBe(false);
  });
});

describe('schemas', () => {
  const log = {
    id: 's1',
    workoutId: 'w1',
    startedAt: '2026-01-01T10:00:00Z',
    endedAt: '2026-01-01T10:30:00Z',
    riddenSec: 10,
    completed: false,
    playerIds: [],
    config,
  };
  it('accepts a session log', () => {
    expect(sessionLogSchema.safeParse(log).success).toBe(true);
  });
  it('rejects negative riddenSec', () => {
    expect(sessionLogSchema.safeParse({ ...log, riddenSec: -1 }).success).toBe(false);
  });
  it('accepts an active session with plan and rejects bad slot', () => {
    const a = {
      ...active('2026-01-01T00:00:00Z'),
      plan: { planId: 'p', week: 1, slot: 'progres' },
    };
    expect(activeSessionSchema.safeParse(a).success).toBe(true);
    expect(
      activeSessionSchema.safeParse({ ...a, plan: { planId: 'p', week: 1, slot: 'x' } }).success,
    ).toBe(false);
  });
});

describe('schema extras', () => {
  it('rejects more than 10 playerIds in a session config', () => {
    const cfg = {
      background: 'basic',
      hud: 'solo',
      playerIds: Array.from({ length: 11 }, (_, i) => `p${i}`),
      music: false,
    };
    expect(sessionConfigSchema.safeParse(cfg).success).toBe(false);
  });
  it('rejects a non ISO savedAt', () => {
    expect(activeSessionSchema.safeParse({ ...active('nope') }).success).toBe(false);
  });
});
