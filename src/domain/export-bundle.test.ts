import { describe, expect, it } from 'vitest';
import { parseExportBundle } from './export-bundle';
import { DEFAULT_SETTINGS } from './settings';

const good = () => ({
  app: 'spinning-tutor',
  schemaVersion: 1,
  exportedAt: '2026-01-01T00:00:00Z',
  workouts: [],
  players: [{ id: 'p1', name: 'Ola', ftp: 200 }] as Array<Record<string, unknown>>,
  planProgress: [],
  sessionLogs: [],
  settings: DEFAULT_SETTINGS as unknown,
});

describe('parseExportBundle', () => {
  it('accepts an object', () => {
    expect(parseExportBundle(good()).ok).toBe(true);
  });
  it('accepts a JSON string and null settings', () => {
    expect(parseExportBundle(JSON.stringify({ ...good(), settings: null })).ok).toBe(true);
  });
  it('rejects non JSON strings', () => {
    expect(parseExportBundle('{nope')).toEqual({ ok: false, reason: 'notJson' });
  });
  it('rejects wrong app', () => {
    expect(parseExportBundle({ ...good(), app: 'other' })).toMatchObject({
      ok: false,
      reason: 'wrongApp',
    });
  });
  it('rejects non object values as wrongApp', () => {
    expect(parseExportBundle(42)).toMatchObject({ ok: false, reason: 'wrongApp' });
    expect(parseExportBundle(null)).toMatchObject({ ok: false, reason: 'wrongApp' });
  });
  it('rejects schemaVersion 2 and 0', () => {
    expect(parseExportBundle({ ...good(), schemaVersion: 2 })).toMatchObject({
      ok: false,
      reason: 'unsupportedVersion',
    });
    expect(parseExportBundle({ ...good(), schemaVersion: 0 })).toMatchObject({
      ok: false,
      reason: 'unsupportedVersion',
    });
  });
  it('reports the first schema issue with path', () => {
    const b = good();
    b.players = [{ id: 'p1', name: 'Ola', ftp: 9999 }];
    const r = parseExportBundle(b);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid');
      expect(r.details).toContain('players.0.ftp');
    }
  });
  it('rejects two isMe players', () => {
    const b = good();
    b.players = [
      { id: 'a', name: 'A', ftp: 200, isMe: true },
      { id: 'b', name: 'B', ftp: 200, isMe: true },
    ];
    expect(parseExportBundle(b)).toMatchObject({ ok: false, reason: 'invalid' });
  });
  it('rejects missing collections', () => {
    const rest: Record<string, unknown> = { ...good() };
    delete rest.workouts;
    expect(parseExportBundle(rest)).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('parseExportBundle duplicate ids', () => {
  it.each(['workouts', 'players', 'planProgress', 'sessionLogs'] as const)(
    'rejects duplicate ids in %s naming collection and id',
    (key) => {
      const item =
        key === 'players'
          ? { id: 'dup', name: 'A', ftp: 200 }
          : key === 'planProgress'
            ? {
                id: 'dup',
                planId: 'dup',
                startedAt: '2026-01-01T00:00:00Z',
                settings: {
                  sessionMinutes: 45,
                  difficulty: 0,
                  layout: 'progresFreestyle',
                  startWeek: 1,
                },
                entries: [],
              }
            : key === 'sessionLogs'
              ? {
                  id: 'dup',
                  workoutId: 'w',
                  startedAt: '2026-01-01T00:00:00Z',
                  endedAt: '2026-01-01T00:10:00Z',
                  riddenSec: 1,
                  completed: false,
                  playerIds: [],
                  config: { background: 'basic', hud: 'solo', playerIds: [], music: false },
                }
              : {
                  id: 'dup',
                  name: 'W',
                  description: '',
                  category: 'progres',
                  tags: [],
                  source: { kind: 'user' },
                  blocks: [],
                  musicCues: [],
                  fallbackPlaylist: [],
                  schemaVersion: 1,
                  updatedAt: '2026-01-01T00:00:00Z',
                };
      const r = parseExportBundle({ ...good(), [key]: [item, structuredClone(item)] });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe('invalid');
        expect(r.details).toContain(key);
        expect(r.details).toContain('dup');
      }
    },
  );
  it('rejects a non ISO exportedAt', () => {
    expect(parseExportBundle({ ...good(), exportedAt: 'yesterday' }).ok).toBe(false);
  });
});
