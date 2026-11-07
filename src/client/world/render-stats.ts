/** Latest render stats published by the active world engine, read by the Diagnostics overlay. */
export interface RenderStats {
  /** GPU time of the last measured frame in ms; null when EXT_disjoint_timer_query_webgl2 is missing. */
  gpuMs: number | null;
  drawCalls: number;
  triangles: number;
  /** Drawing-buffer size in megapixels. */
  mpx: number;
}

let latest: RenderStats | null = null;

export const publishRenderStats = (s: RenderStats): void => {
  latest = s;
};
export const readRenderStats = (): RenderStats | null => latest;
export const clearRenderStats = (): void => {
  latest = null;
};

/** Minimal slice of WebGL2 + the timer extension we use (keeps the timer testable). */
interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}
interface TimerGl {
  getParameter(p: number): unknown;
  createQuery(): unknown;
  deleteQuery(q: unknown): void;
  beginQuery(target: number, q: unknown): void;
  endQuery(target: number): void;
  getQueryParameter(q: unknown, p: number): unknown;
  QUERY_RESULT_AVAILABLE: number;
  QUERY_RESULT: number;
}

export interface GpuTimer {
  begin(): void;
  end(): void;
  /** Last completed measurement in ms, or null if none yet. */
  readonly ms: number | null;
  dispose(): void;
}

/** GPU frame timer; returns undefined when the extension is unavailable. One query in flight. */
export function createGpuTimer(gl: unknown, ext: unknown): GpuTimer | undefined {
  if (!gl || !ext) return undefined;
  const g = gl as TimerGl;
  const e = ext as TimerExt;
  let pending: unknown = null;
  let active = false;
  let ms: number | null = null;
  const poll = (): void => {
    if (pending === null) return;
    const ready = g.getQueryParameter(pending, g.QUERY_RESULT_AVAILABLE) as boolean;
    if (!ready) return;
    const disjoint = g.getParameter(e.GPU_DISJOINT_EXT) as boolean;
    if (!disjoint) ms = Number(g.getQueryParameter(pending, g.QUERY_RESULT)) / 1e6;
    g.deleteQuery(pending);
    pending = null;
  };
  return {
    begin() {
      poll();
      if (pending !== null) return;
      const q = g.createQuery();
      g.beginQuery(e.TIME_ELAPSED_EXT, q);
      pending = q;
      active = true;
    },
    end() {
      if (!active) return;
      active = false;
      g.endQuery(e.TIME_ELAPSED_EXT);
    },
    get ms() {
      return ms;
    },
    dispose() {
      if (pending !== null) g.deleteQuery(pending);
      pending = null;
    },
  };
}
