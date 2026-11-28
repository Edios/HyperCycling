/**
 * Where the ride changes (spec fit-import §2.4), on a smoothed intensity series:
 *
 * - `pelt`: Pruned Exact Linear Time change-point detection with a squared-error cost (a change
 *   of the mean). Each extra segment costs `penalty`; a segment is at least `minSize` long.
 *   Exact for that cost, and with pruning about linear in practice.
 * - `zoneSplits`: the simpler fallback. A segment lasts until the signal leaves a band of
 *   `band` around the segment's mean for longer than `holdSize` points.
 *
 * Both return the start indices of the segments after the first (sorted, without 0 and n).
 */

export function pelt(x: ArrayLike<number>, penalty: number, minSize: number): number[] {
  const n = x.length;
  const min = Math.max(1, Math.floor(minSize));
  if (n < 2 * min) return [];
  const s1 = new Float64Array(n + 1);
  const s2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) {
    const v = x[i] as number;
    s1[i + 1] = (s1[i] as number) + v;
    s2[i + 1] = (s2[i] as number) + v * v;
  }
  const cost = (a: number, b: number): number => {
    const sum = (s1[b] as number) - (s1[a] as number);
    return (s2[b] as number) - (s2[a] as number) - (sum * sum) / (b - a);
  };

  const best = new Float64Array(n + 1).fill(Infinity);
  const prev = new Int32Array(n + 1);
  best[0] = -penalty;
  let candidates: number[] = [0];
  for (let t = min; t <= n; t += 1) {
    // A new start becomes usable once it is `min` points behind.
    if (t - min >= min) candidates.push(t - min);
    let f = Infinity;
    let arg = 0;
    const totals: number[] = [];
    for (const s of candidates) {
      const v = (best[s] as number) + cost(s, t) + penalty;
      totals.push(v);
      if (v < f) {
        f = v;
        arg = s;
      }
    }
    best[t] = f;
    prev[t] = arg;
    // Pruning: a start that cannot win now (even without the penalty) never will.
    candidates = candidates.filter((_, i) => (totals[i] as number) - penalty <= f);
  }

  const cuts: number[] = [];
  for (let t = n; t > 0; t = prev[t] as number) {
    if ((prev[t] as number) > 0) cuts.push(prev[t] as number);
  }
  return cuts.reverse();
}

export function zoneSplits(x: ArrayLike<number>, band: number, holdSize: number): number[] {
  const cuts: number[] = [];
  let sum = 0;
  let count = 0;
  let outSince = -1;
  for (let i = 0; i < x.length; i += 1) {
    const v = x[i] as number;
    const mean = count > 0 ? sum / count : v;
    if (Math.abs(v - mean) > band) {
      if (outSince < 0) outSince = i;
      if (i - outSince + 1 > holdSize) {
        // The change began where the signal left the band.
        cuts.push(outSince);
        sum = 0;
        count = 0;
        for (let j = outSince; j <= i; j += 1) {
          sum += x[j] as number;
          count += 1;
        }
        outSince = -1;
      }
      continue;
    }
    outSince = -1;
    sum += v;
    count += 1;
  }
  return cuts;
}
