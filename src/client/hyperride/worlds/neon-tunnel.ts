import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { TUNNEL_LENGTH } from '../../../domain/tunnel-path';
import { glowStrength } from '../frame';
import type { HyperrideQuality, HyperrideWorld, WorldFrame } from '../world';

/**
 * "Neon Tunnel": a port of docs/design/prototypes/hyperride-prototype.html. Comfort rules
 * (spec 4.8): no camera roll and no ring rotation around the view axis, sparse rings, near rings
 * fade out, fog hides the far end, moderate bloom.
 */

const RING_COUNT = 36;
const RING_SPACING = TUNNEL_LENGTH / RING_COUNT; // 8
const RING_RADIUS = 7;
const STREAKS_HIGH = 500;
const STREAKS_LOW = 250;
const CAMERA_HEIGHT = 0.2;
const LOOK_AHEAD = 11;
const BACKGROUND = 0x020308;
const FOG_DENSITY = 0.018;
/** Rails sit on the ring's octagon corners: 3π/8, 5π/8, 11π/8, 13π/8. */
const RAIL_ANGLES = [3, 5, 11, 13].map((k) => (k * Math.PI) / 8);

interface Streak {
  a: number;
  r: number;
  depth: number;
}

export interface NeonTunnelOptions {
  rand?: () => number;
}

interface Disposable {
  dispose(): void;
}

interface Scene3D {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  cam: THREE.PerspectiveCamera;
  rings: THREE.InstancedMesh;
  rails: THREE.InstancedMesh;
  streaks: THREE.LineSegments;
  sPos: Float32Array;
  sData: Streak[];
  sMat: THREE.LineBasicMaterial;
  composer?: EffectComposer;
  bloom?: UnrealBloomPass;
  /** Geometries, materials, passes, composer: disposed in order. */
  disposables: Disposable[];
  /** Removes the devicePixelRatio listener. */
  unwatchDpr(): void;
}

const maxPixelRatio = (): number => Math.min(window.devicePixelRatio || 1, 2);

/** Calls `onChange` whenever devicePixelRatio changes (window moved to another screen, zoom). */
function watchDevicePixelRatio(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  let mq: MediaQueryList | undefined;
  const handle = (): void => {
    onChange();
    listen();
  };
  function listen(): void {
    mq?.removeEventListener('change', handle);
    mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener('change', handle);
  }
  listen();
  return () => mq?.removeEventListener('change', handle);
}

export function createNeonTunnel(opts: NeonTunnelOptions = {}): HyperrideWorld {
  const rand = opts.rand ?? Math.random;
  let s: Scene3D | undefined;
  let width = 1;
  let height = 1;
  let viewOffsetX = 0;

  // smoothed state, initial values as in the prototype
  let dist = 0;
  let slope = 0;
  let speed = 12;
  let fov = 70;
  /** Taken from the first frame, so the bloom does not flash at start. */
  let glow: number | undefined;
  let appliedFov = NaN;

  const tmp = new THREE.Object3D();
  // yaw first, then pitch: the pair can never add a roll around the view axis
  tmp.rotation.order = 'YXZ';
  const railOffset = new THREE.Vector3();
  const col = new THREE.Color();
  const col2 = new THREE.Color();
  const colorCache = new Map<string, THREE.Color>();
  const parsed = (hex: string): THREE.Color => {
    let c = colorCache.get(hex);
    if (!c) {
      c = new THREE.Color(hex);
      colorCache.set(hex, c);
    }
    return c;
  };

  /** setViewOffset / clearViewOffset also refresh the projection matrix. */
  function applyViewOffset(): void {
    if (!s) return;
    if (viewOffsetX !== 0) {
      s.cam.setViewOffset(width, height, width * viewOffsetX, 0, width, height);
    } else {
      s.cam.clearViewOffset();
    }
    appliedFov = s.cam.fov;
  }

  /** Everything after the renderer; `created` collects disposables for cleanup on failure. */
  function build(renderer: THREE.WebGLRenderer, high: boolean, created: Disposable[]): Scene3D {
    renderer.setPixelRatio(high ? maxPixelRatio() : 1);
    renderer.setSize(width, height, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND);
    scene.fog = new THREE.FogExp2(BACKGROUND, FOG_DENSITY);
    const cam = new THREE.PerspectiveCamera(70, width / height, 0.1, 400);

    // With bloom the OutputPass applies ACES to the whole frame; rendering directly (low
    // quality) the materials must opt in to tone mapping to keep the same look.
    const toneMapped = !high;
    const ringGeo = new THREE.TorusGeometry(RING_RADIUS, 0.07, 6, 8);
    created.push(ringGeo);
    ringGeo.rotateZ(Math.PI / 8);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped });
    created.push(ringMat);
    const rings = new THREE.InstancedMesh(ringGeo, ringMat, RING_COUNT);
    created.push(rings);
    rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(RING_COUNT * 3), 3);
    rings.frustumCulled = false;
    scene.add(rings);

    const railGeo = new THREE.BoxGeometry(0.06, 0.02, RING_SPACING * 1.02);
    created.push(railGeo);
    const rails = new THREE.InstancedMesh(railGeo, ringMat, RING_COUNT * 4);
    created.push(rails);
    rails.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(RING_COUNT * 4 * 3),
      3,
    );
    rails.frustumCulled = false;
    scene.add(rails);

    const streakCount = high ? STREAKS_HIGH : STREAKS_LOW;
    const sPos = new Float32Array(streakCount * 6);
    const sData: Streak[] = [];
    for (let i = 0; i < streakCount; i++) {
      sData.push({ a: rand() * Math.PI * 2, r: 2 + rand() * 4.5, depth: rand() * TUNNEL_LENGTH });
    }
    const sGeo = new THREE.BufferGeometry();
    created.push(sGeo);
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    const sMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      toneMapped,
    });
    created.push(sMat);
    const streaks = new THREE.LineSegments(sGeo, sMat);
    streaks.frustumCulled = false;
    scene.add(streaks);

    const out: Scene3D = {
      renderer,
      scene,
      cam,
      rings,
      rails,
      streaks,
      sPos,
      sData,
      sMat,
      disposables: created,
      unwatchDpr: () => undefined,
    };

    if (high) {
      const composer = new EffectComposer(renderer);
      created.push(composer);
      const renderPass = new RenderPass(scene, cam);
      created.push(renderPass);
      const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.6, 0.35, 0.05);
      created.push(bloom);
      const output = new OutputPass();
      created.push(output);
      composer.addPass(renderPass);
      composer.addPass(bloom);
      composer.addPass(output);
      composer.setSize(width, height);
      out.composer = composer;
      out.bloom = bloom;
      out.unwatchDpr = watchDevicePixelRatio(() => {
        renderer.setPixelRatio(maxPixelRatio());
        renderer.setSize(width, height, false);
        composer.setPixelRatio(maxPixelRatio());
        composer.setSize(width, height);
      });
    }
    return out;
  }

  function update(frame: WorldFrame): void {
    if (!s) return;
    const { cam, rings, rails, sPos, sData, streaks, sMat } = s;
    const dt = frame.dtSec;
    const { curveX, curveY } = frame.path;
    const L = TUNNEL_LENGTH;

    speed += (frame.speedTarget - speed) * Math.min(1, dt * 1.5);
    dist += speed * dt;
    slope += (frame.slopeTarget - slope) * Math.min(1, dt * 0.8);
    fov += (frame.fovTarget - fov) * Math.min(1, dt * 2);
    if (Math.abs(fov - appliedFov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
      appliedFov = fov;
    }
    const glowTarget = glowStrength(frame.effortGlow);
    glow = glow === undefined ? glowTarget : glow + (glowTarget - glow) * Math.min(1, dt * 1.5);
    if (s.bloom) s.bloom.strength = glow;

    // camera on the path; lookAt with a fixed up vector: never any roll
    cam.position.set(curveX(dist), curveY(dist) + CAMERA_HEIGHT, 0);
    cam.lookAt(
      curveX(dist + LOOK_AHEAD),
      curveY(dist + LOOK_AHEAD) + slope * LOOK_AHEAD + CAMERA_HEIGHT,
      -LOOK_AHEAD,
    );

    for (let k = 0; k < RING_COUNT; k++) {
      const depth = (((k * RING_SPACING - dist) % L) + L) % L;
      const z = dist + depth;
      const x = curveX(z);
      const y = curveY(z) + slope * depth;
      // ring faces along the path: yaw/pitch only (order YXZ), no rotation around the view axis
      const yaw = -Math.atan(frame.path.slopeX(z));
      const pitch = Math.atan(frame.path.slopeY(z) + slope);
      tmp.position.set(x, y, -depth);
      tmp.rotation.set(pitch, yaw, 0);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      rings.setMatrixAt(k, tmp.matrix);

      col.copy(parsed(frame.colorAtDepth(depth)));
      const far = 1 - depth / L;
      const near = Math.min(1, Math.max(0, (depth - 4) / 14));
      col.multiplyScalar((0.15 + 0.75 * far * far * far) * near * near);
      rings.setColorAt(k, col);

      col2.copy(col).multiplyScalar(0.6);
      for (let r = 0; r < 4; r++) {
        const ang = RAIL_ANGLES[r] ?? 0;
        // rails sit on the ring and follow both its yaw and pitch (tmp still holds them)
        railOffset
          .set(Math.cos(ang) * RING_RADIUS, Math.sin(ang) * RING_RADIUS, 0)
          .applyQuaternion(tmp.quaternion);
        tmp.position.set(x + railOffset.x, y + railOffset.y, -depth + railOffset.z);
        tmp.updateMatrix();
        rails.setMatrixAt(k * 4 + r, tmp.matrix);
        rails.setColorAt(k * 4 + r, col2);
      }
    }
    rings.instanceMatrix.needsUpdate = true;
    rails.instanceMatrix.needsUpdate = true;
    if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
    if (rails.instanceColor) rails.instanceColor.needsUpdate = true;

    const len = Math.max(0.05, speed * 0.06);
    for (let i = 0; i < sData.length; i++) {
      const st = sData[i];
      if (!st) continue;
      st.depth -= speed * dt;
      if (st.depth < 0) st.depth += L;
      const z = dist + st.depth;
      const x = curveX(z) + Math.cos(st.a) * st.r;
      const y = curveY(z) + slope * st.depth + Math.sin(st.a) * st.r;
      const o = i * 6;
      sPos[o] = x;
      sPos[o + 1] = y;
      sPos[o + 2] = -st.depth;
      sPos[o + 3] = x;
      sPos[o + 4] = y;
      sPos[o + 5] = -(st.depth + len);
    }
    streaks.geometry.getAttribute('position').needsUpdate = true;
    sMat.color.copy(parsed(frame.effortColor));
    sMat.opacity = 0.1 + Math.min(0.45, speed / 70);

    if (s.composer) s.composer.render(dt);
    else s.renderer.render(s.scene, cam);
  }

  return {
    get speed() {
      return speed;
    },
    get distance() {
      return dist;
    },

    init(canvas: HTMLCanvasElement, quality: HyperrideQuality) {
      width = Math.max(1, canvas.clientWidth || canvas.width);
      height = Math.max(1, canvas.clientHeight || canvas.height);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      const created: Disposable[] = [];
      try {
        s = build(renderer, quality === 'high', created);
      } catch (err) {
        for (const c of created) c.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        throw err;
      }
      applyViewOffset();
    },

    update,

    resize(w: number, h: number) {
      width = Math.max(1, Math.round(w));
      height = Math.max(1, Math.round(h));
      if (!s) return;
      s.cam.aspect = width / height;
      s.renderer.setSize(width, height, false);
      s.composer?.setSize(width, height);
      applyViewOffset();
    },

    setViewOffsetX(fraction: number) {
      if (fraction === viewOffsetX) return;
      viewOffsetX = fraction;
      applyViewOffset();
    },

    dispose() {
      if (!s) return;
      const cur = s;
      s = undefined;
      cur.unwatchDpr();
      cur.scene.clear();
      for (const d of cur.disposables) d.dispose();
      cur.renderer.dispose();
      cur.renderer.forceContextLoss();
      colorCache.clear();
    },
  };
}
