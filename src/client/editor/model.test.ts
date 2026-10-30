import { describe, expect, it } from 'vitest';
import { DEFAULT_EFFORT_TABLE } from '../../domain/effort';
import { workoutSchema } from '../../domain/workout';
import { createEditorState, editorReducer, type EditorAction } from './editor-state';
import {
  hardMinutes,
  isSaveable,
  newWorkoutDraft,
  rpmOutsideUsual,
  selectionOrder,
  shortcutToAction,
} from './model';

const T = DEFAULT_EFFORT_TABLE;

function stateWith(actions: EditorAction[]) {
  let s = createEditorState(newWorkoutDraft('x'));
  for (const a of actions) s = editorReducer(s, a);
  return s;
}

describe('newWorkoutDraft', () => {
  it('is a valid warm-up + steady + cool-down user workout', () => {
    const w = newWorkoutDraft('Draft');
    expect(workoutSchema.safeParse(w).success).toBe(true);
    expect(w.blocks.map((b) => b.kind)).toEqual(['ramp', 'steady', 'ramp']);
    expect(w.source.kind).toBe('user');
    expect(isSaveable(w)).toBe(true);
  });
  it('an empty or unnamed workout is not saveable', () => {
    expect(isSaveable({ ...newWorkoutDraft('a'), blocks: [] })).toBe(false);
    expect(isSaveable({ ...newWorkoutDraft('a'), name: '' })).toBe(false);
  });
});

describe('selectionOrder', () => {
  it('lists a repeat before its children', () => {
    const s = stateWith([{ type: 'addBlock', kind: 'interval' }]);
    const rep = s.workout.blocks[3];
    if (rep?.kind !== 'repeat') throw new Error('expected repeat');
    expect(selectionOrder(s.workout).slice(3)).toEqual([rep.id, ...rep.blocks.map((c) => c.id)]);
  });
});

describe('shortcutToAction', () => {
  const sel = (i: number) => {
    const s = createEditorState(newWorkoutDraft('x'));
    return editorReducer(s, { type: 'select', id: s.workout.blocks[i]?.id });
  };

  it('arrows move the selection', () => {
    const s = sel(1);
    const id = (i: number) => s.workout.blocks[i]?.id;
    expect(shortcutToAction(s, { key: 'ArrowRight' }, T)).toEqual({ type: 'select', id: id(2) });
    expect(shortcutToAction(s, { key: 'ArrowLeft' }, T)).toEqual({ type: 'select', id: id(0) });
  });
  it('+/- resize by 15 s, Shift by 5 s', () => {
    const s = sel(1);
    const id = s.selectedId as string;
    expect(shortcutToAction(s, { key: '+' }, T)).toMatchObject({ id, durationSec: 615 });
    expect(shortcutToAction(s, { key: '-', shiftKey: true }, T)).toMatchObject({
      durationSec: 595,
    });
  });
  it('up/down change effort and clamp', () => {
    const s = sel(1);
    expect(shortcutToAction(s, { key: 'ArrowUp' }, T)).toMatchObject({
      type: 'setIntensity',
      effort: 6,
    });
    expect(shortcutToAction(s, { key: 'ArrowDown' }, T)).toMatchObject({ effort: 4 });
  });
  it('ramps change the end, Shift changes the start', () => {
    const s = sel(0);
    expect(shortcutToAction(s, { key: 'ArrowUp' }, T)).toMatchObject({ which: 'to', effort: 5 });
    expect(shortcutToAction(s, { key: 'ArrowUp', shiftKey: true }, T)).toMatchObject({
      which: 'from',
    });
  });
  it('Delete, Ctrl+D, Ctrl+Z, Ctrl+Y', () => {
    const s = sel(1);
    const id = s.selectedId as string;
    expect(shortcutToAction(s, { key: 'Delete' }, T)).toEqual({ type: 'removeBlock', id });
    expect(shortcutToAction(s, { key: 'd', ctrlKey: true }, T)).toEqual({
      type: 'duplicateBlock',
      id,
    });
    expect(shortcutToAction(s, { key: 'z', ctrlKey: true }, T)).toEqual({ type: 'undo' });
    expect(shortcutToAction(s, { key: 'y', ctrlKey: true }, T)).toEqual({ type: 'redo' });
  });
  it('without a selection block keys do nothing', () => {
    const s = createEditorState(newWorkoutDraft('x'));
    expect(shortcutToAction(s, { key: 'Delete' }, T)).toBeUndefined();
    expect(shortcutToAction(s, { key: 'ArrowUp' }, T)).toBeUndefined();
  });
  it('a child of a repeat is removed with removeChild', () => {
    let s = stateWith([{ type: 'addBlock', kind: 'interval' }]);
    const rep = s.workout.blocks[3];
    if (rep?.kind !== 'repeat') throw new Error('expected repeat');
    const child = rep.blocks[0]?.id;
    s = editorReducer(s, { type: 'select', id: child });
    expect(shortcutToAction(s, { key: 'Delete' }, T)).toEqual({
      type: 'removeChild',
      repeatId: rep.id,
      childId: child,
    });
  });
});

describe('Alt+arrows reorder', () => {
  it('moves the selected top-level block, not beyond the ends', () => {
    let s = createEditorState(newWorkoutDraft('x'));
    s = editorReducer(s, { type: 'select', id: s.workout.blocks[1]?.id });
    expect(shortcutToAction(s, { key: 'ArrowRight', altKey: true }, T)).toEqual({
      type: 'moveBlock',
      from: 1,
      to: 2,
    });
    expect(shortcutToAction(s, { key: 'ArrowLeft', altKey: true }, T)).toEqual({
      type: 'moveBlock',
      from: 1,
      to: 0,
    });
    s = editorReducer(s, { type: 'select', id: s.workout.blocks[2]?.id });
    expect(shortcutToAction(s, { key: 'ArrowRight', altKey: true }, T)).toBeUndefined();
  });
});

describe('hardMinutes', () => {
  it('counts time at or above 85 % FTP, prorating ramps', () => {
    const w = newWorkoutDraft('x');
    w.blocks = [
      { kind: 'steady', id: 'a', durationSec: 600, intensity: { ftpPct: 90 } },
      { kind: 'steady', id: 'b', durationSec: 600, intensity: { ftpPct: 70 } },
      { kind: 'ramp', id: 'c', durationSec: 600, from: { ftpPct: 70 }, to: { ftpPct: 100 } },
    ];
    // 10 min steady + half of the ramp (85..100 of 70..100) = 10 + 5
    expect(hardMinutes(w, T)).toBe(15);
  });
});

describe('rpmOutsideUsual', () => {
  it('flags values outside 55..120', () => {
    expect(rpmOutsideUsual(undefined)).toBe(false);
    expect(rpmOutsideUsual(54)).toBe(true);
    expect(rpmOutsideUsual(55)).toBe(false);
    expect(rpmOutsideUsual(120)).toBe(false);
    expect(rpmOutsideUsual(121)).toBe(true);
  });
});
