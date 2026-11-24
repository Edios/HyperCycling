/** Why the last WebGL attempt was turned down, read by the Diagnostics overlay (null = none yet). */
let latest: string | null = null;

export const publishWebglIssue = (reason: string): void => {
  latest = reason;
};
export const readWebglIssue = (): string | null => latest;
export const clearWebglIssue = (): void => {
  latest = null;
};
