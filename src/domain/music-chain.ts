/**
 * The chain of recordings behind each song of an Experience slot. A song can be played from
 * several YouTube uploads and, when the rider linked it, from Spotify; the music tries them in
 * order and moves on at once when one fails. This file only builds the chains (pure logic).
 *
 * Order: the "music source" setting decides who goes first. YouTube is the default (it needs no
 * account); with Spotify chosen (or Auto and Spotify connected) Spotify goes first and YouTube is
 * the backup. Uploads that a music check found dead go to the end of the chain.
 */
import { hintQueue, type MusicHint, type QueueItem, type YoutubeCandidate } from './experience';
import { songKey } from './slot-plan';
import { MAX_ALTERNATES, type TrackRef } from './workout';

export type MusicSource = 'youtube' | 'spotify' | 'auto';
export const MUSIC_SOURCES: readonly MusicSource[] = ['youtube', 'spotify', 'auto'];
export const DEFAULT_MUSIC_SOURCE: MusicSource = 'youtube';

export interface ChainOptions {
  source: MusicSource;
  /** Spotify is connected, so its tracks can play. */
  spotifyUsable: boolean;
  /** The rider's matched Spotify tracks for the slot, in queue order (may be shorter than the hint). */
  spotify?: readonly TrackRef[];
  /** `provider:id` of recordings a music check found dead; they go last in their chain. */
  dead?: ReadonlySet<string>;
}

export const trackKey = (t: Pick<TrackRef, 'provider' | 'id'>): string => `${t.provider}:${t.id}`;

/** The TrackRef of one YouTube upload of `item`. */
export function youtubeTrack(item: QueueItem, cand: YoutubeCandidate): TrackRef {
  return {
    provider: 'youtube',
    id: cand.id,
    title: item.title,
    artist: item.artist,
    startAtSec: cand.offsetSec ?? item.startOffsetSec ?? 0,
    ...((cand.durationSec ?? item.durationSec) !== undefined
      ? { durationSec: cand.durationSec ?? item.durationSec }
      : {}),
    ...(item.bpm !== undefined ? { bpm: item.bpm } : {}),
  };
}

const titleKey = (t: { title: string }): string => songKey({ title: t.title });

/** Pairs the rider's Spotify tracks with the authored items: by title, then by position. */
function pairSpotify(
  items: readonly QueueItem[],
  tracks: readonly TrackRef[],
): (TrackRef | undefined)[] {
  const out: (TrackRef | undefined)[] = items.map(() => undefined);
  const free: TrackRef[] = [];
  for (const t of tracks) {
    const i = items.findIndex((it, k) => out[k] === undefined && titleKey(it) === titleKey(t));
    if (i >= 0) out[i] = t;
    else free.push(t); // e.g. a stand-in from the reserve
  }
  for (const t of free) {
    const i = out.findIndex((x) => x === undefined);
    if (i >= 0) out[i] = t;
  }
  return out;
}

/** The recordings of one song, best first: the first is played, the others are the way around. */
export function songChain(
  item: QueueItem,
  spotify: TrackRef | undefined,
  opts: Pick<ChainOptions, 'source' | 'spotifyUsable' | 'dead'>,
): TrackRef[] {
  const yt = (item.youtube ?? []).map((c) => youtubeTrack(item, c));
  const sp: TrackRef[] = [];
  if (opts.spotifyUsable && spotify) {
    const { alternates: _a, ...plain } = spotify;
    void _a;
    sp.push(plain);
  }
  const spotifyFirst = opts.source !== 'youtube' && sp.length > 0;
  const chain = spotifyFirst ? [...sp, ...yt] : [...yt, ...sp];
  const dead = opts.dead;
  const ordered = dead
    ? [
        ...chain.filter((t) => !dead.has(trackKey(t))),
        ...chain.filter((t) => dead.has(trackKey(t))),
      ]
    : chain;
  return ordered.slice(0, MAX_ALTERNATES + 1);
}

/** The queue of one slot: one TrackRef per authored song, each carrying its backups. */
export function slotQueue(hint: MusicHint, opts: ChainOptions): TrackRef[] {
  const items = hintQueue(hint);
  const paired = pairSpotify(items, opts.spotify ?? []);
  const out: TrackRef[] = [];
  items.forEach((item, i) => {
    const [first, ...rest] = songChain(item, paired[i], opts);
    if (first) out.push(rest.length > 0 ? { ...first, alternates: rest } : first);
  });
  return out;
}

/** Every recording of a slot's queue, flat (the music check tests each of them). */
export function queueRecordings(queue: readonly TrackRef[]): TrackRef[] {
  return queue.flatMap((t) => [t, ...(t.alternates ?? [])]);
}
