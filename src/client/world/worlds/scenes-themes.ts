import type { ThemeId } from '../../../domain/experience';
import { PATTERN, type SceneDef, type SceneLook } from './scenes-registry';

/**
 * Theme engine of the Scenes world. A theme is one scene definition whose variants are the named
 * "looks" an Experience chapter refers to; the Experience decides when each look shows (at song
 * boundaries). Themes live apart from SCENES, so adding one never changes the rotation of the
 * plain Scenes world. Neon Grid palette: dark #02040f, cyan #2de2ff, white #e8fbff, violet #3a1a7a
 * (no orange, no Tron imagery; design doc section 7.1).
 */

export interface ThemeDef {
  scene: SceneDef;
  /** Look name (as in the Experience file) → index into scene.variants. */
  looks: Readonly<Record<string, number>>;
}

const NEON: SceneLook = {
  skyTop: '#02040f',
  skyMid: '#0a0a2a',
  skyHorizon: '#12304f',
  horizonGlow: '#2de2ff',
  sunA: '#e8fbff',
  sunB: '#3a1a7a',
  sunSize: 0,
  sunX: 0.5,
  sunY: 0.06,
  sunStripes: 0,
  sunRing: 0,
  stars: 0.6,
  fog: '#02040f',
  fogFar: 620,
  road: '#050818',
  fill: '#02040f',
  line: '#2de2ff',
  pattern: PATTERN.grid,
  patternScale: 14,
  lineWidth: 1,
  height: 40,
  flat: 18,
  rise: 70,
  roughness: 0.6,
  extraA: '#e8fbff',
  extraB: '#3a1a7a',
};

const LOOK_NAMES = [
  'grid-wake',
  'light-lanes',
  'arches',
  'surge',
  'summit-scan',
  'overdrive',
  'afterglow',
] as const;

const NEON_GRID: ThemeDef = {
  scene: {
    id: 'neon-grid',
    extra: 'pylons',
    variants: [
      // grid-wake: sparse, dim, slow
      { ...NEON, patternScale: 18, lineWidth: 0.8, stars: 0.4, fogFar: 520, height: 30 },
      // light-lanes: brighter lines, first columns
      { ...NEON, skyMid: '#0d1240', patternScale: 14, lineWidth: 1.2, horizonGlow: '#5fe9ff' },
      // arches: denser, more relief
      { ...NEON, skyMid: '#14104a', patternScale: 11, lineWidth: 1.4, height: 55, rise: 85 },
      // surge: fast, dense
      { ...NEON, skyMid: '#1a1058', patternScale: 9, lineWidth: 1.6, line: '#7af0ff', height: 60 },
      // summit-scan: densest
      {
        ...NEON,
        skyMid: '#20106a',
        skyHorizon: '#3a1a7a',
        patternScale: 8,
        lineWidth: 1.8,
        line: '#e8fbff',
        height: 70,
        rise: 100,
      },
      // overdrive: maximum brightness
      {
        ...NEON,
        skyMid: '#2a1480',
        skyHorizon: '#3a1a7a',
        horizonGlow: '#e8fbff',
        patternScale: 8,
        lineWidth: 2,
        line: '#e8fbff',
        stars: 1,
      },
      // afterglow: fading, dark with a faint ember
      {
        ...NEON,
        skyMid: '#06061a',
        skyHorizon: '#0a1a2a',
        horizonGlow: '#1a6a80',
        patternScale: 18,
        lineWidth: 0.7,
        line: '#1a8aa0',
        stars: 0.3,
        height: 25,
      },
    ],
  },
  looks: Object.fromEntries(LOOK_NAMES.map((n, i) => [n, i])),
};

/** `abstract` has no definition: the plain Scenes rotation stays in charge. */
export const THEMES: Readonly<Partial<Record<ThemeId, ThemeDef>>> = { 'neon-grid': NEON_GRID };

/** Variant of a named look; unknown names fall back to the first look. */
export function lookVariant(theme: ThemeDef, look: string): number {
  return theme.looks[look] ?? 0;
}
