import { zoneForBpm, type HrZone } from '../../domain/hr-zones';
import {
  CADENCE_TOLERANCE_RPM,
  judgeCadence,
  type CadenceJudgement,
} from '../../domain/live-metrics';
import type { LinkState, LiveSnapshot } from '../devices/live-metrics';

/** What the Measures group shows from connected sensors; undefined = no sensors (HUD as before). */
export interface LiveMeasures {
  /** Worst state among the connected devices. */
  signal: Exclude<LinkState, 'off'>;
  /** Present only for a bike that shows watts and a trainer that is (or was) connected. */
  power?: { watts: number | null; target: number | null };
  /** Present when a trainer is (or was) connected. */
  cadence?: {
    rpm: number | null;
    target: number | null;
    judgement: CadenceJudgement | null;
    /** Target range for the range bar (D22). */
    band?: { low: number; high: number };
  };
  /** Present when a strap is (or was) connected. */
  hr?: {
    bpm: number | null;
    zone: HrZone | null;
    noContact: boolean;
    /** The block's HR zone in bpm, for the range bar (D22). */
    band?: { low: number; high: number };
  };
}

export interface LiveContext {
  showsWatts: boolean;
  /** Target watts of the block for the rider on the trainer, null without an FTP. */
  targetW: number | null;
  /** Target cadence of the block, if any. */
  targetRpm: number | undefined;
  hrMax: number | undefined;
  /** Trainer mode shows the power in the effort ring: no separate power row. */
  powerInRing?: boolean;
  /** The block's HR zone in bpm (from HRmax), if known. */
  hrBand?: { low: number; high: number };
}

const SEVERITY: Record<LinkState, number> = { off: 0, live: 1, stale: 2, reconnecting: 3, lost: 4 };

export function worstLink(a: LinkState, b: LinkState): LinkState {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

export function buildLiveMeasures(live: LiveSnapshot, ctx: LiveContext): LiveMeasures | undefined {
  const signal = worstLink(live.trainer, live.hr);
  if (signal === 'off') return undefined;
  const out: LiveMeasures = { signal };
  if (live.trainer !== 'off') {
    if (ctx.showsWatts && !ctx.powerInRing) out.power = { watts: live.powerW, target: ctx.targetW };
    const target = ctx.targetRpm ?? null;
    out.cadence = {
      rpm: live.cadenceRpm,
      target,
      judgement:
        live.cadenceRpm !== null && target !== null ? judgeCadence(live.cadenceRpm, target) : null,
      ...(target !== null
        ? { band: { low: target - CADENCE_TOLERANCE_RPM, high: target + CADENCE_TOLERANCE_RPM } }
        : {}),
    };
  }
  if (live.hr !== 'off') {
    out.hr = {
      bpm: live.hrBpm,
      zone: live.hrBpm === null ? null : zoneForBpm(live.hrBpm, ctx.hrMax),
      noContact: live.hrContact === 'none',
      ...(ctx.hrBand ? { band: ctx.hrBand } : {}),
    };
  }
  return out;
}
