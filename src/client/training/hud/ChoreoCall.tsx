import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { choreoFrame, type ChoreoFrame } from '../../../domain/choreography';
import type { Segment } from '../../../domain/segments';
import type { TrackChoreo, TrackRef } from '../../../domain/workout';
import { useT } from '../../i18n';
import { useSessionStore } from '../session-store';
import styles from './ChoreoCall.module.css';

/** How often the player's own clock is read; between reads the time runs on. */
export const SONG_CLOCK_POLL_MS = 250;
/** A reading older than this is not trusted (the player stopped answering). */
const SONG_CLOCK_STALE_MS = 1500;

export interface ChoreoCallProps {
  /** The song clock of the music (null = nothing plays, or the player cannot tell). */
  getSongPosition: () => { track: TrackRef; sec: number } | null;
  segments: readonly Segment[];
  color: string;
  /** No beat pulse and no motion; the count-in still shows. */
  reducedMotion?: boolean;
}

interface Reading {
  choreo: TrackChoreo;
  sec: number;
  at: number;
}

const frameKey = (f: ChoreoFrame | null): string =>
  f
    ? `${f.beat}|${f.onBeat ? 1 : 0}|${f.call?.move ?? ''}|${f.call?.count ?? ''}|${f.call?.on ?? ''}`
    : '';

const CALL_KEYS = {
  stand: {
    plain: 'training.choreo.stand',
    chorus: 'training.choreo.standChorus',
    drop: 'training.choreo.standDrop',
  },
  sprint: {
    plain: 'training.choreo.sprint',
    chorus: 'training.choreo.sprintChorus',
    drop: 'training.choreo.sprintDrop',
  },
  sit: { plain: 'training.choreo.sit', chorus: 'training.choreo.sit', drop: 'training.choreo.sit' },
} as const;

/**
 * Choreography of a song with a cue sheet: "Stand up on the chorus in 4… 3… 2… 1" counted on the
 * song's beat, and a light that pulses on the beat while the block's cadence goes with the song.
 * Runs on the player's own clock; without one (no cue sheet, an advert, nothing playing) it shows
 * nothing and the ride is as before.
 */
export function ChoreoCall({
  getSongPosition,
  segments,
  color,
  reducedMotion = false,
}: ChoreoCallProps) {
  const t = useT();
  const [frame, setFrame] = useState<ChoreoFrame | null>(null);
  const getRef = useRef(getSongPosition);
  useEffect(() => {
    getRef.current = getSongPosition;
  });

  useEffect(() => {
    let raf = 0;
    let reading: Reading | null = null;
    let shown = '';
    const show = (next: ChoreoFrame | null): void => {
      const key = frameKey(next);
      if (key !== shown) {
        shown = key;
        setFrame(next);
      }
    };
    const frameAt = (now: number): ChoreoFrame | null => {
      const state = useSessionStore.getState().state;
      const cur = segments[state.segmentIndex];
      if (state.status !== 'running' || !reading || !cur) return null;
      if (now - reading.at >= SONG_CLOCK_STALE_MS) return null;
      const songSec = reading.sec + (now - reading.at) / 1000;
      return choreoFrame(
        reading.choreo,
        songSec,
        cur,
        segments[state.segmentIndex + 1],
        state.segmentRemainingSec,
      );
    };
    // Frames run only while a song with a grid plays; a ride without choreography costs a
    // clock read every 250 ms and nothing per frame.
    const tick = (): void => {
      const next = frameAt(performance.now());
      show(next);
      raf = next ? requestAnimationFrame(tick) : 0;
    };
    const poll = (): void => {
      const now = performance.now();
      const running = useSessionStore.getState().state.status === 'running';
      const pos = running ? getRef.current() : null;
      reading = pos?.track.choreo ? { choreo: pos.track.choreo, sec: pos.sec, at: now } : null;
      if (!reading) {
        cancelAnimationFrame(raf);
        raf = 0;
        show(null);
      } else if (raf === 0) {
        tick();
      }
    };
    poll();
    const timer = setInterval(poll, SONG_CLOCK_POLL_MS);
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(raf);
    };
  }, [segments]);

  const call = frame?.call;
  const label = call ? t(CALL_KEYS[call.move][call.on ?? 'plain']) : '';
  const style: CSSProperties & Record<'--c' | '--beat', string> = {
    '--c': color,
    '--beat': `${Math.round((frame?.countSec ?? 0) * 1000)}ms`,
  };
  // The live region is always mounted (empty when quiet), so even the first call is announced.
  const live = (
    <span role="status" aria-live="polite" className={styles.srOnly}>
      {label}
    </span>
  );
  return (
    <>
      {frame && (
        <div
          className={styles.root}
          style={style}
          data-testid="choreo"
          data-section={frame.section}
          data-on-beat={frame.onBeat ? 'true' : 'false'}
        >
          {frame.onBeat && !reducedMotion && (
            <span
              key={frame.beat}
              className={`${styles.beat} ${frame.beatInBar === 0 ? styles.downbeat : ''}`}
              data-testid="choreo-beat"
              aria-hidden="true"
              title={t('training.choreo.beat')}
            />
          )}
          {call && (
            <div
              className={styles.call}
              data-testid="choreo-call"
              data-move={call.move}
              data-on={call.on}
              data-count={call.count}
              aria-hidden="true"
            >
              <span className={styles.label}>{label}</span>
              <span
                key={call.count}
                className={`${styles.count} ${reducedMotion ? '' : styles.tick}`}
              >
                {call.count}
              </span>
            </div>
          )}
        </div>
      )}
      {/* Said once per call, not on every beat; outside the HUD so it is never remounted. */}
      {live}
    </>
  );
}
