import { useCallback, useEffect, useRef, useState } from 'react';
import { WORLD_SETTING_IDS } from '../../domain/settings';
import { WorldCanvas, webglAvailable } from '../world/WorldCanvas';
import { WORLD_CHOICES } from '../world/world-options';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { useDemoFrameInput } from './demo-frame-input';
import { frameStats } from './frame-stats';
import type { TestResult } from './recommendation';
import { useFrameMeter } from './useFrameMeter';
import styles from './PerformanceTestModal.module.css';

export const DEFAULT_STEP_MS = 10_000;
const MIN_OVERRIDE_MS = 200;
const MAX_OVERRIDE_MS = 120_000;
/** The first moments of a step (world loading, shader compile) are not measured. */
const WARM_UP_MS = 1500;
const WARM_UP_SHARE = 0.2;

/** Step length: 10 s, or the `diagMs` query value where overrides are allowed (dev and e2e builds). */
export function testDurationMs(params: URLSearchParams, allowOverride: boolean): number {
  if (!allowOverride) return DEFAULT_STEP_MS;
  const raw = Number(params.get('diagMs'));
  return Number.isFinite(raw) && raw >= MIN_OVERRIDE_MS && raw <= MAX_OVERRIDE_MS
    ? raw
    : DEFAULT_STEP_MS;
}

const STEPS = WORLD_SETTING_IDS.flatMap((world) =>
  (['high', 'low'] as const).map((quality) => ({ world, quality })),
);

export interface PerformanceTestModalProps {
  durationMs?: number;
  onDone(results: TestResult[]): void;
  onCancel(): void;
}

/** Full-viewport run of every world x quality combination, measuring frame times. */
export function PerformanceTestModal({
  durationMs = DEFAULT_STEP_MS,
  onDone,
  onCancel,
}: PerformanceTestModalProps) {
  const t = useT();
  const getFrameInput = useDemoFrameInput();
  const rootRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [blocked, setBlocked] = useState(() => !webglAvailable());
  const run = useRef({ startedAt: undefined as number | undefined, samples: [] as number[] });
  const results = useRef<TestResult[]>([]);
  const finished = useRef(false);
  const callbacks = useRef({ onDone, onCancel });
  useEffect(() => {
    callbacks.current = { onDone, onCancel };
  });
  const cancel = (): void => {
    finished.current = true; // no result may arrive after a cancel
    callbacks.current.onCancel();
  };
  const cancelRef = useRef(cancel);
  useEffect(() => {
    cancelRef.current = cancel;
  });

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancelRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const current = STEPS[step];
  const onFrame = useCallback(
    (dtMs: number, nowMs: number) => {
      if (finished.current || !current) return;
      const r = run.current;
      if (r.startedAt === undefined) {
        r.startedAt = nowMs;
        return;
      }
      const elapsed = nowMs - r.startedAt;
      if (elapsed >= Math.min(WARM_UP_MS, durationMs * WARM_UP_SHARE) && dtMs <= 1000) {
        r.samples.push(dtMs);
      }
      if (elapsed < durationMs) return;
      const stats = frameStats(r.samples);
      const canvas = rootRef.current?.querySelector('canvas');
      results.current.push({
        world: current.world,
        quality: current.quality,
        avgFps: stats.avgFps,
        p5Fps: stats.p5Fps,
        slowPct: stats.slowPct,
        width: canvas?.width ?? 0,
        height: canvas?.height ?? 0,
      });
      run.current = { startedAt: undefined, samples: [] };
      if (step + 1 >= STEPS.length) {
        finished.current = true;
        callbacks.current.onDone(results.current);
      } else {
        setStep(step + 1);
      }
    },
    [current, durationMs, step],
  );
  const live = useFrameMeter({ enabled: !blocked, onFrame });

  const label = (id: string): string => {
    const choice = WORLD_CHOICES.find((w) => w.value === id);
    return choice ? t(choice.labelKey) : id;
  };

  return (
    <div
      ref={rootRef}
      className={styles.root}
      role="dialog"
      aria-modal="true"
      aria-labelledby="perf-test-title"
      data-testid="performance-test"
    >
      {!blocked && current && (
        <WorldCanvas
          getFrameInput={getFrameInput}
          quality={current.quality}
          world={current.world}
          onUnavailable={() => setBlocked(true)}
        />
      )}
      <div className={styles.bar}>
        <div className={styles.info}>
          <h2 id="perf-test-title" className={styles.title}>
            {t('diagnostics.test.modalTitle')}
          </h2>
          {blocked ? (
            <p role="alert" className={styles.line}>
              {t('diagnostics.test.noWebgl')}
            </p>
          ) : (
            current && (
              <>
                <p className={styles.line} role="status">
                  {t('diagnostics.test.step', {
                    n: step + 1,
                    total: STEPS.length,
                    world: label(current.world),
                    quality: t(`diagnostics.quality.${current.quality}`),
                  })}
                </p>
                <div className={styles.track} aria-hidden="true">
                  <div
                    key={step}
                    className={styles.fill}
                    style={{ animationDuration: `${durationMs}ms` }}
                  />
                </div>
              </>
            )
          )}
        </div>
        {!blocked && (
          <span className={styles.fps} aria-hidden="true">
            {Math.round(live.avgFps)} {t('diagnostics.overlay.fps')}
          </span>
        )}
        <Button onClick={cancel} data-autofocus>
          {t('diagnostics.test.cancel')}
        </Button>
      </div>
    </div>
  );
}
