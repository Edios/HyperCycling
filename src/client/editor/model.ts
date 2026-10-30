import { ftpPctToEffort, type EffortLevel, type EffortTable } from '../../domain/effort';
import { flattenWorkout } from '../../domain/segments';
import { newId } from '../../domain/ids';
import {
  workoutSchema,
  type Block,
  type Intensity,
  type RampBlock,
  type RepeatBlock,
  type SteadyBlock,
  type Workout,
} from '../../domain/workout';
import type { EditorAction, EditorState } from './editor-state';

export type Leaf = SteadyBlock | RampBlock;

/** Block ids in the order ←/→ walks them: a repeat, then its children. */
export function selectionOrder(w: Workout): string[] {
  const ids: string[] = [];
  for (const b of w.blocks) {
    ids.push(b.id);
    if (b.kind === 'repeat') for (const c of b.blocks) ids.push(c.id);
  }
  return ids;
}

export function findBlock(w: Workout, id: string | undefined): Block | undefined {
  if (id === undefined) return undefined;
  for (const b of w.blocks) {
    if (b.id === id) return b;
    if (b.kind === 'repeat') {
      const c = b.blocks.find((x) => x.id === id);
      if (c) return c;
    }
  }
  return undefined;
}

/** The repeat that contains `id`, if any. */
export function parentRepeat(w: Workout, id: string): RepeatBlock | undefined {
  for (const b of w.blocks) {
    if (b.kind === 'repeat' && b.blocks.some((c) => c.id === id)) return b;
  }
  return undefined;
}

/** Effort level of an intensity: the explicit level, else the nearest to its %FTP. */
export function intensityEffort(i: Intensity, table: EffortTable): EffortLevel {
  if (i.effort !== undefined) return i.effort;
  if (i.ftpPct !== undefined) return ftpPctToEffort(i.ftpPct, table);
  return 5;
}

/** Duration of one pass through a block (a repeat sums its children once). */
export function blockSpanSec(b: Block): number {
  return b.kind === 'repeat' ? b.blocks.reduce((s, c) => s + c.durationSec, 0) : b.durationSec;
}

/** Duration of a block as laid out on the timeline (a repeat counts every pass). */
export function blockTotalSec(b: Block): number {
  return b.kind === 'repeat' ? b.times * blockSpanSec(b) : b.durationSec;
}

/** Rounds a duration to 15 s (5 s when `fine`), never below 5 s; matches the reducer's resizeBlock. */
export function snapSec(sec: number, fine: boolean): number {
  const step = fine ? 5 : 15;
  return Math.max(5, Math.round(sec / step) * step);
}

export function clampEffort(n: number): EffortLevel {
  return Math.min(10, Math.max(1, Math.round(n))) as EffortLevel;
}

export const RPM_WARN_MIN = 55;
export const RPM_WARN_MAX = 120;

export function rpmOutsideUsual(rpm: number | undefined): boolean {
  return rpm !== undefined && (rpm < RPM_WARN_MIN || rpm > RPM_WARN_MAX);
}

export function isSaveable(w: Workout): boolean {
  return w.blocks.length > 0 && workoutSchema.safeParse(w).success;
}

/** A starting draft: warm-up, one steady block and a cool-down. */
export function newWorkoutDraft(
  name: string,
  now: () => string = () => new Date().toISOString(),
): Workout {
  const warm = newId();
  const steady = newId();
  const cool = newId();
  return {
    id: newId(),
    name,
    description: '',
    category: 'freestyle',
    tags: [],
    source: { kind: 'user' },
    blocks: [
      {
        kind: 'ramp',
        id: warm,
        durationSec: 300,
        from: { ftpPct: 40 },
        to: { ftpPct: 70 },
      },
      { kind: 'steady', id: steady, durationSec: 600, intensity: { effort: 5 }, rpm: 90 },
      { kind: 'ramp', id: cool, durationSec: 300, from: { ftpPct: 70 }, to: { ftpPct: 45 } },
    ],
    musicCues: [],
    fallbackPlaylist: [],
    schemaVersion: 1,
    updatedAt: now(),
  };
}

export interface KeyInfo {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * +1 / -1 for the duration keys. The physical key (`code`) decides, so Shift (needed for "+" on
 * many layouts) only selects the fine step; without a code the produced character is used.
 */
function stepDirection(e: KeyInfo): 1 | -1 | 0 {
  if (e.code === 'Equal' || e.code === 'NumpadAdd') return 1;
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') return -1;
  if (e.code) return 0;
  if (e.key === '+' || e.key === '=') return 1;
  if (e.key === '-' || e.key === '_') return -1;
  return 0;
}

/**
 * Maps a key press to an editor action for the current selection; undefined when the key does
 * nothing. ↑/↓ change the effort (a ramp's end, or its start with Shift); +/- change the
 * duration by 15 s (Shift 5 s) or a repeat's count by one.
 */
export function shortcutToAction(
  state: EditorState,
  e: KeyInfo,
  table: EffortTable,
): EditorAction | undefined {
  const w = state.workout;
  const mod = e.ctrlKey === true || e.metaKey === true;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod) {
    if (k === 'z') return { type: e.shiftKey ? 'redo' : 'undo' };
    if (k === 'y') return { type: 'redo' };
    if (k === 'd' && state.selectedId) return { type: 'duplicateBlock', id: state.selectedId };
    return undefined;
  }
  if (e.altKey) {
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && state.selectedId !== undefined) {
      const from = w.blocks.findIndex((b) => b.id === state.selectedId);
      const to = from + (k === 'ArrowRight' ? 1 : -1);
      if (from >= 0 && to >= 0 && to < w.blocks.length) return { type: 'moveBlock', from, to };
    }
    return undefined;
  }

  const order = selectionOrder(w);
  if (k === 'ArrowLeft' || k === 'ArrowRight') {
    if (order.length === 0) return undefined;
    const at = state.selectedId === undefined ? -1 : order.indexOf(state.selectedId);
    const next =
      k === 'ArrowRight'
        ? order[Math.min(order.length - 1, at + 1)]
        : order[Math.max(0, at < 0 ? 0 : at - 1)];
    return { type: 'select', id: next };
  }
  const b = findBlock(w, state.selectedId);
  if (!b) return undefined;
  if (k === 'Delete' || k === 'Backspace') {
    const parent = parentRepeat(w, b.id);
    return parent
      ? { type: 'removeChild', repeatId: parent.id, childId: b.id }
      : { type: 'removeBlock', id: b.id };
  }
  const dir = stepDirection(e);
  if (dir !== 0) {
    if (b.kind === 'repeat') {
      return {
        type: 'updateBlock',
        id: b.id,
        patch: { times: Math.min(50, Math.max(2, b.times + dir)) },
      };
    }
    const step = e.shiftKey ? 5 : 15;
    return { type: 'resizeBlock', id: b.id, durationSec: b.durationSec + dir * step, fine: true };
  }
  if (k === 'ArrowUp' || k === 'ArrowDown') {
    if (b.kind === 'repeat') return undefined;
    const up = k === 'ArrowUp' ? 1 : -1;
    if (b.kind === 'steady') {
      return {
        type: 'setIntensity',
        id: b.id,
        effort: clampEffort(intensityEffort(b.intensity, table) + up),
      };
    }
    const which = e.shiftKey ? 'from' : 'to';
    return {
      type: 'setIntensity',
      id: b.id,
      effort: clampEffort(intensityEffort(b[which], table) + up),
      which,
    };
  }
  return undefined;
}

/** Minutes spent at or above `thresholdPct` % FTP (ramps count the part above the threshold). */
export function hardMinutes(w: Workout, table: EffortTable, thresholdPct = 85): number {
  let sec = 0;
  for (const s of flattenWorkout(w, table)) {
    const a = s.ftpPctStart;
    const b = s.ftpPctEnd;
    if (a === b) {
      if (a >= thresholdPct) sec += s.durationSec;
    } else {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (hi >= thresholdPct)
        sec += (s.durationSec * (hi - Math.max(lo, thresholdPct))) / (hi - lo);
    }
  }
  return Math.round(sec / 60);
}

/** Tags a user can set on a workout (the `mine` tag is added automatically elsewhere). */
export const EDITOR_TAGS = [
  'hiit',
  'test',
  'music',
  'climb',
  'sprint',
  'cadence',
  'endurance',
  'tempo',
  'sweetspot',
  'threshold',
  'vo2',
  'recovery',
] as const;

/** Why the workout cannot be saved, or undefined when it can. */
export function saveIssue(w: Workout): { empty: true } | { issue: string } | undefined {
  if (w.blocks.length === 0) return { empty: true };
  const r = workoutSchema.safeParse(w);
  if (r.success) return undefined;
  const first = r.error.issues[0];
  return { issue: first ? `${first.path.join('.')} ${first.message}`.trim() : 'invalid' };
}
