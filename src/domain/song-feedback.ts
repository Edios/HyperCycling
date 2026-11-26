/**
 * The owner's per-song feedback during a ride (energy matching spec §9 J): a thumb up or down and
 * a heart for the song that plays, with what the planner weighed when it chose it (the part, the
 * effort, the cadence, the tempo, 1:1 or 2x). Data for tuning the planner's weights by hand: the
 * planner does not read it. Kept on the device and in the backup, never sent anywhere.
 */
import { z } from 'zod';
import { matchBpm, type MatchKind } from './bpm-match';
import type { Segment } from './segments';
import type { TrackRef } from './workout';

export const SONG_FEEDBACK_VERSION = 1;

export type SongRating = 'up' | 'down';

export interface FeedbackContext {
  /** The segment the song played in: 'steady' or 'ramp', and its label when it has one. */
  segmentKind: Segment['kind'];
  label?: string;
  /** Effort 1-10 and %FTP at the segment's start. */
  effort: number;
  ftpPct: number;
  /** The cadence asked for, when the segment has one. */
  targetRpm?: number;
  /** The song's tempo, when known. */
  bpm?: number;
  /**
   * How the tempo fits the cadence (bpm-match): 'exact' = two beats per stroke (shown as 2x),
   * 'half' = one beat per stroke (1:1), 'double' = 4x. Absent when it fits none.
   */
  relation?: MatchKind;
}

export interface SongFeedbackRecord {
  /** `<ride start>|<provider>:<track id>`: one record per song per ride. */
  id: string;
  schemaVersion: typeof SONG_FEEDBACK_VERSION;
  updatedAt: string;
  rideStartedAt: string;
  workoutId: string;
  track: { provider: TrackRef['provider']; id: string; title: string; artist?: string };
  context: FeedbackContext;
  rating?: SongRating;
  love?: true;
}

export function feedbackContext(track: Pick<TrackRef, 'bpm'>, segment: Segment): FeedbackContext {
  const m =
    track.bpm !== undefined && segment.rpm !== undefined
      ? matchBpm(track.bpm, segment.rpm)
      : undefined;
  return {
    segmentKind: segment.kind,
    ...(segment.label ? { label: segment.label.slice(0, 80) } : {}),
    effort: segment.effortStart,
    ftpPct: Math.round(segment.ftpPctStart),
    ...(segment.rpm !== undefined ? { targetRpm: segment.rpm } : {}),
    ...(track.bpm !== undefined ? { bpm: Math.round(track.bpm) } : {}),
    ...(m ? { relation: m.kind } : {}),
  };
}

export interface FeedbackInput {
  rideStartedAt: string;
  workoutId: string;
  track: TrackRef;
  segment: Segment;
}

/** The record of a song in a ride, before any rating (the context is taken when it is first rated). */
export function songFeedbackRecord(input: FeedbackInput, now: Date): SongFeedbackRecord {
  const { track } = input;
  return {
    id: `${input.rideStartedAt}|${track.provider}:${track.id}`,
    schemaVersion: SONG_FEEDBACK_VERSION,
    updatedAt: now.toISOString(),
    rideStartedAt: input.rideStartedAt,
    workoutId: input.workoutId,
    track: {
      provider: track.provider,
      id: track.id,
      title: (track.title || '').slice(0, 200),
      ...(track.artist ? { artist: track.artist.slice(0, 200) } : {}),
    },
    context: feedbackContext(track, input.segment),
  };
}

/** A tap: the same thumb again clears it, the other thumb replaces it, the heart toggles. */
export function withRating(
  r: SongFeedbackRecord,
  tap: SongRating | 'love',
  now: Date,
): SongFeedbackRecord {
  const { rating, love, ...rest } = r;
  const next: SongFeedbackRecord = { ...rest, updatedAt: now.toISOString() };
  if (tap === 'love') {
    if (rating) next.rating = rating;
    if (!love) next.love = true;
  } else {
    if (rating !== tap) next.rating = tap;
    if (love) next.love = true;
  }
  return next;
}

export const songFeedbackSchema = z
  .object({
    id: z.string().min(1).max(300),
    schemaVersion: z.literal(SONG_FEEDBACK_VERSION),
    updatedAt: z.iso.datetime({ offset: true }),
    rideStartedAt: z.iso.datetime({ offset: true }),
    workoutId: z.string().min(1).max(200),
    track: z
      .object({
        provider: z.enum(['spotify', 'youtube']),
        id: z.string().min(1).max(100),
        title: z.string().max(200),
        artist: z.string().min(1).max(200).optional(),
      })
      .strict(),
    context: z
      .object({
        segmentKind: z.enum(['steady', 'ramp']),
        label: z.string().min(1).max(80).optional(),
        effort: z.number().int().min(1).max(10),
        ftpPct: z.number().min(0).max(1000),
        targetRpm: z.number().min(0).max(300).optional(),
        bpm: z.number().min(0).max(400).optional(),
        relation: z.enum(['exact', 'half', 'double']).optional(),
      })
      .strict(),
    rating: z.enum(['up', 'down']).optional(),
    love: z.literal(true).optional(),
  })
  .strict() as unknown as z.ZodType<SongFeedbackRecord>;
