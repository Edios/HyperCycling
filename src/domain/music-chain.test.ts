import { describe, expect, it } from 'vitest';
import type { CueSheet } from './choreography';
import type { MusicHint, QueueItem } from './experience';
import { queueRecordings, slotQueue, songChain, trackKey } from './music-chain';
import type { TrackRef } from './workout';

const hint: MusicHint = {
  slot: 0,
  artist: 'Zedd',
  title: 'Clarity',
  startOffsetSec: 4,
  durationSec: 271,
  youtube: [{ id: 'AAAAAAAAAAA' }, { id: 'BBBBBBBBBBB', offsetSec: 9, label: 'lyric' }],
  queue: [
    {
      artist: 'David Guetta',
      title: 'Titanium',
      youtube: [{ id: 'CCCCCCCCCCC' }, { id: 'DDDDDDDDDDD' }],
    },
  ],
};
const sp = (id: string, title: string): TrackRef => ({
  provider: 'spotify',
  id,
  title,
  startAtSec: 0,
});

describe('slotQueue', () => {
  it('YouTube first by default: main upload, its backups, one entry per authored song', () => {
    const q = slotQueue(hint, { source: 'youtube', spotifyUsable: false });
    expect(q.map((t) => t.id)).toEqual(['AAAAAAAAAAA', 'CCCCCCCCCCC']);
    expect(q[0]?.alternates?.map((t) => t.id)).toEqual(['BBBBBBBBBBB']);
    expect(q[0]?.startAtSec).toBe(4); // the item's offset
    expect(q[0]?.alternates?.[0]?.startAtSec).toBe(9); // the upload's own start
  });

  it('keeps Spotify as the last backup when YouTube is the source', () => {
    const q = slotQueue(hint, {
      source: 'youtube',
      spotifyUsable: true,
      spotify: [sp('s1', 'Clarity'), sp('s2', 'Titanium')],
    });
    expect(q[0]?.provider).toBe('youtube');
    expect(q[0]?.alternates?.map((t) => t.id)).toEqual(['BBBBBBBBBBB', 's1']);
    expect(q[1]?.alternates?.map((t) => t.id)).toEqual(['DDDDDDDDDDD', 's2']);
  });

  it('Spotify first when chosen and connected, YouTube behind it', () => {
    const opts = { spotifyUsable: true, spotify: [sp('s1', 'Clarity - Radio Edit')] };
    const q = slotQueue(hint, { ...opts, source: 'spotify' });
    expect(q[0]).toMatchObject({ provider: 'spotify', id: 's1' });
    expect(q[0]?.alternates?.map((t) => t.id)).toEqual(['AAAAAAAAAAA', 'BBBBBBBBBBB']);
    expect(q[1]?.provider).toBe('youtube'); // no Spotify track for Titanium
    expect(slotQueue(hint, { ...opts, source: 'auto' })[0]?.provider).toBe('spotify');
  });

  it('Spotify chosen but not connected: YouTube plays', () => {
    const q = slotQueue(hint, {
      source: 'spotify',
      spotifyUsable: false,
      spotify: [sp('s1', 'Clarity')],
    });
    expect(q.map((t) => t.provider)).toEqual(['youtube', 'youtube']);
    expect(queueRecordings(q).some((t) => t.provider === 'spotify')).toBe(false);
  });

  it('a stand-in Spotify track takes the place of the song it replaced', () => {
    const q = slotQueue(hint, {
      source: 'spotify',
      spotifyUsable: true,
      spotify: [sp('s9', 'Something Else')],
    });
    expect(q[0]).toMatchObject({ provider: 'spotify', id: 's9' });
  });

  it('puts recordings found dead last', () => {
    const q = slotQueue(hint, {
      source: 'youtube',
      spotifyUsable: false,
      dead: new Set(['youtube:AAAAAAAAAAA']),
    });
    expect(q[0]?.id).toBe('BBBBBBBBBBB');
    expect(q[0]?.alternates?.map((t) => t.id)).toEqual(['AAAAAAAAAAA']);
  });

  it('a song without any recording is left out; a hint without ids gives no queue', () => {
    expect(
      slotQueue({ slot: 0, artist: 'A', title: 'B' }, { source: 'youtube', spotifyUsable: false }),
    ).toEqual([]);
  });
});

describe('songChain', () => {
  it('is capped so a track never carries more than the schema allows', () => {
    const many = {
      artist: 'A',
      title: 'B',
      youtube: Array.from({ length: 6 }, (_, i) => ({ id: `${i}`.repeat(11) })),
    };
    const chain = songChain(many, sp('s', 'B'), { source: 'youtube', spotifyUsable: true });
    expect(chain).toHaveLength(7);
    expect(trackKey(chain[6] as TrackRef)).toBe('spotify:s');
  });
});

describe('per-upload length', () => {
  it('an upload carries its own length, falling back to the song', () => {
    const q = slotQueue(
      {
        slot: 0,
        artist: 'A',
        title: 'B',
        durationSec: 404,
        youtube: [{ id: 'AAAAAAAAAAA' }, { id: 'BBBBBBBBBBB', durationSec: 213 }],
      },
      { source: 'youtube', spotifyUsable: false },
    );
    expect(q[0]?.durationSec).toBe(404);
    expect(q[0]?.alternates?.[0]?.durationSec).toBe(213);
  });
});

describe('chains with a cue sheet', () => {
  const sheet: CueSheet = {
    schemaVersion: 1,
    artist: 'A',
    title: 'Song',
    bpm: 120,
    beatsPerBar: 4,
    downbeatSec: 0.5,
    recordings: [
      { id: 'AAAAAAAAAAA', durationSec: 200 },
      { id: 'BBBBBBBBBBB', durationSec: 203, shiftSec: 3 },
    ],
    sections: [
      { t: 0, kind: 'intro' },
      { t: 60.5, kind: 'chorus', id: 'chorus-1' },
    ],
  };
  const item: QueueItem = {
    artist: 'A',
    title: 'Song',
    durationSec: 200,
    startOffsetSec: 4,
    youtube: [{ id: 'AAAAAAAAAAA' }, { id: 'BBBBBBBBBBB' }, { id: 'CCCCCCCCCCC' }],
  };
  const opts = { source: 'youtube', spotifyUsable: false, cueSheets: [sheet] } as const;

  it('gives every listed upload its grid; an unlisted one plays as authored, without one', () => {
    const [a, b, c] = songChain(item, undefined, opts);
    expect(a?.choreo?.downbeatSec).toBe(0.5);
    expect(b?.choreo?.downbeatSec).toBe(3.5);
    expect(c?.choreo).toBeUndefined();
    expect([a?.startAtSec, b?.startAtSec, c?.startAtSec]).toEqual([4, 4, 4]);
  });

  it('moves the listed uploads to the anchored start, each by its own shift', () => {
    const [a, b, c] = songChain(item, undefined, opts, { startSec: 30 });
    expect([a?.startAtSec, b?.startAtSec, c?.startAtSec]).toEqual([30, 33, 4]);
  });

  it('moves only the first song of a slot', () => {
    const hint: MusicHint = { ...item, slot: 0, queue: [{ ...item }] };
    const [first, second] = slotQueue(hint, opts, { startSec: 30 });
    expect(first?.startAtSec).toBe(30);
    expect(second?.startAtSec).toBe(4);
  });

  it('a song without a sheet has no grid', () => {
    const [a] = songChain({ ...item, title: 'Other' }, undefined, opts);
    expect(a?.choreo).toBeUndefined();
  });
});
