/**
 * Matching a song's tempo to a block's cadence. Owner's rule: 2 BPM = 1 RPM (two beats per pedal
 * revolution), so 90 RPM wants ~180 BPM. Half time (BPM = RPM) and double time (BPM = 4 x RPM)
 * also count, with a lower score. Pure logic; no I/O, no audio analysis (link-only music).
 */

export type MatchKind = 'exact' | 'half' | 'double';
export type MatchFit = 'on-beat' | 'close';

export interface BpmTarget {
  kind: MatchKind;
  bpm: number;
}

export interface BpmMatch {
  kind: MatchKind;
  fit: MatchFit;
  /** Relative distance to the target tempo (0.02 = 2%). */
  deviation: number;
  /** 0..1; exact on-beat = 1. */
  score: number;
}

/** Song tempos outside this range are not treated as real (BPM field, hints, tap tempo). */
export const BPM_MIN = 40;
export const BPM_MAX = 220;

const MULTIPLIER: Record<MatchKind, number> = { exact: 2, half: 1, double: 4 };
const KIND_WEIGHT: Record<MatchKind, number> = { exact: 1, half: 0.85, double: 0.85 };
const ON_BEAT = 0.03;
const CLOSE = 0.06;

function validNumber(n: number | undefined): n is number {
  return n !== undefined && Number.isFinite(n) && n > 0;
}

/** Tempos that suit a cadence, exact first. Targets outside the plausible song range are dropped. */
export function targetBpms(rpm: number): BpmTarget[] {
  if (!validNumber(rpm)) return [];
  const kinds: MatchKind[] = ['exact', 'half', 'double'];
  return kinds
    .map((kind) => ({ kind, bpm: rpm * MULTIPLIER[kind] }))
    .filter((t) => t.bpm >= BPM_MIN && t.bpm <= BPM_MAX);
}

/** Best fit of a song tempo to a cadence, or undefined when it does not fit at all. */
export function matchBpm(bpm: number, rpm: number): BpmMatch | undefined {
  if (!validNumber(bpm) || !validNumber(rpm)) return undefined;
  let best: BpmMatch | undefined;
  for (const target of targetBpms(rpm)) {
    const deviation = Math.abs(bpm - target.bpm) / target.bpm;
    if (deviation > CLOSE) continue;
    const fit: MatchFit = deviation <= ON_BEAT ? 'on-beat' : 'close';
    const score = (fit === 'on-beat' ? 1 : 0.6) * KIND_WEIGHT[target.kind];
    if (!best || score > best.score || (score === best.score && deviation < best.deviation)) {
      best = { kind: target.kind, fit, deviation, score };
    }
  }
  return best;
}

/** BPM from tap timestamps (ms): median interval of the last 12 taps, so one stray tap is ignored. */
export function tapTempoBpm(tapsMs: number[]): number | undefined {
  const taps = tapsMs.slice(-12);
  if (taps.length < 4) return undefined;
  const gaps: number[] = [];
  for (let i = 1; i < taps.length; i++) gaps.push((taps[i] as number) - (taps[i - 1] as number));
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median =
    gaps.length % 2 === 1
      ? (gaps[mid] as number)
      : ((gaps[mid - 1] as number) + (gaps[mid] as number)) / 2;
  if (median <= 0) return undefined;
  const bpm = Math.round(60000 / median);
  return bpm >= BPM_MIN && bpm <= BPM_MAX ? bpm : undefined;
}

/** "Climb 128 BPM", "140bpm", "bpm: 172" -> the number, if it is a plausible tempo. */
export function parseBpmFromName(name: string): number | undefined {
  const m = /(\d{2,3})\s*bpm|bpm\s*[:=]?\s*(\d{2,3})/i.exec(name);
  const n = Number(m?.[1] ?? m?.[2]);
  return Number.isFinite(n) && n >= BPM_MIN && n <= BPM_MAX ? n : undefined;
}

export type GenreId =
  'chillPop' | 'hipHop' | 'pop' | 'rock' | 'dance' | 'house' | 'techno' | 'trance' | 'drumAndBass';

export interface Genre {
  id: GenreId;
  /** Typical song tempo range for the genre. */
  bpmMin: number;
  bpmMax: number;
}

/** Genre config: typical tempo ranges. Extend freely; ids are translated in i18n (`bpm.genre.<id>`). */
export const GENRES: readonly Genre[] = [
  { id: 'chillPop', bpmMin: 80, bpmMax: 100 },
  { id: 'hipHop', bpmMin: 85, bpmMax: 100 },
  { id: 'pop', bpmMin: 100, bpmMax: 130 },
  { id: 'rock', bpmMin: 110, bpmMax: 150 },
  { id: 'dance', bpmMin: 120, bpmMax: 135 },
  { id: 'house', bpmMin: 120, bpmMax: 130 },
  { id: 'techno', bpmMin: 125, bpmMax: 150 },
  { id: 'trance', bpmMin: 130, bpmMax: 145 },
  { id: 'drumAndBass', bpmMin: 160, bpmMax: 180 },
];

/** Genres whose typical range contains a target tempo for the cadence (exact, half or double). */
export function genresForRpm(rpm: number): Genre[] {
  const targets = targetBpms(rpm);
  return GENRES.filter((g) => targets.some((t) => t.bpm >= g.bpmMin && t.bpm <= g.bpmMax));
}

export interface RankedTrack<T> {
  track: T;
  match: BpmMatch;
}

/** Tracks with a known BPM that fit the cadence, best first (stable). Tracks without BPM are skipped. */
export function rankTracks<T extends { bpm?: number }>(tracks: T[], rpm: number): RankedTrack<T>[] {
  const out: { r: RankedTrack<T>; i: number }[] = [];
  tracks.forEach((track, i) => {
    if (track.bpm === undefined) return;
    const match = matchBpm(track.bpm, rpm);
    if (match) out.push({ r: { track, match }, i });
  });
  return out
    .sort(
      (a, b) =>
        b.r.match.score - a.r.match.score || a.r.match.deviation - b.r.match.deviation || a.i - b.i,
    )
    .map((x) => x.r);
}
