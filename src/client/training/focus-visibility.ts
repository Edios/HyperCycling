/** How long the Focus HUD stays after the last mouse / touch / key input. */
export const FOCUS_INPUT_HOLD_MS = 3000;
/** The HUD fades in this long before a block ends, so riders see what comes next. */
export const FOCUS_BEFORE_BLOCK_END_SEC = 5;
/** ...and stays this long after the next block started. */
export const FOCUS_AFTER_BLOCK_START_SEC = 4;
/** The finish is always shown: the last seconds of the whole workout. */
export const FOCUS_FINAL_SEC = 10;

export interface FocusInput {
  status: 'idle' | 'countdown' | 'running' | 'paused' | 'finished';
  /** Monotonic wall-clock time (ms) and the time of the last user input on the same clock. */
  nowMs: number;
  lastInputMs: number;
  blockElapsedSec: number;
  blockRemainingSec: number;
  workoutRemainingSec: number;
  /** An end dialog or the quick settings are open. */
  dialogOpen: boolean;
}

/** Whether the Focus layout shows its HUD right now (pure; the screen only animates the result). */
export function focusVisible(i: FocusInput): boolean {
  if (i.status !== 'running' || i.dialogOpen) return true;
  if (i.nowMs - i.lastInputMs < FOCUS_INPUT_HOLD_MS) return true;
  if (i.blockRemainingSec <= FOCUS_BEFORE_BLOCK_END_SEC) return true;
  if (i.blockElapsedSec < FOCUS_AFTER_BLOCK_START_SEC) return true;
  return i.workoutRemainingSec <= FOCUS_FINAL_SEC;
}
