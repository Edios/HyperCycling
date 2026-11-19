/**
 * Viewport matrix for the layout project. Sizes are CSS pixels.
 *
 * "bar" variants model a phone whose browser keeps its address bar and system bars on screen: the
 * owner's Android Chrome shows about 110 px less than the nominal size (see the QA strategy,
 * section 3). The tags decide which scenarios use which size, so the matrix stays selective:
 *  - `core`: runs for every scenario (cheap pages and training)
 *  - `phone`: the sizes the owner actually rides on
 *  - `wide`: tablets and desktops (only a few scenarios)
 */
export type Tag = 'core' | 'phone' | 'wide';

export interface Viewport {
  id: string;
  width: number;
  height: number;
  tags: Tag[];
  /** Phone-like: touch, mobile user agent, device scale factor. */
  mobile: boolean;
}

/** Height lost to the browser bar and the system bars on the owner's phone (px). */
export const BROWSER_BAR = 110;

export const VIEWPORTS: Viewport[] = [
  { id: 'phone-p-412x915', width: 412, height: 915, tags: ['phone'], mobile: true },
  {
    id: 'phone-p-412x805-bar',
    width: 412,
    height: 915 - BROWSER_BAR,
    tags: ['core', 'phone'],
    mobile: true,
  },
  { id: 'phone-l-915x412', width: 915, height: 412, tags: ['phone'], mobile: true },
  {
    id: 'phone-l-915x302-bar',
    width: 915,
    height: 412 - BROWSER_BAR,
    tags: ['core', 'phone'],
    mobile: true,
  },
  { id: 'small-360x640', width: 360, height: 640, tags: ['core', 'phone'], mobile: true },
  { id: 'tablet-p-768x1024', width: 768, height: 1024, tags: ['wide'], mobile: true },
  { id: 'tablet-l-1024x768', width: 1024, height: 768, tags: ['wide'], mobile: true },
  { id: 'pc-1280x800', width: 1280, height: 800, tags: ['core', 'wide'], mobile: false },
  { id: 'pc-1920x1080', width: 1920, height: 1080, tags: ['wide'], mobile: false },
];

export interface Variant {
  id: string;
  locale: 'pl-PL' | 'en-US';
  colorScheme: 'dark' | 'light';
  /** Multiplier of the root font size (Android "font size" setting, browser text zoom). */
  textScale: number;
}

/** Default variant: what most riders see. */
export const DEFAULT_VARIANT: Variant = {
  id: 'pl-dark',
  locale: 'pl-PL',
  colorScheme: 'dark',
  textScale: 1,
};

/** Extra variants, each run on a small set of viewports only (see `variantsFor`). */
export const EXTRA_VARIANTS: Variant[] = [
  { id: 'en-dark', locale: 'en-US', colorScheme: 'dark', textScale: 1 },
  { id: 'pl-light', locale: 'pl-PL', colorScheme: 'light', textScale: 1 },
  { id: 'pl-dark-t130', locale: 'pl-PL', colorScheme: 'dark', textScale: 1.3 },
  { id: 'pl-dark-t200', locale: 'pl-PL', colorScheme: 'dark', textScale: 2 },
];

export function viewportsWith(tag: Tag): Viewport[] {
  return VIEWPORTS.filter((v) => v.tags.includes(tag));
}

/**
 * LAYOUT_DEPTH=smoke  -> core viewports, default variant only (fast, for a PR)
 * LAYOUT_DEPTH=full   -> every viewport of the scenario's tags plus the extra variants on phones
 * default (standard)  -> scenario tags, default variant, and EN + text scale on the core phones
 */
export type Depth = 'smoke' | 'standard' | 'full';
export function depth(): Depth {
  const d = process.env.LAYOUT_DEPTH;
  return d === 'smoke' || d === 'full' ? d : 'standard';
}

export interface Cell {
  viewport: Viewport;
  variant: Variant;
}

export function cellsFor(tags: Tag[]): Cell[] {
  const d = depth();
  const wanted = d === 'smoke' ? (['core'] as Tag[]) : tags;
  const viewports = VIEWPORTS.filter((v) => v.tags.some((t) => wanted.includes(t)));
  const cells: Cell[] = viewports.map((viewport) => ({ viewport, variant: DEFAULT_VARIANT }));
  if (d === 'smoke') return cells;
  const extraOn = (v: Viewport): boolean =>
    d === 'full'
      ? v.tags.includes('phone') || v.id === 'pc-1280x800'
      : ['phone-p-412x805-bar', 'phone-l-915x302-bar', 'small-360x640'].includes(v.id);
  const variants =
    d === 'full' ? EXTRA_VARIANTS : EXTRA_VARIANTS.slice(0, 1).concat(EXTRA_VARIANTS[2]!);
  for (const viewport of viewports.filter(extraOn)) {
    for (const variant of variants) cells.push({ viewport, variant });
  }
  return cells;
}
