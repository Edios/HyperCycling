import type { EffortTable } from '../../domain/effort';
import { cueRuns } from '../../domain/music-schedule';
import { flattenWorkout } from '../../domain/segments';
import {
  effectiveMusicCues,
  type MusicCue,
  type TrackRef,
  type Workout,
} from '../../domain/workout';
import { blockTotalSec, findBlock } from './model';

/** Shown length of a track whose length nobody told us (a typical song); marked as an estimate. */
export const ESTIMATE_SEC = 210;

/** Gap between two top-level bars of the timeline (Timeline.module.css `.lane { gap }`). */
export const BAR_GAP_PX = 2;

/** A free stretch narrower than this share of the workout gets no "+ next track" button. */
const MIN_GHOST_SHARE = 0.05;

/**
 * The timeline's horizontal scale. Top-level blocks are flex items sized by duration with a fixed
 * gap between them, so a time maps to `k * gap + (width - gaps) * t / total`, k = its block.
 */
export interface LaneAxis {
  totalSec: number;
  /** Start of each top-level block (seconds); one more entry at the end = total. */
  edges: number[];
}

export function laneAxis(w: Workout): LaneAxis {
  const edges = [0];
  for (const b of w.blocks) edges.push((edges.at(-1) ?? 0) + blockTotalSec(b));
  return { totalSec: edges.at(-1) ?? 0, edges };
}

/** Index of the block a time falls in; `end` edges belong to the block they close. */
function blockIndex(axis: LaneAxis, sec: number, edge: 'start' | 'end'): number {
  const n = axis.edges.length - 1;
  if (n <= 0) return 0;
  for (let k = 0; k < n; k++) {
    const a = axis.edges[k] as number;
    const z = axis.edges[k + 1] as number;
    if (edge === 'start' ? sec >= a && sec < z : sec > a && sec <= z) return k;
  }
  return edge === 'start' ? (sec <= 0 ? 0 : n - 1) : sec <= 0 ? 0 : n - 1;
}

interface AxisPoint {
  px: number;
  frac: number;
}

function point(axis: LaneAxis, sec: number, edge: 'start' | 'end'): AxisPoint {
  const t = Math.min(Math.max(sec, 0), axis.totalSec);
  return {
    px: blockIndex(axis, t, edge) * BAR_GAP_PX,
    frac: axis.totalSec > 0 ? t / axis.totalSec : 0,
  };
}

function gapsPx(axis: LaneAxis): number {
  return Math.max(0, axis.edges.length - 2) * BAR_GAP_PX;
}

const num = (x: number): string => String(Math.round(x * 1e6) / 1e6);

/** CSS `left` and `width` of the stretch [fromSec, toSec), aligned with the timeline bars. */
export function axisBox(
  axis: LaneAxis,
  fromSec: number,
  toSec: number,
  spacingPx = 3,
): { left: string; width: string } {
  const a = point(axis, fromSec, 'start');
  const z = point(axis, toSec, 'end');
  const g = gapsPx(axis);
  return {
    left: `calc(${num(a.px)}px + (100% - ${g}px) * ${num(a.frac)})`,
    width: `max(0px, calc(${num(z.px - a.px)}px + (100% - ${g}px) * ${num(z.frac - a.frac)} - ${spacingPx}px))`,
  };
}

/** Seconds per pixel of drag for a lane `widthPx` wide. */
export function secPerPx(axis: LaneAxis, widthPx: number): number {
  const usable = widthPx - gapsPx(axis);
  return usable > 0 ? axis.totalSec / usable : 0;
}

export interface LanePill {
  key: string;
  /** Cue the track belongs to. */
  blockId: string;
  rep: number;
  /** 0 = the cue's track, 1.. = its queue. */
  index: number;
  track: TrackRef;
  startSec: number;
  /** Where the pill ends on the clock (clipped; for an unknown length: the estimate). */
  endSec: number;
  /** Cue start .. next cue (or end): the furthest a trimmed end may reach on screen. */
  limitSec: number;
  estimated: boolean;
  clipped: boolean;
}

export interface LaneTail {
  key: string;
  startSec: number;
  endSec: number;
}

export interface LaneGhost {
  key: string;
  kind: 'pin' | 'next';
  /** pin: the block to pin a track to; next: the block whose cue gets the next track. */
  blockId: string;
  startSec: number;
  endSec: number;
}

export interface MusicLaneLayout {
  axis: LaneAxis;
  pills: LanePill[];
  /** Unknown-length tracks hold their slot past the estimate: hatched, not clickable. */
  tails: LaneTail[];
  ghosts: LaneGhost[];
  /** Cue (blockId, rep 1) of the selected block, whose pills get trim handles. */
  selectedCue?: { blockId: string; rep: number };
}

/** A track replaced in one cue (drag preview). */
export interface TrackOverride {
  blockId: string;
  rep: number;
  index: number;
  track: TrackRef;
}

function withOverride(cues: MusicCue[], o: TrackOverride | undefined): MusicCue[] {
  if (!o) return cues;
  return cues.map((c) => {
    if (c.blockId !== o.blockId || c.rep !== o.rep) return c;
    if (o.index === 0) return { ...c, track: o.track };
    const queue = [...(c.queue ?? [])];
    if (queue[o.index - 1]) queue[o.index - 1] = o.track;
    return { ...c, queue };
  });
}

/**
 * What the editor's music lane shows: each pinned track at its real length (from its start to its
 * trimmed end or the end of the recording), cut where the next track takes over; free time after
 * a run (the fallback playlist or silence plays there) offers "+ next track"; the selected block
 * without a track offers "+ pin a track" where nothing plays yet.
 */
export function musicLaneLayout(
  w: Workout,
  table: EffortTable,
  selectedId: string | undefined,
  readOnly: boolean,
  override?: TrackOverride,
): MusicLaneLayout {
  const axis = laneAxis(w);
  const empty: MusicLaneLayout = { axis, pills: [], tails: [], ghosts: [] };
  if (axis.totalSec <= 0) return empty;
  const segments = flattenWorkout(w, table);
  const explicit = withOverride(w.musicCues, override);
  const all = effectiveMusicCues({ ...w, musicCues: explicit });
  // Song slots and the cool-down track have lanes of their own; here they only cut runs short.
  const runs = cueRuns(segments, all, { estimateSec: ESTIMATE_SEC }).filter((r) =>
    explicit.includes(r.cue),
  );
  const pills: LanePill[] = [];
  const tails: LaneTail[] = [];
  let ghosts: LaneGhost[] = [];
  for (const run of runs) {
    const { blockId, rep } = run.cue;
    for (const item of run.items) {
      const shownEnd = item.open ? Math.min(item.fullEndSec, run.limitSec) : item.endSec;
      pills.push({
        key: `${blockId}:${rep}:${item.index}`,
        blockId,
        rep,
        index: item.index,
        track: item.track,
        startSec: item.startSec,
        endSec: shownEnd,
        limitSec: run.limitSec,
        estimated: item.open,
        clipped: item.clipped,
      });
      if (item.open && shownEnd < run.limitSec) {
        tails.push({ key: `tail:${blockId}:${rep}`, startSec: shownEnd, endSec: run.limitSec });
      }
    }
    const last = run.items.at(-1);
    if (!readOnly && rep === 1 && last && !last.open && run.endSec < run.limitSec) {
      ghosts.push({
        key: `next:${blockId}`,
        kind: 'next',
        blockId,
        startSec: run.endSec,
        endSec: run.limitSec,
      });
    }
  }

  const sel = findBlock(w, selectedId);
  const firstId = sel?.kind === 'repeat' ? sel.blocks[0]?.id : sel?.id;
  const selectedCue =
    firstId && explicit.some((c) => c.blockId === firstId && c.rep === 1)
      ? { blockId: firstId, rep: 1 }
      : undefined;
  if (!readOnly && firstId && !selectedCue) {
    const seg = segments.find((s) => s.blockId === firstId && s.rep === 1);
    const s = seg?.startSec;
    const busy = s === undefined || runs.some((r) => r.startSec <= s && s < r.endSec);
    if (s !== undefined && !busy) {
      const end = Math.min(
        runs.find((r) => r.startSec > s)?.startSec ?? axis.totalSec,
        axis.totalSec,
      );
      // A "+ next" button in the same free stretch gives way to the pin from this block on.
      ghosts = ghosts.map((g) => (g.startSec < s && s < g.endSec ? { ...g, endSec: s } : g));
      ghosts.push({
        key: `pin:${firstId}`,
        kind: 'pin',
        blockId: firstId,
        startSec: s,
        endSec: end,
      });
    }
  }
  ghosts = ghosts.filter(
    (g) => g.kind === 'pin' || (g.endSec - g.startSec) / axis.totalSec >= MIN_GHOST_SHARE,
  );
  return { axis, pills, tails, ghosts, ...(selectedCue ? { selectedCue } : {}) };
}
