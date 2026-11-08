import * as THREE from 'three';
import { dashOffset, hash01 } from './road-model';
import {
  MAX_CONSTRUCT_INSTANCES,
  buildConstruct,
  type ConstructFrame,
  type Placer,
} from './scenes-constructs';
import type { SceneExtraId, SceneLook } from './scenes-registry';
import { setHex } from './scenes-shaders';

/** Scene extras of the Scenes world: things a scene adds beyond the shared sky and terrain. */

export interface Disposable {
  dispose(): void;
}

export interface ExtraFrame {
  /** Distance travelled (world z of the camera). */
  dist: number;
  /** Animation time in seconds (frozen under reduced motion). */
  time: number;
  /** Effort intensity 0..1. */
  intensity: number;
  /** Beat pulse swell 0..~0.6 (0 under reduced motion). */
  beat: number;
  look: SceneLook;
  /** Road centre x / height at a depth ahead of the camera. */
  roadX(depth: number): number;
  roadY(depth: number): number;
  fogNear: number;
}

export interface SceneExtra {
  object: THREE.Object3D;
  update(f: ExtraFrame): void;
}

const EXTRA_VIEW = 620;

// ---------------------------------------------------------------------------------------------
// Aurora curtains: soft additive walls of light beside the road and far curtains in the sky
// ---------------------------------------------------------------------------------------------

type CurtainUniforms = {
  uA: { value: THREE.Vector3 };
  uB: { value: THREE.Vector3 };
  uTime: { value: number };
  uIntensity: { value: number };
  uFogNear: { value: number };
  uFogFar: { value: number };
};

function curtainMaterial(uniforms: CurtainUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec2 aUv; // u: world units along the curtain, v: 0 bottom .. 1 top
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        vUv = aUv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uA, uB;
      uniform float uTime, uIntensity, uFogNear, uFogFar;
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        float v = vUv.y;
        float u = vUv.x;
        float folds = 0.55 + 0.25 * sin(u * 0.045 + uTime * 0.35) + 0.2 * sin(u * 0.13 - uTime * 0.6);
        float rays = 0.75 + 0.25 * sin(u * 0.9 + sin(u * 0.05 + uTime * 0.2) * 6.0);
        float a = smoothstep(0.0, 0.06, v) * pow(1.0 - v, 1.5) * folds * rays;
        a *= (0.45 + 0.55 * uIntensity);
        a *= smoothstep(8.0, 60.0, vDepth) * (1.0 - smoothstep(uFogNear, uFogFar, vDepth));
        vec3 col = mix(uA, uB, smoothstep(0.05, 0.85, v));
        gl_FragColor = vec4(col * a, 1.0);
      }
    `,
  });
}

function aurora(high: boolean, created: Disposable[]): SceneExtra {
  const group = new THREE.Group();
  const uniforms: CurtainUniforms = {
    uA: { value: new THREE.Vector3() },
    uB: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uIntensity: { value: 0.5 },
    uFogNear: { value: 200 },
    uFogFar: { value: 900 },
  };
  const mat = curtainMaterial(uniforms);
  created.push(mat);

  // side walls follow the road: one cross-section (bottom + top vertex) per depth
  const sections = high ? 64 : 36;
  const walls = high
    ? [
        { side: -1, off: 34, h: 34, phase: 0.3 },
        { side: 1, off: 46, h: 42, phase: 2.1 },
        { side: -1, off: 90, h: 60, phase: 4.2 },
        { side: 1, off: 120, h: 70, phase: 5.3 },
      ]
    : [
        { side: -1, off: 36, h: 36, phase: 0.3 },
        { side: 1, off: 60, h: 48, phase: 2.1 },
      ];
  const depths = new Float32Array(sections + 1);
  for (let i = 0; i <= sections; i++) {
    const u = i / sections;
    depths[i] = 6 + (EXTRA_VIEW - 6) * u * u;
  }
  const wallGeos = walls.map(() => {
    const geo = new THREE.BufferGeometry();
    created.push(geo);
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array((sections + 1) * 6), 3),
    );
    geo.setAttribute('aUv', new THREE.BufferAttribute(new Float32Array((sections + 1) * 4), 2));
    const idx: number[] = [];
    for (let i = 0; i < sections; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    group.add(mesh);
    return geo;
  });

  // far sky curtains, fixed relative to the camera like the sky
  const skyGeo = new THREE.PlaneGeometry(900, 1, high ? 64 : 32, 1);
  created.push(skyGeo);
  const skyPos = skyGeo.getAttribute('position');
  const skyUv = new Float32Array(skyPos.count * 2);
  for (let i = 0; i < skyPos.count; i++) {
    const x = skyPos.getX(i);
    const top = skyPos.getY(i) > 0;
    skyPos.setXYZ(i, x, top ? 150 : 18, -620 + 60 * Math.sin(x / 140));
    skyUv[i * 2] = x + 2000;
    skyUv[i * 2 + 1] = top ? 1 : 0;
  }
  skyGeo.setAttribute('aUv', new THREE.BufferAttribute(skyUv, 2));
  const sky = new THREE.Mesh(skyGeo, mat);
  sky.frustumCulled = false;
  sky.renderOrder = 6;
  group.add(sky);

  return {
    object: group,
    update(f) {
      setHex(uniforms.uA.value, f.look.extraA);
      setHex(uniforms.uB.value, f.look.extraB);
      uniforms.uTime.value = f.time;
      uniforms.uIntensity.value = f.intensity;
      uniforms.uFogNear.value = f.fogNear * 4;
      uniforms.uFogFar.value = f.look.fogFar * 1.2;
      walls.forEach((w, k) => {
        const geo = wallGeos[k];
        if (!geo) return;
        const pos = geo.getAttribute('position') as THREE.BufferAttribute;
        const uv = geo.getAttribute('aUv') as THREE.BufferAttribute;
        const p = pos.array as Float32Array;
        const q = uv.array as Float32Array;
        for (let i = 0; i < depths.length; i++) {
          const d = depths[i] ?? 0;
          const z = f.dist + d;
          const x =
            f.roadX(d) + w.side * (w.off + 9 * Math.sin(z / 95 + w.phase) + 4 * Math.sin(z / 37));
          const y = f.roadY(d) + 2;
          const h = w.h * (0.7 + 0.3 * Math.sin(z / 150 + w.phase * 2));
          const o = i * 6;
          p[o] = x;
          p[o + 1] = y;
          p[o + 2] = -d;
          p[o + 3] = x;
          p[o + 4] = y + h;
          p[o + 5] = -d;
          q[i * 4] = z;
          q[i * 4 + 1] = 0;
          q[i * 4 + 2] = z;
          q[i * 4 + 3] = 1;
        }
        pos.needsUpdate = true;
        uv.needsUpdate = true;
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Data city: abstract towers with light strips beside the road
// ---------------------------------------------------------------------------------------------

type TowerUniforms = {
  uA: { value: THREE.Vector3 };
  uB: { value: THREE.Vector3 };
  uFill: { value: THREE.Vector3 };
  uFog: { value: THREE.Vector3 };
  uFogNear: { value: number };
  uFogFar: { value: number };
  uTime: { value: number };
  uIntensity: { value: number };
};

function towers(high: boolean, created: Disposable[]): SceneExtra {
  const uniforms: TowerUniforms = {
    uA: { value: new THREE.Vector3() },
    uB: { value: new THREE.Vector3() },
    uFill: { value: new THREE.Vector3() },
    uFog: { value: new THREE.Vector3() },
    uFogNear: { value: 40 },
    uFogFar: { value: 600 },
    uTime: { value: 0 },
    uIntensity: { value: 0.5 },
  };
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  created.push(geo);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vSize;
      varying float vUp;
      varying float vSeed;
      varying float vDepth;
      void main() {
        vLocal = position;
        vUp = normal.y;
        vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz),
          length(instanceMatrix[2].xyz));
        vSeed = instanceColor.r;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uA, uB, uFill, uFog;
      uniform float uFogNear, uFogFar, uTime, uIntensity;
      varying vec3 vLocal;
      varying vec3 vSize;
      varying float vUp;
      varying float vSeed;
      varying float vDepth;
      float h11(float x) { return fract(sin(x * 91.17 + vSeed * 311.7) * 43758.5453); }
      void main() {
        vec3 col = uFill;
        if (vUp < 0.5) {
          float wy = vLocal.y * vSize.y;
          float wx = vLocal.x * vSize.x + vLocal.z * vSize.z;
          // vertical light strips, some dark, and a pulse running up them (faster with effort)
          float col4 = floor(wx / 2.6);
          float lit = step(0.45, h11(col4));
          // antialiased with the screen-space derivative; strips thinner than a pixel fade to
          // their mean instead of sparkling
          float qx = wx / 2.6;
          float fx = max(fwidth(qx), 1e-4);
          float strip = smoothstep(0.16 + fx, 0.16 - fx, abs(fract(qx) - 0.5));
          strip = mix(strip, 0.32, smoothstep(0.2, 0.6, fx)) * lit;
          float run = fract((wy - uTime * (6.0 + 14.0 * uIntensity)) / (26.0 + 20.0 * h11(col4 + 7.0)));
          float pulse = smoothstep(0.0, 0.1, run) * smoothstep(0.35, 0.1, run);
          float qy = wy / 3.2;
          float fy = max(fwidth(qy), 1e-4);
          float floors = smoothstep(0.06 + fy, 0.06 - fy, abs(fract(qy) - 0.5));
          floors = mix(floors, 0.12, smoothstep(0.2, 0.6, fy)) * 0.18;
          col += uA * strip * (0.28 + 0.5 * uIntensity * pulse + 0.25 * pulse);
          col += uB * floors * (0.5 + 0.5 * uIntensity);
          // bright cap line along the roof edge
          col += uA * smoothstep(0.985, 1.0, vLocal.y) * 0.9;
        } else {
          col += uB * 0.08;
        }
        float fogK = smoothstep(uFogNear, uFogFar, vDepth);
        gl_FragColor = vec4(mix(col, uFog, fogK), 1.0);
      }
    `,
  });
  created.push(mat);
  const period = high ? 15 : 26;
  const perSide = Math.ceil(EXTRA_VIEW / period) + 1;
  const mesh = new THREE.InstancedMesh(geo, mat, perSide * 2);
  created.push(mesh);
  const seeds = new Float32Array(perSide * 2 * 3);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(seeds, 3);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  const tmp = new THREE.Object3D();

  return {
    object: mesh,
    update(f) {
      setHex(uniforms.uA.value, f.look.extraA);
      setHex(uniforms.uB.value, f.look.extraB);
      setHex(uniforms.uFill.value, f.look.fill);
      setHex(uniforms.uFog.value, f.look.fog);
      uniforms.uFogNear.value = f.fogNear;
      uniforms.uFogFar.value = f.look.fogFar;
      uniforms.uTime.value = f.time;
      uniforms.uIntensity.value = f.intensity;
      const phase = dashOffset(f.dist, period);
      const base = Math.floor(f.dist / period);
      let n = 0;
      for (let i = 0; i < perSide; i++) {
        const depth = i * period - phase;
        if (depth < 2) continue;
        const slot = i + base;
        for (let side = 0; side < 2; side++) {
          const key = slot * 2 + side;
          if (hash01(key * 7 + 1) < 0.2) continue;
          const sign = side === 0 ? -1 : 1;
          const w = 6 + hash01(key + 11) * 10;
          const r = hash01(key + 23);
          const h = 14 + r * r * 90;
          const x = f.roadX(depth) + sign * (22 + w / 2 + hash01(key + 37) * 50);
          tmp.position.set(x, f.roadY(depth) - 0.5, -depth);
          tmp.rotation.set(0, (hash01(key + 41) - 0.5) * 0.3, 0);
          tmp.scale.set(w, h, 6 + hash01(key + 53) * 10);
          tmp.updateMatrix();
          mesh.setMatrixAt(n, tmp.matrix);
          seeds[n * 3] = hash01(key + 61);
          n++;
        }
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Pylons and arches (Neon Grid): thin glowing posts beside the road, arches over it
// ---------------------------------------------------------------------------------------------

type PylonUniforms = TowerUniforms;

function pylons(high: boolean, created: Disposable[]): SceneExtra {
  const uniforms: PylonUniforms = {
    uA: { value: new THREE.Vector3() },
    uB: { value: new THREE.Vector3() },
    uFill: { value: new THREE.Vector3() },
    uFog: { value: new THREE.Vector3() },
    uFogNear: { value: 40 },
    uFogFar: { value: 600 },
    uTime: { value: 0 },
    uIntensity: { value: 0.5 },
  };
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  created.push(geo);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vSize;
      varying float vDepth;
      void main() {
        vLocal = position;
        vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz),
          length(instanceMatrix[2].xyz));
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uA, uB, uFill, uFog;
      uniform float uFogNear, uFogFar, uTime, uIntensity;
      varying vec3 vLocal;
      varying vec3 vSize;
      varying float vDepth;
      void main() {
        // distance (world units) to the three face planes; the face itself is the smallest, the
        // middle one is the distance to the nearest edge
        float a = (0.5 - abs(vLocal.x)) * vSize.x;
        float b = (0.5 - abs(vLocal.z)) * vSize.z;
        float c = min(vLocal.y, 1.0 - vLocal.y) * vSize.y;
        float mn = min(a, min(b, c));
        float mx = max(a, max(b, c));
        float mid = a + b + c - mn - mx;
        float fw = max(fwidth(mid), 1e-3);
        float edge = 1.0 - smoothstep(0.18, 0.18 + 1.5 * fw, mid);
        float wy = vLocal.y * vSize.y;
        float run = fract((wy - uTime * (8.0 + 22.0 * uIntensity)) / 24.0);
        float pulse = smoothstep(0.0, 0.08, run) * smoothstep(0.3, 0.08, run);
        vec3 col = uFill + uA * edge * (0.45 + 0.55 * pulse) * (0.55 + 0.45 * uIntensity);
        col += uB * 0.1;
        float fogK = smoothstep(uFogNear, uFogFar, vDepth);
        gl_FragColor = vec4(mix(col, uFog, fogK), 1.0);
      }
    `,
  });
  created.push(mat);
  const capacity = high ? MAX_CONSTRUCT_INSTANCES : Math.floor(MAX_CONSTRUCT_INSTANCES / 2);
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  created.push(mesh);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  const tmp = new THREE.Object3D();
  tmp.rotation.order = 'YXZ';
  let n = 0;
  // one reused placer: no allocation per frame
  const put: Placer = (x, y, z, sx, sy, sz, yaw, roll) => {
    if (n >= capacity) return;
    tmp.position.set(x, y, z);
    tmp.rotation.set(0, yaw, roll);
    tmp.scale.set(sx, sy, sz);
    tmp.updateMatrix();
    mesh.setMatrixAt(n++, tmp.matrix);
  };
  const cf: ConstructFrame = {
    dist: 0,
    time: 0,
    roadX: () => 0,
    roadY: () => 0,
    scale: 1,
  };

  return {
    object: mesh,
    update(f) {
      // edges glow in the grid colour of the look
      setHex(uniforms.uA.value, f.look.line);
      setHex(uniforms.uB.value, f.look.extraB);
      setHex(uniforms.uFill.value, f.look.fill);
      setHex(uniforms.uFog.value, f.look.fog);
      uniforms.uFogNear.value = f.fogNear;
      uniforms.uFogFar.value = f.look.fogFar;
      uniforms.uTime.value = f.time;
      uniforms.uIntensity.value = f.intensity + f.beat * 0.5;
      cf.dist = f.dist;
      cf.time = f.time;
      cf.roadX = f.roadX;
      cf.roadY = f.roadY;
      cf.scale = f.look.objHeight;
      n = 0;
      buildConstruct(f.look.construct, high, cf, put);
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

export function buildExtra(id: SceneExtraId, high: boolean, created: Disposable[]): SceneExtra {
  if (id === 'aurora') return aurora(high, created);
  return id === 'pylons' ? pylons(high, created) : towers(high, created);
}
