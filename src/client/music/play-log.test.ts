import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearMusicLog,
  formatMusicLog,
  getMusicLog,
  logMusicEvent,
  MAX_LOG,
  resetMusicLogForTests,
  subscribeMusicLog,
} from './play-log';
import { getMusicSource, setMusicSource } from './music-source';

const track = { provider: 'youtube', id: 'abc', title: 'Song', startAtSec: 0 } as const;

beforeEach(() => {
  localStorage.clear();
  resetMusicLogForTests();
});

describe('music log', () => {
  it('records which recording played or failed, with the reason', () => {
    logMusicEvent(
      { track, index: 0, total: 3, outcome: 'failed', error: new Error('error 150') },
      1,
    );
    logMusicEvent({ track, index: 1, total: 3, outcome: 'played' }, 2);
    const log = getMusicLog();
    expect(log.map((e) => `${e.outcome}#${e.index}`)).toEqual(['failed#0', 'played#1']);
    expect(log[0]?.error).toBe('error 150');
    expect(formatMusicLog(log)).toContain('failed #0 youtube:abc Song (error 150)');
  });

  it('keeps the last entries only, survives a reload and can be cleared', () => {
    for (let i = 0; i < MAX_LOG + 5; i++) {
      logMusicEvent({ track, index: i, total: 0, outcome: 'played' }, i);
    }
    expect(getMusicLog()).toHaveLength(MAX_LOG);
    resetMusicLogForTests(); // like a page reload: read again from storage
    expect(getMusicLog()).toHaveLength(MAX_LOG);
    const seen = vi.fn();
    subscribeMusicLog(seen);
    clearMusicLog();
    expect(getMusicLog()).toEqual([]);
    expect(seen).toHaveBeenCalled();
  });

  it('works when storage is broken', () => {
    localStorage.setItem('hypercycling.music.log', '{nope');
    expect(getMusicLog()).toEqual([]);
    logMusicEvent({ track, index: 0, total: 1, outcome: 'played' });
    expect(getMusicLog()).toHaveLength(1);
  });
});

describe('music source setting', () => {
  it('is YouTube until the rider chooses, and ignores junk', () => {
    expect(getMusicSource()).toBe('youtube');
    setMusicSource('auto');
    expect(getMusicSource()).toBe('auto');
    localStorage.setItem('hypercycling.music.source', 'tape');
    expect(getMusicSource()).toBe('youtube');
  });
});
