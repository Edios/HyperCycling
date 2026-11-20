import { describe, expect, it } from 'vitest';
import { isInViewport, placeBubble } from './position';

const bubble = { width: 300, height: 160 };
const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 844 };
const landscape = { width: 844, height: 390 };

describe('placeBubble', () => {
  it('prefers below the target, centred and kept inside the viewport', () => {
    const p = placeBubble({ left: 100, top: 100, width: 200, height: 60 }, bubble, desktop);
    expect(p.placement).toBe('below');
    expect(p.top).toBe(172);
    expect(p.left).toBe(50);
    const edge = placeBubble({ left: 0, top: 100, width: 40, height: 40 }, bubble, desktop);
    expect(edge.left).toBe(8);
  });

  it('puts the bubble inside a target that fills most of the screen', () => {
    const p = placeBubble({ left: 220, top: 200, width: 720, height: 520 }, bubble, desktop);
    expect(p.placement).toBe('inside');
    expect(p.left).toBe(236);
    expect(p.top).toBe(216);
    const narrow = placeBubble({ left: 0, top: 0, width: 220, height: 800 }, bubble, desktop);
    expect(narrow.placement).toBe('right');
  });

  it('goes above when there is no room below (a bar at the bottom of a phone)', () => {
    const p = placeBubble({ left: 0, top: 770, width: 390, height: 74 }, bubble, phone);
    expect(p.placement).toBe('above');
    expect(p.top).toBe(770 - 12 - 160);
    expect(p.left + bubble.width).toBeLessThanOrEqual(phone.width - 8);
  });

  it('goes beside the target when it is too tall for above and below', () => {
    const p = placeBubble({ left: 20, top: 40, width: 200, height: 700 }, bubble, desktop);
    expect(p.placement).toBe('right');
    expect(p.left).toBe(232);
    const q = placeBubble({ left: 1000, top: 40, width: 260, height: 700 }, bubble, desktop);
    expect(q.placement).toBe('left');
  });

  it('docks to the bottom edge when nothing fits (a phone in landscape)', () => {
    const p = placeBubble({ left: 10, top: 100, width: 820, height: 180 }, bubble, landscape);
    expect(p.placement).toBe('docked');
    expect(p.top).toBe(390 - 160 - 8);
    expect(p.left).toBeGreaterThanOrEqual(8);
  });

  it('never positions the bubble outside the viewport', () => {
    const targets = [
      { left: -50, top: -20, width: 100, height: 40 },
      { left: 360, top: 800, width: 100, height: 40 },
      { left: 200, top: 400, width: 10, height: 10 },
    ];
    for (const view of [desktop, phone, landscape]) {
      for (const t of targets) {
        const p = placeBubble(t, bubble, view);
        expect(p.left).toBeGreaterThanOrEqual(8);
        expect(p.top).toBeGreaterThanOrEqual(8);
        expect(p.left + bubble.width).toBeLessThanOrEqual(view.width - 8);
        expect(p.top + bubble.height).toBeLessThanOrEqual(view.height - 8);
      }
    }
  });
});

describe('isInViewport', () => {
  it('is true while any part is visible and false for empty or far-off rectangles', () => {
    expect(isInViewport({ left: 10, top: 10, width: 50, height: 50 }, desktop)).toBe(true);
    expect(isInViewport({ left: -40, top: 10, width: 50, height: 50 }, desktop)).toBe(true);
    expect(isInViewport({ left: 10, top: 900, width: 50, height: 50 }, desktop)).toBe(false);
    expect(isInViewport({ left: 10, top: 10, width: 0, height: 50 }, desktop)).toBe(false);
    expect(isInViewport({ left: -80, top: 10, width: 50, height: 50 }, desktop)).toBe(false);
  });
});
