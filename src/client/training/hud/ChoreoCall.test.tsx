import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Segment } from '../../../domain/segments';
import type { EngineState } from '../../../domain/session-engine';
import type { TrackRef } from '../../../domain/workout';
import { setLang } from '../../i18n';
import { useSessionStore } from '../session-store';
import { ChoreoCall } from './ChoreoCall';

const seg = (index: number, startSec: number, over: Partial<Segment> = {}): Segment => ({
  index,
  startSec,
  durationSec: 30,
  kind: 'steady',
  ftpPctStart: 70,
  ftpPctEnd: 70,
  effortStart: 6,
  effortEnd: 6,
  rpm: 63,
  position: 'seated',
  blockId: `b${index}`,
  rep: 1,
  reps: 1,
  ...over,
});
const segments = [seg(0, 0), seg(1, 30, { position: 'standing' })];

// 126 BPM, bar line at 0; the chorus starts at 60 s of the song, with the standing block
const song: TrackRef = {
  provider: 'youtube',
  id: 'AAAAAAAAAAA',
  title: 'Song',
  startAtSec: 30,
  choreo: { bpm: 126, downbeatSec: 0, beatsPerBar: 4, marks: [{ t: 60, kind: 'chorus' }] },
};

function setEngine(patch: Partial<EngineState>): void {
  const base: EngineState = {
    status: 'running',
    segmentIndex: 0,
    workoutElapsedSec: 0,
    segmentElapsedSec: 0,
    segmentRemainingSec: 30,
  };
  useSessionStore.setState({ state: { ...base, ...patch } });
}

/** Moves the fake clock by `ms` and lets the animation frames run. */
const run = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'setInterval',
      'clearInterval',
      'performance',
      'Date',
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
  setLang('en');
  useSessionStore.setState({
    state: {
      status: 'idle',
      segmentIndex: 0,
      workoutElapsedSec: 0,
      segmentElapsedSec: 0,
      segmentRemainingSec: 0,
    },
  });
});

describe('ChoreoCall', () => {
  it('counts the stand on the chorus in on the beat, then is quiet', () => {
    // 1.5 s before the standing block (= 3.15 beats at 126 BPM)
    setEngine({ segmentRemainingSec: 1.5 });
    const pos = vi.fn(() => ({ track: song, sec: 58.5 }));
    render(<ChoreoCall getSongPosition={pos} segments={segments} color="#0ff" />);
    run(20);
    const call = screen.getByTestId('choreo-call');
    expect(call).toHaveAttribute('data-move', 'stand');
    expect(call).toHaveAttribute('data-on', 'chorus');
    expect(call).toHaveAttribute('data-count', '4');
    expect(call).toHaveTextContent('Stand up on the chorus');
    expect(screen.getByRole('status')).toHaveTextContent('Stand up on the chorus');
    // the beat runs on between the readings of the player's clock
    setEngine({ segmentRemainingSec: 0.4 });
    run(1100);
    expect(screen.getByTestId('choreo-call')).toHaveAttribute('data-count', '1');
    expect(screen.getByTestId('choreo-beat')).toBeInTheDocument(); // 63 rpm goes with 126 BPM
  });

  it('speaks Polish', () => {
    setLang('pl');
    setEngine({ segmentRemainingSec: 1.5 });
    render(
      <ChoreoCall
        getSongPosition={() => ({ track: song, sec: 58.5 })}
        segments={segments}
        color="#0ff"
      />,
    );
    run(20);
    expect(screen.getByTestId('choreo-call')).toHaveTextContent('Wstajemy na refren');
  });

  it('shows no beat with reduced motion, but still counts in', () => {
    setEngine({ segmentRemainingSec: 1.5 });
    render(
      <ChoreoCall
        getSongPosition={() => ({ track: song, sec: 58.5 })}
        segments={segments}
        color="#0ff"
        reducedMotion
      />,
    );
    run(20);
    expect(screen.queryByTestId('choreo-beat')).toBeNull();
    expect(screen.getByTestId('choreo-call')).toHaveAttribute('data-count', '4');
  });

  it('shows nothing without a song clock, for a song without a grid or while paused', () => {
    setEngine({ segmentRemainingSec: 1.5 });
    const { rerender } = render(
      <ChoreoCall getSongPosition={() => null} segments={segments} color="#0ff" />,
    );
    run(300);
    expect(screen.queryByTestId('choreo')).toBeNull();
    const plain = { ...song, choreo: undefined };
    rerender(
      <ChoreoCall
        getSongPosition={() => ({ track: plain, sec: 58.5 })}
        segments={segments}
        color="#0ff"
      />,
    );
    run(300);
    expect(screen.queryByTestId('choreo')).toBeNull();
    rerender(
      <ChoreoCall
        getSongPosition={() => ({ track: song, sec: 58.5 })}
        segments={segments}
        color="#0ff"
      />,
    );
    setEngine({ status: 'paused', segmentRemainingSec: 1.5 });
    run(300);
    expect(screen.queryByTestId('choreo')).toBeNull();
  });

  it('stops trusting a clock that went quiet', () => {
    setEngine({ segmentRemainingSec: 20 });
    let answer: { track: TrackRef; sec: number } | null = { track: song, sec: 40 };
    render(<ChoreoCall getSongPosition={() => answer} segments={segments} color="#0ff" />);
    run(20);
    expect(screen.getByTestId('choreo')).toHaveAttribute('data-on-beat', 'true');
    answer = null;
    run(400);
    expect(screen.queryByTestId('choreo')).toBeNull();
  });

  it('runs no animation frames while the song has no grid, and keeps the live region mounted', () => {
    setEngine({ segmentRemainingSec: 20 });
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    const plain = { ...song, choreo: undefined };
    let answer: { track: TrackRef; sec: number } | null = { track: plain, sec: 40 };
    render(<ChoreoCall getSongPosition={() => answer} segments={segments} color="#0ff" />);
    run(1000);
    expect(raf).not.toHaveBeenCalled();
    const live = screen.getByRole('status');
    expect(live).toHaveTextContent('');
    // 1.5 s before the standing block, which starts on the chorus: the call is on.
    setEngine({ segmentRemainingSec: 1.5 });
    answer = { track: song, sec: 58.5 };
    run(300);
    expect(raf).toHaveBeenCalled();
    // The same element announces the call: it was there before the call came.
    expect(screen.getByRole('status')).toBe(live);
    expect(live).toHaveTextContent(/\S/);
    raf.mockRestore();
  });
});
