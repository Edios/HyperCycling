import { describe, expect, it } from 'vitest';
import { collectDeviceInfo, UNAVAILABLE, type DeviceEnv } from './device-info';

function fakeGl(vendor = 'ACME', renderer = 'Fake GPU 9000', maxTex = 8192) {
  const ext = { UNMASKED_VENDOR_WEBGL: 1, UNMASKED_RENDERER_WEBGL: 2 };
  const params: Record<number, unknown> = { 1: vendor, 2: renderer, 3: maxTex };
  return {
    MAX_TEXTURE_SIZE: 3,
    getExtension: (n: string) => (n === 'WEBGL_debug_renderer_info' ? ext : null),
    getParameter: (p: number) => params[p],
  };
}

const baseEnv = (over: Partial<DeviceEnv> = {}): DeviceEnv => ({
  navigator: {
    userAgent: 'UA/1.0',
    platform: 'Linux armv8l',
    hardwareConcurrency: 4,
    deviceMemory: 8,
  },
  screen: { width: 1920, height: 1080 },
  devicePixelRatio: 1.5,
  innerWidth: 1280,
  innerHeight: 720,
  createCanvas: () => ({ getContext: (id: string) => (id === 'webgl2' ? fakeGl() : null) }),
  matchMedia: () => ({ matches: true }),
  ...over,
});

describe('collectDeviceInfo', () => {
  it('collects everything from a capable environment', () => {
    expect(collectDeviceInfo(baseEnv())).toEqual({
      userAgent: 'UA/1.0',
      platform: 'Linux armv8l',
      screen: { width: 1920, height: 1080, pixelRatio: 1.5 },
      viewport: { width: 1280, height: 720 },
      hardwareConcurrency: 4,
      deviceMemoryGb: 8,
      webgl2: true,
      gpuVendor: 'ACME',
      gpuRenderer: 'Fake GPU 9000',
      maxTextureSize: 8192,
      reducedMotion: true,
    });
  });

  it('marks missing values as unavailable instead of throwing', () => {
    const info = collectDeviceInfo(
      baseEnv({
        navigator: { userAgent: 'UA' },
        createCanvas: () => ({ getContext: () => null }),
        matchMedia: undefined,
      }),
    );
    expect(info.deviceMemoryGb).toBeUndefined();
    expect(info.hardwareConcurrency).toBeUndefined();
    expect(info.webgl2).toBe(false);
    expect(info.gpuVendor).toBe(UNAVAILABLE);
    expect(info.gpuRenderer).toBe(UNAVAILABLE);
    expect(info.maxTextureSize).toBeUndefined();
    expect(info.reducedMotion).toBe(false);
    expect(info.platform).toBe(UNAVAILABLE);
  });

  it('reports unavailable GPU strings when the debug extension is missing', () => {
    const gl = { ...fakeGl(), getExtension: () => null };
    const info = collectDeviceInfo(baseEnv({ createCanvas: () => ({ getContext: () => gl }) }));
    expect(info.webgl2).toBe(true);
    expect(info.gpuVendor).toBe(UNAVAILABLE);
    expect(info.maxTextureSize).toBe(8192);
  });

  it('survives a canvas that throws', () => {
    const info = collectDeviceInfo(
      baseEnv({
        createCanvas: () => {
          throw new Error('no canvas');
        },
      }),
    );
    expect(info.webgl2).toBe(false);
  });
});
