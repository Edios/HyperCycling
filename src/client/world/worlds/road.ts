import * as THREE from 'three';
import type { WorldQuality, WorldRenderer, WorldFrame } from '../world';
import { prefersReducedMotion } from './motion';
import { renderPixelRatio, watchDevicePixelRatio, wantsAntialias } from './pixel-ratio';
import { BASE_VFOV_DEG, baseVerticalFov, dashOffset, gateDepth, hash01 } from './road-model';

/**
 * "Road": a calm, stylised road at dusk (spec 5, mockup docs/design/mockups/wizard/07-road-world).
 * Zone-coloured bars run along both road edges; each bar takes the colour of the block that will
 * be active when the rider reaches it, so the next block's colour travels toward the rider, and a
 * gate frame marks where the next block begins. The sky (gradient, sun, mountains, skyline) is
 * drawn once per size into a CanvasTexture. There is no bike in view: only the road.
 * No post-processing: `high` adds a soft additive glow under the edge bars and a full pixel
 * ratio, `low` halves the road segments, bars and props.
 *
 * World units: the camera sits CAM_HEIGHT above the road; one camera height ≈ the mockup's unit.
 */

const CAM_HEIGHT = 4;
const ROAD_HALF = 5.4;
/** Farthest depth the road, bars and gate are drawn to. */
const VIEW = 420;
const NEAR_DEPTH = 0.5;
const LOOK_AHEAD = 30;
/** The tunnel path bends are scaled down: a road swings gently, it does not corkscrew. */
const CURVE_SCALE = 0.3;
/** Horizon height as a fraction of the canvas height, from the top. */
const HORIZON_LANDSCAPE = 0.45;
const HORIZON_PORTRAIT = 0.4;

const EDGE_INNER = 0.8;
const EDGE_OUTER = 0.99;
const LINE_INNER = 0.755;
const LINE_OUTER = 0.775;
const DASH_PERIOD = 10.4;
const DASH_LENGTH = 5;
const DASH_HALF = 0.11;
const BAR_PERIOD = 4;
const BAR_FILL = 0.88;
const BAR_DIM = 0.55;
const TREE_PERIOD = 8;
/** Round gate: a ring slightly wider than the road, its lowest part sunk into the road. */
const GATE_RADIUS = ROAD_HALF * 1.05;
const GATE_CENTER_Y = GATE_RADIUS * 0.82;
const GATE_TUBE = 0.16;

/** Widest backdrop texture in pixels. */
const MAX_TEXTURE_WIDTH = 2560;
const RIBBON_SEGMENTS_HIGH = 140;
const RIBBON_SEGMENTS_LOW = 70;

const FOG_COLOR = 0x6e4058;
const FOG_NEAR = 30;
const FOG_FAR = 470;
const GROUND_COLOR = 0x0b0c1a;
const ROAD_COLOR = 0x1d1a33;
const LINE_COLOR = 0xd9d4e6;
const DASH_COLOR = 0xffecc8;
const TREE_COLOR = 0x0d0a22;

export interface RoadOptions {
  /** Static scene (no streaming); defaults to the prefers-reduced-motion media query. */
  reducedMotion?: boolean;
}

interface Disposable {
  dispose(): void;
}

/** A flat strip along the road between two lateral offsets (fractions of ROAD_HALF). */
interface Ribbon {
  mesh: THREE.Mesh;
  pos: Float32Array;
  inner: number;
  outer: number;
}

interface Scene3D {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  cam: THREE.PerspectiveCamera;
  ground: THREE.Mesh;
  ribbons: Ribbon[];
  /** Depths of the ribbon cross-sections (denser near the camera). */
  ribbonDepths: Float32Array;
  bars: THREE.InstancedMesh;
  barsPerSide: number;
  barPeriod: number;
  glow?: THREE.InstancedMesh;
  dashes: THREE.InstancedMesh;
  dashCount: number;
  trees: THREE.InstancedMesh;
  treesPerSide: number;
  treePeriod: number;
  gate: THREE.Group;
  gateSolid: THREE.MeshBasicMaterial;
  gateFill: THREE.MeshBasicMaterial;
  high: boolean;
  /** Owned by the scene for its whole life (geometries, materials, static textures). */
  disposables: Disposable[];
  /** Re-created on every resize. */
  backdrop?: THREE.CanvasTexture;
  /** Live city lights over the backdrop; absent with reduced motion. Re-created on resize. */
  lights?: LightsLayer;
  unwatchDpr(): void;
}

/** The small screen-space layer that carries the live lights (own scene and camera). */
interface LightsLayer {
  plan: LightsPlan;
  g: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  geo: THREE.PlaneGeometry;
  mat: THREE.MeshBasicMaterial;
  scene: THREE.Scene;
  cam: THREE.OrthographicCamera;
  /** Animation clock in seconds, and when the layer was last repainted. */
  t: number;
  painted: number;
}

const isPortrait = (w: number, h: number): boolean => h > w;
const horizonFraction = (w: number, h: number): number =>
  isPortrait(w, h) ? HORIZON_PORTRAIT : HORIZON_LANDSCAPE;

// ---------------------------------------------------------------------------------------------
// 2D backdrop drawing, adapted from the mockup's canvas code
// ---------------------------------------------------------------------------------------------

function make2d(w: number, h: number): CanvasRenderingContext2D | null {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c.getContext('2d');
}

const CITY_COLOR = '#1c1238';
const WINDOW_COLOR = '#ffc77a';

/** Mountain ridge height at x; shared by the backdrop and by the clipping of the live lights. */
function ridgeY(x: number, W: number, base: number, amp: number, seed: number, freq: number) {
  const t = (x / W) * freq;
  return (
    base -
    amp *
      (0.55 * Math.abs(Math.sin(t * 1.7 + seed)) +
        0.3 * Math.abs(Math.sin(t * 3.9 + seed * 2)) +
        0.15 * Math.sin(t * 9 + seed * 3))
  );
}

/** The ridge in front of the city (it hides the lower part of the skyline). */
function frontRidge(W: number, H: number) {
  const P = isPortrait(W, H);
  const hy = Math.round(H * horizonFraction(W, H));
  return { base: hy + H * 0.002, amp: H * 0.07, seed: 4.1, freq: P ? 7 : 9 };
}

interface CityWindow {
  x: number;
  y: number;
  lit: boolean;
  /** Hash used to pick the few windows that switch on and off. */
  key: number;
}

interface Building {
  x: number;
  w: number;
  h: number;
  windows: CityWindow[];
}

interface City {
  buildings: Building[];
  /** Foot line of the buildings. */
  base: number;
  /** Window width. */
  win: number;
  x0: number;
  x1: number;
}

/** The skyline: a band of blocks, taller in the middle, each with a pattern of lit windows. */
function cityLayout(W: number, H: number): City {
  const P = isPortrait(W, H);
  const hy = Math.round(H * horizonFraction(W, H));
  const cityX = W * (P ? 0.06 : 0.56);
  const cityW = W * (P ? 0.5 : 0.36);
  const base = hy - H * 0.01;
  const win = Math.max(2, H * 0.0032);
  const buildings: Building[] = [];
  let x = cityX;
  let k = 0;
  while (x < cityX + cityW) {
    const bw = W * (0.012 + hash01(k + 50) * 0.018);
    const centre = 1 - Math.abs((x - cityX - cityW / 2) / cityW) * 0.9;
    const bh = H * (0.015 + hash01(k + 70) * 0.07 * centre);
    const windows: CityWindow[] = [];
    for (let j = 0; j < bh / (H * 0.012); j++) {
      windows.push({
        x: x + bw * 0.25 + hash01(k + j) * bw * 0.4,
        y: base - bh + j * H * 0.012 + 3,
        lit: hash01(k * 31 + j) > 0.62,
        key: hash01(k * 17 + j * 7 + 3),
      });
    }
    buildings.push({ x, w: bw, h: bh, windows });
    x += bw + W * 0.002;
    k++;
  }
  return { buildings, base, win, x0: cityX, x1: x };
}

// ---------------------------------------------------------------------------------------------
// Live city lights: a small transparent layer over the static backdrop. Only this small texture
// is repainted (a few times per second); the full backdrop never is.
// ---------------------------------------------------------------------------------------------

const AIRCRAFT_COLOR = '255,59,59';
/** Windows that switch on or off, at most (high quality). */
const MAX_LIVE_WINDOWS = 28;
const LIGHTS_FPS_HIGH = 8;
const LIGHTS_FPS_LOW = 4;

interface LiveWindow {
  x: number;
  y: number;
  lit: boolean;
  period: number;
  phase: number;
}

export interface LightsPlan {
  /** Layer rectangle in backdrop pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  win: number;
  windows: LiveWindow[];
  /** Aircraft warning light on the tallest tower, in layer pixels. */
  tower: { x: number; y: number };
  /** Layer-space polygon that the ridge in front of the city covers. */
  ridge: { x: number; y: number }[];
}

export function planLights(W: number, H: number, high: boolean): LightsPlan {
  const city = cityLayout(W, H);
  let tallest = city.buildings[0];
  for (const b of city.buildings) if (!tallest || b.h > tallest.h) tallest = b;
  const top = city.base - (tallest?.h ?? 0);
  const pad = city.win * 8;
  const x = Math.floor(city.x0);
  const y = Math.floor(top - pad);
  const w = Math.ceil(city.x1 - city.x0) + 1;
  const h = Math.ceil(city.base - y) + 1;
  const windows: LiveWindow[] = [];
  if (high) {
    for (const b of city.buildings) {
      for (const win of b.windows) {
        if (win.key <= 0.84 || windows.length >= MAX_LIVE_WINDOWS) continue;
        const period = 14 + hash01(win.key * 1000) * 18;
        windows.push({
          x: win.x - x,
          y: win.y - y,
          lit: win.lit,
          period,
          phase: hash01(win.key * 3000 + 1) * period,
        });
      }
    }
  }
  const fr = frontRidge(W, H);
  const step = Math.max(2, W / 400);
  const ridge: { x: number; y: number }[] = [];
  for (let px = x; px <= x + w + step; px += step) {
    ridge.push({ x: px - x, y: ridgeY(px, W, fr.base, fr.amp, fr.seed, fr.freq) - y });
  }
  return {
    x,
    y,
    w,
    h,
    win: city.win,
    windows,
    tower: {
      x: (tallest ? tallest.x + tallest.w / 2 : city.x0) - x,
      y: top - city.win * 3.5 - y,
    },
    ridge,
  };
}

const smooth01 = (v: number): number => {
  const c = Math.min(1, Math.max(0, v));
  return c * c * (3 - 2 * c);
};

/** Paints the lights for time `t` (seconds). The layer starts transparent every time. */
function drawLights(g: CanvasRenderingContext2D, plan: LightsPlan, t: number): void {
  g.clearRect(0, 0, plan.w, plan.h);
  g.globalCompositeOperation = 'source-over';
  for (const w of plan.windows) {
    // slow on/off: mostly settled on one state, with a fade of a few seconds between them
    const s = 0.5 + 0.5 * Math.sin((2 * Math.PI * (t + w.phase)) / w.period);
    const on = smooth01((s - 0.35) / 0.3);
    if (w.lit) {
      // a lit window of the backdrop going dark: paint the wall colour over it
      g.globalAlpha = 1 - on;
      g.fillStyle = CITY_COLOR;
      g.fillRect(w.x - 0.5, w.y - 0.5, plan.win + 1, plan.win * 1.2 + 1);
    } else {
      g.globalAlpha = on;
      g.fillStyle = WINDOW_COLOR;
      g.fillRect(w.x, w.y, plan.win, plan.win * 1.2);
    }
  }
  g.globalAlpha = 1;

  // aircraft warning light: a short red blink every ~1.6 s, with a soft fade in and out
  const ph = t % 1.6;
  const blink = smooth01(ph / 0.08) * (1 - smooth01((ph - 0.32) / 0.08));
  const { x, y } = plan.tower;
  g.fillStyle = CITY_COLOR; // the mast
  g.fillRect(x - 0.5, y, Math.max(1, plan.win * 0.4), plan.win * 3.5);
  const r = plan.win * 7;
  const glow = g.createRadialGradient(x, y, 0, x, y, r);
  glow.addColorStop(0, `rgba(${AIRCRAFT_COLOR},${(1 * blink).toFixed(3)})`);
  glow.addColorStop(0.3, `rgba(${AIRCRAFT_COLOR},${(0.5 * blink).toFixed(3)})`);
  glow.addColorStop(1, `rgba(${AIRCRAFT_COLOR},0)`);
  g.fillStyle = glow;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.fillStyle = `rgba(255,${120 + Math.round(100 * blink)},${120 + Math.round(100 * blink)},${(0.25 + 0.75 * blink).toFixed(3)})`;
  g.fillRect(x - plan.win * 0.6, y - plan.win * 0.6, plan.win * 1.2, plan.win * 1.2);

  // the ridge in front of the city hides what is below it
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  g.beginPath();
  g.moveTo(0, plan.h + 2);
  for (const p of plan.ridge) g.lineTo(p.x, p.y);
  g.lineTo(plan.w + 2, plan.h + 2);
  g.closePath();
  g.fill();
  g.globalCompositeOperation = 'source-over';
}

/** Sky gradient, stars, sun, two mountain ridges and a city skyline; ground below in fog colour. */
function drawBackdrop(g: CanvasRenderingContext2D, high: boolean): void {
  const W = g.canvas.width;
  const H = g.canvas.height;
  const P = isPortrait(W, H);
  const hy = Math.round(H * horizonFraction(W, H));

  const sky = g.createLinearGradient(0, 0, 0, hy);
  sky.addColorStop(0, '#060818');
  sky.addColorStop(0.3, '#161650');
  sky.addColorStop(0.6, '#5b2a75');
  sky.addColorStop(0.82, '#d4506b');
  sky.addColorStop(1, '#ff9d5c');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, hy + 2);

  const starSize = Math.max(1.2, Math.min(W, H) / 450);
  g.fillStyle = '#ffffff';
  for (let i = 0; i < (high ? 80 : 50); i++) {
    g.globalAlpha = 0.2 + hash01(i + 900) * 0.6;
    g.fillRect(hash01(i) * W, hash01(i + 400) * hy * 0.55, starSize, starSize);
  }
  g.globalAlpha = 1;

  const sunX = W / 2 + W * (P ? 0.22 : 0.2);
  const sunR = Math.min(W, H) * (P ? 0.14 : 0.11);
  const sunY = hy - sunR * (P ? 0.95 : 0.55);
  const halo = g.createRadialGradient(sunX, sunY, sunR * 0.2, sunX, sunY, sunR * 4.2);
  halo.addColorStop(0, 'rgba(255,200,120,0.75)');
  halo.addColorStop(0.25, 'rgba(255,140,90,0.32)');
  halo.addColorStop(1, 'rgba(255,120,90,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, W, hy);
  g.fillStyle = '#ffd58f';
  g.beginPath();
  g.arc(sunX, sunY, sunR, 0, Math.PI * 2);
  g.fill();

  const ridge = (base: number, amp: number, seed: number, color: string, freq: number): void => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, hy + 2);
    const step = Math.max(2, W / 400);
    for (let x = 0; x <= W + step; x += step) g.lineTo(x, ridgeY(x, W, base, amp, seed, freq));
    g.lineTo(W, hy + 2);
    g.closePath();
    g.fill();
  };
  ridge(hy - H * 0.015, H * 0.15, 1.3, '#4a2a6a', P ? 5 : 6);

  // skyline: a band of blocks, taller in the middle, with a few lit windows
  const city = cityLayout(W, H);
  for (const b of city.buildings) {
    g.fillStyle = CITY_COLOR;
    g.fillRect(b.x, city.base - b.h, b.w, b.h + H * 0.012);
    g.fillStyle = WINDOW_COLOR;
    for (const w of b.windows) {
      if (w.lit) g.fillRect(w.x, w.y, city.win, city.win * 1.2);
    }
  }
  const fr = frontRidge(W, H);
  ridge(fr.base, fr.amp, fr.seed, '#160e2e', fr.freq);

  // below the horizon the 3D ground covers everything; match its far (fog) colour
  g.fillStyle = `#${FOG_COLOR.toString(16).padStart(6, '0')}`;
  g.fillRect(0, hy + 2, W, H - hy - 2);
}

/** 1-D texture: vertical alpha ramp (gate fill) or horizontal soft falloff (bar glow). */
function rampTexture(kind: 'vertical' | 'soft'): THREE.CanvasTexture | null {
  const g = make2d(kind === 'soft' ? 64 : 4, kind === 'soft' ? 4 : 64);
  if (!g) return null;
  const { width: w, height: h } = g.canvas;
  const grad =
    kind === 'soft' ? g.createLinearGradient(0, 0, w, 0) : g.createLinearGradient(0, 0, 0, h);
  if (kind === 'soft') {
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(g.canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------------------------

export function createRoad(opts: RoadOptions = {}): WorldRenderer {
  let s: Scene3D | undefined;
  let width = 1;
  let height = 1;
  let viewOffsetX = 0;
  let reduced = false;

  // smoothed state; the road starts already rolling like the tunnel
  let dist = 0;
  let speed = 12;
  let fov = BASE_VFOV_DEG;
  let appliedFov = NaN;

  const tmp = new THREE.Object3D();
  const col = new THREE.Color();
  const glowCol = new THREE.Color();
  const colorCache = new Map<string, THREE.Color>();
  const parsed = (hex: string): THREE.Color => {
    let c = colorCache.get(hex);
    if (!c) {
      c = new THREE.Color(hex);
      colorCache.set(hex, c);
    }
    return c;
  };

  /** Fov (sprint widening relative to 70°) and both view offsets: x for the HUD, y for the horizon. */
  function applyProjection(): void {
    if (!s) return;
    const { cam } = s;
    cam.aspect = width / height;
    cam.fov = baseVerticalFov(width / height) * (fov / BASE_VFOV_DEG);
    // the camera looks level, so the horizon is the frustum centre; shift the view to lift it
    const shiftY = height * (0.5 - horizonFraction(width, height));
    cam.setViewOffset(width, height, width * viewOffsetX, shiftY, width, height);
    appliedFov = fov;
  }

  /** Redraws the size-dependent backdrop texture. */
  function paint(): void {
    if (!s) return;
    // a 4K canvas at ratio 2 does not need two 8K textures for a soft sky and a silhouette
    const ratio = Math.min(s.renderer.getPixelRatio(), MAX_TEXTURE_WIDTH / width);
    const w = width * ratio;
    const h = height * ratio;
    const bg = make2d(w, h);
    if (!bg) return;
    drawBackdrop(bg, s.high);
    s.backdrop?.dispose();
    s.backdrop = new THREE.CanvasTexture(bg.canvas);
    s.backdrop.colorSpace = THREE.SRGBColorSpace;
    s.scene.background = s.backdrop;
    disposeLights(s);
    if (!reduced) s.lights = makeLights(bg.canvas.width, bg.canvas.height, ratio, s.high);
  }

  /** The live-lights layer for a backdrop of W x H pixels (ratio = backdrop px per CSS px). */
  function makeLights(W: number, H: number, ratio: number, high: boolean): LightsLayer | undefined {
    const plan = planLights(W, H, high);
    const lg = make2d(plan.w, plan.h);
    if (!lg) return undefined;
    drawLights(lg, plan, 0);
    const tex = new THREE.CanvasTexture(lg.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(plan.w / ratio, plan.h / ratio);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // screen space in CSS pixels, y up
    mesh.position.set((plan.x + plan.w / 2) / ratio, height - (plan.y + plan.h / 2) / ratio, 0);
    const scene = new THREE.Scene();
    scene.add(mesh);
    const cam = new THREE.OrthographicCamera(0, width, height, 0, -1, 1);
    return { plan, g: lg, tex, geo, mat, scene, cam, t: 0, painted: 0 };
  }

  function disposeLights(sc: Scene3D): void {
    const l = sc.lights;
    if (!l) return;
    l.tex.dispose();
    l.geo.dispose();
    l.mat.dispose();
    l.scene.clear();
    delete sc.lights;
  }

  function makeRibbon(
    segments: number,
    inner: number,
    outer: number,
    color: number,
    order: number,
    created: Disposable[],
  ): Ribbon {
    const pos = new Float32Array((segments + 1) * 2 * 3);
    const idx: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new THREE.BufferGeometry();
    created.push(geo);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ color, depthWrite: false, side: THREE.DoubleSide });
    created.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    return { mesh, pos, inner, outer };
  }

  function flatQuad(created: Disposable[]): THREE.PlaneGeometry {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    created.push(geo);
    return geo;
  }

  function build(renderer: THREE.WebGLRenderer, high: boolean, created: Disposable[]): Scene3D {
    renderer.setPixelRatio(renderPixelRatio(width, height, high));
    renderer.setSize(width, height, false);
    renderer.autoClear = false;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
    const cam = new THREE.PerspectiveCamera(BASE_VFOV_DEG, width / height, 0.1, 1200);
    cam.position.set(0, CAM_HEIGHT, 0);

    // ground: a wide plane under the road (the camera stays at x = 0, the road bends around it);
    // fog paints the dusk haze on its far part
    const groundGeo = new THREE.PlaneGeometry(2400, 1100);
    groundGeo.rotateX(-Math.PI / 2);
    created.push(groundGeo);
    const groundMat = new THREE.MeshBasicMaterial({ color: GROUND_COLOR, depthWrite: false });
    created.push(groundMat);
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(0, -0.01, -540);
    ground.renderOrder = 0;
    scene.add(ground);

    const segs = high ? RIBBON_SEGMENTS_HIGH : RIBBON_SEGMENTS_LOW;
    const ribbonDepths = new Float32Array(segs + 1);
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      ribbonDepths[i] = NEAR_DEPTH + (VIEW - NEAR_DEPTH) * u * u;
    }
    const ribbons = [
      makeRibbon(segs, -1, 1, ROAD_COLOR, 1, created),
      makeRibbon(segs, -LINE_OUTER, -LINE_INNER, LINE_COLOR, 3, created),
      makeRibbon(segs, LINE_INNER, LINE_OUTER, LINE_COLOR, 3, created),
    ];
    for (const r of ribbons) scene.add(r.mesh);

    const quad = flatQuad(created);

    const barPeriod = high ? BAR_PERIOD : BAR_PERIOD * 2;
    const barsPerSide = Math.ceil(VIEW / barPeriod) + 1;
    // transparent only to be drawn after the additive glow (three draws opaque objects first)
    const barMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    created.push(barMat);
    const bars = new THREE.InstancedMesh(quad, barMat, barsPerSide * 2);
    created.push(bars);
    bars.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(barsPerSide * 2 * 3),
      3,
    );
    bars.frustumCulled = false;
    bars.renderOrder = 4;
    scene.add(bars);

    let glow: THREE.InstancedMesh | undefined;
    if (high) {
      const soft = rampTexture('soft');
      if (soft) created.push(soft);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: soft,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      created.push(glowMat);
      glow = new THREE.InstancedMesh(quad, glowMat, barsPerSide * 2);
      created.push(glow);
      glow.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(barsPerSide * 2 * 3),
        3,
      );
      glow.frustumCulled = false;
      glow.renderOrder = 2;
      scene.add(glow);
    }

    const dashCount = Math.ceil(VIEW / DASH_PERIOD) + 1;
    const dashMat = new THREE.MeshBasicMaterial({ color: DASH_COLOR, depthWrite: false });
    created.push(dashMat);
    const dashes = new THREE.InstancedMesh(quad, dashMat, dashCount);
    created.push(dashes);
    dashes.frustumCulled = false;
    dashes.renderOrder = 5;
    scene.add(dashes);

    // pine silhouettes: a triangle on a short trunk, facing the camera
    const treeShape = new THREE.Shape();
    treeShape.moveTo(0, 1);
    treeShape.lineTo(0.32, 0.12);
    treeShape.lineTo(0.045, 0.12);
    treeShape.lineTo(0.045, 0);
    treeShape.lineTo(-0.045, 0);
    treeShape.lineTo(-0.045, 0.12);
    treeShape.lineTo(-0.32, 0.12);
    treeShape.closePath();
    const treeGeo = new THREE.ShapeGeometry(treeShape);
    created.push(treeGeo);
    const treeMat = new THREE.MeshBasicMaterial({ color: TREE_COLOR });
    created.push(treeMat);
    const treePeriod = high ? TREE_PERIOD : TREE_PERIOD * 2;
    const treesPerSide = Math.ceil(VIEW / treePeriod) + 1;
    const trees = new THREE.InstancedMesh(treeGeo, treeMat, treesPerSide * 2);
    created.push(trees);
    trees.frustumCulled = false;
    trees.renderOrder = 10;
    scene.add(trees);

    // gate: a ring over the road, a stripe across the road and a translucent round fill
    const gate = new THREE.Group();
    const gateSolid = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      fog: false,
    });
    created.push(gateSolid);
    const ringGeo = new THREE.TorusGeometry(GATE_RADIUS, GATE_TUBE, 8, high ? 72 : 40);
    created.push(ringGeo);
    const ring = new THREE.Mesh(ringGeo, gateSolid);
    ring.position.set(0, GATE_CENTER_Y, 0);
    gate.add(ring);
    const stripe = new THREE.Mesh(quad, gateSolid);
    stripe.scale.set(ROAD_HALF * 2, 1, 0.9);
    stripe.position.set(0, 0.02, -0.45);
    gate.add(stripe);
    const fillTex = rampTexture('vertical');
    if (fillTex) created.push(fillTex);
    const gateFill = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: fillTex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    created.push(gateFill);
    const fillGeo = new THREE.CircleGeometry(GATE_RADIUS, high ? 72 : 40);
    created.push(fillGeo);
    const fill = new THREE.Mesh(fillGeo, gateFill);
    fill.position.set(0, GATE_CENTER_Y, 0);
    gate.add(fill);
    gate.visible = false;
    gate.renderOrder = 11;
    scene.add(gate);

    const out: Scene3D = {
      renderer,
      scene,
      cam,
      ground,
      ribbons,
      ribbonDepths,
      bars,
      barsPerSide,
      barPeriod,
      dashes,
      dashCount,
      trees,
      treesPerSide,
      treePeriod,
      gate,
      gateSolid,
      gateFill,
      high,
      disposables: created,
      unwatchDpr: () => undefined,
    };
    if (glow) out.glow = glow;
    if (high) {
      out.unwatchDpr = watchDevicePixelRatio(() => {
        renderer.setPixelRatio(renderPixelRatio(width, height, true));
        renderer.setSize(width, height, false);
        paint();
      });
    }
    return out;
  }

  function update(frame: WorldFrame): void {
    if (!s) return;
    const { cam, ribbons, ribbonDepths, bars, glow, dashes, trees, gate } = s;
    const dt = frame.dtSec;

    // the speed keeps following the effort even when static: colorAtDepth depends on it
    speed += (frame.speedTarget - speed) * Math.min(1, dt * 1.5);
    if (!reduced) {
      dist += speed * dt;
      fov += (frame.fovTarget - fov) * Math.min(1, dt * 2);
    }
    if (Math.abs(fov - appliedFov) > 1e-3) applyProjection();

    const k = reduced ? 0 : CURVE_SCALE;
    const x0 = frame.path.curveX(dist);
    const roadX = (depth: number): number => (frame.path.curveX(dist + depth) - x0) * k;
    const yawAt = (depth: number): number => -Math.atan(frame.path.slopeX(dist + depth) * k);

    cam.lookAt(roadX(LOOK_AHEAD), CAM_HEIGHT, -LOOK_AHEAD);

    for (const r of ribbons) {
      const { pos, inner, outer } = r;
      for (let i = 0; i < ribbonDepths.length; i++) {
        const d = ribbonDepths[i] ?? 0;
        const x = roadX(d);
        const o = i * 6;
        pos[o] = x + inner * ROAD_HALF;
        pos[o + 1] = 0;
        pos[o + 2] = -d;
        pos[o + 3] = x + outer * ROAD_HALF;
        pos[o + 4] = 0;
        pos[o + 5] = -d;
      }
      r.mesh.geometry.getAttribute('position').needsUpdate = true;
    }

    // edge bars: each takes the colour of the block active when the rider reaches it
    const barW = (EDGE_OUTER - EDGE_INNER) * ROAD_HALF;
    const barMid = ((EDGE_OUTER + EDGE_INNER) / 2) * ROAD_HALF;
    const barLen = s.barPeriod * BAR_FILL;
    const barPhase = dashOffset(dist, s.barPeriod);
    const barBase = Math.floor(dist / s.barPeriod);
    for (let i = 0; i < s.barsPerSide; i++) {
      const near = i * s.barPeriod - barPhase;
      const a = Math.max(near, NEAR_DEPTH);
      const b = near + barLen;
      const visible = b > a;
      const mid = (a + b) / 2;
      const len = visible ? b - a : 0;
      const x = roadX(mid);
      const yaw = yawAt(mid);
      col.copy(parsed(frame.colorAtDepth(Math.max(0, near))));
      if ((i + barBase) % 2 === 1) col.multiplyScalar(BAR_DIM);
      // near the horizon the glow would only add haze: fade it out with depth
      const glowFade = Math.max(0, 1 - mid / 140);
      glowCol.copy(col).multiplyScalar(glowFade);
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? -1 : 1;
        const n = i * 2 + side;
        tmp.position.set(x + sign * barMid, 0, -mid);
        tmp.rotation.set(0, yaw, 0);
        tmp.scale.set(barW, 1, Math.max(len, 1e-4));
        tmp.updateMatrix();
        bars.setMatrixAt(n, tmp.matrix);
        bars.setColorAt(n, col);
        if (glow) {
          tmp.scale.set(barW * 3.2, 1, Math.max(len / BAR_FILL, 1e-4));
          tmp.position.y = -0.005;
          tmp.updateMatrix();
          glow.setMatrixAt(n, tmp.matrix);
          glow.setColorAt(n, glowCol);
        }
      }
    }
    bars.instanceMatrix.needsUpdate = true;
    if (bars.instanceColor) bars.instanceColor.needsUpdate = true;
    if (glow) {
      glow.instanceMatrix.needsUpdate = true;
      if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
    }

    const dashPhase = dashOffset(dist, DASH_PERIOD);
    for (let i = 0; i < s.dashCount; i++) {
      const near = i * DASH_PERIOD - dashPhase;
      const a = Math.max(near, NEAR_DEPTH);
      const b = near + DASH_LENGTH;
      const mid = (a + b) / 2;
      tmp.position.set(roadX(mid), 0, -mid);
      tmp.rotation.set(0, yawAt(mid), 0);
      tmp.scale.set(DASH_HALF * 2, 1, Math.max(b - a, 1e-4));
      tmp.updateMatrix();
      dashes.setMatrixAt(i, tmp.matrix);
    }
    dashes.instanceMatrix.needsUpdate = true;

    const treePhase = dashOffset(dist, s.treePeriod);
    const treeBase = Math.floor(dist / s.treePeriod);
    for (let i = 0; i < s.treesPerSide; i++) {
      const depth = i * s.treePeriod - treePhase;
      const slot = i + treeBase;
      for (let side = 0; side < 2; side++) {
        const key = slot * 2 + side;
        const n = i * 2 + side;
        const sign = side === 0 ? -1 : 1;
        const skip = hash01(key * 5 + 3) < 0.35 || depth < 1;
        const h = skip ? 0 : CAM_HEIGHT * (0.55 + hash01(key) * 0.7);
        tmp.position.set(
          roadX(depth) + sign * ROAD_HALF * (1.6 + hash01(key + 77) * 2.2),
          0,
          -depth,
        );
        tmp.rotation.set(0, 0, 0);
        tmp.scale.set(h * 0.95, h, 1);
        tmp.updateMatrix();
        trees.setMatrixAt(n, tmp.matrix);
      }
    }
    trees.instanceMatrix.needsUpdate = true;

    // gate at the start of the next block, in that block's colour
    const gd = gateDepth({ speed, nextBlockInSec: frame.nextBlockInSec, viewDistance: VIEW });
    if (gd === null) {
      gate.visible = false;
    } else {
      gate.visible = true;
      gate.position.set(roadX(gd), 0, -gd);
      gate.rotation.set(0, yawAt(gd), 0);
      const c = parsed(frame.colorAtDepth(gd + 0.5));
      // fade in from the far end, and out just before the rider rides through it
      const fade = Math.min(1, (VIEW - gd) / 80) * Math.min(1, Math.max(0, (gd - 2) / 10));
      s.gateSolid.color.copy(c);
      s.gateSolid.opacity = fade;
      s.gateFill.color.copy(c);
      s.gateFill.opacity = 0.5 * fade;
    }

    const { renderer } = s;
    renderer.clear();
    renderer.render(s.scene, cam);
    const lights = s.lights;
    if (lights) {
      // a few repaints per second of one small texture; the large backdrop is never redrawn
      lights.t += dt;
      const every = 1 / (s.high ? LIGHTS_FPS_HIGH : LIGHTS_FPS_LOW);
      if (lights.t - lights.painted >= every) {
        lights.painted = lights.t;
        drawLights(lights.g, lights.plan, lights.t);
        lights.tex.needsUpdate = true;
      }
      renderer.clearDepth();
      renderer.render(lights.scene, lights.cam);
    }
  }

  return {
    get speed() {
      return speed;
    },
    get distance() {
      return dist;
    },

    init(canvas: HTMLCanvasElement, quality: WorldQuality) {
      reduced = opts.reducedMotion ?? prefersReducedMotion();
      width = Math.max(1, canvas.clientWidth || canvas.width);
      height = Math.max(1, canvas.clientHeight || canvas.height);
      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: wantsAntialias(renderPixelRatio(width, height, quality === 'high')),
      });
      const created: Disposable[] = [];
      try {
        s = build(renderer, quality === 'high', created);
        applyProjection();
        paint();
      } catch (err) {
        s?.unwatchDpr();
        s?.backdrop?.dispose();
        if (s) disposeLights(s);
        s = undefined;
        for (const c of created) c.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        throw err;
      }
    },

    update,

    resize(w: number, h: number) {
      const nw = Math.max(1, Math.round(w));
      const nh = Math.max(1, Math.round(h));
      if (nw === width && nh === height && s?.backdrop) return;
      width = nw;
      height = nh;
      if (!s) return;
      s.renderer.setSize(width, height, false);
      applyProjection();
      paint();
    },

    setViewOffsetX(fraction: number) {
      if (fraction === viewOffsetX) return;
      viewOffsetX = fraction;
      applyProjection();
    },

    dispose() {
      if (!s) return;
      const cur = s;
      s = undefined;
      cur.unwatchDpr();
      cur.scene.background = null;
      cur.scene.clear();
      cur.backdrop?.dispose();
      disposeLights(cur);
      for (const d of cur.disposables) d.dispose();
      cur.renderer.dispose();
      cur.renderer.forceContextLoss();
      colorCache.clear();
    },
  };
}
