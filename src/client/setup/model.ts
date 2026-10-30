import { DEFAULT_PLAN_SETTINGS, type PlanSettings, type PlanSlot } from '../../domain/plan';
import type { Player } from '../../domain/player';
import { scaleWorkout } from '../../domain/scale';
import type { Segment } from '../../domain/segments';
import type { SessionConfig } from '../../domain/settings';
import type { Workout } from '../../domain/workout';
import type { MessageKey } from '../i18n';
import type { SessionRuntime } from '../training/session-store';

export const MAX_SESSION_PLAYERS = 10;

export type Background = SessionConfig['background'];
export type Hud = SessionConfig['hud'];

/** Backgrounds the player can pick today; Hyperride and YouTube arrive with M7 and M8. */
export const ENABLED_BACKGROUNDS: readonly Background[] = ['basic'];

export interface PlanRef {
  planId: string;
  week: number;
  slot: PlanSlot;
}

/** Reads `plan`, `week` and `slot` from the query; all three must be valid or there is no plan. */
export function parsePlanRef(params: URLSearchParams): PlanRef | undefined {
  const planId = params.get('plan');
  const week = Number(params.get('week'));
  const slot = params.get('slot');
  if (!planId || !Number.isInteger(week) || week < 1) return undefined;
  if (slot !== 'progres' && slot !== 'freestyle') return undefined;
  return { planId, week, slot };
}

/** Plan scaling (session length and difficulty); a failure falls back to the unscaled workout. */
export function applyPlanSettings(w: Workout, s: PlanSettings = DEFAULT_PLAN_SETTINGS): Workout {
  try {
    return scaleWorkout(w, { targetMinutes: s.sessionMinutes, difficultyPct: s.difficulty });
  } catch (err) {
    console.warn('Scaling the workout failed, using it unscaled', err);
    return w;
  }
}

export interface LayoutOption {
  value: Hud;
  labelKey: MessageKey;
  disabled?: boolean;
}

/** Basic offers Solo / With players; the overlay layouts exist only on Hyperride and YouTube. */
export function layoutOptions(background: Background, hasPlayers: boolean): LayoutOption[] {
  if (background === 'basic') {
    return [
      { value: 'solo', labelKey: 'setup.layoutSolo' },
      { value: 'players', labelKey: 'setup.layoutPlayers', disabled: !hasPlayers },
    ];
  }
  return [
    { value: 'immersive', labelKey: 'setup.layoutImmersive' },
    { value: 'column', labelKey: 'setup.layoutColumn' },
    { value: 'cockpit', labelKey: 'setup.layoutCockpit', disabled: hasPlayers },
    { value: 'tunnelTime', labelKey: 'setup.layoutTunnel', disabled: hasPlayers },
  ];
}

/** The layout that is actually in effect for the current choices. */
export function effectiveHud(
  background: Background,
  chosen: Hud | undefined,
  hasPlayers: boolean,
): Hud {
  const hit = layoutOptions(background, hasPlayers).find((o) => o.value === chosen && !o.disabled);
  if (hit) return hit.value;
  if (background === 'basic') return hasPlayers ? 'players' : 'solo';
  return 'immersive';
}

export interface SetupChoices {
  background: Background;
  /** Undefined means "automatic" (players layout whenever someone is selected). */
  hud: Hud | undefined;
  playerIds: string[];
  /** The toggle as the user left it; it only takes effect when the workout has cues. */
  music: boolean;
}

export function buildConfig(c: SetupChoices, hasMusicCues: boolean): SessionConfig {
  return {
    background: c.background,
    hud: effectiveHud(c.background, c.hud, c.playerIds.length > 0),
    playerIds: c.playerIds,
    music: c.music && hasMusicCues,
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
): SessionRuntime {
  return { workout, segments, config, players, ...(plan ? { plan } : {}) };
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
