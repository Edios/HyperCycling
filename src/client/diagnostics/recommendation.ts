/** One measured combination of the performance test. */
export interface TestResult {
  world: string;
  quality: 'high' | 'low';
  avgFps: number;
  /** Worst-case fps (slowest 5 % of frames). */
  p5Fps: number;
  slowPct: number;
  /** Canvas backing-buffer size in px. */
  width: number;
  height: number;
}

export type Recommendation = 'high' | 'low' | 'basic';

const smooth = (r: TestResult, minFps: number, maxSlowPct: number): boolean =>
  r.avgFps >= minFps && r.slowPct <= maxSlowPct;

/** Picks the best quality at which every tested world still runs smoothly. */
export function recommendQuality(results: readonly TestResult[]): Recommendation | undefined {
  if (results.length === 0) return undefined;
  const of = (q: TestResult['quality']): TestResult[] => results.filter((r) => r.quality === q);
  if (of('high').every((r) => smooth(r, 50, 5)) && of('high').length > 0) return 'high';
  if (of('low').every((r) => smooth(r, 40, 10)) && of('low').length > 0) return 'low';
  return 'basic';
}
