/** Viewport facts that explain layout bugs on phones: dvh/svh/lvh, safe area, orientation. */

export interface ViewportProbe {
  dvh: number;
  svh: number;
  lvh: number;
  safeTop: number;
  safeRight: number;
  safeBottom: number;
  safeLeft: number;
}

export interface ViewportEnv {
  innerWidth: number;
  innerHeight: number;
  /** visualViewport height (shrinks with the on-screen keyboard); undefined when unsupported. */
  visualHeight: number | undefined;
  devicePixelRatio: number;
  orientation: string | undefined;
  probe(): ViewportProbe | null;
}

export interface ViewportInfo {
  width: number;
  height: number;
  visualHeight: number | undefined;
  dpr: number;
  dvh: number | undefined;
  svh: number | undefined;
  lvh: number | undefined;
  safe: { top?: number; right?: number; bottom?: number; left?: number };
  orientation: string | undefined;
}

export function readViewport(env: ViewportEnv): ViewportInfo {
  const p = env.probe();
  return {
    width: env.innerWidth,
    height: env.innerHeight,
    visualHeight: env.visualHeight,
    dpr: env.devicePixelRatio,
    dvh: p?.dvh,
    svh: p?.svh,
    lvh: p?.lvh,
    safe: p ? { top: p.safeTop, right: p.safeRight, bottom: p.safeBottom, left: p.safeLeft } : {},
    orientation: env.orientation,
  };
}

const n = (v: number | undefined): string => (v === undefined ? '-' : String(Math.round(v)));

/** "390x664@3 vv640 dvh664 svh600 lvh750 safe 47/0/34/0 portrait" */
export function formatViewport(v: ViewportInfo): string {
  const { top, right, bottom, left } = v.safe;
  return [
    `${v.width}x${v.height}@${Math.round(v.dpr * 100) / 100}`,
    `vv${n(v.visualHeight)}`,
    `dvh${n(v.dvh)}`,
    `svh${n(v.svh)}`,
    `lvh${n(v.lvh)}`,
    `safe ${n(top)}/${n(right)}/${n(bottom)}/${n(left)}`,
    v.orientation?.split('-')[0] ?? '-',
  ].join(' ');
}

let probeEl: HTMLDivElement | null = null;

/** One hidden element, reused: its heights and padding resolve the CSS units and env() insets. */
function measure(): ViewportProbe | null {
  try {
    if (!probeEl || !probeEl.isConnected) {
      probeEl = document.createElement('div');
      probeEl.setAttribute('aria-hidden', 'true');
      probeEl.style.cssText =
        'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;' +
        'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) ' +
        'env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);box-sizing:content-box';
      document.body.appendChild(probeEl);
    }
    const el = probeEl;
    const heightOf = (unit: string): number => {
      el.style.height = `100${unit}`;
      return el.getBoundingClientRect().height;
    };
    const cs = getComputedStyle(el);
    const px = (v: string): number => parseFloat(v) || 0;
    const safeTop = px(cs.paddingTop);
    const safeBottom = px(cs.paddingBottom);
    const inner = (unit: string): number => heightOf(unit) - safeTop - safeBottom;
    return {
      dvh: inner('dvh'),
      svh: inner('svh'),
      lvh: inner('lvh'),
      safeTop,
      safeRight: px(cs.paddingRight),
      safeBottom,
      safeLeft: px(cs.paddingLeft),
    };
  } catch {
    return null;
  }
}

export function browserViewportEnv(): ViewportEnv {
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    visualHeight: window.visualViewport?.height,
    devicePixelRatio: window.devicePixelRatio || 1,
    orientation: screen.orientation?.type,
    probe: measure,
  };
}
