/**
 * Scene registry of the Scenes world: abstract, stylised scenes along the road (design note:
 * .superpowers/sdd/2026-10-30-spinning-tutor-v2/road-scenes-design.md). A scene is a list of
 * variants (looks: palettes and numbers for the shared sky and terrain shaders) plus an optional
 * extra builder (aurora curtains, towers). Registry order is the rotation order of the schedule.
 * To add a scene: append a definition here (and an extra in scenes-extras.ts when it needs one).
 */

/** Terrain patterns drawn by the terrain shader. */
export const PATTERN = { grid: 0, stripes: 1, dots: 2, hexes: 3 } as const;

/** Everything a variant sets. Colours are `#rrggbb` (sRGB); lerped field by field. */
export type SceneLook = {
  skyTop: string;
  skyMid: string;
  skyHorizon: string;
  horizonGlow: string;
  /** Sun (or moon) colour at its top and bottom. */
  sunA: string;
  sunB: string;
  /** Sun radius as a fraction of the view height; 0 hides it. */
  sunSize: number;
  /** Sun centre: x as a fraction of the width, y above the horizon as a fraction of the height. */
  sunX: number;
  sunY: number;
  /** 1: synthwave scanline cuts through the lower half of the sun. */
  sunStripes: number;
  /** 1: a thin ring around the sun. */
  sunRing: number;
  stars: number;
  fog: string;
  fogFar: number;
  road: string;
  /** Terrain base and pattern colours. */
  fill: string;
  line: string;
  pattern: number;
  /** Pattern cell size in world units. */
  patternScale: number;
  /** Line width of the pattern in pixels (grid) / relative size (others). */
  lineWidth: number;
  /** Side terrain (scenes-model TerrainShape). */
  height: number;
  flat: number;
  rise: number;
  roughness: number;
  /** Colours of the scene extra (curtains, tower light strips). */
  extraA: string;
  extraB: string;
  /**
   * "Trip" channels (Experience themes; the plain scenes keep PLAIN_FX, i.e. nothing changes).
   * Everything is a number or a colour, so looks still lerp field by field.
   */
  /** Second line colour: bands of it travel through the terrain pattern (`band` is their share, 0..1). */
  lineB: string;
  band: number;
  /** Scenery speed relative to the ride (eased). */
  speedMul: number;
  /** Beat pulse: strength 0..1 of the brightness swell, and its rate in Hz (about half the song tempo). */
  pulse: number;
  pulseHz: number;
  /** Flowing nebula in the sky (0 = off; Lite quality uses a cheaper version). */
  warp: number;
  /** Height factor of the scenery objects (gates, rings, towers). */
  objHeight: number;
  /** Always-on speed streaks 0..1 (a sprint adds more) and darkened screen edges 0..1 (Standard only). */
  streak: number;
  vignette: number;
  /** Construction along the road (scenes-constructs CONSTRUCT id) and terrain terrace step (0 = smooth). */
  construct: number;
  terrace: number;
};

/** The "Trip" channels switched off: what every plain scene uses. */
export function plainFx(line: string) {
  return {
    lineB: line,
    band: 0,
    speedMul: 1,
    pulse: 0,
    pulseHz: 1,
    warp: 0,
    objHeight: 1,
    streak: 0,
    vignette: 0,
    construct: 0,
    terrace: 0,
  };
}

export type SceneExtraId = 'aurora' | 'towers' | 'pylons';

export interface SceneDef {
  id: string;
  variants: readonly SceneLook[];
  extra?: SceneExtraId;
}

const SYNTH: SceneLook = {
  skyTop: '#0b0420',
  skyMid: '#3a0b4a',
  skyHorizon: '#ff4f8b',
  horizonGlow: '#ff7a59',
  sunA: '#ffe16b',
  sunB: '#ff3d8b',
  sunSize: 0.17,
  sunX: 0.5,
  sunY: 0.06,
  sunStripes: 1,
  sunRing: 0,
  stars: 0.8,
  fog: '#2a0a3a',
  fogFar: 680,
  road: '#140a26',
  fill: '#0d0420',
  line: '#ff3df0',
  pattern: PATTERN.grid,
  patternScale: 10,
  lineWidth: 1.4,
  height: 70,
  flat: 14,
  rise: 90,
  roughness: 0.85,
  extraA: '#ffffff',
  extraB: '#ffffff',
  ...plainFx('#ff3df0'),
};

const FIELDS: SceneLook = {
  skyTop: '#1d3b5c',
  skyMid: '#3f7a8c',
  skyHorizon: '#bfe8d0',
  horizonGlow: '#e6fff0',
  sunA: '#fffbe6',
  sunB: '#ffe7a8',
  sunSize: 0.1,
  sunX: 0.7,
  sunY: 0.2,
  sunStripes: 0,
  sunRing: 1,
  stars: 0,
  fog: '#7fb8a8',
  fogFar: 620,
  road: '#24343f',
  fill: '#2e6b5e',
  line: '#9fffd8',
  pattern: PATTERN.hexes,
  patternScale: 7,
  lineWidth: 1.2,
  height: 30,
  flat: 11,
  rise: 120,
  roughness: 0.1,
  extraA: '#ffffff',
  extraB: '#ffffff',
  ...plainFx('#9fffd8'),
};

const AURORA: SceneLook = {
  skyTop: '#010409',
  skyMid: '#04121e',
  skyHorizon: '#0d3340',
  horizonGlow: '#1f6f6a',
  sunA: '#e0f0ff',
  sunB: '#a8c8e8',
  sunSize: 0.035,
  sunX: 0.8,
  sunY: 0.33,
  sunStripes: 0,
  sunRing: 0,
  stars: 1.2,
  fog: '#06202a',
  fogFar: 640,
  road: '#07121c',
  fill: '#0a1a26',
  line: '#7fe8ff',
  pattern: PATTERN.dots,
  patternScale: 12,
  lineWidth: 0.7,
  height: 24,
  flat: 12,
  rise: 140,
  roughness: 0.35,
  extraA: '#3dffa8',
  extraB: '#3d8bff',
  ...plainFx('#7fe8ff'),
};

const CITY: SceneLook = {
  skyTop: '#01020a',
  skyMid: '#060a24',
  skyHorizon: '#1a2a5a',
  horizonGlow: '#2a6aff',
  sunA: '#ffffff',
  sunB: '#ffffff',
  sunSize: 0,
  sunX: 0.5,
  sunY: 0.2,
  sunStripes: 0,
  sunRing: 0,
  stars: 0.4,
  fog: '#070c22',
  fogFar: 600,
  road: '#06080f',
  fill: '#04060f',
  line: '#2a6aff',
  pattern: PATTERN.grid,
  patternScale: 16,
  lineWidth: 1,
  height: 0,
  flat: 12,
  rise: 60,
  roughness: 0,
  extraA: '#3dd6ff',
  extraB: '#2a4aff',
  ...plainFx('#2a6aff'),
};

export const SCENES: readonly SceneDef[] = [
  {
    id: 'grid',
    variants: [
      SYNTH,
      {
        ...SYNTH,
        skyTop: '#02040f',
        skyMid: '#071a3a',
        skyHorizon: '#1fb5d6',
        horizonGlow: '#3de0ff',
        sunA: '#e8fbff',
        sunB: '#3d7bff',
        sunSize: 0.14,
        sunY: 0.08,
        stars: 1,
        fog: '#05142a',
        road: '#081022',
        fill: '#020814',
        line: '#2de2ff',
        height: 60,
      },
      {
        ...SYNTH,
        skyTop: '#160a26',
        skyMid: '#5a1f3a',
        skyHorizon: '#ffb04a',
        horizonGlow: '#ff8a3d',
        sunA: '#fff2b0',
        sunB: '#ff7a2a',
        sunSize: 0.19,
        sunY: 0.04,
        stars: 0.3,
        fog: '#3a1a2c',
        road: '#1c0e1e',
        fill: '#140816',
        line: '#ffb347',
        height: 80,
      },
    ],
  },
  {
    id: 'fields',
    variants: [
      FIELDS,
      {
        ...FIELDS,
        skyTop: '#3a1d4a',
        skyMid: '#8a3f6a',
        skyHorizon: '#ffc2a0',
        horizonGlow: '#ffd9b8',
        sunA: '#fff3e0',
        sunB: '#ffb48a',
        sunSize: 0.12,
        sunX: 0.3,
        sunY: 0.17,
        fog: '#c07a7e',
        road: '#3a2434',
        fill: '#7a3450',
        line: '#ffd0b0',
        pattern: PATTERN.dots,
        patternScale: 6,
        height: 34,
      },
      {
        ...FIELDS,
        skyTop: '#211a4a',
        skyMid: '#5a4a9a',
        skyHorizon: '#d6c8ff',
        horizonGlow: '#efe8ff',
        sunA: '#ffffff',
        sunB: '#d0c0ff',
        sunSize: 0.09,
        sunX: 0.62,
        sunY: 0.25,
        fog: '#8a7ec0',
        road: '#2a2448',
        fill: '#4a3e8a',
        line: '#e8d8ff',
        pattern: PATTERN.stripes,
        patternScale: 9,
        height: 24,
      },
    ],
  },
  {
    id: 'aurora',
    extra: 'aurora',
    variants: [
      AURORA,
      {
        ...AURORA,
        skyHorizon: '#2a1240',
        horizonGlow: '#6a2a8a',
        fog: '#160a28',
        road: '#100818',
        fill: '#140a22',
        line: '#d88aff',
        extraA: '#ff4fd8',
        extraB: '#7a5cff',
      },
      {
        ...AURORA,
        skyHorizon: '#3a1a1a',
        horizonGlow: '#8a4a2a',
        fog: '#1f0f14',
        road: '#140a0e',
        fill: '#1a0e14',
        line: '#ffc89a',
        extraA: '#ffd27a',
        extraB: '#ff5f8a',
      },
    ],
  },
  {
    id: 'city',
    extra: 'towers',
    variants: [
      CITY,
      {
        ...CITY,
        skyHorizon: '#3a0f4a',
        horizonGlow: '#b02aff',
        fog: '#140720',
        line: '#b02aff',
        extraA: '#ff4fd8',
        extraB: '#7a3dff',
      },
      {
        ...CITY,
        skyHorizon: '#3a240a',
        horizonGlow: '#ff9a2a',
        fog: '#160e06',
        line: '#ff9a2a',
        extraA: '#ffd27a',
        extraB: '#ffffff',
      },
    ],
  },
];

export const SCENE_VARIANT_COUNTS: readonly number[] = SCENES.map((s) => s.variants.length);
