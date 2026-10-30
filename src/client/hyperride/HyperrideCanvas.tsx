import { useEffect, useRef } from 'react';
import { buildWorldFrame } from './frame';
import { createPathModel } from './path-model';
import type { FrameInput, HyperrideQuality, HyperrideWorld } from './world';
import { DEFAULT_WORLD, WORLDS, type WorldId } from './worlds';
import styles from './HyperrideCanvas.module.css';

export interface HyperrideCanvasProps {
  /** Read every animation frame (engine state, segments, effort table). No store coupling. */
  getFrameInput(): FrameInput;
  quality: HyperrideQuality;
  /** Which world to show (default Neon Tunnel). */
  world?: WorldId;
  /** Horizontal view offset as a fraction of the width (0.11 for Column HUD without players). */
  viewOffsetX?: number;
  /** WebGL missing or the world failed to start: the caller falls back to Basic dark. */
  onUnavailable?(): void;
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

export function HyperrideCanvas(props: HyperrideCanvasProps) {
  const { quality, viewOffsetX = 0, world: worldId = DEFAULT_WORLD } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<HyperrideWorld | null>(null);
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
    let world: HyperrideWorld | undefined;
    let observer: ResizeObserver | undefined;
    const unavailable = (): void => latest.current.onUnavailable?.();

    if (!webglAvailable()) {
      unavailable();
      return;
    }

    const start = async (): Promise<void> => {
      // three is only fetched here, when a Hyperride session actually starts
      const w = await WORLDS[worldId]();
      if (cancelled) return;
      try {
        w.init(canvas, quality);
      } catch (err) {
        console.warn('Hyperride: WebGL world failed to start', err);
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

      const path = createPathModel({ rand: Math.random });
      let last = performance.now();
      let reported = false;
      const loop = (now: number): void => {
        raf = requestAnimationFrame(loop); // schedule first: a failing frame must not stop the loop
        const dtSec = Math.min(MAX_DT_SEC, Math.max(0, (now - last) / 1000));
        last = now;
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
          w.update(buildWorldFrame(input, { dtSec, speed: w.speed, path }));
        } catch (err) {
          if (!reported) console.error('Hyperride frame failed', err);
          reported = true;
        }
      };
      raf = requestAnimationFrame(loop);
    };

    start().catch((err: unknown) => {
      if (cancelled) return;
      console.warn('Hyperride: world could not be loaded', err);
      unavailable();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      world?.dispose();
      worldRef.current = null;
    };
  }, [quality, worldId]);

  // A new canvas per world/quality: a disposed renderer leaves its canvas with a lost context.
  return (
    <canvas
      key={`${worldId}:${quality}`}
      ref={canvasRef}
      className={styles.canvas}
      data-testid="hyperride-canvas"
      aria-hidden="true"
    />
  );
}
