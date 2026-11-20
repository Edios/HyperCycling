import { describe, expect, it } from 'vitest';
import { builtinExperiences, getWorkout } from '../client/data/builtin';
import { fillGaps, withUserMusic, chainChoices } from '../client/experience/musicMatch';
import { hintQueue } from '../domain/experience';
import { cueRuns, musicAt } from '../domain/music-schedule';
import { flattenWorkout } from '../domain/segments';
import { songKey } from '../domain/slot-plan';
import { effectiveMusicCues, totalDurationSec, type TrackRef } from '../domain/workout';

const YT_ONLY = { source: 'youtube', spotifyUsable: false } as const;
const IDS = ['neon-grid-30', 'neon-grid-45', 'neon-grid-45-light'] as const;

function ride(id: string) {
  const e = builtinExperiences.find((x) => x.id === id)!;
  const base = getWorkout(e.workoutRef.id)!;
  const w = withUserMusic(base, e, {}, YT_ONLY);
  return {
    e,
    base,
    w,
    segments: flattenWorkout(w),
    cues: effectiveMusicCues(w),
    end: totalDurationSec(w) - (w.silenceLastSec ?? 0),
  };
}

/** Seconds (sampled every second) outside the closing silence where nothing is scheduled. */
function holes(id: string, ended?: ReadonlyMap<string, number>): number[] {
  const { w, segments, cues, end } = ride(id);
  const out: number[] = [];
  for (let t = 0; t < end; t += 1) {
    const at = musicAt({
      segments,
      cues,
      fallback: w.fallbackPlaylist,
      tSec: t,
      ...(ended ? { ended } : {}),
    });
    if (!at) out.push(t);
  }
  return out;
}

/** Shortest real play length of a queue entry over all its recordings. */
const shortest = (t: TrackRef): number =>
  Math.min(
    ...[t, ...(t.alternates ?? [])].map((r) =>
      r.durationSec === undefined ? Infinity : r.durationSec - r.startAtSec,
    ),
  );

describe('Neon Grid music: no silence outside the closing silence (seamless contract)', () => {
  it.each(IDS)('%s: every second has music', (id) => {
    expect(holes(id)).toEqual([]);
  });

  it.each(IDS)('%s: still no hole when every song ends on its shortest upload', (id) => {
    // The director marks a song over when its recording ends (ENDED) or none reaches the
    // position; the queue then moves up and the fallback fills the rest. Worst case: every song
    // plays its shortest upload.
    const { segments, cues } = ride(id);
    const ended = new Map<string, number>();
    for (const run of cueRuns(segments, cues)) {
      for (const item of run.items) {
        const real = shortest(item.track);
        if (real < (item.track.durationSec ?? Infinity) - item.track.startAtSec) {
          ended.set(item.key, item.track.startAtSec + real);
        }
      }
    }
    expect(ended.size).toBeGreaterThan(0);
    expect(holes(id, ended)).toEqual([]);
  });

  it.each(IDS)('%s: has a long, calm fallback track with a backup recording', (id) => {
    const { w } = ride(id);
    const [bed] = w.fallbackPlaylist;
    expect(bed?.provider).toBe('youtube');
    expect(bed?.durationSec).toBeGreaterThanOrEqual(15 * 60);
    expect(bed?.alternates?.length).toBeGreaterThan(0);
  });

  it.each(IDS)('%s: a reserve song never repeats a song of the session', (id) => {
    const { e, w } = ride(id);
    const authored = new Set((e.musicHints ?? []).flatMap(hintQueue).map(songKey));
    const { report } = fillGaps(w, e, chainChoices(w, e, {}, YT_ONLY), YT_ONLY);
    const added = Object.values(report).flatMap((r) => r.added);
    for (const key of added) expect(authored.has(key), key).toBe(false);
    expect(new Set(added).size).toBe(added.length);
  });

  it('closes the known gaps with the rules of the spec, in order', () => {
    const rules = (id: string) => {
      const { e, w } = ride(id);
      const { report } = fillGaps(w, e, chainChoices(w, e, {}, YT_ONLY), YT_ONLY);
      return Object.fromEntries(
        Object.entries(report)
          .filter(([, r]) => r.rules.length > 0)
          .map(([slot, r]) => [slot.replace(/^class-neon-grid-[\w-]+?-s/, 's'), r.rules.join('+')]),
      );
    };
    // Nightcall (257 s in 300 s): a reserve song when the session does not play it elsewhere,
    // else the calm fallback. Witchcraft (236 s in 300 s): Propane Nightmares at the same tempo.
    // Tidal Wave (232 s in 240 s): 8 s, too short for another song, so the fallback.
    expect(rules('neon-grid-45')).toEqual({ s1: 'reserve', s7: 'reserve', s10: 'fallback' });
    expect(rules('neon-grid-45-light')).toEqual({ s1: 'fallback', s7: 'reserve', s10: 'fallback' });
    expect(rules('neon-grid-30')).toEqual({ s1: 'fallback', s6: 'fallback' });
  });

  it('leaves no silence to report (R5) in any slot', () => {
    for (const id of IDS) {
      const { e, w } = ride(id);
      const { report } = fillGaps(w, e, chainChoices(w, e, {}, YT_ONLY), YT_ONLY);
      for (const [slot, r] of Object.entries(report)) expect(r.silenceSec, `${id} ${slot}`).toBe(0);
    }
  });
});
