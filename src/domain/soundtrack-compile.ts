/**
 * Soundtrack Match, part 3b: a confirmed plan turned into the music the ride plays (pure logic,
 * soundtrack spec §5.5). The plan is a snapshot of catalog ids; this builds plain `MusicCue`s
 * (one per section, at the section's anchor) with each song's chain of recordings, exactly what
 * `music-schedule.ts` and the music director already read. Compiled at the start of a ride, so
 * a changed music source or a music check's dead uploads apply without planning again.
 */
import { songChain, type ChainOptions } from './music-chain';
import { flattenWorkout } from './segments';
import type { CatalogTrack } from './soundtrack-catalog';
import { soundtrackFingerprint, type PlanPick, type SoundtrackPlan } from './soundtrack-plan';
import { MAX_QUEUE, type MusicCue, type TrackRef, type Workout } from './workout';

export interface CompileOptions {
  catalog: readonly CatalogTrack[];
  /** Music source and dead uploads (Spotify is not part of the catalog). */
  chain?: Pick<ChainOptions, 'source' | 'spotifyUsable' | 'dead'>;
}

export interface CompiledSoundtrack {
  cues: MusicCue[];
  /** The plan's fallback songs, for the gaps (rule R4). */
  fallbackPlaylist: TrackRef[];
  /** The workout changed since the plan was made (its fingerprint differs). */
  stale: boolean;
  /** Sections left out: their anchor no longer exists in the workout. */
  skipped: string[];
  /** Picks left out: their song is no longer in the catalog. */
  missing: string[];
}

const DEFAULT_CHAIN: Pick<ChainOptions, 'source' | 'spotifyUsable'> = {
  source: 'youtube',
  spotifyUsable: false,
};

/**
 * The recordings of one pick, the chosen upload first (unless a music check found it dead), each
 * starting where the pick starts. A repeated ending (rule R3) starts the same distance before the
 * end of every upload, whatever its length.
 */
function pickRecordings(
  pick: PlanPick,
  track: CatalogTrack,
  chain: Pick<ChainOptions, 'source' | 'spotifyUsable' | 'dead'>,
): TrackRef | undefined {
  const all = songChain(track, undefined, chain);
  const chosen = all.findIndex((t) => t.id === pick.upload);
  const deadChosen = chosen >= 0 && (chain.dead?.has(`youtube:${pick.upload}`) ?? false);
  const ordered =
    chosen > 0 && !deadChosen
      ? [all[chosen] as TrackRef, ...all.filter((_, i) => i !== chosen)]
      : all;
  const main = all[chosen >= 0 ? chosen : 0];
  const playSec =
    pick.startAtSec > 0 && main?.durationSec !== undefined
      ? main.durationSec - pick.startAtSec
      : undefined;
  const refs = ordered.map((t) =>
    playSec === undefined
      ? t
      : { ...t, startAtSec: Math.max(0, (t.durationSec ?? track.durationSec) - playSec) },
  );
  // The tempo is the catalog's own, checked by hand (spec §5.7).
  const [first, ...rest] = refs.map((t) =>
    t.bpm === undefined ? t : { ...t, bpmSource: 'catalog' as const },
  );
  if (!first) return undefined;
  return rest.length > 0 ? { ...first, alternates: rest } : first;
}

/** Compiles a plan for a ride (see the file comment). Never mutates its inputs. */
export function compilePlan(
  plan: SoundtrackPlan,
  workout: Workout,
  opts: CompileOptions,
): CompiledSoundtrack {
  const chain = opts.chain ?? DEFAULT_CHAIN;
  const byId = new Map(opts.catalog.map((t) => [t.id, t]));
  const anchors = new Set(flattenWorkout(workout).map((s) => `${s.blockId}#${s.rep}`));
  const cues: MusicCue[] = [];
  const skipped: string[] = [];
  const missing: string[] = [];
  const refsOf = (picks: readonly PlanPick[]): TrackRef[] => {
    const out: TrackRef[] = [];
    for (const pick of picks) {
      const track = byId.get(pick.ref.id);
      const ref = track ? pickRecordings(pick, track, chain) : undefined;
      if (ref) out.push(ref);
      else missing.push(pick.ref.id);
    }
    return out;
  };
  for (const s of plan.sections) {
    if (s.locked || s.picks.length === 0) continue;
    if (!anchors.has(`${s.anchor.blockId}#${s.anchor.rep}`)) {
      skipped.push(s.sectionId);
      continue;
    }
    const [track, ...queue] = refsOf(s.picks);
    if (!track) continue;
    const cue: MusicCue = { blockId: s.anchor.blockId, rep: s.anchor.rep, track };
    if (queue.length > 0) cue.queue = queue.slice(0, MAX_QUEUE);
    cues.push(cue);
  }
  return {
    cues,
    fallbackPlaylist: refsOf(plan.fallback),
    stale: plan.fingerprint !== soundtrackFingerprint(workout),
    skipped,
    missing,
  };
}

/**
 * The workout with the plan's music on top (spec §5.5): a cue of the plan wins over a cue of the
 * workout at the same block and repetition, the other cues stay, and the plan's fallback songs
 * come before the workout's own in the gaps. Never mutates the workout.
 */
export function withSoundtrack(
  workout: Workout,
  compiled: Pick<CompiledSoundtrack, 'cues' | 'fallbackPlaylist'>,
): Workout {
  if (compiled.cues.length === 0 && compiled.fallbackPlaylist.length === 0) return workout;
  const own = new Set(compiled.cues.map((c) => `${c.blockId}#${c.rep}`));
  return {
    ...workout,
    musicCues: [
      ...workout.musicCues.filter((c) => !own.has(`${c.blockId}#${c.rep}`)),
      ...compiled.cues,
    ],
    fallbackPlaylist: [...compiled.fallbackPlaylist, ...workout.fallbackPlaylist],
  };
}
