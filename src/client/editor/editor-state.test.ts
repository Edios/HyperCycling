import { describe, expect, it } from 'vitest';
import { workoutSchema, type RepeatBlock, type TrackRef, type Workout } from '../../domain/workout';
import {
  createEditorState,
  editorReducer,
  type EditorAction,
  type EditorState,
} from './editor-state';

const track: TrackRef = { provider: 'youtube', id: 'abc', title: 'Song', startAtSec: 0 };

function base(): Workout {
  return {
    id: 'w1',
    name: 'Test',
    description: '',
    category: 'freestyle',
    tags: [],
    source: { kind: 'user' },
    blocks: [
      { kind: 'ramp', id: 'wu', durationSec: 300, from: { effort: 2 }, to: { effort: 4 } },
      {
        kind: 'repeat',
        id: 'rep',
        times: 3,
        blocks: [
          { kind: 'steady', id: 'a', durationSec: 60, intensity: { effort: 8 } },
          { kind: 'steady', id: 'b', durationSec: 60, intensity: { effort: 3 } },
        ],
      },
      { kind: 'steady', id: 'mid', durationSec: 120, intensity: { effort: 5 } },
      { kind: 'ramp', id: 'cd', durationSec: 300, from: { effort: 4 }, to: { effort: 1 } },
    ],
    musicCues: [
      { blockId: 'a', rep: 2, track },
      { blockId: 'mid', rep: 1, track },
    ],
    fallbackPlaylist: [],
    musicHints: { a: 'hint a', mid: 'hint mid' },
    scaling: {
      warmupBlockId: 'wu',
      cooldownBlockId: 'cd',
      flexRepeatId: 'rep',
      minTimes: 2,
      maxTimes: 5,
    },
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function fresh(): EditorState {
  let n = 0;
  return createEditorState(base(), {
    idFactory: () => `n${++n}`,
    now: () => '2026-02-02T00:00:00.000Z',
  });
}

function run(s: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, s);
}

const ids = (w: Workout): string[] => w.blocks.map((b) => b.id);

describe('createEditorState', () => {
  it('starts clean', () => {
    const s = createEditorState(base());
    expect(s.past).toEqual([]);
    expect(s.future).toEqual([]);
    expect(s.dirty).toBe(false);
    expect(s.errors).toEqual([]);
    expect(s.selectedId).toBeUndefined();
  });
});

describe('addBlock', () => {
  it('appends a steady block with defaults and selects it', () => {
    const s0 = fresh();
    const s = run(s0, { type: 'addBlock', kind: 'steady' });
    const b = s.workout.blocks.at(-1);
    expect(b).toMatchObject({
      kind: 'steady',
      id: 'n1',
      durationSec: 300,
      intensity: { effort: 5 },
      rpm: 90,
    });
    expect(s.selectedId).toBe('n1');
    expect(s.dirty).toBe(true);
    expect(s.workout).not.toBe(s0.workout);
    expect(s0.workout.blocks).toHaveLength(4);
    expect(workoutSchema.safeParse(s.workout).success).toBe(true);
  });

  it('inserts at index', () => {
    const s = run(fresh(), { type: 'addBlock', kind: 'ramp', atIndex: 1 });
    expect(ids(s.workout)).toEqual(['wu', 'n1', 'rep', 'mid', 'cd']);
    expect(s.workout.blocks[1]).toMatchObject({
      kind: 'ramp',
      durationSec: 300,
      from: { effort: 4 },
      to: { effort: 8 },
    });
  });

  it('warmup and cooldown defaults', () => {
    const s = run(
      fresh(),
      { type: 'addBlock', kind: 'warmup' },
      { type: 'addBlock', kind: 'cooldown' },
    );
    expect(s.workout.blocks.at(-2)).toMatchObject({
      kind: 'ramp',
      durationSec: 480,
      from: { ftpPct: 40 },
      to: { ftpPct: 75 },
    });
    expect(s.workout.blocks.at(-1)).toMatchObject({
      kind: 'ramp',
      durationSec: 300,
      from: { ftpPct: 70 },
      to: { ftpPct: 45 },
    });
  });

  it('interval is a repeat x4 of two steady blocks', () => {
    const s = run(fresh(), { type: 'addBlock', kind: 'interval' });
    const r = s.workout.blocks.at(-1) as RepeatBlock;
    expect(r.kind).toBe('repeat');
    expect(r.times).toBe(4);
    expect(r.blocks).toMatchObject([
      { kind: 'steady', durationSec: 60, intensity: { effort: 8 }, rpm: 95 },
      { kind: 'steady', durationSec: 60, intensity: { effort: 3 }, rpm: 85 },
    ]);
    expect(new Set([r.id, ...r.blocks.map((c) => c.id)]).size).toBe(3);
    expect(s.selectedId).toBe(r.id);
  });

  it('defaults to the real id generator', () => {
    const s = run(createEditorState(base()), { type: 'addBlock', kind: 'steady' });
    expect(s.workout.blocks.at(-1)?.id.length).toBeGreaterThan(10);
  });
});

describe('moveBlock', () => {
  it('moves a top-level block', () => {
    const s = run(fresh(), { type: 'moveBlock', from: 3, to: 0 });
    expect(ids(s.workout)).toEqual(['cd', 'wu', 'rep', 'mid']);
  });
  it('from === to is a no-op without history', () => {
    const s0 = fresh();
    const s = run(s0, { type: 'moveBlock', from: 1, to: 1 });
    expect(s).toBe(s0);
  });
  it('errors on out-of-range index and keeps workout', () => {
    const s0 = fresh();
    const s = run(s0, { type: 'moveBlock', from: 9, to: 0 });
    expect(s.workout).toBe(s0.workout);
    expect(s.errors).toEqual(['editor.error.invalid']);
    expect(s.past).toHaveLength(0);
    expect(s.dirty).toBe(false);
  });
});

describe('resizeBlock', () => {
  it('snaps to 15 s', () => {
    const s = run(fresh(), { type: 'resizeBlock', id: 'mid', durationSec: 128 });
    expect(s.workout.blocks[2]).toMatchObject({ durationSec: 135 });
  });
  it('snaps to 5 s when fine', () => {
    const s = run(fresh(), { type: 'resizeBlock', id: 'mid', durationSec: 128, fine: true });
    expect(s.workout.blocks[2]).toMatchObject({ durationSec: 130 });
  });
  it('clamps to min 5 s', () => {
    const s = run(fresh(), { type: 'resizeBlock', id: 'mid', durationSec: 2 });
    expect(s.workout.blocks[2]).toMatchObject({ durationSec: 5 });
  });
  it('resizes repeat children', () => {
    const s = run(fresh(), { type: 'resizeBlock', id: 'a', durationSec: 90 });
    expect((s.workout.blocks[1] as RepeatBlock).blocks[0]?.durationSec).toBe(90);
  });
  it('rejects repeat and unknown ids', () => {
    expect(run(fresh(), { type: 'resizeBlock', id: 'rep', durationSec: 60 }).errors).toEqual([
      'editor.error.invalid',
    ]);
    expect(run(fresh(), { type: 'resizeBlock', id: 'zzz', durationSec: 60 }).errors).toEqual([
      'editor.error.notFound',
    ]);
  });
  it('rejects durations above the schema maximum', () => {
    const s = run(fresh(), { type: 'resizeBlock', id: 'mid', durationSec: 99999 });
    expect(s.errors).toEqual(['editor.error.invalid']);
    expect(s.workout.blocks[2]).toMatchObject({ durationSec: 120 });
  });
});

describe('setIntensity', () => {
  it('sets effort and clears ftpPct on steady', () => {
    const s0 = run(fresh(), {
      type: 'updateBlock',
      id: 'mid',
      patch: { intensity: { effort: 5, ftpPct: 88 } },
    });
    const s = run(s0, { type: 'setIntensity', id: 'mid', effort: 7 });
    expect(s.workout.blocks[2]).toMatchObject({ intensity: { effort: 7 } });
    expect((s.workout.blocks[2] as { intensity: object }).intensity).not.toHaveProperty('ftpPct');
  });
  it('ramp sets "to" by default and "from" on request', () => {
    const s = run(
      fresh(),
      { type: 'setIntensity', id: 'cd', effort: 2 },
      { type: 'setIntensity', id: 'cd', effort: 6, which: 'from' },
    );
    expect(s.workout.blocks[3]).toMatchObject({ from: { effort: 6 }, to: { effort: 2 } });
  });
  it('rejects a repeat block', () => {
    expect(run(fresh(), { type: 'setIntensity', id: 'rep', effort: 3 }).errors).toEqual([
      'editor.error.invalid',
    ]);
  });
});

describe('updateBlock', () => {
  it('patches fields', () => {
    const s = run(fresh(), {
      type: 'updateBlock',
      id: 'mid',
      patch: { rpm: 100, position: 'standing', label: 'L', cue: 'go' },
    });
    expect(s.workout.blocks[2]).toMatchObject({
      rpm: 100,
      position: 'standing',
      label: 'L',
      cue: 'go',
    });
  });
  it('patches repeat times', () => {
    const s = run(fresh(), { type: 'updateBlock', id: 'rep', patch: { times: 6 } });
    expect((s.workout.blocks[1] as RepeatBlock).times).toBe(6);
  });
  it('lowering times prunes cues above the new count', () => {
    const s = run(
      fresh(),
      { type: 'updateBlock', id: 'rep', patch: { times: 2 } },
      { type: 'updateBlock', id: 'rep', patch: { times: 2 } },
    );
    expect(s.errors).toEqual([]);
    expect(s.workout.musicCues.map((c) => c.blockId)).toEqual(['a', 'mid']);
    const t = run(fresh(), { type: 'updateBlock', id: 'rep', patch: { times: 2 } });
    expect(t.workout.musicCues.find((c) => c.blockId === 'a')?.rep).toBe(2);
    const cues = { type: 'setCue', blockId: 'b', rep: 3, track } as const;
    const u = run(fresh(), cues, { type: 'updateBlock', id: 'rep', patch: { times: 2 } });
    expect(u.errors).toEqual([]);
    expect(u.workout.musicCues.some((c) => c.blockId === 'b')).toBe(false);
  });
  it('stamps updatedAt from the injected clock', () => {
    const s = run(fresh(), { type: 'addBlock', kind: 'steady' });
    expect(s.workout.updatedAt).toBe('2026-02-02T00:00:00.000Z');
  });
  it('invalid patch keeps previous workout with error', () => {
    const s0 = fresh();
    const s = run(s0, { type: 'updateBlock', id: 'rep', patch: { times: 1 } });
    expect(s.workout).toBe(s0.workout);
    expect(s.errors).toEqual(['editor.error.invalid']);
  });
  it('durations under 5 s give minDuration', () => {
    const s = run(fresh(), { type: 'updateBlock', id: 'mid', patch: { durationSec: 3 } });
    expect(s.errors).toEqual(['editor.error.minDuration']);
  });
  it('a later success clears errors', () => {
    const s = run(
      fresh(),
      { type: 'updateBlock', id: 'rep', patch: { times: 1 } },
      { type: 'updateBlock', id: 'rep', patch: { times: 4 } },
    );
    expect(s.errors).toEqual([]);
  });
});

describe('removeBlock', () => {
  it('removes and selects the neighbour', () => {
    const s = run(fresh(), { type: 'removeBlock', id: 'mid' });
    expect(ids(s.workout)).toEqual(['wu', 'rep', 'cd']);
    expect(s.selectedId).toBe('cd');
  });
  it('selects the previous block when last is removed, none when empty', () => {
    const s = run(fresh(), { type: 'removeBlock', id: 'cd' });
    expect(s.selectedId).toBe('mid');
    const empty = run(
      fresh(),
      ...['wu', 'rep', 'mid', 'cd'].map((id): EditorAction => ({ type: 'removeBlock', id })),
    );
    expect(empty.workout.blocks).toEqual([]);
    expect(empty.selectedId).toBeUndefined();
  });
  it('removes its cues and hints', () => {
    const s = run(fresh(), { type: 'removeBlock', id: 'mid' });
    expect(s.workout.musicCues.map((c) => c.blockId)).toEqual(['a']);
    expect(s.workout.musicHints).toEqual({ a: 'hint a' });
  });
  it('removing a repeat removes children cues and hints and flex scaling', () => {
    const s = run(fresh(), { type: 'removeBlock', id: 'rep' });
    expect(s.workout.musicCues.map((c) => c.blockId)).toEqual(['mid']);
    expect(s.workout.musicHints).toEqual({ mid: 'hint mid' });
    expect(s.workout.scaling).toEqual({ warmupBlockId: 'wu', cooldownBlockId: 'cd' });
  });
  it('removing warm-up or cool-down drops scaling', () => {
    expect(run(fresh(), { type: 'removeBlock', id: 'wu' }).workout.scaling).toBeUndefined();
    expect(run(fresh(), { type: 'removeBlock', id: 'cd' }).workout.scaling).toBeUndefined();
  });
  it('unknown id is an error', () => {
    expect(run(fresh(), { type: 'removeBlock', id: 'nope' }).errors).toEqual([
      'editor.error.notFound',
    ]);
  });
});

describe('removeChild', () => {
  it('removes a child, its cues, and selects the neighbour', () => {
    const s = run(fresh(), { type: 'removeChild', repeatId: 'rep', childId: 'a' });
    expect((s.workout.blocks[1] as RepeatBlock).blocks.map((c) => c.id)).toEqual(['b']);
    expect(s.workout.musicCues.map((c) => c.blockId)).toEqual(['mid']);
    expect(s.selectedId).toBe('b');
  });
  it('removeBlock on the last child of a repeat keeps state with an error', () => {
    const s = run(
      fresh(),
      { type: 'removeChild', repeatId: 'rep', childId: 'a' },
      { type: 'removeBlock', id: 'b' },
    );
    expect((s.workout.blocks[1] as RepeatBlock).blocks.map((c) => c.id)).toEqual(['b']);
    expect(s.errors).toEqual(['editor.error.invalid']);
  });
  it('refuses to remove the last child', () => {
    const s = run(
      fresh(),
      { type: 'removeChild', repeatId: 'rep', childId: 'a' },
      { type: 'removeChild', repeatId: 'rep', childId: 'b' },
    );
    expect((s.workout.blocks[1] as RepeatBlock).blocks).toHaveLength(1);
    expect(s.errors).toEqual(['editor.error.invalid']);
  });
});

describe('duplicateBlock', () => {
  it('inserts a copy with new id after the original, selects it, copies no cues', () => {
    const s = run(fresh(), { type: 'duplicateBlock', id: 'mid' });
    expect(ids(s.workout)).toEqual(['wu', 'rep', 'mid', 'n1', 'cd']);
    expect(s.selectedId).toBe('n1');
    expect(s.workout.musicCues).toHaveLength(2);
    expect(s.workout.musicHints).toEqual({ a: 'hint a', mid: 'hint mid' });
  });
  it('duplicating a repeat gives fresh ids for children', () => {
    const s = run(fresh(), { type: 'duplicateBlock', id: 'rep' });
    const copy = s.workout.blocks[2] as RepeatBlock;
    expect(copy.id).toBe(s.selectedId);
    expect(copy.blocks.map((c) => c.id)).not.toContain('a');
    expect(workoutSchema.safeParse(s.workout).success).toBe(true);
  });
  it('duplicates a repeat child inside its repeat', () => {
    const s = run(fresh(), { type: 'duplicateBlock', id: 'a' });
    expect((s.workout.blocks[1] as RepeatBlock).blocks.map((c) => c.id)).toEqual(['a', 'n1', 'b']);
  });
});

describe('addRepeatChild', () => {
  it('adds a steady child at index', () => {
    const s = run(fresh(), { type: 'addRepeatChild', repeatId: 'rep', kind: 'steady', atIndex: 1 });
    expect((s.workout.blocks[1] as RepeatBlock).blocks.map((c) => c.id)).toEqual(['a', 'n1', 'b']);
    expect(s.selectedId).toBe('n1');
  });
  it('adds a ramp child at the end', () => {
    const s = run(fresh(), { type: 'addRepeatChild', repeatId: 'rep', kind: 'ramp' });
    expect((s.workout.blocks[1] as RepeatBlock).blocks.at(-1)?.kind).toBe('ramp');
  });
  it('fails for a non-repeat', () => {
    expect(
      run(fresh(), { type: 'addRepeatChild', repeatId: 'mid', kind: 'steady' }).errors,
    ).toEqual(['editor.error.invalid']);
  });
});

describe('cues', () => {
  it('sets a cue, replacing one on the same block and rep', () => {
    const t2 = { ...track, id: 'zzz' };
    const s = run(
      fresh(),
      { type: 'setCue', blockId: 'a', rep: 3, track },
      { type: 'setCue', blockId: 'a', rep: 3, track: t2 },
    );
    expect(s.workout.musicCues.filter((c) => c.blockId === 'a' && c.rep === 3)).toEqual([
      { blockId: 'a', rep: 3, track: t2 },
    ]);
  });
  it('rejects a cue above the repeat count', () => {
    const s = run(fresh(), { type: 'setCue', blockId: 'a', rep: 4, track });
    expect(s.errors).toEqual(['editor.error.invalid']);
  });
  it('clears a cue', () => {
    const s = run(fresh(), { type: 'clearCue', blockId: 'a', rep: 2 });
    expect(s.workout.musicCues.map((c) => c.blockId)).toEqual(['mid']);
  });
});

describe('select / markSaved / meta', () => {
  it('select does not touch history or dirty', () => {
    const s = run(fresh(), { type: 'select', id: 'mid' });
    expect(s.selectedId).toBe('mid');
    expect(s.dirty).toBe(false);
    expect(s.past).toHaveLength(0);
  });
  it('select with an unknown id is a no-op', () => {
    const s0 = fresh();
    expect(run(s0, { type: 'select', id: 'ghost' })).toBe(s0);
  });
  it('dirty tracks the saved workout across undo/redo', () => {
    const s1 = run(fresh(), { type: 'addBlock', kind: 'steady' }, { type: 'markSaved' });
    expect(s1.dirty).toBe(false);
    const s2 = run(s1, { type: 'addBlock', kind: 'ramp' });
    expect(s2.dirty).toBe(true);
    const u = run(s2, { type: 'undo' });
    expect(u.dirty).toBe(false);
    expect(run(u, { type: 'undo' }).dirty).toBe(true);
    expect(run(u, { type: 'redo' }).dirty).toBe(true);
  });
  it('markSaved clears dirty', () => {
    const s = run(fresh(), { type: 'addBlock', kind: 'steady' }, { type: 'markSaved' });
    expect(s.dirty).toBe(false);
  });
  it('updateMeta renames and validates', () => {
    expect(run(fresh(), { type: 'updateMeta', patch: { name: 'New' } }).workout.name).toBe('New');
    expect(run(fresh(), { type: 'updateMeta', patch: { name: '' } }).errors).toEqual([
      'editor.error.invalid',
    ]);
  });
});

describe('undo / redo', () => {
  it('restores workout and selectedId', () => {
    const s0 = run(fresh(), { type: 'select', id: 'mid' });
    const s1 = run(s0, { type: 'duplicateBlock', id: 'mid' });
    expect(s1.selectedId).toBe('n1');
    const u = run(s1, { type: 'undo' });
    expect(u.workout).toEqual(s0.workout);
    expect(u.selectedId).toBe('mid');
    expect(u.dirty).toBe(false);
    const r = run(u, { type: 'redo' });
    expect(r.workout).toEqual(s1.workout);
    expect(r.selectedId).toBe('n1');
  });
  it('is a no-op with empty history', () => {
    const s0 = fresh();
    expect(run(s0, { type: 'undo' }).workout).toBe(s0.workout);
    expect(run(s0, { type: 'redo' }).workout).toBe(s0.workout);
  });
  it('a new action clears future', () => {
    const s = run(
      fresh(),
      { type: 'addBlock', kind: 'steady' },
      { type: 'undo' },
      { type: 'addBlock', kind: 'ramp' },
    );
    expect(s.future).toEqual([]);
  });
  it('caps history at 100, dropping the oldest', () => {
    let s = fresh();
    for (let i = 0; i < 105; i++) s = editorReducer(s, { type: 'addBlock', kind: 'steady' });
    expect(s.past).toHaveLength(100);
    for (let i = 0; i < 100; i++) s = editorReducer(s, { type: 'undo' });
    expect(s.workout.blocks).toHaveLength(9);
    expect(editorReducer(s, { type: 'undo' })).toBe(s);
  });
});
