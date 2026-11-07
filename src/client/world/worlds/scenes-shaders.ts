import * as THREE from 'three';
import type { SceneLook } from './scenes-registry';

/**
 * Shared shaders of the Scenes world. The ShaderMaterials write their colours as given (sRGB `#hex`
 * values, no colour-space conversion), so a look's hex value shows exactly as written.
 */

/** Sets a vec3 uniform to the raw sRGB components of `#rrggbb`. */
export function setHex(v: THREE.Vector3, hex: string): THREE.Vector3 {
  const n = parseInt(hex.slice(1, 7), 16) || 0;
  return v.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const v3 = (): { value: THREE.Vector3 } => ({ value: new THREE.Vector3() });
const f = (value = 0): { value: number } => ({ value });

const HASH = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
`;

// ---------------------------------------------------------------------------------------------
// Sky: full-screen quad behind everything (gradient, horizon glow, stars, sun/moon)
// ---------------------------------------------------------------------------------------------

export type SkyUniforms = {
  uTop: { value: THREE.Vector3 };
  uMid: { value: THREE.Vector3 };
  uHor: { value: THREE.Vector3 };
  uGlow: { value: THREE.Vector3 };
  uSunA: { value: THREE.Vector3 };
  uSunB: { value: THREE.Vector3 };
  uBelow: { value: THREE.Vector3 };
  uSunSize: { value: number };
  uSunX: { value: number };
  uSunY: { value: number };
  uStripes: { value: number };
  uRing: { value: number };
  uStars: { value: number };
  uHorizonY: { value: number };
  uAspect: { value: number };
  uTime: { value: number };
  /** Camera bank (radians) and the screen point it turns around (uv). */
  uRoll: { value: number };
  uPivot: { value: THREE.Vector2 };
  /** Nebula strength 0..1, its detail (1 Lite, 2 Standard) and the beat swell 0..1. */
  uWarp: { value: number };
  uDetail: { value: number };
  uBeat: { value: number };
};

export function skyMaterial(): THREE.ShaderMaterial & { uniforms: SkyUniforms } {
  const uniforms: SkyUniforms = {
    uTop: v3(),
    uMid: v3(),
    uHor: v3(),
    uGlow: v3(),
    uSunA: v3(),
    uSunB: v3(),
    uBelow: v3(),
    uSunSize: f(),
    uSunX: f(0.5),
    uSunY: f(),
    uStripes: f(),
    uRing: f(),
    uStars: f(),
    uHorizonY: f(0.55),
    uAspect: f(1.78),
    uTime: f(),
    uRoll: f(),
    uPivot: { value: new THREE.Vector2(0.5, 0.55) },
    uWarp: f(),
    uDetail: f(2),
    uBeat: f(),
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uHor, uGlow, uSunA, uSunB, uBelow;
      uniform float uSunSize, uSunX, uSunY, uStripes, uRing, uStars, uHorizonY, uAspect, uTime;
      uniform float uRoll, uWarp, uDetail, uBeat;
      uniform vec2 uPivot;
      varying vec2 vUv;
      ${HASH}
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 q = fract(p);
        q = q * q * (3.0 - 2.0 * q);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), q.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), q.x), q.y);
      }
      void main() {
        // the sky banks with the camera, around the level horizon's centre
        vec2 c = vUv - uPivot;
        c.x *= uAspect;
        float cr = cos(uRoll);
        float sr = sin(uRoll);
        c = mat2(cr, sr, -sr, cr) * c;
        c.x /= uAspect;
        vec2 uv = c + uPivot;
        float h = uv.y - uHorizonY;
        if (h < 0.0) { gl_FragColor = vec4(uBelow, 1.0); return; }
        float t = clamp(h / max(0.05, 1.0 - uHorizonY), 0.0, 1.0);
        vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.42, t));
        col = mix(col, uTop, smoothstep(0.3, 1.0, t));
        col += uGlow * exp(-h * 22.0) * (0.55 + 0.35 * uBeat);

        // flowing nebula: domain-warped value noise tinted by the look's glow and sun colours
        if (uWarp > 0.001) {
          vec2 q = vec2(uv.x * uAspect, uv.y) * 2.6;
          float tt = uTime * 0.05;
          float n;
          if (uDetail > 1.5) {
            vec2 w = vec2(vnoise(q + tt), vnoise(q + 7.3 - tt));
            n = vnoise(q * 1.7 + w * 2.2 + tt * 2.0) * 0.65 + vnoise(q * 3.4 - w * 1.6) * 0.35;
          } else {
            n = vnoise(q * 1.5 + tt * 2.0);
          }
          float veil = smoothstep(0.35, 0.85, n) * smoothstep(0.02, 0.4, t) * (1.0 - 0.45 * t);
          col += mix(uSunB, uGlow, n) * veil * uWarp * (0.42 + 0.2 * uBeat);
        }

        // stars: sparse cells, fading toward the horizon, slow twinkle
        vec2 sp = vec2(uv.x * uAspect, uv.y) * 150.0;
        vec2 cell = floor(sp);
        float r = hash21(cell);
        if (r > 0.986) {
          float d = length(fract(sp) - 0.5);
          float tw = 0.65 + 0.35 * sin(uTime * (0.6 + r * 2.0) + r * 40.0);
          col += uStars * tw * smoothstep(0.16, 0.0, d) * smoothstep(0.08, 0.45, t);
        }

        // sun: gradient disc, optional scanline cuts in its lower half, soft halo, optional ring
        float size = uSunSize * min(1.0, uAspect * 1.1);
        if (size > 0.0) {
          vec2 p = vec2((uv.x - uSunX) * uAspect, h - uSunY);
          float d = length(p) / size;
          float sy = p.y / size;
          vec3 disc = mix(uSunB, uSunA, smoothstep(-1.0, 1.0, sy));
          float band = fract(sy * 6.0 + 0.2);
          float cut = uStripes * step(sy, 0.25) * step(band, 0.12 + (0.25 - sy) * 0.16);
          float inside = smoothstep(1.0, 0.985, d) * (1.0 - cut);
          col += uSunA * 0.32 * exp(-max(d - 1.0, 0.0) * 2.2) * step(1.0, d);
          col += uSunA * uRing * 0.55 * smoothstep(0.035, 0.0, abs(d - 1.55));
          col = mix(col, disc, inside);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return mat as THREE.ShaderMaterial & { uniforms: SkyUniforms };
}

export function applySkyLook(u: SkyUniforms, look: SceneLook): void {
  setHex(u.uTop.value, look.skyTop);
  setHex(u.uMid.value, look.skyMid);
  setHex(u.uHor.value, look.skyHorizon);
  setHex(u.uGlow.value, look.horizonGlow);
  setHex(u.uSunA.value, look.sunA);
  setHex(u.uSunB.value, look.sunB);
  setHex(u.uBelow.value, look.fog);
  u.uSunSize.value = look.sunSize;
  u.uSunX.value = look.sunX;
  u.uSunY.value = look.sunY;
  u.uStripes.value = look.sunStripes;
  u.uRing.value = look.sunRing;
  u.uStars.value = look.stars;
  u.uWarp.value = look.warp;
}

// ---------------------------------------------------------------------------------------------
// Terrain: a height field around the road with a glowing pattern (grid, stripes, dots, hexes)
// ---------------------------------------------------------------------------------------------

export type TerrainUniforms = {
  uFill: { value: THREE.Vector3 };
  uLine: { value: THREE.Vector3 };
  uLineB: { value: THREE.Vector3 };
  /** Share of the travelling second colour 0..1 and the beat swell 0..1. */
  uBand: { value: number };
  uBeat: { value: number };
  uFog: { value: THREE.Vector3 };
  uFogNear: { value: number };
  uFogFar: { value: number };
  uScale: { value: number };
  uWidth: { value: number };
  uPatA: { value: number };
  uPatB: { value: number };
  uPatMix: { value: number };
  /** Effort intensity 0..1: line brightness and pulse strength. */
  uIntensity: { value: number };
  uPeak: { value: number };
  uTime: { value: number };
  /** World distance travelled (pulse waves travel toward the rider). */
  uDist: { value: number };
};

export function terrainMaterial(): THREE.ShaderMaterial & { uniforms: TerrainUniforms } {
  const uniforms: TerrainUniforms = {
    uFill: v3(),
    uLine: v3(),
    uLineB: v3(),
    uBand: f(),
    uBeat: f(),
    uFog: v3(),
    uFogNear: f(40),
    uFogFar: f(650),
    uScale: f(10),
    uWidth: f(1.2),
    uPatA: f(),
    uPatB: f(),
    uPatMix: f(),
    uIntensity: f(0.5),
    uPeak: f(1),
    uTime: f(),
    uDist: f(),
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aGrid; // lateral offset from the road, world z, height above the road
      varying vec3 vGrid;
      varying float vDepth;
      void main() {
        vGrid = aGrid;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uFill, uLine, uLineB, uFog;
      uniform float uBand, uBeat;
      uniform float uFogNear, uFogFar, uScale, uWidth, uPatA, uPatB, uPatMix, uIntensity, uPeak;
      uniform float uTime, uDist;
      varying vec3 vGrid;
      varying float vDepth;
      ${HASH}

      float hexDist(vec2 p) {
        p = abs(p);
        return max(dot(p, vec2(0.5, 0.8660254)), p.x);
      }

      // pattern coverage 0..1 at cell coordinates p
      float pattern(float kind, vec2 p) {
        vec2 fw = max(fwidth(p), vec2(1e-4));
        // patterns this dense on screen would only shimmer: fade them to their mean value
        float dense = smoothstep(0.18, 0.55, max(fw.x, fw.y));
        if (kind < 0.5) {
          vec2 g = abs(fract(p - 0.5) - 0.5) / fw;
          float l = 1.0 - min(min(g.x, g.y) / uWidth, 1.0);
          return mix(l, 0.12, dense);
        }
        if (kind < 1.5) {
          float q = (p.x + p.y) * 0.7071;
          float w = fwidth(q);
          float s = smoothstep(0.22 + w, 0.22 - w, abs(fract(q) - 0.5));
          return mix(s, 0.44, dense);
        }
        if (kind < 2.5) {
          float d = length(fract(p) - 0.5);
          float r = 0.13 * uWidth;
          float s = smoothstep(r + fw.x, r - fw.x, d);
          return mix(s, 0.1, dense);
        }
        vec2 rr = vec2(1.0, 1.7320508);
        vec2 a = mod(p, rr) - rr * 0.5;
        vec2 b = mod(p - rr * 0.5, rr) - rr * 0.5;
        vec2 gv = dot(a, a) < dot(b, b) ? a : b;
        float e = 0.5 - hexDist(gv);
        float s = smoothstep(0.045 * uWidth + fw.x, 0.045 * uWidth - fw.x, e);
        return mix(s, 0.2, dense);
      }

      void main() {
        vec2 p = vec2(vGrid.x, vGrid.y) / uScale;
        float pat = mix(pattern(uPatA, p), pattern(uPatB, p), uPatMix);
        // a slow wave of light rolls toward the rider; stronger with effort
        float wave = 0.5 + 0.5 * sin((vGrid.y - uDist) * 0.035 - uTime * 1.6);
        float bright = (0.35 + 0.65 * uIntensity + 0.45 * uIntensity * wave) * (1.0 + 0.5 * uBeat);
        float peak = clamp(vGrid.z / max(uPeak, 1.0), 0.0, 1.0);
        // bands of the second colour drift through the terrain (psychedelic colour travel)
        float bandK = uBand * (0.5 + 0.5 * sin(vGrid.y * 0.011 + vGrid.x * 0.006 - uTime * 0.18));
        vec3 lineCol = mix(uLine, uLineB, bandK);
        vec3 col = mix(uFill, lineCol, clamp(pat * bright * (0.8 + 0.5 * peak), 0.0, 1.0));
        col += lineCol * 0.09 * peak * (1.0 + 0.6 * uBeat);
        float fogK = smoothstep(uFogNear, uFogFar, vDepth);
        gl_FragColor = vec4(mix(col, uFog, fogK), 1.0);
      }
    `,
  });
  return mat as THREE.ShaderMaterial & { uniforms: TerrainUniforms };
}

// ---------------------------------------------------------------------------------------------
// Overlay: the scene-change wash and the screen-edge vignette in one full-screen pass
// ---------------------------------------------------------------------------------------------

export type OverlayUniforms = {
  uColor: { value: THREE.Vector3 };
  /** Wash opacity 0..1 and vignette strength 0..1. */
  uWash: { value: number };
  uVig: { value: number };
  uAspect: { value: number };
};

export function overlayMaterial(): THREE.ShaderMaterial & { uniforms: OverlayUniforms } {
  const uniforms: OverlayUniforms = { uColor: v3(), uWash: f(), uVig: f(), uAspect: f(1.78) };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uWash, uVig, uAspect;
      varying vec2 vUv;
      void main() {
        vec2 c = (vUv - 0.5) * vec2(min(uAspect, 1.0) * 1.0 + max(uAspect - 1.0, 0.0) * 0.45, 1.0);
        float v = smoothstep(0.28, 0.95, length(c) * 1.25);
        float vig = uVig * v * 0.8;
        // wash colour over black vignette, one "over" operation
        float a = uWash + vig * (1.0 - uWash);
        vec3 rgb = a > 0.0001 ? uColor * uWash / a : vec3(0.0);
        gl_FragColor = vec4(rgb, a);
      }
    `,
  });
  return mat as THREE.ShaderMaterial & { uniforms: OverlayUniforms };
}
