import { z } from 'zod';
import { BPM_MAX, BPM_MIN, matchBpm } from './bpm-match';
import { positionOf, type Segment } from './segments';
import { songKey } from './slot-plan';
import type { TrackChoreo, Workout } from './workout';

/**
 * Choreography of a song: its beat grid and its parts (verse, chorus, drop) as plain times, so the
 * ride can stand up on the chorus and pedal on the beat. A cue sheet describes one song; each of
 * its YouTube uploads is listed with how much later the song starts in it than in the first one.
 * A recording the sheet does not list plays as before, with no choreography.
 */

export const SECTION_KINDS = [
  'intro',
  'verse',
  'build',
  'chorus',
  'drop',
  'break',
  'outro',
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export interface CueSection {
  /** Seconds into the first recording of the sheet. */
  t: number;
  kind: SectionKind;
  /** Name an anchor can point at, e.g. "drop-2". */
  id?: string;
}

export interface CueRecording {
  /** The 11-character YouTube id. */
  id: string;
  /** Length of this upload, seconds. */
  durationSec: number;
  /** The song starts this much later in this upload than in the first one (negative = earlier). */
  shiftSec?: number;
}

export interface CueSheet {
  schemaVersion: 1;
  artist: string;
  title: string;
  /** Exact tempo of the grid. */
  bpm: number;
  beatsPerBar: number;
  /** The first bar line (beat 1) in the first recording, seconds. */
  downbeatSec: number;
  /** First recording = the time base of `downbeatSec` and `sections`. */
  recordings: CueRecording[];
  sections: CueSection[];
}

/** In a slot's hint: which part of its first song must fall on the start of which block. */
export interface SlotAnchor {
  blockId: string;
  /** `id` of a section of the song's cue sheet. */
  section: string;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export const cueSheetSchema: z.ZodType<CueSheet> = z
  .object({
    schemaVersion: z.literal(1),
    artist: z.string().min(1).max(120),
    title: z.string().min(1).max(160),
    bpm: z.number().min(BPM_MIN).max(BPM_MAX),
    beatsPerBar: z.number().int().min(2).max(8),
    downbeatSec: z.number().min(0).max(120),
    recordings: z
      .array(
        z.object({
          id: z.string().regex(YOUTUBE_ID),
          durationSec: z.number().min(10).max(7200),
          shiftSec: z.number().min(-120).max(120).optional(),
        }),
      )
      .min(1)
      .max(8),
    sections: z
      .array(
        z.object({
          t: z.number().min(0),
          kind: z.enum(SECTION_KINDS),
          id: z
            .string()
            .regex(/^[a-z]+(-\d+)?$/)
            .optional(),
        }),
      )
      .max(64),
  })
  .refine((s) => s.sections.every((x, i) => i === 0 || x.t > (s.sections[i - 1]?.t ?? -1)), {
    message: 'sections must be in time order',
    path: ['sections'],
  })
  .refine((s) => s.sections.every((x) => x.t < (s.recordings[0]?.durationSec ?? 0)), {
    message: 'a section starts after the end of the first recording',
    path: ['sections'],
  }) as unknown as z.ZodType<CueSheet>;

export const slotAnchorSchema = z.object({
  blockId: z.string().min(1),
  section: z.string().min(1),
});

/** The sheet of a song, matched by artist and title (the same rule as the slot plan). */
export function findCueSheet(
  sheets: readonly CueSheet[] | undefined,
  song: { artist?: string; title: string },
): CueSheet | undefined {
  const key = songKey(song);
  return sheets?.find((s) => songKey(s) === key);
}

/** Seconds into the first recording where the named section starts. */
export function sectionSec(sheet: CueSheet, id: string): number | undefined {
  return sheet.sections.find((s) => s.id === id)?.t;
}

/** The beat grid and parts of one upload, in that upload's own seconds; undefined = not listed. */
export function recordingChoreo(sheet: CueSheet, videoId: string): TrackChoreo | undefined {
  const rec = sheet.recordings.find((r) => r.id === videoId);
  if (!rec) return undefined;
  const shift = rec.shiftSec ?? 0;
  const period = 60 / sheet.bpm;
  // Keep the first bar line inside the recording: whole bars earlier or later are the same grid.
  let downbeat = sheet.downbeatSec + shift;
  const bar = period * sheet.beatsPerBar;
  while (downbeat < 0) downbeat += bar;
  return {
    bpm: sheet.bpm,
    downbeatSec: round3(downbeat),
    beatsPerBar: sheet.beatsPerBar,
    marks: sheet.sections
      .map((s) => ({ t: round3(s.t + shift), kind: s.kind }))
      .filter((m) => m.t >= 0 && m.t < rec.durationSec),
  };
}

/** Where `shiftSec` puts the song in this upload; undefined = the upload is not on the sheet. */
export function recordingShift(sheet: CueSheet, videoId: string): number | undefined {
  const rec = sheet.recordings.find((r) => r.id === videoId);
  return rec ? (rec.shiftSec ?? 0) : undefined;
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Start of a block in workout seconds (top-level, or a child in the first round of a repeat). */
export function blockStartSec(w: Workout, blockId: string): number | undefined {
  let t = 0;
  for (const b of w.blocks) {
    if (b.id === blockId) return t;
    if (b.kind === 'repeat') {
      let inner = t;
      for (const c of b.blocks) {
        if (c.id === blockId) return inner;
        inner += c.durationSec;
      }
      t += b.times * b.blocks.reduce((s, c) => s + c.durationSec, 0);
    } else t += b.durationSec;
  }
  return undefined;
}

export interface AnchorResult {
  /** Where the first recording starts playing so that the section falls on the block. */
  startSec: number;
  /** The section comes this many seconds after the block starts (the song is too short before it). */
  lateBySec: number;
}

/**
 * Moves the song, not the plan: the start of the first recording so that the anchor's section
 * starts with the anchor's block. Undefined when the block or the section is unknown.
 */
export function anchorStart(
  slotStartSec: number,
  w: Workout,
  anchor: SlotAnchor,
  sheet: CueSheet,
): AnchorResult | undefined {
  const block = blockStartSec(w, anchor.blockId);
  const at = sectionSec(sheet, anchor.section);
  if (block === undefined || at === undefined || block < slotStartSec) return undefined;
  const start = at - (block - slotStartSec);
  return start >= 0
    ? { startSec: round3(start), lateBySec: 0 }
    : { startSec: 0, lateBySec: round3(-start) };
}

/** What the rider is about to do at the next block, as the HUD counts it in. */
export type ChoreoMove = 'stand' | 'sit' | 'sprint';

export interface ChoreoCall {
  move: ChoreoMove;
  /** Counts left (4..1), one per beat (two beats in a fast song). */
  count: number;
  /** The song's part that starts with the block, when there is one. */
  on?: 'chorus' | 'drop';
}

export interface ChoreoFrame {
  /** Index of the beat now, counted from the grid's first bar line (negative before it). */
  beat: number;
  /** 0 = the first beat of a bar. */
  beatInBar: number;
  /** How far into the beat, 0..1. */
  phase: number;
  /** Seconds between two counted beats (one beat, or two in a fast song). */
  countSec: number;
  /** Part of the song now; undefined before the first mark. */
  section?: SectionKind;
  /** The block's cadence goes with the song's tempo, so the beat is worth showing. */
  onBeat: boolean;
  call?: ChoreoCall;
}

/** Counts lead in this many counted beats. */
export const CHOREO_LEAD_COUNTS = 4;
/** A beat shorter than this is counted in pairs (a 174 BPM song counts at 87). */
const FAST_BEAT_SEC = 0.4;

function moveOf(cur: Segment, next: Segment): ChoreoMove | undefined {
  const now = positionOf(cur);
  const then = positionOf(next);
  if (then === 'standing' && now !== 'standing') return 'stand';
  if (now === 'standing' && then !== 'standing') return 'sit';
  if (next.label === '@sprint' && cur.label !== '@sprint') return 'sprint';
  return undefined;
}

/**
 * The choreography at song second `songSec` of a recording, while block `cur` has `remainingSec`
 * left and `next` follows. The count-in runs on the song's beat: the last four counted beats
 * before the change, and says "on the chorus" when a chorus or drop starts with the next block
 * (within a bar).
 */
export function choreoFrame(
  c: TrackChoreo,
  songSec: number,
  cur: Segment,
  next: Segment | undefined,
  remainingSec: number,
): ChoreoFrame {
  const period = 60 / c.bpm;
  const pos = (songSec - c.downbeatSec) / period;
  const beat = Math.floor(pos);
  const beatInBar = ((beat % c.beatsPerBar) + c.beatsPerBar) % c.beatsPerBar;
  const countSec = period < FAST_BEAT_SEC ? period * 2 : period;
  const section = [...c.marks].reverse().find((m) => m.t <= songSec)?.kind;
  const frame: ChoreoFrame = {
    beat,
    beatInBar,
    phase: pos - beat,
    countSec,
    onBeat: cur.rpm !== undefined && matchBpm(c.bpm, cur.rpm) !== undefined,
    ...(section ? { section } : {}),
  };
  const move = next ? moveOf(cur, next) : undefined;
  if (move && remainingSec > 0 && remainingSec <= countSec * CHOREO_LEAD_COUNTS) {
    const count = Math.min(
      CHOREO_LEAD_COUNTS,
      Math.max(1, Math.ceil(remainingSec / countSec - 0.05)),
    );
    const changeAt = songSec + remainingSec;
    const bar = period * c.beatsPerBar;
    const part = c.marks.find(
      (m) => (m.kind === 'chorus' || m.kind === 'drop') && Math.abs(m.t - changeAt) <= bar,
    );
    frame.call = {
      move,
      count,
      ...(part && move !== 'sit' ? { on: part.kind as 'chorus' | 'drop' } : {}),
    };
  }
  return frame;
}
