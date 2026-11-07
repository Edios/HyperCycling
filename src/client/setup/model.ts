import { DEFAULT_PLAN_SETTINGS, type PlanSettings, type PlanSlot } from '../../domain/plan';
import type { Player } from '../../domain/player';
import { scaleForPlan } from '../../domain/scale';
import type { Segment } from '../../domain/segments';
import type { SessionConfig } from '../../domain/settings';
import type { Workout } from '../../domain/workout';
import type { MessageKey } from '../i18n';
import {
  layoutChoices,
  storedHud,
  supportsRiders,
  type LayoutKind,
} from '../training/overlay-layouts';
import type { SessionOptions, SessionRuntime } from '../training/session-store';

export const MAX_SESSION_PLAYERS = 10;

export type Background = SessionConfig['background'];
export type Hud = SessionConfig['hud'];

export const RECENT_YOUTUBE_MAX = 10;

/** Backgrounds the player can pick. */
export const ENABLED_BACKGROUNDS: readonly Background[] = ['basic', 'hyperride', 'youtube'];

/** The link first, then the older ones without a repeat, at most ten. */
export function addRecentYoutubeUrl(recent: readonly string[], url: string): string[] {
  return [url, ...recent.filter((u) => u !== url)].slice(0, RECENT_YOUTUBE_MAX);
}

export interface PlanRef {
  planId: string;
  week: number;
  slot: PlanSlot;
  /** Pass through a looping plan; absent means 1. */
  cycle?: number;
}

/** Reads `plan`, `week` and `slot` from the query; all three must be valid or there is no plan. */
export function parsePlanRef(params: URLSearchParams): PlanRef | undefined {
  const planId = params.get('plan');
  const week = Number(params.get('week'));
  const slot = params.get('slot');
  if (!planId || !Number.isInteger(week) || week < 1) return undefined;
  if (slot !== 'progres' && slot !== 'freestyle') return undefined;
  const cycle = params.has('cycle') ? Number(params.get('cycle')) : 1;
  if (!Number.isInteger(cycle) || cycle < 1) return undefined;
  return { planId, week, slot, ...(cycle > 1 ? { cycle } : {}) };
}

/** Plan scaling (session length and difficulty); a failure falls back to the unscaled workout. */
export function applyPlanSettings(w: Workout, s: PlanSettings = DEFAULT_PLAN_SETTINGS): Workout {
  try {
    return scaleForPlan(w, s);
  } catch (err) {
    console.warn('Scaling the workout failed, using it unscaled', err);
    return w;
  }
}

export interface LayoutOption {
  value: LayoutKind;
  labelKey: MessageKey;
}

const LAYOUT_LABEL: Record<LayoutKind, MessageKey> = {
  classic: 'setup.layoutClassic',
  immersive: 'setup.layoutImmersive',
  column: 'setup.layoutColumn',
  cockpit: 'setup.layoutCockpit',
  tunnelTime: 'setup.layoutTunnel',
  focus: 'setup.layoutFocus',
};

export function layoutLabelKey(kind: LayoutKind): MessageKey {
  return LAYOUT_LABEL[kind];
}

/** Every layout works on every background; only Basic's own tiles (Classic) stay on Basic. */
export function layoutOptions(background: Background, experience = false): LayoutOption[] {
  return layoutChoices(background, experience).map((value) => ({
    value,
    labelKey: LAYOUT_LABEL[value],
  }));
}

/** Whether the riders panel can be on: needs a selected rider and a layout with room for it. */
export function ridersAvailable(kind: LayoutKind, hasPlayers: boolean): boolean {
  return hasPlayers && supportsRiders(kind);
}

/** Visible reason the "Show riders" switch is off-limits (never only a tooltip). */
export function ridersHintKey(kind: LayoutKind, hasPlayers: boolean): MessageKey | undefined {
  if (!hasPlayers) return 'setup.ridersHint.none';
  return supportsRiders(kind) ? undefined : 'setup.ridersHint.noRoom';
}

/**
 * Who is ticked when Setup opens: the saved riders that still exist, else the rider flagged as
 * me, else the only rider (so the HUD is not left without watts by accident).
 */
export function initialSelection(
  players: readonly Player[],
  savedIds: readonly string[] | undefined,
): string[] {
  const kept = (savedIds ?? []).filter((id) => players.some((p) => p.id === id));
  if (kept.length > 0) return kept;
  const me = players.find((p) => p.isMe);
  if (me) return [me.id];
  const only = players.length === 1 ? players[0] : undefined;
  return only ? [only.id] : [];
}

/** The layout in effect: the chosen one when this background offers it, else the default. */
export function effectiveLayout(
  background: Background,
  chosen: LayoutKind | undefined,
  experience = false,
): LayoutKind {
  const fallback: LayoutKind = background === 'basic' && !experience ? 'classic' : 'immersive';
  return chosen !== undefined && layoutChoices(background, experience).includes(chosen)
    ? chosen
    : fallback;
}

/** The layout id to store; a layout without room for riders never stores a riders panel. */
export function effectiveHud(
  background: Background,
  chosen: LayoutKind | undefined,
  hasPlayers: boolean,
  showRiders = true,
): Hud {
  const kind = effectiveLayout(background, chosen);
  return storedHud(kind, showRiders && ridersAvailable(kind, hasPlayers));
}

export interface SetupChoices {
  background: Background;
  /** Undefined means the background's default layout. */
  hud: LayoutKind | undefined;
  /** The "Show riders" switch; undefined means on. */
  showRiders?: boolean;
  playerIds: string[];
  /** The toggle as the user left it; it only takes effect when the workout has cues. */
  music: boolean;
  /** Used when the background is YouTube. */
  youtubeUrl?: string;
}

export function buildConfig(c: SetupChoices, hasMusicCues: boolean): SessionConfig {
  return {
    background: c.background,
    hud: effectiveHud(c.background, c.hud, c.playerIds.length > 0, c.showRiders),
    ...(c.showRiders === false ? { showRiders: false } : {}),
    playerIds: c.playerIds,
    music: c.music && hasMusicCues,
    ...(c.background === 'youtube' && c.youtubeUrl ? { youtubeUrl: c.youtubeUrl } : {}),
  };
}

export function peakEffort(segments: readonly Segment[]): number {
  return segments.reduce((m, s) => Math.max(m, s.effortStart, s.effortEnd), 0);
}

export function totalSec(segments: readonly Segment[]): number {
  const last = segments[segments.length - 1];
  return last ? last.startSec + last.durationSec : 0;
}

export function buildRuntime(
  workout: Workout,
  segments: Segment[],
  config: SessionConfig,
  players: Player[],
  plan: PlanRef | undefined,
  options?: SessionOptions,
): SessionRuntime {
  return {
    workout,
    segments,
    config,
    players,
    ...(plan ? { plan } : {}),
    ...(options ? { options } : {}),
  };
}

/** Players for the ids, in the given order; unknown ids are dropped. */
export function pickPlayers(all: readonly Player[], ids: readonly string[]): Player[] {
  const byId = new Map(all.map((p) => [p.id, p]));
  return ids.flatMap((id) => {
    const p = byId.get(id);
    return p ? [p] : [];
  });
}

/** True when the saved position lies inside the segment it names (the last one is inclusive). */
export function snapshotFits(
  segments: readonly Segment[],
  snap: { segmentIndex: number; workoutElapsedSec: number },
): boolean {
  const seg = segments[snap.segmentIndex];
  if (!seg || !Number.isFinite(snap.workoutElapsedSec)) return false;
  const t = snap.workoutElapsedSec;
  const end = seg.startSec + seg.durationSec;
  const last = snap.segmentIndex === segments.length - 1;
  return t >= seg.startSec && (last ? t <= end : t < end);
}
