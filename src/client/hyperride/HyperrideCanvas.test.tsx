import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EFFORT_TABLE } from '../../domain/effort';
import type { Segment } from '../../domain/segments';
import { HyperrideCanvas } from './HyperrideCanvas';
import type { FrameInput } from './world';

/** Minimal stand-in for the parts of three the Neon Tunnel touches; records disposal. */
const fake = vi.hoisted(() => {
  const log = {
    disposed: [] as string[],
    renderers: [] as { forceContextLoss: ReturnType<typeof vi.fn> }[],
    renders: 0,
    composerRenders: 0,
    failRenderer: false,
  };
  const vec = () => ({ set: vi.fn(), setScalar: vi.fn() });
  class Disposable {
    constructor(readonly kind: string) {}
    dispose() {
      log.disposed.push(this.kind);
    }
  }
  class Color {
    set() {
      return this;
    }
    copy() {
      return this;
    }
    multiplyScalar() {
      return this;
    }
  }
  class Object3D {
    position = vec();
    rotation = vec();
    scale = vec();
    matrix = {};
    frustumCulled = true;
    updateMatrix() {}
  }
  class Geometry extends Disposable {
    attrs: Record<string, { needsUpdate: boolean }> = {};
    rotateZ() {
      return this;
    }
    setAttribute(name: string, a: { needsUpdate: boolean }) {
      this.attrs[name] = a;
    }
    getAttribute(name: string) {
      return this.attrs[name] ?? { needsUpdate: false };
    }
  }
  class Material extends Disposable {
    color = new Color();
    opacity = 1;
  }
  const three = {
    ACESFilmicToneMapping: 4,
    Color,
    Object3D,
    Vector2: class {},
    FogExp2: class {},
    BufferAttribute: class {
      needsUpdate = false;
    },
    InstancedBufferAttribute: class {
      needsUpdate = false;
    },
    Scene: class {
      background: unknown;
      fog: unknown;
      add() {}
      clear() {}
    },
    PerspectiveCamera: class extends Object3D {
      fov = 70;
      aspect = 1;
      updateProjectionMatrix() {}
      lookAt() {}
      setViewOffset() {}
      clearViewOffset() {}
    },
    TorusGeometry: class extends Geometry {
      constructor() {
        super('TorusGeometry');
      }
    },
    BoxGeometry: class extends Geometry {
      constructor() {
        super('BoxGeometry');
      }
    },
    BufferGeometry: class extends Geometry {
      constructor() {
        super('BufferGeometry');
      }
    },
    MeshBasicMaterial: class extends Material {
      constructor() {
        super('MeshBasicMaterial');
      }
    },
    LineBasicMaterial: class extends Material {
      constructor() {
        super('LineBasicMaterial');
      }
    },
    InstancedMesh: class extends Disposable {
      instanceMatrix = { needsUpdate: false };
      instanceColor: { needsUpdate: boolean } | null = null;
      frustumCulled = true;
      constructor() {
        super('InstancedMesh');
      }
      setMatrixAt() {}
      setColorAt() {}
    },
    LineSegments: class {
      frustumCulled = true;
      constructor(readonly geometry: InstanceType<typeof Geometry>) {}
    },
    WebGLRenderer: class extends Disposable {
      toneMapping = 0;
      forceContextLoss = vi.fn();
      constructor() {
        if (log.failRenderer) throw new Error('Error creating WebGL context.');
        super('WebGLRenderer');
        log.renderers.push(this);
      }
      setPixelRatio() {}
      setSize() {}
      render() {
        log.renders += 1;
      }
    },
  };
  const pass = (kind: string) =>
    class extends Disposable {
      strength = 0;
      constructor() {
        super(kind);
      }
    };
  const composer = class extends Disposable {
    constructor() {
      super('EffectComposer');
    }
    addPass() {}
    setSize() {}
    render() {
      log.composerRenders += 1;
    }
  };
  return { log, three, pass, composer };
});

vi.mock('three', () => fake.three);
vi.mock('three/examples/jsm/postprocessing/EffectComposer.js', () => ({
  EffectComposer: fake.composer,
}));
vi.mock('three/examples/jsm/postprocessing/RenderPass.js', () => ({
  RenderPass: fake.pass('RenderPass'),
}));
vi.mock('three/examples/jsm/postprocessing/UnrealBloomPass.js', () => ({
  UnrealBloomPass: fake.pass('UnrealBloomPass'),
}));
vi.mock('three/examples/jsm/postprocessing/OutputPass.js', () => ({
  OutputPass: fake.pass('OutputPass'),
}));

const segment: Segment = {
  index: 0,
  startSec: 0,
  durationSec: 60,
  kind: 'steady',
  ftpPctStart: 62,
  ftpPctEnd: 62,
  effortStart: 3,
  effortEnd: 3,
  rpm: 85,
  blockId: 'b',
  rep: 1,
  reps: 1,
};

const input: FrameInput = {
  segments: [segment],
  state: {
    status: 'running',
    segmentIndex: 0,
    workoutElapsedSec: 5,
    segmentElapsedSec: 5,
    segmentRemainingSec: 55,
  },
  table: DEFAULT_EFFORT_TABLE,
};

let frames: FrameRequestCallback[];

beforeEach(() => {
  fake.log.disposed.length = 0;
  fake.log.renderers.length = 0;
  fake.log.renders = 0;
  fake.log.composerRenders = 0;
  fake.log.failRenderer = false;
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockWebgl(): void {
  const gl = { getExtension: () => ({ loseContext: vi.fn() }) };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    gl as unknown as RenderingContext,
  );
}

describe('HyperrideCanvas', () => {
  it('reports unavailable when WebGL context creation fails', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onUnavailable = vi.fn();
    render(
      <HyperrideCanvas getFrameInput={() => input} quality="high" onUnavailable={onUnavailable} />,
    );
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1));
    expect(fake.log.renderers).toHaveLength(0);
  });

  it('reports unavailable when the renderer throws', async () => {
    mockWebgl();
    fake.log.failRenderer = true;
    const onUnavailable = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(
      <HyperrideCanvas getFrameInput={() => input} quality="high" onUnavailable={onUnavailable} />,
    );
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1));
    expect(fake.log.disposed).toEqual([]);
  });

  it('renders frames from getFrameInput and disposes everything on unmount', async () => {
    mockWebgl();
    const getFrameInput = vi.fn(() => input);
    const { unmount } = render(<HyperrideCanvas getFrameInput={getFrameInput} quality="high" />);
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    frames.shift()?.(16);
    expect(getFrameInput).toHaveBeenCalled();
    expect(fake.log.composerRenders).toBe(1);

    unmount();
    const disposed = fake.log.disposed;
    for (const kind of [
      'TorusGeometry',
      'BoxGeometry',
      'BufferGeometry',
      'MeshBasicMaterial',
      'LineBasicMaterial',
      'RenderPass',
      'UnrealBloomPass',
      'OutputPass',
      'EffectComposer',
      'WebGLRenderer',
    ]) {
      expect(disposed).toContain(kind);
    }
    expect(fake.log.renderers[0]?.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it("quality 'low' renders without bloom", async () => {
    mockWebgl();
    const { unmount } = render(<HyperrideCanvas getFrameInput={() => input} quality="low" />);
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    frames.shift()?.(16);
    expect(fake.log.renders).toBe(1);
    expect(fake.log.composerRenders).toBe(0);
    unmount();
    expect(fake.log.disposed).not.toContain('UnrealBloomPass');
    expect(fake.log.disposed).toContain('WebGLRenderer');
  });
});
