import type { EffortLevel } from '../../domain/effort';
import { newId } from '../../domain/ids';
import {
  repairSongs,
  slotTracks,
  workoutSchema,
  type Block,
  type RampBlock,
  type RepeatBlock,
  type SongSlot,
  type SteadyBlock,
  type TrackRef,
  type Workout,
} from '../../domain/workout';

export const HISTORY_LIMIT = 100;
const SNAP_SEC = 15;
const FINE_SNAP_SEC = 5;
const MIN_DURATION_SEC = 5;

export const ERROR_INVALID = 'editor.error.invalid';
export const ERROR_MIN_DURATION = 'editor.error.minDuration';
export const ERROR_NOT_FOUND = 'editor.error.notFound';

export type NewBlockKind = 'warmup' | 'steady' | 'interval' | 'ramp' | 'cooldown';
export type ChildKind = 'steady' | 'ramp';

type BlockPatch = Partial<Omit<SteadyBlock, 'id' | 'kind'>> &
  Partial<Omit<RampBlock, 'id' | 'kind'>> & { times?: number };

type MetaPatch = Partial<
  Pick<Workout, 'name' | 'description' | 'category' | 'tags' | 'fallbackPlaylist' | 'localized'>
>;

/** `null` clears the field. */
/** One track is kept as the plain `track`, several as `tracks`; none removes both. */
function storeQueue(slot: SongSlot, list: TrackRef[]): void {
  delete slot.track;
  delete slot.tracks;
  if (list.length === 1) slot.track = list[0] as TrackRef;
  else if (list.length > 1) slot.tracks = list;
}

export interface SongPatch {
  hint?: string | null;
  bpm?: [number, number] | null;
  /** Replaces (or, with null, drops) the first track of the slot's queue. */
  track?: TrackRef | null;
  /** The whole queue; one track is stored as `track` (older apps read it), more as `tracks`. */
  tracks?: TrackRef[];
}

export type EditorAction =
  | { type: 'addBlock'; kind: NewBlockKind; atIndex?: number }
  | { type: 'moveBlock'; from: number; to: number }
  | { type: 'resizeBlock'; id: string; durationSec: number; fine?: boolean }
  | { type: 'setIntensity'; id: string; effort: EffortLevel; which?: 'from' | 'to' }
  | { type: 'updateBlock'; id: string; patch: BlockPatch }
  | { type: 'removeBlock'; id: string }
  | { type: 'duplicateBlock'; id: string }
  | { type: 'addRepeatChild'; repeatId: string; kind: ChildKind; atIndex?: number }
  | { type: 'removeChild'; repeatId: string; childId: string }
  | { type: 'setCue'; blockId: string; rep: number; track: TrackRef }
  | { type: 'clearCue'; blockId: string; rep: number }
  | { type: 'addSong'; blockId: string }
  | { type: 'removeSong'; id: string }
  | { type: 'resizeSong'; id: string; edge: 'start' | 'end'; delta: 1 | -1 }
  | { type: 'updateSong'; id: string; patch: SongPatch }
  | { type: 'setCooldownTrack'; track: TrackRef | null }
  | { type: 'updateMeta'; patch: MetaPatch }
  | { type: 'select'; id: string | undefined }
  | { type: 'markSaved' }
  | { type: 'undo' }
  | { type: 'redo' };

export interface HistoryEntry {
  workout: Workout;
  selectedId?: string | undefined;
}

export interface EditorState {
  workout: Workout;
  selectedId?: string | undefined;
  past: HistoryEntry[];
  future: HistoryEntry[];
  dirty: boolean;
  /** i18n message keys of the last failed action; empty after a successful one. */
  errors: string[];
  /** The last saved workout; `dirty` is `workout !== saved`. */
  saved: Workout;
  // NOTE: the two injectables below are functions, so this state is not serialisable
  // (do not persist or structuredClone it; persist `workout` instead).
  /** Id source, injectable for deterministic tests. Defaults to newId. */
  idFactory?: () => string;
  /** Clock for `updatedAt` (ISO string), injectable so the reducer stays pure. */
  now?: () => string;
}

const systemNow = (): string => new Date().toISOString();

export function createEditorState(
  workout: Workout,
  opts: { idFactory?: () => string; now?: () => string } = {},
): EditorState {
  return {
    workout,
    saved: workout,
    selectedId: undefined,
    past: [],
    future: [],
    dirty: false,
    errors: [],
    ...(opts.idFactory ? { idFactory: opts.idFactory } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  };
}

// ---------------------------------------------------------------------------

type Outcome = { selectedId: string | undefined } | { error: string };

interface Location {
  list: Block[];
  index: number;
  parent?: RepeatBlock;
}

function locate(w: Workout, id: string): Location | undefined {
  const top = w.blocks.findIndex((b) => b.id === id);
  if (top >= 0) return { list: w.blocks, index: top };
  for (const b of w.blocks) {
    if (b.kind !== 'repeat') continue;
    const index = b.blocks.findIndex((c) => c.id === id);
    if (index >= 0) return { list: b.blocks, index, parent: b };
  }
  return undefined;
}

function blockAt(loc: Location): Block {
  const b = loc.list[loc.index];
  if (!b) throw new Error('editor: block index out of range');
  return b;
}

function defaultBlock(kind: NewBlockKind, nextId: () => string): Block {
  switch (kind) {
    case 'warmup':
      return {
        kind: 'ramp',
        id: nextId(),
        durationSec: 480,
        from: { ftpPct: 40 },
        to: { ftpPct: 75 },
      };
    case 'cooldown':
      return {
        kind: 'ramp',
        id: nextId(),
        durationSec: 300,
        from: { ftpPct: 70 },
        to: { ftpPct: 45 },
      };
    case 'ramp':
      return {
        kind: 'ramp',
        id: nextId(),
        durationSec: 300,
        from: { effort: 4 },
        to: { effort: 8 },
      };
    case 'steady':
      return {
        kind: 'steady',
        id: nextId(),
        durationSec: 300,
        intensity: { effort: 5 },
        rpm: 90,
      };
    case 'interval': {
      const id = nextId();
      return {
        kind: 'repeat',
        id,
        times: 4,
        blocks: [
          { kind: 'steady', id: nextId(), durationSec: 60, intensity: { effort: 8 }, rpm: 95 },
          { kind: 'steady', id: nextId(), durationSec: 60, intensity: { effort: 3 }, rpm: 85 },
        ],
      };
    }
  }
}

function collectIds(b: Block): string[] {
  return b.kind === 'repeat' ? [b.id, ...b.blocks.map((c) => c.id)] : [b.id];
}

/** Drops cues/hints of removed blocks and scaling references that no longer resolve. */
function pruneRemoved(w: Workout, removed: Set<string>, topLevel: boolean): void {
  w.musicCues = w.musicCues.filter((c) => !removed.has(c.blockId));
  if (w.musicHints) {
    const hints = Object.fromEntries(Object.entries(w.musicHints).filter(([k]) => !removed.has(k)));
    if (Object.keys(hints).length > 0) w.musicHints = hints;
    else delete w.musicHints;
  }
  const sc = w.scaling;
  if (!sc || !topLevel) return;
  if (removed.has(sc.warmupBlockId) || removed.has(sc.cooldownBlockId)) {
    delete w.scaling;
  } else if (sc.flexRepeatId !== undefined && removed.has(sc.flexRepeatId)) {
    delete sc.flexRepeatId;
    delete sc.minTimes;
    delete sc.maxTimes;
  }
}

function slotIndex(w: Workout, sg: SongSlot): number {
  return w.blocks.findIndex((b) => b.id === sg.firstBlockId);
}

/** Top-level block indices covered by a slot (empty when its ids do not resolve). */
function slotRange(w: Workout, sg: SongSlot): number[] {
  const a = slotIndex(w, sg);
  const z = w.blocks.findIndex((b) => b.id === sg.lastBlockId);
  if (a < 0 || z < a) return [];
  return Array.from({ length: z - a + 1 }, (_, i) => a + i);
}

function neighbour(list: Block[], index: number): string | undefined {
  return (list[index] ?? list[index - 1])?.id;
}

function snap(sec: number, fine: boolean): number {
  const step = fine ? FINE_SNAP_SEC : SNAP_SEC;
  return Math.max(MIN_DURATION_SEC, Math.round(sec / step) * step);
}

function fail(state: EditorState, key: string): EditorState {
  return { ...state, errors: [key] };
}

/** An action that changes nothing still supersedes the error of the previous failed action. */
function noop(state: EditorState): EditorState {
  return state.errors.length === 0 ? state : { ...state, errors: [] };
}

/** Clones the workout, runs `fn` on the clone, validates, and records history on success. */
function apply(state: EditorState, fn: (w: Workout, nextId: () => string) => Outcome): EditorState {
  const draft = structuredClone(state.workout);
  const oldOrder = draft.blocks.map((b) => b.id);
  const outcome = fn(draft, state.idFactory ?? newId);
  if ('error' in outcome) return fail(state, outcome.error);
  repairSongs(draft, oldOrder);
  draft.updatedAt = (state.now ?? systemNow)();
  const parsed = workoutSchema.safeParse(draft);
  if (!parsed.success) return fail(state, ERROR_INVALID);
  return {
    ...state,
    workout: parsed.data,
    selectedId: outcome.selectedId,
    past: [...state.past, { workout: state.workout, selectedId: state.selectedId }].slice(
      -HISTORY_LIMIT,
    ),
    future: [],
    dirty: true,
    errors: [],
  };
}

const notFound: Outcome = { error: ERROR_NOT_FOUND };
const invalid: Outcome = { error: ERROR_INVALID };

function cloneWithNewIds(b: Block, nextId: () => string): Block {
  const copy = structuredClone(b);
  copy.id = nextId();
  if (copy.kind === 'repeat') for (const c of copy.blocks) c.id = nextId();
  return copy;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'select':
      if (action.id !== undefined && !locate(state.workout, action.id)) return noop(state);
      return { ...state, selectedId: action.id };

    case 'markSaved':
      return { ...state, saved: state.workout, dirty: false };

    case 'undo': {
      const prev = state.past.at(-1);
      if (!prev) return noop(state);
      return {
        ...state,
        workout: prev.workout,
        selectedId: prev.selectedId,
        past: state.past.slice(0, -1),
        future: [...state.future, { workout: state.workout, selectedId: state.selectedId }],
        dirty: prev.workout !== state.saved,
        errors: [],
      };
    }

    case 'redo': {
      const next = state.future.at(-1);
      if (!next) return noop(state);
      return {
        ...state,
        workout: next.workout,
        selectedId: next.selectedId,
        past: [...state.past, { workout: state.workout, selectedId: state.selectedId }].slice(
          -HISTORY_LIMIT,
        ),
        future: state.future.slice(0, -1),
        dirty: next.workout !== state.saved,
        errors: [],
      };
    }

    case 'addBlock':
      return apply(state, (w, nextId) => {
        const block = defaultBlock(action.kind, nextId);
        const at = Math.min(Math.max(action.atIndex ?? w.blocks.length, 0), w.blocks.length);
        w.blocks.splice(at, 0, block);
        return { selectedId: block.id };
      });

    case 'moveBlock':
      if (
        action.from === action.to &&
        action.from >= 0 &&
        action.from < state.workout.blocks.length
      ) {
        return noop(state);
      }
      return apply(state, (w) => {
        const n = w.blocks.length;
        if (action.from < 0 || action.from >= n || action.to < 0 || action.to >= n) return invalid;
        const [moved] = w.blocks.splice(action.from, 1);
        if (!moved) return invalid;
        w.blocks.splice(action.to, 0, moved);
        return { selectedId: state.selectedId };
      });

    case 'resizeBlock':
      return apply(state, (w) => {
        const loc = locate(w, action.id);
        if (!loc) return notFound;
        const b = blockAt(loc);
        if (b.kind === 'repeat') return invalid;
        b.durationSec = snap(action.durationSec, action.fine === true);
        return { selectedId: state.selectedId };
      });

    case 'setIntensity':
      return apply(state, (w) => {
        const loc = locate(w, action.id);
        if (!loc) return notFound;
        const b = blockAt(loc);
        if (b.kind === 'repeat') return invalid;
        if (b.kind === 'steady') b.intensity = { effort: action.effort };
        else b[action.which ?? 'to'] = { effort: action.effort };
        return { selectedId: state.selectedId };
      });

    case 'updateBlock': {
      const { durationSec } = action.patch;
      if (durationSec !== undefined && durationSec < MIN_DURATION_SEC) {
        return fail(state, ERROR_MIN_DURATION);
      }
      return apply(state, (w) => {
        const loc = locate(w, action.id);
        if (!loc) return notFound;
        const b = blockAt(loc);
        const patch: Record<string, unknown> = { ...action.patch };
        if (b.kind === 'repeat') {
          // Only the repeat count is editable on a repeat block.
          const times = typeof patch.times === 'number' ? patch.times : b.times;
          loc.list[loc.index] = { ...b, times } as Block;
          // Lowering the count drops cues on repetitions that no longer exist.
          const childIds = new Set(b.blocks.map((c) => c.id));
          w.musicCues = w.musicCues.filter((c) => !childIds.has(c.blockId) || c.rep <= times);
        } else {
          delete patch.times;
          loc.list[loc.index] = { ...b, ...patch } as Block;
        }
        return { selectedId: state.selectedId };
      });
    }

    case 'removeBlock':
      return apply(state, (w) => {
        const loc = locate(w, action.id);
        if (!loc) return notFound;
        const [removed] = loc.list.splice(loc.index, 1);
        if (!removed) return invalid;
        pruneRemoved(w, new Set(collectIds(removed)), loc.parent === undefined);
        return { selectedId: neighbour(loc.list, loc.index) ?? loc.parent?.id };
      });

    case 'removeChild':
      return apply(state, (w) => {
        const parent = w.blocks.find((b) => b.id === action.repeatId);
        if (parent?.kind !== 'repeat') return invalid;
        const index = parent.blocks.findIndex((c) => c.id === action.childId);
        if (index < 0) return notFound;
        parent.blocks.splice(index, 1);
        pruneRemoved(w, new Set([action.childId]), false);
        return { selectedId: neighbour(parent.blocks, index) ?? parent.id };
      });

    case 'duplicateBlock':
      return apply(state, (w, nextId) => {
        const loc = locate(w, action.id);
        if (!loc) return notFound;
        const copy = cloneWithNewIds(blockAt(loc), nextId);
        loc.list.splice(loc.index + 1, 0, copy);
        return { selectedId: copy.id };
      });

    case 'addRepeatChild':
      return apply(state, (w, nextId) => {
        const parent = w.blocks.find((b) => b.id === action.repeatId);
        if (parent?.kind !== 'repeat') return invalid;
        const child = defaultBlock(action.kind, nextId) as SteadyBlock | RampBlock;
        const at = Math.min(
          Math.max(action.atIndex ?? parent.blocks.length, 0),
          parent.blocks.length,
        );
        parent.blocks.splice(at, 0, child);
        return { selectedId: child.id };
      });

    case 'setCue':
      return apply(state, (w) => {
        w.musicCues = [
          ...w.musicCues.filter((c) => !(c.blockId === action.blockId && c.rep === action.rep)),
          { blockId: action.blockId, rep: action.rep, track: action.track },
        ];
        return { selectedId: state.selectedId };
      });

    case 'clearCue':
      return apply(state, (w) => {
        w.musicCues = w.musicCues.filter(
          (c) => !(c.blockId === action.blockId && c.rep === action.rep),
        );
        return { selectedId: state.selectedId };
      });

    case 'addSong':
      return apply(state, (w, nextId) => {
        const i = w.blocks.findIndex((b) => b.id === action.blockId);
        if (i < 0) return invalid;
        if ((w.songs ?? []).some((sg) => slotRange(w, sg).includes(i))) return invalid;
        const slot: SongSlot = {
          id: nextId(),
          firstBlockId: action.blockId,
          lastBlockId: action.blockId,
        };
        w.songs = [...(w.songs ?? []), slot].sort((x, y) => slotIndex(w, x) - slotIndex(w, y));
        w.format = 'songs';
        return { selectedId: state.selectedId };
      });

    case 'removeSong':
      return apply(state, (w) => {
        if (!w.songs?.some((sg) => sg.id === action.id)) return notFound;
        w.songs = w.songs.filter((sg) => sg.id !== action.id);
        if (w.songs.length === 0) {
          delete w.songs;
          delete w.format;
        }
        return { selectedId: state.selectedId };
      });

    case 'resizeSong':
      return apply(state, (w) => {
        const slot = w.songs?.find((sg) => sg.id === action.id);
        if (!slot || !w.songs) return notFound;
        const [a, z] = [slotIndex(w, slot), slotRange(w, slot).at(-1) ?? -1];
        const na = action.edge === 'start' ? a - action.delta : a;
        const nz = action.edge === 'end' ? z + action.delta : z;
        if (na < 0 || nz >= w.blocks.length || na > nz) return invalid;
        const clash = w.songs.some(
          (o) => o.id !== slot.id && slotRange(w, o).some((k) => k >= na && k <= nz),
        );
        if (clash) return invalid;
        slot.firstBlockId = (w.blocks[na] as Block).id;
        slot.lastBlockId = (w.blocks[nz] as Block).id;
        return { selectedId: state.selectedId };
      });

    case 'updateSong':
      return apply(state, (w) => {
        const slot = w.songs?.find((sg) => sg.id === action.id);
        if (!slot) return notFound;
        const { hint, bpm, track, tracks } = action.patch;
        if (hint !== undefined) {
          if (hint === null || hint.trim() === '') delete slot.hint;
          else slot.hint = hint;
        }
        if (bpm !== undefined) {
          if (bpm === null) delete slot.bpm;
          else slot.bpm = bpm;
        }
        if (track !== undefined) {
          const rest = slotTracks(slot).slice(1);
          storeQueue(slot, track === null ? rest : [track, ...rest]);
        }
        if (tracks !== undefined) storeQueue(slot, tracks);
        return { selectedId: state.selectedId };
      });

    case 'setCooldownTrack':
      return apply(state, (w) => {
        if (action.track === null) delete w.cooldownTrack;
        else w.cooldownTrack = action.track;
        return { selectedId: state.selectedId };
      });

    case 'updateMeta':
      return apply(state, (w) => {
        Object.assign(w, action.patch);
        return { selectedId: state.selectedId };
      });
  }
}
