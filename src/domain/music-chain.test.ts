import { describe, expect, it } from 'vitest';
import type { MusicHint } from './experience';
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
