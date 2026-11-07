import { useEffect, useRef, useState } from 'react';
import { createAutoQuality } from '../diagnostics/auto-quality';
import { createRenderScaleController, SCALE_MIN } from './render-scale';
import { readRenderStats } from './render-stats';
import { buildWorldFrame } from './frame';
import { createPathModel } from './path-model';
import { createSway } from './sway';
import type { FrameInput, WorldQuality, WorldRenderer } from './world';
import { DEFAULT_WORLD, WORLDS, type WorldId } from './worlds';
import styles from './WorldCanvas.module.css';

export interface WorldCanvasProps {
  /** Read every animation frame (engine state, segments, effort table). No store coupling. */
  getFrameInput(): FrameInput;
  /** 'auto' starts on high and drops to low once if a 5 s window averages under 45 fps. */
  quality: WorldQuality | 'auto';
  /** Which world to show (default Neon Tunnel). */
  world?: WorldId;
  /** Horizontal view offset as a fraction of the width (0.11 for Column HUD without players). */
  viewOffsetX?: number;
  /** Called every frame with the HUD inertia offsets in px (omit to skip the computation). */
  onSway?(x: number, y: number): void;
  /** WebGL missing or the world failed to start: the caller falls back to Basic dark. */
  onUnavailable?(): void;
  /** Automatic quality just switched to low (once per canvas lifetime). */
  onAutoLowered?(): void;
}

const MAX_DT_SEC = 0.1;

/** Probes WebGL on a throwaway canvas and releases the context right away. */
export function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function WorldCanvas(props: WorldCanvasProps) {
  const { viewOffsetX = 0, world: worldId = DEFAULT_WORLD } = props;
  const [lowered, setLowered] = useState(false);
  const auto = props.quality === 'auto';
  const quality: WorldQuality =
    props.quality === 'auto' ? (lowered ? 'low' : 'high') : props.quality;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<WorldRenderer | null>(null);
  const latest = useRef(props);
  const offsetRef = useRef(viewOffsetX);

  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    offsetRef.current = viewOffsetX;
    worldRef.current?.setViewOffsetX(viewOffsetX);
  }, [viewOffsetX]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let raf = 0;
    let world: WorldRenderer | undefined;
    let observer: ResizeObserver | undefined;
    const unavailable = (): void => latest.current.onUnavailable?.();

    if (!webglAvailable()) {
      unavailable();
      return;
    }

    const start = async (): Promise<void> => {
      // three is only fetched here, when a World session actually starts
      const w = await WORLDS[worldId]();
      if (cancelled) return;
      try {
        w.init(canvas, quality);
      } catch (err) {
        console.warn('World: WebGL world failed to start', err);
        w.dispose();
        unavailable();
        return;
      }
      world = w;
      worldRef.current = w;
      w.setViewOffsetX(offsetRef.current);

      const resize = (): void => w.resize(canvas.clientWidth, canvas.clientHeight);
      resize();
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(resize);
        observer.observe(canvas);
      }

      const autoQuality = auto && !lowered ? createAutoQuality() : undefined;
      // continuous resolution scaling comes first; the high->low switch is the fallback at the floor
      const scaler = auto && w.setRenderScale ? createRenderScaleController() : undefined;
      const path = createPathModel({ rand: Math.random });
      const sway = createSway();
      let last = performance.now();
      let reported = false;
      const loop = (now: number): void => {
        raf = requestAnimationFrame(loop); // schedule first: a failing frame must not stop the loop
        const dtSec = Math.min(MAX_DT_SEC, Math.max(0, (now - last) / 1000));
        last = now;
        if (scaler) {
          const next = scaler.onFrame(now, readRenderStats()?.gpuMs ?? null);
          if (next !== undefined) w.setRenderScale?.(next);
        }
        if ((!scaler || scaler.scale <= SCALE_MIN) && autoQuality?.onFrame(now)) {
          setLowered(true);
          latest.current.onAutoLowered?.();
        }
        try {
          const input = latest.current.getFrameInput();
          path.onFrame({
            dist: w.distance,
            speed: w.speed,
            workoutSec: input.state.workoutElapsedSec,
            segments: input.segments,
            segmentIndex: input.state.segmentIndex,
            running: input.state.status === 'running',
          });
          const frame = buildWorldFrame(input, { dtSec, speed: w.speed, path });
          w.update(frame);
          const onSway = latest.current.onSway;
          if (onSway) {
            const o = sway.step(path, w.distance, frame.slopeTarget, dtSec);
            onSway(o.x, o.y);
          }
        } catch (err) {
          if (!reported) console.error('World frame failed', err);
          reported = true;
        }
      };
      raf = requestAnimationFrame(loop);
    };

    start().catch((err: unknown) => {
      if (cancelled) return;
      console.warn('World: world could not be loaded', err);
      unavailable();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      world?.dispose();
      worldRef.current = null;
    };
    // lowered is read only to decide whether to watch; its change is already covered by quality.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, worldId, auto]);

  // A new canvas per world/quality: a disposed renderer leaves its canvas with a lost context.
  return (
    <canvas
      key={`${worldId}:${quality}`}
      ref={canvasRef}
      className={styles.canvas}
      data-testid="world-canvas"
      aria-hidden="true"
    />
  );
}
