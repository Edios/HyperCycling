/**
 * Turns an Experience's song suggestions (names and tempos only, no ids) into Spotify tracks of
 * the rider's own account. Pure logic: the search function is injected, so tests need no network.
 * Nothing leaves the app except the Spotify search the rider's own token makes.
 */
import { rankTracks } from '../../domain/bpm-match';
import { pickPreferred, songKey, type PlanCandidate } from '../../domain/slot-plan';
import {
  hintQueue,
  withExperiencePins,
  type Experience,
  type MusicHint,
  type SongSuggestion,
} from '../../domain/experience';
import {
  compileSongCues,
  songDurationSec,
  type MusicCue,
  type TrackRef,
  type Workout,
} from '../../domain/workout';
import type { SpotifyTrackHit } from '../music/spotify';

export type SearchFn = (query: string, limit?: number) => Promise<SpotifyTrackHit[]>;

/** A candidate scoring below this is not the song that was asked for. */
export const MIN_SCORE = 60;
/** A song this much shorter than its slot gets a warning. */
export const SHORT_TOLERANCE_SEC = 20;

const norm = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Words that mark another recording or edit of the same song, with how bad each is when unwanted. */
const VERSION_PENALTY: Record<string, number> = {
  live: 60,
  karaoke: 80,
  cover: 80,
  tribute: 80,
  sped: 80,
  slowed: 80,
  reverb: 60,
  remaster: 15,
  remastered: 15,
  remix: 30,
  acoustic: 30,
  instrumental: 30,
  extended: 10,
  radio: 10,
  edit: 10,
  demo: 40,
};

function versionWords(text: string): Set<string> {
  return new Set(
    norm(text)
      .split(' ')
      .filter((w) => w in VERSION_PENALTY),
  );
}

/** Title without the "(feat. ...)", "- Remastered 2019" parts, for comparing songs. */
function baseTitle(title: string): string {
  return norm(
    title
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/\s-\s.*$/, ' ')
      .replace(/\bfeat\.?.*$/i, ' '),
  );
}

export interface Scored {
  hit: SpotifyTrackHit;
  score: number;
}

/** Candidates for one suggestion, best first; hits that are a different song or artist are dropped. */
export function rankHits(
  want: SongSuggestion,
  hits: readonly SpotifyTrackHit[],
  opts: { explicit?: boolean; durationSec?: number } = {},
): Scored[] {
  const wantTitle = baseTitle(want.title);
  const wantArtist = norm(want.artist);
  const wanted = versionWords(want.title);
  const out: Scored[] = [];
  for (const hit of hits) {
    const title = baseTitle(hit.ref.title);
    const artist = norm(hit.ref.artist ?? '');
    let score = 0;
    // Whole title and whole words of the artist: "Stay" is not "Stay With Me", "Pink" not "Pink Floyd".
    if (title === wantTitle) score += 50;
    else continue;
    if (` ${artist} `.includes(` ${wantArtist} `)) score += 40;
    else continue;
    const have = new Set([...versionWords(hit.ref.title), ...versionWords(hit.album ?? '')]);
    for (const w of have) if (!wanted.has(w)) score -= VERSION_PENALTY[w] ?? 0;
    for (const w of wanted) if (!have.has(w)) score -= 30;
    if (hit.explicit) score += opts.explicit ? 5 : -12;
    const d = hit.ref.durationSec;
    if (opts.durationSec && d && Math.abs(d - opts.durationSec) / opts.durationSec > 0.25)
      score -= 10;
    out.push({ hit, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

export interface MatchOption {
  /** 'main' = the first suggestion, 'alt' = one of the alternatives. */
  source: 'main' | 'alt';
  wanted: SongSuggestion;
  ref: TrackRef;
  explicit: boolean;
  /** False = not playable in the rider's market. */
  playable: boolean | undefined;
  score: number;
}

export type SlotStatus = 'ok' | 'none' | 'unavailable';

export interface SlotMatch {
  slot: number;
  status: SlotStatus;
  /** Best result per suggestion, in order of preference (main first). */
  options: MatchOption[];
  /** Index into `options` of the automatic choice; absent when nothing playable was found. */
  chosen?: number;
  /** Every plausible hit of the suggestion and its alternatives (all versions), for the planner. */
  candidates: PlanCandidate[];
}

export function searchQuery(s: SongSuggestion): string {
  const clean = (v: string): string => v.replace(/["]/g, ' ').replace(/\s+/g, ' ').trim();
  return `track:${clean(s.title)} artist:${clean(s.artist)}`;
}

/** Searches the suggestion and its alternatives and picks the first one that is playable. */
export async function resolveSlot(hint: MusicHint, search: SearchFn): Promise<SlotMatch> {
  const wants: { source: 'main' | 'alt'; want: SongSuggestion }[] = [
    { source: 'main', want: hint },
    ...(hint.alternatives ?? []).map((want) => ({ source: 'alt' as const, want })),
  ];
  const options: MatchOption[] = [];
  const candidates: PlanCandidate[] = [];
  for (const { source, want } of wants) {
    const hits = await search(searchQuery(want), 8);
    const ranked = rankHits(want, hits, {
      ...(hint.explicit !== undefined ? { explicit: hint.explicit } : {}),
      ...(source === 'main' && hint.durationSec ? { durationSec: hint.durationSec } : {}),
    }).filter((r) => r.score >= MIN_SCORE);
    for (const r of ranked) {
      candidates.push({
        track: r.hit.ref,
        origin: source,
        playable: r.hit.playable,
        explicit: r.hit.explicit,
        ...(r.hit.album ? { album: r.hit.album } : {}),
        ...(want.bpm !== undefined ? { bpm: want.bpm } : {}),
      });
    }
    // The best playable hit wins; if none is playable, the best unplayable one is still shown.
    const best = ranked.find((r) => r.hit.playable !== false) ?? ranked[0];
    if (!best) continue;
    options.push({
      source,
      wanted: want,
      ref: best.hit.ref,
      explicit: best.hit.explicit,
      playable: best.hit.playable,
      score: best.score,
    });
  }
  const chosen = options.findIndex((o) => o.playable !== false);
  if (chosen >= 0) return { slot: hint.slot, status: 'ok', options, chosen, candidates };
  return {
    slot: hint.slot,
    status: options.length > 0 ? 'unavailable' : 'none',
    options,
    candidates,
  };
}

export type ItemHow = 'found' | 'longer' | 'replaced' | 'missing';

export interface ItemResult {
  want: SongSuggestion;
  how: ItemHow;
  /** The track chosen for this song (or its stand-in); absent when `how` is 'missing'. */
  ref?: TrackRef;
  /** The reserve song that took the place of an unavailable one. */
  stoodInFor?: SongSuggestion;
  /** Spotify did not say whether the track plays in the rider's country (no `is_playable`). */
  regionUnverified?: boolean;
}

/** The authored queue of one slot matched against the rider's catalogue. Deterministic. */
export interface QueueMatch {
  slot: number;
  items: ItemResult[];
  /** The tracks to play, in order, with the author's start offsets. Nothing is added to them. */
  queue: TrackRef[];
  /** All plausible hits (every version, reserve included) for the advanced editor. */
  candidates: PlanCandidate[];
}

async function searchSong(
  want: SongSuggestion,
  source: 'main' | 'alt',
  opts: { explicit?: boolean; durationSec?: number },
  search: SearchFn,
): Promise<PlanCandidate[]> {
  const hits = await search(searchQuery(want), 8);
  return rankHits(want, hits, opts)
    .filter((r) => r.score >= MIN_SCORE)
    .map((r) => ({
      track: r.hit.ref,
      origin: source,
      playable: r.hit.playable,
      explicit: r.hit.explicit,
      ...(r.hit.album ? { album: r.hit.album } : {}),
      ...(want.bpm !== undefined ? { bpm: want.bpm } : {}),
    }));
}

/**
 * Matches the slot's authored queue song by song. The preferred version is picked among the
 * results (a longer album/extended cut over a radio edit); a song that is not found or not
 * playable in the rider's region is replaced by the reserve song with the closest tempo. No song
 * is added beyond the authored queue.
 */
export async function resolveHintQueue(
  hint: MusicHint,
  search: SearchFn,
  slotSec: number,
): Promise<QueueMatch> {
  const explicit = hint.explicit !== undefined ? { explicit: hint.explicit } : {};
  const reserve: { want: SongSuggestion; cands: PlanCandidate[] }[] = [];
  const items: ItemResult[] = [];
  const candidates: PlanCandidate[] = [];
  const queue: TrackRef[] = [];
  const spent = new Set<string>();
  const authored = hintQueue(hint);
  let remaining = slotSec;
  let reserveLoaded = false;
  for (const item of authored) {
    const cands = await searchSong(
      item,
      'main',
      { ...explicit, ...(item.durationSec ? { durationSec: item.durationSec } : {}) },
      search,
    );
    candidates.push(...cands);
    const playable = cands.filter((c) => c.playable !== false);
    let pick = pickPreferred(playable, item.version, remaining);
    let how: ItemHow = 'found';
    let stoodInFor: SongSuggestion | undefined;
    if (pick) {
      const shortest = Math.min(...playable.map((c) => c.track.durationSec ?? Infinity));
      if ((pick.track.durationSec ?? 0) > shortest + 10) how = 'longer';
    } else {
      if (!reserveLoaded) {
        reserveLoaded = true;
        for (const alt of hint.alternatives ?? []) {
          const c = await searchSong(alt, 'alt', explicit, search);
          candidates.push(...c);
          reserve.push({ want: alt, cands: c });
        }
      }
      const free = reserve.filter(
        (r) =>
          !spent.has(songKey({ title: r.want.title, artist: r.want.artist })) &&
          r.cands.some((c) => c.playable !== false),
      );
      const near = [...free].sort(
        (a, b) =>
          Math.abs((a.want.bpm ?? 0) - (item.bpm ?? a.want.bpm ?? 0)) -
          Math.abs((b.want.bpm ?? 0) - (item.bpm ?? b.want.bpm ?? 0)),
      )[0];
      if (near) {
        pick = pickPreferred(
          near.cands.filter((c) => c.playable !== false),
          undefined,
          remaining,
        );
        spent.add(songKey({ title: near.want.title, artist: near.want.artist }));
        how = 'replaced';
        stoodInFor = item;
      }
    }
    if (!pick) {
      items.push({ want: item, how: 'missing' });
      continue;
    }
    const ref: TrackRef = { ...pick.track, startAtSec: item.startOffsetSec ?? 0 };
    spent.add(songKey(ref));
    queue.push(ref);
    remaining -= Math.max(0, (ref.durationSec ?? 0) - ref.startAtSec);
    items.push({
      want: item,
      how,
      ref,
      ...(stoodInFor ? { stoodInFor } : {}),
      ...(pick.playable === undefined ? { regionUnverified: true } : {}),
    });
  }
  if (!reserveLoaded) {
    for (const alt of hint.alternatives ?? []) {
      candidates.push(...(await searchSong(alt, 'alt', explicit, search)));
    }
  }
  return { slot: hint.slot, items, queue, candidates };
}

/** Every hinted slot's authored queue, sequentially (gentle on the rate limit). */
export async function resolveAllQueues(
  hints: readonly MusicHint[],
  search: SearchFn,
  slotSecOf: (slot: number) => number,
  onProgress?: (done: number, total: number) => void,
): Promise<QueueMatch[]> {
  const out: QueueMatch[] = [];
  for (const h of hints) {
    out.push(await resolveHintQueue(h, search, slotSecOf(h.slot)));
    onProgress?.(out.length, hints.length);
  }
  return out;
}

/** Every hinted slot, sequentially (gentle on the rate limit). Errors (token, 429) propagate. */
export async function resolveAll(
  hints: readonly MusicHint[],
  search: SearchFn,
  onProgress?: (done: number, total: number) => void,
): Promise<SlotMatch[]> {
  const out: SlotMatch[] = [];
  for (const h of hints) {
    out.push(await resolveSlot(h, search));
    onProgress?.(out.length, hints.length);
  }
  return out;
}

export interface Annotation {
  /** Tempo used for the check: from the library cache when known, else the author's. */
  bpm?: number;
  bpmFrom?: 'library' | 'hint';
  /** How the tempo suits the slot (2 BPM = 1 RPM); absent when unknown or the slot is beatless. */
  bpmFit?: 'on-beat' | 'close' | 'off';
  /** The song ends this many seconds before its slot does (add a second song with the same BPM). */
  shortBySec?: number;
}

/** Warnings for one option in its slot; `cache` maps a Spotify id to a tempo already known. */
export function annotate(
  option: MatchOption,
  hint: MusicHint,
  slotSec: number,
  range: readonly [number, number] | undefined,
  cache: ReadonlyMap<string, number>,
): Annotation {
  const out: Annotation = {};
  const cached = cache.get(option.ref.id);
  const bpm = cached ?? option.wanted.bpm;
  if (bpm !== undefined && !hint.noBeat) {
    out.bpm = bpm;
    out.bpmFrom = cached !== undefined ? 'library' : 'hint';
    if (range) {
      const rpm = (range[0] + range[1]) / 4; // 2 BPM = 1 RPM
      const ranked = rankTracks([{ bpm }], rpm)[0];
      out.bpmFit = ranked ? ranked.match.fit : 'off';
    }
  }
  const d = option.ref.durationSec;
  if (d !== undefined && slotSec - d > SHORT_TOLERANCE_SEC)
    out.shortBySec = Math.round(slotSec - d);
  return out;
}

/** The slot's length in seconds and its wanted BPM range. */
export function slotInfo(
  w: Workout,
  slotIndex: number,
): { id: string; sec: number; range?: [number, number] } | undefined {
  const s = w.songs?.[slotIndex];
  if (!s) return undefined;
  return { id: s.id, sec: songDurationSec(w, s), ...(s.bpm ? { range: s.bpm } : {}) };
}

/** Cues for the rider's chosen queues (slot id -> tracks), placed like a slot's own pinned tracks. */
export function choiceCues(w: Workout, choices: Readonly<Record<string, TrackRef[]>>): MusicCue[] {
  const songs = (w.songs ?? []).map((s) => {
    const { track: _drop, tracks: _drop2, ...rest } = s;
    void _drop;
    void _drop2;
    const t = choices[s.id];
    return t && t.length > 0 ? { ...rest, tracks: t } : rest;
  });
  return compileSongCues({ ...w, songs });
}

/** The workout with the experience's pins and then the rider's own matches on top. */
export function withUserMusic(
  w: Workout,
  e: Experience,
  choices: Readonly<Record<string, TrackRef[]>>,
): Workout {
  const mine = choiceCues(w, choices);
  if (mine.length === 0) return withExperiencePins(w, e);
  const key = (c: MusicCue): string => `${c.blockId}#${c.rep}`;
  const taken = new Set(mine.map(key));
  return withExperiencePins(w, {
    ...e,
    musicPins: [...e.musicPins.filter((p) => !taken.has(key(p))), ...mine],
  });
}
