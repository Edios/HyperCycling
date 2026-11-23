import { useEffect, useRef, useState } from 'react';
import { createAutoQuality } from '../diagnostics/auto-quality';
import { createRenderScaleController, SCALE_MIN } from './render-scale';
import { readRenderStats } from './render-stats';
import { clearWebglIssue, publishWebglIssue } from './webgl-log';
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
  /**
   * Waits (ms) before each new try when WebGL is refused or the world fails to start, e.g. while
   * the GPU is still busy at app start; `onUnavailable` is called only after the last one fails.
   */
  retryDelaysMs?: readonly number[];
}

/** A busy GPU or a context limit is often gone a moment later: three more tries over ~6 s. */
export const DEFAULT_RETRY_MS: readonly number[] = [400, 1500, 4000];

const MAX_DT_SEC = 0.1;

/** Probes WebGL on a throwaway canvas and releases the context right away. */
export function probeWebgl(): { ok: true } | { ok: false; reason: string } {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
    if (!gl) return { ok: false, reason: 'getContext returned null' };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: `getContext threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function webglAvailable(): boolean {
  return probeWebgl().ok;
}

export function WorldCanvas(props: WorldCanvasProps) {
  const { viewOffsetX = 0, world: worldId = DEFAULT_WORLD } = props;
  const [lowered, setLowered] = useState(false);
  // Bumped to start over on a fresh canvas after the browser restored a lost context.
  const [epoch, setEpoch] = useState(0);
  // Failed tries so far; survives the restarts above, reset once a world runs or a context returns.
  const tries = useRef(0);
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
    const delays = props.retryDelaysMs ?? DEFAULT_RETRY_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Another try after the next delay; false when the delays are used up. */
    const retryLater = (reason: string, again: () => void): boolean => {
      publishWebglIssue(reason);
      const delay = delays[tries.current];
      if (delay === undefined) return false;
      tries.current += 1;
      timer = setTimeout(again, delay);
      return true;
    };
    const onLost = (e: Event): void => {
      e.preventDefault(); // lets the browser restore the context
      publishWebglIssue('context lost');
    };
    const onRestored = (): void => {
      clearWebglIssue();
      tries.current = 0;
      setEpoch((n) => n + 1);
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    const begin = (): void => {
      const probe = probeWebgl();
      if (!probe.ok) {
        if (!retryLater(probe.reason, begin)) unavailable();
        return;
      }
      clearWebglIssue();
      start().catch((err: unknown) => {
        if (cancelled) return;
        console.warn('World: world could not be loaded', err);
        unavailable();
      });
    };

    const start = async (): Promise<void> => {
      // three is only fetched here, when a World session actually starts
      const w = await WORLDS[worldId]();
      if (cancelled) return;
      try {
        w.init(canvas, quality);
      } catch (err) {
        console.warn('World: WebGL world failed to start', err);
        w.dispose();
        // A canvas whose context failed stays unusable: try again on a fresh one.
        const reason = `world init failed: ${err instanceof Error ? err.message : String(err)}`;
        if (!retryLater(reason, () => setEpoch((n) => n + 1))) unavailable();
        return;
      }
      tries.current = 0;
      clearWebglIssue();
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

    begin();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      cancelAnimationFrame(raf);
      observer?.disconnect();
      world?.dispose();
      worldRef.current = null;
    };
    // lowered is read only to decide whether to watch; its change is already covered by quality.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, worldId, auto, epoch]);

  // A new canvas per world/quality: a disposed renderer leaves its canvas with a lost context.
  return (
    <canvas
      key={`${worldId}:${quality}:${epoch}`}
      ref={canvasRef}
      className={styles.canvas}
      data-testid="world-canvas"
      aria-hidden="true"
    />
  );
}
