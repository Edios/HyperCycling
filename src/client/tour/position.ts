export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export type Placement = 'inside' | 'below' | 'above' | 'right' | 'left' | 'docked';

export interface BubblePosition {
  left: number;
  top: number;
  placement: Placement;
}

const MARGIN = 8;
const INSET = 16;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

/**
 * Where to put a bubble next to its target (all values in viewport coordinates). It prefers
 * below, then above, right and left, whichever fits entirely. A target that fills the screen
 * (the timeline) gets the bubble in its own top-left corner. With no room anywhere (a small phone
 * in landscape) the bubble docks to the bottom edge and the target stays highlighted.
 */
export function placeBubble(target: Rect, bubble: Size, viewport: Size, gap = 12): BubblePosition {
  const maxLeft = viewport.width - bubble.width - MARGIN;
  const maxTop = viewport.height - bubble.height - MARGIN;
  const centredLeft = clamp(target.left + target.width / 2 - bubble.width / 2, MARGIN, maxLeft);
  const centredTop = clamp(target.top + target.height / 2 - bubble.height / 2, MARGIN, maxTop);

  // A target that fills most of the screen (the timeline) gets the bubble in its own empty corner,
  // instead of covering the bar above it.
  if (
    target.height >= viewport.height * 0.5 &&
    target.width >= bubble.width + 2 * INSET &&
    target.top < viewport.height - bubble.height - INSET
  ) {
    return {
      left: clamp(target.left + INSET, MARGIN, maxLeft),
      top: clamp(Math.max(target.top, 0) + INSET, MARGIN, maxTop),
      placement: 'inside',
    };
  }

  const below = target.top + target.height + gap;
  if (below + bubble.height <= viewport.height - MARGIN) {
    return { left: centredLeft, top: below, placement: 'below' };
  }
  const above = target.top - gap - bubble.height;
  if (above >= MARGIN && above + bubble.height <= viewport.height - MARGIN) {
    return { left: centredLeft, top: above, placement: 'above' };
  }

  const right = target.left + target.width + gap;
  if (right + bubble.width <= viewport.width - MARGIN) {
    return { left: right, top: centredTop, placement: 'right' };
  }
  const left = target.left - gap - bubble.width;
  if (left >= MARGIN) return { left, top: centredTop, placement: 'left' };

  return {
    left: clamp((viewport.width - bubble.width) / 2, MARGIN, maxLeft),
    top: Math.max(MARGIN, maxTop),
    placement: 'docked',
  };
}

/** A target counts as visible when any part of it lies inside the viewport. */
export function isInViewport(rect: Rect, viewport: Size): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.left < viewport.width &&
    rect.top < viewport.height &&
    rect.left + rect.width > 0 &&
    rect.top + rect.height > 0
  );
}
