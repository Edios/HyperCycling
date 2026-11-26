/**
 * Soundtrack Match, part 6: the rider's own songs (a YouTube link, a title, a tempo the rider
 * typed). Kept on the device like the saved plans (the `ownTracks` repository), never sent
 * anywhere: no tempo lookup, no YouTube API. The planner reads them as catalog songs
 * (`toCatalogTrack`) with the same tempo rules (`matchBpm`, half and double time), when the rider
 * turns "Use my songs" on.
 */
import { z } from 'zod';
import { BPM_MAX, BPM_MIN } from './bpm-match';
import { YOUTUBE_ID } from './experience';
import {
  ROLE_SPRINT_RPM,
  catalogRpm,
  type CatalogTrack,
  type TrackEnergy,
} from './soundtrack-catalog';

export const OWN_TRACK_RECORD_VERSION = 1;
/** Own songs' ids start with this; catalog ids are slugs and never do. */
export const OWN_ID_PREFIX = 'own-';
/** A song whose length the rider did not give is taken as this long (a typical radio edit). */
export const DEFAULT_OWN_DURATION_SEC = 210;
/** A song whose energy the rider did not give sits in the middle. */
export const DEFAULT_OWN_ENERGY: TrackEnergy = 3;
/** Hard cap: the planner looks at every song for every part. */
export const MAX_OWN_TRACKS = 300;
const MAX_TEXT = 120;
const MIN_SEC = 30;
const MAX_SEC = 60 * 60;

export interface OwnTrackRecord {
  /** The storage key: `own-` + the video id when the app adds it (one record per video). */
  id: string;
  schemaVersion: typeof OWN_TRACK_RECORD_VERSION;
  createdAt: string;
  youtubeId: string;
  title: string;
  artist?: string;
  /** The tempo the rider typed (whole BPM). */
  bpm: number;
  energy?: TrackEnergy;
  /** Length in seconds, when the rider gave it. */
  durationSec?: number;
  /** Where the song starts in the video, seconds (the link's `?t=`). */
  startSec?: number;
}

export interface OwnTrackInput {
  youtubeId: string;
  title: string;
  artist?: string | undefined;
  bpm: number;
  energy?: TrackEnergy | undefined;
  durationSec?: number | undefined;
  startSec?: number | undefined;
}

export function isOwnTrackId(id: string): boolean {
  return id.startsWith(OWN_ID_PREFIX);
}

export const ownTrackRecordSchema = z
  .object({
    id: z.string().min(1).max(80),
    schemaVersion: z.literal(OWN_TRACK_RECORD_VERSION),
    createdAt: z.iso.datetime({ offset: true }),
    youtubeId: z.string().regex(YOUTUBE_ID),
    title: z.string().min(1).max(MAX_TEXT),
    artist: z.string().min(1).max(MAX_TEXT).optional(),
    bpm: z.number().int().min(BPM_MIN).max(BPM_MAX),
    energy: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
      .optional(),
    durationSec: z.number().int().min(MIN_SEC).max(MAX_SEC).optional(),
    startSec: z.number().int().min(1).max(MAX_SEC).optional(),
  })
  .strict() as unknown as z.ZodType<OwnTrackRecord>;

/** The record for a song the rider adds (texts trimmed, numbers whole). Not validated here. */
export function ownTrackRecord(input: OwnTrackInput, now: Date): OwnTrackRecord {
  const artist = input.artist?.trim();
  return {
    id: OWN_ID_PREFIX + input.youtubeId,
    schemaVersion: OWN_TRACK_RECORD_VERSION,
    createdAt: now.toISOString(),
    youtubeId: input.youtubeId,
    title: input.title.trim().slice(0, MAX_TEXT),
    ...(artist ? { artist: artist.slice(0, MAX_TEXT) } : {}),
    bpm: Math.round(input.bpm),
    ...(input.energy !== undefined ? { energy: input.energy } : {}),
    ...(input.durationSec !== undefined ? { durationSec: Math.round(input.durationSec) } : {}),
    ...(input.startSec !== undefined && input.startSec >= 1
      ? { startSec: Math.min(MAX_SEC, Math.round(input.startSec)) }
      : {}),
  };
}

/** Roles of an own song: any but the finisher mark, a sprint tempo for intervals only. */
const ANY_ROLE: CatalogTrack['roles'] = ['warmup', 'steady', 'climb', 'intervals', 'cooldown'];

/**
 * An own song as the planner reads it: on the beat, clean (the rider chose it), of any category
 * (`own`), with its one upload. An artist left out is the title, so two own songs without an
 * artist do not count as the same artist.
 */
export function toCatalogTrack(r: OwnTrackRecord): CatalogTrack {
  const durationSec = r.durationSec ?? DEFAULT_OWN_DURATION_SEC;
  return {
    // Made of the video id whatever the storage key, so a plan's pick always names the video.
    id: OWN_ID_PREFIX + r.youtubeId,
    artist: r.artist ?? r.title,
    title: r.title,
    bpm: r.bpm,
    durationSec,
    youtube: [{ id: r.youtubeId, durationSec }],
    ...(r.startSec !== undefined && r.startSec < durationSec ? { startOffsetSec: r.startSec } : {}),
    categories: [],
    roles: catalogRpm(r.bpm) >= ROLE_SPRINT_RPM ? ['intervals'] : [...ANY_ROLE],
    energy: r.energy ?? DEFAULT_OWN_ENERGY,
    beat: 'steady',
    clean: true,
    verified: r.createdAt.slice(0, 10),
    own: true,
  };
}

/**
 * The songs the planner and the ride read: the catalog and the rider's own songs (the planner
 * leaves the own ones out unless `includeLibrary` is on). The catalog itself when there are none.
 * An own song whose video is a catalog upload is left out: the catalog song is the same recording
 * with a checked tempo, and one video never plays twice in a ride.
 */
export function withOwnTracks(
  catalog: readonly CatalogTrack[],
  own: readonly OwnTrackRecord[],
): readonly CatalogTrack[] {
  if (own.length === 0) return catalog;
  const uploads = new Set(catalog.flatMap((t) => t.youtube.map((u) => u.id)));
  const seen = new Set<string>();
  const mine: CatalogTrack[] = [];
  for (const r of own) {
    if (mine.length >= MAX_OWN_TRACKS) break;
    if (uploads.has(r.youtubeId)) continue;
    const t = toCatalogTrack(r);
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    mine.push(t);
  }
  return [...catalog, ...mine];
}
