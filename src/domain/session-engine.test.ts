import { describe, expect, it } from 'vitest';
import type { Segment } from './segments';
import { createSessionEngine, restoreSessionEngine, type EngineEvent } from './session-engine';

function makeSegments(durations: number[]): Segment[] {
  let cursor = 0;
  return durations.map((d, index) => {
    const seg: Segment = {
      index,
      startSec: cursor,
      durationSec: d,
      kind: 'steady',
      ftpPctStart: 70,
      ftpPctEnd: 70,
      effortStart: 4,
      effortEnd: 4,
      blockId: `b${index}`,
      rep: 1,
      reps: 1,
    };
    cursor += d;
    return seg;
  });
}

function setup(
  durations: number[],
  opts?: { startCountdownSec?: number; gapThresholdSec?: number },
) {
  let now = 0;
  const engine = createSessionEngine(makeSegments(durations), () => now, opts);
  return {
    engine,
    at(ms: number) {
      now = ms;
    },
    advance(ms: number) {
      now += ms;
    },
    /** Starts and passes the countdown; the workout clock starts at now=3000. */
    startRunning() {
      now = 0;
      engine.start();
      engine.tick();
      now = 3000;
      engine.tick();
    },
  };
}

describe('session engine', () => {
  it('throws on an empty segment list', () => {
    expect(() => createSessionEngine([], () => 0)).toThrow();
  });

  it('starts idle', () => {
    const { engine } = setup([10]);
    expect(engine.getState()).toMatchObject({
      status: 'idle',
      segmentIndex: 0,
      workoutElapsedSec: 0,
    });
    expect(engine.tick()).toEqual([]);
  });

  it('counts down 3-2-1 then runs', () => {
    const t = setup([10, 10]);
    t.engine.start();
    expect(t.engine.getState()).toMatchObject({ status: 'countdown', startCountdown: 3 });
    expect(t.engine.tick()).toEqual([{ type: 'countdownTick', n: 3, phase: 'start' }]);
    t.at(1000);
    expect(t.engine.tick()).toEqual([{ type: 'countdownTick', n: 2, phase: 'start' }]);
    expect(t.engine.getState().startCountdown).toBe(2);
    t.at(2000);
    expect(t.engine.tick()).toEqual([{ type: 'countdownTick', n: 1, phase: 'start' }]);
    t.at(2500);
    expect(t.engine.tick()).toEqual([]);
    t.at(3000);
    expect(t.engine.tick()).toEqual([]);
    const s = t.engine.getState();
    expect(s.status).toBe('running');
    expect(s.startCountdown).toBeUndefined();
    expect(s.workoutElapsedSec).toBe(0);
  });

  it('does not count countdown as workout time', () => {
    const t = setup([10]);
    t.startRunning();
    t.at(5000);
    expect(t.engine.getState().workoutElapsedSec).toBe(2);
  });

  it('honours a custom start countdown', () => {
    const t = setup([10], { startCountdownSec: 1 });
    t.engine.start();
    expect(t.engine.tick()).toEqual([{ type: 'countdownTick', n: 1, phase: 'start' }]);
    t.at(1000);
    t.engine.tick();
    expect(t.engine.getState().status).toBe('running');
  });

  it('changes segment exactly at boundary', () => {
    const t = setup([10, 10]);
    t.startRunning();
    t.at(3000 + 9999);
    expect(t.engine.tick().some((e) => e.type === 'segmentChanged')).toBe(false);
    t.at(3000 + 10_000);
    expect(t.engine.tick()).toEqual([{ type: 'segmentChanged', from: 0, to: 1, skipped: false }]);
    expect(t.engine.getState()).toMatchObject({
      segmentIndex: 1,
      segmentElapsedSec: 0,
      segmentRemainingSec: 10,
    });
  });

  it('emits segmentEnd ticks 3,2,1 before boundary, only once each', () => {
    const t = setup([10, 10]);
    t.startRunning();
    const collected: EngineEvent[] = [];
    for (let ms = 0; ms <= 10_000; ms += 100) {
      t.at(3000 + ms);
      collected.push(...t.engine.tick());
    }
    expect(collected).toEqual([
      { type: 'countdownTick', n: 3, phase: 'segmentEnd' },
      { type: 'countdownTick', n: 2, phase: 'segmentEnd' },
      { type: 'countdownTick', n: 1, phase: 'segmentEnd' },
      { type: 'segmentChanged', from: 0, to: 1, skipped: false },
    ]);
    expect(collected[0]).toBeDefined();
  });

  it('fires segmentEnd 3 at remaining exactly 3s', () => {
    const t = setup([10, 10]);
    t.startRunning();
    for (let ms = 1000; ms <= 6000; ms += 1000) {
      t.at(3000 + ms);
      t.engine.tick();
    }
    t.at(3000 + 7000);
    expect(t.engine.tick()).toEqual([{ type: 'countdownTick', n: 3, phase: 'segmentEnd' }]);
  });

  it('does not emit segmentEnd ticks on the last segment', () => {
    const t = setup([10]);
    t.startRunning();
    const collected: EngineEvent[] = [];
    for (let ms = 0; ms < 10_000; ms += 100) {
      t.at(3000 + ms);
      collected.push(...t.engine.tick());
    }
    expect(collected).toEqual([]);
  });

  it('orders countdown ticks before segmentChanged before finished', () => {
    const t = setup([10, 1]);
    t.startRunning();
    for (let ms = 1000; ms < 10_000; ms += 1000) {
      t.at(3000 + ms);
      t.engine.tick();
    }
    t.at(3000 + 10_000);
    const ev = t.engine.tick();
    expect(ev).toEqual([{ type: 'segmentChanged', from: 0, to: 1, skipped: false }]);
    t.at(3000 + 11_000);
    expect(t.engine.tick()).toEqual([{ type: 'finished' }]);
  });

  it('pause freezes time', () => {
    const t = setup([20, 20]);
    t.startRunning();
    t.at(3000 + 5000);
    t.engine.tick();
    t.engine.pause();
    expect(t.engine.getState().status).toBe('paused');
    t.advance(60_000);
    expect(t.engine.tick()).toEqual([]);
    t.engine.resume();
    expect(t.engine.getState()).toMatchObject({ status: 'running', segmentElapsedSec: 5 });
    t.advance(1000);
    expect(t.engine.tick()).toEqual([]);
    expect(t.engine.getState().segmentElapsedSec).toBe(6);
  });

  it('does not treat a pause as a long gap', () => {
    const t = setup([20, 20]);
    t.startRunning();
    t.at(3000 + 5000);
    t.engine.tick();
    t.engine.pause();
    t.advance(60_000);
    t.engine.tick();
    t.engine.resume();
    t.advance(500);
    expect(t.engine.tick()).toEqual([]);
  });

  it('prev within 3s goes back, after 3s restarts', () => {
    const t = setup([20, 20, 20]);
    t.startRunning();
    t.at(3000 + 20_000 + 2000);
    t.engine.tick();
    expect(t.engine.getState().segmentIndex).toBe(1);
    t.engine.prev();
    expect(t.engine.getState()).toMatchObject({ segmentIndex: 0, segmentElapsedSec: 0 });
    expect(t.engine.tick()).toEqual([{ type: 'segmentChanged', from: 1, to: 0, skipped: true }]);

    t.advance(5000);
    t.engine.tick();
    t.engine.prev();
    expect(t.engine.getState()).toMatchObject({ segmentIndex: 0, segmentElapsedSec: 0 });
    expect(t.engine.tick()).toEqual([]);
  });

  it('prev at index 0 within 3s restarts the segment', () => {
    const t = setup([20, 20]);
    t.startRunning();
    t.at(3000 + 1000);
    t.engine.tick();
    t.engine.prev();
    expect(t.engine.getState()).toMatchObject({ segmentIndex: 0, segmentElapsedSec: 0 });
  });

  it('next moves to the following segment with skipped change on next tick', () => {
    const t = setup([20, 20, 20]);
    t.startRunning();
    t.at(3000 + 4000);
    t.engine.tick();
    t.engine.next();
    expect(t.engine.getState()).toMatchObject({
      segmentIndex: 1,
      segmentElapsedSec: 0,
      workoutElapsedSec: 20,
    });
    expect(t.engine.tick()).toEqual([{ type: 'segmentChanged', from: 0, to: 1, skipped: true }]);
    expect(t.engine.tick()).toEqual([]);
  });

  it('next on last finishes', () => {
    const t = setup([10, 10]);
    t.startRunning();
    t.at(3000 + 12_000);
    t.engine.tick();
    t.engine.next();
    expect(t.engine.getState()).toMatchObject({
      status: 'finished',
      segmentIndex: 1,
      workoutElapsedSec: 20,
      segmentRemainingSec: 0,
    });
    expect(t.engine.tick()).toEqual([{ type: 'finished' }]);
    expect(t.engine.tick()).toEqual([]);
  });

  it('re-arms segmentEnd ticks when restarting a segment', () => {
    const t = setup([10, 10]);
    t.startRunning();
    for (let ms = 100; ms <= 9500; ms += 100) {
      t.at(3000 + ms);
      t.engine.tick();
    }
    t.engine.prev(); // elapsed > 3s: restarts segment 0
    const collected: EngineEvent[] = [];
    for (let ms = 100; ms <= 10_000; ms += 100) {
      t.at(3000 + 9500 + ms);
      collected.push(...t.engine.tick());
    }
    expect(collected).toEqual([
      { type: 'countdownTick', n: 3, phase: 'segmentEnd' },
      { type: 'countdownTick', n: 2, phase: 'segmentEnd' },
      { type: 'countdownTick', n: 1, phase: 'segmentEnd' },
      { type: 'segmentChanged', from: 0, to: 1, skipped: false },
    ]);
  });

  it('suppresses segmentEnd ticks already passed after a jump', () => {
    const t = setup([10, 2, 10]);
    t.startRunning();
    t.engine.seek(1); // remaining 2s: ticks 3 and 2 are already passed
    const collected: EngineEvent[] = [];
    for (let ms = 0; ms <= 2000; ms += 100) {
      t.at(3000 + ms);
      collected.push(...t.engine.tick());
    }
    expect(collected).toEqual([
      { type: 'segmentChanged', from: 0, to: 1, skipped: true },
      { type: 'countdownTick', n: 1, phase: 'segmentEnd' },
      { type: 'segmentChanged', from: 1, to: 2, skipped: false },
    ]);
  });

  it('seek clamps and keeps paused status', () => {
    const t = setup([10, 10, 10]);
    t.startRunning();
    t.engine.pause();
    t.engine.seek(99);
    expect(t.engine.getState()).toMatchObject({
      status: 'paused',
      segmentIndex: 2,
      segmentElapsedSec: 0,
    });
    expect(t.engine.tick()).toEqual([{ type: 'segmentChanged', from: 0, to: 2, skipped: true }]);
    t.engine.seek(-5);
    expect(t.engine.getState()).toMatchObject({ status: 'paused', segmentIndex: 0 });
    t.engine.next();
    expect(t.engine.getState().status).toBe('paused');
    t.engine.prev();
    expect(t.engine.getState().status).toBe('paused');
  });

  it('next on last while paused finishes', () => {
    const t = setup([10]);
    t.startRunning();
    t.engine.pause();
    t.engine.next();
    expect(t.engine.getState().status).toBe('finished');
  });

  it('long gap: one skipped change, no beeps', () => {
    const t = setup([10, 10, 10]);
    t.startRunning();
    t.at(3000 + 1000);
    t.engine.tick();
    t.advance(25_000);
    expect(t.engine.tick()).toEqual([{ type: 'segmentChanged', from: 0, to: 2, skipped: true }]);
    expect(t.engine.getState()).toMatchObject({ segmentIndex: 2, segmentElapsedSec: 6 });
  });

  it('long gap with no index change emits nothing and does not beep late', () => {
    const t = setup([100, 10]);
    t.startRunning();
    t.engine.tick();
    t.advance(2500);
    expect(t.engine.tick()).toEqual([]);
  });

  it('long gap landing in the end window of a segment is silent', () => {
    const t = setup([30, 10]);
    t.startRunning();
    t.advance(1000);
    t.engine.tick();
    t.advance(28_500); // 29.5s elapsed: remaining 0.5 in segment 0
    expect(t.engine.tick()).toEqual([]);
    t.advance(100);
    expect(t.engine.tick()).toEqual([]);
  });

  it('long gap reaching the end gives skipped change then finished', () => {
    const t = setup([10, 10, 10]);
    t.startRunning();
    t.advance(1000);
    t.engine.tick();
    t.advance(120_000);
    expect(t.engine.tick()).toEqual([
      { type: 'segmentChanged', from: 0, to: 2, skipped: true },
      { type: 'finished' },
    ]);
    expect(t.engine.getState()).toMatchObject({
      status: 'finished',
      workoutElapsedSec: 30,
      segmentIndex: 2,
    });
  });

  it('gap during countdown moves silently into the workout', () => {
    const t = setup([10, 10]);
    t.engine.start();
    t.engine.tick();
    t.at(15_000);
    expect(t.engine.tick()).toEqual([{ type: 'segmentChanged', from: 0, to: 1, skipped: true }]);
  });

  it('snapshot/restore resumes paused at same place', () => {
    const t = setup([20, 20]);
    t.startRunning();
    t.at(3000 + 25_000);
    t.engine.tick();
    const snap = t.engine.snapshot();
    expect(snap).toEqual({ segmentIndex: 1, workoutElapsedSec: 25, status: 'running' });

    t.advance(120_000);
    const restored = restoreSessionEngine(
      makeSegments([20, 20]),
      () => 3000 + 25_000 + 120_000,
      snap,
    );
    expect(restored.getState()).toMatchObject({
      status: 'paused',
      segmentIndex: 1,
      workoutElapsedSec: 25,
      segmentElapsedSec: 5,
    });
    expect(restored.tick()).toEqual([]);
    restored.resume();
    expect(restored.getState().status).toBe('running');
    expect(restored.snapshot().status).toBe('running');
  });

  it('snapshot while paused reports paused and restore clamps elapsed', () => {
    const t = setup([10]);
    t.startRunning();
    t.engine.pause();
    expect(t.engine.snapshot().status).toBe('paused');
    const restored = restoreSessionEngine(makeSegments([10]), () => 0, {
      segmentIndex: 0,
      workoutElapsedSec: 999,
      status: 'paused',
    });
    expect(restored.getState().workoutElapsedSec).toBe(10);
  });

  it('finishes at total duration and stays finished', () => {
    const t = setup([10, 10]);
    t.startRunning();
    t.at(3000 + 19_999);
    expect(t.engine.tick().some((e) => e.type === 'finished')).toBe(false);
    t.at(3000 + 20_000);
    expect(t.engine.tick()).toEqual([{ type: 'finished' }]);
    expect(t.engine.getState()).toMatchObject({
      status: 'finished',
      workoutElapsedSec: 20,
      segmentIndex: 1,
      segmentRemainingSec: 0,
    });
    t.advance(10_000);
    expect(t.engine.tick()).toEqual([]);
    t.engine.start();
    t.engine.resume();
    t.engine.pause();
    t.engine.next();
    t.engine.prev();
    t.engine.seek(0);
    expect(t.engine.getState().status).toBe('finished');
    expect(t.engine.getState().segmentIndex).toBe(1);
    expect(t.engine.snapshot().status).toBe('paused');
  });

  it('ignores controls that do not apply', () => {
    const t = setup([10, 10]);
    t.engine.pause();
    t.engine.resume();
    t.engine.next();
    t.engine.prev();
    t.engine.seek(1);
    expect(t.engine.getState().status).toBe('idle');
    t.engine.start();
    t.engine.start();
    t.engine.next();
    expect(t.engine.getState().status).toBe('countdown');
    t.engine.pause(); // cancels the countdown
    expect(t.engine.getState().status).toBe('idle');
    t.engine.start();
    t.startRunning();
    t.engine.resume(); // already running
    t.engine.start(); // already running
    expect(t.engine.getState().status).toBe('running');
  });

  describe('fix round 1', () => {
    it('pause at or after the end finishes immediately', () => {
      const t = setup([10]);
      t.startRunning();
      t.at(3000 + 10_000);
      t.engine.pause();
      expect(t.engine.getState().status).toBe('finished');
      expect(t.engine.tick()).toEqual([{ type: 'finished' }]);
    });

    it('pause during countdown cancels back to idle; next/prev stay no-ops', () => {
      const t = setup([10, 10]);
      t.engine.start();
      t.engine.tick();
      t.engine.next();
      t.engine.prev();
      expect(t.engine.getState().status).toBe('countdown');
      t.engine.pause();
      expect(t.engine.getState().status).toBe('idle');
      expect(t.engine.tick()).toEqual([]);
      t.at(5000);
      t.engine.start();
      expect(t.engine.tick()).toEqual([{ type: 'countdownTick', n: 3, phase: 'start' }]);
    });

    it('seek truncates and ignores non-finite input', () => {
      const t = setup([10, 10, 10]);
      t.startRunning();
      t.engine.seek(1.9);
      expect(t.engine.getState().segmentIndex).toBe(1);
      t.engine.seek(Number.NaN);
      t.engine.seek(Number.POSITIVE_INFINITY);
      expect(t.engine.getState().segmentIndex).toBe(1);
    });

    it('restore accepts options and sanitises elapsed', () => {
      const segs = makeSegments([10, 10]);
      for (const bad of [Number.NaN, -5, Number.NEGATIVE_INFINITY]) {
        const e = restoreSessionEngine(segs, () => 0, {
          segmentIndex: 0,
          workoutElapsedSec: bad,
          status: 'paused',
        });
        expect(e.getState().workoutElapsedSec).toBe(0);
      }
      const big = restoreSessionEngine(segs, () => 0, {
        segmentIndex: 0,
        workoutElapsedSec: 1e9,
        status: 'paused',
      });
      expect(big.getState().workoutElapsedSec).toBe(20);
      let now = 0;
      const e = restoreSessionEngine(
        segs,
        () => now,
        { segmentIndex: 0, workoutElapsedSec: 1, status: 'paused' },
        { gapThresholdSec: 100 },
      );
      e.resume();
      e.tick();
      now = 10_000;
      expect(e.tick()).toEqual([{ type: 'segmentChanged', from: 0, to: 1, skipped: false }]);
    });

    it('index and remaining time agree at fractional boundaries', () => {
      const t = setup([0.1, 0.2, 10]);
      t.startRunning();
      for (let ms = 0; ms <= 600; ms += 10) {
        t.at(3000 + ms);
        t.engine.tick();
        const s = t.engine.getState();
        expect(s.segmentRemainingSec).toBeGreaterThan(0);
        expect(s.segmentElapsedSec).toBeGreaterThanOrEqual(0);
      }
    });

    it('canResume is false when idle or finished, true otherwise', () => {
      const t = setup([10]);
      expect(t.engine.canResume()).toBe(false);
      t.engine.start();
      expect(t.engine.canResume()).toBe(false);
      t.startRunning();
      expect(t.engine.canResume()).toBe(true);
      t.engine.pause();
      expect(t.engine.canResume()).toBe(true);
      t.engine.next();
      expect(t.engine.canResume()).toBe(false);
    });
  });
});
