export const UNAVAILABLE = 'unavailable';

export interface DeviceInfo {
  userAgent: string;
  platform: string;
  screen: { width: number; height: number; pixelRatio: number };
  viewport: { width: number; height: number };
  hardwareConcurrency: number | undefined;
  deviceMemoryGb: number | undefined;
  webgl2: boolean;
  gpuVendor: string;
  gpuRenderer: string;
  maxTextureSize: number | undefined;
  reducedMotion: boolean;
}

/** The slice of the browser the collector reads; tests pass fakes. */
export interface DeviceEnv {
  navigator: {
    userAgent: string;
    platform?: string;
    hardwareConcurrency?: number;
    deviceMemory?: number;
  };
  screen: { width: number; height: number };
  devicePixelRatio: number;
  innerWidth: number;
  innerHeight: number;
  createCanvas(): { getContext(id: string): unknown };
  matchMedia?: (query: string) => { matches: boolean };
}

interface GlLike {
  MAX_TEXTURE_SIZE: number;
  getExtension(
    name: string,
  ): { UNMASKED_VENDOR_WEBGL: number; UNMASKED_RENDERER_WEBGL: number } | null;
  getParameter(p: number): unknown;
}

const str = (v: unknown): string => (typeof v === 'string' && v !== '' ? v : UNAVAILABLE);

function probeGl(
  env: DeviceEnv,
): Pick<DeviceInfo, 'webgl2' | 'gpuVendor' | 'gpuRenderer' | 'maxTextureSize'> {
  const none = {
    webgl2: false,
    gpuVendor: UNAVAILABLE,
    gpuRenderer: UNAVAILABLE,
    maxTextureSize: undefined,
  };
  try {
    const gl = env.createCanvas().getContext('webgl2') as GlLike | null;
    if (!gl) return none;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    return {
      webgl2: true,
      gpuVendor: ext ? str(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : UNAVAILABLE,
      gpuRenderer: ext ? str(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : UNAVAILABLE,
      maxTextureSize: typeof max === 'number' ? max : undefined,
    };
  } catch {
    return none;
  }
}

/** Reads what is known about this device; every missing value is `undefined` or "unavailable". */
export function collectDeviceInfo(env: DeviceEnv): DeviceInfo {
  return {
    userAgent: env.navigator.userAgent,
    platform: str(env.navigator.platform),
    screen: {
      width: env.screen.width,
      height: env.screen.height,
      pixelRatio: env.devicePixelRatio,
    },
    viewport: { width: env.innerWidth, height: env.innerHeight },
    hardwareConcurrency: env.navigator.hardwareConcurrency,
    deviceMemoryGb: env.navigator.deviceMemory,
    ...probeGl(env),
    reducedMotion: env.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  };
}

/** The real browser environment. */
export function browserDeviceEnv(): DeviceEnv {
  return {
    navigator,
    screen,
    devicePixelRatio: window.devicePixelRatio || 1,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    createCanvas: () => document.createElement('canvas'),
    ...(typeof window.matchMedia === 'function' ? { matchMedia: (q) => window.matchMedia(q) } : {}),
  };
}
