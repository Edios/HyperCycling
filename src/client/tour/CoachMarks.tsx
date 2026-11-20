import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { isInViewport, placeBubble, type BubblePosition, type Rect } from './position';
import type { Tour } from './useTour';
import styles from './CoachMarks.module.css';

export interface CoachStep {
  id: string;
  /** CSS selectors tried in order; the first visible element found is highlighted. */
  targets: string[];
  title: string;
  body: string;
}

function findTarget(selectors: string[]): HTMLElement | undefined {
  for (const selector of selectors) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el && el.getClientRects().length > 0) return el;
  }
  return undefined;
}

function toRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * A non-modal tour: a small bubble next to the section it talks about, with the section
 * outlined. Nothing is dimmed or blocked, so the user can keep working; Esc skips, ←/→ move.
 */
export function CoachMarks({ steps, tour }: { steps: CoachStep[]; tour: Tour }) {
  const t = useT();
  const titleId = useId();
  const bodyId = useId();
  const bubbleRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [place, setPlace] = useState<{ pos: BubblePosition; ring?: Rect }>();
  const step = tour.running ? steps[tour.index] : undefined;
  const stepId = step?.id;
  const targets = step?.targets;

  const measure = useCallback(() => {
    const bubble = bubbleRef.current;
    if (!bubble || !targets) return;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const size = { width: bubble.offsetWidth, height: bubble.offsetHeight };
    const el = findTarget(targets);
    const rect = el ? toRect(el) : undefined;
    if (rect && isInViewport(rect, viewport)) {
      setPlace({ pos: placeBubble(rect, size, viewport), ring: rect });
    } else {
      // No visible target: the bubble sits at the bottom edge and nothing is outlined.
      setPlace({
        pos: {
          left: Math.max(8, (viewport.width - size.width) / 2),
          top: Math.max(8, viewport.height - size.height - 8),
          placement: 'docked',
        },
      });
    }
  }, [targets]);

  // Bring the target into view, then measure; re-measure on resize and on any scroll.
  useLayoutEffect(() => {
    if (!stepId || !targets) return undefined;
    findTarget(targets)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    measure();
    const onChange = (): void => measure();
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
    };
  }, [stepId, targets, measure]);

  // Focus moves to "Next" when the tour opens and goes back to where it was when it ends.
  const running = tour.running;
  useEffect(() => {
    if (!running) return undefined;
    returnFocus.current = document.activeElement as HTMLElement | null;
    nextRef.current?.focus();
    return () => {
      const back = returnFocus.current;
      if (back && document.contains(back) && back !== document.body) back.focus();
      setPlace(undefined);
    };
  }, [running]);

  // Esc skips from anywhere, unless a dialog or an open menu has already used the key.
  const skip = tour.skip;
  useEffect(() => {
    if (!running) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      skip();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [running, skip]);

  // "Back" is disabled on the first step; do not leave the keyboard user stranded on <body>.
  useEffect(() => {
    if (running && document.activeElement === document.body) nextRef.current?.focus();
  }, [running, tour.index]);

  if (!step) return null;
  const last = tour.index >= tour.count - 1;

  return (
    <>
      {place?.ring && (
        <div
          aria-hidden="true"
          className={styles.ring}
          data-testid="tour-ring"
          style={{
            left: place.ring.left - 4,
            top: place.ring.top - 4,
            width: place.ring.width + 8,
            height: place.ring.height + 8,
          }}
        />
      )}
      <div
        ref={bubbleRef}
        role="region"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className={styles.bubble}
        data-testid="tour-bubble"
        data-step={step.id}
        data-placement={place?.pos.placement}
        style={{
          left: place?.pos.left ?? 8,
          top: place?.pos.top ?? 8,
          // Not `visibility`: a hidden element cannot take focus while the first measurement is pending.
          opacity: place ? 1 : 0,
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            tour.skip();
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            tour.next();
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            e.stopPropagation();
            tour.back();
          }
        }}
      >
        <p className={styles.count} data-testid="tour-count">
          {t('tour.common.step', { n: tour.index + 1, total: tour.count })}
        </p>
        <h2 id={titleId} className={styles.title}>
          {step.title}
        </h2>
        <p id={bodyId} className={styles.body} aria-live="polite">
          {step.body}
        </p>
        <div className={styles.actions}>
          <Button className={styles.skip} onClick={tour.skip} data-testid="tour-skip">
            {t('tour.common.skip')}
          </Button>
          <span className={styles.sp} />
          <Button onClick={tour.back} disabled={tour.index === 0} data-testid="tour-back">
            {t('tour.common.back')}
          </Button>
          <Button variant="primary" ref={nextRef} onClick={tour.next} data-testid="tour-next">
            {last ? t('tour.common.done') : t('tour.common.next')}
          </Button>
        </div>
      </div>
    </>
  );
}
