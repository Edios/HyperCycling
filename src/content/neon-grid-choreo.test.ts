import { describe, expect, it } from 'vitest';
import { builtinExperiences, getWorkout } from '../client/data/builtin';
import { hintAnchorStart, withUserMusic } from '../client/experience/musicMatch';
import { choreoFrame, findCueSheet } from '../domain/choreography';
import { hintQueue, songStartsSec } from '../domain/experience';
import { musicAt } from '../domain/music-schedule';
import { flattenWorkout } from '../domain/segments';
import { effectiveMusicCues } from '../domain/workout';

/**
 * Choreography of Neon Grid 30: the cue sheets of its songs (beat grid and parts) and the two
 * anchors that move a song so that its drop or chorus starts with a block (the first stand of
 * the summit, the second sprint). Songs without a sheet ride as before.
 */
const YT_ONLY = { source: 'youtube', spotifyUsable: false } as const;
const e = builtinExperiences.find((x) => x.id === 'neon-grid-30')!;
const base = getWorkout(e.workoutRef.id)!;
const sheets = e.cueSheets ?? [];
const hints = e.musicHints ?? [];

describe('Neon Grid 30 cue sheets', () => {
  it('covers most of the songs with a beat (5 of 6; the ambient cooldown has none)', () => {
    const covered = hints.filter((h) => findCueSheet(sheets, h));
    expect(covered.map((h) => h.title)).toEqual([
      'Nightcall',
      'The Pretender',
      'Faded',
      'Pjanoo',
      'Midnight City',
    ]);
  });

  it('every sheet matches its song: tempo, uploads and their lengths', () => {
    const all = builtinExperiences.flatMap((x) =>
      (x.musicHints ?? []).flatMap((h) => hintQueue(h)),
    );
    for (const sheet of sheets) {
      const songs = all.filter((s) => findCueSheet([sheet], s));
      expect(songs.length, sheet.title).toBeGreaterThan(0);
      for (const song of songs) {
        if (song.bpm !== undefined)
          expect(Math.abs(song.bpm - sheet.bpm), sheet.title).toBeLessThanOrEqual(1);
        for (const rec of sheet.recordings) {
          const upload = song.youtube?.find((y) => y.id === rec.id);
          expect(upload, `${sheet.title} ${rec.id}`).toBeDefined();
          const len = upload?.durationSec ?? song.durationSec ?? rec.durationSec;
          expect(Math.abs(len - rec.durationSec), `${sheet.title} ${rec.id}`).toBeLessThanOrEqual(
            2,
          );
        }
      }
      expect(sheet.downbeatSec).toBeLessThan((60 / sheet.bpm) * sheet.beatsPerBar * 8);
    }
  });

  it('the anchors fit: each part comes on time and the moved song still reaches past its slot end or is closed by the gap rules', () => {
    const starts = songStartsSec(base);
    const anchored = hints.filter((h) => h.anchor);
    expect(anchored.map((h) => `${h.title} -> ${h.anchor?.blockId}`)).toEqual([
      'Pjanoo -> ng9-c',
      'Midnight City -> ng10-s2',
    ]);
    for (const h of anchored) {
      const a = hintAnchorStart(base, e, h, starts[h.slot] ?? 0);
      expect(a, h.title).toBeDefined();
      expect(a?.lateBySec, h.title).toBe(0);
    }
  });
});

describe('Neon Grid 30 ride with choreography', () => {
  const w = withUserMusic(base, e, {}, YT_ONLY);
  const segments = flattenWorkout(w);
  const cues = effectiveMusicCues(w);
  const at = (t: number) => musicAt({ segments, cues, fallback: w.fallbackPlaylist, tSec: t });
  const segAt = (blockId: string) => segments.findIndex((s) => s.blockId === blockId);

  /** The count-in half a second before `blockId` starts, from the scheduled song position. */
  function callBefore(blockId: string) {
    const i = segAt(blockId);
    const cur = segments[i - 1]!;
    const t = segments[i]!.startSec - 0.5;
    const now = at(t)!;
    expect(now.track.choreo, blockId).toBeDefined();
    return choreoFrame(now.track.choreo!, now.offsetSec, cur, segments[i], 0.5);
  }

  it('starts Pjanoo where its drop meets the first stand of the summit', () => {
    const now = at(segments[segAt('ng9-c')]!.startSec)!;
    expect(now.track.title).toBe('Pjanoo');
    expect(now.track.startAtSec).toBeGreaterThan(90);
    expect(callBefore('ng9-c').call).toEqual({ move: 'stand', count: 1, on: 'drop' });
  });

  it('starts Midnight City so that the second sprint comes with the chorus; every sprint is on the beat', () => {
    expect(callBefore('ng10-s2').call).toEqual({ move: 'sprint', count: 1, on: 'chorus' });
    for (const id of ['ng10-s1', 'ng10-s2', 'ng10-s3']) {
      const s = segments[segAt(id)]!;
      const now = at(s.startSec + 1)!;
      expect(now.track.title).toBe('Midnight City');
      expect(choreoFrame(now.track.choreo!, now.offsetSec, s, undefined, 10).onBeat, id).toBe(true);
    }
  });

  it('every upload of a covered song carries its own grid; the songs without a sheet carry none', () => {
    for (const c of cues) {
      for (const t of [c.track, ...(c.queue ?? [])]) {
        const sheet = findCueSheet(sheets, t);
        for (const rec of [t, ...(t.alternates ?? [])]) {
          const listed = sheet?.recordings.some((r) => r.id === rec.id) ?? false;
          expect(rec.choreo !== undefined, `${t.title} ${rec.id}`).toBe(listed);
        }
      }
    }
  });
});
