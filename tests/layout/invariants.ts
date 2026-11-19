import type { Page } from '@playwright/test';

/**
 * Layout invariants: rules every screen must satisfy at every size, checked from the DOM.
 * They are heuristics, so a violation is a lead for a human (severity says how likely it is real),
 * not a verdict. Nothing here knows about a particular screen except the `required` list.
 */
export type Rule =
  | 'doc-scroll-x' // the page scrolls sideways
  | 'offscreen' // a visible control or text lies outside the viewport
  | 'clipped' // a control or text is cut by an ancestor with overflow hidden
  | 'truncated' // a label is shortened by ellipsis / overflow (text does not fit)
  | 'overlap' // two controls, or a control and some text, or two texts overlap
  | 'covered' // the centre of a control is hit by a different element
  | 'icon-ratio' // an icon-only button is not square
  | 'icon-size' // an icon-only button is smaller than the touch target
  | 'icon-scale' // icon buttons of one group have different icon sizes
  | 'missing'; // a required element is absent, hidden or outside the viewport

export type Severity = 'high' | 'medium' | 'low';

export interface Violation {
  rule: Rule;
  severity: Severity;
  /** Short, human readable. Stable between viewports so findings can be merged. */
  message: string;
  /** Element description: tag, test id or class, trimmed text. */
  target: string;
  rect?: { x: number; y: number; w: number; h: number };
}

export interface Required {
  /** CSS selector of something that must be visible and inside the viewport. */
  selector: string;
  /** Used in the message; defaults to the selector. */
  label?: string;
}

export interface CheckOptions {
  required?: Required[];
  /** Skip the vertical "offscreen" check: the screen is allowed to scroll (most pages). */
  scrollsVertically?: boolean;
  /** Root to check (default: whole document). */
  root?: string;
  /** Minimum size of an icon-only button, px. */
  minTouch?: number;
}

export async function checkInvariants(
  page: Page,
  options: CheckOptions = {},
): Promise<Violation[]> {
  return page.evaluate((opts: CheckOptions) => {
    const out: Violation[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const TOL = 1.5;
    const minTouch = opts.minTouch ?? 44;
    const root: Element = (opts.root ? document.querySelector(opts.root) : null) ?? document.body;

    const INTERACTIVE =
      'button, a[href], input:not([type="hidden"]), select, textarea, summary, ' +
      '[role="button"], [role="switch"], [role="radio"], [role="tab"], [role="checkbox"], ' +
      '[role="menuitem"], [role="slider"]';

    const describe = (el: Element): string => {
      const e = el as HTMLElement;
      const id = e.getAttribute('data-testid') ?? e.getAttribute('data-g');
      const label =
        e.getAttribute('aria-label') ??
        (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
      const cls =
        typeof e.className === 'string' && e.className
          ? '.' + e.className.split(/\s+/)[0]!.replace(/_[A-Za-z0-9]{5,}$/, '')
          : '';
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : cls}${label ? ` "${label}"` : ''}`;
    };
    const rectOf = (r: DOMRect) => ({
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
    });
    const add = (
      rule: Rule,
      severity: Severity,
      message: string,
      el: Element | string,
      r?: DOMRect,
    ): void => {
      out.push({
        rule,
        severity,
        message,
        target: typeof el === 'string' ? el : describe(el),
        ...(r ? { rect: rectOf(r) } : {}),
      });
    };

    /** Rendered, not transparent, not a screen-reader-only helper. */
    const isShown = (el: Element): boolean => {
      for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05)
          return false;
        if (n.hasAttribute('inert') || n.hasAttribute('hidden')) return false;
        if (n.getAttribute('data-hidden') === 'true') return false;
      }
      // Closed <details>, content-visibility: hidden and the like keep their boxes but paint nothing.
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 2 && r.height >= 2;
    };

    /** Nearest ancestors that scroll horizontally / clip: a child may legitimately stick out. */
    const scrollsInside = (el: Element, axis: 'x' | 'y'): boolean => {
      for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const o = axis === 'x' ? cs.overflowX : cs.overflowY;
        if (o === 'auto' || o === 'scroll') {
          if (
            axis === 'x' ? n.scrollWidth > n.clientWidth + 1 : n.scrollHeight > n.clientHeight + 1
          )
            return true;
        }
      }
      return false;
    };
    const pinnedCache = new Map<Element, boolean>();
    const hasFixedAncestor = (el: Element): boolean => {
      const hit = pinnedCache.get(el);
      if (hit !== undefined) return hit;
      const p = getComputedStyle(el).position;
      const result =
        p === 'fixed' ||
        p === 'sticky' ||
        (el.parentElement !== null &&
          el.parentElement !== document.documentElement &&
          hasFixedAncestor(el.parentElement));
      pinnedCache.set(el, result);
      return result;
    };

    /** The part of a box that is actually painted: cut by ancestors with overflow hidden/clip. */
    const visibleRect = (el: Element, r: DOMRect, includeSelf: boolean): DOMRect | null => {
      let left = r.left;
      let right = r.right;
      let top = r.top;
      let bottom = r.bottom;
      for (
        let n: Element | null = includeSelf ? el : el.parentElement;
        n && n !== document.documentElement;
        n = n.parentElement
      ) {
        const cs = getComputedStyle(n);
        const hid = (o: string) => o === 'hidden' || o === 'clip';
        const b = n.getBoundingClientRect();
        if (hid(cs.overflowX)) {
          left = Math.max(left, b.left);
          right = Math.min(right, b.right);
        }
        if (hid(cs.overflowY)) {
          top = Math.max(top, b.top);
          bottom = Math.min(bottom, b.bottom);
        }
      }
      if (right - left < 1 || bottom - top < 1) return null;
      return new DOMRect(left, top, right - left, bottom - top);
    };
    /** Sticky and fixed bars sit over scrolling content by design: such pairs are not overlaps. */
    const oneIsPinned = (a: Element, b: Element): boolean =>
      hasFixedAncestor(a) !== hasFixedAncestor(b);

    /**
     * Long pages (lists of 100+ workouts) are checked where the rider can see them: the viewport
     * plus one screen above and below. Keeps the quadratic overlap loops fast and the report short.
     */
    const nearViewport = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      return r.bottom > -vh && r.top < 2 * vh;
    };

    // ---- collect ----
    const controls = [...root.querySelectorAll<HTMLElement>(INTERACTIVE)].filter(
      (el) => nearViewport(el) && isShown(el) && !el.closest('.sr-only'),
    );
    interface TextBox {
      el: Element;
      text: string;
      r: DOMRect;
      /** Painted part of the text box (null: fully clipped away). */
      vr: DOMRect | null;
    }
    const texts: TextBox[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
      const el = n.parentElement;
      if (!text || !el || el.closest('script, style, noscript, .sr-only, svg')) continue;
      if (!nearViewport(el) || !isShown(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      texts.push({ el, text, r, vr: visibleRect(el, r, true) });
    }

    // Painted rectangles of the controls, computed once (the pair loops below are quadratic).
    const controlVr = new Map<Element, DOMRect | null>(
      controls.map((c) => [c, visibleRect(c, c.getBoundingClientRect(), false)]),
    );

    // ---- document scrolls sideways ----
    const se = document.scrollingElement;
    if (se && se.scrollWidth > vw + 1)
      add('doc-scroll-x', 'high', `page scrolls sideways (${se.scrollWidth} > ${vw})`, 'document');

    // ---- offscreen ----
    const vertical = !opts.scrollsVertically;
    const checkBounds = (el: Element, r: DOMRect, what: string): void => {
      const offX = (r.left < -TOL || r.right > vw + TOL) && !scrollsInside(el, 'x');
      const offY =
        (r.top < -TOL || r.bottom > vh + TOL) &&
        (vertical || hasFixedAncestor(el)) &&
        !scrollsInside(el, 'y');
      if (offX || offY)
        add('offscreen', 'high', `${what} outside the viewport (${offX ? 'x' : 'y'})`, el, r);
    };
    for (const el of controls) {
      const vr = controlVr.get(el);
      if (vr) checkBounds(el, vr, 'control');
    }
    for (const t of texts) if (t.vr) checkBounds(t.el, t.vr, 'text');

    // ---- clipped by an ancestor (overflow hidden/clip) ----
    const clippedBy = (el: Element, r: DOMRect): Element | null => {
      for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const hid = (o: string) => o === 'hidden' || o === 'clip';
        if (!hid(cs.overflowX) && !hid(cs.overflowY)) continue;
        const b = n.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        const cutX = hid(cs.overflowX) && (r.left < b.left - 2 || r.right > b.right + 2);
        const cutY = hid(cs.overflowY) && (r.top < b.top - 2 || r.bottom > b.bottom + 2);
        if (cutX || cutY) return n;
      }
      return null;
    };
    for (const el of controls) {
      const by = clippedBy(el, el.getBoundingClientRect());
      if (by)
        add('clipped', 'high', `control cut by ${describe(by)}`, el, el.getBoundingClientRect());
    }
    const seenClip = new Set<Element>();
    for (const t of texts) {
      if (seenClip.has(t.el)) continue;
      const by = clippedBy(t.el, t.r);
      if (by) {
        seenClip.add(t.el);
        add('clipped', 'medium', `text cut by ${describe(by)}`, t.el, t.r);
      }
    }

    // ---- truncated labels (text does not fit its box) ----
    const seenTrunc = new Set<Element>();
    for (const t of texts) {
      const el = t.el as HTMLElement;
      if (seenTrunc.has(el) || el.hasAttribute('data-allow-truncate')) continue;
      const cs = getComputedStyle(el);
      const hid = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      const clamp = cs.getPropertyValue('-webkit-line-clamp');
      const clamped = clamp && clamp !== 'none' && el.scrollHeight > el.clientHeight + 1;
      if ((hid && el.scrollWidth > el.clientWidth + 1) || clamped) {
        seenTrunc.add(el);
        const key =
          cs.textOverflow === 'ellipsis' || clamped ? 'shortened with an ellipsis' : 'cut off';
        // Long descriptions (paragraphs) are clamped on purpose; titles and labels are not.
        add('truncated', el.tagName === 'P' ? 'low' : 'medium', `label ${key}`, el, t.r);
      }
    }

    // ---- overlap ----
    const inter = (a: DOMRect, b: DOMRect): { w: number; h: number } => ({
      w: Math.min(a.right, b.right) - Math.max(a.left, b.left),
      h: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
    });
    const related = (a: Element, b: Element): boolean => a.contains(b) || b.contains(a);
    for (let i = 0; i < controls.length; i += 1) {
      for (let j = i + 1; j < controls.length; j += 1) {
        const a = controls[i]!;
        const b = controls[j]!;
        if (related(a, b) || oneIsPinned(a, b)) continue;
        const ra = controlVr.get(a);
        const rb = controlVr.get(b);
        if (!ra || !rb) continue;
        const x = inter(ra, rb);
        if (x.w > 3 && x.h > 3)
          add(
            'overlap',
            'high',
            `controls overlap: ${describe(a)} / ${describe(b)}`,
            a,
            a.getBoundingClientRect(),
          );
      }
    }
    const coveredText = new Set<string>();
    for (const t of texts) {
      for (const c of controls) {
        if (!t.vr || c.contains(t.el) || t.el.contains(c) || oneIsPinned(t.el, c)) continue;
        const rc = controlVr.get(c);
        if (!rc) continue;
        const x = inter(t.vr, rc);
        if (x.w > 3 && x.h > 3) {
          const key = `${describe(t.el)}|${describe(c)}`;
          if (coveredText.has(key)) continue;
          coveredText.add(key);
          add('overlap', 'medium', `text overlaps a control: ${describe(c)}`, t.el, t.r);
        }
      }
    }
    for (let i = 0; i < texts.length; i += 1) {
      for (let j = i + 1; j < texts.length; j += 1) {
        const a = texts[i]!;
        const b = texts[j]!;
        if (!a.vr || !b.vr || a.el === b.el || related(a.el, b.el) || oneIsPinned(a.el, b.el))
          continue;
        const x = inter(a.vr, b.vr);
        // Both axes must overlap by a visible amount (line boxes touch by a pixel or two).
        if (x.w > 4 && x.h > 4 && x.h > Math.min(a.vr.height, b.vr.height) * 0.35)
          add('overlap', 'medium', `texts overlap: "${b.text.slice(0, 24)}"`, a.el, a.r);
      }
    }

    // ---- covered: something else sits on top of the centre of a control ----
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue; // offscreen reports it already
      const top = document.elementFromPoint(cx, cy);
      if (!top || el.contains(top) || top.contains(el)) continue;
      if (el.matches('input[type="file"]') || (hasFixedAncestor(top) && !hasFixedAncestor(el)))
        continue;
      // A label wrapping a hidden input, or the input inside a label, is the same control.
      if (el.closest('label')?.contains(top) || top.closest('label')?.contains(el)) continue;
      add('covered', 'high', `control covered by ${describe(top)}`, el, r);
    }

    // ---- icon buttons: square, big enough, one scale per group ----
    const iconButtons = controls.filter((el) => {
      if (!el.matches('button, [role="button"], a[href]')) return false;
      const hasText = [...el.childNodes].some((n) => (n.textContent ?? '').trim() !== '');
      const hasLabelText = (el.textContent ?? '').replace(/\s+/g, '').length > 0;
      return !hasText && !hasLabelText && !!el.querySelector('svg, img');
    });
    for (const el of iconButtons) {
      const r = el.getBoundingClientRect();
      if (Math.abs(r.width - r.height) > 1.5)
        add(
          'icon-ratio',
          'medium',
          `icon button is not square (${Math.round(r.width)}x${Math.round(r.height)})`,
          el,
          r,
        );
      if (Math.min(r.width, r.height) < minTouch - 0.5)
        add(
          'icon-size',
          Math.min(r.width, r.height) < 36 ? 'medium' : 'low',
          `icon button smaller than ${minTouch}px (${Math.round(r.width)}x${Math.round(r.height)})`,
          el,
          r,
        );
    }
    const groups = new Map<Element, HTMLElement[]>();
    for (const el of iconButtons) {
      const g = el.parentElement;
      if (g) groups.set(g, [...(groups.get(g) ?? []), el]);
    }
    for (const [g, els] of groups) {
      if (els.length < 2) continue;
      const sizes = els.map((e) => e.querySelector('svg, img')!.getBoundingClientRect().width);
      if (Math.max(...sizes) - Math.min(...sizes) > 2)
        add(
          'icon-scale',
          'low',
          `icons in one row have different sizes (${sizes.map((s) => Math.round(s)).join('/')})`,
          g,
          g.getBoundingClientRect(),
        );
      const boxes = els.map((e) => e.getBoundingClientRect().width);
      if (Math.max(...boxes) - Math.min(...boxes) > 2)
        add(
          'icon-scale',
          'low',
          `icon buttons in one row have different sizes (${boxes.map((s) => Math.round(s)).join('/')})`,
          g,
          g.getBoundingClientRect(),
        );
    }

    // ---- required elements ----
    for (const req of opts.required ?? []) {
      const el = [...document.querySelectorAll(req.selector)].find((e) => isShown(e));
      const label = req.label ?? req.selector;
      if (!el) {
        add('missing', 'high', `required element missing or hidden: ${label}`, req.selector);
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.right < 0 || r.left > vw || r.bottom < 0 || r.top > vh)
        add('missing', 'high', `required element outside the viewport: ${label}`, el, r);
    }

    // De-duplicate identical messages on the same target (text nodes of one element).
    const seen = new Set<string>();
    return out.filter((v) => {
      const k = `${v.rule}|${v.message}|${v.target}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, options);
}
