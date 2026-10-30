export interface Sound {
  tick(): void;
  segment(): void;
  finish(): void;
  setEnabled(enabled: boolean): void;
  /** Creates/resumes the AudioContext; call from a user gesture (Start). */
  unlock(): void;
}

const TICK = { hz: 660, sec: 0.12 };
const SEGMENT = { hz: 880, sec: 0.25 };
const FINISH_TONES = [660, 880, 1100];
const FINISH_STEP_SEC = 0.18;
const TAIL_SEC = 0.02;

/** WebAudio sine beeps. The AudioContext is created lazily so it can start on a user gesture. */
export function createSound(ctx?: AudioContext): Sound {
  let ac = ctx;
  let enabled = true;

  const context = (): AudioContext | undefined => {
    if (!ac) {
      try {
        ac = typeof AudioContext === 'undefined' ? undefined : new AudioContext();
      } catch {
        ac = undefined;
      }
    }
    if (ac && ac.state === 'suspended') void ac.resume().catch(() => undefined);
    return ac;
  };

  const beep = (hz: number, sec: number, offsetSec = 0, volume = 0.2): void => {
    if (!enabled) return;
    try {
      const c = context();
      if (!c) return;
      const at = c.currentTime + offsetSec;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(volume, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + sec);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(at);
      osc.stop(at + sec + TAIL_SEC);
    } catch {
      // Sound must never disturb the workout.
    }
  };

  return {
    tick: () => beep(TICK.hz, TICK.sec),
    segment: () => beep(SEGMENT.hz, SEGMENT.sec, 0, 0.24),
    finish: () => FINISH_TONES.forEach((hz, i) => beep(hz, 0.22, i * FINISH_STEP_SEC, 0.24)),
    setEnabled(b) {
      enabled = b;
    },
    unlock() {
      context();
    },
  };
}
