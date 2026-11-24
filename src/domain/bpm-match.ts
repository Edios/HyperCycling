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
/** A song within this share of a target tempo is on the beat. */
export const BPM_ON_BEAT = 0.03;
/** Default window: a song within this share of a target tempo is close enough. */
export const BPM_CLOSE = 0.06;
/** Wider window the soundtrack planner may fall back to when a section has too few songs. */
export const BPM_RELAXED = 0.1;

export interface MatchOptions {
  /**
   * Widest relative distance that still counts as a match (default `BPM_CLOSE`). Everything past
   * `BPM_ON_BEAT` (or past the tolerance, if that is smaller) is a 'close' fit with the same score.
   */
  tolerance?: number;
}

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

/**
 * Best fit of a song tempo to a cadence, or undefined when it does not fit at all. Without options
 * the window is `BPM_CLOSE` (6%); `tolerance` widens or narrows it (invalid values = default).
 */
export function matchBpm(bpm: number, rpm: number, opts?: MatchOptions): BpmMatch | undefined {
  if (!validNumber(bpm) || !validNumber(rpm)) return undefined;
  const tol = opts?.tolerance;
  const close = tol !== undefined && Number.isFinite(tol) && tol >= 0 ? tol : BPM_CLOSE;
  const onBeat = Math.min(BPM_ON_BEAT, close);
  let best: BpmMatch | undefined;
  for (const target of targetBpms(rpm)) {
    const deviation = Math.abs(bpm - target.bpm) / target.bpm;
    if (deviation > close) continue;
    const fit: MatchFit = deviation <= onBeat ? 'on-beat' : 'close';
    const score = (fit === 'on-beat' ? 1 : 0.6) * KIND_WEIGHT[target.kind];
    if (!best || score > best.score || (score === best.score && deviation < best.deviation)) {
      best = { kind: target.kind, fit, deviation, score };
    }
  }
  return best;
}

/**
 * How a song tempo relates to a wanted BPM range (a song slot's): inside it, half its speed
 * (the song's BPM doubled falls inside) or double. The first that holds wins; undefined = no fit.
 */
export function fitToRange(bpm: number, range: readonly [number, number]): MatchKind | undefined {
  if (!validNumber(bpm)) return undefined;
  const [lo, hi] = range;
  const inside = (v: number): boolean => v >= lo && v <= hi;
  if (inside(bpm)) return 'exact';
  if (inside(bpm * 2)) return 'half';
  if (inside(bpm / 2)) return 'double';
  return undefined;
}

/** Cadences the editor mentions when it translates a song tempo to rpm. */
export const CADENCE_HINT_MIN = 50;
export const CADENCE_HINT_MAX = 130;

/** The cadence window a song tempo suits when read as `kind`: rpm = bpm / multiplier, +-tolerance. */
export interface CadenceHint {
  kind: MatchKind;
  lo: number;
  hi: number;
}

/**
 * The rpm a song tempo suits, by the same rule as `matchBpm` (2 BPM = 1 RPM, half time BPM = RPM,
 * double time 4 BPM = 1 RPM), each as a window of +- `tolerance` (default `BPM_CLOSE`). Cadences
 * nobody rides at (outside 50-130 rpm) are left out; exact first. Empty for an invalid tempo.
 */
export function cadenceHints(bpm: number, tolerance: number = BPM_CLOSE): CadenceHint[] {
  if (!validNumber(bpm)) return [];
  const kinds: MatchKind[] = ['exact', 'half', 'double'];
  const out: CadenceHint[] = [];
  for (const kind of kinds) {
    const centre = bpm / MULTIPLIER[kind];
    if (centre < CADENCE_HINT_MIN || centre > CADENCE_HINT_MAX) continue;
    out.push({
      kind,
      lo: Math.round(centre * (1 - tolerance)),
      hi: Math.round(centre * (1 + tolerance)),
    });
  }
  return out;
}

/** The rpm window of a wanted BPM range (a song slot's): 2 BPM = 1 RPM on the beat. */
export function cadenceOfBpmRange(range: readonly [number, number]): [number, number] {
  return [Math.round(range[0] / 2), Math.round(range[1] / 2)];
}

/**
 * How a song suits a cadence: 'fit' on the beat (2 BPM = 1 RPM), 'alt' in half or double time,
 * 'miss' when it does not fit at all.
 */
export type CadenceVerdict = 'fit' | 'alt' | 'miss';

const VERDICT_OF_KIND: Record<MatchKind, CadenceVerdict> = {
  exact: 'fit',
  half: 'alt',
  double: 'alt',
};

export interface CadenceFit {
  verdict: CadenceVerdict;
  /** How it fits; undefined for 'miss'. */
  kind?: MatchKind;
  /** Within the close window but not on the beat. */
  close?: boolean;
}

/** A song tempo against a block's cadence (rpm); undefined when either is not a valid number. */
export function cadenceFit(
  bpm: number | undefined,
  rpm: number | undefined,
): CadenceFit | undefined {
  if (bpm === undefined || rpm === undefined || !validNumber(bpm) || !validNumber(rpm)) {
    return undefined;
  }
  const m = matchBpm(bpm, rpm);
  if (!m) return { verdict: 'miss' };
  return {
    verdict: VERDICT_OF_KIND[m.kind],
    kind: m.kind,
    ...(m.fit === 'close' ? { close: true } : {}),
  };
}

/** A song tempo against a slot's wanted BPM range (inclusive); undefined for an invalid tempo. */
export function cadenceFitToRange(
  bpm: number | undefined,
  range: readonly [number, number],
): CadenceFit | undefined {
  if (bpm === undefined || !validNumber(bpm)) return undefined;
  const kind = fitToRange(bpm, range);
  return kind ? { verdict: VERDICT_OF_KIND[kind], kind } : { verdict: 'miss' };
}

const VERDICT_RANK: Record<CadenceVerdict, number> = { fit: 0, alt: 1, miss: 2 };

/**
 * Items best-fitting first (on the beat, then half/double time, then misses), stable inside a
 * group. Items whose tempo is unknown (undefined verdict) go last.
 */
export function sortByCadence<T>(
  items: readonly T[],
  verdictOf: (item: T) => CadenceFit | undefined,
): T[] {
  const rank = (item: T): number => {
    const v = verdictOf(item);
    return v ? VERDICT_RANK[v.verdict] : 3;
  };
  return items
    .map((item, i) => ({ item, i, r: rank(item) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.item);
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

/** Strict BPM field parser: plain digits (optionally with decimals), rounded; undefined if invalid or out of range. */
export function parseBpmInput(text: string): number | undefined {
  const m = /^(\d{2,3}(?:[.,]\d+)?)$/.exec(text.trim());
  if (!m) return undefined;
  const n = Math.round(Number((m[1] as string).replace(',', '.')));
  return n >= BPM_MIN && n <= BPM_MAX ? n : undefined;
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
