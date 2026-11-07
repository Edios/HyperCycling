/** Raw input texts to numbers; an empty or non-numeric text becomes NaN so validation rejects it. */
export function parseSteps(values: readonly string[]): number[] {
  return values.map((v) => (v.trim() === '' ? Number.NaN : Number(v)));
}
