import { ftpPctToEffort, type EffortLevel, type EffortTable } from '../../domain/effort';
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
export function newWorkoutDraft(name: string, now: () => string = () => new Date().toISOString()): Workout {
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
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
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
  if (e.altKey) return undefined;

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
  if (k === '+' || k === '=' || k === '-' || k === '_') {
    const dir = k === '+' || k === '=' ? 1 : -1;
    if (b.kind === 'repeat') {
      return { type: 'updateBlock', id: b.id, patch: { times: Math.min(50, Math.max(2, b.times + dir)) } };
    }
    const step = e.shiftKey ? 5 : 15;
    return { type: 'resizeBlock', id: b.id, durationSec: b.durationSec + dir * step, fine: true };
  }
  if (k === 'ArrowUp' || k === 'ArrowDown') {
    if (b.kind === 'repeat') return undefined;
    const dir = k === 'ArrowUp' ? 1 : -1;
    if (b.kind === 'steady') {
      return {
        type: 'setIntensity',
        id: b.id,
        effort: clampEffort(intensityEffort(b.intensity, table) + dir),
      };
    }
    const which = e.shiftKey ? 'from' : 'to';
    return {
      type: 'setIntensity',
      id: b.id,
      effort: clampEffort(intensityEffort(b[which], table) + dir),
      which,
    };
  }
  return undefined;
}
