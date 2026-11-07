import * as THREE from 'three';
import type { Segment } from '../../../domain/segments';
import { FOV_NORMAL } from '../frame';
import type { WorldQuality, WorldRenderer, WorldFrame } from '../world';
import { prefersReducedMotion } from './motion';
import { renderPixelRatio, watchDevicePixelRatio, wantsAntialias } from './pixel-ratio';
import { buildExtra, type Disposable, type SceneExtra } from './scenes-extras';
import { BASE_VFOV_DEG, baseVerticalFov, dashOffset, gateDepth, hash01 } from './road-model';
import { approach, terrainHeight, type TerrainShape } from './scenes-model';
import { elevationTable, sampleTable, windX } from './scenes-path';
import { SCENES, SCENE_VARIANT_COUNTS, type SceneExtraId, type SceneLook } from './scenes-registry';
import {
  workoutSeed,
  buildSceneSchedule,
  lerpLook,
  sceneStateAt,
  type SceneScheduleEntry,
} from './scenes-schedule';
import { applySkyLook, setHex, skyMaterial, terrainMaterial } from './scenes-shaders';

/**
 * "Scenes" (working name): a calm road through abstract, stylised scenes (synthwave grid valley,
 * pattern fields, aurora night, data city; registry in scenes-registry.ts, schedule in
 * scenes-schedule.ts, terrain helpers in scenes-model.ts; design note
 * .superpowers/sdd/2026-10-30-spinning-tutor-v2/road-scenes-design.md). A separate world from the
 * plain Road (road.ts), which stays as it is.
 *
 * The road is the spine: one thin continuous edge line per side in the CURRENT zone colour
 * (smooth change at block boundaries), a subtle dashed centre line, and a round gate at the start
 * of the next block, the only preview of the next block's colour. The road follows the terrain:
 * climbs rise toward the horizon and lift the side terrain, recovery runs down into a valley.
 * Effort drives the scene's intensity (pattern pulse, light strips, aurora brightness), sprints
 * add speed streaks. Scene changes wash the view in light while the rider passes the gate.
 * `low` quality: fewer road sections, coarser terrain, fewer extras, no glow, fewer streaks.
 * Reduced motion: nothing streams or animates; scenes still change with fades.
 */

const CAM_HEIGHT = 4;
const ROAD_HALF = 5.4;
/** Farthest depth the road and gate are drawn to; the terrain goes a little farther. */
const VIEW = 560;
const TERRAIN_VIEW = 720;
const NEAR_DEPTH = 0.5;
const LOOK_AHEAD = 30;
/** The camera pitches by this share of the road's rise ahead (the rest reads as the hill). */
const PITCH_SHARE = 0.6;
/** Bank into bends: roll per unit of lateral acceleration (speed² · curvature), capped. */
const BANK_PER_ACCEL = 0.03;
const MAX_BANK = 0.07;
/** Elevation table step (world units) on high / low quality. */
const PROFILE_STEP_HIGH = 8;
const PROFILE_STEP_LOW = 12;
const HORIZON_LANDSCAPE = 0.45;
const HORIZON_PORTRAIT = 0.4;

const EDGE_INNER = 0.935;
const EDGE_OUTER = 0.985;
const GLOW_INNER = 0.7;
const GLOW_OUTER = 1.32;
const DASH_PERIOD = 10.4;
const DASH_LENGTH = 4.2;
const DASH_HALF = 0.07;
const GATE_RADIUS = ROAD_HALF * 1.05;
const GATE_CENTER_Y = GATE_RADIUS * 0.82;
const GATE_TUBE = 0.16;
const FOG_NEAR = 40;

const RIBBON_SEGMENTS_HIGH = 150;
const RIBBON_SEGMENTS_LOW = 80;
const TERRAIN_ROWS_HIGH = 110;
const TERRAIN_ROWS_LOW = 60;
const TERRAIN_COLS_HIGH = [0, 4, 9, 15, 23, 33, 46, 63, 84, 110, 142, 180, 225, 280, 340];
const TERRAIN_COLS_LOW = [0, 9, 23, 46, 84, 142, 225, 340];
const STREAKS_HIGH = 160;
const STREAKS_LOW = 70;
const STREAK_VIEW = 240;

export interface ScenesOptions {
  /** Static scene (no streaming); defaults to the prefers-reduced-motion media query. */
  reducedMotion?: boolean;
}

/** A strip along the road between two lateral offsets (fractions of ROAD_HALF). */
interface Ribbon {
  mesh: THREE.Mesh;
  pos: Float32Array;
  inner: number;
  outer: number;
  lift: number;
}

interface Streak {
  x: number;
  y: number;
  depth: number;
}

interface Scene3D {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  cam: THREE.PerspectiveCamera;
  fog: THREE.Fog;
  bgScene: THREE.Scene;
  overlayScene: THREE.Scene;
  flatCam: THREE.OrthographicCamera;
  sky: ReturnType<typeof skyMaterial>;
  wash: THREE.MeshBasicMaterial;
  terrain: THREE.Mesh;
  terrainMat: ReturnType<typeof terrainMaterial>;
  terrainPos: Float32Array;
  terrainGrid: Float32Array;
  terrainCols: number[];
  terrainDepths: Float32Array;
  road: THREE.MeshBasicMaterial;
  ribbons: Ribbon[];
  ribbonDepths: Float32Array;
  edge: THREE.MeshBasicMaterial;
  glow?: THREE.MeshBasicMaterial;
  dashes: THREE.InstancedMesh;
  dashMat: THREE.MeshBasicMaterial;
  dashCount: number;
  gate: THREE.Group;
  gateSolid: THREE.MeshBasicMaterial;
  gateFill: THREE.MeshBasicMaterial;
  streaks: THREE.LineSegments;
  streakMat: THREE.LineBasicMaterial;
  streakPos: Float32Array;
  streakData: Streak[];
  extras: Map<SceneExtraId, SceneExtra>;
  high: boolean;
  /** Owned by the scene for its whole life (geometries, materials, textures). */
  disposables: Disposable[];
  unwatchDpr(): void;
}

const isPortrait = (w: number, h: number): boolean => h > w;
const horizonFraction = (w: number, h: number): number =>
  isPortrait(w, h) ? HORIZON_PORTRAIT : HORIZON_LANDSCAPE;

/** Soft horizontal falloff (glow ribbon) or vertical ramp (gate fill). */
function rampTexture(kind: 'vertical' | 'soft'): THREE.CanvasTexture | null {
  const c = document.createElement('canvas');
  c.width = kind === 'soft' ? 64 : 4;
  c.height = kind === 'soft' ? 4 : 64;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad =
    kind === 'soft'
      ? g.createLinearGradient(0, 0, c.width, 0)
      : g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  if (kind === 'soft') {
    grad.addColorStop(0.5, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    grad.addColorStop(1, 'rgba(255,255,255,1)');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stripIndex(segments: number, columns = 2): number[] {
  const idx: number[] = [];
  for (let i = 0; i < segments; i++) {
    for (let c = 0; c < columns - 1; c++) {
      const a = i * columns + c;
      const b = a + columns;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return idx;
}

export function createScenes(opts: ScenesOptions = {}): WorldRenderer {
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
  let bank = 0;
  let seed = 0;
  let profile = new Float32Array(0);
  let profileStep = PROFILE_STEP_HIGH;
  let intensity: number | undefined;
  let sprint = 0;
  let time = 0;
  let edgeReady = false;
  const edgeColor = new THREE.Color();
  const washColor = new THREE.Color();
  const white = new THREE.Color(0xffffff);

  let scheduleFor: readonly Segment[] | undefined;
  let schedule: SceneScheduleEntry[] = [];

  const tmp = new THREE.Object3D();
  tmp.rotation.order = 'YXZ';
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
    const shiftY = height * (0.5 - horizonFraction(width, height));
    cam.setViewOffset(width, height, width * viewOffsetX, shiftY, width, height);
    s.sky.uniforms.uAspect.value = width / height;
    appliedFov = fov;
  }

  function makeRibbon(
    segments: number,
    inner: number,
    outer: number,
    mat: THREE.Material,
    order: number,
    lift: number,
    created: Disposable[],
    extra?: (geo: THREE.BufferGeometry) => void,
  ): Ribbon {
    const pos = new Float32Array((segments + 1) * 2 * 3);
    const geo = new THREE.BufferGeometry();
    created.push(geo);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(stripIndex(segments));
    extra?.(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    return { mesh, pos, inner, outer, lift };
  }

  function build(renderer: THREE.WebGLRenderer, high: boolean, created: Disposable[]): Scene3D {
    renderer.setPixelRatio(renderPixelRatio(width, height, high));
    renderer.setSize(width, height, false);
    renderer.autoClear = false;

    const flatCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeo = new THREE.PlaneGeometry(2, 2);
    created.push(quadGeo);
    const bgScene = new THREE.Scene();
    const sky = skyMaterial();
    created.push(sky);
    const skyQuad = new THREE.Mesh(quadGeo, sky);
    skyQuad.frustumCulled = false;
    bgScene.add(skyQuad);
    const overlayScene = new THREE.Scene();
    const wash = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    created.push(wash);
    const washQuad = new THREE.Mesh(quadGeo, wash);
    washQuad.frustumCulled = false;
    overlayScene.add(washQuad);

    const scene = new THREE.Scene();
    const fog = new THREE.Fog(0x000000, FOG_NEAR, 600);
    scene.fog = fog;
    const cam = new THREE.PerspectiveCamera(BASE_VFOV_DEG, width / height, 0.3, 1500);
    cam.position.set(0, CAM_HEIGHT, 0);

    // terrain: a height field around the road, columns at fixed offsets from the road centre
    const half = high ? TERRAIN_COLS_HIGH : TERRAIN_COLS_LOW;
    const terrainCols = [
      ...half
        .slice(1)
        .map((x) => -x)
        .reverse(),
      ...half,
    ];
    const rows = high ? TERRAIN_ROWS_HIGH : TERRAIN_ROWS_LOW;
    const terrainDepths = new Float32Array(rows + 1);
    for (let i = 0; i <= rows; i++) {
      const u = i / rows;
      terrainDepths[i] = NEAR_DEPTH + (TERRAIN_VIEW - NEAR_DEPTH) * u * u;
    }
    const nCols = terrainCols.length;
    const terrainPos = new Float32Array((rows + 1) * nCols * 3);
    const terrainGrid = new Float32Array((rows + 1) * nCols * 3);
    const terrainGeo = new THREE.BufferGeometry();
    created.push(terrainGeo);
    terrainGeo.setAttribute('position', new THREE.BufferAttribute(terrainPos, 3));
    terrainGeo.setAttribute('aGrid', new THREE.BufferAttribute(terrainGrid, 3));
    terrainGeo.setIndex(stripIndex(rows, nCols));
    const terrainMat = terrainMaterial();
    terrainMat.side = THREE.DoubleSide;
    created.push(terrainMat);
    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    terrain.frustumCulled = false;
    terrain.renderOrder = 0;
    scene.add(terrain);

    profileStep = high ? PROFILE_STEP_HIGH : PROFILE_STEP_LOW;
    profile = new Float32Array(Math.ceil(TERRAIN_VIEW / profileStep) + 2);
    const segs = high ? RIBBON_SEGMENTS_HIGH : RIBBON_SEGMENTS_LOW;
    const ribbonDepths = new Float32Array(segs + 1);
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      ribbonDepths[i] = NEAR_DEPTH + (VIEW - NEAR_DEPTH) * u * u;
    }
    const road = new THREE.MeshBasicMaterial({
      color: 0x101018,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    created.push(road);
    const edge = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -8,
    });
    created.push(edge);
    const ribbons = [
      makeRibbon(segs, -1, 1, road, 1, 0, created),
      makeRibbon(segs, -EDGE_OUTER, -EDGE_INNER, edge, 4, 0.01, created),
      makeRibbon(segs, EDGE_INNER, EDGE_OUTER, edge, 4, 0.01, created),
    ];
    let glow: THREE.MeshBasicMaterial | undefined;
    if (high) {
      const soft = rampTexture('soft');
      if (soft) created.push(soft);
      glow = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: soft,
        vertexColors: true,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -6,
      });
      created.push(glow);
      // u across the strip for the soft texture; brightness fades with depth (fixed per section)
      const glowAttrs = (geo: THREE.BufferGeometry): void => {
        const uv = new Float32Array((segs + 1) * 4);
        const col = new Float32Array((segs + 1) * 6);
        for (let i = 0; i <= segs; i++) {
          uv.set([0, 0.5, 1, 0.5], i * 4);
          const fade = Math.max(0, 1 - (ribbonDepths[i] ?? 0) / 220);
          col.fill(fade * fade, i * 6, i * 6 + 6);
        }
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      };
      ribbons.push(
        makeRibbon(segs, -GLOW_OUTER, -GLOW_INNER, glow, 3, 0.005, created, glowAttrs),
        makeRibbon(segs, GLOW_INNER, GLOW_OUTER, glow, 3, 0.005, created, glowAttrs),
      );
    }
    for (const r of ribbons) scene.add(r.mesh);

    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);
    created.push(quad);
    const dashCount = Math.ceil(VIEW / DASH_PERIOD) + 1;
    const dashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -8,
    });
    created.push(dashMat);
    const dashes = new THREE.InstancedMesh(quad, dashMat, dashCount);
    created.push(dashes);
    dashes.frustumCulled = false;
    dashes.renderOrder = 5;
    scene.add(dashes);

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
    stripe.position.set(0, 0.03, -0.45);
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

    // sprint streaks: short lines rushing past beside and above the road
    const nStreaks = high ? STREAKS_HIGH : STREAKS_LOW;
    const streakPos = new Float32Array(nStreaks * 6);
    const streakGeo = new THREE.BufferGeometry();
    created.push(streakGeo);
    streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
    const streakMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    created.push(streakMat);
    const streaks = new THREE.LineSegments(streakGeo, streakMat);
    streaks.frustumCulled = false;
    streaks.renderOrder = 12;
    streaks.visible = false;
    scene.add(streaks);
    const streakData: Streak[] = [];
    for (let i = 0; i < nStreaks; i++) {
      const side = hash01(i * 3) < 0.5 ? -1 : 1;
      streakData.push({
        x: side * (ROAD_HALF * 1.4 + hash01(i * 3 + 1) * 22),
        y: 0.4 + hash01(i * 3 + 2) * 12,
        depth: hash01(i + 500) * STREAK_VIEW,
      });
    }

    const out: Scene3D = {
      renderer,
      scene,
      cam,
      fog,
      bgScene,
      overlayScene,
      flatCam,
      sky,
      wash,
      terrain,
      terrainMat,
      terrainPos,
      terrainGrid,
      terrainCols,
      terrainDepths,
      road,
      ribbons,
      ribbonDepths,
      edge,
      dashes,
      dashMat,
      dashCount,
      gate,
      gateSolid,
      gateFill,
      streaks,
      streakMat,
      streakPos,
      streakData,
      extras: new Map(),
      high,
      disposables: created,
      unwatchDpr: () => undefined,
    };
    if (glow) out.glow = glow;
    if (high) {
      out.unwatchDpr = watchDevicePixelRatio(() => {
        renderer.setPixelRatio(renderPixelRatio(width, height, true));
        renderer.setSize(width, height, false);
      });
    }
    return out;
  }

  function extraFor(id: SceneExtraId): SceneExtra | undefined {
    if (!s) return undefined;
    let e = s.extras.get(id);
    if (!e) {
      e = buildExtra(id, s.high, s.disposables);
      s.extras.set(id, e);
      s.scene.add(e.object);
    }
    return e;
  }

  function update(frame: WorldFrame): void {
    if (!s) return;
    const { cam, ribbons, ribbonDepths, dashes, gate } = s;
    const dt = frame.dtSec;

    // the speed keeps following the effort even when static: colorAtDepth depends on it
    speed += (frame.speedTarget - speed) * Math.min(1, dt * 1.5);
    const intensityTarget = Math.min(1, Math.max(0, (frame.effortGlow - 0.2) / 0.7));
    intensity =
      intensity === undefined ? intensityTarget : approach(intensity, intensityTarget, dt, 0.8);
    const sprinting = frame.fovTarget > FOV_NORMAL || frame.effortGlow >= 0.8;
    if (!reduced) {
      dist += speed * dt;
      time += dt;
      fov += (frame.fovTarget - fov) * Math.min(1, dt * 2);
      sprint = approach(sprint, sprinting ? 1 : 0, dt, 1.2);
    }
    if (Math.abs(fov - appliedFov) > 1e-3) applyProjection();

    // which scene / variant (pure schedule keyed to the workout time)
    if (scheduleFor !== frame.segments) {
      scheduleFor = frame.segments;
      schedule = buildSceneSchedule(frame.segments, { variantCounts: SCENE_VARIANT_COUNTS });
      seed = workoutSeed(frame.segments);
    }
    const st = sceneStateAt(schedule, frame.workoutSec);
    const def = SCENES[st.scene] ?? SCENES[0];
    if (!def) return;
    const fromLook = def.variants[st.fromVariant] ?? def.variants[0];
    const toLook = def.variants[st.toVariant] ?? fromLook;
    if (!fromLook || !toLook) return;
    const look: SceneLook = st.variantMix >= 1 ? toLook : lerpLook(fromLook, toLook, st.variantMix);

    // road geometry ahead: curves and elevation relative to the camera
    // (scenes-path: winding bends, rolling crests and dips, block grades integrated ahead;
    // under reduced motion the profile ignores the workout so the scene stays still)
    const x0 = windX(dist, seed);
    const roadX = (d: number): number => windX(dist + d, seed) - x0;
    elevationTable(
      reduced ? [] : frame.segments,
      reduced ? 0 : frame.workoutSec,
      speed,
      dist,
      seed,
      profileStep,
      profile,
    );
    const roadY = (d: number): number => sampleTable(profile, profileStep, d);
    const yawAt = (d: number): number => -Math.atan(roadX(d + 0.5) - roadX(d - 0.5));

    // camera: pitches with the slope ahead, banks gently into bends
    const lookY = roadY(LOOK_AHEAD) * PITCH_SHARE;
    cam.lookAt(roadX(LOOK_AHEAD), CAM_HEIGHT + lookY, -LOOK_AHEAD);
    if (!reduced) {
      const curvature = (roadX(30) - 2 * roadX(20) + roadX(10)) / 100;
      const bankTarget = Math.max(
        -MAX_BANK,
        Math.min(MAX_BANK, -BANK_PER_ACCEL * curvature * speed * speed),
      );
      bank = approach(bank, bankTarget, dt, 1.5);
    }
    cam.rotateZ(bank);
    const pitch = Math.atan(lookY / LOOK_AHEAD);
    const halfFov = (cam.fov * Math.PI) / 360;
    const sky = s.sky.uniforms;
    applySkyLook(sky, look);
    const level = 1 - horizonFraction(width, height);
    sky.uHorizonY.value = level - (0.5 * Math.tan(pitch)) / Math.tan(halfFov);
    sky.uRoll.value = bank;
    sky.uPivot.value.set(0.5 - viewOffsetX, level);
    sky.uSunX.value = look.sunX - viewOffsetX;
    sky.uTime.value = time;

    s.fog.color.copy(parsed(look.fog));
    s.fog.far = look.fogFar;
    s.road.color.copy(parsed(look.road));

    // zone edge: the CURRENT zone colour, easing over at block boundaries
    const target = parsed(frame.effortColor);
    if (!edgeReady) {
      edgeColor.copy(target);
      edgeReady = true;
    } else {
      edgeColor.lerp(target, Math.min(1, dt * 3));
    }
    s.edge.color.copy(edgeColor);
    s.glow?.color.copy(edgeColor).multiplyScalar(0.5 + 0.5 * intensity);
    s.dashMat.color.copy(parsed(look.road)).lerp(white, 0.55);

    // terrain
    const tm = s.terrainMat.uniforms;
    setHex(tm.uFill.value, look.fill);
    setHex(tm.uLine.value, look.line);
    setHex(tm.uFog.value, look.fog);
    tm.uFogNear.value = FOG_NEAR;
    tm.uFogFar.value = look.fogFar;
    tm.uScale.value = look.patternScale;
    tm.uWidth.value = look.lineWidth;
    tm.uPatA.value = fromLook.pattern;
    tm.uPatB.value = toLook.pattern;
    tm.uPatMix.value = st.variantMix;
    tm.uIntensity.value = intensity;
    tm.uTime.value = time;
    tm.uDist.value = dist;
    // climbs lift the side terrain, recovery lowers it
    const slopeAhead = roadY(200) / 200;
    const lift = 1 + Math.max(-0.35, Math.min(0.7, slopeAhead * 4));
    const shape: TerrainShape = {
      height: look.height * lift,
      flat: look.flat,
      rise: look.rise,
      roughness: look.roughness,
    };
    tm.uPeak.value = Math.max(1, shape.height);
    const { terrainPos: tp, terrainGrid: tg, terrainCols: cols, terrainDepths: tds } = s;
    const nCols = cols.length;
    for (let i = 0; i < tds.length; i++) {
      const d = tds[i] ?? 0;
      const rx = roadX(d);
      const ry = roadY(d) - 0.05;
      const z = dist + d;
      for (let c = 0; c < nCols; c++) {
        const off = cols[c] ?? 0;
        const h = terrainHeight(Math.abs(off), z, shape);
        const o = (i * nCols + c) * 3;
        tp[o] = rx + off;
        tp[o + 1] = ry + h;
        tp[o + 2] = -d;
        tg[o] = off;
        tg[o + 1] = z;
        tg[o + 2] = h;
      }
    }
    s.terrain.geometry.getAttribute('position').needsUpdate = true;
    s.terrain.geometry.getAttribute('aGrid').needsUpdate = true;

    // road ribbons
    for (const r of ribbons) {
      const { pos, inner, outer, lift: up } = r;
      for (let i = 0; i < ribbonDepths.length; i++) {
        const d = ribbonDepths[i] ?? 0;
        const x = roadX(d);
        const y = roadY(d) + up;
        const o = i * 6;
        pos[o] = x + inner * ROAD_HALF;
        pos[o + 1] = y;
        pos[o + 2] = -d;
        pos[o + 3] = x + outer * ROAD_HALF;
        pos[o + 4] = y;
        pos[o + 5] = -d;
      }
      r.mesh.geometry.getAttribute('position').needsUpdate = true;
    }

    const dashPhase = dashOffset(dist, DASH_PERIOD);
    for (let i = 0; i < s.dashCount; i++) {
      const near = i * DASH_PERIOD - dashPhase;
      const a = Math.max(near, NEAR_DEPTH);
      const b = near + DASH_LENGTH;
      const mid = (a + b) / 2;
      const len = Math.max(b - a, 1e-4);
      tmp.position.set(roadX(mid), roadY(mid) + 0.02, -mid);
      tmp.rotation.set(Math.atan((roadY(b) - roadY(a)) / len), yawAt(mid), 0);
      tmp.scale.set(DASH_HALF * 2, 1, len);
      tmp.updateMatrix();
      dashes.setMatrixAt(i, tmp.matrix);
    }
    dashes.instanceMatrix.needsUpdate = true;

    // gate at the start of the next block, in that block's colour
    const gd = gateDepth({ speed, nextBlockInSec: frame.nextBlockInSec, viewDistance: VIEW });
    if (gd === null) {
      gate.visible = false;
    } else {
      gate.visible = true;
      gate.position.set(roadX(gd), roadY(gd), -gd);
      gate.rotation.set(0, yawAt(gd), 0);
      const c = parsed(frame.colorAtDepth(gd + 0.5));
      const fade = Math.min(1, (VIEW - gd) / 100) * Math.min(1, Math.max(0, (gd - 2) / 10));
      s.gateSolid.color.copy(c);
      s.gateSolid.opacity = fade;
      s.gateFill.color.copy(c);
      s.gateFill.opacity = 0.45 * fade;
    }

    // scene extras: only the current scene's extra is visible
    for (const [id, e] of s.extras) e.object.visible = id === def.extra;
    if (def.extra) {
      extraFor(def.extra)?.update({
        dist,
        time,
        intensity,
        look,
        roadX,
        roadY,
        fogNear: FOG_NEAR,
      });
    }

    // sprint streaks
    s.streaks.visible = sprint > 0.01;
    if (s.streaks.visible) {
      const len = Math.max(0.5, speed * 0.12);
      const sp = s.streakPos;
      s.streakData.forEach((k, i) => {
        k.depth -= speed * 1.6 * dt;
        if (k.depth < 0) k.depth += STREAK_VIEW;
        const o = i * 6;
        const x = roadX(k.depth) + k.x;
        const y = roadY(k.depth) + k.y;
        sp[o] = x;
        sp[o + 1] = y;
        sp[o + 2] = -k.depth;
        sp[o + 3] = x;
        sp[o + 4] = y;
        sp[o + 5] = -(k.depth + len);
      });
      s.streaks.geometry.getAttribute('position').needsUpdate = true;
      s.streakMat.color.copy(edgeColor).lerp(white, 0.5);
      s.streakMat.opacity = 0.55 * sprint;
    }

    // scene change: a wash in the scene's horizon light, peaking as the rider passes the gate
    // (outgoing scene's colour before the change, incoming after; the swap hides at the peak)
    washColor.copy(parsed(look.horizonGlow)).lerp(white, 0.3);
    s.wash.color.copy(washColor);
    s.wash.opacity = st.wash;

    const { renderer } = s;
    renderer.clear();
    renderer.render(s.bgScene, s.flatCam);
    renderer.render(s.scene, cam);
    if (st.wash > 0.001) renderer.render(s.overlayScene, s.flatCam);
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
      } catch (err) {
        s?.unwatchDpr();
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
      if (nw === width && nh === height) return;
      width = nw;
      height = nh;
      if (!s) return;
      s.renderer.setPixelRatio(renderPixelRatio(width, height, s.high));
      s.renderer.setSize(width, height, false);
      applyProjection();
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
      cur.scene.clear();
      cur.bgScene.clear();
      cur.overlayScene.clear();
      cur.extras.clear();
      for (const d of cur.disposables) d.dispose();
      cur.renderer.dispose();
      cur.renderer.forceContextLoss();
      colorCache.clear();
    },
  };
}
